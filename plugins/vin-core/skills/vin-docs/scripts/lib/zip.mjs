// Minimal ZIP reader for Office files (DOCX/XLSX/PPTX are ZIP archives of XML).
// Reads the central directory, supports stored and deflated entries, and refuses
// archives that would expand past a size limit (zip bombs).
import zlib from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

export function readZip (buf, { maxEntries = 5000, maxTotal = 300 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('not a ZIP file (too small)')
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a ZIP file (no end record)')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count > maxEntries) throw new Error(`ZIP has ${count} entries; the limit is ${maxEntries}`)
  if (cdOffset >= buf.length) throw new Error('ZIP central directory is outside the file')
  const entries = new Map()
  let p = cdOffset
  let declared = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new Error('ZIP central directory is damaged')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    declared += usize
    if (declared > maxTotal) throw new Error(`ZIP would expand past ${Math.round(maxTotal / 1e6)} MB`)
    entries.set(name, { method, csize, usize, local })
    p += 46 + nameLen + extraLen + commentLen
  }
  const read = (name) => {
    const e = entries.get(name)
    if (!e) return null
    if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== LOC_SIG) throw new Error(`ZIP entry ${name} is damaged`)
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28)
    const data = buf.subarray(start, start + e.csize)
    if (e.method === 0) return data
    if (e.method === 8) {
      const out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, e.usize) + 1024 })
      return out
    }
    throw new Error(`ZIP entry ${name} uses unsupported compression ${e.method}`)
  }
  return { names: [...entries.keys()], has: (n) => entries.has(n), read, text: (n) => { const b = read(n); return b ? b.toString('utf8') : null } }
}

/** Write a ZIP (deflate) from {name: string|Buffer}. Used by tests and examples. */
export function writeZip (files) {
  const locals = []
  const central = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const comp = zlib.deflateRawSync(data)
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = zlib.crc32 ? zlib.crc32(data) : 0
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(LOC_SIG, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28)
    locals.push(lh, nameBuf, comp)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(CEN_SIG, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42)
    central.push(ch, nameBuf)
    offset += 30 + nameBuf.length + comp.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD_SIG, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
