import { plural } from '../format.js';
import { redact, redactLine } from '../redact.js';

const HEADINGS = { broken: 'BROKEN', warning: 'WARNING', unknown: 'UNKNOWN' };
const MARKS = { broken: '[x]', warning: '[!]', unknown: '[?]' };
const STYLE = { broken: '\x1b[31m', warning: '\x1b[33m', unknown: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' };

export function renderText(result, { days, all = false, color = false }) {
  const paint = (style, s) => (color ? `${STYLE[style]}${s}${STYLE.reset}` : s);
  // Every field that lands in the report goes through this before printing, so
  // a subject, message, shape or warning can never fake an extra report line by
  // embedding a newline of its own.
  const one = s => redact(s).replace(/\s*\n\s*/g, ' ');
  const { findings, stats } = result;
  const { min, max } = stats.versions;
  const versions = min ? `, Claude Code ${min === max ? min : `${min}-${max}`}` : '';
  const lines = [`silentfail: ${plural(stats.sessions, 'session')}, last ${days} days${versions}`, ''];

  if (stats.sessions === 0) lines.push(`No Claude Code session logs in the last ${days} days.`, '');
  else if (!findings.some(f => f.severity !== 'ok')) lines.push('Nothing broken found.', '');
  for (const severity of ['broken', 'warning', 'unknown']) {
    const group = findings.filter(f => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(paint(severity, HEADINGS[severity]));
    for (const f of group) {
      const last = f.evidence?.last ?? f.evidence?.lastError;
      const when = typeof last === 'string' ? ` (last ${one(last.slice(0, 10))})` : '';
      lines.push(`  ${paint(severity, MARKS[severity])} ${one(f.subject)}: ${one(f.message)}${when}`);
      // Command and stderr detail lines are only shown for problems worth
      // acting on (or everything, with --all), so a merely-unverifiable
      // finding doesn't print a command for no reason.
      const showDetail = all || severity === 'broken' || severity === 'warning';
      if (showDetail && f.evidence?.command) lines.push(`      command: ${redactLine(f.evidence.command)}`);
      if (showDetail && f.evidence?.stderr) lines.push(`      stderr: ${redactLine(f.evidence.stderr)}`);
    }
    lines.push('');
  }

  const ok = findings.filter(f => f.severity === 'ok');
  if (all && ok.length > 0) {
    lines.push('OK');
    for (const f of ok) lines.push(`  [ok] ${one(f.subject)}: ${one(f.message)}`);
    lines.push('');
  } else if (ok.length > 0) {
    const mcp = ok.filter(f => f.id.startsWith('mcp-')).length;
    lines.push(paint('dim', `OK: ${plural(mcp, 'MCP server')}, ${plural(ok.length - mcp, 'hook')} (--all to list)`), '');
  }

  const unrecognized = Object.values(stats.unrecognized).reduce((a, b) => a + b, 0);
  if (unrecognized > 0) {
    lines.push(`${plural(unrecognized, 'log line')} not recognized (newer Claude Code?). This is not an error.`);
    if (all) for (const [shape, n] of Object.entries(stats.unrecognized)) lines.push(`  ${n}  ${one(shape)}`);
  }
  if (stats.badLines > 0) lines.push(`${plural(stats.badLines, 'unreadable log line')} skipped.`);
  for (const w of stats.warnings) lines.push(`note: ${one(w)}`);
  return `${lines.join('\n')}\n`;
}
