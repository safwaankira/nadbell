import { chain } from "@/lib/chain/config";
import { useMarket, type Snapshot } from "@/lib/chain/market";
import { MON_FAUCET } from "./format";

export function Onboarding({
  snap,
  account,
  busy,
}: {
  snap: Snapshot | null;
  account: string | null;
  busy: string | null;
}) {
  const m = useMarket.getState();
  const hasMon = !!snap?.me && snap.me.mon > 0n;
  const hasFunds = !!snap?.me && (snap.me.usdc > 0n || snap.me.stock > 0n);
  const steps = [
    {
      done: !!account,
      title: "Connect a wallet",
      body: `MetaMask, Rabby or Phantom on ${chain.name}. Nadbell adds the network for you.`,
      action: (
        <button
          type="button"
          className="btn button-sm bg-fg text-bg hover:bg-fg/90"
          onClick={() => void m.connect()}
        >
          Connect
        </button>
      ),
    },
    {
      done: hasMon,
      title: "Get test MON for gas",
      body: "Free from the Monad faucet.",
      action: (
        <a
          className="btn button-sm border border-border hover:border-muted"
          href={MON_FAUCET}
          target="_blank"
          rel="noreferrer"
        >
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
          className="btn button-sm bg-primary text-fg hover:bg-primary/90"
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
    <section
      className="mt-8 rounded-2xl border border-border bg-surface p-6"
      aria-labelledby="start-title"
    >
      <h2 id="start-title" className="title-3">
        Start in three steps
      </h2>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={`flex flex-col gap-2 rounded-xl border bg-surface-2 p-4 ${i === current ? "border-primary/70" : "border-border"} ${s.done ? "opacity-60" : ""}`}
          >
            <p className="title-4 flex items-center gap-2">
              <span
                className={`caption-4 flex size-6 items-center justify-center rounded-full font-mono ${s.done ? "bg-primary text-fg" : "bg-raised text-muted"}`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              {s.title}
            </p>
            <p className="caption-5 text-muted">{s.body}</p>
            {/* The faucet needs no connection, so offer it from the start rather than waiting for step 1. */}
            {!s.done && (i === current || s.title === "Get test MON for gas") ? (
              <div className="mt-auto pt-2">{s.action}</div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
