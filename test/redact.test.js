import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { redact, redactDeep, redactLine } from '../src/redact.js';

test('blanks Anthropic-style keys, including the canary', () => {
  assert.equal(redact('key sk-ant-FAKE0000000000000000 end'), 'key [redacted] end');
});

test('does not treat words containing "sk-" as keys', () => {
  assert.equal(redact('run-task-scheduler-now'), 'run-task-scheduler-now');
});

test('blanks GitHub, Slack and AWS tokens', () => {
  assert.equal(redact('ghp_' + 'a'.repeat(36)), '[redacted]');
  assert.equal(redact('github_pat_' + 'A1'.repeat(15)), '[redacted]');
  assert.equal(redact('xoxb-1234567890-abcdef'), '[redacted]');
  assert.equal(redact('AKIAABCDEFGHIJKLMNOP'), '[redacted]');
});

test('blanks bearer tokens and key=value secrets', () => {
  assert.equal(redact('curl -H "Authorization: Bearer abc.def.ghi" x'), 'curl -H "Authorization: Bearer [redacted]" x');
  assert.equal(redact('API_KEY=hunter2 next'), 'API_KEY=[redacted] next');
  assert.equal(redact('?token=abc&x=1'), '?token=[redacted]&x=1');
});

test('blanks long token-like runs but keeps UUIDs, plain words and paths', () => {
  assert.equal(redact('id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'), 'id [redacted]');
  assert.equal(redact('2f260b27-e634-4c15-a617-2cc3a83338fb'), '2f260b27-e634-4c15-a617-2cc3a83338fb');
  const hook = '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start';
  assert.equal(redact(hook), hook);
  const path = 'C:/Users/someone/.claude/plugins/cache/superpowers-dev/superpowers/6.3.0/hooks';
  assert.equal(redact(path), path);
});

test('blanks quoted or colon-separated key=value pairs, and flag-style secrets', () => {
  assert.equal(redact('API_KEY="abc123"'), 'API_KEY="[redacted]"');
  assert.equal(redact('password: hunter2'), 'password: [redacted]');
  assert.equal(redact('--token abc123'), '--token [redacted]');
});

test('blanks Authorization: token|basic values, leaving Bearer to its own rule', () => {
  assert.equal(redact('Authorization: token abc'), 'Authorization: token [redacted]');
});

test('blanks URL userinfo', () => {
  assert.equal(redact('https://me:pw@host/x'), 'https://[redacted]@host/x');
});

test('replaces the home folder with ~, in both slash directions', () => {
  const p = join(homedir(), 'a');
  assert.equal(redact(p), `~${sep}a`);
  assert.equal(redact(homedir().replace(/\\/g, '/')), '~');
});

test('strips ANSI escapes and control characters, keeping newlines and tabs', () => {
  assert.equal(redact('a\x1b[2Jb'), 'ab');
  assert.equal(redact('line1\nline2\ttabbed\rcr'), 'line1\nline2\ttabbedcr');
});

test('redact treats null and undefined as empty', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(undefined), '');
});

test('redactLine keeps only the first line and caps the length', () => {
  assert.equal(redactLine('first sk-ant-FAKE0000000000000000\nsecond'), 'first [redacted]');
  const long = redactLine('x'.repeat(500));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('...'));
});

test('redactDeep redacts every string in nested data, keys included', () => {
  assert.deepEqual(
    redactDeep({ a: ['sk-ant-FAKE0000000000000000', 3], b: { c: 'ok' }, 'sk-ant-FAKE0000000000000000': 1 }),
    { a: ['[redacted]', 3], b: { c: 'ok' }, '[redacted]': 1 },
  );
});
