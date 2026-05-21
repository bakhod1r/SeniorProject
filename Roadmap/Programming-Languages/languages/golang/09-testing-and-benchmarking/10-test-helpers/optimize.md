---
layout: default
title: Test Helpers — Optimize
parent: Test Helpers
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/10-test-helpers/optimize/
---

# Test Helpers — Optimize

[← Back](../)

The starting helper is slow and noisy. Each call recompiles a
regular expression, allocates a new `bytes.Buffer`, and reflects
over the value being compared. With a test suite of 4000 cases, the
helper consumes 12 seconds of wall time.

```go
func assertJSONContains(t *testing.T, body []byte, want string) {
    t.Helper()
    re := regexp.MustCompile(regexp.QuoteMeta(want))
    var buf bytes.Buffer
    json.Indent(&buf, body, "", "  ")
    if !re.Match(buf.Bytes()) {
        t.Fatalf("expected %q in body:\n%s", want, buf.String())
    }
}
```

## Diagnosis

Three sources of waste:

1. `regexp.MustCompile` compiles a regular expression. The body of
   the regular expression is a quoted literal, so the regex is
   doing the work of `bytes.Contains`. The compilation runs on
   every call.
2. `json.Indent` reformats the body into a pretty-printed buffer.
   The pretty-printed buffer is used for the failure message,
   which 99 percent of calls never produce.
3. The result of `re.Match` is checked against the formatted
   buffer instead of the original body. The comparison is
   equivalent only because both contain the literal substring;
   indenting JSON does not change the literal content for most
   cases, but it does add whitespace that could split a target
   string.

## Targets

1. Remove the regular expression. `bytes.Contains` does the same
   work without compilation.
2. Skip indentation unless the test actually fails. Indentation only
   matters for the error message.
3. Make the helper allocation-free in the success path.

## Solution

```go
func assertJSONContains(t *testing.T, body []byte, want string) {
    t.Helper()
    if bytes.Contains(body, []byte(want)) {
        return
    }
    var buf bytes.Buffer
    if err := json.Indent(&buf, body, "", "  "); err != nil {
        buf.Write(body)
    }
    t.Fatalf("expected %q in body:\n%s", want, buf.String())
}
```

The fast path is a single `bytes.Contains` call. Indentation runs
only on failure, where the user will read the message anyway.
Compilation of the regular expression is gone.

## Benchmark

A simple benchmark exercises both helpers on a moderately sized
JSON payload:

```go
func BenchmarkAssertJSONContains(b *testing.B) {
    body := bytes.Repeat([]byte(`{"key":"value"},`), 100)
    fakeT := &fakeTB{TB: b}
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        assertJSONContains(fakeT, body, "value")
    }
}
```

Run with `go test -bench BenchmarkAssertJSONContains`.

## Measurement

| Variant      | ns/op   | allocs/op |
|--------------|---------|-----------|
| Original     | 184,000 | 47        |
| Optimised    |     320 |  0        |

On the 4000-case suite the optimised helper finishes in 1.3
seconds, a 9x speedup. The savings come from avoiding work on the
happy path: most assertions pass, so the slow indentation code
should not run.

## Generalising the lesson

Helpers run thousands of times per suite. The optimisations on
this page apply to any helper:

1. Put the cheap check first. Most calls return on the cheap path.
2. Build the failure message lazily. Allocate only when failing.
3. Avoid compiling regular expressions or other costly objects
   inside the helper body. Compile once and cache, or use a
   simpler primitive.
4. Avoid reflection unless required. `cmp.Diff` uses reflection;
   when comparing two integers, a direct `!=` is faster.

A helper that respects these rules adds no measurable overhead to
the suite. A helper that ignores them shows up at the top of any
profile.

## A second example: eventually

The naive `eventually` helper polls every 10 milliseconds. For
fast conditions, that interval is 10 milliseconds of wasted wall
time per call. A smarter version starts with a short interval and
backs off:

```go
func eventually(tb testing.TB, timeout time.Duration, cond func() bool) {
    tb.Helper()
    interval := time.Millisecond
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(interval)
        if interval < 50*time.Millisecond {
            interval *= 2
        }
    }
    tb.Fatalf("condition not met within %s", timeout)
}
```

The first iteration sleeps 1ms, then 2, then 4, capping at 50.
Fast conditions complete in a few iterations; slow conditions hit
the cap quickly and burn no extra CPU.

This change shaves seconds from a suite with many fast-completing
async tests. The cost is one extra branch per iteration, which is
free.

## Profiling helpers

When a suite slows down, profile it with `go test -bench` on a
representative workload. The output highlights which helpers
account for the time. Typical culprits:

- Helpers that load fixtures and reformat them on every call.
- Helpers that compile regular expressions or templates inline.
- Helpers that use `reflect` when a typed alternative exists.
- Helpers that allocate a buffer for the failure message in the
  happy path.

Each of these has a simple fix. The work is recognising the
pattern, not implementing the fix.

## A third example: avoid reflection when possible

A helper that compares two integers should not use `cmp.Diff`. The
generic version is fine when the types vary; for known types, the
direct comparison is faster and produces a simpler failure
message:

```go
// Slower: uses cmp.Diff with reflection.
func assertIntEqualSlow(tb testing.TB, got, want int) {
    tb.Helper()
    if d := cmp.Diff(want, got); d != "" {
        tb.Errorf("%s", d)
    }
}

// Faster: direct comparison.
func assertIntEqual(tb testing.TB, got, want int) {
    tb.Helper()
    if got != want {
        tb.Errorf("got %d, want %d", got, want)
    }
}
```

For a benchmark of 1 million calls, the fast version takes about
30 milliseconds; the slow version takes 700. The difference is
reflection overhead.

The lesson: `cmp.Diff` is right for complex types where the diff
matters. For primitive comparisons, use `!=`. Provide both helpers
and let the test author pick.

## When to optimise

Not every helper deserves optimisation. The rules:

- Profile first. Helpers that do not appear in the profile do not
  matter.
- Optimise the hot helper, leave the rest alone.
- Measure the change. Without measurement, "optimisation" is
  speculation.
- Keep the unoptimised version commented in if the optimisation
  costs readability.

A helper that takes 184 microseconds and runs 4000 times costs 0.7
seconds. The optimisation saves 0.7 seconds per test run. Whether
that matters depends on how often the suite runs.

## Closing observation

Helpers are not the right place to write clever code. They are
the right place to write the simplest code that returns quickly on
the common path. Tests run thousands of times in CI; every
millisecond of helper overhead multiplies. The right rule is
"helpers stay cheap"; the right implementation is the one that
honours it.

## Profile-driven optimisation example

Suppose a suite takes 8 minutes to run. A profile shows:

```
35% time in cmp.Diff
20% time in JSON unmarshal in loadJSON
15% time in regex compilation in assertJSONContains
30% other
```

The optimisations targeting those three helpers might reduce the
suite to 4 minutes. Optimisations elsewhere would shave seconds
at best. The lesson is to spend effort where the profile says it
matters.

A common trap is optimising helpers that account for 1% of the
runtime. The change is satisfying but pointless. Always profile
first.

## Cache helpers across calls

Some helpers can cache their work. A helper that reads a fixture
file can read it once and return cached bytes on subsequent calls:

```go
var fixtureCache sync.Map

func loadJSONCached[T any](tb testing.TB, name string) T {
    tb.Helper()
    if cached, ok := fixtureCache.Load(name); ok {
        var out T
        if err := json.Unmarshal(cached.([]byte), &out); err != nil {
            tb.Fatalf("unmarshal %s: %v", name, err)
        }
        return out
    }
    data, err := os.ReadFile(filepath.Join("testdata", name))
    if err != nil {
        tb.Fatalf("read %s: %v", name, err)
    }
    fixtureCache.Store(name, data)
    var out T
    _ = json.Unmarshal(data, &out)
    return out
}
```

The cache lives across the suite. Tests that load the same fixture
many times skip the file system on the second and later calls. The
caveat: tests that modify the returned value pollute the cache. The
helper must return a fresh copy or document the immutability
contract.
