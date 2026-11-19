import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import type { Snapshot } from "@/lib/chain/market";
import { usd } from "./format";

// Chart colours mirror the theme tokens in styles.css (recharts needs literal values).
const UP = "#8b7bff";
const DOWN = "#f0517a";
const FAINT = "#737373";
const GRID = "#272727";

export function PriceChart({
  snap,
  refCents,
  mid,
  up,
}: {
  snap: Snapshot | null;
  refCents: number;
  mid: number;
  up: boolean;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  const series = useMemo(() => {
    const t = snap?.trades.slice().reverse() ?? [];
    const pts = t.map((x, i) => ({ i, px: x.price }));
    if (pts.length === 0 && refCents)
      return [
        { i: 0, px: refCents },
        { i: 1, px: mid },
      ];
    return [...pts, { i: pts.length, px: mid }];
  }, [snap?.trades, refCents, mid]);
  const refName = snap?.marketOpen ? "Official" : "Close";

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="title-3">
          Trades here vs the {snap?.marketOpen ? "official price" : "close"}
        </h2>
        {snap ? (
          <span className={`caption-5 font-mono ${up ? "text-up" : "text-down"}`}>{usd(mid)}</span>
        ) : null}
      </div>
      <div className="mt-4 min-h-56 flex-1">
        {on && snap ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <YAxis
                domain={[
                  (d: number) => Math.min(d, refCents) - 40,
                  (d: number) => Math.max(d, refCents) + 40,
                ]}
                tickFormatter={(v: number) => (v / 100).toFixed(2)}
                tickCount={4}
                width={56}
                axisLine={false}
                tickLine={false}
                tick={{ fill: FAINT, fontSize: 12, fontFamily: "Geist Mono, monospace" }}
              />
              <ReferenceLine
                y={refCents}
                stroke={FAINT}
                strokeDasharray="4 4"
                label={{ value: refName, position: "insideTopLeft", fill: FAINT, fontSize: 12 }}
              />
              <Line
                type="stepAfter"
                dataKey="px"
                stroke={up ? UP : DOWN}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : null}
      </div>
    </div>
  );
}
