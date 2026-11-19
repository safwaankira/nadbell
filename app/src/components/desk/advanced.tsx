import { useState } from "react";
import { chain } from "@/lib/chain/config";
import { useMarket, type Side, type Snapshot } from "@/lib/chain/market";
import { fmtShares, usd } from "./format";
import { Field } from "./field";

export function Advanced({
  snap,
  busy,
  connected,
  isIssuer,
}: {
  snap: Snapshot | null;
  busy: string | null;
  connected: boolean;
  isIssuer: boolean;
}) {
  const m = useMarket.getState();
  const [side, setSide] = useState<Side>("buy");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [mintQty, setMintQty] = useState("1");
  const [printInput, setPrintInput] = useState("");
  const toLots = (s: string) => BigInt(Math.round(Number(s) * 100) || 0);
  const fresh = snap?.print.fresh ?? false;

  return (
    <details className="mt-3 rounded-2xl border border-border bg-surface p-6">
      <summary className="title-3">Advanced: limit orders, mint and redeem, how it works</summary>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const cents = Math.round(Number(price) * 100);
            const lots = toLots(qty);
            if (cents > 0 && lots > 0n) void m.place(side, cents, lots);
          }}
        >
          <h3 className="title-4">Limit order</h3>
          <p className="caption-5 mt-1 text-muted">
            Whatever doesn't match waits on the book until filled or cancelled.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`btn button-sm ${side === s ? (s === "buy" ? "bg-primary text-fg" : "bg-down text-fg") : "border border-border text-muted hover:text-fg"}`}
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
          <button
            type="submit"
            disabled={!connected || !!busy}
            className="btn button-sm mt-2 w-full bg-fg text-bg hover:bg-fg/90"
          >
            Place limit {side}
          </button>
          {snap?.me && snap.me.orders.length > 0 ? (
            <ul className="caption-5 mt-3 space-y-1 font-mono">
              {snap.me.orders.map((o) => (
                <li key={String(o.id)} className="flex items-center justify-between gap-2">
                  <span className={o.isBuy ? "text-up" : "text-down"}>
                    {o.isBuy ? "buy" : "sell"} {fmtShares(o.lots)} @ {usd(o.price)}
                  </span>
                  <button
                    type="button"
                    className="btn caption-4 border border-border py-1 hover:border-muted"
                    disabled={!!busy}
                    onClick={() => void m.cancel(o.id)}
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>

        <div>
          <h3 className="title-4">Mint and redeem</h3>
          <p className="caption-5 mt-1 text-muted">
            Like a real issuer, the vault creates or retires tAAPL at the official price ± 0.5%,
            only while the market is open. Vault backing:{" "}
            {snap?.backing.ratioBps ? `${(snap.backing.ratioBps / 10_000).toFixed(2)}x` : "—"}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Field label="Shares" value={mintQty} onChange={setMintQty} />
            <button
              type="button"
              className="btn button-sm self-end bg-primary text-fg hover:bg-primary/90"
              disabled={!fresh || !connected || !!busy}
              onClick={() => void m.mint(toLots(mintQty))}
            >
              Mint
            </button>
            <button
              type="button"
              className="btn button-sm self-end border border-border hover:border-muted"
              disabled={!fresh || !connected || !!busy}
              onClick={() => void m.redeem(toLots(mintQty))}
            >
              Redeem
            </button>
          </div>
          {!fresh ? (
            <p className="caption-5 mt-2 text-muted">Closed until the market reopens.</p>
          ) : null}

          <h3 className="title-4 mt-6">How it works</h3>
          <ul className="caption-5 mt-2 list-disc space-y-2 pl-4 text-muted">
            <li>
              A keeper relays Alpaca's free IEX price every few minutes while NYSE is open, then
              rings the closing bell.
            </li>
            <li>
              The order book is fully onchain on {chain.name} and never closes. Best price first,
              then first come.
            </li>
            <li>
              A bot keeps a few quotes on the book. On weekends it follows the last trade here, so
              your trades move the price.
            </li>
            <li>
              At the reopen, every call and this market's last price are scored against the real
              open.
            </li>
            <li>
              tAAPL uses a display multiplier for dividends and splits (ERC-8056 draft), like
              Robinhood's stock tokens. Display multiplier now:{" "}
              {snap ? snap.multiplier.toFixed(4) : "—"}.
            </li>
          </ul>
        </div>
      </div>

      {isIssuer ? (
        <div className="mt-6 border-t border-border pt-6">
          <h3 className="title-4">Keeper controls</h3>
          <p className="caption-5 mt-1 text-muted">
            The scheduled keeper does this automatically. Use these only to test.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Field label="Price $" value={printInput} onChange={setPrintInput} />
            <button
              type="button"
              className="btn button-sm self-end border border-border hover:border-muted"
              disabled={!!busy || !printInput}
              onClick={() => void m.pushPrint(Math.round(Number(printInput) * 100))}
            >
              Push price (opens market)
            </button>
            <button
              type="button"
              className="btn button-sm self-end border border-border hover:border-muted"
              disabled={!!busy || !snap?.marketOpen}
              onClick={() => void m.closeMarket()}
            >
              Ring closing bell
            </button>
          </div>
        </div>
      ) : null}
    </details>
  );
}
