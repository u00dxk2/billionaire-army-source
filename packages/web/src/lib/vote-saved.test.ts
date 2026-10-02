import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initialVoteSaveState,
  voteSaved,
  voteSaveDisclosure,
  voteSaveReducer,
  type VoteSaveAction,
  type VoteSaveState,
} from "./vote-saved";

/**
 * B-050 — a vote is shown as counted only when the API said it saved.
 *
 * The BEHAVIOUR (what the results screen may say, through in-flight saves, late failures, re-votes
 * and Start Over) is tested on the pure reducer and disclosure below. Whether those lines actually
 * REACH the page is tested by rendering them — components/vote-save-notices.test.ts, added on the
 * orchestrator's 2026-09-17 ruling, which closes the hole this header used to admit (a disclosure
 * computed and then hidden behind `false &&` passed every source check).
 * What remains a source check: that each results screen renders VoteSaveNotices at all.
 *
 * Sabotage that must turn this red: drop the `.ok` check in voteSaved, drop the run check or the
 * newest-vote check in the reducer, or put SwipeCards' original `.catch(() => {})` back.
 */

function play(...actions: VoteSaveAction[]): VoteSaveState {
  return actions.reduce(voteSaveReducer, initialVoteSaveState);
}
const start = (seq: number, personId: string, run = 0): VoteSaveAction => ({ type: "start", run, seq, personId });
const settle = (seq: number, personId: string, saved: boolean, run = 0): VoteSaveAction =>
  ({ type: "settle", run, seq, personId, name: `Name ${personId}`, saved });

test("voteSaved: a 2xx response is a saved vote", async () => {
  assert.equal(await voteSaved(async () => new Response(null, { status: 201 })), true);
});

test("voteSaved: a 500 is NOT a saved vote — fetch resolves on it, which is the whole bug", async () => {
  assert.equal(await voteSaved(async () => new Response(null, { status: 500 })), false);
});

test("voteSaved: a rejected request and a synchronous throw are NOT saved votes", async () => {
  assert.equal(await voteSaved(() => Promise.reject(new Error("offline"))), false);
  assert.equal(await voteSaved(() => { throw new TypeError("bad url"); }), false);
});

const CLEAR = { saving: null, unconfirmed: null, unsent: null };

test("an in-flight save is shown as SAVING, never as counted or failed", () => {
  const d = voteSaveDisclosure(play(start(1, "a")));
  assert.equal(d.saving, "Saving 1 vote…");
  assert.equal(d.unconfirmed, null);
  assert.equal(d.unsent, null);
});

test("a failure that lands after the results screen renders is disclosed, by name", () => {
  const d = voteSaveDisclosure(play(start(1, "a"), start(2, "b"), settle(1, "a", true), settle(2, "b", false)));
  assert.equal(d.saving, null);
  assert.equal(d.unconfirmed, "We couldn't confirm this vote saved, so it may not count on the scoreboard: Name b.");
  const two = voteSaveDisclosure(play(start(1, "a"), start(2, "b"), settle(1, "a", false), settle(2, "b", false)));
  assert.equal(two.unconfirmed, "We couldn't confirm these 2 votes saved, so they may not count on the scoreboard: Name a, Name b.");
});

test("a verdict that never left the browser is its OWN claim, not an unconfirmed save", () => {
  const one = voteSaveDisclosure(play({ type: "unsent", run: 0, seq: 1, personId: "a", name: "Name a" }));
  assert.equal(one.unsent, "This verdict wasn't recorded: Name a.");
  assert.equal(one.unconfirmed, null, "an unsent verdict must never be reported as merely unconfirmed");
  assert.equal(one.saving, null, "an unsent verdict has no request to wait for");
  const mixed = voteSaveDisclosure(play(
    { type: "unsent", run: 0, seq: 1, personId: "a", name: "Name a" },
    { type: "unsent", run: 0, seq: 2, personId: "b", name: "Name b" },
    start(3, "c"), settle(3, "c", false),
  ));
  assert.equal(mixed.unsent, "These 2 verdicts weren't recorded: Name a, Name b.");
  assert.equal(mixed.unconfirmed, "We couldn't confirm this vote saved, so it may not count on the scoreboard: Name c.");
});

test("signing in and re-voting clears the unsent claim for that person", () => {
  const d = voteSaveDisclosure(play(
    { type: "unsent", run: 0, seq: 1, personId: "a", name: "Name a" },
    start(2, "a"), settle(2, "a", true),
  ));
  assert.deepEqual(d, CLEAR);
});

test("a request from before Start Over changes nothing in the new run", () => {
  const d = voteSaveDisclosure(play(start(1, "a"), { type: "restart" }, start(2, "a", 1), settle(2, "a", true, 1), settle(1, "a", false)));
  assert.deepEqual(d, CLEAR);
  // The newest-vote check alone hides a stale STATUS; only the run check stops a stale request
  // from clearing the new run's "Saving…" while its own vote is still in flight.
  const inFlight = voteSaveDisclosure(play(start(1, "a"), { type: "restart" }, start(2, "b", 1), settle(1, "a", false)));
  assert.equal(inFlight.saving, "Saving 1 vote…");
});

test("only the NEWEST vote on a person decides its status, whichever settles last", () => {
  const slowFailure = play(start(1, "a"), start(2, "a"), settle(2, "a", true), settle(1, "a", false));
  assert.deepEqual(voteSaveDisclosure(slowFailure), CLEAR);
  const retried = play(start(1, "a"), settle(1, "a", false), start(2, "a"), settle(2, "a", true));
  assert.deepEqual(voteSaveDisclosure(retried), CLEAR);
});

const here = dirname(fileURLToPath(import.meta.url));

/** Strip comments so prose describing the wire-up cannot satisfy it. */
function code(file: string): string {
  return readFileSync(join(here, "..", "components", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

for (const file of ["SwipeCards.tsx", "DailySwipe.tsx"]) {
  test(`${file} tracks every vote POST and renders both disclosure lines`, () => {
    const body = code(file);
    // assert.ok, not assert.match: a failing match prints the whole component source.
    assert.ok(/saves\.track\([^)]*\(\)\s*=>\s*fetch\(`\$\{API_URL\}\/api\/votes`/.test(body), `${file} must track its vote POST`);
    // The notices themselves are RENDERED and asserted in components/vote-save-notices.test.ts;
    // this half only pins that the results screen hands them this component's state.
    assert.ok(/<VoteSaveNotices disclosure=\{saves\.disclosure\} \/>/.test(body), `${file} must render VoteSaveNotices with its own save state`);
    assert.ok(!/\/api\/votes`[\s\S]{0,300}\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(body), `${file} must not swallow a vote failure`);
    // Review round 2: clearing the guest flag when a later vote is sent hid the "weren't recorded"
    // note for verdicts rated BEFORE signing in mid-run. Over-disclosure beats hiding them.
    assert.ok(!/setIsGuest\(\s*false\s*\)/.test(body), `${file} must not clear the guest note mid-run`);
    // Review round 3: signed in at mount, signed out before voting — the verdict is never sent.
    // Round 4: `!== true` — `=== false` missed the click that lands before the mount read resolves.
    assert.ok(/else if \(isGuest !== true\)\s*\{\s*saves\.markUnsent\(/.test(body), `${file} must disclose a verdict that was never sent, unless the visitor is a KNOWN guest`);
    // B-051: the stamp the API orders two overlapping votes by. Taken when the verdict is CHOSEN —
    // inside the thunk it would be the send time, which is the very ordering that cannot be trusted.
    assert.ok(/const castAt = Date\.now\(\);[\s\S]{0,400}body: JSON\.stringify\(\{ personId: current\.id, direction, castAt \}\)/.test(body), `${file} must stamp the verdict at choice time and send it`);
  });
}

test("SwipeCards' Start Over also restarts save tracking", () => {
  assert.ok(/setCurrentIndex\(0\);\s*setResults\(\{\}\);\s*saves\.restart\(\)/.test(code("SwipeCards.tsx")), "Start Over must call saves.restart()");
});
