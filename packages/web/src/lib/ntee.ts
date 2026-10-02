// Human-readable labels for IRS NTEE (National Taxonomy of Exempt Entities)
// codes, as returned by ProPublica Nonprofit Explorer. A precise label for the
// common foundation codes, falling back to the NTEE major-group name; unknown
// or missing codes return null and the UI omits the line.

const SPECIFIC_LABELS: Record<string, string> = {
  T20: "Private grantmaking foundation",
  T21: "Corporate foundation",
  T22: "Private independent foundation",
  T23: "Private operating foundation",
  T30: "Public foundation",
  T31: "Community foundation",
};

const MAJOR_GROUP_LABELS: Record<string, string> = {
  A: "Arts, culture & humanities",
  B: "Education",
  C: "Environment",
  D: "Animal-related",
  E: "Health care",
  F: "Mental health & crisis intervention",
  G: "Disease & disorder-focused",
  H: "Medical research",
  I: "Crime & legal-related",
  J: "Employment",
  K: "Food, agriculture & nutrition",
  L: "Housing & shelter",
  M: "Public safety & disaster relief",
  N: "Recreation & sports",
  O: "Youth development",
  P: "Human services",
  Q: "International & foreign affairs",
  R: "Civil rights, social action & advocacy",
  S: "Community improvement",
  T: "Philanthropy, voluntarism & grantmaking",
  U: "Science & technology",
  V: "Social science",
  W: "Public & societal benefit",
  X: "Religion-related",
  Y: "Mutual & membership benefit",
};

export function nteeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const specific = SPECIFIC_LABELS[normalized.slice(0, 3)];
  if (specific) return specific;
  return MAJOR_GROUP_LABELS[normalized[0]] ?? null;
}
