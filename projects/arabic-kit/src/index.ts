export { toWesternDigits, toArabicDigits, toPersianDigits } from './digits.js';
export {
  normalize, normalizeForSearch, removeDiacritics, removeTatweel,
  includesArabic, equalsArabic, type NormalizeOptions,
} from './normalize.js';
export { detectDirection, arabicRatio, isArabic, hasRTL, isolate, type Direction } from './direction.js';
export { slugify, transliterate, type SlugifyOptions } from './slug.js';
export { toArabicWords, toArabicCurrencyWords, CURRENCIES, type CurrencyWords } from './tafqit.js';
