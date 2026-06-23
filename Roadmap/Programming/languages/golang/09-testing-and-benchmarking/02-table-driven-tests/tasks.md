---
layout: default
title: Table-Driven Tests — Tasks
parent: Table-Driven Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/tasks/
---

# Table-Driven Tests — Tasks

[← Back](../)

Hands-on exercises. Each task gives a starting point, the goal, and acceptance criteria. Solve them in order — later tasks assume the patterns from earlier ones.

---

## Task 1 — Convert a duplicated suite into one table

You're given five sibling test functions that all call the same `Normalize(s string) string` function with different inputs:

```go
package text

func TestNormalize_lower(t *testing.T) {
    got := Normalize("HELLO")
    if got != "hello" { t.Errorf("got %q want %q", got, "hello") }
}
func TestNormalize_spaces(t *testing.T) {
    got := Normalize("  hi  ")
    if got != "hi" { t.Errorf("got %q want %q", got, "hi") }
}
func TestNormalize_unicode(t *testing.T) {
    got := Normalize("Ünïcödé")
    if got != "unicode" { t.Errorf("got %q want %q", got, "unicode") }
}
func TestNormalize_empty(t *testing.T) {
    got := Normalize("")
    if got != "" { t.Errorf("got %q want %q", got, "") }
}
func TestNormalize_already(t *testing.T) {
    got := Normalize("clean")
    if got != "clean" { t.Errorf("got %q want %q", got, "clean") }
}
```

**Goal**: replace all five with a single `TestNormalize` that uses a slice-of-struct table and `t.Run`.

**Acceptance**:

- Output of `go test -v` shows five subtests with descriptive names (e.g. `TestNormalize/lower`).
- Adding a sixth case requires adding exactly one row to the table.
- No duplication of the assertion logic.

---

## Task 2 — Generate a table from JSON

You have a file `testdata/cases.json` shaped like:

```json
[
  {"name": "positive", "input": "42", "want": 42, "wantErr": false},
  {"name": "negative", "input": "-7", "want": -7, "wantErr": false},
  {"name": "empty",    "input": "",   "want":  0, "wantErr": true}
]
```

**Goal**: write `TestParseInt` that loads this file at test time and iterates the rows.

**Acceptance**:

- Use `//go:embed testdata/cases.json` to bring the file into the binary.
- Unmarshal into a `[]testCase` slice.
- A failure in unmarshalling fails the whole test with `t.Fatal`.
- Adding a new case to JSON requires no Go code changes.

**Bonus**: also write a `TestMain` that fails fast if `cases.json` is missing.

---

## Task 3 — Make a table-driven test parallel

Given:

```go
func TestEncode(t *testing.T) {
    cases := []struct {
        name string
        in   *User
        want string
    }{
        {"empty", &User{}, `{}`},
        {"name", &User{Name: "Ann"}, `{"name":"Ann"}`},
        {"both", &User{Name: "Ann", Age: 30}, `{"name":"Ann","age":30}`},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := Encode(tc.in)
            if err != nil { t.Fatal(err) }
            if got != tc.want { t.Errorf("got %s want %s", got, tc.want) }
        })
    }
}
```

**Goal**: make every subtest run in parallel.

**Acceptance**:

- Add `t.Parallel()` correctly.
- Add the `tc := tc` shadow if the module declares `go 1.21` or earlier; explain in a comment why it is unnecessary for `go 1.22+`.
- Run with `go test -race -count=20` and confirm zero failures across the 60 subtest invocations.

---

## Task 4 — Debug a flaky parallel table

You have this test, which passes when run with `-parallel 1` but fails intermittently when run with the default `-parallel`:

```go
var counter int

func TestIncrement(t *testing.T) {
    cases := []struct {
        name string
        n    int
        want int
    }{
        {"one", 1, 1},
        {"two", 2, 3},
        {"three", 3, 6},
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            counter += tc.n
            if counter != tc.want { t.Errorf("counter = %d, want %d", counter, tc.want) }
        })
    }
}
```

**Goal**: identify the bug and fix it.

**Acceptance**:

- Diagnose: explain why parallel execution breaks this test.
- Fix: either remove `t.Parallel`, or refactor so each subtest doesn't depend on global state.
- Justify your fix.

---

## Task 5 — Build a matrix test

Given a `Convert(value any, target Type) (any, error)` function that supports converting between `Int`, `Float`, `String`, and `Bool` types.

**Goal**: write a matrix test that covers every `(source type, target type)` pair — 16 combinations.

**Acceptance**:

- Use **nested** `t.Run` calls so output looks like `TestConvert/int/float`, `TestConvert/string/bool`, etc.
- Each leaf row has at least one positive case and one negative case.
- Add a `skip` flag for combinations that are intentionally not supported (e.g. `string → bool` may error).

---

## Task 6 — Add golden-file integration

Given a `Render(data Data) []byte` function that emits HTML.

**Goal**: write `TestRender` table-driven, where the `want` is loaded from a golden file per case.

**Acceptance**:

- Each row has a `name` field; golden file lives at `testdata/render/<name>.golden`.
- A `-update` flag rewrites all golden files.
- On mismatch, the failure message shows the first 200 bytes of `got` and points at the row.
- Use `t.Helper` in any assertion helper.

---

## Task 7 — Build a fuzz-seed table

Given a `Roundtrip(b []byte) ([]byte, error)` function that decodes, validates, and re-encodes a payload.

**Goal**: write `FuzzRoundtrip` with a seed table of known good and known bad inputs.

**Acceptance**:

- At least 8 seed cases added via `f.Add(...)`.
- Inside `f.Fuzz`, the assertion is `Roundtrip(Roundtrip(b)) == Roundtrip(b)` (idempotence).
- Place additional binary seeds under `testdata/fuzz/FuzzRoundtrip/`.

---

## Task 8 — Measure t.Run overhead

**Goal**: write a benchmark that measures the per-subtest overhead of `t.Run`.

**Acceptance**:

- A benchmark `BenchmarkSubtestOverhead` that runs `b.N` subtests using `b.Run` with empty bodies.
- Compare against a baseline benchmark that runs `b.N` empty iterations with no `b.Run` wrapper.
- Report the delta in nanoseconds per call.

---

## Task 9 — Split a god-table

You inherit a 600-line test function `TestHandler` that has 47 rows in a single table. Cases are mixed: some test parsing, some test authorization, some test rate-limiting, some test rendering, and several need a Postgres container, while others are pure.

**Goal**: refactor.

**Acceptance**:

- Group cases by concern. Each concern becomes its own test function (`TestHandler_Parsing`, `TestHandler_Auth`, ...) with its own smaller table.
- The Postgres-dependent rows go in a separate file under a `//go:build integration` build tag.
- No row is dropped — counts add up to 47.

---

## Task 10 — Programmatic table generation

**Goal**: write a `TestSort` that programmatically generates 100 random input slices and asserts that `sort.Ints` produces a sorted output.

**Acceptance**:

- Each generated row has a name like `random_0001`, `random_0002`, ...
- Use a fixed seed so reruns are deterministic.
- Use `sort.IntsAreSorted` for the assertion.
- Run with `-count 5` to confirm stability across reruns.

**Bonus**: take a `-tests N` custom flag so the count is configurable.

---

## Task 11 — Share a table across two packages

Create `internal/testcases/canonical.go` exposing:

```go
type Canonical struct {
    Name    string
    Pretty  string
    Compact string
}

var Cases = []Canonical{ ... }
```

**Goal**: write `parser_test.go` and `formatter_test.go` in two separate packages that both import `internal/testcases` and iterate `Cases`.

**Acceptance**:

- Parser test reads `tc.Pretty`, asserts `Parse(tc.Pretty)` produces an AST whose `String()` returns `tc.Compact`.
- Formatter test reads `tc.Compact`, asserts `Format(Parse(tc.Compact))` returns `tc.Pretty`.
- Adding a case to `Cases` automatically affects both tests.

---

## Task 12 — Build a stateful sequence table

You have a `Counter` type with `Inc()`, `Dec()`, `Reset()`, `Get()` methods.

**Goal**: write a test where each row is a sequence of operations:

```go
type step struct { op string; want int }
cases := []struct {
    name  string
    steps []step
}{
    {"basic", []step{{"inc", 1}, {"inc", 2}, {"dec", 1}}},
    {"reset", []step{{"inc", 1}, {"reset", 0}, {"inc", 1}}},
}
```

**Acceptance**:

- Each row creates a fresh `Counter` inside the `t.Run` body.
- The subtest iterates `tc.steps`, applies each op, asserts `c.Get() == s.want` after.
- Failure messages include the step index.

---

## Task 13 — Migrate a god-table

You inherit a 600-line test function with 47 rows in a single table. Rows test parsing, authorization, rate-limiting, and rendering — four distinct concerns.

**Goal**: refactor into four smaller `Test*` functions, each with its own focused table.

**Acceptance**:

- Total row count after refactor matches before (47).
- Each new function compiles and passes independently.
- Shared fixtures move to a `newTestHandler` helper.

---

## Task 14 — Anchored `-run` patterns

**Goal**: given the test `TestParse` with subtests `valid_simple`, `valid_complex`, `valid_with_unicode`, `invalid_empty`, `invalid_malformed`, write the **exact** `go test -run` commands that:

1. Run only the three `valid_*` rows.
2. Run only `invalid_empty`.
3. Run all rows whose name contains "unicode".
4. Run `TestParse` but **not** `TestParseV2`.

**Acceptance**:

- Each command uses anchors (`^`, `$`) where appropriate to avoid over-matching.

---

[← Back](../)
