import { createWriteStream, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds a fake Claude config folder holding one huge session log made of the
// forged fixtures repeated, written with backpressure so it never sits in memory.
export async function makeBigHome(targetBytes = 200 * 1024 * 1024) {
  const dir = mkdtempSync(join(tmpdir(), 'silentfail-stress-'));
  const logDir = join(dir, 'projects', 'stress');
  mkdirSync(logDir, { recursive: true });
  const forged = fileURLToPath(new URL('../fixtures/forged/', import.meta.url));
  const chunk = readdirSync(forged)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .map(f => readFileSync(join(forged, f), 'utf8'))
    .map(t => (t.endsWith('\n') ? t : `${t}\n`))
    .join('');
  const size = Buffer.byteLength(chunk);
  const out = createWriteStream(join(logDir, 'big.jsonl'));
  let bytes = 0;
  while (bytes < targetBytes) {
    if (!out.write(chunk)) await once(out, 'drain');
    bytes += size;
  }
  out.end();
  await once(out, 'finish');
  return { dir, bytes };
}
