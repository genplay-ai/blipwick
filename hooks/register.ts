import type { EngineInterface, PluginOptions, Register } from 'claude-code'
import {
  basename,
  errorPush,
  errorText,
  finishedPush,
  needsInputPush,
  normalizeNotifyOn,
  normalizeServer,
  ntfyRequest,
  randomId,
  testPush,
} from '../core/push.js'

// The Claude Code adapter: it turns engine events into the pushes described in
// core/push.js and sends them with $.http.fetch. One push per event, published
// to ntfy (https://ntfy.sh) as JSON so titles and bodies keep their UTF-8 text.

type Push = { title: string; message: string; tags: string[]; priority: number }

type About = { where: string; agent: string; product: string }

type Config = {
  topic: string
  server: string
  token: string
  notifyOn: 'all' | 'input-and-errors' | 'errors'
  minTurnMs: number
}

const TOPIC_KEY = 'generatedTopic'

const ERROR_TEXT: Record<string, string> = {
  rate_limit: 'Rate limited',
  overloaded: 'API overloaded',
  billing_error: 'Billing problem',
  authentication_failed: 'Authentication failed',
  max_output_tokens: 'Hit the output token limit',
  server_error: 'API server error',
}

// When the current main turn started: set by its first turn.start (subagent
// turns run inside it), cleared when the turn stops.
let turnStartedAt: number | undefined

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'notify-setup',
      description: 'Show how to receive blipwick push notifications and send a test',
    })
    return next(e)
  })

  on('command.run', { command: 'notify-setup' }, async $ => {
    const topic = await topicFor($, cfg)
    try {
      await publish($, cfg, topic, testPush('Claude Code finishes, needs you, or stops on an error'))
    } catch (err) {
      return { text: `Could not reach ${cfg.server}: ${errorText(err)}` }
    }
    return { text: setupText(cfg, topic) }
  })

  on('turn.start', async ($, e, next) => {
    if (turnStartedAt === undefined) turnStartedAt = await $.clock.now()
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    const startedAt = turnStartedAt
    turnStartedAt = undefined
    if (cfg.notifyOn !== 'all') return result
    const tookMs = startedAt === undefined ? Infinity : (await $.clock.now()) - startedAt
    if (tookMs < cfg.minTurnMs) return result

    await tryPublish($, cfg, finishedPush(about(e.cwd), e.last_assistant_message, tookMs))
    return result
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    const result = await next(e)
    if (cfg.notifyOn === 'errors') return result
    await tryPublish($, cfg, needsInputPush(about(e.cwd), e.title, e.message))
    return result
  }).catch(($, e, next) => next(e))

  on('classic.StopFailure', async ($, e, next) => {
    const result = await next(e)
    turnStartedAt = undefined
    const reason = ERROR_TEXT[e.error] ?? `Error: ${e.error}`
    const details = [e.error_details, e.last_assistant_message].filter(Boolean).join('\n\n')
    await tryPublish($, cfg, errorPush(about(e.cwd), reason, details))
    return result
  }).catch(($, e, next) => next(e))
}

function about(cwd: string | undefined): About {
  return { where: basename(cwd, 'Claude Code'), agent: 'Claude', product: 'Claude Code' }
}

async function topicFor($: EngineInterface, cfg: Config): Promise<string> {
  if (cfg.topic) return cfg.topic
  const saved = await $.store.get(TOPIC_KEY)
  if (typeof saved === 'string' && saved) return saved
  const topic = `claude-${randomId(20)}`
  await $.store.set(TOPIC_KEY, topic)
  return topic
}

async function publish($: EngineInterface, cfg: Config, topic: string, push: Push): Promise<void> {
  const { url, init } = ntfyRequest(cfg.server, cfg.token, topic, push)
  const res = await $.http.fetch(url, init)
  if (!res.ok) throw new Error(`ntfy answered ${res.status}: ${res.text.slice(0, 200)}`)
}

// Never let a failed push get in the way of the session.
async function tryPublish($: EngineInterface, cfg: Config, push: Push): Promise<void> {
  try {
    await publish($, cfg, await topicFor($, cfg), push)
  } catch (err) {
    $.ui.log(`blipwick: ${errorText(err)}`)
  }
}

function readConfig(options: PluginOptions): Config {
  return {
    topic: String(options.topic || '').trim(),
    server: normalizeServer(options.server),
    token: String(options.token || '').trim(),
    notifyOn: normalizeNotifyOn(options.notifyOn),
    minTurnMs: Math.max(0, Number(options.minTurnSeconds ?? 0) || 0) * 1000,
  }
}

function setupText(cfg: Config, topic: string): string {
  const onDefault = cfg.server === 'https://ntfy.sh'
  return [
    'Sent a test notification.',
    '',
    `Topic:  ${topic}`,
    `Web:    ${cfg.server}/${topic}`,
    '',
    'To get it on your phone:',
    '  1. Install the ntfy app (iOS App Store / Google Play / F-Droid).',
    `  2. Tap "+" and subscribe to the topic "${topic}"${onDefault ? '.' : ` on server ${cfg.server}.`}`,
    '',
    'Anyone who knows the topic name can read it, so keep it private.',
    'Change the topic, server, or when you are notified in /config (blipwick).',
    '',
    'Using the same topic in the blipwick browser extension puts your ChatGPT',
    'notifications in this same place. See extension/README.md.',
  ].join('\n')
}
