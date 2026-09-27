// Builds the MCP Inspector command that debugs one configured stdio server live.
// Returns null when there is nothing runnable to hand off: URL servers, plugin
// servers (scope 'plugin', or any part referencing ${CLAUDE_PLUGIN_ROOT} /
// ${CLAUDE_PLUGIN_DATA}, which only resolve inside Claude Code). Other ${VAR}
// references (e.g. from a project .mcp.json) are kept literally, unread, and
// left for the user's own shell to expand when they paste the command.
import { homedir } from 'node:os';

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const PLUGIN_VAR = /\$\{CLAUDE_PLUGIN_(ROOT|DATA)\}/;

export function inspectorCommand(server) {
  if (!server || typeof server.command !== 'string' || server.command === '') return null;
  if (server.scope === 'plugin') return null;
  const parts = [server.command, ...(Array.isArray(server.args) ? server.args : [])];
  if (parts.some(p => PLUGIN_VAR.test(p))) return null;
  return ['npx', '@modelcontextprotocol/inspector', ...parts.map(withHomeVar).map(quote)].join(' ');
}

// A part that starts with the user's home folder gets that prefix swapped for
// the literal ${HOME}, so the printed command still works when the user pastes
// it into their own shell (bash/zsh/Git Bash expand ${HOME} even inside double
// quotes, unlike a bare ~). This also means redact() finds no raw home path
// left in the string to turn into '~', which would NOT expand inside quotes.
function withHomeVar(part) {
  const home = homedir();
  if (!home) return part;
  const homeSlash = home.replace(/\\/g, '/');
  const partSlash = part.replace(/\\/g, '/');
  const isWin = process.platform === 'win32';
  const a = isWin ? partSlash.toLowerCase() : partSlash;
  const b = isWin ? homeSlash.toLowerCase() : homeSlash;
  if (a === b) return '${HOME}';
  if (!a.startsWith(b)) return part;
  const next = part[homeSlash.length];
  if (next !== '/' && next !== '\\') return part;
  return `\${HOME}${part.slice(homeSlash.length)}`;
}

function quote(arg) {
  if (SAFE.test(arg)) return arg;
  const escaped = arg
    .replace(/\\(?=[\\"$`]|$)/g, '\\\\')
    .replace(/(["`]|\$(?!\{))/g, '\\$1');
  return `"${escaped}"`;
}
