# CPU Profiling — Middle Level

> **Roadmap:** [Profiling](../README.md) → [CPU Profiling](README.md) → Middle
> *The junior page told you to chase the function that's 30% of the profile. This page explains where that 30% number comes from — it's a statistical estimate from a few thousand stack samples, not a measurement — and the two ways to misread it that send you optimizing code that was never the problem.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How a Sampling Profiler Actually Works](#how-a-sampling-profiler-actually-works)
4. [Sample Rate vs Overhead vs Accuracy](#sample-rate-vs-overhead-vs-accuracy)
5. [The Profile Is a Sample of the Truth](#the-profile-is-a-sample-of-the-truth)
6. [Wall-Clock vs On-CPU — Why the Two Profiles Disagree](#wall-clock-vs-on-cpu--why-the-two-profiles-disagree)
7. [Flat vs Cumulative — Self vs Total](#flat-vs-cumulative--self-vs-total)
8. [Symbolication — Why Frames Show `??`](#symbolication--why-frames-show-)
9. [Safepoint Bias and Why async-profiler Exists](#safepoint-bias-and-why-async-profiler-exists)
10. [The Toolbelt](#the-toolbelt)
11. [Worked Example — Capture, Top, List a Hot Function](#worked-example--capture-top-list-a-hot-function)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do sampling profilers actually work, and how do I read a profile without lying to myself?**

At the junior level a profile is a ranked list: the top function is the bottleneck, go fix it. That model is right often enough to be dangerous, because it hides two facts that quietly invert your conclusions.

The first: **the numbers are estimates.** A profiler doesn't watch every instruction — it interrupts the program a few thousand times a second and writes down the call stack. "This function is 30% of CPU" really means "this function was on top of stack in ~30% of the samples we happened to take." That's a poll, with all of a poll's caveats: a real cost can be invisible if it never coincided with a sample.

The second: **a profile answers exactly one question, and there are two questions you might be asking.** "Where is wall-clock time going?" and "Where is the CPU burning cycles?" are different questions with different answers, and pointing the wrong profiler at your problem is how a senior engineer spends a day optimizing a function that was *blocked on I/O*, not computing anything.

This page makes the machinery concrete — `SIGPROF`, `perf_events`, sample rates, flat vs cumulative, symbolication, safepoint bias — with the actual tools and their actual output, so you read profiles instead of guessing about them.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can capture a profile and find the top function.
- **Required:** Comfortable on the command line; you can run `go tool pprof`, `perf`, or your platform's profiler.
- **Helpful:** You know what a call stack is and that one exists per thread/goroutine.
- **Helpful:** A rough sense of the difference between "running on a CPU" and "waiting" (for a lock, disk, network).

---

## How a Sampling Profiler Actually Works

There are two families. **Instrumenting** profilers add code at every function entry/exit to count and time calls — exact, but they distort the very thing they measure (a 5 ns function with 20 ns of instrumentation reports nonsense, and inlining is defeated). Almost every profiler you'll use in production is the other kind: a **sampling** profiler.

A sampling profiler does one thing on a timer: **stop the program, walk the current call stack, record it, resume.** Do that a few thousand times a second and the resulting pile of stacks is a statistical portrait of where time is spent. Two mechanisms drive the timer:

**Signal/timer-driven (the classic Unix model).** The kernel is asked for a periodic timer that fires `SIGPROF`. The profiler's signal handler runs *in the context of whatever was executing*, captures that thread's stack, and returns. Go's runtime uses exactly this:

```
setitimer(ITIMER_PROF, every 10ms) → SIGPROF → runtime handler walks the
goroutine stack → append to profile buffer
```

Because `SIGPROF` is delivered against CPU time consumed (not real time), a thread that's *asleep* receives no ticks — which is precisely why this model measures **on-CPU** time. A blocked thread is, by construction, invisible to it.

**PMU / `perf_events` (hardware-assisted).** Modern CPUs have a Performance Monitoring Unit: hardware counters that can be programmed to raise an interrupt every *N* events. Set the event to `cpu-clock` and you get a time-based sampler; set it to `cache-misses` or `branch-misses` and you sample on *that* event instead — "show me the stacks where cache misses happen." Linux `perf` is the front end:

```bash
perf record -F 999 -g -- ./myprogram      # 999 Hz, with call graphs (-g)
```

`-F 999` requests 999 samples/sec. (999, not 1000, is a folk convention — an off-round frequency avoids *lock-step aliasing* with periodic work that happens to tick at exactly 1000 Hz.) The PMU approach can profile the whole machine, kernel included, and across all threads at once.

> **Key insight:** A sampling profiler doesn't *measure* time spent in a function — it *counts how often that function was caught on the stack* and multiplies by the sample period. Every number you read is `sample_count × period`, an estimate. This single fact is the source of every "the profiler is lying" surprise later on the page.

---

## Sample Rate vs Overhead vs Accuracy

The sample rate is the one knob you'll touch most, and it's a three-way trade-off.

| Rate | Samples/sec | Overhead | Resolution | Use when |
|---|---|---|---|---|
| Low | 99 | negligible | coarse | always-on production profiling |
| Default | ~100–1000 | low (1–3%) | good | most local/staging work |
| High | 4000–10000 | noticeable (5–15%+) | fine | short, sharp hot path you can't otherwise see |

Three forces pull against each other:

- **Higher rate → more accuracy.** More samples shrink the statistical error (see next section). A function that's genuinely 2% of CPU needs *enough* samples before it rises above the noise.
- **Higher rate → more overhead.** Every sample is a stop-walk-resume. At 10 kHz on a deep stack, the act of profiling starts to show up *in the profile* — you measure the measurement.
- **Higher rate → diminishing returns and aliasing risk.** Past a point you're paying overhead for samples that don't change the ranking, and round frequencies can resonate with periodic work.

Go fixes its CPU profile rate at 100 Hz and deliberately won't let you raise it far — the maintainers decided the accuracy gain past that wasn't worth the distortion. `perf` lets you push to thousands but will warn (or silently cap, via `kernel.perf_event_max_sample_rate`) when you ask for more than the kernel allows.

> **Key insight:** There is no "correct" sample rate, only a correct rate *for a question*. Always-on production wants low overhead and accepts coarse data; a 200 ms hot path you're trying to dissect wants a high rate for a short window and accepts the overhead. Pick the rate for the job, not a default you copied.

---

## The Profile Is a Sample of the Truth

Because a profile is a poll, it has a poll's **sampling error**. The rule of thumb: the relative error on a function's measured share is roughly `1/√n`, where `n` is the number of samples landing in that function.

Work it out. A 30-second run at 100 Hz gives **3000 samples** total. A function that's truly 20% of CPU catches ~600 of them — `1/√600 ≈ 4%` error, so you'll read it as somewhere around 19–21%. Solid. But a function that's truly **1%** catches ~30 samples — `1/√30 ≈ 18%` error — so it reads anywhere from 0.8% to 1.2%, and its *rank* against its neighbours is basically noise. And a function that runs for 50 µs total over the whole run? Expected samples: **0.015**. It will almost certainly appear **nowhere in the profile at all.**

This produces three concrete reading habits:

1. **Trust the head, distrust the tail.** The top few entries are statistically solid. The long tail of sub-1% functions is mostly noise; don't rank-order it or optimize within it.
2. **Rare-but-expensive work hides.** A function called once that takes 8 ms is real, costly work — but at 100 Hz it expects *under one sample* and may be invisible. Sampling profilers are blind to infrequent events by design. (This is when an instrumenting profiler, or a targeted benchmark, earns its keep.)
3. **Profile long enough.** A 2-second profile of a service is ~200 samples total — too few to trust below the top item or two. Capture 30–60 seconds of representative load.

> **Key insight:** "Not in the profile" does **not** mean "free." It means "didn't coincide with enough samples." A sampling profiler is a flashlight that blinks 100 times a second — anything that moves between blinks is unseen. Before concluding a function is cheap, ask whether the profile could even have *caught* it.

---

## Wall-Clock vs On-CPU — Why the Two Profiles Disagree

This is the distinction that separates people who read profiles from people who are misled by them.

- **On-CPU time** answers *"which code is burning CPU cycles?"* The clock only advances while a thread is actually running on a core. Time spent blocked — waiting on a mutex, a disk read, a network round-trip, a channel — does **not** count.
- **Wall-clock time** answers *"where is real, elapsed time going?"* It counts everything from a function's entry to its exit, **including** time the thread spent parked, waiting.

Why they disagree: a function can dominate *wall-clock* time while barely appearing in the *on-CPU* profile, because it spends its time **blocked, not computing.**

```go
func handleRequest() {
    rows := db.Query(sql)   // 95 ms — blocked on the network, ~0 CPU
    return transform(rows)  // 3 ms — actual CPU work
}
```

Profile this **on-CPU** (the default for `pprof` and `perf`) and `handleRequest` is nearly *absent* — it burned almost no cycles; it was asleep waiting for the database. Your CPU profile correctly says "the CPU isn't the problem here." Profile it **wall-clock** and `handleRequest` is 98% of the time — correctly saying "elapsed time is dominated by that query."

Both are right. They answer different questions. The catastrophe is pointing an on-CPU profiler at a latency problem, seeing your slow endpoint is "only 2% of CPU," and concluding it's fine — when the real story is a 95 ms blocking wait that an on-CPU profiler is *built to ignore*.

The off-CPU side has its own tools: Go's **block** and **mutex** profiles (where goroutines wait on synchronization), and on Linux, **off-CPU profiling** via `perf`/eBPF that captures stacks at the moment a thread goes off-CPU. The senior move is to know *which* question you're asking before you capture.

> **Key insight:** Default profilers (`pprof`, `perf record`) measure **on-CPU** time. If your symptom is *latency* (a slow request) rather than *throughput / high CPU*, the on-CPU profile may be nearly empty exactly where the problem is — because the problem is *waiting*, and waiting burns no CPU. Reach for wall-clock, block, or off-CPU profiling instead.

---

## Flat vs Cumulative — Self vs Total

Every profile reports each function two ways, and confusing them is the single most common reading error.

- **Flat** (a.k.a. **self**): time spent executing *the instructions of this function itself* — its own loops and arithmetic, **not** its callees.
- **Cumulative** (a.k.a. **total**): flat time **plus** everything its callees consumed. A function's cumulative time includes its whole subtree.

`main` has tiny flat time (it mostly just calls things) but ~100% cumulative time (everything happens beneath it). A tight inner loop has high flat *and* high cumulative. Here's `pprof`'s top view, both columns side by side:

```
      flat  flat%   sum%        cum   cum%
     1.84s 42.59% 42.59%      1.84s 42.59%  compress.deflate          ← hot LEAF
     0.71s 16.44% 59.03%      0.71s 16.44%  runtime.memmove
     0.02s  0.46% 59.49%      3.10s 71.76%  http.(*conn).serve        ← wrapper
     0.00s  0.00% 59.49%      3.10s 71.76%  http.ListenAndServe       ← pure pass-through
```

Read this correctly: `ListenAndServe` is **71.76% cumulative** but **0% flat**. It is *not* slow — it does nothing itself; it just sits above all the work. `compress.deflate` is **42.59% flat** — *that* is where the CPU actually is. The classic blunder is sorting by cumulative, seeing `ListenAndServe`/`serve` at the top, and "optimizing" a wrapper that contains no hot instructions at all.

The discipline:

- **To find where CPU is actually burned, sort by flat.** High flat = real cycles in *this* function's own code. That's your optimization target.
- **To find which call path is expensive, read cumulative.** High cumulative, low flat = a router/dispatcher; the cost is *below* it. Use it to navigate *down* toward the real leaf, not as a target itself.

> **Key insight:** **Flat tells you what to optimize; cumulative tells you where to look.** A function with high cumulative and ~zero flat is a signpost, not a destination — it's pointing at expensive children. Optimize the high-*flat* leaves; use high-*cumulative* frames only to find your way down to them.

---

## Symbolication — Why Frames Show `??`

A running program knows only **addresses** — `0x401a3f`. **Symbolication** is the translation of those addresses back into `package.Function (file.go:42)`. When it fails, your profile fills with `??`, raw hex, or `[unknown]`, and a flame graph becomes an unreadable wall of nameless boxes.

```
# perf report on a stripped binary, no debug info:
  41.2%  myprog  [.] 0x000000000004a3f0     ← no symbol
  16.0%  myprog  [.] 0x000000000004b120
   8.3%  libc.so [.] 0x0000000000089a40
```

Why it breaks, and the fix for each:

- **Stripped binary.** Release builds run `strip` to drop the symbol table and shrink the binary. No symbol table → no names. *Fix:* profile an unstripped build, or keep the symbols in a separate `.debug` file (`objcopy --only-keep-debug`) and point the profiler at it.
- **Missing debug info (`-g`).** Without DWARF debug data the profiler can map to a function name but not the file/line. *Fix:* compile with `-g` (Go keeps enough by default; C/C++/Rust release builds often need it added).
- **Broken stack unwinding.** With frame-pointer omission (`-fomit-frame-pointer`, common in optimized C/C++) the profiler can't walk the stack and you get one-deep, truncated stacks. *Fix:* build with `-fno-omit-frame-pointer`, or use DWARF call-frame unwinding (`perf record --call-graph dwarf`) or hardware LBR (`--call-graph lbr`).
- **JIT / dynamically generated code.** A JVM or V8 emits machine code at runtime that no static symbol table describes. *Fix:* a side-channel symbol map — `perf-<pid>.map` in `/tmp`, which `perf` reads to name JIT frames (async-profiler and Node's `--perf-basic-prof` write these).
- **Stripped containers.** The classic production trap: minimal images ship binaries without symbols *or* the system libraries' debug packages. *Fix:* install `-dbg`/`-debuginfo` packages, or symbolize off-box against a build artifact you kept.

> **Key insight:** A profile full of `??` isn't broken data — it's *unsymbolized* data. The samples are real; you've lost the address→name map. Fix the map (unstripped binary, `-g`, frame pointers, a JIT `perf-map`) rather than re-capturing and hoping. Symbolication is a separate step from sampling, and it fails for separate reasons.

---

## Safepoint Bias and Why async-profiler Exists

This one is specific to managed runtimes (the JVM most of all), and it silently corrupts profiles produced by the "standard" tools.

Many traditional JVM profilers (anything built on `GetAllStackTraces` via JVMTI — VisualVM, older commercial agents) can only capture a thread's stack when that thread is at a **safepoint**: a special checkpoint the JIT inserts where the heap is in a consistent, walkable state — typically at method returns and loop back-edges, *not* in the middle of a hot inlined loop. So when the profiler says "sample now," each thread doesn't stop where it *is*; it runs forward to the *next safepoint* and is sampled there.

The result is **safepoint bias**: samples cluster at safepoint-rich locations and systematically *miss* tight, hot, inlined loops — which are exactly the code with *few* safepoints. Your real bottleneck — a CPU-bound numeric loop — can be under-reported, while the innocent method *after* it (where the safepoint is) gets the blame. You optimize the wrong method and the profile barely moves.

The fix is to sample *without* waiting for safepoints. **async-profiler** uses `AsyncGetCallTrace` — an unofficial JVM API that captures the stack at the *actual* point of interrupt, plus `perf_events` for the kernel side — so it sees the real instruction pointer, inlined frames and all. **JFR** (Java Flight Recorder, built into the JDK) is the other strong choice: low-overhead, always-available, and not bound to JVMTI safepoints in the same way.

```bash
# async-profiler: attach to a running JVM, 30s CPU profile → flame graph
asprof -d 30 -e cpu -f flame.html <pid>

# JFR: built into the JDK, no extra agent
jcmd <pid> JFR.start duration=30s filename=rec.jfr
```

> **Key insight:** On the JVM, the *profiler you choose changes the answer.* Safepoint-biased tools blame the method after the hot loop, not the loop itself — a wrong answer that looks completely plausible. async-profiler and JFR sidestep safepoint bias and are the default for serious JVM CPU work. If a JVM profile's hotspot doesn't match a benchmark, suspect safepoint bias before you suspect the benchmark.

---

## The Toolbelt

You'll use whichever the platform hands you; each has a thing it's best at.

| Tool | Platform | Mechanism | Best at |
|---|---|---|---|
| **Go `pprof`** | Go | runtime `SIGPROF`, 100 Hz | built-in `top`/`list`/`web`; `-http` UI; live capture via `/debug/pprof` |
| **`perf`** | Linux | `perf_events`/PMU | whole-machine, kernel + user, hardware-event sampling |
| **async-profiler** | Java | `AsyncGetCallTrace` + perf | JVM without safepoint bias; allocation + lock profiling too |
| **JFR** | Java | JDK-native | always-available, very low overhead, rich event stream |
| **py-spy** | Python | reads target memory, no code change | profiling a *running* prod process you can't restart |
| **Instruments** | macOS | DTrace/`os_signpost` | GUI time-profiler, deep Apple-stack integration |
| **cargo flamegraph** | Rust | wraps `perf`/dtrace | one-command native flame graph from a Cargo build |

A few notes that matter in practice. `pprof`'s `-http=:8080` opens an interactive browser UI with flame graph, top, and source views — the fastest way to explore a Go profile. `py-spy` is special: it samples a Python process *from the outside* by reading its memory, so you can profile a stuck production service **without restarting it or adding a single line of code** (`py-spy dump --pid <pid>` even prints every thread's current stack — a profiler and a "what is it doing right now" debugger in one). `cargo flamegraph` collapses the whole `perf record` → fold → `flamegraph.pl` pipeline into one command for Rust binaries.

---

## Worked Example — Capture, Top, List a Hot Function

A Go service feels CPU-heavy under load. Walk it end to end.

**1. Capture 30 seconds of on-CPU profile** from the live `/debug/pprof` endpoint:

```bash
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
# Fetching profile over HTTP...
# Saved profile in /Users/you/pprof/pprof.samples.cpu.001.pb.gz
# Type: cpu
# Entering interactive mode (type "help" for commands)
(pprof)
```

**2. `top` — rank by flat to find real CPU.** (`top` defaults to flat; that's what you want here.)

```
(pprof) top
Showing nodes accounting for 4.12s, 95.37% of 4.32s total
      flat  flat%   sum%        cum   cum%
     1.84s 42.59% 42.59%      1.92s 44.44%  encoding/json.(*decodeState).object
     0.71s 16.44% 59.03%      0.71s 16.44%  runtime.mallocgc
     0.43s  9.95% 68.98%      0.43s  9.95%  runtime.memmove
     0.38s  8.80% 77.78%      2.51s 58.10%  api.(*Handler).parseBody
     0.02s  0.46% 78.24%      4.10s 94.91%  net/http.(*conn).serve
```

Read it: `serve` is 94.91% *cumulative* but **0.46% flat** — a wrapper, ignore it as a target. The real CPU leaf is `json.(*decodeState).object` at **42.59% flat**. `parseBody` (8.8% flat, 58% cum) is the path leading down into it. The story: this service spends nearly half its CPU decoding JSON.

**3. `list` the hot function** to see *which lines* cost what — flat time attributed per source line:

```
(pprof) list decodeState.*object
Total: 4.32s
ROUTINE ======================== encoding/json.(*decodeState).object
     1.84s      1.92s (flat, cum) 44.44% of Total
         .          .    412:	for {
     0.21s      0.21s    421:		key, err := d.parseKey()
     1.31s      1.31s    436:		d.value(subv)        ← the hot line: 1.31s here
     0.32s      0.40s    448:		d.scanWhile(scanSkipSpace)
```

Line 436 alone is **1.31s** — the recursive `value` decode dominates. *Now* you have something actionable: this isn't "JSON is slow," it's "this specific decode path is hot," which points at concrete fixes (a streaming decoder, `jsoniter`, avoiding `interface{}`, or caching the decoded result). The flame graph (`-http`) would show the same shape visually; `top` + `list` gets you there in two commands from the terminal.

> Note this is the **on-CPU** profile — it found CPU-bound work, which is what we suspected. Had `top` come back nearly empty (everything in `runtime.gopark` / blocking), that would have been the signal to switch to a **block** or **wall-clock** profile, per the section above.

---

## Mental Models

- **A sampling profiler is a strobe light, not a stopwatch.** It blinks ~100 times a second and writes down whatever the program is doing at each flash. You don't see the motion; you see frozen frames and infer the motion. Anything that happens entirely between flashes is invisible — which is why rare-but-costly work hides and the top entries are the only ones you can trust.

- **Every profile number is `count × period`.** "30% of CPU" = "caught on the stack in 30% of samples." Internalize this and the statistical caveats (`1/√n` error, invisible rare functions, why you profile for 30 s not 2 s) stop being surprises and become predictions.

- **On-CPU answers *what's computing*; wall-clock answers *where time goes*.** They disagree precisely when code is *blocked*. A latency problem is usually a wall-clock/blocking problem, and an on-CPU profiler is built to *not see it*. Match the profiler to the question.

- **Flat is the destination; cumulative is the road sign.** High flat = optimize here. High cumulative + low flat = the cost is in the children; follow it down. Confusing the two is how you "optimize" `main`.

- **Symbolication is a separate promise from sampling.** The samples can be perfect while the names are lost. `??` means "I have the addresses but not the map," not "bad data." Fix the map.

---

## Common Mistakes

1. **Pointing an on-CPU profiler at a latency problem.** Your slow endpoint shows as 2% of CPU, so you call it fine — missing that it spends 95 ms *blocked* on a query, which the on-CPU profiler ignores by design. Use wall-clock / block / off-CPU profiling for latency.

2. **Sorting by cumulative and optimizing the top.** That puts `main`, `ListenAndServe`, or your router on top — functions with ~0 flat time that do nothing themselves. Sort by **flat** to find real CPU; use cumulative only to navigate down to the hot leaf.

3. **Trusting the long tail.** Below ~1% of CPU the sample count is too small for the ranking to mean anything (`1/√n`). Optimizing a 0.4% function is rearranging noise. Work the head of the profile.

4. **Concluding "not in the profile" = "free."** A function called once for 8 ms expects under one sample at 100 Hz and may not appear at all. Sampling is blind to infrequent events; verify cost with a benchmark before dismissing it.

5. **Profiling for two seconds.** ~200 samples total — enough to see the #1 item, not enough for anything below it. Capture 30–60 seconds of representative load.

6. **Ignoring safepoint bias on the JVM.** A safepoint-biased profiler blames the method *after* your hot inlined loop. If the hotspot disagrees with a benchmark, re-profile with async-profiler or JFR before trusting it.

7. **Re-capturing to fix `??` frames.** New captures of a stripped binary are still stripped. Fix *symbolication* — unstripped build, `-g`, frame pointers, a JIT `perf-map` — not the capture.

---

## Test Yourself

1. A profiler reports a function is "25% of CPU." What does that statement *literally* mean in terms of samples?
2. Your slow API endpoint shows up as 1.5% in the CPU profile. Why might the on-CPU profile be the wrong tool, and which profile would you capture instead?
3. In `pprof top`, a function shows 0.1% flat and 80% cumulative. Is it a good optimization target? What is it telling you?
4. A function that runs once for 6 ms during a 30-second, 100 Hz profile doesn't appear at all. Is it free? Roughly how many samples would you *expect* it to get?
5. Your `perf report` is full of `0x4a3f0`-style frames instead of names. The samples are fine — what's broken, and name two fixes.
6. Why can two different JVM profilers disagree about which method is hottest, and which kind avoids the problem?

<details>
<summary>Answers</summary>

1. It means the function was found on top of the captured call stack in ~25% of the samples taken. The percentage is `samples_in_function / total_samples`; time is inferred as `count × sample_period`, not measured directly.
2. The on-CPU profile only counts cycles actually burned; a slow endpoint is usually slow because it's **blocked** (DB/network/lock), which burns ~0 CPU and is invisible to it. Capture a **wall-clock**, **block/mutex**, or **off-CPU** profile to see the waiting.
3. No — it's a near-pure pass-through (a wrapper/dispatcher) with ~0 flat time of its own. The 80% cumulative tells you the cost is in its **callees**; use it to navigate *down* to the high-flat leaf, then optimize there.
4. Not free — it's real 6 ms of work. Expected samples ≈ `0.006 s × 100 Hz = 0.6`, i.e. likely zero. Sampling profilers are blind to infrequent work; confirm its cost with a benchmark.
5. Symbolication failed — you have addresses but no address→name map (stripped binary and/or missing debug info, or broken unwinding). Fixes: profile an unstripped/`-g` build; install the `-debuginfo`/`-dbg` packages; build with `-fno-omit-frame-pointer` or use `--call-graph dwarf`; for JIT code provide a `/tmp/perf-<pid>.map`.
6. **Safepoint bias:** safepoint-bound profilers (JVMTI `GetAllStackTraces`) sample only at safepoints, so they miss hot inlined loops (few safepoints) and over-credit the next method. **async-profiler** (`AsyncGetCallTrace`) and **JFR** sample at the true instruction pointer and avoid the bias.

</details>

---

## Cheat Sheet

```
HOW SAMPLING WORKS
  signal/timer   SIGPROF via setitimer → on-CPU time only (sleeping = no ticks)
  PMU/perf       hardware counters → time OR cache-miss/branch-miss sampling
  every number   = sample_count × sample_period   (an ESTIMATE, not a measurement)

SAMPLE RATE TRADE-OFF
  higher Hz → more accurate, more overhead, aliasing risk
  Go: fixed 100 Hz   perf: -F 999 (odd freq avoids lock-step aliasing)
  error on a function ≈ 1/√(its sample count)   → trust head, distrust <1% tail

WALL-CLOCK vs ON-CPU   (the big one)
  on-CPU      what's BURNING cycles      (default: pprof, perf record)
  wall-clock  where ELAPSED time goes    (includes BLOCKED/waiting time)
  latency problem + empty CPU profile → it's BLOCKED → use wall/block/off-CPU

FLAT vs CUMULATIVE
  flat (self)  cycles in THIS function's own code   → OPTIMIZE here
  cum  (total) flat + all callees                   → NAVIGATE down with it
  high cum + ~0 flat = wrapper/router, NOT a target

SYMBOLICATION  (?? / hex = lost name map, not bad data)
  stripped binary   → unstripped build / objcopy --only-keep-debug
  no -g             → compile with -g (DWARF)
  truncated stacks  → -fno-omit-frame-pointer OR perf --call-graph dwarf|lbr
  JIT code (JVM/V8) → /tmp/perf-<pid>.map

JVM: SAFEPOINT BIAS
  JVMTI profilers sample only at safepoints → miss hot inlined loops
  use async-profiler (AsyncGetCallTrace) or JFR

TOOLS (best at)
  go pprof    -http UI, top/list, /debug/pprof live capture
  perf        whole-machine, kernel+user, hardware events
  async-prof  JVM, no safepoint bias
  py-spy      profile RUNNING Python, no code change / restart
  Instruments macOS GUI time profiler
  cargo flamegraph   one-command Rust flame graph
```

---

## Summary

- A sampling profiler **stops the program on a timer, walks the stack, resumes** — via `SIGPROF` (on-CPU, signal/timer) or the **PMU/`perf_events`** (hardware counters, can sample on cache-misses etc.). Every reported number is `sample_count × period` — an **estimate**, not a measurement.
- The **sample rate** is a three-way trade between accuracy, overhead, and aliasing. Go fixes it at 100 Hz; `perf` uses odd frequencies like 999 Hz. Statistical error ≈ `1/√n`, so the **head** of the profile is trustworthy and the **sub-1% tail** is noise. Rare-but-expensive work can be invisible — *"not in the profile" ≠ "free."*
- **On-CPU** time answers *what's computing*; **wall-clock** answers *where elapsed time goes*. They disagree when code is **blocked**, and pointing an on-CPU profiler at a *latency* problem makes the real cost — a blocking wait — disappear. Match the profiler to the question.
- **Flat (self)** is what to optimize; **cumulative (total)** is a signpost to navigate *down* toward the hot leaf. High-cumulative, zero-flat frames (`main`, routers) are wrappers, not targets.
- **Symbolication** — turning addresses into names — is a separate step that fails separately: stripped binaries, missing `-g`, broken unwinding, JIT code. `??` means a lost name map, not bad data; fix the map.
- On the **JVM**, safepoint-biased profilers blame the method *after* a hot inlined loop. **async-profiler** and **JFR** sidestep it. The profiler you pick can change the answer.

---

## Further Reading

- *Systems Performance* (Brendan Gregg) — Chapter 6 (CPUs) and the profiling chapters; the authoritative treatment of sampling, `perf`, and off-CPU analysis.
- [Go Diagnostics](https://go.dev/doc/diagnostics) and the `runtime/pprof` docs — how Go's profiler is wired, and the block/mutex profiles.
- [async-profiler README](https://github.com/async-profiler/async-profiler) — safepoint bias explained by the people who built the tool that fixes it.
- [perf Examples](https://www.brendangregg.com/perf.html) — Brendan Gregg's `perf` cookbook, including `--call-graph` and symbolization fixes.
- [py-spy](https://github.com/benfred/py-spy) — sampling a live Python process without touching its code.
- `man perf-record`, `man perf-report` — the primary sources for the flags above.

---

## Related Topics

- [junior.md](junior.md) — capture a profile and find the top function; the foundation this page formalizes.
- [senior.md](senior.md) — continuous/production profiling, PMU events, off-CPU and differential profiling, profile-guided optimization.
- [Flame Graphs → Middle](../04-flame-graphs/middle.md) — the dominant *visualization* of the profiles captured here; reading width, depth, and plateaus.
- [CPU-Bound Optimization → Middle](../../04-cpu-bound-optimization/middle.md) — what to actually *do* once the profile names a hot, high-flat function.
