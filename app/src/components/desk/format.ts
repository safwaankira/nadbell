export const MON_FAUCET = "https://faucet.monad.xyz";

export const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money = (dollars: number) =>
  `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtShares = (lots: number) =>
  (lots / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const pct = (bps: number, sign = false) =>
  `${sign && bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

export function ago(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function until(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

export const nyWhen = (d: Date) =>
  d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }) + " ET";
