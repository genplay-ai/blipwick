# ping-me

Get a push notification on your phone when Claude Code:

- ✅ **finishes** a long task
- 🔔 **needs you**: a permission prompt, or it's waiting for input
- ⚠️ **stops on an error**: rate limit, overloaded API, billing, and so on

Notifications go through [ntfy](https://ntfy.sh), a free, open-source push service. You don't need an account or API key, and there's no server to run. It works on Windows, macOS and Linux.

## Install

Type this at the Claude Code prompt in a terminal session:

```
/plugin install ping-me --marketplace genplay-ai/ping-me
```

Answer `y` to add the marketplace, then press Enter to install for your user. Then run:

```
/notify-setup
```

The command sends a test push and shows your private topic name. On your phone:

1. Install the **ntfy** app: [iOS](https://apps.apple.com/app/ntfy/id1625396347), [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy), or [F-Droid](https://f-droid.org/packages/io.heckel.ntfy/).
2. Tap **+** and subscribe to the topic that `/notify-setup` printed.

That's it. You can also watch the topic in a browser at `https://ntfy.sh/<your-topic>`.

## What you get

| When | Title | Priority |
| --- | --- | --- |
| A turn finishes, if it ran at least `minTurnSeconds` | `my-app: Claude finished (4m 12s)`, with Claude's last reply as the body | default |
| Claude needs permission or is waiting for input | `my-app: Claude needs your input` | high |
| The turn stops on an API error | `my-app: Claude stopped - Rate limited` | urgent |

`my-app` is the name of the project folder, so you can tell sessions apart.

## Settings

Change these with `/config`, under **ping-me**:

| Setting | Default | What it does |
| --- | --- | --- |
| `topic` | *(generated)* | Your ntfy topic. If you leave it empty, ping-me generates a random, hard-to-guess one and saves it. |
| `server` | `https://ntfy.sh` | Your own server, if you [self-host ntfy](https://docs.ntfy.sh/install/). |
| `token` | *(empty)* | An access token (`tk_...`) for protected topics. It's stored in secure storage. |
| `notifyOn` | `all` | `all`, `input-and-errors` (no "finished" pushes), or `errors`. |
| `minTurnSeconds` | `30` | Don't send "finished" pushes for quick turns you were watching anyway. Set it to `0` to get a push every time. |

## Privacy

- Anyone who knows your topic name can read your notifications. The generated topic is random, so it can't realistically be guessed, but keep it private. For stronger protection, use a token-protected topic or self-host ntfy.
- The push contains the project folder name and up to 400 characters of Claude's last message. Nothing else leaves your machine, and the push goes only to the server you configure.

## Development

The plugin is a single hooks module, [hooks/register.ts](hooks/register.ts), that runs inside Claude Code's plugin runtime. There's nothing to build.

```sh
claude plugin validate .   # check the manifest, marketplace and hooks module
claude plugin test .       # run hooks/*.test.ts
claude --plugin-dir .      # try it in a session without installing
```

## License

MIT
