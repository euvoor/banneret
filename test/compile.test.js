import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, parseCanonical } from '../src/compile.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const out = () => mkdtemp(join(tmpdir(), 'banneret-'));

test('claude target emits agents with mapped model and the pipeline command', async () => {
  const dir = await out();
  await compile({ root: ROOT, outDir: dir, targets: ['claude'] });
  const scout = await readFile(join(dir, '.claude', 'agents', 'scout.md'), 'utf8');
  assert.match(scout, /^name: scout$/m);
  assert.match(scout, /^model: haiku$/m); // tier: cheap
  assert.match(scout, /Conclusions, not dumps/);
  const verifier = await readFile(join(dir, '.claude', 'agents', 'verifier.md'), 'utf8');
  assert.match(verifier, /^model: sonnet$/m); // tier: standard
  const cmd = await readFile(join(dir, '.claude', 'commands', 'pipeline.md'), 'utf8');
  assert.match(cmd, /\$ARGUMENTS/);
  assert.match(cmd, /3b · Second round on the fixes/);
});

test('codex target emits required TOML fields and enforces read-only scouts', async () => {
  const dir = await out();
  await compile({ root: ROOT, outDir: dir, targets: ['codex'] });
  const scout = await readFile(join(dir, '.codex', 'agents', 'scout.toml'), 'utf8');
  assert.match(scout, /^name = "scout"$/m);
  assert.match(scout, /^description = ".+"$/m);
  assert.match(scout, /^sandbox_mode = "read-only"$/m); // access: read → enforced
  assert.match(scout, /^developer_instructions = '''$/m);
  const verifier = await readFile(join(dir, '.codex', 'agents', 'verifier.toml'), 'utf8');
  assert.doesNotMatch(verifier, /sandbox_mode/); // access: read+exec inherits
});

test('codex AGENTS.md block is idempotent and preserves existing content', async () => {
  const dir = await out();
  await writeFile(join(dir, 'AGENTS.md'), '# My project\n\nExisting instructions.\n');
  await compile({ root: ROOT, outDir: dir, targets: ['codex'] });
  await compile({ root: ROOT, outDir: dir, targets: ['codex'] }); // run twice
  const content = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(content, /Existing instructions\./);
  assert.equal(content.match(/banneret:pipeline/g).length, 2); // one open + one close marker
  assert.match(content, /explicitly spawn/);
});

test('parseCanonical rejects missing frontmatter and missing keys', () => {
  assert.throws(() => parseCanonical('no frontmatter', 'x.md'), /missing frontmatter/);
  assert.throws(() => parseCanonical('---\nname: a\n---\nbody', 'x.md'), /needs "summary"/);
});
