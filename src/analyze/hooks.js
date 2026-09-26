import { basename } from 'node:path';
import { plural } from '../format.js';
import { finding, later, ranInProject } from './common.js';

// Only Stop hooks are guaranteed to show up in the logs whether or not they
// print anything; a silent SessionStart can't be told apart from one that
// never ran at all (spec §11).
export const TRACED_EVENTS = new Set(['Stop']);
const SLOW_MS = 10_000;

const keyOf = (event, command) => `${event}\u0000${command}`;

export function createHookAnalyzer() {
  const groups = new Map();
  const slow = new Map();
  const ran = new Set();

  return {
    add(r) {
      if (r.kind !== 'hook-run') return;
      const key = keyOf(r.event, r.command);
      if (r.command !== null) ran.add(key);
      // Exit code 2 is the documented "block" signal, not a failure.
      const badExit = r.exitCode !== null && r.exitCode !== 0 && r.exitCode !== 2;
      const failed = r.problemType !== null || badExit;
      const g = groups.get(key) ?? { event: r.event, command: r.command, total: 0, failedCount: 0, exitCode: null, problemType: null, stderr: null, last: null, latestTs: '', latestFailed: false };
      g.total++;
      if (failed) {
        g.failedCount++;
        if (badExit) g.exitCode = r.exitCode;
        g.problemType = r.problemType ?? g.problemType;
        g.stderr = r.stderr ?? g.stderr;
        g.last = later(g.last, r.ts);
      }
      // Track whether the most recent run (by ts) failed, so a single old
      // failure among many healthy runs doesn't read as currently broken.
      const ts = r.ts ?? '';
      if (ts >= g.latestTs) {
        g.latestTs = ts;
        g.latestFailed = failed;
      }
      groups.set(key, g);
      if (r.durationMs !== null && r.durationMs > SLOW_MS) {
        const sg = slow.get(key) ?? { event: r.event, command: r.command, count: 0, maxMs: 0 };
        sg.count++;
        sg.maxMs = Math.max(sg.maxMs, r.durationMs);
        slow.set(key, sg);
      }
    },

    finish(config, { cwds }) {
      const findings = [];
      for (const g of groups.values()) {
        if (g.failedCount === 0) continue;
        const severity = g.latestFailed || g.failedCount / g.total >= 0.5 ? 'broken' : 'warning';
        const how = g.exitCode !== null ? `exit code ${g.exitCode}` : g.problemType;
        findings.push(finding('hook-error', severity, subjectFor(g.event, g.command, config), `failed ${g.failedCount} of ${plural(g.total, 'run')} (${how})`,
          { event: g.event, command: g.command, stderr: g.stderr, last: g.last }));
      }
      for (const sg of slow.values()) {
        findings.push(finding('hook-slow', 'warning', subjectFor(sg.event, sg.command, config),
          `took over ${SLOW_MS / 1000}s ${plural(sg.count, 'time')}, up to ${(sg.maxMs / 1000).toFixed(1)}s`,
          { event: sg.event, command: sg.command, maxMs: sg.maxMs }));
      }
      for (const h of config.hooks) {
        if (h.project && !ranInProject(cwds, h.project)) continue;
        const subject = subjectFor(h.event, h.command, config, h);
        const key = keyOf(h.event, h.command);
        const g = groups.get(key);
        if (h.command === null) {
          findings.push(finding('hook-no-trace', 'unknown', subject, `can't verify: ${h.type ?? 'non-command'} hooks leave no trace in the logs`,
            { event: h.event, command: h.command, source: h.source }));
        } else if (g && g.failedCount > 0) {
          continue; // already reported above
        } else if (ran.has(key)) {
          findings.push(finding('hook-ok', 'ok', subject, 'ran', { event: h.event }));
        } else if (TRACED_EVENTS.has(h.event)) {
          findings.push(finding('hook-never-ran', 'warning', subject, 'configured but never ran', { event: h.event, command: h.command, source: h.source }));
        } else if (h.event === 'SessionStart') {
          findings.push(finding('hook-no-trace', 'unknown', subject, "can't verify: no SessionStart run was logged (hooks that print nothing may not be logged)",
            { event: h.event, command: h.command, source: h.source }));
        } else {
          findings.push(finding('hook-no-trace', 'unknown', subject, `can't verify: successful ${h.event} hooks leave no trace in the logs`,
            { event: h.event, command: h.command, source: h.source }));
        }
      }
      return findings;
    },
  };
}

export function analyzeHooks(facts, config, context) {
  const analyzer = createHookAnalyzer();
  for (const r of facts) analyzer.add(r);
  return analyzer.finish(config, context);
}

function subjectFor(event, command, config, known) {
  const h = known ?? config.hooks.find(c => c.event === event && c.command === command);
  const where = !h ? 'not in your config' : h.plugin ? `plugin ${h.plugin}` : h.project ? `${h.scope} settings, ${basename(h.project)}` : 'user settings';
  return `Hook ${event ?? '(unknown event)'} (${where})`;
}
