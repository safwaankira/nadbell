import type { Recap, Snapshot } from "@/lib/chain/market";
import { pct, usd } from "./format";
import { Leaderboard } from "./leaderboard";

export function RecapCard({ snap, account }: { snap: Snapshot | null; account: string | null }) {
  const r: Recap | undefined = snap?.recaps[0];
  if (!snap) return <div className="rounded-2xl border border-border bg-surface p-6" />;
  if (!r) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="title-3">Call the open</h2>
        <p className="body-6 mt-2 text-muted">
          When the market closes, come back and call where AAPL will reopen. After the bell, this
          card shows how the calls and this market did against the real open.
        </p>
      </div>
    );
  }
  const gap = r.openCents - r.closeCents;
  const caught = r.bookCents && gap ? Math.round(((r.bookCents - r.closeCents) / gap) * 100) : null;
  const meIdx = account
    ? r.calls.findIndex((c) => c.player.toLowerCase() === account.toLowerCase())
    : -1;
  const bookErr = r.bookCents
    ? Math.round((Math.abs(r.bookCents - r.openCents) * 10_000) / r.openCents)
    : null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="title-3">Last reopen</h2>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Fig label="Close" value={usd(r.closeCents)} />
        <Fig label="This market said" value={r.bookCents ? usd(r.bookCents) : "no trades"} />
        <Fig label="Real open" value={usd(r.openCents)} strong />
      </div>
      <p className="body-6 mt-4">
        {caught != null
          ? caught >= 0
            ? `While the market was shut, trading here caught ${Math.min(caught, 999)}% of the move${bookErr != null ? `, ending ${pct(bookErr)} from the open` : ""}.`
            : "Trading here guessed the wrong direction this time."
          : gap === 0
            ? "It opened exactly at the close."
            : "No trades happened here while the market was closed."}
      </p>
      <p className="caption-5 mt-2 text-muted">
        {r.calls.length} {r.calls.length === 1 ? "call" : "calls"}
        {r.calls[0] ? `; the closest was ${pct(r.calls[0].errBps)} off` : ""}.
        {meIdx >= 0
          ? ` Yours: ${usd(r.calls[meIdx].cents)}, ${pct(r.calls[meIdx].errBps)} off, #${meIdx + 1}.`
          : ""}
      </p>
      <Leaderboard snap={snap} />
    </div>
  );
}

export function Fig({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`rounded-xl border bg-surface-2 p-3 ${strong ? "border-primary/60" : "border-border"}`}
    >
      <p className="caption-4 text-muted">{label}</p>
      <p className={`mt-1 font-mono text-base ${strong ? "text-fg" : "text-muted"}`}>{value}</p>
    </div>
  );
}
