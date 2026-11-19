import type { Level } from "@/lib/chain/market";

/** Walk the asks to estimate what $X buys (up to 1% above the best offer, like the contract call). */
export function estimateBuy(asks: Level[], dollars: number) {
  const limit = asks[0] ? Math.ceil(asks[0].price * 1.01) : 0;
  let left = dollars;
  let lots = 0;
  let spent = 0;
  for (const l of asks) {
    if (l.price > limit || left <= 0) break;
    const can = Math.min(l.lots, Math.floor((left * 10_000) / l.price));
    lots += can;
    spent += (can * l.price) / 10_000;
    left -= (can * l.price) / 10_000;
  }
  return { lots, avg: lots ? (spent * 10_000) / lots : 0 };
}

export function estimateSell(bids: Level[], lotsWanted: number) {
  const limit = bids[0] ? Math.floor(bids[0].price * 0.99) : 0;
  let left = lotsWanted;
  let got = 0;
  let lots = 0;
  for (const l of bids) {
    if (l.price < limit || left <= 0) break;
    const n = Math.min(l.lots, left);
    lots += n;
    got += (n * l.price) / 10_000;
    left -= n;
  }
  return { lots, dollars: got };
}
