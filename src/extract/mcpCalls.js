import { entryBase, serverFromToolName, serverKey } from './common.js';

// Pairs each tool_use with its tool_result (per session) and reports MCP calls and
// whether they failed. ctx.toolNames carries pending calls between entries.
export function extractMcpCalls(entry, ctx) {
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  const base = entryBase(entry);
  const facts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      ctx.toolNames.set(`${base.sessionId}:${block.id}`, block.name);
    } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      const key = `${base.sessionId}:${block.tool_use_id}`;
      const toolName = ctx.toolNames.get(key);
      if (toolName === undefined) {
        facts.push({ kind: 'orphan-result', ...base });
        continue;
      }
      ctx.toolNames.delete(key);
      const name = serverFromToolName(toolName);
      if (name) facts.push({ kind: 'mcp-call', server: serverKey(name), name, ok: block.is_error !== true, ...base });
    }
  }
  return facts;
}
