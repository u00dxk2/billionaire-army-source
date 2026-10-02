// `React` is imported explicitly because the test runner compiles this file's JSX with the classic
// runtime (React.createElement); Next's own build does not need it, and it is harmless there.
import React from "react";
import type { voteSaveDisclosure } from "../lib/vote-saved";

/**
 * The vote-save disclosure, in ONE place both swipe surfaces render (B-050).
 *
 * It is its own component so a test can RENDER it and assert what a person would see — the wire-up
 * tests beside it are source checks, and a source check cannot see whether a line reaches the page.
 */
export default function VoteSaveNotices({ disclosure }: { disclosure: ReturnType<typeof voteSaveDisclosure> }) {
  return (
    <>
      {disclosure.saving && (
        <p className="daily-guest-note" role="status">{disclosure.saving}</p>
      )}
      {disclosure.unconfirmed && (
        <p className="daily-guest-note" role="alert">{disclosure.unconfirmed}</p>
      )}
      {disclosure.unsent && (
        <p className="daily-guest-note" role="alert">
          {disclosure.unsent} <a href="/login">Sign in</a> so your votes count on the scoreboard.
        </p>
      )}
    </>
  );
}
