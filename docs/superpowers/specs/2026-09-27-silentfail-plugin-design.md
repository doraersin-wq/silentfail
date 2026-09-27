# silentfail v0.2: Claude Code plugin and `/silentfail`

**Date:** 2026-09-27
**Status:** Awaiting user review
**Builds on:** `2026-09-26-silentfail-design.md` (v0.1, shipped)

## 1. Purpose

silentfail v0.1 is a terminal CLI. v0.2 makes it a Claude Code plugin: the
user types `/silentfail` in any session, the report is produced on their
machine, and Claude explains each problem in plain words and offers a
specific fix.

### Success criteria

1. `/silentfail` works on a machine where the plugin was installed from the
   repo. No npm is needed, and it works offline.
2. The plugin run never aborts just because silentfail found something
   broken.
3. Nothing the user or Claude types reaches a shell command through the
   skill. The pre-run command takes no arguments.
4. Claude never changes settings, config files or plugins on its own. It
   proposes a fix and waits for a yes.
5. `claude plugin validate .` passes, or, if the bundled CLI refuses to run
   it, that is reported rather than skipped.

### Non-goals (v0.2)

- The hook tracer, the skills and plugins check, and the weekly format check.
  Those are later pieces (B, C and D in the v2 breakdown).
- Publishing to npm or GitHub. Those remain user actions.
- Any change to what silentfail detects or how it grades findings.

## 2. Decisions (made during brainstorming)

| Question | Decision | Why |
|---|---|---|
| What `/silentfail` does | It runs the report, then Claude explains each finding and offers a fix, asking before any change | It's the value a terminal can't give; auto-fixing configs on day one is too risky |
| Packaging | The repo is the plugin and its own marketplace, and runs the bundled `src/cli.js` | No npm, works offline, version-locked |
| Skill vs. command | A skill (`skills/silentfail/SKILL.md`) | The docs say to prefer skills for new plugins |
| How the report reaches Claude | Pre-run injection (`` ```! `` block): the report is already in the prompt | Chosen by the user; the exit-code and argument risks are handled below |
| Auto-invocation | Allowed: Claude may use it by itself when the user is debugging hooks, MCP or plugins | It's read-only and local, and its output is redacted |

## 3. What gets built

### 3.1 `--exit-zero` CLI flag

`src/main.js` gets a new boolean flag `--exit-zero`. When it's set, a
successful scan exits `0` even if there are broken findings. Setup errors and
bugs still exit `2`. It's listed in `--help`. Nothing else changes.

This matters because a pre-run command that exits non-zero may abort the
skill, and exit code `1` is silentfail's normal "found something" signal.

### 3.2 `.claude-plugin/plugin.json`

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

`package.json` `version` becomes `0.2.0` too. A test keeps the two equal.

### 3.3 `.claude-plugin/marketplace.json`

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

Install commands for the README:
- `/plugin marketplace add <github-user>/silentfail`, then `/plugin install silentfail@silentfail`.
- From a local clone: `/plugin marketplace add ./silentfail`.

### 3.4 `skills/silentfail/SKILL.md` (exact content)

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

**Why the pre-run takes no arguments:** `$ARGUMENTS` would substitute
user- or model-supplied text into a shell command. Because Claude can invoke
the skill itself, that's an injection path. Step 8 covers custom windows
instead, through a normal Bash call that the user's permission rules govern.

**`allowed-tools: Bash(node *)`** pre-approves `node` commands for the turn
the skill runs in, so the pre-run doesn't abort outside auto mode. It covers
only that turn. Deny and ask rules still override it.

### 3.5 README

Add a section **"Inside Claude Code"** after the options section:
- the two install commands
- that `/silentfail` shows the report and has Claude walk through fixes
- that Claude asks before changing anything
- that the report, not the logs, is what Claude sees

## 4. Testing

Test-first, using `node --test` as in v0.1.

- **`--exit-zero`** (`test/e2e.test.js`): on the existing broken fake setup,
  `--json --exit-zero` exits `0` and the JSON still contains the broken
  `filesystem` finding. The existing test without the flag still expects `1`.
- **`--help`** (`test/main.test.js`): the help text lists `--exit-zero`.
- **Plugin structure** (`test/plugin.test.js`, new):
  - `plugin.json` parses, its `name` is `silentfail`, and its `version`
    equals `package.json`'s version.
  - `marketplace.json` parses, its `owner.name` is non-empty, and it has
    exactly one plugin named `silentfail` with source `./`.
  - `SKILL.md` frontmatter has `name: silentfail`, a non-empty
    `description`, and `allowed-tools` containing `Bash(node *)`.
  - The body contains the exact pre-run line
    `node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" --json --exit-zero` inside a
    `` ```! `` block.
  - The body contains no `$ARGUMENTS` and no `$0`-`$9` placeholder. This
    locks the injection guard in place.
- **Official check:** run `claude plugin validate .` with the CLI bundled in
  the desktop app. Record the output. If it refuses (for example, it isn't
  logged in), report that.
- **Live check** (needs the user's OK, since it changes their plugin
  config):
  1. Add the local repo as a marketplace and install the plugin.
  2. Start a fresh session and run `/silentfail`.
  3. Expect Claude to explain the real `filesystem` failure and offer a fix
     without applying it.

## 5. Risks

| Risk | Mitigation |
|---|---|
| A pre-run command that exits non-zero aborts the skill | `--exit-zero` |
| Outside auto mode, an unapproved pre-run aborts the skill | `allowed-tools: Bash(node *)` |
| The skill's name clashes with another `/silentfail` command | `/silentfail:silentfail` always works |
| `node` isn't on the PATH Claude Code uses | Claude Code users already run Node-based tooling. If the pre-run fails, step 1 of the skill reports it plainly |
| Report JSON size | The JSON lists every finding, OK rows included. On the author's machine that's about 30 findings, a few KB, which fits comfortably in a prompt |
| `<github-user>` in the README isn't known yet | The GitHub account doesn't exist yet. The local-clone command works today, and the GitHub one is filled in when the repo is created |
