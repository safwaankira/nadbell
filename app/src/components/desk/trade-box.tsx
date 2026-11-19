import { useMemo, useState } from "react";
import { tokenToShares } from "@/lib/chain/config";
import { useMarket, type Side, type Snapshot } from "@/lib/chain/market";
import { estimateBuy, estimateSell } from "./estimate";
import { fmtShares, money, usd } from "./format";

export function TradeBox({ snap, busy, connected }: { snap: Snapshot | null; busy: string | null; connected: boolean }) {
  const m = useMarket.getState();
  const [side, setSide] = useState<Side>("buy");
  const [dollars, setDollars] = useState("100");
  const [shares, setShares] = useState("");

  const owned = snap?.me ? tokenToShares(snap.me.stock) : 0;
  const cash = snap?.me ? Number(snap.me.usdc) / 1e6 : 0;
  const buyEst = useMemo(() => estimateBuy(snap?.asks ?? [], Number(dollars) || 0), [snap?.asks, dollars]);
  const sellLots = Math.floor((Number(shares) || 0) * 100 + 1e-9);
  const sellEst = useMemo(() => estimateSell(snap?.bids ?? [], sellLots), [snap?.bids, sellLots]);

  const tooMuch = side === "buy" ? (Number(dollars) || 0) > cash : (Number(shares) || 0) > owned;
  const canSubmit =
    connected && !busy && !tooMuch && (side === "buy" ? buyEst.lots > 0 : sellLots > 0 && sellEst.lots > 0);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="grid grid-cols-2 gap-2">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`h-11 rounded-lg text-sm font-medium ${side === s ? (s === "buy" ? "bg-primary text-fg" : "bg-down text-fg") : "border border-border"}`}
            onClick={() => setSide(s)}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {side === "buy" ? (
        <>
          <label className="mt-4 block rounded-lg border border-border px-3 py-2">
            <span className="text-xs text-muted">Amount in tUSDC</span>
            <div className="flex items-baseline gap-1 font-mono text-2xl">
              <span className="text-muted">$</span>
              <input
                className="w-full bg-transparent outline-none"
                inputMode="decimal"
                value={dollars}
                onChange={(e) => setDollars(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
              />
            </div>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {[25, 100, 500].map((v) => (
              <button key={v} type="button" className="h-9 rounded-full border border-border px-3 text-sm" onClick={() => setDollars(String(v))}>
                ${v}
              </button>
            ))}
            {cash > 0 ? (
              <button type="button" className="h-9 rounded-full border border-border px-3 text-sm" onClick={() => setDollars(String(Math.floor(cash)))}>
                Max
              </button>
            ) : null}
          </div>
          <p className="mt-3 text-sm text-muted">
            {buyEst.lots > 0
              ? `≈ ${fmtShares(buyEst.lots)} tAAPL at ${usd(Math.round(buyEst.avg))} each`
              : snap && !snap.asks.length
                ? "Nobody is selling right now."
                : "Enter an amount."}
          </p>
        </>
      ) : (
        <>
          <label className="mt-4 block rounded-lg border border-border px-3 py-2">
            <span className="text-xs text-muted">Shares of tAAPL</span>
            <input
              className="w-full bg-transparent font-mono text-2xl outline-none"
              inputMode="decimal"
              placeholder="0"
              value={shares}
              onChange={(e) => setShares(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="h-9 rounded-full border border-border px-3 text-sm disabled:opacity-40" disabled={!owned} onClick={() => setShares(String(owned))}>
              Sell all ({owned})
            </button>
          </div>
          <p className="mt-3 text-sm text-muted">
            {sellEst.lots > 0
              ? `≈ ${money(sellEst.dollars)} for ${fmtShares(sellEst.lots)} tAAPL${sellEst.lots < sellLots ? " (the rest stays with you)" : ""}`
              : snap && !snap.bids.length
                ? "Nobody is buying right now."
                : "Enter how many shares."}
          </p>
        </>
      )}

      <button
        type="button"
        className={`mt-3 h-12 w-full rounded-lg text-base font-medium disabled:opacity-40 ${side === "buy" ? "bg-primary text-fg" : "bg-down text-fg"}`}
        disabled={!canSubmit}
        onClick={() => void (side === "buy" ? m.buyDollars(Number(dollars)) : m.sellShares(Number(shares)))}
      >
        {busy ? `${busy}…` : !connected ? "Connect a wallet to trade" : tooMuch ? "Not enough balance" : side === "buy" ? "Buy tAAPL" : "Sell tAAPL"}
      </button>
      <p className="mt-2 text-xs text-muted">Fills right away at the best prices, never more than 1% past the top of the book. Anything unfilled comes straight back.</p>

      {snap?.me ? (
        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 font-mono text-sm">
          <div>
            <dt className="text-xs text-muted">tUSDC</dt>
            <dd>{money(cash)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">tAAPL</dt>
            <dd>{tokenToShares(snap.me.stockUI)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Gas</dt>
            <dd>{(Number(snap.me.mon) / 1e18).toFixed(2)} MON</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
