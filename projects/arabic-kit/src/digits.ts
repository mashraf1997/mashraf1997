const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to Western digits (0-9). */
export function toWesternDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Converts Western digits (0-9) to Arabic-Indic digits (٠-٩). */
export function toArabicDigits(text: string | number): string {
  return String(text).replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]!);
}

/** Converts Western digits (0-9) to Persian/Urdu digits (۰-۹). */
export function toPersianDigits(text: string | number): string {
  return String(text).replace(/[0-9]/g, (d) => PERSIAN[Number(d)]!);
}
