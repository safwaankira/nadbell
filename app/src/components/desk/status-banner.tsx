import type { Snapshot } from "@/lib/chain/market";
import { isRegularOpen, nextClose, nextOpen } from "@/lib/nyse";
import { ago, nyWhen, pct, until, usd } from "./format";

type Feed = { tone: "live" | "late" | "frozen"; text: string };

/** One-glance answer to "can I trust this price right now?". */
function feedStatus(snap: Snapshot, now: number): Feed {
  const age = now / 1000 - snap.print.time;
  if (snap.marketOpen) {
    return snap.print.fresh
      ? { tone: "live", text: `Live · updated ${ago(age)} ago` }
      : { tone: "late", text: `Late · last price ${ago(age)} ago` };
  }
  // NYSE is trading but the keeper hasn't relayed a price since the close.
  if (isRegularOpen(new Date(now))) return { tone: "late", text: "Waiting for the keeper" };
  return { tone: "frozen", text: "Frozen at the close" };
}

const BADGE: Record<Feed["tone"], string> = {
  live: "border-primary/60 text-primary",
  late: "border-warn/60 text-warn",
  frozen: "border-border text-muted",
};

export function StatusBanner({ snap, now, mid, gapBps }: { snap: Snapshot | null; now: number; mid: number; gapBps: number }) {
  if (!snap) {
    return <div className="mt-5 rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">Reading the market…</div>;
  }
  const open = snap.marketOpen;
  const feed = feedStatus(snap, now);
  const nOpen = nextOpen(new Date(now));
  const nClose = nextClose(new Date(now));
  return (
    <div className={`mt-5 rounded-xl border px-4 py-4 ${open ? "border-primary/50 bg-primary/10" : "border-down/50 bg-down/10"}`} role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-lg font-medium">
          {open ? "Market open" : "Market closed"}
          <span className="font-mono text-base text-muted">tAAPL</span>
          <span className={`rounded-full border px-2 py-0.5 font-mono text-xs font-normal ${BADGE[feed.tone]}`}>
            {feed.tone === "live" ? <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" /> : null}
            {feed.text}
          </span>
        </p>
        <p className="font-mono text-2xl">{usd(mid)}</p>
      </div>
      <p className="mt-1 text-sm text-muted">
        {open ? (
          <>
            Official price {usd(snap.print.cents)} from {snap.print.label}.
            {nClose ? ` Closes ${nyWhen(nClose)}.` : ""}
            {!snap.print.fresh ? " The price feed is late, so minting is paused." : ""}
          </>
        ) : feed.tone === "late" ? (
          <>
            The real market is trading, but this one still shows the last close, {usd(snap.closeCents)}, until the keeper
            relays a new price. You can trade here meanwhile: this market is{" "}
            <span className={gapBps >= 0 ? "text-primary" : "text-down"}>{pct(gapBps, true)}</span> from the close.
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
