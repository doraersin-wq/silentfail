import { redactDeep } from '../redact.js';

export function renderJson(result, { days }) {
  const doc = { tool: 'silentfail', schema: 1, days, stats: result.stats, findings: result.findings };
  return `${JSON.stringify(redactDeep(doc), null, 2)}\n`;
}
