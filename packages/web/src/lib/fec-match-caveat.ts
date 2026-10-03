/**
 * B-037 / the owner 2026-10-02 (relayed verbatim, bus 4358c4a6): "show it but say that it could be another
 * person with the same name and here's why we can't verify."
 *
 * ONE sentence, read by every surface that shows a name-matched FEC record (the profile's political
 * record and the summary's political paragraph), so the two can never say different things. It
 * states the matching basis and the honest reason we cannot vouch for it: FEC filings can carry an
 * employer and city (597 and 600 of 600 records, scripts/b037-six-employer-check.mjs, 2026-10-02),
 * and the matching behind the displayed record does not use them. Not "the records hold no
 * employer": they usually do, which is why this is a gap in OUR matching, not in the record. Not
 * "we have not checked": a read-only preview does, and the claims pass refuted that wording.
 * Render it ONLY where an FEC record is on the page — a political paragraph without one (an
 * endorsement, say) is not about these donations.
 */
export const FEC_NAME_MATCH_CAVEAT =
  "These donations are matched to this person by name only, so some may belong to a different person with the same name: FEC filings can include a donor's employer and city, but our matching does not check them against what we know about this person.";
