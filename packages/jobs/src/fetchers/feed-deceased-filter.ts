// B-013: a deceased person's index row can still be attached to a live news article when the
// headline only references them implicitly (e.g. "Adelson-linked donors...") rather than naming
// a specific different person — the attribution guard (feed-attribution-guard.ts) structurally
// can't catch that class, because no *other* full name appears in the headline to compare
// against. Filtering deceased persons out of candidate eligibility entirely, upstream of the
// guard and Pass B/C, closes the gap at its root instead of adding another headline-text rule.
//
// The predicate itself now lives in @ba/shared (B-055, 2026-09-27) so the /today pool reads the
// same one. Re-exported here so the curator's import is unchanged.

export { isDeceased, type DeceasedCheckPerson } from "@ba/shared";
