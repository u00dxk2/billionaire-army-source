"use client";

import { useState } from "react";
import { READER_FACING_GRADE_NOUN, readerFacingScoreValue, pbsGrade } from "@ba/shared";
import { SITE_URL } from "@/lib/site";

/**
 * Share THIS profile.
 *
 * Flow 4 (Share the receipt), Cycle 15. The profile is the page where a person's
 * name, wealth and giving grade sit together — "look at what this guy actually
 * gives" is at least as natural a share as a feed card. It had no share
 * affordance at all: `navigator.share` appeared in exactly two files in the whole
 * web package, FeedCard and DailySwipe, and neither is this page. So the only way
 * to send someone a profile was to copy the address bar, which carries no receipt
 * and no framing.
 *
 * That gap mattered more the moment the per-person OG image shipped earlier the
 * same day: we had built the artifact that makes a shared profile land, on a page
 * with no button to send it from.
 *
 * Deliberately mirrors FeedCard.handleShare rather than inventing a second
 * grammar — same receipt order (who · net worth · giving grade), same two-path
 * native/clipboard split, same R-083 rule below. If you change one, change both.
 */
export default function ProfileShareButton({
  name,
  personId,
  netWorth,
  pbs,
}: {
  name: string;
  personId: string;
  netWorth: string | null;
  pbs: number | null;
}) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    const receiptBits: string[] = [name];
    if (netWorth) receiptBits.push(`net worth ${netWorth}`);
    // "giving score", never the bare acronym — a lone letter travels to a stranger
    // as an overall verdict on a named living person (R-041). The noun and the
    // rounding come from @ba/shared so this share, the badge on the page and the
    // OG image cannot drift into three names for one number.
    if (pbs !== null && Number.isFinite(pbs)) {
      const grade = pbsGrade(pbs);
      receiptBits.push(
        `${READER_FACING_GRADE_NOUN} ${grade.letter} (${readerFacingScoreValue(pbs)})`
      );
    }

    const receiptUrl = `${SITE_URL}/billionaires/${personId}`;
    const parts = [receiptBits.join(" · "), "Sourced giving record — every claim source-linked."];

    // R-083 — THE LINK GOES IN `url`, NOT ONLY IN THE TEXT. A share target only
    // unfurls a link handed to it in the `url` FIELD; a URL inside a text blob is
    // just characters, and the per-person OG image built for exactly this moment
    // never appears. The two paths carry different strings on purpose: native gets
    // text WITHOUT the trailing link plus `url` (or a target that appends url to
    // text shows it twice), and the clipboard fallback has no `url` field at all,
    // so its text MUST keep the link or the copied message loses the deep link.
    const nativeText = parts.join("\n\n");
    const clipboardText = [...parts, `See the record: ${receiptUrl}`].join("\n\n");

    if (navigator.share) {
      navigator.share({ text: nativeText, url: receiptUrl }).catch(() => {});
    } else {
      // Canon P0-2: a clipboard fallback needs visible feedback, same "Copied!"
      // pattern FeedCard and DailySwipe already ship.
      navigator.clipboard
        .writeText(clipboardText)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {});
    }
  }

  return (
    <button
      type="button"
      className="btn btn-secondary profile-share-btn"
      onClick={handleShare}
      aria-live="polite"
    >
      {copied ? "Copied!" : "Share this record"}
    </button>
  );
}
