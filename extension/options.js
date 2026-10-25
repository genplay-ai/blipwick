import { DEFAULT_SERVER, normalizeServer } from './core/push.js'

const fields = {
  topic: document.getElementById('topic'),
  server: document.getElementById('server'),
  token: document.getElementById('token'),
  minTurnSeconds: document.getElementById('minTurnSeconds'),
  onlyWhenHidden: document.getElementById('onlyWhenHidden'),
}
const status = document.getElementById('status')

function say(text, bad = false) {
  status.textContent = text
  status.classList.toggle('bad', bad)
}

async function load() {
  const synced = await chrome.storage.sync.get({
    topic: '',
    server: DEFAULT_SERVER,
    minTurnSeconds: 0,
    onlyWhenHidden: true,
  })
  const { token } = await chrome.storage.local.get({ token: '' })

  fields.topic.value = synced.topic
  fields.server.value = synced.server
  fields.token.value = token
  fields.minTurnSeconds.value = String(synced.minTurnSeconds)
  fields.onlyWhenHidden.checked = synced.onlyWhenHidden !== false

  const { topic, server } = await chrome.runtime.sendMessage({ type: 'get-topic' })
  fields.topic.placeholder = topic
  say(subscribeText(topic, server))
}

function subscribeText(topic, server) {
  const lines = [
    `Topic:  ${topic}`,
    `Web:    ${server}/${topic}`,
    '',
    'On your phone: install the ntfy app, tap "+", and subscribe to that topic.',
    'Anyone who knows the topic name can read it, so keep it private.',
  ]
  return lines.join('\n')
}

// A server other than ntfy.sh needs its own host permission, and the request
// has to come first in the click so the user gesture still counts.
async function ensureServerAllowed(server) {
  if (server === DEFAULT_SERVER) return true
  const origins = [`${server}/*`]
  if (await chrome.permissions.contains({ origins })) return true
  return chrome.permissions.request({ origins })
}

async function save(server) {
  await chrome.storage.sync.set({
    topic: fields.topic.value.trim(),
    server,
    minTurnSeconds: Math.max(0, Number(fields.minTurnSeconds.value) || 0),
    onlyWhenHidden: fields.onlyWhenHidden.checked,
  })
  await chrome.storage.local.set({ token: fields.token.value.trim() })
}

document.getElementById('save').addEventListener('click', async () => {
  const server = normalizeServer(fields.server.value)
  if (!(await ensureServerAllowed(server))) return say(`blipwick needs permission to reach ${server}.`, true)
  fields.server.value = server
  await save(server)
  const { topic } = await chrome.runtime.sendMessage({ type: 'get-topic' })
  say(`Saved.\n\n${subscribeText(topic, server)}`)
})

document.getElementById('test').addEventListener('click', async () => {
  const server = normalizeServer(fields.server.value)
  if (!(await ensureServerAllowed(server))) return say(`blipwick needs permission to reach ${server}.`, true)
  fields.server.value = server
  await save(server)

  say('Sending…')
  const result = await chrome.runtime.sendMessage({ type: 'send-test' })
  if (!result?.sent) return say(`Could not reach ${server}: ${result?.error || 'unknown error'}`, true)
  say(`Sent a test notification.\n\n${subscribeText(result.topic, result.server)}`)
})

load()
