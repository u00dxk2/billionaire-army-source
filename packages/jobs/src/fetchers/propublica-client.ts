/**
 * B-021 grant prerequisite 2 (2026-10-01): the ProPublica Nonprofit Explorer client, kept side-effect
 * free so the fetch:990 failure path can be tested (propublica-990.ts opens a DB pool on import).
 *
 * A FAILED search is a STOP, never a delete. The old `if (!res.ok) return []` made a 429/5xx look
 * like "this person matches no foundation", and fetch:990's B-020 self-heal then DELETED their row.
 * Here a failure throws ProPublicaFetchError; the fetcher's per-person catch logs it and moves on,
 * leaving the stored fact untouched.
 *
 * A SUCCESSFUL search that matches nothing still self-heals (B-020). Measured 2026-10-01: a no-match
 * search answers HTTP **404** with a well-formed body (`total_results: 0, organizations: []`), so the
 * status alone cannot separate the two. The body decides: a parsed object with a numeric
 * `total_results` and an `organizations` array is an answer; anything else is a failure. A 404 is an
 * answer only when it says zero results.
 *
 * Filings follow the same rule: a failed org fetch used to return [] and the fetcher then wrote the
 * foundation with grantsPaid 0 — overwriting a good row with zeros. A failure now throws instead.
 */

export interface NonprofitResult {
  ein: number;
  name: string;
  city: string;
  state: string;
  ntee_code: string;
  total_revenue: number;
  total_assets: number;
}

export interface Filing990 {
  tax_prd_yr: number;
  totrevenue: number;
  totfuncexpns: number; // total functional expenses (incl. admin)
  totassetsend: number; // total assets, end of year
  totexpnsexempt: number; // expenses for charitable/exempt purposes = giving OUT (990-PF)
  grscontrgifts: number; // gross contributions/gifts RECEIVED (into the foundation)
}

export class ProPublicaFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProPublicaFetchError";
  }
}

export const PROPUBLICA_API = "https://projects.propublica.org/nonprofits/api/v2";

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}>;

/**
 * Pure: what a search response means. Never returns [] for a response that is not an answer.
 *
 * THE RULE (Codex r2, 2026-10-01 — stated, not a growing case list): an EMPTY result is authoritative
 * only when the body itself says `total_results === 0`. A body with an `error` field, a count that
 * disagrees with an empty list, or any non-200/404 status is a failure, and a failure is a STOP.
 */
export function classifySearchResponse(status: number, body: unknown): { kind: "answer"; orgs: NonprofitResult[] } | { kind: "failed"; reason: string } {
  const b = body as { total_results?: unknown; organizations?: unknown; error?: unknown } | null;
  const shaped = !!b && typeof b === "object" && !("error" in b) && Number.isInteger(b.total_results) && Array.isArray(b.organizations);
  if (!shaped || (status !== 200 && status !== 404)) {
    return { kind: "failed", reason: `HTTP ${status}${shaped ? "" : ", body not a search answer"}` };
  }
  const orgs = b!.organizations as NonprofitResult[];
  const total = b!.total_results as number;
  if (orgs.length === 0) {
    return total === 0 ? { kind: "answer", orgs: [] } : { kind: "failed", reason: `HTTP ${status}, total_results ${total} but no organizations` };
  }
  if (status !== 200) return { kind: "failed", reason: `HTTP ${status} carrying organizations` };
  return { kind: "answer", orgs };
}

/**
 * Pure: what an organization response means. A missing filings array is a failure, not "no filings";
 * so is an `error` field, or a filing without a numeric tax year (an entry the fetcher would turn into
 * $0 grants through its fallbacks).
 */
export function classifyFilingsResponse(status: number, body: unknown): { kind: "answer"; filings: Filing990[] } | { kind: "failed"; reason: string } {
  const b = body as { filings_with_data?: unknown; error?: unknown } | null;
  if (status !== 200 || !b || typeof b !== "object" || "error" in b || !Array.isArray(b.filings_with_data)) {
    return { kind: "failed", reason: `HTTP ${status}` };
  }
  const filings = b.filings_with_data as Filing990[];
  if (filings.some((f) => !f || typeof f !== "object" || !Number.isInteger((f as { tax_prd_yr?: unknown }).tax_prd_yr))) {
    return { kind: "failed", reason: `HTTP ${status}, a filing carries no tax year` };
  }
  return { kind: "answer", filings };
}

async function readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function searchNonprofits(query: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<NonprofitResult[]> {
  let res;
  try {
    res = await fetchImpl(`${PROPUBLICA_API}/search.json?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "BillionaireArmy/0.1" },
    });
  } catch {
    throw new ProPublicaFetchError(`search "${query}" failed: network error`);
  }
  const verdict = classifySearchResponse(res.status, await readJson(res));
  if (verdict.kind === "failed") throw new ProPublicaFetchError(`search "${query}" failed: ${verdict.reason}`);
  return verdict.orgs;
}

export async function getFilings(ein: number, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<Filing990[]> {
  let res;
  try {
    res = await fetchImpl(`${PROPUBLICA_API}/organizations/${ein}.json`, {
      headers: { "User-Agent": "BillionaireArmy/0.1" },
    });
  } catch {
    throw new ProPublicaFetchError(`filings for EIN ${ein} failed: network error`);
  }
  const verdict = classifyFilingsResponse(res.status, await readJson(res));
  if (verdict.kind === "failed") throw new ProPublicaFetchError(`filings for EIN ${ein} failed: ${verdict.reason}`);
  return verdict.filings;
}
