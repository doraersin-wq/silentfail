import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHookAnalyzer } from './analyze/hooks.js';
import { createMcpAnalyzer } from './analyze/mcp.js';
import { createExtractor } from './extract/index.js';
import { loadConfig } from './sources/config.js';
import { findLogFiles, readEntries } from './sources/logs.js';
import { configDir } from './sources/paths.js';

export class SetupError extends Error {}

const ORDER = { broken: 0, warning: 1, unknown: 2, ok: 3 };

// The whole pipeline: logs → facts → findings, plus counters for the report footer.
export async function run({ env = process.env, days = 14, now = Date.now() } = {}) {
  const dir = configDir(env);
  if (!existsSync(dir)) {
    throw new SetupError(`No Claude Code folder found at ${dir}. Is Claude Code installed? (Set CLAUDE_CONFIG_DIR if it lives somewhere else.)`);
  }
  const files = await findLogFiles(join(dir, 'projects'), { days, now });
  const counters = { badLines: 0 };
  const warnings = [];
  const { extract, state } = createExtractor();
  const mcp = createMcpAnalyzer();
  const hooks = createHookAnalyzer();
  for (const file of files) {
    try {
      for await (const { entry } of readEntries(file, counters)) {
        for (const fact of extract(entry)) { mcp.add(fact); hooks.add(fact); }
      }
    } catch (err) {
      warnings.push(`could not read ${file} (${err.code ?? err.message})`);
    }
  }

  const config = await loadConfig({ env, projectPaths: [...state.cwds].filter(p => isAbsolute(p)) });
  warnings.push(...config.warnings);
  const context = { cwds: state.cwds };
  const findings = state.sessions.size === 0
    ? []
    : [...mcp.finish(config, context), ...hooks.finish(config, context)]
        .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.subject.localeCompare(b.subject));

  return {
    findings,
    stats: {
      files: files.length,
      sessions: state.sessions.size,
      badLines: counters.badLines,
      unrecognized: Object.fromEntries([...state.unrecognized].sort((a, b) => b[1] - a[1])),
      versions: state.versions,
      warnings,
    },
  };
}
