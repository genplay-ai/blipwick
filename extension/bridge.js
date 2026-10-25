// Runs in the extension's world on the ChatGPT tab. It turns the signals from
// detector.js into one "a turn finished" message for the service worker, and
// watches the DOM as a fallback in case ChatGPT's network shape changes.
//
// It never sends the push itself: the page's Content-Security-Policy blocks
// calls to ntfy from here. background.js does the sending.

const SETTLE_MS = 400 // let the last tokens render before reading the reply
const STOP_BUTTON = '[data-testid="stop-button"], button[aria-label*="stop" i]'

let turnOpen = false
let startedAt = 0
let settleTimer

function startTurn() {
  if (turnOpen) return
  turnOpen = true
  startedAt = Date.now()
}

function endTurn() {
  if (!turnOpen) return
  clearTimeout(settleTimer)
  settleTimer = setTimeout(finishTurn, SETTLE_MS)
}

function finishTurn() {
  if (!turnOpen) return
  turnOpen = false
  const tookMs = Date.now() - startedAt
  try {
    chrome.runtime.sendMessage({
      type: 'turn-finished',
      where: conversationTitle(),
      message: lastAssistantText(),
      tookMs,
      hidden: document.visibilityState === 'hidden' || !document.hasFocus(),
    })
  } catch {
    // The extension was reloaded or updated under us. Nothing to do.
  }
}

function conversationTitle() {
  const title = (document.title || '').replace(/^ChatGPT\s*[-–|]\s*/i, '').trim()
  return title && title.toLowerCase() !== 'chatgpt' ? title : 'ChatGPT'
}

function lastAssistantText() {
  const turns = document.querySelectorAll('[data-message-author-role="assistant"]')
  const last = turns[turns.length - 1]
  return last ? (last.innerText || '').trim() : ''
}

window.addEventListener('message', event => {
  if (event.source !== window) return
  const data = event.data
  if (!data || data.source !== 'blipwick') return
  if (data.type === 'turn-start') startTurn()
  else if (data.type === 'turn-end') endTurn()
})

// Fallback: the stop button is present only while ChatGPT is generating. If the
// network signals ever stop arriving, this still opens and closes the turn.
let stopButtonSeen = false
const observer = new MutationObserver(() => {
  const present = !!document.querySelector(STOP_BUTTON)
  if (present === stopButtonSeen) return
  stopButtonSeen = present
  if (present) startTurn()
  else endTurn()
})

observer.observe(document.documentElement, { childList: true, subtree: true })
