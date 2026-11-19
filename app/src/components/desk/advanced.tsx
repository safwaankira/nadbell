import { useState } from "react";
import { chain } from "@/lib/chain/config";
import { useMarket, type Side, type Snapshot } from "@/lib/chain/market";
import { fmtShares, usd } from "./format";
import { Field } from "./field";

export function Advanced({ snap, busy, connected, isIssuer }: { snap: Snapshot | null; busy: string | null; connected: boolean; isIssuer: boolean }) {
  const m = useMarket.getState();
  const [side, setSide] = useState<Side>("buy");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [mintQty, setMintQty] = useState("1");
  const [printInput, setPrintInput] = useState("");
  const toLots = (s: string) => BigInt(Math.round(Number(s) * 100) || 0);
  const fresh = snap?.print.fresh ?? false;

  return (
    <details className="mt-4 rounded-xl border border-border bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium">Advanced: limit orders, mint and redeem, how it works</summary>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const cents = Math.round(Number(price) * 100);
            const lots = toLots(qty);
            if (cents > 0 && lots > 0n) void m.place(side, cents, lots);
          }}
        >
          <h3 className="text-sm font-medium">Limit order</h3>
          <p className="mt-1 text-xs text-muted">Whatever doesn't match waits on the book until filled or cancelled.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`h-11 rounded-lg text-sm font-medium ${side === s ? (s === "buy" ? "bg-primary text-fg" : "bg-down text-fg") : "border border-border"}`}
                onClick={() => {
                  setSide(s);
                  const p = s === "buy" ? snap?.bids[0]?.price : snap?.asks[0]?.price;
                  if (p) setPrice((p / 100).toFixed(2));
                }}
              >
                {s === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Price" value={price} onChange={setPrice} />
            <Field label="Shares" value={qty} onChange={setQty} />
          </div>
          <button type="submit" disabled={!connected || !!busy} className="mt-2 h-11 w-full rounded-lg bg-fg text-sm font-medium text-bg disabled:opacity-40">
            Place limit {side}
          </button>
          {snap?.me && snap.me.orders.length > 0 ? (
            <ul className="mt-3 space-y-1 font-mono text-xs">
              {snap.me.orders.map((o) => (
                <li key={String(o.id)} className="flex items-center justify-between gap-2">
                  <span className={o.isBuy ? "text-primary" : "text-down"}>
                    {o.isBuy ? "buy" : "sell"} {fmtShares(o.lots)} @ {usd(o.price)}
                  </span>
                  <button type="button" className="h-9 rounded-lg border border-border px-2 disabled:opacity-40" disabled={!!busy} onClick={() => void m.cancel(o.id)}>
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>

        <div>
          <h3 className="text-sm font-medium">Mint and redeem</h3>
          <p className="mt-1 text-xs text-muted">
            Like a real issuer, the vault creates or retires tAAPL at the official price ± 0.5%, only while the market is
            open. Vault backing: {snap?.backing.ratioBps ? `${(snap.backing.ratioBps / 10_000).toFixed(2)}x` : "—"}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Field label="Shares" value={mintQty} onChange={setMintQty} />
            <button type="button" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-fg disabled:opacity-40" disabled={!fresh || !connected || !!busy} onClick={() => void m.mint(toLots(mintQty))}>
              Mint
            </button>
            <button type="button" className="h-11 rounded-lg border border-border px-4 text-sm disabled:opacity-40" disabled={!fresh || !connected || !!busy} onClick={() => void m.redeem(toLots(mintQty))}>
              Redeem
            </button>
          </div>
          {!fresh ? <p className="mt-2 text-xs text-muted">Closed until the market reopens.</p> : null}

          <h3 className="mt-5 text-sm font-medium">How it works</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted">
            <li>A keeper relays Alpaca's free IEX price every few minutes while NYSE is open, then rings the closing bell.</li>
            <li>The order book is fully onchain on {chain.name} and never closes. Best price first, then first come.</li>
            <li>A bot keeps a few quotes on the book. On weekends it follows the last trade here, so your trades move the price.</li>
            <li>At the reopen, every call and this market's last price are scored against the real open.</li>
            <li>tAAPL uses a display multiplier for dividends and splits (ERC-8056 draft), like Robinhood's stock tokens. Display multiplier now: {snap ? snap.multiplier.toFixed(4) : "—"}.</li>
          </ul>
        </div>
      </div>

      {isIssuer ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Keeper controls</h3>
          <p className="mt-1 text-xs text-muted">The scheduled keeper does this automatically. Use these only to test.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Field label="Price $" value={printInput} onChange={setPrintInput} />
            <button
              type="button"
              className="h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40"
              disabled={!!busy || !printInput}
              onClick={() => void m.pushPrint(Math.round(Number(printInput) * 100))}
            >
              Push price (opens market)
            </button>
            <button type="button" className="h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40" disabled={!!busy || !snap?.marketOpen} onClick={() => void m.closeMarket()}>
              Ring closing bell
            </button>
          </div>
        </div>
      ) : null}
    </details>
  );
}
