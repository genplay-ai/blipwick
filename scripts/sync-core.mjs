// core/push.js is shared by every adapter, but two of them can only load files
// from inside their own folder: a packed extension, and the cloud adapter once
// it has been copied into a repo's .claude/. So the file is copied to each and
// those copies are committed.
//
//   node scripts/sync-core.mjs           copy core/push.js to every adapter
//   node scripts/sync-core.mjs --check   fail if a copy has drifted
//
// Edit core/push.js, never a copy.

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'core', 'push.js')
const targets = [join(root, 'extension', 'core', 'push.js'), join(root, 'cloud', 'blipwick', 'push.js')]

const wanted = await readFile(source, 'utf8')
const check = process.argv.includes('--check')
let drifted = 0

for (const target of targets) {
  const name = relative(root, target).replaceAll('\\', '/')
  const found = await readFile(target, 'utf8').catch(() => null)
  if (found === wanted) {
    console.log(`${name} is up to date`)
    continue
  }
  if (check) {
    console.error(`${name} has drifted from core/push.js`)
    drifted++
    continue
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, wanted)
  console.log(`wrote ${name}`)
}

if (drifted) {
  console.error('Run: node scripts/sync-core.mjs')
  process.exit(1)
}
