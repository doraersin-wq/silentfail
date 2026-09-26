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

// Status lists spell plugin servers plugin:<plugin>:<server>, and tool names use
// underscores. One key covers both spellings.
export function serverKey(name) {
  return String(name).replace(/:/g, '_');
}
