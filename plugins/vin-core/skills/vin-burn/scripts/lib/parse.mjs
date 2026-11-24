// Read Claude Code session transcripts (JSONL) and turn them into usage turns.
// Pure functions where possible so they can be tested without touching ~/.claude.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const RELEVANT = /"type"\s*:\s*"(assistant|user)"/
const MAX_LINE_BYTES = 8 * 1024 * 1024 // a single JSONL line larger than this is skipped

/** Recursively list *.jsonl files under a folder. Symlinks are not followed. */
export function listTranscripts (root) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 6) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
    }
  }
  walk(root, 0)
  return out.sort()
}

/** Numbers from a usage object, missing fields become 0. */
export function readUsage (u) {
  if (!u || typeof u !== 'object') return null
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
  const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null
  const write5m = cc ? n(cc.ephemeral_5m_input_tokens) : n(u.cache_creation_input_tokens)
  const write1h = cc ? n(cc.ephemeral_1h_input_tokens) : 0
  // When the split is present but sums to less than the total, count the rest as 5-minute writes.
  const total = n(u.cache_creation_input_tokens)
  const extra = Math.max(0, total - write5m - write1h)
  return {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheWrite5m: write5m + extra,
    cacheWrite1h: write1h,
    cacheRead: n(u.cache_read_input_tokens)
  }
}

function toolNames (content) {
  if (!Array.isArray(content)) return []
  return content.filter(b => b && b.type === 'tool_use' && typeof b.name === 'string').map(b => b.name)
}

function bashCommands (content) {
  if (!Array.isArray(content)) return []
  return content
    .filter(b => b && b.type === 'tool_use' && b.name === 'Bash' && b.input && typeof b.input.command === 'string')
    .map(b => b.input.command.slice(0, 400))
}

/** Text of a real user prompt, or null for tool results, meta lines and the like. */
export function promptText (entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta) return null
  const c = entry.message && entry.message.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    if (c.some(b => b && b.type === 'tool_result')) return null
    const t = c.filter(b => b && b.type === 'text').map(b => b.text).join('\n')
    return t || null
  }
  return null
}

/**
 * Fold parsed JSONL entries of one file into turns.
 * One turn = one API response (deduplicated by message id / request id), with
 * the tools it called and the user prompt that started its task.
 */
export function entriesToTurns (entries, file = '') {
  const turns = new Map()
  let taskId = 0
  let taskPrompt = ''
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue
    const p = promptText(e)
    if (p !== null && !e.isSidechain) { taskId++; taskPrompt = p.slice(0, 2000); continue }
    if (e.type !== 'assistant' || !e.message || typeof e.message !== 'object') continue
    const usage = readUsage(e.message.usage)
    if (!usage) continue
    const key = (e.sessionId || file) + '|' + (e.message.id || e.requestId || e.uuid || turns.size)
    const prev = turns.get(key)
    const tools = toolNames(e.message.content)
    const cmds = bashCommands(e.message.content)
    if (prev) {
      // Streaming writes one line per content block with the same usage; keep the largest numbers.
      for (const k of Object.keys(usage)) prev.usage[k] = Math.max(prev.usage[k], usage[k])
      prev.tools.push(...tools)
      prev.commands.push(...cmds)
      continue
    }
    turns.set(key, {
      key,
      sessionId: e.sessionId || '',
      timestamp: typeof e.timestamp === 'string' ? e.timestamp : '',
      model: typeof e.message.model === 'string' ? e.message.model : 'unknown',
      cwd: typeof e.cwd === 'string' ? e.cwd : '',
      sidechain: Boolean(e.isSidechain),
      task: (e.sessionId || file) + '#' + taskId,
      prompt: taskPrompt,
      tools,
      commands: cmds,
      usage
    })
  }
  return [...turns.values()]
}

/** Stream one transcript file into entries; bad lines are counted, not fatal. */
export async function readTranscript (file) {
  const entries = []
  let bad = 0
  const stream = fs.createReadStream(file, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line || line.length > MAX_LINE_BYTES) { if (line) bad++; continue }
    // Cheap pre-filter: only user and assistant lines matter.
    if (!RELEVANT.test(line)) continue
    try { entries.push(JSON.parse(line)) } catch { bad++ }
  }
  return { entries, bad }
}
