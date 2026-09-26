import { basename } from 'node:path';
import { plural } from '../format.js';
import { finding, later, ranInProject } from './common.js';

// Events whose successful runs are written to the session logs (spec §2).
export const TRACED_EVENTS = new Set(['SessionStart', 'Stop']);
const SLOW_MS = 10_000;

const keyOf = (event, command) => `${event}\u0000${command}`;

export function analyzeHooks(facts, config, { cwds }) {
  const failures = new Map();
  const slow = new Map();
  const ran = new Set();

  for (const r of facts) {
    if (r.kind !== 'hook-run') continue;
    const key = keyOf(r.event, r.command);
    if (r.command !== null) ran.add(key);
    const badExit = r.exitCode !== null && r.exitCode !== 0;
    if (r.problemType !== null || badExit) {
      const g = failures.get(key) ?? { event: r.event, command: r.command, count: 0, exitCode: null, problemType: null, stderr: null, last: null };
      g.count++;
      if (badExit) g.exitCode = r.exitCode;
      g.problemType = r.problemType ?? g.problemType;
      g.stderr = r.stderr ?? g.stderr;
      g.last = later(g.last, r.ts);
      failures.set(key, g);
    }
    if (r.durationMs !== null && r.durationMs > SLOW_MS) {
      const g = slow.get(key) ?? { event: r.event, command: r.command, count: 0, maxMs: 0 };
      g.count++;
      g.maxMs = Math.max(g.maxMs, r.durationMs);
      slow.set(key, g);
    }
  }

  const findings = [];
  for (const g of failures.values()) {
    const how = g.exitCode !== null ? `exit code ${g.exitCode}` : g.problemType;
    findings.push(finding('hook-error', 'broken', subjectFor(g.event, g.command, config), `failed ${plural(g.count, 'time')} (${how})`,
      { event: g.event, command: g.command, stderr: g.stderr, last: g.last }));
  }
  for (const g of slow.values()) {
    findings.push(finding('hook-slow', 'warning', subjectFor(g.event, g.command, config),
      `took over ${SLOW_MS / 1000}s ${plural(g.count, 'time')}, up to ${(g.maxMs / 1000).toFixed(1)}s`,
      { event: g.event, command: g.command, maxMs: g.maxMs }));
  }
  for (const h of config.hooks) {
    if (h.project && !ranInProject(cwds, h.project)) continue;
    const subject = subjectFor(h.event, h.command, config, h);
    const key = keyOf(h.event, h.command);
    if (!TRACED_EVENTS.has(h.event) || h.command === null) {
      findings.push(finding('hook-no-trace', 'unknown', subject, `can't verify: successful ${h.event} hooks leave no trace in the logs`,
        { event: h.event, command: h.command, source: h.source }));
    } else if (failures.has(key)) {
      continue;
    } else if (ran.has(key)) {
      findings.push(finding('hook-ok', 'ok', subject, 'ran', { event: h.event }));
    } else {
      findings.push(finding('hook-never-ran', 'warning', subject, 'configured but never ran', { event: h.event, command: h.command, source: h.source }));
    }
  }
  return findings;
}

function subjectFor(event, command, config, known) {
  const h = known ?? config.hooks.find(c => c.event === event && c.command === command);
  const where = !h ? 'not in your config' : h.plugin ? `plugin ${h.plugin}` : h.project ? `${h.scope} settings, ${basename(h.project)}` : 'user settings';
  return `Hook ${event ?? '(unknown event)'} (${where})`;
}
