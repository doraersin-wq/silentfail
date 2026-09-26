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
