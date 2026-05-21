---
layout: default
title: Benchmarks — Junior
parent: Benchmarks (testing.B)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/junior/
---

# Benchmarks — Junior

[← Back](../)

> Focus: "What is a Go benchmark? How do I write one, run one, and read its output without lying to myself about what it means?"

This is the entry-level page on `testing.B`. By the end you will be able to write a `BenchmarkXxx` function for a small piece of code, run it, read the columns, and avoid the most common beginner mistakes — chiefly the dead-code trap and the "I forgot `-benchmem`" trap.

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [What a benchmark is](#what-a-benchmark-is)
4. [Your first benchmark in five lines](#your-first-benchmark-in-five-lines)
5. [Reading the output line](#reading-the-output-line)
6. [The `b.N` mystery](#the-bn-mystery)
7. [Calibration in plain English](#calibration-in-plain-english)
8. [`-bench` and the regex](#-bench-and-the-regex)
9. [`-benchmem` — adding allocation data](#-benchmem--adding-allocation-data)
10. [What `allocs/op` is](#what-allocsop-is)
11. [What `B/op` is](#what-bop-is)
12. [`b.ReportAllocs()` — the in-code form](#breportallocs--the-in-code-form)
13. [`-benchtime` — how long to run](#-benchtime--how-long-to-run)
14. [`-count` — running more than once](#-count--running-more-than-once)
15. [Benchmarks vs tests — same file, same binary](#benchmarks-vs-tests--same-file-same-binary)
16. [A first table-driven benchmark](#a-first-table-driven-benchmark)
17. [The dead-code-elimination trap](#the-dead-code-elimination-trap)
18. [The "I included setup time" trap](#the-i-included-setup-time-trap)
19. [Vocabulary recap](#vocabulary-recap)
20. [Beginner mistakes](#beginner-mistakes)
21. [Tiny worked example: `strings.Builder` vs `+`](#tiny-worked-example-stringsbuilder-vs-)
22. [Cheat sheet](#cheat-sheet)
23. [Self-assessment](#self-assessment)
24. [Summary](#summary)
25. [Further reading](#further-reading)

---

## Introduction

If you have written a Go program, you have probably wondered "how fast is this?" The wrong way to answer is to wrap your code in a `time.Now()` / `time.Since` pair and call it a benchmark. The right way is to write a function whose name starts with `Benchmark`, put your work in a loop that runs `b.N` times, and let the `go test` tool decide how many iterations to run.

This page teaches that. Nothing more. You will not learn `benchstat` here, nor `RunParallel`, nor CI gating. Those are for later. Here you learn the absolute minimum: how to produce a number, what the number means, and how to not believe a wrong number.

A benchmark in Go is plain Go code. It is not a separate framework. It lives in a `_test.go` file. It is built into the same `go test` binary as your unit tests. It is run by passing `-bench` to that binary. That is the entirety of the model. The complexity comes later, in how you interpret the numbers.

## Prerequisites

- You can write and run a Go test (`func TestXxx(t *testing.T)`).
- You have `go` on your `PATH`.
- You know `go test` produces output to stdout.

If any of these are new, read the testing-basics page in this section first.

## What a benchmark is

A Go benchmark is a function with this exact signature:

```go
func BenchmarkSomething(b *testing.B) { ... }
```

Three rules:

1. The file ends in `_test.go`.
2. The function name starts with `Benchmark` followed by an upper-case letter or underscore. `BenchmarkAdd`, `Benchmark_internal` — fine. `Benchmarkadd` — not recognised, ignored silently.
3. The single parameter is `*testing.B`.

That is it. The framework gives you a `*testing.B`, you do work that respects `b.N`, and `go test -bench=.` runs it.

A benchmark is not a unit test. It does not assert behaviour. It runs your code in a loop and reports how long each iteration took. If you write `b.Error(...)`, you will mark the benchmark as failed, but typically you do not — benchmarks measure, they do not check.

## Your first benchmark in five lines

Create `main.go`:

```go
package addbench

func Add(a, b int) int { return a + b }
```

Create `main_test.go`:

```go
package addbench

import "testing"

func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        Add(1, 2)
    }
}
```

Run it:

```
go test -bench=.
```

You will see something like:

```
goos: linux
goarch: amd64
pkg: example.com/addbench
BenchmarkAdd-8   1000000000   0.27 ns/op
PASS
ok      example.com/addbench  0.301s
```

You just wrote and ran a benchmark. Now we read the output carefully — because that `0.27 ns/op` is wrong, and learning *why* is half of what this page is about.

## Reading the output line

The line `BenchmarkAdd-8   1000000000   0.27 ns/op` has three fields:

- **`BenchmarkAdd-8`** — the benchmark name with a suffix. The `-8` is the value of `GOMAXPROCS` at the time of the run. If your machine has 16 cores, you will see `-16`. It is not a part of your code; the framework appends it.
- **`1000000000`** — the iteration count, i.e. the value of `b.N` that the framework settled on. One billion in this case.
- **`0.27 ns/op`** — nanoseconds per operation, averaged across the billion iterations. One operation = one trip through your loop body.

`ns/op` is the headline number. It is the per-iteration cost in nanoseconds.

A modern CPU runs at roughly 3 GHz, so one cycle is ~0.33 ns. Our `Add` reports 0.27 ns/op — less than one cycle. That should make you suspicious: even an empty `for` loop usually shows ~0.3 ns/op due to loop bookkeeping. We will come back to this in the dead-code-elimination section. For now, accept the number at face value.

## The `b.N` mystery

You did not write `1000000000` anywhere. The framework chose it. Why?

The framework's goal is to run your benchmark long enough that the measurement is stable. "Long enough" means: longer than the timer's resolution, and long enough that noise (a stray context switch, a brief GC pause) averages out. The default target is **one second of wall time**.

If each operation takes 0.27 ns and the target is 1 second, the framework needs about `1 second / 0.27 ns ≈ 3.7 billion` iterations. It does not jump straight there. It calibrates.

## Calibration in plain English

The algorithm, simplified:

1. Run with `b.N = 1`. Measure wall time.
2. If the wall time is less than the target (default 1 s), increase `b.N` and try again.
3. The new `b.N` is roughly `target_time / current_time × b.N`, rounded up to a "nice" number (1, 2, 5, 10, 20, 50, 100, 200, …).
4. Cap at `1e9` (one billion) iterations to bound the worst case.
5. The framework reports the **final** `b.N` and the **final** `ns/op` calculated from that final run.

What this means in practice:

- A benchmark whose body takes 1 ns will end up with `b.N` near `10⁹`.
- A benchmark whose body takes 1 ms will end up with `b.N` near `10³`.
- A benchmark whose body takes 10 s will run once and report that. The benchmark will take 10 s of CI time per call.

Calibration also means your benchmark function is called **multiple times** during a single `-bench` run. The body that respects `b.N` is fine — it scales. But code *outside* the `b.N` loop runs many times too. This is the source of the "I included setup time" trap.

## `-bench` and the regex

You write `-bench=.` to run all benchmarks. The argument is a Go regular expression matched against the full benchmark name (including `b.Run` sub-benchmark suffixes).

Examples:

- `-bench=.` — everything.
- `-bench=BenchmarkAdd` — anything whose name contains `BenchmarkAdd` (matches `BenchmarkAdd`, `BenchmarkAddSlow`, `BenchmarkAddInt64`).
- `-bench='^BenchmarkAdd$'` — exactly `BenchmarkAdd`.
- `-bench=Add` — anything with `Add` in the name (yes, the `Benchmark` prefix is part of the name, so this still works).

By default, when you pass `-bench`, tests **do not** run. You only get benchmarks. To run both:

```
go test -bench=. -run=.
```

Pass `-bench=^$` to run no benchmarks (useful in scripts that want only tests).

## `-benchmem` — adding allocation data

So far the output had three fields. With `-benchmem`, you get two more:

```
go test -bench=. -benchmem
```

```
BenchmarkAdd-8   1000000000   0.27 ns/op   0 B/op   0 allocs/op
```

The new columns are:

- **`B/op`** — bytes allocated per operation, on average. `Add` allocates nothing.
- **`allocs/op`** — number of heap allocations per operation, on average. Again `0`.

`-benchmem` is cheap. Always pass it. There is no reason not to.

## What `allocs/op` is

A Go program allocates memory on the *heap* whenever the escape analyser decides a value cannot live on the stack. Each heap allocation is one "alloc" — regardless of size. `allocs/op` counts the number of such allocations *per iteration of your benchmark*.

It is reported as an integer or a small decimal. `0 allocs/op` means: on average, your operation triggered fewer than 0.5 heap allocations. `1.0 allocs/op` means exactly one per iteration. `12.5 allocs/op` means twelve point five — meaning some iterations allocate 12 and some 13, or the operation does a variable number of allocations depending on input.

Why care? Heap allocations are not free:

- The allocator must find space (cheap for small allocations, more work for large).
- The garbage collector must later trace and reclaim them.
- They evict cache lines.

A function that does the same work with 0 allocations is almost always faster than the same function with 5. Allocations are also more stable than wall-clock time, so they are a great regression-detection signal — see the professional page.

## What `B/op` is

`B/op` is bytes per operation, rounded. If a function allocates a `[]byte` of length 32 once per call, `B/op` is `32`. If it allocates a `map[string]int` with capacity 8, `B/op` is larger — maps have header overhead, bucket arrays, etc.

`B/op` is useful for detecting "this got bigger" regressions: a change that adds a field to a struct returned by a hot path will bump `B/op`.

## `b.ReportAllocs()` — the in-code form

If you want allocation data without passing `-benchmem`, call `b.ReportAllocs()` inside the benchmark:

```go
func BenchmarkAdd(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        Add(1, 2)
    }
}
```

It is equivalent to `-benchmem` but applies only to that benchmark. Useful when:

- You want `B/op` to be visible by default even if a colleague forgets `-benchmem`.
- The benchmark is shipped in a library and you want allocation regressions surfaced for every user.

Practical advice: call `b.ReportAllocs()` in every benchmark unless you have a reason not to. The overhead is zero.

## `-benchtime` — how long to run

The default benchmark run targets **1 second** of wall time. To change it:

```
go test -bench=. -benchtime=3s
```

Each benchmark now targets 3 seconds. `b.N` will be roughly 3× larger. The reported `ns/op` should be the same — you are reducing noise by averaging over more iterations, not changing what is measured.

A different form fixes the iteration count exactly:

```
go test -bench=. -benchtime=100x
```

The trailing `x` means "100 iterations exactly, no calibration". Useful for very expensive operations (e.g. starting a database) where you do not want the framework to multiply `b.N` past your patience.

Default is `1s`. Production use often goes to `3s` or `5s` for stability. Beyond `10s` there are diminishing returns.

## `-count` — running more than once

```
go test -bench=. -count=5
```

Each benchmark is run **five times in a row**. You get five output lines per benchmark:

```
BenchmarkAdd-8   1000000000   0.27 ns/op
BenchmarkAdd-8   1000000000   0.28 ns/op
BenchmarkAdd-8   1000000000   0.27 ns/op
BenchmarkAdd-8   1000000000   0.27 ns/op
BenchmarkAdd-8   1000000000   0.28 ns/op
```

Why? Because variance. A single run is a single sample of a noisy process. Five samples let you (or `benchstat`, see the senior page) compute a mean and stddev. Without `-count`, you have a point estimate with no uncertainty.

Production use: `-count=10`. Always. The cost is linear (10× the runtime).

## Benchmarks vs tests — same file, same binary

A small but important thing: benchmarks and tests coexist. You can have:

```go
func TestAdd(t *testing.T) { ... }
func BenchmarkAdd(b *testing.B) { ... }
```

in the same file, same package. `go test` runs the tests by default. `go test -bench=.` runs benchmarks (and skips tests unless you also pass `-run`).

You can share helpers between them. A `func makeInput(n int) []byte` defined in `_test.go` is accessible to both.

## A first table-driven benchmark

Just like tests, benchmarks can iterate over a table of cases using `b.Run`:

```go
func BenchmarkSum(b *testing.B) {
    sizes := []int{10, 100, 1000, 10_000}
    for _, n := range sizes {
        xs := make([]int, n)
        for i := range xs {
            xs[i] = i
        }
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                _ = Sum(xs)
            }
        })
    }
}
```

The output:

```
BenchmarkSum/n=10-8         100000000    12.4 ns/op
BenchmarkSum/n=100-8         15000000    78.5 ns/op
BenchmarkSum/n=1000-8         1800000   650.0 ns/op
BenchmarkSum/n=10000-8         200000   6500.0 ns/op
```

Each row gets its own `b.N` calibration. Notice the names: `BenchmarkSum/n=10`, etc. The slash-separated suffix comes from the `b.Run` argument.

This pattern is the bread and butter of microbenchmarks. We will say much more about it on the middle page.

## The dead-code-elimination trap

Now back to that suspicious `0.27 ns/op` for `Add(1, 2)`.

The Go compiler is smart. It sees:

```go
for i := 0; i < b.N; i++ {
    Add(1, 2)
}
```

It notices three things:

1. `Add(1, 2)` always returns `3`.
2. The return value is unused.
3. `Add` has no side effects.

It concludes: the body of the loop is dead. Delete it. The benchmark measures an empty loop.

This is called **dead code elimination**. It is correct compiler behaviour — your *real* program does not benefit from useless function calls. But it ruins your benchmark.

Symptoms:

- Numbers that are physically impossible (sub-cycle latencies).
- Numbers that do not change when you make the function more complex.
- Numbers that change dramatically when you assign the result to a variable.

The fix is to make the result observable. The standard idiom:

```go
package addbench

import "testing"

var sink int

func BenchmarkAdd(b *testing.B) {
    var s int
    for i := 0; i < b.N; i++ {
        s = Add(i, i+1)
    }
    sink = s
}
```

Three changes:

1. A package-level `sink` variable.
2. Inside the loop, assign the result to a local `s`.
3. After the loop, store `s` into `sink`.

Why this works: `sink` is package-level, so its value is observable outside this function. The compiler cannot prove the assignment dead. To assign correctly, it must compute `s`. To compute `s`, it must call `Add`. The work happens.

A second trick: pass different arguments each iteration (`Add(i, i+1)` instead of `Add(1, 2)`). This prevents the compiler from constant-folding the call entirely.

Re-run:

```
BenchmarkAdd-8   500000000   2.40 ns/op   0 B/op   0 allocs/op
```

`2.40 ns/op`. That is the real cost of an `Add` call plus loop overhead. (Even this is dominated by the loop; we are reaching the floor of what microbenchmarking can measure on a 3 GHz CPU.)

On **Go 1.24+** there is a cleaner form:

```go
func BenchmarkAdd(b *testing.B) {
    for b.Loop() {
        _ = Add(1, 2)
    }
}
```

`b.Loop()` is a method on `*testing.B` that returns true `b.N` times. Crucially, the compiler is instructed to treat the loop body as if it had unknowable side-effects, so it does not eliminate the call. This is the modern recommended form. We still cover the sink trick because much existing code uses it.

## The "I included setup time" trap

The second classic mistake. Consider:

```go
func BenchmarkParse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        data, _ := os.ReadFile("big.json")
        var v map[string]any
        _ = json.Unmarshal(data, &v)
    }
}
```

You wanted to benchmark `json.Unmarshal`. You actually benchmarked `os.ReadFile + json.Unmarshal`. Every iteration reads the file from disk.

Fix:

```go
func BenchmarkParse(b *testing.B) {
    data, err := os.ReadFile("big.json")
    if err != nil {
        b.Fatal(err)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var v map[string]any
        _ = json.Unmarshal(data, &v)
    }
}
```

Two changes:

1. Move `os.ReadFile` out of the `b.N` loop.
2. Call `b.ResetTimer()` after setup, before the loop. This zeroes the elapsed time and allocation counters.

Without `ResetTimer`, the file-read time would be amortised over `b.N` iterations, but for low `b.N` (which happens during calibration) it would dominate. With `ResetTimer`, the framework starts counting from the line after `ResetTimer()`.

`b.ResetTimer` will appear in every page on this topic. Make it muscle memory.

## Vocabulary recap

- **Benchmark function**: `func BenchmarkX(b *testing.B)`.
- **`b.N`**: the iteration count chosen by the framework.
- **`ns/op`**: nanoseconds per iteration of the loop body.
- **`B/op`**: bytes allocated on the heap per iteration.
- **`allocs/op`**: count of heap allocations per iteration.
- **`b.ResetTimer()`**: zero the timer and allocation counters; use after setup.
- **`b.ReportAllocs()`**: make `B/op` and `allocs/op` visible without `-benchmem`.
- **Calibration**: the framework's process of choosing `b.N`.
- **Dead code elimination**: compiler optimisation that deletes useless work. Beware.

## Beginner mistakes

1. **Forgetting `-benchmem`.** You see `ns/op` but not allocation data. Always add `-benchmem`, or call `b.ReportAllocs()`.
2. **Trusting a single run.** Run with `-count=10` before quoting a number.
3. **The dead-code trap.** Always use a sink variable or `b.Loop()`.
4. **Setup inside the loop.** Hoist setup; call `b.ResetTimer()`.
5. **Comparing benchmarks across different machines.** Different CPU, different memory, different OS — different numbers.
6. **Using `-bench=Foo` and getting `BenchmarkFooBar` too.** Anchor your regex: `-bench='^BenchmarkFoo$'`.
7. **Calling `t.Log` from a benchmark.** Use `b.Log`. They do the same thing but only `b.Log` is in scope.
8. **Saying "X is faster" from one machine.** Always pair with `benchstat` output.

## Tiny worked example: `strings.Builder` vs `+`

A full small example we will revisit in later pages.

```go
package strbench

import "strings"

func Plus(parts []string) string {
    var s string
    for _, p := range parts {
        s += p
    }
    return s
}

func Builder(parts []string) string {
    var b strings.Builder
    for _, p := range parts {
        b.WriteString(p)
    }
    return b.String()
}
```

Benchmark file:

```go
package strbench

import "testing"

var parts = func() []string {
    p := make([]string, 100)
    for i := range p {
        p[i] = "abcdef"
    }
    return p
}()

var sinkStr string

func BenchmarkPlus(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        sinkStr = Plus(parts)
    }
}

func BenchmarkBuilder(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        sinkStr = Builder(parts)
    }
}
```

Run:

```
go test -bench=. -benchmem
```

Approximate output on a modern laptop:

```
BenchmarkPlus-8       100000   12000 ns/op   34000 B/op   99 allocs/op
BenchmarkBuilder-8   1000000    1200 ns/op    1024 B/op    2 allocs/op
```

Read this carefully:

- **`Plus` is ~10× slower.** Each `+=` creates a new string; allocates and copies. For 100 parts, that is 99 intermediate strings.
- **`Plus` allocates 99× per call.** Each intermediate concatenation = one heap allocation.
- **`Builder` allocates 2× per call.** One for the internal `[]byte`, one for the final `b.String()` (well — depends on Go version and inlining; the point is *small*).

This is the canonical "use `strings.Builder`" lesson, but the *interesting* thing is how visible it is in the benchmark output. You did not need a profiler. The columns tell you.

## Cheat sheet

```go
// Skeleton
func BenchmarkXxx(b *testing.B) {
    // setup (runs once per calibration step)
    b.ReportAllocs()
    b.ResetTimer()
    var sink T // optional
    for i := 0; i < b.N; i++ {
        sink = workUnderTest()
    }
    _ = sink
}
```

```
# Common runs
go test -bench=.                   # all benchmarks
go test -bench=. -benchmem         # + allocation columns
go test -bench=. -count=10         # + 10 repetitions
go test -bench=. -benchtime=3s     # + 3 second target
go test -bench=. -cpu=1,2,4,8      # + GOMAXPROCS sweep
```

## Self-assessment

- [ ] I can write a benchmark function from memory.
- [ ] I know what `b.N` is and why I do not pick it.
- [ ] I know what `ns/op`, `B/op`, `allocs/op` mean.
- [ ] I always pass `-benchmem` or call `b.ReportAllocs()`.
- [ ] I always run with `-count=10` before believing the number.
- [ ] I know the dead-code trap and how to avoid it.
- [ ] I know to put setup outside the loop and call `b.ResetTimer()`.
- [ ] I can read a benchmark output line aloud and explain each field.

## Summary

A Go benchmark is a function named `BenchmarkXxx(b *testing.B)` that runs your code in a loop respecting `b.N`. The framework calibrates `b.N` so the run takes at least `-benchtime` (default 1 s). You read the output as `name iters ns/op [B/op allocs/op]`. The two traps to remember: dead code (use a sink variable or `b.Loop()`), and included setup (call `b.ResetTimer()` after setup). Always pass `-benchmem` and `-count=10`. Everything else builds on this.

## Further reading

- testing package godoc: <https://pkg.go.dev/testing>
- `testing.B` specifically: <https://pkg.go.dev/testing#B>
- "Writing Benchmarks" — Dave Cheney's classic post: <https://dave.cheney.net/2013/06/30/how-to-write-benchmarks-in-go>
- The middle, senior, and professional pages in this same section.

---

## Appendix A — Walking through a real benchmark line by line

Let us walk through a complete benchmark file, line by line, narrating every choice. This is what a "good" first benchmark looks like in production-grade Go code.

```go
package httpheader

import (
    "net/http"
    "testing"
)
```

The package is named after the code it tests (`httpheader`). Tests and benchmarks for it live in the same package — they share unexported helpers. The `_test.go` filename suffix is what marks this as test-only code; the compiler does not include it in the production binary.

```go
var sampleHeader = http.Header{
    "Content-Type":   {"application/json"},
    "Accept":         {"application/json", "text/plain"},
    "Authorization":  {"Bearer eyJhbGciOiJIUzI1NiIs..."},
    "User-Agent":     {"Mozilla/5.0"},
    "X-Request-Id":   {"a3b1f9e4-8a2c-4f5d-9c1e-7e2b1c8d9e0f"},
}
```

A package-level value defines the input. It is built once when the package loads. Crucially:

- It is **not** rebuilt per iteration. The cost of constructing the map and slices is amortised to "once per `go test` invocation".
- It is **stable across runs** — same data, same data layout. Reproducible.
- It is **realistic** — a typical HTTP header has several entries, mixed lengths, some long values. We are not benchmarking `Header{}` empty cases.

```go
var sinkString string
```

The sink variable. Package-level so the compiler cannot prove its value is dead. We will assign benchmark results to it.

```go
func BenchmarkLookupContentType(b *testing.B) {
    b.ReportAllocs()
    var s string
    for i := 0; i < b.N; i++ {
        s = sampleHeader.Get("Content-Type")
    }
    sinkString = s
}
```

Six lines of substance. Let us decompose:

- Line 1: standard benchmark signature. The name describes what we measure: "looking up Content-Type from a header".
- Line 2: `b.ReportAllocs()`. We always want allocation columns. There is no cost.
- Line 3: `var s string`. The local variable that holds the result. Local, not package-level — we do not want the optimiser to think it can hoist this out of the loop.
- Line 4: the standard `b.N` loop.
- Line 5: the work under test. `sampleHeader.Get(...)` is what we want to measure. Assignment to `s` is the sink mechanism: the result must be computed each iteration.
- Line 6: `sinkString = s`. After the loop, write the (last) result to a package-level variable. The compiler cannot tell that this is "useless" — package-level variables are observable from outside.

When we run:

```
go test -bench=BenchmarkLookupContentType -benchmem -count=10
```

We get something like (modern laptop, default settings):

```
BenchmarkLookupContentType-8   100000000   12.3 ns/op   0 B/op   0 allocs/op
BenchmarkLookupContentType-8   100000000   12.4 ns/op   0 B/op   0 allocs/op
BenchmarkLookupContentType-8   100000000   12.1 ns/op   0 B/op   0 allocs/op
...
```

Three things to notice:

1. `b.N = 10⁸`. The framework chose this because each op takes ~12 ns and the target is 1 s. The framework will run the loop a billion times if needed.
2. `ns/op` is stable across the 10 runs — variations are in the third significant digit.
3. `0 allocs/op`. `http.Header.Get` does not allocate; it does a map lookup that reuses the existing strings.

This is a "good" benchmark. It is deterministic, stable, has no traps, measures what its name says it measures.

## Appendix B — The most common benchmark output patterns and what they mean

A short field guide.

### Pattern 1: `<1 ns/op`

```
BenchmarkX-8   1000000000   0.27 ns/op
```

You are measuring an empty loop or a fully-eliminated body. Real Go code cannot do useful work in under one cycle (~0.33 ns at 3 GHz).

**Likely cause:** dead code elimination.

**Action:** add a sink variable or switch to `for b.Loop()`.

### Pattern 2: `1-10 ns/op`

```
BenchmarkX-8   200000000   3.4 ns/op
```

Per-op cost in the range of a few CPU instructions or a small computation. Common for arithmetic, simple field accesses, atomic loads.

**Likely cause:** real work, well-optimised.

**Action:** trust the number, but check the sink trick was applied — at this level the loop overhead is a meaningful fraction.

### Pattern 3: `10-100 ns/op`

```
BenchmarkX-8   20000000   45 ns/op
```

A short function with a small amount of memory traffic. Typical for hash lookups, slice indexing with bounds checks, short string comparisons.

**Likely cause:** real work, typical microbenchmark range.

**Action:** focus on `allocs/op` for further insight.

### Pattern 4: `100-1000 ns/op`

```
BenchmarkX-8   2000000   480 ns/op   320 B/op   3 allocs/op
```

Modest work — small parses, short hash computations, lookups in trees. Usually involves at least one heap allocation.

**Likely cause:** real work, allocation-bound.

**Action:** can you remove the allocations? Pre-allocate, reuse, `sync.Pool`?

### Pattern 5: `1-100 µs/op`

```
BenchmarkX-8   30000   25000 ns/op   8192 B/op   15 allocs/op
```

Heavier work — a real parse, encoding, network simulator, cryptographic hash on moderate inputs.

**Likely cause:** the work is genuinely complex.

**Action:** focus on `allocs/op` and `B/op` more than `ns/op`. Algorithm changes matter at this scale.

### Pattern 6: `>1 ms/op`

```
BenchmarkX-8   500   3500000 ns/op
```

Either heavy CPU work, or you have I/O in your benchmark.

**Likely cause:** disk read, network call, large compute.

**Action:** is I/O supposed to be there? If not, hoist it out. If yes, this is an integration benchmark and should probably live separately.

### Pattern 7: Increases under `-cpu=1,2,4,8`

```
BenchmarkX-1  100000000   10 ns/op
BenchmarkX-2   50000000   25 ns/op
BenchmarkX-4   30000000   42 ns/op
BenchmarkX-8   20000000   60 ns/op
```

Negative scaling. The code gets *slower* per op as more goroutines are added.

**Likely cause:** contention on a shared resource — mutex, atomic, false sharing.

**Action:** profile under contention; look for ways to shard the resource.

### Pattern 8: Flat under `-cpu=1,2,4,8`

Numbers stay constant. The code does not contend.

**Likely cause:** lock-free, per-goroutine state, or simply not measuring concurrency.

**Action:** verify the benchmark is actually parallel (`b.RunParallel`).

## Appendix C — Why benchmark files cannot import each other

A reminder about the file model. `_test.go` files are compiled into a separate test binary, not into the production binary. They can:

- Access unexported names of their own package.
- Import any regular package.
- Define helpers used by both tests and benchmarks.

They cannot:

- Be imported by other packages (the test binary is self-contained).
- Provide library helpers to other packages' tests.

If you want shared test infrastructure across packages, put it in a regular (non-`_test`) helper package — e.g. `internal/testutil`. The same applies for benchmark fixtures.

## Appendix D — The `b.Helper()` method

Borrowed from `t.Helper()` and works the same way: marks the calling function as a helper so that when an error is logged, the file:line of the *caller* of the helper is reported, not the line inside the helper. Useful for benchmarks that fail (call `b.Fatal`) from inside a helper utility:

```go
func mustOpen(b *testing.B, path string) *os.File {
    b.Helper()
    f, err := os.Open(path)
    if err != nil {
        b.Fatal(err)
    }
    return f
}
```

Calling `mustOpen(b, "/tmp/missing")` from inside `BenchmarkX` will report the error at the line of the `mustOpen` *call*, not inside `mustOpen`. This makes failures easier to triage.

## Appendix E — Tiny vocabulary of perf words you will see

| Word | What it means |
|---|---|
| **micro-benchmark** | A benchmark of a single function or small block of code, in isolation. The kind `go test -bench` produces. |
| **macro-benchmark** | A benchmark of an entire system (a service handling requests). Not produced by `go test`; needs load tools. |
| **throughput** | Operations per second; how many things the system can do per unit time. |
| **latency** | Time per operation; how long one thing takes. |
| **p50 / p99** | Percentiles of latency. p99 = "99 % of operations were faster than this". |
| **tail latency** | The slow end (p99, p99.9, p99.99). Often the relevant metric in production. |
| **noise** | Variation in a measurement caused by factors other than the code. |
| **stddev** | Standard deviation; one measure of noise magnitude. |
| **regression** | A change that makes performance worse. |
| **hot path** | A code path executed very often. Where optimisation pays off. |
| **cold path** | A code path executed rarely. Optimising it usually does not matter. |
| **escape** | When a value cannot be allocated on the stack and must go on the heap. |
| **allocation** | A heap allocation, as counted by `allocs/op`. |
| **GC** | Garbage collector. |
| **inlining** | Compiler optimisation that pastes a function body into its caller. |

## Appendix F — Reading the test binary's verbose output

`go test -bench=. -v` adds verbose output. You see lines like:

```
goos: linux
goarch: amd64
pkg: example.com/foo
cpu: AMD Ryzen 9 5950X 16-Core Processor
BenchmarkX
BenchmarkX-8         1000000           1234 ns/op
```

The `-v` flag shows the `BenchmarkX` line *before* the run starts. Useful for long-running benchmarks where you want progress indication. Without `-v`, you only see the result line after the run completes.

The header lines (`goos`, `goarch`, `pkg`, `cpu`) are emitted at the start of any benchmark run. They are important — comparing benchmarks across different `goarch` (amd64 vs arm64) or different CPU models is comparing apples to oranges. `benchstat` warns when these differ between input files.

## Appendix G — Where benchmarks live in real Go codebases

A walk through how mainstream Go projects organise benchmarks:

### Standard library

In the Go source tree, every package has a `*_test.go` file with tests *and* benchmarks for performance-sensitive functions. For example `src/strings/strings_test.go` contains `BenchmarkIndexByte`, `BenchmarkReplaceAll`, etc.

Pattern: benchmark functions are intermixed with tests in the same file. There is no separate `bench_test.go` convention.

### Kubernetes

`k8s.io/kubernetes` has benchmarks for hot paths: scheduling, API conversion, cache lookups. They live in the same files as unit tests, suffixed `_test.go`.

There is also an out-of-tree perf test suite (`test/integration/scheduler_perf`) for macro-benchmarks of the scheduler under realistic load. Those use a different framework but borrow ideas from `testing.B`.

### gRPC-Go

`google.golang.org/grpc` has microbenchmarks in `benchmark/` for stream throughput, codec performance, etc. Some are full-server benchmarks that start an in-process gRPC server.

### Pattern observation

Across the ecosystem:

- Microbenchmarks live next to their code: `foo.go` + `foo_test.go`.
- Macro-benchmarks live in `benchmark/` or `cmd/benchmark/` subdirectories with their own `main` packages and run modes.
- Critical projects have dedicated CI infrastructure (Go's own perf dashboard at <https://perf.golang.org>).

You can adopt any of these patterns. Start with the standard-library convention (intermixed in `_test.go` files) for any package small enough to fit. Graduate to a `benchmark/` subdirectory when the benchmark code becomes substantial.

## Appendix H — Benchmark naming conventions in the wild

A glance at popular projects shows three naming styles:

### Style 1 — `BenchmarkFunctionName`

```go
func BenchmarkParse(b *testing.B) { ... }
func BenchmarkMarshal(b *testing.B) { ... }
```

Direct mapping from the function under test to the benchmark name. The simplest and most common.

### Style 2 — `BenchmarkFunctionName_Variant`

```go
func BenchmarkParse_JSON(b *testing.B) { ... }
func BenchmarkParse_XML(b *testing.B) { ... }
```

Underscore-separated variants. Pre-dates `b.Run`. Mostly legacy now; prefer style 3.

### Style 3 — `BenchmarkScope` with `b.Run("variant")`

```go
func BenchmarkParse(b *testing.B) {
    b.Run("json", func(b *testing.B) { ... })
    b.Run("xml", func(b *testing.B) { ... })
}
```

A single top-level benchmark with sub-benchmarks for variants. Cleaner output (table-driven), easier to filter via `-bench`. The current best practice.

You will see all three in the wild. When you write new benchmarks, prefer style 3.

## Appendix I — Common patterns to use as starting points

Copy-paste skeletons for the situations you will hit most often.

### Pattern A — Simple function benchmark

```go
var benchSink int

func BenchmarkAdd(b *testing.B) {
    b.ReportAllocs()
    var s int
    for i := 0; i < b.N; i++ {
        s = Add(i, i+1)
    }
    benchSink = s
}
```

### Pattern B — Benchmark with setup

```go
func BenchmarkProcess(b *testing.B) {
    data := loadCorpus()
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = Process(data)
    }
}
```

### Pattern C — Table-driven over input sizes

```go
func BenchmarkSum(b *testing.B) {
    for _, n := range []int{10, 100, 1000, 10_000} {
        xs := buildInts(n)
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            b.ReportAllocs()
            for i := 0; i < b.N; i++ {
                _ = Sum(xs)
            }
        })
    }
}
```

### Pattern D — Throughput benchmark

```go
func BenchmarkEncode(b *testing.B) {
    input := buildPayload(1 << 20) // 1 MiB
    b.SetBytes(int64(len(input)))
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = Encode(input)
    }
}
```

### Pattern E — Parallel benchmark

```go
func BenchmarkConcurrent(b *testing.B) {
    state := initState()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = state.Op()
        }
    })
}
```

Keep these patterns around. Most benchmarks you write are variations of them.

## Appendix J — A final, complete example

Putting *everything* together: a complete `_test.go` file that benchmarks a function correctly, in the modern style.

```go
package wordcount

import (
    "fmt"
    "strings"
    "testing"
)

// Count returns the number of whitespace-separated words in s.
func Count(s string) int {
    return len(strings.Fields(s))
}

var (
    benchInputs = []struct {
        name string
        text string
    }{
        {"short", "the quick brown fox"},
        {"medium", strings.Repeat("lorem ipsum ", 50)},
        {"long", strings.Repeat("the rain in spain stays mainly in the plain ", 1000)},
    }
    sinkInt int
)

func BenchmarkCount(b *testing.B) {
    for _, in := range benchInputs {
        b.Run(fmt.Sprintf("len=%s", in.name), func(b *testing.B) {
            b.ReportAllocs()
            b.SetBytes(int64(len(in.text)))
            b.ResetTimer()
            var n int
            for i := 0; i < b.N; i++ {
                n = Count(in.text)
            }
            sinkInt = n
        })
    }
}
```

Run:

```
go test -bench=BenchmarkCount -benchmem -count=10
```

What you should see:

```
BenchmarkCount/len=short-8     20000000   65 ns/op   315.38 MB/s   48 B/op   1 allocs/op
BenchmarkCount/len=medium-8     1500000  820 ns/op   731.71 MB/s  672 B/op   1 allocs/op
BenchmarkCount/len=long-8         50000 28000 ns/op  1567.86 MB/s 8192 B/op  1 allocs/op
```

Read top to bottom:

- All three variants allocate exactly once per call (the result slice from `strings.Fields`).
- `MB/s` increases with input size — overhead per call amortises out; the steady-state throughput is around 1.5 GB/s.
- `B/op` grows with the result size.

This is a benchmark you can defend. It has setup hoisted out, allocation reporting on, throughput declared, table-driven structure, and a sink. Everything we covered in this page, in one file.

## Appendix K — Frequently asked questions at the junior level

A grab-bag of questions junior engineers ask when they first encounter benchmarks. Read them as flashcards.

### Q1: Can I have multiple `BenchmarkX` functions in the same file?

Yes. As many as you want. They are independent functions; `go test -bench=.` discovers all of them by name.

### Q2: Can I share helpers between tests and benchmarks?

Yes. A helper defined in `_test.go` is visible to both `func TestX(t *testing.T)` and `func BenchmarkY(b *testing.B)` in the same package. The first parameter type is the only difference.

### Q3: What if my code panics in a benchmark?

The benchmark fails with a stack trace, just like a test. `go test` exit code is non-zero. CI gates can react.

### Q4: Can I print things from a benchmark?

You can, but should not. `fmt.Println` from inside the `b.N` loop will slow down the benchmark by orders of magnitude. Use `b.Log` if you must — and only outside the loop or behind a condition.

### Q5: Does `go test` rebuild the test binary every time?

Yes. Each `go test -bench` invocation builds a fresh test binary from source. The build is fast (Go is incremental and parallel) but it is non-zero. For repeated runs of the same benchmark, the build cache helps a lot.

### Q6: Why do my numbers change between runs?

Many reasons. Sources of noise: CPU frequency scaling, background processes, GC pauses, cache state. The senior page goes deep on this. For now: run `-count=10` and look at the variation.

### Q7: Should I commit the `benchstat` output?

Generally no — the numbers depend on the machine. Commit *interpretations*. PRs may include "BenchmarkX improved by 23 % (p=0.000)" as a sentence, not as raw numbers in the diff.

### Q8: Can benchmarks be parallelised across machines?

Not directly. A single benchmark must run on a single machine for the per-iteration measurement to be coherent. Different benchmarks can run on different machines in parallel CI shards.

### Q9: What is `BenchmarkX-8`'s `-8` again?

`GOMAXPROCS=8`. The framework appends the value of `GOMAXPROCS` at the time of the run to every benchmark name. It is informational; it does not affect the benchmark behaviour unless you used `b.RunParallel`.

### Q10: Why does my benchmark take more than `-benchtime=1s`?

Because there is setup outside the loop, calibration with multiple sub-runs, output, etc. The `-benchtime` is the target *for the measured loop*, not the total wall time of `go test`.

## Appendix L — A minimal benchmark workflow you can adopt today

If you want one piece of advice from this page to remember, here it is:

```
go test -bench=. -benchmem -count=10 > bench.txt
cat bench.txt
```

Always with `-benchmem`. Always with `-count=10`. Read both the median and the variation. If the numbers within the 10 runs vary by more than 5 %, the result is too noisy to draw conclusions from — improve your conditions (close apps, governor settings) and re-run.

This is your daily-driver workflow. It is not the optimal workflow (the senior and professional pages cover that), but it is the minimum that produces numbers worth quoting in a code review.

## Appendix M — How `go test` actually finds your benchmark

A peek under the hood. When you run `go test -bench=BenchmarkX`, the toolchain:

1. Scans every `_test.go` file in the target package(s).
2. Parses each file as Go.
3. Identifies every top-level function whose name matches the regex `^Benchmark[A-Z_]`.
4. Verifies the parameter is `*testing.B`.
5. Generates a tiny `main` package that imports the test package and calls a generated entry point.
6. The entry point invokes `testing.Main(...)` with the list of benchmark functions.
7. `testing.Main` filters by the `-bench` regex, then runs the matched ones.
8. For each benchmark, the framework calibrates `b.N` (the "calibration loop"), then runs and reports.

You will never see this generated code unless you pass `-x` to `go test` (which prints the underlying commands) or look in the build cache. But knowing the model helps:

- Why must the function be top-level? Because the generated entry point can only call top-level functions by name.
- Why must the file end in `_test.go`? Because that is the marker `go test` uses to include the file in the test binary.
- Why does the function name start with `Benchmark`? Because that is the regex `go test` uses to find candidates.

Three syntactic conventions, one elegant mechanism.

## Appendix N — Closing thought

Microbenchmarks are tools, not truths. They tell you about the cost of a single function in isolation, on a specific machine, under a specific input. They do not tell you about your service's tail latency. They do not tell you what your users experience. They do not tell you whether your architecture is correct.

But they are *necessary* tools. Without them, every "performance" discussion is opinion. With them, you have numbers — imperfect, contextual, but numbers. The discipline you start building at the junior level — write a benchmark, run it, read the output, do not believe the first number — is what makes a senior engineer trustworthy on performance topics.

The next page (`middle.md`) takes the primitives you have learned here and applies them to comparisons: how to write benchmarks of *two* implementations so you can pick the better one. That is when benchmarks become useful as decision-making tools.

## Appendix O — The `_test.go` file rules in detail

`_test.go` files have specific rules worth knowing at the junior level. They form the contract between you and `go test`.

**Rule 1: Suffix.** The file name must end with `_test.go`. The full file name format is `name_test.go`. The `name` part is arbitrary; common conventions include the source file's name (`add_test.go` for `add.go`) or a topic name (`bench_test.go` if there are many test files).

**Rule 2: Package.** The file declares a `package` clause like any Go file. Two choices:

- Same package as production code: `package mypkg`. Has access to unexported names. Most common.
- External test package: `package mypkg_test`. Acts as if it were a separate user of the library; can only see the exported API. Used to enforce that you do not accidentally rely on internals.

The two can coexist in the same directory; the test binary contains both.

**Rule 3: Not in production binary.** Files ending `_test.go` are compiled only when running `go test`. They never end up in your application's binary. This means you can put expensive imports, test fixtures, debugging helpers there without bloating production.

**Rule 4: Allowed declarations.** All of:

- `func TestXxx(t *testing.T)`.
- `func BenchmarkXxx(b *testing.B)`.
- `func FuzzXxx(f *testing.F)`.
- `func ExampleXxx()` and variants.
- `func TestMain(m *testing.M)` — runs once per package, useful for global setup/teardown.
- Regular `var`, `const`, `type`, and helper `func` declarations.

You can have non-test functions in `_test.go` files; they are accessible from any test/benchmark in the same package.

**Rule 5: Imports.** Standard Go imports. You can import any package, including `testing` itself. You can also import other packages of your own module that would create import cycles in production — useful for isolating test infrastructure.

## Appendix P — A note on the size of `ns/op`

For perspective, here is a rough conversion table between `ns/op` and real-world events on a modern CPU.

| ns/op | What | What you can do in that time |
|---|---|---|
| 0.3 | 1 CPU cycle | An `add` instruction |
| 1 | ~3 cycles | An `add` with operand fetch |
| 3 | L1 cache hit | A simple struct field access |
| 10 | L2 cache hit | A short map lookup |
| 30 | L3 cache hit | A small string compare |
| 100 | DRAM access | A large map lookup (cache miss) |
| 1,000 (1 µs) | Branch mispredict + DRAM × 10 | A short hash computation |
| 10,000 (10 µs) | SSD read syscall | A regex match on 1 KB |
| 100,000 (100 µs) | Same-rack network round trip | A modest JSON parse on 10 KB |
| 1,000,000 (1 ms) | Cross-AZ network round trip | A large compile step |

When you see `45 ns/op`, the rough size of the operation is "a few cache accesses + a small computation". When you see `100,000 ns/op`, you are almost certainly doing I/O. Use the table as a sanity check: an operation should take a time consistent with what it is doing. A "simple field access" reporting `100 ns/op` is suspicious — something else is happening (allocation? interface boxing?).

## Appendix Q — Final exam

Twelve quick questions to test whether the junior page sank in.

1. What is the function signature for a benchmark?
2. Why does the framework choose `b.N` instead of you?
3. What does the `-8` in `BenchmarkX-8` mean?
4. Name the three columns in default benchmark output.
5. Name the two extra columns added by `-benchmem`.
6. Why is `0.27 ns/op` for an `Add(1,2)` benchmark suspicious?
7. What is a "sink variable" and why use one?
8. Where do you put `b.ResetTimer()`?
9. What does `-bench=Foo` match?
10. How do you anchor `-bench` to a single benchmark name?
11. What is `b.Loop()` and which Go version added it?
12. Why is `-count=10` recommended?

If you can answer all twelve aloud without looking, you are ready for the middle page.

## Appendix R — Worked example: "is my comparison fair?"

A subtle problem that beginners get wrong. Suppose you want to compare two functions:

```go
func Fast(n int) int { return n * 2 }
func Slow(n int) int { time.Sleep(time.Microsecond); return n * 2 }
```

You benchmark both:

```go
func BenchmarkFast(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = Fast(i)
    }
}
func BenchmarkSlow(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = Slow(i)
    }
}
```

Output:

```
BenchmarkFast-8   1000000000   0.27 ns/op
BenchmarkSlow-8       1000000   1300 ns/op
```

"Fast is 4800× faster". Wrong on multiple levels:

1. **`Fast` has been eliminated.** Its `0.27 ns/op` is loop overhead. The compiler deleted the multiplication because the result is unused.
2. **`Slow`'s number is real** — `time.Sleep` cannot be optimised away, so 1 µs/op is the actual cost.

The "comparison" is between *no work at all* and *real work*. Not informative.

Fix with sink + non-trivial work:

```go
var sink int

func BenchmarkFast(b *testing.B) {
    var s int
    for i := 0; i < b.N; i++ {
        s = Fast(i)
    }
    sink = s
}
```

Now `BenchmarkFast` reports actual work. Lesson: always apply the same anti-elimination treatment to both sides of a comparison. Asymmetric benchmarks lie.

## Appendix S — Common compiler optimisations that affect benchmarks

A junior-friendly summary of what the compiler does that you should know about:

### Inlining

Small functions are inlined into their callers. The function call itself disappears; the body becomes part of the caller. This can dramatically speed up the function but only if the *caller* is observed.

In a benchmark, if the caller is the `b.N` loop, inlining helps — the work is now in the loop. But inlining sometimes enables further dead-code elimination on the now-visible body.

### Constant folding

`Add(1, 2)` where `Add` is `return a + b` becomes `return 3` at compile time. The function call vanishes; the value `3` is constant. If unused, eliminated entirely.

Pass non-constant arguments (like `Add(i, i+1)`) to prevent this.

### Bounds-check elimination

`a[i]` where the compiler can prove `i` is in range omits the bounds check. Faster but harder to predict. The compiler is more aggressive with simple loop indices than complex ones.

### Escape analysis

A value used only inside a function stays on the stack (free). A value that escapes (returned, sent to a channel, stored in an interface) goes on the heap (one allocation). Your benchmark's allocation count is determined by escape analysis.

A change that prevents escape can drop `B/op` to 0. A change that causes escape can introduce allocations where there were none.

### Loop unrolling

Some loops get partially unrolled — the body is duplicated to reduce per-iteration overhead. The Go compiler is relatively conservative here; LLVM/clang does more. Affects exact `ns/op` but rarely dramatically.

These optimisations are *good* — they make your real code faster. They are *bad* in benchmarks only when they obscure the work you wanted to measure. The dead-code-elimination trap is the classic example.

## Appendix T — One last junior-level mistake

A specific mistake worth singling out. You write:

```go
func BenchmarkX(b *testing.B) {
    input := buildInput()
    for i := 0; i < b.N; i++ {
        result := process(input)
        if result != "expected" {
            b.Fatal("wrong result")
        }
    }
}
```

The assertion is inside the loop. The `if` check costs maybe 1 ns/op. For a benchmark where `process` itself takes 3 ns/op, the assertion is 33 % of the measurement.

Fix: assert once outside the loop, then run the bare loop:

```go
input := buildInput()
if process(input) != "expected" {
    b.Fatal("wrong result")
}
b.ResetTimer()
for i := 0; i < b.N; i++ {
    _ = process(input)
}
```

The single pre-check is enough to catch the "broken function returns early" case. Inside the loop, you only do the work you want to measure.

For slow operations (microseconds and up), the inline assertion is acceptable. For microbenchmarks, hoist it.


