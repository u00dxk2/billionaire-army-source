// PBS component weights live in ./pbs.ts (PBS_WEIGHTS) alongside the scoring
// logic. v1's five-weight block (three of them hardcoded placeholders) was
// removed when v2 shipped — see ./pbs.ts and docs/PBS_METHODOLOGY.md.

// Verification levels for progress reports
export const VERIFICATION_LEVELS = {
  0: "Self-Reported",
  1: "Documented",
  2: "Audited",
  3: "Outcome-Verified",
} as const;

// Goal statuses
export const GOAL_STATUSES = [
  "draft",
  "proposed",
  "active",
  "archived",
] as const;

// SMART criteria labels
export const SMART_LABELS = {
  S: "Specific",
  M: "Measurable",
  A: "Achievable",
  R: "Relevant",
  T: "Time-bound",
} as const;

export const DONATION_CAP_CENTS = 10_000; // $100.00

// Feed categories
export const FEED_CATEGORIES = [
  "politics",
  "philanthropy",
  "business",
  "sec_filing",
  "controversy",
] as const;

export const FEED_CATEGORY_LABELS: Record<string, string> = {
  politics: "Politics",
  philanthropy: "Philanthropy",
  business: "Business",
  sec_filing: "SEC Filing",
  controversy: "Controversy",
};
