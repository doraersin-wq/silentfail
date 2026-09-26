import { asArray, entryBase, serverFromToolName, serverKey, str } from './common.js';

const STATUS_LISTS = [
  ['failedMcpServers', 'failed'],
  ['needsAuthMcpServers', 'needs-auth'],
  ['pendingMcpServers', 'pending'],
];

// deferred_tools_delta attachments say which MCP servers failed, need auth, are
// still pending, or delivered tools (connected).
export function extractMcpStatus(entry) {
  const a = entry.attachment;
  if (!a || a.type !== 'deferred_tools_delta') return [];
  const base = entryBase(entry);
  const facts = [];
  for (const [field, state] of STATUS_LISTS) {
    for (const item of asArray(a[field])) {
      const name = str(item) ?? str(item?.name) ?? str(item?.server);
      if (name) facts.push({ kind: 'mcp-status', server: serverKey(name), name, state, ...base });
    }
  }
  const connected = new Map();
  for (const tool of [...asArray(a.addedNames), ...asArray(a.readdedNames)]) {
    const name = serverFromToolName(tool);
    if (name) connected.set(serverKey(name), name);
  }
  for (const [server, name] of connected) facts.push({ kind: 'mcp-status', server, name, state: 'connected', ...base });
  return facts;
}
