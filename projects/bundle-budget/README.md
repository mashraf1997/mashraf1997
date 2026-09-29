# bundle-budget

**Performance budgets for your build output. It has no dependencies and is built for CI.** bundle-budget measures every file your build produces (raw, gzip and brotli), checks the results against the limits you set, compares them with the previous build, and writes a Markdown report you can post straight onto a pull request.

This is the guardrail we use at [MirrorORG](https://mirrororg.com/) to keep client sites above 95 on PageSpeed long after launch day.

```text
$ bundle-budget dist
bundle-budget
────────────────────────────────────────────────────────────
 ✔ JavaScript             148.2 kB / 170.0 kB brotli (largest file)
 ! CSS                    46.1 kB / 50.0 kB gzip (largest file)   +3.20 kB
 ✘ Images                 612.0 kB / 500.0 kB raw (largest file)
     ✘ img/hero.png  612.0 kB
 ✔ Everything             1.21 MB / 2.00 MB raw (total)   −40.3 kB
────────────────────────────────────────────────────────────
✘ Budget exceeded.
```

## Features

- **Measures what users download.** Sizes are computed with gzip level 9 and brotli quality 11, the levels CDNs typically serve.
- **Per-file limits (`max`) and total limits (`maxTotal`)** on any glob, including `**`, `{a,b}`, `?` and `[...]`.
- **Early warnings.** A budget is flagged when it passes `warnAt` (default 90%) of its limit.
- **Baselines.** `--save-baseline` records a build and `--baseline` shows the size change for each budget.
- **Three output formats.** Colored terminal output, Markdown for PR comments, and JSON for dashboards.
- **CI exit codes.** `0` means within budget, `1` means a budget was exceeded, and `2` means a config or usage error.
- **No dependencies.** It uses only Node's built-in modules (`zlib`, `fs`, `util.parseArgs`).

## Usage

```bash
node projects/bundle-budget/bin/bundle-budget.js dist             # from this repository
npx bundle-budget dist                                            # once installed as a dependency
bundle-budget dist --format markdown -o budget-report.md
bundle-budget dist --save-baseline .budget/main.json              # on your main branch
bundle-budget dist --baseline .budget/main.json                   # on pull requests
```

## Configuration

Put the config in `budget.json`, in a `"budget"` key of `package.json`, or pass it with `--config`:

```json
{
  "ignore": ["**/*.map"],
  "budgets": [
    { "name": "JavaScript", "path": "**/*.js",  "max": "170 kB", "maxTotal": "350 kB", "compression": "brotli" },
    { "name": "CSS",        "path": "**/*.css", "max": "50 kB" },
    { "name": "Fonts",      "path": "**/*.{woff2,woff}", "maxTotal": "150 kB", "compression": "raw" },
    { "name": "Images",     "path": "**/*.{png,jpg,webp,avif}", "max": "500 kB", "compression": "raw", "warnAt": 0.8 },
    { "name": "Everything", "path": "**", "maxTotal": "2 MB", "compression": "raw" }
  ]
}
```

| Key | Description |
| :--- | :--- |
| `path` | A glob, or an array of globs, relative to the build directory |
| `max` | Limit for each matching file |
| `maxTotal` | Limit for the sum of all matching files |
| `compression` | `gzip` (default), `brotli` or `raw` |
| `warnAt` | Fraction of the limit at which a warning is raised (default `0.9`) |
| `name` | Label shown in reports |

Sizes accept `B`, `kB`, `MB`, `GB` (decimal, matching what Lighthouse reports) and `KiB`, `MiB`, `GiB` (binary).

## GitHub Actions

```yaml
- run: npm run build
- run: node tools/bundle-budget/bin/bundle-budget.js dist --format markdown -o budget.md
- uses: marocchino/sticky-pull-request-comment@v2
  if: always() && github.event_name == 'pull_request'
  with:
    path: budget.md
```

## Programmatic API

```js
import { measureDirectory, evaluate, validateConfig, renderMarkdown } from '@mirrororg/bundle-budget';

const files = await measureDirectory('dist');
const result = evaluate(files, validateConfig(config));
console.log(renderMarkdown(result));
```

## Development

```bash
npm test          # node:test suite
npm run check     # run the CLI against the bundled fixture site
```

## License

MIT
