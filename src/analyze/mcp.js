import { plural } from '../format.js';
import { finding, later, ranInProject } from './common.js';

export function createMcpAnalyzer() {
  const servers = new Map();
  let sawStatus = false;
  const get = (key, name) => {
    let s = servers.get(key);
    if (!s) {
      s = { label: name, sessions: new Set(), failed: new Set(), needsAuth: new Set(), pending: new Set(), connected: new Set(), calls: 0, errors: 0, lastError: null };
      servers.set(key, s);
    }
    return s;
  };

  return {
    add(f) {
      if (f.kind === 'mcp-status') {
        sawStatus = true;
        const s = get(f.server, f.name);
        const sid = f.sessionId ?? '(no session)';
        s.sessions.add(sid);
        if (f.state === 'failed') s.failed.add(sid);
        else if (f.state === 'needs-auth') s.needsAuth.add(sid);
        else if (f.state === 'pending') s.pending.add(sid);
        else if (f.state === 'connected') s.connected.add(sid);
      } else if (f.kind === 'mcp-call') {
        if (f.rejected) return;
        const s = get(f.server, f.name);
        s.calls++;
        if (!f.ok) {
          s.errors++;
          s.lastError = later(s.lastError, f.ts);
        }
      }
    },

    finish(config, { cwds }) {
      for (const c of config.mcpServers) {
        const s = servers.get(c.key);
        if (s) s.label = c.label;
      }

      const findings = [];
      for (const s of servers.values()) {
        const subject = `MCP ${s.label}`;
        const n = s.sessions.size;
        const before = findings.length;
        const failedNotConnected = [...s.failed].filter(id => !s.connected.has(id)).length;
        if (failedNotConnected > 0) {
          findings.push(finding('mcp-failed-connect', 'broken', subject, `failed to connect in ${failedNotConnected} of ${plural(n, 'session')}`, { sessions: n, failed: failedNotConnected }));
        }
        if (s.errors > 0) {
          const ratio = s.errors / s.calls;
          const severity = s.calls >= 2 && ratio >= 0.5 ? 'broken' : ratio >= 0.2 ? 'warning' : null;
          if (severity) {
            findings.push(finding('mcp-call-errors', severity, subject, `${s.errors} of ${plural(s.calls, 'call')} failed`, { calls: s.calls, errors: s.errors, lastError: s.lastError }));
          }
        }
        const needsAuth = [...s.needsAuth].filter(id => !s.connected.has(id)).length;
        if (needsAuth > 0) {
          findings.push(finding('mcp-needs-auth', 'warning', subject, `needs auth in ${needsAuth} of ${plural(n, 'session')}`, { sessions: n, needsAuth }));
        }
        const stuck = [...s.pending].filter(id => !s.connected.has(id) && !s.failed.has(id) && !s.needsAuth.has(id)).length;
        if (stuck > 0) {
          findings.push(finding('mcp-stuck-pending', 'warning', subject, `never finished connecting in ${stuck} of ${plural(n, 'session')}`, { sessions: n, stuck }));
        }
        if (findings.length === before) {
          const message = s.calls > 0 ? `${plural(s.calls, 'call')}, ${s.errors} failed` : `connected in ${s.connected.size} of ${plural(n, 'session')}`;
          findings.push(finding('mcp-ok', 'ok', subject, message, { calls: s.calls, sessions: n }));
        }
      }

      const reported = new Set();
      for (const c of config.mcpServers) {
        if (servers.has(c.key) || reported.has(c.key)) continue;
        if (c.project && !ranInProject(cwds, c.project)) continue;
        if (c.enabled === false) continue;
        reported.add(c.key);
        const severity = sawStatus ? 'warning' : 'unknown';
        const message = sawStatus
          ? `configured (${c.scope} scope) but never showed up in the logs`
          : "can't verify: these logs don't record which servers connected";
        findings.push(finding('mcp-never-seen', severity, `MCP ${c.label}`, message, { scope: c.scope, source: c.source }));
      }
      return findings;
    },
  };
}

export function analyzeMcp(facts, config, context) {
  const analyzer = createMcpAnalyzer();
  for (const f of facts) analyzer.add(f);
  return analyzer.finish(config, context);
}
