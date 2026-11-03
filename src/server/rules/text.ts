// Invoice-number normalisation and fuzzy matching for duplicate detection.

/**
 * Reduce an invoice number to its core digits/letters so that trivially different spellings
 * of the same number compare equal: "INV-0010432", "10432", "10432A", "1O432" -> "10432".
 */
export function normaliseInvoiceNumber(raw: string): string {
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  s = s.replace(/^[A-Z]+(?=\d)/, "");          // prefix such as INV / BILL
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1"); // common OCR / typing slips
  s = s.replace(/(?<=\d)[A-Z]{1,2}$/, "");        // trailing suffix such as "A" or "R1"
  s = s.replace(/^0+(?=\d)/, "");                 // leading zeros
  return s;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const ta = typeof a === "string" ? Date.parse(a.length === 10 ? a + "T00:00:00Z" : a) : a.getTime();
  const tb = typeof b === "string" ? Date.parse(b.length === 10 ? b + "T00:00:00Z" : b) : b.getTime();
  return Math.round(Math.abs(ta - tb) / 86_400_000);
}
