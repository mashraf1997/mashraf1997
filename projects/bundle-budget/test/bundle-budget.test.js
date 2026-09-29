import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluate, formatDelta, formatSize, globToRegExp, matches, measureBuffer,
  measureDirectory, parseSize, renderMarkdown, renderText, run, validateConfig,
} from '../src/index.js';

const FIXTURE = new URL('./fixtures/site', import.meta.url).pathname;
const CONFIG = join(FIXTURE, 'budget.json');

/** @param {string[]} argv */
async function cli(argv) {
  const out = [];
  const err = [];
  const code = await run(argv, { stdout: (s) => out.push(s), stderr: (s) => err.push(s), isTTY: false });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('parseSize understands decimal and binary units', () => {
  assert.equal(parseSize('170 kB'), 170_000);
  assert.equal(parseSize('1.5MB'), 1_500_000);
  assert.equal(parseSize('2KiB'), 2048);
  assert.equal(parseSize('512'), 512);
  assert.equal(parseSize(1024), 1024);
  assert.throws(() => parseSize('big'), /Invalid size/);
  assert.throws(() => parseSize(-1), /Invalid size/);
});

test('formatSize and formatDelta are human friendly', () => {
  assert.equal(formatSize(999), '999 B');
  assert.equal(formatSize(1234), '1.23 kB');
  assert.equal(formatSize(170_000), '170.0 kB');
  assert.equal(formatSize(2_500_000), '2.50 MB');
  assert.equal(formatDelta(1200), '+1.20 kB');
  assert.equal(formatDelta(-300), '−300 B');
  assert.equal(formatDelta(0), '±0 B');
});

test('globs support **, *, ?, braces and classes', () => {
  assert.ok(matches('assets/js/app.js', '**/*.js'));
  assert.ok(matches('app.js', '**/*.js'));
  assert.ok(!matches('assets/js/app.js', '*.js'));
  assert.ok(matches('img/a.webp', '**/*.{webp,png}'));
  assert.ok(matches('chunk-1.js', 'chunk-?.js'));
  assert.ok(matches('a.js', '[ab].js') && !matches('c.js', '[!c].js'));
  assert.ok(matches('any/deep/file.txt', '**'));
  assert.ok(globToRegExp('a.b').test('a.b') && !globToRegExp('a.b').test('axb'));
});

test('measureBuffer reports raw, gzip and brotli sizes', () => {
  const size = measureBuffer('x.txt', Buffer.from('a'.repeat(10_000)));
  assert.equal(size.raw, 10_000);
  assert.ok(size.gzip < 100 && size.brotli < 100);
});

test('validateConfig explains mistakes', () => {
  assert.throws(() => validateConfig({}), /non-empty "budgets"/);
  assert.throws(() => validateConfig({ budgets: [{ max: '1kB' }] }), /"path" is required/);
  assert.throws(() => validateConfig({ budgets: [{ path: '*' }] }), /"max" and\/or "maxTotal"/);
  assert.throws(() => validateConfig({ budgets: [{ path: '*', max: 1, compression: 'zip' }] }), /compression/);
  assert.throws(() => validateConfig({ budgets: [{ path: '*', max: 'huge' }] }), /Invalid size/);
});

test('evaluate applies per-file and total limits with warnings and deltas', () => {
  const files = [
    { path: 'a.js', raw: 1000, gzip: 400, brotli: 350 },
    { path: 'b.js', raw: 2000, gzip: 950, brotli: 800 },
    { path: 'c.css', raw: 500, gzip: 200, brotli: 150 },
  ];
  const config = validateConfig({
    budgets: [
      { path: '*.js', max: 1000, maxTotal: 1200 },
      { path: '*.css', max: 1000, compression: 'raw', warnAt: 0.4 },
    ],
  });
  const baseline = [{ path: 'b.js', raw: 1900, gzip: 900, brotli: 780 }];
  const { results, status } = evaluate(files, config, baseline);

  assert.equal(status, 'fail');
  const [perFile, total, css] = results;
  assert.equal(perFile.status, 'warn'); // 950 > 90% of 1000
  assert.equal(perFile.size, 950);
  assert.equal(perFile.baseline, 900);
  assert.equal(total.status, 'fail'); // 1350 > 1200
  assert.equal(total.size, 1350);
  assert.equal(css.status, 'warn'); // 500 > 40% of 1000
});

test('reports render text and markdown', () => {
  const evaluation = evaluate(
    [{ path: 'big.js', raw: 5000, gzip: 3000, brotli: 2500 }],
    validateConfig({ budgets: [{ name: 'JS', path: '*.js', max: '2 kB' }] }),
  );
  const text = renderText(evaluation);
  assert.match(text, /✘ JS/);
  assert.match(text, /big\.js/);
  assert.match(text, /Budget exceeded/);
  const md = renderMarkdown(evaluation);
  assert.match(md, /### ❌ Performance budget exceeded/);
  assert.match(md, /\| ❌ \| JS \| per file · gzip \| 3.00 kB \| 2.00 kB \| 150% \|/);
  assert.match(md, /`big\.js` — 3\.00 kB/);
});

test('measureDirectory walks recursively with posix paths', async () => {
  const files = await measureDirectory(FIXTURE, { ignore: (p) => p === 'budget.json' });
  assert.deepEqual(files.map((f) => f.path), [
    'assets/css/main.css', 'assets/img/hero.webp', 'assets/js/app.js', 'assets/js/vendor.js', 'index.html',
  ]);
});

test('CLI passes on the fixture and saves/uses a baseline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bb-'));
  try {
    const baselinePath = join(dir, 'baseline.json');
    const first = await cli([FIXTURE, '-c', CONFIG, '--save-baseline', baselinePath]);
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /All budgets met/);
    const saved = JSON.parse(await readFile(baselinePath, 'utf8'));
    assert.equal(saved.files.length, 5);

    const md = await cli([FIXTURE, '-c', CONFIG, '-b', baselinePath, '--format', 'markdown', '-o', join(dir, 'report.md')]);
    assert.equal(md.code, 0);
    assert.match(md.out, /±0 B/);
    assert.equal((await readFile(join(dir, 'report.md'), 'utf8')).trim(), md.out.trim());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI exits 1 over budget, 0 with --warn-only, 2 on errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bb-'));
  try {
    await mkdir(join(dir, 'dist'));
    await writeFile(join(dir, 'dist', 'huge.js'), 'x'.repeat(5000));
    const cfg = join(dir, 'budget.json');
    await writeFile(cfg, JSON.stringify({ budgets: [{ path: '*.js', max: 100, compression: 'raw' }] }));

    const over = await cli([join(dir, 'dist'), '-c', cfg, '--format', 'json']);
    assert.equal(over.code, 1);
    assert.equal(JSON.parse(over.out).status, 'fail');
    assert.equal((await cli([join(dir, 'dist'), '-c', cfg, '--warn-only'])).code, 0);

    assert.equal((await cli([join(dir, 'dist'), '-c', join(dir, 'missing.json')])).code, 2);
    assert.equal((await cli(['--format', 'xml'])).code, 2);
    assert.equal((await cli(['--nope'])).code, 2);
    assert.match((await cli(['--help'])).out, /Usage: bundle-budget/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
