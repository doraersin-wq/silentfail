import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLogFiles, readEntries } from '../src/sources/logs.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'silentfail-logs-'));

test('findLogFiles returns recent .jsonl files from nested folders, sorted', async () => {
  const dir = tempDir();
  try {
    mkdirSync(join(dir, 'proj-a', 'sess', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'proj-a', 'one.jsonl'), '');
    writeFileSync(join(dir, 'proj-a', 'sess', 'subagents', 'two.jsonl'), '');
    writeFileSync(join(dir, 'proj-a', 'notes.txt'), '');
    const old = join(dir, 'proj-a', 'old.jsonl');
    writeFileSync(old, '');
    const tenDaysAgo = (Date.now() - 10 * 86_400_000) / 1000;
    utimesSync(old, tenDaysAgo, tenDaysAgo);
    assert.deepEqual(await findLogFiles(dir, { days: 7 }), [
      join(dir, 'proj-a', 'one.jsonl'),
      join(dir, 'proj-a', 'sess', 'subagents', 'two.jsonl'),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findLogFiles returns [] when the folder does not exist', async () => {
  assert.deepEqual(await findLogFiles(join(tmpdir(), `silentfail-missing-${Date.now()}`), { days: 7 }), []);
});

test('readEntries yields objects, skips blank lines and counts bad lines', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 's.jsonl');
    writeFileSync(file, ['{"type":"user","n":1}', '', 'not json', '[1,2]', 'null', '{"type":"assistant","n":2}\r', '{"trunc'].join('\n'));
    const stats = { badLines: 0 };
    const got = [];
    for await (const item of readEntries(file, stats)) got.push(item);
    assert.deepEqual(got.map(g => g.entry.n), [1, 2]);
    assert.deepEqual(got.map(g => g.line), [1, 6]);
    assert.equal(got[0].file, file);
    assert.equal(stats.badLines, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
