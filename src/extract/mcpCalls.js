import { entryBase, serverFromToolName, serverKey } from './common.js';

// A tool_result whose text starts with one of these markers means the user
// rejected or interrupted the call, not that the tool failed (spec §11). The
// text itself is only ever compared, never stored or returned.
const REJECTION_MARKERS = ["The user doesn't want to proceed with this tool use", '[Request interrupted by user'];

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(item => item && typeof item === 'object' && typeof item.text === 'string')
      .map(item => item.text)
      .join(' ');
  }
  return '';
}

// Pairs each tool_use with its tool_result by the tool call's globally unique id
// and reports MCP calls and whether they failed. ctx.toolNames carries pending
// calls between entries; ctx.countedMcp remembers ids already turned into a fact
// so a resumed/forked session that copies history can't double-count a call.
export function extractMcpCalls(entry, ctx) {
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  const base = entryBase(entry);
  const facts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      ctx.toolNames.set(block.id, block.name);
    } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      const id = block.tool_use_id;
      if (ctx.countedMcp.has(id)) continue;
      const toolName = ctx.toolNames.get(id);
      if (toolName === undefined) {
        facts.push({ kind: 'orphan-result', ...base });
        continue;
      }
      ctx.toolNames.delete(id);
      const name = serverFromToolName(toolName);
      if (name) {
        const isError = block.is_error === true;
        const rejected = isError && REJECTION_MARKERS.some(marker => resultText(block.content).startsWith(marker));
        facts.push({ kind: 'mcp-call', server: serverKey(name), name, ok: !isError, rejected, ...base });
        ctx.countedMcp.add(id);
      }
    }
  }
  return facts;
}
