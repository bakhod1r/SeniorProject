---
layout: default
title: Table-Driven Tests — Optimize
parent: Table-Driven Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/optimize/
---

# Table-Driven Tests — Optimize

[← Back](../)

Table-driven tests scale well into the hundreds of rows. Past that, three sources of cost dominate:

1. Per-subtest overhead from `t.Run` (~3–10 µs per call).
2. Per-row fixture setup (DB connections, file system, mocks).
3. Linear scans of the table to find a specific row when debugging.

This file shows how to measure each cost and how to reduce it without sacrificing readability.

---

## Measuring `t.Run` overhead

A baseline benchmark with an empty subtest body:

```go
func BenchmarkEmptySubtest(b *testing.B) {
    for i := 0; i < b.N; i++ {
        b.Run("noop", func(b *testing.B) {
            // intentionally empty
        })
    }
}

func BenchmarkNoSubtest(b *testing.B) {
    for i := 0; i < b.N; i++ {
        // nothing
    }
}
```

Sample numbers on a Linux x86_64 laptop, Go 1.22:

```
BenchmarkEmptySubtest-8   400000   3500 ns/op   376 B/op   6 allocs/op
BenchmarkNoSubtest-8     1e9         0.3 ns/op   0 B/op    0 allocs/op
```

Each `b.Run` (or `t.Run`) costs ~3.5 µs and ~376 bytes of allocation. For 1000 rows that's ~3.5 ms total — usually invisible. For 100,000 rows it's 350 ms — noticeable. For 1,000,000+ generated cases (e.g., property-based or fuzz), batching into a single `t.Run` and reporting failures with `t.Logf` + `t.Fail` is cheaper.

---

## When to batch

Rule of thumb: if you have a hot loop of cheap assertions (string parsing, arithmetic) and 10K+ rows, batch:

```go
func TestParseBigBatch(t *testing.T) {
    cases := loadHugeTable() // 50,000 rows

    failures := 0
    for _, tc := range cases {
        got, err := Parse(tc.in)
        if (err != nil) != tc.wantErr || got != tc.want {
            t.Errorf("Parse(%q) = (%v, %v), want (%v, %v)", tc.in, got, err, tc.want, tc.wantErr)
            failures++
            if failures > 20 {
                t.Fatalf("too many failures (%d), aborting", failures)
            }
        }
    }
}
```

Trade-offs:

- Lose per-row `-run` filtering.
- Lose isolated subtest output.
- Gain ~3.5 µs per row, which compounds.

For most production tests (50–500 rows of moderate-cost assertions), keep `t.Run`. Batch only when the profile shows `t.Run` overhead matters.

---

## Hoisting expensive setup

A common smell: each row re-builds a server, a DB pool, or a parser instance.

```go
// SLOW: builds the parser 100 times
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        p := NewParser(WithStrict(), WithMaxDepth(50))
        if got := p.Parse(tc.in); got != tc.want { ... }
    })
}
```

If the parser is **immutable** and **safe to share**, hoist it:

```go
p := NewParser(WithStrict(), WithMaxDepth(50))
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        if got := p.Parse(tc.in); got != tc.want { ... }
    })
}
```

Caveat: only safe when the parser carries no per-call state and you are not using `t.Parallel`. If parallel and the parser holds a mutex internally, hoisting is still fine — measure first. If the parser is genuinely per-row stateful, you cannot hoist; use `b.ResetTimer` instead in benchmarks.

---

## Avoiding redundant work inside the subtest

A frequent waste: marshalling `tc.want` to JSON inside every subtest when it's a constant.

```go
// Wasteful: marshals 100 times
t.Run(tc.name, func(t *testing.T) {
    wantJSON, _ := json.Marshal(tc.want)
    gotJSON, _ := json.Marshal(Compute(tc.in))
    if !bytes.Equal(gotJSON, wantJSON) { ... }
})
```

Pre-compute outside the loop:

```go
type prepared struct {
    name     string
    in       Input
    wantJSON []byte
}
prepared := make([]prepared, 0, len(cases))
for _, tc := range cases {
    j, _ := json.Marshal(tc.want)
    prepared = append(prepared, prepared{tc.name, tc.in, j})
}
for _, tc := range prepared {
    t.Run(tc.name, func(t *testing.T) {
        gotJSON, _ := json.Marshal(Compute(tc.in))
        if !bytes.Equal(gotJSON, tc.wantJSON) { ... }
    })
}
```

---

## Parallel speedup measurement

For an N-row table where each row takes ~T to run, `-parallel K` lets you complete in roughly `N*T / min(K, N)`. Real speedup depends on the work being CPU-bound or I/O-bound. CPU-bound work scales with `GOMAXPROCS`; I/O-bound work can scale to higher `-parallel`.

To see if you're parallel-bound, run:

```
go test -count=1 -parallel=1 -v ./...
go test -count=1 -parallel=8 -v ./...
```

Compare wall time. If the speedup is sub-linear, you have a serialization point (a global lock, an external system, `t.Setenv` accidentally serializing rows, etc.).

---

## Reducing fixture cost with `testing.TB`-shaped helpers

A helper that takes `testing.TB` works for both `*T` and `*B`. This lets you share setup between table-driven tests and benchmarks:

```go
func newTestDB(tb testing.TB) *sql.DB {
    tb.Helper()
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil { tb.Fatal(err) }
    tb.Cleanup(func() { db.Close() })
    return db
}
```

Now both `TestQueries` and `BenchmarkQueries` can call `newTestDB(t)` / `newTestDB(b)` without duplication.

---

## Compiling tables once with `sync.Once`

If a table is built from `embed`, JSON unmarshalling cost is paid every time the test binary starts. To pay it once per test run (across multiple `t.Run` parents in the same package):

```go
var (
    casesOnce sync.Once
    cases     []testCase
)

func getCases(tb testing.TB) []testCase {
    casesOnce.Do(func() {
        if err := json.Unmarshal(raw, &cases); err != nil {
            tb.Fatal(err)
        }
    })
    return cases
}
```

This shaves ~5–20 ms off package-wide test time when the table is large.

---

## Cache golden-file reads

If 50 subtests read 50 golden files, each `os.ReadFile` is a syscall. Cache them:

```go
var golden = func() map[string][]byte {
    m := map[string][]byte{}
    entries, _ := os.ReadDir("testdata/golden")
    for _, e := range entries {
        b, _ := os.ReadFile(filepath.Join("testdata/golden", e.Name()))
        m[strings.TrimSuffix(e.Name(), ".golden")] = b
    }
    return m
}()
```

Now each subtest does a map lookup instead of a syscall.

---

## Avoid `reflect.DeepEqual` when you have a typed equality

`reflect.DeepEqual` is reflection-based and 10×–100× slower than a typed comparison. If your row's `want` is `string`, comparing `got == want` is much faster than `reflect.DeepEqual(got, want)`. Use `cmp.Equal` from `github.com/google/go-cmp/cmp` only when you need diff output or when the type is complex.

---

## Profile a slow test suite

```
go test -cpuprofile=cpu.out -bench=. -benchtime=10s ./pkg
go tool pprof -http=:8080 cpu.out
```

Look at the flame graph. In a table-driven test, expect to see:

- `testing.tRunner` and `testing.(*T).Run` near the top — that's the subtest scaffolding.
- Your function under test should be the visible bulk.

If `runtime.goexit` or `runtime.newproc` dominates, you have too many subtests for the actual work being done. Batch.

---

## Checklist before optimizing

1. Have you actually measured? `go test -v` and `time go test` both tell you something.
2. Is the slowness from `t.Run` overhead, or from work inside the rows?
3. Are you running with `-parallel 1` accidentally?
4. Is `t.Setenv` serializing rows that should be parallel?
5. Are you re-doing setup that could be hoisted?
6. Is `reflect.DeepEqual` showing up in the profile?

Most "slow test" tickets resolve at step 4 or 5. Genuine `t.Run` overhead is rarely the problem.

---

## Tuning `-parallel` empirically

`-parallel` defaults to `GOMAXPROCS`. That's a sensible default for CPU-bound suites but suboptimal for I/O-bound ones. Find the sweet spot:

```bash
for n in 1 2 4 8 16 32 64; do
    echo "parallel=$n"
    time go test -count=1 -parallel=$n ./...
done
```

Plot the times. You'll typically see:

- Sub-linear speedup from 1 → `GOMAXPROCS` (CPU contention growing).
- Continued speedup past `GOMAXPROCS` if the work is I/O-bound.
- A plateau or regression past some point (resource contention: DB pool exhausted, file descriptor limit, kernel scheduling overhead).

Set `-parallel` to ~80% of the plateau point.

---

## When to compile a table at `init` time

If your table is large and constructed via a function (regex compile, schema parse), running that construction lazily inside `TestX` means each `go test` invocation pays the cost. Pre-build once at `init`:

```go
var compiledCases []testCase

func init() {
    raw := loadRawCases()
    compiledCases = make([]testCase, 0, len(raw))
    for _, r := range raw {
        compiledCases = append(compiledCases, testCase{
            name: r.Name,
            re:   regexp.MustCompile(r.Pattern),
            in:   r.Input,
            want: r.Want,
        })
    }
}

func TestRegex(t *testing.T) {
    for _, tc := range compiledCases {
        t.Run(tc.name, func(t *testing.T) { ... })
    }
}
```

Caveats:

- `init` runs before any test — even tests in other files of the same package. If your table is in a `_test.go` file, the `init` is test-only and won't affect non-test code.
- A failing `init` panics the test binary, so make sure it can't fail at runtime. Use `regexp.MustCompile` (panics on bad pattern, which surfaces the bug immediately).

---

## Sub-second startup matters in TDD loops

Developers running `go test ./pkg/...` on every save expect <2s feedback. If your table-driven tests take 30 seconds, the developer disengages. Tactics:

1. **Tag slow tests** with `testing.Short()` and skip them by default:

```go
if testing.Short() {
    t.Skip("slow")
}
```

Run with `go test -short` for the fast subset; `go test` for full.

2. **Split tables into "core" and "comprehensive"** — the core covers happy paths and a few edge cases (20 rows); the comprehensive covers everything (500 rows). Run core on every save, comprehensive on PR.

3. **Cache the binary** — `go test` caches results. Don't pass `-count=1` unless you must.

---

## Memory cost

Each `t.Run` allocates a few hundred bytes for the `*T` and the subtest's name/state. For 10K subtests that's a few megabytes — usually fine. For 1M subtests, you've allocated gigabytes during the test run, which can OOM CI workers.

`b.ReportAllocs()` in benchmarks helps you spot allocation regressions:

```go
b.Run(tc.name, func(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ { ... }
})
```

The output includes `B/op` and `allocs/op`. If your table-driven benchmark spikes from 5 allocs/op to 50 between commits, something in the row body is allocating that didn't before.

---

[← Back](../)
