#!/usr/bin/env node
/**
 * export-from-private.mjs: copy an explicit ALLOWLIST of files from the private
 * Billionaire Army repo into this public source tree.
 *
 * It reads a git REF (default `origin/main`) of the private repo, never its
 * working tree, so uncommitted local work there can never leak here. It never
 * writes to the private repo.
 *
 * Usage:
 *   node scripts/export-from-private.mjs --src <private repo path> [--ref <git ref>] [--dry-run]
 *
 * --src is required (or set $BA_PRIVATE_REPO); there is no default path. --ref defaults to origin/main.
 *
 * Content transforms (all deterministic, all re-applied on every run):
 *   - OVERRIDES: a few files are replaced, in whole or in part, by text kept in
 *     scripts/export-overrides/. Each is pinned to the SHA-256 of the private source
 *     it was written against; if the private file changes, the export REFUSES until
 *     the override is re-reviewed and the pin updated.
 *   - PATCHES: exact find → replace edits per file. Each find must match exactly once
 *     (or the stated count), or the export REFUSES. Where the removed text must not
 *     appear in this script either, a patch replaces N hash-verified lines after an anchor.
 *   - GLOBAL_RULES: regex rules applied to every exported text file (owner-ruling
 *     notes neutralised, local secret-manager wrapper removed, internal card ids dropped).
 *
 * Output: every path copied (with any transform applied), every allowlisted-area
 * path skipped and why, and the counts. Exit 0 on success, 1 on error, 2 on usage error.
 *
 * Files this repo owns and the export never touches: README.md, SECURITY.md,
 * CONTRIBUTING.md, LICENSE-PENDING.md, .env.example, .github/workflows/ci.yml,
 * scripts/export-from-private.mjs, scripts/export-overrides/**. A stale exported file that is no longer on the
 * allowlist is NOT deleted automatically; the script lists such files so you can
 * remove them by hand.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(HERE, "..");

// ---------- args ----------
const args = process.argv.slice(2);
let src = process.env.BA_PRIVATE_REPO || "";
let ref = "origin/main";
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--src") src = args[++i];
  else if (a === "--ref") ref = args[++i];
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--help" || a === "-h") {
    console.log("Usage: node scripts/export-from-private.mjs --src <path> [--ref <ref>] [--dry-run]   (or set BA_PRIVATE_REPO)");
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${a}`);
    process.exit(2);
  }
}
if (!src) {
  console.error("Need the private repo path: pass --src <path> or set BA_PRIVATE_REPO (there is no default).");
  process.exit(2);
}
if (!ref) {
  console.error("--ref needs a value");
  process.exit(2);
}

function git(argv, opts = {}) {
  return execFileSync("git", ["-C", src, ...argv], { maxBuffer: 256 * 1024 * 1024, ...opts });
}

// ---------- allowlist ----------
/** Whole packages copied (subject to JOBS_EXCLUDE inside packages/jobs). */
const PACKAGE_PREFIXES = [
  "packages/api/",
  "packages/db/",
  "packages/shared/",
  "packages/web/",
  "packages/jobs/",
];

/** Root files copied as-is or through a transform. */
const ROOT_FILES = ["package.json", "package-lock.json", "tsconfig.base.json", ".gitignore", "model-seats.json"];

/** Renamed copies. */
const RENAMES = { "docs/PBS_METHODOLOGY.md": "METHODOLOGY.md" };

/**
 * Individual files outside the packages copied as-is (subject to transforms).
 * scripts/check-rls.mjs verifies the database-security SQL in packages/db/sql;
 * the root `check:rls` npm script that runs it is kept.
 */
const EXTRA_FILES = ["scripts/check-rls.mjs"];

/**
 * One-off operational scripts in packages/jobs/src: data repairs, probes and
 * previews written for a single investigation, run by hand against the
 * production database. Not part of the product or the scheduled pipeline.
 * A matching *.test.ts goes with its subject.
 */
const JOBS_EXCLUDE = [
  /^packages\/jobs\/src\/apply-/,
  /^packages\/jobs\/src\/insert-/,
  /^packages\/jobs\/src\/fix-data-issues/,
  /^packages\/jobs\/src\/probe-/,
  /^packages\/jobs\/src\/preview-/,
  /^packages\/jobs\/src\/snapshot-/,
  /^packages\/jobs\/src\/backtest-/,
  /^packages\/jobs\/src\/purge-/,
  /^packages\/jobs\/src\/dedupe-/,
  /^packages\/jobs\/src\/.*b021/,
  /^packages\/jobs\/src\/.*b068/,
];

/**
 * Tests that read an excluded file's SOURCE from disk (a wire-up check on a
 * probe script), so they cannot run without it.
 */
const TESTS_NEEDING_EXCLUDED = [
  "packages/jobs/src/fetchers/feed-curator-currency-wireup.test.ts", // reads probe-passc-context.ts
  "packages/jobs/src/fetchers/feed-curator-passed-over-wireup.test.ts", // reads scripts/read-curator-run.mjs + read-passed-over-composition.mjs
];

/**
 * In exported TEST files, a one-line allowlist row that names an excluded jobs
 * file, e.g. `["jobs/src/probe-x.ts", "reason"],`, is removed. Such a row
 * exempts a file that is not in this tree, and an "allowlist is honest" test
 * then fails on it.
 */
function transformAllowlistRows(path, text) {
  if (!/\.test\.tsx?$/.test(path)) return text;
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*\[\s*"((?:packages\/)?jobs\/src\/[^"]+)"\s*,.*\]\s*,?\s*\r?$/);
    if (m) {
      const full = m[1].startsWith("packages/") ? m[1] : `packages/${m[1]}`;
      if (isJobsExcluded(full)) {
        transformLog.push(`${path}: removed allowlist row for excluded ${m[1]}`);
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Names this repo writes itself; the export refuses to overwrite them. */
const PUBLIC_OWNED = new Set([
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "LICENSE-PENDING.md",
  ".env.example",
  ".github/workflows/ci.yml",
  "scripts/export-from-private.mjs",
]);

function isJobsExcluded(p) {
  return JOBS_EXCLUDE.some((re) => re.test(p));
}

// ---------- transforms ----------
const transformLog = [];

/** Paths of excluded jobs scripts, relative to packages/jobs (e.g. "src/probe-x.ts"). */
let excludedJobsRel = [];

function refsExcluded(cmd) {
  if (/(^|\s|\/)scripts\//.test(cmd) && !EXTRA_FILES.some((f) => cmd.includes(f))) return "references scripts/ (not exported)";
  if (/\.githooks/.test(cmd)) return "references .githooks (not exported)";
  for (const rel of excludedJobsRel) {
    const base = posix.basename(rel);
    if (cmd.includes(base)) return `references excluded ${base}`;
  }
  return null;
}

function stripDoppler(cmd) {
  return cmd.replace(/doppler run --\s+/g, "");
}

function transformJobsPackageJson(text) {
  const pkg = JSON.parse(text);
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    const why = refsExcluded(cmd);
    if (why) {
      delete pkg.scripts[name];
      transformLog.push(`packages/jobs/package.json: dropped script "${name}" (${why})`);
    } else if (cmd !== stripDoppler(cmd)) {
      pkg.scripts[name] = stripDoppler(cmd);
      transformLog.push(`packages/jobs/package.json: removed "doppler run --" from "${name}"`);
    }
  }
  return { text: JSON.stringify(pkg, null, 2) + "\n", pkg };
}

function transformWorkspacePackageJson(path, text) {
  const pkg = JSON.parse(text);
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    if (cmd !== stripDoppler(cmd)) {
      pkg.scripts[name] = stripDoppler(cmd);
      transformLog.push(`${path}: removed "doppler run --" from "${name}"`);
    }
  }
  return JSON.stringify(pkg, null, 2) + "\n";
}

function transformRootPackageJson(text, jobsScripts) {
  const pkg = JSON.parse(text);
  const scripts = pkg.scripts ?? {};
  const dropped = new Set();
  const drop = (name, why) => {
    delete scripts[name];
    dropped.add(name);
    transformLog.push(`package.json: dropped script "${name}" (${why})`);
  };
  // Pass 1: direct references to excluded paths, or to a jobs script the export dropped.
  for (const [name, cmd] of Object.entries(scripts)) {
    const why = refsExcluded(cmd);
    if (why) { drop(name, why); continue; }
    const m = cmd.match(/npm run ([\w:-]+) -w packages\/jobs/);
    if (m && !(m[1] in jobsScripts)) drop(name, `calls jobs script "${m[1]}", which was dropped`);
  }
  // Pass 2 to a fixed point: scripts that call a dropped root script.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, cmd] of Object.entries(scripts)) {
      for (const m of cmd.matchAll(/npm run ([\w:-]+)/g)) {
        if (dropped.has(m[1]) && !cmd.includes(" -w ")) {
          drop(name, `calls dropped script "${m[1]}"`);
          changed = true;
          break;
        }
      }
    }
  }
  for (const [name, cmd] of Object.entries(scripts)) {
    if (cmd !== stripDoppler(cmd)) {
      scripts[name] = stripDoppler(cmd);
      transformLog.push(`package.json: removed "doppler run --" from "${name}"`);
    }
  }
  pkg.scripts = scripts;
  // The locked Supabase packages require Node 22+, so the public engine floor says so.
  if (pkg.engines?.node !== ">=22") {
    pkg.engines = { ...(pkg.engines ?? {}), node: ">=22" };
    transformLog.push('package.json: engines.node set to ">=22" (locked dependencies require it)');
  }
  return JSON.stringify(pkg, null, 2) + "\n";
}

function transformModelSeats(text, copiedSet) {
  const reg = JSON.parse(text);
  const kept = [];
  for (const s of reg.seats ?? []) {
    const file = String(s.file ?? "").replace(/:\d+$/, "");
    if (file && !copiedSet.has(file)) {
      transformLog.push(`model-seats.json: dropped seat "${s.seat}" (its call site ${file} is not exported)`);
      continue;
    }
    if ("reason" in s) {
      delete s.reason;
      transformLog.push(`model-seats.json: removed internal "reason" note from seat "${s.seat}"`);
    }
    kept.push(s);
  }
  reg.seats = kept;
  return JSON.stringify(reg, null, 2) + "\n";
}

/** Entries that only make sense inside the private repo's tooling. */
const GITIGNORE_DROP = [/^\.claude\//, /^\.playwright-mcp\//, /^continuity/, /^dedupe-pairs\.json$/];
function transformGitignore(text) {
  const seen = new Set();
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (GITIGNORE_DROP.some((re) => re.test(line))) {
      transformLog.push(`.gitignore: dropped "${line}" (private-tooling path)`);
      continue;
    }
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  transformLog.push(".gitignore: removed comment lines and duplicate entries");
  return out.join("\n") + "\n";
}

// ---------- content transforms ----------
const OVERRIDES_DIR = join(HERE, "export-overrides");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Whole- or part-file replacements. `pin` is the SHA-256 of the private source the
 * override was written against. A different hash means the private file changed and
 * the override must be re-read against it, so the export refuses rather than guess.
 *   mode "whole": the public file is the override file.
 *   mode "head":  everything before `keepFrom` is replaced by the override file; the
 *                 private text from `keepFrom` onward is kept.
 */
const OVERRIDES = {
  "packages/jobs/src/fetchers/llm-call-log.ts": {
    mode: "whole",
    file: "packages/jobs/src/fetchers/llm-call-log.ts",
    pin: "c04921c3eba50a856df2511b1fa32c2d60753dc9250f93c86915c5fb994a05e9",
    why: "logging is opt-in via LLM_CALL_LOG_URL; no built-in destination",
  },
  "packages/jobs/src/fetchers/llm-call-log.test.ts": {
    mode: "whole",
    file: "packages/jobs/src/fetchers/llm-call-log.test.ts",
    pin: "31a2cec128ffc56010df5f65c3d37494d8c0fecd05b5f295d29ea60e7b97d730",
    why: "tests for the opt-in logging contract",
  },
  "METHODOLOGY.md": {
    mode: "head",
    file: "METHODOLOGY.head.md",
    keepFrom: "## Where it lives in code",
    pin: "f1588e0d565a78dccb97bafb082be17793f216cbf3a88d38446f7c961981eb77",
    why: "claims narrowed to what the code does; production numbers labelled as dated snapshots",
  },
};

function applyOverride(path, buf) {
  const o = OVERRIDES[path];
  if (!o) return buf;
  const got = sha256(buf);
  if (got !== o.pin) {
    throw new Error(
      `override for ${path} is pinned to private sha256 ${o.pin} but the source is now ${got}; ` +
        `re-review scripts/export-overrides/${o.file} against the new source, then update the pin`
    );
  }
  const replacement = readFileSync(join(OVERRIDES_DIR, o.file), "utf8");
  if (o.mode === "whole") {
    transformLog.push(`${path}: replaced by export-overrides/${o.file} (${o.why})`);
    return Buffer.from(replacement);
  }
  const text = buf.toString("utf8");
  const at = text.indexOf(o.keepFrom);
  if (at < 0 || text.indexOf(o.keepFrom, at + 1) >= 0) {
    throw new Error(`override for ${path}: "${o.keepFrom}" must occur exactly once`);
  }
  transformLog.push(`${path}: text before "${o.keepFrom}" replaced by export-overrides/${o.file} (${o.why})`);
  return Buffer.from(replacement + text.slice(at));
}

/**
 * Exact find → replace edits. Each `find` must occur exactly `count` times (default 1)
 * in the private text, or the export refuses.
 */
const PATCHES = {
  // Personal data: a private family member's medical detail. The event stays identified.
  "packages/shared/src/feed-superseded.ts": [
    {
      after: `        "Pershing Square stock to fund brain research institute' (08-24, Hedgeweek) repeats as " +`,
      lines: 3,
      sha256: "469daf035a521827d107bc9bca3ee0a21c195c0156734d4117c447daced27b79",
      replace:
        `        ` +
        `"'Bill Ackman and Neri Oxman donate $400 million to brain research…' (09-04). The survivor " +\n` +
        `        "is the later card: same gift.",`,
    },
  ],
  // Personal data: a family-law detail in a test fixture (the test only needs a self-narrating sentence).
  "packages/shared/src/summary-self-narration.test.ts": [
    {
      after: `  "Two validated news articles from August 14–15, 2026 reported on federal grants for Amtrak’s Chicago maintenance-facility relocation.",`,
      lines: 1,
      sha256: "abaaa372241e8a355a4cb24ae9d8dc73d73138464cd3857d6d2f1089889d3a73",
      replace: `  "Two validated news articles published August 15–17, 2026 reported on a court case involving Overdeck.",`,
    },
  ],
  // A local-machine path in a comment.
  "packages/web/next.config.ts": [
    {
      after: "  // Pin the workspace root to the monorepo. Without this, Next infers the root",
      lines: 3,
      sha256: "9ef3e1bd2bebfcc0c5dbd0d9f238bbf9d836ecae4fdc835abda6bdb79ab0417b",
      replace:
        "  // by walking up for lockfiles and can latch onto a stray lockfile outside the\n" +
        "  // repo (which once broke `next build` with a /404 prerender error).",
    },
  ],
  // No production default: the checker probes whatever API you name.
  "packages/jobs/src/check-card-badge-agreement.ts": [
    {
      regex: /const API = process\.env\.BA_API_URL \?\? "[^"]*";/g,
      min: 1,
      replace:
        "// Required: the API base to read /api/feed from (e.g. http://localhost:3001). There is no default.\n" +
        'const API = process.env.BA_API_URL?.trim() || "";',
    },
    {
      find: "} else {\n  let code = 2;\n  try {\n    const res = await fetch(`${API}/api/feed",
      replace:
        "} else if (!API) {\n" +
        '  console.log("RESULT: BAD INPUT — set BA_API_URL to the API base to probe, e.g. http://localhost:3001 (exit 1)");\n' +
        "  process.exitCode = 1;\n" +
        "} else {\n  let code = 2;\n  try {\n    const res = await fetch(`${API}/api/feed",
    },
  ],
  // Sample data must not contradict the checked-in signatory list.
  "packages/db/src/seed.ts": [
    {
      find: "const seedPersons = [",
      replace:
        "// Sample rows for local development only. They are not verified facts; the real\n" +
        "// pipeline builds person records from public sources (see packages/jobs).\n" +
        "const seedPersons = [",
    },
    {
      find:
        '{ type: "residence", details: "Florida" }],\n' +
        "    badges: { givingPledge: true,",
      replace:
        '{ type: "residence", details: "Florida" }],\n' +
        "    badges: { givingPledge: false,",
    },
  ],
  // Unrelated people's names, cities and family relationships are not needed by the
  // runtime (it reads only the EINs); the EIN, evidence URL and rationale stay.
  "packages/jobs/src/fetchers/foundation-trustee-review.ts": [
    { regex: /"Ford Family Foundation" \([^)]*\)/g, replace: `"Ford Family Foundation" (an unrelated family's foundation)`, min: 1 },
    { regex: / ?; officer rows list [^—`]*— /g, replace: " — ", min: 1 },
    { regex: /\$\{NO_OFFICER\} \([^)]*\)/g, replace: "${NO_OFFICER}", min: 1 },
  ],
  "packages/jobs/src/model-seats.ts": [
    {
      find:
        " * Model-seat resolver — the whole of it (portfolio standard\n" +
        " * `skylark-site/docs/model-registry-standard.md`, David's ruling 2026-09-06,\n" +
        ' * board card 74e1c5f2: "a comparison is not what we do — an inventory he edits").',
      replace: " * Model-seat resolver — the whole of it. The registry is an inventory of which\n * model each seat uses, edited by hand.",
    },
    {
      find:
        "A shared runtime layer across 21 repos is a single\n" +
        " * point of failure that strips provider features, which is why the pattern is\n" +
        " * distributed by COPY — this file imports nothing from skylark-site, because a\n" +
        " * `../skylark-site/...` import resolves on David's machine and breaks CI, where\n" +
        " * skylark-site is not checked out.",
      replace:
        "A shared runtime layer is a single\n" +
        " * point of failure that strips provider features, which is why this file is\n" +
        " * self-contained and imports nothing from outside this repository.",
    },
  ],
  "packages/jobs/src/anthropic-judge.ts": [
    {
      find:
        " * ENFORCING gate, silently, into a fail-open catch. The registry standard\n" +
        " * (`skylark-site/docs/model-registry-standard.md` § 8) wants a judge on a\n" +
        " * DIFFERENT model family from the writer it grades; after David's 2026-09-06\n" +
        " * inventory the judges sit on `gpt-5.6-terra`, the same model as Pass A. This",
      replace:
        " * ENFORCING gate, silently, into a fail-open catch. A judge belongs on a\n" +
        " * DIFFERENT model family from the writer it grades; when this file landed the\n" +
        " * judges sat on `gpt-5.6-terra`, the same model as Pass A. This",
    },
    { find: ' * WHAT THIS IS NOT (§ 5 of the standard, "Never a router"). It is not a', replace: " * WHAT THIS IS NOT. It is not a" },
    {
      find: "(GitHub Actions repository secret for the scheduled runs; ` +\n        `\\`doppler run --\\` locally), or unset",
      replace: "(for example from .env, or a CI secret for scheduled runs), ` +\n        `or unset",
    },
  ],
  "packages/shared/src/figure-disagreement.ts": [
    {
      find:
        " * ⚠ THIS IS AN INTERIM INSTRUMENT, NOT THE BLOCK — and NOT a ruling against the block. David\n" +
        ' * authorised exactly one block (board card 30cfaf53, 2026-09-12): "Let it block only where a section\n' +
        ' * states a dollar figure that disagrees with our stored records. Everywhere else it stays log-only."\n' +
        ' * That block is OWED. A 2026-09-14 entry here first called this file "a dated ruling" that the block\n' +
        " * must not ship; the orchestrator overturned that (bus cef485cd) because only David can decide his\n" +
        " * ruling cannot be implemented. Its four-condition test then PASSED for a design built on this file\n" +
        " * plus derived sums as typo targets — so the block is buildable, and this single-figure predicate is\n" +
        " * the part that alone is too weak to be it (see the reach finding below).",
      replace:
        " * ⚠ THIS IS AN INTERIM INSTRUMENT, NOT THE BLOCK. The block (figure-block.ts) is the one place a\n" +
        ' * section may be held back: "only where a section states a dollar figure that disagrees with our\n' +
        ' * stored records. Everywhere else it stays log-only." This single-figure predicate is too weak to be\n' +
        " * that block on its own (see the reach finding below); a design built on it plus derived sums as\n" +
        " * typo targets is buildable.",
    },
  ],
  "packages/shared/src/figure-quarantine.ts": [
    {
      find:
        " * B-045 C2 — PRESERVATION, NOT DELETION (orchestrator ruling 2026-09-17, bus ac23cd8e, inside David's\n" +
        " * card 30cfaf53). `figure-block.ts` is the PREDICATE",
      replace: " * PRESERVATION, NOT DELETION. `figure-block.ts` is the PREDICATE",
    },
  ],
  "packages/shared/src/approved-sections.test.ts": [
    { find: 'ruling: "card bd7748dc"', replace: 'ruling: "decision-0001"' },
  ],
  "packages/jobs/src/fetchers/profile-summary-approved-sections-wireup.test.ts": [
    { find: 'ruling: "card cced4006"', replace: 'ruling: "decision-0002"' },
  ],
  "scripts/check-rls.mjs": [
    { find: " See docs/engineering-health-review-2026-07-29.md finding F1.", replace: "" },
    { find: " not slowly (CLAUDE.md).", replace: " not slowly." },
    {
      find: 'These are PUBLIC values. Run under: doppler run -- npm run check:rls");',
      replace: 'These are PUBLIC values; export them (e.g. from .env) before running.");',
    },
  ],
};

function applyPatches(path, text) {
  const list = PATCHES[path];
  if (!list) return text;
  for (const p of list) {
    if (p.after) {
      // Replace the `lines` lines that follow a unique anchor line, verified by hash. Used
      // where the removed text is itself what must not be published, so it never appears
      // in this script.
      const lines = text.split("\n");
      const hits = lines.flatMap((l, i) => (l.replace(/\r$/, "") === p.after ? [i] : []));
      if (hits.length !== 1) throw new Error(`patch for ${path}: anchor line found ${hits.length} time(s), expected 1`);
      const start = hits[0] + 1;
      const block = lines.slice(start, start + p.lines).join("\n");
      if (sha256(block) !== p.sha256) {
        throw new Error(`patch for ${path}: the ${p.lines} line(s) after the anchor changed (sha256 ${sha256(block)}); re-review`);
      }
      lines.splice(start, p.lines, ...p.replace.split("\n"));
      text = lines.join("\n");
      transformLog.push(`${path}: replaced ${p.lines} hash-verified line(s) after an anchor`);
      continue;
    }
    if (p.regex) {
      const n = [...text.matchAll(p.regex)].length;
      if (n < (p.min ?? 1)) throw new Error(`patch for ${path}: ${p.regex} matched ${n} time(s), expected at least ${p.min ?? 1}`);
      text = text.replace(p.regex, p.replace);
      transformLog.push(`${path}: ${n} match(es) of ${p.regex} rewritten`);
      continue;
    }
    const want = p.count ?? 1;
    const n = text.split(p.find).length - 1;
    if (n !== want) {
      throw new Error(`patch for ${path}: expected ${want} match(es) of ${JSON.stringify(p.find.slice(0, 80))}, found ${n}`);
    }
    text = text.split(p.find).join(p.replace);
    transformLog.push(`${path}: patched ${JSON.stringify(p.find.slice(0, 60))}`);
  }
  return text;
}

/** Text file types the global rules apply to (JSON and lockfiles are left alone). */
const TEXT_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|md|sql|css|html|txt|ya?ml)$/;

/**
 * Regex rules over every exported text file. Owner names in rulings are internal process
 * notes, not rationale, so "David's ruling" becomes "the owner's ruling" and the rationale
 * around it stays. A name followed by a capitalised word ("David Tepper") is a different
 * person and is never touched. Card/bus ids in parentheses are dropped.
 */
const GLOBAL_RULES = [
  { name: "local secret-manager wrapper", re: /doppler run --\s+/g, to: () => "" },
  { name: "owner-ruling adjective", re: /\bDavid-(approved|ruled|reviewed|greenlit)\b/g, to: (_m, w) => `owner-${w}` },
  { name: "owner card", re: /\bDavid card\b/g, to: () => "owner card" },
  {
    name: "owner name in a ruling note",
    re: /\bDavid\b(?![ \t]+[A-Z])(?!-)/g,
    to: (m, offset, whole) => {
      const lineStart = whole.lastIndexOf("\n", offset - 1) + 1;
      const prefix = whole.slice(lineStart, offset);
      let sentenceStart = /[.!?]\s+(?:\*\*)?$/.test(prefix);
      if (!sentenceStart && /^\s*(?:\*+|\/\/+|\/\*+|#+|--)?\s*$/.test(prefix)) {
        // First word on a comment line: a sentence start unless the previous comment line
        // runs on into it (does not end in sentence punctuation).
        const prevEnd = lineStart - 1;
        const prevStart = whole.lastIndexOf("\n", prevEnd - 1) + 1;
        const prev = whole.slice(prevStart, prevEnd).replace(/\r$/, "");
        const prevBody = prev.replace(/^\s*(?:\/\*+|\*+|\/\/+|#+|--)\s?/, "").trimEnd();
        const prevIsComment = /^\s*(?:\/\*+|\*+|\/\/+|#+|--)/.test(prev);
        sentenceStart = !prevIsComment || prevBody === "" || /[.!?:"”)]$/.test(prevBody);
      }
      return sentenceStart ? "The owner" : "the owner";
    },
  },
  { name: "internal card/bus id", re: /\s*\((?:board card|bus) [0-9a-f]{8}\)/g, to: () => "" },
  { name: "internal card id after a date", re: /,\s*board card [0-9a-f]{8}/g, to: () => "" },
];

function applyGlobalRules(path, text) {
  if (!TEXT_EXT.test(path)) return text;
  for (const r of GLOBAL_RULES) {
    let n = 0;
    text = text.replace(r.re, (...a) => {
      n++;
      const whole = a[a.length - 1];
      const offset = a[a.length - 2];
      return r.to(a[0], ...(typeof a[1] === "string" ? [a[1]] : []), offset, whole);
    });
    if (n) transformLog.push(`${path}: ${n} × ${r.name}`);
  }
  return text;
}

// ---------- main ----------
const sha = git(["rev-parse", ref], { encoding: "utf8" }).trim();
const all = git(["ls-tree", "-r", "--name-only", ref], { encoding: "utf8" }).split("\n").filter(Boolean);

const plan = []; // { from, to }
const skipped = []; // { path, why }
for (const p of all) {
  if (RENAMES[p]) { plan.push({ from: p, to: RENAMES[p] }); continue; }
  if (ROOT_FILES.includes(p) || EXTRA_FILES.includes(p)) { plan.push({ from: p, to: p }); continue; }
  if (PACKAGE_PREFIXES.some((pre) => p.startsWith(pre))) {
    if (isJobsExcluded(p)) { skipped.push({ path: p, why: "one-off operational script (or its test)" }); continue; }
    if (TESTS_NEEDING_EXCLUDED.includes(p)) { skipped.push({ path: p, why: "test reads an excluded script's source" }); continue; }
    plan.push({ from: p, to: p });
  }
}
excludedJobsRel = skipped
  .filter((s) => s.path.startsWith("packages/jobs/"))
  .map((s) => s.path.slice("packages/jobs/".length));

for (const { to } of plan) {
  if (PUBLIC_OWNED.has(to) || to.startsWith("scripts/export-overrides/")) {
    console.error(`REFUSING: allowlist would overwrite public-owned file ${to}`);
    process.exit(1);
  }
}

const copiedSet = new Set(plan.map((x) => x.to));
const read = (p) => git(["show", `${ref}:${p}`]); // Buffer

// Transform order matters: jobs package.json first (root depends on what it kept).
const jobsPkgRaw = read("packages/jobs/package.json").toString("utf8");
const jobs = transformJobsPackageJson(jobsPkgRaw);

const contents = new Map();
for (const { from, to } of plan) {
  let buf = read(from);
  if (to === "packages/jobs/package.json") buf = Buffer.from(jobs.text);
  else if (to === "packages/api/package.json" || to === "packages/web/package.json" || to === "packages/db/package.json" || to === "packages/shared/package.json")
    buf = Buffer.from(transformWorkspacePackageJson(to, buf.toString("utf8")));
  else if (to === "package.json") buf = Buffer.from(transformRootPackageJson(buf.toString("utf8"), jobs.pkg.scripts ?? {}));
  else if (to === "package-lock.json") {
    const lock = JSON.parse(buf.toString("utf8"));
    const root = lock.packages?.[""];
    if (root && root.engines?.node !== ">=22") {
      root.engines = { ...(root.engines ?? {}), node: ">=22" };
      transformLog.push('package-lock.json: root engines.node set to ">=22" (matches package.json)');
      buf = Buffer.from(JSON.stringify(lock, null, 2) + "\n");
    }
  }
  else if (to === "model-seats.json") buf = Buffer.from(transformModelSeats(buf.toString("utf8"), copiedSet));
  else if (to === ".gitignore") buf = Buffer.from(transformGitignore(buf.toString("utf8")));
  else if (/\.test\.tsx?$/.test(to)) {
    const before = buf.toString("utf8");
    const after = transformAllowlistRows(to, before);
    if (after !== before) buf = Buffer.from(after);
  }
  try {
    buf = applyOverride(to, buf);
    if (PATCHES[to] || TEXT_EXT.test(to)) {
      const before = buf.toString("utf8");
      const after = applyGlobalRules(to, applyPatches(to, before));
      if (after !== before) buf = Buffer.from(after);
    }
  } catch (err) {
    console.error(`REFUSING: ${err.message}`);
    process.exit(1);
  }
  contents.set(to, { from, buf });
}
for (const p of [...Object.keys(OVERRIDES), ...Object.keys(PATCHES)]) {
  if (!contents.has(p)) {
    console.error(`REFUSING: a transform names ${p}, which this export does not contain`);
    process.exit(1);
  }
}

// .env.example check: every variable NAME in the private file must appear in the public one.
const envNames = (t) => new Set([...t.matchAll(/^\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
const privateEnv = envNames(read(".env.example").toString("utf8"));
const publicEnvPath = join(OUT_ROOT, ".env.example");
const publicEnv = existsSync(publicEnvPath) ? envNames(readFileSync(publicEnvPath, "utf8")) : new Set();
const missingEnv = [...privateEnv].filter((n) => !publicEnv.has(n));

console.log(`Source: ${src} @ ${ref} (${sha})`);
console.log(`Output: ${OUT_ROOT}${dryRun ? " (dry run, nothing written)" : ""}`);
console.log("");
console.log("COPIED:");
for (const [to, { from }] of [...contents.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(from === to ? `  ${to}` : `  ${from} -> ${to}`);
  if (!dryRun) {
    const dest = join(OUT_ROOT, to);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, contents.get(to).buf);
  }
}
console.log("");
console.log("SKIPPED inside allowlisted areas:");
for (const s of skipped) console.log(`  ${s.path}  (${s.why})`);
console.log("");
console.log("TRANSFORMS:");
for (const t of transformLog) console.log(`  ${t}`);
console.log("");

// Stale files: present in packages/ here but not in this export.
const stale = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else {
      const rel = relative(OUT_ROOT, full).split("\\").join("/");
      if (!copiedSet.has(rel) && !rel.endsWith(".tsbuildinfo")) stale.push(rel);
    }
  }
}
walk(join(OUT_ROOT, "packages"));
if (stale.length) {
  console.log("STALE (in packages/ here, not in this export; remove by hand):");
  for (const s of stale) console.log(`  ${s}`);
  console.log("");
}

if (missingEnv.length) {
  console.log(`ENV CHECK: public .env.example is missing ${missingEnv.length} name(s): ${missingEnv.join(", ")}`);
} else {
  console.log(`ENV CHECK: public .env.example covers all ${privateEnv.size} variable names in the private one`);
}
console.log(`RESULT: copied ${contents.size} files, skipped ${skipped.length}, transforms ${transformLog.length}`);
process.exit(0);
