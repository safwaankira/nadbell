import type { Level, Snapshot } from "@/lib/chain/market";
import { ago, fmtShares, usd } from "./format";

export function BookPanel({ snap, now }: { snap: Snapshot | null; now: number }) {
  const asks = (snap?.asks ?? []).slice(0, 4).reverse();
  const bids = (snap?.bids ?? []).slice(0, 4);
  const max = Math.max(1, ...asks.map((r) => r.lots), ...bids.map((r) => r.lots));
  const last = snap?.trades[0];
  // A last trade weeks ago reads as "dead market"; say plainly that the next trade sets the price instead.
  const quiet = !!snap && (!last || now / 1000 - last.time > 86_400);
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">Order book</h2>
      <p className="mt-1 text-xs text-muted">Sellers on top, buyers below. Shares at each price.</p>
      <div className="mt-2">
        <BookRows rows={asks} max={max} tone="down" />
        <div className="my-1 border-t border-border" />
        <BookRows rows={bids} max={max} tone="up" />
      </div>
      {quiet ? (
        <p className="mt-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
          {last ? `Quiet here: the last trade was ${ago(now / 1000 - last.time)} ago.` : "No trades yet."} Your trade sets
          the next price on the chart.
        </p>
      ) : null}
      <h3 className="mt-4 text-xs text-muted">Latest trades</h3>
      <ul className="mt-1 font-mono text-xs">
        {(snap?.trades ?? []).slice(0, 5).map((t, i) => (
          <li key={`${t.time}-${i}`} className="flex justify-between py-0.5">
            <span className={t.takerBuy ? "text-primary" : "text-down"}>{usd(t.price)}</span>
            <span>{fmtShares(t.lots)}</span>
            <span className="text-muted">{ago(now / 1000 - t.time)} ago</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BookRows({ rows, max, tone }: { rows: Level[]; max: number; tone: "up" | "down" }) {
  const bar = tone === "up" ? "bg-primary/25" : "bg-down/25";
  return (
    <ul className="font-mono text-sm">
      {rows.map(({ price, lots }) => (
        <li key={price} className="relative flex justify-between py-1">
          <span className={`absolute inset-y-0 right-0 ${bar}`} style={{ width: `${Math.max(8, (lots / max) * 100)}%` }} />
          <span className={`relative ${tone === "up" ? "text-primary" : "text-down"}`}>{usd(price)}</span>
          <span className="relative text-fg">{fmtShares(lots)}</span>
        </li>
      ))}
    </ul>
  );
}
