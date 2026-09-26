# silentfail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `npx silentfail`, a zero-dependency Node CLI that reads Claude Code's session logs and config files and reports MCP servers and hooks that look fine but are broken.

**Architecture:** There are four stages, each testable on its own:
- **`src/sources/`** finds and streams the log files and reads the config files.
- **`src/extract/`** turns each log entry into small "facts". These are pure functions.
- **`src/analyze/`** compares the facts with the config and grades each finding: broken, warning, unknown, or ok. These are pure functions too.
- **`src/report/`** prints the findings as a terminal report or as JSON.

`src/run.js` wires the stages together, `src/main.js` handles flags and exit codes, and `src/cli.js` is the bin entry.

**Tech Stack:** Node >= 22, ES modules, `node:test`, and no npm dependencies at all (none for runtime or dev).

**Spec:** `docs/superpowers/specs/2026-09-26-silentfail-design.md`

**Execution notes:**
- **Models:** implementer subagents run on Sonnet 5 (`model: "sonnet"`). The controller, meaning the main session doing reviews, runs on Opus 5.5.
- **Controller steps:** Task 8 and Task 11 Step 4 are run by the controller, not by an implementer.
- **Environment:** the dev machine is Windows 10 with Git Bash and Node 22.22.

## Global Constraints

- **Node:** `"engines": { "node": ">=22" }`, `"type": "module"`, and zero entries in `dependencies` or `devDependencies`.
- **Paths:** use only `node:path` `join`/`resolve` and `os.homedir()`. No hard-coded `/` or `\` separators in path building.
- **Config location:** honor `CLAUDE_CONFIG_DIR`, falling back to `~/.claude`. The global config file is `$CLAUDE_CONFIG_DIR/.claude.json` when that variable is set, and `~/.claude.json` otherwise.
- **Privacy:**
  - Never read or print message text, prompts, tool inputs, or tool outputs.
  - Every string silentfail prints goes through `redact()`, `redactLine()`, or `redactDeep()` from `src/redact.js`.
  - The canary strings `CANARY_DO_NOT_PRINT` and `sk-ant-FAKE` must never appear in any output.
- **Robustness:** never crash on unknown log content. Unparseable lines are counted in `badLines`. Unknown entry shapes are counted in `unrecognized`.
- **Exit codes:** `0` nothing broken, `1` broken findings, `2` silentfail could not run.
- **Output markers:** ASCII only (`[x]`, `[!]`, `[?]`, `[ok]`). ANSI color only when stdout is a TTY and `NO_COLOR` is unset.
- **Testing:**
  - `npm test` runs `node --test "test/**/*.test.js"`.
  - The stress test is separate: `npm run test:stress`.
  - Real session logs never go in the repo; test fixtures are synthetic.
- **Commits:** every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pass it as a second `-m`.

## File Map

| File | Responsibility |
|---|---|
| `package.json`, `LICENSE`, `.gitignore` | Package metadata, bin entry, scripts |
| `src/redact.js` | Blank out credentials before printing |
| `src/format.js` | `plural()` for human-readable counts |
| `src/sources/paths.js` | Where the Claude config and global config live |
| `src/sources/logs.js` | Find recent `*.jsonl` files and stream them line by line |
| `src/sources/config.js` | Collect configured MCP servers, hooks and enabled plugins |
| `src/extract/common.js` | Shared helpers: tool-name parsing, server keys, safe field access |
| `src/extract/mcpStatus.js` | `deferred_tools_delta` → MCP connection-status facts |
| `src/extract/mcpCalls.js` | `tool_use`/`tool_result` pairs → MCP call facts |
| `src/extract/hookRuns.js` | `hook_*` attachments and `stop_hook_summary` → hook-run facts |
| `src/extract/shapes.js` | Known entry shapes, `shapeOf()` |
| `src/extract/index.js` | Run all extractors, intern strings, count sessions, versions and unrecognized shapes |
| `src/analyze/common.js` | `finding()`, `later()`, `isInside()`, `ranInProject()` |
| `src/analyze/mcp.js` | MCP findings |
| `src/analyze/hooks.js` | Hook findings, `TRACED_EVENTS` |
| `src/report/text.js` | Terminal report |
| `src/report/json.js` | JSON report |
| `src/run.js` | The whole pipeline → `{ findings, stats }` |
| `src/main.js` | Flags, help, exit codes |
| `src/cli.js` | Bin entry (3 lines) |
| `test/helpers/fakeHome.js` | Throwaway Claude config folders for tests |
| `test/fixtures/basic/*.jsonl` | Hand-written logs with exact expected findings |
| `test/LOG-SHAPES.md` | Structure sheet the log-forger agent works from |
| `.claude/agents/log-forger.md` | Sonnet agent that writes adversarial fake logs |
| `test/fixtures/forged/*.jsonl` | The agent's output, committed |
| `test/stress/*` | 200 MB streaming test |
| `.github/workflows/ci.yml` | Test matrix across OSes |
| `README.md` | Docs |

---

### Task 1: Project scaffold and redaction

**Files:**
- Create: `package.json`, `LICENSE`, `src/redact.js`
- Test: `test/redact.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `redact(text: unknown): string`. Returns `''` for null or undefined.
  - `redactLine(text: unknown, max = 120): string`. Returns the first line only, redacted, capped at `max` characters, with `...` when cut.
  - `redactDeep(value: unknown): unknown`. Redacts every string, object keys included.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "silentfail",
  "version": "0.1.0",
  "description": "Finds the parts of your Claude Code setup that look fine but are broken: MCP servers and hooks, straight from your own session logs.",
  "type": "module",
  "bin": { "silentfail": "src/cli.js" },
  "files": ["src/", "README.md", "LICENSE"],
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test \"test/**/*.test.js\"",
    "test:stress": "node --test test/stress/big-file.stress.js"
  },
  "keywords": ["claude-code", "mcp", "hooks", "diagnostics", "doctor"],
  "license": "MIT"
}
```

- [ ] **Step 2: Create `LICENSE`**

```text
MIT License

Copyright (c) 2026 SilentBuilder

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Write the failing tests in `test/redact.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactDeep, redactLine } from '../src/redact.js';

test('blanks Anthropic-style keys, including the canary', () => {
  assert.equal(redact('key sk-ant-FAKE0000000000000000 end'), 'key [redacted] end');
});

test('does not treat words containing "sk-" as keys', () => {
  assert.equal(redact('run-task-scheduler-now'), 'run-task-scheduler-now');
});

test('blanks GitHub, Slack and AWS tokens', () => {
  assert.equal(redact('ghp_' + 'a'.repeat(36)), '[redacted]');
  assert.equal(redact('github_pat_' + 'A1'.repeat(15)), '[redacted]');
  assert.equal(redact('xoxb-1234567890-abcdef'), '[redacted]');
  assert.equal(redact('AKIAABCDEFGHIJKLMNOP'), '[redacted]');
});

test('blanks bearer tokens and key=value secrets', () => {
  assert.equal(redact('curl -H "Authorization: Bearer abc.def.ghi" x'), 'curl -H "Authorization: Bearer [redacted]" x');
  assert.equal(redact('API_KEY=hunter2 next'), 'API_KEY=[redacted] next');
  assert.equal(redact('?token=abc&x=1'), '?token=[redacted]&x=1');
});

test('blanks long token-like runs but keeps UUIDs, plain words and paths', () => {
  assert.equal(redact('id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'), 'id [redacted]');
  assert.equal(redact('2f260b27-e634-4c15-a617-2cc3a83338fb'), '2f260b27-e634-4c15-a617-2cc3a83338fb');
  const hook = '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start';
  assert.equal(redact(hook), hook);
  const path = 'C:/Users/someone/.claude/plugins/cache/superpowers-dev/superpowers/6.3.0/hooks';
  assert.equal(redact(path), path);
});

test('redact treats null and undefined as empty', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(undefined), '');
});

test('redactLine keeps only the first line and caps the length', () => {
  assert.equal(redactLine('first sk-ant-FAKE0000000000000000\nsecond'), 'first [redacted]');
  const long = redactLine('x'.repeat(500));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('...'));
});

test('redactDeep redacts every string in nested data, keys included', () => {
  assert.deepEqual(
    redactDeep({ a: ['sk-ant-FAKE0000000000000000', 3], b: { c: 'ok' }, 'sk-ant-FAKE0000000000000000': 1 }),
    { a: ['[redacted]', 3], b: { c: 'ok' }, '[redacted]': 1 },
  );
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. `Cannot find module ... src/redact.js`.

- [ ] **Step 5: Write `src/redact.js`**

```js
// Blanks out anything that looks like a credential before silentfail prints it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RULES = [
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]'],
  [/([A-Za-z0-9_]*(?:token|key|secret|password))=[^\s&"']+/gi, '$1=[redacted]'],
];

// Long runs of token-ish characters. UUIDs (connector names) and runs without
// both a letter and a digit (plain words, path pieces) are left alone.
const LONG_RUN = /[A-Za-z0-9_-]{32,}/g;

export function redact(text) {
  if (text === null || text === undefined) return '';
  let out = String(text);
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out.replace(LONG_RUN, run =>
    UUID.test(run) || !/\d/.test(run) || !/[A-Za-z]/.test(run) ? run : '[redacted]',
  );
}

export function redactLine(text, max = 120) {
  const first = redact(text).split(/\r?\n/, 1)[0];
  return first.length > max ? `${first.slice(0, max - 3)}...` : first;
}

export function redactDeep(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k), redactDeep(v)]));
  }
  return value;
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json LICENSE src/redact.js test/redact.test.js
git commit -m "feat: scaffold package and add credential redaction" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Config paths and the streaming log reader

**Files:**
- Create: `src/sources/paths.js`, `src/sources/logs.js`
- Test: `test/paths.test.js`, `test/logs.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `configDir(env = process.env): string`
  - `globalConfigFile(env = process.env): string`
  - `findLogFiles(projectsDir: string, { days: number, now?: number }): Promise<string[]>`. The result is sorted, and a missing folder gives `[]`.
  - `readEntries(file: string, stats: { badLines: number }): AsyncGenerator<{ entry: object, file: string, line: number }>`. It increments `stats.badLines` for each unparseable or non-object line, and throws if the file can't be opened.

- [ ] **Step 1: Write the failing tests in `test/paths.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configDir, globalConfigFile } from '../src/sources/paths.js';

test('configDir honors CLAUDE_CONFIG_DIR', () => {
  assert.equal(configDir({ CLAUDE_CONFIG_DIR: join('x', 'y') }), join('x', 'y'));
});

test('configDir defaults to ~/.claude', () => {
  assert.equal(configDir({}), join(homedir(), '.claude'));
});

test('globalConfigFile sits inside CLAUDE_CONFIG_DIR when it is set', () => {
  assert.equal(globalConfigFile({ CLAUDE_CONFIG_DIR: join('x', 'y') }), join('x', 'y', '.claude.json'));
});

test('globalConfigFile defaults to ~/.claude.json', () => {
  assert.equal(globalConfigFile({}), join(homedir(), '.claude.json'));
});
```

- [ ] **Step 2: Write the failing tests in `test/logs.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLogFiles, readEntries } from '../src/sources/logs.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'silentfail-logs-'));

test('findLogFiles returns recent .jsonl files from nested folders, sorted', async () => {
  const dir = tempDir();
  try {
    mkdirSync(join(dir, 'proj-a', 'sess', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'proj-a', 'one.jsonl'), '');
    writeFileSync(join(dir, 'proj-a', 'sess', 'subagents', 'two.jsonl'), '');
    writeFileSync(join(dir, 'proj-a', 'notes.txt'), '');
    const old = join(dir, 'proj-a', 'old.jsonl');
    writeFileSync(old, '');
    const tenDaysAgo = (Date.now() - 10 * 86_400_000) / 1000;
    utimesSync(old, tenDaysAgo, tenDaysAgo);
    assert.deepEqual(await findLogFiles(dir, { days: 7 }), [
      join(dir, 'proj-a', 'one.jsonl'),
      join(dir, 'proj-a', 'sess', 'subagents', 'two.jsonl'),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findLogFiles returns [] when the folder does not exist', async () => {
  assert.deepEqual(await findLogFiles(join(tmpdir(), `silentfail-missing-${Date.now()}`), { days: 7 }), []);
});

test('readEntries yields objects, skips blank lines and counts bad lines', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 's.jsonl');
    writeFileSync(file, ['{"type":"user","n":1}', '', 'not json', '[1,2]', 'null', '{"type":"assistant","n":2}\r', '{"trunc'].join('\n'));
    const stats = { badLines: 0 };
    const got = [];
    for await (const item of readEntries(file, stats)) got.push(item);
    assert.deepEqual(got.map(g => g.entry.n), [1, 2]);
    assert.deepEqual(got.map(g => g.line), [1, 6]);
    assert.equal(got[0].file, file);
    assert.equal(stats.badLines, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. `Cannot find module ... src/sources/paths.js` (and `logs.js`).

- [ ] **Step 4: Write `src/sources/paths.js`**

```js
import { homedir } from 'node:os';
import { join } from 'node:path';

// Where Claude Code keeps settings, plugins and session logs.
export function configDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

// The global state file that holds user- and local-scope MCP servers. It sits in
// the home folder normally, and inside CLAUDE_CONFIG_DIR when that is set.
export function globalConfigFile(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');
}
```

- [ ] **Step 5: Write `src/sources/logs.js`**

```js
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// Session logs (including subagent logs in subfolders) modified within the last `days` days.
export async function findLogFiles(projectsDir, { days, now = Date.now() }) {
  const cutoff = now - days * 86_400_000;
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl') && (await stat(p)).mtimeMs >= cutoff) found.push(p);
    }
  }
  await walk(projectsDir);
  return found.sort();
}

// Streams one log file line by line, so no file is ever held in memory whole.
// Lines that are not JSON objects are counted in stats.badLines and skipped.
export async function* readEntries(file, stats) {
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let line = 0;
  for await (const text of lines) {
    line++;
    if (!text.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(text);
    } catch {
      stats.badLines++;
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      stats.badLines++;
      continue;
    }
    yield { entry, file, line };
  }
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 15 tests in total.

- [ ] **Step 7: Commit**

```bash
git add src/sources/paths.js src/sources/logs.js test/paths.test.js test/logs.test.js
git commit -m "feat: find and stream Claude Code session logs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: MCP extractors

**Files:**
- Create: `src/extract/common.js`, `src/extract/mcpStatus.js`, `src/extract/mcpCalls.js`
- Test: `test/extract-mcp.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - **From `common.js`:**
    - `asArray(v): any[]`
    - `str(v): string | null`
    - `entryBase(entry): { sessionId, cwd, ts }`
    - `serverFromToolName(name): string | null`
    - `serverKey(name): string`. Replaces `:` with `_`.
  - **From `mcpStatus.js`:** `extractMcpStatus(entry): Fact[]`, where each fact is `{ kind: 'mcp-status', server /* key */, name /* raw */, state: 'failed'|'needs-auth'|'pending'|'connected', sessionId, cwd, ts }`.
  - **From `mcpCalls.js`:** `extractMcpCalls(entry, ctx: { toolNames: Map<string,string> }): Fact[]`. The facts are:
    - `{ kind: 'mcp-call', server, name, ok: boolean, sessionId, cwd, ts }`
    - `{ kind: 'orphan-result', sessionId, cwd, ts }`

- [ ] **Step 1: Write the failing tests in `test/extract-mcp.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverFromToolName, serverKey } from '../src/extract/common.js';
import { extractMcpCalls } from '../src/extract/mcpCalls.js';
import { extractMcpStatus } from '../src/extract/mcpStatus.js';

const base = { sessionId: 's1', cwd: '/w/p', timestamp: '2026-09-20T10:00:00.000Z' };

test('serverFromToolName reads the server out of mcp__server__tool', () => {
  assert.equal(serverFromToolName('mcp__filesystem__read_file'), 'filesystem');
  assert.equal(serverFromToolName('mcp__ccd_session_mgmt__set_title'), 'ccd_session_mgmt');
  assert.equal(serverFromToolName('Bash'), null);
  assert.equal(serverFromToolName('mcp__broken'), null);
  assert.equal(serverFromToolName(42), null);
});

test('serverKey makes plugin:x:y and plugin_x_y the same key', () => {
  assert.equal(serverKey('plugin:cloudflare:cloudflare'), 'plugin_cloudflare_cloudflare');
  assert.equal(serverKey('filesystem'), 'filesystem');
});

test('extractMcpStatus reports failed, needs-auth, pending and connected servers', () => {
  const facts = extractMcpStatus({
    ...base,
    type: 'attachment',
    attachment: {
      type: 'deferred_tools_delta',
      failedMcpServers: ['broken-one'],
      needsAuthMcpServers: ['plugin:cloudflare:cloudflare'],
      pendingMcpServers: [{ name: 'slowpoke' }],
      addedNames: ['mcp__filesystem__read_file', 'mcp__filesystem__write_file', 'Read'],
      readdedNames: ['mcp__memory__recall'],
    },
  });
  assert.deepEqual(facts.map(f => [f.server, f.name, f.state]), [
    ['broken-one', 'broken-one', 'failed'],
    ['plugin_cloudflare_cloudflare', 'plugin:cloudflare:cloudflare', 'needs-auth'],
    ['slowpoke', 'slowpoke', 'pending'],
    ['filesystem', 'filesystem', 'connected'],
    ['memory', 'memory', 'connected'],
  ]);
  assert.deepEqual(
    { sessionId: facts[0].sessionId, cwd: facts[0].cwd, ts: facts[0].ts },
    { sessionId: 's1', cwd: '/w/p', ts: '2026-09-20T10:00:00.000Z' },
  );
});

test('extractMcpStatus ignores other entries and junk list items', () => {
  assert.deepEqual(extractMcpStatus({ ...base, type: 'user' }), []);
  assert.deepEqual(
    extractMcpStatus({ ...base, type: 'attachment', attachment: { type: 'deferred_tools_delta', failedMcpServers: 'nope', needsAuthMcpServers: [null, 7] } }),
    [],
  );
});

test('extractMcpCalls pairs tool_use with tool_result and flags errors', () => {
  const ctx = { toolNames: new Map() };
  const fromUse = extractMcpCalls({
    ...base,
    type: 'assistant',
    message: { content: [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't1', name: 'mcp__filesystem__read_file', input: {} },
      { type: 'tool_use', id: 't2', name: 'Bash', input: {} },
    ] },
  }, ctx);
  assert.deepEqual(fromUse, []);
  const fromResult = extractMcpCalls({
    ...base,
    type: 'user',
    message: { content: [
      { type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'boom' },
      { type: 'tool_result', tool_use_id: 't2', content: 'ok' },
    ] },
  }, ctx);
  assert.deepEqual(fromResult.map(f => [f.kind, f.server, f.ok]), [['mcp-call', 'filesystem', false]]);
  assert.equal(ctx.toolNames.size, 0);
});

test('extractMcpCalls keeps sessions apart and reports orphan results', () => {
  const ctx = { toolNames: new Map() };
  extractMcpCalls({ ...base, sessionId: 'a', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__x__y' }] } }, ctx);
  const facts = extractMcpCalls({ ...base, sessionId: 'b', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }, ctx);
  assert.deepEqual(facts.map(f => f.kind), ['orphan-result']);
});

test('extractMcpCalls survives odd message shapes', () => {
  const ctx = { toolNames: new Map() };
  for (const entry of [{}, { message: 'text' }, { message: { content: 'text' } }, { message: { content: [null, 3, 'x', { type: 'tool_use' }] } }]) {
    assert.deepEqual(extractMcpCalls(entry, ctx), []);
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. `Cannot find module ... src/extract/common.js`.

- [ ] **Step 3: Write `src/extract/common.js`**

```js
// Shared helpers for turning raw log entries into facts.

export const asArray = v => (Array.isArray(v) ? v : []);
export const str = v => (typeof v === 'string' ? v : null);

export function entryBase(entry) {
  return { sessionId: str(entry.sessionId), cwd: str(entry.cwd), ts: str(entry.timestamp) };
}

// MCP tool names look like mcp__<server>__<tool>.
export function serverFromToolName(name) {
  if (typeof name !== 'string') return null;
  const match = /^mcp__(.+?)__./.exec(name);
  return match ? match[1] : null;
}

// Status lists spell plugin servers plugin:<plugin>:<server>, and tool names use
// underscores. One key covers both spellings.
export function serverKey(name) {
  return String(name).replace(/:/g, '_');
}
```

- [ ] **Step 4: Write `src/extract/mcpStatus.js`**

```js
import { asArray, entryBase, serverFromToolName, serverKey, str } from './common.js';

const STATUS_LISTS = [
  ['failedMcpServers', 'failed'],
  ['needsAuthMcpServers', 'needs-auth'],
  ['pendingMcpServers', 'pending'],
];

// deferred_tools_delta attachments say which MCP servers failed, need auth, are
// still pending, or delivered tools (connected).
export function extractMcpStatus(entry) {
  const a = entry.attachment;
  if (!a || a.type !== 'deferred_tools_delta') return [];
  const base = entryBase(entry);
  const facts = [];
  for (const [field, state] of STATUS_LISTS) {
    for (const item of asArray(a[field])) {
      const name = str(item) ?? str(item?.name) ?? str(item?.server);
      if (name) facts.push({ kind: 'mcp-status', server: serverKey(name), name, state, ...base });
    }
  }
  const connected = new Map();
  for (const tool of [...asArray(a.addedNames), ...asArray(a.readdedNames)]) {
    const name = serverFromToolName(tool);
    if (name) connected.set(serverKey(name), name);
  }
  for (const [server, name] of connected) facts.push({ kind: 'mcp-status', server, name, state: 'connected', ...base });
  return facts;
}
```

- [ ] **Step 5: Write `src/extract/mcpCalls.js`**

```js
import { entryBase, serverFromToolName, serverKey } from './common.js';

// Pairs each tool_use with its tool_result (per session) and reports MCP calls and
// whether they failed. ctx.toolNames carries pending calls between entries.
export function extractMcpCalls(entry, ctx) {
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  const base = entryBase(entry);
  const facts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      ctx.toolNames.set(`${base.sessionId}:${block.id}`, block.name);
    } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      const key = `${base.sessionId}:${block.tool_use_id}`;
      const toolName = ctx.toolNames.get(key);
      if (toolName === undefined) {
        facts.push({ kind: 'orphan-result', ...base });
        continue;
      }
      ctx.toolNames.delete(key);
      const name = serverFromToolName(toolName);
      if (name) facts.push({ kind: 'mcp-call', server: serverKey(name), name, ok: block.is_error !== true, ...base });
    }
  }
  return facts;
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 22 tests in total.

- [ ] **Step 7: Commit**

```bash
git add src/extract/common.js src/extract/mcpStatus.js src/extract/mcpCalls.js test/extract-mcp.test.js
git commit -m "feat: extract MCP connection status and call results from logs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hook extractor and the extraction pipeline

**Files:**
- Create: `src/extract/hookRuns.js`, `src/extract/shapes.js`, `src/extract/index.js`
- Test: `test/extract-hooks.test.js`

**Interfaces:**
- Consumes: `asArray`, `str` and `entryBase` from `src/extract/common.js`, plus `extractMcpStatus` and `extractMcpCalls` (all from Task 3).
- Produces:
  - `extractHookRuns(entry): Fact[]`, where each fact is `{ kind: 'hook-run', event, command, exitCode, durationMs, stderr, problemType, sessionId, cwd, ts }`. `stderr` is only kept on failed runs.
  - `KNOWN_SHAPES: Set<string>`
  - `shapeOf(entry): string`
  - `compareVersions(a, b): number`
  - `createExtractor(): { extract(entry): Fact[], state }`, where `state` is `{ sessions: Set, cwds: Set, unrecognized: Map<string, number>, versions: { min, max } }`.

- [ ] **Step 1: Write the failing tests in `test/extract-hooks.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHookRuns } from '../src/extract/hookRuns.js';
import { compareVersions, createExtractor } from '../src/extract/index.js';
import { shapeOf } from '../src/extract/shapes.js';

const base = { sessionId: 's1', cwd: '/w/p', timestamp: '2026-09-20T10:00:00.000Z' };

test('hook_success becomes a clean hook-run without stderr', () => {
  const [fact] = extractHookRuns({
    ...base,
    type: 'attachment',
    attachment: { type: 'hook_success', hookEvent: 'SessionStart', hookName: 'SessionStart:startup', command: '"x" start', exitCode: 0, durationMs: 120, stdout: 'CANARY_DO_NOT_PRINT', stderr: 'noise' },
  });
  assert.deepEqual(fact, {
    kind: 'hook-run', event: 'SessionStart', command: '"x" start', exitCode: 0, durationMs: 120,
    stderr: null, problemType: null, sessionId: 's1', cwd: '/w/p', ts: '2026-09-20T10:00:00.000Z',
  });
});

test('a non-zero exit keeps stderr', () => {
  const [fact] = extractHookRuns({ ...base, type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'SessionStart', command: 'x', exitCode: 1, stderr: 'bad thing' } });
  assert.equal(fact.exitCode, 1);
  assert.equal(fact.stderr, 'bad thing');
  assert.equal(fact.problemType, null);
});

test('other hook_* attachments are problems', () => {
  const [fact] = extractHookRuns({ ...base, type: 'attachment', attachment: { type: 'hook_non_blocking_error', hookEvent: 'PreToolUse', command: 'x', stderr: 'oops' } });
  assert.equal(fact.problemType, 'hook_non_blocking_error');
  assert.equal(fact.stderr, 'oops');
  assert.equal(fact.event, 'PreToolUse');
});

test('hook_additional_context says nothing about success', () => {
  assert.deepEqual(extractHookRuns({ ...base, type: 'attachment', attachment: { type: 'hook_additional_context', hookEvent: 'SessionStart' } }), []);
});

test('stop_hook_summary lists each Stop hook and each error', () => {
  const facts = extractHookRuns({
    ...base,
    type: 'system',
    subtype: 'stop_hook_summary',
    hookCount: 2,
    hookInfos: [{ command: 'a' }, { command: 'b' }],
    hookErrors: ['b exploded', { command: 'b', error: 'again' }],
  });
  assert.deepEqual(facts.map(f => [f.event, f.command, f.problemType, f.stderr]), [
    ['Stop', 'a', null, null],
    ['Stop', 'b', null, null],
    ['Stop', null, 'stop_hook_error', 'b exploded'],
    ['Stop', 'b', 'stop_hook_error', 'again'],
  ]);
});

test('shapeOf joins type, subtype and attachment type', () => {
  assert.equal(shapeOf({ type: 'attachment', attachment: { type: 'hook_success' } }), 'attachment/hook_success');
  assert.equal(shapeOf({ type: 'system', subtype: 'stop_hook_summary' }), 'system/stop_hook_summary');
  assert.equal(shapeOf({}), '(no type)');
  assert.equal(shapeOf({ type: 5 }), '(no type)');
});

test('compareVersions compares numerically', () => {
  assert.ok(compareVersions('2.1.281', '2.1.39') > 0);
  assert.equal(compareVersions('9.9.9', '9.9.9'), 0);
});

test('createExtractor tracks sessions, cwds, versions and unrecognized shapes', () => {
  const { extract, state } = createExtractor();
  extract({ type: 'user', sessionId: 'a', cwd: '/p', version: '2.1.229' });
  extract({ type: 'assistant', sessionId: 'b', cwd: '/q', version: '2.1.281-beta' });
  extract({ type: 'brand-new-thing', sessionId: 'b' });
  extract({ type: 'attachment', attachment: { type: 'hook_mystery_error', hookEvent: 'Stop' }, sessionId: 'b' });
  assert.deepEqual([...state.sessions], ['a', 'b']);
  assert.deepEqual([...state.cwds], ['/p', '/q']);
  assert.deepEqual(state.versions, { min: '2.1.229', max: '2.1.281' });
  assert.deepEqual([...state.unrecognized], [['brand-new-thing', 1]]);
});

test('createExtractor pairs calls across entries', () => {
  const { extract } = createExtractor();
  extract({ type: 'assistant', sessionId: 'a', message: { content: [{ type: 'tool_use', id: 't', name: 'mcp__fs__read' }] } });
  const facts = extract({ type: 'user', sessionId: 'a', message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: true }] } });
  assert.deepEqual(facts.map(f => [f.kind, f.server, f.ok]), [['mcp-call', 'fs', false]]);
});

test('createExtractor counts entries that make an extractor throw instead of crashing', () => {
  const { extract, state } = createExtractor();
  const evil = { type: 'user' };
  Object.defineProperty(evil, 'message', { get() { throw new Error('boom'); } });
  assert.deepEqual(extract(evil), []);
  assert.deepEqual([...state.unrecognized], [['user (extractor error)', 1]]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. `Cannot find module ... src/extract/hookRuns.js`.

- [ ] **Step 3: Write `src/extract/hookRuns.js`**

```js
import { asArray, entryBase, str } from './common.js';

// Hook runs show up as hook_* attachments (SessionStart and friends) and as
// stop_hook_summary system entries.
export function extractHookRuns(entry) {
  const a = entry.attachment;
  if (a && typeof a.type === 'string' && a.type.startsWith('hook_')) {
    if (a.type === 'hook_additional_context') return [];
    const problem = a.type !== 'hook_success';
    const exitCode = Number.isInteger(a.exitCode) ? a.exitCode : null;
    const failed = problem || (exitCode !== null && exitCode !== 0);
    return [hookRun(entry, {
      event: str(a.hookEvent),
      command: str(a.command),
      exitCode,
      durationMs: Number.isFinite(a.durationMs) ? a.durationMs : null,
      // stderr is kept only when something went wrong, which keeps memory small on big log sets.
      stderr: failed ? str(a.stderr) : null,
      problemType: problem ? a.type : null,
    })];
  }
  if (entry.type === 'system' && entry.subtype === 'stop_hook_summary') {
    const facts = asArray(entry.hookInfos).map(info => hookRun(entry, { event: 'Stop', command: str(info?.command) }));
    for (const err of asArray(entry.hookErrors)) {
      facts.push(hookRun(entry, {
        event: 'Stop',
        command: str(err?.command),
        stderr: str(err) ?? str(err?.error) ?? str(err?.message) ?? str(err?.stderr),
        problemType: 'stop_hook_error',
      }));
    }
    return facts;
  }
  return [];
}

function hookRun(entry, fields) {
  return {
    kind: 'hook-run', event: null, command: null, exitCode: null, durationMs: null, stderr: null, problemType: null,
    ...entryBase(entry),
    ...fields,
  };
}
```

Note: the expected object in the first test lists keys in the order `kind, event, command, exitCode, durationMs, stderr, problemType, sessionId, cwd, ts`. `deepEqual` ignores key order, so this is fine.

- [ ] **Step 4: Write `src/extract/shapes.js`**

```js
// Entry shapes seen in real logs (Claude Code 2.1.170 to 2.1.281). Anything else
// that no extractor turns into a fact is counted as "not recognized", so a format
// change shows up in the report instead of vanishing.
export const KNOWN_SHAPES = new Set([
  'assistant', 'user', 'summary', 'last-prompt', 'custom-title', 'ai-title', 'atis-latch',
  'queue-operation', 'mode', 'bridge-session', 'agent-name', 'file-history-delta',
  'file-history-snapshot', 'cost-state',
  'system/stop_hook_summary', 'system/local_command', 'system/compact_boundary',
  'attachment/total_tokens_reminder', 'attachment/edited_text_file', 'attachment/deferred_tools_delta',
  'attachment/skill_listing', 'attachment/task_reminder', 'attachment/agent_listing_delta',
  'attachment/mcp_instructions_delta', 'attachment/deferred_tools_record',
  'attachment/hook_additional_context', 'attachment/hook_success', 'attachment/auto_mode',
  'attachment/silent_turn_reminder', 'attachment/prompt_snapshot', 'attachment/command_permissions',
  'attachment/queued_command', 'attachment/date', 'attachment/instructions', 'attachment/environment',
  'attachment/model', 'attachment/file', 'attachment/session_context', 'attachment/remote_session_change',
  'attachment/compact_file_reference', 'attachment/thinking_drop',
]);

export function shapeOf(entry) {
  const parts = [entry.type, entry.subtype, entry.attachment?.type].filter(p => typeof p === 'string' && p !== '');
  return parts.length > 0 ? parts.join('/') : '(no type)';
}
```

- [ ] **Step 5: Write `src/extract/index.js`**

```js
import { extractHookRuns } from './hookRuns.js';
import { extractMcpCalls } from './mcpCalls.js';
import { extractMcpStatus } from './mcpStatus.js';
import { KNOWN_SHAPES, shapeOf } from './shapes.js';

const EXTRACTORS = [extractMcpStatus, extractMcpCalls, extractHookRuns];

// Repeated strings in facts share one copy, which keeps memory flat on huge log sets.
const INTERNED_FIELDS = ['sessionId', 'cwd', 'server', 'name', 'event', 'command'];

// Runs every extractor over a stream of log entries and keeps run-wide counters.
export function createExtractor() {
  const ctx = { toolNames: new Map() };
  const pool = new Map();
  const state = { sessions: new Set(), cwds: new Set(), unrecognized: new Map(), versions: { min: null, max: null } };

  const intern = s => {
    if (typeof s !== 'string') return s;
    const hit = pool.get(s);
    if (hit !== undefined) return hit;
    pool.set(s, s);
    return s;
  };

  function extract(entry) {
    if (typeof entry.sessionId === 'string') state.sessions.add(entry.sessionId);
    if (typeof entry.cwd === 'string') state.cwds.add(entry.cwd);
    noteVersion(state.versions, entry.version);
    const facts = [];
    let crashed = false;
    for (const fn of EXTRACTORS) {
      try {
        facts.push(...fn(entry, ctx));
      } catch {
        crashed = true;
      }
    }
    const shape = shapeOf(entry);
    if (crashed) bump(state.unrecognized, `${shape} (extractor error)`);
    else if (facts.length === 0 && !KNOWN_SHAPES.has(shape)) bump(state.unrecognized, shape);
    for (const fact of facts) {
      for (const field of INTERNED_FIELDS) if (field in fact) fact[field] = intern(fact[field]);
    }
    return facts;
  }

  return { extract, state };
}

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// Keeps only the numeric x.y.z prefix, so odd suffixes never reach the report.
function noteVersion(versions, raw) {
  const match = typeof raw === 'string' ? /^\d+\.\d+\.\d+/.exec(raw) : null;
  if (!match) return;
  const v = match[0];
  if (versions.min === null || compareVersions(v, versions.min) < 0) versions.min = v;
  if (versions.max === null || compareVersions(v, versions.max) > 0) versions.max = v;
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 32 tests in total.

- [ ] **Step 7: Commit**

```bash
git add src/extract/hookRuns.js src/extract/shapes.js src/extract/index.js test/extract-hooks.test.js
git commit -m "feat: extract hook runs and count unrecognized log shapes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Config loader

**Files:**
- Create: `src/sources/config.js`, `test/helpers/fakeHome.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: `configDir` and `globalConfigFile` (Task 2), and `serverKey` (Task 3).
- Produces:
  - `loadConfig({ env?, projectPaths?: string[] }): Promise<Config>`, where `Config` has:
    - `mcpServers: [{ key, label, scope: 'user'|'local'|'project'|'plugin', project: string|null, source }]`
    - `hooks: [{ event, matcher, type, command /* trimmed, or null */, scope: 'user'|'project'|'local'|'plugin', project, source, plugin /* plugin name, or null */ }]`
    - `plugins: [{ id, name, installPath }]`
    - `warnings: string[]`
  - `makeFakeHome(): { dir, projectDir, write(pathOrRel, content), writeLog(relUnderProjects, text), env, cleanup() }`
  - `readFixture(name): string`

- [ ] **Step 1: Write `test/helpers/fakeHome.js`**

```js
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

// A throwaway Claude config folder. `write` takes a path relative to it (or an
// absolute path) and a string or an object (written as JSON). `writeLog` puts a
// session log under projects/ and swaps __PROJECT__ for the fake project folder.
export function makeFakeHome() {
  const dir = mkdtempSync(join(tmpdir(), 'silentfail-'));
  const projectDir = join(dir, 'work', 'proj');
  mkdirSync(projectDir, { recursive: true });
  const write = (path, content) => {
    const target = isAbsolute(path) ? path : join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return target;
  };
  const writeLog = (rel, text) => write(join('projects', rel), text.replaceAll('__PROJECT__', JSON.stringify(projectDir).slice(1, -1)));
  return {
    dir,
    projectDir,
    write,
    writeLog,
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, NO_COLOR: '1' },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function readFixture(name) {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}
```

- [ ] **Step 2: Write the failing tests in `test/config.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadConfig } from '../src/sources/config.js';
import { makeFakeHome } from './helpers/fakeHome.js';

test('collects MCP servers from user, local, project and plugin scopes', async () => {
  const home = makeFakeHome();
  try {
    home.write('.claude.json', { mcpServers: { memory: {} }, projects: { [home.projectDir]: { mcpServers: { localone: {} } } } });
    home.write(join(home.projectDir, '.mcp.json'), { mcpServers: { filesystem: {} } });
    const pluginDir = join(home.dir, 'plugins', 'cache', 'cloudflare');
    home.write(join('plugins', 'installed_plugins.json'), { version: 2, plugins: { 'cloudflare@mk': [{ scope: 'user', installPath: pluginDir }] } });
    home.write(join(pluginDir, '.mcp.json'), { mcpServers: { cloudflare: {} } });
    home.write(join(pluginDir, '.claude-plugin', 'plugin.json'), { name: 'cloudflare', mcpServers: './.mcp.json' });
    home.write('settings.json', { enabledPlugins: { 'cloudflare@mk': true } });
    const cfg = await loadConfig({ env: home.env, projectPaths: [home.projectDir] });
    assert.deepEqual(cfg.mcpServers.map(s => [s.key, s.label, s.scope]), [
      ['memory', 'memory', 'user'],
      ['localone', 'localone', 'local'],
      ['filesystem', 'filesystem', 'project'],
      ['plugin_cloudflare_cloudflare', 'plugin:cloudflare:cloudflare', 'plugin'],
    ]);
    assert.equal(cfg.mcpServers[2].project, home.projectDir);
    assert.deepEqual(cfg.warnings, []);
  } finally {
    home.cleanup();
  }
});

test('collects hooks from user settings, project settings and enabled plugins', async () => {
  const home = makeFakeHome();
  try {
    home.write('settings.json', {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '  lint.sh  ' }] }] },
      enabledPlugins: { 'sp@mk': true, 'off@mk': false },
    });
    home.write(join(home.projectDir, '.claude', 'settings.local.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify' }] }] } });
    const spDir = join(home.dir, 'plugins', 'cache', 'sp');
    home.write(join('plugins', 'installed_plugins.json'), { plugins: { 'sp@mk': [{ installPath: spDir }], 'off@mk': [{ installPath: join(home.dir, 'x') }] } });
    home.write(join(spDir, 'hooks', 'hooks.json'), { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/run" start' }] }] } });
    const cfg = await loadConfig({ env: home.env, projectPaths: [home.projectDir] });
    assert.deepEqual(cfg.hooks.map(h => [h.event, h.matcher, h.command, h.scope, h.plugin]), [
      ['PreToolUse', 'Bash', 'lint.sh', 'user', null],
      ['Stop', null, 'notify', 'local', null],
      ['SessionStart', 'startup', '"${CLAUDE_PLUGIN_ROOT}/run" start', 'plugin', 'sp'],
    ]);
    assert.deepEqual(cfg.plugins.map(p => p.id), ['sp@mk']);
  } finally {
    home.cleanup();
  }
});

test('broken files become warnings; missing files are silent', async () => {
  const home = makeFakeHome();
  try {
    home.write('settings.json', '{ not json');
    const cfg = await loadConfig({ env: home.env, projectPaths: [join(home.dir, 'does-not-exist')] });
    assert.equal(cfg.warnings.length, 1);
    assert.match(cfg.warnings[0], /could not parse .*settings\.json/);
    assert.deepEqual(cfg.mcpServers, []);
  } finally {
    home.cleanup();
  }
});

test('an enabled plugin that is not installed is a warning', async () => {
  const home = makeFakeHome();
  try {
    home.write('settings.json', { enabledPlugins: { 'ghost@mk': true } });
    const cfg = await loadConfig({ env: home.env });
    assert.deepEqual(cfg.warnings, ['plugin ghost@mk is enabled but not installed']);
  } finally {
    home.cleanup();
  }
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. `Cannot find module ... src/sources/config.js`.

- [ ] **Step 4: Write `src/sources/config.js`**

```js
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serverKey } from '../extract/common.js';
import { configDir, globalConfigFile } from './paths.js';

// Reads JSON. A missing file returns null quietly; an unreadable or broken one adds a warning.
async function readJson(file, warnings) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') warnings.push(`could not read ${file} (${err.code ?? err.message})`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    warnings.push(`could not parse ${file}`);
    return null;
  }
}

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = v => (Array.isArray(v) ? v : []);
// hooks.json wraps events in a "hooks" key; inline plugin.json hooks may not.
const unwrapHooks = v => ('hooks' in obj(v) ? obj(v).hooks : v);

// Collects configured MCP servers, hooks and enabled plugins from every place Claude Code keeps them.
export async function loadConfig({ env = process.env, projectPaths = [] } = {}) {
  const warnings = [];
  const mcpServers = [];
  const hooks = [];
  const plugins = [];
  const enabled = new Set();

  const addServers = (servers, scope, project, source, plugin = null) => {
    for (const name of Object.keys(obj(servers))) {
      const label = plugin ? `plugin:${plugin}:${name}` : name;
      if (plugin && mcpServers.some(s => s.label === label)) continue;
      mcpServers.push({ key: serverKey(label), label, scope, project, source });
    }
  };
  const addHooks = (config, scope, project, source, plugin = null) => {
    for (const [event, groups] of Object.entries(obj(config))) {
      for (const group of list(groups)) {
        for (const h of list(group?.hooks)) {
          hooks.push({
            event,
            matcher: typeof group.matcher === 'string' ? group.matcher : null,
            type: typeof h?.type === 'string' ? h.type : null,
            command: typeof h?.command === 'string' ? h.command.trim() : null,
            scope,
            project,
            source,
            plugin,
          });
        }
      }
    }
  };
  const noteEnabled = settings => {
    for (const [id, on] of Object.entries(obj(settings.enabledPlugins))) {
      if (on === true) enabled.add(id);
      else if (on === false) enabled.delete(id);
    }
  };

  const globalFile = globalConfigFile(env);
  const global = obj(await readJson(globalFile, warnings));
  addServers(global.mcpServers, 'user', null, globalFile);
  for (const [project, entry] of Object.entries(obj(global.projects))) {
    addServers(obj(entry).mcpServers, 'local', project, globalFile);
  }

  const dir = configDir(env);
  const userSettingsFile = join(dir, 'settings.json');
  const userSettings = obj(await readJson(userSettingsFile, warnings));
  addHooks(userSettings.hooks, 'user', null, userSettingsFile);
  noteEnabled(userSettings);

  for (const project of new Set(projectPaths)) {
    const mcpFile = join(project, '.mcp.json');
    addServers(obj(await readJson(mcpFile, warnings)).mcpServers, 'project', project, mcpFile);
    for (const [name, scope] of [['settings.json', 'project'], ['settings.local.json', 'local']]) {
      const file = join(project, '.claude', name);
      const settings = obj(await readJson(file, warnings));
      addHooks(settings.hooks, scope, project, file);
      noteEnabled(settings);
    }
  }

  const installed = obj(obj(await readJson(join(dir, 'plugins', 'installed_plugins.json'), warnings)).plugins);
  for (const id of enabled) {
    const records = Array.isArray(installed[id]) ? installed[id] : [installed[id]];
    const installPath = records.map(r => r?.installPath).filter(p => typeof p === 'string').at(-1);
    if (!installPath) {
      warnings.push(`plugin ${id} is enabled but not installed`);
      continue;
    }
    const name = id.split('@')[0];
    plugins.push({ id, name, installPath });
    const manifestFile = join(installPath, '.claude-plugin', 'plugin.json');
    const manifest = obj(await readJson(manifestFile, warnings));

    const serverFiles = new Set([join(installPath, '.mcp.json')]);
    if (typeof manifest.mcpServers === 'string') serverFiles.add(resolve(installPath, manifest.mcpServers));
    for (const file of serverFiles) addServers(obj(await readJson(file, warnings)).mcpServers, 'plugin', null, file, name);
    if (typeof manifest.mcpServers === 'object') addServers(manifest.mcpServers, 'plugin', null, manifestFile, name);

    const hookFiles = new Set([join(installPath, 'hooks', 'hooks.json')]);
    if (typeof manifest.hooks === 'string') hookFiles.add(resolve(installPath, manifest.hooks));
    for (const file of hookFiles) addHooks(unwrapHooks(await readJson(file, warnings)), 'plugin', null, file, name);
    if (typeof manifest.hooks === 'object') addHooks(unwrapHooks(manifest.hooks), 'plugin', null, manifestFile, name);
  }

  return { mcpServers, hooks, plugins, warnings };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 36 tests in total.

- [ ] **Step 6: Commit**

```bash
git add src/sources/config.js test/helpers/fakeHome.js test/config.test.js
git commit -m "feat: load configured MCP servers, hooks and plugins" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: MCP analyzer

**Files:**
- Create: `src/format.js`, `src/analyze/common.js`, `src/analyze/mcp.js`
- Test: `test/analyze-mcp.test.js`

**Interfaces:**
- Consumes: `mcp-status` and `mcp-call` facts (Task 3) and `Config` (Task 5).
- Produces:
  - **From `format.js`:** `plural(n, word): string`
  - **From `analyze/common.js`:**
    - `finding(id, severity, subject, message, evidence = {}): Finding`
    - `later(a, b): string | null`
    - `isInside(child, parent): boolean`
    - `ranInProject(cwds: Set<string>, project: string): boolean`
  - **From `analyze/mcp.js`:** `analyzeMcp(facts, config, { cwds }): Finding[]`
  - **`Finding` type:** `{ id, severity: 'broken'|'warning'|'unknown'|'ok', subject: string, message: string, evidence: object }`

- [ ] **Step 1: Write the failing tests in `test/analyze-mcp.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInside, later } from '../src/analyze/common.js';
import { analyzeMcp } from '../src/analyze/mcp.js';
import { plural } from '../src/format.js';

const call = (server, ok, sessionId = 's1', ts = '2026-09-20T10:00:00.000Z') => ({ kind: 'mcp-call', server, name: server, ok, sessionId, cwd: '/w/p', ts });
const status = (server, state, sessionId = 's1', name = server) => ({ kind: 'mcp-status', server, name, state, sessionId, cwd: '/w/p', ts: '2026-09-20T10:00:00.000Z' });
const noConfig = { mcpServers: [], hooks: [] };
const ctx = { cwds: new Set(['/w/p']) };
const pick = findings => findings.map(f => [f.id, f.severity, f.subject, f.message]);

test('plural, later and isInside basics', () => {
  assert.equal(plural(1, 'call'), '1 call');
  assert.equal(plural(2, 'call'), '2 calls');
  assert.equal(later(null, '2026-01-02'), '2026-01-02');
  assert.equal(later('2026-01-03', '2026-01-02'), '2026-01-03');
  assert.ok(isInside('/w/p/sub', '/w/p'));
  assert.ok(isInside('/w/p', '/w/p'));
  assert.ok(!isInside('/w/pp', '/w/p'));
});

test('2 of 2 failed calls is broken, with the last error time', () => {
  const findings = analyzeMcp([call('filesystem', false), call('filesystem', false, 's1', '2026-09-23T08:00:00.000Z')], noConfig, ctx);
  assert.deepEqual(pick(findings), [['mcp-call-errors', 'broken', 'MCP filesystem', '2 of 2 calls failed']]);
  assert.equal(findings[0].evidence.lastError, '2026-09-23T08:00:00.000Z');
});

test('call error thresholds: 1 of 1 warns, 1 of 5 warns, 1 of 10 is fine', () => {
  const severities = facts => analyzeMcp(facts, noConfig, ctx).map(f => f.severity);
  assert.deepEqual(severities([call('a', false)]), ['warning']);
  assert.deepEqual(severities([call('a', false), ...Array(4).fill(call('a', true))]), ['warning']);
  assert.deepEqual(severities([call('a', false), ...Array(9).fill(call('a', true))]), ['ok']);
});

test('connection problems are counted per session', () => {
  const facts = [
    status('broken', 'failed', 's1'), status('broken', 'failed', 's2'),
    status('cf', 'needs-auth', 's1', 'plugin:cf:cf'), status('cf', 'needs-auth', 's2', 'plugin:cf:cf'), status('cf', 'connected', 's2', 'plugin:cf:cf'),
    status('slow', 'pending', 's1'),
    status('slow2', 'pending', 's1'), status('slow2', 'connected', 's1'),
  ];
  assert.deepEqual(pick(analyzeMcp(facts, noConfig, ctx)), [
    ['mcp-failed-connect', 'broken', 'MCP broken', 'failed to connect in 2 of 2 sessions'],
    ['mcp-needs-auth', 'warning', 'MCP plugin:cf:cf', 'needs auth in 1 of 2 sessions'],
    ['mcp-stuck-pending', 'warning', 'MCP slow', 'never finished connecting in 1 of 1 session'],
    ['mcp-ok', 'ok', 'MCP slow2', 'connected in 1 of 1 session'],
  ]);
});

test('configured labels win over names from the logs', () => {
  const cfg = { hooks: [], mcpServers: [{ key: 'plugin_cf_cf', label: 'plugin:cf:cf', scope: 'plugin', project: null, source: 'x' }] };
  const [f] = analyzeMcp([call('plugin_cf_cf', true)], cfg, ctx);
  assert.equal(f.subject, 'MCP plugin:cf:cf');
});

test('configured servers that never show up are flagged, but only where a session ran', () => {
  const cfg = { hooks: [], mcpServers: [
    { key: 'ghost', label: 'ghost', scope: 'user', project: null, source: '.claude.json' },
    { key: 'here', label: 'here', scope: 'project', project: '/w/p', source: '/w/p/.mcp.json' },
    { key: 'elsewhere', label: 'elsewhere', scope: 'project', project: '/other', source: '/other/.mcp.json' },
    { key: 'seen', label: 'seen', scope: 'user', project: null, source: '.claude.json' },
  ] };
  assert.deepEqual(pick(analyzeMcp([call('seen', true)], cfg, ctx)), [
    ['mcp-ok', 'ok', 'MCP seen', '1 call, 0 failed'],
    ['mcp-never-seen', 'warning', 'MCP ghost', 'configured (user scope) but never showed up in the logs'],
    ['mcp-never-seen', 'warning', 'MCP here', 'configured (project scope) but never showed up in the logs'],
  ]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. `Cannot find module ... src/analyze/common.js`.

- [ ] **Step 3: Write `src/format.js`**

```js
// "1 call", "2 calls".
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
```

- [ ] **Step 4: Write `src/analyze/common.js`**

```js
import { resolve, sep } from 'node:path';

export function finding(id, severity, subject, message, evidence = {}) {
  return { id, severity, subject, message, evidence };
}

// The later of two ISO timestamps; either may be null.
export function later(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return b > a ? b : a;
}

// True when `child` is `parent` or sits somewhere under it.
export function isInside(child, parent) {
  const norm = p => {
    const r = resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

// Project-scoped config only counts when some session actually ran in that project.
export function ranInProject(cwds, project) {
  for (const cwd of cwds) if (isInside(cwd, project)) return true;
  return false;
}
```

- [ ] **Step 5: Write `src/analyze/mcp.js`**

```js
import { plural } from '../format.js';
import { finding, later, ranInProject } from './common.js';

export function analyzeMcp(facts, config, { cwds }) {
  const servers = new Map();
  const get = (key, name) => {
    let s = servers.get(key);
    if (!s) {
      s = { label: name, sessions: new Set(), failed: new Set(), needsAuth: new Set(), pending: new Set(), connected: new Set(), calls: 0, errors: 0, lastError: null };
      servers.set(key, s);
    }
    return s;
  };

  for (const f of facts) {
    if (f.kind === 'mcp-status') {
      const s = get(f.server, f.name);
      const sid = f.sessionId ?? '(no session)';
      s.sessions.add(sid);
      if (f.state === 'failed') s.failed.add(sid);
      else if (f.state === 'needs-auth') s.needsAuth.add(sid);
      else if (f.state === 'pending') s.pending.add(sid);
      else if (f.state === 'connected') s.connected.add(sid);
    } else if (f.kind === 'mcp-call') {
      const s = get(f.server, f.name);
      s.calls++;
      if (!f.ok) {
        s.errors++;
        s.lastError = later(s.lastError, f.ts);
      }
    }
  }
  for (const c of config.mcpServers) {
    const s = servers.get(c.key);
    if (s) s.label = c.label;
  }

  const findings = [];
  for (const s of servers.values()) {
    const subject = `MCP ${s.label}`;
    const n = s.sessions.size;
    const before = findings.length;
    if (s.failed.size > 0) {
      findings.push(finding('mcp-failed-connect', 'broken', subject, `failed to connect in ${s.failed.size} of ${plural(n, 'session')}`, { sessions: n, failed: s.failed.size }));
    }
    if (s.errors > 0) {
      const ratio = s.errors / s.calls;
      const severity = s.calls >= 2 && ratio >= 0.5 ? 'broken' : ratio >= 0.2 ? 'warning' : null;
      if (severity) {
        findings.push(finding('mcp-call-errors', severity, subject, `${s.errors} of ${plural(s.calls, 'call')} failed`, { calls: s.calls, errors: s.errors, lastError: s.lastError }));
      }
    }
    const needsAuth = [...s.needsAuth].filter(id => !s.connected.has(id)).length;
    if (needsAuth > 0) {
      findings.push(finding('mcp-needs-auth', 'warning', subject, `needs auth in ${needsAuth} of ${plural(n, 'session')}`, { sessions: n, needsAuth }));
    }
    const stuck = [...s.pending].filter(id => !s.connected.has(id) && !s.failed.has(id) && !s.needsAuth.has(id)).length;
    if (stuck > 0) {
      findings.push(finding('mcp-stuck-pending', 'warning', subject, `never finished connecting in ${stuck} of ${plural(n, 'session')}`, { sessions: n, stuck }));
    }
    if (findings.length === before) {
      const message = s.calls > 0 ? `${plural(s.calls, 'call')}, ${s.errors} failed` : `connected in ${s.connected.size} of ${plural(n, 'session')}`;
      findings.push(finding('mcp-ok', 'ok', subject, message, { calls: s.calls, sessions: n }));
    }
  }

  const reported = new Set();
  for (const c of config.mcpServers) {
    if (servers.has(c.key) || reported.has(c.key)) continue;
    if (c.project && !ranInProject(cwds, c.project)) continue;
    reported.add(c.key);
    findings.push(finding('mcp-never-seen', 'warning', `MCP ${c.label}`, `configured (${c.scope} scope) but never showed up in the logs`, { scope: c.scope, source: c.source }));
  }
  return findings;
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 42 tests in total.

- [ ] **Step 7: Commit**

```bash
git add src/format.js src/analyze/common.js src/analyze/mcp.js test/analyze-mcp.test.js
git commit -m "feat: grade MCP servers from connection and call facts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Hook analyzer

**Files:**
- Create: `src/analyze/hooks.js`
- Test: `test/analyze-hooks.test.js`

**Interfaces:**
- Consumes: `hook-run` facts (Task 4), `Config.hooks` (Task 5), and `finding`, `later`, `ranInProject` and `plural` (Task 6).
- Produces:
  - `TRACED_EVENTS: Set<string>`, initially `{'SessionStart', 'Stop'}`.
  - `analyzeHooks(facts, config, { cwds }): Finding[]`. The finding ids are `hook-error`, `hook-slow`, `hook-no-trace`, `hook-ok` and `hook-never-ran`.

- [ ] **Step 1: Write the failing tests in `test/analyze-hooks.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACED_EVENTS, analyzeHooks } from '../src/analyze/hooks.js';

const run = fields => ({ kind: 'hook-run', event: 'SessionStart', command: 'start.sh', exitCode: 0, durationMs: 100, stderr: null, problemType: null, sessionId: 's1', cwd: '/w/p', ts: '2026-09-20T10:00:00.000Z', ...fields });
const hook = fields => ({ event: 'SessionStart', matcher: null, type: 'command', command: 'start.sh', scope: 'user', project: null, source: 'settings.json', plugin: null, ...fields });
const ctx = { cwds: new Set(['/w/p']) };
const none = { mcpServers: [], hooks: [] };
const pick = findings => findings.map(f => [f.id, f.severity, f.subject, f.message]);

test('a configured SessionStart hook that ran is ok', () => {
  assert.deepEqual(pick(analyzeHooks([run()], { mcpServers: [], hooks: [hook()] }, ctx)), [
    ['hook-ok', 'ok', 'Hook SessionStart (user settings)', 'ran'],
  ]);
});

test('a configured SessionStart or Stop hook that never ran is a warning', () => {
  const cfg = { mcpServers: [], hooks: [hook({ command: 'missing.sh' }), hook({ event: 'Stop', command: 'bye', plugin: 'sp', scope: 'plugin' })] };
  assert.deepEqual(pick(analyzeHooks([run()], cfg, ctx)), [
    ['hook-never-ran', 'warning', 'Hook SessionStart (user settings)', 'configured but never ran'],
    ['hook-never-ran', 'warning', 'Hook Stop (plugin sp)', 'configured but never ran'],
  ]);
});

test('hooks on untraced events are unknown, not broken', () => {
  assert.deepEqual(pick(analyzeHooks([], { mcpServers: [], hooks: [hook({ event: 'Notification' })] }, ctx)), [
    ['hook-no-trace', 'unknown', 'Hook Notification (user settings)', "can't verify: successful Notification hooks leave no trace in the logs"],
  ]);
});

test('project hooks are only judged when a session ran in that project', () => {
  const cfg = { mcpServers: [], hooks: [hook({ command: 'x', scope: 'project', project: '/elsewhere' })] };
  assert.deepEqual(analyzeHooks([], cfg, ctx), []);
});

test('failed runs are broken, grouped by event and command, with the latest stderr', () => {
  const facts = [
    run({ exitCode: 1, stderr: 'first' }),
    run({ exitCode: 1, stderr: 'second', ts: '2026-09-21T10:00:00.000Z' }),
    run({ event: 'Stop', command: 'app-hook', exitCode: null, problemType: 'stop_hook_error', stderr: 'died' }),
  ];
  const findings = analyzeHooks(facts, none, ctx);
  assert.deepEqual(pick(findings), [
    ['hook-error', 'broken', 'Hook SessionStart (not in your config)', 'failed 2 times (exit code 1)'],
    ['hook-error', 'broken', 'Hook Stop (not in your config)', 'failed 1 time (stop_hook_error)'],
  ]);
  assert.equal(findings[0].evidence.stderr, 'second');
  assert.equal(findings[0].evidence.command, 'start.sh');
  assert.equal(findings[0].evidence.last, '2026-09-21T10:00:00.000Z');
});

test('a configured hook that failed is reported once, as broken', () => {
  const findings = analyzeHooks([run({ exitCode: 2, stderr: 'no' })], { mcpServers: [], hooks: [hook()] }, ctx);
  assert.deepEqual(pick(findings), [['hook-error', 'broken', 'Hook SessionStart (user settings)', 'failed 1 time (exit code 2)']]);
});

test('slow hooks are warnings', () => {
  const findings = analyzeHooks([run({ durationMs: 12_500 }), run({ durationMs: 30_000 })], none, ctx);
  assert.deepEqual(pick(findings), [['hook-slow', 'warning', 'Hook SessionStart (not in your config)', 'took over 10s 2 times, up to 30.0s']]);
});

test('only SessionStart and Stop are traced for now', () => {
  assert.deepEqual([...TRACED_EVENTS].sort(), ['SessionStart', 'Stop']);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. `Cannot find module ... src/analyze/hooks.js`.

- [ ] **Step 3: Write `src/analyze/hooks.js`**

```js
import { basename } from 'node:path';
import { plural } from '../format.js';
import { finding, later, ranInProject } from './common.js';

// Events whose successful runs are written to the session logs (spec §2).
export const TRACED_EVENTS = new Set(['SessionStart', 'Stop']);
const SLOW_MS = 10_000;

const keyOf = (event, command) => `${event}\u0000${command}`;

export function analyzeHooks(facts, config, { cwds }) {
  const failures = new Map();
  const slow = new Map();
  const ran = new Set();

  for (const r of facts) {
    if (r.kind !== 'hook-run') continue;
    const key = keyOf(r.event, r.command);
    if (r.command !== null) ran.add(key);
    const badExit = r.exitCode !== null && r.exitCode !== 0;
    if (r.problemType !== null || badExit) {
      const g = failures.get(key) ?? { event: r.event, command: r.command, count: 0, exitCode: null, problemType: null, stderr: null, last: null };
      g.count++;
      if (badExit) g.exitCode = r.exitCode;
      g.problemType = r.problemType ?? g.problemType;
      g.stderr = r.stderr ?? g.stderr;
      g.last = later(g.last, r.ts);
      failures.set(key, g);
    }
    if (r.durationMs !== null && r.durationMs > SLOW_MS) {
      const g = slow.get(key) ?? { event: r.event, command: r.command, count: 0, maxMs: 0 };
      g.count++;
      g.maxMs = Math.max(g.maxMs, r.durationMs);
      slow.set(key, g);
    }
  }

  const findings = [];
  for (const g of failures.values()) {
    const how = g.exitCode !== null ? `exit code ${g.exitCode}` : g.problemType;
    findings.push(finding('hook-error', 'broken', subjectFor(g.event, g.command, config), `failed ${plural(g.count, 'time')} (${how})`,
      { event: g.event, command: g.command, stderr: g.stderr, last: g.last }));
  }
  for (const g of slow.values()) {
    findings.push(finding('hook-slow', 'warning', subjectFor(g.event, g.command, config),
      `took over ${SLOW_MS / 1000}s ${plural(g.count, 'time')}, up to ${(g.maxMs / 1000).toFixed(1)}s`,
      { event: g.event, command: g.command, maxMs: g.maxMs }));
  }
  for (const h of config.hooks) {
    if (h.project && !ranInProject(cwds, h.project)) continue;
    const subject = subjectFor(h.event, h.command, config, h);
    const key = keyOf(h.event, h.command);
    if (!TRACED_EVENTS.has(h.event) || h.command === null) {
      findings.push(finding('hook-no-trace', 'unknown', subject, `can't verify: successful ${h.event} hooks leave no trace in the logs`,
        { event: h.event, command: h.command, source: h.source }));
    } else if (failures.has(key)) {
      continue;
    } else if (ran.has(key)) {
      findings.push(finding('hook-ok', 'ok', subject, 'ran', { event: h.event }));
    } else {
      findings.push(finding('hook-never-ran', 'warning', subject, 'configured but never ran', { event: h.event, command: h.command, source: h.source }));
    }
  }
  return findings;
}

function subjectFor(event, command, config, known) {
  const h = known ?? config.hooks.find(c => c.event === event && c.command === command);
  const where = !h ? 'not in your config' : h.plugin ? `plugin ${h.plugin}` : h.project ? `${h.scope} settings, ${basename(h.project)}` : 'user settings';
  return `Hook ${event ?? '(unknown event)'} (${where})`;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 50 tests in total.

- [ ] **Step 5: Commit**

```bash
git add src/analyze/hooks.js test/analyze-hooks.test.js
git commit -m "feat: grade hooks from run facts and config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Hook-logging spike (controller runs this, not an implementer)

**Purpose:** find out whether successful and failing PreToolUse, PostToolUse and UserPromptSubmit hook runs appear in the logs, and what attachment type a failing hook produces. The spike doesn't touch the user's real settings: it passes a throwaway settings file with `--settings`. It costs one small Sonnet call.

**Files:**
- Maybe modify: `src/analyze/hooks.js` (`TRACED_EVENTS`), `test/analyze-hooks.test.js` (the last test), `test/extract-hooks.test.js`, and spec §2.

- [ ] **Step 1: Confirm the flag exists**

Run (Git Bash):
```bash
CLAUDE_EXE="$APPDATA/Claude/claude-code/$(ls "$APPDATA/Claude/claude-code" | sort -V | tail -1)/claude.exe"; "$CLAUDE_EXE" --help | grep -- '--settings'
```
Expected: a line containing `--settings <file-or-json>`.

- [ ] **Step 2: Write the throwaway settings into the session scratchpad at `<scratchpad>/spike/settings.json`**

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [
      { "type": "command", "command": "node -e \"process.exit(0)\"" },
      { "type": "command", "command": "node -e \"process.stderr.write('spike-stderr'); process.exit(1)\"" }
    ] }],
    "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node -e \"process.exit(0)\"" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node -e \"process.exit(0)\"" }] }]
  }
}
```

- [ ] **Step 3: Run one headless session from inside the spike folder**

```bash
cd "<scratchpad>/spike" && "$CLAUDE_EXE" -p "Run this shell command and nothing else: echo silentfail-spike" --settings "<scratchpad>/spike/settings.json" --model sonnet --allowedTools "Bash(echo silentfail-spike)"
```
Expected: output mentioning `silentfail-spike`.

- [ ] **Step 4: Print the hook-related entries from that session's log**

```bash
F=$(find ~/.claude/projects -name '*.jsonl' -newer "<scratchpad>/spike/settings.json" | head -1); echo "$F"; node -e "
for (const l of require('fs').readFileSync(process.argv[1],'utf8').split('\n')) { if (!l.trim()) continue; const o = JSON.parse(l); const a = o.attachment;
  if ((a && /hook/.test(a.type)) || /hook/.test(o.subtype || '')) console.log(o.type, o.subtype || '', a?.type || '', a?.hookEvent || '', 'exit=' + a?.exitCode, 'keys=' + Object.keys(a || o).join(','));
}" "$F"
```

- [ ] **Step 5: Apply what was learned**

Apply whichever of these cases match the Step 4 output:
- **Exit-0 runs appear** for `PreToolUse`, `PostToolUse` or `UserPromptSubmit` (as `hook_success` or similar):
  - Add those event names to `TRACED_EVENTS` in `src/analyze/hooks.js`.
  - Change the last test in `test/analyze-hooks.test.js` to the new sorted list, and rename it to "traced events match the spike findings".
- **The exit-1 hook shows up as an attachment type**, for example `hook_non_blocking_error`:
  - In `test/extract-hooks.test.js`, change the "other hook_* attachments are problems" test to use that exact type name and field set.
  - Add one line with that exact shape to `test/fixtures/basic/hook-error.jsonl` (create the file). Use sessionId `s-hook-err`, cwd `__PROJECT__` and the same fields, with `stderr` `"spike-stderr"`.
- **Nothing appears for these events:** leave the code as it is.
- **In every case:** add one sentence to the end of spec §2 recording the result. For example: "As of 2.1.281, successful PreToolUse runs are / are not logged; a failing hook is logged as `<type>`."

- [ ] **Step 6: Run the tests and commit**

Run: `npm test`
Expected: PASS.
```bash
git add -A src test docs
git commit -m "chore: record hook-logging spike results" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
The spike's own session log stays in `~/.claude/projects`. It's harmless and needs no cleanup.

---

### Task 9: Terminal and JSON reports

**Files:**
- Create: `src/report/text.js`, `src/report/json.js`
- Test: `test/report.test.js`

**Interfaces:**
- Consumes: `redact`, `redactLine` and `redactDeep` (Task 1), `plural` (Task 6), and `Finding` (Task 6).
- Produces:
  - `renderText(result, { days, all = false, color = false }): string`
  - `renderJson(result, { days }): string`
  - Both take a `result` of shape `{ findings: Finding[], stats: { files, sessions, badLines, unrecognized: Record<string, number>, versions: { min, max }, warnings: string[] } }`.

- [ ] **Step 1: Write the failing tests in `test/report.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJson } from '../src/report/json.js';
import { renderText } from '../src/report/text.js';

const result = {
  findings: [
    { id: 'mcp-call-errors', severity: 'broken', subject: 'MCP filesystem', message: '2 of 2 calls failed', evidence: { calls: 2, errors: 2, lastError: '2026-09-23T08:00:00.000Z' } },
    { id: 'hook-error', severity: 'broken', subject: 'Hook Stop (user settings)', message: 'failed 1 time (exit code 1)', evidence: { event: 'Stop', command: 'curl -H "Authorization: Bearer sk-ant-FAKE0000000000000000" x', stderr: 'boom sk-ant-FAKE0000000000000000\nline two', last: '2026-09-22T00:00:00.000Z' } },
    { id: 'mcp-needs-auth', severity: 'warning', subject: 'MCP plugin:cloudflare:cloudflare', message: 'needs auth in 9 of 9 sessions', evidence: {} },
    { id: 'hook-no-trace', severity: 'unknown', subject: 'Hook PreToolUse (plugin superpowers)', message: "can't verify: successful PreToolUse hooks leave no trace in the logs", evidence: {} },
    { id: 'mcp-ok', severity: 'ok', subject: 'MCP memory', message: '3 calls, 0 failed', evidence: {} },
    { id: 'hook-ok', severity: 'ok', subject: 'Hook SessionStart (plugin superpowers)', message: 'ran', evidence: {} },
  ],
  stats: {
    files: 3, sessions: 37, badLines: 2,
    unrecognized: { 'attachment/new_thing': 12 },
    versions: { min: '2.1.229', max: '2.1.281' },
    warnings: ['could not parse /x/settings.json'],
  },
};

test('text report groups findings and never prints secrets', () => {
  assert.equal(renderText(result, { days: 14 }), [
    'silentfail: 37 sessions, last 14 days, Claude Code 2.1.229-2.1.281',
    '',
    'BROKEN',
    '  [x] MCP filesystem: 2 of 2 calls failed (last 2026-09-23)',
    '  [x] Hook Stop (user settings): failed 1 time (exit code 1) (last 2026-09-22)',
    '      command: curl -H "Authorization: Bearer [redacted]" x',
    '      stderr: boom [redacted]',
    '',
    'WARNING',
    '  [!] MCP plugin:cloudflare:cloudflare: needs auth in 9 of 9 sessions',
    '',
    'UNKNOWN',
    "  [?] Hook PreToolUse (plugin superpowers): can't verify: successful PreToolUse hooks leave no trace in the logs",
    '',
    'OK: 1 MCP server, 1 hook (--all to list)',
    '',
    '12 log lines not recognized (newer Claude Code?). This is not an error.',
    '2 unreadable log lines skipped.',
    'note: could not parse /x/settings.json',
    '',
  ].join('\n'));
});

test('text report colors only when asked', () => {
  assert.ok(!renderText(result, { days: 14 }).includes('\x1b['));
  assert.ok(renderText(result, { days: 14, color: true }).includes('\x1b[31mBROKEN\x1b[0m'));
});

test('--all lists ok items and unrecognized shapes', () => {
  const out = renderText(result, { days: 14, all: true });
  assert.ok(out.includes('OK\n  [ok] MCP memory: 3 calls, 0 failed\n  [ok] Hook SessionStart (plugin superpowers): ran\n'));
  assert.ok(out.includes('  12  attachment/new_thing'));
});

test('says so when nothing is broken', () => {
  const empty = { findings: [], stats: { files: 1, sessions: 1, badLines: 0, unrecognized: {}, versions: { min: null, max: null }, warnings: [] } };
  assert.equal(renderText(empty, { days: 7 }), 'silentfail: 1 session, last 7 days\n\nNothing broken found.\n\n');
});

test('json report is redacted, object keys included', () => {
  const withBadKey = { ...result, stats: { ...result.stats, unrecognized: { 'x/sk-ant-FAKE0000000000000000': 1 } } };
  const text = renderJson(withBadKey, { days: 14 });
  assert.ok(!text.includes('sk-ant-FAKE'));
  const json = JSON.parse(text);
  assert.equal(json.tool, 'silentfail');
  assert.equal(json.schema, 1);
  assert.equal(json.days, 14);
  assert.equal(json.findings.length, 6);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. `Cannot find module ... src/report/text.js`.

- [ ] **Step 3: Write `src/report/text.js`**

```js
import { plural } from '../format.js';
import { redact, redactLine } from '../redact.js';

const HEADINGS = { broken: 'BROKEN', warning: 'WARNING', unknown: 'UNKNOWN' };
const MARKS = { broken: '[x]', warning: '[!]', unknown: '[?]' };
const STYLE = { broken: '\x1b[31m', warning: '\x1b[33m', unknown: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' };

export function renderText(result, { days, all = false, color = false }) {
  const paint = (style, s) => (color ? `${STYLE[style]}${s}${STYLE.reset}` : s);
  const { findings, stats } = result;
  const { min, max } = stats.versions;
  const versions = min ? `, Claude Code ${min === max ? min : `${min}-${max}`}` : '';
  const lines = [`silentfail: ${plural(stats.sessions, 'session')}, last ${days} days${versions}`, ''];

  if (!findings.some(f => f.severity !== 'ok')) lines.push('Nothing broken found.', '');
  for (const severity of ['broken', 'warning', 'unknown']) {
    const group = findings.filter(f => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(paint(severity, HEADINGS[severity]));
    for (const f of group) {
      const last = f.evidence?.last ?? f.evidence?.lastError;
      const when = typeof last === 'string' ? ` (last ${redact(last.slice(0, 10))})` : '';
      lines.push(`  ${paint(severity, MARKS[severity])} ${redact(f.subject)}: ${redact(f.message)}${when}`);
      if (f.evidence?.command) lines.push(`      command: ${redactLine(f.evidence.command)}`);
      if (f.evidence?.stderr) lines.push(`      stderr: ${redactLine(f.evidence.stderr)}`);
    }
    lines.push('');
  }

  const ok = findings.filter(f => f.severity === 'ok');
  if (all && ok.length > 0) {
    lines.push('OK');
    for (const f of ok) lines.push(`  [ok] ${redact(f.subject)}: ${redact(f.message)}`);
    lines.push('');
  } else if (ok.length > 0) {
    const mcp = ok.filter(f => f.id.startsWith('mcp-')).length;
    lines.push(paint('dim', `OK: ${plural(mcp, 'MCP server')}, ${plural(ok.length - mcp, 'hook')} (--all to list)`), '');
  }

  const unrecognized = Object.values(stats.unrecognized).reduce((a, b) => a + b, 0);
  if (unrecognized > 0) {
    lines.push(`${plural(unrecognized, 'log line')} not recognized (newer Claude Code?). This is not an error.`);
    if (all) for (const [shape, n] of Object.entries(stats.unrecognized)) lines.push(`  ${n}  ${redact(shape)}`);
  }
  if (stats.badLines > 0) lines.push(`${plural(stats.badLines, 'unreadable log line')} skipped.`);
  for (const w of stats.warnings) lines.push(`note: ${redact(w)}`);
  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: Write `src/report/json.js`**

```js
import { redactDeep } from '../redact.js';

export function renderJson(result, { days }) {
  const doc = { tool: 'silentfail', schema: 1, days, stats: result.stats, findings: result.findings };
  return `${JSON.stringify(redactDeep(doc), null, 2)}\n`;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 55 tests in total, or more if Task 8 added any.

- [ ] **Step 6: Commit**

```bash
git add src/report/text.js src/report/json.js test/report.test.js
git commit -m "feat: terminal and JSON reports with redaction" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Runner, CLI and end-to-end tests

**Files:**
- Create: `src/run.js`, `src/main.js`, `src/cli.js`, `test/fixtures/basic/filesystem-broken.jsonl`, `test/fixtures/basic/healthy.jsonl`
- Test: `test/main.test.js`, `test/e2e.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `run({ env?, days?, now? }): Promise<{ findings, stats }>`. It throws `SetupError` when the config folder is missing.
  - `class SetupError extends Error`
  - `main(argv: string[], { stdout?, stderr?, env? }): Promise<number>`, which returns the exit code.
  - `HELP: string`
  - The `src/cli.js` bin.

- [ ] **Step 1: Write `test/fixtures/basic/filesystem-broken.jsonl` (7 lines, exactly)**

```jsonl
{"type":"attachment","sessionId":"s-basic-1","cwd":"__PROJECT__","timestamp":"2026-09-20T10:00:00.000Z","version":"2.1.281","attachment":{"type":"hook_success","hookEvent":"SessionStart","hookName":"SessionStart:startup","command":"\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start","exitCode":0,"durationMs":120,"stdout":"CANARY_DO_NOT_PRINT","stderr":""}}
{"type":"attachment","sessionId":"s-basic-1","cwd":"__PROJECT__","timestamp":"2026-09-20T10:00:01.000Z","version":"2.1.281","attachment":{"type":"deferred_tools_delta","addedNames":["mcp__filesystem__read_file","mcp__filesystem__list_directory"],"addedLines":[],"readdedNames":[],"removedNames":[],"pendingMcpServers":[],"needsAuthMcpServers":["plugin:cloudflare:cloudflare"],"failedMcpServers":[]}}
{"type":"assistant","sessionId":"s-basic-1","cwd":"__PROJECT__","timestamp":"2026-09-20T10:00:02.000Z","version":"2.1.281","message":{"role":"assistant","content":[{"type":"text","text":"CANARY_DO_NOT_PRINT"},{"type":"tool_use","id":"toolu_1","name":"mcp__filesystem__read_file","input":{"path":"CANARY_DO_NOT_PRINT"}}]}}
{"type":"user","sessionId":"s-basic-1","cwd":"__PROJECT__","timestamp":"2026-09-20T10:00:03.000Z","version":"2.1.281","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","is_error":true,"content":"Access denied sk-ant-FAKE0000000000000000 CANARY_DO_NOT_PRINT"}]}}
{"type":"assistant","sessionId":"s-basic-1","cwd":"__PROJECT__","timestamp":"2026-09-20T10:00:04.000Z","version":"2.1.281","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"mcp__filesystem__list_directory","input":{"path":"CANARY_DO_NOT_PRINT"}}]}}
{"type":"user","sessionId":"s-basic-1","cwd":"__PROJECT__","timestamp":"2026-09-20T10:00:05.000Z","version":"2.1.281","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_2","is_error":true,"content":"Access denied CANARY_DO_NOT_PRINT"}]}}
{"type":"system","subtype":"stop_hook_summary","sessionId":"s-basic-1","cwd":"__PROJECT__","timestamp":"2026-09-20T10:00:06.000Z","version":"2.1.229","hookCount":1,"hookInfos":[{"command":"node app-stop-hook.js"}],"hookErrors":[],"preventedContinuation":false,"stopReason":"","hasOutput":false,"level":"info"}
```

- [ ] **Step 2: Write `test/fixtures/basic/healthy.jsonl` (3 lines, exactly)**

```jsonl
{"type":"attachment","sessionId":"s-healthy","cwd":"/healthy/project","timestamp":"2026-09-21T09:00:00.000Z","version":"2.1.281","attachment":{"type":"deferred_tools_delta","addedNames":["mcp__memory__recall"],"addedLines":[],"readdedNames":[],"removedNames":[],"pendingMcpServers":[],"needsAuthMcpServers":[],"failedMcpServers":[]}}
{"type":"assistant","sessionId":"s-healthy","cwd":"/healthy/project","timestamp":"2026-09-21T09:00:01.000Z","version":"2.1.281","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_h1","name":"mcp__memory__recall","input":{"q":"CANARY_DO_NOT_PRINT"}}]}}
{"type":"user","sessionId":"s-healthy","cwd":"/healthy/project","timestamp":"2026-09-21T09:00:02.000Z","version":"2.1.281","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_h1","content":"CANARY_DO_NOT_PRINT"}]}}
```

- [ ] **Step 3: Write the failing tests in `test/main.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.js';

function io(env = process.env) {
  const out = { text: '' };
  const err = { text: '' };
  return {
    out,
    err,
    opts: {
      stdout: { write: s => { out.text += s; return true; }, isTTY: false },
      stderr: { write: s => { err.text += s; return true; } },
      env,
    },
  };
}

test('--help prints usage and exits 0', async () => {
  const t = io();
  assert.equal(await main(['--help'], t.opts), 0);
  assert.match(t.out.text, /Usage: npx silentfail/);
});

test('--version prints the package version', async () => {
  const t = io();
  assert.equal(await main(['--version'], t.opts), 0);
  assert.equal(t.out.text, '0.1.0\n');
});

test('a bad --days exits 2', async () => {
  for (const d of ['0', '-3', '1.5', 'abc', '99999']) {
    const t = io();
    assert.equal(await main([`--days=${d}`], t.opts), 2, d);
    assert.match(t.err.text, /--days must be/);
  }
});

test('unknown flags exit 2', async () => {
  const t = io();
  assert.equal(await main(['--nope'], t.opts), 2);
});

test('a missing Claude folder exits 2 with a clear message', async () => {
  const t = io({ ...process.env, CLAUDE_CONFIG_DIR: join(tmpdir(), `silentfail-none-${Date.now()}`) });
  assert.equal(await main([], t.opts), 2);
  assert.match(t.err.text, /No Claude Code folder found/);
});
```

- [ ] **Step 4: Write the failing tests in `test/e2e.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFakeHome, readFixture } from './helpers/fakeHome.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const runCli = (env, ...args) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });

function brokenHome() {
  const home = makeFakeHome();
  home.writeLog(join('proj', 's-basic-1.jsonl'), readFixture('basic/filesystem-broken.jsonl'));
  home.write(join(home.projectDir, '.mcp.json'), { mcpServers: { filesystem: { command: 'npx', args: [] } } });
  const sp = join(home.dir, 'plugins', 'cache', 'superpowers');
  const cf = join(home.dir, 'plugins', 'cache', 'cloudflare');
  home.write(join('plugins', 'installed_plugins.json'), { version: 2, plugins: {
    'superpowers@test': [{ scope: 'user', installPath: sp }],
    'cloudflare@test': [{ scope: 'user', installPath: cf }],
  } });
  home.write(join(sp, 'hooks', 'hooks.json'), { hooks: { SessionStart: [{ matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start' }] }] } });
  home.write(join(cf, '.mcp.json'), { mcpServers: { cloudflare: { type: 'http', url: 'https://example.invalid/mcp' } } });
  home.write('settings.json', {
    enabledPlugins: { 'superpowers@test': true, 'cloudflare@test': true },
    hooks: { Notification: [{ hooks: [{ type: 'command', command: 'ping.sh' }] }] },
  });
  return home;
}

test('end to end: finds the broken filesystem server and exits 1', () => {
  const home = brokenHome();
  try {
    const r = runCli(home.env, '--json');
    assert.equal(r.status, 1, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.deepEqual(json.findings.map(f => [f.id, f.severity, f.subject, f.message]), [
      ['mcp-call-errors', 'broken', 'MCP filesystem', '2 of 2 calls failed'],
      ['mcp-needs-auth', 'warning', 'MCP plugin:cloudflare:cloudflare', 'needs auth in 1 of 1 session'],
      ['hook-no-trace', 'unknown', 'Hook Notification (user settings)', "can't verify: successful Notification hooks leave no trace in the logs"],
      ['hook-ok', 'ok', 'Hook SessionStart (plugin superpowers)', 'ran'],
    ]);
    assert.equal(json.stats.sessions, 1);
    assert.deepEqual(json.stats.versions, { min: '2.1.229', max: '2.1.281' });
  } finally {
    home.cleanup();
  }
});

test('end to end: the text report shows the finding and leaks nothing', () => {
  const home = brokenHome();
  try {
    for (const args of [[], ['--all'], ['--json']]) {
      const r = runCli(home.env, ...args);
      for (const canary of ['CANARY_DO_NOT_PRINT', 'sk-ant-FAKE']) {
        assert.ok(!r.stdout.includes(canary) && !r.stderr.includes(canary), `${canary} leaked with ${args.join(' ')}`);
      }
    }
    assert.match(runCli(home.env).stdout, /\[x\] MCP filesystem: 2 of 2 calls failed \(last 2026-09-20\)/);
  } finally {
    home.cleanup();
  }
});

test('end to end: a healthy setup exits 0', () => {
  const home = makeFakeHome();
  try {
    home.writeLog(join('proj', 's-healthy.jsonl'), readFixture('basic/healthy.jsonl'));
    const r = runCli(home.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Nothing broken found\./);
  } finally {
    home.cleanup();
  }
});

test('end to end: no Claude folder exits 2', () => {
  const r = runCli({ ...process.env, CLAUDE_CONFIG_DIR: join(tmpdir(), `silentfail-nope-${Date.now()}`) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No Claude Code folder found/);
});
```

If Task 8 created `test/fixtures/basic/hook-error.jsonl`, also add this test:

```js
test('end to end: a failing hook from the spike shape is broken', () => {
  const home = makeFakeHome();
  try {
    home.writeLog(join('proj', 's-hook-err.jsonl'), readFixture('basic/hook-error.jsonl'));
    const r = runCli(home.env, '--json');
    assert.equal(r.status, 1, r.stderr);
    assert.ok(JSON.parse(r.stdout).findings.some(f => f.id === 'hook-error'));
  } finally {
    home.cleanup();
  }
});
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. `Cannot find module ... src/main.js`, and the e2e tests fail because `src/cli.js` is missing.

- [ ] **Step 6: Write `src/run.js`**

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeHooks } from './analyze/hooks.js';
import { analyzeMcp } from './analyze/mcp.js';
import { createExtractor } from './extract/index.js';
import { loadConfig } from './sources/config.js';
import { findLogFiles, readEntries } from './sources/logs.js';
import { configDir } from './sources/paths.js';

export class SetupError extends Error {}

const ORDER = { broken: 0, warning: 1, unknown: 2, ok: 3 };

// The whole pipeline: logs → facts → findings, plus counters for the report footer.
export async function run({ env = process.env, days = 14, now = Date.now() } = {}) {
  const dir = configDir(env);
  if (!existsSync(dir)) {
    throw new SetupError(`No Claude Code folder found at ${dir}. Is Claude Code installed? (Set CLAUDE_CONFIG_DIR if it lives somewhere else.)`);
  }
  const files = await findLogFiles(join(dir, 'projects'), { days, now });
  const counters = { badLines: 0 };
  const warnings = [];
  const { extract, state } = createExtractor();
  const facts = [];
  for (const file of files) {
    try {
      for await (const { entry } of readEntries(file, counters)) {
        for (const fact of extract(entry)) facts.push(fact);
      }
    } catch (err) {
      warnings.push(`could not read ${file} (${err.code ?? err.message})`);
    }
  }

  const config = await loadConfig({ env, projectPaths: [...state.cwds] });
  warnings.push(...config.warnings);
  const context = { cwds: state.cwds };
  const findings = [...analyzeMcp(facts, config, context), ...analyzeHooks(facts, config, context)]
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.subject.localeCompare(b.subject));

  return {
    findings,
    stats: {
      files: files.length,
      sessions: state.sessions.size,
      badLines: counters.badLines,
      unrecognized: Object.fromEntries([...state.unrecognized].sort((a, b) => b[1] - a[1])),
      versions: state.versions,
      warnings,
    },
  };
}
```

- [ ] **Step 7: Write `src/main.js`**

```js
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { redact } from './redact.js';
import { renderJson } from './report/json.js';
import { renderText } from './report/text.js';
import { run, SetupError } from './run.js';

export const HELP = `silentfail: find the parts of your Claude Code setup that look fine but are broken.

Usage: npx silentfail [options]

Options:
  --days <n>     how many days of session logs to read (default 14)
  --json         print JSON instead of the report
  --all          also list everything that is fine, and unrecognized log shapes
  -h, --help     show this help
  -v, --version  show the version

Exit codes: 0 nothing broken, 1 something is broken, 2 silentfail could not run.
Everything stays on your machine. Nothing is uploaded.
`;

const OPTIONS = {
  days: { type: 'string', default: '14' },
  json: { type: 'boolean', default: false },
  all: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

export async function main(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, options: OPTIONS }).values;
  } catch (err) {
    stderr.write(`${err.message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    stdout.write(HELP);
    return 0;
  }
  if (args.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    stdout.write(`${pkg.version}\n`);
    return 0;
  }
  const days = Number(args.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    stderr.write('--days must be a whole number between 1 and 3650\n');
    return 2;
  }
  try {
    const result = await run({ env, days });
    const color = Boolean(stdout.isTTY) && !env.NO_COLOR;
    stdout.write(args.json ? renderJson(result, { days }) : renderText(result, { days, all: args.all, color }));
    return result.findings.some(f => f.severity === 'broken') ? 1 : 0;
  } catch (err) {
    if (err instanceof SetupError) {
      stderr.write(`${redact(err.message)}\n`);
      return 2;
    }
    stderr.write(`silentfail hit a bug: ${redact(err?.stack ?? String(err))}\nPlease open an issue with this output. It contains no conversation content.\n`);
    return 2;
  }
}
```

- [ ] **Step 8: Write `src/cli.js`**

```js
#!/usr/bin/env node
import { main } from './main.js';

process.exitCode = await main(process.argv.slice(2));
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, all tests (64 without the Task 8 extra, 65 with it).

- [ ] **Step 10: Commit**

```bash
git add src/run.js src/main.js src/cli.js test/fixtures/basic test/main.test.js test/e2e.test.js
git commit -m "feat: wire the pipeline into the silentfail CLI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Forged fixtures and the log-forger agent

**Files:**
- Create: `test/LOG-SHAPES.md`, `.claude/agents/log-forger.md`, `test/forged.test.js`, `test/fixtures/forged/*` (written by the agent in Step 4)

**Interfaces:**
- Consumes: `makeFakeHome` (Task 5) and `src/cli.js` (Task 10).
- Produces: 8 committed forged fixture files named `01-unknown-types.jsonl` through `08-secrets-in-hooks.jsonl`, plus `test/fixtures/forged/README.md`.

- [ ] **Step 1: Write `test/LOG-SHAPES.md`**

If Task 8 recorded a real hook-error attachment type, use that exact name in item 6 in place of `hook_non_blocking_error`.

````markdown
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
````

- [ ] **Step 2: Write `.claude/agents/log-forger.md`**

````markdown
---
name: log-forger
description: Writes adversarial fake Claude Code session logs into test/fixtures/forged/ to stress-test silentfail's parser. Use when silentfail needs new edge-case fixtures.
tools: Read, Write, Glob
model: sonnet
---

You write fake Claude Code session logs whose only job is to break silentfail's parser.

## Hard rules

- Read `test/LOG-SHAPES.md` first. It is your only source for what logs look like. Never read anything under `~/.claude`, and never read real session logs.
- Write only inside `test/fixtures/forged/`.
- Use only made-up data:
  - sessionIds like `forged-03-a`
  - cwd values like `/forged/project-a`
  - timestamps in 2026
  - versions like `2.1.281`
- There are two canary strings:
  - `CANARY_DO_NOT_PRINT` goes only in content fields: text blocks in `message.content`, `tool_use.input`, `tool_result.content`, and hook `stdout`. Use it at least 3 times per file.
  - `sk-ant-FAKE0000000000000000` goes in content fields AND in hook `command`, hook `stderr`, and `hookErrors` values. Use it at least 3 times per file.
- Never put either canary in `type`, `subtype`, `attachment.type`, `hookEvent`, `hookName`, `sessionId`, `cwd`, `timestamp`, `version`, tool names, or server names.

## Files to write

Write 30 to 80 lines each. Every file also includes some normal, valid entries so the parser does real work: MCP tool calls with results, `hook_success`, `deferred_tools_delta`, and `stop_hook_summary`.

1. `01-unknown-types.jsonl`: at least 10 entries with `type` or `attachment.type` values that don't appear in LOG-SHAPES.md.
2. `02-missing-fields.jsonl`: known shapes with fields missing, null, or the wrong type (numbers where strings belong, objects where arrays belong).
3. `03-truncated-lines.jsonl`: at least 5 lines cut off mid-JSON, plus a few lines that are not JSON at all.
4. `04-future-version.jsonl`: every entry has `"version":"9.9.9"`, and some use made-up new fields.
5. `05-orphan-results.jsonl`: tool_result blocks whose tool_use_id matches no tool_use, and tool_use blocks that never get a result.
6. `06-interleaved-sessions.jsonl`: three sessions mixed line by line, reusing the same tool_use ids across sessions.
7. `07-unicode.jsonl`: emoji, right-to-left text, combining characters, and zero-width spaces in content fields and server names.
8. `08-secrets-in-hooks.jsonl`: failing hooks (non-zero `exitCode`, `hookErrors`, and other `hook_*` problem types) whose `command` and `stderr` contain the fake key, Bearer tokens, `API_KEY=...`, and long hex strings.

Finally, write `test/fixtures/forged/README.md` with one line per file saying what it attacks.
````

- [ ] **Step 3: Write `test/forged.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFakeHome } from './helpers/fakeHome.js';

const forgedDir = fileURLToPath(new URL('./fixtures/forged/', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const files = existsSync(forgedDir) ? readdirSync(forgedDir).filter(f => f.endsWith('.jsonl')).sort() : [];
const CANARIES = ['CANARY_DO_NOT_PRINT', 'sk-ant-FAKE'];

function runOn(name, args) {
  const home = makeFakeHome();
  try {
    home.writeLog(join('forged', name), readFileSync(join(forgedDir, name), 'utf8'));
    return spawnSync(process.execPath, [cli, '--days', '3650', ...args], { env: home.env, encoding: 'utf8' });
  } finally {
    home.cleanup();
  }
}

test('all 8 forged fixtures exist', () => {
  assert.equal(files.length, 8, `found: ${files.join(', ')}`);
});

for (const name of files) {
  test(`forged ${name}: no crash, no leaks`, () => {
    for (const args of [['--json'], ['--all']]) {
      const r = runOn(name, args);
      assert.ok(r.status === 0 || r.status === 1, `exit ${r.status} with ${args}: ${r.stderr}`);
      for (const canary of CANARIES) {
        assert.ok(!r.stdout.includes(canary), `${canary} leaked to stdout with ${args}`);
        assert.ok(!r.stderr.includes(canary), `${canary} leaked to stderr with ${args}`);
      }
    }
  });
}

const statsOf = name => JSON.parse(runOn(name, ['--json']).stdout).stats;

test('forged: unknown types are counted, not dropped', () => {
  const stats = statsOf('01-unknown-types.jsonl');
  assert.ok(Object.values(stats.unrecognized).reduce((a, b) => a + b, 0) >= 10);
});

test('forged: truncated lines are counted as bad lines', () => {
  assert.ok(statsOf('03-truncated-lines.jsonl').badLines >= 5);
});

test('forged: the future version shows up in the version range', () => {
  assert.equal(statsOf('04-future-version.jsonl').versions.max, '9.9.9');
});
```

- [ ] **Step 4 (controller): Run the log-forger agent**

Dispatch a subagent with `model: "sonnet"` and this prompt:

> Work in the repository root. You are the log-forger agent. Read `.claude/agents/log-forger.md` and follow its instructions exactly.

- [ ] **Step 5: Check the forged files contain no real data**

Run (Git Bash): `grep -rilE 'Desktop|AppData|Users[\\/]' test/fixtures/forged/ || echo clean`
Expected: `clean`

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS.
- **If a canary leaks,** that's a real bug in silentfail. Fix the code, never the fixture, then rerun.
- **If a file-specific assertion fails because the agent missed a requirement** (for example, fewer than 10 unknown types), dispatch the agent again with the failing requirement quoted.

- [ ] **Step 7: Commit**

```bash
git add test/LOG-SHAPES.md .claude/agents/log-forger.md test/forged.test.js test/fixtures/forged
git commit -m "test: forged adversarial logs from the log-forger agent" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Stress test

**Files:**
- Create: `test/stress/make-big.js`, `test/stress/child.js`, `test/stress/big-file.stress.js`

**Interfaces:**
- Consumes: `run` (Task 10) and the forged fixtures (Task 11).
- Produces: `makeBigHome(targetBytes?): Promise<{ dir, bytes }>`.

- [ ] **Step 1: Write `test/stress/make-big.js`**

```js
import { createWriteStream, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds a fake Claude config folder holding one huge session log made of the
// forged fixtures repeated, written with backpressure so it never sits in memory.
export async function makeBigHome(targetBytes = 200 * 1024 * 1024) {
  const dir = mkdtempSync(join(tmpdir(), 'silentfail-stress-'));
  const logDir = join(dir, 'projects', 'stress');
  mkdirSync(logDir, { recursive: true });
  const forged = fileURLToPath(new URL('../fixtures/forged/', import.meta.url));
  const chunk = readdirSync(forged)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .map(f => readFileSync(join(forged, f), 'utf8'))
    .map(t => (t.endsWith('\n') ? t : `${t}\n`))
    .join('');
  const size = Buffer.byteLength(chunk);
  const out = createWriteStream(join(logDir, 'big.jsonl'));
  let bytes = 0;
  while (bytes < targetBytes) {
    if (!out.write(chunk)) await once(out, 'drain');
    bytes += size;
  }
  out.end();
  await once(out, 'finish');
  return { dir, bytes };
}
```

- [ ] **Step 2: Write `test/stress/child.js`**

```js
// Runs the silentfail pipeline once and prints wall time and peak memory as JSON.
import { run } from '../../src/run.js';

let peak = process.memoryUsage().rss;
const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25);
const start = Date.now();
const result = await run({ days: 3650 });
clearInterval(timer);
peak = Math.max(peak, process.memoryUsage().rss);
process.stdout.write(JSON.stringify({ ms: Date.now() - start, peakRss: peak, badLines: result.stats.badLines }));
```

- [ ] **Step 3: Write `test/stress/big-file.stress.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeBigHome } from './make-big.js';

test('streams a 200 MB log set in under 60 s and 256 MB of memory', { timeout: 300_000 }, async () => {
  const { dir, bytes } = await makeBigHome();
  try {
    const child = fileURLToPath(new URL('./child.js', import.meta.url));
    const r = spawnSync(process.execPath, [child], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8', timeout: 240_000 });
    assert.equal(r.status, 0, r.stderr);
    const { ms, peakRss } = JSON.parse(r.stdout);
    console.log(`read ${(bytes / 1048576).toFixed(0)} MB in ${(ms / 1000).toFixed(1)} s, peak memory ${(peakRss / 1048576).toFixed(0)} MB`);
    assert.ok(ms < 60_000, `took ${ms} ms`);
    assert.ok(peakRss < 256 * 1024 * 1024, `peak memory ${(peakRss / 1048576).toFixed(0)} MB`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run it**

Run: `npm run test:stress`
Expected: PASS, printing a line like `read 200 MB in 12.3 s, peak memory 140 MB`.
If it fails on time or memory, **do not change the thresholds.** Report the printed numbers back to the controller. The likely fix is aggregating facts per key inside `run.js` instead of keeping every fact, and that is a design decision for the controller.

- [ ] **Step 5: Confirm the regular suite is unaffected, then commit**

Run: `npm test`
Expected: PASS, and the stress test does NOT run as part of it.

```bash
git add test/stress
git commit -m "test: 200 MB streaming stress test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: CI, README and the real-machine check

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: the finished CLI.
- Produces: a publishable package (publishing itself is a user action, not part of this plan).

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [22, 24]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm test
```

- [ ] **Step 2: Run the real-machine check**

Run: `node src/cli.js --days 90`
Expected: exit code 1, and the BROKEN section contains `[x] MCP filesystem: 2 of 2 calls failed`. Save the full output for the controller to review. If the `filesystem` line is missing, stop and report back; that means the extractors or config loading are wrong for real logs.

- [ ] **Step 3: Write `README.md`**

For the example block, use lines from the Step 2 output:
- **Keep:** the header line, the `filesystem` line, and the `OK:` summary line.
- **Remove:** any line that names a personal connector, an account, or a file path.

````markdown
# silentfail

Finds the parts of your Claude Code setup that look fine but are broken.

```
npx silentfail
```

```
<paste the trimmed lines from the real-machine run here, see Step 3 above>
```

## What it checks

| Finding | Severity | Meaning |
|---|---|---|
| MCP call failures | broken or warning | Calls to an MCP server keep failing (broken at 50% or more with 2+ calls, warning at 20% or more) |
| MCP connection failures | broken | A server failed to connect |
| MCP needs auth | warning | A server kept asking you to log in |
| MCP stuck pending | warning | A server never finished connecting |
| MCP never seen | warning | A server is in your config but never loaded |
| Hook errors | broken | A hook exited non-zero or errored |
| Slow hooks | warning | A hook took over 10 seconds |
| Hook never ran | warning | A configured SessionStart or Stop hook never ran |
| Can't verify | unknown | A hook on an event that leaves no trace when it succeeds |

## Privacy

- It runs entirely on your machine. Nothing is uploaded, and there's no telemetry.
- It reads Claude Code's own session logs (`~/.claude/projects`) and your config files. It never prints your conversations.
- Anything that looks like a key or token is blanked out before it's printed.

## Options

```
--days <n>     how many days of session logs to read (default 14)
--json         print JSON instead of the report
--all          also list everything that is fine, and unrecognized log shapes
```

Exit codes: `0` nothing broken, `1` something is broken, `2` silentfail couldn't run.

## How it works

Claude Code writes a log of every session to disk, and those logs record which MCP servers failed to connect, which tool calls failed, and how hooks ran. silentfail reads those logs, compares them with your settings, plugins and `.mcp.json` files, and reports the difference.

## Limitations

- Some hook events leave no trace in the logs when they succeed. Those show as UNKNOWN, never as broken.
- The log format isn't an official API. New Claude Code versions can add entry types. silentfail counts anything it doesn't recognize instead of crashing, and says so at the bottom of the report.

## Contributing

- `npm test` runs the suite.
- `npm run test:stress` runs the 200 MB streaming test.
- New adversarial fixtures come from the `log-forger` agent in `.claude/agents/`.

## License

MIT
````

- [ ] **Step 4: Check the package contents**

Run: `npm pack --dry-run`
Expected: the file list contains only `LICENSE`, `README.md`, `package.json` and files under `src/`. No `test/` and no `docs/`.

- [ ] **Step 5: Run everything once more**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Controller review, then commit**

The controller shows the user the README example block before committing.
```bash
git add .github/workflows/ci.yml README.md
git commit -m "docs: README, CI matrix" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the plan: user actions (not tasks)

These need the user's own accounts, so they're not automated:
1. Create a GitHub repo named `silentfail` and push. CI runs on the first push.
2. `npm login`, then `npm publish`.
3. Post the launch: r/ClaudeAI, the Claude Discord, and Show HN.
