// Edit Replay's type contract: the values it keeps in `$.state`.

/** One line of a step's diff: `+` added, `-` removed, ` ` context, `~` a skipped run. */
export type DiffLine = { op: '+' | '-' | ' ' | '~'; t: string }

/**
 * One recorded edit. `diff` holds at most the first lines a step can show;
 * `total` is how many the whole trimmed diff had, `add` and `del` its counts.
 */
export type ReplayStep = {
  tool: 'Edit' | 'Write'
  file: string
  note: string
  diff: DiffLine[]
  total: number
  add: number
  del: number
}

/** Where the replay shows: nowhere, in its pane, or in the band (no pane could be placed). */
export type ReplayMode = 'closed' | 'pane' | 'band'

declare module 'claude-code' {
  interface PluginState {
    'edit-replay': {
      /** Steps recorded during the running main-loop turn. */
      pending: ReplayStep[]
      /** The last finished turn's steps: what the pane shows. */
      replay: ReplayStep[]
      /** The step on screen, 0-based. */
      index: number
      /**
       * What the band draws from, read in one go: where the replay shows, and
       * whether the person hid the hint (the next replay shows it again).
       */
      view: { mode: ReplayMode; isHintHidden: boolean }
    }
  }
}
