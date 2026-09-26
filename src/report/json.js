import { redactDeep, redactLine } from '../redact.js';

export function renderJson(result, { days }) {
  const findings = result.findings.map(f =>
    typeof f.evidence?.stderr === 'string'
      ? { ...f, evidence: { ...f.evidence, stderr: redactLine(f.evidence.stderr) } }
      : f,
  );
  const doc = { tool: 'silentfail', schema: 1, days, stats: result.stats, findings };
  return `${JSON.stringify(redactDeep(doc), null, 2)}\n`;
}
