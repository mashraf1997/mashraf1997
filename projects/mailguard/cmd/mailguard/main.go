// Command mailguard audits the email-authentication DNS records of one or
// more domains and prints a graded report.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/mashraf1997/mailguard/audit"
)

var version = "dev"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("mailguard", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "print the report as JSON")
	selectors := fs.String("selector", "", "comma-separated DKIM selectors to probe in addition to the defaults")
	minGrade := fs.String("min-grade", "", "exit with status 2 if any domain grades below this (A-F); useful in CI")
	timeout := fs.Duration("timeout", 15*time.Second, "overall DNS timeout per domain")
	noColor := fs.Bool("no-color", os.Getenv("NO_COLOR") != "", "disable colored output")
	showVersion := fs.Bool("version", false, "print version and exit")
	fs.Usage = func() {
		fmt.Fprintf(stderr, "Usage: mailguard [flags] domain [domain...]\n\nAudits MX, SPF, DKIM, DMARC, MTA-STS and TLS-RPT.\n\nFlags:\n")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 64
	}
	if *showVersion {
		fmt.Fprintln(stdout, "mailguard", version)
		return 0
	}
	if fs.NArg() == 0 {
		fs.Usage()
		return 64
	}
	if *minGrade != "" && audit.GradeRank(*minGrade) < 0 {
		fmt.Fprintf(stderr, "invalid -min-grade %q (want A-F)\n", *minGrade)
		return 64
	}

	a := audit.New()
	if *selectors != "" {
		a.Selectors = append(strings.Split(*selectors, ","), a.Selectors...)
	}

	reports := make([]audit.Report, fs.NArg())
	var wg sync.WaitGroup
	for i, d := range fs.Args() {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), *timeout)
			defer cancel()
			reports[i] = a.Run(ctx, d)
		}()
	}
	wg.Wait()

	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		if len(reports) == 1 {
			enc.Encode(reports[0])
		} else {
			enc.Encode(reports)
		}
	} else {
		p := printer{w: stdout, color: !*noColor && isTerminal(stdout)}
		for i, r := range reports {
			if i > 0 {
				fmt.Fprintln(stdout)
			}
			p.report(r)
		}
	}

	if *minGrade != "" {
		for _, r := range reports {
			if audit.GradeRank(r.Grade) < audit.GradeRank(*minGrade) {
				return 2
			}
		}
	}
	return 0
}

type printer struct {
	w     io.Writer
	color bool
}

func (p printer) paint(code, s string) string {
	if !p.color {
		return s
	}
	return "\x1b[" + code + "m" + s + "\x1b[0m"
}

func (p printer) report(r audit.Report) {
	gradeColor := map[string]string{"A": "32", "B": "32", "C": "33", "D": "33", "F": "31"}[r.Grade]
	fmt.Fprintf(p.w, "%s  %s\n", p.paint("1", "mailguard · "+r.Domain),
		p.paint("1;"+gradeColor, fmt.Sprintf("Grade %s (%d/100)", r.Grade, r.Score)))
	fmt.Fprintln(p.w, strings.Repeat("─", 60))
	for _, f := range r.Findings {
		icon := map[audit.Status]string{
			audit.Pass: p.paint("32", "✔"),
			audit.Warn: p.paint("33", "!"),
			audit.Fail: p.paint("31", "✘"),
		}[f.Status]
		fmt.Fprintf(p.w, " %s %-8s %s\n", icon, f.Check, f.Detail)
		for _, adv := range f.Advice {
			fmt.Fprintf(p.w, "   %s %s\n", p.paint("2", "→"), p.paint("2", adv))
		}
	}
}

func isTerminal(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	st, err := f.Stat()
	return err == nil && st.Mode()&os.ModeCharDevice != 0
}
