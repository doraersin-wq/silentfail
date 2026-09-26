import { homedir } from 'node:os';
import { join } from 'node:path';

// Where Claude Code keeps settings, plugins and session logs.
export function configDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

// The global state file that holds user- and local-scope MCP servers. It sits in
// the home folder normally, and inside CLAUDE_CONFIG_DIR when that is set.
export function globalConfigFile(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');
}
