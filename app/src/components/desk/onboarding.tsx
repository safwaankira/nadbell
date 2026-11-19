import { chain } from "@/lib/chain/config";
import { useMarket, type Snapshot } from "@/lib/chain/market";
import { MON_FAUCET } from "./format";

export function Onboarding({ snap, account, busy }: { snap: Snapshot | null; account: string | null; busy: string | null }) {
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
            {/* The faucet needs no connection, so offer it from the start rather than waiting for step 1. */}
            {!s.done && (i === current || s.title === "Get test MON for gas") ? <div className="mt-auto">{s.action}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
