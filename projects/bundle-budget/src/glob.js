/**
 * Compiles a glob to a RegExp. Supports `**` (any depth), `*`, `?`,
 * `{a,b}` alternation and `[abc]` classes. Paths always use forward slashes.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let re = '';
  let inGroup = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { inGroup++; re += '(?:'; }
    else if (c === '}' && inGroup) { inGroup--; re += ')'; }
    else if (c === ',' && inGroup) re += '|';
    else if (c === '[') {
      const end = glob.indexOf(']', i);
      if (end === -1) re += '\\[';
      else { re += glob.slice(i, end + 1).replace(/^\[!/, '[^'); i = end; }
    } else re += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * @param {string} path
 * @param {string | string[]} patterns
 */
export function matches(path, patterns) {
  return [patterns].flat().some((p) => globToRegExp(p).test(path));
}
