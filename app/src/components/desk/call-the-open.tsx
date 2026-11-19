import { useState } from "react";
import { useMarket, type Snapshot } from "@/lib/chain/market";
import { nextOpen } from "@/lib/nyse";
import { nyWhen, pct, usd } from "./format";
import { Leaderboard } from "./leaderboard";

const chip = "btn caption-4 rounded-full border border-border px-3 py-1.5 hover:border-muted";

export function CallTheOpen({
  snap,
  busy,
  connected,
  mid,
  now,
}: {
  snap: Snapshot;
  busy: string | null;
  connected: boolean;
  mid: number;
  now: number;
}) {
  const m = useMarket.getState();
  const [price, setPrice] = useState("");
  const mine = snap.calls.mine;
  const nOpen = nextOpen(new Date(now));
  const cents = Math.round((Number(price) || 0) * 100);
  const vsClose =
    cents && snap.closeCents
      ? Math.round(((cents - snap.closeCents) / snap.closeCents) * 10_000)
      : 0;

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-6">
      <h2 className="title-3">Call the open</h2>
      <p className="body-6 mt-2 text-muted">
        Where will AAPL open{nOpen ? ` ${nyWhen(nOpen)}` : ""}? Free, no money at stake. Scored
        against the real open.
      </p>
      <label className="mt-6 block rounded-xl border border-border bg-surface-2 px-4 py-3 focus-within:border-muted">
        <span className="caption-4 text-muted">Your call</span>
        <div className="mt-1 flex items-baseline gap-1 font-mono text-3xl">
          <span className="text-faint">$</span>
          <input
            className="w-full bg-transparent outline-none placeholder:text-faint"
            inputMode="decimal"
            placeholder={(mid / 100).toFixed(2)}
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
          />
        </div>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={chip}
          onClick={() => setPrice((snap.closeCents / 100).toFixed(2))}
        >
          Close {usd(snap.closeCents)}
        </button>
        <button type="button" className={chip} onClick={() => setPrice((mid / 100).toFixed(2))}>
          This market {usd(mid)}
        </button>
      </div>
      <p className="body-6 mt-4 min-h-5 text-muted">
        {cents ? (
          <>
            <span className={`font-mono ${vsClose >= 0 ? "text-up" : "text-down"}`}>
              {pct(vsClose, true)}
            </span>{" "}
            vs the close
          </>
        ) : null}
      </p>
      <button
        type="button"
        className="btn button-md mt-4 w-full bg-fg text-bg hover:bg-fg/90"
        disabled={!connected || !!busy || !cents}
        onClick={() => void m.callOpen(cents)}
      >
        {!connected ? "Connect a wallet to call it" : mine ? "Change my call" : "Lock my call"}
      </button>
      <p className="caption-5 mt-3 text-faint">
        {mine ? `Your call: ${usd(mine)}. ` : ""}
        {snap.calls.count} {snap.calls.count === 1 ? "call" : "calls"} so far this session.
      </p>
      <Leaderboard snap={snap} />
    </div>
  );
}
