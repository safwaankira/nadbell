import { useMarket, type Snapshot } from "@/lib/chain/market";
import { pct, short } from "./format";

export function Leaderboard({ snap }: { snap: Snapshot }) {
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
