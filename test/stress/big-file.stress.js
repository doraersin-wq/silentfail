import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeBigHome } from './make-big.js';

test('streams a 200 MB log set in under 60 s and 256 MB of memory', { timeout: 300_000 }, async () => {
  const { dir, bytes } = await makeBigHome();
  try {
    const child = fileURLToPath(new URL('./child.js', import.meta.url));
    const r = spawnSync(process.execPath, [child], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8', timeout: 240_000 });
    assert.equal(r.status, 0, r.stderr);
    const { ms, peakRss } = JSON.parse(r.stdout);
    console.log(`read ${(bytes / 1048576).toFixed(0)} MB in ${(ms / 1000).toFixed(1)} s, peak memory ${(peakRss / 1048576).toFixed(0)} MB`);
    assert.ok(ms < 60_000, `took ${ms} ms`);
    assert.ok(peakRss < 256 * 1024 * 1024, `peak memory ${(peakRss / 1048576).toFixed(0)} MB`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
