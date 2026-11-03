// Deterministic date formatting (same output on server and client), e.g. "3 Nov 2026" / "3 Nov 2026, 14:05 UTC".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00Z" : d) : d;
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  const hh = String(x.getUTCHours()).padStart(2, "0");
  const mm = String(x.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(x)}, ${hh}:${mm} UTC`;
}

export function formatPct(ratio: number | null | undefined, decimals = 1): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "—";
  return `${(ratio * 100).toFixed(decimals)}%`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
