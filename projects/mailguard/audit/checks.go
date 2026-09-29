package audit

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

func (a *Auditor) checkMX(ctx context.Context, domain string) Finding {
	f := Finding{Check: "MX", Weight: 10}
	mxs, err := a.Resolver.LookupMX(ctx, domain)
	if err != nil && !isNotFound(err) {
		f.Status, f.Detail = Fail, "MX lookup failed: "+err.Error()
		return f
	}
	if len(mxs) == 0 {
		f.Status, f.Detail = Fail, "no MX records — the domain cannot receive mail"
		f.Advice = []string{"Publish at least one MX record pointing at your mail provider."}
		return f
	}
	if len(mxs) == 1 && (mxs[0].Host == "." || mxs[0].Host == "") {
		f.Status, f.Detail = Pass, "null MX (RFC 7505): domain explicitly accepts no mail"
		return f
	}
	sort.Slice(mxs, func(i, j int) bool { return mxs[i].Pref < mxs[j].Pref })
	hosts := make([]string, len(mxs))
	for i, mx := range mxs {
		hosts[i] = fmt.Sprintf("%s (%d)", strings.TrimSuffix(mx.Host, "."), mx.Pref)
	}
	f.Status = Pass
	f.Detail = fmt.Sprintf("%d mail exchanger(s): %s", len(mxs), strings.Join(hosts, ", "))
	if len(mxs) == 1 {
		f.Advice = []string{"Consider a backup MX, or confirm your provider handles failover."}
	}
	return f
}

func (a *Auditor) checkSPF(ctx context.Context, domain string) Finding {
	f := Finding{Check: "SPF", Weight: 25}
	recs, err := txtWithPrefix(ctx, a.Resolver, domain, "v=spf1")
	switch {
	case err != nil:
		f.Status, f.Detail = Fail, "TXT lookup failed: "+err.Error()
		return f
	case len(recs) == 0:
		f.Status, f.Detail = Fail, "no SPF record"
		f.Advice = []string{`Publish a TXT record such as "v=spf1 include:<your-provider> -all".`}
		return f
	case len(recs) > 1:
		f.Status, f.Detail = Fail, fmt.Sprintf("%d SPF records found — receivers treat this as a permanent error", len(recs))
		f.Advice = []string{"Merge all SPF records into a single TXT record."}
		return f
	}
	f.Record = recs[0]
	spf := ParseSPF(recs[0])
	lookups, lerr := a.countSPFLookups(ctx, domain, map[string]bool{}, 0)

	var problems, advice []string
	status := Pass
	switch spf.All {
	case "-":
		// strict: ideal
	case "~":
		status = Warn
		problems = append(problems, "soft-fail (~all)")
		advice = append(advice, "Move to -all once every legitimate sender is listed.")
	case "+":
		status = Fail
		problems = append(problems, "+all authorizes the entire internet")
		advice = append(advice, "Replace +all with -all immediately.")
	case "?":
		status = Fail
		problems = append(problems, "neutral ?all gives no protection")
		advice = append(advice, "End the record with -all (or ~all while testing).")
	default:
		if spf.Redirect == "" {
			status = Fail
			problems = append(problems, "no terminating all mechanism")
			advice = append(advice, "End the record with -all.")
		}
	}
	if spf.UsesPTR {
		status = worst(status, Warn)
		problems = append(problems, "uses the deprecated ptr mechanism")
		advice = append(advice, "Remove ptr; it is slow and discouraged by RFC 7208.")
	}
	if lerr != nil {
		status = worst(status, Warn)
		problems = append(problems, lerr.Error())
	} else if lookups > 10 {
		status = Fail
		problems = append(problems, fmt.Sprintf("%d DNS lookups exceeds the limit of 10", lookups))
		advice = append(advice, "Flatten includes or drop unused senders to stay within 10 lookups.")
	}

	f.Status = status
	if len(problems) == 0 {
		f.Detail = fmt.Sprintf("valid, strict policy (%d/10 DNS lookups)", lookups)
	} else {
		f.Detail = fmt.Sprintf("%s (%d/10 DNS lookups)", strings.Join(problems, "; "), lookups)
	}
	f.Advice = advice
	return f
}

// countSPFLookups counts DNS-querying terms recursively, as RFC 7208 §4.6.4 requires.
func (a *Auditor) countSPFLookups(ctx context.Context, domain string, seen map[string]bool, depth int) (int, error) {
	if depth > 10 {
		return 0, fmt.Errorf("SPF include chain too deep")
	}
	if seen[domain] {
		return 0, fmt.Errorf("SPF include loop at %s", domain)
	}
	seen[domain] = true
	defer delete(seen, domain)

	recs, err := txtWithPrefix(ctx, a.Resolver, domain, "v=spf1")
	if err != nil {
		return 0, fmt.Errorf("lookup of %s failed", domain)
	}
	if len(recs) != 1 {
		if depth == 0 {
			return 0, nil
		}
		return 0, fmt.Errorf("included domain %s has %d SPF records", domain, len(recs))
	}
	spf := ParseSPF(recs[0])
	count := spf.Lookups
	for _, inc := range append(append([]string{}, spf.Includes...), spf.Redirect) {
		if inc == "" || strings.Contains(inc, "%") {
			continue // macros cannot be resolved statically
		}
		n, err := a.countSPFLookups(ctx, inc, seen, depth+1)
		count += n
		if err != nil {
			return count, err
		}
	}
	return count, nil
}

func (a *Auditor) checkDKIM(ctx context.Context, domain string) Finding {
	f := Finding{Check: "DKIM", Weight: 20}
	var found, weak, revoked []string
	for _, sel := range a.Selectors {
		recs, err := lookupTXT(ctx, a.Resolver, sel+"._domainkey."+domain)
		if err != nil {
			continue
		}
		for _, rec := range recs {
			tags := parseTags(rec)
			if v, ok := tags["v"]; ok && !strings.EqualFold(v, "DKIM1") {
				continue
			}
			p, ok := tags["p"]
			if !ok {
				continue
			}
			switch {
			case p == "":
				revoked = append(revoked, sel)
			case strings.EqualFold(tags["k"], "rsa") || tags["k"] == "":
				// base64 of a 1024-bit RSA SubjectPublicKeyInfo is ~216 chars; 2048-bit is ~392.
				if len(strings.ReplaceAll(p, " ", "")) < 300 {
					weak = append(weak, sel)
				} else {
					found = append(found, sel)
				}
			default:
				found = append(found, sel) // ed25519 and friends
			}
		}
	}
	switch {
	case len(found) > 0:
		f.Status = Pass
		f.Detail = "keys found for selector(s): " + strings.Join(found, ", ")
		if len(weak) > 0 {
			f.Status = Warn
			f.Detail += "; weak (≤1024-bit) keys: " + strings.Join(weak, ", ")
			f.Advice = []string{"Rotate 1024-bit keys to 2048-bit RSA."}
		}
	case len(weak) > 0:
		f.Status = Warn
		f.Detail = "only weak (≤1024-bit) keys found: " + strings.Join(weak, ", ")
		f.Advice = []string{"Rotate to 2048-bit RSA keys."}
	case len(revoked) > 0:
		f.Status = Warn
		f.Detail = "only revoked keys found: " + strings.Join(revoked, ", ")
		f.Advice = []string{"Publish an active DKIM key for your sending service."}
	default:
		f.Status = Warn
		f.Detail = fmt.Sprintf("no DKIM key among %d probed selectors", len(a.Selectors))
		f.Advice = []string{"Enable DKIM signing, or pass your selector with -selector to verify it."}
	}
	return f
}

func (a *Auditor) checkDMARC(ctx context.Context, domain string) Finding {
	f := Finding{Check: "DMARC", Weight: 30}
	recs, err := txtWithPrefix(ctx, a.Resolver, "_dmarc."+domain, "v=DMARC1")
	switch {
	case err != nil:
		f.Status, f.Detail = Fail, "TXT lookup failed: "+err.Error()
		return f
	case len(recs) == 0:
		f.Status, f.Detail = Fail, "no DMARC record — spoofed mail is not rejected"
		f.Advice = []string{`Start with "v=DMARC1; p=none; rua=mailto:dmarc@` + domain + `" and tighten to p=reject.`}
		return f
	case len(recs) > 1:
		f.Status, f.Detail = Fail, "multiple DMARC records — receivers will ignore them"
		f.Advice = []string{"Keep exactly one DMARC record."}
		return f
	}
	f.Record = recs[0]
	tags := parseTags(recs[0])
	pct := 100
	if v, ok := tags["pct"]; ok {
		if n, err := strconv.Atoi(v); err == nil {
			pct = n
		}
	}
	var notes []string
	switch strings.ToLower(tags["p"]) {
	case "reject":
		f.Status = Pass
		notes = append(notes, "policy p=reject")
	case "quarantine":
		f.Status = Pass
		notes = append(notes, "policy p=quarantine")
		f.Advice = append(f.Advice, "Move to p=reject for full spoofing protection.")
	case "none":
		f.Status = Warn
		notes = append(notes, "monitoring only (p=none)")
		f.Advice = append(f.Advice, "After reviewing reports, move to p=quarantine then p=reject.")
	default:
		f.Status = Fail
		notes = append(notes, "missing or invalid p= tag")
		f.Advice = append(f.Advice, "Add a valid policy: p=none, p=quarantine or p=reject.")
	}
	if pct < 100 && f.Status == Pass {
		f.Status = Warn
		notes = append(notes, fmt.Sprintf("applied to only %d%% of mail", pct))
		f.Advice = append(f.Advice, "Raise pct to 100.")
	}
	if tags["rua"] == "" {
		f.Status = worst(f.Status, Warn)
		notes = append(notes, "no aggregate reports (rua)")
		f.Advice = append(f.Advice, "Add rua=mailto:... to receive aggregate reports.")
	}
	f.Detail = strings.Join(notes, "; ")
	return f
}

func (a *Auditor) checkMTASTS(ctx context.Context, domain string) Finding {
	f := Finding{Check: "MTA-STS", Weight: 8}
	recs, err := txtWithPrefix(ctx, a.Resolver, "_mta-sts."+domain, "v=STSv1")
	switch {
	case err != nil:
		f.Status, f.Detail = Warn, "TXT lookup failed: "+err.Error()
	case len(recs) == 0:
		f.Status, f.Detail = Warn, "not configured — inbound TLS can be downgraded"
		f.Advice = []string{"Publish _mta-sts TXT and a policy at https://mta-sts." + domain + "/.well-known/mta-sts.txt."}
	default:
		f.Status, f.Record = Pass, recs[0]
		f.Detail = "published (id=" + parseTags(recs[0])["id"] + ")"
	}
	return f
}

func (a *Auditor) checkTLSRPT(ctx context.Context, domain string) Finding {
	f := Finding{Check: "TLS-RPT", Weight: 7}
	recs, err := txtWithPrefix(ctx, a.Resolver, "_smtp._tls."+domain, "v=TLSRPTv1")
	switch {
	case err != nil:
		f.Status, f.Detail = Warn, "TXT lookup failed: "+err.Error()
	case len(recs) == 0:
		f.Status, f.Detail = Warn, "not configured — TLS delivery failures go unreported"
		f.Advice = []string{`Publish _smtp._tls TXT "v=TLSRPTv1; rua=mailto:tls-reports@` + domain + `".`}
	default:
		f.Status, f.Record = Pass, recs[0]
		f.Detail = "reports sent to " + parseTags(recs[0])["rua"]
	}
	return f
}

func worst(a, b Status) Status {
	rank := map[Status]int{Pass: 0, Warn: 1, Fail: 2}
	if rank[b] > rank[a] {
		return b
	}
	return a
}
