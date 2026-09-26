import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFakeHome } from './helpers/fakeHome.js';

const forgedDir = fileURLToPath(new URL('./fixtures/forged/', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const files = existsSync(forgedDir) ? readdirSync(forgedDir).filter(f => f.endsWith('.jsonl')).sort() : [];
const CANARIES = ['CANARY_DO_NOT_PRINT', 'sk-ant-FAKE'];

function runOn(name, args) {
  const home = makeFakeHome();
  try {
    home.writeLog(join('forged', name), readFileSync(join(forgedDir, name), 'utf8'));
    return spawnSync(process.execPath, [cli, '--days', '3650', ...args], { env: home.env, encoding: 'utf8' });
  } finally {
    home.cleanup();
  }
}

test('all 8 forged fixtures exist', () => {
  assert.equal(files.length, 8, `found: ${files.join(', ')}`);
});

for (const name of files) {
  test(`forged ${name}: no crash, no leaks`, () => {
    for (const args of [['--json'], ['--all']]) {
      const r = runOn(name, args);
      assert.ok(r.status === 0 || r.status === 1, `exit ${r.status} with ${args}: ${r.stderr}`);
      for (const canary of CANARIES) {
        assert.ok(!r.stdout.includes(canary), `${canary} leaked to stdout with ${args}`);
        assert.ok(!r.stderr.includes(canary), `${canary} leaked to stderr with ${args}`);
      }
    }
  });
}

const statsOf = name => JSON.parse(runOn(name, ['--json']).stdout).stats;

test('forged: unknown types are counted, not dropped', () => {
  const stats = statsOf('01-unknown-types.jsonl');
  assert.ok(Object.values(stats.unrecognized).reduce((a, b) => a + b, 0) >= 10);
});

test('forged: truncated lines are counted as bad lines', () => {
  assert.ok(statsOf('03-truncated-lines.jsonl').badLines >= 5);
});

test('forged: the future version shows up in the version range', () => {
  assert.equal(statsOf('04-future-version.jsonl').versions.max, '9.9.9');
});
