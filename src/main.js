import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { redact } from './redact.js';
import { renderJson } from './report/json.js';
import { renderText } from './report/text.js';
import { run, SetupError } from './run.js';

export const HELP = `silentfail: find the parts of your Claude Code setup that look fine but are broken.

Usage: npx silentfail [options]

Options:
  --days <n>     how many days of session logs to read (default 14)
  --json         print JSON instead of the report
  --all          also list everything that is fine, and unrecognized log shapes
  -h, --help     show this help
  -v, --version  show the version

Exit codes: 0 nothing broken, 1 something is broken, 2 silentfail could not run.
Everything stays on your machine. Nothing is uploaded.
`;

const OPTIONS = {
  days: { type: 'string', default: '14' },
  json: { type: 'boolean', default: false },
  all: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

export async function main(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, options: OPTIONS }).values;
  } catch (err) {
    stderr.write(`${err.message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    stdout.write(HELP);
    return 0;
  }
  if (args.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    stdout.write(`${pkg.version}\n`);
    return 0;
  }
  const days = Number(args.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    stderr.write('--days must be a whole number between 1 and 3650\n');
    return 2;
  }
  try {
    const result = await run({ env, days });
    const color = Boolean(stdout.isTTY) && !env.NO_COLOR;
    stdout.write(args.json ? renderJson(result, { days }) : renderText(result, { days, all: args.all, color }));
    return result.findings.some(f => f.severity === 'broken') ? 1 : 0;
  } catch (err) {
    if (err instanceof SetupError) {
      stderr.write(`${redact(err.message)}\n`);
      return 2;
    }
    stderr.write(`silentfail hit a bug: ${redact(err?.stack ?? String(err))}\nPlease open an issue with this output. It contains no conversation content.\n`);
    return 2;
  }
}
