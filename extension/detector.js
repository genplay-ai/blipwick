// Runs in the page's own world, so it can see ChatGPT's fetch and XHR calls.
//
// It only reports when a turn starts and when it ends; it never changes a
// request or a response. The end of the response stream is the precise signal.
// bridge.js watches the DOM as a fallback for when ChatGPT changes shape.

const CONVERSATION = /\/backend-api\/(?:[\w-]+\/)*conversation\b/

function post(type, detail) {
  window.postMessage({ source: 'blipwick', type, ...detail }, window.location.origin)
}

// Drain a copy of the response so the real reader is untouched. The clone is
// taken before anything reads the body, and read straight away, so it does not
// hold the stream back.
function watchStream(res) {
  if (!res.body) return post('turn-end', { via: 'no-body' })
  const reader = res.clone().body.getReader()
  ;(async () => {
    try {
      for (;;) {
        const { done } = await reader.read()
        if (done) break
      }
    } catch {
      // A cancelled or broken stream still ends the turn.
    }
    post('turn-end', { via: 'stream' })
  })()
}

const originalFetch = window.fetch
window.fetch = function (...args) {
  let isTurn = false
  try {
    const input = args[0]
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || ''
    const method = String(args[1]?.method || input?.method || 'GET').toUpperCase()
    isTurn = method === 'POST' && CONVERSATION.test(url)
  } catch {
    // Anything unexpected about the arguments means this is not our request.
  }
  if (!isTurn) return originalFetch.apply(this, args)

  post('turn-start')
  return originalFetch.apply(this, args).then(
    res => {
      try {
        watchStream(res)
      } catch {
        post('turn-end', { via: 'stream-failed' })
      }
      return res
    },
    err => {
      post('turn-end', { via: 'fetch-failed' })
      throw err
    },
  )
}

// Listen-only on XHR, in case a surface still uses it. Nothing is intercepted.
const originalOpen = XMLHttpRequest.prototype.open
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  try {
    if (String(method).toUpperCase() === 'POST' && CONVERSATION.test(String(url))) {
      this.addEventListener('loadstart', () => post('turn-start'))
      this.addEventListener('loadend', () => post('turn-end', { via: 'xhr' }))
    }
  } catch {
    // Never let the listeners get in the way of the request.
  }
  return originalOpen.call(this, method, url, ...rest)
}
