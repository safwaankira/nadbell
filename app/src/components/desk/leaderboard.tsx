import { useMarket, type Snapshot } from "@/lib/chain/market";
import { pct, short } from "./format";

export function Leaderboard({ snap }: { snap: Snapshot }) {
  const account = useMarket((s) => s.account)?.toLowerCase();
  if (!snap.leaders.length) return null;
  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="title-4">Best callers, last {Math.min(8, snap.recaps.length)} reopens</h3>
      <ol className="caption-5 mt-3 space-y-2 font-mono">
        {snap.leaders.slice(0, 5).map((l, i) => {
          const me = l.player.toLowerCase() === account;
          return (
            <li
              key={l.player}
              className={`flex justify-between gap-3 ${me ? "text-up" : "text-muted"}`}
            >
              <span>
                <span className="mr-2 text-faint">{i + 1}</span>
                {short(l.player)}
                {me ? " (you)" : ""}
              </span>
              <span>
                {pct(l.avgErrBps)} avg miss, {l.sessions}×
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
