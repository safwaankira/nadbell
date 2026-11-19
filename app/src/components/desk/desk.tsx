import { useEffect, useState } from "react";
import { addresses, addressUrl, chain } from "@/lib/chain/config";
import { useMarket } from "@/lib/chain/market";
import { MON_FAUCET, short } from "./format";
import { StatusBanner } from "./status-banner";
import { Onboarding } from "./onboarding";
import { TradeBox } from "./trade-box";
import { CallTheOpen } from "./call-the-open";
import { RecapCard } from "./recap-card";
import { PriceChart } from "./price-chart";
import { BookPanel } from "./book-panel";
import { Advanced } from "./advanced";

export function Desk() {
  const { account, snap, error, busy, activity } = useMarket();
  const m = useMarket.getState();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void useMarket.getState().refresh();
    const poll = setInterval(() => void useMarket.getState().refresh(), 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const bid = snap?.bids[0]?.price ?? null;
  const ask = snap?.asks[0]?.price ?? null;
  const ref = snap?.marketOpen ? snap.print.cents : (snap?.closeCents ?? 0);
  const mid = bid != null && ask != null ? Math.round((bid + ask) / 2) : snap?.lastPrice || ref;
  const gapBps = ref ? Math.round(((mid - ref) / ref) * 10_000) : 0;
  const isIssuer = !!account && !!snap && account.toLowerCase() === snap.gateOwner.toLowerCase();

  const needsSetup = !account || !snap?.me || snap.me.mon === 0n || (snap.me.usdc === 0n && snap.me.stock === 0n);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Nadbell</h1>
          <p className="mt-1 text-sm text-muted">The price freezes at the close. This market doesn't.</p>
        </div>
        {account ? (
          <span className="rounded-full border border-border px-4 py-2 font-mono text-sm">
            {short(account)}
            {isIssuer ? " · keeper" : ""}
          </span>
        ) : (
          <button type="button" className="h-11 rounded-full bg-fg px-5 text-sm font-medium text-bg" onClick={() => void m.connect()}>
            Connect wallet
          </button>
        )}
      </header>

      <StatusBanner snap={snap} now={now} mid={mid} gapBps={gapBps} />

      {error ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-down/60 bg-down/15 px-4 py-3 text-sm" role="alert">
          <span>
            {error}{" "}
            {/MON/.test(error) ? (
              <a className="underline" href={MON_FAUCET} target="_blank" rel="noreferrer">
                Open the faucet
              </a>
            ) : null}
          </span>
          <button type="button" className="text-muted" aria-label="Dismiss" onClick={m.clearError}>
            ✕
          </button>
        </div>
      ) : null}

      {needsSetup && addresses ? <Onboarding snap={snap} account={account} busy={busy} /> : null}

      <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <TradeBox snap={snap} busy={busy} connected={!!account} />
        {snap?.marketOpen === false ? (
          <CallTheOpen snap={snap} busy={busy} connected={!!account} mid={mid} now={now} />
        ) : (
          <RecapCard snap={snap} account={account} />
        )}
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
        <PriceChart snap={snap} refCents={ref} mid={mid} up={gapBps >= 0} />
        <BookPanel snap={snap} now={now} />
      </section>

      {activity.length ? (
        <section className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">Your activity</h2>
          <ul className="mt-2 space-y-2">
            {activity.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-border pb-2 text-sm last:border-0">
                <span className={`font-mono text-xs ${e.ok ? "text-primary" : "text-down"}`}>{e.title}</span>
                <span>{e.detail}</span>
                {e.url ? (
                  <a className="text-xs text-muted underline" href={e.url} target="_blank" rel="noreferrer">
                    view tx
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Advanced snap={snap} busy={busy} connected={!!account} isIssuer={isIssuer} />

      {addresses ? (
        <p className="mt-6 font-mono text-xs leading-relaxed text-muted">
          {chain.name} contracts:{" "}
          {(["book", "vault", "gate", "openCall", "stock", "usdc"] as const).map((k) => {
            const url = addressUrl(addresses![k]);
            return (
              <span key={k} className="mr-3 inline-block">
                {k}{" "}
                {url ? (
                  <a className="underline" href={url} target="_blank" rel="noreferrer">
                    {short(addresses![k])}
                  </a>
                ) : (
                  short(addresses![k])
                )}
              </span>
            );
          })}
        </p>
      ) : null}

      <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted">
        Testnet demo only. tAAPL and tUSDC are mock tokens with no value. They are not issued by or affiliated with
        Apple, Nasdaq, Alpaca, Robinhood, Kraken, Dinari, Ondo or Anchored, and represent no ownership, claim or economic
        right in any security. Prices come from Alpaca's free IEX feed, relayed by a single keeper. Not investment advice.
      </p>
    </main>
  );
}
