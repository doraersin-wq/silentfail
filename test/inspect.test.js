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
