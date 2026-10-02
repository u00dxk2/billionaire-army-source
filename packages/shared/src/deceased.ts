// ONE "is this person deceased?" predicate, read by both the feed curator (B-013) and the /today
// daily-ten pool (B-055). It lived in packages/jobs until 2026-09-27, which the API cannot import,
// so /today never asked the question and served people the feed already refused — Jim Simons
// (d. 2024) was card 7 on 2026-09-21. Kept here rather than forked, the same rule that holds
// accountabilityScore() and eventSignature() in this package.
//
// `deathYear` comes from fetch:wikidata's P570. A death Wikidata does not record is invisible here.

export interface DeceasedCheckPerson {
  name?: string;
  deathYear: number | null;
}

export function isDeceased(person: DeceasedCheckPerson | undefined): boolean {
  return person != null && person.deathYear != null;
}
