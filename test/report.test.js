import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJson } from '../src/report/json.js';
import { renderText } from '../src/report/text.js';

const result = {
  findings: [
    { id: 'mcp-call-errors', severity: 'broken', subject: 'MCP filesystem', message: '2 of 2 calls failed', evidence: { calls: 2, errors: 2, lastError: '2026-09-23T08:00:00.000Z' } },
    { id: 'hook-error', severity: 'broken', subject: 'Hook Stop (user settings)', message: 'failed 1 time (exit code 1)', evidence: { event: 'Stop', command: 'curl -H "Authorization: Bearer sk-ant-FAKE0000000000000000" x', stderr: 'boom sk-ant-FAKE0000000000000000\nline two', last: '2026-09-22T00:00:00.000Z' } },
    { id: 'mcp-needs-auth', severity: 'warning', subject: 'MCP plugin:cloudflare:cloudflare', message: 'needs auth in 9 of 9 sessions', evidence: {} },
    { id: 'hook-no-trace', severity: 'unknown', subject: 'Hook PreToolUse (plugin superpowers)', message: "can't verify: successful PreToolUse hooks leave no trace in the logs", evidence: {} },
    { id: 'mcp-ok', severity: 'ok', subject: 'MCP memory', message: '3 calls, 0 failed', evidence: {} },
    { id: 'hook-ok', severity: 'ok', subject: 'Hook SessionStart (plugin superpowers)', message: 'ran', evidence: {} },
  ],
  stats: {
    files: 3, sessions: 37, badLines: 2,
    unrecognized: { 'attachment/new_thing': 12 },
    versions: { min: '2.1.229', max: '2.1.281' },
    warnings: ['could not parse /x/settings.json'],
  },
};

test('text report groups findings and never prints secrets', () => {
  assert.equal(renderText(result, { days: 14 }), [
    'silentfail: 37 sessions, last 14 days, Claude Code 2.1.229-2.1.281',
    '',
    'BROKEN',
    '  [x] MCP filesystem: 2 of 2 calls failed (last 2026-09-23)',
    '  [x] Hook Stop (user settings): failed 1 time (exit code 1) (last 2026-09-22)',
    '      command: curl -H "Authorization: Bearer [redacted]" x',
    '      stderr: boom [redacted]',
    '',
    'WARNING',
    '  [!] MCP plugin:cloudflare:cloudflare: needs auth in 9 of 9 sessions',
    '',
    'UNKNOWN',
    "  [?] Hook PreToolUse (plugin superpowers): can't verify: successful PreToolUse hooks leave no trace in the logs",
    '',
    'OK: 1 MCP server, 1 hook (--all to list)',
    '',
    '12 log lines not recognized (newer Claude Code?). This is not an error.',
    '2 unreadable log lines skipped.',
    'note: could not parse /x/settings.json',
    '',
  ].join('\n'));
});

test('text report colors only when asked', () => {
  assert.ok(!renderText(result, { days: 14 }).includes('\x1b['));
  assert.ok(renderText(result, { days: 14, color: true }).includes('\x1b[31mBROKEN\x1b[0m'));
});

test('--all lists ok items and unrecognized shapes', () => {
  const out = renderText(result, { days: 14, all: true });
  assert.ok(out.includes('OK\n  [ok] MCP memory: 3 calls, 0 failed\n  [ok] Hook SessionStart (plugin superpowers): ran\n'));
  assert.ok(out.includes('  12  attachment/new_thing'));
});

test('says so when nothing is broken', () => {
  const empty = { findings: [], stats: { files: 1, sessions: 1, badLines: 0, unrecognized: {}, versions: { min: null, max: null }, warnings: [] } };
  assert.equal(renderText(empty, { days: 7 }), 'silentfail: 1 session, last 7 days\n\nNothing broken found.\n\n');
});

test('says so when there are no session logs at all', () => {
  const empty = { findings: [], stats: { files: 0, sessions: 0, badLines: 0, unrecognized: {}, versions: { min: null, max: null }, warnings: [] } };
  assert.equal(renderText(empty, { days: 30 }), 'silentfail: 0 sessions, last 30 days\n\nNo Claude Code session logs in the last 30 days.\n\n');
});

test('command and stderr lines are hidden for unknown findings unless --all, and embedded newlines cannot fake a report line', () => {
  const injected = {
    findings: [
      { id: 'hook-no-trace', severity: 'unknown', subject: 'Hook X (user settings)', message: 'line one\nline two', evidence: { command: 'sneaky.sh', stderr: 'oops' } },
    ],
    stats: { files: 1, sessions: 1, badLines: 0, unrecognized: {}, versions: { min: null, max: null }, warnings: [] },
  };
  const out = renderText(injected, { days: 14 });
  const bodyLines = out.split('\n').filter(l => l.startsWith('  ['));
  assert.deepEqual(bodyLines, ['  [?] Hook X (user settings): line one line two']);
  assert.ok(!out.includes('command:'));
  assert.ok(!out.includes('stderr:'));
  const all = renderText(injected, { days: 14, all: true });
  assert.ok(all.includes('command: sneaky.sh'));
  assert.ok(all.includes('stderr: oops'));
});

test('json report is redacted, object keys included', () => {
  const withBadKey = { ...result, stats: { ...result.stats, unrecognized: { 'x/sk-ant-FAKE0000000000000000': 1 } } };
  const text = renderJson(withBadKey, { days: 14 });
  assert.ok(!text.includes('sk-ant-FAKE'));
  const json = JSON.parse(text);
  assert.equal(json.tool, 'silentfail');
  assert.equal(json.schema, 1);
  assert.equal(json.days, 14);
  assert.equal(json.findings.length, 6);
});

test('json report cuts stderr to its first line and 120 characters, like the text report', () => {
  const json = JSON.parse(renderJson(result, { days: 14 }));
  assert.equal(json.findings[1].evidence.stderr, 'boom [redacted]');
  const long = { ...result, findings: [{ ...result.findings[1], evidence: { ...result.findings[1].evidence, stderr: 'e'.repeat(300) } }] };
  assert.equal(JSON.parse(renderJson(long, { days: 14 })).findings[0].evidence.stderr.length, 120);
});
