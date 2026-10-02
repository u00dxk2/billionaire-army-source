import { netWorthAgeNote } from "@ba/shared";
import type { FeedItem } from "./feed-types";

/**
 * B-065 — the ONE net-worth age sentence for a served feed card, from the fields the API serves.
 * Rendered in three places that must never drift: the card body (FeedCard), the share text
 * (FeedCard.handleShare) and the shared link's description (/feed/[id] metadata) — the last two are
 * where a card travels without its body (Codex r3-4 #1, #2).
 *
 * The grade clause needs a grade on the card, which renders only when the served score is numeric.
 */
export function feedCardNetWorthNote(item: Pick<FeedItem, "contextData" | "netWorthAsOf" | "gradeUsesStaleNetWorth" | "netWorthTextFigure">): string | null {
  const ctx = item.contextData || {};
  const pbs = ctx.pbs;
  const gradeShown = pbs != null && Number.isFinite(Number(pbs));
  return netWorthAgeNote(
    item.netWorthAsOf ?? null,
    Boolean(item.gradeUsesStaleNetWorth && gradeShown),
    item.netWorthTextFigure ?? null,
    ctx.netWorth ? String(ctx.netWorth) : null,
  );
}
