// Package audit inspects the DNS records that decide whether a domain's email
// is trusted: MX, SPF, DKIM, DMARC, MTA-STS and TLS-RPT.
package audit

import (
	"context"
	"errors"
	"net"
	"strings"
)

// Status is the outcome of a single check.
type Status string

const (
	Pass Status = "pass"
	Warn Status = "warn"
	Fail Status = "fail"
)

// Finding describes the result of one check.
type Finding struct {
	Check  string   `json:"check"`
	Status Status   `json:"status"`
	Weight int      `json:"weight"`
	Detail string   `json:"detail"`
	Advice []string `json:"advice,omitempty"`
	Record string   `json:"record,omitempty"`
}

// Report is the full audit of a domain.
type Report struct {
	Domain   string    `json:"domain"`
	Score    int       `json:"score"`
	Grade    string    `json:"grade"`
	Findings []Finding `json:"findings"`
}

// Resolver is the subset of DNS lookups the auditor needs. *net.Resolver
// satisfies it; tests use an in-memory implementation.
type Resolver interface {
	LookupTXT(ctx context.Context, name string) ([]string, error)
	LookupMX(ctx context.Context, name string) ([]*net.MX, error)
}

// DefaultSelectors are DKIM selectors used by common providers. DKIM
// selectors cannot be enumerated from DNS, so we probe the usual suspects.
var DefaultSelectors = []string{
	"default", "google", "selector1", "selector2", "k1", "k2", "k3",
	"mail", "dkim", "s1", "s2", "smtp", "mx", "zoho", "mandrill", "pm",
}

// Auditor runs every check against a domain.
type Auditor struct {
	Resolver  Resolver
	Selectors []string
}

// New returns an Auditor that uses the system resolver.
func New() *Auditor {
	return &Auditor{Resolver: net.DefaultResolver, Selectors: DefaultSelectors}
}

// Run audits the domain and returns a scored report.
func (a *Auditor) Run(ctx context.Context, domain string) Report {
	domain = normalizeDomain(domain)
	findings := []Finding{
		a.checkMX(ctx, domain),
		a.checkSPF(ctx, domain),
		a.checkDKIM(ctx, domain),
		a.checkDMARC(ctx, domain),
		a.checkMTASTS(ctx, domain),
		a.checkTLSRPT(ctx, domain),
	}
	score := Score(findings)
	return Report{Domain: domain, Score: score, Grade: Grade(score), Findings: findings}
}

// Score converts findings to a 0-100 score: a pass earns the full weight,
// a warning half of it and a failure nothing.
func Score(findings []Finding) int {
	var earned, total int
	for _, f := range findings {
		total += f.Weight
		switch f.Status {
		case Pass:
			earned += f.Weight * 2
		case Warn:
			earned += f.Weight
		}
	}
	if total == 0 {
		return 0
	}
	return (earned*100 + total) / (total * 2)
}

// Grade maps a score to a letter grade.
func Grade(score int) string {
	switch {
	case score >= 90:
		return "A"
	case score >= 80:
		return "B"
	case score >= 65:
		return "C"
	case score >= 50:
		return "D"
	default:
		return "F"
	}
}

// GradeRank orders grades so callers can compare them; unknown grades rank lowest.
func GradeRank(g string) int {
	return strings.Index("FDCBA", strings.ToUpper(g))
}

func normalizeDomain(d string) string {
	d = strings.TrimSpace(strings.ToLower(d))
	d = strings.TrimPrefix(d, "mailto:")
	if i := strings.LastIndex(d, "@"); i >= 0 {
		d = d[i+1:]
	}
	return strings.TrimSuffix(d, ".")
}

// lookupTXT treats "no such host" as an empty answer rather than an error.
func lookupTXT(ctx context.Context, r Resolver, name string) ([]string, error) {
	recs, err := r.LookupTXT(ctx, name)
	if isNotFound(err) {
		return nil, nil
	}
	return recs, err
}

// txtWithPrefix returns the TXT records at name that start with prefix
// (case-insensitively), e.g. "v=spf1".
func txtWithPrefix(ctx context.Context, r Resolver, name, prefix string) ([]string, error) {
	recs, err := lookupTXT(ctx, r, name)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, rec := range recs {
		t := strings.TrimSpace(rec)
		if len(t) >= len(prefix) && strings.EqualFold(t[:len(prefix)], prefix) &&
			(len(t) == len(prefix) || t[len(prefix)] == ' ' || t[len(prefix)] == ';') {
			out = append(out, t)
		}
	}
	return out, nil
}

func isNotFound(err error) bool {
	var dnsErr *net.DNSError
	return errors.As(err, &dnsErr) && dnsErr.IsNotFound
}

// parseTags parses "k=v; k2=v2" records used by DMARC, DKIM, MTA-STS and TLS-RPT.
func parseTags(record string) map[string]string {
	tags := map[string]string{}
	for _, part := range strings.Split(record, ";") {
		k, v, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		tags[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
	}
	return tags
}
