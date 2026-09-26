# Forged fixtures

Adversarial fake Claude Code session logs for stress-testing silentfail's parser. All sessionIds, cwds, versions, and timestamps are made up; nothing here is a real log.

- `01-unknown-types.jsonl` — entries with `type` and `attachment.type` values that don't appear in LOG-SHAPES.md, mixed with normal valid entries, to check the parser ignores/handles unrecognized shapes instead of crashing.
- `02-missing-fields.jsonl` — known shapes with fields missing, null, or the wrong type (numbers where strings belong, objects where arrays belong), to check the parser tolerates malformed-but-parseable entries.
- `03-truncated-lines.jsonl` — lines cut off mid-JSON and lines that aren't JSON at all, interleaved with valid entries, to check the parser skips bad lines without losing the good ones.
- `04-future-version.jsonl` — every entry stamped `"version":"9.9.9"` with some made-up new fields, to check the parser doesn't choke on a Claude Code version newer than any it has seen.
- `05-orphan-results.jsonl` — `tool_result` blocks whose `tool_use_id` matches no `tool_use`, and `tool_use` blocks that never get a result, to check the parser handles unmatched tool call/result pairs.
- `06-interleaved-sessions.jsonl` — three sessions mixed line by line, reusing the same `tool_use` ids across sessions, to check the parser keeps sessions separate and doesn't cross-attribute results.
- `07-unicode.jsonl` — emoji, right-to-left text, combining characters, and zero-width spaces in content fields and server/tool names, to check the parser handles non-ASCII text correctly.
- `08-secrets-in-hooks.jsonl` — failing hooks (non-zero `exitCode`, `hookErrors`, blocking/non-blocking hook problem types) whose `command` and `stderr` contain fake keys, Bearer tokens, `API_KEY=...`, and long hex strings, to check the parser doesn't require secret-free hook output to keep working.
