// Builds the MCP Inspector command that debugs one configured stdio server live.
// Returns null when there is nothing runnable to hand off: URL servers, plugin
// servers (scope 'plugin', or any part referencing ${CLAUDE_PLUGIN_ROOT} /
// ${CLAUDE_PLUGIN_DATA}, which only resolve inside Claude Code). Other ${VAR}
// references (e.g. from a project .mcp.json) are kept literally, unread, and
// left for the user's own shell to expand when they paste the command.
const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const PLUGIN_VAR = /\$\{CLAUDE_PLUGIN_(ROOT|DATA)\}/;

export function inspectorCommand(server) {
  if (!server || typeof server.command !== 'string' || server.command === '') return null;
  if (server.scope === 'plugin') return null;
  const parts = [server.command, ...(Array.isArray(server.args) ? server.args : [])];
  if (parts.some(p => PLUGIN_VAR.test(p))) return null;
  return ['npx', '@modelcontextprotocol/inspector', ...parts.map(quote)].join(' ');
}

function quote(arg) {
  return SAFE.test(arg) ? arg : `"${arg.replace(/(["`]|\$(?!\{))/g, '\\$1')}"`;
}
