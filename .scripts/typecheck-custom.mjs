#!/usr/bin/env node
/**
 * Type-checks the ODELIA custom/ layer against the REAL OHIF types.
 *
 * tsconfig.custom.json maps `@ohif/*` to platform/ and extensions/ SOURCE, which
 * is what makes an upstream bump show up here as type errors instead of silently
 * compiling. The cost is that tsc then also reports diagnostics for the upstream
 * files it pulled into the program: upstream does not enable `strictNullChecks`
 * (see tsconfig.json) and does not typecheck clean under it, which is thousands
 * of pre-existing errors that are not ours to fix.
 *
 * So: run tsc over the whole program, but only report — and only fail on —
 * diagnostics in custom/. Diagnostics elsewhere are counted and summarized so
 * the suppression stays visible.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(import.meta.dirname, '..');

const tsc = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '--pretty',
    'false',
    '-p',
    path.join(repoRoot, 'tsconfig.custom.json'),
  ],
  { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);

if (tsc.error) {
  console.error(tsc.error.message);
  process.exit(1);
}

const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`;
const lines = output.split('\n');

// `path/to/file.ts(12,34): error TS1234: ...`, optionally followed by indented
// continuation lines belonging to the same diagnostic.
const diagnosticStart = /^(\S[^(]*)\((\d+),(\d+)\): (error|warning) TS\d+:/;

const ours = [];
let upstreamCount = 0;
let current = null;

for (const line of lines) {
  const match = line.match(diagnosticStart);
  if (match) {
    const file = match[1];
    current = file.startsWith('custom/') ? { file, lines: [line] } : null;
    if (current) {
      ours.push(current);
    } else {
      upstreamCount++;
    }
    continue;
  }
  if (current && /^\s+/.test(line) && line.trim()) {
    current.lines.push(line);
  }
}

if (upstreamCount) {
  console.log(
    `note: ${upstreamCount} pre-existing diagnostic(s) in upstream platform/, ` +
      `extensions/ and modes/ sources were ignored (upstream builds without ` +
      `strictNullChecks); only custom/ is enforced.`
  );
}

if (!ours.length) {
  console.log('typecheck:custom — no type errors in custom/.');
  process.exit(0);
}

for (const diagnostic of ours) {
  console.log(diagnostic.lines.join('\n'));
}
console.error(`\ntypecheck:custom — ${ours.length} type error(s) in custom/.`);
process.exit(1);
