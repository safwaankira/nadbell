import { useState } from "react";
import { useMarket, type Snapshot } from "@/lib/chain/market";
import { nextOpen } from "@/lib/nyse";
import { nyWhen, pct, usd } from "./format";
import { Leaderboard } from "./leaderboard";

export function CallTheOpen({ snap, busy, connected, mid, now }: { snap: Snapshot; busy: string | null; connected: boolean; mid: number; now: number }) {
  const m = useMarket.getState();
  const [price, setPrice] = useState("");
  const mine = snap.calls.mine;
  const nOpen = nextOpen(new Date(now));
  const cents = Math.round((Number(price) || 0) * 100);
  const vsClose = cents && snap.closeCents ? Math.round(((cents - snap.closeCents) / snap.closeCents) * 10_000) : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">Call the open</h2>
      <p className="mt-1 text-sm text-muted">
        Where will AAPL open{nOpen ? ` ${nyWhen(nOpen)}` : ""}? Free, no money at stake. Scored against the real open.
      </p>
      <label className="mt-4 block rounded-lg border border-border px-3 py-2">
        <span className="text-xs text-muted">Your call</span>
        <div className="flex items-baseline gap-1 font-mono text-2xl">
          <span className="text-muted">$</span>
          <input
            className="w-full bg-transparent outline-none"
            inputMode="decimal"
            placeholder={(mid / 100).toFixed(2)}
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
          />
        </div>
      </label>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <button type="button" className="h-9 rounded-full border border-border px-3" onClick={() => setPrice((snap.closeCents / 100).toFixed(2))}>
          Close {usd(snap.closeCents)}
        </button>
        <button type="button" className="h-9 rounded-full border border-border px-3" onClick={() => setPrice((mid / 100).toFixed(2))}>
          This market {usd(mid)}
        </button>
      </div>
      {cents ? <p className="mt-2 text-sm text-muted">{pct(vsClose, true)} vs the close</p> : null}
      <button
        type="button"
        className="mt-3 h-12 w-full rounded-lg bg-fg text-base font-medium text-bg disabled:opacity-40"
        disabled={!connected || !!busy || !cents}
        onClick={() => void m.callOpen(cents)}
      >
        {!connected ? "Connect a wallet to call it" : mine ? "Change my call" : "Lock my call"}
      </button>
      <p className="mt-2 text-sm text-muted">
        {mine ? `Your call: ${usd(mine)}. ` : ""}
        {snap.calls.count} {snap.calls.count === 1 ? "call" : "calls"} so far this session.
      </p>
      <Leaderboard snap={snap} />
    </div>
  );
}
