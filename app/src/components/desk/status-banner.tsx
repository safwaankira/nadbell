import type { Snapshot } from "@/lib/chain/market";
import { nextClose, nextOpen } from "@/lib/nyse";
import { ago, nyWhen, pct, until, usd } from "./format";

export function StatusBanner({ snap, now, mid, gapBps }: { snap: Snapshot | null; now: number; mid: number; gapBps: number }) {
  if (!snap) {
    return <div className="mt-5 rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">Reading the market…</div>;
  }
  const open = snap.marketOpen;
  const age = now / 1000 - snap.print.time;
  const nOpen = nextOpen(new Date(now));
  const nClose = nextClose(new Date(now));
  return (
    <div className={`mt-5 rounded-xl border px-4 py-4 ${open ? "border-primary/50 bg-primary/10" : "border-down/50 bg-down/10"}`} role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-medium">
          {open ? "Market open" : "Market closed"}
          <span className="ml-2 font-mono text-base text-muted">tAAPL</span>
        </p>
        <p className="font-mono text-2xl">{usd(mid)}</p>
      </div>
      <p className="mt-1 text-sm text-muted">
        {open ? (
          <>
            Official price {usd(snap.print.cents)} from {snap.print.label}, updated {ago(age)} ago.
            {nClose ? ` Closes ${nyWhen(nClose)}.` : ""}
            {!snap.print.fresh ? " The price feed is late, so minting is paused." : ""}
          </>
        ) : (
          <>
            Frozen at {usd(snap.closeCents)} since the close. You can still trade here: this market is{" "}
            <span className={gapBps >= 0 ? "text-primary" : "text-down"}>{pct(gapBps, true)}</span> from the close.
            {nOpen ? ` Reopens ${nyWhen(nOpen)}, in ${until(nOpen.getTime() - now)}.` : ""}
          </>
        )}
      </p>
    </div>
  );
}
