import { test } from 'node:test';
import assert from 'node:assert/strict';
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
