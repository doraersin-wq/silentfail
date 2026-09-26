import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// Session logs (including subagent logs in subfolders) modified within the last `days` days.
export async function findLogFiles(projectsDir, { days, now = Date.now() }) {
  const cutoff = now - days * 86_400_000;
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        let info;
        try {
          info = await stat(p);
        } catch {
          // The file can vanish between readdir and stat (another Claude Code
          // session rotating or removing a log concurrently). Skip it rather
          // than crash; hard to trigger reliably, so no dedicated test.
          continue;
        }
        if (info.mtimeMs >= cutoff) found.push(p);
      }
    }
  }
  await walk(projectsDir);
  return found.sort();
}

// Streams one log file line by line, so no file is ever held in memory whole.
// Lines that are not JSON objects are counted in stats.badLines and skipped.
export async function* readEntries(file, stats) {
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let line = 0;
  for await (const text of lines) {
    line++;
    if (!text.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(text);
    } catch {
      stats.badLines++;
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      stats.badLines++;
      continue;
    }
    yield { entry, file, line };
  }
}
