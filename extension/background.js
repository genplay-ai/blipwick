// The ChatGPT adapter. It builds the same pushes as the Claude Code plugin
// (see core/push.js) and sends them from the service worker, which is not
// bound by the ChatGPT page's Content-Security-Policy.

import {
  DEFAULT_SERVER,
  errorText,
  finishedPush,
  normalizeServer,
  ntfyRequest,
  randomId,
  testPush,
} from './core/push.js'

const SYNCED = {
  topic: '',
  server: DEFAULT_SERVER,
  minTurnSeconds: 0,
  onlyWhenHidden: true,
}

async function getSettings() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(SYNCED),
    chrome.storage.local.get({ token: '' }),
  ])
  return {
    topic: String(synced.topic || '').trim(),
    server: normalizeServer(synced.server),
    token: String(local.token || '').trim(),
    minTurnMs: Math.max(0, Number(synced.minTurnSeconds) || 0) * 1000,
    onlyWhenHidden: synced.onlyWhenHidden !== false,
  }
}

// The topic the user set, or one generated and kept for next time. Sharing it
// with the Claude Code plugin is the point: one topic, one phone subscription.
async function topicFor(settings) {
  if (settings.topic) return settings.topic
  const { generatedTopic } = await chrome.storage.sync.get({ generatedTopic: '' })
  if (generatedTopic) return generatedTopic
  const topic = `blipwick-${randomId(20)}`
  await chrome.storage.sync.set({ generatedTopic: topic })
  return topic
}

async function publish(settings, push) {
  const topic = await topicFor(settings)
  const { url, init } = ntfyRequest(settings.server, settings.token, topic, push)
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ntfy answered ${res.status}: ${body.slice(0, 200)}`)
  }
  return topic
}

// Keep the last outcome so the options page can show whether pushes land.
async function record(error) {
  await chrome.storage.local.set({ lastSentAt: Date.now(), lastError: error ? errorText(error) : '' })
}

async function onTurnFinished(msg) {
  const settings = await getSettings()
  if (settings.onlyWhenHidden && !msg.hidden) return { skipped: 'tab-focused' }
  if (msg.tookMs < settings.minTurnMs) return { skipped: 'too-short' }

  const push = finishedPush({ where: msg.where, agent: 'ChatGPT', product: 'ChatGPT' }, msg.message, msg.tookMs)
  try {
    await publish(settings, push)
    await record()
    return { sent: true }
  } catch (err) {
    await record(err)
    return { sent: false, error: errorText(err) }
  }
}

async function onSendTest() {
  const settings = await getSettings()
  try {
    const topic = await publish(settings, testPush('ChatGPT finishes a long reply'))
    await record()
    return { sent: true, topic, server: settings.server }
  } catch (err) {
    await record(err)
    return { sent: false, error: errorText(err) }
  }
}

const HANDLERS = {
  'turn-finished': onTurnFinished,
  'send-test': onSendTest,
  'get-topic': async () => {
    const settings = await getSettings()
    return { topic: await topicFor(settings), server: settings.server }
  },
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type]
  if (!handler) return false
  // Returning true keeps the worker alive until the push has been answered.
  handler(msg).then(sendResponse, err => sendResponse({ error: errorText(err) }))
  return true
})
