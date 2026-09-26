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

test('hook_system_message is not a problem and is left for the unrecognized counter', () => {
  assert.deepEqual(extractHookRuns({ ...base, type: 'attachment', attachment: { type: 'hook_system_message', hookEvent: 'SessionStart' } }), []);
});

test('hook_blocking_error is an intentional block, not a failure', () => {
  assert.deepEqual(extractHookRuns({ ...base, type: 'attachment', attachment: { type: 'hook_blocking_error', hookEvent: 'PreToolUse', command: 'x', stderr: 'blocked' } }), []);
});

test('hook_success with exit code 2 is not failed and keeps no stderr', () => {
  const [fact] = extractHookRuns({ ...base, type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'SessionStart', command: 'x', exitCode: 2, stderr: 'not really an error' } });
  assert.equal(fact.exitCode, 2);
  assert.equal(fact.stderr, null);
  assert.equal(fact.problemType, null);
});

test('commands read from the log are trimmed like config commands', () => {
  const [fact] = extractHookRuns({ ...base, type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'SessionStart', command: '  start.sh  ', exitCode: 0 } });
  assert.equal(fact.command, 'start.sh');
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

test('createExtractor caps distinct unrecognized shapes at 200, bumping (other) after that', () => {
  const { extract, state } = createExtractor();
  for (let i = 0; i < 250; i++) extract({ type: `brand-new-thing-${i}` });
  assert.equal(state.unrecognized.size, 201);
  assert.equal(state.unrecognized.get('(other)'), 50);
});

test('createExtractor counts entries that make an extractor throw instead of crashing', () => {
  const { extract, state } = createExtractor();
  const evil = { type: 'user' };
  Object.defineProperty(evil, 'message', { get() { throw new Error('boom'); } });
  assert.deepEqual(extract(evil), []);
  assert.deepEqual([...state.unrecognized], [['user (extractor error)', 1]]);
});
