import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { addresses, addressUrl, chain, tokenToShares } from "@/lib/chain/config";
import { useMarket, type Level, type Recap, type Side, type Snapshot } from "@/lib/chain/market";
import { nextClose, nextOpen } from "@/lib/nyse";

const MON_FAUCET = "https://faucet.monad.xyz";

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (dollars: number) =>
  `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtShares = (lots: number) => (lots / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pct = (bps: number, sign = false) => `${sign && bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

function ago(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function until(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

const nyWhen = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) +
  " ET";

/** Walk the asks to estimate what $X buys (up to 1% above the best offer, like the contract call). */
function estimateBuy(asks: Level[], dollars: number) {
  const limit = asks[0] ? Math.ceil(asks[0].price * 1.01) : 0;
  let left = dollars;
  let lots = 0;
  let spent = 0;
  for (const l of asks) {
    if (l.price > limit || left <= 0) break;
    const can = Math.min(l.lots, Math.floor((left * 10_000) / l.price));
    lots += can;
    spent += (can * l.price) / 10_000;
    left -= (can * l.price) / 10_000;
  }
  return { lots, avg: lots ? (spent * 10_000) / lots : 0 };
}

function estimateSell(bids: Level[], lotsWanted: number) {
  const limit = bids[0] ? Math.floor(bids[0].price * 0.99) : 0;
  let left = lotsWanted;
  let got = 0;
  let lots = 0;
  for (const l of bids) {
    if (l.price < limit || left <= 0) break;
    const n = Math.min(l.lots, left);
    lots += n;
    got += (n * l.price) / 10_000;
    left -= n;
  }
  return { lots, dollars: got };
}

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

// ---------------------------------------------------------------- status

function StatusBanner({ snap, now, mid, gapBps }: { snap: Snapshot | null; now: number; mid: number; gapBps: number }) {
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

// ---------------------------------------------------------------- onboarding

function Onboarding({ snap, account, busy }: { snap: Snapshot | null; account: string | null; busy: string | null }) {
  const m = useMarket.getState();
  const hasMon = !!snap?.me && snap.me.mon > 0n;
  const hasFunds = !!snap?.me && (snap.me.usdc > 0n || snap.me.stock > 0n);
  const steps = [
    {
      done: !!account,
      title: "Connect a wallet",
      body: `MetaMask, Rabby or Phantom on ${chain.name}. Nadbell adds the network for you.`,
      action: (
        <button type="button" className="h-11 rounded-lg bg-fg px-4 text-sm font-medium text-bg" onClick={() => void m.connect()}>
          Connect
        </button>
      ),
    },
    {
      done: hasMon,
      title: "Get test MON for gas",
      body: "Free from the Monad faucet. A little covers hundreds of trades.",
      action: (
        <a className="flex h-11 items-center rounded-lg border border-border px-4 text-sm" href={MON_FAUCET} target="_blank" rel="noreferrer">
          Open faucet
        </a>
      ),
    },
    {
      done: hasFunds,
      title: "Get test dollars",
      body: "5,000 tUSDC per tap. No approvals needed after this.",
      action: (
        <button
          type="button"
          className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-fg disabled:opacity-40"
          disabled={!account || !hasMon || !!busy}
          onClick={() => void m.faucet()}
        >
          Get $5,000
        </button>
      ),
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">Start in three steps</h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={`flex flex-col gap-2 rounded-lg border p-3 ${i === current ? "border-primary/70" : "border-border"} ${s.done ? "opacity-60" : ""}`}
          >
            <p className="text-sm font-medium">
              <span className="mr-2 font-mono text-muted">{s.done ? "✓" : i + 1}</span>
              {s.title}
            </p>
            <p className="text-xs text-muted">{s.body}</p>
            {!s.done && i === current ? <div className="mt-auto">{s.action}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- trade

function TradeBox({ snap, busy, connected }: { snap: Snapshot | null; busy: string | null; connected: boolean }) {
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

// ---------------------------------------------------------------- call the open

function CallTheOpen({ snap, busy, connected, mid, now }: { snap: Snapshot; busy: string | null; connected: boolean; mid: number; now: number }) {
  const m = useMarket.getState();
  const [price, setPrice] = useState("");
  const mine = snap.calls.mine;
  const nOpen = nextOpen(new Date(now));
  const cents = Math.round((Number(price) || 0) * 100);
  const vsClose = cents && snap.closeCents ? Math.round(((cents - snap.closeCents) / snap.closeCents) * 10_000) : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">Call the open</h2>
      <p className="mt-1 text-sm text-muted">
        Where will AAPL open{nOpen ? ` ${nyWhen(nOpen)}` : ""}? Free, no money at stake. Scored against the real open.
      </p>
      <label className="mt-4 block rounded-lg border border-border px-3 py-2">
        <span className="text-xs text-muted">Your call</span>
        <div className="flex items-baseline gap-1 font-mono text-2xl">
          <span className="text-muted">$</span>
          <input
            className="w-full bg-transparent outline-none"
            inputMode="decimal"
            placeholder={(mid / 100).toFixed(2)}
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
          />
        </div>
      </label>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <button type="button" className="h-9 rounded-full border border-border px-3" onClick={() => setPrice((snap.closeCents / 100).toFixed(2))}>
          Close {usd(snap.closeCents)}
        </button>
        <button type="button" className="h-9 rounded-full border border-border px-3" onClick={() => setPrice((mid / 100).toFixed(2))}>
          This market {usd(mid)}
        </button>
      </div>
      {cents ? <p className="mt-2 text-sm text-muted">{pct(vsClose, true)} vs the close</p> : null}
      <button
        type="button"
        className="mt-3 h-12 w-full rounded-lg bg-fg text-base font-medium text-bg disabled:opacity-40"
        disabled={!connected || !!busy || !cents}
        onClick={() => void m.callOpen(cents)}
      >
        {!connected ? "Connect a wallet to call it" : mine ? "Change my call" : "Lock my call"}
      </button>
      <p className="mt-2 text-sm text-muted">
        {mine ? `Your call: ${usd(mine)}. ` : ""}
        {snap.calls.count} {snap.calls.count === 1 ? "call" : "calls"} so far this session.
      </p>
      <Leaderboard snap={snap} />
    </div>
  );
}

function RecapCard({ snap, account }: { snap: Snapshot | null; account: string | null }) {
  const r: Recap | undefined = snap?.recaps[0];
  if (!snap) return <div className="rounded-xl border border-border bg-surface p-4" />;
  if (!r) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Call the open</h2>
        <p className="mt-2 text-sm text-muted">
          When the market closes, come back and call where AAPL will reopen. After the bell, this card shows how the
          calls and this market did against the real open.
        </p>
      </div>
    );
  }
  const gap = r.openCents - r.closeCents;
  const caught = r.bookCents && gap ? Math.round(((r.bookCents - r.closeCents) / gap) * 100) : null;
  const meIdx = account ? r.calls.findIndex((c) => c.player.toLowerCase() === account.toLowerCase()) : -1;
  const bookErr = r.bookCents ? Math.round((Math.abs(r.bookCents - r.openCents) * 10_000) / r.openCents) : null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">Last reopen</h2>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Fig label="Close" value={usd(r.closeCents)} />
        <Fig label="This market said" value={r.bookCents ? usd(r.bookCents) : "no trades"} />
        <Fig label="Real open" value={usd(r.openCents)} strong />
      </div>
      <p className="mt-3 text-sm">
        {caught != null
          ? caught >= 0
            ? `While the market was shut, trading here caught ${Math.min(caught, 999)}% of the move${bookErr != null ? `, ending ${pct(bookErr)} from the open` : ""}.`
            : "Trading here guessed the wrong direction this time."
          : gap === 0
            ? "It opened exactly at the close."
            : "No trades happened here while the market was closed."}
      </p>
      <p className="mt-1 text-sm text-muted">
        {r.calls.length} {r.calls.length === 1 ? "call" : "calls"}
        {r.calls[0] ? `; the closest was ${pct(r.calls[0].errBps)} off` : ""}.
        {meIdx >= 0 ? ` Yours: ${usd(r.calls[meIdx].cents)}, ${pct(r.calls[meIdx].errBps)} off, #${meIdx + 1}.` : ""}
      </p>
      <Leaderboard snap={snap} />
    </div>
  );
}

function Fig({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-2 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-mono text-sm ${strong ? "text-fg" : "text-muted"}`}>{value}</p>
    </div>
  );
}

function Leaderboard({ snap }: { snap: Snapshot }) {
  const account = useMarket((s) => s.account)?.toLowerCase();
  if (!snap.leaders.length) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <h3 className="text-xs text-muted">Best callers, last {Math.min(8, snap.recaps.length)} reopens (average miss)</h3>
      <ol className="mt-2 space-y-1 font-mono text-xs">
        {snap.leaders.slice(0, 5).map((l, i) => (
          <li key={l.player} className={`flex justify-between ${l.player.toLowerCase() === account ? "text-primary" : ""}`}>
            <span>
              {i + 1}. {short(l.player)}
              {l.player.toLowerCase() === account ? " (you)" : ""}
            </span>
            <span>
              {pct(l.avgErrBps)} · {l.sessions}×
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- chart + book

function PriceChart({ snap, refCents, mid, up }: { snap: Snapshot | null; refCents: number; mid: number; up: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  const series = useMemo(() => {
    const t = snap?.trades.slice().reverse() ?? [];
    const pts = t.map((x, i) => ({ i, px: x.price }));
    if (pts.length === 0 && refCents) return [{ i: 0, px: refCents }, { i: 1, px: mid }];
    return [...pts, { i: pts.length, px: mid }];
  }, [snap?.trades, refCents, mid]);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Trades here vs the {snap?.marketOpen ? "official price" : "close"}</h2>
        <span className="font-mono text-xs text-muted">dashed = {snap?.marketOpen ? "official" : "close"}</span>
      </div>
      <div className="h-44">
        {on && snap ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#2e2648" vertical={false} />
              <YAxis
                domain={[(d: number) => Math.min(d, refCents) - 40, (d: number) => Math.max(d, refCents) + 40]}
                tickFormatter={(v: number) => (v / 100).toFixed(2)}
                width={56}
                stroke="#a99bc4"
                tick={{ fill: "#a99bc4", fontSize: 11 }}
              />
              <ReferenceLine y={refCents} stroke="#a99bc4" strokeDasharray="4 4" />
              <Line type="stepAfter" dataKey="px" stroke={up ? "#6E54FF" : "#A0055D"} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : null}
      </div>
    </div>
  );
}

function BookPanel({ snap, now }: { snap: Snapshot | null; now: number }) {
  const asks = (snap?.asks ?? []).slice(0, 4).reverse();
  const bids = (snap?.bids ?? []).slice(0, 4);
  const max = Math.max(1, ...asks.map((r) => r.lots), ...bids.map((r) => r.lots));
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">Order book</h2>
      <p className="mt-1 text-xs text-muted">Sellers on top, buyers below. Shares at each price.</p>
      <div className="mt-2">
        <BookRows rows={asks} max={max} tone="down" />
        <div className="my-1 border-t border-border" />
        <BookRows rows={bids} max={max} tone="up" />
      </div>
      <h3 className="mt-4 text-xs text-muted">Latest trades</h3>
      <ul className="mt-1 font-mono text-xs">
        {(snap?.trades ?? []).slice(0, 5).map((t, i) => (
          <li key={`${t.time}-${i}`} className="flex justify-between py-0.5">
            <span className={t.takerBuy ? "text-primary" : "text-down"}>{usd(t.price)}</span>
            <span>{fmtShares(t.lots)}</span>
            <span className="text-muted">{ago(now / 1000 - t.time)} ago</span>
          </li>
        ))}
        {snap && snap.trades.length === 0 ? <li className="text-muted">No trades yet.</li> : null}
      </ul>
    </div>
  );
}

function BookRows({ rows, max, tone }: { rows: Level[]; max: number; tone: "up" | "down" }) {
  const bar = tone === "up" ? "bg-primary/25" : "bg-down/25";
  return (
    <ul className="font-mono text-sm">
      {rows.map(({ price, lots }) => (
        <li key={price} className="relative flex justify-between py-1">
          <span className={`absolute inset-y-0 right-0 ${bar}`} style={{ width: `${Math.max(8, (lots / max) * 100)}%` }} />
          <span className={`relative ${tone === "up" ? "text-primary" : "text-down"}`}>{usd(price)}</span>
          <span className="relative text-fg">{fmtShares(lots)}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- advanced

function Advanced({ snap, busy, connected, isIssuer }: { snap: Snapshot | null; busy: string | null; connected: boolean; isIssuer: boolean }) {
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
          <p className="mt-1 text-xs text-muted">Name your price. Whatever doesn't match waits on the book until filled or cancelled.</p>
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

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-24 flex-1 rounded-lg border border-border px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <input
        className="mt-1 w-full bg-transparent font-mono text-base outline-none"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
      />
    </label>
  );
}
