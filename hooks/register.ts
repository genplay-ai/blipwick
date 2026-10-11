import type { EngineInterface, PluginOptions, Register } from 'claude-code'

// One push per event, published to ntfy (https://ntfy.sh) as JSON so titles
// and bodies keep their UTF-8 text.

type Config = {
  topic: string
  server: string
  token: string
  notifyOn: 'all' | 'input-and-errors' | 'errors'
  minTurnMs: number
}

type Push = {
  title: string
  message: string
  tags: string[]
  priority: number
}

const TOPIC_KEY = 'generatedTopic'
const MAX_MESSAGE = 400

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
      description: 'Show how to receive ping-me push notifications and send a test',
    })
    return next(e)
  })

  on('command.run', { command: 'notify-setup' }, async $ => {
    const topic = await topicFor($, cfg)
    try {
      await publish($, cfg, topic, {
        title: 'ping-me is working',
        message: 'You will get a push here when Claude Code finishes, needs you, or stops on an error.',
        tags: ['tada'],
        priority: 3,
      })
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

    const took = Number.isFinite(tookMs) ? ` (${formatDuration(tookMs)})` : ''
    await tryPublish($, cfg, {
      title: `${basename(e.cwd)}: Claude finished${took}`,
      message: e.last_assistant_message?.trim() || 'Claude Code is done and waiting for you.',
      tags: ['white_check_mark'],
      priority: 3,
    })
    return result
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    const result = await next(e)
    if (cfg.notifyOn === 'errors') return result
    await tryPublish($, cfg, {
      title: `${basename(e.cwd)}: ${e.title || 'Claude needs your input'}`,
      message: e.message || 'Claude Code is waiting for you.',
      tags: ['bell'],
      priority: 4,
    })
    return result
  }).catch(($, e, next) => next(e))

  on('classic.StopFailure', async ($, e, next) => {
    const result = await next(e)
    turnStartedAt = undefined
    const reason = ERROR_TEXT[e.error] ?? `Error: ${e.error}`
    await tryPublish($, cfg, {
      title: `${basename(e.cwd)}: Claude stopped - ${reason}`,
      message: [e.error_details, e.last_assistant_message].filter(Boolean).join('\n\n') || reason,
      tags: ['warning'],
      priority: 5,
    })
    return result
  }).catch(($, e, next) => next(e))
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`
  const res = await $.http.fetch(cfg.server, {
    method: 'POST',
    headers,
    body: JSON.stringify({ topic, ...push, message: clip(push.message) }),
  })
  if (!res.ok) throw new Error(`ntfy answered ${res.status}: ${clip(res.text, 200)}`)
}

// Never let a failed push get in the way of the session.
async function tryPublish($: EngineInterface, cfg: Config, push: Push): Promise<void> {
  try {
    await publish($, cfg, await topicFor($, cfg), push)
  } catch (err) {
    $.ui.log(`ping-me: ${errorText(err)}`)
  }
}

function readConfig(options: PluginOptions): Config {
  const notifyOn = String(options.notifyOn || 'all')
  return {
    topic: String(options.topic || '').trim(),
    server: String(options.server || 'https://ntfy.sh').trim().replace(/\/+$/, ''),
    token: String(options.token || '').trim(),
    notifyOn: notifyOn === 'errors' || notifyOn === 'input-and-errors' ? notifyOn : 'all',
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
    'Change the topic, server, or when you are notified in /config (ping-me).',
  ].join('\n')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function basename(path: string | undefined): string {
  if (!path) return 'Claude Code'
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || path
}

function clip(text: string, max = MAX_MESSAGE): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function randomId(length: number): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('')
}
