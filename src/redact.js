// Blanks out anything that looks like a credential before silentfail prints it.

import { homedir } from 'node:os';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The home folder, in both its native (\ on win32) and forward-slash forms, so
// a path that got its separators swapped somewhere is still caught. Matching
// is case-insensitive on win32, where the filesystem is too.
const HOME = homedir();
const HOME_VARIANTS = [...new Set([HOME, HOME.replace(/\\/g, '/')])].filter(v => v.length > 0);
const HOME_FLAGS = process.platform === 'win32' ? 'gi' : 'g';
const HOME_RULES = HOME_VARIANTS.map(v => [new RegExp(escapeRegExp(v), HOME_FLAGS), '~']);

const RULES = [
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]'],
  // key=value / key: value, quoted or not.
  [/([A-Za-z0-9_]*(?:token|key|secret|password|passwd|pwd))(\s*[=:]\s*)(["']?)[^\s"'&]+\3/gi, '$1$2$3[redacted]$3'],
  // --token value / --password "value" style CLI flags.
  [/(--?[A-Za-z0-9_-]*(?:token|key|secret|password|passwd|pwd))(\s+)(["']?)[^\s"']+\3/gi, '$1$2$3[redacted]$3'],
  // Authorization: token|basic ...; Bearer is already handled by its own rule above.
  [/(\bauthorization\s*[:=]\s*)(?!bearer\b)((?:token|basic)\s+)?[^\s"']+/gi, '$1$2[redacted]'],
  // URL userinfo: scheme://user:pass@host.
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[redacted]@'],
];

// Long runs of token-ish characters. UUIDs (connector names) and runs without
// both a letter and a digit (plain words, path pieces) are left alone.
const LONG_RUN = /[A-Za-z0-9_-]{32,}/g;

// ANSI escape sequences (colors, cursor moves, ...).
const ANSI_ESCAPE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
// Other control characters. \n and \t are left alone; \r is stripped.
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function redact(text) {
  if (text === null || text === undefined) return '';
  let out = String(text);
  for (const [pattern, replacement] of HOME_RULES) out = out.replace(pattern, replacement);
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  out = out.replace(LONG_RUN, run =>
    UUID.test(run) || !/\d/.test(run) || !/[A-Za-z]/.test(run) ? run : '[redacted]',
  );
  out = out.replace(ANSI_ESCAPE, '');
  out = out.replace(CONTROL_CHARS, '');
  return out;
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
