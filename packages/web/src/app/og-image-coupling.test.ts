import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * R-044's coupling invariant, enforced instead of commented.
 *
 * THE RULE (CLAUDE.md § OG share images): never serve `twitter:card: summary_large_image`
 * without an `og:image` — it reserves a slot the platform cannot fill and renders worse than
 * a plain tile.
 *
 * WHY A TEST AND NOT A THIRD COMMENT. The rule WAS commented, carefully, at both of the call
 * sites anyone had counted: the root layout and /feed/[id]. There were three. `/billionaires/[id]`
 * declared its own `openGraph` block with no `images`, and because a route's `openGraph` REPLACES
 * the parent's rather than deep-merging, that silently dropped the site-wide og:image — while
 * `twitter` (a separate metadata key) kept inheriting `summary_large_image` from the root.
 * Measured on live prod 2026-08-27: `og:image=NONE` with `twitter:card=summary_large_image` on
 * the profile route, i.e. ~1,092 of the site's most person-specific shareable pages, for as long
 * as the profile has had metadata. Typecheck, tests and build were all green throughout — nothing
 * in the type system objects to an openGraph block without images.
 *
 * This is this project's own standing lesson arriving on schedule: an invariant asserted in the
 * file everyone loads gets checked LESS, because it reads as settled. So the check is mechanical
 * and enumerates the routes itself rather than trusting a list someone maintains by hand — the
 * defect was precisely a call site missing from a hand-maintained mental list.
 */

const APP = dirname(fileURLToPath(import.meta.url));

/** Every page/layout module under app/, found by walking — never a hand-kept list. */
function routeModules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) routeModules(p, out);
    else if (/^(page|layout)\.tsx$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Does this module's OWN segment carry an opengraph-image file?
 *
 * SAME SEGMENT ONLY — deliberately, and the first draft of this helper got it wrong in a way
 * that matters. It walked up to app/, found the site-wide app/opengraph-image.tsx, and declared
 * every route covered — so the guard PASSED on the exact live defect it was written to catch.
 * Caught only because the sabotage run was actually performed (remove `images`, expect red, got
 * green). This project's own lesson: a positive control can survive its own sabotage wherever
 * the broken and correct paths agree on that input.
 *
 * The measured behaviour, read off live prod 2026-08-27 rather than off the Next docs:
 *   /            layout declares openGraph, no images, SAME-segment app/opengraph-image.tsx → image PRESENT
 *   /feed/[id]   declares openGraph, no images, SAME-segment opengraph-image.tsx          → image PRESENT
 *   /today       declares NO openGraph, ancestor file                                      → image PRESENT
 *   /compare     declares NO openGraph, ancestor file                                      → image PRESENT
 *   /billionaires/[id]  declares openGraph, no images, only an ANCESTOR file               → image NONE
 * So: declaring an openGraph block suppresses an ANCESTOR's file-convention image but not a
 * co-located one. An ancestor file is therefore NOT evidence of coverage here.
 */
function hasOwnSegmentImage(modulePath: string): boolean {
  return readdirSync(dirname(modulePath)).some((f) =>
    /^(opengraph|twitter)-image\.(tsx|ts|jsx|js|png|jpg|jpeg|gif)$/.test(f),
  );
}

test("every route declaring an openGraph block still supplies an og:image", () => {
  const modules = routeModules(APP);
  // Denominator assertion: if the walk finds nothing, the layout moved and this test is
  // asserting over an empty set — which would pass silently. That is the false-clean shape.
  assert.ok(modules.length >= 10, `expected to walk the app router, found only ${modules.length} module(s)`);

  const declaring = modules.filter((p) => /openGraph\s*:\s*\{/.test(readFileSync(p, "utf8")));
  assert.ok(declaring.length >= 3, `expected at least 3 routes to declare openGraph, found ${declaring.length}`);

  const offenders: string[] = [];
  for (const p of declaring) {
    const body = readFileSync(p, "utf8");
    const declaresImages = /openGraph\s*:\s*\{[\s\S]*?\bimages\s*:/.test(body);
    if (!declaresImages && !hasOwnSegmentImage(p)) offenders.push(p.slice(APP.length + 1));
  }

  assert.deepEqual(
    offenders,
    [],
    `these routes declare openGraph with no images and inherit none by file convention, so they serve ` +
      `summary_large_image over an empty image slot:\n  ${offenders.join("\n  ")}`,
  );
});

test("the walk can actually SEE a route that declares openGraph — the positive control", () => {
  // Without this, a regex that stopped matching would make the test above vacuously green:
  // 0 declaring routes, 0 offenders, PASS. The 2026-08-27 defect was a call site nobody
  // counted; a detector that counts zero call sites is the same failure one level up.
  const declaring = routeModules(APP).filter((p) => /openGraph\s*:\s*\{/.test(readFileSync(p, "utf8")));
  const names = declaring.map((p) => p.slice(APP.length + 1).replace(/\\/g, "/"));
  assert.ok(names.includes("layout.tsx"), `root layout should be among the openGraph declarers, got: ${names.join(", ")}`);
  assert.ok(
    names.some((n) => n.includes("billionaires/[id]")),
    `the profile route should be among the openGraph declarers, got: ${names.join(", ")}`,
  );
});
