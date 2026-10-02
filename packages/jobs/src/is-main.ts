import { pathToFileURL } from "node:url";

/**
 * True when this module is the process entrypoint (`tsx foo.ts`), false when it
 * was imported by something else.
 *
 * Why this exists: every script in this package ended its file with a bare
 * `main()` call, so IMPORTING one RAN it. That is a live footgun on a repo whose
 * scripts mutate prod — `cleanup.ts` deletes persons and facts on line one of
 * its run, `dedupe-*.ts` merges rows, `feed-curator.ts` writes feed cards. A
 * stray import (an editor auto-import, a test that wants one helper, an agent
 * reaching for a pure function) was a production write. Found 2026-07-25 during
 * the gate-execution sweep, while trying to call the curator's faithfulness
 * verifier in isolation — which could not be done for exactly this reason.
 *
 * `entry` is injectable so this is testable without spawning a process.
 */
export function isMain(moduleUrl: string, entry: string | undefined = process.argv[1]): boolean {
  if (!moduleUrl || !entry) return false;
  const entryUrl = pathToFileURL(entry).href;
  if (moduleUrl === entryUrl) return true;
  // tsx and ts-node resolve an extensionless or .js-suffixed entry to the .ts
  // source, so the two hrefs can differ only by extension. Compare stripped.
  const strip = (u: string) => u.replace(/\.[cm]?[jt]s$/, "");
  return strip(moduleUrl) === strip(entryUrl);
}
