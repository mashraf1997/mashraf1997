import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

/**
 * @typedef {{ path: string, raw: number, gzip: number, brotli: number }} FileSize
 */

/**
 * Recursively measures every file under `dir`. Compression uses the levels
 * CDNs typically serve static assets with (gzip 9, brotli 11).
 * @param {string} dir
 * @param {{ ignore?: (path: string) => boolean }} [options]
 * @returns {Promise<FileSize[]>}
 */
export async function measureDirectory(dir, { ignore = () => false } = {}) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .map((abs) => ({ abs, path: relative(dir, abs).split(sep).join('/') }))
    .filter(({ path }) => !ignore(path))
    .sort((a, b) => a.path.localeCompare(b.path));

  return Promise.all(files.map(async ({ abs, path }) => measureBuffer(path, await readFile(abs))));
}

/**
 * @param {string} path
 * @param {Buffer} buf
 * @returns {FileSize}
 */
export function measureBuffer(path, buf) {
  return {
    path,
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }).length,
  };
}
