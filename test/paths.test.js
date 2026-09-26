import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configDir, globalConfigFile } from '../src/sources/paths.js';

test('configDir honors CLAUDE_CONFIG_DIR', () => {
  assert.equal(configDir({ CLAUDE_CONFIG_DIR: join('x', 'y') }), join('x', 'y'));
});

test('configDir defaults to ~/.claude', () => {
  assert.equal(configDir({}), join(homedir(), '.claude'));
});

test('globalConfigFile sits inside CLAUDE_CONFIG_DIR when it is set', () => {
  assert.equal(globalConfigFile({ CLAUDE_CONFIG_DIR: join('x', 'y') }), join('x', 'y', '.claude.json'));
});

test('globalConfigFile defaults to ~/.claude.json', () => {
  assert.equal(globalConfigFile({}), join(homedir(), '.claude.json'));
});
