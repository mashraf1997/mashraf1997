# arabic-kit

**The Arabic text toolkit every bilingual product needs.** Normalization, search matching, slugs, transliteration, digit conversion, direction detection and number-to-words (تفقيط). It's written in TypeScript with no runtime dependencies and is tree-shakeable.

Extracted from the Arabic-first products we build at [MirrorORG](https://mirrororg.com/), such as [Masar](https://msar.cloud/), which generates bilingual Arabic/English websites.

```ts
import { includesArabic, slugify, toArabicCurrencyWords, transliterate } from '@mirrororg/arabic-kit';

includesArabic('مُحَمَّد أحمد في المدرسة', 'محمد احمد');  // true
slugify('مرحباً بالعالم 2026!');                          // "مرحبا-بالعالم-2026"
slugify('مسار — منصة ذكية', { transliterate: true });     // "msar-mnsa-dhkia"
transliterate('بوسطة');                                   // "bosta"
toArabicCurrencyWords(1250.5, 'EGP');
// "فقط ألف ومائتان وخمسون جنيهًا وخمسون قرشًا لا غير"
```

## Why

Arabic user input is messy: `أحمد` / `احمد` / `أَحْمَد`, `مدرسة` / `مدرسه`, `الى` / `إلى`, `٢٠٢٦` / `2026`, `مـــرحبا` with tatweel. Naive string comparison fails on all of them, which breaks search, deduplication, login by name and URL routing. arabic-kit handles these cases so your product doesn't have to.

## API

### Normalization and search

| Function | Description |
| :--- | :--- |
| `normalize(text, options?)` | Strip diacritics and tatweel, unify alef forms and ى/ي, convert digits, collapse whitespace. Every step can be toggled. |
| `normalizeForSearch(text)` | The most aggressive normalization (also ة→ه and ؤ/ئ), plus lower-casing. Use it to build search indexes. |
| `includesArabic(text, query)` | Substring match that ignores spelling variants. |
| `equalsArabic(a, b)` | Equality check that ignores spelling variants. |
| `removeDiacritics(text)` / `removeTatweel(text)` | Single-purpose helpers. |

`NormalizeOptions`: `diacritics`, `tatweel`, `alef`, `yaa`, `digits`, `whitespace` (all default `true`); `taaMarbuta`, `hamza` (default `false`).

### URLs and transliteration

| Function | Description |
| :--- | :--- |
| `slugify(text, { transliterate?, separator?, maxLength?, lowercase? })` | SEO-friendly slugs that either keep Arabic (browsers display it natively) or transliterate to ASCII. `maxLength` cuts at a word boundary. |
| `transliterate(text)` | Readable Latin output: و/ي become `w`/`y` at the start of a word and `o`/`i` inside it, so `ميرور` → `miror` and `مسار` → `msar`. |

### Digits and direction

| Function | Description |
| :--- | :--- |
| `toWesternDigits(text)` | `٠-٩` and `۰-۹` → `0-9` |
| `toArabicDigits(text)` / `toPersianDigits(text)` | `0-9` → `٠-٩` / `۰-۹` |
| `detectDirection(text)` | `'rtl' \| 'ltr' \| 'neutral'`, using the first-strong-character rule that `dir="auto"` uses. |
| `arabicRatio(text)` / `isArabic(text, threshold?)` | Share of the letters that are Arabic. |
| `hasRTL(text)` | Any right-to-left character present. |
| `isolate(text)` | Wraps text in Unicode FSI/PDI isolates so mixed Arabic and English doesn't scramble punctuation. |

### Numbers to words (تفقيط)

| Function | Description |
| :--- | :--- |
| `toArabicWords(n)` | Integers up to 10¹⁵ (`number` or `bigint`), with correct agreement: `ألفان`, `ثلاثة آلاف`, `أحد عشر ألفًا`, `ثلاثة ملايين`. |
| `toArabicCurrencyWords(amount, currency, { wrap? })` | Invoice and cheque wording for `EGP`, `SAR`, `AED` and `USD`, or any custom `CurrencyWords` definition. |

```ts
toArabicWords(2026);    // "ألفان وستة وعشرون"
toArabicWords(250000);  // "مائتان وخمسون ألفًا"
toArabicCurrencyWords(7, 'AED', { wrap: false }); // "سبعة دراهم"
```

## Install and develop

```bash
cd projects/arabic-kit
npm install
npm test        # compiles with strict TypeScript and runs the node:test suite
```

The package (`@mirrororg/arabic-kit`) ships as ESM with bundled type declarations. Requires Node 18+ or any modern bundler.

## License

MIT
