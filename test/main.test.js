import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.js';

function io(env = process.env) {
  const out = { text: '' };
  const err = { text: '' };
  return {
    out,
    err,
    opts: {
      stdout: { write: s => { out.text += s; return true; }, isTTY: false },
      stderr: { write: s => { err.text += s; return true; } },
      env,
    },
  };
}

test('--help prints usage and exits 0', async () => {
  const t = io();
  assert.equal(await main(['--help'], t.opts), 0);
  assert.match(t.out.text, /Usage: npx silentfail/);
});

test('--version prints the package version', async () => {
  const t = io();
  assert.equal(await main(['--version'], t.opts), 0);
  assert.equal(t.out.text, '0.1.0\n');
});

test('a bad --days exits 2', async () => {
  for (const d of ['0', '-3', '1.5', 'abc', '99999']) {
    const t = io();
    assert.equal(await main([`--days=${d}`], t.opts), 2, d);
    assert.match(t.err.text, /--days must be/);
  }
});

test('unknown flags exit 2', async () => {
  const t = io();
  assert.equal(await main(['--nope'], t.opts), 2);
});

test('a missing Claude folder exits 2 with a clear message', async () => {
  const t = io({ ...process.env, CLAUDE_CONFIG_DIR: join(tmpdir(), `silentfail-none-${Date.now()}`) });
  assert.equal(await main([], t.opts), 2);
  assert.match(t.err.text, /No Claude Code folder found/);
});

test('--help lists --exit-zero', async () => {
  const t = io();
  assert.equal(await main(['--help'], t.opts), 0);
  assert.match(t.out.text, /--exit-zero/);
});
