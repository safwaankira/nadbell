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

  const needsSetup =
    !account || !snap?.me || snap.me.mon === 0n || (snap.me.usdc === 0n && snap.me.stock === 0n);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-lg focus:bg-fg focus:px-3 focus:py-2 focus:text-bg"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <nav
          className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6"
          aria-label="Main"
        >
          <a href="/" className="flex items-center gap-2" aria-label="Nadbell home">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="title-2">Nadbell</span>
          </a>
          {account ? (
            <span className="caption-4 rounded-full border border-border px-3 py-1.5 font-mono">
              {short(account)}
              {isIssuer ? ", keeper" : ""}
            </span>
          ) : (
            <button
              type="button"
              className="btn button-sm bg-fg text-bg hover:bg-fg/90"
              onClick={() => void m.connect()}
            >
              Connect wallet
            </button>
          )}
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <StatusBanner snap={snap} now={now} mid={mid} gapBps={gapBps} />

        {error ? (
          <div
            className="body-6 mt-6 flex items-start justify-between gap-3 rounded-xl border border-down/60 bg-surface px-4 py-3"
            role="alert"
          >
            <span>
              {error}{" "}
              {/MON/.test(error) ? (
                <a className="underline" href={MON_FAUCET} target="_blank" rel="noreferrer">
                  Open the faucet
                </a>
              ) : null}
            </span>
            <button
              type="button"
              className="text-muted hover:text-fg"
              aria-label="Dismiss"
              onClick={m.clearError}
            >
              ✕
            </button>
          </div>
        ) : null}

        {needsSetup && addresses ? <Onboarding snap={snap} account={account} busy={busy} /> : null}

        <section className="mt-8 grid gap-3 lg:grid-cols-2" aria-label="Trade">
          <TradeBox snap={snap} busy={busy} connected={!!account} />
          {snap?.marketOpen === false ? (
            <CallTheOpen snap={snap} busy={busy} connected={!!account} mid={mid} now={now} />
          ) : (
            <RecapCard snap={snap} account={account} />
          )}
        </section>

        <section className="mt-3 grid gap-3 lg:grid-cols-[1.3fr_0.9fr]" aria-label="Market">
          <PriceChart snap={snap} refCents={ref} mid={mid} up={gapBps >= 0} />
          <BookPanel snap={snap} now={now} />
        </section>

        {activity.length ? (
          <section className="mt-3 rounded-2xl border border-border bg-surface p-6">
            <h2 className="title-3">Your activity</h2>
            <ul className="mt-3 space-y-2">
              {activity.map((e) => (
                <li
                  key={e.id}
                  className="body-6 flex flex-wrap items-baseline gap-x-2 border-b border-border pb-2 last:border-0"
                >
                  <span className={`font-mono ${e.ok ? "text-up" : "text-down"}`}>{e.title}</span>
                  <span>{e.detail}</span>
                  {e.url ? (
                    <a
                      className="text-muted underline hover:text-fg"
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view tx
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Advanced snap={snap} busy={busy} connected={!!account} isIssuer={isIssuer} />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl space-y-3 px-4 py-8 sm:px-6">
          {addresses ? (
            <p className="caption-5 font-mono text-muted">
              {chain.name} contracts:{" "}
              {(["book", "vault", "gate", "openCall", "stock", "usdc"] as const).map((k) => {
                const url = addressUrl(addresses![k]);
                return (
                  <span key={k} className="mr-3 inline-block">
                    {k}{" "}
                    {url ? (
                      <a
                        className="underline hover:text-fg"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
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
          <p className="caption-5 max-w-2xl text-faint">
            Testnet demo only. tAAPL and tUSDC are mock tokens with no value. They are not issued by
            or affiliated with Apple, Nasdaq, Alpaca, Robinhood, Kraken, Dinari, Ondo or Anchored,
            and represent no ownership, claim or economic right in any security. Prices come from
            Alpaca's free IEX feed, relayed by a single keeper. Not investment advice.
          </p>
          <p className="caption-5 text-faint">
            <a
              className="underline hover:text-fg"
              href="https://github.com/safwaankira/nadbell"
              target="_blank"
              rel="noreferrer"
            >
              Source on GitHub
            </a>
          </p>
        </div>
      </footer>
    </>
  );
}
