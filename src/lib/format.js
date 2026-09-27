// Browser-side display formatting. Amounts arrive from the API as raw
// integer strings (jetton units) and are only turned into text here.

// Grouped, at most 4 fractional digits: for display, never for inputs.
export function formatUnits(raw, decimals) {
  if (raw === null || raw === undefined || decimals === null || decimals === undefined) return "—";
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 4);
  return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

// Full precision, no grouping: for pre-filling inputs.
export function formatExact(raw, decimals) {
  if (raw === null || raw === undefined || decimals === null) return "";
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${value / base}${frac ? `.${frac}` : ""}`;
}

const numberFormat = new Intl.NumberFormat("en-US");
export function formatPoints(points) {
  return numberFormat.format(points || 0);
}

export function formatDate(epochSec, { time = false } = {}) {
  if (!epochSec) return "—";
  const date = new Date(epochSec * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}
