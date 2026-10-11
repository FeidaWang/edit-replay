// A step's diff, taken from the patch the Edit or Write tool already made
// (its result's `structuredPatch`), trimmed to the official example's shape:
// one line of context around each change, `⋯` where lines were skipped. Pure:
// no `$`, so the tests read it directly.

import type { DiffLine, ReplayStep } from '../types'

export const MAX_DIFF_LINES = 12

/** One hunk of the tool's patch: its lines start with `+`, `-` or ` `. */
export type Hunk = { lines: readonly string[] }

export function relPath(cwd: string, path: string | undefined): string {
  if (!path) return '(unknown file)'
  if (cwd && path.startsWith(cwd + '/')) return path.slice(cwd.length + 1)
  return path
}

export function patchLines(hunks: readonly Hunk[]): DiffLine[] {
  const out: DiffLine[] = []
  for (const hunk of hunks) {
    const lines: DiffLine[] = []
    for (const raw of hunk.lines) {
      const op = raw[0]
      // `\ No newline at end of file` and the like are not lines of the file.
      if (op === '+' || op === '-' || op === ' ') lines.push({ op, t: raw.slice(1) })
    }
    if (out.length && lines.length) out.push({ op: '~', t: '⋯' })
    out.push(...trimContext(lines))
  }
  return out
}

// Keep one line of context around each change (the tool's patch keeps three).
function trimContext(lines: DiffLine[]): DiffLine[] {
  if (!lines.some(l => l.op !== ' ')) return lines.slice(0, MAX_DIFF_LINES)
  const changed = (k: number) => {
    const l = lines[k]
    return l !== undefined && l.op !== ' '
  }
  const out: DiffLine[] = []
  let skipped = false
  lines.forEach((l, k) => {
    if (changed(k) || changed(k - 1) || changed(k + 1)) {
      if (skipped && out.length) out.push({ op: '~', t: '⋯' })
      out.push(l)
      skipped = false
    } else skipped = true
  })
  return out
}

// A step keeps only the lines a pane can show, so `$.state` stays small
// however large the Write was; the counts come from the whole diff.
export function makeStep(tool: ReplayStep['tool'], file: string, note: string, diff: DiffLine[]): ReplayStep {
  let add = 0
  let del = 0
  for (const l of diff) {
    if (l.op === '+') add++
    else if (l.op === '-') del++
  }
  return { tool, file, note, diff: diff.slice(0, MAX_DIFF_LINES), total: diff.length, add, del }
}
