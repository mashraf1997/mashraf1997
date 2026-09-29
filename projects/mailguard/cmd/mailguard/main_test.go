package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestUsageErrors(t *testing.T) {
	for _, args := range [][]string{{}, {"-min-grade", "Z", "example.com"}, {"-bogus"}} {
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 64 {
			t.Errorf("run(%q) = %d, want 64", args, code)
		}
	}
}

func TestVersion(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := run([]string{"-version"}, &out, &errOut); code != 0 || !strings.HasPrefix(out.String(), "mailguard ") {
		t.Errorf("version: code %d, output %q", code, out.String())
	}
}
