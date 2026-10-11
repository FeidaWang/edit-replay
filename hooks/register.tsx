// Edit Replay: records the file edits Claude makes in a turn, then lets you
// step through them in a pane, one diff at a time.
//
// A port of anthropics/claude-code-playground claude-code/mods/replay-theater
// to this build's API (claude-code.d.ts 2.1.286): every value a drawing reads
// lives in `$.state`, so a hot reload keeps the replay, and the view draws on
// the terminal and on the desktop Code tab.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, ToolCallInput, ToolCallResult } from 'claude-code'

import type { ReplayMode, ReplayStep } from '../types'
import { ADD, DEL, PX_PER_CELL, frames, iconSvg, plural, stripSvg, summarize } from './art.ts'
import { MAX_DIFF_LINES, makeStep, patchLines, relPath } from './diff.ts'
import type { Hunk } from './diff.ts'

const PANE_ID = 'edit-replay'
// Body columns asked for while docked; rows asked for while inline.
const PANE_COLUMNS = 58
const PANE_ROWS = Math.min(MAX_DIFF_LINES + 8, 22)

const pending = atom({ plugin: 'edit-replay', key: 'pending' } as const, [])
// Read through `$.state.get` where its version keys a cache.
const REPLAY = { plugin: 'edit-replay', key: 'replay' } as const
const replay = atom(REPLAY, [])
const index = atom({ plugin: 'edit-replay', key: 'index' } as const, 0)
const view = atom({ plugin: 'edit-replay', key: 'view' } as const, { mode: 'closed', isHintHidden: false })

type ReplaySite = RenderInput<'Pane'> | RenderInput<'AbovePrompt'>

function setMode($: EngineInterface, mode: ReplayMode) {
  return update($, view, v => ({ ...v, mode }))
}

// What the Edit and Write tools answer with, as far as a step needs it: the
// patch they made, whether a new file was created, and whether the write was
// held for review instead of made.
type EditResult = {
  structuredPatch?: Hunk[]
  type?: 'create' | 'update'
  staged?: boolean
  gitDiff?: { additions: number; deletions: number }
}

// Turns one finished Edit or Write call into its step, from the patch the
// tool made: nothing for a call that was denied, failed, or was only staged.
async function stepFor($: EngineInterface, e: ToolCallInput, ran: ToolCallResult): Promise<ReplayStep | null> {
  if (e.tool !== 'Edit' && e.tool !== 'Write') return null
  if (ran.deny !== undefined || ran.isError) return null
  const r = ran.result as EditResult | undefined
  if (!r || r.staged) return null
  let cwd = ''
  try {
    cwd = await $.session.cwd()
  } catch {
    // keep the full path
  }
  const note = e.tool === 'Edit' ? (e.replace_all ? 'replace all' : '') : r.type === 'create' ? 'new file' : 'rewrite'
  const step = makeStep(e.tool, relPath(cwd, e.file_path), note, patchLines(r.structuredPatch ?? []))
  // A patch the tool could not make (too large, timed out): git's counts.
  if (!step.total && r.gitDiff) return { ...step, add: r.gitDiff.additions, del: r.gitDiff.deletions }
  return step
}

// `dockable` is the surface's `isFullscreen`: true docks the pane beside the
// transcript, so ask for columns; false seats it inline, so ask for rows;
// unknown, ask for both (each is ignored where it does not apply).
function paneSize(dockable: boolean | undefined): { rows?: number; columns?: number } {
  if (dockable === true) return { columns: PANE_COLUMNS }
  if (dockable === false) return { rows: PANE_ROWS }
  return { rows: PANE_ROWS, columns: PANE_COLUMNS }
}

async function openReplay($: EngineInterface, dockable: boolean | undefined): Promise<boolean> {
  if (!(await read($, replay)).length) return false
  await update($, index, () => 0)
  // The pane only takes the keyboard while nothing else holds it. Showing the
  // replay hides the band (which held the keys if its button was pressed);
  // give it a moment to go, then open.
  await setMode($, 'pane')
  await $.clock.sleep(200)
  let isPlaced = false
  try {
    const placed = await $.ui.open({
      id: PANE_ID,
      title: 'Edit Replay',
      focus: true,
      closeOnEscape: true,
      ...paneSize(dockable),
    })
    isPlaced = placed.isPlaced
  } catch {
    // refused: fall back to the band
  }
  // No room for a pane (a narrow terminal, a surface that places none): the
  // band above the prompt draws the replay instead.
  if (!isPlaced) await setMode($, 'band')
  return true
}

async function closeReplay($: EngineInterface): Promise<void> {
  const { mode } = await read($, view)
  await setMode($, 'closed')
  if (mode === 'pane') await $.ui.close({ id: PANE_ID })
}

// The replay view, one step at a time: drawn in the Pane, or in the band
// above the prompt when no pane could be placed.
async function replayView($: EngineInterface, e: ReplaySite, where: 'pane' | 'band') {
  const steps = await read($, replay)
  const at = await read($, index)
  const { Box, Text, Button } = $.ui.resolve(e)
  const isTerminal = e.surface === 'terminal'

  const total = steps.length
  if (!total) return <Text dimColor>No edits to replay.</Text>
  const k = Math.max(0, Math.min(at, total - 1))
  const step = steps[k]!

  // The band has only its rows to spare; a pane shows the step's full cap.
  const maxDiff =
    where === 'band' && e.component === 'AbovePrompt'
      ? Math.max(3, Math.min(MAX_DIFF_LINES, e.props.maxRows - 7))
      : MAX_DIFF_LINES
  // The terminal view draws its own frame (border and padding: 4 cells); the
  // desktop pane brings its own chrome.
  const width = Math.max(10, e.props.bodyColumns - (isTerminal ? 4 : 0))
  const shown = step.diff.slice(0, maxDiff)
  const more = step.total - shown.length

  // Moves from the stored index, not the one drawn, so two presses before
  // the redraw both land.
  const stepBy = (delta: number) => update($, index, i => Math.max(0, Math.min(i + delta, total - 1)))

  const header = (
    <Box flexDirection="row" justifyContent="space-between">
      <Text bold color="magenta">
        ▶ Edit Replay
      </Text>
      <Text bold>{`step ${k + 1} of ${total}`}</Text>
    </Box>
  )

  // One cell per step, the current one highlighted.
  const strip = (
    <Box key="strip" flexDirection="row" flexWrap="wrap">
      {steps.map((_, n) =>
        n === k ? (
          <Text inverse color="cyan">{` ${n + 1} `}</Text>
        ) : (
          <Text dimColor>{` ${n + 1} `}</Text>
        ),
      )}
    </Box>
  )

  const diffRows = shown.map((l, n) => {
    const line = `${l.op === '~' ? ' ' : l.op} ${l.t}`.slice(0, width)
    if (l.op === '+') return <Text color="green" wrap="truncate-end">{line}</Text>
    if (l.op === '-') return <Text color="red" wrap="truncate-end">{line}</Text>
    return <Text dimColor wrap="truncate-end">{line}</Text>
  })
  if (more > 0) diffRows.push(<Text dimColor>{`  … ${more} more lines`}</Text>)
  if (!shown.length) diffRows.push(<Text dimColor>{'  (no line changes)'}</Text>)

  const body = [
    header,
    strip,
    <Text bold color="cyan" wrap="truncate-start">
      {step.file}
    </Text>,
    <Box key="meta" flexDirection="row" gap={2}>
      <Text dimColor>{`${step.tool}${step.note ? ' · ' + step.note : ''}`}</Text>
      <Text color="green">{`+${step.add}`}</Text>
      <Text color="red">{`-${step.del}`}</Text>
    </Box>,
    <Box key="diff" flexDirection="column" marginTop={1}>
      {diffRows}
    </Box>,
    // Prev, Next and Close: hotkeys while the site holds the keyboard (the
    // terminal), clicks everywhere. `role="dismiss"` is a drawing hint: the
    // desktop draws its native close control, the terminal `[ Close ]`.
    <Box key="buttons" flexDirection="row" gap={2} marginTop={1}>
      <Button key="prev" label="◀ Prev" hotkey="p" onPress={() => void stepBy(-1)} />
      <Button key="next" label="Next ▶" hotkey="n" variant="primary" autoFocus onPress={() => void stepBy(1)} />
      <Button key="close" label="Close" hotkey="c" role="dismiss" onPress={() => void closeReplay($)} />
    </Box>,
  ]

  if (isTerminal) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
        {body}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={0}>
      {body}
    </Box>
  )
}

// The band's hint, laid out as Token Weather lays out its line so the two
// read as one band: an icon, values over their labels, the controls at the
// trailing edge as bare text. Wide: the count, a strip of film with a frame
// per step, the lines changed; narrow: one line.
// The strip's SVG, built once per replay and width: a redraw for any other
// reason (the band beside it, a toast, a resize back) reuses it.
let stripCache = { key: '', svg: '' }

function cachedStrip(steps: readonly ReplayStep[], version: number, w: number): string {
  const key = `${version}:${w}`
  if (stripCache.key !== key) stripCache = { key, svg: stripSvg(frames(steps, w / 6), w) }
  return stripCache.svg
}

function hintBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, steps: ReplayStep[], version: number): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isTerminal = e.surface === 'terminal'
  const cols = e.props.bodyColumns
  const s = summarize(steps)
  const dockable = e.viewport?.isFullscreen
  const open = () => void openReplay($, dockable)
  const hide = () => void update($, view, v => ({ ...v, isHintHidden: true }))

  const icon = (size: number): RenderElement => {
    if (e.surface === 'terminal') {
      return (
        <Box width={3}>
          <Text color="magenta" bold>
            ▶▶
          </Text>
        </Box>
      )
    }
    const { Svg } = $.ui.resolve(e)
    return <Svg key="reel" source={iconSvg(size)} alt="Replay" width={size} height={size} />
  }

  const strip = (cells: number): RenderElement => {
    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="row">
          {frames(steps, cells).map(f =>
            f.add + f.del === 0 ? (
              <Text dimColor>▮</Text>
            ) : f.del === 0 ? (
              <Text color="green">▮</Text>
            ) : f.add === 0 ? (
              <Text color="red">▮</Text>
            ) : (
              <Text color="yellow">▮</Text>
            ),
          )}
        </Box>
      )
    }
    const { Svg } = $.ui.resolve(e)
    const w = cells * PX_PER_CELL
    return (
      <Svg
        key="strip"
        source={cachedStrip(steps, version, w)}
        alt={`${plural(s.edits, 'edit')}: ${s.add} lines added, ${s.del} removed`}
        width={w}
        height={20}
      />
    )
  }

  const lines = (
    <Text bold>
      <Text color={ADD}>{`+${s.add}`}</Text>
      <Text> </Text>
      <Text color={DEL}>{`−${s.del}`}</Text>
    </Text>
  )

  const controls = (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Button key="open-replay" label="Replay" plain hotkey={isTerminal ? 'r' : undefined} onPress={open} />
      <Button key="hide-hint" label="×" plain onPress={hide} />
    </Box>
  )

  if (cols < 60) {
    return (
      <Box flexDirection="row" columnGap={2} alignItems="center">
        {icon(20)}
        <Text bold>{plural(s.edits, 'edit')}</Text>
        {lines}
        <Box flexGrow={1} />
        {controls}
      </Box>
    )
  }

  const stripCells = cols >= 110 ? 22 : 16
  const tools = [s.edit ? `Edit ×${s.edit}` : '', s.write ? `Write ×${s.write}` : ''].filter(Boolean).join(' · ')
  const stripLabel = cols >= 90 ? `${plural(s.files, 'file')} · ${tools}` : plural(s.files, 'file')
  return (
    <Box flexDirection="row" alignItems="center" gap={2}>
      {icon(28)}
      <Box flexDirection="row" columnGap={3} alignItems="flex-start">
        <Box key="count" flexDirection="column">
          <Text bold>{plural(s.edits, 'edit')}</Text>
          <Text>last turn</Text>
        </Box>
        <Box key="film" flexDirection="column">
          <Box height={1} alignItems="center">
            {strip(stripCells)}
          </Box>
          <Text>{stripLabel}</Text>
        </Box>
        <Box key="lines" flexDirection="column">
          {lines}
          <Text>lines changed</Text>
        </Box>
      </Box>
      <Box flexGrow={1} />
      {controls}
    </Box>
  )
}

export function register(on: Parameters<Register>[0]): void {
  // Slash command: /replay opens the pane.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'replay',
      description: "Edit Replay: step through the last turn's file edits",
    })
    return next(e)
  })

  on('command.run', { command: 'replay' }, async ($, e) => {
    const opened = await openReplay($, e.presentation?.isFullscreen)
    const n = (await read($, replay)).length
    return {
      text: opened
        ? `Edit Replay: ${n} edit${n === 1 ? '' : 's'}`
        : 'Edit Replay: no edits in the last turn.',
    }
  })

  // Let each edit run, then record what it did. Never blocks or changes the
  // call, and never its result.
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const ran = await next(e)
    try {
      const step = await stepFor($, e, ran)
      if (step) await update($, pending, list => [...list, step])
    } catch {
      // recording must never fail the edit
    }
    return ran
  })

  // A subagent's run raises no turn.start: this is always the main loop.
  on('turn.start', async ($, e, next) => {
    await update($, pending, () => [])
    return next(e)
  })

  // At the end of a main-loop turn, the pending edits become the replay. A
  // turn with no edits keeps the previous replay.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const steps = await read($, pending)
    if (!steps.length) return r
    await update($, replay, () => steps)
    await update($, pending, () => [])
    await update($, index, () => 0)
    await update($, view, v => ({ ...v, isHintHidden: false }))
    return r
  })

  // The band above the prompt: the hint, stacked under whatever the plugins
  // beneath draw (the band is shared, so Token Weather's line stays). The
  // replay itself, drawn here when no pane could be placed, takes the band
  // alone: it sizes its diff to `maxRows`.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    const { value: steps = [], version } = await $.state.get(REPLAY)
    const v = await read($, view)
    if (v.mode === 'band') return replayView($, e, 'band')
    if (!steps.length || v.mode === 'pane' || v.isHintHidden) return next(e)
    const { Box } = $.ui.resolve(e)
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {below}
        {hintBand($, e, steps, version)}
      </Box>
    )
  })

  // The pane.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => replayView($, e, 'pane'))

  // The person closed the pane (Escape, the close mark): keep the flag in step.
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE_ID) await setMode($, 'closed')
    return r
  })
}
