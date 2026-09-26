// Shared helpers for turning raw log entries into facts.

export const asArray = v => (Array.isArray(v) ? v : []);
export const str = v => (typeof v === 'string' ? v : null);

export function entryBase(entry) {
  return { sessionId: str(entry.sessionId), cwd: str(entry.cwd), ts: str(entry.timestamp) };
}

// MCP tool names look like mcp__<server>__<tool>.
export function serverFromToolName(name) {
  if (typeof name !== 'string') return null;
  const match = /^mcp__(.+?)__./.exec(name);
  return match ? match[1] : null;
}

// Claude Code turns server names into tool-name pieces by replacing every
// character outside [A-Za-z0-9_-] with '_' (so "claude.ai Gmail" becomes
// "claude_ai_Gmail", matching mcp__claude_ai_Gmail__search). Status lists spell
// plugin servers plugin:<plugin>:<server>; this same rule folds that into the
// same key tool names use.
export function serverKey(name) {
  return String(name).replace(/[^A-Za-z0-9_-]/g, '_');
}
