# silentfail: Design

**Date:** 2026-09-26
**Status:** Approved 2026-09-26

## 1. Purpose

`npx silentfail` finds the parts of a Claude Code setup that look fine but are
broken. Examples: MCP servers that never connect or whose calls keep failing,
and hooks that error, crash, or never run.

It works by reading the session logs Claude Code already writes to disk and
comparing them against the user's configuration. Nothing needs to be installed,
and it reports on weeks of history the first time it runs.

### Success criteria

1. On the author's machine, it reports the `filesystem` MCP server as broken
   (2 of 2 calls failed).
2. It never crashes on log content it does not understand. Unrecognized entries
   are counted and reported, never dropped silently.
3. It never prints conversation content, and every planted secret and canary
   string stays out of its output (enforced by tests).
4. It finishes a 200 MB log set without running out of memory.
5. Launch goal: in the first month after the public launch, 10 strangers report
   that it found something broken in their setup, and npm weekly downloads grow.

### Non-goals (v1)

- Fixing anything automatically. It reports; the user fixes.
- Telemetry, accounts, or uploads. Everything stays on the user's machine.
- Other MCP clients (Cursor, VS Code, Claude Desktop chat).
- Plugin and skill checks for enabled-but-not-loaded. Deferred to v2.
- A tracer hook for events that leave no trace in the logs. Deferred to v2.
- A GUI, a watch mode, or any config file of its own.

## 2. Evidence: what the logs record

The design is based on a structure-only survey of the author's logs: 37 session
files, 19,376 lines, Claude Code 2.1.170 to 2.1.281. No content was read.

| Signal | Where it appears in `~/.claude/projects/<project>/<session>.jsonl` |
|---|---|
| MCP connection problems | `attachment.type = "deferred_tools_delta"`, fields `failedMcpServers`, `needsAuthMcpServers`, `pendingMcpServers`, `addedNames` |
| MCP calls and failures | `message.content[]` items: `tool_use` (`name` = `mcp__<server>__<tool>`, `id`) paired with `tool_result` (`tool_use_id`, `is_error`) |
| Hook runs | `attachment.type = "hook_success"` with `hookEvent`, `hookName`, `command`, `exitCode`, `durationMs`, `stderr`. Observed for SessionStart only. |
| Hook context output | `attachment.type = "hook_additional_context"` with `hookEvent`, `hookName`. Observed for SessionStart and PostToolUse. |
| Stop hooks | `type = "system"`, `subtype = "stop_hook_summary"` with `hookCount`, `hookErrors[]`, `hookInfos[].command`, `preventedContinuation` |
| Session context | every entry: `sessionId`, `cwd`, `timestamp`, `version` |

**Name and command forms (observed):**

- **Plugin MCP servers** appear in the status lists as
  `plugin:<plugin>:<server>` (for example, `plugin:cloudflare:cloudflare`).
  Their tool-name form hasn't been observed yet. The matcher accepts both
  `mcp__plugin_<plugin>_<server>__…` and the colon form; add a fixture as soon
  as a real example is seen.
- **Hook commands:** `hook_success.command` holds the command exactly as
  written in the config, including an unexpanded `${CLAUDE_PLUGIN_ROOT}` and
  surrounding quotes. Matching a configured hook to its runs is therefore an
  exact string compare after trimming.
- **Stop hooks that match no config:** the logs show 2 Stop hooks on every
  session that match no local config file, most likely injected by the desktop
  app.

Other hook attachment types (errors, blocking errors, cancellations) were not
observed on this machine. Any attachment whose type starts with `hook_`, other
than the two above, is treated as a hook problem and reported under its raw
type name.

## 3. Architecture

Node >= 22 (Node 20 reached end of life in April 2026), plain ES modules, zero
runtime dependencies. There are four stages,
and each can be tested on its own:

```
sources/  →  extract/  →  analyze/  →  report/
```

### 3.1 `src/sources/`

- **`paths.js`:** resolves the Claude config directory (`CLAUDE_CONFIG_DIR`,
  else `~/.claude`) and `~/.claude.json`. Uses `os.homedir()` and `path.join`
  everywhere; no hard-coded separators.
- **`logs.js`:** finds `projects/**/*.jsonl` whose modification time falls
  within `--days`. Streams each file line by line with `readline`, so no file is
  ever read into memory whole. Yields `{ entry, file, line }`. Lines that fail
  to parse are counted per file and skipped.
- **`config.js`:** collects the configured items:
  - **MCP servers**, with the scope each came from:
    - `~/.claude.json` top-level `mcpServers` (user scope)
    - `~/.claude.json` `projects[<path>].mcpServers` (local scope)
    - `<project>/.mcp.json` for each project path seen in the logs (project scope)
    - each enabled plugin's `.mcp.json` and the `mcpServers` field of its `plugin.json` (plugin scope)
  - **Hooks:** the `hooks` object from `~/.claude/settings.json`, and from each
    seen project's `.claude/settings.json` and `.claude/settings.local.json`,
    plus each enabled plugin's `hooks/hooks.json`.
  - **Enabled plugins:** `enabledPlugins` in settings, with install paths from
    `plugins/installed_plugins.json`.

  A missing file is skipped quietly. A file that can't be read or parsed is
  skipped and recorded as a config warning.

### 3.2 `src/extract/`

These are pure functions: one log entry in, zero or more facts out.

- `mcpStatus.js` → `{ kind: 'mcp-status', server, state: 'failed'|'needs-auth'|'pending'|'connected', sessionId, cwd, ts }`
- `mcpCalls.js` → `{ kind: 'mcp-call', server, ok, sessionId, cwd, ts }`. It keeps
  a per-session `tool_use.id → name` map. A result with no matching call becomes
  an `orphan-result` fact.
- `hookRuns.js` → `{ kind: 'hook-run', event, command, exitCode, durationMs, stderr, problemType, sessionId, cwd, ts }`
  from `hook_success`, the other `hook_*` types, and `stop_hook_summary`.
  `stderr` is kept only for failed runs.
- `common.js` holds the shared helpers: tool-name parsing, server keys, and
  safe field access.
- `shapes.js` lists the entry shapes seen in real logs.
- `index.js` runs every extractor on each entry. An entry counts as
  unrecognized when its `type/subtype/attachment.type` shape isn't on that
  list and no extractor produced a fact from it. `index.js` also records the
  sessions, working directories, and the minimum and maximum `version` seen.

### 3.3 `src/analyze/`

Pure functions: facts plus config in, findings out. Each finding is
`{ id, severity: 'broken'|'warning'|'unknown'|'ok', subject, message, evidence }`.

| Finding | Severity | Rule |
|---|---|---|
| `mcp-failed-connect` | broken | the server appears in `failedMcpServers` in at least 1 session |
| `mcp-call-errors` | broken if ≥2 calls and ≥50% failed; warning if ≥20% | from `mcp-call` facts |
| `mcp-needs-auth` | warning | listed in `needsAuthMcpServers`; the message says in how many sessions |
| `mcp-stuck-pending` | warning | pending in a session, and none of its tools were ever added in that session |
| `mcp-never-seen` | warning | configured and enabled, but never appears in any log entry within the window. Project-scoped servers only count sessions whose `cwd` is inside that project. |
| `hook-error` | broken | a non-zero `exitCode`, any other `hook_*` problem type, or a non-empty `hookErrors` |
| `hook-slow` | warning | `durationMs` > 10,000 |
| `hook-never-ran` | warning | a configured SessionStart or Stop hook whose command never appears in the logs, for events whose runs are logged (see §2) |
| `hook-no-trace` | unknown | a configured hook on an event whose successful runs leave no trace. Worded as "can't verify", never "broken". |
| `logs-unrecognized` | shown in the footer | counts, and the range of Claude Code versions seen |

Servers and hooks seen in the logs but not in any local config are checked for
failures and errors, but never flagged as "never seen" or "never ran". These
include claude.ai connectors, servers built into the desktop app, and the Stop
hooks the desktop app injects. "Never seen" means no `mcp-status` fact, no
`mcp-call` fact, and no `mcp__<server>__` tool name for that server in the
window.

### 3.4 `src/report/`

- **Terminal (default):** grouped BROKEN → WARNING → UNKNOWN, then a one-line
  OK count. It uses ASCII markers `[x] [!] [?]` so it renders in any Windows
  console, with ANSI color that's disabled when `NO_COLOR` is set or output
  isn't a terminal.
- **`--json`:** the same findings as a stable JSON document.
- **`--all`:** also lists the OK items.

Example:

```
silentfail: 37 sessions, last 14 days, Claude Code 2.1.229-2.1.281

BROKEN
  [x] MCP filesystem: 2 of 2 calls failed (last 2026-09-23)
WARNING
  [!] MCP cloudflare: needs auth in 9 of 9 sessions
UNKNOWN
  [?] Hook PreToolUse (plugin superpowers): successful runs leave no trace; can't verify
OK: 21 MCP servers, 2 hooks (--all to list)

12 log lines not recognized (newer Claude Code?). This is not an error.
```

### 3.5 `src/cli.js`

The `bin` entry. Flags: `--days <n>` (default 14), `--json`, `--all`,
`--help`, `--version`. Exit codes: `0` nothing broken, `1` broken findings,
`2` silentfail itself couldn't run (for example, no Claude config directory).

## 4. Privacy and redaction

- It never reads or prints message text, prompts, tool inputs, or tool outputs.
  Extractors pull only the named fields in §2.
- Printed strings (hook commands, the stderr line, server names) all pass
  through `redact.js`, which replaces these with `[redacted]`:
  - Anthropic and OpenAI style keys: `sk-…`
  - GitHub tokens: `ghp_`, `gho_`, `github_pat_`
  - Slack tokens: `xox[abpr]-`
  - AWS access keys: `AKIA…`
  - `Bearer <token>`
  - `token|key|secret|password=<value>`
  - any run of 32 or more base64 or hex characters
- stderr is cut to its first line, at most 120 characters, after redaction.

## 5. Error handling

- A missing config directory produces a friendly message and exit code 2.
- An unreadable log file produces a warning in the footer, and the scan
  continues.
- Unparseable lines are counted, never thrown.
- An unknown entry shape is counted as unrecognized.
- Any extractor throwing on an entry is caught; the entry is counted as
  unrecognized and the run continues. There is one top-level catch that
  prints a bug-report hint.

## 6. Testing

Test-first, using `node --test`.

- **Unit tests** for each extractor, analyzer rule, and redaction pattern.
- **Hand-written fixtures** (`test/fixtures/basic/`) with exact expected
  findings, including one that reproduces the author's `filesystem` 2-of-2
  failure.
- **End-to-end test:** builds a fake config directory in `os.tmpdir()`, runs
  the CLI with `CLAUDE_CONFIG_DIR` pointing at it, and asserts on the `--json`
  output and the exit code.
- **Forged fixtures (log-forger agent):**
  - `.claude/agents/log-forger.md`, `model: sonnet`, tools `Read, Write, Glob`.
  - It reads only `test/LOG-SHAPES.md` (the structure sheet from §2) and never
    real logs.
  - It writes `test/fixtures/forged/*.jsonl` designed to break the parser:
    - unknown types
    - missing fields
    - truncated lines
    - a made-up future version
    - orphan tool results
    - interleaved sessions
    - odd unicode
    - fake keys in stderr and commands
  - Every forged file contains the canaries `sk-ant-FAKE0000000000000000` and
    `CANARY_DO_NOT_PRINT`.
  - The output is reviewed and committed, so tests are deterministic and cost
    no usage to rerun.
  - Forged-fixture tests check invariants only: no crash, no canary in the
    output, and unrecognized shapes counted.
- **Stress test** (`npm run test:stress`, not part of the default run):
  `test/stress/make-big.js` concatenates the forged fixtures into a 200 MB file
  in the temp directory. The test requires a full run in under 60 s, with
  memory use (RSS) under 256 MB.
- **CI:** a GitHub Actions matrix (Ubuntu, macOS, Windows × Node 22, 24),
  which is free for public repos.
- **Real-machine check (last task):** run `npx .` on the author's machine and
  confirm the `filesystem` finding.
- **Hook logging check (a spike during the build):** temporarily register a
  harmless PreToolUse hook on the dev machine and inspect what gets logged.
  This decides whether PreToolUse moves from `hook-no-trace` to
  `hook-never-ran`. The throwaway hook is removed afterward.

## 7. Build process

The plan comes from the writing-plans skill and runs in one session with
subagent-driven development. The main session (planning and review) runs on Opus 5.5.
Implementation subagents run on Sonnet 5 (the author is on the Pro
plan, which doesn't include Fable). A phone push goes out when the plan finishes
or blocks. If the Pro usage limit interrupts it, it resumes when the user says
"continue".

## 8. Launch

- MIT license, published on the author's GitHub and on npm as `silentfail`
  (the name was free on 2026-09-26). No "Claude" in the name, because of
  Anthropic's trademark.
- The README opens with a real, redacted report, then the single command, then
  the privacy promise.
- Publish to GitHub and npm in October 2026. The public launch posts
  (r/ClaudeAI, the Claude Discord, Show HN) go out once the package is published.

## 9. Risks

| Risk | Mitigation |
|---|---|
| The log format isn't a public API and changes between versions | Tolerant extractors, unrecognized-shape counting, and forged future-version fixtures. v2 adds a weekly format-change check. |
| False alarms erode trust | "unknown" instead of "broken" wherever the evidence is absent, and thresholds on error rates |
| Anthropic ships the same check | It would still be a shipped project with real users, which is the outcome that matters. Moving fast matters more than the moat. |
| Only one dev machine (Windows) | `path.join` and `os.homedir` everywhere, plus the CI matrix across OSes |

## 10. Later (not v1)

- A plugin wrapper that exposes the CLI as a `/silentfail` command.
- A tracer hook that covers events leaving no trace in the logs.
- A weekly agent that runs the test suite against the newest Claude Code logs
  to catch format changes.
- Plugin and skill enabled-versus-loaded checks.
