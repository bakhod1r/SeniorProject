# Runtime ↔ GC Integration — Professional Level

> **Topic:** [Runtime ↔ GC Integration](README.md)
> **Focus:** Designing and operating the interface at production scale: stack-map encoding budgets, safepoint protocol design (per-thread polling, hijacking, signals), barrier ABI and codegen contracts, allocation-path co-design (TLABs, bump pointers, sampling), and running latency-SLO incidents to ground. The contract as an engineering system — not the collection algorithm.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **The interface as a system you design, ship, and operate** — with budgets, ABIs, protocols, failure modes, and an on-call runbook.

The senior page covered *how* engines solve the hard cases. The professional page is about *owning* the interface: the cross-cutting design decisions, the costs you must budget, the contracts you must specify so independent teams (codegen, runtime, GC) can ship without breaking each other, and the operational discipline to keep latency SLOs intact in production.

Four pillars frame this level:

1. **Metadata economics.** Stack maps / GC info are *data you ship*. In a large application there are millions of safepoints; naive maps can rival code size. You budget and compress this — bitmaps, deltas, dictionary sharing, partially-interruptible regions — trading map size against stop granularity and TTSP.

2. **Safepoint protocol as a distributed agreement.** Bringing N threads to a globally consistent halt is a tiny consensus problem. The protocol (poll mechanism, thread-local vs global, hijacking, signals, native-transition handshakes) determines your TTSP distribution, which *is* your pause-time tail. You design it for the worst thread, not the average.

3. **Barrier ABI and codegen contract.** The barrier is a contract between the GC team and the codegen team: which registers it clobbers, what it may call, what it must not do (allocate? safepoint?), how it's elided. A loose contract here produces correctness bugs that surface as one-in-a-billion crashes. You specify it precisely and test it adversarially.

4. **Allocation/collection co-design.** Throughput is dominated by the allocation fast path (TLAB bump) and the rate at which it feeds the collector. You co-design TLAB sizing, bump-pointer layout, allocation-site sampling (for profiling and for sampled allocation policies), and the slow-path → GC handoff.

Through all of it: **you measure, budget, and SLO the interface.** A pause-time SLO (p99.9 < 10 ms) is met or missed largely by integration decisions — TTSP protocol, barrier cost, allocation rate — not by the collection algorithm in isolation.

> 🎓 **Why this matters at the professional level:** You are the person who signs off that "we can run this collector under this SLO on this workload," who writes the runbook for "GC pause regression," and who arbitrates the codegen-vs-GC contract in design review. That requires treating the interface as an engineered system with explicit budgets and failure modes.

---

## Prerequisites

- **Required:** Senior level — precise maps under optimization, deopt × GC, load/colored-pointer barriers, Go hybrid barrier, engine-specific mechanisms.
- **Required:** Production operations experience: reading flame graphs, GC logs, p99/p99.9 latency, and correlating pauses to upstream symptoms.
- **Required:** Comfort reasoning about ABIs, calling conventions, and codegen contracts.
- **Helpful:** Capacity-planning experience (heap sizing, allocation-rate budgeting, headroom).
- **Helpful:** Exposure to designing or reviewing a runtime component (allocator, JIT, GC).

You do **not** need to author a collector. You **do** need to own its interface in production.

---

## Glossary

| Term | Definition |
|------|-----------|
| **GC info budget** | The space (and decode-time) cost of stack maps / GC metadata across a program; a first-class engineering budget. |
| **Partially-interruptible code** | Methods with safepoints only at call sites; smaller maps, coarser stops, longer worst-case TTSP. |
| **Fully-interruptible code** | Safepoints (nearly) everywhere; larger maps, finer stops, shorter TTSP. |
| **Safepoint protocol** | The agreement and mechanism that brings all threads to a consistent halt (poll type, signaling, native handshakes). |
| **Thread-local handshake** | Stopping/scanning a *single* thread without a global STW (HotSpot `Handshake`, used by ZGC/Shenandoah). |
| **Hijacking** | Rewriting a thread's saved return address so it traps into the runtime on return (.NET). |
| **Native transition** | The state machine a thread runs through when crossing managed↔native, so the GC knows whether it can scan/move while the thread is in native code. |
| **Barrier ABI** | The contract specifying the barrier's clobbers, inputs, allowed operations, and elision rules. |
| **TLAB** | Thread-Local Allocation Buffer: per-thread bump region for lock-free allocation. |
| **Bump-pointer allocation** | Allocate by advancing a pointer; the heap (or TLAB) is a contiguous arena. |
| **Allocation-site sampling** | Sampling a fraction of allocations (e.g., every N bytes) for profiling or policy, wired into the slow path or via a sampling counter. |
| **Allocation rate** | Bytes/sec the mutator allocates; drives GC frequency and thus pause frequency. |
| **GC pacing** | Runtime feedback loop deciding *when* to start a (concurrent) GC so it finishes before the heap fills (Go's pacer, G1's prediction). |
| **Safepoint bias** | Profiler artifact where samples cluster at safepoints because stack walking needs maps. |
| **Stop-the-world budget** | The portion of the SLO you allocate to actual STW phases vs concurrent work. |

---

## Core Concepts

### 1. Metadata Economics: Budgeting GC Info

Every safepoint needs a stack map. A large server with hundreds of MB of JIT code can accumulate comparable amounts of GC metadata if encoded naively. Professionals treat this as a budget with knobs:

- **Encoding.** Bitmaps for "is-pointer" per slot; delta-encode adjacent safepoints (nearby PCs differ in a slot or two); deduplicate identical maps via a shared dictionary; pack derived-pointer base references compactly.
- **Granularity.** *Fully-interruptible* code has many safepoints (small TTSP, big maps). *Partially-interruptible* code (safepoints only at calls) shrinks maps but lengthens worst-case TTSP. The .NET JIT chooses per-method; HotSpot tiers (interpreted → C1 → C2) change safepoint density. This is a **map-size vs TTSP** dial.
- **Lazy materialization.** Some engines store compressed maps and decode on demand during a GC, trading decode CPU for resident size.
- **Code-cache pressure.** GC info competes with code for cache and memory; on memory-constrained deployments it's a real constraint, not an afterthought.

The professional question is never "do we have maps?" but "what is our maps budget, and what TTSP and stop-granularity does it buy?"

### 2. Safepoint Protocol Design

Bringing threads to a halt is a small agreement protocol. Design dimensions:

- **Poll mechanism.** Flag (portable, branchy), page-trap (single instruction, hardware-forced), or signal-based (Go async preemption; stops even poll-free code). Each has a different *worst-case* TTSP and platform dependency.
- **Global vs per-thread.** A global STW stops everyone. **Thread-local handshakes** (HotSpot) stop and operate on one thread at a time — essential for concurrent collectors (ZGC/Shenandoah) that want to scan a thread's roots without halting the world. Per-thread polling pages let the runtime arm individual threads.
- **Hijacking** (.NET) handles threads about to return: rewrite the return address so they enter the runtime on return, covering call-free stretches without a poll there.
- **Native transitions.** A thread in native code can't poll. The runtime tracks each thread's state (in-managed / in-native / transitioning). A thread *in native* is treated as already-safe (the GC can scan/relocate without it), but the *transition back* must synchronize: the thread, on return, checks whether a GC is in progress and blocks if so. Get this state machine wrong and you either corrupt memory (scan a thread mid-transition) or hang (miss a thread).

The deliverable is a **TTSP distribution**, not a single number. Your pause-time tail is dominated by the slowest thread under the worst case, so you design the protocol around stragglers: counted-loop safepoints, async preemption, bounded native critical sections, and per-thread handshakes to avoid one straggler stalling the world.

### 3. The Barrier ABI: A Codegen ↔ GC Contract

A write or read barrier is emitted by codegen but defined by the GC. At scale this is a *formal contract*:

- **Inputs/outputs.** What registers hold the object, the field address, the value; what the barrier returns (load barriers return the corrected pointer).
- **Clobbers.** Which registers the barrier may destroy. Codegen must save live values around the barrier accordingly. An under-specified clobber set is a silent miscompile.
- **Allowed operations.** May the barrier *allocate*? *Safepoint*? Usually the fast path may do neither (it must be leaf-like and non-blocking); only the out-of-line slow path may. If the fast path could safepoint, you'd need a map *inside the barrier*, which is usually forbidden by design.
- **Elision rules.** The contract specifies when codegen may omit the barrier (init stores into non-escaped allocations, null stores, same-region stores). These rules must be *exactly* aligned between codegen and GC, or codegen omits a barrier the GC needed → a live object freed.
- **Out-of-line layout.** Fast path inline, slow path in a stub, predicted-not-taken. The contract pins this so profiles and code size are predictable.

Professionals write this down, generate codegen and GC from a shared spec where possible, and **fuzz/stress test** it (run GC at every safepoint, randomize timing) because the failure mode is a rare, data-dependent, memory-corrupting crash.

### 4. Allocation Path Co-Design

Throughput is dominated by allocation, and allocation is co-designed with collection:

- **TLAB.** Each thread gets a private bump region. Allocation is: `if (top + size <= end) { p = top; top += size; }` — a few instructions, inlined, lock-free. TLAB *size* is tuned (too small → frequent slow paths and contention on the shared heap; too big → wasted memory and worse locality, plus larger "retained" slop at a GC).
- **Bump-pointer layout.** Works because the collector keeps a contiguous arena (copying/compacting young gen). The allocator and collector agree on the arena's shape; a non-moving collector can't bump-allocate as freely and uses free-lists, which are slower per-allocation.
- **Slow-path / GC handoff.** When the TLAB is exhausted, the slow path requests a new TLAB; if the heap is full, this triggers (or waits on) a GC. The handoff must be a safepoint-clean transition — the allocating thread may itself become the trigger for STW.
- **Allocation-site sampling.** Profilers (and some policies) sample 1-in-N bytes by maintaining a per-thread "bytes until next sample" counter decremented in the fast path; when it crosses zero, the slow path records a stack and possibly applies a policy. This must be near-free in the common case (a subtract and a predicted-not-taken branch) — itself a codegen/runtime contract.

The professional lever: **allocation rate is the GC's input.** Halving allocation roughly halves GC frequency, which roughly halves pause frequency and barrier executions. Capacity planning budgets allocation rate against the pause-time SLO.

### 5. Pacing: When To Start, Not Just How To Stop

A concurrent collector must *start early enough* to finish before the heap fills, or it falls back to an STW collection (a latency cliff). This is **GC pacing**: a feedback loop estimating allocation rate and collection speed to choose the trigger heap occupancy. Go's pacer (the `GOGC` / soft-memory-limit machinery), G1's prediction model, and ZGC's allocation-rate-driven start are all pacers. Pacing is part of the integration because it consumes runtime signals (allocation rate via the TLAB slow path, mark progress via barrier queues) to drive the collector. A mistuned pacer turns a concurrent collector into an STW one under load — a classic production incident.

### 6. Operating The Interface: The SLO View

A pause-time SLO decomposes into integration terms:

```text
visible_pause ≈ time_to_safepoint            (protocol: stragglers, native)
              + STW_phase_work                (root scan, flips, etc.)
              + (for concurrent) almost nothing else, IF pacing kept up
throughput_loss ≈ barrier_cost * pointer_op_rate
                + allocation_fast_path_overhead
                + concurrent_GC_CPU_share
```

You budget each term, monitor each in production (safepoint logs, barrier CPU via profiling, allocation-rate counters, pacer state), and alert on each. The runbook for "p99.9 pause regression" walks this decomposition: split TTSP from STW work; if TTSP, find the straggler; if STW work, examine root-set size and concurrent-phase fallbacks; if it's actually throughput, profile barriers and allocation.

### 7. Cross-Cutting Failure Modes At Scale

- **TTSP stragglers** from counted loops, long native calls, page-fault stalls during a poll, or a descheduled thread (noisy neighbor) that can't reach a poll. Mitigations: async preemption, per-thread handshakes (don't let one straggler stall the world), bounded native sections, and CPU isolation.
- **Pacer fallback to STW** under an allocation-rate spike; mitigations: headroom, soft memory limits, allocation-rate alerting.
- **Barrier hot spots** in pointer-graph mutation; mitigations: representation changes, conditional card marking, collector choice.
- **Metadata bloat** crowding the code cache on memory-tight nodes; mitigations: partially-interruptible regions, map compression.
- **Native-transition races** corrupting memory or hanging; mitigations: rigorous state-machine review and stress testing.

### 8. The Generational Twist For Load-Barrier Collectors

A professional note tying threads together: pure load-barrier collectors (early ZGC) were *non-generational*, scanning the whole heap each cycle — fine for latency but costly in CPU/allocation-heavy workloads. **Generational ZGC** adds a young generation, which *re-introduces a write barrier* (to track old→young pointers) on top of the load barrier. The integration lesson: collectors evolve by *adding* interface obligations (another barrier, more metadata) to buy efficiency, and your codegen/runtime must absorb each new obligation. Choosing a collector is partly choosing which barriers your hot code will pay.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **GC info budget** | The weight allowance on an aircraft: maps are cargo you must pay to carry; you compress and ration it. |
| **Safepoint protocol** | An air-traffic ground-stop: getting every plane to hold at a known point, designed around the slowest taxiing aircraft, not the average. |
| **Thread-local handshake** | Pulling one car aside for inspection without stopping the whole highway. |
| **Native transition state machine** | A customs checkpoint: travelers in the duty-free zone (native) are "out of jurisdiction," but re-entry is gated and synchronized. |
| **Barrier ABI** | A legal contract between two contractors: exactly what each provides, clobbers, and must never do — ambiguity causes a collapse. |
| **TLAB** | Each chef gets a personal mise-en-place tray, refilled from the pantry only when empty — no queuing for every ingredient. |
| **Pacing** | A toll plaza opening lanes *before* the rush hits, predicting traffic so it never backs up onto the freeway. |
| **Pacer fallback to STW** | The toll plaza misjudging the rush and slamming a full stop — the latency cliff. |

---

## Mental Models

### The "Interface Has A Budget Sheet" Model

Hold a spreadsheet in mind with rows: *map bytes*, *TTSP p99*, *STW work*, *barrier CPU %*, *allocation MB/s*, *GC CPU %*. Every design decision moves cells: partially-interruptible code shrinks *map bytes* but raises *TTSP p99*; a load barrier raises *barrier CPU* but slashes *STW work*; a bigger TLAB cuts *slow-path CPU* but raises *retained slop*. Professional GC work is *balancing this sheet against an SLO*, not chasing a single metric.

### The "Slowest Thread Owns Your Tail" Model

Pause-time tails are set by stragglers. Average TTSP is irrelevant; the p99.9 pause is the one thread that wouldn't stop. So you design the protocol (signals, per-thread handshakes, native bounds) and the code (no poll-free loops) for the *worst* thread under the *worst* schedule. This reframes "GC tuning" as "straggler elimination."

### The "Allocation Rate Is The Throttle" Model

The collector's workload is whatever the allocator hands it. Allocation rate sets GC frequency, which sets pause frequency and barrier-execution count. The cheapest GC tuning is often *allocating less* (object reuse, value types, avoiding boxing) — it reduces every downstream cost at once. Think of allocation rate as the master throttle on the whole integration.

### The "Contract, Then Fuzz" Model

The barrier ABI and the elision rules are correctness contracts shared by two codebases (codegen, GC). The professional model: *specify it formally, then attack it* — stress GC at every safepoint, randomize timing, run sanitizers, fuzz the schedule. Concurrency-and-relocation bugs are too rare to find by luck; you manufacture the rare schedules deliberately.

---

## Code Examples

### Measuring the TTSP distribution, not the mean (JVM)

```bash
# Per-safepoint detail; post-process to get a TTSP histogram, not just the average.
java -Xlog:safepoint=info:file=safepoint.log:tags,uptime \
     -XX:+PrintGCApplicationStoppedTime -jar service.jar

# Then extract "Reaching safepoint" values and build a p50/p99/p99.9.
# A healthy service has TTSP p99.9 in the low single-digit ms; a straggler shows as a long tail.
```

The discipline: a 1 ms *mean* TTSP with a 400 ms *p99.9* is a straggler problem, invisible if you only look at the mean. SLOs live on the tail.

### Tuning the allocation fast path (TLAB sizing, JVM)

```bash
# Observe TLAB behavior: fast-path allocs, slow-path refills, waste.
java -Xlog:gc+tlab=trace -jar service.jar

# Knobs:
#   -XX:+UseTLAB (default on), -XX:TLABSize=..., -XX:-ResizeTLAB to pin a size,
#   -XX:TLABWasteTargetPercent=... to trade slow-path frequency vs end-of-TLAB waste.
```

If logs show frequent slow-path refills, the TLAB is too small for the thread's allocation rate (contention on the shared heap, more atomic ops). If they show high waste, it's too big (memory and locality cost). This is the allocation half of the co-design in operational form.

### Allocation-rate budgeting (Go)

```bash
# gctrace shows heap growth and GC frequency; allocation rate drives both.
GODEBUG=gctrace=1 ./service
# Lines: gc N @t s, heap sizes, and the wall/CPU time. Rising frequency under load
# means rising allocation rate -> tune GOGC / GOMEMLIMIT or cut allocations.

# Pprof the allocation profile to find the hot allocation sites:
go tool pprof -alloc_space ./service profile.pb.gz
```

The professional move: attack the top allocation sites (object reuse, `sync.Pool`, value semantics) to lower GC frequency *and* write-barrier execution count simultaneously.

### A barrier ABI, specified as pseudocode contract

```text
# Contract between CODEGEN and GC for the reference-store barrier.
# Inputs : OBJ in reg R_obj, FIELD_OFFSET imm, VAL in reg R_val
# Output : none (write barrier) ; corrected ref in R_ret (load barrier)
# Clobbers (fast path): R_scratch1 only. Codegen must NOT keep a live value there.
# Fast path MAY NOT: allocate, safepoint, block, throw.
# Slow path (out-of-line stub) MAY: allocate, safepoint, take locks.
# Elision: codegen MAY omit iff
#   (a) store initializes a freshly-allocated, not-yet-published object, OR
#   (b) value is statically null AND collector ignores null edges.
# Any deviation from (a)/(b) is a CORRECTNESS bug (live object may be freed).
```

Pinning this contract is what lets the codegen and GC teams ship independently. The elision clause is the dangerous one: it must be *identical* on both sides.

### Bounding native sections to protect TTSP (JNI)

```c
/* A long native loop here would either block a moving GC (if it pins) or,
   if it doesn't transition, delay the thread's return-side safepoint check. */
JNIEXPORT void JNICALL Java_X_process(JNIEnv* env, jobject self, jbyteArray data) {
    jsize n = (*env)->GetArrayLength(env, data);
    /* Copy out instead of holding a Critical (pinning) region across heavy work. */
    jbyte* buf = malloc(n);
    (*env)->GetByteArrayRegion(env, data, 0, n, buf);  /* no pin held during compute */
    heavy_compute(buf, n);                              /* GC can run/move freely */
    free(buf);
}
```

Using `GetByteArrayRegion` (copy) instead of `GetPrimitiveArrayCritical` (pin) keeps a moving collector unblocked during `heavy_compute` — a deliberate TTSP/throughput tradeoff.

---

## Pros & Cons

| Design decision | Pros | Cons |
|-----------------|------|------|
| **Fully-interruptible code** | Short TTSP; fine stop granularity. | Large GC info; more code-cache pressure. |
| **Partially-interruptible code** | Small GC info; less metadata. | Longer worst-case TTSP; coarse stops. |
| **Page-trap / signal polling** | Single-instruction polls; stops poll-free code (signals). | Platform-specific; harder to debug; fault/signal machinery. |
| **Thread-local handshakes** | One straggler can't stall the world; enables concurrent root scan. | More protocol complexity; per-thread state. |
| **Big TLABs** | Fewer slow paths; lower contention; high throughput. | Memory waste; worse locality; larger retained slop at GC. |
| **Allocation-site sampling** | Cheap profiling/policy hooks. | Fast-path counter cost; sampling bias to manage. |
| **Concurrent + pacing** | Tiny pauses if pacing keeps up. | Latency cliff (STW fallback) if pacing misjudges; pacer tuning. |
| **Generational load-barrier collector** | Latency *and* better CPU efficiency. | Two barriers (load + write); more codegen obligations and metadata. |

---

## Use Cases

- **Setting and defending a pause-time SLO** for a managed service: decompose the SLO into TTSP, STW work, barrier cost, and allocation rate; budget and monitor each.
- **Choosing/tuning a collector for a fleet:** translate barrier economics, pacing behavior, and metadata budget to the workload and hardware.
- **Arbitrating codegen ↔ GC contracts** in runtime development: specifying and stress-testing the barrier ABI and elision rules.
- **Capacity planning:** budgeting allocation rate and heap headroom so the pacer never falls back to STW under peak.
- **On-call incident response:** running the "pause regression" or "throughput regression" runbook to ground, attributing to a specific interface term.
- **Hardening native interop** at scale: bounding pinning/critical windows, designing handle lifetimes, reviewing native-transition state machines.

---

## Coding Patterns

### Pattern 1: SLO decomposition runbook

```text
ALERT: p99.9 pause > SLO
  1. Split TTSP vs STW work (safepoint log).
  2. TTSP tail?  -> find straggler thread:
        - counted/poll-free loop?  enable strip mining / async preempt
        - long native call/pin?     bound it / copy-out
        - descheduled (noisy nbr)?  CPU isolation / pinning
  3. STW work big? -> root-set size, concurrent-phase fallback (pacer), heap sizing
  4. Throughput regressed (not pause)? -> profile barrier CPU + allocation rate
NEVER reach for GC flags before step 1-2.
```

### Pattern 2: Cut allocation rate to cut everything downstream

```go
// Reuse buffers; fewer allocations -> fewer GCs -> fewer pauses + fewer barriers.
var bufPool = sync.Pool{New: func() any { return make([]byte, 0, 4096) }}

func handle(req *Request) {
    b := bufPool.Get().([]byte)[:0]
    b = serialize(b, req)
    write(b)
    bufPool.Put(b)        // reuse instead of re-allocating
}
```

### Pattern 3: Specify-then-fuzz the barrier contract

```text
# CI gate for runtime developers:
- Run the test suite with "GC at every safepoint" mode (stress flag).
- Randomize relocation so every load barrier slow path executes.
- Run under TSan/ASan equivalents for the runtime.
- Fuzz the thread schedule around native transitions.
A barrier/elision bug must be reproduced by the harness, never by luck in prod.
```

### Pattern 4: Keep TTSP bounded by design

```text
- No hand-written poll-free assembly hot loops.
- Bounded native critical/pinning sections (copy-out for heavy work).
- Prefer per-thread handshakes for root scan so a straggler is local, not global.
- Enable counted-loop safepoints / async preemption per the engine.
```

---

## Best Practices

- **SLO the interface, not the algorithm.** Express pause and throughput budgets in interface terms (TTSP, STW work, barrier CPU, allocation rate) and monitor each.
- **Design for the slowest thread.** Tails come from stragglers; eliminate poll-free loops and unbounded native sections; use per-thread handshakes so one straggler is contained.
- **Treat GC metadata as a budget.** Pick fully- vs partially-interruptible regions deliberately; compress maps; watch code-cache pressure on tight nodes.
- **Make the barrier ABI explicit and adversarially tested.** Clobbers, allowed operations, and elision rules must be identical across codegen and GC, and validated by stress/fuzz harnesses.
- **Co-design and tune the allocation path.** Right-size TLABs from telemetry; remember allocation rate is the GC's throttle — cutting it cuts pauses, barriers, and CPU together.
- **Mind the pacer.** Keep headroom and alert on allocation-rate spikes so a concurrent collector never falls back to STW.
- **Bound native interop.** Prefer copy-out over long pinning; design handle lifetimes; review native-transition state machines like the consensus protocols they are.

---

## Edge Cases & Pitfalls

- **Mean-vs-tail TTSP blindness.** Dashboards showing average TTSP hide the one straggler that owns p99.9. Always histogram the tail.
- **Pacer cliff under load spikes.** A concurrent collector silently degrades to STW when allocation outruns the pacer's prediction — a sudden latency cliff, not a gradual slope. Headroom and allocation-rate alerts are the guard.
- **Elision-rule skew.** If codegen's barrier-omission rules drift from the GC's expectations (e.g., after a "publication" optimization changes when an object escapes), a needed barrier is dropped and a live object is freed — extremely rare, data-dependent, catastrophic.
- **TLAB sizing pathologies.** Too-small TLABs cause shared-heap contention and slow-path storms under many threads; too-large TLABs waste memory and inflate retained slop captured at each GC. Both show in `gc+tlab` logs.
- **Native-transition races.** Scanning or moving a thread that is mid-transition (managed↔native) corrupts memory; missing a transitioning thread hangs the GC. The state machine must be exhaustively correct.
- **Metadata bloat on constrained nodes.** Fully-interruptible code plus large JIT output can make GC info a non-trivial fraction of resident memory; partially-interruptible regions trade it back for TTSP.
- **Allocation-site sampling skew.** A naive byte-counter sampler biases toward large allocations or specific sites; geometric/randomized intervals are needed for unbiased profiles, and the counter cost must stay off the hot path.
- **Generational-load-barrier double cost.** Generational ZGC pays *both* a load barrier and a young-gen write barrier; a workload that is both load- and store-heavy can see compounded overhead — measure before assuming "newer collector = strictly faster."

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│        RUNTIME ↔ GC INTEGRATION — PROFESSIONAL (design & operate)              │
├──────────────────────────────────────────────────────────────────────────────┤
│ THE BUDGET SHEET (balance against the SLO):                                   │
│   map bytes | TTSP p99.9 | STW work | barrier CPU% | alloc MB/s | GC CPU%      │
├──────────────────────────────────────────────────────────────────────────────┤
│ METADATA: fully-interruptible (small TTSP, big maps)                          │
│           partially-interruptible (small maps, long TTSP)                     │
│           compress: bitmaps, deltas, dedup; watch code-cache pressure         │
├──────────────────────────────────────────────────────────────────────────────┤
│ SAFEPOINT PROTOCOL (design for the SLOWEST thread):                           │
│   poll: flag | page-trap | signal(async preempt)                              │
│   scope: global STW | per-thread handshake | return-addr hijack               │
│   native transitions: in-native = safe; RETURN side must synchronize          │
├──────────────────────────────────────────────────────────────────────────────┤
│ BARRIER ABI (codegen ↔ GC contract): inputs, CLOBBERS, may-not-allocate/      │
│   safepoint on fast path, ELISION rules IDENTICAL on both sides; FUZZ it       │
├──────────────────────────────────────────────────────────────────────────────┤
│ ALLOCATION: TLAB bump fast path; size from telemetry; alloc RATE = GC throttle│
│   sampling: per-thread byte counter, off hot path, unbiased intervals         │
│   PACING: start concurrent GC early or fall off the STW cliff                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ RUNBOOK: pause? -> split TTSP vs STW FIRST -> straggler or heap -> only then   │
│          GC flags.  throughput? -> barrier CPU + allocation rate.             │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- At production scale the runtime↔GC interface is an **engineered system with budgets**: map bytes, TTSP, STW work, barrier CPU, allocation rate, GC CPU — balanced against a latency/throughput SLO.
- **GC metadata is cargo you ship.** Fully- vs partially-interruptible code trades **map size against TTSP**; compression (bitmaps, deltas, dedup) and code-cache pressure are real constraints.
- The **safepoint protocol** is a small agreement protocol whose **TTSP distribution** sets your pause tail. Design it for the **slowest thread**: page-trap/signal polls, **per-thread handshakes** so a straggler stays local, and a correct **native-transition state machine**.
- The **barrier ABI** is a formal **codegen ↔ GC contract** — clobbers, "fast path may not allocate/safepoint," and **elision rules that must be byte-identical on both sides**. Its failure mode is a rare, memory-corrupting miscompile, so you **specify then fuzz** it.
- The **allocation path** is co-designed with collection: **TLAB bump** fast path (sized from telemetry), bump-pointer arenas, **allocation-site sampling** off the hot path, and a clean slow-path → GC handoff. **Allocation rate is the GC's throttle** — cutting it reduces pauses, barriers, and CPU at once.
- **Pacing** decides when a concurrent collector starts; mistuned pacing falls off an **STW latency cliff** under load. Keep headroom; alert on allocation-rate spikes.
- Collectors evolve by **adding interface obligations** (generational ZGC = load barrier *plus* a young-gen write barrier) to buy efficiency; choosing a collector means choosing which barriers your hot code pays.
- The operating discipline: **decompose every SLO incident into interface terms and attribute it** — TTSP straggler, STW work, pacer fallback, barrier storm, or allocation rate — before touching a tuning flag.

---

## Further Reading

- *The Garbage Collection Handbook* (2nd ed.) — Jones, Hosking, Moss. The systems chapters: safepoints, barriers, allocation, concurrent coordination.
- *HotSpot* source and JEPs: JEP 312 (thread-local handshakes), JEP 333/376 (ZGC), JEP 379 (Shenandoah), JEP 439 (generational ZGC). https://openjdk.org/jeps/
- *A Guide to the Go Garbage Collector* and the Go runtime pacer design — pacing, GOGC, GOMEMLIMIT. https://go.dev/doc/gc-guide
- *.NET Book of the Runtime (BOTR)* — GC info, GC-safe points, stackwalking, thread suspension/hijacking. https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/
- *Java Flight Recorder / JFR* and *async-profiler* — allocation-site sampling and safepoint-bias-free profiling. https://github.com/async-profiler/async-profiler
- *Continuous Profiling and GC* talks (Nitsan Wakart, Aleksey Shipilëv) — TTSP, barriers, allocation in practice.
- *Idle and tail-latency engineering* literature (Dean & Barroso, "The Tail at Scale") — for the straggler-owns-the-tail mindset.
- *Generational ZGC* design notes — why a young-gen write barrier returns on top of the load barrier.

---

## Diagrams & Visual Aids

### The Interface Budget Sheet

```text
┌────────────────────┬───────────────┬──────────────────────────────────────┐
│ Cell               │ Lever         │ Side effect of pushing the lever       │
├────────────────────┼───────────────┼──────────────────────────────────────┤
│ map bytes ▼        │ partial-interr│ TTSP p99.9 ▲                           │
│ TTSP p99.9 ▼       │ signals/handshk│ protocol complexity ▲                 │
│ STW work ▼         │ load barrier  │ barrier CPU% ▲                         │
│ barrier CPU% ▼     │ value/index   │ developer effort ▲                     │
│ alloc MB/s ▼       │ pooling/reuse │ GC freq ▼, pauses ▼, barriers ▼ (win!) │
│ GC CPU% ▼          │ generational  │ +a second barrier (more codegen oblig.)│
└────────────────────┴───────────────┴──────────────────────────────────────┘
```

### Safepoint Protocol — Scope Choices

```text
GLOBAL STW                 PER-THREAD HANDSHAKE          RETURN-ADDR HIJACK
 stop ALL threads            stop ONE thread, scan,        rewrite return addr;
 at once                     resume; repeat                thread traps on return
 straggler stalls world      straggler is LOCAL            covers call-free returns
 (simple)                    (ZGC/Shenandoah root scan)    (.NET)
```

### Native Transition State Machine (simplified)

```text
  IN_MANAGED ──(call native)──► TRANSITION_OUT ──► IN_NATIVE
      ▲                                                │
      │                                         (return to managed)
  (GC may NOT scan mid-transition)                     ▼
      └────────────── IN_MANAGED ◄── TRANSITION_IN ◄───┘
                                        │
                       if GC in progress: BLOCK here until safe
  IN_NATIVE is treated as "already safe" -> GC can scan/move without this thread.
```

### Allocation Fast Path + Pacing Feedback

```text
new(size):
   if top+size <= end:  p=top; top+=size; return p          ; FAST (bump)
   else: slow_path -> new TLAB                               ; refill
            └─ if heap occupancy >= PACER_TRIGGER:
                   start concurrent GC (pace to finish before full)
            └─ if heap FULL: STW collection (the cliff — avoid!)
   alloc-sample counter -= size; if <=0: record stack (off hot path)
```

### Pause Decomposition Under The SLO

```text
visible_pause  =  [ TTSP ]  +  [ STW phase work ]  +  ~0 (if concurrent + paced)
                    │                │
   straggler? ──────┘                └────── root-set size / pacer fallback
throughput_loss = barrier_cost*pointer_ops + alloc_overhead + concurrent_GC_share
```
