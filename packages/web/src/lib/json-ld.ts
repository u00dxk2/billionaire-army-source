// Serialize JSON-LD for a <script type="application/ld+json"> sink.
// JSON.stringify does NOT escape "<", so a data value containing "</script>"
// would close the tag and inject markup into the page. All JSON-LD values here
// are DB-sourced (names, aliases, descriptions), which makes this a latent
// second-order injection — escape "<" as the < JSON escape (inert in HTML).
//
// U+2028 / U+2029 are legal inside a JSON string and inert inside this ld+json block, which is
// DATA and never executed — so they are not an escape from THIS sink. They are escaped anyway
// because the escape is free and the failure is silent: the day someone reuses this helper for a
// real `<script>` payload (a config blob, a hydration island), an unescaped line separator is a
// syntax error that ships green through every test that only reads the JSON back.
//
// `>` and `&` are deliberately NOT escaped, and that is a decision rather than an omission: script
// content is RAW TEXT, so HTML entities are never decoded there and only `</script` can end the
// element. Escaping `<` already makes that unreachable; escaping the rest would be cargo cult.
//
// The separator pattern is built from a STRING, never a regex literal: U+2028 IS a line terminator
// in JavaScript source, so writing it raw inside /…/ ends the literal and the file stops parsing.
// This file's own first attempt did exactly that (2026-09-11, caught by the suite) — the character
// defeated the expression written to escape it.
const LINE_SEPARATORS = new RegExp("[\\u2028\\u2029]", "g");

export function jsonLdString(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATORS, (ch) => (ch.charCodeAt(0) === 0x2028 ? "\\u2028" : "\\u2029"));
}
