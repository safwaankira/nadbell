import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateBuy, estimateSell } from "./estimate.ts";

// Prices are cents per share; lots are 1/100 of a share (see OrderBook.sol).
const asks = [
  { price: 35_000, lots: 100 }, // 1 share at $350.00
  { price: 35_200, lots: 100 }, // 1 share at $352.00 (within 1% of the best ask)
  { price: 36_000, lots: 100 }, // more than 1% above the best ask: never reached
];
const bids = [
  { price: 34_900, lots: 100 },
  { price: 34_600, lots: 100 }, // within 1% below the best bid
  { price: 34_000, lots: 100 }, // more than 1% below: never reached
];

test("buy walks the asks and stops at the 1% band", () => {
  const { lots, avg } = estimateBuy(asks, 10_000);
  assert.equal(lots, 200);
  assert.equal(Math.round(avg), 35_100);
});

test("buy spends only what the dollars cover", () => {
  assert.equal(estimateBuy(asks, 175).lots, 50); // $175 at $350 = half a share
});

test("buy on an empty book or with $0 fills nothing", () => {
  assert.deepEqual(estimateBuy([], 100), { lots: 0, avg: 0 });
  assert.equal(estimateBuy(asks, 0).lots, 0);
});

test("sell walks the bids and stops at the 1% band", () => {
  const { lots, dollars } = estimateSell(bids, 300);
  assert.equal(lots, 200);
  assert.equal(dollars, 695);
});

test("sell never sells more than asked", () => {
  assert.equal(estimateSell(bids, 50).lots, 50);
  assert.equal(estimateSell([], 50).lots, 0);
});
