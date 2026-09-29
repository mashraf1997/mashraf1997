import { matches } from './glob.js';
import { parseSize } from './size.js';

/**
 * @typedef {import('./measure.js').FileSize} FileSize
 * @typedef {'raw' | 'gzip' | 'brotli'} Compression
 * @typedef {{ name?: string, path: string | string[], max?: string | number, maxTotal?: string | number, compression?: Compression, warnAt?: number }} BudgetRule
 * @typedef {{ budgets: BudgetRule[], ignore?: string[] }} BudgetConfig
 * @typedef {'pass' | 'warn' | 'fail'} Status
 * @typedef {{ path: string, size: number, baseline?: number, status: Status }} FileResult
 * @typedef {{ name: string, compression: Compression, kind: 'file' | 'total', limit: number, size: number, baseline?: number, status: Status, files: FileResult[] }} RuleResult
 */

const COMPRESSIONS = ['raw', 'gzip', 'brotli'];

/**
 * Validates and normalizes a config object, throwing readable errors.
 * @param {unknown} input
 * @returns {BudgetConfig}
 */
export function validateConfig(input) {
  const cfg = /** @type {any} */ (input);
  if (!cfg || !Array.isArray(cfg.budgets) || cfg.budgets.length === 0) {
    throw new Error('Config must contain a non-empty "budgets" array.');
  }
  cfg.budgets.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
    const where = `budgets[${i}]`;
    if (!b.path) throw new Error(`${where}: "path" is required.`);
    if (b.max === undefined && b.maxTotal === undefined) throw new Error(`${where}: set "max" and/or "maxTotal".`);
    if (b.compression && !COMPRESSIONS.includes(b.compression)) {
      throw new Error(`${where}: compression must be one of ${COMPRESSIONS.join(', ')}.`);
    }
    if (b.warnAt !== undefined && !(b.warnAt > 0 && b.warnAt <= 1)) {
      throw new Error(`${where}: warnAt must be between 0 and 1.`);
    }
    if (b.max !== undefined) parseSize(b.max);
    if (b.maxTotal !== undefined) parseSize(b.maxTotal);
  });
  return cfg;
}

/**
 * @param {number} size
 * @param {number} limit
 * @param {number} warnAt
 * @returns {Status}
 */
function statusFor(size, limit, warnAt) {
  if (size > limit) return 'fail';
  if (size > limit * warnAt) return 'warn';
  return 'pass';
}

/**
 * Evaluates measured files against every budget rule. A rule with `max`
 * limits each matching file; `maxTotal` limits their sum. Both may be set.
 * @param {FileSize[]} files
 * @param {BudgetConfig} config
 * @param {FileSize[]} [baseline] measurements from a previous build for deltas
 * @returns {{ results: RuleResult[], status: Status }}
 */
export function evaluate(files, config, baseline = []) {
  const base = new Map(baseline.map((f) => [f.path, f]));
  /** @type {RuleResult[]} */
  const results = [];

  for (const rule of config.budgets) {
    const compression = rule.compression ?? 'gzip';
    const warnAt = rule.warnAt ?? 0.9;
    const name = rule.name ?? [rule.path].flat().join(', ');
    const matched = files.filter((f) => matches(f.path, rule.path));
    const baseMatched = baseline.filter((f) => matches(f.path, rule.path));
    const sizeOf = (/** @type {FileSize | undefined} */ f) => (f ? f[compression] : undefined);

    if (rule.max !== undefined) {
      const limit = parseSize(rule.max);
      const fileResults = matched.map((f) => ({
        path: f.path,
        size: f[compression],
        baseline: sizeOf(base.get(f.path)),
        status: statusFor(f[compression], limit, warnAt),
      }));
      const largest = fileResults.reduce((m, f) => (f.size > m.size ? f : m), { size: 0, baseline: undefined });
      results.push({
        name, compression, kind: 'file', limit, files: fileResults,
        size: largest.size,
        baseline: largest.baseline,
        status: worst(fileResults.map((f) => f.status)),
      });
    }
    if (rule.maxTotal !== undefined) {
      const limit = parseSize(rule.maxTotal);
      const size = matched.reduce((sum, f) => sum + f[compression], 0);
      results.push({
        name, compression, kind: 'total', limit, size,
        baseline: baseline.length ? baseMatched.reduce((sum, f) => sum + f[compression], 0) : undefined,
        status: statusFor(size, limit, warnAt),
        files: matched.map((f) => ({ path: f.path, size: f[compression], baseline: sizeOf(base.get(f.path)), status: 'pass' })),
      });
    }
  }
  return { results, status: worst(results.map((r) => r.status)) };
}

/**
 * @param {Status[]} statuses
 * @returns {Status}
 */
export function worst(statuses) {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}
