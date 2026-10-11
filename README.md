# Edit Replay

Step through the file edits Claude made in the last turn, one diff at a time. Instead of scrolling back through a long answer to find what changed, you get a replay: next step, previous step, close.

## What you see

After a turn that edited files, a hint line appears above the prompt: a film strip colored by lines added and removed, the number of edits, and the total lines changed. Press **Replay** (or type `/replay`) to open the replay pane.

In the replay, each step shows one file's change as a compact diff, with one line of context around each hunk and long diffs trimmed to 12 lines (the added and removed counts always cover the full diff).

## Install

```
/plugin marketplace add FeidaWang/edit-replay
/plugin install edit-replay@edit-replay
```

Restart Claude Code to apply.

## Use

| Action | Terminal | Desktop |
| --- | --- | --- |
| Open the replay | `/replay`, or press `r` after focusing the band (ctrl+x, Tab) | `/replay` or the **Replay** button |
| Next / previous step | `n` / `p` | **Next** / **Prev** buttons |
| Close | `c` or Esc | **Close** |
| Hide the hint until the next replay | the `×` button | the `×` button |

## What it records

- Successful `Edit` and `Write` calls only. Denied, failed, and staged-for-review edits are not recorded.
- Edits made by subagents count toward the turn that started them.
- A turn with no edits keeps the previous replay.

The plugin reads the patch Claude Code already returns from the tool, so it computes no diffs of its own and reads no files.

## Works on

Claude Code terminal and desktop surfaces. It is a Claude Code *mod* (UI and hooks), so it has no effect in chat or Cowork. Terminal use requires Claude Code 2.1.287 or later; the desktop Code tab works from 2.1.286.

## Plays well with other plugins

The band above the prompt is shared. Edit Replay draws its hint beneath whatever other plugins draw there (for example a status or usage band) by calling `next(e)` first, so it never replaces another plugin's line.

## What it reads, runs, and sends

Everything runs locally. The plugin sends nothing anywhere: it makes no network requests, bundles no MCP server, and calls no model.

- **Reads tool results.** The patch returned by each successful `Edit` and `Write` call.
- **Reads the working directory** (`$.session.cwd`) to show paths relative to the project.
- **Runs no programs and reads no environment variables or credentials.**
- **Handles the `/replay` command itself.** It does not touch permissions, agents, settings, or Remote Control.
- **Keeps state** (the last turn's trimmed edits, the current step, the view mode) in Claude Code's own in-session plugin state.

See [PRIVACY.md](PRIVACY.md) for the data-handling summary.

## Development

```
claude plugin validate .      # manifest + hooks
claude plugin test .          # unit and UI tests (terminal and desktop)
./scripts/preflight.sh        # everything the directory's checks look at
```

Source: `hooks/diff.ts` (patch to steps), `hooks/art.ts` (film strip and icons), `hooks/register.tsx` (hooks, `/replay`, band and pane), `types/index.d.ts` (the `$.state` contract).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Edit Replay is derived from the `replay-theater` sample mod in [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/replay-theater) (Apache-2.0). It is an independent project, not an Anthropic product.
