---
layout: default
title: Table-Driven Tests — Middle
parent: Table-Driven Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/middle/
---

# Table-Driven Tests — Middle

[← Back](../)

## Table of Contents

1. [Where We Pick Up](#where-we-pick-up)
2. [Subtest Filtering with `-run`](#subtest-filtering-with--run)
3. [Subtest Anchoring and Regex Pitfalls](#subtest-anchoring-and-regex-pitfalls)
4. [Parallel Table-Driven Tests](#parallel-table-driven-tests)
5. [The `t.Parallel` Lifecycle](#the-tparallel-lifecycle)
6. [Per-Case Setup vs Shared Setup](#per-case-setup-vs-shared-setup)
7. [`t.TempDir`, `t.Setenv`, `t.Cleanup`](#ttempdir-tsetenv-tcleanup)
8. [Assertion Helpers and `t.Helper`](#assertion-helpers-and-thelper)
9. [Golden Files in a Table](#golden-files-in-a-table)
10. [Error Matching with `errors.Is` and `errors.As`](#error-matching-with-errorsis-and-errorsas)
11. [Comparison with go-cmp](#comparison-with-go-cmp)
12. [Custom Field Types in a Table](#custom-field-types-in-a-table)
13. [Working with Time](#working-with-time)
14. [Working with HTTP Handlers](#working-with-http-handlers)
15. [Worked Example — JSON Codec Tests](#worked-example--json-codec-tests)
16. [Worked Example — Parser with Position Info](#worked-example--parser-with-position-info)
17. [Common Mistakes at This Level](#common-mistakes-at-this-level)
18. [What to Read Next](#what-to-read-next)
19. [Self-Check](#self-check)

---

## Where We Pick Up

You can write a basic table-driven test and you know what `t.Run` does. You can read failure output and add a new case. At this level we tackle:

- Running specific subsets of rows efficiently.
- Making the table parallel — both pre- and post-Go 1.22.
- Per-case setup and teardown.
- Golden files in tables.
- Strong error matching.
- Comparison libraries (`reflect.DeepEqual`, `go-cmp`).
- Two larger worked examples.

We assume Go 1.22+ throughout, but call out pre-1.22 differences where they matter.

---

## Subtest Filtering with `-run`

The `-run` flag takes a regex and selects which tests (and subtests) execute.

### Basic forms

```
go test -run TestParseInt              # all subtests of TestParseInt
go test -run TestParseInt/positive     # only the "positive" subtest
go test -run 'Parse'                   # all tests with "Parse" in their name
```

### Slash semantics

`-run` splits the pattern on **unbracketed** slashes. Each segment is a regex matched against the corresponding subtest level:

```
go test -run TestParse/case_3/sub_a
```

Means: `TestParse` matches the top-level test name, `case_3` matches the first-level subtest, `sub_a` matches the second-level subtest. Each segment is a **substring** regex — `case_3` matches `case_3` and `case_30` and `case_3_foo`.

### Multiple alternatives

To run rows whose names start with `valid_`:

```
go test -run 'TestEmail/^valid_'
```

To run several specific rows:

```
go test -run 'TestEmail/(valid_simple|valid_with_plus|valid_subdomain)'
```

The alternation works because regex `|` is supported.

### Hierarchical filtering

If you have nested subtests like `TestX/integer/positive`, you can filter at any level:

```
go test -run TestX                 # everything under TestX
go test -run TestX/integer         # only the integer group
go test -run TestX/integer/positive # one specific leaf
```

---

## Subtest Anchoring and Regex Pitfalls

Common mistake: `-run TestParseInt` also runs `TestParseIntegers`, `TestParseInt32`, etc., because regex matching is **substring**, not anchored.

Anchor with `^` and `$`:

```
go test -run '^TestParseInt$'
```

Same for subtest segments:

```
go test -run '^TestParseInt$/^positive$'
```

The single quotes are important — `$` would be interpreted by some shells. In Windows PowerShell, use backticks or escape.

### Special regex characters in names

If your subtest names contain `.` or `(` or `*`, they have regex meaning. Either escape them in the `-run` pattern or pick safer names. Tables that use slash separators inside `tc.name` (e.g. `"a/b"`) create three levels of subtest, not one — keep slashes out of names unless you want them as separators.

---

## Parallel Table-Driven Tests

Adding `t.Parallel()` inside the subtest body marks each row as eligible for parallel execution:

```go
func TestSquare(t *testing.T) {
    cases := []struct {
        name string
        in   int
        want int
    }{
        {"two", 2, 4},
        {"three", 3, 9},
        {"four", 4, 16},
        {"ten", 10, 100},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            if got := Square(tc.in); got != tc.want {
                t.Errorf("Square(%d) = %d, want %d", tc.in, got, tc.want)
            }
        })
    }
}
```

For Go 1.21 and earlier, add `tc := tc`:

```go
for _, tc := range cases {
    tc := tc // necessary pre-1.22; harmless and redundant post-1.22
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        ...
    })
}
```

### Why is `t.Parallel` worth it?

For pure-CPU pure-Go work on a single-core function, parallelism gives no speedup — the CPU is the bottleneck and you have one CPU. But:

- **I/O-bound tests** (HTTP, DB, file system) parallelize beautifully.
- **Multi-core CPU work** scales with `GOMAXPROCS`.
- **Even pure-CPU rows** parallelize across rows. If you have 32 rows each taking 100ms on a single core, sequential = 3.2s; with `-parallel 8` on an 8-core machine = ~400ms.

`go test -parallel N` (default `GOMAXPROCS`) caps the number of concurrent parallel subtests. `-parallel 1` forces sequential.

---

## The `t.Parallel` Lifecycle

When a subtest calls `t.Parallel`:

1. The subtest's goroutine is **paused**.
2. The parent test continues — it kicks off the next subtest.
3. Eventually the parent finishes its **sequential** subtests. Then all paused parallel subtests are resumed, up to `-parallel` at a time.
4. The parent's `Run` returns after **all** sequential and parallel children complete.

Implication: parallel subtests don't run interleaved with sequential ones. They wait until the sequential wave finishes, then run together as a parallel wave.

If you mix sequential and parallel subtests in the same loop, the sequential ones run first in order, then the parallel ones run together. This can be surprising when you read the `-v` output.

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        if tc.parallelOK { t.Parallel() }
        ...
    })
}
```

In `-v` output, sequential rows appear immediately, parallel rows appear later, in a clump.

---

## Per-Case Setup vs Shared Setup

Three places to put setup code:

### 1. Inside the subtest (per-case)

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        srv := newServer(tc.config)
        defer srv.Close()
        ...
    })
}
```

Each row gets its own server. Cleanup is scoped to the row. Use this when rows have meaningfully different configs.

### 2. Outside the loop (shared)

```go
srv := newServer(defaultConfig)
defer srv.Close()
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        srv.Reset(tc.state)
        ...
    })
}
```

One server, reset between rows. Use when setup is expensive and rows are independent enough to share.

### 3. Once per package (`TestMain`)

```go
var globalDB *sql.DB

func TestMain(m *testing.M) {
    globalDB = setupDB()
    code := m.Run()
    globalDB.Close()
    os.Exit(code)
}
```

One resource shared across all tests in the package. Costliest setup; only do it if multiple tests need the same fixture.

A common combination is (3) for the DB connection and (1) for per-row transaction rollback:

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        tx, _ := globalDB.Begin()
        defer tx.Rollback()
        ...
    })
}
```

Each row gets its own transaction; the DB connection is shared.

---

## `t.TempDir`, `t.Setenv`, `t.Cleanup`

Three `*testing.T` methods that are essential for clean per-case setup.

### `t.TempDir()`

Added in Go 1.15. Returns a directory unique to the current `*T` and **auto-deletes** it when the test finishes. No manual `os.RemoveAll`.

```go
t.Run(tc.name, func(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "input.txt")
    os.WriteFile(path, tc.contents, 0644)
    ...
})
```

Each subtest gets its own directory. Parallel-safe.

### `t.Setenv(key, value)`

Added in Go 1.17. Sets an env var and registers cleanup to restore the prior value. **Cannot be used in parallel tests.**

```go
t.Run(tc.name, func(t *testing.T) {
    t.Setenv("APP_ENV", tc.env)
    got := ReadConfig()
    ...
})
```

If you also call `t.Parallel()` in the same subtest, the test panics. Reason: env vars are process-global, so changing them concurrently would race.

### `t.Cleanup(f)`

Added in Go 1.14. Registers `f` to run when the test ends. Replaces most `defer` patterns inside tests:

```go
t.Run(tc.name, func(t *testing.T) {
    srv := startServer()
    t.Cleanup(srv.Stop)
    ...
})
```

Multiple `Cleanup` calls run in LIFO order. Cleanups run when the subtest exits, **after** all its own subtests complete.

---

## Assertion Helpers and `t.Helper`

Most tables eventually grow assertion helpers. A helper that doesn't mark itself with `t.Helper` makes failure output point at the helper's `t.Errorf` line — not the test row that called it.

```go
func assertJSONEqual(t *testing.T, got, want []byte) {
    t.Helper()
    var g, w any
    if err := json.Unmarshal(got, &g); err != nil { t.Fatal(err) }
    if err := json.Unmarshal(want, &w); err != nil { t.Fatal(err) }
    if !reflect.DeepEqual(g, w) {
        t.Errorf("JSON mismatch:\ngot:  %s\nwant: %s", got, want)
    }
}
```

Without `t.Helper`:

```
=== RUN   TestEncode/full
    helpers.go:14: JSON mismatch: ...
```

Useless — that's the helper, not the caller. With `t.Helper`:

```
=== RUN   TestEncode/full
    encode_test.go:42: JSON mismatch: ...
```

Now we know it's line 42 of the test file, where the subtest body called `assertJSONEqual`.

**Rule**: every helper that calls `t.Error` or `t.Fatal` should call `t.Helper()` as its first line. Helpers that just do work and don't fail tests don't need it.

`t.Helper` cascades: if helper A calls helper B and both call `t.Helper`, failures point at the test code that called A, not at A or B.

---

## Golden Files in a Table

A **golden file** is a checked-in file containing the expected output of a test case. Update with a flag; on mismatch, the test fails with a diff.

```go
var update = flag.Bool("update", false, "rewrite golden files")

func TestRender(t *testing.T) {
    cases := []struct {
        name string
        in   Input
    }{
        {"empty", Input{}},
        {"simple", Input{Name: "Ada"}},
        {"complex", Input{Name: "Ada", Items: []string{"a", "b", "c"}}},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got := Render(tc.in)
            golden := filepath.Join("testdata", "render", tc.name+".golden")
            if *update {
                if err := os.WriteFile(golden, got, 0644); err != nil {
                    t.Fatal(err)
                }
                return
            }
            want, err := os.ReadFile(golden)
            if err != nil { t.Fatalf("read %s: %v", golden, err) }
            if !bytes.Equal(got, want) {
                t.Errorf("Render(%s):\ngot:\n%s\nwant:\n%s", tc.name, got, want)
            }
        })
    }
}
```

Workflow:

1. Add a row to `cases`.
2. Run `go test -update -run TestRender/<new_name>`.
3. Inspect the generated `testdata/render/<new_name>.golden` to ensure it's correct.
4. Commit both the row and the golden file in one commit.
5. Subsequent runs verify against the file.

When intentional output changes, rerun with `-update`, review the diff in git, commit.

### Pitfalls

- **Don't auto-update in CI.** `-update` must be a developer-only flag. CI runs without it.
- **Strip non-deterministic content** (timestamps, UUIDs, random IDs) before comparing. Replace with placeholders like `<TIMESTAMP>`.
- **Pretty-print** before saving so diffs are meaningful (`json.MarshalIndent` for JSON, `gofmt` for Go source).

---

## Error Matching with `errors.Is` and `errors.As`

A boolean `wantErr` field is fine for trivial cases. For stronger assertions, use typed errors.

### Sentinel errors with `errors.Is`

```go
var ErrInvalidEmail = errors.New("invalid email")

func TestValidateEmail(t *testing.T) {
    cases := []struct {
        name    string
        in      string
        wantErr error
    }{
        {"valid", "a@b.com", nil},
        {"missing_at", "ab.com", ErrInvalidEmail},
        {"empty", "", ErrInvalidEmail},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            err := ValidateEmail(tc.in)
            if !errors.Is(err, tc.wantErr) {
                t.Errorf("err = %v, want %v", err, tc.wantErr)
            }
        })
    }
}
```

`errors.Is` walks the error chain (`Unwrap`) and returns true if any error in the chain equals the target. So wrapped errors still match.

### Typed errors with `errors.As`

When the error has fields you want to inspect:

```go
type ValidationError struct {
    Field string
    Code  string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Code }

func TestValidate(t *testing.T) {
    cases := []struct {
        name      string
        in        Input
        wantField string
        wantCode  string
    }{
        {"empty_name",   Input{}, "name", "required"},
        {"too_long",     Input{Name: strings.Repeat("a", 1000)}, "name", "max_length"},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            err := Validate(tc.in)
            var ve *ValidationError
            if !errors.As(err, &ve) {
                t.Fatalf("want *ValidationError, got %T (%v)", err, err)
            }
            if ve.Field != tc.wantField || ve.Code != tc.wantCode {
                t.Errorf("got %+v, want field=%s code=%s", ve, tc.wantField, tc.wantCode)
            }
        })
    }
}
```

`errors.As` walks the chain looking for an error of the target type and assigns it to the pointer.

---

## Comparison with go-cmp

`reflect.DeepEqual` works but produces awful failure messages:

```
got: map[string]int{"a":1, "b":2, "c":3}
want: map[string]int{"a":1, "b":2, "c":4}
```

Eyeball-diffing a 30-key map is painful. `github.com/google/go-cmp/cmp` produces line-by-line diffs:

```go
import "github.com/google/go-cmp/cmp"

if diff := cmp.Diff(tc.want, got); diff != "" {
    t.Errorf("mismatch (-want +got):\n%s", diff)
}
```

Output:

```
mismatch (-want +got):
  map[string]int{
      "a": 1,
      "b": 2,
-     "c": 4,
+     "c": 3,
  }
```

`go-cmp` also supports options for ignoring fields, custom equality, and approximate floats:

```go
opt := cmpopts.IgnoreFields(User{}, "CreatedAt")
if diff := cmp.Diff(want, got, opt); diff != "" {
    t.Errorf("mismatch: %s", diff)
}
```

For tables, `go-cmp` shines because every row's failure is immediately legible.

---

## Custom Field Types in a Table

Your table struct can hold functions, interfaces, channels — anything. Patterns:

### Function fields for variant logic

```go
cases := []struct {
    name string
    op   func(int) int
    in   int
    want int
}{
    {"double", func(n int) int { return n * 2 }, 3, 6},
    {"square", func(n int) int { return n * n }, 3, 9},
    {"neg",    func(n int) int { return -n },    3, -3},
}
```

Useful when the function under test takes a function as input. Don't overuse — if every row has a different `op`, you might as well have separate tests.

### Pointer-to-pointer for partial updates

```go
cases := []struct {
    name  string
    patch *Patch
    want  User
}{
    {"name_only", &Patch{Name: ptr("Ada")}, User{Name: "Ada"}},
    {"age_only",  &Patch{Age: ptr(30)},     User{Age: 30}},
}

func ptr[T any](v T) *T { return &v }
```

The `ptr` helper is a common Go idiom for "I need a pointer to a literal".

---

## Working with Time

Time-dependent tables are a flake source. Patterns:

### Inject a clock

```go
type Clock interface{ Now() time.Time }

type fixedClock struct{ t time.Time }
func (c fixedClock) Now() time.Time { return c.t }

func TestRateLimit(t *testing.T) {
    fixed := time.Date(2026, 5, 20, 12, 0, 0, 0, time.UTC)
    cases := []struct {
        name   string
        offset time.Duration
        allow  bool
    }{
        {"now",          0,                true},
        {"1s_later",     time.Second,      true},
        {"61s_later",    61*time.Second,   false}, // window expired
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            clock := fixedClock{t: fixed.Add(tc.offset)}
            limiter := NewLimiter(clock)
            got := limiter.Allow()
            if got != tc.allow {
                t.Errorf("Allow() = %v, want %v", got, tc.allow)
            }
        })
    }
}
```

### Always compare times in UTC

```go
got := f(...)
got = got.UTC()
if !got.Equal(tc.want) { ... }
```

Local time is a foot-gun. `time.Equal` ignores location, but printing a time with `%v` shows location, which is confusing in failures.

---

## Working with HTTP Handlers

`httptest.NewRecorder` and `httptest.NewRequest` make handler tables straightforward:

```go
func TestRouter(t *testing.T) {
    handler := NewRouter()
    cases := []struct {
        name     string
        method   string
        path     string
        body     string
        wantCode int
        wantBody string
    }{
        {"get_root",      "GET", "/",        "",            200, "ok"},
        {"get_unknown",   "GET", "/missing", "",            404, "not found"},
        {"post_create",   "POST", "/items",  `{"name":"x"}`, 201, `{"id":1}`},
        {"post_bad_body", "POST", "/items",  `not json`,    400, "bad request"},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
            rec := httptest.NewRecorder()
            handler.ServeHTTP(rec, req)
            if rec.Code != tc.wantCode {
                t.Errorf("code = %d, want %d", rec.Code, tc.wantCode)
            }
            if got := strings.TrimSpace(rec.Body.String()); got != tc.wantBody {
                t.Errorf("body = %q, want %q", got, tc.wantBody)
            }
        })
    }
}
```

Each row is one request-response pair. The handler can be shared across rows because `httptest.NewRecorder` returns a fresh recorder per call.

---

## Worked Example — JSON Codec Tests

A common real-world table tests both encoding and decoding ("roundtrip"):

```go
type Order struct {
    ID     int       `json:"id"`
    Total  float64   `json:"total"`
    Date   time.Time `json:"date"`
    Status string    `json:"status,omitempty"`
}

func TestOrderJSON(t *testing.T) {
    fixed := time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC)
    cases := []struct {
        name string
        in   Order
        json string
    }{
        {
            name: "minimal",
            in:   Order{ID: 1, Total: 10.5, Date: fixed},
            json: `{"id":1,"total":10.5,"date":"2026-05-20T00:00:00Z"}`,
        },
        {
            name: "with_status",
            in:   Order{ID: 2, Total: 0, Date: fixed, Status: "paid"},
            json: `{"id":2,"total":0,"date":"2026-05-20T00:00:00Z","status":"paid"}`,
        },
        {
            name: "zero_id",
            in:   Order{ID: 0, Total: 99.99, Date: fixed},
            json: `{"id":0,"total":99.99,"date":"2026-05-20T00:00:00Z"}`,
        },
    }
    for _, tc := range cases {
        t.Run(tc.name+"/encode", func(t *testing.T) {
            b, err := json.Marshal(tc.in)
            if err != nil { t.Fatal(err) }
            if string(b) != tc.json {
                t.Errorf("marshal:\ngot  %s\nwant %s", b, tc.json)
            }
        })
        t.Run(tc.name+"/decode", func(t *testing.T) {
            var got Order
            if err := json.Unmarshal([]byte(tc.json), &got); err != nil { t.Fatal(err) }
            if !reflect.DeepEqual(got, tc.in) {
                t.Errorf("unmarshal:\ngot  %+v\nwant %+v", got, tc.in)
            }
        })
    }
}
```

Note the **two `t.Run`s per row** — one for encode, one for decode. They share the same `tc` so the round-trip property is implicit.

---

## Worked Example — Parser with Position Info

When a parser returns errors with source positions, the assertion shape is:

```go
type ParseError struct {
    Line int
    Col  int
    Msg  string
}

func TestParse(t *testing.T) {
    cases := []struct {
        name      string
        in        string
        wantErr   *ParseError
    }{
        {"valid",          "x := 1", nil},
        {"missing_op",     "x  1",   &ParseError{Line: 1, Col: 4, Msg: "expected ':='"}},
        {"unterminated",   "x := \"hello", &ParseError{Line: 1, Col: 12, Msg: "unterminated string"}},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            _, err := Parse(tc.in)
            if tc.wantErr == nil {
                if err != nil { t.Fatalf("unexpected error: %v", err) }
                return
            }
            var pe *ParseError
            if !errors.As(err, &pe) {
                t.Fatalf("want *ParseError, got %T (%v)", err, err)
            }
            if pe.Line != tc.wantErr.Line || pe.Col != tc.wantErr.Col {
                t.Errorf("position = (%d,%d), want (%d,%d)",
                    pe.Line, pe.Col, tc.wantErr.Line, tc.wantErr.Col)
            }
            if !strings.Contains(pe.Msg, tc.wantErr.Msg) {
                t.Errorf("msg = %q, want substring %q", pe.Msg, tc.wantErr.Msg)
            }
        })
    }
}
```

Two things to notice:

1. `wantErr` is a `*ParseError`, not a `bool`. Letting `nil` mean "no error expected" makes the table read naturally.
2. We assert on **field equality** for position but **substring containment** for message. Exact message matching is fragile; substring matching is more durable.

---

## Common Mistakes at This Level

### Mistake 1 — Using `t.Setenv` in a parallel row

```go
t.Run(tc.name, func(t *testing.T) {
    t.Parallel()
    t.Setenv("FOO", tc.foo) // BOOM
})
```

Panic. Either don't parallel, or refactor away the env-var dependency.

### Mistake 2 — Forgetting `t.Helper` in deeply nested helpers

```go
func deepCheck(t *testing.T, ...) {
    t.Helper()
    midCheck(t, ...) // calls t.Errorf
}

func midCheck(t *testing.T, ...) {
    // missing t.Helper — failures point here
}
```

`t.Helper` is per-function. Every helper in the chain needs its own.

### Mistake 3 — Mutating shared fixtures from parallel rows

```go
shared := &Config{}
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        shared.Set(tc.key, tc.val) // race
        ...
    })
}
```

Either clone `shared` per row, or remove `t.Parallel`.

### Mistake 4 — Auto-updating golden files in CI

```go
if *update {
    os.WriteFile(golden, got, 0644)
}
```

If `update` defaults to `true`, or if CI passes `-update`, golden files get rewritten and the test passes trivially. Always default to `false`, never enable in CI.

### Mistake 5 — Asserting on `err.Error()` strings

```go
if err.Error() != "invalid email" { ... }
```

Brittle: any wording change in the error message breaks the test. Prefer `errors.Is` for sentinels or `strings.Contains` for substring checks.

---

## What to Read Next

- [Senior](../senior/) — designing tables for complex domains, matrix tests, nested tables.
- [Professional](../professional/) — managing tables at scale, data formats, CI practices.
- [Find the Bug](../find-bug/) — sharpen diagnosis.

---

## Self-Check

1. What does the `-run TestX/foo` pattern actually match? What about `-run '^TestX$/^foo$'`?
2. When a subtest calls `t.Parallel`, when does it actually start running?
3. Why must `t.Helper` be the first line of an assertion helper?
4. What's the difference between `errors.Is` and `errors.As`?
5. How do you keep golden files from being auto-rewritten in CI?

---

## Deep Dive — `t.Cleanup` Ordering

`t.Cleanup` registers a function to run when the test (or subtest) ends. Multiple registrations run in **LIFO** order:

```go
t.Run(tc.name, func(t *testing.T) {
    t.Cleanup(func() { log.Print("first cleanup registered, last to run") })
    t.Cleanup(func() { log.Print("second cleanup registered, runs before first") })
    t.Cleanup(func() { log.Print("third cleanup registered, runs first") })
    // ... test body
})
```

Output order: third, second, first.

This LIFO order mirrors `defer` stacking and lets you compose cleanups bottom-up. Setup A, setup B, setup C → cleanup C, cleanup B, cleanup A.

Cleanups also propagate up: if the subtest body calls `t.Cleanup` and the parent's `Run` returns, the cleanup runs before the parent returns from its own body.

A subtle point: cleanups run after **all subtests of the cleanup's owner finish**. So if you call `t.Cleanup` inside `TestX` (not inside a `t.Run`), it runs after all `t.Run` subtests are done — useful for tearing down a fixture used by all rows.

---

## Deep Dive — `cmp` Options for Real Tables

`go-cmp` accepts options that control comparison. Common ones for table-driven tests:

```go
import (
    "github.com/google/go-cmp/cmp"
    "github.com/google/go-cmp/cmp/cmpopts"
)

opts := []cmp.Option{
    cmpopts.IgnoreFields(User{}, "CreatedAt", "UpdatedAt"),  // ignore timestamps
    cmpopts.EquateEmpty(),                                    // nil == empty slice/map
    cmpopts.SortSlices(func(a, b int) bool { return a < b }), // sort before compare
    cmpopts.EquateApprox(0.001, 0),                           // float tolerance
}

if diff := cmp.Diff(tc.want, got, opts...); diff != "" {
    t.Errorf("mismatch (-want +got):\n%s", diff)
}
```

For tables where every row uses the same options, define `opts` at package level so all assertions share configuration:

```go
var defaultOpts = []cmp.Option{
    cmpopts.IgnoreFields(User{}, "CreatedAt"),
    cmpopts.EquateEmpty(),
}
```

This avoids duplicating option setup in every assertion.

### Comparing unexported fields

`cmp` panics if your struct has unexported fields you didn't tell it about. Either expose the fields, use `cmp.AllowUnexported(User{})` (use with caution — couples tests to internals), or compare by exported method results (`u.Name()` instead of `u.name`).

```go
cmp.AllowUnexported(User{})
```

For tables that grow into deeply nested third-party types, you'll often combine `IgnoreFields`, `AllowUnexported`, and `EquateEmpty` into a single options pack.

---

## Deep Dive — `httptest.NewServer` vs `httptest.NewRecorder`

Both let you test HTTP handlers; choose based on what you need:

- **`NewRecorder`** — in-process. The handler's `ServeHTTP` is called directly, the response is captured to a `ResponseRecorder`. Fast (~microseconds per call). No network. Best for unit tests of handlers.
- **`NewServer`** — spins up a real local TCP server. You make actual HTTP requests via `http.Client`. Slower (~milliseconds). Tests the full HTTP stack including middlewares, TLS, redirects. Best for integration-style tests.

For table-driven tests of a single handler, `NewRecorder` wins. For tests that exercise a full router with middleware, `NewServer` is more realistic.

```go
// NewRecorder pattern (preferred for table-driven handler tests)
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
        rec := httptest.NewRecorder()
        handler.ServeHTTP(rec, req)
        // assert on rec.Code, rec.Body
    })
}

// NewServer pattern (full stack)
srv := httptest.NewServer(handler)
defer srv.Close()
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        resp, err := http.Post(srv.URL+tc.path, "application/json", strings.NewReader(tc.body))
        // ...
    })
}
```

---

## Deep Dive — When a Single Row Needs Custom Behavior

You'll occasionally hit a row that needs slightly different logic. Don't bend the struct — use a `setup` or `before` function field for the exceptional rows:

```go
cases := []struct {
    name   string
    in     Input
    want   Output
    setup  func(*testing.T)
}{
    {"normal_case", Input{...}, Output{...}, nil},
    {"needs_db_seed", Input{...}, Output{...}, func(t *testing.T) {
        seedDB(t)
    }},
}
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        if tc.setup != nil { tc.setup(t) }
        ...
    })
}
```

Acceptable for one or two outliers. If more than 20% of rows need `setup`, that's a smell — split the table.

---

## Deep Dive — Strict JSON Comparison

Comparing JSON byte-for-byte is fragile (whitespace, key order). Two strategies for tables:

### 1. Normalize both sides

```go
func normalizeJSON(t *testing.T, b []byte) []byte {
    t.Helper()
    var v any
    if err := json.Unmarshal(b, &v); err != nil { t.Fatal(err) }
    out, err := json.MarshalIndent(v, "", "  ")
    if err != nil { t.Fatal(err) }
    return out
}

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        got := normalizeJSON(t, produce(tc.in))
        want := normalizeJSON(t, []byte(tc.wantJSON))
        if !bytes.Equal(got, want) { ... }
    })
}
```

### 2. Unmarshal both sides and compare with cmp

```go
var got, want any
json.Unmarshal(produce(tc.in), &got)
json.Unmarshal([]byte(tc.wantJSON), &want)
if diff := cmp.Diff(want, got); diff != "" {
    t.Errorf("JSON mismatch: %s", diff)
}
```

Strategy 2 produces nicer diffs but loses key-order info (which is usually a feature). Strategy 1 keeps key order if you want to assert it (rarely).

---

## Common Mid-Level Mistake — Mixing Helpers with Subtest Bodies

A test file accretes a lot of helpers over time. Watch for this anti-pattern:

```go
func TestX(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            runCase(t, tc)
        })
    }
}

func runCase(t *testing.T, tc testCase) {
    t.Helper()
    // 40 lines of setup, assertions, teardown
}
```

The subtest body is now empty except for a helper call. This isn't wrong, but it hides the test logic in a function the reviewer has to navigate to. For simple tables, prefer inlining. Helpers are for **truly repeated** setup, not for hiding length.

A good test of "should this be a helper?": does at least three places call it identically?

---

## Common Mid-Level Mistake — Conditionally Calling `t.Parallel`

```go
t.Run(tc.name, func(t *testing.T) {
    if tc.slow { t.Parallel() }
    ...
})
```

This works mechanically but is brittle. Two issues:

1. Output is harder to read — some rows finish immediately, others later.
2. A future maintainer doesn't realize parallelism is conditional.

If only some rows benefit from `t.Parallel`, that's a signal to split into two tests: one parallel, one not.

---

## Deep Dive — `t.Skip` Patterns

`t.Skip`, `t.Skipf`, and `t.SkipNow` mark a subtest as skipped (not passed, not failed). Useful when a row genuinely cannot run in the current environment.

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        if tc.needsDocker && os.Getenv("CI_DOCKER") == "" {
            t.Skip("requires docker (set CI_DOCKER=1)")
        }
        if tc.windowsOnly && runtime.GOOS != "windows" {
            t.Skipf("only runs on windows, got %s", runtime.GOOS)
        }
        ...
    })
}
```

Skipped subtests appear in `go test -v` output as `--- SKIP`. Their skip messages tell developers exactly what's needed to enable them.

### Skip vs filter

`t.Skip` keeps the row in the table — visible to readers, opt-out at runtime. Filtering with `-run` hides the row from output entirely. Prefer `t.Skip` because the existence of the row is part of the test's documentation.

### `testing.Short()` integration

```go
if testing.Short() && tc.slow {
    t.Skip("slow case skipped in -short mode")
}
```

Lets you tier the suite: fast subset for save-loop, full suite for CI.

---

## Deep Dive — Combining Multiple Tests Into One Table

When two functions accept the same input and should produce related outputs, one table can drive both:

```go
type roundtripCase struct {
    name    string
    original Tree
    encoded  string
}

cases := []roundtripCase{
    {"empty", Tree{}, "{}"},
    {"node",  Tree{Val: 1}, `{"val":1}`},
    {"deep",  Tree{Val: 1, Left: &Tree{Val: 2}}, `{"val":1,"left":{"val":2}}`},
}

for _, tc := range cases {
    t.Run(tc.name+"/encode", func(t *testing.T) {
        got, err := json.Marshal(tc.original)
        if err != nil { t.Fatal(err) }
        if string(got) != tc.encoded {
            t.Errorf("encode: got %s, want %s", got, tc.encoded)
        }
    })
    t.Run(tc.name+"/decode", func(t *testing.T) {
        var got Tree
        if err := json.Unmarshal([]byte(tc.encoded), &got); err != nil { t.Fatal(err) }
        if !reflect.DeepEqual(got, tc.original) {
            t.Errorf("decode: got %+v, want %+v", got, tc.original)
        }
    })
}
```

Two subtests per row, sharing the same data. Adding a new case adds both directions.

---

## Deep Dive — Asserting on Slices With Variable Order

If your function returns a slice that's a set (order doesn't matter), comparing slice-equality is wrong. Three approaches:

### 1. Sort before compare

```go
got := f(tc.in)
sort.Strings(got)
sort.Strings(tc.want)
if !slices.Equal(got, tc.want) { ... }
```

### 2. Convert to map

```go
gotSet := make(map[string]bool, len(got))
for _, v := range got { gotSet[v] = true }
wantSet := make(map[string]bool, len(tc.want))
for _, v := range tc.want { wantSet[v] = true }
if !reflect.DeepEqual(gotSet, wantSet) { ... }
```

### 3. Use `cmpopts.SortSlices`

```go
opt := cmpopts.SortSlices(func(a, b string) bool { return a < b })
if diff := cmp.Diff(tc.want, got, opt); diff != "" { ... }
```

The third option produces the cleanest failure output. Use it when you have `go-cmp`.

---

## Tip — Self-Validating Test Data

If your table is large, add a sanity-check test that runs first:

```go
func TestValidateCaseNames(t *testing.T) {
    seen := map[string]bool{}
    for _, tc := range cases {
        if tc.name == "" { t.Errorf("empty case name in case index %d", ...) }
        if seen[tc.name] { t.Errorf("duplicate name: %q", tc.name) }
        seen[tc.name] = true
    }
}
```

Cheap insurance. Catches mistakes that would otherwise show up as cryptic `#01` suffixes in failure output.

---

## Tip — Failure Snippets in CI Logs

CI tools (GitHub Actions, GitLab CI, CircleCI) parse `go test` output to display failures. Tips to make failures readable in CI:

- Keep failure messages on **one line** when possible. CI log parsers break around newlines.
- If multi-line is needed, prefix continuation lines with a marker (e.g. `  | got: ...`).
- Include the row name in every error message redundantly: `t.Errorf("[%s] %s", tc.name, msg)`. Yes, the `=== RUN TestX/case_name` is above the error, but CI may strip context.
- Truncate large diffs. A 10K-line `cmp.Diff` is useless; cap with:

```go
if diff := cmp.Diff(want, got); diff != "" {
    if len(diff) > 2000 { diff = diff[:2000] + "\n... (truncated)" }
    t.Errorf("mismatch:\n%s", diff)
}
```

---

## Common Mid-Level Mistake — Re-Reading the Same Golden File

A naive table-driven test loads each golden file on every iteration. For 50 rows that's 50 syscalls. Cache:

```go
var goldens = func() map[string][]byte {
    m := map[string][]byte{}
    entries, _ := os.ReadDir("testdata/golden")
    for _, e := range entries {
        b, err := os.ReadFile(filepath.Join("testdata/golden", e.Name()))
        if err != nil { panic(err) }
        name := strings.TrimSuffix(e.Name(), ".golden")
        m[name] = b
    }
    return m
}()

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        got := Render(tc.in)
        want, ok := goldens[tc.name]
        if !ok { t.Fatalf("no golden file for %s", tc.name) }
        if !bytes.Equal(got, want) { ... }
    })
}
```

Now the file-system pass happens once. For large suites this can save seconds.

---

## Common Mid-Level Mistake — Forgetting Cleanup on a Failing Subtest

```go
t.Run(tc.name, func(t *testing.T) {
    srv := newServer()
    if err := srv.Setup(tc.config); err != nil {
        t.Fatal(err)
        // srv.Stop() never called — leak
    }
    defer srv.Stop()
    ...
})
```

The `t.Fatal` jumps out of the function before `defer` is set up. Fix with `t.Cleanup`:

```go
srv := newServer()
t.Cleanup(srv.Stop)  // registered before the fatal-able code
if err := srv.Setup(tc.config); err != nil { t.Fatal(err) }
```

Or, ensure `defer` is registered immediately after creating the resource:

```go
srv := newServer()
defer srv.Stop()
if err := srv.Setup(tc.config); err != nil { t.Fatal(err) }
```

Both work. `t.Cleanup` is preferred when the resource is shared by multiple subtests.

---

## A Mid-Level Worked Example — HTTP API Handler Test

Real-world example: testing a JSON CRUD handler.

```go
type apiTestCase struct {
    name       string
    method     string
    path       string
    body       string
    headers    map[string]string
    wantCode   int
    wantBody   string  // substring match
    wantHeader map[string]string
}

func TestUsersAPI(t *testing.T) {
    store := newMemStore()
    handler := NewUserHandler(store)

    cases := []apiTestCase{
        {
            name:     "list_empty",
            method:   "GET",
            path:     "/users",
            wantCode: 200,
            wantBody: `[]`,
        },
        {
            name:     "create_valid",
            method:   "POST",
            path:     "/users",
            body:     `{"name":"Ada","email":"ada@example.com"}`,
            headers:  map[string]string{"Content-Type": "application/json"},
            wantCode: 201,
            wantBody: `"name":"Ada"`,
            wantHeader: map[string]string{"Location": "/users/1"},
        },
        {
            name:     "create_missing_name",
            method:   "POST",
            path:     "/users",
            body:     `{"email":"ada@example.com"}`,
            wantCode: 400,
            wantBody: `"error":"name is required"`,
        },
        {
            name:     "get_existing",
            method:   "GET",
            path:     "/users/1",
            wantCode: 200,
            wantBody: `"name":"Ada"`,
        },
        {
            name:     "get_missing",
            method:   "GET",
            path:     "/users/999",
            wantCode: 404,
            wantBody: `not found`,
        },
        {
            name:     "delete_existing",
            method:   "DELETE",
            path:     "/users/1",
            wantCode: 204,
        },
        {
            name:     "delete_again",
            method:   "DELETE",
            path:     "/users/1",
            wantCode: 404,
        },
    }

    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
            for k, v := range tc.headers {
                req.Header.Set(k, v)
            }
            rec := httptest.NewRecorder()
            handler.ServeHTTP(rec, req)

            if rec.Code != tc.wantCode {
                t.Errorf("code = %d, want %d (body: %s)", rec.Code, tc.wantCode, rec.Body)
            }
            if tc.wantBody != "" && !strings.Contains(rec.Body.String(), tc.wantBody) {
                t.Errorf("body does not contain %q\nfull body: %s", tc.wantBody, rec.Body)
            }
            for k, want := range tc.wantHeader {
                if got := rec.Header().Get(k); got != want {
                    t.Errorf("header %s = %q, want %q", k, got, want)
                }
            }
        })
    }
}
```

Things to notice:

- **Cases run in order**, with `delete_existing` and `delete_again` exercising the sequence (delete, then verify it's gone). This is a deliberate sequence test embedded in a table.
- **Body assertion is substring-based** (`wantBody` is a substring), which is durable against JSON key reordering.
- **Optional fields** (`headers`, `wantHeader`) are zero-valued for rows that don't need them — Go's zero values let us omit fields cleanly.
- **The store is shared across rows.** This is by design — earlier rows seed the data later rows depend on. If you wanted independent rows, you'd reset the store per row.

This pattern scales to dozens of API tests. Adding a new endpoint case is one row.

---

## A Mid-Level Tip — Reading Stdlib Tests

The Go standard library is the single best resource for learning idiomatic table-driven tests. A few files worth reading:

- `src/strconv/atoi_test.go` — concise tables for numeric parsing, mix of valid and invalid inputs.
- `src/path/filepath/path_test.go` — tables with build-tag-gated platform-specific cases.
- `src/encoding/json/decode_test.go` — large tables with `wantErr` and structured expected values.
- `src/net/http/request_test.go` — handler-style tables similar to the one above.
- `src/regexp/all_test.go` — tables with generated cross-product cases.
- `src/time/format_test.go` — symmetric table for `Parse` and `Format`.

Read these as production-quality examples, not as bibles — the stdlib has accumulated some habits (test data inline, sometimes unique to the file) that don't match modern conventions, but the core patterns are excellent.

---

[← Back](../)
