import type { Level, Snapshot } from "@/lib/chain/market";
import { ago, fmtShares, usd } from "./format";

export function BookPanel({ snap, now }: { snap: Snapshot | null; now: number }) {
  const asks = (snap?.asks ?? []).slice(0, 4).reverse();
  const bids = (snap?.bids ?? []).slice(0, 4);
  const max = Math.max(1, ...asks.map((r) => r.lots), ...bids.map((r) => r.lots));
  const last = snap?.trades[0];
  const spread = snap?.asks[0] && snap?.bids[0] ? snap.asks[0].price - snap.bids[0].price : null;
  // A last trade weeks ago reads as "dead market"; say plainly that the next trade sets the price instead.
  const quiet = !!snap && (!last || now / 1000 - last.time > 86_400);
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="title-3">Order book</h2>
        {spread != null ? (
          <span className="caption-5 font-mono text-muted">Spread {usd(spread)}</span>
        ) : null}
      </div>
      <div className="caption-4 mt-4 flex justify-between text-faint">
        <span>Price</span>
        <span>Shares</span>
      </div>
      <div className="mt-1">
        <BookRows rows={asks} max={max} tone="down" />
        <div className="my-1 border-t border-border" />
        <BookRows rows={bids} max={max} tone="up" />
      </div>
      {quiet ? (
        <p className="caption-5 mt-4 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2">
          {last
            ? `Quiet here: the last trade was ${ago(now / 1000 - last.time)} ago.`
            : "No trades yet."}{" "}
          Your trade sets the next price on the chart.
        </p>
      ) : null}
      <h3 className="title-4 mt-6">Latest trades</h3>
      <ul className="caption-5 mt-2 font-mono">
        {(snap?.trades ?? []).slice(0, 5).map((t, i) => (
          <li key={`${t.time}-${i}`} className="flex justify-between py-1">
            <span className={t.takerBuy ? "text-up" : "text-down"}>{usd(t.price)}</span>
            <span>{fmtShares(t.lots)}</span>
            <span className="text-muted">{ago(now / 1000 - t.time)} ago</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BookRows({ rows, max, tone }: { rows: Level[]; max: number; tone: "up" | "down" }) {
  const bar = tone === "up" ? "bg-up/10" : "bg-down/10";
  return (
    <ul className="body-6 font-mono">
      {rows.map(({ price, lots }) => (
        <li key={price} className="relative flex justify-between px-2 py-1">
          <span
            className={`absolute inset-y-0 right-0 rounded-sm ${bar}`}
            style={{ width: `${Math.max(8, (lots / max) * 100)}%` }}
          />
          <span className={`relative ${tone === "up" ? "text-up" : "text-down"}`}>
            {usd(price)}
          </span>
          <span className="relative text-fg">{fmtShares(lots)}</span>
        </li>
      ))}
    </ul>
  );
}
