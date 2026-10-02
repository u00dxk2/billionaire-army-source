import { useReducer, useRef } from "react";
import { initialVoteSaveState, voteSaved, voteSaveDisclosure, voteSaveReducer } from "./vote-saved";

/**
 * B-050: the one place SwipeCards and DailySwipe track whether their fire-and-forget vote POSTs
 * saved. `run` and `seq` live in refs because a request settles in a closure that outlives the
 * render it started in — the reducer uses them to drop results from before Start Over and to let
 * only the newest vote on a person decide its status.
 */
export function useVoteSaves() {
  const [state, dispatch] = useReducer(voteSaveReducer, initialVoteSaveState);
  const run = useRef(0);
  const seq = useRef(0);

  function track(personId: string, name: string, request: () => Promise<Response>) {
    const r = run.current;
    const s = ++seq.current;
    dispatch({ type: "start", run: r, seq: s, personId });
    voteSaved(request).then((saved) => dispatch({ type: "settle", run: r, seq: s, personId, name, saved }));
  }

  /** A verdict that never left the browser (no session): definitely not counted, not merely unconfirmed. */
  function markUnsent(personId: string, name: string) {
    dispatch({ type: "unsent", run: run.current, seq: ++seq.current, personId, name });
  }

  function restart() {
    run.current += 1;
    dispatch({ type: "restart" });
  }

  return { disclosure: voteSaveDisclosure(state), track, markUnsent, restart };
}
