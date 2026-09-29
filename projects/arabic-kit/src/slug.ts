import { normalize } from './normalize.js';

const TRANSLIT: Record<string, string> = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'aa', 'ٱ': 'a', 'ء': '', 'ؤ': 'o', 'ئ': 'e',
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd',
  'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd',
  'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k',
  'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ة': 'a', 'ى': 'a',
  'پ': 'p', 'چ': 'ch', 'ژ': 'zh', 'گ': 'g', 'ڤ': 'v', 'ک': 'k', 'ی': 'y',
  '،': ',', '؛': ';', '؟': '?',
};

/**
 * Readable, reversible-enough Latin transliteration for URLs, file names and
 * usernames. و and ي become consonants (w, y) at the start of a word and
 * vowels (o, i) inside it: "بوسطة" → "bosta", "ميرور" → "miror".
 */
export function transliterate(text: string): string {
  const s = normalize(text, { alef: false, yaa: false, whitespace: false });
  let out = '';
  let prevIsLetter = false;
  for (const ch of s) {
    let mapped: string;
    if (ch === 'و') mapped = prevIsLetter ? 'o' : 'w';
    else if (ch === 'ي') mapped = prevIsLetter ? 'i' : 'y';
    else mapped = TRANSLIT[ch] ?? ch;
    out += mapped;
    prevIsLetter = /\p{L}/u.test(ch);
  }
  return out;
}

export interface SlugifyOptions {
  /** Transliterate Arabic to Latin instead of keeping Arabic letters. Default: false. */
  transliterate?: boolean;
  /** Word separator. Default: "-". */
  separator?: string;
  /** Maximum length; the slug is cut at a word boundary. Default: unlimited. */
  maxLength?: number;
  /** Lower-case Latin letters. Default: true. */
  lowercase?: boolean;
}

/**
 * Creates URL slugs that keep Arabic readable (modern browsers display
 * percent-encoded Arabic paths natively) or transliterate to ASCII.
 *
 * @example slugify('مرحباً بالعالم 2026!') // "مرحبا-بالعالم-2026"
 * @example slugify('مسار — منصة ذكية', { transliterate: true }) // "msar-mnsa-dhkia"
 */
export function slugify(text: string, options: SlugifyOptions = {}): string {
  const { separator = '-', maxLength, lowercase = true } = options;
  let s = normalize(text, { alef: false, yaa: false });
  if (options.transliterate) {
    s = transliterate(s)
      .normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, ''); // strip Latin accents: é → e
  }
  if (lowercase) s = s.toLowerCase();
  const words = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let slug = words.join(separator);
  if (maxLength !== undefined && slug.length > maxLength) {
    slug = '';
    for (const w of words) {
      const next = slug ? slug + separator + w : w;
      if (next.length > maxLength) break;
      slug = next;
    }
    if (!slug) slug = (words[0] ?? '').slice(0, maxLength);
  }
  return slug;
}
