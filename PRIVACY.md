# Privacy

Edit Replay runs entirely on your machine.

- **Reads:** the result of each successful `Edit` or `Write` tool call in the current session (file path, line counts and the changed lines of the patch), and the session's working directory, used to show paths relative to your project.
- **Stores:** at most the last turn's edits, trimmed to a few lines each, in Claude Code's own in-session plugin state. Nothing is written to disk by the plugin and nothing outlives the session.
- **Sends:** nothing. The plugin makes no network requests, bundles no MCP server, starts no processes, and does not read credentials or environment variables.
- **Age:** the plugin is not directed at people under 18 and collects no personal data.

Questions: founder@rsiagent.app
