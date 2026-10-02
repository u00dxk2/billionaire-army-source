import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * B-030 — the fork guard, and it exists because the probe MISSED this exact defect.
 *
 * `check:plausibility` reported `COLLAPSE APPLIED: 3/3` on 2026-08-12 while
 * billionaire.army was still serving `$152.5B / Foundation Assets`. Both statements were
 * true: the probe exercises `foundationTotals()` and the SCORER, so it proved the helper
 * collapses — it cannot see whether a rendering CONSUMER calls it. The profile page was
 * reading `data.totalFoundationAssets` straight off the stored fact, and `/compare` was
 * reducing the array itself. Two of four consumers were fixed and the gate said clean.
 *
 * A gate cannot adjudicate its own blind spot. This test is the blind spot, closed
 * statically: `totalFoundationAssets` and `totalGrantsPaid` are the fetcher's UN-COLLAPSED
 * sums, so outside the two places that are ALLOWED to touch them — the fetcher that writes
 * them, and the shared helper that reads them as a fallback — any reference is a fork
 * re-publishing the doubled figure.
 *
 * No network, no DB: it runs inside `npm test`, which is the gate that actually blocks.
 * If you add a legitimate consumer, route it through `foundationTotals()` rather than
 * widening this allowlist — widening it is how the defect comes back.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const RAW_SUM_FIELDS = /\b(totalFoundationAssets|totalGrantsPaid)\b/;

/** Files permitted to name the raw sums, each for a stated reason. */
const ALLOWED = [
  // writes them
  join("packages", "jobs", "src", "fetchers", "propublica-990.ts"),
  // reads them, but only as the no-foundations[] fallback — this IS the collapse
  join("packages", "shared", "src", "foundation-endowment.ts"),
  // the probe compares raw-vs-collapsed on purpose
  join("packages", "jobs", "src", "probe-b030-plausibility.ts"),
  // this guard names the fields to search for them
  join("packages", "shared", "src", "foundation-endowment-fork.test.ts"),
  // builds stored-shape fixtures to prove the fallback and the ignore-stored-sums rule
  join("packages", "shared", "src", "foundation-endowment.test.ts"),
  // ONE stored-shape fixture, to prove the B-030 prose repair is a NO-OP on legacy facts that
  // carry no foundations[]. A fixture, not a consumer: no code path here reads the raw sums.
  join("packages", "shared", "src", "foundation-prose-repair.test.ts"),
  // OVERWRITES both fields with foundationTotals()' output before the summary model is handed
  // the fact JSON — it never reads the raw sums, it deletes them by replacement. Named here
  // because the collapsed values keep the stored key names, so the payload shape the model sees
  // is unchanged. Not a widening: a consumer that READ them would still fail this guard.
  join("packages", "jobs", "src", "fetchers", "summary-fact-collapse.ts"),
  // asserts the doubled figure is absent from the collapsed prompt payload
  join("packages", "jobs", "src", "fetchers", "summary-fact-collapse.test.ts"),
];

/**
 * Comments are not reads. Excluding them is not a loophole — the fix for this defect REQUIRES
 * naming the fields in prose at each repaired call site, so a guard that flagged comments would
 * fire on its own remediation and get muted. It still catches every real access.
 */
const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", "tmp"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

test("no consumer reads the un-collapsed foundation sums outside the allowlist (B-030 fork guard)", () => {
  const offenders: string[] = [];
  for (const file of walk(join(REPO, "packages"))) {
    const rel = relative(REPO, file);
    if (ALLOWED.some((a) => rel === a || rel.split(sep).join(sep) === a)) continue;
    const src = readFileSync(file, "utf8");
    // A type DECLARATION naming the stored shape is fine; a READ is not. Both appear as the
    // bare identifier, so require an access or destructure to avoid flagging interfaces.
    for (const [i, line] of src.split("\n").entries()) {
      if (!RAW_SUM_FIELDS.test(line)) continue;
      if (isComment(line)) continue;
      const isDeclaration = /^\s*(readonly\s+)?(totalFoundationAssets|totalGrantsPaid)\s*[?]?\s*:/.test(line);
      if (isDeclaration) continue;
      offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "These read the fetcher's un-collapsed sums directly. Route them through foundationTotals() " +
      "from @ba/shared instead — reading the stored totals is how B-030 published a 2x figure:\n" +
      offenders.join("\n")
  );
});

test("the guard can actually fail — it finds the fields where they legitimately live", () => {
  // Positive control: without it, an allowlist typo or a broken walk would make the test above
  // pass by scanning nothing, which is the comfortable-green shape this repo keeps hitting.
  const helper = readFileSync(
    join(REPO, "packages", "shared", "src", "foundation-endowment.ts"),
    "utf8"
  );
  assert.ok(RAW_SUM_FIELDS.test(helper), "pattern must match the fields where they do appear");
  assert.ok(walk(join(REPO, "packages")).length > 50, "walk must actually reach the source tree");
});

/**
 * THE GUARD'S OWN BLIND SPOT, closed 2026-08-20 — one level below where it was looking.
 *
 * The test above searches for the STORED sum fields. On 2026-08-20 a FOURTH un-collapsed consumer
 * was found in `feed-curator.ts`, and it was invisible here because it never named those fields: it
 * reduced `foundations[]` itself (`for (const f of foundations) totalAssets += Number(f.totalAssets)`).
 * That is the same defect with different syntax, and it was the consumer that reached the FRONT
 * DOOR — the served #1 card read "$152.5B in foundation assets" for Melinda French Gates where the
 * collapsed figure is $76.95B, in the chip AND in the GPT dek, because the chip is also Pass A context.
 *
 * So: summing `totalAssets` across a list is the operation `foundationTotals()` exists to own.
 * Reading ONE foundation's `totalAssets` stays legal — the profile lists each entity individually,
 * and that breakdown is the owner's explicit ruling (2026-08-12: keep the trust in the breakdown).
 *
 * KNOWN CEILING, stated rather than implied: this catches `+=` accumulation and `.reduce(...)`. A
 * third way of summing (a `sum()` util, a SQL aggregate) would slip it. It is a tripwire on the two
 * shapes that have actually appeared, not a proof of absence.
 */
const ARRAY_SUM_SHAPES = [
  /\+=\s*(Number\()?\s*\w+\.totalAssets/, // for (…) total += Number(f.totalAssets)
  /\.reduce\([^\n]*totalAssets/, // founds.reduce((a, f) => a + f.totalAssets, 0)
];

const SUM_ALLOWED = [
  // owns the operation
  join("packages", "shared", "src", "foundation-endowment.ts"),
  // this guard names the shapes to search for them
  join("packages", "shared", "src", "foundation-endowment-fork.test.ts"),
  // compares raw-vs-collapsed on purpose
  join("packages", "jobs", "src", "probe-b030-plausibility.ts"),
  // WRITES the raw sums. `foundationTotals()` reads them as its no-foundations[] fallback, so the
  // fetcher summing the array un-collapsed is not a fork — it is where the fallback value comes
  // from. Collapsing here would corrupt that fallback for older facts.
  join("packages", "jobs", "src", "fetchers", "propublica-990.ts"),
];

test("no consumer sums foundations[].totalAssets by hand (B-030 fork guard, array shape)", () => {
  const offenders: string[] = [];
  for (const file of walk(join(REPO, "packages"))) {
    const rel = relative(REPO, file);
    if (SUM_ALLOWED.some((a) => rel === a)) continue;
    const src = readFileSync(file, "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      if (isComment(line)) continue;
      if (ARRAY_SUM_SHAPES.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "These hand-sum foundation assets, which double-counts an endowment trust. Call " +
      "foundationTotals() or foundationAssetsChip() from @ba/shared:\n" + offenders.join("\n")
  );
});

test("the array-shape guard can actually fail — the shapes match real code", () => {
  // Positive control on the PATTERNS, not just the walk: the exact line that shipped the defect,
  // and the reduce form, must both be recognised. A regex that matches nothing passes silently.
  const shipped = "      for (const f of foundations) totalAssets += Number(f.totalAssets) || 0;";
  const reduceForm = "  const t = founds.reduce((a, f) => a + Number(f.totalAssets), 0);";
  assert.ok(ARRAY_SUM_SHAPES.some((re) => re.test(shipped)), "must catch the += accumulation that shipped");
  assert.ok(ARRAY_SUM_SHAPES.some((re) => re.test(reduceForm)), "must catch the reduce form");
  // And it must NOT fire on a single-entity read, which the profile breakdown does legitimately.
  const singleRead = "  <span>Assets: {formatCurrency(f.totalAssets)}</span>";
  assert.ok(!ARRAY_SUM_SHAPES.some((re) => re.test(singleRead)), "must not fire on a single-entity read");
});
