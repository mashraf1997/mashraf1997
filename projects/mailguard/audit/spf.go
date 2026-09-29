package audit

import "strings"

// SPF is a parsed SPF record, reduced to what the auditor needs.
type SPF struct {
	All      string   // qualifier of the "all" mechanism: "+", "-", "~", "?" or "" if absent
	Includes []string // include: targets, in order
	Redirect string   // redirect= modifier target
	Lookups  int      // DNS-querying terms in this record only (not recursive)
	UsesPTR  bool
}

// ParseSPF parses a "v=spf1 ..." record. Unknown terms are ignored.
func ParseSPF(record string) SPF {
	var s SPF
	fields := strings.Fields(record)
	for _, term := range fields[min(1, len(fields)):] {
		term = strings.ToLower(term)
		if name, value, ok := strings.Cut(term, "="); ok {
			if name == "redirect" {
				s.Redirect = value
				s.Lookups++
			}
			continue
		}
		qualifier := "+"
		if strings.ContainsAny(term[:1], "+-~?") {
			qualifier, term = term[:1], term[1:]
		}
		name, value, _ := strings.Cut(term, ":")
		if i := strings.Index(name, "/"); i >= 0 {
			name = name[:i]
		}
		switch name {
		case "all":
			s.All = qualifier
		case "include":
			s.Includes = append(s.Includes, value)
			s.Lookups++
		case "a", "mx", "exists":
			s.Lookups++
		case "ptr":
			s.Lookups++
			s.UsesPTR = true
		}
	}
	// A redirect is ignored when an "all" mechanism is present (RFC 7208 §6.1).
	if s.All != "" && s.Redirect != "" {
		s.Redirect = ""
		s.Lookups--
	}
	return s
}
