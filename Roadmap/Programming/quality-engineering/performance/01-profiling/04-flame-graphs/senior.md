# Flame Graphs — Senior Level

> **Roadmap:** [Profiling](../README.md) → Flame Graphs
> *The middle page taught you to read a flame graph. This page is about trusting one. A flame graph is only as honest as the stacks that fed it — and in production those stacks are routinely truncated, merged, mis-attributed, or silently dropped. The senior skill is knowing when the picture is lying, why, and how to get a true one.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Stack Quality — Why the Graph Is Often Wrong](#stack-quality--why-the-graph-is-often-wrong)
4. [Inlining — The Frames That Vanish or Merge](#inlining--the-frames-that-vanish-or-merge)
5. [Off-CPU Flame Graphs — Profiling the Wait](#off-cpu-flame-graphs--profiling-the-wait)
6. [Differential Flame Graphs Done Right](#differential-flame-graphs-done-right)
7. [FlameScope — The Variance a Single Graph Averages Away](#flamescope--the-variance-a-single-graph-averages-away)
8. [The Missing-Time Problem — Skid and Lost Samples](#the-missing-time-problem--skid-and-lost-samples)
9. [Flame Graphs for Non-Time Metrics at Scale](#flame-graphs-for-non-time-metrics-at-scale)
10. [eBPF and Fleet-Wide Continuous Profiling](#ebpf-and-fleet-wide-continuous-profiling)
11. [Reading Judgment — Cumulative, Recursion, and Noise](#reading-judgment--cumulative-recursion-and-noise)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The hard parts of producing a flame graph you can act on — stack fidelity, off-CPU capture, valid comparison, sub-second variance, and fleet-scale collection.**

At the middle level you can read a flame graph fluently: width is time, the y-axis is stack depth, plateaus are hot leaves, towers are hot paths. That gets you a long way against your own code on your own laptop. The senior problem is different. In production, against an optimized binary, under load, with a sampling profiler racing a CPU that reorders and skids — the flame graph you get is frequently *not* a faithful rendering of where time went. Frames are missing. Stacks are stitched to the wrong parent. A third of your latency doesn't appear at all because the thread was asleep, not on-CPU. Two flame graphs you're "comparing" had different sample counts, so the colors lie.

A senior engineer treats a flame graph the way a senior treats any instrument: with a model of its error sources. You need to know *why* a stack came back six frames deep when the real call chain is forty, why a hot function appears split across three towers, why `cargo flamegraph` shows a clean picture and `perf` shows mud, and why the off-CPU graph — the one almost nobody generates — is usually where the real latency bug is hiding. This page is that model: the failure modes of stack collection, the variants that recover the truth, and the infrastructure that does it across thousands of hosts.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — anatomy, reading wide vs deep, generating graphs with `flamegraph.pl` / `pprof` / async-profiler.
- **Required:** You understand sampling profiling (timer-driven stack capture) vs instrumentation, and the [01 — CPU Profiling](../01-cpu-profiling/senior.md) story of `perf record`/`perf report`.
- **Helpful:** A working model of the call stack at the machine level: the frame pointer (`%rbp`), the return-address chain, and what an optimizer is allowed to do to both.
- **Helpful:** You've been burned at least once by a flame graph that was confidently wrong, and want to know why.

---

## Stack Quality — Why the Graph Is Often Wrong

A flame graph is a frequency count of *stack traces*. If the traces are corrupt, every downstream conclusion is corrupt — and collecting a correct stack trace from a running, optimized program is genuinely hard. The profiler has a program counter and a stack pointer; it must reconstruct the chain of callers from there. There are three ways to do that, and each fails differently.

**1. Frame-pointer (FP) unwinding.** The classic convention: every function pushes the caller's `%rbp` and sets `%rbp` to its own frame, forming a linked list the unwinder can walk in a handful of instructions. Cheap, robust, works in-kernel. The catch: compilers *omit* the frame pointer by default at `-O2` (`-fomit-frame-pointer` is implied) because `%rbp` then becomes a free general-purpose register, worth a small but real speedup. With frame pointers omitted, FP unwinding walks into garbage after the first frame — you get **broken, truncated stacks**: a leaf or two, then `[unknown]`, then nothing.

```bash
perf record -F 99 -g -- ./app          # -g defaults to fp unwinding
perf script | head -40
# main
# [unknown]            ← frame pointer omitted: chain breaks here
```

The fix is to compile with `-fno-omit-frame-pointer`. This is the **frame-pointer trade**, and it is a real organizational decision, not a free win. Restoring the frame pointer costs roughly **1–2% CPU** on typical workloads (occasionally more on register-starved hot loops, near-zero on memory-bound code). In exchange you get cheap, always-correct, in-kernel-capable unwinding fleet-wide. Major distributions (Fedora, Ubuntu) re-enabled frame pointers in their default builds in 2023–2024 *specifically* to make continuous profiling trustworthy — the consensus among people who profile at scale is that 1% CPU is a bargain for stacks that are never broken. If your binaries omit frame pointers, your flame graph's depth is a lie wherever the chain snapped.

**2. DWARF (CFI) unwinding.** Instead of a runtime convention, the compiler emits `.eh_frame` / `.debug_frame` Call Frame Information describing, for every PC, how to find the caller's frame and saved registers. `perf record --call-graph dwarf` uses this. It works *without* frame pointers and reconstructs stacks correctly even through `-O2` code — but it's expensive in a way that distorts production profiling: `perf` can't interpret DWARF cheaply at sample time, so it **copies a chunk of the user stack** (default 8 KB) into the trace on every sample and unwinds offline.

```bash
perf record -F 99 --call-graph dwarf,16384 -- ./app   # copy 16KB of stack/sample
#   huge perf.data, high overhead, and stacks deeper than the dump size get truncated
```

That stack-copy has two consequences a senior must weigh. First, **enormous trace volume and overhead** — easily 5–20x the data of FP unwinding, enough to perturb the very latency you're measuring. Second, **the dump-size truncation trap**: any stack deeper than the copied window (8 KB ≈ a few dozen frames of deep recursion or fiber machinery) is cut off, reintroducing the truncation you were trying to avoid. DWARF unwinding is the right tool when you *cannot* recompile with frame pointers and you can tolerate the overhead on a profiling host — it is the wrong default for always-on fleet profiling.

**3. LBR (Last Branch Record) unwinding.** Intel/AMD CPUs keep a small hardware ring buffer of the most recent taken branches (16–32 entries). `perf record --call-graph lbr` reconstructs the call stack from that buffer — no frame pointers, no stack copy, very low overhead, hardware-accurate for the branches it captured. The limit is in the name: the ring is shallow (**~16–32 frames**), so deep stacks are truncated to the most recent N. LBR is excellent for shallow, hot CPU code and is the cheapest accurate option, but it can't show you a 60-frame web-framework call chain.

**4. ORC — the kernel's answer.** The Linux kernel can't use `.eh_frame` (it's stripped) and the maintainers refused to pay the frame-pointer tax kernel-wide for years. The compromise is **ORC** (Oops Rewind Capability): a *custom, compact, fast* unwind-table format generated by `objtool` at kernel build time, living in `.orc_unwind`. It's a DWARF-like table designed to be simple and quick to interpret in-kernel, giving correct kernel stacks without frame pointers and without DWARF's cost. When you see clean kernel frames in a `perf` flame graph on a modern kernel (`CONFIG_UNWINDER_ORC=y`), ORC is why. (Userspace still needs FP/DWARF/LBR — ORC is a kernel-only mechanism.)

| Method | Needs FP? | Overhead | Depth limit | Best for |
|---|---|---|---|---|
| **Frame pointer** | yes (`-fno-omit-frame-pointer`) | ~1–2% CPU at build | none | fleet-wide always-on profiling |
| **DWARF (CFI)** | no | high (stack copy, big traces) | dump size (~8 KB) | recompile-impossible, profiling host |
| **LBR** | no | very low | ~16–32 frames | shallow hot CPU code |
| **ORC** | no (kernel) | low (in-kernel) | none | kernel stacks (objtool-generated) |

> **Key insight:** The flame graph's *depth axis* is exactly as trustworthy as your unwinding method. A truncated stack doesn't announce itself — it just produces a shallower tower that silently re-parents time onto the wrong frame. Before believing a flame graph, know which unwinder produced it and what that unwinder *cannot see*: frame-pointer-omitted code (FP breaks), stacks deeper than the dump (DWARF truncates) or the LBR ring (LBR truncates). The single highest-leverage fix for fleet profiling is `-fno-omit-frame-pointer` everywhere.

---

## Inlining — The Frames That Vanish or Merge

Even with perfect unwinding, an optimized binary lies about its call structure, because the optimizer *deleted* calls. When the compiler inlines `validate()` into `handle()`, there is no `validate` frame on the stack at runtime — its instructions are physically part of `handle`. A naive profiler attributes all of that time to `handle`, and `validate` simply **does not appear**. At `-O2`/`-O3` with aggressive inlining, the flame graph you see can be structurally unrelated to the source: a dozen source-level functions collapsed into three machine functions, their boundaries erased.

The recovery mechanism is **debug info**. The compiler records, per instruction range, the *inlining tree* — "these bytes came from `validate`, inlined into `handle` at line 42." Unwinders that read DWARF line/inline tables (or a symbol server) can **reconstruct the inlined frames**, re-expanding `handle` into `handle → validate → check_len` so the flame graph regains its source-level shape. This only works if the debug info exists and the tool reads it.

```bash
# perf: symbolize with inline frames (needs DWARF / debuginfo present)
perf script --inline | head
perf report --inline

# Go's pprof reconstructs inlined frames natively from the binary's pclntab:
go tool pprof -http=:8080 cpu.prof    # inlined funcs shown as their own frames

# addr2line proves inlining at a single PC:
addr2line -f -i -e ./app 0x40123a
# check_len            ← innermost inlined
# validate             ← inlined into
# handle               ← the real on-stack frame
```

The senior consequences:

- **Missing frames inflate their inliner.** If `validate` is hot but inlined and *not* reconstructed, its time hides inside `handle`. You'll "optimize `handle`" and find the cost was in a callee you couldn't see. Always profile with inline reconstruction on (`--inline`, debuginfo present) before drawing conclusions about a fat plateau.
- **Stripped production binaries lose it entirely.** No debug info → no inline reconstruction → permanently merged frames. The fix is to ship/serve **separate debuginfo** (split debug, a debuginfod server) so the profiler can re-expand inlines without bloating the deployed binary. This is the same separate-symbols discipline as `09 — Reproducible Builds`, now in service of profiling.
- **Tail-call optimization erases the parent, not the child.** A tail call reuses the caller's frame, so the *caller* can vanish from the stack — a subtler merge that even debug info handles imperfectly. When a known caller is missing rather than a callee, suspect TCO.
- **Runtime-specific behavior varies.** Go's `pprof` reconstructs inlines from `pclntab` baked into every binary (no separate debuginfo needed) — one reason Go flame graphs are unusually trustworthy out of the box. JIT runtimes (JVM, V8) instead emit a *runtime symbol map* (`perf-<pid>.map`) so `perf` can name JIT'd frames at all.

> **Key insight:** Inlining and unwinding are the two independent ways a stack loses fidelity, and they fail in opposite directions. Broken unwinding **truncates** the stack (frames missing from the *root* side). Inlining **merges** the stack (frames missing from the *middle*). A flame graph can be perfectly unwound and still structurally wrong because the optimizer deleted the very functions you care about — only debug-info-driven inline reconstruction puts them back.

---

## Off-CPU Flame Graphs — Profiling the Wait

A CPU flame graph answers "where is the CPU spending cycles?" For a huge class of real latency problems, that is the *wrong question*, because the slow thread isn't burning CPU — it's **blocked**: waiting on a lock, a disk read, a database round-trip, a channel, a syscall. A thread asleep in `epoll_wait` or `futex` contributes *zero* samples to a CPU profile. Your p99 is 800 ms, your CPU flame graph is nearly empty, and you stare at it wondering where the time went. It went into the **off-CPU** state, which the CPU profiler is structurally blind to.

The **off-CPU flame graph** inverts the metric: width is **time spent off-CPU (blocked)**, attributed to the stack *at the moment the thread went to sleep*. Instead of "what ran," it shows "what we waited on, and who asked to wait." Together, on-CPU + off-CPU is the *complete* accounting of wall-clock time: every nanosecond a thread exists, it is either running (on-CPU) or blocked (off-CPU). One without the other is half the picture — and for latency-bound services it's usually the *less interesting* half.

How the wait time is actually captured depends on the stack:

**eBPF / `perf sched` at the kernel level (any language).** The kernel scheduler knows exactly when a thread leaves the CPU (`sched_switch` off) and returns (on). Capture the stack at switch-out, the timestamp at switch-out and switch-in, and the delta *is* the off-CPU duration for that stack. The eBPF tool `offcputime` (BCC) does precisely this, aggregating in-kernel so overhead stays sane even though context switches are far more frequent than CPU samples:

```bash
# BCC: off-CPU time by stack, blocked >1ms, for 30s → folded stacks → flame graph
/usr/share/bcc/tools/offcputime -df -m 1000 30 > offcpu.folded
./flamegraph.pl --color=io --title="Off-CPU Time" offcpu.folded > offcpu.svg

# perf-based alternative (sched switch events):
perf sched record -- sleep 30
perf sched latency                  # per-task scheduling latency summary
```

The eBPF approach is the senior default because it (a) aggregates stacks in kernel space — no per-switch userspace round-trip — and (b) can capture both kernel *and* user stacks at the blocking point. The honest caveat: at very high context-switch rates the overhead is real, and very short blocks (the `-m` threshold) are filtered to keep it tractable.

**Go runtime: block and mutex profiles.** Go doesn't need eBPF for this — the runtime instruments blocking directly. The **block profile** records stacks where goroutines block on channel ops, `select`, `sync` primitives, and network/timer waits; the **mutex profile** records contended `sync.Mutex`/`RWMutex` holders. Both feed `pprof` and render as off-CPU flame graphs:

```go
runtime.SetBlockProfileRate(1)        // sample every blocking event (1ns granularity)
runtime.SetMutexProfileFraction(1)    // sample every mutex contention event
```
```bash
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/block
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/mutex
```

And Go's **execution tracer** (`runtime/trace`) goes further than any sampled profile: it records *every* scheduling event with timestamps, so you can see a single goroutine's exact wall-clock timeline — running, blocked-on-mutex, blocked-on-network, GC-paused — not a statistical aggregate. When a Go service's latency doesn't show up in the CPU profile, the order of escalation is: block/mutex profile (cheap, aggregate) → execution trace (expensive, exact, per-event).

> **Key insight:** A CPU flame graph and an off-CPU flame graph are *complements*, not alternatives, and wall-clock time is exactly their sum. Latency bugs — lock contention, slow I/O, serialized round-trips — live almost entirely in the off-CPU graph, which most engineers never generate. The first question for any "it's slow but the CPU is idle" problem is "where's the off-CPU flame graph?" Capture the wait at switch-out (eBPF/`perf sched`) for language-agnostic coverage, or use the runtime's block/mutex profile when you have one.

---

## Differential Flame Graphs Done Right

You changed something and want to know what got faster or slower. The naive approach — eyeball two flame graphs side by side — fails because human vision can't diff thousands of stacks. The **differential flame graph** computes the difference per stack and colors it: typically **red = grew, blue = shrank**, intensity ∝ magnitude. Done right it's the fastest regression-finder you have. Done wrong it actively misleads, and the wrong way is the *default* way.

The core trap is **comparing two profiles with different total sample counts.** Profile A ran for 30 s and collected 3,000 samples; profile B (after your change, or on a busier host) ran for 30 s and collected 4,500 samples. A function that holds a *constant 10% share* in both will show **1,500 raw samples in B vs 1,000 in A** — and a naive diff paints it bright red ("this got 50% worse!") when in reality its proportion didn't move at all. The whole graph tilts red simply because B has more total samples. You'll chase a "regression" that's an artifact of sample-count mismatch.

The fix is **normalization**: compare *fractions*, not raw counts. Scale both profiles to the same total (or diff percentages) before subtracting, so the comparison measures *share of time*, which is what you actually care about. Brendan Gregg's `difffolded.pl` does this; so do `pprof -diff_base` and Speedscope's "left-heavy diff" view:

```bash
# Gregg's toolkit: normalize, then render red/blue
./difffolded.pl -n before.folded after.folded | ./flamegraph.pl > diff.svg
#   -n  = NORMALIZE sample counts  ← the flag that prevents the count-mismatch lie

# Go: pprof differential against a base profile (handles scaling)
go tool pprof -http=:8080 -diff_base=before.prof after.prof
```

Even normalized, two more pitfalls remain:

- **Red/blue hides the absolute size.** A function that *doubled* but represents 0.1% of runtime glows the same red as one that grew from 20% to 40%. A loud color does not mean a meaningful change — always read the diff *next to* the magnitude. Some tools (and Speedscope's left-heavy view) mitigate this by showing the after-graph with diff coloring, so width still encodes absolute cost.
- **Disappearing/appearing frames diff poorly.** If a refactor renamed or inlined a function, it shows as a large blue (gone) next to a large red (new) — not a true regression, just a relabeling. Differential graphs assume *stable* stack identities; a structural change to the code violates that and produces spurious red/blue pairs.

> **Key insight:** A differential flame graph compares *proportions*, and proportions only mean something after normalization. The single most common differential mistake is diffing raw counts from runs with different totals — it paints the whole graph red and invents a regression. Normalize first (`difffolded.pl -n`, `-diff_base`), then remember that color shows *direction and relative magnitude*, never absolute importance; a bright-red 0.1% frame is noise.

---

## FlameScope — The Variance a Single Graph Averages Away

A flame graph is an **average over the whole capture window.** That averaging is its strength for steady-state code and its blind spot for everything bursty. A service that's smooth for 28 seconds and then stalls for 2 seconds shows, in a 30 s flame graph, a *faint smear* of the stall — 2 s out of 30 is ~7% of width, easy to dismiss — when it's actually a periodic, severe perturbation. Tail latency, GC pauses, lock convoys, a cron job stomping the cache, a noisy neighbor: these are *time-localized* events that a single flame graph dilutes into invisibility.

**FlameScope** (Netflix) solves this by adding the time dimension back. It renders the capture as a **subsecond-offset heatmap**: the x-axis is elapsed wall-clock time, the y-axis is the *offset within each second* (0–1000 ms), and each cell's color is sample intensity at that sub-second offset. Patterns the flame graph erased become visible:

```
        elapsed seconds →
offset  0   1   2   3   4   5   6   7   8   9
within  ┌───────────────────────────────────────┐
sec     │ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ │ ← 0-100ms:  steady baseline load
(ms) ↓  │ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ │
        │ ░ ░ █ ░ ░ ░ ░ █ ░ ░ │ ← ~250ms:   periodic SPIKE every ~5s
        │ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ │
        │ ▓ ▓ ▓ ▓ ▓ ▓ ▓ ▓ ▓ ▓ │ ← 600ms:    horizontal band = once-per-sec event
        │ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ │              (timer? metrics flush? GC?)
        └───────────────────────────────────────┘
   ░ = low   ▓ = medium   █ = high sample intensity
```

The workflow is the payoff: you **select a region of the heatmap** — just the bright spike column, or just the horizontal band — and FlameScope generates a flame graph *from only the samples in that region*. Now you have a flame graph of the perturbation in isolation, with the steady-state baseline excluded. The horizontal band ("same offset every second") is a dead giveaway for a *periodic* task — a once-per-second metrics flush, a timer-driven GC, a heartbeat. A diagonal stripe means a slowly-drifting period. A vertical column means a one-time event at a specific wall-clock moment. None of these are legible in the averaged flame graph; all of them are obvious in the heatmap.

> **Key insight:** A flame graph trades away time to show you structure; FlameScope trades back enough time to show you *variance*. Whenever the symptom is "p99 is bad but p50 is fine" or "it stalls periodically," the averaged flame graph is the wrong tool — it dilutes the rare-but-severe event into the background. Use the subsecond heatmap to *find* the perturbation in time, then zoom that region into its own flame graph to see its stacks. Averages hide tails; FlameScope is how you stop averaging.

---

## The Missing-Time Problem — Skid and Lost Samples

Even with perfect stacks, the *attribution* of samples to instructions can be wrong, and under load samples can be *dropped* — two distinct sources of "missing time" that a flame graph won't flag.

**Skid.** A sampling profiler arms a hardware counter (cycles, or a PMU event) to interrupt after N events; the CPU then has to stop the out-of-order pipeline and record the instruction pointer. But on a deeply pipelined, speculating CPU, the IP captured at interrupt time is often **not the instruction that triggered the event** — it's one a few instructions downstream. This is **skid**, and it smears samples onto neighboring instructions and, at function boundaries, onto the *wrong function*. A tight hot loop's cost can appear to leak into the function after it. The hardware mitigation is **PEBS** (Precise Event-Based Sampling) on Intel / **IBS** on AMD, which records the *precise* faulting IP in a hardware buffer:

```bash
perf record -e cycles:pp -F 999 -g -- ./app    # :pp = use PEBS for precise IP (low skid)
#   :p  = reduced skid,  :pp = requested precise,  :ppp = max precise
```

Skid mostly distorts *which instruction/line* within a function, less so coarse function-level width — but at hot boundaries it absolutely moves time between adjacent frames. When line-level attribution in a flame graph looks "off by one function," suspect skid and re-record with `:pp`.

**Lost samples.** Under heavy load `perf` writes samples to a ring buffer that userspace drains; if the buffer fills faster than it's drained, samples are **silently dropped**. The flame graph then under-represents exactly the busiest periods — the time you most wanted to see. `perf` *does* tell you, if you look:

```bash
perf report 2>&1 | grep -i 'lost\|warning'
# Warning: Processed 482194 events and lost 1173 chunks!   ← samples dropped
perf record -m 64M ...        # bigger ring buffer → fewer drops
```

The deeper "missing time" symptom is a flame graph whose widths don't sum to the wall-clock you expected — a chunk is simply *gone*. The usual culprits, in order: (1) the thread was **off-CPU** and you only captured on-CPU (the big one — see above); (2) **lost samples** under load; (3) **broken unwinding** dumping time into `[unknown]`; (4) time in code with **no symbols** (JIT without a map, stripped libs) showing as a hex-address plateau you can't read.

> **Key insight:** "The widths don't add up to the wall-clock" is a signal, not a rounding error. Missing time is almost always one of: off-CPU time you didn't capture, samples lost to a full ring buffer, or unwinding/symbolization failures dumping time into `[unknown]`. And the *location* of time within a function is subject to skid — use precise sampling (`:pp`/PEBS/IBS) before trusting line-level attribution. A flame graph that accounts for less than the elapsed time is telling you where to look next.

---

## Flame Graphs for Non-Time Metrics at Scale

The flame-graph visualization is **metric-agnostic**: width can encode *any* additive quantity attributable to a stack, not just time. This is one of its most under-used powers. The y-axis is still "who called whom"; only the meaning of width changes. Senior-relevant variants:

- **Allocation flame graphs.** Width = bytes (or object count) allocated, attributed to the allocating stack. This finds the code paths that *create garbage*, which a CPU profile often misses because the *cost* of that garbage (GC) shows up elsewhere, attributed to the collector, not the allocator. Go: `go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap` with `alloc_space`. eBPF can trace `malloc`/`free` (via uprobes) for native code. The classic find: a fat allocation plateau in a hot path that's invisible in the CPU graph but is the *root cause* of GC pressure showing up as CPU.

- **Page-fault flame graphs.** Width = page faults, attributed to the faulting stack — surfaces memory-access patterns causing minor/major faults, mmap thrashing, or first-touch cost. `perf record -e page-faults -g` or `perf record -e major-faults -g`.

- **I/O and block-I/O flame graphs (eBPF).** Width = bytes read/written, or I/O latency, attributed to the issuing stack. BCC's `biostacks`/`fileslower` and bpftrace one-liners on `vfs_read`/`block_rq_issue` build a flame graph of *who is doing the I/O* — the disk-latency analog of an off-CPU graph, but attributed to the I/O initiator.

- **Lock-contention flame graphs.** Width = time spent *waiting* to acquire a lock (or contention count), attributed to the contending stack. This is an off-CPU graph specialized to synchronization: Go's mutex profile, or eBPF on `futex`/`lock` tracepoints (`offcputime` filtered to lock waits). It answers "which call paths are serializing on which lock," the single most common scalability ceiling in concurrent services.

```bash
# eBPF (bpftrace): block-I/O size by stack → folded → flame graph
bpftrace -e 'tracepoint:block:block_rq_issue { @[kstack, comm] = sum(args->bytes); }'

# Go allocation flame graph (alloc_space = total allocated, incl. freed)
go tool pprof -sample_index=alloc_space -http=:8080 http://localhost:6060/debug/pprof/heap
```

The senior judgment: **pick the metric that matches the symptom.** High GC CPU → *allocation* flame graph (find the allocator, not the collector). Slow under load but CPU idle → *off-CPU* or *lock-contention*. Erratic latency with high page-fault counts → *page-fault*. The visualization is constant; choosing the right width is the skill, and it routes directly to sibling topics — [03 — Allocation Profiling](../03-allocation-profiling/senior.md) for the allocation variant, and the broader profiling map for the rest.

> **Key insight:** A flame graph is a *renderer for any additive, stack-attributable metric*. The same SVG that shows CPU time shows allocated bytes, page faults, I/O bytes, or lock-wait time — you just change what you fold. The leverage is matching metric to symptom: optimizing CPU when the real problem is allocation (or lock contention) wastes the diagnostic. One visualization, many questions.

---

## eBPF and Fleet-Wide Continuous Profiling

Everything above describes profiling *one process, once*. The senior reality is profiling *thousands of hosts, continuously*, with overhead low enough to leave on in production forever. Two technology shifts make this possible: **eBPF** for near-zero-overhead in-kernel collection, and **continuous profilers** that aggregate flame graphs fleet-wide.

**eBPF profiling** runs a tiny, verified program in the kernel that samples stacks on a timer (or on events) and aggregates them *in kernel space* — counting stack frequencies in a BPF map — so userspace only ever reads compact summaries, never per-sample data. This collapses the overhead that made always-on profiling impractical. The accessible front-ends:

```bash
# BCC: on-CPU profile, system-wide, 30s, folded → flame graph
/usr/share/bcc/tools/profile -F 99 -df 30 > out.folded
./flamegraph.pl out.folded > cpu.svg

# bpftrace: one-liner on-CPU flame-graph input (user+kernel stacks)
bpftrace -e 'profile:hz:99 { @[ustack, kstack, comm] = count(); }'
```

The key property: eBPF can capture **kernel and user stacks together**, system-wide, without recompiling the target — making it the substrate for the off-CPU, I/O, and lock variants above as well as plain CPU. It still depends on good *userspace* unwinding (frame pointers, or DWARF, or recent kernels' BPF stack-walking), which is exactly why the frame-pointer decision matters at fleet scale: eBPF gives you cheap collection, but only frame pointers give you cheap *correct* collection.

**Continuous, fleet-wide profilers** build the production system on top. **Parca** (CNCF, eBPF-based, agent per node) and **Grafana Pyroscope** (formerly Pyroscope/Phlare; eBPF *and* SDK-based) continuously sample every process across the fleet, attach metadata (service, version, pod, region), store profiles time-series-style, and serve **flame graphs you can slice by any dimension and diff across time or version**. This turns the flame graph from a one-shot artifact into a queryable signal:

- *"Show the CPU flame graph for `checkout-v2` in `us-east`, last hour"* — aggregated across every replica.
- *"Diff this week's flame graph against last week's"* — a differential flame graph over *time*, normalization handled.
- *"Which deploy added that hot path?"* — version-labeled profiles make regressions attributable to a release.

This is the natural endpoint of everything on this page: the same folded-stack → flame-graph pipeline, but with eBPF collection (cheap), proper unwinding (frame pointers, trustworthy), and a backend that aggregates, labels, normalizes, and diffs (correct comparison) — across the whole fleet, all the time. **pprof** remains the interchange format that ties it together (Go, Parca, and Pyroscope all speak it), which is why the pprof format is effectively the lingua franca of profiling.

> **Key insight:** Continuous profiling makes the flame graph a *production telemetry signal*, not a debugging session. eBPF supplies the cheap, system-wide, kernel-and-user collection; Parca/Pyroscope supply the aggregation, labeling, time-series storage, and *normalized differential* across versions and regions. The hard parts from earlier on this page (unwinding quality, off-CPU capture, valid diffing) don't disappear at scale — they become *configuration*: enable frame pointers fleet-wide, collect off-CPU alongside on-CPU, and let the backend handle normalization so the cross-version diffs are honest.

---

## Reading Judgment — Cumulative, Recursion, and Noise

Trustworthy stacks still get misread. The senior reading errors:

**Cumulative vs self, at the leaf.** A function's *total* (cumulative) width is its own time plus all its callees'. Its *self* time is only the work in its own body. A function that's 50% of the flame graph is 50% *cumulative* — almost always because it *calls* expensive things, not because *it* is expensive. Optimizing the wide-but-shallow frame at the top of a deep tower is futile; the cost is at the **leaves**, where self time lives. The rule: **find time in the widest *leaf* plateaus**, not the widest frame overall. (`pprof`'s flat-vs-cum columns make this explicit; in a flame graph, look for wide frames with *little above them*.)

**Recursion fragments and inflates.** A recursive function appears as a *tower of identical frames* — `quicksort → quicksort → quicksort → …` — which (a) makes the call look pathologically deep when it's just recursion, and (b) splits its self-time across many stack frames so no single frame looks dominant even when the function is the hot spot. Folding recursion (collapsing repeated adjacent identical frames into one, which `pprof` and some viewers do) is what makes recursive code legible. An unfolded recursive tower routinely fools people into "optimizing the depth" when the issue is the per-call body.

**Framework noise drowns the signal.** In a web service, the top of nearly every stack is identical middleware/router/serialization machinery — a forest of thin towers that share a deep common base of framework frames. The *cumulative* base looks huge (everything goes through it) but the *actionable* self time is in your handlers near the leaves. Don't optimize the framework's plateau; it's a fixed cost shared by all requests. Use the inverted ("icicle") graph or merge-by-function to push *your* hot leaves to the top where they're visible above the framework base.

> **Key insight:** Three reading traps survive perfect data. **Cumulative ≠ self** — wide frames are usually wide because of callees; act on wide *leaves*. **Recursion** inflates depth and fragments self-time — fold it before judging. **Framework noise** makes shared infrastructure look like the bottleneck when it's a fixed cost — find *your* code's leaves. The flame graph is honest; the eye needs discipline.

---

## Mental Models

- **A flame graph is a frequency count of stacks — garbage stacks in, garbage graph out.** Every fidelity question (truncation, merging, skid, lost samples, off-CPU blindness) is a question about the *input stacks*, not the visualization. Fix the stacks and the graph fixes itself.

- **Unwinding and inlining fail in opposite directions.** Broken unwinding truncates from the *root* (frames missing from the bottom). Inlining merges in the *middle* (frames the optimizer deleted). A correct flame graph needs both good unwinding (frame pointers) *and* inline reconstruction (debug info).

- **Wall-clock time = on-CPU + off-CPU, exactly.** A CPU flame graph shows one term. Latency bugs live in the other. "Slow but CPU idle" always means "go generate the off-CPU graph."

- **Differential = proportions, and proportions need normalization.** Diffing raw sample counts from runs with different totals invents regressions. Normalize to shares first; then color shows direction, never absolute importance.

- **The flame graph averages over time; FlameScope un-averages it.** Rare-but-severe perturbations are diluted into the background of a single flame graph. The subsecond heatmap finds them in time so you can zoom one region into its own graph.

- **Act on the leaves.** Cumulative width flows downward through callees; self time pools at the leaves. The widest frame is usually a caller of the real problem. Recursion and framework frames are the two things that most distort this — fold recursion, ignore the shared framework base.

---

## Common Mistakes

1. **Trusting a flame graph from frame-pointer-omitted binaries.** Default `-O2` omits the frame pointer, so FP unwinding produces truncated stacks that silently re-parent time. Build with `-fno-omit-frame-pointer` (≈1% CPU) or use DWARF/LBR, and *know* which unwinder ran.

2. **Drawing conclusions about a fat plateau without inline reconstruction.** Inlined callees hide inside their inliner; the real cost may be in a function that doesn't appear. Profile with `--inline` and debuginfo present, or you'll optimize the wrong frame.

3. **Only ever generating CPU flame graphs.** If the symptom is latency-under-load with idle CPU, the CPU graph is empty by construction. The time is off-CPU (locks, I/O, waits) — generate the off-CPU flame graph (`offcputime`, block/mutex profile).

4. **Diffing two profiles with different total sample counts.** Raw-count diffs paint everything red when B simply collected more samples. Normalize first (`difffolded.pl -n`, `pprof -diff_base`) so you compare shares, not counts.

5. **Reading red/blue as importance instead of direction.** A bright-red 0.1% frame and a bright-red 30% frame look identical. Color is direction + relative magnitude only — always read it next to absolute width.

6. **Using one averaged flame graph for a bursty/periodic problem.** Averaging dilutes a 2 s stall in a 30 s window into a faint 7% smear. Use FlameScope's subsecond heatmap to locate the event in time, then zoom that region.

7. **Optimizing the widest frame instead of the widest leaf.** A 50%-cumulative frame is wide because of its callees. Self time lives at the leaves; act there. Fold recursion and look past the shared framework base first.

8. **Ignoring `[unknown]` plateaus and "lost samples" warnings.** A hex-address or `[unknown]` plateau is missing symbols/unwinding; a "lost N chunks" warning means dropped samples under load. Both mean the graph is under-counting exactly where you care — fix symbols, enlarge the ring buffer (`-m`).

---

## Test Yourself

1. A `perf` CPU flame graph shows `main` → one frame → `[unknown]`, then nothing, on an optimized binary. What's the most likely cause, and what are two distinct fixes with different trade-offs?
2. A function you know is hot doesn't appear in the flame graph at all, even though unwinding is clean. Why might that be, and how do you recover it?
3. Your service's p99 is 500 ms but the CPU flame graph is nearly empty. Where is the time, what kind of flame graph do you generate, and how is its width captured?
4. You diff a before/after profile and the *entire* graph is tinted red. What's the most likely measurement error, and what single flag prevents it?
5. p99 is bad but p50 is fine, and the averaged flame graph shows nothing obvious. What tool do you reach for and what does it let you do that a flame graph can't?
6. A flame graph's frame widths visibly sum to less than the wall-clock elapsed time. List three distinct reasons time could be "missing."
7. You want to know which code paths are creating GC pressure, but the CPU flame graph attributes the cost to the garbage collector. What flame-graph variant do you generate instead, and why?

<details>
<summary>Answers</summary>

1. The binary was built with the frame pointer **omitted** (default at `-O2`), so frame-pointer unwinding breaks after the first frame → truncated stack ending in `[unknown]`. Fixes: (a) recompile with **`-fno-omit-frame-pointer`** — cheap (~1%), correct, in-kernel-capable, best for always-on profiling; (b) record with **`--call-graph dwarf`** — works without recompiling but copies the user stack each sample (high overhead, big traces, truncates past the dump size); or (c) **`--call-graph lbr`** — very low overhead, hardware-accurate, but limited to ~16–32 frames.

2. It was **inlined** into its caller — at `-O2`/`-O3` the function has no runtime frame; its time is attributed to the inliner. Recover it with **inline reconstruction from debug info**: `perf script --inline` / `perf report --inline` with debuginfo present (or a debuginfod server for stripped binaries); Go's `pprof` reconstructs inlines from `pclntab` automatically. `addr2line -i` confirms the inline chain at a PC.

3. The threads are **off-CPU** (blocked on locks, I/O, or waits), which a CPU profile can't see. Generate an **off-CPU flame graph** where width = time spent blocked, attributed to the stack at switch-out. Capture it via the scheduler: eBPF `offcputime` (timestamps `sched_switch` out→in, aggregates in kernel) or `perf sched`; in Go, via the runtime **block/mutex profiles** (`SetBlockProfileRate`/`SetMutexProfileFraction`).

4. Comparing two profiles with **different total sample counts** — the larger run shows more raw samples everywhere, so a constant-share function looks like it grew. The fix is **normalization** (compare fractions): `difffolded.pl -n`, or `pprof -diff_base` which scales for you.

5. **FlameScope.** It renders the capture as a subsecond-offset heatmap (x = elapsed time, y = offset within each second), making periodic/bursty perturbations visible that the averaged flame graph dilutes. You then **select the perturbation's region** and generate a flame graph from only those samples — isolating the stall's stacks from the steady-state baseline.

6. Any of: (a) **off-CPU time** not captured (threads were blocked, not running); (b) **lost samples** — the `perf` ring buffer filled under load and dropped events (the "lost N chunks" warning); (c) **broken unwinding / missing symbols** dumping time into `[unknown]` or unreadable hex plateaus (stripped libs, JIT without a `perf-<pid>.map`). Skid also *moves* time between adjacent frames (mitigated by PEBS/IBS, `:pp`).

7. An **allocation flame graph** (width = bytes/objects allocated, attributed to the *allocating* stack), e.g. Go's `alloc_space` heap profile or eBPF on `malloc`. The CPU graph blames the collector because that's where the *cost* of garbage is spent; the allocation graph shows the *cause* — the code paths producing the garbage — which is what you actually fix.

</details>

---

## Cheat Sheet

```
STACK QUALITY (the graph is only as good as its stacks)
  -fno-omit-frame-pointer        ~1% CPU; correct FP unwinding everywhere (fleet default)
  perf record -g                 frame-pointer unwinding (breaks if FP omitted)
  perf record --call-graph dwarf,16384   DWARF/CFI; no FP needed; high overhead, dump-size truncation
  perf record --call-graph lbr   hardware branch stack; very cheap; ~16-32 frame limit
  (kernel) CONFIG_UNWINDER_ORC   ORC tables → correct kernel stacks, no FP, low cost

INLINING (frames merged by the optimizer)
  perf script --inline / report --inline    reconstruct inlined frames (needs debuginfo)
  addr2line -f -i -e app <addr>              prove the inline chain at a PC
  go tool pprof                              reconstructs inlines from pclntab natively

OFF-CPU (wall-clock = on-CPU + off-CPU)
  offcputime -df -m 1000 30 > off.folded     eBPF: blocked time by stack (>1ms)
  perf sched record / perf sched latency     scheduler-event off-CPU view
  runtime.SetBlockProfileRate(1)             Go: block profile (channels, select, sync)
  runtime.SetMutexProfileFraction(1)         Go: mutex-contention profile
  runtime/trace                              Go: exact per-goroutine wall-clock timeline

DIFFERENTIAL (compare proportions, not counts)
  difffolded.pl -n before.folded after.folded | flamegraph.pl   -n = NORMALIZE (critical)
  go tool pprof -diff_base=before.prof after.prof               scales automatically
  red = grew, blue = shrank; magnitude only — NOT absolute importance

VARIANCE / TIME
  FlameScope                     subsecond heatmap → select region → flame graph of it
  perf record -e cycles:pp       PEBS/IBS precise IP → low skid (trust line attribution)
  perf record -m 64M             bigger ring buffer → fewer lost samples
  grep -i 'lost' (perf report)   detect dropped samples under load

NON-TIME METRICS (same viz, different width)
  pprof -sample_index=alloc_space ...        allocation flame graph (find the allocator)
  perf record -e page-faults -g              page-fault flame graph
  bpftrace block_rq_issue / sum(args->bytes) I/O-by-stack flame graph

FLEET-WIDE
  bcc profile -F 99 -df 30                    eBPF on-CPU, system-wide, low overhead
  bpftrace -e 'profile:hz:99{@[ustack,kstack,comm]=count();}'
  Parca / Grafana Pyroscope                  continuous, labeled, time-diffable flame graphs
  pprof                                       the interchange format tying it all together
```

---

## Summary

- A flame graph is a **frequency count of stack traces** rendered as nested rectangles; it is only as trustworthy as the stacks that fed it. Senior skill is modeling its error sources, not just reading width and depth.
- **Stack fidelity** has two independent failure modes. *Unwinding* truncates from the root: frame-pointer-omitted code breaks FP unwinding (`-fno-omit-frame-pointer` fixes it at ≈1% CPU), DWARF avoids that but copies the stack and truncates past the dump, LBR is cheap but shallow, and ORC gives correct kernel stacks. *Inlining* merges in the middle: the optimizer deletes callees, and only debug-info-driven **inline reconstruction** puts them back.
- **Wall-clock = on-CPU + off-CPU.** The off-CPU flame graph — width = blocked time, captured at scheduler switch-out via eBPF/`perf sched` or a runtime block/mutex profile — is where latency bugs live and is the variant most engineers never generate.
- **Differential flame graphs compare proportions**, so they require **normalization**; diffing raw counts from runs with different totals invents regressions. Red/blue shows direction and relative magnitude, never absolute importance.
- **FlameScope** adds time back as a subsecond heatmap, surfacing periodic/bursty perturbations that a single averaged flame graph dilutes into the background — then zooms a region into its own flame graph.
- **Missing time** is a signal: off-CPU time not captured, samples lost to a full ring buffer, or unwinding/symbol failures into `[unknown]`; and **skid** moves time between adjacent frames unless you sample precisely (PEBS/IBS, `:pp`).
- The visualization is **metric-agnostic** — allocation, page faults, I/O bytes, lock-wait — so match the width to the symptom. At scale, **eBPF** collection plus **Parca/Pyroscope** turn the flame graph into a continuous, labeled, time-diffable production signal, with **pprof** as the common format.

You now treat a flame graph as an instrument with known error bars — you know when it's lying, why, and which variant tells the truth. The next layer — [professional.md](professional.md) — is about operating profiling as a continuous practice across a fleet: SLO-linked regression detection, profile retention, and making "read the flame graph" a reflex the whole org has.

---

## Further Reading

- *Systems Performance* (2nd ed.) and *BPF Performance Tools* — Brendan Gregg. The off-CPU methodology, eBPF profiling tools (`profile`, `offcputime`), and stack-quality issues, from the person who invented the flame graph.
- [brendangregg.com/flamegraphs.html](https://www.brendangregg.com/flamegraphs.html) and the [FlameGraph repo](https://github.com/brendangregg/FlameGraph) — `flamegraph.pl`, `difffolded.pl -n`, and the folded-stack format.
- [Netflix FlameScope](https://github.com/Netflix/flamescope) and the *Netflix Tech Blog* FlameScope posts — the subsecond-offset heatmap and variance analysis.
- [The Return of the Frame Pointers](https://www.brendangregg.com/blog/2024-03-17/the-return-of-frame-pointers.html) — Gregg on the `-fno-omit-frame-pointer` trade and why distros re-enabled it.
- [Parca](https://www.parca.dev/) and [Grafana Pyroscope](https://grafana.com/oss/pyroscope/) docs — eBPF-based continuous, fleet-wide profiling and labeled/diffable flame graphs.
- Linux kernel `Documentation/x86/orc-unwinder.rst`; `man perf-record` (`--call-graph`, `:pp`, `-m`); the [pprof format](https://github.com/google/pprof) docs.

---

## Related Topics

- [Flame Graphs — Junior](junior.md) — anatomy and first reads: width, depth, plateaus vs towers.
- [Flame Graphs — Middle](middle.md) — generating graphs with `flamegraph.pl`, `pprof`, async-profiler, Speedscope.
- [Flame Graphs — Professional](professional.md) — operating flame graphs as a continuous, org-wide practice.
- [01 — CPU Profiling › Senior](../01-cpu-profiling/senior.md) — the sampling-profiler internals (`perf record`, PMU, skid) that feed CPU flame graphs.
- [03 — Allocation Profiling › Senior](../03-allocation-profiling/senior.md) — the allocation-metric flame-graph variant in depth.
