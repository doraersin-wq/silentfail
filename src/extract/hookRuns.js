import { asArray, entryBase, str } from './common.js';

// Commands read from the logs are trimmed the same way config commands are.
const trimmed = x => str(x)?.trim() ?? null;

// Hook runs show up as hook_* attachments (SessionStart and friends) and as
// stop_hook_summary system entries.
export function extractHookRuns(entry) {
  const a = entry.attachment;
  if (a && typeof a.type === 'string' && a.type.startsWith('hook_')) {
    if (a.type === 'hook_additional_context') return [];
    let problem = false;
    if (a.type !== 'hook_success') {
      // hook_blocking_error is an intentional block, not a failure. Other
      // hook_* types are only treated as problems when they look like an error
      // or a cancellation; anything else is left for the unrecognized-shape
      // counter instead of being guessed at.
      const looksLikeProblem = /error|cancel/i.test(a.type) && a.type !== 'hook_blocking_error';
      if (!looksLikeProblem) return [];
      problem = true;
    }
    const exitCode = Number.isInteger(a.exitCode) ? a.exitCode : null;
    // Exit code 2 is the documented "block" signal, not a failure.
    const badExit = exitCode !== null && exitCode !== 0 && exitCode !== 2;
    const failed = problem || badExit;
    return [hookRun(entry, {
      event: str(a.hookEvent),
      command: trimmed(a.command),
      exitCode,
      durationMs: Number.isFinite(a.durationMs) ? a.durationMs : null,
      // stderr is kept only when something went wrong, which keeps memory small on big log sets.
      stderr: failed ? str(a.stderr) : null,
      problemType: problem ? a.type : null,
    })];
  }
  if (entry.type === 'system' && entry.subtype === 'stop_hook_summary') {
    const facts = asArray(entry.hookInfos).map(info => hookRun(entry, { event: 'Stop', command: trimmed(info?.command) }));
    for (const err of asArray(entry.hookErrors)) {
      facts.push(hookRun(entry, {
        event: 'Stop',
        command: trimmed(err?.command),
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
