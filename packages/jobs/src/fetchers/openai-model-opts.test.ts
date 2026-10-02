import { test } from "node:test";
import assert from "node:assert/strict";
import { temperatureOpt, estimateCostUsd, fmtCostUsd } from "./openai-model-opts";

test("gpt-5.6 models omit temperature entirely (any explicit value 400s)", () => {
  assert.deepEqual(temperatureOpt("gpt-5.6-terra", 0.3), {});
  assert.deepEqual(temperatureOpt("gpt-5.4-mini", 0.3), { temperature: 0.3 });
});

// Wave 0, 2026-09-26: gpt-6-* 400s on any temperature; an omitted effort = medium (empty output).
test("gpt-6 models never get a temperature and always carry effort low", () => {
  assert.deepEqual(temperatureOpt("gpt-6-luna", 0), { reasoning_effort: "low" });
  assert.deepEqual(temperatureOpt("gpt-6-sol", 0.7), { reasoning_effort: "low" });
});

test("PRICING carries the gpt-6 rows (wave 0, 2026-09-26)", () => {
  assert.equal(estimateCostUsd("gpt-6-luna", 1_000_000, 1_000_000), 0.6);
  assert.equal(estimateCostUsd("gpt-6-sol", 1_000_000, 1_000_000), 12);
});

// B-019: the table carried pre-2026-07-30 rates for three days and nothing said so.
// These pin the two that were wrong, so a future stale sync fails here instead of in
// a cost figure nobody re-derives.
test("PRICING carries the post-2026-07-30 repriced rates", () => {
  // terra $2/$12 per Mtok
  assert.equal(estimateCostUsd("gpt-5.6-terra", 1_000_000, 0), 2);
  assert.equal(estimateCostUsd("gpt-5.6-terra", 0, 1_000_000), 12);
  // luna $0.20/$1.20 per Mtok
  assert.equal(estimateCostUsd("gpt-5.6-luna", 1_000_000, 0), 0.2);
  assert.equal(estimateCostUsd("gpt-5.6-luna", 0, 1_000_000), 1.2);
});

// The KP-78 half: prove the instrument can FAIL, not just that it can compute.
test("an untabled model is 'unknown', never a confident $0", () => {
  assert.equal(estimateCostUsd("gpt-9.9-imaginary", 1_000_000, 1_000_000), null);
  assert.equal(fmtCostUsd(estimateCostUsd("gpt-9.9-imaginary", 1, 1)), "unknown");
});

test("a real zero is still a zero — 0 tokens costs $0.0000, not 'unknown'", () => {
  assert.equal(fmtCostUsd(estimateCostUsd("gpt-5.6-terra", 0, 0)), "$0.0000");
});

// One unpriced leg must poison the total, or the run line prints a partial sum as if
// it were the whole cost — the same defect one level up.
test("summing legs: any unknown leg makes the total unknown", () => {
  const legs = [estimateCostUsd("gpt-5.6-terra", 1000, 1000), estimateCostUsd("nope", 1000, 1000)];
  const total = legs.some((c) => c === null) ? null : legs.reduce((a, b) => a! + b!, 0);
  assert.equal(fmtCostUsd(total), "unknown");
});
