// Install the cloud adapter into a repository.
//
//   node scripts/install-cloud.mjs <path-to-repo>
//
// Copies .claude/blipwick/ into the repo and merges the hooks into its
// .claude/settings.json, leaving anything already there alone.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]

if (!target) {
  console.error('usage: node scripts/install-cloud.mjs <path-to-repo>')
  process.exit(1)
}

const repo = resolve(target)
const claudeDir = join(repo, '.claude')
const blipwickDir = join(claudeDir, 'blipwick')
const settingsPath = join(claudeDir, 'settings.json')

await mkdir(blipwickDir, { recursive: true })

for (const name of ['notify.mjs', 'push.js']) {
  const from = join(root, 'cloud', 'blipwick', name)
  await writeFile(join(blipwickDir, name), await readFile(from, 'utf8'))
  console.log(`wrote .claude/blipwick/${name}`)
}

const snippet = JSON.parse(await readFile(join(root, 'cloud', 'settings.snippet.json'), 'utf8'))
const settings = JSON.parse(await readFile(settingsPath, 'utf8').catch(() => '{}'))
settings.hooks ??= {}

let added = 0
for (const [event, groups] of Object.entries(snippet.hooks)) {
  settings.hooks[event] ??= []
  const commands = new Set(
    settings.hooks[event].flatMap(group => (group.hooks ?? []).map(hook => hook.command)),
  )
  for (const group of groups) {
    if (group.hooks.every(hook => commands.has(hook.command))) continue
    settings.hooks[event].push(group)
    added++
  }
}

await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
console.log(added ? `added ${added} hook(s) to .claude/settings.json` : '.claude/settings.json already had the hooks')

console.log(`
Installed into ${repo}

Two things are still needed on the cloud environment itself, in the environment
dialog on claude.ai/code:

  1. Network access -> Custom -> Allowed domains: add a line for
       ntfy.sh
     and keep "Also include default list of common package managers" checked.
     The default Trusted list does not include ntfy.sh, so without this the
     push fails silently.

  2. Environment variables, in .env format:
       NTFY_TOPIC=<your topic>
     Optional: NTFY_SERVER, NTFY_TOKEN, BLIPWICK_NOTIFY_ON,
     BLIPWICK_MIN_TURN_SECONDS.

Anyone who uses that environment can read its variables, so use an environment
of your own rather than a shared one.

Then commit .claude/ in that repo. Without NTFY_TOPIC the hooks do nothing, so
collaborators who clone it are not notified and nothing reaches your topic.`)
