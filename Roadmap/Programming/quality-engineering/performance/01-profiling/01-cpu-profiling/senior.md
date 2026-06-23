# CPU Profiling — Senior Level

> **Roadmap:** [Performance](../../README.md) → [Profiling](../README.md) → CPU Profiling
> *The middle page taught you to read a flat list and a call graph. This page is about whether you can trust them. Where exactly did that sample land, and is the instruction it blamed the one that was actually executing? Why does the JVM profiler swear a getter is hot? What is the program waiting on when the CPU profile shows nothing at all? This is the machinery and the failure modes of CPU attribution.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Hardware PMU and perf_events](#the-hardware-pmu-and-perf_events)
4. [Sampling Skid and Precise Events (PEBS)](#sampling-skid-and-precise-events-pebs)
5. [Stack Unwinding and How It Breaks](#stack-unwinding-and-how-it-breaks)
6. [The Safepoint-Bias Problem and async-profiler](#the-safepoint-bias-problem-and-async-profiler)
7. [On-CPU vs Off-CPU vs Wall-Clock](#on-cpu-vs-off-cpu-vs-wall-clock)
8. [Symbolication of JIT and Interpreted Code](#symbolication-of-jit-and-interpreted-code)
9. [Overhead, the Observer Effect, and Production Profiling](#overhead-the-observer-effect-and-production-profiling)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The machinery and pitfalls of accurate CPU attribution — what a sample actually measures, where it lands, and why the answer is sometimes a lie.**

By the middle level you can capture a profile, render a flame graph, and tell flat time from cumulative time. That is enough to find an obviously hot function. The senior jump is *skepticism backed by mechanism*. You know that a CPU profile is a statistical estimate built from periodic interrupts, that each interrupt has to (1) decide *what* it's counting, (2) figure out *where* the CPU was, and (3) walk the stack to attribute it to a call path — and that every one of those three steps has a characteristic way of going wrong.

A senior reads a profile and asks: was this `cycles` or `instructions` — because those answer different questions? Is this a precise event or did sampling skid blame the wrong instruction? Are these stacks real or did a missing frame pointer truncate them at the first JIT frame? Is the JVM profiler showing me where time goes, or only where the nearest *safepoint* is? And critically — if the CPU profile is flat but the service is slow, what is it *waiting* on, and which tool answers that question?

This page is those mechanisms at the level where you can defend a conclusion. We work in concrete `perf`, `pprof`, and async-profiler terms, because that is where the costs and the lies actually live.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — sampling vs instrumentation, flat vs cumulative, reading a call graph, the basic `perf record` / `pprof` workflow.
- **Required:** You can read x86-64 assembly well enough to recognize a `call`, a `ret`, a function prologue (`push %rbp; mov %rsp,%rbp`), and a load from memory.
- **Helpful:** A working model of CPU pipelining and out-of-order execution — that the "current instruction" is a fuzzy concept on a superscalar core.
- **Helpful:** You've been burned at least once by a flame graph that bottomed out in `[unknown]` and had to figure out why.

---

## The Hardware PMU and perf_events

A sampling CPU profiler does not watch your program. It arms a counter, lets the CPU run, and asks to be interrupted every *N* somethings. *What* that "something" is determines what the profile actually means — and this is the first place senior judgment enters.

Every modern CPU ships a **Performance Monitoring Unit (PMU)**: a small bank of hardware counters that increment on micro-architectural events. On Linux, `perf_event_open(2)` programs them; `perf` is the userspace front end. The events fall into two families:

- **Fixed/core events** — `cycles`, `instructions`, and a handful of others, available everywhere.
- **Raw/model-specific events** — cache misses, branch mispredictions, stalls, port utilization — addressed by raw event codes that differ per micro-architecture.

```bash
perf list                       # every event this CPU exposes
perf list pmu                   # grouped by PMU (cpu, uncore_imc, ...)
perf stat ./app                 # a quick counter snapshot, no sampling
```

`perf stat` is the orientation tool — it *counts*, it doesn't *sample*, so it has near-zero attribution error and tells you the shape of the problem before you profile:

```
$ perf stat ./app
       12,043.55 msec task-clock         #    1.00 CPUs utilized
  38,219,847,113      cycles             #    3.17 GHz
  21,003,556,892      instructions       #    0.55  insn per cycle
   4,880,221,019      cache-references
   1,902,775,331      cache-misses       #   38.99% of all cache refs
```

That `0.55 insn per cycle` (IPC) is the single most useful number on the page. A modern core can retire 3–4 instructions per cycle; **0.55 means the CPU is stalled roughly 85% of the time**, almost certainly waiting on memory — and the 39% cache-miss rate confirms it. This changes how you read the subsequent profile entirely: the hot function isn't hot because it executes a lot of instructions, it's hot because it *waits* a lot. Optimizing its instruction count would do nothing; fixing its memory access pattern is the lever.

### Cycles vs Instructions — Different Questions

These two events are not interchangeable, and choosing the wrong one produces a profile that answers a question you didn't ask:

| Event | Counts | A "hot" function under this event is… | Best for finding |
|---|---|---|---|
| `cycles` | unhalted clock ticks | where **wall-time on-CPU** goes | real latency cost, including stalls |
| `instructions` | retired instructions | where **work** is done | algorithmic / instruction-count hot spots |
| `cache-misses` | LLC misses | where memory stalls originate | data-layout problems |
| `branch-misses` | mispredicted branches | where control flow surprises the CPU | branchy hot loops |

The trap: a memory-bound function that stalls constantly will dominate a `cycles` profile but look modest under `instructions` (it executes few instructions; it just waits on each one). A tight compute kernel is the reverse. If you profile with `instructions` and optimize the top entry, you may be tuning a function that isn't actually costing wall-time — because the wall-time is being burned in stalls that `instructions` doesn't see. **Default to `cycles` for "where does time go," reach for `instructions`/`cache-misses` to explain *why* a function is hot.**

> **Key insight:** A CPU profile's meaning is set by the event you sampled. `cycles` measures elapsed on-CPU time (stalls included); `instructions` measures work done (stalls invisible). The two can rank functions differently, and the gap between them — visible as IPC — is itself the diagnosis: low IPC says "this is a memory/stall problem, not an instruction-count problem."

---

## Sampling Skid and Precise Events (PEBS)

Here is the failure mode that quietly corrupts more profiles than any other, and that almost no one below senior knows to look for.

When a PMU counter overflows, the CPU raises an interrupt and `perf` records the instruction pointer (RIP) at that moment. The problem: a modern out-of-order, deeply-pipelined core does not stop on a dime. Between the instruction that *caused* the counter to overflow and the moment the interrupt is actually taken and the RIP is latched, **tens of instructions may retire**. The recorded RIP therefore points somewhere *after* the real culprit. This lag is called **skid**, and it is not small — on some micro-architectures it routinely lands the sample 1–50 instructions downstream of the instruction that mattered.

The visible symptom: attribution lands on the instruction *right after* a high-latency one. A cache-missing load takes hundreds of cycles; the counter overflows while it's outstanding; by the time the interrupt fires, the load has retired and the RIP points at the next instruction — frequently the one that *consumes* the loaded value. So your profile blames the `add` that used the data, not the `mov` that missed cache fetching it. Aggregate enough samples and skid can shift attribution to the wrong *source line*, and occasionally — across a function boundary — to the wrong *function*.

### Precise Events: PEBS and IBS

The hardware fix is to let the CPU record the architectural state itself, in a buffer, at a precisely-defined instruction — no interrupt-latency window. Intel calls this **PEBS** (Precise Event-Based Sampling); AMD calls its equivalent **IBS** (Instruction-Based Sampling). `perf` exposes the precision level with a `:p` suffix:

```bash
perf record -e cycles ./app          # imprecise: skid present
perf record -e cycles:p  ./app       # request reduced skid
perf record -e cycles:pp ./app       # request that skid be eliminated (PEBS)
perf record -e cycles:ppp ./app      # also disambiguate (e.g. tag origin precisely)
```

`cycles:pp` is the one to memorize. It tells the kernel "use PEBS so the recorded RIP is the instruction that actually caused the sample," and for the events that support it (not all do), it largely eliminates skid. The `perf` shorthand `cycles:P` lets the tool pick the maximum available precision.

```bash
# A typical precise on-CPU profile you can actually trust at the instruction level:
perf record -e cycles:pp -g --call-graph fp -F 999 -- ./app
perf annotate --stdio       # per-instruction attribution; with PEBS this points at the RIGHT instruction
```

A note on sampling frequency: `-F 999` requests 999 samples/sec rather than a fixed period. Use an *odd* frequency (999, not 1000) to avoid aliasing with periodic work that ticks at a round rate (timers, frame loops, 100 Hz schedulers) — a profiler sampling in lockstep with a 1000 Hz event will systematically over- or under-count it. This is the profiling analog of strobe-light aliasing, and it produces beautifully wrong results.

> **Key insight:** Without precise events, the instruction your profile blames is often the instruction *after* the one that mattered — because the interrupt arrives late on an out-of-order core. `perf record -e cycles:pp` uses PEBS to make the recorded address the true culprit. Any instruction-level conclusion drawn from a non-`:pp` profile is suspect, especially near high-latency loads.

---

## Stack Unwinding and How It Breaks

A sample's RIP tells you *which instruction*. To attribute it to a *call path* — the thing a flame graph draws — the profiler must walk the stack from the interrupted frame back to `main`. There are three ways to do this, with sharply different cost and reliability, and choosing among them is a daily senior decision.

### Frame Pointers (`--call-graph fp`)

The classic method. If every function keeps a frame-pointer chain (`%rbp` points at the saved previous `%rbp`, which points at the one before it), unwinding is a trivial linked-list walk: follow `%rbp`, read the return address just above it, repeat.

```bash
perf record --call-graph fp ./app
```

Cheap and fast — a handful of memory reads per sample. The catch: it only works if **every** frame on the stack maintained `%rbp`. And here is the landmine that swallows countless profiles: compilers optimize `%rbp` into a general-purpose register by default. GCC and Clang enable `-fomit-frame-pointer` at `-O1` and above, freeing `%rbp` for computation. The result is faster code and **unwalkable stacks** — the `%rbp` chain is broken, so the unwinder either stops at the first frameless function or, worse, follows a garbage value and prints a fabricated stack.

```bash
# This is why your release-build flame graph truncates at one frame:
gcc -O2 main.c            # -fomit-frame-pointer is implied → no %rbp chain
# Fix: pay ~1% to keep the chain walkable
gcc -O2 -fno-omit-frame-pointer main.c
```

The cost of `-fno-omit-frame-pointer` is real but small — typically ~1% on most workloads, occasionally more in register-starved tight loops. For any binary you intend to profile in production, that is almost always worth paying. This is exactly why Fedora and Ubuntu re-enabled frame pointers across their entire package archives: the fleet-wide profiling win dwarfs the per-binary cost.

### DWARF CFI (`--call-graph dwarf`)

If you can't keep frame pointers, the compiler still emits enough metadata to unwind: **DWARF Call Frame Information** in the `.eh_frame` / `.debug_frame` sections — a table describing, for every instruction address, how to find the return address and restore registers. `perf --call-graph dwarf` doesn't parse this at interrupt time (far too slow); instead it **copies a chunk of the user stack** (8 KB by default) into the sample and unwinds it offline.

```bash
perf record --call-graph dwarf ./app
perf record --call-graph dwarf,16384 ./app   # bigger stack copy for deep recursion
```

This walks optimized, frame-pointer-omitted code correctly. The price is steep: copying kilobytes of stack on every sample inflates `perf.data` enormously and raises overhead, and if a real stack is deeper than the copied window, it **truncates** mid-walk — a classic source of stacks that mysteriously bottom out in the middle. DWARF unwinding is the right tool when you must profile a binary you can't recompile, but it is not the default for high-frequency or production sampling.

### LBR (`--call-graph lbr`)

Modern Intel CPUs keep a **Last Branch Record** — a small hardware ring (typically 16 or 32 entries) of recent taken branches, including calls and returns. `perf --call-graph lbr` reconstructs the call stack from that ring with no frame pointers and no stack copy.

```bash
perf record --call-graph lbr ./app
```

Nearly free and immune to the frame-pointer problem. Its hard limit is *depth*: a 16- or 32-entry ring can only reconstruct the last 16–32 branches, so deep call stacks are truncated to the top frames. LBR is excellent for shallow, hot paths and for branch-level analysis; it's the wrong choice when you need the full call chain to `main`.

### ORC (the kernel's answer)

The Linux **kernel itself** is built with `-fomit-frame-pointer` for performance, which would make in-kernel stacks unwalkable. The kernel's solution is **ORC** (a bespoke unwinder, the reverse of "CORn… Oops Rewind Capability") — a simplified, fast unwind-table format generated at kernel build time (`CONFIG_UNWINDER_ORC`). It's why `perf record -g` on a syscall-heavy workload can show clean kernel stacks even though the kernel has no frame pointers. You rarely configure ORC directly, but knowing it exists explains why kernel and user-space unwinding behave differently in the same profile.

| Method | Mechanism | Overhead | Depth | Works on optimized code? |
|---|---|---|---|---|
| **fp** | `%rbp` linked-list walk | very low | full | only if `-fno-omit-frame-pointer` |
| **dwarf** | copy stack + `.eh_frame` offline | high | full (if stack fits copy) | yes |
| **lbr** | hardware last-branch ring | very low | 16–32 frames | yes |
| **ORC** | kernel unwind tables | low | full (kernel only) | yes (kernel) |

> **Key insight:** A flame graph is only as honest as its unwinder. Frame pointers are cheap but require `-fno-omit-frame-pointer`; DWARF walks anything but is expensive and truncates on deep stacks; LBR is free but shallow. A stack that bottoms out in `[unknown]` or one frame is almost never a mystery — it's the unwinder hitting a frame it couldn't decode. Diagnose the *unwinding method* before you doubt the data.

---

## The Safepoint-Bias Problem and async-profiler

This is the single most important thing a senior knows about JVM CPU profiling, and it invalidates the output of most "traditional" Java profilers.

### Why JVM Profilers Lie

The JVM is a managed runtime. The garbage collector must occasionally stop every application thread to walk the heap — and it can only do so when threads are at a **safepoint**: a designated polling location (typically method entries/exits and loop back-edges) where the runtime knows the thread's stack is in a consistent, walkable state. The compiler emits safepoint polls only at these points.

The classic JVM sampling profiler (anything built on the `Thread.getAllStackTraces()` / JVMTI `GetStackTrace` API — which includes most older commercial profilers) can *only* capture a thread's stack when that thread is **parked at a safepoint**. When the profiler wants a sample, it requests one, and each thread reports its stack only once it reaches its next safepoint poll. The consequence is devastating for accuracy: **samples are not collected where the CPU actually is — they're collected at the nearest safepoint.** This is **safepoint bias**.

The distortion isn't random, which is what makes it dangerous. The JIT *removes* safepoint polls from code it considers fast — tight counted loops get their back-edge polls elided, and aggressively inlined hot methods may have no internal safepoints at all. So the very hottest, most-optimized code is precisely the code with the *fewest* safepoints, and a safepoint-biased profiler systematically *under*-samples it and *over*-attributes time to whatever method happens to sit at the next safepoint — often an innocent caller or a trivial accessor. Engineers have spent days optimizing a getter that a safepoint-biased profiler crowned as hot, when the real cost was in an inlined loop the profiler couldn't see.

### How async-profiler Dodges It

[async-profiler](https://github.com/async-profiler/async-profiler) sidesteps the entire problem by *not* asking the JVM for stacks at safepoints. It combines two mechanisms:

1. **perf_events for the sample trigger.** It arms the hardware PMU (`cycles`, or `itimer`/`cpu` clock) exactly like a native profiler. The interrupt fires *wherever the thread happens to be* — no safepoint required.
2. **`AsyncGetCallTrace` (AGCT) for the Java stack.** This is an undocumented-but-stable HotSpot internal API, explicitly designed to be called from a *signal handler* at an arbitrary instruction — including inside JIT-compiled code that is nowhere near a safepoint. AGCT walks the Java frames directly from the current register/stack state.

The result is an unbiased CPU profile: samples land where the CPU truly is, and AGCT can name the JIT frame even mid-loop.

```bash
# Attach to a running JVM and collect a 30s on-CPU profile as a flame graph:
java -agentpath:/path/libasyncProfiler.so=start,event=cpu,file=prof.html,flamegraph
# or attach at runtime by PID:
asprof -d 30 -e cpu -f prof.html <pid>
# event=cpu uses perf_events; event=itimer is a fallback where PMU is unavailable (containers)
```

async-profiler stitches **Java + native + kernel** frames into one stack — so a flame graph can show a Java method calling into a JNI library calling into a syscall, all in one tower. To make the *native* halves of those stacks walkable, the JVM must keep frame pointers:

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PreserveFramePointer -jar app.jar
```

`-XX:+PreserveFramePointer` forces the JIT to maintain `%rbp` as a frame pointer in generated code, so a native unwinder (perf, async-profiler's native walk) can cross JIT frames. Without it, the Java frames are fine (AGCT handles them) but native/mixed stacks truncate at the JIT boundary — the JVM analog of `-fomit-frame-pointer`.

> **Key insight:** Most "Java profilers" sample at safepoints, so they don't measure where the CPU is — they measure where the nearest safepoint is, and the JIT strips safepoints from the hottest code. async-profiler escapes this by triggering on perf_events (interrupt anywhere) and walking Java frames with `AsyncGetCallTrace` (works in a signal handler, mid-JIT-code). If a JVM CPU profile surprises you by blaming a trivial method, suspect safepoint bias before you believe it.

---

## On-CPU vs Off-CPU vs Wall-Clock

A CPU profile, by construction, can only see threads that are *running on a CPU*. If your service is slow because threads are *blocked* — on a lock, a disk read, a network round-trip, a channel — the CPU profile shows **nothing**, because a sleeping thread consumes no cycles to sample. This is the most common reason a profile "looks fine" while the system is plainly slow, and recognizing it is a defining senior skill.

There are three distinct lenses, and the senior move is knowing which one answers the question in front of you:

- **On-CPU profiling** — *where is the CPU spending cycles?* Samples running threads. Finds compute hot spots. Blind to all waiting. (`perf record -e cycles`, async-profiler `event=cpu`, `pprof` CPU profile.)
- **Off-CPU profiling** — *why are threads* not *running?* Samples threads at the moment they're descheduled and measures how long they stay off-CPU, attributing that blocked time to the stack that blocked. Finds lock contention, I/O waits, blocking syscalls. (`perf sched`, async-profiler `event=wall` or off-cpu modes, BPF `offcputime`.)
- **Wall-clock profiling** — *where does elapsed time go, running or not?* Samples *all* threads regardless of state. The default lens for "this request took 800 ms; where did the 800 ms go?" (async-profiler `event=wall`, `py-spy` default.)

The canonical workflow: an on-CPU profile shows low utilization and no obvious hot function, yet latency is high → switch to off-CPU / wall-clock to find what the threads are *waiting on*. Together, on-CPU + off-CPU account for **all** of a thread's time — running plus blocked — which is the only complete picture. (Brendan Gregg's term for combining them is the "off-CPU analysis" half of the full thread time.)

```bash
# Off-CPU time via BPF: who blocks, on what stack, for how long
offcputime-bpfcc -p <pid> 30          # bcc tool: aggregate off-CPU stacks
# async-profiler wall-clock: sample all threads, running or parked
asprof -d 30 -e wall -f wall.html <pid>
```

### Go: runtime/trace for the Scheduler View

Go's `pprof` CPU profile is on-CPU and shares all the caveats above (it's SIGPROF-driven sampling of running goroutines). But Go ships a second tool that answers the off-CPU question natively: **`runtime/trace`** records *scheduler events* — goroutine creation, blocking on channels/mutexes/network, GC pauses, syscall entry/exit, and which goroutine ran on which OS thread (`P`/`M`/`G`) over time.

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... workload ...
```

```bash
go tool trace trace.out      # opens the scheduler timeline, blocking profiles, GC view
# or via the live endpoint:
curl 'http://localhost:6060/debug/pprof/trace?seconds=5' -o trace.out
```

Where the CPU profile says "this goroutine ran for X," the trace says "this goroutine was *blocked on a channel send* for Y, then *waiting in the run queue* for Z" — the answer to "what is it waiting on" that a pure CPU profile cannot give. For diagnosing latency in a concurrent Go service, the trace is frequently more illuminating than the CPU profile. Go also exposes dedicated `block` and `mutex` profiles (`/debug/pprof/block`, `/debug/pprof/mutex`) for blocking and contention specifically, which are cheaper than a full trace when you already suspect contention.

> **Key insight:** A CPU profile is structurally blind to waiting — a blocked thread emits no samples. "The profile is flat but we're slow" almost always means the time is *off-CPU*: locks, I/O, scheduling. Reach for off-CPU/wall-clock profiling (or `runtime/trace` in Go) to see it. On-CPU plus off-CPU is the only accounting that sums to a thread's whole life.

---

## Symbolication of JIT and Interpreted Code

A profiler records addresses; *symbolication* turns those addresses into function names and line numbers. For statically-compiled native code this is a lookup in the binary's symbol table and DWARF — solvable with debug info on disk. For **JIT-compiled and interpreted** code it is genuinely hard, because the code being executed *did not exist when the binary was built* — it was generated into anonymous memory at runtime. This is why so many flame graphs are towers of `[unknown]` over a JIT runtime, and fixing it is a senior responsibility.

### perf and the `/tmp/perf-<pid>.map` Contract

`perf` solves runtime-generated code with a simple convention: a JIT can write a file at `/tmp/perf-<PID>.map`, one line per generated method, mapping `start_addr size symbol_name`:

```
# /tmp/perf-12345.map
7f3a1c000000 1a0 java.util.HashMap::get
7f3a1c0001a0 220 com.example.Service::handle
```

When `perf report` symbolizes an address that isn't in any binary, it consults this map. The JVM emits it via `-XX:+PreserveFramePointer` plus an agent (or `-XX:+DumpPerfMapAtExit` / the `perf-map-agent` tool); Node.js emits it under `--perf-basic-prof`; many runtimes support the convention.

```bash
# Node.js: make V8's JIT functions show up in perf instead of [unknown]
node --perf-basic-prof app.js
perf record -F 999 -g -p $(pgrep -n node) -- sleep 30
perf report     # JS frames now have names, via /tmp/perf-<pid>.map
```

The richer form is the **jitdump** interface (`perf inject --jit`), which captures not just names but the JIT'd machine code and line tables, enabling `perf annotate` on generated code. The `/tmp/perf-<pid>.map` form is the lightweight, ubiquitous one.

### pprof Labels — Symbolic, Dimensional Profiling

Go's `pprof` doesn't have the JIT problem (Go is AOT-compiled with a built-in symbol table), but it offers something the others largely don't: **profiler labels** — arbitrary key/value tags attached to samples, letting you *slice* a CPU profile by application dimension.

```go
labels := pprof.Labels("endpoint", "/checkout", "tenant", tenantID)
pprof.Do(ctx, labels, func(ctx context.Context) {
    handleCheckout(ctx) // every CPU sample taken in here is tagged
})
```

```bash
# Now you can ask: of the CPU time, how much was the /checkout endpoint?
go tool pprof -tagfocus='endpoint=/checkout' cpu.pprof
```

This turns a flat "function X is hot" profile into "function X is hot *for tenant 42's checkout requests*" — the difference between knowing *what* is slow and knowing *whose traffic* makes it slow. In a multi-tenant service it is the feature that makes a production CPU profile actionable rather than merely interesting.

For Python, `py-spy` solves symbolication differently again: it's an *external* sampler that reads the target interpreter's memory and walks the CPython frame objects directly, with no cooperation from the target process and no `[unknown]` frames — which is also why it can profile a process that's already hung.

> **Key insight:** Native code symbolizes from the binary; JIT/interpreted code generated its functions at runtime, so the profiler needs help — the `/tmp/perf-<pid>.map` contract (JVM, V8/Node) or a runtime-aware sampler (`py-spy`, async-profiler's AGCT). A flame graph that's a wall of `[unknown]` over a managed runtime is a *symbolication* failure, not a measurement one — and it's fixable with the right flag.

---

## Overhead, the Observer Effect, and Production Profiling

Every profiler perturbs the thing it measures. A senior reasons about that perturbation explicitly — both to trust the numbers and to profile safely in production, where the most important profiles are taken.

### The Observer Effect, Concretely

- **Sampling profilers** perturb proportional to *frequency*. Each sample is an interrupt: latch the RIP, walk the stack, write a record. At 99 Hz this is fractions of a percent; at 9999 Hz with DWARF unwinding (kilobytes copied per sample) it can be 10%+ and can *change which code is hot* — the unwinding cost itself starts showing up, and high frequency aliases against fast periodic work. This is why `-F 99` or `-F 999` is the production default, not `-F 9999`.
- **Instrumenting profilers** (compiler `-pg`/gprof, or tracing every function entry/exit) perturb proportional to *call frequency*. They can inflate a tiny, ultra-hot, frequently-called function by 10–100×, because the per-call instrumentation cost dwarfs the function's own work — the classic instrumentation distortion that makes a leaf function look like the bottleneck when it's merely *called* a lot. Sampling is immune to this because its cost is tied to the clock, not to call count.

The deeper trap is **non-uniform** overhead: if the profiler's cost falls unevenly across the code, it doesn't just add a constant — it *re-ranks* functions. Safepoint bias (above) is the extreme case; instrumentation distortion is another. A profile that's 5% slower uniformly is still trustworthy for *relative* attribution; one that's 5% slower *concentrated on the hot path* is lying about what's hot.

### Continuous, Always-On Production Profiling

The old model — "reproduce it locally and profile" — fails for problems that only manifest at production scale, with production data, under production traffic mix. The modern answer is **continuous profiling**: sample the entire fleet at low frequency, all the time, and store the profiles so you can query *the past*.

The economics work because of how cheaply you can sample. At ~19–99 Hz with frame-pointer or eBPF unwinding, per-host overhead is well under 1% — low enough to run on every production host permanently. Google's internal **Google-Wide Profiling (GWP)** pioneered this: continuous, fleet-wide, low-overhead sampling that makes "which function across the entire datacenter is burning the most CPU/dollars" a queryable question. The open-source successors:

- **[Parca](https://www.parca.dev/)** / **Parca Agent** — eBPF-based, system-wide continuous profiling. The agent uses eBPF to sample on-CPU stacks of *every* process (no per-app instrumentation, no recompile), unwinds with frame pointers or DWARF, and ships profiles to a server storing them in pprof format over time.
- **[Pyroscope](https://pyroscope.io/)** (now part of Grafana) — continuous profiling with per-language integrations (including eBPF) and a time-series-style UI for diffing profiles across deploys.
- **eBPF profilers generally** — the key enabler is that eBPF can attach a stack-sampling probe to the `perf` event in-kernel, aggregate stacks in a BPF map, and hand up *pre-folded* stacks, slashing the data volume and overhead versus copying raw samples to userspace.

```bash
# Parca Agent: system-wide continuous profiling via eBPF, no app changes
parca-agent --node=$(hostname) --remote-store-address=parca-server:7070
```

The senior value of continuous profiling is **differential**: not "what's hot now" but "what got 8% hotter after Tuesday's deploy" — a flame-graph *diff* between two time windows that points straight at the regressing commit. That capability is why continuous profiling has become a standard pillar of production observability alongside metrics, logs, and traces. (See [04 — Flame Graphs](../04-flame-graphs/senior.md) for differential / off-CPU flame-graph reading.)

> **Key insight:** Profiling overhead doesn't just slow things down — when it's *non-uniform* it changes which code looks hot, which is worse. Sampling at a low, odd frequency (99/999 Hz) keeps overhead uniform and sub-1%, cheap enough to run **always-on across the fleet** (Parca/Pyroscope/GWP). The payoff is differential profiling: diffing two time windows to catch a regression at the commit that caused it.

---

## Mental Models

- **A CPU profile is a poll, not a recording.** It interrupts every *N* events, snapshots one instruction and one stack, and aggregates. Everything else — skid, unwinding failures, safepoint bias, blindness to blocked threads — follows from "it's a periodic sample, not a continuous log." Reason from that and the failure modes are predictable.

- **The event defines the meaning.** `cycles` answers "where does on-CPU time go" (stalls included); `instructions` answers "where is work done" (stalls invisible). Their disagreement *is* the diagnosis — low IPC says memory, not instruction count, is the problem.

- **The recorded address may not be the guilty instruction.** Out-of-order execution plus interrupt latency means skid lands the sample *after* the culprit. `:pp`/PEBS is the fix; without it, distrust instruction-level conclusions near high-latency loads.

- **A flame graph is only as honest as its unwinder.** fp is cheap but needs `-fno-omit-frame-pointer`; DWARF walks anything but is heavy and truncates deep; LBR is free but shallow. Truncated/`[unknown]` stacks are an unwinding diagnosis, not a data mystery.

- **The profiler samples where it *can*, which may not be where the CPU *is*.** Safepoint-biased JVM profilers sample at safepoints; the JIT strips safepoints from hot code; so they systematically misattribute. async-profiler triggers on perf_events to escape this.

- **On-CPU + off-CPU = the whole story.** The CPU profile sees only running threads. If it's flat but you're slow, the time is off-CPU — locks, I/O, scheduling. You need both lenses to account for a thread's entire life.

---

## Common Mistakes

1. **Profiling with `instructions` (or the default) when you meant "where does time go."** A memory-bound function dominates `cycles` but looks modest under `instructions`. Default to `cycles:pp` for time; use `instructions`/`cache-misses` to *explain* a hot function, not to find it.

2. **Trusting instruction-level attribution from a non-precise profile.** Without `:pp`/PEBS, skid blames the instruction *after* the slow one — typically the consumer of a cache-missing load, not the load. Always use `perf record -e cycles:pp` before `perf annotate`.

3. **Profiling an optimized binary built with `-fomit-frame-pointer` using `--call-graph fp`.** The `%rbp` chain is broken, so stacks truncate at one frame or fabricate garbage. Rebuild with `-fno-omit-frame-pointer` (≈1%), or use `--call-graph dwarf`/`lbr`.

4. **Believing a safepoint-biased JVM profiler that crowns a trivial method.** Older JVMTI/`GetStackTrace` profilers sample at safepoints, which the JIT strips from hot code. Use async-profiler (perf_events + `AsyncGetCallTrace`) and `-XX:+PreserveFramePointer` for mixed stacks.

5. **Concluding "the code is fine" from a flat CPU profile while the service is slow.** The CPU profile can't see blocked threads. The time is off-CPU — switch to off-CPU/wall-clock profiling, or `runtime/trace`/block/mutex profiles in Go, to find what it's waiting on.

6. **Sampling at very high frequency (`-F 9999`) for "more accuracy."** Past a point you add overhead, the unwinding cost itself starts appearing in the profile, and you risk aliasing with periodic work. Use 99/999 Hz (odd, to avoid aliasing); take more *duration*, not more *frequency*.

7. **Accepting a `[unknown]`-filled flame graph over a JIT/interpreter as "just how it is."** That's a symbolication failure, not a measurement limit. Emit `/tmp/perf-<pid>.map` (`--perf-basic-prof` for Node, perf-map-agent for JVM) or use a runtime-aware sampler (`py-spy`, async-profiler).

8. **Profiling only in dev and never in production.** The interesting bottlenecks need production scale, data, and traffic mix. Run continuous low-overhead profiling (Parca/Pyroscope) so you can diff deploys and catch regressions at the commit.

---

## Test Yourself

1. You profile with `perf stat` and see IPC of 0.5 with a 35% cache-miss rate. What does that tell you about how to read the subsequent CPU profile, and which event would you add to confirm the cause?
2. `perf annotate` blames a cheap `add` instruction as the hottest line, right after a memory load. What's the likely artifact, and what flag fixes it?
3. Your release-build flame graph truncates at a single frame. Name the most likely cause and two different ways to get full stacks.
4. A teammate optimized a Java getter that their profiler said was hot, with no improvement. Explain what their profiler probably measured and which tool would have told the truth.
5. The on-CPU profile of a slow service is nearly flat — no function above a few percent. What kind of problem is this, and what do you capture next (a) in general and (b) specifically in Go?
6. A Node.js flame graph is a tower of `[unknown]` over the V8 runtime. What's failing, and what's the fix?
7. Why is sampling at 999 Hz preferable to 1000 Hz, and why is "more accuracy" not a reason to jump to 9999 Hz?

<details>
<summary>Answers</summary>

1. IPC of 0.5 means the core is stalled ~85% of the time, so the "hot" functions are hot because they *wait* (on memory), not because they execute many instructions — optimizing instruction count won't help; fixing data layout/access patterns will. Confirm by adding `cache-misses` (and ideally LLC-load-misses) to attribute the stalls to specific loads. Read the `cycles` profile as "where time is lost to stalls," not "where work happens."
2. Sampling **skid**: on an out-of-order core the counter overflows during the long-latency load, but the interrupt arrives late and latches the RIP at the *next* retired instruction — the `add` that consumes the loaded value. Fix with a precise event: `perf record -e cycles:pp` (PEBS), which makes the recorded address the true culprit.
3. Most likely the binary was built with `-fomit-frame-pointer` (default at `-O1`+) and you used `--call-graph fp`, so the `%rbp` chain is broken. Get full stacks by (a) rebuilding with `-fno-omit-frame-pointer` and re-running fp unwinding, or (b) using `--call-graph dwarf` (offline unwind via `.eh_frame`) or `--call-graph lbr` (hardware branch ring, shallow but free).
4. Their profiler was almost certainly **safepoint-biased** (JVMTI `GetStackTrace`/`getAllStackTraces`): it samples threads only at safepoints, and the JIT strips safepoint polls from hot inlined loops, so time gets misattributed to a nearby trivial method (the getter) instead of the real inlined hot loop. **async-profiler** (perf_events trigger + `AsyncGetCallTrace`, plus `-XX:+PreserveFramePointer`) samples where the CPU actually is and would have shown the real hot path.
5. It's an **off-CPU** problem — threads are blocked (locks, I/O, network, scheduling), and a CPU profile can't see sleeping threads. Next: (a) capture an off-CPU / wall-clock profile (`offcputime` via BPF, or async-profiler `event=wall`) to see what they block on; (b) in Go, capture `runtime/trace` (`go tool trace`) for the scheduler/blocking timeline, and/or the `block` and `mutex` pprof profiles.
6. **Symbolication** of V8's JIT-generated code is failing — those functions were created in anonymous memory at runtime and aren't in any binary's symbol table. Fix: run Node with `--perf-basic-prof` so V8 writes `/tmp/perf-<pid>.map`, which `perf report` consults to name the JIT frames (or use `perf inject --jit` with jitdump for code-level detail).
7. 999 Hz is *odd*, so it won't alias (sample in lockstep) with periodic work that ticks at round rates (1000 Hz timers, 100 Hz schedulers, frame loops), which would systematically over/under-count it. Jumping to 9999 Hz adds per-sample interrupt + unwinding overhead until the unwinding cost itself appears in the profile and overhead becomes non-uniform (re-ranking functions); to tighten statistics, profile for longer *duration* rather than at higher frequency.

</details>

---

## Cheat Sheet

```
ORIENT FIRST (count, don't sample)
  perf stat ./app            cycles, instructions, IPC, cache/branch misses
  IPC < 1   → stalled (memory-bound): fix data layout, not instruction count
  IPC ~ 3-4 → compute-bound: instruction-count / algorithm is the lever

PICK THE EVENT (it defines the meaning)
  -e cycles        where on-CPU TIME goes (stalls included)   ← default
  -e instructions  where WORK is done (stalls invisible)
  -e cache-misses  where memory stalls originate
  -e cycles:pp     PRECISE (PEBS) — kills skid; use before perf annotate

UNWINDING (a flame graph is only as good as this)
  --call-graph fp     cheap, full depth — needs -fno-omit-frame-pointer
  --call-graph dwarf  walks optimized code — heavy, truncates deep stacks
  --call-graph lbr    free, hardware — only last 16-32 frames (shallow)
  ORC                 kernel's own unwinder (kernel stacks, no FP)

FREQUENCY
  -F 99 / -F 999      production default — ODD, low overhead, no aliasing
  NOT -F 9999         overhead + unwinding cost re-ranks; profile LONGER instead

JVM (beware safepoint bias)
  async-profiler: perf_events trigger + AsyncGetCallTrace (samples ANYWHERE)
  asprof -d 30 -e cpu  -f cpu.html  <pid>        on-CPU flame graph
  asprof -d 30 -e wall -f wall.html <pid>        wall-clock (sees blocking)
  -XX:+PreserveFramePointer                      walkable native/mixed stacks

GO
  /debug/pprof/profile?seconds=30   on-CPU (SIGPROF sampling)
  /debug/pprof/trace?seconds=5      scheduler/blocking timeline (off-CPU)
  /debug/pprof/{block,mutex}        contention-specific
  pprof.Labels(...) + pprof.Do(...) slice CPU time by endpoint/tenant

ON-CPU vs OFF-CPU (sum = whole thread life)
  flat CPU profile but slow → time is OFF-CPU (locks/IO/sched)
  offcputime-bpfcc -p <pid> 30     who blocks, on what stack, how long

SYMBOLICATION (JIT/interpreted)
  /tmp/perf-<pid>.map     addr→name contract; Node: --perf-basic-prof
  perf inject --jit       jitdump: names + code + line tables
  py-spy                  external sampler, reads CPython frames, no [unknown]

PRODUCTION (continuous, always-on)
  Parca / Pyroscope / (Google GWP)  eBPF, <1% per host, fleet-wide
  killer feature: DIFF two time windows → catch the regressing deploy
```

---

## Summary

- A CPU profile is a **statistical poll**: interrupt every *N* events, snapshot one instruction and one stack, aggregate. Every failure mode follows from that — it's a sample, not a recording.
- **The event you sample sets the profile's meaning.** `cycles` measures on-CPU time (stalls included); `instructions` measures work (stalls invisible). Their gap is IPC, and low IPC diagnoses a memory/stall problem that no instruction-count tuning will fix.
- **Sampling skid** means the recorded instruction is often the one *after* the culprit, because out-of-order cores take the interrupt late. `perf record -e cycles:pp` uses **PEBS** to record the true instruction; trust instruction-level results only with precise events.
- **Stack unwinding** has three modes with real tradeoffs: **fp** (cheap, needs `-fno-omit-frame-pointer`), **DWARF** (walks optimized code, heavy, truncates deep), **LBR** (free, shallow). Truncated/`[unknown]` stacks are an unwinding diagnosis.
- **Safepoint bias** invalidates classic JVM profilers — they sample at safepoints, which the JIT strips from hot code. **async-profiler** dodges it with perf_events (interrupt anywhere) + `AsyncGetCallTrace` (walk Java frames in a signal handler), plus `-XX:+PreserveFramePointer` for mixed stacks.
- **On-CPU profiles can't see blocked threads.** "Flat but slow" means the time is **off-CPU** — locks, I/O, scheduling — answered by off-CPU/wall-clock profiling or Go's `runtime/trace`. On-CPU + off-CPU is the only complete accounting.
- **JIT/interpreted code needs symbolication help** (`/tmp/perf-<pid>.map`, jitdump, `py-spy`); `pprof` labels let you slice CPU time by application dimension. And **continuous, fleet-wide profiling** (Parca/Pyroscope/GWP) at sub-1% overhead turns "what regressed last deploy" into a flame-graph diff.

You now reason about a CPU profile as an instrument with known biases, and you can defend — or refute — any conclusion drawn from one. The next layer, [professional.md](professional.md), is about operating profiling as a continuous, organization-wide discipline: SLO-driven profiling, profile storage and querying at scale, and profile-guided optimization in the build pipeline.

---

## Further Reading

- *Systems Performance* (2nd ed.) — Brendan Gregg. Chapters on CPUs, profiling, and the on-CPU/off-CPU methodology; the canonical treatment.
- [Brendan Gregg — "The PMCs of EC2" and "perf Examples"](https://www.brendangregg.com/perf.html) — practical `perf` recipes, skid, and PMU events.
- [async-profiler documentation and wiki](https://github.com/async-profiler/async-profiler) — safepoint bias, `AsyncGetCallTrace`, and mixed-mode stacks, from the source.
- *Google-Wide Profiling: A Continuous Profiling Infrastructure for Data Centers* (Ren et al., IEEE Micro 2010) — the paper that defined fleet-wide continuous profiling.
- [The Parca / Pyroscope documentation](https://www.parca.dev/docs/overview) — eBPF-based continuous profiling architecture and differential profiling.
- Intel SDM Vol. 3B (PEBS) and the AMD IBS documentation — the precise-sampling hardware, authoritatively.
- `man perf-record`, `man perf-stat`, `man perf_event_open` — the events, precision suffixes, and call-graph modes.

---

## Related Topics

- [junior.md](junior.md) — the first profile: capturing one and reading the top of the list.
- [middle.md](middle.md) — sampling vs instrumentation, flat vs cumulative, the call-graph workflow.
- [professional.md](professional.md) — profiling as an org-wide discipline: storage, querying, SLO-driven and profile-guided optimization.
- [04 — Flame Graphs › Senior](../04-flame-graphs/senior.md) — differential and off-CPU flame-graph reading, the dominant visualization for these profiles.
