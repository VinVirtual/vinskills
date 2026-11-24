import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { skill, tmpdir, runNode } from './helpers.mjs'
import { readUsage, entriesToTurns, promptText, listTranscripts, readTranscript } from '../plugins/vin-core/skills/vin-burn/scripts/lib/parse.mjs'
import { classifyTask, toolProfile } from '../plugins/vin-core/skills/vin-burn/scripts/lib/classify.mjs'
import { loadPricing, ratesFor, costOf, aggregate, projectLabel, localDay } from '../plugins/vin-core/skills/vin-burn/scripts/lib/aggregate.mjs'
import { renderCsv, renderText, fmtTokens } from '../plugins/vin-core/skills/vin-burn/scripts/lib/format.mjs'
import { parseArgs, periodRange } from '../plugins/vin-core/skills/vin-burn/scripts/vin-burn.mjs'

const CLI = skill('vin-burn', 'scripts/vin-burn.mjs')

const user = (text, extra = {}) => ({ type: 'user', sessionId: 's1', cwd: '/w/acme/app', timestamp: '2026-11-20T10:00:00Z', message: { role: 'user', content: text }, ...extra })
const asst = (id, usage, content = [], extra = {}) => ({
  type: 'assistant', sessionId: 's1', cwd: '/w/acme/app', timestamp: '2026-11-20T10:00:05Z', requestId: 'r-' + id,
  message: { id, model: 'claude-sonnet-4-6', usage, content }, ...extra
})
const U = (i, o, w = 0, r = 0) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: w, cache_read_input_tokens: r })

test('readUsage reads the split cache fields and fills missing ones with 0', () => {
  const u = readUsage({ input_tokens: 5, output_tokens: 7, cache_creation_input_tokens: 100, cache_read_input_tokens: 9, cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 40 } })
  assert.deepEqual(u, { input: 5, output: 7, cacheWrite5m: 60, cacheWrite1h: 40, cacheRead: 9 })
  assert.deepEqual(readUsage({}), { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 })
  assert.equal(readUsage(null), null)
})

test('readUsage without a split counts all cache writes as 5-minute writes', () => {
  assert.equal(readUsage(U(1, 1, 50)).cacheWrite5m, 50)
})

test('readUsage ignores negative and non-numeric values', () => {
  const u = readUsage({ input_tokens: -5, output_tokens: 'x', cache_read_input_tokens: NaN })
  assert.equal(u.input + u.output + u.cacheRead, 0)
})

test('promptText skips tool results and meta lines', () => {
  assert.equal(promptText(user('hello')), 'hello')
  assert.equal(promptText(user([{ type: 'tool_result', content: 'x' }])), null)
  assert.equal(promptText(user('x', { isMeta: true })), null)
  assert.equal(promptText(user([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])), 'a\nb')
  assert.equal(promptText(asst('m', U(1, 1))), null)
})

test('entriesToTurns counts a response written as several lines once, keeping the largest usage', () => {
  const turns = entriesToTurns([
    user('fix the login bug'),
    asst('m1', U(10, 1), [{ type: 'thinking' }]),
    asst('m1', U(10, 50), [{ type: 'tool_use', name: 'Edit', input: {} }])
  ])
  assert.equal(turns.length, 1)
  assert.equal(turns[0].usage.output, 50)
  assert.deepEqual(turns[0].tools, ['Edit'])
  assert.equal(turns[0].prompt, 'fix the login bug')
})

test('entriesToTurns starts a new task at each user prompt and records Bash commands', () => {
  const turns = entriesToTurns([
    user('first'), asst('a', U(1, 1), [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }]),
    user('second'), asst('b', U(1, 1))
  ])
  assert.notEqual(turns[0].task, turns[1].task)
  assert.deepEqual(turns[0].commands, ['npm test'])
})

test('sidechain prompts do not start a new task', () => {
  const turns = entriesToTurns([user('main'), user('sub', { isSidechain: true }), asst('a', U(1, 1), [], { isSidechain: true })])
  assert.equal(turns[0].prompt, 'main')
})

test('entriesToTurns skips assistant lines without usage and junk entries', () => {
  const turns = entriesToTurns([null, 7, { type: 'assistant', message: { id: 'x' } }, asst('ok', U(1, 1))])
  assert.equal(turns.length, 1)
})

test('classifyTask uses prompt words first', () => {
  assert.equal(classifyTask('Fix the crash when saving', []), 'debugging')
  assert.equal(classifyTask('add tests for the parser', []), 'testing')
  assert.equal(classifyTask('please refactor the router', []), 'refactor')
  assert.equal(classifyTask('update the README', []), 'docs')
  assert.equal(classifyTask('review this diff', []), 'review')
  assert.equal(classifyTask('build a settings page', []), 'feature')
})

test('classifyTask falls back to tools when the prompt says nothing', () => {
  const t = (tools, commands = []) => [{ tools, commands }]
  assert.equal(classifyTask('hmm', t([])), 'conversation')
  assert.equal(classifyTask('hmm', t(['Edit', 'Read'])), 'coding')
  assert.equal(classifyTask('hmm', t(['Read', 'Grep'])), 'exploration')
  assert.equal(classifyTask('hmm', t(['WebSearch'])), 'research')
  assert.equal(classifyTask('hmm', t(['Agent'])), 'delegation')
  assert.equal(classifyTask('hmm', t(['Bash'], ['npm test'])), 'testing')
  assert.equal(classifyTask('hmm', t(['Bash'], ['git status'])), 'git')
  assert.equal(classifyTask('hmm', t(['Bash'], ['docker ps'])), 'ops')
})

test('toolProfile counts tool kinds', () => {
  const p = toolProfile([{ tools: ['Edit', 'Write', 'Read', 'WebFetch', 'Agent', 'Bash'], commands: ['git log', 'pytest -q'] }])
  assert.equal(p.edit, 2); assert.equal(p.read, 1); assert.equal(p.web, 1); assert.equal(p.agent, 1); assert.equal(p.git, 1); assert.equal(p.test, 1)
})

test('ratesFor matches exact ids, dated ids and prefixes', () => {
  const table = loadPricing()
  assert.equal(ratesFor('claude-sonnet-4-6', table).name, 'claude-sonnet-4-6')
  assert.equal(ratesFor('claude-haiku-4-5-20251001', table).name, 'claude-haiku-4-5')
  assert.equal(ratesFor('claude-opus-5-5-preview', table).name, 'claude-opus-5-5')
  assert.equal(ratesFor('gpt-something', table), null)
  assert.equal(ratesFor('', table), null)
})

test('costOf applies each rate per million tokens', () => {
  const r = { input: 3, output: 15, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3 }
  const c = costOf({ input: 1e6, output: 1e6, cacheWrite5m: 1e6, cacheWrite1h: 1e6, cacheRead: 1e6 }, r)
  assert.equal(Math.round(c * 100) / 100, 28.05)
  assert.equal(costOf({ input: 1e6, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }, null), 0)
})

test('every default price is a non-negative number for all five rates', () => {
  for (const [m, r] of Object.entries(loadPricing())) {
    for (const k of ['input', 'output', 'cache_write_5m', 'cache_write_1h', 'cache_read']) assert.ok(Number.isFinite(r[k]) && r[k] >= 0, `${m}.${k}`)
  }
})

test('loadPricing merges an override file and rejects bad ones', () => {
  const d = tmpdir()
  const good = path.join(d, 'p.json')
  fs.writeFileSync(good, JSON.stringify({ models: { 'my-model': { input: 1, output: 2 } } }))
  assert.equal(loadPricing(good)['my-model'].output, 2)
  const bad = path.join(d, 'b.json')
  fs.writeFileSync(bad, JSON.stringify({ models: { x: { inputt: 1 } } }))
  assert.throws(() => loadPricing(bad), /unknown rate/)
  fs.writeFileSync(bad, JSON.stringify({ models: { x: { input: -1 } } }))
  assert.throws(() => loadPricing(bad), />= 0/)
  fs.writeFileSync(bad, '{nope')
  assert.throws(() => loadPricing(bad), /could not read/)
})

test('aggregate groups by day, project, model, tool and category and lists unpriced models', () => {
  const turns = entriesToTurns([
    user('fix the bug'),
    asst('a', U(1e6, 0), [{ type: 'tool_use', name: 'Edit', input: {} }, { type: 'tool_use', name: 'Read', input: {} }]),
    { ...asst('b', U(100, 100)), message: { id: 'b', model: 'mystery-model', usage: U(100, 100), content: [] } }
  ])
  const agg = aggregate(turns, { timeZone: 'UTC' })
  assert.equal(agg.total.turns, 2)
  assert.equal(Math.round(agg.total.cost * 100) / 100, 3)
  assert.equal(agg.byProject[0].key, 'acme/app')
  assert.equal(agg.byDay[0].key, '2026-11-20')
  assert.equal(agg.byCategory[0].key, 'debugging')
  const edit = agg.byTool.find(r => r.key === 'Edit')
  assert.equal(Math.round(edit.cost * 100) / 100, 1.5)
  assert.ok(agg.byTool.find(r => r.key === '(text)'))
  assert.deepEqual(agg.unpriced, [{ model: 'mystery-model', turns: 1 }])
})

test('aggregate filters by time window and project', () => {
  const turns = entriesToTurns([user('x'), asst('a', U(1, 1)), { ...asst('b', U(1, 1)), timestamp: '2026-11-25T00:00:00Z', cwd: '/other/proj' }])
  assert.equal(aggregate(turns, { since: '2026-11-21T00:00:00Z' }).total.turns, 1)
  assert.equal(aggregate(turns, { until: '2026-11-21T00:00:00Z' }).total.turns, 1)
  assert.equal(aggregate(turns, { project: 'ACME' }).total.turns, 1)
})

test('projectLabel and localDay', () => {
  assert.equal(projectLabel('/srv/code/app'), 'code/app')
  assert.equal(projectLabel(''), '(unknown)')
  assert.equal(localDay('2026-11-20T23:30:00Z', 'Asia/Kuala_Lumpur'), '2026-11-21')
  assert.equal(localDay('garbage', 'UTC'), 'unknown')
})

test('CSV cells that start like a formula are neutralised', () => {
  const csv = renderCsv({ byDay: [], byProject: [{ key: '=HYPERLINK("x")', input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, cost: 0, turns: 0 }], byModel: [], byCategory: [], byTool: [] })
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/)
})

test('fmtTokens and renderText', () => {
  assert.equal(fmtTokens(999), '999'); assert.equal(fmtTokens(1500), '1.5k'); assert.equal(fmtTokens(2.5e6), '2.50M'); assert.equal(fmtTokens(3e9), '3.00B')
  const agg = aggregate(entriesToTurns([user('x'), asst('a', U(1000, 1000))]), { timeZone: 'UTC' })
  const text = renderText(agg)
  assert.match(text, /By task category/)
  assert.match(text, /not your bill/)
  assert.doesNotMatch(text, /\x1b\[/)
})

test('periodRange understands every period word and rejects others', () => {
  const now = new Date('2026-11-24T15:00:00')
  assert.deepEqual(periodRange('all', now), [null, null])
  assert.equal(periodRange('today', now)[0].getDate(), 24)
  const [ys, ye] = periodRange('yesterday', now)
  assert.equal(ys.getDate(), 23); assert.equal(ye.getDate(), 24)
  assert.equal(periodRange('7d', now)[0].getDate(), 18)
  assert.equal(periodRange('month', now)[0].getDate(), 1)
  assert.equal(periodRange('3h', now)[0].getHours(), 12)
  assert.throws(() => periodRange('fortnight', now), /unknown period/)
  assert.throws(() => periodRange('0d', now), /at least 1/)
})

test('parseArgs validates its options', () => {
  assert.equal(parseArgs(['30d', '--json']).period, '30d')
  assert.throws(() => parseArgs(['--from', '2026/11/01']), /YYYY-MM-DD/)
  assert.throws(() => parseArgs(['--limit', '0']), /1\.\.500/)
  assert.throws(() => parseArgs(['--tz', 'Mars/Base']), /time zone/)
  assert.throws(() => parseArgs(['--wat']), /unknown option/)
  assert.throws(() => parseArgs(['--project']), /needs a value/)
})

function fixtureDir () {
  const d = tmpdir()
  const proj = path.join(d, '-w-acme-app')
  fs.mkdirSync(path.join(proj, 'sub'), { recursive: true })
  const lines = [
    user('add a login form'),
    asst('m1', U(2000, 3000, 1000, 50000), [{ type: 'tool_use', name: 'Write', input: {} }]),
    asst('m1', U(2000, 3000, 1000, 50000), [{ type: 'tool_use', name: 'Write', input: {} }]),
    '{"type":"assistant", broken json',
    user('why does it fail'),
    asst('m2', U(100, 400), [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }])
  ]
  fs.writeFileSync(path.join(proj, 's1.jsonl'), lines.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') + '\n')
  fs.writeFileSync(path.join(proj, 'sub', 'agent.jsonl'), JSON.stringify(asst('m3', U(10, 10))) + '\n')
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'ignored')
  return d
}

test('listTranscripts finds nested jsonl files only; readTranscript counts bad lines', async () => {
  const d = fixtureDir()
  const files = listTranscripts(d)
  assert.equal(files.length, 2)
  const r = await readTranscript(files.find(f => f.endsWith('s1.jsonl')))
  assert.equal(r.bad, 1)
  assert.equal(r.entries.length, 5)
})

test('CLI: report, JSON and CSV over a fixture folder', () => {
  const d = fixtureDir()
  const text = runNode(CLI, ['all', '--dir', d, '--tz', 'UTC'])
  assert.equal(text.status, 0, text.stderr)
  assert.match(text.stdout, /estimated cost/)
  assert.match(text.stdout, /1 unreadable lines skipped/)
  const json = JSON.parse(runNode(CLI, ['all', '--dir', d, '--json', '--tz', 'UTC']).stdout)
  assert.equal(json.total.turns, 3)
  assert.equal(json.total.output, 3410)
  assert.ok(json.byCategory.some(c => c.key === 'feature'))
  assert.ok(json.byCategory.some(c => c.key === 'debugging'))
  const csv = runNode(CLI, ['all', '--dir', d, '--csv', '-']).stdout
  assert.match(csv, /^group,key,cost_usd/)
  assert.match(csv, /tool,Write,/)
})

test('CLI: bad input exits 2 with a message', () => {
  assert.equal(runNode(CLI, ['--dir', '/definitely/not/here']).status, 2)
  assert.equal(runNode(CLI, ['soon']).status, 2)
  assert.equal(runNode(CLI, ['--help']).status, 0)
})
