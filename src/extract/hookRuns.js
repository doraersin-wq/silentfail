import { asArray, entryBase, str } from './common.js';

// Hook runs show up as hook_* attachments (SessionStart and friends) and as
// stop_hook_summary system entries.
export function extractHookRuns(entry) {
  const a = entry.attachment;
  if (a && typeof a.type === 'string' && a.type.startsWith('hook_')) {
    if (a.type === 'hook_additional_context') return [];
    const problem = a.type !== 'hook_success';
    const exitCode = Number.isInteger(a.exitCode) ? a.exitCode : null;
    const failed = problem || (exitCode !== null && exitCode !== 0);
    return [hookRun(entry, {
      event: str(a.hookEvent),
      command: str(a.command),
      exitCode,
      durationMs: Number.isFinite(a.durationMs) ? a.durationMs : null,
      // stderr is kept only when something went wrong, which keeps memory small on big log sets.
      stderr: failed ? str(a.stderr) : null,
      problemType: problem ? a.type : null,
    })];
  }
  if (entry.type === 'system' && entry.subtype === 'stop_hook_summary') {
    const facts = asArray(entry.hookInfos).map(info => hookRun(entry, { event: 'Stop', command: str(info?.command) }));
    for (const err of asArray(entry.hookErrors)) {
      facts.push(hookRun(entry, {
        event: 'Stop',
        command: str(err?.command),
        stderr: str(err) ?? str(err?.error) ?? str(err?.message) ?? str(err?.stderr),
        problemType: 'stop_hook_error',
      }));
    }
    return facts;
  }
  return [];
}

function hookRun(entry, fields) {
  return {
    kind: 'hook-run', event: null, command: null, exitCode: null, durationMs: null, stderr: null, problemType: null,
    ...entryBase(entry),
    ...fields,
  };
}
