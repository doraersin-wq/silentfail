import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadConfig } from '../src/sources/config.js';
import { makeFakeHome } from './helpers/fakeHome.js';

test('collects MCP servers from user, local, project and plugin scopes', async () => {
  const home = makeFakeHome();
  try {
    home.write('.claude.json', { mcpServers: { memory: {} }, projects: { [home.projectDir]: { mcpServers: { localone: {} } } } });
    home.write(join(home.projectDir, '.mcp.json'), { mcpServers: { filesystem: {} } });
    const pluginDir = join(home.dir, 'plugins', 'cache', 'cloudflare');
    home.write(join('plugins', 'installed_plugins.json'), { version: 2, plugins: { 'cloudflare@mk': [{ scope: 'user', installPath: pluginDir }] } });
    home.write(join(pluginDir, '.mcp.json'), { mcpServers: { cloudflare: {} } });
    home.write(join(pluginDir, '.claude-plugin', 'plugin.json'), { name: 'cloudflare', mcpServers: './.mcp.json' });
    home.write('settings.json', { enabledPlugins: { 'cloudflare@mk': true } });
    const cfg = await loadConfig({ env: home.env, projectPaths: [home.projectDir] });
    assert.deepEqual(cfg.mcpServers.map(s => [s.key, s.label, s.scope]), [
      ['memory', 'memory', 'user'],
      ['localone', 'localone', 'local'],
      ['filesystem', 'filesystem', 'project'],
      ['plugin_cloudflare_cloudflare', 'plugin:cloudflare:cloudflare', 'plugin'],
    ]);
    assert.equal(cfg.mcpServers[2].project, home.projectDir);
    assert.deepEqual(cfg.warnings, []);
  } finally {
    home.cleanup();
  }
});

test('collects hooks from user settings, project settings and enabled plugins', async () => {
  const home = makeFakeHome();
  try {
    home.write('settings.json', {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '  lint.sh  ' }] }] },
      enabledPlugins: { 'sp@mk': true, 'off@mk': false },
    });
    home.write(join(home.projectDir, '.claude', 'settings.local.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify' }] }] } });
    const spDir = join(home.dir, 'plugins', 'cache', 'sp');
    home.write(join('plugins', 'installed_plugins.json'), { plugins: { 'sp@mk': [{ installPath: spDir }], 'off@mk': [{ installPath: join(home.dir, 'x') }] } });
    home.write(join(spDir, 'hooks', 'hooks.json'), { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/run" start' }] }] } });
    const cfg = await loadConfig({ env: home.env, projectPaths: [home.projectDir] });
    assert.deepEqual(cfg.hooks.map(h => [h.event, h.matcher, h.command, h.scope, h.plugin]), [
      ['PreToolUse', 'Bash', 'lint.sh', 'user', null],
      ['Stop', null, 'notify', 'local', null],
      ['SessionStart', 'startup', '"${CLAUDE_PLUGIN_ROOT}/run" start', 'plugin', 'sp'],
    ]);
    assert.deepEqual(cfg.plugins.map(p => p.id), ['sp@mk']);
  } finally {
    home.cleanup();
  }
});

test('broken files become warnings; missing files are silent', async () => {
  const home = makeFakeHome();
  try {
    home.write('settings.json', '{ not json');
    const cfg = await loadConfig({ env: home.env, projectPaths: [join(home.dir, 'does-not-exist')] });
    assert.equal(cfg.warnings.length, 1);
    assert.match(cfg.warnings[0], /could not parse .*settings\.json/);
    assert.deepEqual(cfg.mcpServers, []);
  } finally {
    home.cleanup();
  }
});

test('an enabled plugin that is not installed is a warning', async () => {
  const home = makeFakeHome();
  try {
    home.write('settings.json', { enabledPlugins: { 'ghost@mk': true } });
    const cfg = await loadConfig({ env: home.env });
    assert.deepEqual(cfg.warnings, ['plugin ghost@mk is enabled but not installed']);
  } finally {
    home.cleanup();
  }
});
