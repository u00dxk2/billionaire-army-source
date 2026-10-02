/**
 * Model-seat resolver — the whole of it. The registry is an inventory of which
 * model each seat uses, edited by hand.
 *
 * WHAT THIS IS AND IS NOT. It is a file (`model-seats.json` at the repo root)
 * and a function. It is NOT a router, a gateway, an adapter or a client: every
 * call site keeps the exact `openai.chat.completions.create(...)` it already
 * had, with the same `response_format`, `max_completion_tokens` and
 * `temperatureOpt()` it already passed. The only thing that moved is where the
 * model STRING comes from. A shared runtime layer is a single
 * point of failure that strips provider features, which is why this file is
 * self-contained and imports nothing from outside this repository.
 *
 * PRECEDENCE: `SEAT_<NAME>_MODEL` → the seat's `legacyEnv` (the variable the
 * code read BEFORE this landed — `CURATOR_MODEL` and friends, which the
 * `curate-feed` workflow still sets) → the checked-in `model`. Adoption
 * therefore cannot change what the daily run calls: every existing env var
 * still wins.
 *
 * FAIL-CLOSED on the two things a wrong answer bills for:
 *   · an unknown seat THROWS rather than defaulting — a typo'd seat name that
 *     silently resolved to something would be a model swap nobody logged;
 *   · an override set to "" or whitespace is UNSET, never a model named ""
 *     (Doppler and GitHub Actions both store empty strings happily).
 *
 * The registry is read ONCE, at module load. A per-call read would put the
 * filesystem in the hot path of a batch job for no benefit.
 */

import { readFileSync } from "node:fs";

/** Where a resolved model came from. Logged beside the seat so a live override is a visible event. */
export type SeatSource = "env" | "legacyEnv" | "file";

export type SeatResolution = { model: string; source: SeatSource };

type SeatEntry = {
  seat: string;
  model: string;
  envOverride?: string;
  legacyEnv?: string | null;
};

type Registry = { schemaVersion: number; lane: string; seats: SeatEntry[] };

/**
 * `../../../model-seats.json` — this file is `packages/jobs/src/model-seats.ts`,
 * so three levels up is the repo root, which is where the standard pins the file
 * (one per repo, so the fleet gate and skylark-site's `/api/cc/model-seats` panel
 * both know where to look).
 */
const REGISTRY: Registry = JSON.parse(
  readFileSync(new URL("../../../model-seats.json", import.meta.url), "utf8")
) as Registry;

/**
 * `SEAT_` + the seat name uppercased with every run of non-alphanumeric
 * characters collapsed to one `_` + `_MODEL`. DERIVE it, never hand-type it: a
 * hand-typed name is a seat nobody can re-point, because the variable set in
 * Doppler and the variable the resolver reads stop being the same string.
 */
export function deriveEnvName(seat: string): string {
  const core = String(seat ?? "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `SEAT_${core}_MODEL`;
}

/** Every seat declared in the registry, in file order. Diagnostics only. */
export function seatNames(): string[] {
  return REGISTRY.seats.map((s) => s.seat);
}

/**
 * Resolve one seat to the model its call site should hand to the OpenAI SDK.
 *
 * @throws when `name` is not a declared seat — never a silent default.
 */
export function resolveSeat(
  name: string,
  env: Record<string, string | undefined> = process.env
): SeatResolution {
  const entry = REGISTRY.seats.find((s) => s.seat === name);
  if (!entry) {
    throw new Error(
      `model-seats: unknown seat "${name}" — the registry declares ${REGISTRY.seats.length} seat(s): ` +
        `${seatNames().join(", ")}. A seat name is the string the call log is tagged with; add the seat, do not guess a default.`
    );
  }
  const read = (key: string | null | undefined): string => {
    if (!key) return "";
    const v = env[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : "";
  };
  const fromEnv = read(entry.envOverride || deriveEnvName(name));
  if (fromEnv) return { model: fromEnv, source: "env" };
  const fromLegacy = read(entry.legacyEnv);
  if (fromLegacy) return { model: fromLegacy, source: "legacyEnv" };
  return { model: entry.model, source: "file" };
}
