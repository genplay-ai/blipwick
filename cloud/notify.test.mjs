// Runs the cloud adapter the way a hook does: a JSON event on stdin, against a
// throwaway ntfy server. `node --test cloud/`.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'blipwick', 'notify.mjs')

let server
let origin
let received = []
let status = 200

before(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(body || '{}') })
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})

after(() => server.close())

// Runs the hook and resolves once it has exited and the server has caught up.
function runHook(event, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        CLAUDE_CODE_REMOTE: 'true',
        NTFY_TOPIC: 'test-topic',
        NTFY_SERVER: origin,
        NTFY_TOKEN: '',
        BLIPWICK_NOTIFY_ON: 'all',
        BLIPWICK_MIN_TURN_SECONDS: '0',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => resolve({ code, stderr }))
    child.stdin.end(JSON.stringify(event))
  })
}

const STOP = {
  hook_event_name: 'Stop',
  session_id: 'sess-1',
  cwd: '/home/me/my-app',
  stop_hook_active: false,
  last_assistant_message: 'Refactor complete, tests pass.',
}

test('Stop sends a finished push with the reply and the project', async () => {
  received = []
  const { code } = await runHook(STOP)
  assert.equal(code, 0)
  assert.equal(received.length, 1)
  assert.equal(received[0].body.topic, 'test-topic')
  assert.equal(received[0].body.title, 'my-app: Claude finished')
  assert.equal(received[0].body.message, 'Refactor complete, tests pass.')
})

test('Notification sends a needs-input push at high priority', async () => {
  received = []
  await runHook({
    hook_event_name: 'Notification',
    session_id: 'sess-1',
    cwd: '/home/me/my-app',
    message: 'Claude needs your permission to use Bash',
    title: 'Permission needed',
    notification_type: 'permission_prompt',
  })
  assert.equal(received.length, 1)
  assert.equal(received[0].body.title, 'my-app: Permission needed')
  assert.equal(received[0].body.priority, 4)
})

test('StopFailure names the API error', async () => {
  received = []
  await runHook({
    hook_event_name: 'StopFailure',
    session_id: 'sess-1',
    cwd: '/x/proj',
    error: 'rate_limit',
    error_details: 'Usage limit reached',
  })
  assert.equal(received.length, 1)
  assert.equal(received[0].body.title, 'proj: Claude stopped - Rate limited')
  assert.equal(received[0].body.priority, 5)
})

test('a local session sends nothing, so the plugin is not doubled up', async () => {
  received = []
  const { code } = await runHook(STOP, { CLAUDE_CODE_REMOTE: '', BLIPWICK_FORCE: '' })
  assert.equal(code, 0)
  assert.equal(received.length, 0)
})

test('no topic configured sends nothing', async () => {
  received = []
  await runHook(STOP, { NTFY_TOPIC: '' })
  assert.equal(received.length, 0)
})

test('UserPromptSubmit marks the turn and Stop reports how long it took', async () => {
  received = []
  await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'timed-1', cwd: '/home/me/my-app' })
  assert.equal(received.length, 0)

  await runHook({ ...STOP, session_id: 'timed-1' })
  assert.equal(received.length, 1)
  assert.match(received[0].body.title, /^my-app: Claude finished \(\d+s\)$/)
})

test('a turn shorter than BLIPWICK_MIN_TURN_SECONDS sends nothing', async () => {
  received = []
  await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'short-1', cwd: '/home/me/my-app' })
  await runHook({ ...STOP, session_id: 'short-1' }, { BLIPWICK_MIN_TURN_SECONDS: '600' })
  assert.equal(received.length, 0)
})

test('notifyOn "errors" only sends on StopFailure', async () => {
  received = []
  await runHook(STOP, { BLIPWICK_NOTIFY_ON: 'errors' })
  await runHook(
    { hook_event_name: 'Notification', session_id: 'sess-1', cwd: '/x/proj', message: 'Waiting' },
    { BLIPWICK_NOTIFY_ON: 'errors' },
  )
  assert.equal(received.length, 0)

  await runHook(
    { hook_event_name: 'StopFailure', session_id: 'sess-1', cwd: '/x/proj', error: 'overloaded' },
    { BLIPWICK_NOTIFY_ON: 'errors' },
  )
  assert.equal(received.length, 1)
})

test('a failing ntfy server still exits 0, so the turn is never blocked', async () => {
  received = []
  status = 500
  const { code, stderr } = await runHook(STOP)
  status = 200
  assert.equal(code, 0)
  assert.match(stderr, /blipwick: ntfy answered 500/)
})

test('an unparseable event exits 0 without sending', async () => {
  received = []
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, CLAUDE_CODE_REMOTE: 'true', NTFY_TOPIC: 'test-topic', NTFY_SERVER: origin },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.end('not json')
  const code = await new Promise(resolve => child.on('close', resolve))
  assert.equal(code, 0)
  assert.equal(received.length, 0)
})
