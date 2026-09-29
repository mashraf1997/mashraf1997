package audit

import (
	"context"
	"net"
	"strings"
	"testing"
)

type fakeResolver struct {
	txt map[string][]string
	mx  map[string][]*net.MX
}

func (f fakeResolver) LookupTXT(_ context.Context, name string) ([]string, error) {
	if recs, ok := f.txt[name]; ok {
		return recs, nil
	}
	return nil, &net.DNSError{Err: "no such host", Name: name, IsNotFound: true}
}

func (f fakeResolver) LookupMX(_ context.Context, name string) ([]*net.MX, error) {
	if recs, ok := f.mx[name]; ok {
		return recs, nil
	}
	return nil, &net.DNSError{Err: "no such host", Name: name, IsNotFound: true}
}

var strongKey = "p=" + strings.Repeat("A", 392)

func hardenedDomain() fakeResolver {
	return fakeResolver{
		txt: map[string][]string{
			"example.com":                   {"v=spf1 include:_spf.mail.test -all", "google-site-verification=abc"},
			"_spf.mail.test":                {"v=spf1 ip4:192.0.2.0/24 include:_spf2.mail.test ~all"},
			"_spf2.mail.test":               {"v=spf1 ip6:2001:db8::/32 ~all"},
			"_dmarc.example.com":            {"v=DMARC1; p=reject; rua=mailto:dmarc@example.com"},
			"google._domainkey.example.com": {"v=DKIM1; k=rsa; " + strongKey},
			"_mta-sts.example.com":          {"v=STSv1; id=20260101"},
			"_smtp._tls.example.com":        {"v=TLSRPTv1; rua=mailto:tls@example.com"},
		},
		mx: map[string][]*net.MX{
			"example.com": {{Host: "mx2.mail.test.", Pref: 20}, {Host: "mx1.mail.test.", Pref: 10}},
		},
	}
}

func run(t *testing.T, r fakeResolver, domain string) Report {
	t.Helper()
	a := &Auditor{Resolver: r, Selectors: DefaultSelectors}
	return a.Run(context.Background(), domain)
}

func finding(t *testing.T, rep Report, check string) Finding {
	t.Helper()
	for _, f := range rep.Findings {
		if f.Check == check {
			return f
		}
	}
	t.Fatalf("no %s finding", check)
	return Finding{}
}

func TestHardenedDomainScoresA(t *testing.T) {
	rep := run(t, hardenedDomain(), "Postmaster@Example.COM.")
	if rep.Domain != "example.com" {
		t.Errorf("domain = %q, want example.com", rep.Domain)
	}
	for _, f := range rep.Findings {
		if f.Status != Pass {
			t.Errorf("%s: status %s (%s), want pass", f.Check, f.Status, f.Detail)
		}
	}
	if rep.Score != 100 || rep.Grade != "A" {
		t.Errorf("score %d grade %s, want 100 A", rep.Score, rep.Grade)
	}
	if mx := finding(t, rep, "MX"); !strings.HasPrefix(mx.Detail, "2 mail exchanger(s): mx1.mail.test (10)") {
		t.Errorf("MX not sorted by preference: %s", mx.Detail)
	}
	if spf := finding(t, rep, "SPF"); !strings.Contains(spf.Detail, "2/10") {
		t.Errorf("SPF lookups should be counted recursively: %s", spf.Detail)
	}
}

func TestBareDomainFails(t *testing.T) {
	rep := run(t, fakeResolver{}, "nothing.test")
	if rep.Grade != "F" {
		t.Errorf("grade %s, want F", rep.Grade)
	}
	for _, check := range []string{"MX", "SPF", "DMARC"} {
		if f := finding(t, rep, check); f.Status != Fail {
			t.Errorf("%s: %s, want fail", check, f.Status)
		}
	}
}

func TestSPFProblems(t *testing.T) {
	cases := []struct {
		name   string
		txt    map[string][]string
		status Status
		want   string
	}{
		{"soft fail", map[string][]string{"d.test": {"v=spf1 mx ~all"}}, Warn, "soft-fail"},
		{"plus all", map[string][]string{"d.test": {"v=spf1 +all"}}, Fail, "+all"},
		{"no all", map[string][]string{"d.test": {"v=spf1 mx"}}, Fail, "no terminating"},
		{"redirect ok", map[string][]string{"d.test": {"v=spf1 redirect=spf.d.test"}, "spf.d.test": {"v=spf1 -all"}}, Pass, "1/10"},
		{"duplicate", map[string][]string{"d.test": {"v=spf1 -all", "v=spf1 mx -all"}}, Fail, "2 SPF records"},
		{"ptr", map[string][]string{"d.test": {"v=spf1 ptr -all"}}, Warn, "ptr"},
		{"loop", map[string][]string{"d.test": {"v=spf1 include:d.test -all"}}, Warn, "loop"},
		{"too many lookups", map[string][]string{"d.test": {"v=spf1 a mx a:1.d.test a:2.d.test a:3.d.test a:4.d.test a:5.d.test a:6.d.test a:7.d.test mx:8.d.test exists:9.d.test -all"}}, Fail, "11 DNS lookups"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := finding(t, run(t, fakeResolver{txt: tc.txt}, "d.test"), "SPF")
			if f.Status != tc.status || !strings.Contains(f.Detail, tc.want) {
				t.Errorf("got %s %q, want %s containing %q", f.Status, f.Detail, tc.status, tc.want)
			}
		})
	}
}

func TestDMARCPolicies(t *testing.T) {
	cases := map[string]Status{
		"v=DMARC1; p=reject; rua=mailto:a@d.test":         Pass,
		"v=DMARC1; p=quarantine; rua=mailto:a@d.test":     Pass,
		"v=DMARC1; p=reject; pct=50; rua=mailto:a@d.test": Warn,
		"v=DMARC1; p=none; rua=mailto:a@d.test":           Warn,
		"v=DMARC1; p=reject":                              Warn,
		"v=DMARC1; p=bogus":                               Fail,
		"v=DMARC1;p=reject;rua=mailto:a@d.test":           Pass,
	}
	for rec, want := range cases {
		r := fakeResolver{txt: map[string][]string{"_dmarc.d.test": {rec}}}
		if f := finding(t, run(t, r, "d.test"), "DMARC"); f.Status != want {
			t.Errorf("%q: %s (%s), want %s", rec, f.Status, f.Detail, want)
		}
	}
}

func TestDKIMKeyStrength(t *testing.T) {
	weak := "v=DKIM1; k=rsa; p=" + strings.Repeat("B", 216)
	r := fakeResolver{txt: map[string][]string{"s1._domainkey.d.test": {weak}}}
	if f := finding(t, run(t, r, "d.test"), "DKIM"); f.Status != Warn || !strings.Contains(f.Detail, "weak") {
		t.Errorf("weak key: %s %q", f.Status, f.Detail)
	}
	r = fakeResolver{txt: map[string][]string{"mail._domainkey.d.test": {"v=DKIM1; p="}}}
	if f := finding(t, run(t, r, "d.test"), "DKIM"); !strings.Contains(f.Detail, "revoked") {
		t.Errorf("revoked key: %q", f.Detail)
	}
}

func TestNullMX(t *testing.T) {
	r := fakeResolver{mx: map[string][]*net.MX{"d.test": {{Host: ".", Pref: 0}}}}
	if f := finding(t, run(t, r, "d.test"), "MX"); f.Status != Pass || !strings.Contains(f.Detail, "null MX") {
		t.Errorf("null MX: %s %q", f.Status, f.Detail)
	}
}

func TestParseSPF(t *testing.T) {
	s := ParseSPF("v=spf1 ip4:1.2.3.4 a/24 mx include:a.test include:b.test exists:%{i}.x.test ?all redirect=c.test")
	if s.All != "?" || s.Redirect != "" || s.Lookups != 5 || len(s.Includes) != 2 {
		t.Errorf("unexpected parse: %+v", s)
	}
}

func TestScoreAndGrade(t *testing.T) {
	fs := []Finding{{Weight: 50, Status: Pass}, {Weight: 30, Status: Warn}, {Weight: 20, Status: Fail}}
	if got := Score(fs); got != 65 {
		t.Errorf("score = %d, want 65", got)
	}
	if Grade(65) != "C" || Grade(90) != "A" || Grade(49) != "F" {
		t.Error("grade boundaries wrong")
	}
	if GradeRank("A") <= GradeRank("b") || GradeRank("?") != -1 {
		t.Error("grade rank ordering wrong")
	}
}
