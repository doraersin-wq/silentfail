// Blanks out anything that looks like a credential before silentfail prints it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RULES = [
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]'],
  [/([A-Za-z0-9_]*(?:token|key|secret|password))=[^\s&"']+/gi, '$1=[redacted]'],
];

// Long runs of token-ish characters. UUIDs (connector names) and runs without
// both a letter and a digit (plain words, path pieces) are left alone.
const LONG_RUN = /[A-Za-z0-9_-]{32,}/g;

export function redact(text) {
  if (text === null || text === undefined) return '';
  let out = String(text);
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out.replace(LONG_RUN, run =>
    UUID.test(run) || !/\d/.test(run) || !/[A-Za-z]/.test(run) ? run : '[redacted]',
  );
}

export function redactLine(text, max = 120) {
  const first = redact(text).split(/\r?\n/, 1)[0];
  return first.length > max ? `${first.slice(0, max - 3)}...` : first;
}

export function redactDeep(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k), redactDeep(v)]));
  }
  return value;
}
