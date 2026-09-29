# mailguard

**Audit a domain's email security in one command.** mailguard checks the DNS records that decide whether your mail lands in the inbox or gets spoofed — MX, SPF, DKIM, DMARC, MTA-STS and TLS-RPT — then grades the domain and tells you exactly what to fix.

Built from the day-to-day work behind [Bosta](https://bosta.email/), our business email hosting platform.

```text
$ mailguard example.com
mailguard · example.com  Grade B (85/100)
────────────────────────────────────────────────────────────
 ✔ MX       2 mail exchanger(s): mx1.mail.test (10), mx2.mail.test (20)
 ✔ SPF      valid, strict policy (3/10 DNS lookups)
 ✔ DKIM     keys found for selector(s): google
 ! DMARC    monitoring only (p=none)
   → After reviewing reports, move to p=quarantine then p=reject.
 ✔ MTA-STS  published (id=20260101)
 ✔ TLS-RPT  reports sent to mailto:tls@example.com
```

## Features

- **SPF** — detects duplicate records, `+all` / `?all`, missing terminators, deprecated `ptr`, include loops, and counts DNS lookups **recursively** against the RFC 7208 limit of 10.
- **DKIM** — probes 16 common provider selectors (plus your own), flags revoked and weak 1024-bit RSA keys.
- **DMARC** — validates policy, `pct` and aggregate reporting (`rua`).
- **MX** — sorted by preference, understands null MX (RFC 7505).
- **MTA-STS & TLS-RPT** — transport security for inbound mail.
- **Weighted score and A–F grade**, with concrete advice for every warning.
- **CI-ready** — `-json` output and `-min-grade` exit codes let you block deploys when DNS drifts.
- **Zero dependencies** — pure Go standard library; audits multiple domains concurrently.

## Install

```bash
go install github.com/mashraf1997/mailguard/cmd/mailguard@latest
# or from this repository
cd projects/mailguard && go build -o mailguard ./cmd/mailguard
```

## Usage

```bash
mailguard example.com                       # human-readable report
mailguard -selector s2048 example.com       # also probe your own DKIM selector
mailguard -json example.com other.org       # machine-readable, several domains at once
mailguard -min-grade B example.com          # exit 2 if the grade is below B
```

| Flag | Description |
| :--- | :--- |
| `-json` | Print the report as JSON |
| `-selector` | Comma-separated DKIM selectors to probe in addition to the defaults |
| `-min-grade` | Exit with status `2` when any domain grades below this letter |
| `-timeout` | DNS timeout per domain (default `15s`) |
| `-no-color` | Disable ANSI colors (also honors `NO_COLOR`) |

### Guard your DNS in GitHub Actions

```yaml
- uses: actions/setup-go@v5
  with: { go-version: stable }
- run: go install github.com/mashraf1997/mailguard/cmd/mailguard@latest
- run: mailguard -min-grade A yourdomain.com
```

## Scoring

| Check | Weight | Pass | Warn (half credit) | Fail |
| :--- | ---: | :--- | :--- | :--- |
| DMARC | 30 | `p=quarantine`/`reject`, reports on | `p=none`, `pct<100`, no `rua` | missing / invalid |
| SPF | 25 | single record, `-all`, ≤10 lookups | `~all`, `ptr` | missing, duplicate, `+all`, >10 lookups |
| DKIM | 20 | 2048-bit+ key found | weak / revoked / not found | — |
| MX | 10 | at least one MX | — | none |
| MTA-STS | 8 | published | missing | — |
| TLS-RPT | 7 | published | missing | — |

Grades: **A** ≥ 90 · **B** ≥ 80 · **C** ≥ 65 · **D** ≥ 50 · **F** below.

## Use as a library

```go
a := audit.New()                        // system resolver + default selectors
report := a.Run(ctx, "example.com")
fmt.Println(report.Grade, report.Score)
```

`audit.Auditor` accepts any `Resolver`, so it is fully testable without network access.

## Development

```bash
go test ./...
go vet ./...
```

## License

MIT
