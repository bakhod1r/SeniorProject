# CPU Profiling — Junior Level

> **Roadmap:** [Profiling](../README.md) → CPU Profiling
> *Your program is slow. You have a strong hunch about which function is the culprit. You are almost certainly wrong — and a profiler will prove it to you in about thirty seconds.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a CPU Profile Actually Is](#core-concept-1--what-a-cpu-profile-actually-is)
5. [Core Concept 2 — Sampling: How the Profiler Watches](#core-concept-2--sampling-how-the-profiler-watches)
6. [Core Concept 3 — The Golden Rule: Profile, Don't Guess](#core-concept-3--the-golden-rule-profile-dont-guess)
7. [Core Concept 4 — Reading the Top List: Flat vs Cumulative](#core-concept-4--reading-the-top-list-flat-vs-cumulative)
8. [Core Concept 5 — Capturing Your First Profile](#core-concept-5--capturing-your-first-profile)
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

> Focus: **What is a CPU profile, and how do I get one without lying to myself?**

Every engineer has done this: a program runs too slowly, you stare at the code, you *feel* certain that the nested loop in `processOrder` is the problem, you spend an afternoon rewriting it — and the program is exactly as slow as before. The time was never in `processOrder`. It was in a JSON-parsing call you never thought about, hidden three layers down.

This happens because human intuition about performance is terrible. We notice code that *looks* expensive (loops, recursion) and ignore code that *is* expensive (allocation, parsing, a function called a million times in a place we forgot existed). The gap between "where I think the time goes" and "where the time actually goes" is enormous, and it does not close with experience — senior engineers guess wrong just as often. They've simply learned to stop guessing.

The tool that closes the gap is a **CPU profiler**. It measures where your program actually spends CPU time and hands you a ranked list: this function, 38%; that one, 12%; the rest, noise. You stop debating and start fixing the thing at the top of the list. This page teaches you what that measurement *is*, how the most common kind of profiler produces it, and how to read the result without drawing the wrong conclusion.

> **The mindset shift:** stop saying "I think the slow part is X." Start saying "I'll profile it and *know* the slow part is X." A profiler turns performance work from an argument into a measurement — and the measurement is almost always surprising.

---

## Prerequisites

- **Required:** You can write and run a program in at least one language (the hands-on example uses **Go**; the ideas apply to every language).
- **Required:** You're comfortable in a terminal — running a command, reading its output.
- **Helpful:** You've written code that was "too slow" and weren't sure why.
- **Helpful:** You know what a **call stack** is — the chain of "function A called function B called function C" that exists at any moment a program runs. If not: it's just the list of functions currently in progress, innermost last. That concept is the heart of profiling.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Profile** | A recording of where a program spent its time (or memory), summarised so you can find the expensive parts. |
| **Profiler** | The tool that produces a profile. |
| **Sampling profiler** | A profiler that peeks at the program many times a second and writes down what it's doing, instead of timing every single call. |
| **Sample** | One peek — one recorded snapshot of the call stack at a moment in time. |
| **Hot** | Where the time concentrates. A "hot function" or "hot path" is one that shows up in a large share of samples. |
| **Call stack** | The chain of functions currently in progress, e.g. `main → handleRequest → parseJSON`. |
| **Flat (self) time** | Time spent *inside a function's own body*, excluding the functions it calls. |
| **Cumulative time** | Time spent in a function *plus everything it called* — the whole subtree. |
| **`pprof`** | Go's built-in profiling tool (also a file format and a viewer). |
| **Symbolication** | Turning raw memory addresses back into human function names. When it fails, you see `??`. |

---

## Core Concept 1 — What a CPU Profile Actually Is

A CPU profile answers one question: **of all the CPU time my program used, what fraction went to each function?**

That's it. Not "how many times was `add` called" (that's a different measurement). Not "how long did one request take" (that's a trace). A CPU profile is a **distribution of CPU time across your code**, usually presented as a ranked list:

```
flat  flat%   function
2.41s 38.2%   encoding/json.(*decodeState).object
0.78s 12.4%   runtime.mallocgc
0.51s  8.1%   strings.ToLower
0.22s  3.5%   myapp/orders.processOrder
...
```

Read the first line as: *"38.2% of all the CPU time this program burned was spent inside the JSON object decoder."* That single number is worth more than a week of staring at code. It tells you, unambiguously, that if you want this program to be faster, JSON decoding is where to look — and that `processOrder`, the function you suspected, accounts for a mere 3.5%.

The key property of a profile is that it's **relative and ranked**. You don't usually care about absolute seconds; you care about *proportion*. A function at the top is worth your attention because shrinking it shrinks the whole program. A function near the bottom is not, no matter how ugly its code is.

> **Key insight:** A CPU profile is a *priority list*, not a bug report. It doesn't tell you what's wrong — it tells you where the time is, so you can decide where it's *worth* being right. The whole value is in the ranking.

---

## Core Concept 2 — Sampling: How the Profiler Watches

How does a profiler know that JSON decoding took 38%? There are two strategies, and the one you'll use 95% of the time is **sampling**.

A **sampling profiler** works like a wildlife photographer with a fast shutter. It doesn't follow every animal all day. Instead, at a fixed rate — Go's default is **100 times per second** — it interrupts your program, looks at the current **call stack** (which function is running right now, and who called it), writes that stack down, and lets the program continue. Each interrupt is one **sample**.

```
time →
  sample 1:  main → handleRequest → parseJSON → json.object
  sample 2:  main → handleRequest → parseJSON → json.object
  sample 3:  main → handleRequest → processOrder
  sample 4:  main → handleRequest → parseJSON → json.object
  sample 5:  main → handleRequest → parseJSON → json.scanValue
  ...        (100 of these per second)
```

After running for, say, 6 seconds, the profiler has ~600 stack snapshots. Now it just *counts*. If `json.object` appeared in 229 of 600 samples, then the program was inside `json.object` roughly 229/600 ≈ **38% of the time**. The function seen most often is, by definition, the **hottest**.

This is a beautifully cheap trick. The profiler isn't timing anything — it's taking a statistical poll. The cost of one interrupt is tiny, so sampling adds very little overhead (typically a few percent), which means **the profile reflects how your program really behaves**, not a distorted, slowed-down version of it.

The trade-off is *statistical*: with samples, rare events may be missed, and small numbers are noisy. A function at 0.2% might really be 0.1% or 0.4% — you can't tell from a short run. But a function at 38% is *unmistakably* hot, and that's the one you care about. Sampling is fuzzy at the bottom and razor-sharp at the top, which is exactly where you need it to be.

> **Key insight:** Sampling trades perfect precision for near-zero distortion. It can't reliably measure a function that's 0.1% of the program — but it nails the function that's 40%, and that's the only one worth your time. Cheap-and-honest beats precise-and-misleading.

The other strategy, **instrumentation**, inserts a stopwatch at the entry and exit of *every* function. It's exact about call counts but can slow the program 10–50×, and that slowdown changes which parts dominate — so the profile may no longer describe the real program. Junior rule: **reach for the sampling profiler first.** Every tool below is a sampling profiler by default.

---

## Core Concept 3 — The Golden Rule: Profile, Don't Guess

This is the one law of performance work, and it overrides every instinct you have:

**Do not guess where the time goes. Measure it.**

The reason is empirical and brutal: the hot spot is almost never where you'd guess. There's even a name for the engineering folklore here — **Amdahl's argument** — but you don't need theory. You need one experience of confidently optimising the wrong function to internalise it forever.

Why is intuition so bad at this? A few reasons:

- **The expensive code is invisible.** A single line like `data := strings.ToLower(huge)` or `json.Unmarshal(body, &v)` looks cheap — one function call — but does enormous work inside. Loops *look* expensive; library calls *are* expensive, and they don't look like anything.
- **Call frequency hides in plain sight.** A trivial 5-line function is irrelevant — until you learn it's called 50 million times inside a loop you forgot about. The profiler counts the calls you can't see.
- **You optimise what's satisfying, not what matters.** Rewriting a clever algorithm feels productive. The profiler doesn't care about your feelings; it points at the boring 38% and says "here."

The discipline is simple to state and hard to follow: **before you change a single line for performance, capture a profile. After you change it, capture another and compare.** If you skip the first profile, you're guessing. If you skip the second, you don't actually know your change helped — it might have done nothing, or made things worse.

> **Key insight:** The first profile tells you *where* to work; it routinely contradicts your intuition, and the intuition is what's wrong. The second profile (after your fix) tells you whether the work *helped*. Skip either and you're back to guessing — which is how afternoons disappear into functions that were never the problem.

---

## Core Concept 4 — Reading the Top List: Flat vs Cumulative

Every profiler shows you a **top list** — functions ranked by time. But there are *two* times per function, and confusing them is the single most common beginner mistake. They are **flat** (also called *self*) and **cumulative**.

- **Flat (self) time** = time spent inside *this function's own body*, not counting the functions it calls.
- **Cumulative time** = time spent in this function *plus everything it called* — the entire subtree underneath it.

A picture makes it concrete. Suppose `handleRequest` does almost nothing itself but calls `parseJSON`, which is where the real work happens:

```
function          flat    flat%   cum     cum%
handleRequest     0.02s    0.3%   5.10s   81.0%   ← tiny self, huge cumulative
parseJSON         0.15s    2.4%   4.90s   77.8%
json.object       2.41s   38.2%   3.80s   60.3%   ← big self AND big cumulative
runtime.mallocgc  0.78s   12.4%   0.78s   12.4%   ← leaf: self == cumulative
```

Read it carefully:

- `handleRequest` has **0.3% flat** but **81% cumulative**. It personally does almost nothing — but everything expensive happens *below* it. Optimising `handleRequest`'s own body would be pointless; its body is empty. Its high cumulative just means "the slow stuff is somewhere in here."
- `json.object` has **38% flat** *and* high cumulative. High flat means **the cost is right here, in this function's own code**. This is the one to attack — shrinking its body directly removes 38%.
- `runtime.mallocgc` is a **leaf** (it calls nothing of interest), so its flat and cumulative are equal.

The rule of thumb:

- **Sort by cumulative** to *navigate* — to find which area of the program (which subtree) contains the cost. High cumulative = "the time is in here, keep digging."
- **Sort by flat** to *act* — to find the specific function whose own code you should change. High flat = "the time is *right here*; fix this."

> **Key insight:** Cumulative tells you *which branch* of the program to follow; flat tells you *where to stop and fix*. A function with 90% cumulative and 1% flat is just a corridor — the expensive room is further down. Optimise functions with high **flat** time; use high **cumulative** only to find them.

---

## Core Concept 5 — Capturing Your First Profile

Enough theory. Here's a real, complete first profile in Go — the fastest way to *see* everything above. Suppose you have a benchmark for a function `Tokenize`:

```go
// tokenize_test.go
package text

import "testing"

func BenchmarkTokenize(b *testing.B) {
    input := loadSampleDoc() // a big realistic input
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        Tokenize(input)
    }
}
```

Run the benchmark and tell Go to write a CPU profile while it runs:

```bash
go test -run=^$ -bench=BenchmarkTokenize -cpuprofile=cpu.out
```

(`-run=^$` skips normal tests so only the benchmark runs.) This produces a file, `cpu.out` — the raw profile. Now open it with `pprof`:

```bash
go tool pprof cpu.out
```

You land in an interactive prompt. Type `top`:

```
(pprof) top
Showing nodes accounting for 5.30s, 92.0% of 5.76s total
      flat  flat%   sum%        cum   cum%
     2.41s 41.8%  41.8%      2.41s 41.8%  text.scanRune
     1.05s 18.2%  60.0%      3.46s 60.0%  text.(*lexer).next
     0.78s 13.5%  73.5%      0.78s 13.5%  runtime.mallocgc
     0.51s  8.9%  82.4%      0.51s  8.9%  unicode.IsLetter
     0.30s  5.2%  87.6%      4.20s 72.9%  text.Tokenize
```

There it is, in five lines. `scanRune` is **41.8% flat** — it's the hot function, and the time is in its own body. `Tokenize` has high *cumulative* (72.9%) but low *flat* (5.2%) — it's the corridor; the work is below it in `scanRune`. And `runtime.mallocgc` at 13.5% is a hint that you're allocating a lot.

Want to know *which lines* inside `scanRune` are hot? Use `list`:

```
(pprof) list scanRune
     2.41s      2.41s    37: for _, r := range s {        // ← most time is on this loop line
         .          .    38:     if r == '\n' {
     0.90s      0.90s    39:         tokens = append(...)  // ← allocation hotspot
```

For a visual call tree in your browser (covered in depth in [Flame Graphs](../04-flame-graphs/junior.md)):

```bash
go tool pprof -http=:8080 cpu.out
```

**Other stacks, same idea.** Every mainstream language has a sampling profiler that produces the same kind of top list and flame graph:

| Stack | Tool | Sampling? |
|---|---|---|
| Go | `go tool pprof` | yes |
| Python | `py-spy` (`py-spy top -- python app.py`) | yes |
| Java / JVM | async-profiler, JFR | yes |
| Linux (any native) | `perf record` / `perf report` | yes |
| macOS | Instruments (Time Profiler) | yes |
| Rust | `cargo flamegraph` | yes |

The tool changes; the mental model — *interrupt, record the stack, count, rank by flat and cumulative* — does not.

> **Key insight:** The hardest part of profiling is starting. Two commands (`go test -cpuprofile`, then `go tool pprof`) and you have a real, ranked answer. Build the reflex: when something is slow, your first move is to capture a profile, not to open the file you suspect.

---

## Real-World Examples

**1. The 38% nobody suspected.** A team's order-import endpoint was slow. Everyone blamed the database query (it *looked* heavy — a big join). The first CPU profile showed the database call at 4% and `json.Unmarshal` at 38% — they were re-parsing a 2 MB config blob on *every* request instead of once at startup. The fix was three lines (parse once, cache it) and cut endpoint CPU by a third. Total time spent guessing about the database beforehand: two days. Time to find the truth with a profile: ninety seconds.

**2. The trivial function called 50 million times.** A Python data job took 40 minutes. `py-spy top` showed 60% of time in a five-line `normalize_key()` helper. The function wasn't slow — it was *called* inside a triple-nested loop, 50 million times, each call re-compiling a regex. Hoisting the regex compile out of the function (compile once, reuse) dropped the job to 9 minutes. No clever code was rewritten; the profile just revealed *frequency* the eye couldn't see.

**3. The satisfying rewrite that did nothing.** A developer spent a day replacing a recursive tree-walk with a slick iterative version "because recursion is slow." The before/after benchmark showed **zero** improvement — the tree-walk was 0.4% of the profile. The actual hot spot, untouched, was string formatting at 31%. This is the cautionary tale behind the golden rule: the change felt productive and measured nothing, because it was never profiled first.

---

## Mental Models

- **The profiler is a poll, not a census.** It doesn't interview every function; it samples a few hundred times a second and reports the trend. Like an election poll, it's sharp on the front-runner (the 38% function) and noisy on the long tail (the 0.2% functions). Trust it for the leader; ignore it for the stragglers.

- **Flat is the room, cumulative is the corridor.** Walking the profile is like walking a building. High *cumulative* functions are corridors — the expensive thing is somewhere down them, keep walking. High *flat* functions are the rooms where the work actually happens. You fix rooms, not corridors.

- **Hot ≠ wrong, hot = where the time is.** The top of the profile isn't a list of bugs. It's a list of *where the cycles went*. A function can be at 38% and be perfectly correct, well-written code — it just does a lot. Your job is to decide whether that "a lot" is necessary, not to assume it's broken.

- **The 30%/0.3% test.** Before optimising anything, find its share. A function at 30% can give you a real win — halve it and you've cut the whole program by 15%. A function at 0.3% cannot — perfect it to *zero* and the program is 0.3% faster, which nobody will ever notice. Effort should follow the percentage.

---

## Common Mistakes

1. **Optimising before profiling.** The cardinal sin. You rewrite the function you *suspect*, not the one that's actually hot. The fix is mechanical: capture a profile *first*, every time, even when you're "sure." You're not.

2. **Confusing flat and cumulative.** Seeing `main` or `handleRequest` at 95% cumulative and concluding "the problem is in `main`." It isn't — that's just the top of the tree; *everything* is under `main`. Look at **flat** time to find the function whose own code is expensive.

3. **Optimising the 0.3% function.** Spending a day shaving a function that's a rounding error in the profile, because the change was interesting or satisfying. Apply the 30%/0.3% test: if it's tiny, leave it, no matter how much you want to fix it.

4. **Not comparing before and after.** Making a change and *assuming* it helped. Without a second profile (or benchmark), you don't know — your "optimisation" may have done nothing or regressed. Measure, change, measure again.

5. **Profiling a toy input.** Running the profiler against a 10-row test fixture and trusting the result. With tiny input, startup and fixed costs dominate and the profile lies. Profile with a **realistic, large** workload — the one whose slowness you actually care about.

6. **Trusting tiny percentages.** Treating a 0.2% sampled number as precise. Sampling is statistically noisy at the bottom; that 0.2% could be 0.1% or 0.4%. Only act on numbers that are unambiguously large, or run longer to firm up the small ones.

---

## Test Yourself

1. In one sentence, what does a CPU profile measure — and what does it *not* measure?
2. A sampling profiler runs at 100 Hz for 5 seconds. Roughly how many samples does it collect, and how would it conclude that a function took "20% of CPU time"?
3. What's the difference between **flat** and **cumulative** time? Which one do you sort by to decide *what to fix*?
4. Your profile shows `main` at 99% cumulative and 0.1% flat. Is `main` the thing to optimise? Why or why not?
5. State the golden rule of performance work in one sentence, and give one reason human intuition is bad at finding hot spots.
6. A function is 0.3% of your profile. You have a clever idea to make it twice as fast. Should you? What's the best-case impact on the whole program?

<details>
<summary>Answers</summary>

1. It measures **what fraction of CPU time each function consumed** (a ranked distribution of on-CPU time). It does *not* measure call counts, wall-clock latency of a single request, or correctness — only where the cycles went.
2. About **500 samples** (100 × 5). A function "took 20%" if it appeared in ~20% of those samples (~100 of them); the profiler counts stack snapshots and converts the count to a percentage.
3. **Flat (self)** = time in the function's own body; **cumulative** = the function plus everything it calls. Sort by **flat** to decide what to *fix* (its own code is expensive); sort by cumulative to *navigate* to the expensive area.
4. **No.** 99% cumulative just means everything runs under `main` (it's the root); its 0.1% flat means its own code does almost nothing. The real work is in functions with high *flat* time further down.
5. **Profile, don't guess** — measure where the time goes before changing anything. Intuition is bad because expensive library calls (parsing, allocation) *look* cheap, and high call-frequency is invisible in the source.
6. **No.** Best case, you remove half of 0.3% = **0.15%** off the whole program — unmeasurable in practice. Spend that effort on a function near the top of the profile instead.

</details>

---

## Cheat Sheet

```
THE GOLDEN RULE
  Profile, don't guess. The hot spot is almost never where you'd guess.
  Measure → change → measure again. Skip either step = back to guessing.

WHAT A CPU PROFILE IS
  A ranked list: what % of CPU time each function used.
  A priority list, NOT a bug report. The value is the ranking.

SAMPLING (the kind you use 95% of the time)
  Profiler interrupts the program ~100x/sec, records the call stack, counts.
  Function in the most samples = hottest.
  Sharp at the top (40%), noisy at the bottom (0.2%). Cheap, honest, low distortion.

FLAT vs CUMULATIVE
  flat (self) = time in THIS function's own body         → sort by this to FIX
  cumulative  = this function + everything it calls       → sort by this to NAVIGATE
  high cum + low flat = a corridor; the work is deeper down.

CAPTURE A PROFILE (Go)
  go test -run=^$ -bench=BenchmarkX -cpuprofile=cpu.out   # record
  go tool pprof cpu.out                                    # open
    (pprof) top              # ranked list
    (pprof) list funcName    # per-line costs inside a function
  go tool pprof -http=:8080 cpu.out                        # flame graph in browser

OTHER STACKS (same idea)
  Python: py-spy top -- python app.py
  JVM:    async-profiler / JFR
  Linux:  perf record / perf report
  macOS:  Instruments (Time Profiler)
  Rust:   cargo flamegraph

THE 30% / 0.3% TEST
  30% function → worth fixing (halve it, cut the program ~15%)
  0.3% function → not worth it (perfect it to zero, nobody notices)
```

---

## Summary

- A **CPU profile** measures where your program spent CPU time, presented as a **ranked list** of functions by percentage. It's a *priority list* — it tells you where the time is, not what's wrong.
- The profiler you'll use is a **sampling profiler**: it interrupts the program ~100 times a second, records the **call stack**, and counts. The function seen in the most samples is the **hottest**. Sampling is cheap and honest — sharp on big numbers, noisy on tiny ones, with very little distortion of the program.
- The **golden rule** is *profile, don't guess*. The hot spot is almost never where intuition points, because expensive library calls look cheap and high call-frequency is invisible. Measure before *and* after every change.
- Read the top list by distinguishing **flat** (time in a function's own body — sort by this to decide *what to fix*) from **cumulative** (the function plus everything it calls — use this to *navigate* to the expensive area). High cumulative + low flat = a corridor, not the destination.
- Getting a first profile in Go is two commands: `go test -cpuprofile=cpu.out`, then `go tool pprof cpu.out` and type `top`. `py-spy`, `perf`, async-profiler, and Instruments do the same for other stacks.
- Apply the **30% / 0.3% test**: a function that's 30% of the profile is worth fixing; one that's 0.3% is not, no matter how satisfying the change would be.

Profiling is the skill that turns performance from an argument into a measurement. Once you can capture a profile and read its top list, every later topic — flame graphs, benchmarking, CPU-bound optimisation — is about acting on what the profile shows you, faster and more confidently.

---

## Further Reading

- [Go Blog — *Profiling Go Programs*](https://go.dev/blog/pprof) — the canonical walkthrough of `pprof` on a real program. Read it with a terminal open.
- [`pprof` README](https://github.com/google/pprof/blob/main/doc/README.md) — every command (`top`, `list`, `web`, `peek`) explained. Skim, then keep as reference.
- [Brendan Gregg — *CPU Flame Graphs*](https://www.brendangregg.com/flamegraphs.html) — the clearest writing on sampling profilers and visualising them. Background for [Flame Graphs](../04-flame-graphs/junior.md).
- [`py-spy`](https://github.com/benfred/py-spy) — sampling profiler for Python; `py-spy top` gives you the same top list with one command, no code changes.
- The [middle.md](middle.md) of this topic — wall-clock vs on-CPU time, why two profiles of the same program disagree, and symbolication (fixing `??` frames).

---

## Related Topics

- [Flame Graphs — Junior](../04-flame-graphs/junior.md) — the dominant way to *visualise* the call stacks a CPU profile records.
- [Benchmarking & Microbenchmarks — Junior](../../02-benchmarking-and-microbenchmarks/junior.md) — how to *measure* whether your profile-guided change actually helped.
- [CPU-Bound Optimization — Junior](../../04-cpu-bound-optimization/junior.md) — what to *do* once the profile tells you which function is hot.
- [CPU Profiling — Middle](middle.md) — wall-clock vs on-CPU profiles, call graphs, and symbolication, the next layer up from this page.
