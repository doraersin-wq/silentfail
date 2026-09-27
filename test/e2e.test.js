import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFakeHome, readFixture } from './helpers/fakeHome.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const runCli = (env, ...args) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });

function brokenHome() {
  const home = makeFakeHome();
  home.writeLog(join('proj', 's-basic-1.jsonl'), readFixture('basic/filesystem-broken.jsonl'));
  home.write(join(home.projectDir, '.mcp.json'), { mcpServers: { filesystem: { command: 'npx', args: [] } } });
  const sp = join(home.dir, 'plugins', 'cache', 'superpowers');
  const cf = join(home.dir, 'plugins', 'cache', 'cloudflare');
  home.write(join('plugins', 'installed_plugins.json'), { version: 2, plugins: {
    'superpowers@test': [{ scope: 'user', installPath: sp }],
    'cloudflare@test': [{ scope: 'user', installPath: cf }],
  } });
  home.write(join(sp, 'hooks', 'hooks.json'), { hooks: { SessionStart: [{ matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start' }] }] } });
  home.write(join(cf, '.mcp.json'), { mcpServers: { cloudflare: { type: 'http', url: 'https://example.invalid/mcp' } } });
  home.write('settings.json', {
    enabledPlugins: { 'superpowers@test': true, 'cloudflare@test': true },
    hooks: { Notification: [{ hooks: [{ type: 'command', command: 'ping.sh' }] }] },
  });
  return home;
}

test('end to end: finds the broken filesystem server and exits 1', () => {
  const home = brokenHome();
  try {
    const r = runCli(home.env, '--json');
    assert.equal(r.status, 1, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.deepEqual(json.findings.map(f => [f.id, f.severity, f.subject, f.message]), [
      ['mcp-call-errors', 'broken', 'MCP filesystem', '2 of 2 calls failed'],
      ['mcp-needs-auth', 'warning', 'MCP plugin:cloudflare:cloudflare', 'needs auth in 1 of 1 session'],
      ['hook-no-trace', 'unknown', 'Hook Notification (user settings)', "can't verify: successful Notification hooks leave no trace in the logs"],
      ['hook-ok', 'ok', 'Hook SessionStart (plugin superpowers)', 'ran'],
    ]);
    assert.equal(json.stats.sessions, 1);
    assert.deepEqual(json.stats.versions, { min: '2.1.229', max: '2.1.281' });
  } finally {
    home.cleanup();
  }
});

test('end to end: the text report shows the finding and leaks nothing', () => {
  const home = brokenHome();
  try {
    for (const args of [[], ['--all'], ['--json']]) {
      const r = runCli(home.env, ...args);
      for (const canary of ['CANARY_DO_NOT_PRINT', 'sk-ant-FAKE']) {
        assert.ok(!r.stdout.includes(canary) && !r.stderr.includes(canary), `${canary} leaked with ${args.join(' ')}`);
      }
    }
    assert.match(runCli(home.env).stdout, /\[x\] MCP filesystem: 2 of 2 calls failed \(last 2026-09-20\)/);
  } finally {
    home.cleanup();
  }
});

test('end to end: a healthy setup exits 0', () => {
  const home = makeFakeHome();
  try {
    home.writeLog(join('proj', 's-healthy.jsonl'), readFixture('basic/healthy.jsonl'));
    const r = runCli(home.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Nothing broken found\./);
  } finally {
    home.cleanup();
  }
});

test('end to end: no Claude folder exits 2', () => {
  const r = runCli({ ...process.env, CLAUDE_CONFIG_DIR: join(tmpdir(), `silentfail-nope-${Date.now()}`) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No Claude Code folder found/);
});

test('end to end: an empty projects folder (no session logs at all) exits 0 and says so', () => {
  const home = makeFakeHome();
  try {
    const r = runCli(home.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No Claude Code session logs in the last 14 days\./);
  } finally {
    home.cleanup();
  }
});

test('end to end: --exit-zero exits 0 but still reports the broken finding', () => {
  const home = brokenHome();
  try {
    const r = runCli(home.env, '--json', '--exit-zero');
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.ok(json.findings.some(f => f.id === 'mcp-call-errors' && f.severity === 'broken' && f.subject === 'MCP filesystem'));
  } finally {
    home.cleanup();
  }
});
