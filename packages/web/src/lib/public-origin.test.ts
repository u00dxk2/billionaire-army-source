import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicOrigin } from "./public-origin.js";

function hdrs(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

test("production: the forwarded public host wins over the proxy's localhost Host", () => {
  // The exact shape measured on prod 2026-09-27: request.url origin was localhost:3000.
  const h = hdrs({ host: "localhost:3000", "x-forwarded-host": "billionaire.army" });
  assert.equal(publicOrigin(h, "production"), "https://billionaire.army");
});

test("production: a bare Host of the public domain is used", () => {
  assert.equal(publicOrigin(hdrs({ host: "billionaire.army" }), "production"), "https://billionaire.army");
});

test("production: the Render host is still served", () => {
  const h = hdrs({ "x-forwarded-host": "ba-web-1d2a.onrender.com" });
  assert.equal(publicOrigin(h, "production"), "https://ba-web-1d2a.onrender.com");
});

test("production: localhost is NEVER returned, even when it is the only header", () => {
  // Positive control for the defect: this input produced https://localhost:3000 before.
  assert.equal(publicOrigin(hdrs({ host: "localhost:3000" }), "production"), "https://billionaire.army");
});

test("an attacker-chosen host falls back to the production domain", () => {
  for (const evil of ["evil.com", "billionaire.army.evil.com", "evil.com, billionaire.army"]) {
    assert.equal(publicOrigin(hdrs({ "x-forwarded-host": evil }), "production"), "https://billionaire.army", evil);
  }
});

test("no headers at all falls back to the production domain", () => {
  assert.equal(publicOrigin(hdrs({}), "production"), "https://billionaire.army");
});

test("development keeps localhost over http", () => {
  assert.equal(publicOrigin(hdrs({ host: "localhost:3000" }), "development"), "http://localhost:3000");
});

test("the callback route never derives its redirect origin from request.url", () => {
  const src = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\/.*$/gm, "");
  assert.ok(code.includes("publicOrigin(request.headers)"), "route must call publicOrigin");
  assert.ok(!/\{[^}]*\borigin\b[^}]*\}\s*=\s*new URL\(request\.url\)/.test(code), "route destructures origin from request.url again");
  assert.ok(!/new URL\(request\.url\)\.origin/.test(code), "route reads request.url origin again");
});

test("the login page explains ?error=auth instead of ignoring it", () => {
  const src = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.ok(src.includes('params.get("error") === "auth"'), "login must read ?error=auth");
  assert.ok(src.includes("setError(AUTH_LINK_FAILED)"), "login must show the failed-link message");
});
