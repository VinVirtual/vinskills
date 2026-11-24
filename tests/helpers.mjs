// Shared test helpers: the repository root, temp folders, and whether a command exists.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function tmpdir (prefix = 'vinskills-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function has (cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return !r.error
}
