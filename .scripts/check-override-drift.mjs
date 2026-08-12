// Fails when a workspace manifest declares a dependency version that a
// pnpm-workspace.yaml `overrides` entry exists to replace.
//
// Overrides silently correct a manifest at install time, so a stale (often
// vulnerable) declaration can sit in a package.json indefinitely without
// breaking anything locally. GitHub's dependency graph reads those raw
// declarations, which is how such an entry fails Dependency Review while the
// resolved tree is perfectly fine.
//
// This checks the policy directly (declaration vs override) rather than going
// through the lockfile: pnpm rewrites importer `specifier` fields in ways that
// are not a raw manifest mirror (auto-installed peers are recorded under
// `dependencies`, `devEngines.runtime` is synthesized as a `node` entry), so a
// lockfile comparison encodes serialization details instead of intent.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const semver = require('semver');

const root = process.cwd();
const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

// Selectors that resolve to something local rather than to a registry version.
// An override cannot apply to these and GitHub's graph does not read a version
// out of them, so there is genuinely nothing to compare. Note `*` is NOT here:
// it is a valid semver range that any override matches, so it must go through
// the semver path rather than being skipped.
const LOCAL_SELECTOR = /^(workspace:|link:|file:)/;

// Selectors that DO resolve to a registry version but not one this script can
// read off the declaration (aliases, git refs, dist-tags). Skipping these would
// let a drifted declaration through, so they are reported instead.
const OPAQUE_SELECTOR = /^(npm:|catalog:|git\+|git:|github:|https?:)/;

const workspacePath = path.join(root, 'pnpm-workspace.yaml');
if (!fs.existsSync(workspacePath)) {
  console.error(`[overrides:check] Not found: ${workspacePath}`);
  process.exit(1);
}

const workspace = yaml.load(fs.readFileSync(workspacePath, 'utf8')) ?? {};
const overrides = workspace.overrides ?? {};

// An override key is either `name` or `name@range`. Scoped names start with '@',
// so split on the last '@' rather than the first.
function parseOverrideKey(key) {
  const at = key.lastIndexOf('@');
  if (at <= 0) {
    return { name: key, range: null };
  }
  return { name: key.slice(0, at), range: key.slice(at + 1) };
}

const byName = new Map();
for (const [key, target] of Object.entries(overrides)) {
  const { name, range } = parseOverrideKey(key);
  if (!byName.has(name)) {
    byName.set(name, []);
  }
  byName.get(name).push({ range, target, key });
}

// Expand the workspace `packages` globs. Only the trailing `/*` form is used
// here; anything else is reported rather than silently skipped.
const dirs = ['.'];
for (const pattern of workspace.packages ?? []) {
  if (!pattern.endsWith('/*')) {
    console.error(`[overrides:check] Unsupported workspace pattern: ${pattern}`);
    process.exit(1);
  }
  const base = path.join(root, pattern.slice(0, -2));
  if (!fs.existsSync(base)) {
    continue;
  }
  for (const entry of fs.readdirSync(base)) {
    if (fs.existsSync(path.join(base, entry, 'package.json'))) {
      dirs.push(path.relative(root, path.join(base, entry)));
    }
  }
}

// Does a declared range still admit versions the override was written to
// replace? Returns 'ok', 'drifted', or 'unverifiable' — never silently 'ok' for
// a declaration it could not actually evaluate.
function classify(declared, { range, target }) {
  if (declared === target) {
    return 'ok';
  }
  if (OPAQUE_SELECTOR.test(declared)) {
    return 'unverifiable';
  }
  if (range === null) {
    // Unconditional override: every declaration should already state the target.
    return 'drifted';
  }
  if (!semver.validRange(declared)) {
    // A dist-tag such as `latest` can resolve into the overridden range.
    return 'unverifiable';
  }
  if (!semver.validRange(range)) {
    return 'unverifiable';
  }
  return semver.intersects(declared, range) ? 'drifted' : 'ok';
}

const problems = [];
const unverifiable = [];
for (const dir of dirs) {
  const manifestPath = path.join(root, dir, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    continue;
  }

  for (const field of DEP_FIELDS) {
    for (const [name, declared] of Object.entries(manifest[field] ?? {})) {
      if (typeof declared !== 'string' || LOCAL_SELECTOR.test(declared)) {
        continue;
      }
      for (const override of byName.get(name) ?? []) {
        const verdict = classify(declared, override);
        if (verdict === 'drifted') {
          problems.push({ dir, field, name, declared, override });
        } else if (verdict === 'unverifiable') {
          unverifiable.push({ dir, field, name, declared, override });
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error(
    `[overrides:check] ${problems.length} declaration(s) disagree with pnpm-workspace.yaml overrides:\n`
  );
  for (const { dir, field, name, declared, override } of problems) {
    const rule = override.range ? `${name}@${override.range}` : name;
    console.error(`  ${path.join(dir, 'package.json')}  ${field}.${name}`);
    console.error(`    declared: ${declared}`);
    console.error(`    override: '${rule}' -> ${override.target}`);
    console.error(`    fix: declare ${override.target} directly\n`);
  }
  console.error(
    "[overrides:check] An override corrects these at install time, but the raw declaration is what\n" +
      '  GitHub\'s dependency graph reads and what a standalone install of the package would honour.'
  );
  process.exit(1);
}

// Fail closed rather than reporting a pass this script could not actually
// establish: a dist-tag or alias can still resolve into an overridden range.
if (unverifiable.length > 0) {
  console.error(
    `[overrides:check] ${unverifiable.length} declaration(s) matched an override but could not be checked:\n`
  );
  for (const { dir, field, name, declared, override } of unverifiable) {
    const rule = override.range ? `${name}@${override.range}` : name;
    console.error(`  ${path.join(dir, 'package.json')}  ${field}.${name}`);
    console.error(`    declared: ${declared}  (not a comparable semver range)`);
    console.error(`    override: '${rule}' -> ${override.target}`);
    console.error(`    fix: declare an exact version, or extend this script\n`);
  }
  process.exit(1);
}

console.log(
  `[overrides:check] OK: ${dirs.length} manifests agree with ${Object.keys(overrides).length} overrides`
);
