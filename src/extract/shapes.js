// Entry shapes seen in real logs (Claude Code 2.1.170 to 2.1.281). Anything else
// that no extractor turns into a fact is counted as "not recognized", so a format
// change shows up in the report instead of vanishing.
export const KNOWN_SHAPES = new Set([
  'assistant', 'user', 'summary', 'last-prompt', 'custom-title', 'ai-title', 'atis-latch',
  'queue-operation', 'mode', 'bridge-session', 'agent-name', 'file-history-delta',
  'file-history-snapshot', 'cost-state',
  'system/stop_hook_summary', 'system/local_command', 'system/compact_boundary',
  'attachment/total_tokens_reminder', 'attachment/edited_text_file', 'attachment/deferred_tools_delta',
  'attachment/skill_listing', 'attachment/task_reminder', 'attachment/agent_listing_delta',
  'attachment/mcp_instructions_delta', 'attachment/deferred_tools_record',
  'attachment/hook_additional_context', 'attachment/hook_success', 'attachment/auto_mode',
  'attachment/silent_turn_reminder', 'attachment/prompt_snapshot', 'attachment/command_permissions',
  'attachment/queued_command', 'attachment/date', 'attachment/instructions', 'attachment/environment',
  'attachment/model', 'attachment/file', 'attachment/session_context', 'attachment/remote_session_change',
  'attachment/compact_file_reference', 'attachment/thinking_drop',
]);

export function shapeOf(entry) {
  const parts = [entry.type, entry.subtype, entry.attachment?.type].filter(p => typeof p === 'string' && p !== '');
  return parts.length > 0 ? parts.join('/') : '(no type)';
}
