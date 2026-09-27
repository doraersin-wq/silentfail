# silentfail v0.2 Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship silentfail as a Claude Code plugin whose `/silentfail` skill pre-runs the bundled CLI and has Claude explain each finding and offer a fix.

**Architecture:** The repository root becomes the plugin and its own marketplace (`.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`). A single skill, `skills/silentfail/SKILL.md`, pre-runs `node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" --json --exit-zero` through a `` ```! `` block. A new `--exit-zero` CLI flag stops the "found something" exit code from aborting that pre-run.

**Tech Stack:** Node >= 22, ES modules, `node:test`, zero dependencies. Plugin files are JSON and Markdown.

**Spec:** `docs/superpowers/specs/2026-09-27-silentfail-plugin-design.md`

**Execution notes:**
- Implementers run on Sonnet 5 and the controller on Opus 5.5.
- Task 3 is controller-only.
- The machine is Windows 10 with Git Bash and Node 22.22. 105 tests pass before Task 1.

## Global Constraints

- Zero npm dependencies. `npm test` runs `node --test "test/**/*.test.js"`.
- The pre-run command takes **no arguments**. `SKILL.md` must never contain `$ARGUMENTS` or a `$0`-`$9` placeholder.
- The skill must tell Claude never to change settings, config files or plugins itself, and to offer the fix and wait for a yes.
- `--exit-zero`: a successful scan exits `0` even with broken findings. Setup errors and bugs still exit `2`.
- `plugin.json` `version` equals `package.json` `version`, and both are `0.2.0`.
- The npm package's `files` list stays `["src/", "README.md", "LICENSE"]`. The plugin files don't ship to npm.
- No personal paths or details in any file. The author/owner name is "SilentBuilder".
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, passed as a second `-m`.

---

### Task 1: `--exit-zero` flag

**Files:**
- Modify: `src/main.js` (the `HELP` string, the `OPTIONS` object, and the `return` after a successful run)
- Test: `test/main.test.js`, `test/e2e.test.js`

**Interfaces:**
- Consumes: the existing `main(argv, io)` and the e2e helpers `brokenHome()` and `runCli(env, ...args)` in `test/e2e.test.js`.
- Produces: the CLI flag `--exit-zero`. Task 2's `SKILL.md` calls `--json --exit-zero`.

- [ ] **Step 1: Write the failing tests**

Append to `test/main.test.js`:

```js
test('--help lists --exit-zero', async () => {
  const t = io();
  assert.equal(await main(['--help'], t.opts), 0);
  assert.match(t.out.text, /--exit-zero/);
});
```

Append to `test/e2e.test.js`:

```js
test('end to end: --exit-zero exits 0 but still reports the broken finding', () => {
  const home = brokenHome();
  try {
    const r = runCli(home.env, '--json', '--exit-zero');
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.ok(json.findings.some(f => f.id === 'mcp-call-errors' && f.severity === 'broken' && f.subject === 'MCP filesystem'));
  } finally {
    home.cleanup();
  }
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test test/main.test.js test/e2e.test.js`
Expected: 2 failures:
- the help test: no `--exit-zero` in the output
- the e2e test: exit `2`, because parseArgs rejects the unknown option `--exit-zero`

- [ ] **Step 3: Implement it in `src/main.js`**

In `HELP`, add this line directly after the `--all` line, keeping the column alignment:

```text
  --exit-zero    exit 0 even when something is broken (for scripts and the plugin)
```

In `OPTIONS`, add this entry after `all`:

```js
  'exit-zero': { type: 'boolean', default: false },
```

Replace the success return:

```js
    return result.findings.some(f => f.severity === 'broken') ? 1 : 0;
```

with:

```js
    const broken = result.findings.some(f => f.severity === 'broken');
    return broken && !args['exit-zero'] ? 1 : 0;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/main.test.js test/e2e.test.js`, then `npm test`
Expected: PASS, with 107 tests in total.

- [ ] **Step 5: Commit**

```bash
git add src/main.js test/main.test.js test/e2e.test.js
git commit -m "feat: --exit-zero flag for scripts and the plugin" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Plugin packaging

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/silentfail/SKILL.md`, `test/plugin.test.js`
- Modify:
  - `package.json`: `"version"` goes from `0.1.0` to `0.2.0`
  - `test/main.test.js`: the version expectation becomes `'0.2.0\n'`
  - `README.md`: a new section, plus one line in the Options block

**Interfaces:**
- Consumes: the `--exit-zero` flag from Task 1.
- Produces: the installable plugin. Task 3 validates and installs it.

- [ ] **Step 1: Write the failing test `test/plugin.test.js`**

~~~js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const json = rel => JSON.parse(read(rel));

function skill() {
  const text = read('skills/silentfail/SKILL.md').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, 'SKILL.md needs a --- frontmatter block');
  const front = Object.fromEntries(
    m[1].split('\n').filter(Boolean).map(line => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  return { front, body: m[2] };
}

test('plugin.json names the plugin and matches the package version', () => {
  const plugin = json('.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'silentfail');
  assert.equal(plugin.version, json('package.json').version);
});

test('marketplace.json lists exactly this plugin from the repo root', () => {
  const market = json('.claude-plugin/marketplace.json');
  assert.ok(market.owner && market.owner.name, 'owner.name is required');
  assert.deepEqual(market.plugins.map(p => [p.name, p.source]), [['silentfail', './']]);
});

test('the skill frontmatter names it, describes it and pre-approves node', () => {
  const { front } = skill();
  assert.equal(front.name, 'silentfail');
  assert.ok(front.description.length > 40);
  assert.match(front['allowed-tools'], /Bash\(node \*\)/);
});

test('the skill pre-runs exactly the bundled CLI with --json --exit-zero', () => {
  const { body } = skill();
  assert.ok(body.includes('```!\nnode "${CLAUDE_PLUGIN_ROOT}/src/cli.js" --json --exit-zero\n```'));
});

test('no user or model text can reach the pre-run shell command', () => {
  const { body } = skill();
  assert.ok(!body.includes('$ARGUMENTS'));
  assert.doesNotMatch(body, /\$\d/);
});
~~~

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/plugin.test.js`
Expected: FAIL. ENOENT for `.claude-plugin/plugin.json` and the other missing files.

- [ ] **Step 3: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "silentfail",
  "version": "0.2.0",
  "description": "Finds the parts of your Claude Code setup that look fine but are broken: MCP servers and hooks, from your own session logs.",
  "author": { "name": "SilentBuilder" },
  "license": "MIT",
  "keywords": ["mcp", "hooks", "diagnostics", "doctor"]
}
```

- [ ] **Step 4: Create `.claude-plugin/marketplace.json`**

```json
{
  "name": "silentfail",
  "owner": { "name": "SilentBuilder" },
  "plugins": [
    {
      "name": "silentfail",
      "source": "./",
      "description": "Finds MCP servers and hooks that look fine but are broken, and has Claude explain the fix."
    }
  ]
}
```

- [ ] **Step 5: Create `skills/silentfail/SKILL.md` with exactly this content**

~~~markdown
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
~~~

- [ ] **Step 6: Bump the version and fix the version test**

- In `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`. Leave `files` unchanged.
- In `test/main.test.js`, in the test `--version prints the package version`, change `'0.1.0\n'` to `'0.2.0\n'`.

- [ ] **Step 7: Update `README.md`**

In the Options code block, add this line after the `--all` line:

```text
--exit-zero    exit 0 even when something is broken (for scripts and the plugin)
```

Insert this section directly before `## How it works`:

~~~markdown
## Inside Claude Code

silentfail is also a Claude Code plugin. Install it once:

```
/plugin marketplace add <github-user>/silentfail
/plugin install silentfail@silentfail
```

From a local clone, use `/plugin marketplace add ./silentfail` instead.

Then type `/silentfail` in any session. The report runs on your machine, and Claude walks you through each problem and how to fix it. It asks before changing anything. Claude sees the report, not your session logs.
~~~

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `node --test test/plugin.test.js test/main.test.js`, then `npm test`
Expected: PASS, with 112 tests in total (107 + 5).

- [ ] **Step 9: Commit**

```bash
git add .claude-plugin skills test/plugin.test.js test/main.test.js package.json README.md
git commit -m "feat: Claude Code plugin with the /silentfail skill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Official validation and live check (controller only)

**Files:** none changed unless validation reports a problem. If it does, a fix goes through an implementer and review.

- [ ] **Step 1: Run the official validator**

Run (Git Bash):
```bash
CLAUDE_EXE="$APPDATA/Claude/claude-code/$(ls "$APPDATA/Claude/claude-code" | sort -V | tail -1)/claude.exe"; "$CLAUDE_EXE" plugin validate .
```
Expected: no errors. Record the output in the ledger.
- If it refuses to run (for example, "Not logged in"), record that. The structure tests from Task 2 remain the check.
- If it reports errors, dispatch an implementer to fix them, with a review.

- [ ] **Step 2: Live check, with the user's explicit OK first (it changes their plugin config)**

```bash
"$CLAUDE_EXE" plugin marketplace add .
"$CLAUDE_EXE" plugin install silentfail@silentfail
```
Then the user opens a fresh session and types `/silentfail`.

Expected:
- Claude explains the real `filesystem` failure in plain words and offers a fix without applying it.
- The `computer-use` and Cloudflare warnings are explained.
- Nothing is changed without a yes.
