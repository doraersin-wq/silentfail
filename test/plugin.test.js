import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const json = rel => JSON.parse(read(rel));

function skill() {
  const text = read('skills/silentfail/SKILL.md').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, 'SKILL.md needs a --- frontmatter block');
  const front = Object.fromEntries(
    m[1].split('\n').filter(Boolean).map(line => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  return { front, body: m[2] };
}

test('plugin.json names the plugin and matches the package version', () => {
  const plugin = json('.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'silentfail');
  assert.equal(plugin.version, json('package.json').version);
});

test('marketplace.json lists exactly this plugin from the repo root', () => {
  const market = json('.claude-plugin/marketplace.json');
  assert.ok(market.owner && market.owner.name, 'owner.name is required');
  assert.deepEqual(market.plugins.map(p => [p.name, p.source]), [['silentfail', './']]);
});

test('the skill frontmatter names it, describes it and pre-approves node', () => {
  const { front } = skill();
  assert.equal(front.name, 'silentfail');
  assert.ok(front.description.length > 40);
  assert.match(front['allowed-tools'], /Bash\(node \*\)/);
});

test('the skill pre-runs exactly the bundled CLI with --json --exit-zero', () => {
  const { body } = skill();
  assert.ok(body.includes('```!\nnode "${CLAUDE_PLUGIN_ROOT}/src/cli.js" --json --exit-zero\n```'));
});

test('no user or model text can reach the pre-run shell command', () => {
  const { body } = skill();
  assert.ok(!body.includes('$ARGUMENTS'));
  assert.doesNotMatch(body, /\$\d/);
});
