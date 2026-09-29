import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { evaluate, validateConfig } from './budget.js';
import { matches } from './glob.js';
import { measureDirectory } from './measure.js';
import { renderMarkdown, renderText } from './report.js';

const HELP = `Usage: bundle-budget [dir] [options]

Checks build output against size budgets (raw, gzip or brotli).

Options:
  -c, --config <file>     Budget config (default: budget.json, or "budget" in package.json)
  -b, --baseline <file>   Previous --save-baseline output, to report size deltas
      --save-baseline <f> Write this build's measurements to a file
      --format <fmt>      text (default), markdown or json
  -o, --output <file>     Also write the report to a file (e.g. for a PR comment)
      --verbose           List every matched file
      --no-color          Disable colors
      --warn-only         Always exit 0, even when budgets are exceeded
  -h, --help              Show this help

Exit codes: 0 = within budget, 1 = budget exceeded, 2 = usage or config error.`;

/**
 * @param {string} path
 */
async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * @param {string | undefined} explicit
 */
async function loadConfig(explicit) {
  if (explicit) return validateConfig(await readJSON(explicit));
  try {
    return validateConfig(await readJSON('budget.json'));
  } catch (err) {
    if (/** @type {any} */ (err).code !== 'ENOENT') throw err;
  }
  const pkg = await readJSON('package.json').catch(() => ({}));
  if (pkg.budget) return validateConfig(pkg.budget);
  throw new Error('No config found. Create budget.json or pass --config.');
}

/**
 * Runs the CLI. Returns the process exit code instead of exiting so it can be tested.
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, isTTY?: boolean }} [io]
 * @returns {Promise<number>}
 */
export async function run(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s + '\n'));
  const err = io.stderr ?? ((s) => process.stderr.write(s + '\n'));
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: 'string', short: 'c' },
        baseline: { type: 'string', short: 'b' },
        'save-baseline': { type: 'string' },
        format: { type: 'string', default: 'text' },
        output: { type: 'string', short: 'o' },
        verbose: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        'warn-only': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    err(`${/** @type {Error} */ (e).message}\n\n${HELP}`);
    return 2;
  }
  const { values: opts, positionals } = args;
  if (opts.help) {
    out(HELP);
    return 0;
  }
  if (!['text', 'markdown', 'json'].includes(/** @type {string} */ (opts.format))) {
    err(`Unknown --format ${opts.format}. Use text, markdown or json.`);
    return 2;
  }

  try {
    const config = await loadConfig(opts.config);
    const dir = positionals[0] ?? 'dist';
    const ignore = config.ignore ?? [];
    const files = await measureDirectory(dir, { ignore: (p) => ignore.length > 0 && matches(p, ignore) });
    if (files.length === 0) throw new Error(`No files found in ${dir}.`);

    const baseline = opts.baseline ? (await readJSON(opts.baseline)).files ?? [] : [];
    const evaluation = evaluate(files, config, baseline);

    if (opts['save-baseline']) {
      await writeFile(opts['save-baseline'], JSON.stringify({ createdAt: new Date().toISOString(), files }, null, 2) + '\n');
    }

    const color = !opts['no-color'] && !process.env.NO_COLOR && (io.isTTY ?? Boolean(process.stdout.isTTY));
    const report =
      opts.format === 'json' ? JSON.stringify(evaluation, null, 2)
      : opts.format === 'markdown' ? renderMarkdown(evaluation)
      : renderText(evaluation, { color, verbose: opts.verbose });
    out(report);
    if (opts.output) {
      await writeFile(opts.output, (opts.format === 'text' ? renderText(evaluation, { verbose: opts.verbose }) : report) + '\n');
    }
    return evaluation.status === 'fail' && !opts['warn-only'] ? 1 : 0;
  } catch (e) {
    const code = /** @type {any} */ (e).code;
    err(`bundle-budget: ${code === 'ENOENT' ? `file not found: ${/** @type {any} */ (e).path}` : /** @type {Error} */ (e).message}`);
    return 2;
  }
}
