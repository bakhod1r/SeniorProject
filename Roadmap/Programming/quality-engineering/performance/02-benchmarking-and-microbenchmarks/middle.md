# Benchmarking and Microbenchmarks — Middle Level

> **Roadmap:** [Performance](../README.md) → Benchmarking and Microbenchmarks
> *The junior page taught you to time a loop. This page is about the half-dozen ways that loop lies to you — the compiler deleting your code, the JIT not having warmed up, the setup cost leaking into the measurement — and the mechanics every honest benchmark uses to defeat them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Dead-Code Elimination — Why the Compiler Deletes Your Benchmark](#dead-code-elimination--why-the-compiler-deletes-your-benchmark)
4. [Constant Folding and Loop Hoisting — Measuring Nothing N Times](#constant-folding-and-loop-hoisting--measuring-nothing-n-times)
5. [Warm-Up and the JIT — Interpreter → C1 → C2](#warm-up-and-the-jit--interpreter--c1--c2)
6. [How `testing.B` Auto-Scales `b.N`](#how-testingb-auto-scales-bn)
7. [Isolating the Thing Under Test — Timers and Allocs](#isolating-the-thing-under-test--timers-and-allocs)
8. [Throughput vs Latency — Two Different Numbers](#throughput-vs-latency--two-different-numbers)
9. [Worked Example — Comparing Two Runs with benchstat](#worked-example--comparing-two-runs-with-benchstat)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I write a benchmark whose number means what I think it means?**

A benchmark is an experiment, and like any experiment it can be silently invalid. The junior page got you to a working `func BenchmarkX(b *testing.B)` and a number in nanoseconds. The trouble is that an *optimizing compiler and a JIT are actively trying to make your benchmark fast in ways that have nothing to do with your real workload* — and several of those ways produce a number that is real, reproducible, and completely wrong.

This page covers the mechanics that separate a benchmark from a number generator: **dead-code elimination** (the compiler proving your result is unused and deleting the work), **constant folding and loop hoisting** (computing the answer once at compile time, or once outside the loop), **JIT warm-up** (HotSpot runs your code interpreted, then C1-compiled, then C2-compiled — three different speeds), and the harness machinery — `b.N` auto-scaling, `b.ResetTimer`, `b.ReportAllocs`, JMH's `Blackhole`, Rust's `black_box` — that exists *specifically* to defeat these. We finish with `benchstat`, the tool that tells you whether a 4% improvement is real or noise.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can write a basic `testing.B` loop and run `go test -bench`.
- **Required:** You understand "the compiler optimizes" at a hand-wave level (inlining, removing unused variables).
- **Helpful:** Exposure to a JIT-compiled runtime (JVM, V8) or an AOT one (Go, Rust, C++).
- **Helpful:** A passing familiarity with mean / median / standard deviation.

---

## Dead-Code Elimination — Why the Compiler Deletes Your Benchmark

Here is the single most common way a microbenchmark lies. You write:

```go
func BenchmarkPopcount(b *testing.B) {
    for i := 0; i < b.N; i++ {
        bits.OnesCount64(0xDEADBEEF) // result thrown away
    }
}
```

`bits.OnesCount64` has no side effects, and its result is never used. The compiler's reasoning is airtight: *a pure function whose result is discarded can be deleted entirely.* So it deletes the call. Your loop body becomes empty. You will measure the cost of an empty loop — perhaps `0.30 ns/op` — and conclude popcount is free. It is not; you measured nothing.

This is **dead-code elimination (DCE)**, and it is not a bug — it is the compiler doing exactly its job. The fix is to make the result *observably used* so the compiler can't prove it's dead. Every benchmark framework provides a tool for this, called a **sink** or **blackhole**.

**Go** — assign to a package-level variable the compiler can't reason about:

```go
var sink uint64 // package-level: compiler must assume it's read elsewhere

func BenchmarkPopcount(b *testing.B) {
    var s uint64
    for i := 0; i < b.N; i++ {
        s += bits.OnesCount64(uint64(i)) // depends on i, accumulated
    }
    sink = s // publish — now the work cannot be eliminated
}
```

Two defenses combine here: the input `uint64(i)` *varies* (so the result can't be precomputed), and the accumulated `s` is *published* to `sink` (so the work can't be discarded). Modern Go also offers `b.Loop()` (Go 1.24+), which keeps the loop variable and inputs alive automatically — but understanding *why* the sink is needed beats trusting magic.

**Java (JMH)** — return the value, or feed it to a `Blackhole`. JMH consumes returned values for you:

```java
@Benchmark
public int popcount() {
    return Integer.bitCount(0xDEADBEEF); // JMH consumes the return value
}

@Benchmark
public void popcountMany(Blackhole bh) {
    for (int i = 0; i < 1000; i++) {
        bh.consume(Integer.bitCount(i)); // explicitly sink each result
    }
}
```

`Blackhole.consume` is engineered so the JIT cannot prove the value is dead, *and* so the sinking itself is nearly free — it's not just `volatile` (which would dominate the measurement).

**Rust (criterion)** — wrap the value in `black_box`, which is an optimization barrier:

```rust
use criterion::{black_box, Criterion};

fn bench_popcount(c: &mut Criterion) {
    c.bench_function("popcount", |b| {
        b.iter(|| black_box(0xDEADBEEFu64).count_ones())
    });
}
```

`black_box(x)` tells the compiler "assume something opaque might read or write `x`," forcing both the input to be treated as unknown (defeats constant folding) and the result to be treated as used (defeats DCE).

> **Key insight:** A microbenchmark with no sink is measuring the compiler's ability to delete your code, not your code's speed. The tell-tale sign is a result that's *suspiciously fast and suspiciously round* — sub-nanosecond, or identical across inputs that should differ. If `b/op` looks like an empty loop, your benchmark was eliminated.

---

## Constant Folding and Loop Hoisting — Measuring Nothing N Times

DCE deletes work whose *result* is unused. Two cousins delete work whose *inputs* are known.

**Constant folding** computes the answer at *compile time* when all inputs are constants. `Integer.bitCount(0xDEADBEEF)` has a constant argument — a sufficiently aggressive compiler folds it to the literal `24` and never runs the algorithm at runtime. That's why the Go fix above uses `uint64(i)`: a value the compiler can't know until the loop runs.

**Loop-invariant code motion (hoisting)** moves a computation that doesn't depend on the loop variable *out* of the loop, running it once instead of `b.N` times:

```go
// BROKEN: hash(data) doesn't depend on i → hoisted out of the loop
func BenchmarkHash(b *testing.B) {
    data := makePayload()
    for i := 0; i < b.N; i++ {
        sink = hashU64(data) // same input every iteration → computed once
    }
}
```

The compiler sees `hashU64(data)` produces the same value every iteration and lifts it out. You run it once and loop over the cached result. Your `ns/op` will be near zero and *will not scale with payload size* — a dead giveaway.

The cure is the same principle as DCE: **make each iteration depend on the loop variable**, so no iteration is redundant.

```go
func BenchmarkHash(b *testing.B) {
    payloads := makePayloads(1024) // a slab of distinct inputs
    var s uint64
    for i := 0; i < b.N; i++ {
        s ^= hashU64(payloads[i%len(payloads)]) // varies per iteration
    }
    sink = s
}
```

> **Key insight:** DCE, constant folding, and hoisting are one family — the compiler removing work it can *prove* is redundant. You defeat all three with the same two habits: feed inputs the compiler can't know (vary with the loop index), and publish outputs the compiler can't ignore (sink them). Do both, every time, by reflex.

---

## Warm-Up and the JIT — Interpreter → C1 → C2

On an AOT-compiled language (Go, Rust, C++) the machine code is fixed before the program runs, so "warm-up" mostly means filling caches and the branch predictor. On a JIT runtime — the JVM above all — your code runs at *several different speeds during one execution*, and benchmarking the wrong phase gives you a number off by 10–50×.

HotSpot executes a Java method through three tiers:

1. **Interpreter** — bytecode is interpreted directly. Slow, but starts instantly. Every method begins here.
2. **C1 (client compiler)** — once a method is called enough times (default ~1,500–2,000 invocations), C1 compiles it to native code with light optimization. Fast to compile, moderately fast code.
3. **C2 (server compiler)** — after more invocations (~10,000) C2 recompiles the *hot* methods with aggressive optimization: inlining, loop unrolling, escape analysis, speculative devirtualization. This is your steady-state speed.

If you time the first few iterations, you're benchmarking the interpreter. Worse, C2 makes *speculative* optimizations based on observed behavior, and if a never-before-seen branch fires later, it **deoptimizes** — bails back to the interpreter and recompiles — causing a transient slowdown mid-benchmark.

This is the entire reason JMH exists. You never hand-roll a JVM benchmark loop, because you cannot account for tiered compilation by hand. JMH runs explicit warm-up iterations (discarded) before measurement iterations:

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1)      // 5 discarded 1s iterations → reach C2
@Measurement(iterations = 10, time = 1) // 10 measured 1s iterations
@Fork(2)                                // 2 fresh JVMs: defeat profile pollution
@State(Scope.Thread)
public class HashBenchmark {
    private byte[] data;

    @Setup public void setup() { data = makePayload(4096); }

    @Benchmark
    public long hash() { return hashU64(data); } // returned → no DCE
}
```

`@Fork` matters more than it looks: a single JVM accumulates profiling data, so benchmark A can bias the JIT's decisions for benchmark B run in the same process. Forking gives each benchmark a clean JVM. `@Warmup` ensures C2 has kicked in before the stopwatch starts.

> **Key insight:** On a JIT runtime, "how fast is this code?" has no single answer — it depends on which compilation tier is running. A benchmark's job is to measure *steady state* (post-C2), which means discarding warm-up. The number you want is the asymptote, not the cold start — unless cold start *is* your concern (e.g. serverless), in which case you measure that deliberately and separately.

---

## How `testing.B` Auto-Scales `b.N`

Go's `testing.B` solves a timing problem you'd otherwise solve by hand: how many iterations do you need for a stable measurement? Run an operation that takes 5 ns just once and the clock's own resolution (tens of ns) swamps the result. You need to run it *millions* of times and divide.

The harness does this adaptively. It runs your benchmark function with a small `b.N` (e.g. 1), measures wall time, and if the total was too short to be trustworthy it *increases `b.N` and reruns the whole function*, repeating until the run lasts about `-benchtime` (default 1 second). Then it reports `total_time / b.N` as `ns/op`.

```go
func BenchmarkEncode(b *testing.B) {
    payload := makePayload(1024) // setup runs ONCE per b.N value, not per iteration
    b.ResetTimer()               // zero the clock — exclude setup above
    for i := 0; i < b.N; i++ {
        sink = len(encode(payload))
    }
}
```

The critical consequence: **your benchmark function is called repeatedly with growing `b.N`**, and everything *outside* the `for` loop runs once per call. That's why expensive setup needs `b.ResetTimer()` (below) — otherwise its cost is amortized over `b.N` inconsistently across the scaling runs and pollutes the per-op number.

Run it and Go reports the auto-scaled count:

```
BenchmarkEncode-8     2483418      482.6 ns/op      512 B/op       3 allocs/op
                  │         │            │             │              │
            GOMAXPROCS   b.N chosen   per-op time   bytes/op    allocations/op
```

The `2483418` is the `b.N` the harness settled on to fill ~1 second. You don't pick it; you trust it — but you *do* need to keep per-iteration work consistent so dividing by `b.N` is meaningful.

---

## Isolating the Thing Under Test — Timers and Allocs

A benchmark measures everything between "start clock" and "stop clock." If that span includes setup, teardown, or I/O you didn't mean to measure, your number is contaminated. Go gives you three controls.

**`b.ResetTimer()`** — discard everything timed so far. Use it after one-time setup:

```go
func BenchmarkQuery(b *testing.B) {
    db := openAndSeed()  // expensive, not what we're measuring
    b.ResetTimer()       // forget that time + any allocs from setup
    for i := 0; i < b.N; i++ {
        sink2 = db.Get(i % 1000)
    }
}
```

**`b.StopTimer()` / `b.StartTimer()`** — pause the clock for *per-iteration* setup that can't be hoisted out:

```go
func BenchmarkSort(b *testing.B) {
    for i := 0; i < b.N; i++ {
        b.StopTimer()
        data := freshUnsortedSlice(10000) // must rebuild each iter — sort mutates
        b.StartTimer()
        sort.Ints(data)                   // only THIS is timed
    }
}
```

Use this sparingly: `StopTimer`/`StartTimer` have overhead, and if the paused work dwarfs the measured work, the timer-toggle cost itself becomes noise. When per-iteration setup is heavy, prefer pre-building a slab of inputs before the loop.

**`b.ReportAllocs()`** — add allocation columns (`B/op`, `allocs/op`) to the output. Allocations are often the real story behind a slow hot path, because each one is future GC work:

```go
func BenchmarkBuild(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        sink2 = strings.Join([]string{"a", "b", "c"}, "-")
    }
}
// BenchmarkBuild-8  18234561  64.1 ns/op  16 B/op  1 allocs/op
```

`allocs/op` is frequently the most actionable number in the row: dropping an allocation from a hot path often beats shaving nanoseconds off the CPU work, because you also remove the downstream GC cost it would have caused. (You can also enable it globally with `go test -benchmem`.)

> **Key insight:** A benchmark's number is only as honest as its timer boundaries. The default span is "the whole function body times `b.N`"; `ResetTimer`, `StopTimer`/`StartTimer`, and pre-built input slabs are how you shrink that span down to *exactly* the operation under test — and nothing else.

---

## Throughput vs Latency — Two Different Numbers

`ns/op` is a **latency** figure: how long one operation takes. But "fast" sometimes means **throughput**: how many operations complete per second, possibly in parallel. They are not reciprocals once concurrency, batching, or queuing enters — a system can have great throughput (lots of ops/sec via parallelism) while each individual op has poor latency.

For per-op latency, `ns/op` is your answer directly. For data-rate throughput, report **bytes processed per second** with `b.SetBytes`:

```go
func BenchmarkCompress(b *testing.B) {
    payload := makePayload(1 << 20) // 1 MiB
    b.SetBytes(int64(len(payload)))  // tell the harness the per-op data size
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sink2 = len(compress(payload))
    }
}
// BenchmarkCompress-8  1432  814322 ns/op  1287.4 MB/s  ...
```

The `MB/s` column appears *because* of `SetBytes` — far more meaningful than raw `ns/op` when you're comparing algorithms on different payload sizes. For *parallel* throughput (does it scale across cores?), use `b.RunParallel`:

```go
func BenchmarkCacheGet(b *testing.B) {
    c := newCache()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() { // each goroutine pulls from a shared b.N pool
            sink2 = c.Get(42)
        }
    })
}
```

This surfaces contention: if `ns/op` *worsens* as you add goroutines (raise `-cpu`), you've found lock contention or false sharing — which is the domain of [03 — Latency and Throughput](../03-latency-and-throughput/middle.md) and [06 — Concurrency and Contention](../06-concurrency-and-contention/middle.md).

> **Key insight:** Decide which question you're answering *before* you write the benchmark. "How long does one op take?" → latency (`ns/op`). "How much work per second?" → throughput (`MB/s`, ops/sec). "Does it scale?" → parallel throughput. They demand different harness setups and a single benchmark rarely answers all three honestly.

---

## Worked Example — Comparing Two Runs with benchstat

A single `ns/op` is nearly meaningless on its own — it has no error bar, so you can't tell a real 3% win from CPU-frequency noise. The discipline is: run the benchmark *many times* on both the old and new code, then compare distributions statistically. Go's `benchstat` does exactly this.

Run each version multiple times (`-count`), capturing output to a file:

```bash
# on the old code
go test -bench=Encode -count=10 -benchmem > old.txt
# apply your optimization, then on the new code
go test -bench=Encode -count=10 -benchmem > new.txt

benchstat old.txt new.txt
```

```
name        old time/op    new time/op    delta
Encode-8     482.6ns ± 2%   391.4ns ± 1%   -18.90%  (p=0.000 n=10+10)

name        old alloc/op   new alloc/op   delta
Encode-8      512B ± 0%      256B ± 0%    -50.00%  (p=0.000 n=10+10)

name        old allocs/op  new allocs/op  delta
Encode-8      3.00 ± 0%      1.00 ± 0%    -66.67%  (p=0.000 n=10+10)
```

Read this carefully — every column earns its place:

- **`± 2%`** is the variation across the 10 runs (roughly a confidence interval). A tight band (`± 1–2%`) means a stable machine; a wide one (`± 15%`) means your environment is noisy and the delta may be untrustworthy.
- **`delta`** is the percentage change. `-18.90%` means the new code is ~19% faster.
- **`p=0.000`** is the significance: the probability this difference is chance. Below 0.05, the change is statistically real. Here `p=0.000` means it's almost certainly real.
- **`n=10+10`** is the sample sizes (10 old, 10 new).

The case that bites people is the *insignificant* result:

```
name        old time/op    new time/op    delta
Encode-8     482.6ns ± 9%   471.2ns ±11%   ~     (p=0.218 n=10+10)
```

`delta` shows `~` and `p=0.218`. That `~` means **no statistically significant difference** — your "2% improvement" is indistinguishable from noise at these variances. Shipping that change as a "perf win" is a fiction. Either it has no effect, or your benchmark is too noisy to detect one; quiet the machine (close apps, pin CPU frequency, raise `-count`) and rerun.

> **Key insight:** The output of an honest benchmark is a *distribution with a p-value*, not a single number. `benchstat`'s job is to stop you from celebrating noise. If `p > 0.05` or the `±` bands overlap heavily, you have not measured an improvement — you've measured your machine's jitter. "It got faster on one run" is the signature of a benchmark nobody should trust.

---

## Mental Models

- **A microbenchmark is an adversarial game against the optimizer.** The compiler and JIT are trying to make your benchmark fast by *removing* the work (DCE, folding, hoisting). Sinks and `black_box` are your moves against theirs. If you don't play, you measure the empty loop.

- **Inputs in, outputs out — both must be opaque.** Make inputs vary per iteration so they can't be precomputed; sink outputs so they can't be discarded. Every benchmark bug in this family is one of these two leaks.

- **On a JIT, speed is a function of time-since-start.** Interpreter, then C1, then C2 — three speeds in one run. The number you usually want is the C2 asymptote, which is why warm-up iterations exist and must be discarded.

- **The timer span is the experiment's boundary.** Whatever is between start-clock and stop-clock is what you measured. Setup leaking in is contamination; `ResetTimer` and input slabs draw the boundary tight.

- **A number without an error bar is a rumor.** `benchstat` turns "it's faster" into "it's 18.9% faster, p=0.000" — or exposes it as `~` noise. Distributions and p-values, not single runs.

---

## Common Mistakes

1. **No sink — measuring the empty loop.** Discarding a pure function's result lets the compiler delete the call entirely. Sub-nanosecond, input-independent results are the tell. Publish to a package-level `sink` (Go), return or `Blackhole.consume` (JMH), `black_box` (Rust).

2. **Constant inputs — measuring a compile-time constant.** A literal argument gets folded; the algorithm never runs at benchmark time. Feed inputs that vary with the loop index.

3. **Benchmarking the cold JVM.** Timing the first iterations measures the interpreter, not C2-compiled steady state — off by an order of magnitude. Always warm up (JMH does this; hand-rolled JVM loops can't be trusted).

4. **Setup inside the timed span.** Building inputs, opening DB connections, or allocating fixtures inside the measured region inflates `ns/op`. Use `b.ResetTimer()` after one-time setup; `b.StopTimer()`/`StartTimer()` for per-iteration setup (sparingly).

5. **Reporting a single run as fact.** One `ns/op` has no error bar. Run `-count=10` and compare with `benchstat`; trust the delta only when `p < 0.05` and the `±` bands are tight.

6. **Benchmarking on a noisy machine.** Turbo boost, thermal throttling, background processes, and a busy laptop produce `± 15%` swings that drown real deltas. Pin CPU frequency, plug in, close everything, and prefer a quiet dedicated box for numbers you'll cite.

7. **Confusing latency and throughput.** `ns/op` answers "how long is one op," not "how much work per second under load." Use `SetBytes` for data rate and `RunParallel` for scaling; don't quote one when the question was the other.

---

## Test Yourself

1. You write a benchmark calling `math.Sqrt(2.0)` in a loop and get `0.28 ns/op`. What almost certainly happened, and what are the *two* things wrong with this benchmark?
2. What is a "sink" / `Blackhole` / `black_box` for, mechanically — what does it prevent the compiler from doing?
3. On the JVM, why does timing the first 100 iterations of a method give a wildly different number than iterations 100,000–100,100?
4. Explain what Go's harness does with `b.N`. Why is your benchmark *function* (not just its loop) run multiple times?
5. When should you use `b.StopTimer()`/`b.StartTimer()` instead of `b.ResetTimer()`, and what's the risk of overusing the former?
6. `benchstat` reports `delta: ~ (p=0.62)`. Your code is "obviously faster." What does this output actually mean, and what do you do?

<details>
<summary>Answers</summary>

1. The compiler **constant-folded** `math.Sqrt(2.0)` (constant input) and/or **eliminated** the call (result unused) — you measured an empty loop. Two bugs: the input is a constant (fold it), and the result is discarded (no sink). Fix both: vary the input with `i`, accumulate into a published `sink`.
2. To make the benchmarked value *observably used* (and its input *opaque*) so the optimizer cannot prove the work is dead and delete it (DCE), nor precompute it (constant folding). A blackhole is engineered to do this with near-zero measurement overhead.
3. **Tiered JIT compilation.** The first iterations run interpreted (slow); after enough invocations HotSpot compiles via C1 then C2 (aggressively optimized, fast). Iterations 100k+ are steady-state C2 code — often 10–50× faster than the interpreted start.
4. The harness runs the function with a growing `b.N`, measuring wall time, until a run lasts about `-benchtime` (~1s), then reports `total/b.N`. The whole function reruns because it needs to *try* larger `b.N` values; everything outside the loop runs once per attempt, which is why setup needs `ResetTimer`.
5. Use `StopTimer`/`StartTimer` for setup that must happen *every iteration* and can't be hoisted (e.g. rebuilding data a destructive op mutates). `ResetTimer` is for *one-time* setup before the loop. Overusing Stop/Start adds toggle overhead; if the paused work dwarfs the timed work, that overhead becomes noise — prefer pre-building an input slab.
6. `~` with `p=0.62` means **no statistically significant difference** — the change is indistinguishable from machine noise at these variances. "Obviously faster" is your intuition, not the data. Quiet the machine (pin frequency, close apps), raise `-count`, and rerun; if it stays `~`, the change has no measurable effect.

</details>

---

## Cheat Sheet

```
DEFEAT THE OPTIMIZER (do BOTH, every time)
  vary inputs    use loop index → no constant folding / hoisting
  sink outputs   Go: assign to package-level var
                 JMH: return value, or Blackhole.consume(x)
                 Rust: black_box(x)
  symptom of failure: sub-ns/op, result independent of input

GO testing.B
  b.N            auto-scaled by harness to fill -benchtime (~1s)
  b.ResetTimer() zero clock after one-time setup
  b.StopTimer()/StartTimer()  pause for per-iteration setup (use sparingly)
  b.ReportAllocs()  add B/op + allocs/op   (or: go test -benchmem)
  b.SetBytes(n)  enable MB/s throughput column
  b.RunParallel  parallel throughput / contention

JVM (JMH) — never hand-roll a JVM benchmark
  @Warmup        discarded iterations → reach C2 steady state
  @Measurement   the timed iterations
  @Fork(n)       fresh JVMs → no cross-benchmark profile pollution
  @Benchmark return value → consumed (no DCE)

JIT TIERS (HotSpot)
  interpreter → C1 (~1.5k calls) → C2 (~10k calls)   then maybe deopt
  benchmark the C2 asymptote, not the cold start

COMPARE RUNS
  go test -bench=X -count=10 -benchmem > old.txt ; ... > new.txt
  benchstat old.txt new.txt
  read: delta + ±variance + p-value
    p < 0.05 & tight ±  → real change
    delta = ~ / p>0.05  → NOISE, not an improvement
```

---

## Summary

- **Dead-code elimination** deletes work whose result is unused; **constant folding** and **loop hoisting** delete work whose inputs are known or invariant. All three are the optimizer doing its job — and all three silently invalidate a naive benchmark.
- You defeat the whole family with two reflexes: **vary inputs** with the loop index, and **sink outputs** (Go package-level var, JMH `Blackhole`/return, Rust `black_box`). A sub-nanosecond, input-independent result means your benchmark was eliminated.
- On a **JIT runtime** code runs at multiple speeds — interpreter → C1 → C2 — so you must **warm up** and discard the cold phase to measure steady state. JMH automates this with `@Warmup` and isolates profiles with `@Fork`; hand-rolled JVM loops can't be trusted.
- Go's `testing.B` **auto-scales `b.N`** to fill `-benchtime`, rerunning the function with growing counts. Keep per-iteration work consistent and use **`ResetTimer`/`StopTimer`/`ReportAllocs`/`SetBytes`** to draw the timer boundary around exactly the operation under test.
- Distinguish **latency** (`ns/op`) from **throughput** (`MB/s` via `SetBytes`, ops/sec, `RunParallel`) and choose the harness for the question you're actually asking.
- A single number is a rumor. **`benchstat`** turns runs into a distribution with a **p-value**: trust a delta only when `p < 0.05` and the `±` bands are tight; a `~` delta is noise wearing a result's clothes.

---

## Further Reading

- *JMH samples* (`org.openjdk.jmh.samples`) — the canonical, heavily-commented set; `JMHSample_08_DeadCode` and `_38_PerInvokeSetup` are required reading.
- Aleksey Shipilëv, *"Java Microbenchmark Harness: The Lesser of Two Evils"* and his JMH talks — why hand-rolled JVM benchmarks are almost always wrong.
- `pkg.go.dev/testing` — the `testing.B` docs: `b.N`, `ResetTimer`, `ReportAllocs`, `SetBytes`, `RunParallel`, `b.Loop`.
- `pkg.go.dev/golang.org/x/perf/cmd/benchstat` — reading deltas, variance, and p-values.
- *criterion.rs* user guide — `black_box`, statistical analysis, and regression detection in Rust benchmarks.

---

## Related Topics

- [junior.md](junior.md) — writing your first `testing.B` and reading `ns/op`.
- [senior.md](senior.md) — benchmark stability engineering, regression gates in CI, and macro-benchmarking whole systems.
- [01 — Profiling](../01-profiling/01-cpu-profiling/middle.md) — once a benchmark says "slow," profiling says *where* the time goes.
- [03 — Latency and Throughput](../03-latency-and-throughput/middle.md) — tail latency, Little's Law, and why p99 ≠ mean.
- [06 — Concurrency and Contention](../06-concurrency-and-contention/middle.md) — reading `RunParallel` scaling curves and finding contention.
- [07 — Performance Budgets and Regression Testing](../07-performance-budgets-and-regression-testing/middle.md) — turning `benchstat` deltas into automated CI gates.
