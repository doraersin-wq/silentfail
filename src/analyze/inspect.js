// Builds the MCP Inspector command that debugs one configured stdio server live.
// Returns null when there is nothing runnable to hand off: URL servers, or plugin
// servers whose ${CLAUDE_PLUGIN_ROOT} paths only resolve inside Claude Code.
const SAFE = /^[A-Za-z0-9_@%+=:,./\\-]+$/;

export function inspectorCommand(server) {
  if (!server || typeof server.command !== 'string' || server.command === '') return null;
  const parts = [server.command, ...(Array.isArray(server.args) ? server.args : [])];
  if (parts.some(p => p.includes('${'))) return null;
  return ['npx', '@modelcontextprotocol/inspector', ...parts.map(quote)].join(' ');
}

function quote(arg) {
  return SAFE.test(arg) ? arg : `"${arg.replace(/(["$`])/g, '\\$1')}"`;
}
