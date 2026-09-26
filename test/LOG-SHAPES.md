# Claude Code session log shapes

This sheet is the only source the log-forger agent may use. It describes the
structure of Claude Code session logs, based on a structure-only survey of real
logs (Claude Code 2.1.170 to 2.1.281). It contains no real content.

## Files

- One file per session: `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`. Subagent sessions can sit in subfolders.
- One JSON object per line, UTF-8. Lines end in `\n` (sometimes `\r\n` on Windows).

## Fields on most entries

- `type`: the entry kind (see below)
- `sessionId`: string
- `cwd`: the working directory, e.g. `/forged/project-a`
- `timestamp`: ISO 8601, e.g. `2026-09-20T10:00:00.000Z`
- `version`: the Claude Code version, e.g. `2.1.281`
- often also: `uuid`, `parentUuid`, `isSidechain`, `userType`, `entrypoint`, `gitBranch`

## Shapes silentfail reads

1. **MCP connection status.** `type: "attachment"` with `attachment.type: "deferred_tools_delta"`. The attachment fields are:
   - `addedNames` and `readdedNames`: tool names such as `mcp__filesystem__read_file`
   - `removedNames`, `addedLines`
   - `failedMcpServers`, `needsAuthMcpServers`, `pendingMcpServers`: arrays of server names such as `plugin:cloudflare:cloudflare`
   - sometimes `wireHiddenNames`, `surfacedNames`
2. **Tool calls.** `type: "assistant"`. `message.content[]` holds `{"type":"tool_use","id":"toolu_1","name":"mcp__<server>__<tool>","input":{...}}`.
3. **Tool results.** `type: "user"`. `message.content[]` holds `{"type":"tool_result","tool_use_id":"toolu_1","is_error":true,"content":"..."}`. `is_error` is absent on success.
4. **Hook run.** `type: "attachment"` with `attachment.type: "hook_success"`. Fields: `hookEvent`, `hookName` (e.g. `SessionStart:startup`), `command`, `exitCode`, `durationMs`, `stdout`, `stderr`, `toolUseID`.
5. **Hook context.** `attachment.type: "hook_additional_context"`. Fields: `hookEvent`, `hookName`, `content`, `toolUseID`.
6. **Hook problems.** Any other `attachment.type` starting with `hook_`, for example `hook_non_blocking_error`, with the same fields as `hook_success`.
7. **Stop hook summary.** `type: "system"` with `subtype: "stop_hook_summary"`. Fields:
   - `hookCount`
   - `hookInfos`: an array of `{"command":"..."}`
   - `hookErrors`: an array of strings or objects
   - `preventedContinuation`, `stopReason`, `hasOutput`, `level`, `toolUseID`

## Shapes that exist but silentfail ignores

- **Top-level types:** `assistant` and `user` with plain text, `summary`, `last-prompt`, `custom-title`, `ai-title`, `atis-latch`, `queue-operation`, `mode`, `bridge-session`, `agent-name`, `file-history-delta`, `file-history-snapshot`, `cost-state`.
- **`system` subtypes:** `system/local_command`, `system/compact_boundary`.
- **`attachment` types:** `total_tokens_reminder`, `edited_text_file`, `skill_listing`, `task_reminder`, `agent_listing_delta`, `mcp_instructions_delta`, `deferred_tools_record`, `auto_mode`, `silent_turn_reminder`, `prompt_snapshot`, `command_permissions`, `queued_command`, `date`, `instructions`, `environment`, `model`, `file`, `session_context`, `remote_session_change`, `compact_file_reference`, `thinking_drop`.

## Example lines (synthetic)

```
{"type":"attachment","sessionId":"forged-00-a","cwd":"/forged/project-a","timestamp":"2026-09-20T10:00:00.000Z","version":"2.1.281","attachment":{"type":"hook_success","hookEvent":"SessionStart","hookName":"SessionStart:startup","command":"\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start","exitCode":0,"durationMs":120,"stdout":"CANARY_DO_NOT_PRINT","stderr":""}}
{"type":"attachment","sessionId":"forged-00-a","cwd":"/forged/project-a","timestamp":"2026-09-20T10:00:01.000Z","version":"2.1.281","attachment":{"type":"deferred_tools_delta","addedNames":["mcp__filesystem__read_file"],"addedLines":[],"readdedNames":[],"removedNames":[],"pendingMcpServers":[],"needsAuthMcpServers":["plugin:cloudflare:cloudflare"],"failedMcpServers":[]}}
{"type":"assistant","sessionId":"forged-00-a","cwd":"/forged/project-a","timestamp":"2026-09-20T10:00:02.000Z","version":"2.1.281","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"mcp__filesystem__read_file","input":{"path":"CANARY_DO_NOT_PRINT"}}]}}
{"type":"user","sessionId":"forged-00-a","cwd":"/forged/project-a","timestamp":"2026-09-20T10:00:03.000Z","version":"2.1.281","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","is_error":true,"content":"denied sk-ant-FAKE0000000000000000"}]}}
{"type":"system","subtype":"stop_hook_summary","sessionId":"forged-00-a","cwd":"/forged/project-a","timestamp":"2026-09-20T10:00:04.000Z","version":"2.1.281","hookCount":1,"hookInfos":[{"command":"node stop.js"}],"hookErrors":[],"preventedContinuation":false}
```
