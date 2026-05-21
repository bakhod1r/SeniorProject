---
layout: default
title: Benchmark Deep — Find the Bug
parent: Benchmarking Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/find-bug/
---

# Benchmark Deep — Find the Bug

[← Back](../)

Each snippet compiles and produces a number. The number is wrong. Identify
the bug, explain *why* the benchmark lies, and write the corrected version.

## Bug 1 — The vanishing call

```go
func BenchmarkHash(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sha256.Sum256([]byte("hello"))
    }
}
```

The result is suspiciously fast. What did the compiler do, and how do you
prevent it? Hint: there are two separate problems here — one about the
*input*, one about the *output*.

Answer sketch: the input is a string constant so the byte slice is hoisted
out of the loop and the compiler can prove the result is unused. Fix by
introducing a per-iteration input (e.g. `[]byte(strconv.Itoa(i))`) and
assigning the return value to a package-level `var sink [32]byte`.

## Bug 2 — Timer not reset

```go
func BenchmarkParse(b *testing.B) {
    data, _ := os.ReadFile("big.json")
    for i := 0; i < b.N; i++ {
        var out map[string]any
        json.Unmarshal(data, &out)
    }
}
```

Why does `b.N` come out tiny and the reported `ns/op` huge for the first
run? What is missing?

Answer sketch: `os.ReadFile` is inside the timer window. For small `b.N`
values the framework picks during scaling, that I/O dominates. Add
`b.ResetTimer()` between the read and the loop. For extra credit, move the
read above `b.Run` if you are in a sub-benchmark.

## Bug 3 — Setup inside the loop

```go
func BenchmarkSort(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := rand.Perm(10000)
        sort.Ints(s)
    }
}
```

`rand.Perm(10000)` is doing 10000 allocations and a Fisher–Yates shuffle on
every iteration. The benchmark is measuring shuffle + sort, not sort. Fix
without losing the property that each iteration sees a different input
order.

Answer sketch: precompute `N` copies into a slice-of-slices outside the
timer, or generate a single permutation, copy it into a reusable scratch
buffer inside `b.StopTimer/b.StartTimer` blocks.

## Bug 4 — The optimised-away accumulator

```go
var sink int
func BenchmarkSum(b *testing.B) {
    xs := []int{1, 2, 3, 4, 5}
    for i := 0; i < b.N; i++ {
        s := 0
        for _, x := range xs {
            s += x
        }
        sink = s
    }
}
```

This looks correct — there is a sink. But the reported time is still way
too small. Why?

Answer sketch: `xs` is a tiny constant-content slice, the inner sum is
loop-invariant, and the compiler can lift the entire inner loop out, so
`sink` is written once not `b.N` times. Use an input that varies with `i`
(e.g. `xs[i%len(xs)]` driving the work) or randomise `xs` per iteration in
StopTimer'd setup.

## Bug 5 — Wrong baseline for benchstat

```bash
go test -bench BenchmarkNew -count=10 > new.txt
git stash
go test -bench BenchmarkOld -count=10 > old.txt
git stash pop
benchstat old.txt new.txt
```

What is wrong with this comparison workflow?

Answer sketch: the benchmark names differ (`BenchmarkOld` vs
`BenchmarkNew`), so benchstat will report them as two unrelated benchmarks
rather than a paired comparison. benchstat matches by name. Rename both to
the same name, or use `-name-regexp`/the `pkg/op` columns properly.

## Bug 6 — Single-sample comparison

```bash
go test -bench . > a.txt
# change one line of code
go test -bench . > b.txt
benchstat a.txt b.txt
```

benchstat prints `~` for everything. The dev says "the test is broken".
What is actually wrong?

Answer sketch: each file has `-count=1` so benchstat has only one sample
per benchmark and cannot compute a confidence interval — it correctly
refuses to claim significance. Re-run with `-count=10` or more.

## Bug 7 — Frequency-scaled laptop

A benchmark reports `12 ns/op` in the morning and `19 ns/op` after lunch.
The dev concludes their change is non-deterministic. Diagnose.

Answer sketch: the CPU went into turbo while cool and dropped out under
thermal load. Mitigate by disabling turbo (`echo 1 > /sys/devices/system/cpu/intel_pstate/no_turbo` on Linux), pinning to a single
core with `taskset`, and running `-count=10` in a warmed-up state. Or move
the workload to a server with frequency lock.

## Bug 8 — GC pause hides in the mean

A benchmark reports a stable `200 ns/op` mean across 10 runs, but tail
latency in production is terrible. Why is the mean lying?

Answer sketch: GC pauses are rare relative to `b.N` so they get averaged
out. Switch to `b.ReportMetric` with p95/p99 by collecting per-iteration
`time.Now()` deltas, or sample `/gc/pauses:seconds` from `runtime/metrics`
in parallel. The mean is the wrong statistic for a latency-sensitive
benchmark.

## Bug 9 — Captured loop variable

```go
func BenchmarkHandler(b *testing.B) {
    for i := 0; i < b.N; i++ {
        go func() { handle(i) }()
    }
}
```

Two bugs at once. Name both.

Answer sketch: (1) classic captured-variable bug, all goroutines see the
final `i`. Fix with `i := i` or by passing as a parameter. (2) the timer
includes goroutine *launch* but the work runs concurrently, so the
benchmark measures scheduling, not work. Either run serially or use a
`sync.WaitGroup` and include the wait inside the timer.

## Bug 10 — Benchcmp output misread

A dev shows `benchcmp old.txt new.txt` reporting "-12% +/-?" and merges
the PR. Why is this risky?

Answer sketch: `benchcmp` does not do a statistical test and is
deprecated. The 12% delta may be entirely within noise. Re-run with
`benchstat` and check that `p < 0.05`.

## Bug 11 — The non-resetting timer in a sub-benchmark

```go
func BenchmarkAll(b *testing.B) {
    data := loadHugeFixture()
    for _, n := range []int{1, 10, 100, 1000} {
        b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                sink = process(data, n)
            }
        })
    }
}
```

The outer `loadHugeFixture` happens once, fine. But why are the small-N
sub-benches dominated by setup time anyway?

Answer sketch: `b.Run` inherits the outer timer state on entry, but each
sub-bench has its own `b.N` selection. The framework starts the timer
when the sub-bench function is invoked. If there is per-sub-bench setup
inside the closure (e.g. `prep := make([]int, n)`), it counts. Add
`b.ResetTimer()` inside the sub-bench closure if you have per-sub-bench
setup.

## Bug 12 — Allocs counted from a `defer`

```go
func process(x int) int {
    defer trackCall("process")
    return x * 2
}
```

`trackCall` does a `fmt.Sprintf`. The benchmark reports `1 allocs/op`
and the dev cannot find the source. Where is the alloc?

Answer sketch: the `defer` allocates a deferred-function record on the
heap, and `trackCall` itself allocates via `fmt.Sprintf`. Combined that
may report as 1-2 allocs. The fix is to remove or refactor `trackCall`,
or use the Go 1.14+ open-coded defer optimisation (which only fires for
simple defers; complex defers still allocate).

## Bug 13 — Pre-allocation that perturbs cache

```go
func BenchmarkLookup(b *testing.B) {
    m := buildMap(10000)
    keys := buildKeys(10000)
    // 1MB of warmup data:
    warm := make([]byte, 1<<20)
    for i := range warm { warm[i] = byte(i) }

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sink = m[keys[i%len(keys)]]
    }
}
```

The dev added `warm` to "warm up the cache" but the bench got *slower*.
Why?

Answer sketch: `warm` is 1MB of unused-but-resident data sharing cache
lines with the map's buckets. The map's buckets get evicted to make
room for `warm`. The benchmark now measures cold-cache map lookup, not
warm. Remove `warm` or write a real warmup that touches `m[keys[...]]`
in a loop before `ResetTimer`.

## Bug 14 — The bench that times out

```go
func BenchmarkSlowDB(b *testing.B) {
    db := connectDB(b)
    for i := 0; i < b.N; i++ {
        sink = db.Query("SELECT * FROM big_table")
    }
}
```

`go test -bench=BenchmarkSlowDB` runs forever and times out at 10
minutes. The dev concludes "the DB is broken." What is actually
happening?

Answer sketch: the framework grew `b.N` until the per-pass time hit
`-benchtime`, but each iteration takes seconds (DB query). The first
real pass with `b.N=100` takes 10 minutes. Use `-benchtime=10s` (so
the framework stops growing `b.N`) or `-benchtime=10x` (fixed iteration
count). Or — better — do not microbench against a real DB; mock the
slow parts.

## Bug 15 — The `b.N` used as input

```go
func BenchmarkInsert(b *testing.B) {
    list := newList()
    for i := 0; i < b.N; i++ {
        list.Insert(b.N - i)
    }
}
```

The "input size" is `b.N` itself. As `b.N` grows during stabilisation
the benchmark measures inserts into ever-larger lists. The reported
ns/op is meaningless — it averages costs across input sizes that differ
by orders of magnitude.

Fix: separate input size from iteration count. Use a sub-bench
parameterised by size:

```go
for _, n := range []int{100, 10000, 1000000} {
    b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            b.StopTimer()
            list := newList()
            b.StartTimer()
            for j := 0; j < n; j++ {
                list.Insert(j)
            }
        }
    })
}
```

Now `b.N` controls how many times you build a fresh list of size `n`,
which is what you actually wanted.

## Bug 16 — Cross-package state leak

```go
// in package A:
var globalCache map[string]*Resource

func BenchmarkA(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = lookup("key")
    }
}

// in package B (different bench file):
func BenchmarkB(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = lookup("key") // sees A's cache
    }
}
```

`globalCache` is populated by `BenchmarkA` and `BenchmarkB` sees the
hot cache. Run order matters; reverse the order and the numbers
flip. What is the right fix?

Answer sketch: globals across benches are an antipattern. Clear the
global in `b.Cleanup`, or refactor to take cache as a parameter.
The fundamental cause is the global itself.

## Bug 17 — Misuse of `-cpu=1`

A dev sees `BenchmarkParallel-1` and `BenchmarkParallel-8` and
benchstat-compares them. Why is this wrong?

Answer sketch: benchstat compares the same benchmark across two
*files*, treating the `-N` suffix as part of the name. The two rows
are different benchmarks; benchstat reports them as unrelated, not
as a scaling comparison. The right tool for scaling analysis is to
extract the ns/op manually and plot.

## Bug 18 — Forgetting `b.Cleanup` on a leaked goroutine

```go
func BenchmarkWithBackground(b *testing.B) {
    go backgroundLoop() // never stops
    for i := 0; i < b.N; i++ {
        sink = foreground()
    }
}
```

Each invocation of the benchmark (the framework calls it many times
during stabilisation) spawns a new background goroutine. Memory and
CPU leak across iterations. By the end of `-count=10` you may have
hundreds of background goroutines polluting the bench. Fix with
`b.Cleanup`:

```go
func BenchmarkWithBackground(b *testing.B) {
    done := make(chan struct{})
    go func() {
        for {
            select {
            case <-done:
                return
            default:
                backgroundTick()
            }
        }
    }()
    b.Cleanup(func() { close(done) })
    for i := 0; i < b.N; i++ {
        sink = foreground()
    }
}
```

[← Back](../)
