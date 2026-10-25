import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

// Answers $.http.fetch beneath the plugin and records each push.
function captureFetch(on: On, status = 200): Sent[] {
  const sent: Sent[] = []
  on('http.fetch', ($, e) => {
    sent.push({
      url: e.url,
      headers: e.init?.headers ?? {},
      body: JSON.parse(e.init?.body ?? '{}'),
    })
    return { value: { status, ok: status < 300, headers: {}, text: status < 300 ? '{}' : 'nope' } }
  })
  return sent
}

// Stands in for the engine beneath the plugin: the classic events and turn.start.
function answerEngine(on: On) {
  on('classic.Stop', () => ({}))
  on('classic.Notification', () => ({}))
  on('classic.StopFailure', () => ({}))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
}

// A main turn that ran for `ms` on the mocked clock, then stopped.
async function runTurn($: Engine, clock: MockClock, ms: number, text = 'All done.') {
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(ms)
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: text, cwd: '/home/me/my-app' })
}

test('a long turn sends a "finished" push with the reply and project', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const sent = captureFetch(on)
  answerEngine(on)

  await runTurn($, clock, 45_000, 'Refactor complete, tests pass.')

  expect(sent.length).toBe(1)
  expect(sent[0].url).toBe('https://ntfy.sh')
  expect(sent[0].body.title).toBe('my-app: Claude finished (45s)')
  expect(sent[0].body.message).toBe('Refactor complete, tests pass.')
  expect(String(sent[0].body.topic)).toMatch(/^claude-[a-z2-9]{20}$/)
})

test('a quick turn still sends a push by default', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const sent = captureFetch(on)
  answerEngine(on)

  await runTurn($, clock, 5_000)

  expect(sent.length).toBe(1)
  expect(sent[0].body.title).toBe('my-app: Claude finished (5s)')
})

test('a turn shorter than minTurnSeconds sends nothing', { options: { minTurnSeconds: 30 } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const sent = captureFetch(on)
  answerEngine(on)

  await runTurn($, clock, 5_000)

  expect(sent.length).toBe(0)
})

test('the generated topic is kept across sessions', async ($, on) => {
  mock.store(on, { generatedTopic: 'claude-keepmekeepmekeepme' })
  const sent = captureFetch(on)
  answerEngine(on)

  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })

  expect(sent[0].body.topic).toBe('claude-keepmekeepmekeepme')
  expect(sent[0].body.priority).toBe(4)
})

test('configured topic, server and token are used', { options: { topic: 'my-topic', server: 'https://ntfy.example.com/', token: 'tk_secret' } }, async ($, on) => {
  mock.store(on)
  const sent = captureFetch(on)
  answerEngine(on)

  await $.classic.Notification({ message: 'Waiting for input', notification_type: 'idle_prompt' })

  expect(sent[0].url).toBe('https://ntfy.example.com')
  expect(sent[0].body.topic).toBe('my-topic')
  expect(sent[0].headers.Authorization).toBe('Bearer tk_secret')
})

test('notifyOn "errors" only sends on StopFailure', { options: { notifyOn: 'errors', minTurnSeconds: 0 } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const sent = captureFetch(on)
  answerEngine(on)

  await runTurn($, clock, 60_000)
  await $.classic.Notification({ message: 'Waiting', notification_type: 'idle_prompt' })
  await $.classic.StopFailure({ error: 'rate_limit', error_details: 'Usage limit reached', cwd: '/x/proj' })

  expect(sent.length).toBe(1)
  expect(sent[0].body.title).toBe('proj: Claude stopped - Rate limited')
  expect(sent[0].body.priority).toBe(5)
})

test('a failing ntfy server does not break the session', async ($, on) => {
  mock.store(on)
  captureFetch(on, 500)
  answerEngine(on)

  const result = await $.classic.Notification({ message: 'Waiting', notification_type: 'idle_prompt' })

  expect(result).toBeDefined()
})

test('/notify-setup sends a test push and shows the topic', { options: { topic: 'demo-topic' } }, async ($, on) => {
  mock.store(on)
  const sent = captureFetch(on)
  answerEngine(on)

  const { text } = await $.command.run({ command: 'notify-setup' })

  expect(sent.length).toBe(1)
  expect(sent[0].body.title).toBe('blipwick is working')
  expect(text).toContain('https://ntfy.sh/demo-topic')
})
