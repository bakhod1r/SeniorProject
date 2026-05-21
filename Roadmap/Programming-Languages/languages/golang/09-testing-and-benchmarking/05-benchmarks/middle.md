---
layout: default
title: Benchmarks — Middle
parent: Benchmarks (testing.B)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/middle/
---

# Benchmarks — Middle

[← Back](../)

> Focus: structuring benchmarks for comparison and clarity — table-driven via `b.Run`, isolating setup with `ResetTimer`/`StopTimer`/`StartTimer`, declaring throughput with `SetBytes`, exercising contention via `RunParallel`, and laying out the suite so the output is usable.

You have already written a benchmark and read its output. This page is about writing benchmarks *correctly* once you start having more than one. The bugs we cover here cost a senior engineer half a day each; learning them in advance is worth the time.

## Table of Contents

1. [Why "more than one" matters](#why-more-than-one-matters)
2. [Sub-benchmarks with `b.Run`](#sub-benchmarks-with-brun)
3. [Table-driven benchmarks](#table-driven-benchmarks)
4. [Naming conventions for sub-benchmarks](#naming-conventions-for-sub-benchmarks)
5. [Running a subset with `-bench` regex](#running-a-subset-with--bench-regex)
6. [`b.ResetTimer` — the standard cut](#bresettimer--the-standard-cut)
7. [`b.StopTimer` and `b.StartTimer` — the surgical cut](#bstoptimer-and-bstarttimer--the-surgical-cut)
8. [When `StopTimer` is wrong](#when-stoptimer-is-wrong)
9. [`b.SetBytes` — throughput benchmarks](#bsetbytes--throughput-benchmarks)
10. [`b.ReportMetric` — custom columns](#breportmetric--custom-columns)
11. [Parallel benchmarks with `b.RunParallel`](#parallel-benchmarks-with-brunparallel)
12. [`SetParallelism` — multiplying the goroutine count](#setparallelism--multiplying-the-goroutine-count)
13. [`-cpu` flag for GOMAXPROCS sweeps](#-cpu-flag-for-gomaxprocs-sweeps)
14. [Reading parallel benchmark output](#reading-parallel-benchmark-output)
15. [Sharing data across iterations](#sharing-data-across-iterations)
16. [Avoiding cache-hot bias](#avoiding-cache-hot-bias)
17. [Random input pitfalls](#random-input-pitfalls)
18. [`b.Cleanup` for test-style teardown](#bcleanup-for-test-style-teardown)
19. [Skipping benchmarks with `b.Skip`](#skipping-benchmarks-with-bskip)
20. [Failing a benchmark on bad output](#failing-a-benchmark-on-bad-output)
21. [Worked example: parser comparison](#worked-example-parser-comparison)
22. [Worked example: contention sweep](#worked-example-contention-sweep)
23. [Profile collection alongside benchmarks](#profile-collection-alongside-benchmarks)
24. [Middle-level mistakes](#middle-level-mistakes)
25. [Cheat sheet](#cheat-sheet)
26. [Self-assessment](#self-assessment)
27. [Summary](#summary)

---

## Why "more than one" matters

A single benchmark gives a number. A *suite* of benchmarks lets you reason. The interesting question is rarely "how fast is X?" — it is "how does X compare to Y?" or "how does X scale with input size?" or "how does X behave under contention?".

To answer those, you need:

1. Multiple benchmarks running the *same* code under *different* conditions.
2. A consistent input setup that does not pollute the measurement.
3. Per-condition `b.N` calibration.
4. A way to read the resulting table.

`b.Run` is the primary tool for (1) and (3). `b.ResetTimer`, `b.StopTimer`, `b.StartTimer` are the tools for (2). The rest of this page is variations on those.

## Sub-benchmarks with `b.Run`

`b.Run(name, fn)` runs `fn` as a child benchmark. The framework calibrates a fresh `b.N` for it. The output includes a slash-separated suffix on the parent's name:

```go
func BenchmarkOuter(b *testing.B) {
    b.Run("first", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            // ...
        }
    })
    b.Run("second", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            // ...
        }
    })
}
```

Output:

```
BenchmarkOuter/first-8    1000000   12 ns/op
BenchmarkOuter/second-8    500000   24 ns/op
```

Two distinct rows, two distinct calibrations. The "outer" benchmark itself is not measured — it is a container. The child receives its own `*testing.B`.

`b.Run` returns a `bool` (the same as `t.Run`). It is `true` unless the child explicitly failed (`b.Fail`). You can use this to skip subsequent variants if a prior one failed, but it is rarely useful for benchmarks.

## Table-driven benchmarks

The canonical pattern. A slice of test cases, a loop, a `b.Run` per case:

```go
func BenchmarkSort(b *testing.B) {
    cases := []struct {
        name string
        n    int
    }{
        {"n=10", 10},
        {"n=100", 100},
        {"n=1000", 1000},
        {"n=10000", 10000},
    }
    for _, tc := range cases {
        src := makeRandomInts(tc.n)
        dst := make([]int, tc.n)
        b.Run(tc.name, func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                copy(dst, src)
                sort.Ints(dst)
            }
        })
    }
}
```

Key choices:

- `src` is built once *outside* `b.Run`. Building random data is expensive; doing it inside the loop would skew the measurement.
- `dst` is a pre-allocated buffer. `copy(dst, src)` is cheap and resets the data each iteration.
- The closure captures `src` and `dst` from the outer scope. This is fine because the closure runs serially within `b.Run`.

For comparing **two algorithms** across input sizes, nest:

```go
func BenchmarkSortAlgos(b *testing.B) {
    sizes := []int{10, 100, 1000, 10000}
    algos := []struct {
        name string
        fn   func([]int)
    }{
        {"std", sort.Ints},
        {"insertion", insertionSort},
    }
    for _, sz := range sizes {
        src := makeRandomInts(sz)
        dst := make([]int, sz)
        for _, a := range algos {
            b.Run(fmt.Sprintf("size=%d/algo=%s", sz, a.name), func(b *testing.B) {
                for i := 0; i < b.N; i++ {
                    copy(dst, src)
                    a.fn(dst)
                }
            })
        }
    }
}
```

Output:

```
BenchmarkSortAlgos/size=10/algo=std-8           20000000      62 ns/op
BenchmarkSortAlgos/size=10/algo=insertion-8     30000000      40 ns/op
BenchmarkSortAlgos/size=100/algo=std-8           3000000     420 ns/op
BenchmarkSortAlgos/size=100/algo=insertion-8     1500000     820 ns/op
...
```

You can now see the crossover point where `insertion` overtakes `std` (it does at small sizes, loses at large).

## Naming conventions for sub-benchmarks

There is no enforced convention but there is a strong community one. Use `key=value` separated by `/`:

```
BenchmarkParse/format=json/size=1k-8
BenchmarkParse/format=json/size=10k-8
BenchmarkParse/format=xml/size=1k-8
```

Benefits:

- `benchstat` can pivot the table by key.
- `-bench=size=10k` matches only that size.
- The output is grep-friendly.

Avoid:

- Spaces in names (they get percent-encoded into `%20`, ugly).
- Special characters not in `[A-Za-z0-9_/.+=-]`.
- Different conventions in the same suite (`n=10` here, `size_10` there).

## Running a subset with `-bench` regex

The regex matches against the full hierarchical name. Per-component matching:

- `-bench=BenchmarkParse` — anywhere in any name.
- `-bench=BenchmarkParse/format=json` — only JSON variants.
- `-bench=size=10k` — only the 10k size variants, across formats.
- `-bench='^BenchmarkParse/format=json/size=10k$'` — exactly that one.

Useful in development: when iterating on a single benchmark, run only it.

## `b.ResetTimer` — the standard cut

The 90 %-of-the-time tool. Use it after setup:

```go
func BenchmarkProcessFile(b *testing.B) {
    data, err := os.ReadFile("testdata/big.txt")
    if err != nil {
        b.Fatal(err)
    }
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = process(data)
    }
}
```

Semantics:

- Zeroes the elapsed time.
- Zeroes the allocation counters.
- Does **not** stop the timer; the timer continues, just from zero.

Place it after any heavy setup and before the `b.N` loop. The convention is to put `b.ReportAllocs()` immediately before or after `ResetTimer`, since they are both "now we start the real measurement" markers.

## `b.StopTimer` and `b.StartTimer` — the surgical cut

When setup must happen *inside* the `b.N` loop — for example, because each iteration mutates state and needs a fresh setup — use `StopTimer`/`StartTimer`:

```go
func BenchmarkApplyDiff(b *testing.B) {
    base := loadBase()
    diff := loadDiff()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        b.StopTimer()
        state := copyState(base) // not timed
        b.StartTimer()
        applyDiff(state, diff) // timed
    }
}
```

Semantics:

- `StopTimer` pauses the elapsed-time counter.
- `StartTimer` resumes it.
- Wall-clock time spent between them is not counted.

This is *more invasive* than `ResetTimer` because it adds overhead per iteration — the framework has to read a clock twice. For very fast operations, this overhead dominates and corrupts the measurement.

Rule of thumb: if your operation takes < 1 µs, prefer hoisting setup outside the loop entirely (build many pre-prepared inputs, cycle through them) over `StopTimer`/`StartTimer`.

## When `StopTimer` is wrong

Three traps:

### Allocations during stopped time still count

`b.StopTimer()` pauses the clock, not the allocation counter. Memory allocated inside a stopped region inflates `B/op`:

```go
func BenchmarkX(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        b.StopTimer()
        buf := make([]byte, 1<<16) // 64 KiB per iter, still in B/op
        b.StartTimer()
        process(buf)
    }
}
```

You will see `~65600 B/op` even if `process` is allocation-free.

Fix: allocate outside the loop, reuse.

### High-frequency `StopTimer` corrupts ns/op

Each `StopTimer`/`StartTimer` pair reads the clock. On Linux, that is `clock_gettime` — a fast syscall but not free (~20 ns). For operations under ~200 ns, the per-iteration overhead is a significant fraction of measurement.

Fix: batch iterations. Time a group, then reset:

```go
const batch = 1000
for i := 0; i < b.N; i++ {
    if i%batch == 0 {
        b.StopTimer()
        // expensive setup for next batch
        b.StartTimer()
    }
    work()
}
```

### Pausing the wrong segment

```go
for i := 0; i < b.N; i++ {
    b.StopTimer()
    work() // <-- we wanted to time this
    b.StartTimer()
    cleanup() // <-- we did not want to time this
}
```

Off-by-one logic error. Read the boundaries carefully. The timer is running *between* `StartTimer` and `StopTimer`.

## `b.SetBytes` — throughput benchmarks

For benchmarks where each iteration processes a fixed amount of data — parsers, compressors, hashers, encoders — `ns/op` alone is not the right unit. You want bytes per second.

`b.SetBytes(int64)` declares the data volume per iteration. The framework computes `MB/s` and adds it as a column:

```go
func BenchmarkHash(b *testing.B) {
    input := make([]byte, 1<<20) // 1 MiB
    rand.Read(input)
    b.SetBytes(int64(len(input)))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = sha256.Sum256(input)
    }
}
```

Output:

```
BenchmarkHash-8   500   2400000 ns/op   436.91 MB/s
```

Interpretation: SHA-256 hashes at about 437 MB/s on this CPU. Now compare against `md5.Sum`, `xxh3.Hash`, etc., and the right column to read is `MB/s` — bigger is better.

Note: `MB` in `MB/s` is decimal (10⁶), not binary (2²⁰). The framework uses `(bytes * iters) / (seconds * 1e6)`.

## `b.ReportMetric` — custom columns

For benchmarks where you want to track something beyond `ns/op`/`B/op`/`MB/s`, use `ReportMetric`:

```go
func BenchmarkCache(b *testing.B) {
    c := newCache()
    var hits int
    for i := 0; i < b.N; i++ {
        if c.Get(i%1000) != nil {
            hits++
        }
    }
    b.ReportMetric(float64(hits)/float64(b.N), "hit-rate")
}
```

Output:

```
BenchmarkCache-8   10000000   85 ns/op   0.74 hit-rate
```

The unit string is appended to the column. `benchstat` will display it. Useful for: hit rate, queue depth, lookup table fill ratio, GC count, etc.

A nice trick: report `b.Elapsed() / time.Duration(b.N)` to compute a per-op duration in a custom unit, or compute throughput in operation-specific units like "requests/sec".

## Parallel benchmarks with `b.RunParallel`

For code that runs concurrently in production — concurrent maps, atomic counters, sharded caches, channels — you want to measure under contention, not in isolation.

`b.RunParallel(body)` spawns `GOMAXPROCS` goroutines (by default), each repeatedly calling `body`. Each goroutine has its own `*testing.PB`. The framework hands out iterations atomically via `pb.Next()`:

```go
func BenchmarkAtomicCounter(b *testing.B) {
    var n atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            n.Add(1)
        }
    })
}
```

What's happening:

1. `b.RunParallel` reads `GOMAXPROCS` (call it `P`).
2. It spawns `P × SetParallelism()` goroutines (default `SetParallelism = 1`).
3. Each goroutine runs the body, which is a loop: `for pb.Next() { ... }`.
4. `pb.Next()` returns true while there are iterations left; iterations are distributed cooperatively.
5. When all goroutines finish (`pb.Next()` returns false), the benchmark ends.

The reported `ns/op` is **total wall time / total iterations**. That is the per-op time *averaged across concurrent goroutines*. If `n.Add` takes 5 ns serially but contention slows it to 20 ns per op under 8 goroutines, you will see `20 ns/op` — because the 8 goroutines combined did `b.N` ops in 20 × b.N / 8 wall ns.

For maximum clarity, set `GOMAXPROCS` explicitly:

```
GOMAXPROCS=8 go test -bench=BenchmarkAtomicCounter
```

## `SetParallelism` — multiplying the goroutine count

By default `RunParallel` spawns one goroutine per `P` (i.e. `GOMAXPROCS`). To stress-test with more goroutines than cores:

```go
b.SetParallelism(10) // 10 goroutines per P
b.RunParallel(func(pb *testing.PB) { ... })
```

With `GOMAXPROCS=8` and `SetParallelism(10)`, you have 80 goroutines all hammering the shared resource. Useful for measuring how badly contention scales as goroutines outnumber cores.

Counterintuitively, this rarely changes the measured `ns/op` much for lock-free code — the bottleneck is in the hardware (cache line ping-pong), not the goroutine count. For mutex-protected code, `SetParallelism > 1` exposes lock-queue depth.

## `-cpu` flag for GOMAXPROCS sweeps

To see how your benchmark scales across different parallelism levels in one run:

```
go test -bench=. -cpu=1,2,4,8
```

Each benchmark is run once per `GOMAXPROCS` value. Names get the suffix:

```
BenchmarkAtomicCounter-1    50000000    25 ns/op
BenchmarkAtomicCounter-2    20000000    72 ns/op
BenchmarkAtomicCounter-4    10000000   140 ns/op
BenchmarkAtomicCounter-8     8000000   165 ns/op
```

This is *negative* scaling — adding cores makes the benchmark slower per op. Classic atomic-contention signature. For a well-behaved scalable design you would expect the `ns/op` to stay roughly constant.

## Reading parallel benchmark output

The `ns/op` from a parallel benchmark is **per operation across all goroutines**. Mental model:

- Total wall time: T
- Total operations across goroutines: `b.N`
- `ns/op = T / b.N`

If 8 goroutines each did `b.N / 8` operations in T wall seconds:

- Per-goroutine operation latency: `T / (b.N/8) = 8 * ns/op`
- Throughput: `b.N / T = 1/(ns/op) ops/sec`

For most performance comparisons you only need `ns/op`. For latency-sensitive reasoning, multiply by `GOMAXPROCS` to get the per-goroutine perceived latency.

## Sharing data across iterations

A common pattern: build a corpus, cycle through it:

```go
var inputs [][]byte

func init() {
    for i := 0; i < 1024; i++ {
        b := make([]byte, 4096)
        rand.Read(b)
        inputs = append(inputs, b)
    }
}

func BenchmarkProcess(b *testing.B) {
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = process(inputs[i%len(inputs)])
    }
}
```

Two reasons:

1. Each iteration sees different data (no constant-folding by the compiler).
2. The corpus is large enough that successive iterations evict each other from L1, simulating realistic cache behaviour.

A 1024-element corpus of 4 KiB byte slices = 4 MiB total, larger than L1 and L2 on most CPUs. Picking a corpus size larger than L3 simulates DRAM-bound access.

## Avoiding cache-hot bias

If you use a single input across all iterations, the CPU's L1 cache contains it permanently. The reported `ns/op` reflects L1-resident performance — often 5× faster than DRAM-resident performance.

Realistic production workloads have cold data. A benchmark that under-reports DRAM cost will mislead you into "this is fast enough" when it is not.

Strategies:

- Use a corpus larger than L3.
- Flush the cache between iterations (advanced — see senior page).
- Run the benchmark long enough (`-benchtime=10s`) that warm-up effects amortise out.

## Random input pitfalls

Random data is a sharp tool. Pitfalls:

- **Seeding `rand` inside the loop** — calling `rand.New(rand.NewSource(time.Now().UnixNano()))` inside the loop allocates and is slow.
- **Different random data on different runs** — non-reproducible benchmarks. Seed deterministically: `rand.New(rand.NewSource(42))`.
- **All-zero or all-the-same data** — your compressor/dedup/hash will give unrealistically optimistic numbers. Use realistic distributions.

Idiom: seed once at package init, build the corpus deterministically:

```go
var inputs [][]byte

func init() {
    r := rand.New(rand.NewSource(0xC0FFEE))
    for i := 0; i < 1024; i++ {
        b := make([]byte, 4096)
        r.Read(b)
        inputs = append(inputs, b)
    }
}
```

## `b.Cleanup` for test-style teardown

Just like `t.Cleanup`, `b.Cleanup(fn)` registers a function to run after the benchmark (and all sub-benchmarks) finish. Useful for:

- Closing files/handles opened in setup.
- Removing temporary directories.
- Restoring global state (env vars, etc.).

```go
func BenchmarkServer(b *testing.B) {
    srv := startServer()
    b.Cleanup(func() { srv.Stop() })
    client := srv.Client()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = client.Get("/")
    }
}
```

`Cleanup` does not count against the benchmark timer; it runs after the measurement is complete.

## Skipping benchmarks with `b.Skip`

Skip a benchmark when the prerequisite is not available:

```go
func BenchmarkCGo(b *testing.B) {
    if !cgoEnabled() {
        b.Skip("cgo not enabled")
    }
    // ...
}
```

Output marks the benchmark as `--- SKIP:`. It does not fail. Useful for OS-specific or hardware-specific benchmarks.

## Failing a benchmark on bad output

A benchmark *can* call `b.Error`, `b.Errorf`, `b.Fatal`. If it does, the run is marked failed and CI gates can react. Use this as a sanity check inside the benchmark:

```go
func BenchmarkParse(b *testing.B) {
    input := loadInput()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        v, err := parse(input)
        if err != nil {
            b.Fatal(err)
        }
        if v.Result != expected {
            b.Fatalf("wrong result: got %v, want %v", v.Result, expected)
        }
    }
}
```

This is a guard against benchmarks that "succeed" only because the work was actually broken (returning early due to an error). A 100x speed-up from "my parser is faster" is often a 100x speed-up from "my parser now returns immediately on bad input I forgot to flag".

Cost: the per-iteration `if err != nil` check is real and slightly inflates `ns/op`. For ultra-microbenchmarks, move the check outside the loop (do one pre-check) and skip the in-loop assertion.

## Worked example: parser comparison

A complete example combining most of this page:

```go
package parsebench

import (
    "encoding/json"
    "encoding/xml"
    "fmt"
    "testing"
)

var corpora = map[string][]byte{
    "json": []byte(`{"id":1,"name":"alice","tags":["a","b","c"]}`),
    "xml":  []byte(`<o id="1" name="alice"><tag>a</tag><tag>b</tag></o>`),
}

func BenchmarkParse(b *testing.B) {
    for name, data := range corpora {
        b.Run(fmt.Sprintf("format=%s", name), func(b *testing.B) {
            b.ReportAllocs()
            b.SetBytes(int64(len(data)))
            switch name {
            case "json":
                var v map[string]any
                b.ResetTimer()
                for i := 0; i < b.N; i++ {
                    if err := json.Unmarshal(data, &v); err != nil {
                        b.Fatal(err)
                    }
                }
            case "xml":
                var v struct{}
                b.ResetTimer()
                for i := 0; i < b.N; i++ {
                    if err := xml.Unmarshal(data, &v); err != nil {
                        b.Fatal(err)
                    }
                }
            }
        })
    }
}
```

Output (illustrative):

```
BenchmarkParse/format=json-8   2000000   650 ns/op   65.85 MB/s   320 B/op   3 allocs/op
BenchmarkParse/format=xml-8     500000  2400 ns/op   23.95 MB/s  1024 B/op  18 allocs/op
```

Read top to bottom: JSON is faster *and* allocates less *and* throughputs higher. The XML path is allocation-heavy (`18 allocs/op`) which suggests room for optimisation.

## Worked example: contention sweep

A complete example exercising `RunParallel` and `-cpu`:

```go
package contention

import (
    "sync"
    "sync/atomic"
    "testing"
)

type MutexCounter struct {
    mu sync.Mutex
    n  int64
}

func (c *MutexCounter) Inc() { c.mu.Lock(); c.n++; c.mu.Unlock() }

type AtomicCounter struct {
    n atomic.Int64
}

func (c *AtomicCounter) Inc() { c.n.Add(1) }

func BenchmarkCounter(b *testing.B) {
    b.Run("mutex", func(b *testing.B) {
        c := &MutexCounter{}
        b.RunParallel(func(pb *testing.PB) {
            for pb.Next() {
                c.Inc()
            }
        })
    })
    b.Run("atomic", func(b *testing.B) {
        c := &AtomicCounter{}
        b.RunParallel(func(pb *testing.PB) {
            for pb.Next() {
                c.Inc()
            }
        })
    })
}
```

Run:

```
go test -bench=BenchmarkCounter -cpu=1,2,4,8
```

Expect (rough numbers, modern CPU):

```
BenchmarkCounter/mutex-1     200000000     8 ns/op
BenchmarkCounter/mutex-2      50000000    35 ns/op
BenchmarkCounter/mutex-4      30000000    55 ns/op
BenchmarkCounter/mutex-8      20000000    80 ns/op
BenchmarkCounter/atomic-1    500000000     3 ns/op
BenchmarkCounter/atomic-2    100000000    14 ns/op
BenchmarkCounter/atomic-4     50000000    28 ns/op
BenchmarkCounter/atomic-8     30000000    42 ns/op
```

Two lessons:

1. Atomic is faster than mutex at all `GOMAXPROCS` levels.
2. Both scale negatively (`ns/op` rises) — they have a single contention point. A *scalable* design would use sharding (one counter per `P`, sum at read time).

Now you have a benchmark that can guide that next refactor.

## Profile collection alongside benchmarks

`go test` can collect profiles while running benchmarks. Common flags:

```
go test -bench=BenchmarkParse -cpuprofile=cpu.prof -memprofile=mem.prof
go tool pprof cpu.prof
```

Inside `pprof`:

```
top
list parse
web
```

For a *specific* sub-benchmark, narrow with `-bench`:

```
go test -bench='BenchmarkParse/format=json' -cpuprofile=cpu.prof
```

Note: `-blockprofile` and `-mutexprofile` capture goroutine blocking and mutex contention respectively. Pair with `b.RunParallel` to see contention sources.

Profiling overhead is real (~5 % CPU, more with sampling-heavy options). Do not collect profiles *and* gate on perf numbers from the same run.

## Middle-level mistakes

1. **`ResetTimer` placed before setup.** Setup is then timed.
2. **`StopTimer`/`StartTimer` on sub-microsecond operations.** Per-call clock-read overhead dominates.
3. **Allocations during stopped time.** They still count toward `B/op`.
4. **Cache-hot benchmarks.** One input, hot in L1, misrepresents production.
5. **Inconsistent setup across sub-benchmarks.** Apples vs oranges.
6. **Forgetting `SetBytes` for throughput benchmarks.** Numbers harder to compare.
7. **Trusting `RunParallel` numbers from a single run.** Concurrent measurements have more variance, not less.
8. **Mismatched `GOMAXPROCS` between sub-benchmarks.** Pin it explicitly when comparing.
9. **`b.Run` closure captures a loop variable** (pre-Go 1.22) — the classic loopvar bug. Modern Go handles this; older code did not.
10. **Setup inside the closure.** Hoist it out.

## Cheat sheet

```go
// Table-driven skeleton
func BenchmarkXxx(b *testing.B) {
    for _, tc := range tableOfCases {
        // build inputs OUT here, reuse INSIDE
        in := buildInput(tc)
        b.Run(tc.name, func(b *testing.B) {
            b.ReportAllocs()
            b.SetBytes(int64(len(in))) // if throughput-style
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                _ = doWork(in)
            }
        })
    }
}

// Parallel skeleton
func BenchmarkParallel(b *testing.B) {
    shared := initShared()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = shared.Op()
        }
    })
}
```

```
go test -bench=. -benchmem -count=10
go test -bench=. -cpu=1,2,4,8
go test -bench=. -cpuprofile=cpu.prof
```

## Self-assessment

- [ ] I can write a table-driven benchmark with `b.Run`.
- [ ] I name my sub-benchmarks `key=value/key=value`.
- [ ] I know exactly when to use `ResetTimer` vs `StopTimer`/`StartTimer`.
- [ ] I never put allocation inside a stopped region.
- [ ] I declare `b.SetBytes` for any throughput-style benchmark.
- [ ] I write `b.RunParallel` benchmarks for code that runs concurrently.
- [ ] I run `-cpu=1,2,4,8` to check scaling.
- [ ] I use a corpus of inputs, not a single input, to avoid cache-hot bias.
- [ ] I use `b.Cleanup` for teardown.
- [ ] I have assertions inside the benchmark to catch "fast because broken" cases.

## Summary

Middle-level benchmarking is about *structure*. `b.Run` for table-driven; `ResetTimer` for ordinary setup; `StopTimer`/`StartTimer` for per-iteration setup (with care); `SetBytes` for throughput; `RunParallel` for contention; `-cpu` for scaling sweeps. The output reads as a table, comparable row by row. Almost everything in production-grade Go benchmarking is variations on these primitives.

Once you can write any of these patterns from memory, you are ready for the senior page, which is about *statistics* — going from "the numbers look like" to "I can prove the change with p<0.05".

---

## Appendix A — A complete realistic benchmark suite

This appendix walks through a complete benchmark suite for a small library. The goal is to see all the middle-level techniques applied in one place.

### The library under test

```go
// Package urlpath provides URL-path normalisation routines.
package urlpath

import "strings"

// Normalize collapses redundant path elements and removes trailing slashes.
func Normalize(path string) string {
    if path == "" {
        return "/"
    }
    parts := strings.Split(path, "/")
    out := parts[:0]
    for _, p := range parts {
        switch p {
        case "", ".":
            continue
        case "..":
            if len(out) > 0 {
                out = out[:len(out)-1]
            }
        default:
            out = append(out, p)
        }
    }
    return "/" + strings.Join(out, "/")
}
```

### The benchmark suite

```go
package urlpath

import (
    "fmt"
    "strings"
    "testing"
)

// Corpora — built once, used by all sub-benchmarks.
var (
    pathsShort = []string{
        "/a/b/c",
        "/foo/bar",
        "/x/y/z/w",
    }
    pathsRealistic = []string{
        "/api/v1/users/123/profile",
        "/products/category/electronics/page/2",
        "/static/images/2023/01/photo.jpg",
        "/blog/2024/02/15/some-post-title",
    }
    pathsAdversarial = []string{
        "/a/./b/../c/./d/../../e",
        "/foo/bar/../../../../baz",
        strings.Repeat("/a/../", 100) + "final",
    }
    sinkStr string
)

func BenchmarkNormalize(b *testing.B) {
    suites := []struct {
        name  string
        paths []string
    }{
        {"short", pathsShort},
        {"realistic", pathsRealistic},
        {"adversarial", pathsAdversarial},
    }

    for _, s := range suites {
        b.Run(fmt.Sprintf("kind=%s", s.name), func(b *testing.B) {
            b.ReportAllocs()
            // Calculate total bytes processed per iteration.
            total := 0
            for _, p := range s.paths {
                total += len(p)
            }
            b.SetBytes(int64(total))
            b.ResetTimer()

            var r string
            for i := 0; i < b.N; i++ {
                for _, p := range s.paths {
                    r = Normalize(p)
                }
            }
            sinkStr = r
        })
    }
}

// Parallel variant — exercises potential allocator contention.
func BenchmarkNormalizeParallel(b *testing.B) {
    paths := pathsRealistic
    b.ReportAllocs()
    b.RunParallel(func(pb *testing.PB) {
        var r string
        i := 0
        for pb.Next() {
            r = Normalize(paths[i%len(paths)])
            i++
        }
        _ = r
    })
}
```

### Running and reading

```
go test -bench=. -benchmem -count=10
```

Approximate output:

```
BenchmarkNormalize/kind=short-8         3000000   420 ns/op   50.00 MB/s   192 B/op   4 allocs/op
BenchmarkNormalize/kind=realistic-8      800000  1500 ns/op   80.67 MB/s   640 B/op   8 allocs/op
BenchmarkNormalize/kind=adversarial-8     50000 25000 ns/op   34.16 MB/s 12000 B/op  60 allocs/op
BenchmarkNormalizeParallel-8           1500000   780 ns/op                160 B/op   4 allocs/op
```

What we learn from one run:

1. **Short paths are fast, adversarial paths are slow.** The `len(out)-1` slice shrinking on `..` is `O(depth)`. Adversarial inputs amplify this.
2. **MB/s decreases for adversarial.** Despite shorter paths in total bytes, each one costs a lot to normalise.
3. **Allocations scale with path complexity.** Short: 4 allocs. Adversarial: 60. The `strings.Split` and `strings.Join` are not free.
4. **Parallel ns/op is lower than realistic.** Because the average across goroutines distributes the wall time. To compare per-op latency, multiply by `GOMAXPROCS`.

The takeaway: a one-line "this is fast" claim hides a lot of nuance. The structured suite exposes the nuance.

## Appendix B — Comparing two implementations

The classic A/B comparison. Suppose we suspect that using `strings.Builder` instead of repeated `+` would speed up an inner concatenation:

```go
// Implementation A
func JoinPlus(parts []string) string {
    var s string
    for _, p := range parts {
        s += "/" + p
    }
    return s
}

// Implementation B
func JoinBuilder(parts []string) string {
    var b strings.Builder
    for _, p := range parts {
        b.WriteByte('/')
        b.WriteString(p)
    }
    return b.String()
}
```

The benchmark sets them up identically and exercises across sizes:

```go
func BenchmarkJoin(b *testing.B) {
    sizes := []int{4, 16, 64, 256}
    for _, sz := range sizes {
        parts := make([]string, sz)
        for i := range parts {
            parts[i] = "segment"
        }
        b.Run(fmt.Sprintf("size=%d/algo=plus", sz), func(b *testing.B) {
            b.ReportAllocs()
            var s string
            for i := 0; i < b.N; i++ {
                s = JoinPlus(parts)
            }
            sinkStr = s
        })
        b.Run(fmt.Sprintf("size=%d/algo=builder", sz), func(b *testing.B) {
            b.ReportAllocs()
            var s string
            for i := 0; i < b.N; i++ {
                s = JoinBuilder(parts)
            }
            sinkStr = s
        })
    }
}
```

Crucial detail: both implementations are benchmarked with **identical inputs** (`parts`). If you build inputs separately for each algorithm, you risk one cache-warm and one cache-cold.

Output (rough):

```
BenchmarkJoin/size=4/algo=plus-8        10000000   140 ns/op    64 B/op   3 allocs/op
BenchmarkJoin/size=4/algo=builder-8     20000000    70 ns/op    16 B/op   1 allocs/op
BenchmarkJoin/size=16/algo=plus-8         500000  2400 ns/op   704 B/op  15 allocs/op
BenchmarkJoin/size=16/algo=builder-8    10000000   180 ns/op    48 B/op   1 allocs/op
BenchmarkJoin/size=64/algo=plus-8          30000 40000 ns/op  6300 B/op  63 allocs/op
BenchmarkJoin/size=64/algo=builder-8     3000000   500 ns/op   192 B/op   2 allocs/op
BenchmarkJoin/size=256/algo=plus-8          1000 1100000 ns/op 100000 B/op 255 allocs/op
BenchmarkJoin/size=256/algo=builder-8    1000000  2000 ns/op   832 B/op   2 allocs/op
```

The pattern: `+` scales `O(n²)` because each concatenation copies the accumulated string. `Builder` scales `O(n)`. At size 256, the builder is 550× faster. This is *not* a 50 % improvement — it is an algorithmic improvement. The benchmark made it visible.

## Appendix C — Common middle-level table-driven idioms

A few small patterns worth memorising.

### Idiom 1 — Parameterised input size

```go
for _, n := range []int{10, 100, 1000, 10_000} {
    b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) { ... })
}
```

### Idiom 2 — Cross-product of size and shape

```go
for _, n := range []int{100, 10_000} {
    for _, shape := range []string{"sorted", "reversed", "random"} {
        b.Run(fmt.Sprintf("n=%d/shape=%s", n, shape), func(b *testing.B) { ... })
    }
}
```

### Idiom 3 — Cross-product of input and algorithm

```go
for _, in := range inputs {
    for _, algo := range algorithms {
        b.Run(fmt.Sprintf("in=%s/algo=%s", in.name, algo.name), func(b *testing.B) { ... })
    }
}
```

### Idiom 4 — Sweep across parallelism

```go
b.Run("serial", func(b *testing.B) {
    for i := 0; i < b.N; i++ { work() }
})
b.Run("parallel", func(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() { work() }
    })
})
```

Or, externally: `go test -bench=. -cpu=1,2,4,8`.

### Idiom 5 — Reset state per iteration cheaply

```go
src := makeData(n)
dst := make([]int, n)
b.ResetTimer()
for i := 0; i < b.N; i++ {
    copy(dst, src)
    process(dst)
}
```

`copy` is cheap; building `src` anew would not be. This pattern works because many in-place algorithms mutate their input.

## Appendix D — When to *not* use `b.RunParallel`

`RunParallel` is the right tool for measuring concurrent code. It is the wrong tool for several common situations:

1. **Code that is single-threaded by contract.** No point in benchmarking a `sort.Ints` call under parallel; the call is already sequential within a goroutine.
2. **Code that allocates per goroutine in an unrealistic way.** If the parallel version allocates a buffer the serial version reuses, you are comparing different work, not parallel scaling.
3. **Code with global side effects.** If the inner function mutates a global (`fmt.Println`, log writes), parallel execution introduces contention that does not exist in the function's typical usage.

If unsure, write *both* a serial and a parallel benchmark, name them clearly, and compare.

## Appendix E — Inputs that look the same but are not

A subtle middle-level mistake: input that *seems* fixed but actually varies between iterations.

```go
func BenchmarkParse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        input := strconv.Itoa(i) // <-- varies per iteration
        _ = parse(input)
    }
}
```

The input differs per iteration because it includes `i`. This may or may not be what you want. If you want to measure parsing of a *specific* input, use a fixed string. If you want to measure parsing of *a class of inputs*, prebuild a corpus.

A pernicious version:

```go
input := []byte("abc")
for i := 0; i < b.N; i++ {
    work(input)
    input[0] = byte(i % 256) // <-- modifies the input
}
```

Each iteration sees a slightly different first byte. Whether this matters depends on the function being measured. Be explicit about it.

## Appendix F — Naming benchmarks for clarity

The benchmark name is consumed three ways:

1. By you, reading the output.
2. By `-bench` regex, when you want to run a subset.
3. By `benchstat`, when grouping for comparison.

A good naming convention satisfies all three:

```
BenchmarkParse/format=json/size=1k/codec=stdlib
BenchmarkParse/format=json/size=1k/codec=easyjson
BenchmarkParse/format=json/size=10k/codec=stdlib
BenchmarkParse/format=json/size=10k/codec=easyjson
```

You can:

- Read it: "we are parsing JSON of size 1k with stdlib".
- Filter: `-bench='codec=easyjson'` runs only easyjson rows.
- Pivot in `benchstat`: group rows by `codec`, compare across `size` and `format`.

Avoid ambiguous or short names like `Bench1`, `BenchA`. Avoid free-form natural language. Stick to `key=value/key=value` style.

## Appendix G — A worked debugging session

Walking through how middle-level diagnostic skills look in practice.

**Setup.** A colleague's PR claims a 20 % speedup in `BenchmarkHandleRequest`. You skeptically check.

**Step 1 — reproduce.**

```bash
git checkout main
go test -bench=BenchmarkHandleRequest -benchmem -count=10 > old.txt
git checkout pr/optimisation
go test -bench=BenchmarkHandleRequest -benchmem -count=10 > new.txt
benchstat old.txt new.txt
```

Result:

```
BenchmarkHandleRequest-8   3.20µ ± 5%   2.55µ ± 5%   -20.31% (p=0.000 n=10)
```

A 20 % improvement, statistically significant. But the variance is `± 5%` — on the edge. Worth checking what changed.

**Step 2 — check `allocs/op`.**

```
                  │ old.txt      │            new.txt
                  │  alloc/op    │  alloc/op   vs base
HandleRequest-8     2.40k ± 1%    480 B ± 1%    -80.0% (p=0.000)
                    24 ± 0%        4 ± 0%       -83.3% (p=0.000)
```

That is a much bigger story: the new code allocates 80 % less memory and 83 % fewer times. The 20 % `ns/op` improvement is *because* of the allocation reduction.

**Step 3 — verify the allocator change is real.**

Read the diff. The PR introduced a `sync.Pool` for the request struct. That accounts for the alloc reduction.

**Step 4 — extend the benchmark.**

```go
b.Run("under-load", func(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() { HandleRequest(...) }
    })
})
```

Re-run under contention. If `sync.Pool` was the optimisation, the parallel benchmark should show even larger gains (because GC pressure was the bottleneck under load).

**Step 5 — sanity check.**

Is the function actually doing the same work? Add an assertion inside the loop comparing outputs. If the optimised version returns a different answer (e.g. skips a step), the speedup is illusory.

This is what middle-level benchmark engineering looks like in code review. The numbers prompt questions; the structure of the suite answers them.

## Appendix H — Closing thought

The leap from junior to middle is the leap from "I can write a benchmark" to "I can structure a suite that answers a question". The primitives are small: `b.Run`, `b.ResetTimer`, `b.SetBytes`, `b.RunParallel`. The discipline is large: every benchmark in the suite has the right setup, the right input, the right name, and the right assertions.

By the end of this page you should be able to look at a function and immediately sketch the benchmarks it deserves: one for short input, one for typical, one for adversarial; one serial, one parallel; with throughput declared, allocations reported, assertions in place. That sketch is what differentiates a middle engineer from a junior.

The senior page is next. It is about turning "this is faster" into "this is faster with p<0.001, n=10, geomean -15 % across the suite". That is the level at which performance reviews stop being negotiation and start being engineering.

## Appendix I — The full `b.ReportMetric` story

`b.ReportMetric` accepts any `float64` and any unit string. Conventions:

- Use SI-style units: `B/op`, `MB/s`, `ops/sec`, `hits/op`.
- Avoid spaces in the unit (it becomes an extra column).
- The leading number is the metric value averaged or summed across the run — your choice.

Examples worth knowing:

```go
// Track cache hit rate across the benchmark.
b.ReportMetric(float64(hits)/float64(b.N), "hit-rate")

// Track p99 latency from a histogram you maintained.
b.ReportMetric(float64(p99.Nanoseconds()), "p99-ns")

// Track average queue depth.
b.ReportMetric(float64(totalQDepth)/float64(b.N), "qdepth")
```

The output then has these as extra columns:

```
BenchmarkCache-8   1000000   85 ns/op   0.74 hit-rate   180 p99-ns
```

`benchstat` will include them in the comparison table. You can have several custom metrics in the same benchmark; one `ReportMetric` call per metric.

A pattern to avoid: reporting the same thing multiple times under different names. Pick one convention and stick to it across the suite.

## Appendix J — Sharing setup state across `b.Run` calls

A subtle question: when you write

```go
func BenchmarkOuter(b *testing.B) {
    state := setup()
    b.Run("variant1", func(b *testing.B) { ... })
    b.Run("variant2", func(b *testing.B) { ... })
}
```

is `setup()` called once or twice?

Answer: once. The outer function runs once. The inner sub-benchmarks run multiple times (each gets its own calibration), but the outer function — the one with the `setup()` call — runs once per `go test` invocation.

This is the pattern you want for expensive shared setup. The outer function builds the corpus; each sub-benchmark uses it.

If you put `setup()` inside the closure passed to `b.Run`, it will be called multiple times (during calibration). That is usually wrong.

```go
// Wrong - setup runs every calibration step
b.Run("variant1", func(b *testing.B) {
    state := setup()
    for i := 0; i < b.N; i++ { state.Op() }
})

// Right - setup runs once
state := setup()
b.Run("variant1", func(b *testing.B) {
    for i := 0; i < b.N; i++ { state.Op() }
})
```

## Appendix K — Closing thought (one more)

Middle-level benchmarking is the level at which you start to use benchmarks for decisions. "Is X faster than Y?" becomes a question with a real, comparable answer. "Does Z scale with input size?" becomes a graph readable from the output table.

You will write more benchmarks at this level than at any other. Many of them will get thrown away — they answer a question and that is enough. Some of them will become CI artifacts, gated for regression. Knowing how to write either is what makes you a middle engineer for performance.

## Appendix L — A "benchmark hygiene" checklist for code review

When you review a colleague's benchmarks, scan for these middle-level red flags:

- [ ] Setup outside `b.N` loop.
- [ ] `b.ResetTimer` after setup (if there is any).
- [ ] `b.ReportAllocs` enabled.
- [ ] Sub-benchmarks named `key=value` style.
- [ ] Input corpus realistic (not a degenerate "abcdef").
- [ ] `b.SetBytes` for throughput-style.
- [ ] `b.RunParallel` if production is concurrent.
- [ ] Sink variable or `b.Loop` to defeat DCE.
- [ ] Assertions outside the inner loop (or none at all).
- [ ] Consistent inputs across compared algorithms.
- [ ] `b.Cleanup` for any opened resources.
- [ ] No I/O or syscalls in the inner loop (unless that is the point).

A clean benchmark passes all twelve. Approving a PR with violations is signing off on numbers you do not trust.

## Appendix M — One more pattern: the "stress" benchmark

A pattern for finding nonlinear behaviour: run the benchmark across many sizes spanning multiple orders of magnitude.

```go
func BenchmarkProcess(b *testing.B) {
    sizes := []int{1, 10, 100, 1_000, 10_000, 100_000, 1_000_000}
    for _, n := range sizes {
        input := makeInput(n)
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            b.SetBytes(int64(n))
            for i := 0; i < b.N; i++ {
                _ = process(input)
            }
        })
    }
}
```

Plot `MB/s` against `n`. You should see:

- A ramp-up at small `n` as fixed overhead amortises.
- A plateau at typical sizes — the steady-state throughput.
- Possibly a cliff at very large sizes — cache misses, page faults, allocator stress.

The cliff tells you the size beyond which your code stops scaling. If production sees inputs above the cliff, you have a problem to investigate.

The plateau is the "true" performance of your function in steady state. Quote that number in conversations.

## Appendix N — Quick summary

Middle-level benchmarking primitives, one-line each:

- `b.Run("name", fn)` — sub-benchmarks.
- `b.ResetTimer()` — zero the timer after setup.
- `b.StopTimer() / b.StartTimer()` — pause/resume the timer (use sparingly).
- `b.SetBytes(n)` — declare bytes per op for `MB/s` reporting.
- `b.RunParallel(body)` — concurrent benchmark.
- `b.SetParallelism(p)` — multiply the goroutine count.
- `b.ReportMetric(v, unit)` — emit a custom column.
- `b.Cleanup(fn)` — register teardown.
- `b.Skip("reason")` — skip the benchmark.
- `-cpu=1,2,4,8` — scaling sweep.
- `-cpuprofile / -memprofile / -trace` — profile collection.

If you can write benchmarks using these primitives without looking them up, you have completed the middle-level material.
