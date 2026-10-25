# blipwick for ChatGPT

A Chrome extension (Manifest V3) that pushes to your phone when ChatGPT finishes
a long reply, through the same ntfy topic as the Claude Code plugin.

ChatGPT has no hooks for extensions to use, so this watches the page instead.
That is the trade-off: it works without OpenAI's cooperation, and it can break
when ChatGPT changes shape.

## Install

It is not in the Chrome Web Store yet, so load it unpacked:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Select **Load unpacked** and pick this `extension/` folder.
3. Select the blipwick icon in the toolbar.
4. Paste the topic from the Claude Code plugin (`/notify-setup` prints it), or
   leave it empty for a generated one, then **Send test push**.

Using one topic everywhere means one subscription on your phone, with Claude
Code, Codex and ChatGPT all arriving in the same place. The title says which:

| Source | Title |
| --- | --- |
| Claude Code | `my-app: Claude finished (4m 12s)` |
| ChatGPT | `Refactoring a parser: ChatGPT finished (2m 03s)` |

## Settings

Open the toolbar icon, or `chrome://extensions` > blipwick > **Extension options**.

| Setting | Default | What it does |
| --- | --- | --- |
| `topic` | *(generated)* | The ntfy topic. Set it to the plugin's topic to share one subscription. |
| `server` | `https://ntfy.sh` | Your own server, if you self-host. Asks for permission to reach it. |
| `token` | *(empty)* | An access token (`tk_…`) for a protected topic. Stored on this device only, never synced. |
| `minTurnSeconds` | `0` | Only push for replies that took at least this long. |
| `onlyWhenHidden` | on | Only push while the ChatGPT tab is in the background. Turn it off to push every time. |

## How it detects a finished reply

Two signals, so one can fail without taking the other down:

1. **The network.** `detector.js` runs in the page's own world and wraps
   `window.fetch`, watching for the `POST` to `/backend-api/…/conversation` that
   carries a turn. It reads a *clone* of the response, so the real stream is
   untouched, and reports the turn as over when that stream ends. This is the
   precise signal. XHR is watched too, listen-only.
2. **The DOM.** `bridge.js` watches the stop-generating button
   (`[data-testid="stop-button"]`). It appearing opens a turn, it going away
   closes one. This keeps working if the network shape changes.

Whichever fires first ends the turn. `bridge.js` waits 400 ms for the last
tokens to render, reads the reply and the conversation title, and hands them to
the service worker.

The push itself is sent from `background.js`. It has to be: ChatGPT's
`Content-Security-Policy` blocks a page-context `fetch` to ntfy, and a service
worker is not bound by the page's CSP.

## Files

| File | World | Does |
| --- | --- | --- |
| `detector.js` | page (MAIN) | Wraps fetch/XHR, reports turn start and end |
| `bridge.js` | extension (ISOLATED) | DOM fallback, reads the reply, one message per turn |
| `background.js` | service worker | Builds the push and sends it to ntfy |
| `options.js` / `options.html` | options + popup | Settings and the test push |
| `core/push.js` | — | **Generated.** A copy of `/core/push.js` |

`core/push.js` is shared with the Claude Code plugin so both word their pushes
the same way. A packed extension can only load files inside its own folder, so
the copy is committed. Edit the original and run `npm run sync`; `npm run check`
fails if the copy has drifted.

## Privacy

The push carries the conversation title and up to 400 characters of the reply,
and goes only to the ntfy server you configure. Nothing else leaves the browser.
The extension reads ChatGPT pages only to detect when a reply ends.
