---
layout: default
title: Benchmark Deep — Junior
parent: Benchmarking Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/junior/
---

# Benchmark Deep — Junior

[← Back](../)

This page is the bridge between "I can write a `BenchmarkX` function" (which
you learned in `09/05-benchmarks`) and "I understand why my numbers move
when I am not changing the code." Here we slow down and explain —
concretely, with examples you can paste into a sandbox — the things that
go wrong before you even get to comparing implementations.

The goal of this page is not to make you a performance expert. It is to
make sure that, when you write a benchmark and hand it to a senior, the
senior does not have to throw it out and start over. By the end you will
know what `b.N` actually is, why the compiler keeps "stealing" your
benchmark, how to read every column in the output, and how to use
`benchstat` for the first time.

## 1. What `b.N` actually is

When you write:

```go
func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = 1 + 1
    }
}
```

The framework calls your function multiple times. On the first call it
sets `b.N = 1`, measures, sees the elapsed time is way under `-benchtime`
(default 1 second), and decides "I need more iterations to get a reliable
measurement." It calls your function again with a bigger `b.N`. Then
again. And again. The growth schedule roughly doubles each pass until the
wall-clock time per pass exceeds the target.

The number you see in the output column (`12345` in
`BenchmarkAdd-8     12345     97.6 ns/op`) is the *final* `b.N` that
produced a stable measurement. The `ns/op` is the total elapsed time
divided by that `b.N`. So `b.N` is an *output* of the framework's
stabilisation logic, not an input you control directly.

Why does this matter? Because it changes how you write the body. The body
must be inexpensive to repeat. It must not have side effects that compound
(no growing a slice across iterations). It must not depend on `i` for
correctness (only for variability, which we will discuss below).

A common confusion: "if `b.N` is chosen by the framework, can I just hard-
code it to a million and call my own benchmark?" You can, but you lose the
automatic stabilisation and the framework's output integration. The
convention is: write `for i := 0; i < b.N; i++` and let the framework own
the loop bound. Trust the iteration count it picks.

A second confusion: "what if my function takes 10 seconds per call?" Then
`b.N` will end at 1 and the framework will run it for `-benchtime`. You
will get a noisy single-sample measurement. The right fix is either
shorten the function (it is probably not a microbenchmark) or accept that
this benchmark requires `-count=20` to be useful.

## 2. The minimum viable benchmark

Here is a benchmark for `strings.ToUpper`:

```go
package strops_test

import (
    "strings"
    "testing"
)

var sink string

func BenchmarkToUpper(b *testing.B) {
    s := "the quick brown fox jumps over the lazy dog"
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sink = strings.ToUpper(s)
    }
}
```

Three details deserve attention.

First, `var sink string` is package-level. This is the standard idiom to
consume the return value so the compiler cannot eliminate the call as
dead code. Why package-level? Because a local `_ = strings.ToUpper(s)` is
*also* a discard the compiler may optimise away after inlining, while a
package-level variable's address is observable to other packages and
cannot be proven dead.

Second, `b.ResetTimer()` is called between the setup (`s := ...`) and the
loop. The setup is cheap here (just a string-literal assignment, no
allocation), so the reset is cosmetic. But it is good muscle memory: as
soon as you have any meaningful setup, you want it outside the timed
window.

Third, `s` is a literal. This means the compiler might constant-fold
`strings.ToUpper("the quick brown fox...")` at compile time if the
function were marked pure. It is not pure in Go (it allocates), so this
particular case is safe. But we will see in section 4 that constant
inputs cause subtle problems with simpler functions.

A fourth, often-overlooked detail: the benchmark is in package
`strops_test`, not `strops`. Putting benchmarks in the `_test` package
forces them to use the public API of your package, which is what
production callers do. If you put a benchmark *inside* `package strops`
you can access unexported state, which is sometimes useful but also a
trap: you may inadvertently exercise an internal cache that no real
caller sees.

## 3. Reading the output

Run with `go test -bench=. -benchmem`. Output:

```
goos: linux
goarch: amd64
pkg: example.com/strops
cpu: 13th Gen Intel(R) Core(TM) i7-13700H
BenchmarkToUpper-20    9876543    121 ns/op    48 B/op    1 allocs/op
PASS
ok  example.com/strops  1.234s
```

Decode left-to-right:

- `BenchmarkToUpper-20` — the benchmark name plus `GOMAXPROCS`. The `-20`
  is "I ran with `GOMAXPROCS=20`." If you want repeatability set `-cpu=1`
  to remove this variable.
- `9876543` — final `b.N`.
- `121 ns/op` — average wall-clock time per iteration. Average, not
  median. Outliers drag this number; we will fix that on the middle page.
- `48 B/op` — average heap bytes allocated per iteration.
- `1 allocs/op` — average heap allocation *count* per iteration. This is
  the most useful number for spotting allocation regressions because it
  is exact (integer) — a delta from `1` to `2` is unambiguous.

`-benchmem` enabled the last two columns. Without it you see only ns/op.
The Go community has converged on always passing `-benchmem`; the cost
is negligible.

The four header lines (`goos`, `goarch`, `pkg`, `cpu`) are emitted once
per `go test` invocation. They are not metadata you can rely on for
benchstat matching (benchstat ignores them). But you should *keep* them
in any artefact you save: if a year later someone asks "what hardware
was this run on?" the answer is in the header.

## 4. How the compiler steals your benchmark

This is where most beginner benchmarks go wrong. Consider:

```go
func square(x int) int { return x * x }

func BenchmarkSquare(b *testing.B) {
    for i := 0; i < b.N; i++ {
        square(2)
    }
}
```

You will see `0.30 ns/op` or similar. That is the cost of an empty loop.
The compiler:

1. Inlined `square` because it is tiny.
2. Saw the call site `square(2)` has a constant input.
3. Constant-folded the result: `4`.
4. Noticed `4` is unused: dead.
5. Removed the whole call.

The benchmark measures *nothing*. To fix, you need both a non-constant
input and a used output:

```go
var sinkInt int

func BenchmarkSquare(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sinkInt = square(i)
    }
}
```

Now `i` changes per iteration so constant folding cannot fire, and
`sinkInt` is package-level so dead-code elimination cannot fire. The
reported time will be the real cost of an integer multiply plus the loop
overhead (a few hundred picoseconds on modern x86).

There is a still-better idiom that also defeats *partial* inlining tricks:

```go
//go:noinline
func square(x int) int { return x * x }
```

`//go:noinline` tells the compiler to leave the function alone. Use it
when you specifically want to measure the un-inlined cost. Be aware that
production calls *will* be inlined, so this benchmark answers a different
question.

A practical heuristic: every benchmark body should be of the form
`sink = f(varied_input)`. If you find yourself writing `_ = f(...)` or
`f(...)` with no assignment, the compiler will most likely remove the
work and your number is fiction.

A more subtle dead-code trick: even if the return is captured, *if the
function has no observable side effect and the result is overwritten
each iteration*, a smart compiler could remove all but the last call.
Today's Go compiler does not go that far, but the safest pattern is to
make the sink *cumulative*:

```go
var sumSink int64

func BenchmarkSumSafer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sumSink += square(int64(i))
    }
}
```

`sumSink` carries information from every iteration, so no iteration can
be removed without changing the final value.

## 5. Resetting the timer

If your setup is expensive, you need `b.ResetTimer()`:

```go
func BenchmarkSortLargeSlice(b *testing.B) {
    // Setup outside the timed region:
    data := make([]int, 100000)
    rng := rand.New(rand.NewSource(42))
    for i := range data {
        data[i] = rng.Int()
    }

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        // We need a fresh copy each iteration or the second
        // iteration runs sort on an already-sorted slice.
        cp := make([]int, len(data))
        copy(cp, data)
        sort.Ints(cp)
    }
}
```

Two problems are visible here. The `make` + `copy` inside the loop is
part of what we are measuring, even though we only care about
`sort.Ints`. The fix is `b.StopTimer()` / `b.StartTimer()`:

```go
b.ResetTimer()
for i := 0; i < b.N; i++ {
    b.StopTimer()
    cp := make([]int, len(data))
    copy(cp, data)
    b.StartTimer()
    sort.Ints(cp)
}
```

But `StopTimer`/`StartTimer` themselves have overhead (a few hundred
nanoseconds), so for fast operations this adds more noise than it
removes. A better pattern: pre-build N copies before the loop.

```go
func BenchmarkSortLargeSlice(b *testing.B) {
    data := make([]int, 100000)
    rng := rand.New(rand.NewSource(42))
    for i := range data {
        data[i] = rng.Int()
    }
    copies := make([][]int, b.N)
    for i := range copies {
        copies[i] = make([]int, len(data))
        copy(copies[i], data)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sort.Ints(copies[i])
    }
}
```

This is memory-hungry (b.N copies of 100k ints) but the timed region is
clean. For `b.N = 1000` you use 800MB of memory; for `b.N = 100000`
you use 80GB which is not OK. The trade-off is: the larger your `b.N`,
the more important it is to use the StopTimer/StartTimer dance instead
of pre-allocating.

A third option, which scales: pre-allocate a *pool* of N copies up to
some cap, and cycle through them, accepting that very large `b.N` will
sort already-sorted copies in some iterations:

```go
const poolSize = 64
copies := make([][]int, poolSize)
for i := range copies {
    copies[i] = make([]int, len(data))
    copy(copies[i], data)
}
b.ResetTimer()
for i := 0; i < b.N; i++ {
    cp := copies[i%poolSize]
    // restore unsorted order by re-copying (cheap relative to sort).
    if i >= poolSize {
        copy(cp, data)
    }
    sort.Ints(cp)
}
```

This uses bounded memory and the warmup cost amortises over `b.N`.

## 6. Variability between runs

Run the same benchmark twice with no code change:

```
BenchmarkToUpper-20    9876543    121 ns/op
BenchmarkToUpper-20    9876543    118 ns/op
```

A 2.5% delta with no code change. This is normal. The causes, in order
of magnitude:

1. **CPU frequency scaling.** Modern CPUs run at variable clock
   frequencies depending on temperature, power budget, and how many
   cores are active. A laptop on battery may downclock during the
   bench. Solution: plug in, lock frequency with `cpupower` (Linux),
   and let the laptop warm up before recording.
2. **SMT siblings.** If hyperthreading is on, your benchmark shares an
   L1 cache and execution ports with another logical CPU that might be
   doing anything. Solution: disable SMT or pin to a specific core
   whose sibling you keep idle.
3. **Cache state.** First run is cold, subsequent runs find data in
   L2/L3. The framework's warmup partially handles this but not fully.
   Solution: discard the first `-count=N` sample, or run `-benchtime`
   long enough that warmup is negligible.
4. **Page-fault and ASLR layout.** Each binary launch lays out memory
   differently. Solution: `-count=10` and use benchstat to summarise.

The takeaway is that *a single number is not a measurement*. A
measurement is a distribution. The next step up — what you will learn
in the middle section — is how to summarise a distribution responsibly.

A further class of variability comes from the operating system rather
than the CPU: kernel timer ticks, IRQ servicing, page reclaim under
memory pressure. On a developer laptop running a browser and a chat
client these can each cost milliseconds at unpredictable intervals.
Close everything you can, or — better — run benchmarks on a server you
ssh into.

## 7. The first encounter with benchstat

Install the tool:

```
go install golang.org/x/perf/cmd/benchstat@latest
```

Save two runs:

```
go test -bench=BenchmarkToUpper -count=10 > before.txt
# ...edit code...
go test -bench=BenchmarkToUpper -count=10 > after.txt
benchstat before.txt after.txt
```

Sample output:

```
name        old time/op  new time/op  delta
ToUpper-20    121ns ± 3%   89.4ns ± 2%  -26.12% (p=0.000 n=10+10)
```

Translate each column:

- `121ns ± 3%` — the median is 121ns; the interval covering most samples
  is ±3% around the median.
- `-26.12%` — the percentage change.
- `p=0.000` — the Mann–Whitney U test gave p < 0.001, very strong
  evidence that the two distributions differ.
- `n=10+10` — 10 samples on each side.

If the delta column shows `~` instead, it means benchstat could not
reject the null at the configured threshold. Either your change had no
effect, or your samples are too noisy / too few to detect it.

The single line above is the whole point of running 10 samples each
side. Without samples, benchstat refuses to claim anything. A reviewer
looking at a "12% faster" claim with one sample each side has no way
to tell if it is real. A reviewer looking at the line above has a clear
verdict.

Citation: `golang.org/x/perf/cmd/benchstat` — the canonical reference
for the tool's behaviour and flags.

## 8. Allocation hygiene

`b.ReportAllocs()` (or the `-benchmem` flag) shows `B/op` and
`allocs/op`. Treat `allocs/op` as a *first-class regression signal*.
Time/op is noisy; allocs/op is exact. A PR that goes from `0 allocs/op`
to `1 allocs/op` is almost always a regression even if the time delta is
invisible, because the impact on GC pressure scales with QPS and shows
up at the percentile tail.

A simple example. Here is a buggy version:

```go
func format(x int) string {
    return fmt.Sprintf("value=%d", x)
}
```

`fmt.Sprintf` allocates. The benchmark will show `> 0 allocs/op`. The
fix using `strconv` and a pre-sized `bytes.Buffer` or
`strings.Builder`:

```go
func format(x int) string {
    var b strings.Builder
    b.Grow(16)
    b.WriteString("value=")
    b.WriteString(strconv.Itoa(x))
    return b.String()
}
```

This may still allocate (the returned string), but the count drops and
the per-op time falls. A benchstat run before/after will show both
numbers move.

A team policy worth adopting: in PR review, the allocs/op column is
*required* reading. The reviewer should be able to point to it and
say either "this is unchanged" or "this dropped/grew because…". A PR
that changes alloc count without explanation gets a "please justify"
comment. Over time this discipline catches a huge fraction of latency
regressions that would otherwise reach prod.

## 9. The role of `-cpu`

`-cpu=1,2,4,8` re-runs each benchmark at those GOMAXPROCS values. This
is essential for benchmarks that contain parallelism (channels,
mutexes, goroutines). For purely serial code it is wasted time. As a
junior, default to `-cpu=1` for serial work and revisit later when you
have a parallel function to measure.

For a benchmark of `sync.Mutex` contention, `-cpu=1,2,4,8,16` reveals
the scaling curve: at one CPU there is no real contention, at higher
counts the mutex becomes a bottleneck. The slope of the curve tells
you about the lock's quality (a fair mutex degrades gracefully; an
unfair one collapses past some thread count).

Output for a parallel benchmark looks like:

```
BenchmarkMutexContended-1     1000000     105 ns/op
BenchmarkMutexContended-2      800000     310 ns/op
BenchmarkMutexContended-4      400000     820 ns/op
BenchmarkMutexContended-8      200000    1900 ns/op
```

Notice the per-op time grows almost linearly with CPU count: that is
near-total serialisation. A good lock would show sub-linear growth.

## 10. The minimum CLI you must memorise

```
go test -bench=. -benchmem -count=10 -cpu=1 -benchtime=1s ./...
```

This says: run every benchmark in every package under the cwd, report
allocations, take 10 samples, single CPU, 1 second per sample. The
output piped to a file plus `benchstat` against a baseline is enough
rigor for almost any PR-sized change. The further chapters add tools
for the cases where this is not enough.

For a more thorough baseline:

```
go test -bench=. -benchmem -count=20 -cpu=1 -benchtime=2s -timeout=30m ./...
```

Doubles the samples, doubles the per-sample time, and extends the
overall timeout for slow packages. Twenty minutes of bench time for
the suite is reasonable nightly homework on a developer machine.

## 11. Saving a baseline in git

Convention: keep a `bench/baseline.txt` in your repo with the canonical
output of the suite as of the last release tag. Re-run the suite before
merging any perf-sensitive PR and benchstat against it. This is the
cheapest possible CI: no infrastructure, full history, easily
auditable.

```
go test -bench=. -benchmem -count=10 ./... > /tmp/now.txt
benchstat bench/baseline.txt /tmp/now.txt
```

If you maintain the baseline file in git you also get the property
that `git blame` tells you *who* moved each number. A useful
companion file is `bench/baseline-fixture.txt` describing the machine
on which the baseline was collected: CPU, OS, Go version, GOGC,
GOMEMLIMIT, whether SMT was on. Without this fixture the baseline is
unreproducible.

Update the baseline only when:

- A new release tag is cut.
- An intentional perf-improving change has merged and you want
  future PRs measured against the improved number.
- The machine on which the baseline was collected has changed (write
  a small migration note).

Do not update the baseline silently. Treat the baseline as a number
guarded by code review.

## 12. Sub-benchmarks with `b.Run`

A single `BenchmarkX` can host many sub-benchmarks via `b.Run`:

```go
func BenchmarkLookup(b *testing.B) {
    for _, n := range []int{10, 100, 1000, 10000} {
        b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
            m := buildMap(n)
            keys := buildKeys(n)
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                sink = m[keys[i%len(keys)]]
            }
        })
    }
}
```

The output:

```
BenchmarkLookup/N=10-1        100000000     10.5 ns/op
BenchmarkLookup/N=100-1       100000000     11.2 ns/op
BenchmarkLookup/N=1000-1       50000000     22.4 ns/op
BenchmarkLookup/N=10000-1      30000000     45.1 ns/op
```

The shape of the table is more informative than any single number.
You can see that lookup is constant up to ~100 keys (everything in
L1), starts growing past 1k (out of L1), and is dominated by cache
effects at 10k.

benchstat handles sub-benchmarks the same way as top-level ones — it
matches on the full name (`BenchmarkLookup/N=1000-1`). You can compare
two implementations across all the sub-cases with a single command.

## 13. Common junior mistakes (with fixes)

A short catalogue of mistakes I have seen in PRs from juniors who
read only the bench docs:

**Mistake**: putting the benchmark in the package being benchmarked
and importing unexported state. **Fix**: use `package x_test`.

**Mistake**: writing `b.N` as a constant input to a helper. **Fix**:
`b.N` is the loop bound; pass `i` if you need variability.

**Mistake**: using `t := time.Now(); ...; b.Log(time.Since(t))`.
**Fix**: that double-counts because `b.N` already times it. Use
`b.ReportMetric` if you need a custom metric.

**Mistake**: running the benchmark with `go run`. **Fix**: benchmarks
require `go test`.

**Mistake**: trusting a single `-count=1` run. **Fix**: `-count=10`
minimum; use benchstat.

**Mistake**: comparing `-count=1` results "by eye". **Fix**: eyes
are bad at distinguishing signal from noise; always use benchstat.

**Mistake**: forgetting `b.ResetTimer()` after setup. **Fix**: muscle
memory — every benchmark has a setup block ending in `b.ResetTimer()`.

**Mistake**: leaving `b.StopTimer/b.StartTimer` in a hot inner loop
where the call costs more than the work. **Fix**: pre-allocate.

**Mistake**: benchmarking with race detector on (`-race`). **Fix**:
race detector slows code by 5-10x; never benchmark with it.

## 14. Reading the framework source

You learn a lot by reading `src/testing/benchmark.go` in the Go
source. Key entry points: `func (b *B) launch()` is the loop that
calls your function with growing `b.N`; `func (b *B) run1()` is the
1-iteration warmup; `func (b *B) ReportMetric(v float64, unit string)`
is how custom metrics get into the output.

An afternoon spent reading this file is more valuable than ten blog
posts. The framework is small (under 1500 lines) and the logic that
chooses `b.N` is in one function (`launch`). Read it once.

## 15. The mental model going forward

The junior mental model can be reduced to four rules:

1. Defeat the compiler with a real input and a real sink.
2. Take 10 samples, not 1.
3. Compare with benchstat, not with eyes.
4. Watch `allocs/op` even more than `ns/op`.

The middle, senior, and professional pages build on this — statistical
depth, machine state, toolchain interactions, organisational
discipline. But the four rules above will keep you out of 80% of
beginner traps even if you read nothing else.

A fifth rule, less mechanical: be honest about what your benchmark
measures. If you cannot say in one sentence what *production* question
your benchmark answers, the benchmark is decorative. Many beginner
benches measure operations that no production path triggers at scale.
That is fine for learning; bad for guiding PRs.

## 16. A worked example end-to-end

You inherit this code from a teammate and want to know if it is fast:

```go
package id

import "fmt"

func New(prefix string, n int) string {
    return fmt.Sprintf("%s-%d", prefix, n)
}
```

Step 1: write a benchmark.

```go
package id_test

import (
    "testing"

    "example.com/id"
)

var sinkStr string

func BenchmarkNew(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        sinkStr = id.New("user", i)
    }
}
```

Step 2: run it.

```
$ go test -bench=. -count=10 -benchmem
BenchmarkNew-8  10000000   125 ns/op   24 B/op   2 allocs/op
... (nine more lines, similar) ...
```

Step 3: notice 2 allocs/op. One is the result string; what is the
other? Read `fmt.Sprintf`: it allocates a `*pp` (its printer state)
unless a pool gives it one. There is a pool internally but the
`*pp.fmtInteger` path may still escape. Either way the count is too
high for a hot path.

Step 4: rewrite to bypass `fmt`.

```go
func New(prefix string, n int) string {
    return prefix + "-" + strconv.Itoa(n)
}
```

Step 5: rerun and compare.

```
$ go test -bench=. -count=10 -benchmem > new.txt
$ benchstat old.txt new.txt
name    old time/op    new time/op    delta
New-8   125ns ± 2%     55ns ± 3%      -56.00%  (p=0.000 n=10+10)

name    old alloc/op   new alloc/op   delta
New-8   24.0B ± 0%     16.0B ± 0%     -33.33%  (p=0.000 n=10+10)

name    old allocs/op  new allocs/op  delta
New-8   2.00 ± 0%      1.00 ± 0%      -50.00%  (p=0.000 n=10+10)
```

Conclusion: 56% faster, half the allocations. Now you write this up
in the PR description with the benchstat output verbatim, and the
reviewer can audit your claim. This is the workflow you will repeat
hundreds of times in your career.

Step 6: sanity-check correctness. A faster string builder that
returns the wrong value is worse than a slow correct one. Add a unit
test that checks both implementations produce identical output on a
range of inputs. Always pair a benchmark with a correctness test.

## 17. When NOT to benchmark

Benchmarks have a cost: writing them, reading their output, debating
their meaning. They are an investment with diminishing returns. Some
heuristics for when to skip:

- The function is called once per process startup. Optimising it saves
  microseconds total. Skip.
- The function is a thin wrapper over the standard library. The
  standard library has been benchmarked exhaustively. Skip.
- The function is dominated by an external call (DB, network). You
  are measuring the external system, not your code. Skip; write an
  integration test instead.
- The function is a one-off script. Performance is irrelevant. Skip.

When TO benchmark:

- The function is on a hot path (called millions of times per second
  in prod).
- You are choosing between two implementations and need data.
- A regression was reported and you need to localise it.
- The function appears in a flame graph from production.
- You are refactoring a hot path and need to ensure no regression.

A bias toward over-benchmarking is common in juniors who just
learned the tool. A bias toward under-benchmarking is common in
seniors who got burned. The middle ground is "benchmark what is in
the profile."

## 18. Pairing benchmarks with profiles

A benchmark tells you "this function takes X ns/op." A profile tells
you "this function is Y% of total CPU." You need both. If a function
is 50% of CPU and takes 100ns, halving it to 50ns saves you 25% total
CPU — huge. If a function is 0.1% of CPU and takes 100ns, halving it
saves 0.05% total CPU — negligible.

Collect a profile on a representative workload:

```
go test -bench=. -cpuprofile=cpu.pprof
go tool pprof -top -cum cpu.pprof | head -20
```

The top function in `-cum` is where to spend your benchmark effort.
Benchmarking anything else is premature optimisation by the strict
Knuth definition.

## 19. The bench file as documentation

A well-written bench file documents the performance characteristics
of your package. Future readers — including you in six months — read
it to learn:

- What inputs are typical (the `for _, size := range ...` ranges).
- What operations are hot (which functions have benches).
- What the historical numbers were (via git log on the file).

Treat the bench file as a first-class doc. Add comments explaining
why each benchmark exists, what hypothesis it tests, what regression
it would catch. A bench file with no comments is half-useful; a
commented one is teaching material.

## 20. Glossary

- **b.N** — the loop count chosen by the framework.
- **ns/op** — nanoseconds per iteration, the canonical bench output.
- **allocs/op** — heap allocations per iteration.
- **B/op** — heap bytes per iteration.
- **sink** — a package-level variable that consumes return values to
  defeat dead-code elimination.
- **GOMAXPROCS** — the number of OS threads Go will use for user
  goroutines; shown as the `-N` suffix on bench names.
- **benchmem** — the flag that enables alloc reporting.
- **benchtime** — the target wall-clock time per measurement.
- **benchstat** — the tool that statistically compares two bench runs.
- **escape analysis** — the compiler's decision about whether a value
  must be on the heap.
- **inlining** — replacing a call with the callee's body inline at
  the call site.
- **noise floor** — the largest delta a benchmark shows when nothing
  changed; numbers smaller than this cannot be trusted.
- **p-value** — the probability of observing the data under the null
  hypothesis (no real effect).
- **sub-benchmark** — a child benchmark created with `b.Run(name, f)`,
  used to parametrise the same logic.

Memorise these terms; they are the vocabulary of every Go performance
conversation. A senior reviewer will use them without explanation; if
you do not know what they mean, the review will go past you.

## 21. Reading recommendations

- The `testing` package godoc, end-to-end. About 30 minutes.
- `golang.org/x/perf/cmd/benchstat` README and the linked
  documentation. About 20 minutes.
- The Go release notes for the last three minor versions, focusing on
  the "compiler" and "runtime" sections. About 30 minutes per
  release.
- The `runtime/metrics` godoc, just to know what is available. About
  15 minutes.
- One real performance postmortem from a public blog (Cloudflare,
  Discord, Dropbox have published several). About 30 minutes each.

That is about 4 hours of focused reading. After it, you will not be
a senior but you will be ready to read the middle page of this
chapter without feeling lost.

## 22. Sub-benchmark parametric exploration

A pattern that pays off the first time you do it: parametrise a
benchmark by input size and let the table tell you the shape.

```go
func BenchmarkConcat(b *testing.B) {
    for _, parts := range []int{2, 4, 8, 16, 64, 256} {
        for _, partLen := range []int{4, 64, 1024} {
            name := fmt.Sprintf("parts=%d/len=%d", parts, partLen)
            b.Run(name, func(b *testing.B) {
                in := make([]string, parts)
                for i := range in {
                    in[i] = strings.Repeat("a", partLen)
                }
                b.ResetTimer()
                for i := 0; i < b.N; i++ {
                    sink = concat(in)
                }
            })
        }
    }
}
```

Output:

```
BenchmarkConcat/parts=2/len=4-8         200000000     6.5 ns/op
BenchmarkConcat/parts=2/len=64-8        100000000    12.4 ns/op
BenchmarkConcat/parts=2/len=1024-8       50000000    24.2 ns/op
BenchmarkConcat/parts=4/len=4-8         100000000    10.1 ns/op
BenchmarkConcat/parts=4/len=64-8         80000000    18.9 ns/op
BenchmarkConcat/parts=4/len=1024-8       30000000    62.0 ns/op
BenchmarkConcat/parts=8/len=4-8          80000000    18.3 ns/op
... etc.
```

Now you can see: time grows roughly with total bytes, not with parts
count, suggesting the implementation is byte-bound and the per-part
overhead is small. A different implementation might show the
opposite. Either way, the parametric table is more informative than
six unrelated numbers.

## 23. The `BenchmarkParallel` shape

For testing parallel code:

```go
func BenchmarkAtomicAdd(b *testing.B) {
    var counter int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            atomic.AddInt64(&counter, 1)
        }
    })
}
```

`RunParallel` spawns `GOMAXPROCS` goroutines and each calls the body
in a loop. `pb.Next()` distributes iterations across them. The
benchmark reports per-iteration time *as seen by the parallel
workers*, which is the right metric for contended primitives.

Important: a contended atomic measured this way will look slower at
higher GOMAXPROCS because of cache-line bouncing. Run with
`-cpu=1,2,4,8` to see the scaling curve.

## 24. The cost of `time.Now()`

If you ever add manual timing to a benchmark, you must know what
`time.Now()` itself costs. On x86-64 Linux it is around 25ns (uses
the VDSO `gettimeofday` fast path). On Windows it is higher
(QueryPerformanceCounter, around 50-100ns). On ARM macOS it is
around 20ns.

If your benchmark body itself runs in 5ns, wrapping it in
`time.Now()` calls produces a measurement that is 80% timer overhead
and 20% your code. The fix is to *batch*: time 1000 iterations at a
time, not one.

```go
const batch = 1000
batches := b.N / batch
b.ResetTimer()
for i := 0; i < batches; i++ {
    t0 := time.Now()
    for j := 0; j < batch; j++ {
        sink = work(j)
    }
    samples[i] = time.Since(t0) / batch
}
```

Now timer overhead is 25ns / 1000 = 0.025ns per work iteration —
invisible.

## 25. The benchmark file checklist

Before you ask anyone to review a benchmark, run this mental
checklist:

- [ ] Package is `xxx_test`, not `xxx`.
- [ ] Setup is outside `b.ResetTimer()`.
- [ ] Inputs vary per iteration (no constant folding).
- [ ] Return values feed a package-level sink.
- [ ] `b.ReportAllocs()` is set or `-benchmem` is in the run command.
- [ ] A unit test exists that proves the function is correct.
- [ ] You can answer "what production question does this answer?"
- [ ] You ran `-count=10` minimum.
- [ ] You compared with benchstat, not by eye.
- [ ] The machine state (laptop, CI, server) is documented in the
      PR description.

A clean ten-out-of-ten on this list does not guarantee a correct
benchmark, but a fail on any item is grounds for the reviewer to
request changes. Save yourself the round trip; check before
publishing.

## 26. Two benchmarks side by side — a worked diff

A common scenario: you wrote a function two different ways and want
data on which is better. Worked example: encode a struct to bytes.

Version A uses `encoding/json`:

```go
package enc

import "encoding/json"

type Event struct {
    ID   string `json:"id"`
    Type string `json:"type"`
    Body string `json:"body"`
}

func MarshalJSON(e Event) ([]byte, error) {
    return json.Marshal(e)
}
```

Version B uses a hand-written encoder:

```go
func MarshalManual(e Event) []byte {
    n := len(`{"id":"","type":"","body":""}`) +
        len(e.ID) + len(e.Type) + len(e.Body)
    out := make([]byte, 0, n)
    out = append(out, `{"id":"`...)
    out = append(out, e.ID...)
    out = append(out, `","type":"`...)
    out = append(out, e.Type...)
    out = append(out, `","body":"`...)
    out = append(out, e.Body...)
    out = append(out, `"}`...)
    return out
}
```

The benchmark file:

```go
package enc_test

import (
    "testing"

    "example.com/enc"
)

var sinkB []byte

var ev = enc.Event{
    ID:   "abc-123",
    Type: "click",
    Body: "user clicked the green button on the third panel",
}

func BenchmarkMarshalJSON(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        sinkB, _ = enc.MarshalJSON(ev)
    }
}

func BenchmarkMarshalManual(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        sinkB = enc.MarshalManual(ev)
    }
}
```

Run:

```
$ go test -bench=Marshal -count=10 -benchmem > out.txt
$ benchstat -filter ".name:/MarshalJSON/" out.txt
$ benchstat -filter ".name:/MarshalManual/" out.txt
```

Or, to compare them as if they were before/after, you can name them
identically and run from different files, or simply read both rows
and divide.

Typical output:

```
BenchmarkMarshalJSON-8    2000000     780 ns/op    320 B/op   2 allocs/op
BenchmarkMarshalManual-8 10000000     105 ns/op    128 B/op   1 allocs/op
```

The manual version is 7.4x faster and allocates half as much. Whether
this is worth the maintenance cost of hand-written encoders is a
*judgement call*, not a benchmark result. If this is on the hot path
of a 100k QPS service, save the 670ns. If this is called once per
request on a 100 QPS service, do not bother. Benchmarks give you
data; engineering judgement decides what to do with it.

## 27. The first time you read a flame graph

Eventually a benchmark will surprise you and you will need a profile.
Collect one:

```
$ go test -bench=BenchmarkMarshalJSON -cpuprofile=cpu.pprof -count=1 -benchtime=10s
$ go tool pprof -http=:6060 cpu.pprof
```

The browser opens. Click "Flame Graph" in the upper-left dropdown.
You see a wide rectangle at the bottom labelled `runtime.main`. Above
it, narrower rectangles for each function the bottom function called.
Above each of those, the functions *they* called. The width of a
rectangle is the time spent in that function and its callees.

For our `MarshalJSON` benchmark you will see:

- A wide block for `runtime.mallocgc` (the allocator).
- A wide block for `reflect.Value.MapKeys` or similar reflection.
- Smaller blocks for the actual encoding logic.

The blocks tell you where time goes. If reflection is 40% of the
flame, that is your optimisation target. If allocation is 30%, you
need to reduce allocs/op. If actual encoding is 20%, the room to
optimise is bounded by 20% of total time.

Reading flame graphs is a learned skill; the first one is
overwhelming, the tenth is fast. Practice on benchmarks where you
already know the bottleneck so you can calibrate the visual.

## 28. Test data realism

A benchmark on `strings.ToUpper("hello")` measures the function on a
5-character ASCII input. Production may pass 200-character
Unicode-rich input. The two regimes have *different cost curves*
because `strings.ToUpper` allocates differently for short ASCII (no
allocation, in-place possible) vs long Unicode (full allocation, rune
decode).

A bench file for `strings.ToUpper` should include at minimum:

- A short ASCII input.
- A long ASCII input.
- A short Unicode input.
- A long Unicode input.

Each as a sub-benchmark via `b.Run`. The output table then shows
*four* numbers, and you can see whether your optimisation helped all
four or only one. Many "improvements" turn out to optimise the
common case at the cost of the rare one; only the parametric table
reveals this.

## 29. Avoid the JSON pretty-print trap

A benchmark that ends with:

```go
fmt.Println(result)
```

…in the body is a benchmark of `fmt.Println`. The work you intended
to measure is dwarfed by stdout I/O. This sounds obvious but I have
seen it in junior PRs at least three times.

The general principle: anything you do *inside* the timed loop is
measured. The framework cannot read your mind. If you want to print
for debugging, print *outside* the loop or guard with `if testing.Verbose()`.

## 30. Avoiding the dependency-on-clock-resolution trap

Some Go versions on some OSes round `time.Now()` to nearest microsecond.
A `b.N` of 1, where the body takes 200ns, may report `0 ns/op` or
`1000 ns/op` depending on whether the clock ticked during the call.
The framework guards against this by growing `b.N` until elapsed
time is comfortably above the clock resolution, but if you wrote a
custom timing harness *you* must guard against it.

Rule: never time something that takes less than 1µs in isolation.
Batch it.

## 31. Comparing your benchmark to standard library benchmarks

The Go source tree contains thousands of benchmarks under
`src/.../bench_test.go`. They are written by the people who designed
the standard library, and reading them is the fastest way to
internalise idiom. Examples to read:

- `src/bytes/bytes_test.go` — the `BenchmarkIndex*` family is a
  master class in parametric benchmark design.
- `src/encoding/json/bench_test.go` — shows how to benchmark
  marshal/unmarshal with realistic input data.
- `src/runtime/map_test.go` — benchmarks the map type, including
  contention scenarios.
- `src/sort/sort_test.go` — benchmarks the sort algorithms across
  multiple input distributions.

After reading any one of these end to end, your own benchmarks will
improve. The idioms are dense; the comments are minimal; the
discipline is high. Soak it up.

## 32. Cross-platform considerations

A benchmark on macOS arm64 (Apple Silicon), Linux amd64 (server),
and Windows amd64 (CI) can give very different numbers for the same
code. Reasons:

- Different CPU architectures (ARM vs x86) have different cache
  sizes, instruction latencies, branch predictors.
- Different schedulers (XNU vs Linux vs NT) have different overheads.
- Different memory allocators (Go uses the same TC-malloc-derived
  allocator everywhere, but the underlying mmap behaviour differs).
- Different clock resolution.

Pick *one* platform as the reference for any published number, and
state it. Comparing macOS dev numbers to Linux prod numbers is
apples to oranges. If your prod is Linux amd64, do your gating on
Linux amd64. Use other platforms for development convenience only.

## 33. Reporting numbers in a PR

A good PR description has a section called "Performance" that
contains, in order:

1. The hypothesis ("this change should reduce p99 of /api/foo").
2. The fixture (hardware, Go version, flags).
3. The benchstat output (verbatim, in a code block).
4. The conclusion in one sentence ("the change reduces median by
   23%, p99 by 38%, allocs by 50%, with p < 0.001").

A reviewer reading this can decide in 30 seconds whether to dig in.
A PR with just "made it faster" requires the reviewer to re-do the
measurement, which most reviewers will not bother with — they will
either trust you blindly or block you. Neither is what you want.

## 34. The `-run=^$` flag, often overlooked

When running benchmarks you usually do not want unit tests to run
too — they slow the loop and may pollute output. The idiom:

```
go test -bench=. -run=^$ -benchmem ./...
```

`-run=^$` means "match no test function", because nothing matches
an empty-string regex anchored at both ends. The result is "tests
skipped, benchmarks run." Make this part of your muscle memory; it
saves seconds per invocation and a lot of confusion when a flaky
test makes a bench run look broken.

The opposite — running both tests and benchmarks — is good as a
correctness pre-flight. Run tests first to be sure the code works,
*then* run benches:

```
go test ./... && go test -bench=. -run=^$ ./...
```

## 35. Benchmark naming conventions

A benchmark name like `BenchmarkProcess` tells you nothing. Names
should be self-documenting:

- `BenchmarkProcessSmall` / `BenchmarkProcessLarge` for size variants.
- `BenchmarkProcessHot` / `BenchmarkProcessCold` for cache variants.
- `BenchmarkProcessSerial` / `BenchmarkProcessParallel` for
  concurrency variants.
- Sub-bench names like `BenchmarkProcess/size=1024/format=json`.

A good name lets a reader who has never opened the source guess
what the benchmark measures. A bad name forces them to read the
code. Reader time is more expensive than your typing time; spend
the keystrokes on names.

## 36. The `b.ReportMetric` first encounter

You may need to report a custom number from a benchmark. The API:

```go
func BenchmarkCustom(b *testing.B) {
    var totalCmps int64
    for i := 0; i < b.N; i++ {
        cmps := countCompares(input)
        totalCmps += int64(cmps)
    }
    b.ReportMetric(float64(totalCmps)/float64(b.N), "compares/op")
}
```

The output adds a column:

```
BenchmarkCustom-8    1000000   125 ns/op   12.4 compares/op
```

`compares/op` is custom. benchstat understands the format and will
compare it across runs. The `/op` suffix tells the framework "divide
this by `b.N` for display" — that arithmetic is already done by the
code, so the unit string is just labelling.

Use this for any metric that the default columns do not capture:
retry counts, cache hits, branch mispredictions (if you have a way
to measure them).

## 37. Closing

Benchmarks are easy to write and hard to write well. The bar to
"runs" is `go test -bench .`. The bar to "tells you the truth" is
everything above. As a junior your job is to clear the truth bar on
your own benchmarks before asking anyone to act on them. Do that
consistently and the seniors on your team will trust your numbers,
which is the precondition for being trusted with performance-
sensitive code.

A final word of caution: do not become the person who has a strong
opinion about benchmarks but no production scars. Run your code in
prod, watch its metrics, then come back and ask "do my benchmarks
predict what I see?" If yes, you have a good bench suite. If no,
the suite is decorative. The feedback loop from prod to bench is
how you stop fooling yourself.

The next page (middle) covers statistical depth, machine state
control, and the toolchain interactions that separate a measurement
from a guess. Move on when the four rules at the top of this page
feel automatic, not when you have memorised them.

[← Back](../)
