"use client";

import { useState } from "react";
import {
  pbsGrade,
  formatGivingPercent,
  formatUsdCompact,
  sourceLabel,
  isReportedClaim,
  READER_FACING_GRADE_NOUN,
  READER_FACING_SCORE_BADGE_LABEL,
  readerFacingScoreValue,
} from "@ba/shared";
import { feedCardNetWorthNote } from "@/lib/feed-net-worth-note";
import { SITE_URL } from "@/lib/site";
import type { FeedItem } from "@/lib/feed-types";
import { createClient } from "@/lib/supabase-browser";
import FeedComments from "./FeedComments";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Badge backgrounds carry white 10-11px text, so every color here must clear
// 4.5:1 against white (2026-08-05 sweep: business #b8860b was 3.3:1,
// philanthropy #2d8f4e was 4.1:1). Green/gold track the darkened brand tokens
// in globals.css (--color-accent-green / --color-amber).
const CATEGORY_COLORS: Record<string, string> = {
  politics: "#2d5a8e",
  philanthropy: "#1f7a3f",
  business: "#8a6100",
  sec_filing: "#7b4ea3",
  controversy: "#c0392b",
};

const CATEGORY_LABELS: Record<string, string> = {
  politics: "Politics",
  philanthropy: "Philanthropy",
  business: "Business",
  sec_filing: "SEC Filing",
  controversy: "Controversy",
};

// B-010: this runs during SSR (FeedCard is a client component, so Next renders
// it on the server for the initial HTML) AND again at hydration. Two values
// diverge server↔client: Date.now() (the "Xh/Xd ago" branches) and the
// timezone of an un-pinned toLocaleDateString (server is UTC, client is the
// viewer's TZ) — which mismatches the absolute-date branch every load for an
// older card. The absolute branch is pinned to UTC here so it's deterministic;
// the relative branches are covered by suppressHydrationWarning at the render
// site (React's sanctioned tool for legitimately time-dependent text).
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function FeedCard({
  item,
  onUpdate,
}: {
  item: FeedItem;
  onUpdate: (id: string, updates: Partial<FeedItem>) => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [voting, setVoting] = useState(false);
  const [voteNotice, setVoteNotice] = useState(false);
  const [voteError, setVoteError] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const supabase = createClient();

  const raw = item.contextData || {};
  const ctx = {
    netWorth: raw.netWorth ? String(raw.netWorth) : null,
    pbs: raw.pbs ? String(raw.pbs) : null,
    political: raw.political ? String(raw.political) : null,
    philanthropy: raw.philanthropy ? String(raw.philanthropy) : null,
  };
  const pbsNum = ctx.pbs !== null && Number.isFinite(Number(ctx.pbs)) ? Number(ctx.pbs) : null;
  const grade = pbsNum !== null ? pbsGrade(pbsNum) : null;
  const netWorthNote = feedCardNetWorthNote(item);

  async function handleVote(direction: "up" | "down") {
    if (voting) return;
    setVoting(true);
    setVoteError(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Canon P0-1: a logged-out vote must never be a silent no-op — say why
        // nothing happened, near the control (design-canon review 2026-07-18).
        setVoteNotice(true);
        return;
      }

      const res = await fetch(`${API_URL}/api/feed/${item.id}/vote`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ direction }),
      });

      if (res.ok) {
        const { upvotes, downvotes } = await res.json();
        onUpdate(item.id, { upvotes, downvotes });
      } else {
        setVoteError(true);
      }
    } catch {
      // Canon Wave 2 S4: a failed vote must not fail silently.
      setVoteError(true);
    } finally {
      setVoting(false);
    }
  }

  async function handleShare() {
    // The share IS the word-of-mouth channel — carry the receipt, not just the headline.
    // Lead with who + the net-worth↔grade contrast, then the fact, then the verifiable source.
    const person = item.persons?.[0];
    const receiptBits: string[] = [];
    if (person) receiptBits.push(person.name);
    // B-065: the share travels furthest, so an undated or old figure carries its label here too.
    if (ctx.netWorth) receiptBits.push(`net worth ${ctx.netWorth}${item.netWorthAsOf ? ` (${item.netWorthAsOf})` : ""}`);
    // "giving grade", not "PBS" — the bare acronym travels to a stranger as an
    // overall verdict on the person (R-041). Naming the axis keeps a green A on a
    // political card from reading as absolution. The words and the rounding come
    // from `@ba/shared/score-vocabulary` so the share, the badge below and the
    // card's own prose cannot drift into three names for one number (R-081).
    if (grade && pbsNum !== null) {
      receiptBits.push(`${READER_FACING_GRADE_NOUN} ${grade.letter} (${readerFacingScoreValue(pbsNum)})`);
    }

    const parts: string[] = [];
    if (receiptBits.length) parts.push(receiptBits.join(" · "));
    parts.push(item.headline);
    // B-065: the share travels without the card body, so the age sentence rides with it (Codex r3-4 #2).
    if (netWorthNote) parts.push(netWorthNote);
    if (item.sourceUrl) parts.push(`Source —${sourceLabel(item.sourceName, item.sourceUrl)}: ${item.sourceUrl}`);

    // Deep-link to THIS card so the recipient lands on the receipt that earned
    // the share, not the feed root — a cold/unauth visitor sees the card via the
    // SSR /feed/[id] route. Base URL is the single SITE_URL config constant.
    const receiptUrl = `${SITE_URL}/feed/${item.id}`;

    // R-083 — THE LINK GOES IN `url`, NOT ONLY IN THE TEXT, AND THAT IS THE WHOLE FIX.
    // R-044 renders a per-card Open Graph image of this receipt, with a legibility gate
    // pinning its type scale for a ~250px unfurl. Verified live on prod: /feed/<id> serves
    // og:image + twitter:card=summary_large_image at 1200x630. But a share target only
    // unfurls a link it is handed in the `url` FIELD — a URL buried in a text blob is just
    // characters. So the image built for exactly this moment never appeared, and the friend
    // on the other end got a wall of text instead of the receipt card.
    //
    // The two paths carry DIFFERENT strings on purpose:
    //  - native share gets text WITHOUT the trailing link, plus `url` — otherwise a target
    //    that appends url to text shows the same link twice.
    //  - the clipboard fallback has no `url` field at all, so its text MUST keep the link
    //    or the copied message loses the deep link entirely.
    // Named trade, so nobody rediscovers it: a target that keeps `text` and drops `url`
    // loses our deep link. The source citation above survives in the text either way, and
    // the spec has implementations include `url` when present, so this is the rare side.
    const nativeText = parts.join("\n\n");
    const clipboardText = [...parts, `See the receipt: ${receiptUrl}`].join("\n\n");

    if (navigator.share) {
      navigator.share({ text: nativeText, url: receiptUrl }).catch(() => {});
    } else {
      // Canon P0-2: the clipboard fallback needs visible feedback — same
      // "Copied!" pattern DailySwipe ships (design-canon review 2026-07-18).
      navigator.clipboard.writeText(clipboardText).then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }).catch(() => {});
    }
  }

  const categoryColor = CATEGORY_COLORS[item.category] || "#666";
  const categoryLabel = CATEGORY_LABELS[item.category] || item.category;

  return (
    <article className="feed-card">
      {/* Category + time */}
      <div className="feed-card-top">
        <span className="feed-category-badge" style={{ background: categoryColor }}>
          {categoryLabel}
        </span>
        {/* R-062 — the epistemic status of the claim, on the card rather than buried in prose.
            A reader could not tell an unproven allegation from a sourced receipt without parsing
            the headline; both rendered with identical visual authority, which is this project's
            own Facts-vs-Commentary rule failing on its primary surface.
            DETECTOR: isReportedClaim() — a NARROW explicit second-hand-sourcing list, NOT
            hedgePenalty(). The 2026-08-17 attempt reused hedgePenalty and fired on 23 of 152
            live cards, ~7 wrongly, every wrong one a hedge inside an attribution or negation
            ("Ray Dalio warns a wealth tax COULD…", "Walter's sale is NOT EXPECTED TO…").
            hedgePenalty is a RANKING input and ranking can afford to be loose — a false hedge
            costs a card some position. A visible LABEL inverts that cost asymmetry, because it
            asserts something about a named living person's card. Same reasoning as the two
            dedup thresholds in CLAUDE.md.
            CALIBRATED ON PROD, not on reasoning about headline shapes (B-021): the narrow list
            marks 14 of 171 live cards with ZERO false positives, and all 7 of the measured 2026-08-17
            false positives fall outside it. Re-run `npm run preview:hedge-marker` before changing
            this — a better SCORE does not justify a shipped label; zero false positives does. */}
        {isReportedClaim(item.headline) ? (
          <span
            className="feed-reported-badge"
            title="This headline reports a claim second-hand — the source says it is reported, not confirmed. The link below is still the receipt for what was published."
          >
            Reported
          </span>
        ) : null}
        <span className="feed-card-time" suppressHydrationWarning>{timeAgo(item.publishedAt)}</span>
      </div>

      {/* Headline */}
      {/* h2, not h3: the page h1 is "The Feed" and there was no h2 between them,
          so a screen reader heard the card headlines as a level that skipped.
          Styling is class-based, so the level is free to be correct. */}
      <h2 className="feed-card-headline">
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
          {item.headline}
        </a>
      </h2>

      {/* Summary */}
      {/* B-037 DISPLAY leg. When this person's FEC record is withheld, the API's prose strip can
          empty the summary entirely — `withholdPoliticalProse` returns "" rather than editing the
          sentence, because dropping on doubt is the right call for a claim about a named living
          person. That left a headline over a blank <p>: honest and mute. The profile explains the
          same withhold in full and Cycle 16 called that notice the page at its best; this says the
          short version on the surface a reader actually meets, and points at the profile for the
          rest.
          GATED ON THE FLAG, NEVER ON THE EMPTY STRING: three served cards have an empty summary
          and only one of them is withheld (the other two are old cards the curator wrote without
          prose), so `!item.summary` alone would print a withhold notice on a card nothing was
          withheld from — a false claim about our own data, which is the class this whole leg
          exists to avoid. Rendered ONLY where the body would otherwise be blank: a withheld card
          whose prose never named a figure keeps its summary and needs no caveat, and repeating one
          sentence on every surface is how a caveat becomes wallpaper (Cycle 7, Finding 2). */}
      {item.summary ? (
        <p className="feed-card-summary">{item.summary}</p>
      ) : item.politicalWithheld ? (
        <p className="feed-card-summary feed-card-summary--withheld">
          We&rsquo;re not showing a political figure here: we match FEC records by name only, and we
          can&rsquo;t prove this one is theirs. The full note is on the profile.
        </p>
      ) : (
        <p className="feed-card-summary">{item.summary}</p>
      )}

      {/* Source — a clickable independent verification path (every claim source-linked) */}
      {item.sourceUrl ? (
        <a
          className="feed-card-source feed-card-source-link"
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {sourceLabel(item.sourceName, item.sourceUrl)} &#8599;
        </a>
      ) : (
        <span className="feed-card-source">{sourceLabel(item.sourceName, item.sourceUrl)}</span>
      )}

      {/* Person tags */}
      {item.persons && item.persons.length > 0 && (
        <div className="feed-person-tags">
          {item.persons.map((person) => (
            <a
              key={person.id}
              href={`/billionaires/${person.id}`}
              className="feed-person-tag"
            >
              {person.images?.[0] ? (
                <img src={person.images[0]} alt="" className="feed-person-tag-photo" />
              ) : (
                <span className="feed-person-tag-avatar">
                  {person.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </span>
              )}
              <span className="feed-person-tag-name">{person.name}</span>
            </a>
          ))}
        </div>
      )}

      {/* Context nuggets */}
      {(ctx.netWorth || ctx.political || ctx.philanthropy || ctx.pbs) && (
        <div className="feed-context">
          {ctx.netWorth && (
            <span className="feed-context-nugget">
              {/* Label, not a currency symbol: the value already carries its
                  own "$", so a "$" icon rendered "$~$1.14T" on every card.
                  The other nuggets are all source/type labels (FEC, 990,
                  GIVING) — this one now matches. */}
              <span className="feed-context-icon">NET WORTH</span>
              {ctx.netWorth}
              {/* B-065 — a figure we cannot date, or one over a year old, says so on its chip. */}
              {item.netWorthAsOf ? (
                <span className="feed-context-asof"> ({item.netWorthAsOf})</span>
              ) : null}
            </span>
          )}
          {grade && pbsNum !== null ? (
            <span
              className="feed-context-nugget feed-context-pbs"
              style={{ borderColor: grade.color }}
              title="Giving grade — how much of their wealth they actually give, weighted by how well their giving is documented. It rates their GIVING RECORD, not this story."
            >
              <span className="feed-context-icon">{READER_FACING_SCORE_BADGE_LABEL}</span>
              <strong style={{ color: grade.color }}>{grade.letter}</strong>
              <span className="feed-context-pbs-num">({readerFacingScoreValue(pbsNum)})</span>
            </span>
          ) : ctx.pbs ? (
            <span className="feed-context-nugget" title="Giving grade — rates their giving record, not this story.">
              <span className="feed-context-icon">{READER_FACING_SCORE_BADGE_LABEL}</span>
              {ctx.pbs}/100
            </span>
          ) : null}
          {ctx.political && (
            <span className="feed-context-nugget">
              <span className="feed-context-icon">FEC</span>
              {ctx.political}
            </span>
          )}
          {ctx.philanthropy && (
            <span className="feed-context-nugget">
              <span className="feed-context-icon">990</span>
              {ctx.philanthropy}
            </span>
          )}
        </div>
      )}

      {/* B-065 — ONE stated sentence whenever the card's net worth is not current, or its text was
          written from an earlier figure. It covers the chip, the headline and the prose; the prose itself
          is not relabelled (an inline matcher labelled the wrong money three review rounds running). */}
      {netWorthNote ? <p className="feed-grade-caveat">{netWorthNote}</p> : null}

      {/* R-052 — the ratio, stated. The grade badge above already encodes it,
          but a letter is a verdict the reader has to trust; the two numbers
          side by side are a verdict they compute themselves. Rendered from
          live facts, never written by the model — an LLM juxtaposing these is
          exactly what Pass C rejects. Absent (not zero) where the curated
          giving fact is missing, which is most cards. */}
      {item.givingRatio && (
        <p className="feed-receipt-ratio">
          Gives about <strong>{formatUsdCompact(item.givingRatio.annualGiving)}</strong> a year
          {" — "}
          <strong>{formatGivingPercent(item.givingRatio.percent)}</strong> of their{" "}
          {formatUsdCompact(item.givingRatio.netWorth)} fortune.
        </p>
      )}

      {/* Action bar */}
      <div className="feed-action-bar">
        <button
          className="feed-action-btn feed-action-up"
          onClick={() => handleVote("up")}
          disabled={voting}
          aria-label={`Upvote (${item.upvotes})`}
        >
          <span className="feed-vote-arrow">&#9650;</span> {item.upvotes}
        </button>
        <button
          className="feed-action-btn feed-action-down"
          onClick={() => handleVote("down")}
          disabled={voting}
          aria-label={`Downvote (${item.downvotes})`}
        >
          <span className="feed-vote-arrow">&#9660;</span> {item.downvotes}
        </button>
        <button
          className="feed-action-btn"
          onClick={() => setShowComments(!showComments)}
        >
          Comments {item.commentCount > 0 ? `(${item.commentCount})` : ""}
        </button>
        <button className="feed-action-btn" onClick={handleShare} aria-live="polite">
          {shareCopied ? "Copied!" : "Share"}
        </button>
      </div>

      {/* Logged-out vote notice — shown only after a vote attempt with no session */}
      {voteNotice && (
        <p className="feed-vote-notice" role="status">
          <a href="/login">Sign in</a> to make your vote count.
        </p>
      )}
      {voteError && (
        <p className="feed-vote-notice" role="alert">
          That vote didn&apos;t go through — try again.
        </p>
      )}

      {/* Comments section */}
      {showComments && <FeedComments feedItemId={item.id} />}
    </article>
  );
}
