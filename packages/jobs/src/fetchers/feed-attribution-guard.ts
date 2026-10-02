// Deterministic attribution guard for curated feed cards (2026-07-02).
//
// A candidate article's person link is fixed at INGEST time (GDELT/NewsAPI facts
// are stored per-person), but Pass A may rewrite the card toward a different
// subject — e.g. an article fetched under Sheldon Adelson rewritten into a
// "Miriam Adelson's newspaper…" card, or a Jeff Bezos article rewritten into a
// MacKenzie Scott card. Pass B's ENTITY check compares the card against the
// SOURCE ARTICLE, so a card that faithfully names the article's real subject
// passes even though it ships attached to the wrong person row (wrong photo,
// wrong PBS grade, wrong net worth — a wrong receipt on the demo surface).
//
// This guard compares the rewritten HEADLINE against the ATTACHED person row:
// flag only when the attached person's full name is absent from the headline
// AND a different indexed person's full name IS present. Requiring both
// conditions keeps it conservative — "Bloomberg Philanthropies backs…" attached
// to Michael Bloomberg passes (no other person named), while the two failure
// cases above are caught. The headline (not the summary) is the card's subject:
// summaries legitimately mention the attached person in passing.

export interface IndexedPerson {
  id: string;
  name: string;
}

/** Lowercase, strip punctuation/possessives to spaces, pad for boundary checks. */
export function normalizeForNameMatch(text: string): string {
  return " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
}

/** True when the full name appears as a word-bounded phrase in normalized text. */
export function nameInText(name: string, normalizedText: string): boolean {
  const n = normalizeForNameMatch(name).trim();
  if (!n) return false;
  return normalizedText.includes(` ${n} `);
}

/**
 * Returns the name of a DIFFERENT indexed person the headline is about, or null
 * when the attachment looks consistent. Null (pass) when the attached person is
 * named in the headline, or when no other indexed person's full (≥2-token) name
 * appears there — single-token names are too collision-prone to flag on.
 */
export function findAttributionMismatch(
  headline: string,
  attachedPersonId: string,
  attachedPersonName: string,
  allPersons: IndexedPerson[]
): string | null {
  const h = normalizeForNameMatch(headline);
  if (nameInText(attachedPersonName, h)) return null;
  const other = allPersons.find(
    (p) =>
      p.id !== attachedPersonId &&
      normalizeForNameMatch(p.name).trim().includes(" ") &&
      nameInText(p.name, h)
  );
  return other ? other.name : null;
}
