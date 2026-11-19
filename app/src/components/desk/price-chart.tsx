import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import type { Snapshot } from "@/lib/chain/market";

export function PriceChart({ snap, refCents, mid, up }: { snap: Snapshot | null; refCents: number; mid: number; up: boolean }) {
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
