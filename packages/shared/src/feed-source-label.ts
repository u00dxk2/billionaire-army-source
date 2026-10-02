/**
 * How a feed card NAMES its source.
 *
 * The curator stores `"Unknown"` when a candidate carries no publisher string — a NOT-NULL
 * placeholder, never a display value. It reached prod as one: on 2026-08-17 the day's only card,
 * served at #7, was a hedged allegation about a named living person whose whole attribution line
 * rendered as the literal word `Unknown ↗` over a washingtonexaminer.com link. 12 of 152 live cards
 * carry the placeholder. On a platform whose thesis is that no claim outruns its citation, an
 * unnamed source on a defamation-adjacent card is the thesis failing on the surface that carries it.
 *
 * The fix is display-side on purpose: it repairs all existing rows with no prod data write, and the
 * host is derivable from data the card already has. `sourceUrl` is the receipt either way — this only
 * decides what the receipt is CALLED.
 *
 * ponytail: the host, not a curated publisher-name map. "washingtonexaminer.com" is honest and needs
 * no maintenance; a prettified-name table would be a second thing to keep true.
 */

/** Placeholders the pipeline writes when it has no publisher string. Lowercased compare. */
const PLACEHOLDERS = new Set(["unknown", "unknown source", "n/a", "null", "undefined", "-"]);

function isPlaceholder(name: string | null | undefined): boolean {
  if (!name) return true;
  const s = name.trim();
  return s.length === 0 || PLACEHOLDERS.has(s.toLowerCase());
}

/**
 * The publisher label to display for a card. Prefers a real stored name, falls back to the
 * source URL's host, and only when neither is usable says so plainly rather than "Unknown"
 * (which reads as a fact about the source instead of a gap in our record).
 */
export function sourceLabel(sourceName: string | null | undefined, sourceUrl: string | null | undefined): string {
  if (!isPlaceholder(sourceName)) return sourceName!.trim();

  if (sourceUrl) {
    try {
      const host = new URL(sourceUrl).hostname.replace(/^www\./i, "");
      if (host) return host;
    } catch {
      // Malformed stored URL — fall through; never throw inside a render path.
    }
  }

  return "Source not recorded";
}
