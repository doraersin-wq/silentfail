import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInside, later } from '../src/analyze/common.js';
import { analyzeMcp, createMcpAnalyzer } from '../src/analyze/mcp.js';
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

test('createMcpAnalyzer fed one fact at a time matches analyzeMcp', () => {
  const facts = [
    status('broken', 'failed', 's1'), status('broken', 'failed', 's2'),
    status('cf', 'needs-auth', 's1', 'plugin:cf:cf'), status('cf', 'needs-auth', 's2', 'plugin:cf:cf'), status('cf', 'connected', 's2', 'plugin:cf:cf'),
    status('slow', 'pending', 's1'),
    status('slow2', 'pending', 's1'), status('slow2', 'connected', 's1'),
  ];
  const analyzer = createMcpAnalyzer();
  for (const f of facts) analyzer.add(f);
  assert.deepEqual(analyzer.finish(noConfig, ctx), analyzeMcp(facts, noConfig, ctx));
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
