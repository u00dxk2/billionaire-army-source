/**
 * Shared Wikimedia Commons helpers. Extracted from wikidata.ts + wikidata-seed.ts
 * (the two copies were identical apart from a dead `hash` variable) so the enrich
 * and seed paths can't drift.
 */

/**
 * Convert a Wikimedia Commons file URL to a thumbnail URL of the given width.
 * Uses Special:FilePath, which resolves the MD5 hash path for us, so we only
 * need the (space→underscore) encoded filename.
 */
export function wikimediaThumbUrl(commonsUrl: string, width: number = 300): string {
  const filename = commonsUrl.split("/").pop();
  if (!filename) return commonsUrl;
  const encoded = filename.replace(/ /g, "_");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`;
}
