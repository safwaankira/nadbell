// NYSE regular-session calendar (fallback when Alpaca's clock is unavailable).
// Copy of keeper/nyse.mjs. Keep the two in sync.

const HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
// 1:00 pm ET early closes
const EARLY = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

/** Wall-clock parts in New York for a Date. */
export function etParts(date: Date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday, // Mon..Sun
    minutes: Number(p.hour) * 60 + Number(p.minute),
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
  };
}

function isTradingDay(ymd: string, weekday: string) {
  return weekday !== "Sat" && weekday !== "Sun" && !HOLIDAYS.has(ymd);
}

const OPEN_MIN = 9 * 60 + 30;
const closeMin = (ymd: string) => (EARLY.has(ymd) ? 13 * 60 : 16 * 60);

export function isRegularOpen(date = new Date()) {
  const t = etParts(date);
  return isTradingDay(t.ymd, t.weekday) && t.minutes >= OPEN_MIN && t.minutes < closeMin(t.ymd);
}

/** UTC Date for a New York wall-clock time. */
function nyToUtc(y: number, m: number, d: number, minutes: number) {
  let guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60) + 5 * 3600_000;
  for (let i = 0; i < 3; i++) {
    const t = etParts(new Date(guess));
    const dayDiff = Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(y, m - 1, d);
    guess -= dayDiff + (t.minutes - minutes) * 60_000;
  }
  return new Date(guess);
}

/** Next regular-session open strictly after `date`. */
export function nextOpen(date = new Date()): Date | null {
  const t0 = etParts(date);
  for (let i = 0; i < 14; i++) {
    const probe = new Date(Date.UTC(t0.y, t0.m - 1, t0.d + i, 17));
    const t = etParts(probe);
    if (!isTradingDay(t.ymd, t.weekday)) continue;
    const open = nyToUtc(t.y, t.m, t.d, OPEN_MIN);
    if (open > date) return open;
  }
  return null;
}

/** Next regular-session close after `date` (today's if open now). */
export function nextClose(date = new Date()): Date | null {
  const t0 = etParts(date);
  for (let i = 0; i < 14; i++) {
    const probe = new Date(Date.UTC(t0.y, t0.m - 1, t0.d + i, 17));
    const t = etParts(probe);
    if (!isTradingDay(t.ymd, t.weekday)) continue;
    const close = nyToUtc(t.y, t.m, t.d, closeMin(t.ymd));
    if (close > date) return close;
  }
  return null;
}
