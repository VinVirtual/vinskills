// Shared test helpers: temp folders, paths to the skills, a tiny PDF writer.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SKILLS = path.join(ROOT, 'plugins/vin-core/skills')
export const skill = (name, ...p) => path.join(SKILLS, name, ...p)

export function tmpdir (prefix = 'vinskills-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function runNode (script, args = [], opts = {}) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60000, ...opts })
}

export function has (cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return !r.error
}

/** A small, valid PDF with one line of text per page (Helvetica, WinAnsi). */
export function makePdf (pages) {
  const objs = []
  const add = (s) => { objs.push(s); return objs.length }
  const catalog = add(null)
  const pagesObj = add(null)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids = []
  for (const lines of pages) {
    const ops = ['BT', '/F1 12 Tf', '72 740 Td', '14 TL']
    for (const l of lines) ops.push(`(${l.replace(/[()\\]/g, m => '\\' + m)}) Tj T*`)
    ops.push('ET')
    const stream = ops.join('\n')
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** git init with a no-reply identity, commit everything. */
export function gitRepo (dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('add', '-A')
  g('-c', 'user.name=Test', '-c', 'user.email=1+test@users.noreply.github.com', 'commit', '-q', '-m', 'init')
  return dir
}
