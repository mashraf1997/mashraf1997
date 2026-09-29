const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'];
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

/** [singular, dual, plural (3–10), accusative singular (11–99)] */
const SCALES: [string, string, string, string][] = [
  ['ألف', 'ألفان', 'آلاف', 'ألفًا'],
  ['مليون', 'مليونان', 'ملايين', 'مليونًا'],
  ['مليار', 'ملياران', 'مليارات', 'مليارًا'],
  ['تريليون', 'تريليونان', 'تريليونات', 'تريليونًا'],
];

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(HUNDREDS[h]!);
  if (r >= 1 && r <= 10) parts.push(ONES[r]!);
  else if (r >= 11 && r <= 19) parts.push(TEENS[r - 10]!);
  else if (r >= 20) {
    const u = r % 10;
    parts.push(u ? `${ONES[u]} و${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)]!);
  }
  return parts.join(' و');
}

function scaled(group: number, forms: [string, string, string, string]): string {
  const [one, two, plural, accusative] = forms;
  if (group === 1) return one;
  if (group === 2) return two;
  const r = group % 100;
  if (r >= 3 && r <= 10) return `${below1000(group)} ${plural}`;
  if (r >= 11) return `${below1000(group)} ${accusative}`;
  return `${below1000(group)} ${one}`;
}

/**
 * Converts an integer to Arabic words (تفقيط), following standard
 * grammatical agreement for thousands, millions and billions.
 *
 * @example toArabicWords(2026)    // "ألفان وستة وعشرون"
 * @example toArabicWords(15000)   // "خمسة عشر ألفًا"
 * @example toArabicWords(3000000) // "ثلاثة ملايين"
 */
export function toArabicWords(value: number | bigint): string {
  let n = BigInt(value);
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new RangeError('toArabicWords expects a safe integer');
  }
  if (n === 0n) return 'صفر';
  const negative = n < 0n;
  if (negative) n = -n;
  if (n >= 10n ** 15n) throw new RangeError('toArabicWords supports values below 10^15');

  const groups: number[] = [];
  while (n > 0n) {
    groups.push(Number(n % 1000n));
    n /= 1000n;
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    parts.push(i === 0 ? below1000(g) : scaled(g, SCALES[i - 1]!));
  }
  return (negative ? 'سالب ' : '') + parts.join(' و');
}

export interface CurrencyWords {
  /** Main unit: [singular, dual, plural (3–10), accusative (11–99)]. */
  unit: [string, string, string, string];
  /** Sub-unit, e.g. piasters or halalas. */
  subunit: [string, string, string, string];
  /** Sub-units per unit. Default: 100. */
  subunitsPerUnit?: number;
}

export const CURRENCIES = {
  EGP: { unit: ['جنيه', 'جنيهان', 'جنيهات', 'جنيهًا'], subunit: ['قرش', 'قرشان', 'قروش', 'قرشًا'] },
  SAR: { unit: ['ريال', 'ريالان', 'ريالات', 'ريالًا'], subunit: ['هللة', 'هللتان', 'هللات', 'هللة'] },
  AED: { unit: ['درهم', 'درهمان', 'دراهم', 'درهمًا'], subunit: ['فلس', 'فلسان', 'فلوس', 'فلسًا'] },
  USD: { unit: ['دولار', 'دولاران', 'دولارات', 'دولارًا'], subunit: ['سنت', 'سنتان', 'سنتات', 'سنتًا'] },
} satisfies Record<string, CurrencyWords>;

/**
 * Spells out a monetary amount in Arabic for invoices and cheques.
 *
 * @example toArabicCurrencyWords(1250.5, 'EGP')
 * // "فقط ألف ومائتان وخمسون جنيهًا وخمسون قرشًا لا غير"
 */
export function toArabicCurrencyWords(
  amount: number,
  currency: keyof typeof CURRENCIES | CurrencyWords,
  { wrap = true }: { wrap?: boolean } = {},
): string {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('amount must be a non-negative number');
  const c: CurrencyWords = typeof currency === 'string' ? CURRENCIES[currency] : currency;
  const per = c.subunitsPerUnit ?? 100;
  const totalSub = Math.round(amount * per);
  const units = Math.floor(totalSub / per);
  const subs = totalSub % per;

  const phrase = (count: number, forms: [string, string, string, string]): string => {
    if (count === 1) return forms[0];
    if (count === 2) return forms[1];
    const r = count % 100;
    const noun = r >= 3 && r <= 10 ? forms[2] : r >= 11 ? forms[3] : forms[0];
    return `${toArabicWords(count)} ${noun}`;
  };

  const parts: string[] = [];
  if (units || !subs) parts.push(units ? phrase(units, c.unit) : `صفر ${c.unit[0]}`);
  if (subs) parts.push(phrase(subs, c.subunit));
  const text = parts.join(' و');
  return wrap ? `فقط ${text} لا غير` : text;
}
