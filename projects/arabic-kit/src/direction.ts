const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_LETTERS = /[\u0620-\u064A\u0671-\u06D3\u06FA-\u06FF]/g;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
const LETTERS = /\p{L}/gu;

export type Direction = 'rtl' | 'ltr' | 'neutral';

/**
 * Detects base direction from the first strong character, the same rule
 * browsers apply for `dir="auto"`.
 */
export function detectDirection(text: string): Direction {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (LTR_CHAR.test(ch)) return 'ltr';
  }
  return 'neutral';
}

/** Fraction (0–1) of letters in the text that are Arabic letters. */
export function arabicRatio(text: string): number {
  const letters = text.match(LETTERS)?.length ?? 0;
  if (letters === 0) return 0;
  return (text.match(ARABIC_LETTERS)?.length ?? 0) / letters;
}

/** True when at least `threshold` (default 50%) of letters are Arabic. */
export function isArabic(text: string, threshold = 0.5): boolean {
  const ratio = arabicRatio(text);
  return ratio > 0 && ratio >= threshold;
}

/** True when text contains any right-to-left character. */
export function hasRTL(text: string): boolean {
  return RTL_CHAR.test(text);
}

/**
 * Wraps text in Unicode first-strong isolates (FSI … PDI) so that mixed
 * Arabic/English fragments do not scramble surrounding punctuation.
 */
export function isolate(text: string): string {
  return `⁨${text}⁩`;
}
