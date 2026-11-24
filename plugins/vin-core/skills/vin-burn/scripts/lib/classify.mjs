// Rule-based task categories. No model calls: a task is labelled from the words
// of the prompt that started it and the tools its turns used.

export const CATEGORIES = [
  'debugging', 'testing', 'feature', 'refactor', 'docs', 'review',
  'coding', 'exploration', 'research', 'delegation', 'git', 'ops', 'conversation'
]

const PROMPT_RULES = [
  ['debugging', /\b(fix|bug|broken|error|errors|crash|crashes|fails?|failing|failure|exception|traceback|stack ?trace|regression|doesn'?t work|not working|debug)\b/i],
  ['testing', /\b(tests?|unit tests?|e2e|coverage|pytest|jest|vitest|playwright|spec)\b/i],
  ['refactor', /\b(refactor|clean ?up|simplify|rename|restructure|extract|dedupe|tidy)\b/i],
  ['docs', /\b(readme|docs?|documentation|changelog|comments?|write ?up|explain in the docs)\b/i],
  ['review', /\b(review|audit|critique|check (my|this|the) (code|pr|diff))\b/i],
  ['feature', /\b(add|build|implement|create|make|new feature|support for|scaffold|ship)\b/i]
]

const TEST_CMD = /\b(npm (run )?test|node --test|pytest|jest|vitest|go test|cargo test|playwright test|make test)\b/
const GIT_CMD = /^\s*git\b/
const OPS_CMD = /\b(docker|kubectl|systemctl|pm2|ssh|rsync|scp|deploy|apt|brew)\b/

/** Count tool kinds over a list of turns. */
export function toolProfile (turns) {
  const p = { edit: 0, read: 0, web: 0, agent: 0, bash: 0, test: 0, git: 0, ops: 0, total: 0 }
  for (const t of turns) {
    for (const name of t.tools) {
      p.total++
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) p.edit++
      else if (/^(Read|Grep|Glob|LS)$/.test(name)) p.read++
      else if (/^(WebFetch|WebSearch)$/.test(name)) p.web++
      else if (/^(Agent|Task)$/.test(name)) p.agent++
      else if (name === 'Bash') p.bash++
    }
    for (const c of t.commands) {
      if (TEST_CMD.test(c)) p.test++
      if (GIT_CMD.test(c)) p.git++
      if (OPS_CMD.test(c)) p.ops++
    }
  }
  return p
}

/** Category for one task: its prompt plus all of its turns. */
export function classifyTask (prompt, turns) {
  const text = typeof prompt === 'string' ? prompt.slice(0, 2000) : ''
  const p = toolProfile(turns)
  for (const [cat, re] of PROMPT_RULES) {
    if (!re.test(text)) continue
    // "add tests" is testing, "fix the docs" is docs: let the more specific word win.
    if (cat === 'feature' && PROMPT_RULES.slice(0, 5).some(([, r]) => r.test(text))) continue
    return cat
  }
  if (p.total === 0) return 'conversation'
  if (p.test > 0 && p.test >= p.edit) return 'testing'
  if (p.edit > 0) return 'coding'
  if (p.agent > 0 && p.agent >= p.read) return 'delegation'
  if (p.web > 0 && p.web >= p.read) return 'research'
  if (p.git > 0 && p.git >= p.bash / 2) return 'git'
  if (p.ops > 0) return 'ops'
  if (p.read > 0 || p.bash > 0) return 'exploration'
  return 'conversation'
}
