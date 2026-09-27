import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { inspectorCommand } from '../src/analyze/inspect.js';

test('builds the MCP Inspector command for a stdio server', () => {
  assert.equal(
    inspectorCommand({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/work/dir'] }),
    'npx @modelcontextprotocol/inspector npx -y @modelcontextprotocol/server-filesystem /work/dir',
  );
});

test('quotes arguments that need it', () => {
  assert.equal(
    inspectorCommand({ command: 'node', args: ['C:/My Tools/server.js', 'a"b'] }),
    'npx @modelcontextprotocol/inspector node "C:/My Tools/server.js" "a\\"b"',
  );
});

test('returns null when there is nothing runnable to hand off', () => {
  assert.equal(inspectorCommand({ command: null, args: [] }), null);
  assert.equal(inspectorCommand({ command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/s.js'] }), null);
  assert.equal(inspectorCommand(undefined), null);
});

test('quotes a Windows path without stripping its backslashes', () => {
  assert.equal(
    inspectorCommand({ command: 'node', args: ['C:\\Users\\name\\server.js'] }),
    'npx @modelcontextprotocol/inspector node "C:\\Users\\name\\server.js"',
  );
});

test('keeps a non-plugin ${VAR} reference literally for the user\'s shell to expand', () => {
  assert.equal(
    inspectorCommand({ scope: 'project', command: 'node', args: ['${HOME}/srv.js'] }),
    'npx @modelcontextprotocol/inspector node "${HOME}/srv.js"',
  );
});

test('returns null for any plugin-scoped server, regardless of its command', () => {
  assert.equal(inspectorCommand({ scope: 'plugin', command: 'node', args: ['x.js'] }), null);
});

test('escapes a bare $ that is not part of a ${...} reference', () => {
  assert.equal(
    inspectorCommand({ command: 'node', args: ['a$b'] }),
    'npx @modelcontextprotocol/inspector node "a\\$b"',
  );
});

// F1: a part that starts with the home folder becomes ${HOME}, unescaped, so
// bash/zsh/Git Bash/PowerShell expand it even though the whole arg is quoted.
test('rewrites a home-folder prefix to the literal ${HOME}', () => {
  assert.equal(
    inspectorCommand({ command: 'node', args: [join(homedir(), 'mcp', 's.js')] }),
    `npx @modelcontextprotocol/inspector node "\${HOME}${sep}mcp${sep}s.js"`,
  );
});

test('does not rewrite a path that merely starts with the same letters as the home folder', () => {
  const out = inspectorCommand({ command: 'node', args: [homedir() + 'x'] });
  assert.ok(!out.includes('${HOME}'));
});

// F3: a backslash right before \, ", $, a backtick, or the end of the arg is
// doubled first, before the existing "," `, $ escaping runs.
test('doubles a trailing backslash inside a quoted arg', () => {
  assert.equal(
    inspectorCommand({ command: 'x', args: ['D:\\work\\'] }),
    'npx @modelcontextprotocol/inspector x "D:\\work\\\\"',
  );
});

test('doubles a backslash that precedes another backslash', () => {
  assert.equal(
    inspectorCommand({ command: 'x', args: ['\\\\srv\\share'] }),
    'npx @modelcontextprotocol/inspector x "\\\\\\srv\\share"',
  );
});

test('doubles a backslash that precedes a dollar sign, then escapes the dollar sign', () => {
  assert.equal(
    inspectorCommand({ command: 'x', args: ['D:\\$tmp'] }),
    'npx @modelcontextprotocol/inspector x "D:\\\\\\$tmp"',
  );
});
