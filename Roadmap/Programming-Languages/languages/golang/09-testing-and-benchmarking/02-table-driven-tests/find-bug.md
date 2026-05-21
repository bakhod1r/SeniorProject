---
layout: default
title: Table-Driven Tests — Find the Bug
parent: Table-Driven Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/find-bug/
---

# Table-Driven Tests — Find the Bug

[← Back](../)

Each snippet below has at least one defect. The defects are common — loop-variable capture, shared state, non-deterministic ordering, missing names, wrong assertion direction, env-var clobbering. Diagnose, then read the explanation.

---

## Bug 1 — The classic pre-Go 1.22 capture bug

```go
// go.mod declares: go 1.21
func TestSquare(t *testing.T) {
    cases := []struct {
        name string
        in   int
        want int
    }{
        {"two",   2, 4},
        {"three", 3, 9},
        {"four",  4, 16},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            if got := Square(tc.in); got != tc.want {
                t.Errorf("got %d want %d", got, tc.want)
            }
        })
    }
}
```

**Symptom**: all three subtests report `got 16 want X` where X is the row's intended `want`, or pass intermittently.

**Bug**: in `go 1.21` modules the loop variable `tc` is **shared across iterations**. When the parallel goroutine actually runs (after the loop has finished), `tc` is the last row. Add `tc := tc` shadow:

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) { ... })
}
```

Or bump the module to `go 1.22`. The `copyloopvar` linter will then flag the shadow as redundant.

---

## Bug 2 — Shared mutable state across rows

```go
var cache = map[string]int{}

func TestLookup(t *testing.T) {
    cases := []struct {
        name string
        key  string
        val  int
        want int
    }{
        {"miss",  "alice", 0,  0},
        {"set",   "alice", 99, 99},
        {"hit",   "alice", 0, 99},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            if tc.val != 0 { cache[tc.key] = tc.val }
            got := cache[tc.key]
            if got != tc.want { t.Errorf("got %d want %d", got, tc.want) }
        })
    }
}
```

**Symptom**: passes today, breaks tomorrow when someone runs `go test -shuffle on` or when another test populates `cache` in a different file.

**Bug**: rows have a sequential dependency — row 3 (`hit`) only works because row 2 (`set`) ran first and mutated package-level state. The rows are not independent.

**Fix**: either initialize `cache` fresh inside each `t.Run`, or collapse the three rows into one test that explicitly exercises the sequence `miss → set → hit`.

---

## Bug 3 — Missing case names cause duplicate suffixes

```go
func TestValidate(t *testing.T) {
    cases := []struct {
        in   string
        want bool
    }{
        {"alice@example.com", true},
        {"bob@example.com",   true},
        {"not-an-email",      false},
    }
    for _, tc := range cases {
        t.Run("case", func(t *testing.T) {
            if Validate(tc.in) != tc.want { t.Error("mismatch") }
        })
    }
}
```

**Symptom**: failures report `TestValidate/case#01 — mismatch`. You don't know which input failed.

**Bug**: every row uses the same name `"case"`. Go disambiguates with `#NN` but the names are uninformative. Also, `t.Error("mismatch")` doesn't include `tc.in` or `tc.want`.

**Fix**: give each row a name (`tc.in` works as a quick name if it's safe), and make the failure message include the inputs:

```go
t.Run(tc.in, func(t *testing.T) {
    got := Validate(tc.in)
    if got != tc.want { t.Errorf("Validate(%q) = %v, want %v", tc.in, got, tc.want) }
})
```

---

## Bug 4 — Map iteration order mistaken for stability

```go
func TestStep(t *testing.T) {
    cases := map[string]struct {
        in, want int
    }{
        "first":  {1, 2},
        "second": {2, 4},
        "third":  {3, 6},
    }
    var prev int
    for name, tc := range cases {
        t.Run(name, func(t *testing.T) {
            got := Step(tc.in, prev)
            if got != tc.want { t.Errorf("Step(%d,%d)=%d want %d", tc.in, prev, got, tc.want) }
            prev = got
        })
    }
}
```

**Symptom**: passes sometimes, fails sometimes, depending on Go's map-iteration randomization.

**Bug**: the test depends on iteration order (`prev` accumulates across rows), but `range` on a map is **unordered**. Use a slice when order matters, or sort the keys explicitly.

```go
keys := make([]string, 0, len(cases))
for k := range cases { keys = append(keys, k) }
sort.Strings(keys)
```

---

## Bug 5 — `t.Parallel` with `t.Setenv`

```go
func TestEnv(t *testing.T) {
    cases := []struct {
        name string
        env  string
        want string
    }{
        {"prod", "PROD", "production"},
        {"dev",  "DEV",  "development"},
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            t.Setenv("APP_ENV", tc.env)
            got := ResolveEnv()
            if got != tc.want { t.Errorf("got %q want %q", got, tc.want) }
        })
    }
}
```

**Symptom**: `panic: t.Setenv called after t.Parallel; cannot set environment variables in parallel tests`.

**Bug**: `t.Setenv` cannot coexist with `t.Parallel` because env vars are process-global.

**Fix**: remove `t.Parallel`, or refactor `ResolveEnv` to take an explicit string instead of reading os env.

---

## Bug 6 — `wantErr` swallows the wrong error

```go
func TestDivide(t *testing.T) {
    cases := []struct {
        name    string
        a, b    int
        want    int
        wantErr bool
    }{
        {"normal",    10, 2, 5, false},
        {"div-by-0",  10, 0, 0, true},
        {"overflow",  math.MaxInt, 1, math.MaxInt, false},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := Divide(tc.a, tc.b)
            if (err != nil) != tc.wantErr { t.Fatalf("err=%v", err) }
            if got != tc.want { t.Errorf("got %d want %d", got, tc.want) }
        })
    }
}
```

**Symptom**: row `div-by-0` passes even when `Divide` returns `errors.New("connection lost")` instead of the real `ErrDivByZero`.

**Bug**: `wantErr bool` only checks "any error vs no error", not "which error". A regression where `Divide` returns the wrong error type would pass.

**Fix**: use a typed sentinel:

```go
wantErr error
// ...
if !errors.Is(err, tc.wantErr) { t.Fatalf("err=%v want=%v", err, tc.wantErr) }
```

---

## Bug 7 — Calling `t.Fatal` outside the subtest

```go
func TestOpen(t *testing.T) {
    cases := []struct {
        name string
        path string
        want []byte
    }{
        {"empty",  "testdata/empty.txt",  []byte{}},
        {"hello",  "testdata/hello.txt",  []byte("hello")},
        {"binary", "testdata/binary.bin", []byte{0x00, 0x01}},
    }
    f, err := os.Open("testdata/empty.txt")
    if err != nil { t.Fatal(err) }
    defer f.Close()
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := os.ReadFile(tc.path)
            if err != nil { t.Fatal(err) }
            if !bytes.Equal(got, tc.want) { t.Error("mismatch") }
        })
    }
}
```

**Symptom**: when `testdata/empty.txt` doesn't exist, the entire test fails immediately with one message — no subtests show. Also, the `f` is opened but never used.

**Bug**: the outer `t.Fatal` aborts the whole table before any row runs, hiding which rows would have passed. The opened file is also unused, indicating dead code.

**Fix**: remove the outer file open; do per-row setup inside the `t.Run` body where its failure is scoped to that row.

---

## Bug 8 — Captured pointer mutation

```go
func TestStrategy(t *testing.T) {
    cfg := &Config{Mode: "default"}
    cases := []struct {
        name string
        mode string
        want string
    }{
        {"a", "fast", "fast-result"},
        {"b", "safe", "safe-result"},
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            cfg.Mode = tc.mode
            got := Strategy(cfg)
            if got != tc.want { t.Errorf("got %q want %q", got, tc.want) }
        })
    }
}
```

**Symptom**: under `-race`, the test reports a data race on `cfg.Mode`. Under `-race off`, results are non-deterministic — row `a` might see `cfg.Mode == "safe"` because row `b` overwrote it.

**Bug**: both parallel subtests share the **same** `*Config` and write to it concurrently. The `tc := tc` shadow only copies the **case struct**, not the pointer's pointee.

**Fix**: clone the config per row:

```go
local := *cfg
local.Mode = tc.mode
got := Strategy(&local)
```

---

## Bug 9 — Wrong direction of comparison

```go
func TestRound(t *testing.T) {
    cases := []struct {
        in   float64
        want float64
    }{
        {1.4, 1},
        {1.5, 2},
        {1.6, 2},
    }
    for _, tc := range cases {
        t.Run(fmt.Sprintf("%v", tc.in), func(t *testing.T) {
            got := Round(tc.in)
            if tc.want != got { /* note: condition swapped */
                t.Errorf("Round(%v) = %v, want %v", tc.in, tc.want, got)
            }
        })
    }
}
```

**Symptom**: error messages say `Round(1.4) = 1, want 1` — got and want are swapped in the message, even when the comparison itself is correct.

**Bug**: the `t.Errorf` format string has the arguments in the wrong order. Compare `if got != tc.want` is fine, but the message labels are flipped.

**Fix**:

```go
t.Errorf("Round(%v) = %v, want %v", tc.in, got, tc.want)
```

Always: `format("X = %v, want %v", got, want)` — `got` first.

---

## Bug 10 — Forgetting `t.Helper` in an assertion helper

```go
func assertJSONEqual(t *testing.T, got, want []byte) {
    var g, w any
    if err := json.Unmarshal(got, &g); err != nil { t.Fatal(err) }
    if err := json.Unmarshal(want, &w); err != nil { t.Fatal(err) }
    if !reflect.DeepEqual(g, w) { t.Errorf("got %v want %v", g, w) }
}

func TestEncode(t *testing.T) {
    cases := []struct {
        name string
        in   *Order
        want []byte
    }{
        {"empty", &Order{}, []byte(`{}`)},
        {"full",  &Order{ID: 1, Item: "x"}, []byte(`{"id":1,"item":"x"}`)},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := json.Marshal(tc.in)
            if err != nil { t.Fatal(err) }
            assertJSONEqual(t, got, tc.want)
        })
    }
}
```

**Symptom**: when a row fails, the failure points at the line `t.Errorf("got %v want %v", g, w)` **inside** the helper, not at the call site in the test. Hard to map back to a row.

**Bug**: `assertJSONEqual` is missing `t.Helper()`.

**Fix**:

```go
func assertJSONEqual(t *testing.T, got, want []byte) {
    t.Helper()
    // ...
}
```

Now the failure report points at the `assertJSONEqual(t, got, tc.want)` line, which in `go test -v` is right next to the subtest name.

---

## Bug 11 — Unstable row order from a map

```go
cases := map[string]struct {
    in   string
    want string
}{
    "lower":  {"HELLO", "hello"},
    "trim":   {"  hi  ", "hi"},
    "empty":  {"", ""},
}
for name, tc := range cases {
    t.Run(name, func(t *testing.T) {
        if got := Normalize(tc.in); got != tc.want {
            t.Errorf("Normalize(%q) = %q, want %q", tc.in, got, tc.want)
        }
    })
}
```

**Symptom**: passes, but `go test -v` output varies between runs — sometimes `lower` runs first, sometimes `empty`. This obscures CI logs.

**Bug**: Go map iteration is intentionally randomized. The test is correct, but the **output order** is unstable.

**Fix**: either use a slice, or extract keys and sort:

```go
keys := make([]string, 0, len(cases))
for k := range cases { keys = append(keys, k) }
sort.Strings(keys)
for _, k := range keys {
    tc := cases[k]
    t.Run(k, func(t *testing.T) { ... })
}
```

For new code, prefer slices.

---

## Bug 12 — Closure over the wrong variable

```go
type step struct {
    name string
    fn   func() int
}

base := 10
steps := []step{
    {"plus_one", func() int { return base + 1 }},
}
base = 100 // change after table literal

for _, s := range steps {
    t.Run(s.name, func(t *testing.T) {
        if got := s.fn(); got != 11 {
            t.Errorf("got %d, want 11", got)
        }
    })
}
```

**Symptom**: the test fails — `got 101, want 11`.

**Bug**: the closure `func() int { return base + 1 }` captured `base` by reference. By the time the test runs, `base` has been changed.

**Fix**: capture the desired value at literal-construction time:

```go
b := base
steps := []step{
    {"plus_one", func() int { return b + 1 }},
}
```

Or use closure parameters explicitly. This isn't strictly a table bug — it's a closure bug — but tables with `func` fields routinely hit it.

---

[← Back](../)
