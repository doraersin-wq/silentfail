import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serverKey } from '../extract/common.js';
import { configDir, globalConfigFile } from './paths.js';

// Reads JSON. A missing file returns null quietly; an unreadable or broken one adds a warning.
async function readJson(file, warnings) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') warnings.push(`could not read ${file} (${err.code ?? err.message})`);
    return null;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    warnings.push(`could not parse ${file}`);
    return null;
  }
}

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = v => (Array.isArray(v) ? v : []);
// hooks.json wraps events in a "hooks" key; inline plugin.json hooks may not.
const unwrapHooks = v => ('hooks' in obj(v) ? obj(v).hooks : v);

const normPath = p => {
  const r = resolve(String(p));
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

// A project-scope .mcp.json server is disabled only when it's explicitly named
// in disabledMcpjsonServers, merged across ~/.claude.json's projects[<this
// folder>] entry, ~/.claude/settings.json (userSettings) and the project's own
// settings files. Returns a per-name check.
function mcpApproval(globalProjects, project, projectSettingsList, userSettings) {
  const disabledNames = new Set();
  const consider = settings => {
    for (const n of list(settings.disabledMcpjsonServers)) if (typeof n === 'string') disabledNames.add(n);
  };
  const target = normPath(project);
  for (const [key, entry] of Object.entries(obj(globalProjects))) {
    if (normPath(key) === target) consider(obj(entry));
  }
  consider(obj(userSettings));
  for (const settings of projectSettingsList) consider(settings);
  return name => !disabledNames.has(name);
}

// Collects configured MCP servers, hooks and enabled plugins from every place Claude Code keeps them.
export async function loadConfig({ env = process.env, projectPaths = [] } = {}) {
  const warnings = [];
  const mcpServers = [];
  const hooks = [];
  const plugins = [];
  const enabled = new Set();

  const addServers = (servers, scope, project, source, plugin = null, isEnabled = () => true) => {
    for (const [name, cfg] of Object.entries(obj(servers))) {
      const label = plugin ? `plugin:${plugin}:${name}` : name;
      if (plugin && mcpServers.some(s => s.label === label)) continue;
      const spec = obj(cfg);
      mcpServers.push({
        key: serverKey(label), label, scope, project, source, enabled: isEnabled(name),
        command: typeof spec.command === 'string' ? spec.command : null,
        args: list(spec.args).filter(a => typeof a === 'string'),
      });
    }
  };
  const addHooks = (config, scope, project, source, plugin = null) => {
    for (const [event, groups] of Object.entries(obj(config))) {
      for (const group of list(groups)) {
        for (const h of list(group?.hooks)) {
          hooks.push({
            event,
            matcher: typeof group.matcher === 'string' ? group.matcher : null,
            type: typeof h?.type === 'string' ? h.type : null,
            command: typeof h?.command === 'string' ? h.command.trim() : null,
            scope,
            project,
            source,
            plugin,
          });
        }
      }
    }
  };
  const noteEnabled = settings => {
    for (const [id, on] of Object.entries(obj(settings.enabledPlugins))) {
      if (on === true) enabled.add(id);
      else if (on === false) enabled.delete(id);
    }
  };

  const globalFile = globalConfigFile(env);
  const global = obj(await readJson(globalFile, warnings));
  addServers(global.mcpServers, 'user', null, globalFile);
  for (const [project, entry] of Object.entries(obj(global.projects))) {
    addServers(obj(entry).mcpServers, 'local', project, globalFile);
  }

  const dir = configDir(env);
  const userSettingsFile = join(dir, 'settings.json');
  const userSettings = obj(await readJson(userSettingsFile, warnings));
  addHooks(userSettings.hooks, 'user', null, userSettingsFile);
  noteEnabled(userSettings);

  for (const project of new Set(projectPaths)) {
    const mcpFile = join(project, '.mcp.json');
    const projectSettings = [];
    for (const [name, scope] of [['settings.json', 'project'], ['settings.local.json', 'local']]) {
      const file = join(project, '.claude', name);
      const settings = obj(await readJson(file, warnings));
      projectSettings.push(settings);
      addHooks(settings.hooks, scope, project, file);
      noteEnabled(settings);
    }
    const isEnabled = mcpApproval(global.projects, project, projectSettings, userSettings);
    addServers(obj(await readJson(mcpFile, warnings)).mcpServers, 'project', project, mcpFile, null, isEnabled);
  }

  const installed = obj(obj(await readJson(join(dir, 'plugins', 'installed_plugins.json'), warnings)).plugins);
  for (const id of enabled) {
    const records = Array.isArray(installed[id]) ? installed[id] : [installed[id]];
    const installPath = records.map(r => r?.installPath).filter(p => typeof p === 'string').at(-1);
    if (!installPath) {
      warnings.push(`plugin ${id} is enabled but not installed`);
      continue;
    }
    const name = id.split('@')[0];
    plugins.push({ id, name, installPath });
    const manifestFile = join(installPath, '.claude-plugin', 'plugin.json');
    const manifest = obj(await readJson(manifestFile, warnings));

    const serverFiles = new Set([join(installPath, '.mcp.json')]);
    if (typeof manifest.mcpServers === 'string') serverFiles.add(resolve(installPath, manifest.mcpServers));
    for (const file of serverFiles) addServers(obj(await readJson(file, warnings)).mcpServers, 'plugin', null, file, name);
    if (typeof manifest.mcpServers === 'object') addServers(manifest.mcpServers, 'plugin', null, manifestFile, name);

    const hookFiles = new Set([join(installPath, 'hooks', 'hooks.json')]);
    if (typeof manifest.hooks === 'string') hookFiles.add(resolve(installPath, manifest.hooks));
    for (const file of hookFiles) addHooks(unwrapHooks(await readJson(file, warnings)), 'plugin', null, file, name);
    if (typeof manifest.hooks === 'object') addHooks(unwrapHooks(manifest.hooks), 'plugin', null, manifestFile, name);
  }

  return { mcpServers, hooks, plugins, warnings };
}
