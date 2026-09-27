---
name: silentfail
description: Checks this machine's Claude Code setup for MCP servers and hooks that look fine but are broken, using the local session logs, then explains each problem and offers a fix. Use when the user runs /silentfail, or asks why an MCP server, tool call, hook, or plugin isn't working.
allowed-tools: Bash(node *)
---

# silentfail report

silentfail produced the report below on this machine. It read Claude Code's session logs and config files locally. It contains no conversation content, and anything that looks like a secret is blanked out.

```!
node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" --json --exit-zero
```

## What to do with it

1. If the report above is an error message instead of JSON, say that silentfail couldn't run, quote its first line, and stop.
2. Go through the findings in order: broken first, then warning, then unknown. For each broken or warning finding, say in one plain sentence what's wrong and why it matters. Then give one concrete fix, naming the setting, file or command involved.
3. For unknown findings, say briefly that silentfail can't verify that item from the logs. Don't call it broken.
4. Mention ok items only as a count.
5. If nothing is broken or warning, say so in one line.
6. Never change settings, config files or plugins yourself. Offer the fix and wait for the user to say yes.
7. Don't open or read the session logs under `~/.claude/projects` yourself. The report already summarizes them.
8. If the user asks for a different time window, run `node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" --json --exit-zero --days <n>`, where `<n>` is a whole number from 1 to 3650.
