/**
 * Did a vote POST actually save? (B-050)
 *
 * `fetch` RESOLVES on a 500, so a `.catch` alone reports a failed save as cast — SwipeCards did
 * exactly that and its results screen told the voter every vote counted. A non-2xx response, a
 * rejected request and a synchronous throw all mean NOT CONFIRMED. SwipeCards and DailySwipe both
 * read this, so an unconfirmed vote reads the same on both results screens.
 */
export async function voteSaved(request: () => Promise<Response>): Promise<boolean> {
  try {
    return (await request()).ok;
  } catch {
    return false;
  }
}

/**
 * What the results screen may say about saves. The POST is fire-and-forget so the card advance is
 * not delayed, which means the results screen can render while saves are still in flight, and a
 * request can settle after the voter has started over or re-voted the same person. Three rules:
 *   - an in-flight save is shown as SAVING, never as counted;
 *   - only the NEWEST vote on a person decides whether that person is listed as failed;
 *   - a request from a previous run (before Start Over) changes nothing.
 */
export interface VoteSaveState {
  run: number;
  pending: number;
  latest: Record<string, number>;
  unconfirmed: Record<string, string>;
  unsent: Record<string, string>;
}

export type VoteSaveAction =
  | { type: "start"; run: number; seq: number; personId: string }
  | { type: "settle"; run: number; seq: number; personId: string; name: string; saved: boolean }
  | { type: "unsent"; run: number; seq: number; personId: string; name: string }
  | { type: "restart" };

export const initialVoteSaveState: VoteSaveState = { run: 0, pending: 0, latest: {}, unconfirmed: {}, unsent: {} };

export function voteSaveReducer(state: VoteSaveState, action: VoteSaveAction): VoteSaveState {
  if (action.type === "restart") return { ...initialVoteSaveState, run: state.run + 1 };
  if (action.run !== state.run) return state;

  if (action.type === "start" || action.type === "unsent") {
    const unconfirmed = { ...state.unconfirmed };
    const unsent = { ...state.unsent };
    delete unconfirmed[action.personId];
    delete unsent[action.personId];
    if (action.type === "unsent") unsent[action.personId] = action.name;
    return {
      ...state,
      // A verdict that was never sent has no request to wait for.
      pending: action.type === "start" ? state.pending + 1 : state.pending,
      latest: { ...state.latest, [action.personId]: action.seq },
      unconfirmed,
      unsent,
    };
  }

  const pending = Math.max(0, state.pending - 1);
  // ponytail: client send order stands in for commit order. The API upserts direction with no
  // version, so an OLDER overlapping re-vote (DailySwipe Back, then the opposite verdict while the
  // first POST is in flight) that commits last AND loses its response can leave the scoreboard on
  // the older verdict with no warning. Closing that needs server-side vote ordering, not this file.
  if (state.latest[action.personId] !== action.seq) return { ...state, pending };
  const unconfirmed = { ...state.unconfirmed };
  if (action.saved) delete unconfirmed[action.personId];
  else unconfirmed[action.personId] = action.name;
  return { ...state, pending, unconfirmed };
}

/**
 * The three lines the results screen renders; `null` means render nothing for that line.
 *
 * The two failure buckets are NOT the same claim, and collapsing them under-claims in the
 * reassuring direction — the same direction a swallowed error fails in:
 *   - UNCONFIRMED: the request went out and we never learned the answer. The API commits the vote
 *     BEFORE it sends the 201, so a connection that drops after the commit leaves a vote that
 *     counts. "Couldn't confirm" is the most the client can honestly say.
 *   - UNSENT: the request never left the browser (no session), so it definitely did not count.
 *     That is the guest note's claim, and it borrows the guest note's words.
 */
export function voteSaveDisclosure(state: VoteSaveState): {
  saving: string | null;
  unconfirmed: string | null;
  unsent: string | null;
} {
  const unconfirmed = Object.values(state.unconfirmed);
  const unsent = Object.values(state.unsent);
  return {
    saving: state.pending > 0 ? `Saving ${state.pending} vote${state.pending === 1 ? "" : "s"}…` : null,
    unconfirmed: unconfirmed.length > 0
      ? `We couldn't confirm ${unconfirmed.length === 1 ? "this vote" : `these ${unconfirmed.length} votes`} saved, so ${unconfirmed.length === 1 ? "it" : "they"} may not count on the scoreboard: ${unconfirmed.join(", ")}.`
      : null,
    unsent: unsent.length > 0
      ? `${unsent.length === 1 ? "This verdict wasn't" : `These ${unsent.length} verdicts weren't`} recorded: ${unsent.join(", ")}.`
      : null,
  };
}
