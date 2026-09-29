const UNITS = { b: 1, kb: 1000, kib: 1024, mb: 1000 ** 2, mib: 1024 ** 2, gb: 1000 ** 3, gib: 1024 ** 3 };

/**
 * Parses human sizes such as "170 kB", "1.5MB", "512KiB" or 2048 into bytes.
 * kB/MB are decimal (as browsers and Lighthouse report); KiB/MiB are binary.
 * @param {string | number} value
 * @returns {number}
 */
export function parseSize(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmg]i?b|b)?\s*$/i.exec(String(value));
  if (!m) throw new Error(`Invalid size: ${JSON.stringify(value)}`);
  const unit = (m[2] ?? 'b').toLowerCase();
  return Math.round(Number(m[1]) * UNITS[unit]);
}

/**
 * Formats bytes for humans using decimal units.
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  const abs = Math.abs(bytes);
  if (abs < 1000) return `${bytes} B`;
  if (abs < 1000 ** 2) return `${(bytes / 1000).toFixed(abs < 10_000 ? 2 : 1)} kB`;
  return `${(bytes / 1000 ** 2).toFixed(2)} MB`;
}

/**
 * Formats a signed size delta, e.g. "+1.20 kB" or "−300 B".
 * @param {number} bytes
 */
export function formatDelta(bytes) {
  if (bytes === 0) return '±0 B';
  return (bytes > 0 ? '+' : '−') + formatSize(Math.abs(bytes));
}
