import { expect, test } from 'claude-code/testing'
import { clip, finishedPush, ntfyRequest, randomId } from '../core/push.js'

// core/push.js is shared with the browser extension, so these lock the wording
// and the request shape that both adapters depend on.

const CLAUDE = { where: 'my-app', agent: 'Claude', product: 'Claude Code' }
const CHATGPT = { where: 'Refactoring a parser', agent: 'ChatGPT', product: 'ChatGPT' }

test('each adapter names itself in the title', async () => {
  expect(finishedPush(CLAUDE, 'Done.', 45_000).title).toBe('my-app: Claude finished (45s)')
  expect(finishedPush(CHATGPT, 'Done.', 123_000).title).toBe('Refactoring a parser: ChatGPT finished (2m 3s)')
})

test('an empty reply falls back to the product name', async () => {
  expect(finishedPush(CHATGPT, '   ', 1_000).message).toBe('ChatGPT is done and waiting for you.')
})

test('a duration is left out when it is not known', async () => {
  expect(finishedPush(CLAUDE, 'Done.', Infinity).title).toBe('my-app: Claude finished')
})

test('a long message is clipped to what fits in a push', async () => {
  const { init } = ntfyRequest('https://ntfy.sh', '', 'topic', finishedPush(CLAUDE, 'x'.repeat(900), 1_000))
  const body = JSON.parse(init.body)
  expect(body.message.length).toBe(400)
  expect(body.message.endsWith('…')).toBe(true)
  expect(clip('short', 400)).toBe('short')
})

test('the request carries the topic, and a token only when there is one', async () => {
  const withToken = ntfyRequest('https://ntfy.example.com/', 'tk_secret', 'my-topic', finishedPush(CLAUDE, 'hi', 1))
  expect(withToken.url).toBe('https://ntfy.example.com')
  expect(JSON.parse(withToken.init.body).topic).toBe('my-topic')
  expect(withToken.init.headers.Authorization).toBe('Bearer tk_secret')

  const without = ntfyRequest('', '', 'my-topic', finishedPush(CLAUDE, 'hi', 1))
  expect(without.url).toBe('https://ntfy.sh')
  expect(without.init.headers.Authorization).toBeUndefined()
})

test('a generated topic is long and hard to guess', async () => {
  expect(randomId(20)).toMatch(/^[a-z2-9]{20}$/)
  expect(randomId(20)).not.toBe(randomId(20))
})
