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
