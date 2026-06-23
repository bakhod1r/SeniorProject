# CPU-Bound Optimization — Junior Level

> **Roadmap:** [Performance](../README.md) → CPU-Bound Optimization
> *Slow code feels the same whether the CPU is melting or sitting idle waiting on a disk — but the fix is completely different. The first skill in performance work isn't making code fast; it's knowing which kind of slow you have, and then refusing to guess about the rest.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — CPU-Bound vs I/O-Bound](#core-concept-1--cpu-bound-vs-io-bound)
5. [Core Concept 2 — Profile First, Always](#core-concept-2--profile-first-always)
6. [Core Concept 3 — The Algorithm Dominates (Big-O Beats Micro-Tricks)](#core-concept-3--the-algorithm-dominates-big-o-beats-micro-tricks)
7. [Core Concept 4 — Reducing Work Beats Doing Work Faster](#core-concept-4--reducing-work-beats-doing-work-faster)
8. [Core Concept 5 — The Hot Loop and How to Find It](#core-concept-5--the-hot-loop-and-how-to-find-it)
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

> Focus: **My code is slow. Where is the time going, and what actually fixes it?**

A program can be slow for two fundamentally different reasons. Either the CPU is genuinely busy — crunching numbers, looping, comparing, parsing — or the CPU is *idle*, sitting on its hands waiting for something else: a disk read, a database reply, a network packet. These feel identical from the outside (the user waits either way), but they are opposite problems with opposite cures.

This page is about the first kind: **CPU-bound** code, where the processor itself is the bottleneck. The good news is that CPU-bound slowness is the most *fixable* kind a junior engineer will meet, because the biggest wins almost never require clever low-level tricks. They come from doing **less work**: picking a better data structure, not accidentally writing an O(n²) loop, not recomputing the same value a thousand times, not allocating memory inside a tight loop.

But before any of that, there is one rule that overrides everything: **measure first**. The single most expensive mistake in performance work is optimizing code that was never slow — spending a day shaving a function that runs for 2 milliseconds while the real bottleneck, a 4-second loop next door, goes untouched. Your intuition about where time goes is wrong far more often than you'd believe, even for experienced engineers. A profiler turns guessing into knowing.

> **The mindset shift:** *make it work, make it right, make it fast — and only if "fast" is actually required.* Correctness first. Clarity second. Speed only when a measurement (not a feeling) says you need it. "Fast" is a feature with a cost; you pay for it in complexity, so demand evidence before you buy.

---

## Prerequisites

- **Required:** You can write and run a program with loops and functions in at least one language (examples use **Go** and a little **Python**).
- **Required:** You've seen Big-O notation — even just "O(n) means time grows with the input" — and know what an array, map (hash table), and slice/list are.
- **Helpful:** You've watched a program "hang" and wondered whether it was busy or stuck.
- **Helpful:** You've opened a system monitor (Task Manager, Activity Monitor, `top`) and seen a CPU percentage.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **CPU-bound** | The program is slow because the *processor* is the bottleneck — it's doing real work the whole time. |
| **I/O-bound** | The program is slow because it's *waiting* — for disk, network, or a database — while the CPU sits idle. |
| **Profiler** | A tool that measures where your program actually spends its time, function by function. |
| **Hot path / hot loop** | The small part of the code where most of the time is spent. Usually a loop. |
| **Big-O** | How runtime grows as input grows: O(n) linear, O(n²) quadratic, O(log n) logarithmic. |
| **Memoization** | Caching the result of a computation so you never compute the same answer twice. |
| **Hoisting** | Moving work *out* of a loop so it runs once instead of every iteration. |
| **Allocation** | Asking the system for new memory (a new slice, object, string). It isn't free. |
| **Batching** | Processing many items in one operation instead of one item per operation. |

---

## Core Concept 1 — CPU-Bound vs I/O-Bound

Before you optimize anything, answer one question: **is the CPU busy, or is it waiting?** Everything downstream depends on the answer, and the two cases need opposite fixes.

**CPU-bound** means the processor is the limiting resource. The program is actively computing — looping, sorting, hashing, parsing, doing math — and it would go faster on a faster CPU. The telltale sign: **one CPU core pinned at 100%** for the whole duration of the slow operation.

**I/O-bound** means the program is *waiting* on something external — reading a file, querying a database, calling an API. The CPU is mostly idle during the wait. A faster CPU wouldn't help at all; the program is blocked on disk or network. The telltale sign: the operation takes seconds but CPU usage stays **low** (5%, 10%) the whole time.

How to tell, practically:

```
Open a system monitor (top / Activity Monitor / Task Manager) and run the slow operation.

  One core at ~100% the whole time   → CPU-BOUND   (this page)
  CPU near idle, but it's still slow  → I/O-BOUND   (a different problem entirely)
```

A concrete check on the command line:

```bash
# Run your program under `time` and watch the breakdown:
time ./myprogram

# real    0m8.0s   ← wall-clock time you actually waited
# user    0m7.6s   ← time the CPU spent running YOUR code
# sys     0m0.2s   ← time in the kernel

# user ≈ real  → CPU was busy the whole time → CPU-BOUND
# user ≪ real  → most of the wait was idle   → I/O-BOUND (waiting on something)
```

In the example above `user` (7.6s) is almost the whole `real` (8.0s) — the CPU was working the entire time. That's CPU-bound, and the rest of this page applies. If instead `real` were 8.0s but `user` were 0.3s, the CPU did almost nothing for 8 seconds: you're waiting on I/O, and no algorithm change will help — you'd look at caching the I/O, parallelizing the waits, or fixing a slow query (see the [Diagnostics](../../../diagnostics/) and database skills instead).

> **Key insight:** A faster algorithm only helps a CPU-bound program. If your code is I/O-bound, you can rewrite the math to be 100× faster and the program will be *exactly* as slow, because the CPU was never the thing you were waiting on. Diagnose the *type* of slow before you spend a minute fixing it.

---

## Core Concept 2 — Profile First, Always

You've confirmed you're CPU-bound. The next temptation is to read the code, spot something that *looks* expensive, and "fix" it. Resist. **Where the time goes is almost never where you think.**

A **profiler** runs your program and reports, function by function, where the CPU actually spent its cycles. It replaces your guess with a measurement. In Go, profiling is built in:

```go
import (
    "os"
    "runtime/pprof"
)

func main() {
    f, _ := os.Create("cpu.prof")
    pprof.StartCPUProfile(f)   // start recording
    defer pprof.StopCPUProfile()

    runTheSlowThing()          // your actual work
}
```

Then inspect the result:

```bash
go tool pprof cpu.prof
(pprof) top        # the functions that ate the most CPU, ranked
(pprof) list slowFunc   # line-by-line time inside one function
```

The `top` output ranks functions by how much CPU time they consumed. The function at the top is your target — and it is *routinely* a surprise. Python's equivalent is just as easy:

```bash
python -m cProfile -s tottime myscript.py
# Prints every function, sorted by total time spent inside it.
```

The output's `tottime` column is "time spent in this function itself." The biggest number is where to start.

The reason this matters so much is the **80/20 rule of performance**: roughly 80% of the time is spent in about 20% of the code — often a single loop. Optimizing anything *outside* that 20% is wasted effort no matter how clever it is. A 10× speedup on code that accounts for 2% of runtime saves you 1.8% overall. A 2× speedup on the code that accounts for 80% saves you 40%. The profiler tells you which code is which.

> **Key insight:** Optimization without profiling is gambling with your own time. The profiler is not a "nice to have" — it is the *first* tool you reach for, before reading a single line with intent to change it. Find the 20% that matters; ignore the 80% that doesn't.

---

## Core Concept 3 — The Algorithm Dominates (Big-O Beats Micro-Tricks)

Once the profiler points at the hot function, the first thing to examine is its **algorithm** — its Big-O — not its individual lines. Why? Because algorithmic improvements scale with your data, and micro-optimizations don't.

Consider checking, for each item in a list, whether it appears in another list:

```go
// SLOW — O(n × m): for every item, scan the whole other list.
func countMatches(items, lookup []string) int {
    count := 0
    for _, x := range items {        // n times
        for _, y := range lookup {   //   × m times each
            if x == y {
                count++
                break
            }
        }
    }
    return count
}
```

With 10,000 items and a 10,000-element lookup, that inner scan runs up to 100,000,000 times. Now the same logic with the right data structure:

```go
// FAST — O(n + m): build a set once, then each check is O(1).
func countMatches(items, lookup []string) int {
    set := make(map[string]struct{}, len(lookup))
    for _, y := range lookup {       // m times, once
        set[y] = struct{}{}
    }
    count := 0
    for _, x := range items {        // n times
        if _, ok := set[x]; ok {     //   each lookup is O(1)
            count++
        }
    }
    return count
}
```

This goes from ~100,000,000 operations to ~20,000 — roughly **5,000× less work**. No micro-trick exists that can rescue the first version; the *shape* of the work was wrong. Compare that to the kind of "optimization" beginners reach for first — caching a length, swapping `i++` for `++i`, inlining a tiny call. Those might shave 5–10% off a single line. The data-structure change shaved off 99.98%.

The lesson generalizes. Reach for the right container before anything else:

| Need | Slow choice | Right choice | Why |
|---|---|---|---|
| "Is X present?" | scan a list — O(n) | map / set — O(1) | hash lookup vs linear scan |
| "Look up by key" | scan a list — O(n) | map — O(1) | direct addressing |
| "Keep things sorted" | re-sort each time — O(n log n) | sorted insert / heap | maintain order incrementally |
| "Count occurrences" | nested loop — O(n²) | map of counts — O(n) | one pass |

> **Key insight:** Big-O wins compound with scale; micro-tricks don't. A better algorithm turns "slow at 10,000, dead at 1,000,000" into "fine at both." Always ask *"what's the Big-O of this hot function?"* before you touch a single line — and an accidental nested loop is the most common O(n²) trap there is.

---

## Core Concept 4 — Reducing Work Beats Doing Work Faster

The deepest principle in CPU optimization is almost philosophical: **the fastest work is the work you never do.** Before making a computation faster, ask whether it needs to happen at all, or that *many* times.

**Hoist work out of loops.** If something inside a loop produces the same answer every iteration, compute it *once* before the loop:

```go
// SLOW — len(data) and the regexp compile run every single iteration.
for i := 0; i < len(data); i++ {
    re := regexp.MustCompile(`\d+`)   // recompiled n times!
    process(data[i], re, len(data))
}

// FAST — compute the invariants once, outside the loop.
re := regexp.MustCompile(`\d+`)       // compiled once
n := len(data)
for i := 0; i < n; i++ {
    process(data[i], re, n)
}
```

Compiling that regular expression is expensive; doing it 10,000 times instead of once is 9,999 wasted compilations.

**Memoize repeated computation.** If you compute the same expensive answer for the same input more than once, cache it:

```python
from functools import lru_cache

@lru_cache(maxsize=None)          # remembers results; same input → instant return
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
```

Without the cache, `fib(35)` recomputes the same sub-values billions of times — it can take seconds. With one decorator line, each `fib(k)` is computed exactly once and the call returns almost instantly. You didn't make the math faster; you made it *happen far fewer times*.

**Batch instead of per-item.** Doing one operation per item often carries fixed overhead each time. Doing it once over all items pays that overhead once:

```go
// SLOW — a string grows by copying its whole contents every += .  O(n²) total.
result := ""
for _, s := range parts {
    result += s            // each += allocates a new, larger string
}

// FAST — accumulate in a builder, produce the final string once.  O(n).
var b strings.Builder
for _, s := range parts {
    b.WriteString(s)       // appends in place, no per-item full copy
}
result := b.String()
```

> **Key insight:** Three questions, in order, before optimizing any computation: *(1) Can I skip it entirely? (2) Can I do it once instead of n times (hoist / memoize)? (3) Can I do it in bulk instead of per-item (batch)?* Only if all three are "no" should you try to make the work itself faster. Eliminating work always beats accelerating it.

---

## Core Concept 5 — The Hot Loop and How to Find It

At the machine level, a CPU does one thing: it executes instructions in a loop, one after another, billions per second. So when a program is CPU-bound, the time is being spent in *some loop* executing *some instructions* over and over. Performance work is largely the art of finding **the hot loop** — the one place where the iteration count and the per-iteration cost multiply into most of your runtime — and shrinking that product.

The math is simple and worth internalizing:

```
loop cost  ≈  (number of iterations)  ×  (work done per iteration)
```

You can attack either factor. Fewer iterations (a better algorithm, Concept 3) or cheaper iterations (less work each pass, Concept 4). A loop running 1,000,000 times doing a tiny bit of needless work — an allocation, a recompile, a redundant lookup — is where junior-level wins hide, because that needless work gets *multiplied a million times*.

This is why **allocating inside a hot loop** is such a classic mistake. Each allocation is cheap in isolation, but multiplied across millions of iterations it dominates:

```go
// SLOW — allocates a fresh slice every iteration; the garbage collector
// then has to clean up millions of throwaway slices.
func sumRows(rows [][]int) int {
    total := 0
    for _, row := range rows {
        buf := make([]int, len(row))   // NEW allocation each iteration
        copy(buf, row)
        total += reduce(buf)
    }
    return total
}

// FAST — allocate the buffer ONCE, reuse it every iteration.
func sumRows(rows [][]int) int {
    total := 0
    var buf []int
    for _, row := range rows {
        buf = buf[:0]                  // reuse the same backing array
        buf = append(buf, row...)
        total += reduce(buf)
    }
    return total
}
```

How do you *find* the hot loop? You already have the tool: the profiler from Concept 2. After `go tool pprof` shows you the top function, `list <funcName>` shows the time spent on each line *inside* it — and the line with the biggest number, almost always inside a loop, is exactly where to focus. Python's `cProfile` plus a line-level profiler (`line_profiler`) does the same. The workflow is always: profile → find the hot function → find the hot line/loop → reduce its iterations or its per-iteration cost.

> **Key insight:** A CPU-bound program's time lives inside a loop, and `cost ≈ iterations × work-per-iteration`. The profiler points you at the loop; then you have exactly two levers — fewer passes or cheaper passes. Anything that wouldn't change one of those two numbers isn't optimization, it's decoration.

---

## Real-World Examples

**1. The dashboard that got slower every month.** A reporting page loaded fine at launch, then crept toward 30 seconds over a year. The team assumed the database was slow (an I/O-bound assumption). A `time` check showed `user` time nearly equal to `real` time — the CPU was pinned. The profiler pointed at a function that, for each of N users, scanned the full list of N transactions: an O(n²) loop hiding in plain sight. As the data grew, n² exploded. Replacing the inner scan with a pre-built map (Concept 3) took the page from 30 seconds back to under a second. The "database problem" was never a database problem.

**2. The image pipeline that allocated itself to death.** A batch image processor spent 60% of its CPU time in garbage collection — visible immediately in the profile. The cause: a buffer allocated fresh inside the per-pixel-row loop, millions of times (Concept 5). Hoisting the allocation out and reusing one buffer cut total runtime by more than half. No algorithm changed; the program simply stopped creating millions of throwaway objects.

**3. The "optimization" that fixed nothing.** A developer was sure a string-formatting function was the bottleneck and spent a day hand-optimizing it. It got 3× faster — and the program's overall runtime didn't move. A profiler, run *afterward*, showed that function accounted for 1.5% of runtime; the real cost was a redundant sort being run inside a loop. A day of work bought a 0.5% improvement. Five minutes with a profiler first would have pointed straight at the sort.

---

## Mental Models

- **Busy vs waiting.** A CPU-bound program is a cook chopping vegetables non-stop — give them a faster knife (algorithm) and dinner comes sooner. An I/O-bound program is a cook standing idle waiting for the oven timer — a faster knife changes nothing. Always identify which cook you have.

- **The profiler is a flashlight in a dark room.** Don't grope around fixing whatever your hand touches. Turn on the light, see where the mess actually is, then clean *that*. Optimizing without profiling is rearranging furniture you can't see.

- **The 80/20 hot path.** Most of the time lives in a tiny fraction of the code. Your job is to find that fraction and ignore the rest. Effort spent outside the hot path is, by definition, wasted no matter how good the work.

- **Cost = iterations × work-per-pass.** Every CPU-bound problem reduces to this product. You have exactly two levers: do it fewer times, or do less each time. If a change doesn't move one of those numbers, it isn't an optimization.

- **The cheapest work is no work.** Before making something fast, ask if it can be skipped, done once instead of n times, or done in bulk. Deleting work always beats accelerating it.

---

## Common Mistakes

1. **Premature optimization — the cardinal sin.** Optimizing code before you've measured that it's slow, or before correctness and clarity are nailed down. You trade readability for speed you may not need, and you almost always optimize the wrong thing. Make it work, make it right, *then* make it fast — and only if a measurement demands it.

2. **Not checking CPU-bound vs I/O-bound first.** Pouring algorithmic effort into a program that's actually waiting on a database. A 100× faster loop saves zero time when the CPU was idle the whole time. Run `time` and watch `user` vs `real` before anything else.

3. **Optimizing without a profiler.** Trusting your gut about where time goes. Your gut is wrong most of the time — even seniors guess wrong. The function you're sure is slow is usually fine; the real cost is somewhere you didn't suspect.

4. **Micro-optimizing while ignoring Big-O.** Caching a length or inlining a call inside an O(n²) loop. You're polishing a brick. Fix the *shape* of the work (the algorithm and data structure) before touching individual lines.

5. **Accidental O(n²).** A nested loop, or calling an O(n) operation (like `x in list`, or `list += ` building a string) *inside* another loop. It looks innocent and runs fine on test data, then collapses in production where n is large. Whenever you see a loop inside a loop, check the complexity.

6. **Allocating inside a hot loop.** Creating a new slice, map, or object every iteration. Cheap once, ruinous a million times — and it loads the garbage collector on top. Allocate once outside the loop and reuse.

7. **Believing "it's fine on my machine."** Your laptop has fast hardware and a small test dataset. Production has more data and shared, contended hardware. Test performance with realistic data sizes, because O(n²) only bites at scale.

---

## Test Yourself

1. A request takes 6 seconds. You run `time` and see `real 6.0s`, `user 0.2s`. Is this CPU-bound or I/O-bound? Will a faster algorithm help?
2. Your code is confirmed CPU-bound and slow. What is the *very first* tool you reach for, and why not just read the code?
3. You have a loop that, for each of 50,000 users, does `if user.id in id_list` where `id_list` is a list of 50,000 IDs. What's the Big-O, and how do you fix it?
4. Inside a loop running a million times, you compile a regular expression every iteration. What's the fix called, and roughly how much wasted work does it remove?
5. Name the two levers you have to reduce the cost of a hot loop.
6. A colleague spent a day making a function 5× faster and the program didn't speed up at all. What did they almost certainly skip, and what should they have done first?

<details>
<summary>Answers</summary>

1. **I/O-bound.** `user` (0.2s) is tiny compared to `real` (6.0s), so the CPU was idle ~5.8s — it was *waiting* (disk, network, database). A faster algorithm will **not** help; the CPU was never the bottleneck.
2. **A profiler** (`go tool pprof`, `cProfile`, etc.). Because where the time actually goes is almost never where you'd guess; reading code with intent to change it before measuring means you'll likely optimize the wrong 80% and leave the real bottleneck untouched.
3. **O(n²)** — for each of n users you do an O(n) linear scan of the list (n × n = 2.5 billion checks). Fix: put the IDs in a **set / map** first, making each membership check O(1), bringing the whole thing to **O(n)**.
4. **Hoisting** — move the compile *out* of the loop so it runs once. It removes ~999,999 redundant compilations (all but one).
5. **Fewer iterations** (a better algorithm / data structure) and **less work per iteration** (hoisting, memoizing, avoiding allocations). Cost ≈ iterations × work-per-pass.
6. They skipped **profiling**. The function they optimized was almost certainly not the bottleneck (a 5× local speedup with no overall change means it was a tiny fraction of runtime). They should have **profiled first** to find the function that actually dominates runtime, then optimized *that*.

</details>

---

## Cheat Sheet

```
STEP 0 — WHAT KIND OF SLOW?
  time ./program
    user ≈ real   → CPU-BOUND  (this page applies)
    user ≪ real   → I/O-BOUND  (waiting; algorithm won't help)
  system monitor: one core at 100% = CPU-bound

STEP 1 — PROFILE (never guess)
  Go:     pprof.StartCPUProfile(f) ... go tool pprof cpu.prof → top, list fn
  Python: python -m cProfile -s tottime script.py
  Find the hot function (the ~20% of code using ~80% of time).

STEP 2 — FIX, IN PRIORITY ORDER
  1. CAN I SKIP IT?         delete the work entirely
  2. BIG-O                  fix the algorithm / data structure first
       "is X present?"  list scan O(n)  →  set/map O(1)
       nested loop O(n²)               →  one pass with a map O(n)
  3. DO IT FEWER TIMES      hoist invariants out of loops; memoize
  4. DO IT IN BULK          batch; use strings.Builder, not  s += s
  5. STOP ALLOCATING        in hot loops: allocate once, reuse the buffer
  6. ONLY THEN micro-tune individual lines

THE LOOP EQUATION
  cost ≈ iterations × work-per-iteration
  two levers: fewer passes  |  cheaper passes

GOLDEN RULES
  make it work → make it right → make it fast (only if required)
  measure before you change anything
  the fastest work is the work you never do
```

---

## Summary

- A slow program is either **CPU-bound** (processor busy, one core at 100%) or **I/O-bound** (CPU idle, waiting on disk/network/database). These need opposite fixes — diagnose the type first with `time` (compare `user` to `real`) or a system monitor.
- A **faster algorithm only helps CPU-bound code.** Confirm you're CPU-bound before spending a minute optimizing.
- **Profile first, always.** Where time goes is almost never where you think; a profiler (`pprof`, `cProfile`) replaces guessing with measurement and points you at the ~20% of code that holds ~80% of the runtime.
- **The algorithm dominates.** Fixing Big-O — a list scan to a map lookup, an accidental O(n²) to one pass — beats every micro-trick, because algorithmic wins compound with data size while micro-tricks don't.
- **Reducing work beats doing work faster.** In order: can you skip it, do it once instead of n times (hoist / memoize), or do it in bulk (batch)? Don't allocate inside a hot loop.
- A CPU-bound program's time lives in a **hot loop** where `cost ≈ iterations × work-per-iteration`. You have two levers — fewer passes or cheaper passes — and the profiler shows you exactly which loop to aim them at.

You now have the junior playbook: identify the kind of slow, measure before touching anything, fix the algorithm before the lines, and delete work before accelerating it. Everything deeper in this roadmap — cache behavior, allocation profiles, concurrency overhead — sits on top of these same instincts.

---

## Further Reading

- *Systems Performance* — Brendan Gregg. The canonical text; start with the chapter on methodology and the USE method.
- *The Art of Computer Programming* / any good algorithms course — for the Big-O intuition that underlies Concept 3. The `big-o-analysis` skill is a fast on-ramp.
- [Go blog — Profiling Go Programs](https://go.dev/blog/pprof) — the original, still the clearest walkthrough of `pprof`.
- Python docs — [The Python Profilers](https://docs.python.org/3/library/profile.html) — `cProfile` usage and reading its output.
- The [middle.md](middle.md) of this topic, which goes from "find the hot loop" into *why* loops are fast or slow at the hardware level: branch prediction, instruction-level parallelism, and the cost model of a modern CPU.

---

## Related Topics

- [01 — Profiling](../01-profiling/) — the full treatment of CPU, memory, and allocation profiles and how to read a flame graph.
- [02 — Benchmarking and Microbenchmarks](../02-benchmarking-and-microbenchmarks/junior.md) — how to *prove* an optimization actually helped, without fooling yourself.
- [02 — Benchmarking (deeper)](../02-benchmarking-and-microbenchmarks/middle.md) — the traps (dead-code elimination, warm-up) that make naive benchmarks lie.
- [05 — Memory Optimization](../05-memory-and-allocation-profiling/) — when "stop allocating in the hot loop" becomes its own discipline.
- [Diagnostics](../../../diagnostics/) — what to do when the slowness is I/O-bound, or when slow becomes a production incident.
