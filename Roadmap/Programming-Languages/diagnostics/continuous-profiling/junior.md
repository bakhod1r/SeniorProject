# Continuous Profiling — Junior Level

> **Topic:** [Continuous Profiling Roadmap](README.md)
> **Focus:** What continuous profiling is, and why "always-on in production" beats "once on my laptop." The profile types (CPU, heap, off-CPU, goroutine, mutex). How to read a flame graph correctly. Running `go tool pprof` on a real service. How sampling profilers stay cheap.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Profiling vs the Other Three Signals](#profiling-vs-the-other-three-signals)
6. [The Profile Types](#the-profile-types)
7. [Real-World Analogies](#real-world-analogies)
8. [Mental Models](#mental-models)
9. [How a Sampling Profiler Works](#how-a-sampling-profiler-works)
10. [Reading a Flame Graph](#reading-a-flame-graph)
11. [Your First Profile — Code Examples](#your-first-profile--code-examples)
12. [What Profiling Costs](#what-profiling-costs)
13. [Use Cases](#use-cases)
14. [Coding Patterns](#coding-patterns)
15. [Best Practices](#best-practices)
16. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
17. [Common Mistakes](#common-mistakes)
18. [Tricky Points](#tricky-points)
19. [Test Yourself](#test-yourself)
20. [Cheat Sheet](#cheat-sheet)
21. [Summary](#summary)
22. [What You Can Build](#what-you-can-build)
23. [Further Reading](#further-reading)
24. [Related Topics](#related-topics)
25. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is a profile, and why run it continuously in production instead of once on a laptop?**

A **profile is a statistical map of where your program spends a resource.** A CPU profile answers "which functions were on the CPU, and for what fraction of the time?" A heap profile answers "which lines of code allocated the bytes that are still live?" The profiler does not watch every instruction — that would be ruinously expensive. Instead it **samples**: a few hundred times a second it interrupts the program, records the current call stack, and moves on. After a minute you have tens of thousands of stack samples, and the function that appears in 30% of them was, statistically, on the CPU 30% of the time. That sampling is the trick that makes profiling cheap enough to leave running forever.

The word **continuous** is the whole point of this roadmap. The traditional way to profile is reactive: a service is slow, you reproduce the problem on your laptop, run a profiler, stare at the output, fix it, and turn the profiler off. That works right up until the bug *only happens in production* — under real traffic, real data, a real contended database, a cache that's actually cold. You cannot reproduce it on your laptop, so the laptop profiler is useless. **Continuous profiling** runs the (cheap, sampled) profiler permanently on every process in the fleet and stores the results time-indexed, the same way metrics are stored. Now when the p99 latency spikes at 14:32, you don't reproduce anything — you pull up the flame graph *for 14:32 in production* and see exactly which code was burning the CPU.

This page covers the five profile types you'll meet (CPU, heap, off-CPU/wall-clock, goroutine/thread, mutex/block), how a sampling profiler stays cheap, and — the single most important skill — **how to actually read a flame graph**, including the rule that trips up everyone: *the width of a box is how many samples it appeared in, not the order things ran in.* The next level ([`middle.md`](middle.md)) sets up Pyroscope/Parca and the continuous pipeline; [`senior.md`](senior.md) covers diff profiles, off-CPU latency debugging, and overhead budgets.

> 🎓 **Why this matters for a junior:** When a senior says "did you check the profile?" they mean a real, recent, production flame graph — not a guess about which loop is slow. The engineer who can open a flame graph and immediately point at the widest tower at the top is worth ten who reason about performance from intuition. Intuition about performance is almost always wrong; the profile is almost always right.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small service or program in at least one language (Go, Python, Java, JavaScript, Rust). Go is used most here because its profiler is built in and the gold standard.
- **Required:** What a *call stack* is — function A calls B calls C. Flame graphs are nothing but call stacks, stacked up.
- **Helpful:** What "CPU-bound" vs "I/O-bound / waiting" means. The difference is the difference between a CPU profile and an off-CPU profile.
- **Helpful:** You've seen latency in metrics — a p99 graph. Profiling is what you reach for *after* a metric tells you something is slow.
- **Helpful:** Exposure to the other signals. See [`../metrics/junior.md`](../metrics/junior.md) and [`../tracing/junior.md`](../tracing/junior.md). Metrics tell you *that* it's slow; a trace tells you *which span*; the profile tells you *which line of code*.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Profile** | A statistical summary of where a program spent a resource (CPU time, allocated bytes, blocked time), attributed to call stacks. |
| **Sample** | One recorded call stack, captured when the profiler interrupted the program. Profiles are made of thousands of samples. |
| **Sampling profiler** | A profiler that interrupts the program periodically and records the stack, rather than instrumenting every call. Cheap, statistical. |
| **Instrumenting profiler** | A profiler that records *every* function entry/exit. Exact but expensive — usually too slow for production. |
| **Flame graph** | The standard visualization of a profile: stacked boxes where width = how many samples contained that stack frame. (Brendan Gregg.) |
| **Continuous profiling** | Running a cheap sampling profiler *permanently* in production and storing profiles time-indexed. The subject of this roadmap. |
| **CPU profile / on-CPU** | Where the program was spending actual CPU cycles. Answers "what's burning the processor?" |
| **Off-CPU / wall-clock** | Where the program was *waiting* (blocked on I/O, locks, channels). Answers "why is this slow even though CPU is idle?" |
| **Heap profile** | Where memory was allocated, attributed to the code that allocated it. Answers "what's eating RAM / churning the GC?" |
| **pprof** | Both Go's profiling toolchain *and* the protobuf profile format that became the industry's lingua franca. |
| **Symbolization** | Turning raw memory addresses in a stack into human-readable `package.Function` names, using debug info. |
| **Overhead** | The performance cost of running the profiler. For sampling profilers, typically ~1–2% CPU — low enough to leave on. |
| **Self vs total (flat vs cumulative)** | *Self/flat* = time in this function's own code. *Total/cumulative* = time in this function plus everything it called. |
| **Stack trace** | The chain of function calls active at one moment: `main → handler → query → scan`. One sample is one stack trace. |

---

## Core Concepts

### 1. A profile is statistical, not exact

The profiler does not measure your program. It *samples* it — hundreds of times a second it freezes the process, writes down the call stack, and unfreezes it. After enough samples, the proportions converge on the truth: a function in 30% of samples used ~30% of the resource. This means profiles have **noise** — a function that runs once for 2 ms might not appear at all if no sample landed on it. The fix is more samples (longer collection) or a higher sample rate, not a different tool. Internalising "this is a statistical estimate" stops you from over-trusting a single thin box.

### 2. On-CPU and off-CPU are different questions

A **CPU profile** shows where the program was *running*. But a request can be slow while the CPU is nearly idle — it's *waiting* on a database, a lock, a network call, a channel. A CPU profile is blind to waiting; it will look empty or healthy. To debug that, you need an **off-CPU / wall-clock profile**, which captures where the program was *blocked*. The junior reflex "it's slow, show me the CPU profile" is right half the time. The other half, the CPU profile is flat and the answer is in the off-CPU profile.

### 3. Continuous beats occasional because the bug lives in production

The reason to run the profiler always-on is that **the slow path is the one your tests never hit**. Production has the real data distribution, the real concurrency, the real cache state, the real noisy neighbours. A laptop profile of synthetic input profiles a different program. Continuous profiling means when the incident happens, the evidence already exists — you query history instead of trying (and usually failing) to reproduce.

### 4. The flame graph's width is samples, not time

This is the rule everyone gets wrong first. In a flame graph, the **x-axis is not time and the left-to-right order means nothing.** Width encodes *how many samples a frame appeared in* — i.e. how much of the resource it used. Frames are sorted alphabetically, not chronologically. You read a flame graph by finding the **widest towers**, especially the wide boxes at the *top* (the leaf functions actually consuming the resource). A wide box low down just means "a lot happened underneath me."

### 5. Sampling is what makes it cheap enough to leave on

Because the profiler only acts a few hundred times a second — not on every instruction — its cost is roughly proportional to the sample rate, not to how much work your program does. That's why it lands around 1–2% overhead and why "profile everything, always, in production" is a sane default rather than a luxury. An *instrumenting* profiler that timestamped every function call would be 10–100× slower and could never run in prod.

---

## Profiling vs the Other Three Signals

Continuous profiling is the **fourth signal of observability.** It doesn't replace the other three; it answers a question they can't.

| | **Metric** | **Trace** | **Log** | **Profile** |
|---|---|---|---|---|
| **Answers** | "Is something slow?" | "Which span was slow?" | "What happened to this request?" | "Which *line of code* burned the resource?" |
| **Granularity** | Aggregate number | One request's path | One event | Function/line, aggregated over a window |
| **Typical use** | Alert fires: latency up | Find the slow service | Read the error message | Find the hot function inside that service |
| **Cost model** | Constant | Sampled (~1%) | Scales with volume | Sampled (~1–2% CPU) |

The chain in practice: a **metric** alerts you that p99 latency rose. A **trace** shows the time is spent inside `checkout-service`. The **profile** for that service, at that timestamp, shows the time is in `json.Marshal` called from `serializeCart` — the actual line to fix. Metrics and traces tell you *where* to look; the profile tells you *what the code was doing.*

---

## The Profile Types

| Type | Resource it maps | Answers | When you reach for it |
|------|------------------|---------|------------------------|
| **CPU (on-CPU)** | CPU time / cycles | "What's burning the processor?" | High CPU, compute-bound latency |
| **Heap / allocation** | Bytes allocated (or live) | "What's allocating / eating RAM / churning GC?" | High memory, frequent GC, OOMs |
| **Off-CPU / wall-clock** | Time spent *blocked* | "Why is it slow while CPU is idle?" | Latency with low CPU — I/O, locks, waits |
| **Goroutine / thread** | Count & state of goroutines/threads | "Are goroutines leaking? What are they all stuck on?" | Goroutine/thread leak, stuck workers |
| **Mutex / block (lock contention)** | Time waiting on locks | "Which lock is serialising my concurrency?" | Throughput plateau under load, contention |

Two distinctions a junior must keep straight:

- **CPU vs off-CPU.** CPU = running. Off-CPU = waiting. A latency problem can live in either. Check CPU first; if it's flat, the answer is off-CPU.
- **Allocated vs in-use heap.** The heap profile has two flavours: *alloc* (everything ever allocated — good for finding GC pressure) and *inuse* (what's live right now — good for finding leaks). Pick the right one or you'll chase the wrong bytes.

---

## Real-World Analogies

- **The hospital triage nurse (sampling).** The nurse doesn't take every patient's full history every second. They glance at the waiting room periodically and note "three chest pains, one broken arm." After enough glances, they know the ward's load distribution — without examining anyone continuously. That's sampling: cheap snapshots that, in aggregate, tell the truth.
- **A heat map of a city, not a GPS trail (flame graph).** A flame graph is a heat map of where time *piled up*, not a route showing the order you visited places. The widest red zones are where the resource went. Asking "but what happened first?" misreads the picture — that's what a *trace* is for.
- **A dashcam that's always recording (continuous).** You don't install a dashcam *after* the crash. It records continuously, cheaply, and when the crash happens the footage already exists. Continuous profiling is the dashcam for your production CPU.
- **A doctor checking your pulse vs running a full scan (the four signals).** Pulse = metric (cheap, always-on, "something's wrong"). Symptom interview = trace ("the pain is in your left arm"). The MRI = profile ("here's the exact tissue"). You don't MRI everyone constantly — but a cheap, always-on MRI changes the game, and that's what continuous profiling is.

---

## Mental Models

- **"The profile is the ground truth; your intuition is a hypothesis."** Never optimise based on where you *think* the time goes. Profile, then optimise the widest box. Performance intuition is famously, reliably wrong.
- **"Width = how much, height = how deep, top = where it actually happened."** Read flame graphs top-down for the leaves (the code actually consuming the resource), and look for the *widest* leaf, not the leftmost.
- **"Continuous profiling is metrics for code paths."** Just as a metric is a number over time you can query, a continuous profile is a *flame graph over time* you can query. "Show me CPU usage by function for the last hour" is the profiling equivalent of a PromQL query.
- **"CPU profile when it's hot, off-CPU profile when it's waiting."** Match the profile type to the symptom.

---

## How a Sampling Profiler Works

A CPU sampling profiler works like this:

1. A timer (or a hardware **perf event** like "every N CPU cycles") fires, say, 100 times per second.
2. On each tick, the profiler **interrupts** the running thread and **walks its call stack** — reading the chain of return addresses to reconstruct `main → handler → query → scan`.
3. It records that stack as one **sample** and lets the program continue.
4. After collection ends, all the samples are **aggregated**: identical stacks are counted together, so `... → scan` appearing in 3,000 of 10,000 samples means `scan` (and its callers) used ~30% of the CPU.
5. Raw addresses are **symbolized** into function names using the binary's debug info.

Because it only acts on the timer tick — not on every function call — the cost is bounded by the sample rate, giving the ~1–2% overhead that makes always-on viable. This is **statistical sampling**, and its accuracy improves with more samples. Contrast with an **instrumenting profiler**, which inserts a timer around every function entry and exit: exact call counts, but it can slow the program by an order of magnitude — fine for a microbenchmark, impossible in production.

An **off-CPU** profiler works inversely: instead of sampling who's *on* the CPU, it records stacks at the moments a thread goes to *sleep* (blocks on a syscall, lock, or channel) and how long it stayed asleep — mapping where the program *waited*.

---

## Reading a Flame Graph

This is the one skill to actually master. A flame graph (Brendan Gregg's invention) renders a profile as stacked boxes:

```text
   ┌──────────────────────────────────────────────────────────┐
   │                          main                            │  ← root, full width
   ├───────────────────────────┬──────────────────────────────┤
   │        handleRequest       │        backgroundJob         │
   ├──────────────┬─────────────┼───────────────┬──────────────┤
   │  parseJSON   │  queryDB     │  compress     │   sleep      │
   ├──────────────┤             ┌┴────────┐      │              │
   │ json.Unmarshal│            │ scanRows │      │             │  ← widest LEAF = the hot line
   └──────────────┘             └─────────┘      └──────────────┘
        ▲                            ▲
   23% of samples              41% of samples  ←  optimise THIS first
```

The rules:

1. **Each box is a function.** A box sits on top of the function that called it. The stack grows upward (flame) or downward (icicle — same data, flipped).
2. **Width = number of samples containing that frame = share of the resource.** A box twice as wide used twice the CPU/bytes/time.
3. **The x-axis is NOT time.** Left-to-right order is *not* execution order — frames are sorted alphabetically. Do not read a flame graph like a timeline. (If you want a timeline, you want a *trace*, not a profile.)
4. **Look at the top.** The topmost boxes are the *leaf* functions — the code actually on the CPU when sampled. A wide box at the bottom (`main`) is meaningless; a wide box at the *top* (`json.Unmarshal`, `scanRows`) is your target.
5. **Find the widest tower, optimise from the top down.** In the sketch, `scanRows` at 41% is the single biggest win.

**Flame vs icicle:** a *flame* graph grows up from the root (`main` at the bottom); an *icicle* graph hangs down from the root (`main` at the top). Identical information, just orientation. Pyroscope defaults to icicle; classic Brendan-Gregg SVGs are flame. Don't let the flip confuse you.

---

## Your First Profile — Code Examples

### Go — the gold standard, built into the language

Go's profiler is built in and is the reference implementation everyone else imitates. Add one import and you get live CPU/heap/goroutine/mutex/block profiles over HTTP:

```go
package main

import (
    "net/http"
    _ "net/http/pprof" // registers /debug/pprof/* handlers as a side effect
)

func main() {
    go func() {
        // expose profiling endpoints on a side port
        http.ListenAndServe("localhost:6060", nil)
    }()

    // ... your real server ...
    select {}
}
```

Now, while the program runs, collect a 30-second CPU profile and open the interactive flame graph in a browser:

```bash
# Collect 30s of CPU profile and open the web UI (flame graph + top + source)
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=30

# Heap (memory) profile
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap

# Goroutine profile — great for finding leaks/stuck goroutines
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/goroutine
```

In the text REPL instead of the browser:

```bash
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
(pprof) top         # top functions by self CPU
(pprof) top -cum    # top by cumulative (function + callees)
(pprof) list scanRows   # annotated source, line-by-line cost
(pprof) web         # render an SVG call graph
```

> ⚠️ **Don't expose `net/http/pprof` on a public port.** Those endpoints leak internals and let anyone trigger a profile (a small DoS). Bind it to localhost or an internal admin port behind auth.

### Python — py-spy, no code changes, profile a running process

`py-spy` attaches to an *already-running* Python process by PID — no `import`, no restart:

```bash
pip install py-spy

# Live top-like view of where CPU goes
py-spy top --pid 12345

# Record 30s and write an interactive flame graph SVG
py-spy record --pid 12345 --duration 30 --output profile.svg
```

### JVM — async-profiler, the production standard

```bash
# Attach to a running JVM by PID, profile CPU for 30s, emit a flame graph HTML
./asprof -d 30 -e cpu -f flame.html <pid>

# Allocation profiling instead of CPU
./asprof -d 30 -e alloc -f alloc.html <pid>
```

Java also ships **JFR (Java Flight Recorder)**, a built-in low-overhead recorder you can run continuously (covered in [`middle.md`](middle.md)).

### Node.js — built-in and tooling

```bash
# Built-in V8 profiler; produces isolate-*.log, then process it
node --prof app.js
node --prof-process isolate-*.log > processed.txt

# Friendlier: 0x produces an interactive flame graph in one command
npx 0x app.js
```

The whole point of `py-spy` and async-profiler attaching by PID is that you can profile production *without redeploying* — the seed of continuous profiling.

---

## What Profiling Costs

| Profiler kind | Typical overhead | Safe in prod? |
|---------------|------------------|---------------|
| CPU sampling (~100 Hz) | ~1–2% CPU | ✅ Yes — leave it on |
| Heap sampling (Go default) | Negligible (samples every ~512 KB allocated) | ✅ Yes |
| Off-CPU / wall-clock | Low–moderate (depends on block-event rate) | ✅ Usually |
| Mutex/block profiling | Low, but set a *rate* (Go: `SetMutexProfileFraction`) | ✅ With a sane fraction |
| **Instrumenting** profiler | 10–100× slowdown possible | ❌ Microbenchmarks only |

The lesson: **sampling profilers are cheap because they're statistical.** Their cost scales with the sample *rate*, not your workload, which is exactly why "always on" is affordable.

---

## Use Cases

- **A latency spike at 14:32.** Metrics alerted, the trace points at `search-service`. You pull the CPU profile *for 14:32* and see 60% in a regex compile that should have been cached. No reproduction needed.
- **A slow endpoint with idle CPU.** CPU profile is flat. The *off-CPU* profile shows every request blocked 200 ms on a single un-pooled DB connection.
- **A memory leak.** The `inuse` heap profile shows live bytes growing in a cache that never evicts. (See the `memory-leak-detection` skill for the systematic hunt.)
- **A goroutine leak.** The goroutine profile shows 80,000 goroutines all parked on the same channel receive — a producer died and consumers wait forever.
- **GC pauses.** The `alloc` heap profile shows a hot path allocating a fresh buffer per request; pooling it cuts allocations 90% and GC pauses with them.

---

## Coding Patterns

```go
// PATTERN: gate profiling endpoints behind an internal-only mux, never the public one.
func startAdminServer() {
    mux := http.NewServeMux()
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    http.ListenAndServe("127.0.0.1:6060", mux) // localhost only
}
```

```go
// PATTERN: enable mutex/block profiling with a sampling fraction (off by default in Go).
import "runtime"

func init() {
    runtime.SetMutexProfileFraction(5) // sample ~1/5 of contention events
    runtime.SetBlockProfileRate(10000) // sample blocking ~1 per 10µs blocked
}
```

```python
# PATTERN: profile a running prod process without redeploying — py-spy by PID.
# py-spy dump --pid <pid>   # one-shot: what is every thread doing right now?
```

---

## Best Practices

- **Profile before you optimise. Always.** The number-one rule. Optimise the widest box, not the one you suspect.
- **Match the profile type to the symptom.** Hot CPU → CPU profile. Slow but idle → off-CPU. Growing RAM → `inuse` heap. Leaking goroutines → goroutine profile.
- **Collect long enough.** A 1-second CPU profile is noise. 30 seconds is a reasonable default; longer for rare paths.
- **Read flame graphs top-down, widest-first.** The leaf is the line to fix.
- **Keep pprof endpoints internal.** Localhost or an authenticated admin port — never public.
- **Use the language's built-in path when it exists.** Go's `net/http/pprof` and the JVM's JFR are low-overhead and trusted.

---

## Edge Cases & Pitfalls

- **A flat CPU profile doesn't mean "fast."** It means the program wasn't burning CPU — it might have been *waiting*. Switch to off-CPU.
- **Inlining hides functions.** The compiler may inline a small function into its caller, so it never appears as its own frame. Don't conclude "that function isn't called."
- **Stripped binaries can't be symbolized.** Without debug info you get hex addresses, not names. Keep symbols (or upload them) for production binaries.
- **A short-lived process gives a thin profile.** If the process exits in 2 seconds you collected almost no samples. Profile something that runs long enough.
- **Heap `alloc` vs `inuse` answer different questions.** Chasing a leak with `alloc` (which includes freed memory) wastes hours. Use `inuse` for leaks.

---

## Common Mistakes

| Mistake | Why it's wrong | Fix |
|---|---|---|
| Reading the flame graph left-to-right as a timeline | The x-axis is samples, not time | Read widest-first, top-down; use a *trace* for timelines |
| Optimising the leftmost box | Position is alphabetical, not importance | Optimise the *widest* leaf |
| Using a CPU profile for a waiting-bound slowness | CPU profile is blind to blocking | Use off-CPU / wall-clock |
| Exposing `/debug/pprof` publicly | Leaks internals, enables DoS | Bind to localhost / admin port |
| Trusting a 2-second profile | Too few samples; statistical noise | Collect 30s+ |
| Profiling on the laptop to debug a prod-only bug | Different data, concurrency, cache | Profile in production (continuously) |

---

## Tricky Points

- **"Self" vs "total."** A function with huge *total* but tiny *self* isn't the problem — its callees are. Optimise the function with high *self* time (the one doing the work itself).
- **The profiler can lie about rare events.** A function that ran for 5 ms once may not appear if no sample landed on it. Absence in a profile is weak evidence; presence is strong.
- **Allocations and CPU are different graphs.** A line can be cheap on CPU but allocate heavily (driving GC). Check both heap and CPU before concluding.
- **Continuous ≠ a different tool.** It's the *same* sampling profiler, run permanently and stored time-indexed. The novelty is the pipeline, not the profiler.

---

## Test Yourself

1. In a flame graph, what does the **width** of a box mean? What does the **left-to-right position** mean?
2. A request takes 300 ms but the CPU profile is nearly empty. What profile type do you reach for, and why?
3. Why can a sampling profiler run continuously in production when an instrumenting one cannot?
4. You're hunting a memory leak. Do you use the heap `alloc` profile or `inuse`? Why?
5. What single import gives a Go service live CPU/heap/goroutine profiles, and what's the security caveat?
6. Name the five profile types and the one question each answers.

<details>
<summary>Answers</summary>

1. Width = how many samples contained that frame = its share of the resource. Left-to-right position means **nothing** (alphabetical, not time order).
2. **Off-CPU / wall-clock** — the time is spent *waiting* (I/O, lock, channel), which a CPU profile can't see.
3. Sampling acts only on a timer tick (~100 Hz), so cost is bounded by sample rate (~1–2%), not workload. Instrumenting times every call — 10–100× overhead.
4. **`inuse`** — it shows live bytes right now; a leak is memory that stays live. `alloc` includes already-freed bytes and would mislead.
5. `import _ "net/http/pprof"`. Caveat: never expose it publicly — bind to localhost/admin port.
6. CPU (what's burning the processor), heap (what's allocating/eating RAM), off-CPU (where it's waiting), goroutine/thread (leaks/stuck), mutex/block (lock contention).

</details>

---

## Cheat Sheet

```text
PROFILE = statistical map of where a resource went, by call stack.
SAMPLING = interrupt ~100×/s, record the stack → cheap (~1-2%) → always-on viable.

PROFILE TYPES
  CPU (on-CPU) ...... what's burning the processor
  heap/alloc ........ what's allocating / churning GC   (use 'alloc')
  heap/inuse ........ what's live now / leaking          (use 'inuse')
  off-CPU/wall ...... where it's WAITING (I/O, lock, chan)
  goroutine/thread .. leaks, stuck workers
  mutex/block ....... lock contention

FLAME GRAPH
  width  = #samples = share of resource   (NOT time!)
  x-pos  = alphabetical                    (NOT execution order!)
  top    = leaf = the line actually consuming → optimise WIDEST leaf
  flame  = grows up   |   icicle = hangs down   (same data)

GO (gold standard)
  import _ "net/http/pprof"
  go tool pprof -http=:8080 http://host:6060/debug/pprof/profile?seconds=30
  (pprof) top / top -cum / list <fn> / web

OTHERS (attach by PID, no redeploy)
  py-spy record --pid <pid> -d 30 -o flame.svg
  asprof -d 30 -e cpu -f flame.html <pid>      # JVM async-profiler
  npx 0x app.js                                # Node

RULE: profile FIRST, optimise the widest box. Intuition is wrong.
```

---

## Summary

- A **profile is a statistical map** of where a resource (CPU, bytes, blocked time) went, attributed to call stacks. It's built by **sampling** — interrupting the program ~100×/s and recording the stack.
- Sampling is why profiling is **cheap (~1–2%)** and why **continuous, always-on, production** profiling is viable — the opposite of the one-off laptop profile.
- **Continuous beats occasional** because the bug lives in production: real data, real concurrency, real cache. The evidence already exists when the incident hits.
- The **five profile types**: CPU (burning), heap (allocating/leaking — `alloc` vs `inuse`), off-CPU (waiting), goroutine/thread (leaks), mutex/block (contention). Match the type to the symptom.
- **Reading a flame graph:** width = samples = share of resource; **x-axis is NOT time**; read top-down, optimise the **widest leaf**. Flame grows up, icicle hangs down — same data.
- Profiling is the **fourth observability signal**: metric says *that* it's slow, trace says *which span*, profile says *which line of code*.
- Go's `net/http/pprof` is the gold standard; `py-spy`, async-profiler, and `0x` attach to live processes by PID. Keep endpoints **internal**.

---

## What You Can Build

- A **"read the flame graph" drill:** take 5 sample SVGs (Go, Python, JVM) and, for each, point at the widest leaf and name the line to optimise — without running anything.
- A **deliberately slow Go service** with one obvious hot loop, instrumented with `net/http/pprof`. Profile it, find the loop, fix it, re-profile, and watch the box shrink.
- A **CPU-vs-off-CPU demo:** one endpoint that spins the CPU and one that sleeps on I/O. Profile both, show that the CPU profile catches the first and misses the second.
- A **py-spy-on-prod simulation:** a long-running Python script you attach to *by PID* with `py-spy top`, proving you can profile without restarting.
- An **alloc-hotspot reproduction:** a Go handler allocating a buffer per request; heap-profile it, pool the buffer, re-profile, and measure the GC drop.

---

## Further Reading

- **Brendan Gregg — "Flame Graphs"** — <https://www.brendangregg.com/flamegraphs.html>. The original, and the source of the "width is samples, not time" rule.
- **The Go Blog — "Profiling Go Programs"** — <https://go.dev/blog/pprof>. The canonical `go tool pprof` tutorial.
- **`net/http/pprof` docs** — <https://pkg.go.dev/net/http/pprof>.
- **py-spy** — <https://github.com/benfred/py-spy>. Sampling profiler that attaches to running Python by PID.
- **async-profiler** — <https://github.com/async-profiler/async-profiler>. The JVM production-profiling standard.
- The **`profiling-techniques`** skill — for the laptop-side mechanics of generating and benchmarking flame graphs.

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — setting up the continuous pipeline (Pyroscope/Parca), the pprof format, language SDKs, querying profiles over time.
- **Senior level:** [senior.md](senior.md) — differential flame graphs, off-CPU latency debugging, overhead budgets, profile-to-trace correlation.
- **Professional level:** [professional.md](professional.md) — fleet rollout, eBPF whole-system profiling, deploy-gate regression detection, storage/cost at scale.
- **Interview prep:** [interview.md](interview.md).
- **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Metrics — Junior](../metrics/junior.md) — the signal that *alerts* you something is slow.
- [Tracing — Junior](../tracing/junior.md) — narrows the slowness to a span; the profile narrows it to a line.
- [Logging](../logging/) — the per-event pillar.
- [Observability Engineering](../observability-engineering/) — how the four signals fit together.
- [Dynamic Instrumentation & eBPF](../dynamic-instrumentation-and-ebpf/) — the kernel tech behind language-agnostic profiling.

**Cross-roadmap links:**

- [Quality Engineering → Performance → Profiling](../../quality-engineering/performance/01-profiling/) — the one-off, laptop, "now I'll fix this function" counterpart. This page finds the function in prod; that one teaches you to optimise it.

---

## Diagrams & Visual Aids

### The four signals working together

```text
   METRIC   ▁▂▅█▅  "p99 latency jumped at 14:32"          ← alerts you
      │
      ▼
   TRACE    ├─api─┬─ search-svc 480ms ──┬─ render 12ms     ← which span
      │           └─ cache 2ms          └─ db 30ms
      ▼
   PROFILE  (search-svc CPU @ 14:32)                       ← which LINE
            ████████ regexp.Compile  60%  ← the fix
            ██ json.Unmarshal 14%
      │
      ▼
   LOG      "search: recompiled pattern (cache miss) ..."  ← the why/context
```

### Sampling, conceptually

```text
  program timeline ────────────────────────────────────────►
        ▲     ▲     ▲     ▲     ▲     ▲     ▲     ▲          ← timer ticks (~100/s)
     [stackA][stackB][stackA][stackA][stackC][stackA]...     ← recorded samples
                                                  │
                            aggregate identical stacks
                                                  ▼
            stackA: 60%   stackB: 25%   stackC: 15%   ← the profile
```

### Flame vs icicle (same data, flipped)

```text
   FLAME (grows up)                 ICICLE (hangs down)
        leaf  leaf                    main ──────────────
     ┌─────┐┌─────┐                  ┌──────┬───────────┐
     │ B   ││  C  │                  │  A   │    D      │
   ┌─┴─────┴┴─────┴─┐               ┌┴───┬──┴┐      ┌───┴┐
   │       A        │               │ B  │ C │      │... │
   ├────────────────┤  vs            └────┴───┘      └────┘
   │      main      │                   leaf  leaf
   └────────────────┘
   root at bottom                    root at top
```
