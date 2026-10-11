import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PaneOpenArgs, RenderPropsOf } from 'claude-code'

import { frames } from '../hooks/art.ts'
import { makeStep, patchLines } from '../hooks/diff.ts'

const PLUGIN = 'edit-replay'
const PANE_ID = 'edit-replay'
const SURFACES = ['terminal', 'desktop'] as const
// Text drops `key` (TextProps has none), so the hint is found by its count.
const HINT = /^\d+ edits?$/

const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'Edit Replay',
  isFocused: true,
  bodyColumns: 56,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const bandProps = (maxRows = 12): RenderPropsOf['AbovePrompt'] => ({
  hasSurvey: false,
  isWorking: false,
  maxRows,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: maxRows - 1 },
  view: {},
})

const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }

// The patches the Edit and Write tools answer with, by file, as the tools
// spell them: the change and three lines of context around it.
const PATCHES: Record<string, { type?: 'create' | 'update'; lines: string[] }> = {
  '/repo/src/a.ts': { lines: ['-export function greet() {', '+export function welcome() {', '   return 1', ' }'] },
  '/repo/src/new.ts': { type: 'create', lines: ['+one', '+two', '+three', '+four', '+five'] },
  '/repo/src/old.ts': { type: 'update', lines: [' keep', '-old line', '+new line', ' keep too'] },
}

// The engine beneath the plugin: a working directory, tools that succeed (or
// are denied, fail, or are staged, by file name), turns that end, panes that
// open (or wait undrawn).
function engineBeneath(on: On, { isPlaced = true } = {}) {
  const opened: PaneOpenArgs[] = []
  const closed: string[] = []
  const commands: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  // The engine's own drawing, where the plugin passes.
  on('ui.render', () => ({ type: 'Box' as const, props: {}, children: [] }))
  on('tool.call', (_$, e) => {
    const path = e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : ''
    if (path.endsWith('denied.ts')) return { deny: 'The user declined.' }
    if (path.endsWith('broken.ts')) return { result: undefined as never, text: 'String not found', isError: true }
    const p = PATCHES[path] ?? { lines: ['+x'] }
    const result = { filePath: path, type: p.type, staged: path.endsWith('staged.ts'), structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: p.lines }] }
    return { result: result as never, text: 'ok' }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.register', (_$, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    opened.push(e)
    return { value: isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no room' } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const clock = mock.clock(on)
  return { opened, closed, commands, clock }
}

async function turnWithEdits($: Engine, turnId: string) {
  await $.turn.start({ text: 'rename greet to welcome', turnId })
  await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/src/a.ts',
    old_string: 'export function greet() {\n  return 1\n}',
    new_string: 'export function welcome() {\n  return 1\n}',
  })
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'one\ntwo\nthree\nfour\nfive\n' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/old.ts', content: 'keep\nnew line\nkeep too\n' })
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
}

async function runReplay($: Engine, env: ReturnType<typeof engineBeneath>, isFullscreen = true) {
  const run = $.command.run({
    command: 'replay',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen, columns: 160 },
  })
  // openReplay waits 200 ms for the band to let go of the keys.
  await env.clock.advance(200)
  return run
}

describe('diff', () => {
  test('keeps one line of context and marks skipped runs', () => {
    const hunk = { lines: [' a', '-b', '+B', ' c', ' d', ' e', '-f', '+F', '\\ No newline at end of file'] }
    expect(patchLines([hunk])).toEqual([
      { op: ' ', t: 'a' },
      { op: '-', t: 'b' },
      { op: '+', t: 'B' },
      { op: ' ', t: 'c' },
      { op: '~', t: '⋯' },
      { op: ' ', t: 'e' },
      { op: '-', t: 'f' },
      { op: '+', t: 'F' },
    ])
  })

  test('hunks are joined by a skipped run', () => {
    expect(patchLines([{ lines: ['-a', '+A'] }, { lines: ['-z', '+Z'] }])).toEqual([
      { op: '-', t: 'a' },
      { op: '+', t: 'A' },
      { op: '~', t: '⋯' },
      { op: '-', t: 'z' },
      { op: '+', t: 'Z' },
    ])
  })

  test('a step keeps at most 12 lines but counts them all', () => {
    const lines = Array.from({ length: 30 }, (_, n) => `+line ${n}`)
    const step = makeStep('Write', 'big.ts', 'new file', patchLines([{ lines }]))
    expect(step.diff).toHaveLength(12)
    expect(step.total).toBe(30)
    expect(step.add).toBe(30)
    expect(step.del).toBe(0)
  })
})

describe('recording', () => {
  test('/replay is registered at session start', async ($, on) => {
    const env = engineBeneath(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    expect(env.commands).toContain('replay')
  })

  test('with no edits, /replay says so and opens nothing', async ($, on) => {
    const env = engineBeneath(on)
    const r = await runReplay($, env)
    expect(r.text).toBe('Edit Replay: no edits in the last turn.')
    expect(env.opened).toHaveLength(0)
  })

  test('the band offers the replay after a turn with edits', async ($, on) => {
    engineBeneath(on)
    await turnWithEdits($, 't1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: VIEWPORT })
      expect((await ui.find({ type: 'Text', text: HINT }))?.text).toBe('3 edits')
      const open = await ui.find({ key: 'open-replay' })
      expect(open?.props.label).toBe('Replay')
      // A hotkey on the terminal; the desktop button is clicked.
      expect(open?.props.hotkey).toBe(surface === 'terminal' ? 'r' : undefined)
      await ui.unmount()
    }
  })

  test('denied, failed and staged edits are not recorded', async ($, on) => {
    engineBeneath(on)
    await $.turn.start({ text: 'try', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/denied.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/broken.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/staged.ts', content: 'x' })
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'one\ntwo\nthree\nfour\nfive\n' })
    await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: bandProps() })
    expect(await ui.find({ type: 'Text', text: HINT })).toMatchObject({ text: '1 edit' })
    await ui.unmount()
  })

  test('a turn with no edits keeps the previous replay', async ($, on) => {
    engineBeneath(on)
    await turnWithEdits($, 't1')
    await $.turn.start({ text: 'thanks', turnId: 't2' })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps() })
    expect((await ui.find({ type: 'Text', text: HINT }))?.text).toBe('3 edits')
    await ui.unmount()
  })
})

describe('pane', () => {
  test('/replay opens a focused pane sized by isFullscreen', async ($, on) => {
    const env = engineBeneath(on)
    await turnWithEdits($, 't1')
    const r = await runReplay($, env)
    expect(r.text).toBe('Edit Replay: 3 edits')
    expect(env.opened).toHaveLength(1)
    expect(env.opened[0]).toMatchObject({ id: PANE_ID, title: 'Edit Replay', focus: true, closeOnEscape: true })
    // Fullscreen docks the pane: ask for columns, not rows.
    expect(env.opened[0]?.columns).toBe(58)
    expect(env.opened[0]?.rows).toBeUndefined()
    // The main screen seats it inline: ask for rows, not columns.
    await runReplay($, env, false)
    expect(env.opened[1]?.rows).toBe(20)
    expect(env.opened[1]?.columns).toBeUndefined()
  })

  test('Prev, Next and Close step through the replay', async ($, on) => {
    const env = engineBeneath(on)
    await turnWithEdits($, 't1')
    for (const surface of SURFACES) {
      await runReplay($, env)
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: PANE_ID,
        props: PANE_PROPS,
        viewport: VIEWPORT,
      })
      const stepText = async () => (await ui.find({ type: 'Text', text: /^step \d+ of \d+$/ }))?.text
      const fileText = async () => (await ui.find({ type: 'Text', text: /^src\// }))?.text

      expect(await stepText()).toBe('step 1 of 3')
      expect(await fileText()).toBe('src/a.ts')
      expect(await ui.find({ type: 'Text', text: '- export function greet() {' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '+ export function welcome() {' })).toBeDefined()

      await ui.press({ key: 'next' })
      expect(await stepText()).toBe('step 2 of 3')
      expect(await fileText()).toBe('src/new.ts')
      expect(await ui.find({ type: 'Text', text: 'Write · new file' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '+5' })).toBeDefined()

      await ui.press({ key: 'next' })
      expect(await ui.find({ type: 'Text', text: 'Write · rewrite' })).toBeDefined()
      await ui.press({ key: 'next' })
      expect(await stepText()).toBe('step 3 of 3')

      await ui.press({ key: 'prev' })
      await ui.press({ key: 'prev' })
      await ui.press({ key: 'prev' })
      expect(await stepText()).toBe('step 1 of 3')

      const buttons = await ui.findAll({ type: 'Button' })
      expect(buttons.map(b => b.key)).toEqual(['prev', 'next', 'close'])
      expect(buttons.map(b => b.props.hotkey)).toEqual(['p', 'n', 'c'])
      const close = buttons[2]
      expect(close?.props.role).toBe('dismiss')

      // The terminal draws its own frame; the desktop pane brings its own.
      const root = await ui.find({ type: 'Box' })
      if (surface === 'terminal') expect(root?.props.borderStyle).toBe('round')
      else expect(root?.props.borderStyle).toBeUndefined()

      await ui.press({ key: 'close' })
      expect(env.closed.at(-1)).toBe(PANE_ID)
      await ui.unmount()
    }
  })

  test('the band button opens the pane and hides the hint', async ($, on) => {
    const env = engineBeneath(on)
    await turnWithEdits($, 't1')
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: VIEWPORT })
      const press = band.press({ key: 'open-replay' })
      await env.clock.advance(200)
      await press
      expect(env.opened.at(-1)).toMatchObject({ id: PANE_ID, columns: 58 })
      expect(await band.find({ type: 'Text', text: HINT })).toBeUndefined()
      await band.unmount()

      const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE_ID, props: PANE_PROPS })
      await pane.press({ key: 'close' })
      await pane.unmount()
    }
  })
})

describe('hint band', () => {
  test('wide: the count, a strip of film, the lines changed', async ($, on) => {
    engineBeneath(on)
    await turnWithEdits($, 't1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: VIEWPORT })
      expect(await ui.find({ type: 'Text', text: 'last turn' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '3 files · Edit ×1 · Write ×2' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '+7' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '−2' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'lines changed' })).toBeDefined()
      if (surface === 'terminal') {
        // One frame per step: Edit (mixed), Write new (added), Write old (mixed).
        const cells = await ui.findAll({ type: 'Text', text: '▮' })
        expect(cells.map(c => c.props.color)).toEqual(['yellow', 'green', 'yellow'])
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.map(v => v.props.alt)).toEqual(['Replay', '3 edits: 7 lines added, 2 removed'])
        expect(svgs.every(v => String(v.props.source).includes('@keyframes'))).toBe(true)
      }
      await ui.unmount()
    }
  })

  test('narrow: one line', async ($, on) => {
    engineBeneath(on)
    await turnWithEdits($, 't1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...bandProps(), bodyColumns: 50 } })
      expect(await ui.find({ type: 'Text', text: '3 edits' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'last turn' })).toBeUndefined()
      expect(await ui.find({ key: 'open-replay' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('× hides the hint until the next replay', async ($, on) => {
    engineBeneath(on)
    await turnWithEdits($, 't1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps() })
      await ui.press({ key: 'hide-hint' })
      expect(await ui.find({ type: 'Text', text: HINT })).toBeUndefined()
      await turnWithEdits($, `t-${surface}`)
      expect(await ui.find({ type: 'Text', text: '3 edits' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('past the strip width, neighbouring steps share a frame', () => {
    const step = (add: number, del: number) => ({ tool: 'Edit' as const, file: 'a', note: '', diff: [], total: 0, add, del })
    const steps = [step(1, 0), step(0, 1), step(2, 0), step(0, 3), step(4, 4)]
    expect(frames(steps, 10)).toHaveLength(5)
    expect(frames(steps, 2)).toEqual([{ add: 3, del: 1 }, { add: 4, del: 7 }])
  })
})

describe('shared band', () => {
  // Another plugin on the band, drawn the way Token Weather draws it: its
  // line on top of what lies beneath. Loaded outside edit-replay
  // (`prepend`) and inside it (`append`), so both orders are covered.
  for (const order of ['prepend', 'append'] as const) {
    const weather = {
      name: 'fake-weather',
      tier: order,
      register: (on: On) => {
        on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
          const { Box, Text } = $.ui.resolve(e)
          const below = await next(e)
          return Box({ flexDirection: 'column', children: [Text({ children: '☀ Clear 18% of context' }), below] })
        })
      },
    }

    test(`the hint stacks with another band plugin (${order})`, { plugins: [weather] }, async ($, on) => {
      engineBeneath(on)
      await turnWithEdits($, 't1')
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: VIEWPORT })
        const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
        const sky = texts.indexOf('☀ Clear 18% of context')
        const hint = texts.indexOf('3 edits')
        expect(sky).toBeGreaterThanOrEqual(0)
        expect(hint).toBeGreaterThan(sky)
        expect(await ui.find({ key: 'open-replay' })).toBeDefined()
        await ui.unmount()
      }
    })
  }

  test('the hint keeps what the engine draws beneath it', async ($, on) => {
    // Registered before engineBeneath's catch-all, so it is the one that answers.
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      return Box({ children: [Text({ children: 'beneath' })] })
    })
    engineBeneath(on)
    await turnWithEdits($, 't1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps() })
      expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: HINT })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('band fallback', () => {
  test('with no pane placed, the band draws the replay and Close returns the hint', async ($, on) => {
    const env = engineBeneath(on, { isPlaced: false })
    await turnWithEdits($, 't1')
    for (const surface of SURFACES) {
      await runReplay($, env)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(10), viewport: VIEWPORT })
      expect(await ui.find({ type: 'Text', text: 'step 1 of 3' })).toBeDefined()
      await ui.press({ key: 'next' })
      // maxRows 10 leaves room for 3 diff lines; the new file had 5.
      expect(await ui.find({ type: 'Text', text: '  … 2 more lines' })).toBeDefined()
      const closedBefore = env.closed.length
      await ui.press({ key: 'close' })
      // A replay drawn in the band closes no pane.
      expect(env.closed).toHaveLength(closedBefore)
      expect((await ui.find({ type: 'Text', text: HINT }))?.text).toBe('3 edits')
      await ui.unmount()
    }
  })
})
