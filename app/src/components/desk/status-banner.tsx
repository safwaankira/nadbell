import type { Snapshot } from "@/lib/chain/market";
import { isRegularOpen, nextClose, nextOpen } from "@/lib/nyse";
import { ago, nyWhen, pct, until, usd } from "./format";

type Feed = { tone: "live" | "late" | "frozen"; text: string };

/** One-glance answer to "can I trust this price right now?". */
function feedStatus(snap: Snapshot, now: number): Feed {
  const age = now / 1000 - snap.print.time;
  if (snap.marketOpen) {
    return snap.print.fresh
      ? { tone: "live", text: `Live, updated ${ago(age)} ago` }
      : { tone: "late", text: `Late, last price ${ago(age)} ago` };
  }
  // NYSE is trading but the keeper hasn't relayed a price since the close.
  if (isRegularOpen(new Date(now))) return { tone: "late", text: "Waiting for the keeper" };
  return { tone: "frozen", text: "Frozen at the close" };
}

const BADGE: Record<Feed["tone"], string> = {
  live: "border-primary/60 text-up",
  late: "border-warn/60 text-warn",
  frozen: "border-border text-muted",
};

/**
 * The payoff, first: the oracle's frozen price next to the price this book is trading at,
 * with the gap between them. That gap is the whole idea of Nadbell.
 */
export function StatusBanner({
  snap,
  now,
  mid,
  gapBps,
}: {
  snap: Snapshot | null;
  now: number;
  mid: number;
  gapBps: number;
}) {
  const open = snap?.marketOpen ?? false;
  const feed = snap ? feedStatus(snap, now) : null;
  const nOpen = nextOpen(new Date(now));
  const nClose = nextClose(new Date(now));
  const oracle = snap ? (open ? snap.print.cents : snap.closeCents) : 0;

  return (
    <section className="mt-12" aria-labelledby="hero-title" role="status">
      <p className="caption-4 flex flex-wrap items-center gap-2 text-muted">
        <span className={open ? "text-up" : "text-fg"}>
          {snap ? (open ? "NYSE open" : "NYSE closed") : "Reading the market…"}
        </span>
        {snap && !open && nOpen ? (
          <span>
            Reopens {nyWhen(nOpen)}, in {until(nOpen.getTime() - now)}
          </span>
        ) : null}
        {snap && open && nClose ? <span>Closes {nyWhen(nClose)}</span> : null}
      </p>
      <h1 id="hero-title" className="heading-3 mt-3 max-w-[680px]">
        Trade tAAPL after
        <br />
        the closing bell
      </h1>
      <p className="body-3 mt-3 max-w-[680px] text-muted">
        At the NYSE close the oracle freezes. This onchain order book keeps trading, so its price
        shows where AAPL might reopen.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
            <p className="title-4 text-muted">{open ? "Official price" : "Oracle price"}</p>
            {feed ? (
              <span
                className={`caption-4 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${BADGE[feed.tone]}`}
              >
                {feed.tone === "live" ? (
                  <span className="size-1.5 animate-pulse rounded-full bg-up" aria-hidden="true" />
                ) : null}
                {feed.text}
              </span>
            ) : null}
          </div>
          <p className="mt-3 font-mono text-5xl leading-none font-medium tracking-tight">
            {snap ? usd(oracle) : "…"}
          </p>
          <p className="caption-5 mt-3 text-muted">
            {snap ? (open ? `From ${snap.print.label}` : `Last relayed price at the close`) : " "}
          </p>
        </div>

        <div className="rounded-2xl border border-primary/60 bg-surface p-6">
          <p className="title-4 flex min-h-6 items-center text-muted">Nadbell price</p>
          <p className="mt-3 font-mono text-5xl leading-none font-medium tracking-tight">
            {snap ? usd(mid) : "…"}
          </p>
          <p className="caption-5 mt-3 text-muted">
            {snap ? (
              <>
                <span className={`font-mono ${gapBps >= 0 ? "text-up" : "text-down"}`}>
                  {pct(gapBps, true)}
                </span>{" "}
                vs the {open ? "official price" : "close"}
              </>
            ) : (
              " "
            )}
          </p>
        </div>
      </div>

      {snap && open && !snap.print.fresh ? (
        <p className="body-6 mt-3 text-warn">The price feed is late, so minting is paused.</p>
      ) : null}
      {snap && !open && feed?.tone === "late" ? (
        <p className="body-6 mt-3 text-warn">
          NYSE is trading, but the keeper hasn't relayed a new price yet.
        </p>
      ) : null}
    </section>
  );
}
