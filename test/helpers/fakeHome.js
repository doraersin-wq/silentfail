import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

// A throwaway Claude config folder. `write` takes a path relative to it (or an
// absolute path) and a string or an object (written as JSON). `writeLog` puts a
// session log under projects/ and swaps __PROJECT__ for the fake project folder.
export function makeFakeHome() {
  const dir = mkdtempSync(join(tmpdir(), 'silentfail-'));
  const projectDir = join(dir, 'work', 'proj');
  mkdirSync(projectDir, { recursive: true });
  const write = (path, content) => {
    const target = isAbsolute(path) ? path : join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return target;
  };
  const writeLog = (rel, text) => write(join('projects', rel), text.replaceAll('__PROJECT__', JSON.stringify(projectDir).slice(1, -1)));
  return {
    dir,
    projectDir,
    write,
    writeLog,
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, NO_COLOR: '1' },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function readFixture(name) {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}
