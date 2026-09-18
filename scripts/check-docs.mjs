import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately offline: checks documentation structure, never deployment claims.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = 'docs/catalog.md';
const skip = new Set(['node_modules', 'dist', 'build', 'vendor', 'coverage', 'minimals']);
const paths = [];
function walk(dir) {
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && entry.name.endsWith('.md') && path !== catalog) paths.push(path);
  }
}
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.md')) paths.push(entry.name);
}
for (const dir of ['docs', 'deploy', 'apps', 'services', 'packages']) {
  if (existsSync(resolve(root, dir))) walk(dir);
}
paths.sort();
function title(path) {
  return readFileSync(resolve(root, path), 'utf8').match(/^#\s+(.+)$/m)?.[1] || path;
}
function index() {
  const rows = [
    '# Markdown 完整目录', '',
    '> 由 `pnpm docs:index` 生成；请勿手改。此清单只表示文件存在，不代表能力、部署或验收状态。', '',
    '当前能力见[状态摘要](current-state.md)，推荐阅读见[文档索引](README.md)，维护方式见[Harness](harness/README.md)。', '',
  ];
  let group;
  for (const path of paths) {
    const next = dirname(path) === '.' ? '仓库根目录' : dirname(path);
    if (next !== group) { if (group) rows.push(''); rows.push(`## ${next}`, ''); group = next; }
    const label = title(path).replaceAll('[', '\\[').replaceAll(']', '\\]');
    const target = relative(resolve(root, 'docs'), resolve(root, path)).split('/').map(encodeURIComponent).join('/');
    rows.push(`- [${label}](${target}) — \`${path}\``);
  }
  return `${rows.join('\n')}\n`;
}
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--write-index')) {
  console.error('Usage: node scripts/check-docs.mjs [--write-index]');
  process.exit(2);
}
const generated = index();
if (args.includes('--write-index')) {
  writeFileSync(resolve(root, catalog), generated);
  console.log(`Updated ${catalog}: ${paths.length} documents.`);
}
const errors = [];
if (!existsSync(resolve(root, catalog)) || readFileSync(resolve(root, catalog), 'utf8') !== generated) {
  errors.push('docs/catalog.md is outdated; run pnpm docs:index.');
}
let links = 0, jsonExamples = 0;
for (const path of [...paths, ...(existsSync(resolve(root, catalog)) ? [catalog] : [])]) {
  const text = readFileSync(resolve(root, path), 'utf8');
  const lines = text.split('\n');
  let fence = null, language = '', code = [], lineStart = 0;
  const prose = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence && match) {
      fence = match[1]; language = match[2].trim(); code = []; lineStart = i + 1;
    } else if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) {
        if (language === 'json') {
          try { JSON.parse(code.join('\n')); jsonExamples++; }
          catch (error) { errors.push(`${path}:${lineStart}: invalid JSON example: ${error.message}`); }
        }
        fence = null;
      } else code.push(lines[i]);
    } else prose.push([i + 1, lines[i].replace(/`+[^`]*`+/g, '')]);
  }
  if (fence) errors.push(`${path}:${lineStart}: unclosed code fence`);
  for (const [line, content] of prose) {
    // Inline/image links and reference definitions; anchors and external URLs are out of scope.
    const targets = [
      ...content.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g),
      ...content.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/g),
    ];
    for (const match of targets) {
      const target = match[1] || match[2];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) continue;
      let local;
      try { local = decodeURIComponent(target.split(/[?#]/)[0]); }
      catch { errors.push(`${path}:${line}: invalid URL encoding: ${target}`); continue; }
      if (!local) continue;
      links++;
      if (!existsSync(resolve(root, dirname(path), local))) errors.push(`${path}:${line}: missing local target ${target}`);
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${paths.length + 1} Markdown files, ${links} local links and ${jsonExamples} JSON examples; catalog is current. External URLs, anchors and runtime claims were not checked.`);
