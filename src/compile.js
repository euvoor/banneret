// Compiles banneret's canonical agent contracts and playbook into per-tool
// formats. Canonical sources are markdown with a small YAML-subset frontmatter
// (string values only, one `key: value` per line); that constraint is what
// keeps this parser dependency-free, so keep frontmatter values single-line.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const TIER_TO_CLAUDE_MODEL = { cheap: 'haiku', standard: 'sonnet' };
const MARKER_OPEN = '<!-- banneret:pipeline -->';
const MARKER_CLOSE = '<!-- /banneret:pipeline -->';

export function parseCanonical(raw, file) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) throw new Error(`${file}: frontmatter line not "key: value": ${line}`);
    meta[kv[1]] = kv[2].trim();
  }
  for (const key of ['name', 'summary']) {
    if (!meta[key]) throw new Error(`${file}: frontmatter needs "${key}"`);
  }
  return { meta, body: raw.slice(m[0].length).trim() };
}

export async function loadSources(root) {
  const agentsDir = join(root, 'agents');
  const agents = [];
  for (const entry of (await readdir(agentsDir)).filter((f) => f.endsWith('.md')).sort()) {
    const file = join(agentsDir, entry);
    agents.push({ file, ...parseCanonical(await readFile(file, 'utf8'), file) });
  }
  const playbookFile = join(root, 'playbook', 'pipeline.md');
  const playbook = { file: playbookFile, ...parseCanonical(await readFile(playbookFile, 'utf8'), playbookFile) };
  return { agents, playbook };
}

// ---------- Claude Code target ----------

function claudeAgent({ meta, body }) {
  const model = TIER_TO_CLAUDE_MODEL[meta.tier] ?? 'sonnet';
  return `---\nname: ${meta.name}\ndescription: ${meta.summary}\nmodel: ${model}\n---\n\n${body}\n`;
}

function claudeCommand(playbook) {
  return `---\ndescription: ${playbook.meta.summary}\n---\n\nRun the sub-agent pipeline for: $ARGUMENTS\n\n${playbook.body}\n`;
}

async function emitClaude({ agents, playbook }, outDir) {
  const written = [];
  for (const agent of agents) {
    const path = join(outDir, '.claude', 'agents', `${agent.meta.name}.md`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, claudeAgent(agent));
    written.push(path);
  }
  const cmd = join(outDir, '.claude', 'commands', 'pipeline.md');
  await mkdir(dirname(cmd), { recursive: true });
  await writeFile(cmd, claudeCommand(playbook));
  written.push(cmd);
  return written;
}

// ---------- Codex target ----------

// TOML multiline literal strings ('''…''') take no escapes, so the one thing
// the body must not contain is the delimiter itself.
function tomlLiteral(text) {
  return `'''\n${text.replaceAll("'''", "''​'")}\n'''`;
}

function codexAgent({ meta, body }) {
  const lines = [
    `name = "${meta.name}"`,
    `description = "${meta.summary.replaceAll('"', '\\"')}"`,
  ];
  // Codex enforces this in the sandbox — stronger than the prose rule alone.
  if (meta.access === 'read') lines.push('sandbox_mode = "read-only"');
  lines.push(`developer_instructions = ${tomlLiteral(body)}`);
  return lines.join('\n') + '\n';
}

function codexPipelineBlock(playbook) {
  const preamble =
    '## Pipeline (banneret)\n\n' +
    'When asked to run the pipeline on a task, follow the playbook below. Codex only ' +
    'spawns subagents when explicitly asked, so at each fan-out phase explicitly spawn ' +
    'the named agents (defined in .codex/agents/).\n';
  return `${MARKER_OPEN}\n${preamble}\n${playbook.body}\n${MARKER_CLOSE}`;
}

async function emitCodex({ agents, playbook }, outDir) {
  const written = [];
  for (const agent of agents) {
    const path = join(outDir, '.codex', 'agents', `${agent.meta.name}.toml`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, codexAgent(agent));
    written.push(path);
  }
  const agentsMd = join(outDir, 'AGENTS.md');
  const block = codexPipelineBlock(playbook);
  let content;
  if (existsSync(agentsMd)) {
    const current = await readFile(agentsMd, 'utf8');
    const managed = new RegExp(
      `${MARKER_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    );
    content = managed.test(current)
      ? current.replace(managed, block)
      : `${current.trimEnd()}\n\n${block}\n`;
  } else {
    content = `${block}\n`;
  }
  await writeFile(agentsMd, content);
  written.push(agentsMd);
  return written;
}

// ---------- entry ----------

export const TARGETS = { claude: emitClaude, codex: emitCodex };

export async function compile({ root, outDir, targets }) {
  const sources = await loadSources(root);
  const written = {};
  for (const target of targets) {
    const emit = TARGETS[target];
    if (!emit) throw new Error(`unknown target "${target}" (have: ${Object.keys(TARGETS).join(', ')})`);
    written[target] = await emit(sources, outDir);
  }
  return written;
}
