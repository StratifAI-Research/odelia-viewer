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
 *
 * That suppression has to fail CLOSED, which is the subtle part. tsc exits 2 on
 * the suppressed upstream errors, so its exit status carries no signal by
 * itself, and an earlier version of this script therefore ignored the status
 * entirely — which meant a crash, an OOM, an empty program, or an error in
 * tsconfig.custom.json all reported success. The two guards below cover that:
 * a diagnostic attributable to neither bucket is a configuration error and
 * fails, and a non-zero exit with no diagnostics at all means no check ever ran.
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

// Diagnostics are attributed by path prefix, and the buckets have to be
// exhaustive. Anything outside both `custom/` and upstream — most importantly
// `tsconfig.custom.json`, the file that governs this whole gate — used to fall
// into the upstream bucket and be suppressed, so a broken config read as
// "2320 pre-existing upstream errors" and passed.
const UPSTREAM_PREFIXES = ['platform/', 'extensions/', 'modes/', 'node_modules/'];

const ours = [];
const unattributed = [];
let upstreamCount = 0;
let current = null;

for (const line of lines) {
  const match = line.match(diagnosticStart);
  if (match) {
    const file = match[1];
    if (file.startsWith('custom/')) {
      current = { file, lines: [line] };
      ours.push(current);
    } else if (UPSTREAM_PREFIXES.some(prefix => file.startsWith(prefix))) {
      current = null;
      upstreamCount++;
    } else {
      current = { file, lines: [line] };
      unattributed.push(current);
    }
    continue;
  }
  if (current && /^\s+/.test(line) && line.trim()) {
    current.lines.push(line);
  }
}

const fail = reason => {
  console.error(output.trim() || 'tsc produced no output');
  console.error(`\ntypecheck:custom — ${reason}`);
  process.exit(1);
};

// A signal is never a normal tsc exit. Checked FIRST and on its own: an earlier
// version only looked at signals when no diagnostics had been parsed at all,
// which meant a tsc killed (OOM, SIGKILL from a CI memory cap) *after* printing
// even one upstream diagnostic was reported as a pass — and printing thousands
// of upstream diagnostics is the very first thing this run does, so that is the
// likely shape of a real crash rather than an exotic one.
if (tsc.signal) {
  fail(`tsc was killed by ${tsc.signal}, so nothing was actually checked.`);
}

// Fatal runtime failures that tsc reports as prose rather than as a diagnostic,
// and so survive the parse above however many diagnostics preceded them.
const FATAL_OUTPUT = /FATAL ERROR|JavaScript heap out of memory|Debug Failure|Maximum call stack/;

if (FATAL_OUTPUT.test(output)) {
  fail('tsc reported a fatal error, so its diagnostics cannot be trusted.');
}

// tsc exits non-zero on the suppressed upstream errors, so the status alone says
// nothing. But a non-zero exit having produced NO diagnostics at all means it
// never ran a real check: a crash, or a program with no inputs (TS18003, which
// tsc prints without a `file(line,col)` prefix and so is invisible to the parse).
if (tsc.status !== 0 && !ours.length && !unattributed.length && !upstreamCount) {
  fail(
    `tsc exited with ${tsc.status} without reporting a single diagnostic, so nothing was checked.`
  );
}

if (unattributed.length) {
  for (const diagnostic of unattributed) {
    console.error(diagnostic.lines.join('\n'));
  }
  console.error(
    `\ntypecheck:custom — ${unattributed.length} diagnostic(s) outside custom/ and outside ` +
      `upstream sources. These are configuration errors, not pre-existing upstream noise.`
  );
  process.exit(1);
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
