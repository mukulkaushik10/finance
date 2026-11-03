// Money helpers. Amounts are always integer minor units (bigint) + ISO currency code.
// Nothing here uses floating point arithmetic on money.

const EXPONENTS: Record<string, number> = { JPY: 0, KRW: 0, BHD: 3, KWD: 3, OMR: 3 };

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Parse a decimal string such as "1,234.50" or "-12" into minor units. Throws on bad input. */
export function parseMoney(input: string | number, currency: string): bigint {
  const raw = String(input).trim().replace(/[,\s]/g, "").replace(/^[$€£¥]/, "");
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error(`"${input}" is not a valid amount`);
  const exp = currencyExponent(currency);
  const negative = raw.startsWith("-");
  const [whole, frac = ""] = raw.replace("-", "").split(".");
  if (frac.length > exp) {
    if (/[^0]/.test(frac.slice(exp))) throw new Error(`"${input}" has more decimal places than ${currency} allows`);
  }
  const fracPadded = (frac + "0".repeat(exp)).slice(0, exp);
  const minor = BigInt(whole + fracPadded);
  return negative ? -minor : minor;
}

/** Format minor units for display, e.g. 1234550n USD -> "$12,345.50". */
export function formatMoney(minor: bigint | number, currency: string, opts: { compact?: boolean } = {}): string {
  const m = typeof minor === "bigint" ? minor : BigInt(minor);
  const exp = currencyExponent(currency);
  const negative = m < 0n;
  const abs = negative ? -m : m;
  const divisor = 10n ** BigInt(exp);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const symbol = currencySymbol(currency);
  if (opts.compact && whole >= 1_000_000n) {
    const tenths = (abs * 10n) / (divisor * 1_000_000n);
    return `${negative ? "-" : ""}${symbol}${tenths / 10n}.${tenths % 10n}M`;
  }
  if (opts.compact && whole >= 10_000n) {
    const tenths = (abs * 10n) / (divisor * 1_000n);
    return `${negative ? "-" : ""}${symbol}${tenths / 10n}${tenths % 10n === 0n ? "" : "." + (tenths % 10n)}k`;
  }
  const wholeStr = new Intl.NumberFormat("en-US").format(whole);
  const fracStr = exp > 0 ? "." + frac.toString().padStart(exp, "0") : "";
  return `${negative ? "-" : ""}${symbol}${wholeStr}${fracStr}`;
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case "USD": return "$";
    case "EUR": return "€";
    case "GBP": return "£";
    case "JPY": return "¥";
    default: return currency.toUpperCase() + " ";
  }
}

/** Absolute difference between two amounts as basis points of `base`. Integer maths only. */
export function diffBps(amount: bigint, base: bigint): bigint {
  if (base === 0n) return amount === 0n ? 0n : 10_000_000n;
  const d = amount > base ? amount - base : base - amount;
  return (d * 10_000n) / (base < 0n ? -base : base);
}

/** true when |amount - base| <= base * tolBps / 10000. Exact integer comparison. */
export function withinTolerance(amount: bigint, base: bigint, tolBps: number): boolean {
  const d = amount > base ? amount - base : base - amount;
  const b = base < 0n ? -base : base;
  return d * 10_000n <= b * BigInt(tolBps);
}

export function formatBps(bps: number | bigint, decimals = 1): string {
  const n = Number(bps);
  return `${(n / 100).toFixed(decimals)}%`;
}
