import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Intentionally published, size-limited homepage sample; personal renders stay excluded.
const publicDemoVideo = filename => filename === 'docs/public/demo/sailboat.mp4';
const privatePath = /(?:^|\/)(?:node_modules|\.data|\.desktop|\.media-tools|\.next(?:-[^/]+)?|\.npm-cache|release|\.codex|\.claude|\.agents)(?:\/|$)|(?:^|\/)\.env(?![^/]*\.example$)(?:\.|$)|\.local(?:\/|\.)|\.(?:safetensors|gguf|ggml|ckpt|pt|pth|onnx|sqlite(?:3)?(?:-[^/]*)?|db(?:-[^/]*)?|pem|key|p12|pfx|dmg|pkg|exe|AppImage|tar\.gz|mp4|mov|webm)$/i;
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}\b/],
];

export function sourceIssues(filename, content) {
  const issues = [];
  if (privatePath.test(filename) && !publicDemoVideo(filename)) issues.push('private/runtime file is included');
  for (const [name, pattern] of secretPatterns) if (pattern.test(content)) issues.push(`possible ${name}`);
  if (/\/(?:Users|home)\/[A-Za-z0-9._-]+\//.test(content)) issues.push('machine-specific home path');
  return issues;
}

// Use Git's real ignore rules before the first git init as well as afterward.
// A temporary Git directory never creates or changes the project's index.
export async function candidateFiles(directory = root) {
  let temporary;
  const options = { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    let git = [];
    try { execFileSync('git', ['rev-parse', '--show-toplevel'], options); }
    catch {
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-source-audit-'));
      execFileSync('git', ['init', '--bare', temporary], options);
      git = [`--git-dir=${temporary}`, `--work-tree=${directory}`];
    }
    // Include tracked files even when newly ignored: .gitignore cannot untrack them.
    return [...new Set(execFileSync('git', [...git, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], options).split('\0').filter(Boolean))].sort();
  } finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
}

export async function checkSource(directory = root) {
  const files = await candidateFiles(directory), findings = [];
  for (const filename of files) {
    const file = path.join(directory, filename), stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!stat) continue; // Tracked deletions are absent from the next source snapshot.
    if (!stat.isFile() || stat.isSymbolicLink()) { findings.push(`${filename}: source must be a regular file`); continue; }
    // Never read a private file just to report that Git would include it.
    if (privatePath.test(filename) && !publicDemoVideo(filename)) { findings.push(`${filename}: private/runtime file is included`); continue; }
    if (stat.size > 2 * 1024 * 1024) { findings.push(`${filename}: unexpected source file over 2 MB`); continue; }
    const buffer = await fs.readFile(file);
    if (buffer.includes(0)) {
      if (!publicDemoVideo(filename) && !/^(?:public|docs\/public)\/.*\.(?:png|jpe?g|webp|ico|woff2?)$/i.test(filename)) findings.push(`${filename}: unexpected binary file`);
      continue;
    }
    for (const issue of sourceIssues(filename, buffer.toString('utf8'))) findings.push(`${filename}: ${issue}`);
  }
  return { files, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { files, findings } = await checkSource();
  if (findings.length) {
    console.error(`Source audit found ${findings.length} issue(s):\n${findings.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Source audit passed: ${files.length} candidate files; ignored content was not read. Review git diff --cached before committing.`);
}
