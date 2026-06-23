# Benchmarking and Microbenchmarks — Junior Level

> **Roadmap:** [Performance](../README.md) → Benchmarking and Microbenchmarks
> *"It feels faster" is not data. A benchmark turns a feeling into a number, and a number into something you can defend, compare, and watch over time.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Benchmark Is a Controlled Measurement](#core-concept-1--a-benchmark-is-a-controlled-measurement)
5. [Core Concept 2 — Micro vs Macro Benchmarks](#core-concept-2--micro-vs-macro-benchmarks)
6. [Core Concept 3 — Why Naive Timing Lies](#core-concept-3--why-naive-timing-lies)
7. [Core Concept 4 — Warm-Up and Steady State](#core-concept-4--warm-up-and-steady-state)
8. [Core Concept 5 — Variance: Read the Spread, Not One Number](#core-concept-5--variance-read-the-spread-not-one-number)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is a benchmark, and why does measuring beat guessing?**

Sooner or later someone asks "is this code fast enough?" and the room fills with opinions. One person swears the JSON parser is the bottleneck. Another is sure it's the database. A third rewrote a loop "to be faster" last week and is certain it helped. Almost everyone is wrong, because almost nobody measured.

A **benchmark** is the cure. It is a small, repeatable experiment that runs a piece of code under controlled conditions and reports how long it took (or how many operations it managed per second, or how much memory it allocated). Instead of arguing, you run the benchmark, look at the numbers, and the argument is over.

That sounds trivial, and the *concept* is. The trap is that timing code *correctly* is surprisingly hard. A benchmark written carelessly will hand you a confident number that is completely false — and a false number is worse than no number, because you'll trust it and optimise in the wrong direction. The bulk of this page is about the difference between a benchmark that tells the truth and one that lies to your face.

> **The mindset shift:** stop saying "I think this is faster." Start saying "I measured it, here are the numbers, and here's how much they varied." Performance work without measurement isn't engineering — it's guessing with extra steps. The professional reflex is **measure, don't guess**, and everything below is in service of measuring *honestly*.

---

## Prerequisites

- **Required:** You can write and run a program in at least one language (examples use **Go**, with light mentions of **Python** and **Java**).
- **Required:** You've used a terminal to run a command and read its output.
- **Helpful:** You've at some point said (or heard) "this rewrite is faster" without actually timing it. (We'll fix that instinct.)
- **Helpful:** A rough sense of units of time — that a millisecond (ms) is 1,000 microseconds (µs), and a microsecond is 1,000 nanoseconds (ns). Microbenchmarks live in the ns–µs range.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Benchmark** | A repeatable experiment that measures how fast (or how memory-hungry) some code is. |
| **Microbenchmark** | A benchmark of a *tiny* piece of code — one function, one loop — in isolation. |
| **Macrobenchmark** | A benchmark of a *whole* operation or request through the real system. |
| **Iteration** | One single run of the code being measured. |
| **Warm-up** | Throwaway runs at the start, before measuring, to let caches/JIT settle. |
| **Steady state** | The stable performance the code reaches *after* warm-up. |
| **Variance / noise** | How much your measurements jump around between runs. |
| **ns/op** | Nanoseconds per operation — Go's default benchmark unit. Lower is better. |
| **Throughput** | Operations completed per unit of time (e.g. ops/sec). Higher is better. |
| **benchstat** | A Go tool that compares benchmark results and tells you if a change is *real*. |

---

## Core Concept 1 — A Benchmark Is a Controlled Measurement

A benchmark has three jobs, and all three matter:

1. **Run the target code** — the thing you want to know about.
2. **Measure** something objective — time, operations per second, bytes allocated.
3. **Be repeatable** — run it again and get *roughly* the same answer.

The word doing the heavy lifting is **controlled**. A measurement you can't reproduce isn't a benchmark; it's an anecdote. If you time something once, get "42 ms," and move on, you've learned almost nothing — you don't know if the true value is 40 ms or 80 ms, or whether the 42 was a fluke caused by your laptop indexing files in the background.

Go bakes this discipline into the standard library. A benchmark is just a function starting with `Benchmark`, taking a `*testing.B`:

```go
package strutil

import "testing"

func BenchmarkConcat(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = "hello" + "world"
    }
}
```

The key piece is `b.N`. You do **not** pick how many times to run the code — the framework does. It runs your loop a few times, sees how long that took, then automatically scales `b.N` up (1, then 100, then 10,000, then millions) until the total run is long enough to measure reliably. You write the loop; Go decides the iteration count so the result is statistically meaningful.

Run it:

```bash
go test -bench=BenchmarkConcat
```

```
goos: darwin
goarch: arm64
pkg: example/strutil
BenchmarkConcat-8    1000000000    0.31 ns/op
PASS
```

Read that last line: the benchmark ran **one billion** iterations, and each one averaged **0.31 nanoseconds**. The `-8` is the number of CPUs available (`GOMAXPROCS`). You didn't ask for a billion runs — Go chose that many *because* the operation is so fast that it needed a huge sample to get a stable per-operation figure.

> **Key insight:** the value of a benchmark is not the single number it prints — it's that the number is *reproducible* and *comparable*. A benchmark exists so you can run it before a change and after a change and ask "did this actually help?" One run in isolation answers nothing.

---

## Core Concept 2 — Micro vs Macro Benchmarks

Benchmarks come in two sizes, and confusing them is one of the most common ways people fool themselves.

A **microbenchmark** measures one tiny thing in isolation — a single function, a parsing routine, one hot loop. It answers a narrow question: *"Of these two ways to write this exact function, which is faster?"*

```go
// Microbenchmark: which string-building approach wins?
func BenchmarkBuilder(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var sb strings.Builder
        for j := 0; j < 100; j++ {
            sb.WriteString("x")
        }
        _ = sb.String()
    }
}
```

A **macrobenchmark** measures a whole, realistic operation — an entire HTTP request, a full report generation, processing a real input file end to end. It answers a broader question: *"How fast is the thing the user actually waits for?"*

```go
// Macrobenchmark: the whole request path, the way production runs it
func BenchmarkHandleRequest(b *testing.B) {
    srv := newServer(testDB)         // real router, real handlers
    req := httptest.NewRequest("GET", "/api/orders/42", nil)
    b.ResetTimer()                   // don't count the setup above
    for i := 0; i < b.N; i++ {
        w := httptest.NewRecorder()
        srv.ServeHTTP(w, req)
    }
}
```

Both are useful, but they answer different questions, and **a microbenchmark win does not guarantee a macrobenchmark win.** You can make a string function 3× faster in a microbenchmark and have zero measurable effect on request latency — because that function was 0.1% of the request's time. This is the gap between *"fast in a loop"* and *"fast in production."*

| | Microbenchmark | Macrobenchmark |
|---|---|---|
| Scope | One function / loop | A whole operation / request |
| Question | "Which implementation is faster?" | "Is the user-visible thing fast enough?" |
| Speed to run | Very fast (ns–µs) | Slower (ms–s) |
| Risk | Optimising something that doesn't matter | Hard to isolate *what* is slow |
| Use it to | Compare two candidate functions | Decide if the system meets its target |

> **Key insight:** start macro to find *what* is slow (or use a [profiler](../01-profiling/01-cpu-profiling/junior.md)), then go micro to fix the specific hot spot — and finally return to the macro benchmark to confirm the fix actually moved the number that matters. A microbenchmark in a vacuum optimises code that may be completely irrelevant to real performance.

---

## Core Concept 3 — Why Naive Timing Lies

The instinct of every beginner is to wrap a stopwatch around the code:

```go
start := time.Now()
result := slowFunction()
fmt.Println(time.Since(start))   // "237µs" — done, right?
```

This is wrong in at least four ways, and each one alone can make the number meaningless.

**1. One run is noise, not signal.** Your machine is doing a hundred other things — the OS scheduler, background processes, your editor indexing. A single measurement captures whatever happened to be going on *that instant*. Run the same code three times and you might see 237µs, 198µs, 410µs. Which is "the" answer? None of them — you need many runs and their *distribution*.

**2. The clock is too coarse for tiny code.** If `slowFunction()` takes 4 nanoseconds and your timer's resolution is ~50 nanoseconds, you're measuring the *clock*, not the code. This is why you can't time a single fast operation directly — you must run it millions of times and divide, which is exactly what `b.N` does for you.

**3. The compiler may delete your code.** This is the sneaky one. If you compute a result and never use it, an optimising compiler is allowed to conclude the work is pointless and **remove it entirely** — a process called dead-code elimination (DCE). Your "benchmark" then measures an empty loop:

```go
// BROKEN: result is never used → the compiler may delete the call
func BenchmarkParse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        parse(input)   // looks measured; may be optimised to nothing
    }
}
// Result: 0.25 ns/op — suspiciously fast. That's the smell of DCE.
```

The fix is to *use* the result so the compiler can't prove it's dead — typically by assigning to a package-level variable the compiler can't see through:

```go
var sink Result   // package-level: compiler can't assume it's unused

func BenchmarkParse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = parse(input)   // result escapes; the work must really happen
    }
}
```

**4. Print-and-eyeball gives no notion of confidence.** Printing one number tells you nothing about how much it varies, so you can't tell a real 5% improvement from random jitter. You end up "confirming" wins that don't exist.

> **Key insight:** naive timing — one run, a wall clock wrapped around a tiny op, print and eyeball — produces a number that *looks* authoritative and is frequently false. A real benchmarking tool exists precisely to handle iteration count, clock resolution, dead-code elimination, and variance *for you*. Reaching for `time.Now()` to "quickly check" is how confident, wrong conclusions are born.

---

## Core Concept 4 — Warm-Up and Steady State

Code is often *slower the first time it runs* and faster afterward. If you measure that first slow run, you measure a cost the user rarely pays. The first few runs are the **warm-up**; the stable speed they settle into is the **steady state**.

Why does code speed up after a few runs?

- **Caches fill up.** The CPU pulls the relevant data and instructions into its fast caches; the first run pays the "cold cache" penalty, later runs don't.
- **Just-In-Time (JIT) compilation** (huge in **Java** and the JVM, and in JavaScript). The first runs execute slow interpreted bytecode; once the JIT notices a hot loop, it compiles it to optimised machine code and subsequent runs are *dramatically* faster.
- **One-time setup** — lazy initialisation, connection pools, file-system caches warming.

This matters most in Java. A naive JMH-less timing loop in Java can show a function getting 10× faster partway through purely because the JIT kicked in. That's why the JVM benchmarking tool **JMH** runs explicit warm-up iterations (which it *discards*) before it starts measuring:

```java
@Warmup(iterations = 5)            // 5 runs, thrown away, to let the JIT compile
@Measurement(iterations = 10)      // 10 runs that actually count
@Benchmark
public void parse() { /* ... */ }
```

Go is ahead-of-time compiled, so it has no JIT warm-up — but caches still need warming, and there's almost always **setup** you must keep out of the measurement. That's what `b.ResetTimer()` is for: do the expensive one-time preparation, then reset the clock so only the loop is timed.

```go
func BenchmarkSearch(b *testing.B) {
    data := buildBigIndex()   // slow setup — should NOT be counted
    b.ResetTimer()            // start the clock fresh, here
    for i := 0; i < b.N; i++ {
        _ = data.Search("target")
    }
}
```

> **Key insight:** the number you usually care about is the **steady-state** number — the speed code runs at *after* it has warmed up, because that's the speed it runs at in production for the millionth request. Measure the cold first run and you report a cost the user almost never pays. Warm up, *then* measure.

---

## Core Concept 5 — Variance: Read the Spread, Not One Number

Here is the rule that separates people who benchmark from people who *think* they benchmark: **never trust a single number — look at how much the numbers vary.**

Run the same benchmark twice and you will get slightly different results, because your machine is noisy. The question is never "what was the number?" — it's "what was the number, *plus or minus how much*?" A measurement of `200 ns/op ± 2%` is solid. A measurement of `200 ns/op ± 40%` is mush, and any "improvement" smaller than that 40% swing is invisible noise.

Go makes this easy with `-count`, which runs each benchmark several times so you can see the spread:

```bash
go test -bench=Search -count=10 | tee old.txt
```

```
BenchmarkSearch-8    523 ns/op
BenchmarkSearch-8    519 ns/op
BenchmarkSearch-8    641 ns/op    ← an outlier; the machine hiccuped
BenchmarkSearch-8    521 ns/op
BenchmarkSearch-8    525 ns/op
...
```

Eyeballing ten numbers is better than one, but you still shouldn't judge "is my change faster?" by hand. Use **benchstat**, which runs the statistics for you and refuses to call a change real unless it survives the noise:

```bash
# Measure before and after a change, then compare
go test -bench=Search -count=10 > old.txt
# ... make your optimisation ...
go test -bench=Search -count=10 > new.txt
benchstat old.txt new.txt
```

```
name      old time/op    new time/op    delta
Search-8     524ns ± 1%     310ns ± 2%   -40.84%  (p=0.000 n=10+10)
```

Two things to read here. The `± 1%` and `± 2%` are the **variance** — small, so the measurements are trustworthy. The `p=0.000` is a confidence figure: it means the difference is statistically real, not luck. When benchstat instead prints `~ (p=0.21)`, it's telling you *"the change is within the noise — I can't say it did anything."* That honesty is the entire point.

> **Key insight:** a benchmark result is a *range*, not a point. The discipline is to run many times, look at the spread, and only believe an improvement that is clearly bigger than the noise. "It went from 524 ns to 519 ns" is not an improvement — it's the machine breathing. Let a tool like benchstat decide what's real; your eyes are too eager to see wins.

---

## Real-World Examples

**1. The rewrite that "felt faster" and wasn't.** A developer replaces a `for`-loop string concatenation with a fancier approach because "it should be faster." They time it once before (190µs) and once after (170µs), declare victory, and merge. Run under benchstat with `-count=10`, the truth emerges: `~ (p=0.34)` — the change is pure noise, the two versions are identical within variance, and the "20µs improvement" was the machine hiccuping. A single before/after measurement had manufactured a win that didn't exist.

**2. The microbenchmark that optimised the wrong thing.** A team spends two days making a date-formatting function 4× faster, with a beautiful microbenchmark to prove it. The macrobenchmark of the actual API request? Unchanged. A [profile](../01-profiling/01-cpu-profiling/junior.md) later shows date formatting was 0.3% of request time; the real cost was a database query. The micro win was real *and* irrelevant — a textbook case of "fast in a loop, no effect in production."

**3. The benchmark the compiler deleted.** Someone benchmarks a hashing function, sees `0.4 ns/op`, and excitedly reports that the hash is "basically free." It wasn't — the result was never used, so dead-code elimination removed the call and the benchmark timed an empty loop. Assigning the result to a package-level `sink` variable brought the honest number back: `38 ns/op`, a hundred times slower. The "free" hash was a measurement artifact, not a fact.

---

## Mental Models

- **A benchmark is a science experiment, not a stopwatch.** A real experiment is controlled, repeated, and reports uncertainty. Timing code once is like weighing yourself once on a wobbly scale and tattooing the number on your arm.

- **One measurement is a rumour; many measurements are evidence.** You wouldn't trust a poll of one person. Don't trust a benchmark of one run. The *spread* across runs is the part that tells you whether to believe the average.

- **Warm-up is letting the engine reach temperature.** You don't judge a car's top speed from the first second after a cold start. Caches and JITs need a few laps before they show their real pace. Throw the cold laps away.

- **Micro vs macro is a microscope vs a wide-angle lens.** The microscope shows one function in exquisite detail but can't tell you if that function matters. The wide lens shows the whole request but can't tell you *why* it's slow. You need both, in the right order.

- **The compiler is a lazy genius.** If it can prove your benchmarked work has no observable effect, it will delete it and hand you a gorgeous, meaningless `0.3 ns/op`. Always make the result *escape* so the work is forced to happen.

---

## Common Mistakes

1. **Measuring once and trusting it.** A single run captures whatever noise was present that instant. Always run many times (`-count=10`) and look at the variance before believing any number.

2. **Wrapping `time.Now()` around a tiny operation.** The clock is too coarse for nanosecond work, and you'll measure the clock, not the code. Use a proper harness (`testing.B`, `timeit`, JMH) that loops and divides.

3. **Letting dead-code elimination delete the work.** If the benchmarked result is never used, the compiler may remove it and you'll time an empty loop. Assign the result to a package-level `sink` (Go) or use the tool's "blackhole" (JMH's `Blackhole`).

4. **Counting setup in the measurement.** Building the test fixture inside the timed loop inflates every result. Move setup out and call `b.ResetTimer()` (Go) so only the work-under-test is timed.

5. **Forgetting warm-up — especially on the JVM.** In Java, the first runs are slow interpreted code; measure those and you'll under-report steady-state speed by an order of magnitude. Discard warm-up iterations (JMH does this for you).

6. **Believing a micro win is a macro win.** Making one function faster proves nothing about end-to-end speed. Confirm with a macrobenchmark or profile that the function was actually on the hot path.

7. **Calling tiny differences "improvements."** "524 ns → 519 ns" is noise, not a win. If the change is smaller than the variance, it isn't real — let benchstat's `p`-value decide.

---

## Test Yourself

1. Why does Go let `b.N` (not you) decide how many iterations to run?
2. What is the difference between a microbenchmark and a macrobenchmark, and why can a micro win mean nothing for the user?
3. You time a function once with `time.Now()` and get `0.3 ns/op`. Name two separate reasons that number might be a lie.
4. What is "warm-up," and in which of Go vs Java does JIT warm-up matter — and why?
5. Your benchmark goes from `524 ns/op` to `519 ns/op`. Did your change help? How would you decide properly?
6. What does `b.ResetTimer()` do, and why would you call it?

<details>
<summary>Answers</summary>

1. Because a tiny operation can't be timed reliably in one run (the clock is too coarse and one run is noisy). The framework scales `b.N` up automatically until the total runtime is long enough to give a stable per-operation average.
2. A **micro**benchmark measures one isolated function/loop; a **macro**benchmark measures a whole real operation (e.g. an HTTP request). A micro win can mean nothing because the function you sped up may be a negligible fraction of the real operation's time — fast in a loop, invisible in production.
3. (a) **Dead-code elimination** — the result was never used, so the compiler deleted the work and you timed an empty loop. (b) **One noisy run** of a too-fast operation against a coarse clock — the single measurement isn't reproducible signal.
4. Warm-up is throwaway runs at the start that let caches fill and JITs compile, so you measure the **steady state** rather than the cold first run. JIT warm-up matters in **Java** (the JVM interprets first, then compiles hot loops to fast machine code); **Go** is ahead-of-time compiled so it has no JIT, though cache warming and one-time setup still apply.
5. You can't tell yet — a ~1% difference is almost certainly within the noise. Run both versions many times (`-count=10`) and compare with **benchstat**; only believe the change if the delta clearly exceeds the variance and the `p`-value is small (e.g. `p<0.05`).
6. It resets the benchmark's timer to zero, discarding the time spent on one-time setup before the loop, so the reported `ns/op` reflects only the work under test, not the fixture preparation.

</details>

---

## Cheat Sheet

```
THE CARDINAL RULE
  Measure, don't guess. A feeling is not data.

GO BENCHMARK ANATOMY
  func BenchmarkX(b *testing.B) {
      setup()                 // one-time prep
      b.ResetTimer()          // don't time the setup
      for i := 0; i < b.N; i++ {
          sink = work()       // assign result → defeat dead-code elimination
      }
  }

RUN IT
  go test -bench=.                 # run all benchmarks
  go test -bench=Search -count=10  # run 10x to see the spread
  go test -bench=. -benchmem       # also report allocations (B/op, allocs/op)

COMPARE HONESTLY
  go test -bench=Search -count=10 > old.txt
  # ...change code...
  go test -bench=Search -count=10 > new.txt
  benchstat old.txt new.txt        # tells you if the delta is REAL
    delta -40% (p=0.000)  → real improvement
    ~       (p=0.34)      → noise; change did nothing

NAIVE TIMING LIES BECAUSE
  one run        → noise, not signal
  coarse clock   → measures the clock, not tiny code
  unused result  → compiler deletes the work (DCE)
  print+eyeball  → no idea of confidence/variance

MICRO vs MACRO
  micro = one function in isolation   → "which impl is faster?"
  macro = whole operation/request     → "is it fast enough for the user?"
  a micro win is NOT automatically a macro win

WARM-UP
  first runs are slow (cold cache; JVM JIT not compiled yet)
  measure the STEADY STATE, discard warm-up (JMH does it; Go: ResetTimer)

OTHER LANGUAGES
  Python: timeit.timeit("work()", number=100000)   # loops for you
  Java:   JMH  @Warmup / @Measurement / Blackhole
```

---

## Summary

- A **benchmark** is a controlled, repeatable measurement of how fast code runs. Its value is not the single number — it's that the number is *reproducible and comparable*, so you can answer "did this change actually help?"
- **Microbenchmarks** measure one function in isolation; **macrobenchmarks** measure a whole real operation. A micro win does **not** guarantee a macro win — code that's "fast in a loop" can be irrelevant in production.
- **Naive timing lies**: one run is noise, a coarse clock can't time tiny ops, the compiler may *delete* unused work (dead-code elimination), and print-and-eyeball gives no sense of confidence. Use a real harness (`testing.B`, `timeit`, JMH) that handles all of this.
- Code is often slower on its first runs (cold caches, JVM JIT). **Warm up, then measure** the **steady state** — the speed code runs at in production — and keep setup out of the timed region (`b.ResetTimer()`).
- A result is a **range, not a point**. Run many times, read the **spread**, and only believe an improvement clearly larger than the noise. Let a tool like **benchstat** decide what's statistically real.

The whole discipline reduces to four words: **measure, don't guess** — and then *measure honestly*. Everything in the rest of this section is about making those measurements more accurate, more stable, and harder to fool yourself with.

---

## Further Reading

- [`testing` package — benchmarks](https://pkg.go.dev/testing#hdr-Benchmarks) — the canonical reference for `testing.B`, `b.N`, and `b.ResetTimer`.
- [`benchstat`](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) — the tool that decides whether a change is real; install it and use it on day one.
- *JMH Samples* — the official JMH examples (especially the dead-code-elimination and `Blackhole` ones) are the best short course on how microbenchmarks lie, in any language.
- [Python `timeit` docs](https://docs.python.org/3/library/timeit.html) — the standard-library way to time small snippets correctly.
- The [middle.md](middle.md) of this topic, which goes deeper on dead-code elimination, the statistics behind variance, and writing benchmarks that survive a noisy CI machine.

---

## Related Topics

- [01 — Profiling](../01-profiling/01-cpu-profiling/junior.md) — find *what* is slow first; benchmark the specific hot spot second.
- [03 — Latency and Throughput](../03-latency-and-throughput/junior.md) — what your benchmark numbers (ns/op, ops/sec) actually mean for users.
- [07 — Performance Budgets and Regression Testing](../07-performance-budgets-and-regression-testing/junior.md) — running benchmarks in CI so a regression can't sneak in.
- [middle.md](middle.md) — the next tier of this same topic: defeating optimisers, measuring allocations, and trustworthy CI benchmarks.
