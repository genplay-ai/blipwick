# blipwick

Get a push notification on your phone when your AI assistant:

- ✅ **finishes** a long task
- 🔔 **needs you**: a permission prompt, or it's waiting for input
- ⚠️ **stops on an error**: rate limit, overloaded API, billing, and so on

Notifications go through [ntfy](https://ntfy.sh), a free, open-source push service. You don't need an account or API key, and there's no server to run. It works on Windows, macOS and Linux.

Three parts, one topic:

| Part | Covers | All three kinds of push? |
| --- | --- | --- |
| **Claude Code plugin** | Claude Code in the terminal, the desktop app and your IDE | Yes |
| **[Cloud hooks](cloud/README.md)** | Claude Code cloud sessions, per repository | Yes |
| **[Browser extension](extension/README.md)** | ChatGPT on the web | Finished only — ChatGPT has no hooks for the rest |

Point them all at the same ntfy topic and you subscribe once on your phone. The title says where each push came from.

## Install the Claude Code plugin

Type this at the Claude Code prompt in a terminal session:

```
/plugin marketplace add genplay-ai/blipwick
/plugin install blipwick@blipwick
```

Then run:

```
/notify-setup
```

The command sends a test push and shows your private topic name. On your phone:

1. Install the **ntfy** app: [iOS](https://apps.apple.com/app/ntfy/id1625396347), [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy), or [F-Droid](https://f-droid.org/packages/io.heckel.ntfy/).
2. Tap **+** and subscribe to the topic that `/notify-setup` printed.

That's it. You can also watch the topic in a browser at `https://ntfy.sh/<your-topic>` — though a browser subscription is not a subscription in the phone app, only a way to read the topic.

You install it once, not once per surface. The plugin lives in your user
settings, so the same install covers Claude Code in the terminal, in the desktop
app and in your IDE, and there is no source to clone: Claude Code fetches the
plugin from GitHub and caches it.

> Plugins load where the session runs, and a cloud session loads none of them. For those, install the [cloud hooks](cloud/README.md) in the repository instead.

## Install the cloud hooks

Cloud sessions don't load plugins, but they do fire the same hook events and
they do read the repo they cloned. So the same three pushes are available there
as a per-repository hook:

```sh
npm run install-cloud -- /path/to/your/repo
```

It also needs `ntfy.sh` on the environment's allowed-domains list and an
`NTFY_TOPIC` environment variable — [cloud/README.md](cloud/README.md) has the
exact steps and the caveats.

## Install the ChatGPT extension

Load `extension/` unpacked in Chrome, then paste the topic that `/notify-setup`
printed. Full instructions, settings and how the detection works:
[extension/README.md](extension/README.md).

## What you get

| When | Title | Priority |
| --- | --- | --- |
| A turn finishes (only turns of at least `minTurnSeconds`, if you set it) | `my-app: Claude finished (4m 12s)`, with the last reply as the body | default |
| Claude needs permission or is waiting for input | `my-app: Claude needs your input` | high |
| The turn stops on an API error | `my-app: Claude stopped - Rate limited` | urgent |
| ChatGPT finishes a reply | `Refactoring a parser: ChatGPT finished (2m 03s)` | default |

For Claude Code, `my-app` is the name of the project folder. For ChatGPT, it's the conversation title. Either way you can tell sessions apart.

## Settings

Change these with `/config`, under **blipwick**. The extension has its own, in [its README](extension/README.md#settings).

| Setting | Default | What it does |
| --- | --- | --- |
| `topic` | *(generated)* | Your ntfy topic. If you leave it empty, blipwick generates a random, hard-to-guess one and saves it. |
| `server` | `https://ntfy.sh` | Your own server, if you [self-host ntfy](https://docs.ntfy.sh/install/). |
| `token` | *(empty)* | An access token (`tk_...`) for protected topics. It's stored in secure storage. |
| `notifyOn` | `all` | `all`, `input-and-errors` (no "finished" pushes), or `errors`. |
| `minTurnSeconds` | `0` | Send a "finished" push only for turns that ran at least this long. `0` pushes after every turn; raise it (e.g. `30`) to skip quick turns you were watching anyway. |

## Nothing arrives

Work down the chain rather than guessing. One command tells you which half is
broken — ask ntfy what it is holding for your topic:

```sh
curl -s "https://ntfy.sh/<your-topic>/json?poll=1&since=12h"
```

**Messages come back.** blipwick is doing its job and the break is on the phone.

- A subscription in a browser is not a subscription in the app. Open the ntfy
  app and check the topic is in its list. Subscribing pulls the last 12 hours,
  so the backlog should appear at once; if it stays empty, the topic or the
  server is wrong.
- Check the operating system's notification permission for ntfy.
- On Android, turn off battery optimisation for ntfy. Instant delivery needs a
  foreground service, and a power saver that kills it leaves you on slow
  polling, which looks like "sometimes it arrives, very late".

**Nothing comes back.** No push was ever sent.

- Is the session local? A cloud session loads no plugins at all. Run
  `/notify-setup`: if the command doesn't exist, the plugin isn't loaded there.
- In the desktop app, the environment selector under the prompt box has to be on
  a **Local** entry rather than a cloud one. A running cloud session can't be
  moved to local, so start a new session instead.
- For cloud sessions, use the [cloud hooks](cloud/README.md), and check that
  `ntfy.sh` is on the environment's allowed-domains list. The default **Trusted**
  list doesn't include it, and the push then fails silently.
- A cloud environment's variables reach a session when it starts, so after
  changing `NTFY_TOPIC` open a new session rather than reusing the old one.
- A cloud session runs the `.claude/` of the branch it cloned. The hooks have to
  be on that branch — usually the default one.

## Privacy

- Anyone who knows your topic name can read your notifications. The generated topic is random, so it can't realistically be guessed, but keep it private. For stronger protection, use a token-protected topic or self-host ntfy.
- The push contains the project folder or conversation name and up to 400 characters of the last message. Nothing else leaves your machine, and the push goes only to the server you configure.

## Development

```
core/push.js      what a push says and how it reaches ntfy — shared, no I/O
hooks/register.ts the Claude Code adapter (engine events -> pushes)
cloud/            the cloud-session adapter (command hooks -> pushes)
extension/        the ChatGPT adapter (page signals -> pushes)
```

Adapters bring their own fetch and their own storage; everything about how a
push is worded lives in `core/push.js`. Two of them can only load files from
inside their own folder — a packed extension, and the cloud adapter once it is
copied into a repo — so that file is copied to each and the copies are
committed:

```sh
npm run sync               # copy core/push.js to every adapter
npm run check              # fail if a copy has drifted
npm test                   # run the cloud adapter's tests
```

The plugin is a single hooks module, [hooks/register.ts](hooks/register.ts), that runs inside Claude Code's plugin runtime. There's nothing to build.

```sh
claude plugin validate .   # check the manifest, marketplace and hooks module
claude plugin test .       # run hooks/*.test.ts
claude --plugin-dir .      # try it in a session without installing
```

## License

MIT
