import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, pct, until, usd } from "./format.ts";

test("usd formats cents with two decimals and thousands separators", () => {
  assert.equal(usd(35_400), "$354.00");
  assert.equal(usd(123_456_789), "$1,234,567.89");
});

test("pct shows a sign only when asked", () => {
  assert.equal(pct(125), "1.25%");
  assert.equal(pct(125, true), "+1.25%");
  assert.equal(pct(-40, true), "-0.40%");
  assert.equal(pct(0, true), "0.00%");
});

test("ago picks seconds, minutes, hours, then days", () => {
  assert.equal(ago(42), "42s");
  assert.equal(ago(600), "10 min");
  assert.equal(ago(17 * 3600), "17h");
  assert.equal(ago(33 * 86_400), "33d");
});

test("until counts down in days, hours and minutes", () => {
  assert.equal(until(65 * 60_000), "1h 5m");
  assert.equal(until(2 * 86_400_000 + 3 * 3_600_000), "2d 3h");
  assert.equal(until(-5_000), "0m");
});
