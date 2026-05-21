---
layout: default
title: Table-Driven Tests — Specification
parent: Table-Driven Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/specification/
---

# Table-Driven Tests — Specification

[← Back](../)

This file is the spec-style reference for the language and `testing` package primitives that underpin the table-driven idiom. Where possible it cites the Go release that introduced or changed a relevant behavior.

---

## 1. `testing.T.Run` — the building block of subtests

From the `testing` package godoc (paraphrased):

> `func (t *T) Run(name string, f func(t *T)) bool`
>
> Run runs `f` as a subtest of `t` called `name`. It runs `f` in a separate goroutine and blocks until either `f` returns or calls `t.Parallel` to become a parallel test. `Run` reports whether `f` succeeded (or at least did not fail before calling `t.Parallel`).

Key properties:

1. The argument `name` becomes part of the **full test name** in the form `TestX/name`.
2. Slashes in `name` are preserved; spaces and other special characters are **rewritten** to underscores when reporting (see Section 4).
3. `Run` always launches a goroutine for `f`, but it **blocks** until `f` either returns or calls `t.Parallel`. So a non-parallel subtest is, behaviorally, sequential.
4. Failures in one subtest do not abort its siblings — each subtest gets a fresh `*T`.

`Run` was introduced in **Go 1.7** (August 2016).

---

## 2. `-run` regex semantics

From `go help testflag`:

> `-run regexp`
>
> Run only those tests, examples, and fuzz tests matching the regular expression. For tests, the regular expression is split by unbracketed slash (`/`) characters into a sequence of regular expressions, and each part of a test's identifier must match the corresponding element in the sequence, if any.

So `-run TestParse/empty_input` evaluates as:

- Top-level test name must match the regex `TestParse`.
- The first subtest level must match `empty_input`.

The match is `regexp.MatchString` — **substring**, not full anchor. So `-run Parse` matches `TestParse`, `TestParseV2`, and `TestUnparse`. To anchor, use `^TestParse$`.

Each subtest name segment is also matched as a substring. To run a single case named `empty_input` under `TestParse` and nothing else, write `-run '^TestParse$/^empty_input$'`.

---

## 3. `-run` and `t.Parallel` interaction

When `-run` excludes a test, that test is **not started** at all. When `-run` selects a parallel test, that test still goes through the standard "pause until non-parallel siblings finish" sequence. There is no flag to skip the parallel-pause mechanism.

`-parallel N` (default `GOMAXPROCS`) caps how many parallel subtests run at the same time. Note that `-parallel` is a property of `t.Parallel`, not of `t.Run` — sequential subtests do not consume a `-parallel` slot.

---

## 4. Name sanitization

`testing` rewrites the displayed name in two passes:

1. Characters that are not printable per Go's `strconv.IsPrint` are replaced.
2. Spaces are replaced with underscores.

So a row named `"empty input"` shows as `TestParse/empty_input` in output and is matched by `-run TestParse/empty_input` **or** `-run TestParse/empty input` (the matcher applies the same rewrite to the regex).

Duplicate names within the same parent are disambiguated with a `#NN` suffix: `case#01`, `case#02`. This is why you should **always set `tc.name`** explicitly — relying on Go to suffix duplicates makes failures hard to find.

---

## 5. Go 1.22 loop variable scope (issue 60078)

Before Go 1.22, this loop:

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        check(tc.input)
    })
}
```

was **broken** for parallel subtests. The loop variable `tc` was a **single variable** reused across iterations. By the time the parallel goroutine actually ran, `tc` held the **last** value of the slice. The standard fix:

```go
for _, tc := range cases {
    tc := tc // shadow with a per-iteration copy
    t.Run(tc.name, func(t *testing.T) { ... })
}
```

Go 1.22 (February 2024) changed `for` loop scoping so that the loop variables are **scoped per iteration**. The `tc := tc` line is now a no-op in modules that declare `go 1.22` or later in `go.mod`. See [proposal 60078](https://github.com/golang/go/issues/60078) and the [Go 1.22 release notes](https://go.dev/doc/go1.22#language).

Backwards compatibility: code that does `tc := tc` still compiles and runs identically — it is just redundant. Linters (`copyloopvar`) will flag the shadow as unnecessary in Go 1.22+ modules.

---

## 6. `testing.T.Cleanup`

Added in Go 1.14:

> `func (t *T) Cleanup(f func())`
>
> Cleanup registers a function to be called when the test (or subtest) and all its subtests complete. Cleanup functions will be called in last added, first called order.

This is essential for table-driven tests because per-case teardown (`tc.tempDir`, `tc.server.Close()`) belongs inside the `t.Run` body, scoped to one row.

---

## 7. `testing.T.Helper`

Added in Go 1.9. Mark a function so that line numbers in failure reports point at the **caller**, not at the helper. Vital for table-driven assertion helpers:

```go
func assertEqual(t *testing.T, got, want any) {
    t.Helper()
    if !reflect.DeepEqual(got, want) {
        t.Errorf("got %v want %v", got, want)
    }
}
```

Without `t.Helper`, every failure report points at the `t.Errorf` inside the helper, hiding the row that actually failed.

---

## 8. `testing.T.Setenv` and per-case env

Added in Go 1.17. Sets an environment variable and registers a cleanup that restores the previous value. Cannot be combined with `t.Parallel` — it will fail the test if both are called on the same `*T`.

This matters for tables: if even one row needs `t.Setenv`, that row cannot be parallel. Either skip parallelism for the whole table, or split the row out.

---

## 9. Fuzz seed corpus and tables

Added in Go 1.18. The signature is:

```go
func FuzzX(f *testing.F) {
    seeds := []struct{ a, b int }{
        {1, 2},
        {0, 0},
        {-1, math.MaxInt32},
    }
    for _, s := range seeds {
        f.Add(s.a, s.b)
    }
    f.Fuzz(func(t *testing.T, a, b int) { ... })
}
```

The seed corpus is the **same shape** as a test table — `f.Add` calls play the role of rows. Files in `testdata/fuzz/FuzzX/` are also seed inputs.

---

## 10. `testing.B.Run` — table-driven benchmarks

Mirrors `T.Run`:

```go
func BenchmarkSplit(b *testing.B) {
    cases := []struct {
        name string
        in   string
    }{
        {"empty", ""},
        {"short", "a,b,c"},
        {"long", strings.Repeat("a,", 10000)},
    }
    for _, tc := range cases {
        b.Run(tc.name, func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                _ = strings.Split(tc.in, ",")
            }
        })
    }
}
```

`b.Run` sub-benchmarks each get their own `b.N` calibration. The `-bench` flag uses the same slash-regex semantics as `-run`.

---

## 11. Standard library idioms

Examples of table-driven tests in the standard library worth reading:

- `src/strconv/atoi_test.go` — classic slice-of-struct table for `Atoi`.
- `src/encoding/json/decode_test.go` — table with `wantErr` and `errType` fields.
- `src/net/url/url_test.go` — nested tables (per-method tables inside the file).
- `src/time/format_test.go` — table-driven `Parse` and `Format` tests sharing one table.
- `src/path/filepath/path_test.go` — separate tables for Unix and Windows, gated by build tags.

These files predate `t.Run` (1.7) in many cases, so they show both the older "increment counter, print case index" style and the newer subtest style.

---

## 12. Idiomatic field names

The Go community has converged on:

- `name` — string label for the row, becomes the subtest name.
- `input`, `in` — single input value.
- `args` — when there are multiple inputs.
- `want`, `wantErr`, `wantOut` — expected values, kept consistent across the codebase.
- `setup`, `teardown` — function fields for per-case lifecycle (less common, often a code smell).

Avoid `expected` (older Java convention), `actual` (use `got`), and `caseN` (no name — relies on duplicate-disambiguation).

---

## 13. Match precedence

When multiple flags overlap:

1. `-run` selects which tests to run.
2. `-count N` reruns each selected test N times (default 1, sometimes 2 for caching).
3. `-parallel N` caps concurrent parallel subtests.
4. `-timeout` applies to the whole `go test` invocation, not to individual subtests.

Per-subtest timeouts must be implemented with `context.WithTimeout` inside the subtest body.

---

## 14. Limits

- There is no built-in limit on the number of subtests, but each `t.Run` allocates a `*T` and a goroutine — at ~10⁶ rows, the per-subtest overhead (~5 µs each) starts to dominate.
- Subtest names are de-duplicated within the same parent only. Two `TestA/foo` and `TestB/foo` are independent.
- `t.Run` returns `bool` — the result of the subtest. You almost never need it, but it lets you skip subsequent subtests if a setup-row failed.

---

## 15. `testing.T` methods relevant to table-driven tests

The full list of `*testing.T` methods you commonly use inside a `t.Run` body, with the Go version that introduced each non-original method:

| Method | Since | Notes |
|---|---|---|
| `t.Errorf` | 1.0 | Mark fail, continue subtest. |
| `t.Fatalf` | 1.0 | Mark fail, stop **this** subtest only. |
| `t.Logf` | 1.0 | Stream-style logging (visible only in `-v` or on failure). |
| `t.Skipf` / `t.Skip` / `t.SkipNow` | 1.1 | Mark subtest skipped. |
| `t.Parallel` | 1.0 | Pause until siblings finish, then resume in parallel. |
| `t.Run` | 1.7 | Create a subtest. |
| `t.Helper` | 1.9 | Mark caller as helper; failures point at caller's caller. |
| `t.Cleanup` | 1.14 | Register teardown function (LIFO). |
| `t.TempDir` | 1.15 | Auto-deleted per-test directory. |
| `t.Setenv` | 1.17 | Sets env var; restores on cleanup. Incompatible with `t.Parallel`. |
| `t.Deadline` | 1.15 | Returns `-timeout` deadline if set. |
| `t.Failed` | 1.0 | True if subtest has failed (useful in `Cleanup`). |
| `t.Name` | 1.8 | Returns full subtest path. |
| `t.Chdir` | 1.24 | Changes working directory and restores on cleanup. |

---

## 16. Go release timeline for table-driven features

A condensed history of features that shaped the modern table-driven idiom:

- **Go 1.0** (March 2012) — `testing` package with `func TestX(t *testing.T)`, `t.Error`, `t.Fatal`. No subtests.
- **Go 1.7** (August 2016) — `T.Run` and `B.Run` added; `-run` learns slash semantics for hierarchy.
- **Go 1.8** (February 2017) — `T.Name` added so helpers can introspect the current subtest path.
- **Go 1.9** (August 2017) — `T.Helper` added; failures point at caller.
- **Go 1.14** (February 2020) — `T.Cleanup` added; replaces most `defer` patterns inside tests.
- **Go 1.15** (August 2020) — `T.TempDir` added; per-test auto-deleted scratch dir.
- **Go 1.16** (February 2021) — `//go:embed` added; tables can now ship test data inside the binary.
- **Go 1.17** (August 2021) — `T.Setenv` added; per-test env vars.
- **Go 1.18** (March 2022) — `testing.F` and `f.Fuzz` added; seed corpus is shape-compatible with table tests.
- **Go 1.21** (August 2023) — `slices` and `cmp` standard packages stabilize; common in test helpers.
- **Go 1.22** (February 2024) — `for` loop variable per-iteration scoping. `tc := tc` shadow becomes redundant in modules with `go 1.22+`.
- **Go 1.23** (August 2024) — Range-over-func iterators usable in test data generation.
- **Go 1.24** (February 2025) — `T.Chdir` added; per-test directory changes are scoped.

---

## 17. The `-shuffle` flag

`go test -shuffle on` randomizes the order of top-level tests (and **only** top-level tests — subtests within a `Test` run in declaration order). The intent: surface tests that depend on package-level state mutated by earlier tests.

```
go test -shuffle on -count=10 ./...
```

If a table-driven test has subtest rows that depend on each other (sequential mutation), `-shuffle` will not catch it directly because subtest order within `TestX` is preserved. But if `TestX` depends on `TestW` having set up state, `-shuffle` will catch that.

To shuffle subtests, you'd have to shuffle the table slice yourself before the loop — but **don't**. Subtests should be independent; making them rely on order is a code smell.

---

## 18. Caching semantics

`go test` caches successful test results based on a hash of the package's source files, environment, and build configuration. Effects on tables:

- Adding a row to a table invalidates the cache for that package.
- Changing test data files (`testdata/*.json`) does **not** invalidate the cache by default — `go test` does not hash file system reads. If your table is data-driven from `testdata/`, use `//go:embed` so the data is part of the source hash. Otherwise, run with `-count=1` to bypass the cache.

```
go test -count=1 ./...
```

This is the standard workaround. Many teams alias `gotest='go test -count=1'`.

---

## 19. The race detector and tables

`go test -race` adds runtime instrumentation that detects data races. For parallel tables:

- A 10× wall-clock overhead is normal.
- Race detector slots are limited (8K active goroutines per binary); huge parallel tables can hit the limit. Cap `-parallel`.
- Any race in setup, teardown, or shared fixtures is reported and fails the test.

A best-practice CI configuration runs the whole suite with `-race -count=1` at least nightly, even if the per-commit pipeline runs without `-race` for speed.

---

## 20. Test name normalization details

When `testing` rewrites a subtest name for display and matching, the rule (paraphrased from `src/testing/match.go`):

```go
func rewrite(s string) string {
    b := make([]byte, 0, len(s))
    for _, r := range s {
        switch {
        case isSpace(r):
            b = append(b, '_')
        case !strconv.IsPrint(r):
            s := strconv.QuoteRune(r)
            b = append(b, s[1:len(s)-1]...)
        default:
            b = append(b, string(r)...)
        }
    }
    return string(b)
}
```

So `"hello world"` becomes `hello_world`, and `"naïve"` survives because `ï` is printable per `IsPrint`. Tab characters (`\t`) and newlines become escaped (`\t`, `\n`).

---

## 21. `go test -v` vs `go test -json`

Two output modes you'll use to inspect table results:

- **`-v`** — human-readable, streams `=== RUN`, `--- PASS`, `--- FAIL` markers. Subtests appear indented under parents. Good for terminal debugging.
- **`-json`** — machine-readable, one JSON event per line. Used by `gotestsum`, IDE test runners, and CI dashboards. Each subtest has its own events with `Test: "TestX/foo"`.

```
go test -json -run TestX ./... | jq -r 'select(.Action=="fail") | .Test'
```

Lists failing subtests by full path.

---

## 22. Custom `*testing.T` and embedding

You cannot define a custom `*testing.T` because the type is concrete. But you can:

- Define a helper interface that accepts `testing.TB` (parent of `*T` and `*B`).
- Wrap test runs in a custom function that takes the slice and returns a `func(*testing.T)`:

```go
func runTable[T any](cases []T, name func(T) string, body func(*testing.T, T)) func(*testing.T) {
    return func(t *testing.T) {
        for _, tc := range cases {
            t.Run(name(tc), func(t *testing.T) { body(t, tc) })
        }
    }
}

func TestX(t *testing.T) {
    cases := []struct{...}{...}
    runTable(cases, func(c struct{...}) string { return c.name }, func(t *testing.T, c struct{...}) {
        ...
    })(t)
}
```

This works but is rarely worth the indirection. Idiomatic Go keeps the loop inline.

---

[← Back](../)
