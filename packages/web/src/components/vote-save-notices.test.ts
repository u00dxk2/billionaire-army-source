import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import VoteSaveNotices from "./VoteSaveNotices";
import { initialVoteSaveState, voteSaveDisclosure, voteSaveReducer, type VoteSaveAction } from "../lib/vote-saved";

/**
 * B-050's RENDER leg (orchestrator ruling 2026-09-17): the wire-up tests beside this one are source
 * checks, and a source check cannot see whether a line reaches the page — a disclosure computed and
 * then hidden behind a dead condition passes every one of them. This renders the component and
 * asserts what a person would SEE.
 *
 * Deliberately minimal, per the ruling: react-dom/server's static renderer, already a dependency of
 * this package, over ONE presentational component. No new dependency, no jsdom, no snapshots, and
 * nothing else in the repo changes.
 *
 * Sabotage that must turn this red: wrap any notice in `false &&` inside VoteSaveNotices.tsx.
 *
 * THE CEILING OF A RENDER READ (orchestrator, 2026-09-17): this proves the component EMITS the
 * sentence, names the person and carries the alert role. It cannot see a notice that renders and is
 * then hidden by CSS, covered by another element, or scrolled out of reach. So a claim that we
 * RENDER the disclosure is supported here; a claim that a person SEES it owes a browser frame read.
 * Write the claim you can support.
 */

const render = (...actions: VoteSaveAction[]) =>
  renderToStaticMarkup(createElement(VoteSaveNotices, {
    disclosure: voteSaveDisclosure(actions.reduce(voteSaveReducer, initialVoteSaveState)),
  }));

test("a save that succeeded renders NOTHING — no notice, no empty shell", () => {
  const html = render(
    { type: "start", run: 0, seq: 1, personId: "a" },
    { type: "settle", run: 0, seq: 1, personId: "a", name: "Jeff Bezos", saved: true },
  );
  assert.equal(html, "", `a clean run must render no notices, got: ${html.slice(0, 200)}`);
});

test("a save we could not confirm is VISIBLE, names the person, and is announced", () => {
  const html = render(
    { type: "start", run: 0, seq: 1, personId: "a" },
    { type: "settle", run: 0, seq: 1, personId: "a", name: "Jeff Bezos", saved: false },
  );
  assert.ok(html.includes("We couldn&#x27;t confirm this vote saved"), `the unconfirmed notice must render, got: ${html.slice(0, 200)}`);
  assert.ok(html.includes("Jeff Bezos"), "the unconfirmed notice must name the person");
  assert.ok(html.includes('role="alert"'), "the unconfirmed notice must be announced to a screen reader");
});

test("a verdict that was never sent renders its own line with the sign-in route", () => {
  const html = render({ type: "unsent", run: 0, seq: 1, personId: "a", name: "Elon Musk" });
  assert.ok(html.includes("wasn&#x27;t recorded"), `the never-sent notice must render, got: ${html.slice(0, 200)}`);
  assert.ok(html.includes('href="/login"'), "the never-sent notice must offer the sign-in route");
  assert.ok(!html.includes("couldn&#x27;t confirm"), "a never-sent verdict must not borrow the unconfirmed wording");
});

test("a save still in flight renders the saving line, and no failure notice", () => {
  const html = render({ type: "start", run: 0, seq: 1, personId: "a" });
  assert.ok(html.includes("Saving 1 vote"), `the saving notice must render, got: ${html.slice(0, 200)}`);
  assert.ok(!html.includes('role="alert"'), "an in-flight save must not render a failure notice");
});
