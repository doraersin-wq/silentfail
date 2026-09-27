# silentfail

Finds the parts of your Claude Code setup that look fine but are broken.

```
npx silentfail
```

Example output (from `npx silentfail --days 90` on the author's machine):

```
silentfail: 38 sessions, last 90 days, Claude Code 2.1.170-2.1.281

BROKEN
  [x] MCP filesystem: 2 of 2 calls failed (last 2026-08-23)

OK: 25 MCP servers, 1 hook (--all to list)
```

## What it checks

| Finding | Severity | Meaning |
|---|---|---|
| MCP call failures | broken or warning | Calls to an MCP server keep failing (broken at 50% or more with 2+ calls, warning at 20% or more) |
| MCP connection failures | broken | A server failed to connect |
| MCP needs auth | warning | A server kept asking you to log in |
| MCP stuck pending | warning | A server never finished connecting |
| MCP never seen | warning | A server is in your config but never showed up in the logs |
| Hook errors | broken | A hook exited non-zero or errored |
| Slow hooks | warning | A hook took over 10 seconds |
| Hook never ran | warning | A configured Stop hook never ran |
| Can't verify | unknown | A hook on an event that leaves no trace when it succeeds |

## Privacy

- It runs entirely on your machine. Nothing is uploaded, and there's no telemetry.
- It reads Claude Code's own session logs (`~/.claude/projects`) and your config files. It never prints your conversations.
- Anything that looks like a key or token is blanked out before it's printed. This is best effort, so glance over a report before sharing it.
- For a failing hook it prints the hook's command and the first line of its error output, after blanking.

## Options

```
--days <n>     how many days of session logs to read (default 14)
--json         print JSON instead of the report
--all          also list everything that is fine, and unrecognized log shapes
--exit-zero    exit 0 even when something is broken (for scripts and the plugin)
```

Exit codes: `0` nothing broken, `1` something is broken, `2` silentfail couldn't run.

## Inside Claude Code

silentfail is also a Claude Code plugin. Install it once:

```
/plugin marketplace add <github-user>/silentfail
/plugin install silentfail@silentfail
```

From a local clone, use `/plugin marketplace add ./silentfail` instead.

Then type `/silentfail` in any session. The report runs on your machine, and Claude walks you through each problem and how to fix it. It asks before changing anything. Claude sees the report, not your session logs.

## How it works

Claude Code writes a log of every session to disk, and those logs record which MCP servers failed to connect, which tool calls failed, and how hooks ran. silentfail reads those logs, compares them with your settings, plugins and `.mcp.json` files, and reports the difference.

## How it fits with other tools

silentfail looks back at what actually happened. It works alongside:

| Tool | Use it for |
|---|---|
| `/doctor` (built into Claude Code) | Checking and cleaning up your config and context size |
| silentfail | Finding what actually failed, from your session history |
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | Debugging one server live. silentfail prints the exact command for each broken server |
| [ccusage](https://github.com/ryoppippi/ccusage) | Seeing what Claude Code cost you |

## Limitations

- Some hook events leave no trace in the logs when they succeed. Those show as UNKNOWN, never as broken.
- The log format isn't an official API. New Claude Code versions can add entry types. silentfail counts anything it doesn't recognize instead of crashing, and says so at the bottom of the report.

## Contributing

- `npm test` runs the suite.
- `npm run test:stress` runs the 200 MB streaming test.
- New adversarial fixtures come from the `log-forger` agent in `.claude/agents/`.

## License

MIT
