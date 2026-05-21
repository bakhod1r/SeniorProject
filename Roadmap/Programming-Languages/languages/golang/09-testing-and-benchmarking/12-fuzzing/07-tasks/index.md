---
layout: default
title: Fuzzing — Tasks
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/07-tasks/
---

# Fuzzing — Tasks

[← Back](../)

A graded set of exercises. Each task is self-contained; solutions follow
the specification page. Pick the one matching your level and copy-paste
into a scratch module to experiment. The point is to feel the engine
work, not to read other people's code — please run every snippet.

## Task 1 — Write your first fuzz target

Goal: round-trip a `strings.ToUpper` / `strings.ToLower` pair.

```go
package mypkg

import (
    "strings"
    "testing"
)

func FuzzCaseRoundTrip(f *testing.F) {
    f.Add("hello")
    f.Add("HELLO")
    f.Add("")
    f.Fuzz(func(t *testing.T, s string) {
        if strings.ToLower(strings.ToUpper(s)) != strings.ToLower(s) {
            t.Errorf("case round trip failed for %q", s)
        }
    })
}
```

Run with `go test -fuzz=FuzzCaseRoundTrip -fuzztime=5s`. The Turkish
dotted-I characters (`U+0130`, `U+0131`) and certain Greek capital
letters will produce a counterexample within seconds. Inspect the file
the runtime saves in `testdata/fuzz/FuzzCaseRoundTrip/`.

The lesson: case mapping is not a simple bijection for Unicode. The
fuzzer surfaced this property failure faster than any human review.

## Task 2 — JSON encode/decode invariant

Write `FuzzJSONRoundTrip` that asserts
`json.Unmarshal(json.Marshal(x))` equals `x` for `map[string]string`.
You will quickly hit the limitation that the native engine only takes
basic types — turn the input into a slice of strings that you fold
pairwise into a map. Skeleton:

```go
func FuzzJSONRoundTrip(f *testing.F) {
    f.Add("key", "value")
    f.Add("", "")
    f.Fuzz(func(t *testing.T, k, v string) {
        m := map[string]string{k: v}
        bytes, err := json.Marshal(m)
        if err != nil {
            t.Skip()
        }
        var out map[string]string
        if err := json.Unmarshal(bytes, &out); err != nil {
            t.Fatalf("unmarshal after marshal failed: %v", err)
        }
        if !reflect.DeepEqual(m, out) {
            t.Fatalf("round trip mismatch: %v -> %v", m, out)
        }
    })
}
```

Discuss in comments why a single key-value pair is enough — the fuzz
engine mutates both strings independently, exploring the key and value
spaces simultaneously.

## Task 3 — Parser invariant

Given:

```go
func parseDuration(s string) (time.Duration, error)
```

Write a fuzz target that:

1. Calls `parseDuration`.
2. If no error, calls `d.String()`.
3. Re-parses the string form and asserts the duration round-trips.

This catches inputs where `parseDuration` accepts a value that its own
`String()` cannot regenerate. Example skeleton:

```go
func FuzzDuration(f *testing.F) {
    f.Add("1s")
    f.Add("500ms")
    f.Fuzz(func(t *testing.T, s string) {
        d, err := time.ParseDuration(s)
        if err != nil {
            return
        }
        d2, err := time.ParseDuration(d.String())
        if err != nil {
            t.Fatalf("re-parse of %q (Duration.String=%q) failed: %v",
                s, d.String(), err)
        }
        if d != d2 {
            t.Fatalf("round trip mismatch: %v -> %v", d, d2)
        }
    })
}
```

Real `time.ParseDuration` round-trips correctly. If you wrote your own
parser, this fuzz target will find inputs where `String()` produces
something the parser rejects, or where two textual forms map to the
same `Duration` but produce different strings.

## Task 4 — Differential fuzzing

Compare your hand-rolled `myAtoi` to `strconv.Atoi`. Any disagreement
on non-error cases is a bug. Skeleton:

```go
func FuzzAtoi(f *testing.F) {
    f.Add("0")
    f.Add("-1")
    f.Add("9223372036854775807")
    f.Fuzz(func(t *testing.T, s string) {
        a, aErr := myAtoi(s)
        b, bErr := strconv.Atoi(s)
        if (aErr == nil) != (bErr == nil) {
            t.Fatalf("error mismatch for %q: mine=%v ref=%v", s, aErr, bErr)
        }
        if aErr == nil && a != b {
            t.Fatalf("result mismatch for %q: mine=%d ref=%d", s, a, b)
        }
    })
}
```

Try this with a deliberately buggy `myAtoi` that mishandles leading
plus signs or whitespace. The fuzzer should find the divergence within
a few seconds.

## Task 5 — Property: encoder is total

Write `func encode(buf []byte) string` that base32-encodes its input.
Fuzz target asserts the function never panics regardless of input.
The discovery that you cannot panic is itself the property; useful for
inputs you do not fully trust.

```go
func FuzzEncode(f *testing.F) {
    f.Add([]byte{})
    f.Add([]byte("hello"))
    f.Add([]byte{0, 1, 2, 3, 4, 5, 6, 7})
    f.Fuzz(func(t *testing.T, data []byte) {
        defer func() {
            if r := recover(); r != nil {
                t.Fatalf("encode panicked on %x: %v", data, r)
            }
        }()
        _ = encode(data)
    })
}
```

The `defer recover` makes panics report nicer than the default. The
engine treats any `t.Fatal` as a finding and saves the minimized input.

## Task 6 — Add corpus from production logs

Take a sample of real request bodies from your service logs, redact
PII, and drop each one into `testdata/fuzz/FuzzHandler/0000`,
`0001`, etc. The file format is:

```
go test fuzz v1
[]byte("...binary data...")
```

Re-run `go test -fuzz=FuzzHandler -fuzztime=30s`. Coverage will start
higher than from a synthetic seed set because real inputs cover paths
that synthetic ones do not.

## Task 7 — Constrain via t.Skip

For a target that only makes sense for valid UTF-8:

```go
f.Fuzz(func(t *testing.T, s string) {
    if !utf8.ValidString(s) {
        t.Skip()
    }
    _ = process(s)
})
```

Measure exec/s before and after the skip. Verify the engine still
explores valid inputs — coverage should keep climbing. Skip is a
performance optimization, not a way to silence real bugs.

## Task 8 — CI integration

Add a GitHub Actions job that runs
`go test -fuzz=Fuzz -fuzztime=60s` for each fuzz target on push to
main. Skeleton:

```yaml
name: fuzz
on:
  push:
    branches: [main]
jobs:
  fuzz:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: List fuzz targets
        id: list
        run: |
          targets=$(go test ./... -list 'Fuzz.*' 2>/dev/null | grep -E '^Fuzz' | sort -u | paste -sd, -)
          echo "targets=$targets" >> $GITHUB_OUTPUT
      - name: Run fuzz
        run: |
          IFS=',' read -ra arr <<< "${{ steps.list.outputs.targets }}"
          for t in "${arr[@]}"; do
            go test -run=^$ -fuzz="^${t}$" -fuzztime=60s ./...
          done
      - name: Upload findings on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: fuzz-corpus
          path: testdata/fuzz
```

The `-run=^$` switch disables ordinary tests so only fuzzing happens.
The upload-artifact step captures the minimized crashers so engineers
can reproduce locally.

## Task 9 — Combined property and differential

For a custom regex engine, fuzz both:

1. The engine does not panic on any pattern.
2. For patterns that compile, the match result agrees with `regexp.Regexp`.

```go
func FuzzRegex(f *testing.F) {
    f.Add(".*", "")
    f.Add("a", "abc")
    f.Fuzz(func(t *testing.T, pattern, input string) {
        if len(pattern) > 64 || len(input) > 256 {
            t.Skip()
        }
        mine, myErr := myCompile(pattern)
        ref, refErr := regexp.Compile(pattern)
        if (myErr == nil) != (refErr == nil) {
            return
        }
        if myErr != nil {
            return
        }
        if mine.MatchString(input) != ref.MatchString(input) {
            t.Fatalf("disagreement: pattern=%q input=%q", pattern, input)
        }
    })
}
```

The size cap is essential — pathological regexes can take exponential
time to compile, killing exec/s.

## Task 10 — Fuzz a binary protocol

Define a small length-prefixed binary frame and fuzz its parser.

```go
func FuzzFrame(f *testing.F) {
    f.Add([]byte{0x00, 0x05, 'h', 'e', 'l', 'l', 'o'})
    f.Fuzz(func(t *testing.T, data []byte) {
        frames, err := ParseFrames(data)
        if err != nil {
            return
        }
        var out bytes.Buffer
        for _, frm := range frames {
            out.Write(frm.Bytes())
        }
        if !bytes.Equal(data, out.Bytes()) && err == nil {
            t.Fatalf("frames did not re-encode to original input")
        }
    })
}
```

This is the round-trip property for a binary format. The fuzzer will
find inputs that the parser accepts but cannot re-encode — a common
class of bug in length-prefixed formats where the parser is more
permissive than the encoder.

## Task 11 — Measure exec/s improvement

Take an existing fuzz target. Profile it with `-cpuprofile`. Find
the slowest call inside the inner function. Move it outside or
optimize it. Re-run fuzz with the same `-fuzztime` and compare
exec/s before and after. Target: at least 5x improvement.

This exercise builds the habit of paying attention to throughput
rather than just correctness. A slow fuzz target is a useless fuzz
target.

## Task 12 — Build a stateful fuzz target

Take a simple state machine — for example, a 4-state TCP-like
connection model. Write a fuzz target that takes a byte sequence
and interprets each byte as a state transition. Assert that the
state machine never reaches an invalid state regardless of input
sequence.

```go
func FuzzStateMachine(f *testing.F) {
    f.Add([]byte{0, 1, 2, 3})
    f.Fuzz(func(t *testing.T, data []byte) {
        m := NewMachine()
        for _, b := range data {
            m.Apply(b)
            if !m.Valid() {
                t.Fatalf("invalid state after applying %x: %v",
                    data, m.State())
            }
        }
    })
}
```

This pattern generalizes to many stateful systems: caches,
session managers, parser state machines.

Solutions for these tasks are intentionally not provided in full —
fuzzing is a feedback discipline, and watching the engine surprise you
is half the learning. Run each target, read the saved input, fix the
bug, repeat.
