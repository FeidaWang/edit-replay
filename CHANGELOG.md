# Changelog

## 0.1.2

- Remove the `setMode` helper; its four call sites now call `update($, view, ...)` directly. The directory's analyzer reported exactly those calls (`MOD_CAPABILITY_USE_NOT_PLAIN`) and no other use of `$`.

## 0.1.1

- Make `setMode` an `async` function that awaits its update, so the directory's analyzer can follow every `$` use (it reported `MOD_CAPABILITY_USE_NOT_PLAIN` at its call sites).

## 0.1.0

- First release as Edit Replay, derived from the `replay-theater` sample mod (Apache-2.0, see NOTICE).
- Records the successful `Edit` and `Write` calls of each turn and replays them one diff at a time, in a pane or in the band above the prompt.
- Hint band with a film strip, shared with other plugins' bands through `next(e)`.
- `/replay` command; hotkeys on the terminal; native close control on desktop.
