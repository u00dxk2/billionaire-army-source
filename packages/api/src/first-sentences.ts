// Canon Wave 3 (design-canon review P1-3): the naive /[^.!?]+[.!?]+/ split
// counted "U." and "S." as sentences, so daily-ten receipt bios rendered as
// "Frank Slootman is a U.S." — truncated mid-phrase on the demo surface.
//
// The merge logic MOVED to `@ba/shared` (`splitSentences`) on 2026-08-25, when the
// profile-render commentary strip became a second consumer that needed the same
// abbreviation/decimal handling. One copy, so a second caller cannot re-learn the
// truncated-bio lesson the expensive way. This file keeps its own name and signature —
// every existing call site and its tests are unchanged.
import { splitSentences } from "@ba/shared";

export function firstSentences(text: string, n: number): string {
  const parts = splitSentences(text);
  if (!parts.length) return text;
  return parts.slice(0, n).join("").trim();
}
