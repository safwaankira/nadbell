import { useMemo, useState } from "react";
import { tokenToShares } from "@/lib/chain/config";
import { useMarket, type Side, type Snapshot } from "@/lib/chain/market";
import { estimateBuy, estimateSell } from "./estimate";
import { fmtShares, money, usd } from "./format";

const chip = "btn caption-4 rounded-full border border-border px-3 py-1.5 hover:border-muted";

export function TradeBox({
  snap,
  busy,
  connected,
}: {
  snap: Snapshot | null;
  busy: string | null;
  connected: boolean;
}) {
  const m = useMarket.getState();
  const [side, setSide] = useState<Side>("buy");
  const [dollars, setDollars] = useState("100");
  const [shares, setShares] = useState("");

  const owned = snap?.me ? tokenToShares(snap.me.stock) : 0;
  const cash = snap?.me ? Number(snap.me.usdc) / 1e6 : 0;
  const buyEst = useMemo(
    () => estimateBuy(snap?.asks ?? [], Number(dollars) || 0),
    [snap?.asks, dollars],
  );
  const sellLots = Math.floor((Number(shares) || 0) * 100 + 1e-9);
  const sellEst = useMemo(() => estimateSell(snap?.bids ?? [], sellLots), [snap?.bids, sellLots]);

  const tooMuch = side === "buy" ? (Number(dollars) || 0) > cash : (Number(shares) || 0) > owned;
  const canSubmit =
    connected &&
    !busy &&
    !tooMuch &&
    (side === "buy" ? buyEst.lots > 0 : sellLots > 0 && sellEst.lots > 0);
  const tone = side === "buy" ? "bg-primary hover:bg-primary/90" : "bg-down hover:bg-down/90";

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="title-3">Trade tAAPL</h2>
        <div
          className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1"
          role="tablist"
          aria-label="Side"
        >
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              className={`btn button-sm rounded-md px-4 py-1.5 ${side === s ? (s === "buy" ? "bg-primary text-fg" : "bg-down text-fg") : "text-muted hover:text-fg"}`}
              onClick={() => setSide(s)}
            >
              {s === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
      </div>

      {side === "buy" ? (
        <>
          <label className="mt-6 block rounded-xl border border-border bg-surface-2 px-4 py-3 focus-within:border-muted">
            <span className="caption-4 text-muted">Amount in tUSDC</span>
            <div className="mt-1 flex items-baseline gap-1 font-mono text-3xl">
              <span className="text-faint">$</span>
              <input
                className="w-full bg-transparent outline-none"
                inputMode="decimal"
                value={dollars}
                onChange={(e) => setDollars(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
              />
            </div>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {[25, 100, 500].map((v) => (
              <button key={v} type="button" className={chip} onClick={() => setDollars(String(v))}>
                ${v}
              </button>
            ))}
            {cash > 0 ? (
              <button
                type="button"
                className={chip}
                onClick={() => setDollars(String(Math.floor(cash)))}
              >
                Max
              </button>
            ) : null}
          </div>
          <p className="body-6 mt-4 min-h-5 text-muted">
            {buyEst.lots > 0 ? (
              <>
                You get <span className="font-mono text-fg">≈ {fmtShares(buyEst.lots)} tAAPL</span>{" "}
                at <span className="font-mono text-fg">{usd(Math.round(buyEst.avg))}</span> each
              </>
            ) : snap && !snap.asks.length ? (
              "Nobody is selling right now."
            ) : null}
          </p>
        </>
      ) : (
        <>
          <label className="mt-6 block rounded-xl border border-border bg-surface-2 px-4 py-3 focus-within:border-muted">
            <span className="caption-4 text-muted">Shares of tAAPL</span>
            <input
              className="mt-1 w-full bg-transparent font-mono text-3xl outline-none placeholder:text-faint"
              inputMode="decimal"
              placeholder="0"
              value={shares}
              onChange={(e) => setShares(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={chip}
              disabled={!owned}
              onClick={() => setShares(String(owned))}
            >
              Sell all ({owned})
            </button>
          </div>
          <p className="body-6 mt-4 min-h-5 text-muted">
            {sellEst.lots > 0 ? (
              <>
                You get <span className="font-mono text-fg">≈ {money(sellEst.dollars)}</span> for{" "}
                <span className="font-mono text-fg">{fmtShares(sellEst.lots)} tAAPL</span>
                {sellEst.lots < sellLots ? ". The rest stays with you." : ""}
              </>
            ) : snap && !snap.bids.length ? (
              "Nobody is buying right now."
            ) : null}
          </p>
        </>
      )}

      <button
        type="button"
        className={`btn button-md mt-4 w-full text-fg ${tone}`}
        disabled={!canSubmit}
        onClick={() =>
          void (side === "buy" ? m.buyDollars(Number(dollars)) : m.sellShares(Number(shares)))
        }
      >
        {busy
          ? `${busy}…`
          : !connected
            ? "Connect a wallet to trade"
            : tooMuch
              ? "Not enough balance"
              : side === "buy"
                ? "Buy tAAPL"
                : "Sell tAAPL"}
      </button>
      <p className="caption-5 mt-3 text-faint">
        Fills at the best prices, never more than 1% past the top of the book. Anything unfilled
        comes back to you.
      </p>

      {snap?.me ? (
        <div className="mt-auto pt-6">
          <dl className="grid grid-cols-3 gap-3 border-t border-border pt-4 font-mono">
            <div>
              <dt className="caption-4 font-sans text-muted">tUSDC</dt>
              <dd className="body-6 mt-1">{money(cash)}</dd>
            </div>
            <div>
              <dt className="caption-4 font-sans text-muted">tAAPL</dt>
              <dd className="body-6 mt-1">{tokenToShares(snap.me.stockUI)}</dd>
            </div>
            <div>
              <dt className="caption-4 font-sans text-muted">Gas</dt>
              <dd className="body-6 mt-1">{(Number(snap.me.mon) / 1e18).toFixed(2)} MON</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
