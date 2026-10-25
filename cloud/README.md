# blipwick for cloud sessions

A cloud session doesn't load plugins, so the Claude Code plugin can't notify you
about one:

> The plugin browser is not available in cloud sessions, and plugins you install
> from the desktop app aren't available for cloud sessions. A cloud session also
> doesn't install plugins that the repository's `.claude/settings.json` declares.

Hooks are a different matter. Claude Code "fires the same hook events wherever
it runs", cloud sessions included, and a cloud session does read the hooks in
the repo it cloned. So this adapter is a plain command hook rather than a
plugin, installed per repository.

## Install

```sh
npm run install-cloud -- /path/to/your/repo
```

That writes `.claude/blipwick/` into the repo and merges the hooks into its
`.claude/settings.json`, leaving anything already there alone. Then two things
on the cloud environment itself, in the environment dialog on claude.ai/code:

1. **Network access** > **Custom** > **Allowed domains**: add a line for
   `ntfy.sh`, and keep *Also include default list of common package managers*
   checked. The default **Trusted** list does not include `ntfy.sh`, so without
   this every push fails silently.
2. **Environment variables**, in `.env` format:
   ```
   NTFY_TOPIC=claude-your-topic-here
   ```

Finally, commit `.claude/` in that repo.

Use the same topic as the plugin and the extension, and everything lands on the
one subscription on your phone.

## Settings

All of them are environment variables on the cloud environment.

| Variable | Default | What it does |
| --- | --- | --- |
| `NTFY_TOPIC` | *(none)* | **Required.** Without it the hooks do nothing. |
| `NTFY_SERVER` | `https://ntfy.sh` | Your own server, if you self-host. Add it to the allowlist too. |
| `NTFY_TOKEN` | *(empty)* | An access token for a protected topic. |
| `BLIPWICK_NOTIFY_ON` | `all` | `all`, `input-and-errors`, or `errors`. |
| `BLIPWICK_MIN_TURN_SECONDS` | `0` | Only push for turns that ran at least this long. |

## What you get

The same three pushes as the plugin, from the matching hook events:

| Hook event | Push |
| --- | --- |
| `Stop` | `my-app: Claude finished (4m 12s)` |
| `Notification` | `my-app: Permission needed` |
| `StopFailure` | `my-app: Claude stopped - Rate limited` |

`UserPromptSubmit` sends nothing. It leaves a timestamp in the sandbox's temp
directory, keyed by session, so `Stop` can say how long the turn took and
`BLIPWICK_MIN_TURN_SECONDS` can work. Classic hooks have no turn-start event of
their own.

## Things worth knowing

- **It only fires in the cloud.** The first thing `notify.mjs` checks is
  `$CLAUDE_CODE_REMOTE === "true"`, which Claude Code sets in remote web
  environments and not in the local CLI. Without that check a local session
  would push twice, once from the plugin and once from here.
- **No topic, no push.** Someone who clones the repo without setting
  `NTFY_TOPIC` gets nothing, and nothing reaches your topic.
- **Environment variables are readable** by anyone who uses that environment, so
  put the topic on an environment of your own rather than a shared one.
- **It never blocks a turn.** The script always exits 0. On `Stop`, exit 2 would
  tell Claude to keep going, and any other non-zero code is reported as a hook
  error, so a failed push is written to stderr and otherwise ignored.
- **Per repository, not global.** Cloud sessions don't read
  `~/.claude/settings.json`, so each repo you want notified needs its own copy.

## Files

| File | Does |
| --- | --- |
| `blipwick/notify.mjs` | Reads a hook event on stdin, sends the push |
| `blipwick/push.js` | **Generated.** A copy of `/core/push.js` |
| `settings.snippet.json` | The hooks the installer merges in |
| `notify.test.mjs` | Runs the script as a hook against a throwaway server |

```sh
npm test        # run the cloud adapter's tests
npm run sync    # refresh blipwick/push.js from core/push.js
```
