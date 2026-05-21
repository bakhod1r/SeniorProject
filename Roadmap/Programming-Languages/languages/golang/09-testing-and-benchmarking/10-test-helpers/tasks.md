---
layout: default
title: Test Helpers — Tasks
parent: Test Helpers
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/10-test-helpers/tasks/
---

# Test Helpers — Tasks

[← Back](../)

The tasks below practise the patterns from the four tier pages.
Work through them in order; each builds on the previous. Solutions
are not provided; the tiers contain enough material to write each
helper by hand.

## Task 1 — `assertEqual`

Write a generic helper
`assertEqual[T comparable](t *testing.T, got, want T)` that fails
the test with `t.Errorf` when the values differ and otherwise
returns silently. The failure message must include both values
formatted with `%v`.

```go
func assertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

Extension: add a variant `assertEqualf` that accepts a label string
so several calls in the same test produce distinct messages.

## Task 2 — `mustParseTime`

Implement `mustParseTime(t *testing.T, layout, value string) time.Time`
that parses the time or calls `t.Fatalf` on error. Use it to keep
table tests readable.

```go
func mustParseTime(t *testing.T, layout, value string) time.Time {
    t.Helper()
    ts, err := time.Parse(layout, value)
    if err != nil {
        t.Fatalf("parse %q: %v", value, err)
    }
    return ts
}
```

Extension: write `mustParseURL`, `mustParseUUID`, and `mustParseJSON`
following the same pattern.

## Task 3 — `tempFile` with Cleanup

Implement `tempFile(t *testing.T, content string) string` that
creates a temporary file containing the given content and registers
cleanup with `t.Cleanup`. Return the absolute path. The test should
not need to defer removal itself.

Use `os.CreateTemp` or `t.TempDir` plus `os.WriteFile`. The cleanup
should remove the file (or the parent directory if you use
`TempDir`).

Extension: parameterise the helper with a filename pattern so tests
can ask for `*.json` or `*.txt` extensions.

## Task 4 — `eventually` polling helper

Write `eventually(t *testing.T, timeout time.Duration, cond func() bool)`
that polls `cond` every 10 milliseconds until either it returns
true or the timeout elapses. On timeout the helper fails with
`t.Fatalf`. Use this to test asynchronous code without sleeping a
fixed duration.

Extension: write a `eventuallyEqual` variant that accepts a
function returning a value and a target value; it polls until the
returned value equals the target or the timeout elapses.

## Task 5 — `assertContainsAll`

Implement
`assertContainsAll(t *testing.T, body string, needles ...string)`
that calls `t.Errorf` for each missing needle and continues.
Demonstrate that failure messages still report the test line.

```go
func assertContainsAll(t *testing.T, body string, needles ...string) {
    t.Helper()
    for _, n := range needles {
        if !strings.Contains(body, n) {
            t.Errorf("body does not contain %q", n)
        }
    }
}
```

Extension: write `assertContainsNone` that fails if any of the
needles appear in the body.

## Task 6 — Diff-based equality

Write `assertEqualDiff[T any](t *testing.T, got, want T)` that uses
`cmp.Diff(want, got)` and reports the diff on mismatch. The helper
should accept `cmp.Option` values as a variadic parameter so callers
can supply their own comparers.

```go
func assertEqualDiff[T any](t *testing.T, got, want T, opts ...cmp.Option) {
    t.Helper()
    if d := cmp.Diff(want, got, opts...); d != "" {
        t.Errorf("(-want +got):\n%s", d)
    }
}
```

Extension: write a domain-specific variant for one of your project's
types that pre-applies the relevant `cmpopts.IgnoreFields` options.

## Task 7 — HTTP test server helper

Implement
`newTestServer(t *testing.T, handler http.Handler) *httptest.Server`
that starts a server with `httptest.NewServer`, registers
`t.Cleanup` to close it, and returns the server. Callers should
never have to remember to close the server.

Extension: write `newRecordedServer` that wraps the handler and
records every incoming request. The returned value exposes a
`Requests()` method that returns a copy of the recorded slice.
Ensure the recording is goroutine-safe.

## Task 8 — Test the helper

Write a test for `assertEqual` that uses a fake `testing.T`
implementation to verify that calling the helper with unequal
arguments records exactly one error. The fake should satisfy
whatever subset of `testing.TB` the helper calls.

```go
type fakeTB struct {
    testing.TB
    errors []string
}

func (f *fakeTB) Helper() {}
func (f *fakeTB) Errorf(format string, args ...any) {
    f.errors = append(f.errors, fmt.Sprintf(format, args...))
}
```

The outer test passes a `*fakeTB` to `assertEqual` and checks
`len(f.errors)` after the call.

Extension: extend the fake to record `Cleanup` registrations, then
test that `newTestServer` registers exactly one cleanup.

## Task 9 — Random table builder

Build a helper that fills a struct with random values using
`testing/quick.Value`. The helper should accept a seed for
reproducibility and a pointer to the struct. Use it to drive a
property-style table test.

```go
func randomFill[T any](t *testing.T, seed int64) T {
    t.Helper()
    r := rand.New(rand.NewSource(seed))
    v, ok := quick.Value(reflect.TypeOf(*new(T)), r)
    if !ok {
        t.Fatalf("quick.Value did not produce a %T", *new(T))
    }
    return v.Interface().(T)
}
```

Extension: log the seed at the start of each test so failures
include the input that triggered them.

## Task 10 — Golden file helper

Implement `assertGolden(t *testing.T, name string, got []byte)`
that reads `testdata/<name>` and compares it to `got`. Support an
`-update` flag that, when set, rewrites the golden file with the
current output.

```go
var update = flag.Bool("update", false, "update golden files")

func assertGolden(t *testing.T, name string, got []byte) {
    t.Helper()
    path := filepath.Join("testdata", name)
    if *update {
        if err := os.WriteFile(path, got, 0o644); err != nil {
            t.Fatalf("write golden: %v", err)
        }
        return
    }
    want, err := os.ReadFile(path)
    if err != nil {
        t.Fatalf("read golden: %v", err)
    }
    if !bytes.Equal(got, want) {
        t.Errorf("golden mismatch")
    }
}
```

Extension: produce a diff between `got` and `want` on mismatch so
the failure message is actionable.

## Task 11 — Composing helpers

Write `loadAndValidate[T any](t *testing.T, path string, validate func(T) error) T`
that loads a JSON fixture, validates it, and stops the test if
either step fails. The helper should call other helpers
(`loadJSON`, `requireNoError`) rather than reimplementing their
logic.

Extension: add a context-aware version that accepts a
`context.Context` and cancels validation if the context expires.

## Task 12 — Helper for table tests

Write a generic runner
`runCases[I, O any](t *testing.T, cases []struct{name string; in I; want O}, fn func(I) O, eq func(O, O) bool)`
that loops over cases, calls `t.Run` for each, applies `fn`, and
checks the result with `eq`. Use it to replace boilerplate in an
existing table test.

This is a deliberately advanced exercise; the resulting helper
borders on a framework. Reflect on whether the abstraction is worth
the cognitive cost compared to a hand-written loop.

## Reflection prompts

After completing the tasks, answer these questions in writing:

- Which helpers did you write that you would promote to
  `internal/testutil`?
- Which helpers stayed too small to share?
- Which helpers crossed the line into framework territory?
- What naming convention emerged from the tasks?
- How would you refactor an existing test file in your codebase to
  use the helpers from this exercise?

The answers are the project's helper strategy in miniature.

## Task 13 — Convert testify to hand-rolled

Find a test file in your project that uses `testify/assert` or
`testify/require`. Rewrite it using hand-rolled helpers from
earlier tasks. Compare the result for readability, length, and
diagnostic quality on a deliberate failure.

The exercise is not about eliminating testify; it is about
understanding what testify hides and whether the hidden behaviour
matters for your project.

## Task 14 — Audit your helper package

If your project has an `internal/testutil` package, walk through
every exported function. For each, answer:

- Does it call `tb.Helper()`?
- Is the failure mode appropriate?
- Does it accept `testing.TB`?
- Does it register cleanup correctly?
- Is the godoc accurate?

Fix anything that fails the audit. Submit the change as a single
commit with a clear message.

## Task 15 — Build a small DSL

Pick a sequence of operations that appears in several tests
(login + fetch profile + check field, for example). Build a small
DSL that lets a test express the sequence in two or three lines.
After implementation, count the lines saved across all callers and
compare to the lines of DSL code.

If the savings exceed the cost, keep the DSL. If not, throw it
away. The exercise teaches when to stop.

## Task 16 — Optimise a helper

Find a helper in your codebase that runs more than a thousand
times per suite run. Benchmark it. Apply at least one optimisation
from the Optimize page. Measure the result. Document the change in
the helper's godoc.

The goal is not a particular speedup; the goal is the habit of
measuring before changing.

## Task 17 — Document a helper

Pick an undocumented helper in your codebase. Write a godoc comment
that names:

- What the helper does.
- The failure mode (continue or stop).
- Whether it calls `tb.Helper`.
- Any side effects (cleanup registration, global state).
- The parameter constraints.

Submit as a single commit. Notice how much you had to read to
write the comment; the time spent is a measure of how unclear the
helper was without documentation.
