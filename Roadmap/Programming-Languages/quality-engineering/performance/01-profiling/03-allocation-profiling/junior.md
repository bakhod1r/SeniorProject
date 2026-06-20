# Allocation Profiling — Junior Level

> **Roadmap:** [Profiling](../README.md) → Allocation Profiling
> *Your garbage collector isn't slow because it's badly written. It's busy because your code keeps handing it garbage to collect. Allocation profiling shows you exactly which lines are doing the handing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Allocation Rate vs Live Memory](#core-concept-1--allocation-rate-vs-live-memory)
5. [Core Concept 2 — Your First Allocation Profile: `-benchmem`](#core-concept-2--your-first-allocation-profile--benchmem)
6. [Core Concept 3 — `alloc_objects` vs `alloc_space`: Many Small vs Few Large](#core-concept-3--alloc_objects-vs-alloc_space-many-small-vs-few-large)
7. [Core Concept 4 — Reading Per-Call-Site Counts to Find the Worst Offender](#core-concept-4--reading-per-call-site-counts-to-find-the-worst-offender)
8. [Core Concept 5 — The Four Junior Culprits](#core-concept-5--the-four-junior-culprits)
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

> Focus: **Where do allocations happen, and how often?**

You've shipped a service. It works. Then someone notices the CPU graph has a sawtooth pattern, or the latency chart has spikes that line up suspiciously with "GC" in the logs. The instinct is to blame the garbage collector — "the GC is pausing us." That instinct is almost always pointed at the wrong thing.

Here is the truth that reframes the whole problem: **a garbage collector only does work when there is garbage to collect.** If your program is allocating millions of short-lived objects per second, the GC has no choice but to run constantly to clean up after you. The GC isn't the disease. It's the symptom. The disease is your **allocation rate** — how much new memory your code requests per second.

This page is about *finding* that allocation rate and *attributing* it to specific lines of code. That's a narrow, specific skill, and it's worth separating from two neighbours you'll meet later. **Memory profiling** (the next topic over) asks "what is still *alive* in the heap right now?" — it's about what's *retained*. **Memory optimization** asks "how do I *reduce* this?" — it's about the fixes. Allocation profiling sits between them: it answers "**where** is new memory being created, and **how fast**?" Get good at this one question first; the answer points you at the other two.

The good news for a junior: in a garbage-collected language, **allocation rate is usually the easier win**. You don't need to understand the GC's internals, tune obscure flags, or rewrite your memory layout. You just need to find the handful of lines that allocate the most and make them allocate less. The tooling makes those lines obvious.

> **The mindset shift:** stop asking "why is the GC slow?" and start asking "why is my code making so much garbage?" The GC's cost is downstream of your allocation rate. Cut the rate at the source and the GC quietly stops being a problem — often without you touching a single GC setting.

---

## Prerequisites

- **Required:** You can write and run a program in a garbage-collected language. Examples use **Go**; there are light asides for **Java** and **Python**.
- **Required:** You've run a command in a terminal and read its output.
- **Helpful:** You know roughly what "the heap" and "the stack" are — heap = memory the program asks for at runtime and the GC later reclaims; stack = scratch space for a single function call, freed automatically when the call returns. (We'll keep it this simple.)
- **Helpful:** You've seen "GC" in a log line or a flame graph and wondered why it was there. By the end you'll know how to make it leave.
- **Not required:** Any knowledge of GC algorithms, generations, or escape analysis internals. We name them; we don't need them.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Allocation** | A request for a fresh chunk of heap memory — what happens when you create a slice, a map, a struct on the heap, or a new object. |
| **Allocation rate** | How much new memory your program requests over time (bytes/sec, or objects/sec). The hidden driver of GC work. |
| **Garbage collector (GC)** | The runtime component that automatically reclaims heap memory you're no longer using. It runs *because* you allocated. |
| **Live memory** | The bytes currently in use and reachable — what a *memory* profile measures. Different from allocation rate. |
| **Call site** | The exact line of code where an allocation happens (`buf := make(...)` on line 42). |
| **`allocs/op`** | Benchmark metric: number of heap allocations per operation. Lower is better. |
| **`B/op`** | Benchmark metric: bytes allocated per operation. Lower is better. |
| **`alloc_objects`** | pprof view: *count* of allocations attributed to each call site ("how many"). |
| **`alloc_space`** | pprof view: *total bytes* allocated by each call site ("how big"). |
| **Boxing** | Putting a plain value (an `int`, a `float`) into an interface/object wrapper, which often forces a heap allocation. |
| **Escape** | When a value the compiler hoped to keep on the stack must instead go on the heap (it "escapes" the function). |

---

## Core Concept 1 — Allocation Rate vs Live Memory

These two numbers sound similar and are constantly confused. Telling them apart is the foundation of everything below.

- **Live memory** = how much is *alive right now*. A snapshot. "The heap currently holds 400 MB." This is what a **memory profile** answers, and it's the thing to look at when memory keeps *growing* (a leak) or is simply *too large*.

- **Allocation rate** = how much is *created over time*, regardless of whether it's later thrown away. A flow. "This code allocates 2 GB/sec." This is what an **allocation profile** answers, and it's the thing to look at when the **GC runs a lot** or **CPU is spent in GC**.

Here's why the difference matters so much. Consider a function that, on every request, builds a 1 KB temporary buffer, uses it, and discards it:

```
10,000 requests/sec × 1 KB temporary buffer each
  → live memory at any instant: ~1 KB (one buffer in flight)
  → allocation rate:            ~10 MB/sec of pure garbage
```

A memory profile of this code looks *clean* — almost nothing is alive, because each buffer dies immediately. But the program is generating 10 MB of garbage every second, and the GC must run over and over to sweep it up. **Low live memory, high allocation rate.** If you only ever look at a memory profile, this problem is invisible. You need the allocation profile to see it.

> **Key insight:** "Memory is fine, we're only using 1 KB" and "the GC is killing us" are *not contradictory* — they're the classic signature of a high allocation rate. The bytes don't *accumulate*; they *churn*. The cost isn't storage, it's the constant create-and-collect cycle.

The practical rule of thumb: **if memory keeps growing, profile memory (retention). If memory is flat but the GC/CPU is busy, profile allocations (rate).** This page is the second case.

---

## Core Concept 2 — Your First Allocation Profile: `-benchmem`

You don't need a fancy tool to get your first allocation numbers in Go. A benchmark with one flag will do it. This is the single most useful habit you can build at this level.

Suppose you suspect this string-building function allocates too much:

```go
func joinWords(words []string) string {
    s := ""
    for _, w := range words {
        s += w + " "   // each += builds a brand-new string
    }
    return s
}
```

Write a benchmark for it (file `bench_test.go`):

```go
func BenchmarkJoinWords(b *testing.B) {
    words := []string{"the", "quick", "brown", "fox", "jumps"}
    for i := 0; i < b.N; i++ {
        _ = joinWords(words)
    }
}
```

Run it with `-benchmem` — the flag that turns on allocation reporting:

```bash
go test -bench=JoinWords -benchmem
```

```
BenchmarkJoinWords-8    3,000,000    412 ns/op    160 B/op    5 allocs/op
```

Read the last two columns — they are the whole point:

- **`160 B/op`** — this function allocates 160 bytes of heap memory *per call*.
- **`5 allocs/op`** — it makes 5 separate heap allocations *per call*.

Five allocations to join five words. That's not a coincidence — each `s += ...` throws away the old string and builds a new, longer one. The number of allocations grows with the input. Now you have a *measured* fact, not a hunch: this function allocates per word.

> **Key insight:** `allocs/op` and `B/op` are your scoreboard. Before you "optimize" anything, get the number. After you change the code, get it again. If `allocs/op` didn't drop, your change didn't help the allocation problem — no matter how clever it felt. Optimizing without measuring these two numbers is guessing.

A note for other languages so the idea transfers: Java's **JMH** benchmark harness has `-prof gc`, which reports allocation rate per operation in much the same spirit. Python's standard-library **`tracemalloc`** can snapshot allocations and show you the top allocating lines. The tool changes; the question — *how much does this code allocate per unit of work?* — does not.

---

## Core Concept 3 — `alloc_objects` vs `alloc_space`: Many Small vs Few Large

`-benchmem` gives you one function's totals. To see allocations across a *whole program* and attribute them to call sites, you use **pprof** — and pprof asks you which of two questions you want answered.

Generate an allocation profile from a benchmark:

```bash
go test -bench=. -memprofile=mem.out
go tool pprof mem.out
```

Inside pprof, the same data has two lenses:

```
(pprof) sample_index = alloc_objects   # count: HOW MANY allocations
(pprof) sample_index = alloc_space     # bytes: HOW BIG the allocations are
```

These answer genuinely different questions, and the gap between them is diagnostic:

- **`alloc_objects`** counts allocations. A call site high here is allocating **many small things** — think a tight loop creating one tiny object per iteration. Each object is cheap, but there are millions of them, and *the GC's cost is driven by the number of objects*, not their size. This is the view that most often explains GC pressure.

- **`alloc_space`** sums bytes. A call site high here is allocating **a lot of memory**, possibly in **a few large chunks** — think one `make([]byte, 10_000_000)`. One allocation, huge size.

A call site can be a giant in one view and invisible in the other:

```
alloc_objects (count):                 alloc_space (bytes):
  4,000,000  parseRow      ← huge        12 MB   parseRow
        1    loadFile               →   500 MB   loadFile      ← huge
```

`parseRow` made four million tiny allocations (a GC nightmare); `loadFile` made *one* allocation of half a gigabyte (a memory-size concern, but trivial GC work — one object). If GC *pauses* are your problem, you chase `parseRow`. If total *memory* is your problem, you look at `loadFile`. Pick the lens that matches your symptom.

> **Key insight:** "Many small" and "few large" are different diseases with different cures, and a single number can't tell them apart. Always check **both** `alloc_objects` and `alloc_space`. The contrast between them — which call sites jump to the top when you switch lenses — *is* the diagnosis.

---

## Core Concept 4 — Reading Per-Call-Site Counts to Find the Worst Offender

The reason this whole discipline is tractable for a junior: allocations are wildly **unevenly distributed**. You will almost never find allocation spread evenly across your code. Instead, a tiny number of call sites — often *one* — produce the overwhelming majority. Find that one line, fix that one line, and the graph moves. This is the 80/20 rule in its purest form.

pprof's `top` command sorts call sites by the metric you chose, worst first:

```bash
(pprof) sample_index = alloc_objects
(pprof) top
```

```
      flat  flat%   sum%        cum   cum%
  3850000  77.0%  77.0%    3850000  77.0%  main.parseRow
   480000   9.6%  86.6%     480000   9.6%  main.(*Buffer).grow
   210000   4.2%  90.8%     210000   4.2%  encoding/json.Marshal
    95000   1.9%  92.7%      95000   1.9%  main.newSession
```

How to read this without drowning in columns:

- **`flat`** — allocations made *directly in this function's own code*. This is the number you want for finding the offender: it's allocations the function itself is responsible for, not ones made by functions it calls.
- **`flat%`** — that as a percentage of all allocations. `parseRow` is **77%** of every allocation in the program. That's your offender. Everything else is rounding error by comparison.
- **`cum` / `cum%`** — *cumulative*: this function **plus everything it calls**. Useful when the real cost hides in a callee, but start with `flat`.

To see the exact lines inside the worst function, use `list`:

```bash
(pprof) list parseRow
```

```
         .          .   12:  func parseRow(line string) Row {
   1920000          .   13:      parts := strings.Split(line, ",")    ← allocates a slice every call
   1920000          .   14:      tags := make([]string, 0)            ← starts empty, grows repeatedly
         .          .   15:      ...
```

Now you're looking at the precise lines doing the damage — `strings.Split` and an un-presized slice — with allocation counts beside them. This is the payoff of the whole exercise: not "the program allocates a lot," but "**line 13 of `parseRow` allocates 1.9 million times.**" That's a fact you can act on.

> **Key insight:** Don't try to reduce allocations everywhere — that's exhausting and pointless. Find the **top one or two call sites** (by `flat`), confirm the exact lines with `list`, and fix only those. Allocation is so skewed that fixing the #1 offender usually moves the whole program's GC cost more than fixing the next twenty combined.

---

## Core Concept 5 — The Four Junior Culprits

Once you can read a profile, the same handful of patterns will show up at the top again and again. Learn to recognise these four on sight; they cover the large majority of what a junior will find.

**1. String concatenation in a loop.** Strings are immutable in Go (and Java, and Python). `s += x` can't extend the existing string — it must allocate a *whole new one* and copy. In a loop, that's an allocation every iteration, and the strings get longer each time.

```go
s := ""
for _, x := range items {
    s += x          // a new string allocated EVERY iteration
}
```

This lights up `alloc_objects` *and* `alloc_space`. In the profile you'll see the concatenation line with a count proportional to your loop length. (Java's `String +` in a loop is the identical trap; the fix uses a `StringBuilder`.)

**2. Growing a slice without preallocating.** Appending to a slice that starts empty forces the runtime to allocate a bigger backing array and copy everything over each time it runs out of room — repeatedly, as the slice grows.

```go
var out []int                  // capacity 0
for _, v := range src {
    out = append(out, v*2)     // re-allocates the backing array several times as it grows
}
```

In the profile this appears as allocations inside `growslice` (Go's internal grow routine), traced back to your `append` line. The tell is multiple allocations for a slice whose final size you could have known up front.

**3. Boxing a value into an interface.** Putting a concrete value into an `interface{}` (now `any`) — very commonly by passing it to something like `fmt.Sprintf` or storing it in a `map[string]any` — frequently forces the value onto the heap so the interface can hold a pointer to it.

```go
func log(v any) { ... }
for i := 0; i < n; i++ {
    log(i)        // the int 'i' gets boxed onto the heap to fit in 'any'
}
```

This is sneaky because there's no `make` or `new` in sight — the allocation is *implicit*. In the profile you'll see it attributed to the call line, and the `list` view will show an allocation on a line that looks allocation-free. (This is exactly what Java does when it auto-boxes an `int` into an `Integer`, and what Python does because *everything* is already a heap object.)

**4. Defensive copies.** Code that copies a slice or struct "to be safe" — so a caller can't mutate the original — allocates a new buffer every time it runs. Sometimes necessary; often done reflexively on a hot path where it isn't.

```go
func process(data []byte) {
    local := make([]byte, len(data))   // a fresh copy on every call
    copy(local, data)
    ...
}
```

In the profile this is a clean `make` on a hot path, high in both `alloc_objects` and `alloc_space`. The question to ask is never "is the copy correct?" — it's "does *this* path actually need it, given how often it runs?"

> **Key insight:** Three of these four allocations are *invisible in the source* — there's no `make` or `new` on the boxing or concatenation lines. That's precisely why you profile instead of reading code: the profiler sees the heap allocations the syntax hides. Your eyes can't reliably spot an allocation; pprof can't miss one.

---

## Real-World Examples

**1. The "GC is killing us" service that had no leak.** A JSON API shows GC eating 30% of CPU under load. The team's first move is to tune GC settings — no improvement. Someone finally runs `go test -bench=. -memprofile`, switches pprof to `alloc_objects`, and runs `top`. One line — a per-request log call that did `fmt.Sprintf("%v", bigStruct)` — accounts for 60% of all allocations, because formatting boxed every field. Memory usage had always looked *fine* (nothing was retained); the problem was pure churn. Removing one `Sprintf` from the hot path cut GC CPU by more than half. No GC flag was ever touched.

**2. The slice that reallocated eight times.** A data pipeline reads a CSV and builds a slice of rows. `-benchmem` reports `9 allocs/op` for a function that conceptually does *one* thing. `list` reveals the cause: `var rows []Row` starts at capacity zero and `append` grows the backing array repeatedly as the file is read. The final size was knowable from the line count all along. The fix (presizing) is a *Memory Optimization* concern — but it was the **allocation profile** that turned a vague "this feels slow" into "this line reallocates eight times per call."

**3. The "few large" surprise that wasn't a GC problem at all.** An image service occasionally spikes to 2 GB of memory. The team assumes high allocation rate and goes hunting for churn in `alloc_objects` — and finds nothing remarkable. Switching to `alloc_space` tells the real story: a single `make([]byte, ...)` that decodes a full-resolution image. *One* allocation, but enormous. This is a "few large" case: it's a memory-*size* issue (relevant to a memory profile and to capacity planning), not a GC-pressure issue. The lesson: checking *both* lenses stopped them from chasing the wrong problem.

---

## Mental Models

- **The GC is a janitor; allocation is the litter.** A janitor who never stops sweeping isn't lazy or broken — the room is filling with trash faster than one person can clear it. Don't hire a faster janitor (tune the GC). Stop dropping so much litter (allocate less). The allocation profile is the map of where the litter is being dropped.

- **Live memory is a photograph; allocation rate is the water bill.** A photo of your heap (memory profile) can show an almost-empty room while your water meter (allocation profile) spins wildly — because the water flows *through* and drains away. Churn doesn't show up in a snapshot; you have to measure the flow.

- **`alloc_objects` counts cars; `alloc_space` weighs the cargo.** A traffic jam (GC pressure) is caused by the *number of cars* (object count), not the *weight of what they carry* (bytes). One truck hauling a piano (a single huge allocation) doesn't cause a jam; ten thousand bicycles do.

- **Allocations hide in the syntax; the profiler reveals them.** `s += x`, passing an `int` to `any`, a `defer` capturing a value — none of these say "allocate" in the source. Reading code to find allocations is like proofreading for invisible ink. The profiler is the lamp that makes the ink show up.

---

## Common Mistakes

1. **Blaming the GC instead of the allocation rate.** "The GC is slow" is almost never the real issue. The GC runs proportionally to how much you allocate. Profile allocations *first*; tune the GC approximately never. Reaching for `GOGC` before opening an allocation profile is treating the symptom.

2. **Looking only at live memory when the symptom is GC/CPU.** A memory profile of a high-churn program looks *clean* — everything dies immediately, so nothing is retained. If your symptom is "GC is busy" or "CPU is high in GC," the memory profile will mislead you into thinking there's no problem. Use the allocation profile.

3. **Checking only one of `alloc_objects` / `alloc_space`.** "Many small" and "few large" are different problems. A call site can dominate one view and vanish in the other. Always look at both; the contrast is the diagnosis.

4. **Optimizing call sites that aren't at the top.** Allocation is heavily skewed — one or two call sites usually dominate. Shaving allocations off a function that's 0.5% of the total is wasted effort. Sort by `flat`, fix the top, re-measure.

5. **"Optimizing" without re-measuring `allocs/op`.** You changed the code and it *feels* leaner. Did `allocs/op` actually drop? If you didn't re-run `-benchmem`, you don't know — and "felt faster" has sent many engineers down the wrong path. The number is the only verdict.

6. **Confusing "where it's allocated" with "where it's retained."** An allocation profile tells you the line that *created* the memory. It does **not** tell you what's keeping memory *alive* — that's a memory (retention) profile, a different tool answering a different question. Don't use an allocation profile to hunt a leak.

---

## Test Yourself

1. A service uses only 2 KB of live memory at any instant, but the GC is consuming 25% of CPU. Is there a memory leak? What kind of profile do you reach for, and why?
2. In `go test -benchmem` output, what do `allocs/op` and `B/op` each tell you, and which one most directly relates to GC pressure?
3. You switch pprof from `alloc_objects` to `alloc_space` and a different call site jumps to the top. What does that contrast tell you about the two call sites?
4. You see `5 allocs/op` for a function that joins 5 strings in a loop. Why does the allocation count track the number of strings?
5. There's no `make` or `new` anywhere near a line, yet pprof attributes thousands of allocations to it. Name two patterns that allocate *implicitly* like this.
6. You "optimized" a hot function. How do you *prove* the allocation problem is actually better?

<details>
<summary>Answers</summary>

1. **No leak** — live memory is tiny and flat, so nothing is accumulating. The symptom (GC burning CPU on flat memory) is the classic signature of a **high allocation rate**: lots of short-lived garbage being created and collected. Reach for an **allocation profile** (`-memprofile` → pprof `alloc_objects`), not a memory/retention profile, because the problem is *churn*, not *retention*.
2. **`allocs/op`** = number of heap allocations per operation; **`B/op`** = bytes allocated per operation. **`allocs/op`** is the one most tied to GC pressure, because the GC's cost is driven largely by the *number of objects* it must track and sweep, not their total size.
3. The two call sites have different *shapes*. The one that tops `alloc_objects` makes **many small** allocations (a GC-pressure concern). The one that tops `alloc_space` makes **fewer but larger** allocations (a memory-*size* concern). The contrast tells you which symptom — GC pauses vs total memory — each call site is responsible for.
4. Strings are immutable, so `s += x` can't grow the existing string — it allocates a brand-new string and copies the old contents in. Once per loop iteration → once per string → the count scales with the input.
5. Any two of: **boxing a value into an interface** (`any` / `interface{}`, e.g. passing an `int` to `fmt.Sprintf`); **growing a slice without preallocating** (the implicit reallocation inside `append`/`growslice`); **string concatenation in a loop** (`s += x`); a **defensive copy** that's syntactically a `make` but easy to overlook on a hot path.
6. Re-run `go test -bench=... -benchmem` and compare `allocs/op` and `B/op` before vs after. If those numbers dropped, the allocation problem is genuinely better. "It feels faster" is not evidence — the scoreboard is.

</details>

---

## Cheat Sheet

```
THE CORE DISTINCTION
  live memory   = what's ALIVE now (snapshot)   → memory profile  → leaks / size
  alloc rate    = what's CREATED over time (flow)→ alloc profile  → GC / CPU churn
  rule: memory GROWING → profile retention.  memory FLAT but GC busy → profile allocs.

FIRST NUMBERS (Go benchmark)
  go test -bench=Name -benchmem
    → ... 412 ns/op    160 B/op    5 allocs/op
       B/op      = bytes allocated per op
       allocs/op = # heap allocations per op   ← most tied to GC pressure

WHOLE-PROGRAM PROFILE (pprof)
  go test -bench=. -memprofile=mem.out
  go tool pprof mem.out
    (pprof) sample_index = alloc_objects   # COUNT  → "many small" → GC pressure
    (pprof) sample_index = alloc_space     # BYTES  → "few large"  → memory size
    (pprof) top                            # worst call sites, by 'flat'
    (pprof) list funcName                  # exact allocating lines + counts
  ALWAYS check both alloc_objects AND alloc_space.

READING top
  flat  = allocations made directly IN this function ← use this to find the offender
  cum   = this function + everything it calls

THE FOUR JUNIOR CULPRITS
  1. s += x in a loop          → new string every iteration   (use a builder)
  2. append to empty slice     → backing array reallocates    (preallocate cap)
  3. value into interface/any  → implicit boxing onto heap     (avoid on hot path)
  4. defensive make+copy       → fresh buffer every call       (only if needed)
  (3 of 4 are INVISIBLE in source — that's why you profile, not read.)

THE LOOP
  profile allocations → top by flat → list the worst → allocate less THERE → re-measure
```

---

## Summary

- **Most "GC problems" are allocation problems in disguise.** The GC runs because there's garbage to collect; the amount of garbage is your **allocation rate**. Cut the rate and the GC quietly stops hurting — usually without touching a single GC setting.
- **Live memory and allocation rate are different questions.** Live memory (a memory profile) is what's *retained right now*; allocation rate (an allocation profile) is what's *created over time*. A high-churn program can show tiny, flat memory while the GC burns CPU. If memory grows, profile retention; if memory is flat but GC is busy, profile allocations.
- **Get the numbers first.** `go test -benchmem` gives you `allocs/op` and `B/op` per function — your scoreboard. For whole-program attribution, pprof offers two lenses: **`alloc_objects`** (count — "many small," the usual GC driver) and **`alloc_space`** (bytes — "few large," a memory-size concern). Always check both; the contrast is the diagnosis.
- **Find the worst offender, fix only it.** Allocation is wildly skewed: `top` sorted by `flat` plus `list` usually points at one or two lines responsible for most of the churn. Fixing the #1 offender moves the graph more than fixing the next twenty.
- **Know the four culprits.** String concatenation in a loop, growing a slice without presizing, boxing a value into an interface, and reflexive defensive copies. Three of the four allocate *invisibly* — which is exactly why you profile instead of trusting your eyes.

You now have the loop: **profile allocations → find the top call site → allocate less there → re-measure.** That single cycle, repeated on the worst offender each time, is how you turn a GC-bound service back into a fast one. *How* to actually allocate less — pooling, presizing, keeping values on the stack — is the subject of [Memory Optimization](../../05-memory-and-allocation-profiling/junior.md); *what's keeping memory alive* is [Memory Profiling](../02-memory-profiling/junior.md). This page was about finding *where the garbage comes from* — the first and most leveraged question of the three.

---

## Further Reading

- [Go Blog — *Profiling Go Programs*](https://go.dev/blog/pprof) — the canonical walkthrough of capturing and reading pprof profiles, allocation profiles included.
- [`pprof` README](https://github.com/google/pprof/blob/main/doc/README.md) — what `top`, `list`, `flat`, `cum`, and the `sample_index` views actually mean.
- [Go testing docs — `-benchmem`](https://pkg.go.dev/testing#hdr-Benchmarks) — how `allocs/op` and `B/op` are produced.
- *Java Performance* (Scott Oaks) — the allocation-rate chapter; the concepts transfer directly even though the tool (JFR / async-profiler) differs.
- The [middle.md](middle.md) of this topic, which adds escape analysis, inline vs heap allocation, and reading allocation flame graphs.

---

## Related Topics

- [02 — Memory Profiling](../02-memory-profiling/junior.md) — the sibling question: what's *retained* and alive, not what's *created*. Use it when memory grows.
- [05 — Memory & Allocation Optimization](../../05-memory-and-allocation-profiling/junior.md) — once the profile names the offender, *how* to allocate less: presizing, pooling, avoiding boxing.
- [Allocation Profiling — Middle](middle.md) — escape analysis, the stack/heap decision, and allocation flame graphs.
- [Language Internals › Tracing Garbage Collection](../../../../language-internals/memory-management/05-tracing-garbage-collection/) — *why* allocation rate drives GC frequency and pause times.
