/**
 * How a scheduled refresh run ENDS (SEC / FEC on GitHub Actions, 2026-10-02 round 4).
 *
 * By hand, an operator read the closing line ("… 37 errored") and knew the run was partial. On a
 * schedule nobody reads the log of a green run, and every fetcher exited 0 whatever happened — a
 * rate-limited tail, or a run that reached nobody at all, concluded "success". So the exit code
 * now carries what the closing line said:
 *   - any errored person → exit 1 (the run is PARTIAL; the persons that errored kept old facts);
 *   - zero persons attempted → exit 1 (a run over an empty set is UNREADABLE, never a clean zero).
 * Side-effect-free on purpose, so it can be tested without a database.
 */
export interface RunCounts {
  /** Persons the loop started work on (enriched + skipped + errored). */
  attempted: number;
  errors: number;
}

export function refreshRunExitCode({ attempted, errors }: RunCounts): 0 | 1 {
  if (attempted === 0) return 1;
  return errors > 0 ? 1 : 0;
}

/**
 * A refused or failed HTTP read is an ERROR, never an empty result. SEC's search used to return
 * `{ totalHits: 0 }` on any non-2xx, so a 403 or 429 printed "No EDGAR mentions" and counted as a
 * clean skip — an absent read reported as a zero.
 */
export function assertHttpOk(res: { ok: boolean; status: number }, label: string): void {
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
}

/**
 * A 200 whose body lacks the container the caller reads is an ERROR, never an empty list. Without
 * this, `data.results || []` turned `{"error":"unavailable"}` into "no contributions found", and an
 * EFTS body missing `hits.hits` reached the no-usable-CIK branch and self-heal-DELETED a real fact
 * (Codex review of 11f8a0c, finding 2). One rule for every boundary, not a patch per case.
 */
export function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: unexpected response shape`);
  return value;
}
