import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ak from '../dist/index.js';

test('digits convert both ways, including Persian', () => {
  assert.equal(ak.toWesternDigits('٢٠٢٦ و ۱۴۰۵'), '2026 و 1405');
  assert.equal(ak.toArabicDigits('Order #1250'), 'Order #١٢٥٠');
  assert.equal(ak.toArabicDigits(907), '٩٠٧');
  assert.equal(ak.toPersianDigits('42'), '۴۲');
});

test('normalize strips diacritics, tatweel and unifies letters', () => {
  assert.equal(ak.removeDiacritics('مُحَمَّدٌ'), 'محمد');
  assert.equal(ak.removeTatweel('مـــرحبا'), 'مرحبا');
  assert.equal(ak.normalize('  أَحْمَدُ   إلى  آخر ٣  '), 'احمد الي اخر 3');
  assert.equal(ak.normalize('مدرسة', { taaMarbuta: true }), 'مدرسه');
  assert.equal(ak.normalize('مسؤول شاطئ', { hamza: true }), 'مسوول شاطي');
  assert.equal(ak.normalize('إلى', { alef: false, yaa: false }), 'إلى');
});

test('search helpers ignore spelling variants', () => {
  assert.ok(ak.includesArabic('مُحَمَّد أحمد في المدرسة', 'محمد احمد'));
  assert.ok(ak.includesArabic('المدرسه الكبرى', 'مدرسة الكبري'));
  assert.ok(ak.includesArabic('Hello WORLD', 'world'));
  assert.ok(ak.equalsArabic('إسلام', 'اسلام'));
  assert.ok(!ak.includesArabic('مرسال', 'مسار'));
});

test('direction detection follows the first strong character', () => {
  assert.equal(ak.detectDirection('123 — مرحبا hello'), 'rtl');
  assert.equal(ak.detectDirection('Hi مرحبا'), 'ltr');
  assert.equal(ak.detectDirection('2026!'), 'neutral');
  assert.equal(ak.arabicRatio('abc'), 0);
  assert.equal(ak.arabicRatio('مرحبا'), 1);
  assert.ok(ak.isArabic('مرحبا hi'));
  assert.ok(!ak.isArabic('hello there مرحبا'));
  assert.ok(ak.hasRTL('abc שלום'));
  assert.ok(!ak.hasRTL('abc'));
  assert.equal(ak.isolate('مسار'), '⁨مسار⁩');
});

test('transliterate produces readable Latin', () => {
  assert.equal(ak.transliterate('بوسطة'), 'bosta');
  assert.equal(ak.transliterate('ميرور'), 'miror');
  assert.equal(ak.transliterate('مرسال'), 'mrsal');
  assert.equal(ak.transliterate('وليد'), 'wlid');
  assert.equal(ak.transliterate('شخص'), 'shkhs');
});

test('slugify keeps Arabic or transliterates', () => {
  assert.equal(ak.slugify('مرحباً بالعالم 2026!'), 'مرحبا-بالعالم-2026');
  assert.equal(ak.slugify('مسار — منصة ذكية', { transliterate: true }), 'msar-mnsa-dhkia');
  assert.equal(ak.slugify('Café Déjà Vu', { transliterate: true }), 'cafe-deja-vu');
  assert.equal(ak.slugify('عرض ٥٠٪ خصم'), 'عرض-50-خصم');
  assert.equal(ak.slugify('one two three', { separator: '_' }), 'one_two_three');
  assert.equal(ak.slugify('alpha beta gamma', { maxLength: 11 }), 'alpha-beta');
  assert.equal(ak.slugify('supercalifragilistic', { maxLength: 5 }), 'super');
  assert.equal(ak.slugify('   !!!  '), '');
});

test('toArabicWords handles grammatical agreement', () => {
  const cases = {
    0: 'صفر',
    1: 'واحد',
    12: 'اثنا عشر',
    21: 'واحد وعشرون',
    100: 'مائة',
    200: 'مائتان',
    305: 'ثلاثمائة وخمسة',
    1000: 'ألف',
    2000: 'ألفان',
    2026: 'ألفان وستة وعشرون',
    3000: 'ثلاثة آلاف',
    11000: 'أحد عشر ألفًا',
    100000: 'مائة ألف',
    250000: 'مائتان وخمسون ألفًا',
    1000000: 'مليون',
    3000000: 'ثلاثة ملايين',
    2000000000: 'ملياران',
    [-45]: 'سالب خمسة وأربعون',
  };
  for (const [n, words] of Object.entries(cases)) {
    assert.equal(ak.toArabicWords(Number(n)), words, `n=${n}`);
  }
  assert.equal(ak.toArabicWords(1000001n), 'مليون وواحد');
  assert.throws(() => ak.toArabicWords(1.5), RangeError);
  assert.throws(() => ak.toArabicWords(10n ** 15n), RangeError);
});

test('toArabicCurrencyWords spells invoice amounts', () => {
  assert.equal(ak.toArabicCurrencyWords(1250.5, 'EGP'), 'فقط ألف ومائتان وخمسون جنيهًا وخمسون قرشًا لا غير');
  assert.equal(ak.toArabicCurrencyWords(1, 'SAR'), 'فقط ريال لا غير');
  assert.equal(ak.toArabicCurrencyWords(7, 'AED', { wrap: false }), 'سبعة دراهم');
  assert.equal(ak.toArabicCurrencyWords(0.02, 'USD', { wrap: false }), 'سنتان');
  assert.equal(ak.toArabicCurrencyWords(0, 'EGP', { wrap: false }), 'صفر جنيه');
  assert.throws(() => ak.toArabicCurrencyWords(-1, 'EGP'), RangeError);
});
