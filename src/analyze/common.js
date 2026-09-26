import { resolve, sep } from 'node:path';

export function finding(id, severity, subject, message, evidence = {}) {
  return { id, severity, subject, message, evidence };
}

// The later of two ISO timestamps; either may be null.
export function later(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return b > a ? b : a;
}

// True when `child` is `parent` or sits somewhere under it.
export function isInside(child, parent) {
  const norm = p => {
    const r = resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

// Project-scoped config only counts when some session actually ran in that project.
export function ranInProject(cwds, project) {
  for (const cwd of cwds) if (isInside(cwd, project)) return true;
  return false;
}
