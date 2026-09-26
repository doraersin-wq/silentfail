import { extractHookRuns } from './hookRuns.js';
import { extractMcpCalls } from './mcpCalls.js';
import { extractMcpStatus } from './mcpStatus.js';
import { KNOWN_SHAPES, shapeOf } from './shapes.js';

const EXTRACTORS = [extractMcpStatus, extractMcpCalls, extractHookRuns];

// Repeated strings in facts share one copy, which keeps memory flat on huge log sets.
const INTERNED_FIELDS = ['sessionId', 'cwd', 'server', 'name', 'event', 'command'];

// Runs every extractor over a stream of log entries and keeps run-wide counters.
export function createExtractor() {
  const ctx = { toolNames: new Map() };
  const pool = new Map();
  const state = { sessions: new Set(), cwds: new Set(), unrecognized: new Map(), versions: { min: null, max: null } };

  const intern = s => {
    if (typeof s !== 'string') return s;
    const hit = pool.get(s);
    if (hit !== undefined) return hit;
    pool.set(s, s);
    return s;
  };

  function extract(entry) {
    if (typeof entry.sessionId === 'string') state.sessions.add(entry.sessionId);
    if (typeof entry.cwd === 'string') state.cwds.add(entry.cwd);
    noteVersion(state.versions, entry.version);
    const facts = [];
    let crashed = false;
    for (const fn of EXTRACTORS) {
      try {
        facts.push(...fn(entry, ctx));
      } catch {
        crashed = true;
      }
    }
    const shape = shapeOf(entry);
    if (crashed) bump(state.unrecognized, `${shape} (extractor error)`);
    else if (facts.length === 0 && !KNOWN_SHAPES.has(shape)) bump(state.unrecognized, shape);
    for (const fact of facts) {
      for (const field of INTERNED_FIELDS) if (field in fact) fact[field] = intern(fact[field]);
    }
    return facts;
  }

  return { extract, state };
}

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// Keeps only the numeric x.y.z prefix, so odd suffixes never reach the report.
function noteVersion(versions, raw) {
  const match = typeof raw === 'string' ? /^\d+\.\d+\.\d+/.exec(raw) : null;
  if (!match) return;
  const v = match[0];
  if (versions.min === null || compareVersions(v, versions.min) < 0) versions.min = v;
  if (versions.max === null || compareVersions(v, versions.max) > 0) versions.max = v;
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
