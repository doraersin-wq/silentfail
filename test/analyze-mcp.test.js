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

test('rejected and interrupted calls are not counted at all', () => {
  const rejected = { kind: 'mcp-call', server: 'fs', name: 'fs', ok: false, rejected: true, sessionId: 's1', cwd: '/w/p', ts: '2026-09-20T10:00:00.000Z' };
  const facts = [rejected, rejected, call('fs', true)];
  assert.deepEqual(pick(analyzeMcp(facts, noConfig, ctx)), [['mcp-ok', 'ok', 'MCP fs', '1 call, 0 failed']]);
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
  // status('seen', 'connected') gives the analyzer connection-status evidence, so
  // never-seen findings elsewhere stay 'warning' rather than 'unknown' (F4b).
  const facts = [call('seen', true), status('seen', 'connected')];
  assert.deepEqual(pick(analyzeMcp(facts, cfg, ctx)), [
    ['mcp-ok', 'ok', 'MCP seen', '1 call, 0 failed'],
    ['mcp-never-seen', 'warning', 'MCP ghost', 'configured (user scope) but never showed up in the logs'],
    ['mcp-never-seen', 'warning', 'MCP here', 'configured (project scope) but never showed up in the logs'],
  ]);
});

test('never-seen is unknown, not warning, when the logs record no connection status at all', () => {
  const cfg = { hooks: [], mcpServers: [{ key: 'ghost', label: 'ghost', scope: 'user', project: null, source: '.claude.json' }] };
  assert.deepEqual(pick(analyzeMcp([], cfg, ctx)), [
    ['mcp-never-seen', 'unknown', 'MCP ghost', "can't verify: these logs don't record which servers connected"],
  ]);
});

test('a server that is in your config but not enabled for the project is never flagged never-seen', () => {
  const cfg = { hooks: [], mcpServers: [{ key: 'ghost', label: 'ghost', scope: 'project', project: '/w/p', source: '/w/p/.mcp.json', enabled: false }] };
  assert.deepEqual(pick(analyzeMcp([status('other', 'connected')], cfg, ctx)), [
    ['mcp-ok', 'ok', 'MCP other', 'connected in 1 of 1 session'],
  ]);
});

test('a server that failed then connected later in the same session is not a failed-connect', () => {
  const facts = [status('flaky', 'failed', 's1'), status('flaky', 'connected', 's1')];
  assert.deepEqual(pick(analyzeMcp(facts, noConfig, ctx)), [
    ['mcp-ok', 'ok', 'MCP flaky', 'connected in 1 of 1 session'],
  ]);
});

test('broken and never-seen servers carry an MCP Inspector command from the config', () => {
  const cfg = { hooks: [], mcpServers: [
    { key: 'fs', label: 'fs', scope: 'project', project: '/w/p', source: 'x', enabled: true, command: 'npx', args: ['-y', 'fs-server'] },
    { key: 'ghost', label: 'ghost', scope: 'user', project: null, source: 'y', enabled: true, command: 'node', args: ['ghost.js'] },
  ] };
  const facts = [status('fs', 'connected'), call('fs', false), call('fs', false), status('other', 'connected')];
  const findings = analyzeMcp(facts, cfg, ctx);
  assert.equal(findings.find(f => f.id === 'mcp-call-errors').evidence.inspect, 'npx @modelcontextprotocol/inspector npx -y fs-server');
  assert.equal(findings.find(f => f.id === 'mcp-never-seen').evidence.inspect, 'npx @modelcontextprotocol/inspector node ghost.js');
});

test('needs-auth and ok findings carry no Inspector command', () => {
  const cfg = { hooks: [], mcpServers: [{ key: 'cf', label: 'cf', scope: 'user', project: null, source: 'x', enabled: true, command: 'node', args: ['cf.js'] }] };
  const [f] = analyzeMcp([status('cf', 'needs-auth')], cfg, ctx);
  assert.equal(f.id, 'mcp-needs-auth');
  assert.equal(f.evidence.inspect, undefined);
});

// F4: a key can have more than one config entry (e.g. a user-scope server
// shadowed by a local-scope one for a project that actually ran). The local
// one should win.
test('when a key has both a user-scope and a ran local-scope entry, the Inspector command uses the local one', () => {
  const cfg = { hooks: [], mcpServers: [
    { key: 'fs', label: 'fs', scope: 'user', project: null, source: 'x', enabled: true, command: 'a', args: [] },
    { key: 'fs', label: 'fs', scope: 'local', project: '/w/p', source: 'y', enabled: true, command: 'b', args: [] },
  ] };
  const findings = analyzeMcp([call('fs', false), call('fs', false)], cfg, ctx);
  const f = findings.find(x => x.id === 'mcp-call-errors');
  assert.equal(f.evidence.inspect, 'npx @modelcontextprotocol/inspector b');
});

// F8: fill test gaps for mcp-failed-connect, mcp-stuck-pending and mcp-ok.
test('mcp-failed-connect and mcp-stuck-pending carry an Inspector command; mcp-ok does not', () => {
  const cfg = { hooks: [], mcpServers: [
    { key: 'broken', label: 'broken', scope: 'user', project: null, source: 'x', enabled: true, command: 'node', args: ['broken.js'] },
    { key: 'slow', label: 'slow', scope: 'user', project: null, source: 'x', enabled: true, command: 'node', args: ['slow.js'] },
    { key: 'fine', label: 'fine', scope: 'user', project: null, source: 'x', enabled: true, command: 'node', args: ['fine.js'] },
  ] };
  const facts = [
    status('broken', 'failed', 's1'),
    status('slow', 'pending', 's1'),
    status('fine', 'connected', 's1'),
  ];
  const findings = analyzeMcp(facts, cfg, ctx);
  assert.equal(findings.find(f => f.id === 'mcp-failed-connect').evidence.inspect, 'npx @modelcontextprotocol/inspector node broken.js');
  assert.equal(findings.find(f => f.id === 'mcp-stuck-pending').evidence.inspect, 'npx @modelcontextprotocol/inspector node slow.js');
  assert.equal(findings.find(f => f.id === 'mcp-ok').evidence.inspect, undefined);
});
