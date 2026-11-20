import { test } from "node:test";
import assert from "node:assert/strict";
import { isRegularOpen, nextClose, nextOpen } from "./nyse.ts";
// The keeper decides when to push and ring the bell with its own copy of the calendar.
// If the two drift apart, the app and the chain disagree about whether NYSE is open.
import * as keeper from "../../../keeper/nyse.mjs";

const at = (iso: string) => new Date(iso);

test("open on a normal Tuesday at 10:00 ET, closed at 16:00 ET", () => {
  assert.equal(isRegularOpen(at("2026-11-17T15:00:00Z")), true); // 10:00 EST
  assert.equal(isRegularOpen(at("2026-11-17T21:00:00Z")), false); // 16:00 EST
});

test("closed on weekends and holidays (Thanksgiving 2026)", () => {
  assert.equal(isRegularOpen(at("2026-11-21T16:00:00Z")), false); // Saturday
  assert.equal(isRegularOpen(at("2026-11-26T16:00:00Z")), false); // Thanksgiving
});

test("early close the day after Thanksgiving ends at 13:00 ET", () => {
  assert.equal(isRegularOpen(at("2026-11-27T17:30:00Z")), true); // 12:30 EST
  assert.equal(isRegularOpen(at("2026-11-27T18:30:00Z")), false); // 13:30 EST
  assert.equal(nextClose(at("2026-11-27T15:00:00Z"))?.toISOString(), "2026-11-27T18:00:00.000Z");
});

test("Friday evening's next open skips the weekend to Monday 09:30 ET", () => {
  assert.equal(nextOpen(at("2026-11-20T22:00:00Z"))?.toISOString(), "2026-11-23T14:30:00.000Z");
});

test("app and keeper calendars agree every 30 minutes through 2026-27", () => {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const end = Date.parse("2027-12-31T23:30:00Z");
  let checked = 0;
  for (let t = start; t <= end; t += 30 * 60_000) {
    const d = new Date(t);
    assert.equal(isRegularOpen(d), keeper.isRegularOpen(d), d.toISOString());
    checked++;
  }
  assert.ok(checked > 35_000);
});
