import { toWesternDigits } from './digits.js';

/** Harakat, tanween, shadda, sukun, superscript alef and Quranic annotation marks. */
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g;
const TATWEEL = /\u0640/g;

export interface NormalizeOptions {
  /** Strip harakat and other diacritics. Default: true. */
  diacritics?: boolean;
  /** Strip tatweel/kashida (ـ). Default: true. */
  tatweel?: boolean;
  /** Unify أ إ آ ٱ into ا. Default: true. */
  alef?: boolean;
  /** Map alef maqsura ى to ي. Default: true. */
  yaa?: boolean;
  /** Map taa marbuta ة to ه. Default: false (it changes meaning in display text). */
  taaMarbuta?: boolean;
  /** Map ؤ to و and ئ to ي. Default: false. */
  hamza?: boolean;
  /** Convert Arabic-Indic / Persian digits to Western digits. Default: true. */
  digits?: boolean;
  /** Collapse runs of whitespace and trim. Default: true. */
  whitespace?: boolean;
}

/** Removes harakat (fatha, damma, kasra, shadda, sukun, tanween…) from text. */
export function removeDiacritics(text: string): string {
  return text.replace(DIACRITICS, '');
}

/** Removes tatweel (kashida) used to stretch words: "مـــرحبا" → "مرحبا". */
export function removeTatweel(text: string): string {
  return text.replace(TATWEEL, '');
}

/**
 * Normalizes Arabic text so that visually or orthographically different
 * spellings of the same word compare equal. Ideal for search indexes,
 * deduplication and user-input comparison.
 */
export function normalize(text: string, options: NormalizeOptions = {}): string {
  const o = {
    diacritics: true, tatweel: true, alef: true, yaa: true,
    taaMarbuta: false, hamza: false, digits: true, whitespace: true,
    ...options,
  };
  let s = text.normalize('NFC');
  if (o.diacritics) s = removeDiacritics(s);
  if (o.tatweel) s = removeTatweel(s);
  if (o.alef) s = s.replace(/[أإآٱ]/g, 'ا');
  if (o.yaa) s = s.replace(/ى/g, 'ي');
  if (o.taaMarbuta) s = s.replace(/ة/g, 'ه');
  if (o.hamza) s = s.replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  if (o.digits) s = toWesternDigits(s);
  if (o.whitespace) s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Aggressive normalization used for search: every option on, lower-cased. */
export function normalizeForSearch(text: string): string {
  return normalize(text, { taaMarbuta: true, hamza: true }).toLowerCase();
}

/**
 * Returns true when `query` appears in `text`, ignoring diacritics, tatweel,
 * hamza/alef variants, ة/ه, ى/ي, digit scripts and letter case.
 *
 * @example includesArabic('مُحَمَّد أحمد', 'محمد احمد') // true
 */
export function includesArabic(text: string, query: string): boolean {
  return normalizeForSearch(text).includes(normalizeForSearch(query));
}

/** Equality under search normalization. */
export function equalsArabic(a: string, b: string): boolean {
  return normalizeForSearch(a) === normalizeForSearch(b);
}
