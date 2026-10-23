#!/usr/bin/env node
// banneret — compile the canonical sub-agent contracts + pipeline playbook
// into per-tool formats (Claude Code, Codex).
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { compile, TARGETS, loadSources } from '../src/compile.js';

const KIT_ROOT = join(fileURLToPath(import.meta.url), '..', '..');

function usage() {
  console.log(`banneret — portable sub-agent pipeline kit

Usage:
  banneret compile [--target claude|codex|all] [--out <dir>]
  banneret list

compile   Write the agent definitions and playbook for the chosen tool(s)
          into <dir> (default: current directory). Idempotent: re-running
          replaces banneret-managed files and the managed AGENTS.md block,
          and touches nothing else.
list      Show the canonical agents and playbook this kit ships.
`);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = { target: 'all', out: '.' };
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--target') args.target = rest[++i];
  else if (rest[i] === '--out') args.out = rest[++i];
  else {
    console.error(`unknown argument: ${rest[i]}`);
    process.exit(2);
  }
}

try {
  if (cmd === 'compile') {
    const targets = args.target === 'all' ? Object.keys(TARGETS) : [args.target];
    const written = await compile({ root: KIT_ROOT, outDir: resolve(args.out), targets });
    for (const [target, files] of Object.entries(written)) {
      console.log(`${target}:`);
      for (const file of files) console.log(`  ${file}`);
    }
  } else if (cmd === 'list') {
    const { agents, playbook } = await loadSources(KIT_ROOT);
    for (const a of agents) console.log(`${a.meta.name} (${a.meta.tier ?? 'standard'}, ${a.meta.access ?? 'read'}) — ${a.meta.summary.split('.')[0]}.`);
    console.log(`pipeline — ${playbook.meta.summary.split('.')[0]}.`);
  } else {
    usage();
    process.exit(cmd ? 2 : 0);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
