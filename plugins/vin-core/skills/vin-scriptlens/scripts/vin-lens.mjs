#!/usr/bin/env node
// vin-lens: run a small JavaScript snippet over a big JSON document, print only its result.
//   gh api repos/o/r/issues | node vin-lens.mjs -e 'return count(data, i => i.state)'
//   node vin-lens.mjs response.json -f summarise.js
import fs from 'node:fs'
import { runLens, LIMITS } from './lib/lens.mjs'

const HELP = `vin-lens — run a script over big JSON so only the answer enters context

Usage: <command> | vin-lens.mjs -e '<code>'
       vin-lens.mjs <data.json> -e '<code>' | -f <script.js>

The script is a function body: use \`return\`. \`data\` holds the parsed JSON.
Helpers: count(xs,f) groupBy(xs,f) sum(xs,f) pick(o,...keys) uniq(xs)
         sortBy(xs,f,desc) top(xs,n,f) get(o,'a.b.c') console.log(...)
No require/import, no fetch, no process, no file or network access.

Options:
  -e <code>            script text
  -f <file>            script file
  --timeout <ms>       CPU time for the script (default ${LIMITS.timeoutMs})
  --max-result <chars> cut the printed result here (default ${LIMITS.maxResultChars})
  --pretty             pretty-print the result
  -h, --help
`

export function parseArgs (argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i] }
    if (a === '-h' || a === '--help') o.help = true
    else if (a === '-e') o.code = next()
    else if (a === '-f') o.codeFile = next()
    else if (a === '--pretty') o.pretty = true
    else if (a === '--timeout') {
      o.timeoutMs = Number(next())
      if (!Number.isInteger(o.timeoutMs) || o.timeoutMs < 10 || o.timeoutMs > 60000) throw new Error('--timeout must be 10..60000 ms')
    } else if (a === '--max-result') {
      o.maxResultChars = Number(next())
      if (!Number.isInteger(o.maxResultChars) || o.maxResultChars < 100 || o.maxResultChars > 1e6) throw new Error('--max-result must be 100..1000000')
    } else if (!a.startsWith('-') && !o.dataFile) o.dataFile = a
    else throw new Error(`unknown option ${a}`)
  }
  if (!o.help && !o.code && !o.codeFile) throw new Error('give a script with -e or -f')
  if (o.code && o.codeFile) throw new Error('use -e or -f, not both')
  return o
}

async function readStdin () {
  if (process.stdin.isTTY) throw new Error('pipe JSON in or give a data file')
  const chunks = []
  let n = 0
  for await (const c of process.stdin) { n += c.length; if (n > LIMITS.maxDataBytes) throw new Error('input over the data limit'); chunks.push(c) }
  return Buffer.concat(chunks).toString('utf8')
}

async function main () {
  let o
  try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error('vin-lens: ' + e.message + '\n\n' + HELP); process.exit(2) }
  if (o.help) { process.stdout.write(HELP); return }
  const code = o.codeFile ? fs.readFileSync(o.codeFile, 'utf8') : o.code
  const dataText = o.dataFile ? fs.readFileSync(o.dataFile, 'utf8') : await readStdin()
  let r
  try {
    r = await runLens({ code, dataText }, { ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}), ...(o.maxResultChars ? { maxResultChars: o.maxResultChars } : {}) })
  } catch (e) { console.error('vin-lens: ' + e.message); process.exit(2) }
  if (!r.ok) { console.error('vin-lens: script failed: ' + r.error); process.exit(1) }
  let text = r.result
  if (o.pretty && !r.truncated) text = JSON.stringify(JSON.parse(text), null, 2)
  for (const l of r.logs) process.stdout.write('log: ' + l + '\n')
  process.stdout.write(text + (r.truncated ? '\n… (result cut at the size limit)' : '') + '\n')
  process.stdout.write(`[vin-lens] data ${r.beforeChars} chars → result ${r.afterChars} chars (-${r.beforeChars ? Math.max(0, Math.round((1 - r.afterChars / r.beforeChars) * 100)) : 0}%)\n`)
}

if (process.argv[1] && process.argv[1].endsWith('vin-lens.mjs')) {
  main().catch(e => { console.error('vin-lens: ' + e.message); process.exit(1) })
}
