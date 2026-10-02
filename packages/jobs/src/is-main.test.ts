import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { isMain } from "./is-main";

const asUrl = (p: string) => pathToFileURL(p).href;
// A real absolute path on this platform, so the Windows drive-letter/URL
// round-trip is exercised rather than assumed.
const script = new URL("./cleanup.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("run directly → true", () => {
  assert.equal(isMain(asUrl(script), script), true);
});

test("imported by another module → false (this is the whole point)", () => {
  const other = script.replace("cleanup.ts", "feed-curator.ts");
  assert.equal(isMain(asUrl(script), other), false);
});

test("extension differences between loader and source do not break it", () => {
  // tsx resolves a .js entry to the .ts source; the hrefs then differ only here.
  assert.equal(isMain(asUrl(script), script.replace(/\.ts$/, ".js")), true);
});

test("no entrypoint (embedded/eval) → false, never runs by accident", () => {
  assert.equal(isMain(asUrl(script), undefined), false);
  assert.equal(isMain("", script), false);
});

test("a different script with a similar name is not main", () => {
  const sibling = script.replace("cleanup.ts", "cleanup-extra.ts");
  assert.equal(isMain(asUrl(script), sibling), false);
});
