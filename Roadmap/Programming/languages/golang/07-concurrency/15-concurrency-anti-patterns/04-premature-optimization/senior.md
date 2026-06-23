---
layout: default
title: Senior
parent: Premature Optimization
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 3
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/04-premature-optimization/senior/
---

# Premature Concurrency Optimization — Senior Level

## Table of Contents
1. [Introduction: the senior shift](#introduction-the-senior-shift)
2. [When concurrency hurts](#when-concurrency-hurts)
3. [Sequential is faster than you think](#sequential-is-faster-than-you-think)
4. [Amdahl's law for goroutines](#amdahls-law-for-goroutines)
5. [Gustafson, Karp-Flatt, and the practical companions to Amdahl](#gustafson-karp-flatt-and-the-practical-companions-to-amdahl)
6. [Context-switch costs](#context-switch-costs)
7. [Scheduler overhead in detail](#scheduler-overhead-in-detail)
8. [False sharing](#false-sharing)
9. [Cache lines, NUMA, and memory traffic](#cache-lines-numa-and-memory-traffic)
10. [Measurement-first methodology](#measurement-first-methodology)
11. [Designing the right experiment](#designing-the-right-experiment)
12. [Reviewing a "make it concurrent" PR](#reviewing-a-make-it-concurrent-pr)
13. [Sequential vs parallel decision tree](#sequential-vs-parallel-decision-tree)
14. [Latency vs throughput at the design table](#latency-vs-throughput-at-the-design-table)
15. [The "shape" of the workload](#the-shape-of-the-workload)
16. [Cost models you can carry in your head](#cost-models-you-can-carry-in-your-head)
17. [Coordination overhead](#coordination-overhead)
18. [Why parallelizing tiny tasks loses](#why-parallelizing-tiny-tasks-loses)
19. [Channel and mutex hidden costs](#channel-and-mutex-hidden-costs)
20. [Common premature optimisations and their refutations](#common-premature-optimisations-and-their-refutations)
21. [Building a culture of measurement](#building-a-culture-of-measurement)
22. [Organisational norms](#organisational-norms)
23. [Worked example: a CSV pipeline that got slower](#worked-example-a-csv-pipeline-that-got-slower)
24. [Worked example: image thumbnailer](#worked-example-image-thumbnailer)
25. [Worked example: HTTP request fan-out](#worked-example-http-request-fan-out)
26. [Worked example: a hot counter](#worked-example-a-hot-counter)
27. [Worked example: parallel map](#worked-example-parallel-map)
28. [Reading a CPU profile after a concurrency change](#reading-a-cpu-profile-after-a-concurrency-change)
29. [Reading a trace after a concurrency change](#reading-a-trace-after-a-concurrency-change)
30. [Statistical significance for benchmarks](#statistical-significance-for-benchmarks)
31. [GOMAXPROCS at the senior level](#gomaxprocs-at-the-senior-level)
32. [GC interactions with goroutine count](#gc-interactions-with-goroutine-count)
33. [Self-assessment](#self-assessment)
34. [Summary](#summary)

---

## Introduction: the senior shift

At the junior level the rule was "write the simple version, measure, then optimise." At middle level you applied the rule inside an existing codebase. At senior level the rule becomes a *responsibility*: you own a body of code that other engineers will modify, and your job is to make sure their first instinct is not "let me add a goroutine" but "let me measure first."

This document is about three things in roughly equal measure:

1. **The physics**. Why concurrency frequently *adds* cost — context switches, false sharing, cache-line bouncing, scheduler overhead, GC pressure from extra allocations. Senior engineers can quote rough numbers on these without rerunning the benchmark.
2. **The methodology**. How to design experiments that produce a defensible answer. How to read pprof, trace, and `benchstat` output. How to know when N=10 is enough and when you need N=200.
3. **The leadership**. How to gate "performance" PRs, how to write a benchmarking policy, how to teach the team to look at the numbers before the diff.

If you do these three things well, your service does not become a graveyard of dead optimisations, and your team learns to discipline its instincts. If you do them poorly, every quarter brings a new pile of `sync.Pool` and "actor" code that nobody dares delete and nobody is sure works.

---

## When concurrency hurts

The phrase "concurrency hurts" is precise. We are not saying "goroutines are bad" or "channels are slow." We are saying that, for a given workload, the *act* of running it concurrently can make the program slower, less reliable, and harder to maintain than the obvious sequential version. There are eight specific mechanisms by which concurrency hurts performance. A senior engineer recognises them on sight.

1. **Per-goroutine fixed overhead exceeds the per-item work.** Spawning, scheduling, finishing, and synchronising a goroutine costs roughly 1–3 microseconds on modern hardware. If the work the goroutine does is, say, "decode 30 bytes of varint," the bookkeeping is 100× the work. You are paying the courier more than the package is worth.
2. **Coordination cost dominates the critical section.** A naive `range` over a slice is one memory access per element, predictable, pipelined by the CPU. A channelised version pays a mutex-lock-and-park on every send and receive. The CPU does the same arithmetic; the runtime does much more bookkeeping.
3. **False sharing.** Two goroutines writing to different fields in the same cache line invalidate that line on every write. The CPU now reads the same line back and forth between cores at the speed of L2 or L3 (10–60 ns) rather than L1 (1 ns). You pay 10–60× per write.
4. **Mutex contention pile-up.** A protected section short enough to be fine sequentially becomes a queue when 16 goroutines compete for it. Each waiter is parked and woken (a few microseconds round-trip); the protected work itself runs the same speed it always did.
5. **Stale cache lines from migration.** When the scheduler moves a goroutine between Ps, the new core's cache is cold for that goroutine's stack and recently-touched data. The first iteration on the new core suffers L1/L2 misses (10–30 ns each) until the line is warm again.
6. **GC and allocator amplification.** Concurrent workers each have their own *mcache* and per-P state. Allocating from N goroutines in tight loops can multiply the GC's mark work, and increase the rate at which mcaches are flushed back to the central allocator. The GC's CPU share grows; the application's shrinks.
7. **System-call queueing.** Going wide on a single bottleneck — a database connection pool, a single file handle, an HTTP/2 stream — adds queue depth without adding throughput. The bottleneck did not get wider; you just put more workers in line for it.
8. **Critical-path lengthening from coordination synchronisation.** Fork-join workloads pay for the *slowest* worker. A single straggler caused by a hot CPU, a GC pause, or a stuck network call can leave 31 goroutines waiting on 1. The serial version had no straggler — it had one path.

Each of these is testable. Each shows up in pprof, trace, or perf counters. A senior engineer makes them visible *before* the optimisation is merged.

---

## Sequential is faster than you think

A common mental model says "more goroutines = more parallelism = more speed." Modern CPUs and well-written compilers undermine that intuition in three ways.

### Pipelining and ILP

A single core executes more than one instruction per cycle. Decoders, schedulers, and reorder buffers inside the core hide memory latency by issuing independent instructions while a load is in flight. A tight loop that reads `arr[i]`, adds, and stores `out[i]` retires at well over 1 element per cycle on a modern x86. SIMD widens this further: AVX2 processes 4 doubles per instruction; AVX-512 processes 8.

If you split that loop across N goroutines, you are no longer feeding one well-tuned pipeline; you are starting N pipelines on N cores, *each* of which needs warm caches and tight branch prediction. The breakeven point is not "1 core's worth of work" — it is "1 core's worth of work, plus all the warm-up cost N times."

### Branch prediction warmth

The CPU's branch predictor learns the pattern of a loop. After a few iterations it predicts the back-edge with near-perfect accuracy. When you split work across N goroutines, each goroutine warms up its own branch predictor state. The first iterations of each are slower.

### Allocator and TLB locality

Sequentially walking a slice keeps the TLB and L2 hot. Splitting it across cores spreads the touched pages — the original program had 1 TLB working set, the new one has N. If the data exceeds L2 per core, you trade *intra-core* misses for *inter-core* misses.

### A concrete number

```go
// Sequential
func sumSeq(xs []float64) float64 {
    s := 0.0
    for _, x := range xs {
        s += x
    }
    return s
}
```

With `len(xs) == 10_000_000` this runs at roughly 5 ms on a typical laptop CPU. A parallel version that splits across 8 goroutines runs at... roughly 5 ms too, sometimes 6 ms because of the coordination, sometimes 4 ms if the data was not warm in L2. The gain is a fraction of the dispersion. Below 10 million elements there is *no consistent gain at all*. Below 1 million elements the parallel version loses every time.

A senior engineer can predict this. A team that benchmarks ahead of merging discovers it. A team that does not benchmarks discovers it three quarters later when someone notices the parallel sum showing up in a flame graph at 3% of CPU.

---

## Amdahl's law for goroutines

Amdahl's law gives the upper bound on speedup from parallelism:

```
            1
speedup = -----------
          (1 - p) + p/N
```

where `p` is the parallelisable fraction and `N` the number of cores. If `p = 0.95` and `N = 16`, the maximum speedup is `1 / (0.05 + 0.95/16) = 9.14×`. Note that you never reach 16× even with 16 cores; serial fractions dominate at scale.

For Go specifically there are three Amdahl-style serial fractions that are easy to miss:

### 1. Pre-fan-out setup

```go
items, err := loadAllItems(ctx)   // serial: reading from DB
if err != nil { return err }
// ... fan out
```

If `loadAllItems` is half your wall time, parallelising the post-fan-out step caps your speedup at 2× regardless of cores.

### 2. Joining the result

```go
var sum int64
for _, n := range results {
    sum += n
}
```

Aggregating N results is O(N) and serial. With short per-result work, the aggregation can be the new dominator.

### 3. Channel send/receive

Every channel hop synchronises. In a pipeline `stage1 -> stage2 -> stage3`, even if stage 2 fans out to 8 workers, the channel between stages 1 and 2 is a serial bottleneck. The total wall time is bounded by `stage1` plus the slowest stage's per-element latency.

### Amdahl's law as a budget check

Senior engineers do an Amdahl check *before* writing the parallel code:

1. Roughly, what fraction of wall time is in the loop I want to parallelise?
2. Multiply that fraction by the rough core count you can use.
3. Subtract overhead at, say, 5% of total runtime per goroutine boundary.

If the answer is less than 1.3× speedup, do not parallelise. The simple version wins, because complexity has a cost and 30% is rarely worth it.

### A worked Amdahl calculation

Suppose a function takes 100 ms wall time, of which:

- 10 ms is input parsing (serial)
- 80 ms is a CPU-bound loop you could parallelise
- 10 ms is output formatting (serial)

With 8 cores, ideal speedup of the loop is 80 ms / 8 = 10 ms, total `10 + 10 + 10 = 30 ms`. Real-world: add 5 ms goroutine overhead and 5 ms join overhead — `35 ms`. Net speedup: `100 / 35 = 2.86×`. Useful, but a factor of 8 *not* a factor of 14. If the function is called at 100 req/s, you saved 6.5 seconds per second — clearly worth the engineering.

Now suppose the same function takes 5 ms wall time, of which:

- 1 ms input parsing
- 3 ms CPU-bound loop
- 1 ms output formatting

With 8 cores, loop in 0.375 ms, total `1 + 0.375 + 1 = 2.375 ms`. Real-world: add 1 ms goroutine overhead, `3.375 ms`. Net speedup: `5 / 3.375 = 1.48×`. Worth maybe a day of engineering, not three.

Amdahl turns "should we parallelise" from a feeling into a number.

---

## Gustafson, Karp-Flatt, and the practical companions to Amdahl

Amdahl assumes a *fixed* problem size and asks how much faster N cores make it. Gustafson's law inverts the question: given N cores, how much larger a problem can we solve in the same time? Most production workloads are Gustafson-shaped: the data set grows, the user base grows, the dashboard widget gets faster *or* shows more detail in the same time budget.

Gustafson's formula:

```
speedup = (1 - p) + p * N
```

If `p = 0.95` and `N = 16`, Gustafson speedup is `0.05 + 0.95 * 16 = 15.25×`. Why the optimism? Because we are not trying to do the *same* work faster; we are trying to do *more* work in the same time. Gustafson is the law that justifies, say, "with these 16 cores we can now compute a 16× larger window of analytics per dashboard refresh."

### Karp-Flatt for diagnosing real systems

If you have *measured* serial time `T1` and parallel time `Tn` on `n` cores, Karp-Flatt gives the *experimentally determined* serial fraction:

```
        (1/speedup) - (1/n)
e = ---------------------------
              1 - (1/n)
```

If `e` grows as you add cores, you have a synchronisation bottleneck (mutex contention, false sharing). If `e` stays roughly constant, your serial fraction is a real serial part you have not addressed yet.

A senior engineer reaches for Karp-Flatt before redesigning a slow parallel workload. "We saw `e = 0.1` at 4 cores and `e = 0.3` at 16 cores — that is a synchronisation problem, not a serial fraction; let's profile the mutex wait, not refactor the algorithm." Without Karp-Flatt the debate is anecdotal.

---

## Context-switch costs

A goroutine context switch on Go's M:N scheduler is dramatically cheaper than an OS thread context switch — but it is not free. On x86_64 Linux a goroutine-to-goroutine switch is roughly 150–250 ns in 2024-era CPUs when both goroutines are runnable on the same P. Switching to a goroutine on a different P (because of work stealing) costs more, because the destination CPU's caches are cold for the goroutine's stack.

### What happens during a goroutine switch

1. The current goroutine reaches a *safe point* — function preamble, channel op, stack growth check, or asynchronous preemption signal.
2. The scheduler saves the current `g.sched` (register file, PC, SP).
3. The scheduler picks the next runnable G from the local P's runq.
4. The scheduler swaps the M's pointer from old G to new G.
5. The CPU restores the new G's registers.

Steps 2 and 5 are roughly free (one cache-resident memory operation each). Step 3 is contention-free if the runq is non-empty. The actual cost is the cache miss profile: jumping to the new G's stack frame and code may evict lines the old G had warm.

### What does *not* happen

There is no kernel transition. No TLB flush. No address-space change. No syscall. That is why goroutine switches are 100–1000× faster than OS thread switches.

### When switches start to dominate

If your goroutine does 100 ns of useful work and then waits on a channel, you are paying:

- 100 ns of work
- ~150 ns to save state
- ~150 ns to restore state on the next goroutine
- N times the work-set cache miss to warm L1/L2 for the new goroutine

The ratio of useful to overhead is roughly 1:3. A serial loop running the same 100 ns of work is at 1:0. The serial loop is 3× faster regardless of how many cores you have.

### Numbers to memorise

| Operation | Approximate cost |
|---|---|
| Function call, hot | <1 ns |
| L1 cache hit | ~1 ns |
| L2 cache hit | ~3 ns |
| L3 cache hit | ~12 ns |
| Main memory hit | ~70 ns |
| Goroutine switch | ~200 ns |
| Mutex lock (uncontended) | ~10 ns |
| Mutex lock (contended) | ~1 µs (parking) |
| Channel send/recv (buffered, hot) | ~50 ns |
| Channel send/recv (unbuffered, syncing) | ~250 ns |
| HTTP round-trip (LAN) | ~500 µs |
| HTTP round-trip (intercontinental) | ~150 ms |

Senior engineers think in these numbers. If you can compute "how many cache misses does this design introduce per item" you can estimate the speedup before writing the code.

---

## Scheduler overhead in detail

Go's scheduler is excellent, but every bit of work it does is work your CPU is not doing on your program. There are five scheduler overheads worth understanding.

### 1. Work stealing

When a P's local runqueue is empty, it tries to steal half of another P's runqueue. Stealing requires:

- Atomic CAS on the source P's head/tail pointers.
- Cache coherence traffic to move the stolen Gs' descriptors to the new P.
- A few hundred cycles of bookkeeping.

In a workload where Ps are mostly idle, stealing happens often and is cheap. In a workload where every P is busy, stealing is rare. The pathological case is a workload where one P generates work in bursts: other Ps repeatedly try to steal, fail, and go idle.

### 2. Global runqueue checks

Every 61 scheduler ticks (a runtime constant), a P checks the global runqueue before its local one. This prevents starvation of goroutines pushed to the global queue (e.g. on stack growth or `runtime.Gosched`). The check is cheap, but it adds occasional cross-P cache traffic.

### 3. Sysmon

A monitor goroutine `sysmon` runs at periodic intervals, checking for:

- Goroutines stuck in long syscalls (it hands off the P to another M).
- Goroutines running too long without a safe point (asynchronous preemption since Go 1.14).
- Idle Ms to retire.
- GC trigger conditions.

Sysmon itself uses a tiny fraction of CPU, but its work creates scheduler activity that affects your program — preemptions, hand-offs, and runqueue pokes.

### 4. Preemption

Asynchronous preemption fires a SIGURG to a goroutine running too long. Receiving the signal and rewinding to a safe point costs roughly 2–4 µs. If your goroutines all run shorter than 10 ms, you never see preemption. If you have a tight loop with no function calls, preemption fires every ~10 ms.

### 5. P-handoff on blocking syscall

A goroutine entering a blocking syscall releases its P. The handoff costs roughly 1 µs. The cost is per-syscall, not per-goroutine, so it adds up if your design issues a syscall for every item. Channel-based pipelines with explicit batching can amortise this.

### Profile evidence

Look at `top` in pprof's CPU profile. If you see `runtime.findrunnable`, `runtime.schedule`, `runtime.gopark`, `runtime.goroutineReady` collectively above 5% of CPU, the scheduler is doing too much work for your workload. Common causes: too many short-lived goroutines, too many channel hops, too small a batch size.

---

## False sharing

False sharing is the single most surprising performance bug in concurrent code, and the one most often introduced by "let me just add a goroutine."

### What it is

CPU caches operate on *cache lines*, typically 64 bytes on x86_64 and 128 bytes on Apple Silicon. When core A writes to address X and core B writes to address Y, and X and Y fall on the same cache line, both cores must coordinate to invalidate each other's copies. The actual data they touch is different — there is no logical conflict — but the cache hardware does not see logical conflicts; it sees cache lines.

The result: each write causes a cache invalidation, the other core reads the line back from L2 or L3, and the cost per write balloons from ~1 ns (L1) to ~30 ns (L3) or worse (memory).

### A concrete example

```go
type Counters struct {
    A int64
    B int64
}

var c Counters

// Goroutine 1
for i := 0; i < 1e9; i++ {
    c.A++
}

// Goroutine 2
for i := 0; i < 1e9; i++ {
    c.B++
}
```

On x86_64, `A` and `B` are adjacent fields in a 64-byte cache line. Goroutines on different cores writing to `A` and `B` ping-pong the line between L1 caches. Throughput drops by a factor of 10–30 compared to either loop alone.

### The fix: padding

```go
type Counters struct {
    A int64
    _ [56]byte    // pad to a full cache line
    B int64
    _ [56]byte
}
```

Now `A` and `B` live in separate cache lines and the goroutines do not interfere. Throughput recovers.

Alternative: `runtime.CacheLineSize` (Go 1.22+ proposal pending) or convention-driven padding constants:

```go
const cacheLine = 64

type Counters struct {
    A int64
    _ [cacheLine - 8]byte
    B int64
}
```

### Where false sharing hides

- Stride-1 access on a shared slice from multiple workers (worker 0 writes indices 0,8,16,...; worker 1 writes 1,9,17,...). Many of those writes share lines.
- Per-goroutine fields in a struct array indexed by goroutine ID.
- `[]atomic.Int64` counters indexed by worker ID without padding.
- Slabs of small structs in a shared backing array.

### Detection

`perf c2c record / perf c2c report` on Linux highlights cache-line contention by virtual address. The `runtime/race` detector does *not* find false sharing (it is not a race, just a performance bug). Benchmarks that scale sublinearly with cores are the most reliable signal.

### Senior heuristic

If a parallel implementation gives 1.5× speedup on 8 cores rather than ~7×, false sharing is the first hypothesis. Pad and re-run; if you go from 1.5× to 6×, you found it.

---

## Cache lines, NUMA, and memory traffic

False sharing is the headline cache effect, but the broader story is *memory traffic*. The CPU's memory hierarchy is roughly:

```
L1d (per core)   ~32 KB    ~1 ns
L2  (per core)   ~512 KB   ~3 ns
L3  (shared)     ~10 MB    ~12 ns
DRAM             GBs       ~70 ns
Remote NUMA      GBs       ~150 ns
```

A goroutine running on core 0 with its data in L1 retires loads at ~1 ns. The same goroutine after being stolen onto core 4 reads from L3 or DRAM for the first several thousand cycles. The cost depends on data set size.

### NUMA in Go

On multi-socket servers, memory is partitioned per socket. A page of memory has a *home* NUMA node — the socket whose cores can reach it fastest. Cross-NUMA accesses cost roughly 2× a local-NUMA access.

Go is NUMA-agnostic. The runtime does not pin Ps to NUMA nodes. The scheduler may move a goroutine across sockets at any time. On NUMA hardware this can hurt: imagine a goroutine allocates a large slice on socket 0's memory, then is stolen to socket 1 — every read crosses the interconnect.

### Mitigations

- On NUMA hardware, set CPU affinity at the process level (`taskset`, `numactl`) to constrain Go to one socket if your service fits.
- Pre-fault and allocate per-worker data on the worker's preferred socket. Linux provides `numa_alloc_onnode`; Go does not expose this, so for true NUMA-aware Go services you often need cgo wrappers.
- For most services it is sufficient to *avoid* NUMA hardware until you measure that you need it. A 16-core single-socket box has no NUMA penalty.

### Going wide vs going deep

The senior insight: more cores rarely beat warmer caches. If your service is a 10-µs request that touches 4 KB of data, scaling to 64 cores buys nothing unless you have at least 64 requests in flight at all times, because a single request's data fits in L1 anyway. The cores sit half-idle waiting on slow memory traffic from other goroutines that *thought* they were "scaling."

---

## Measurement-first methodology

Senior engineering means refusing to merge optimisations that are not measured. Here is the methodology:

### Step 1: Establish a representative workload

A workload is a function plus a distribution of inputs and a load pattern. "Random ints" is not a workload — "the size distribution of our actual request batches over the last week, replayed at production rate" is a workload.

Sources for representative inputs:

- Anonymised production captures (PCAP, request logs).
- Replayed traces from observability systems.
- Synthetic distributions calibrated against production histograms.

The benchmark you ship should use input that resembles production. Senior engineers reject benchmarks that use `make([]int, 1e6)` filled with ascending integers as "synthetic and not generalisable."

### Step 2: Define the metric and the SLO

Throughput? p50 latency? p99 latency? Memory? GC pause?

Pick one or two; do not chase all five. Have an SLO in mind: "the change should not regress p99 latency on the 1k-batch case by more than 5%."

### Step 3: Write the benchmark

Use `testing.B`, `b.ReportAllocs()`, `b.ResetTimer()`. Make the benchmark *deterministic*: seed the RNG, control input size with `-benchtime`. Run with `-cpu=1,2,4,8` to cover the GOMAXPROCS matrix.

### Step 4: Run it enough times to be statistically meaningful

`-count=10` minimum. `-count=20` for noisy benchmarks. Use `benchstat` to compare the baseline and the optimised version. Report `geomean` and per-benchmark deltas with `p<0.05`.

### Step 5: Inspect the profile

`-cpuprofile`, `-memprofile`, `-blockprofile`, `-mutexprofile`. Before and after. If you cannot explain the speedup with a profile delta, your benchmark is wrong or noisy.

### Step 6: Decide

Speedup × use_frequency > engineering_cost + maintenance_cost?

If yes: merge. If no: archive the branch with a benchmark and a note for next time. If equivocal: pick the simpler implementation.

### A checklist for the senior reviewer

When reviewing a "make it concurrent" PR, ask the author:

1. Where is the benchmark?
2. Where is the baseline?
3. Where is the `benchstat` output?
4. Where is the pprof profile showing the win?
5. Is the win larger than the noise floor (`p < 0.05`)?
6. Does the win hold at `-cpu=1`?
7. Does the win hold under GC pressure (run with `GOGC=20`)?
8. Does the win hold at production input distribution?
9. What does the trace look like under load?
10. Is the new code clearer, or have we taken on complexity for the speedup?

If any answer is "I have not measured that," the PR is not ready.

---

## Designing the right experiment

A benchmark is an experiment. Experiments should isolate the variable under test. Here are the experiment design errors senior engineers reject most often.

### Confounding the measurement

```go
func BenchmarkParallel(b *testing.B) {
    items := loadItemsFromDisk()   // confound 1: disk
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(len(items))
        for _, item := range items {
            go func(item Item) {
                defer wg.Done()
                process(item)
            }(item)
        }
        wg.Wait()
    }
}
```

Two confounds: the disk read is inside the loop, and the goroutine spawn cost is conflated with the parallel processing. The right design is to load once outside, reset the timer, then measure the parallel loop alone.

### Warm-up

The first iteration of a Go benchmark suffers cold caches, JIT-like instruction caches, allocator warm-up. `go test` runs N iterations and divides; with N=1 the warm-up dominates. With N=1000 it amortises. Use `-benchtime=2s` or `-benchtime=10000x` so each measurement is many iterations.

### Background interference

Benchmarks run on a busy laptop are noisy. Run on an isolated machine, disable turbo boost (so frequency is fixed), disable Spectre mitigations only if your production runs without them. Pin to specific cores.

Senior-level benchmark machines:

- Dedicated, not a developer laptop.
- Frequency scaling disabled or pinned (`cpupower frequency-set -g performance`).
- Background services (cron, snapd, indexers) quiesced.
- Same machine for baseline and candidate, in a controlled run order.

### Input bias

Tests written by the author tend to favour their hypothesis. Senior reviewers ask for a benchmark suite that covers:

- Small input (where overhead might dominate).
- Medium input (the common case).
- Large input (where parallelism should win).
- Adversarial input (e.g. all values identical, all values distinct, very long elements).

A win on "medium random" that fails on "small skewed" is rarely a real win.

### Variance

Re-run the same `-count=20` twice. If the geomean differs by >2%, your variance is too high. Increase `-benchtime`, isolate the machine, or change the workload to be more deterministic.

---

## Reviewing a "make it concurrent" PR

Here is a checklist for a thoughtful PR review when someone proposes adding concurrency:

1. **Does the description state the latency or throughput goal?** "Add parallel processing" is not a goal. "Reduce p99 of batch import from 800 ms to 400 ms" is a goal.
2. **Is there a benchmark covering the goal metric?** If not, decline the PR and ask for one.
3. **Does the benchmark cover the right input distribution?** Compare the benchmark inputs to recent production data.
4. **Has the author run `benchstat`?** Are the deltas statistically significant?
5. **Is `-cpu=1` regressed?** A parallel design that loses on 1 CPU is buggy or expensive. Smaller-than-expected datasets running on a single-CPU pod will pay the cost without the benefit.
6. **Does the trace show good parallelism?** Open `go tool trace`; the goroutines should overlap. If goroutines run sequentially because of a shared mutex, the design is broken.
7. **Is the worker count bounded?** Unbounded fan-out is a memory bug waiting to happen. The PR should justify N workers, often as `runtime.GOMAXPROCS(0)` or a config constant.
8. **Are errors propagated correctly?** Fan-out designs lose the first error or accumulate all errors; the team should be explicit about which.
9. **Are panics recovered?** A panic in a worker should not crash the service if the service handles many independent batches.
10. **Is cancellation honoured?** `ctx.Done()` should short-circuit worker loops.
11. **Are profiles attached?** A pprof CPU + alloc profile of the new code under benchmark load.
12. **Are the resource costs proportional?** "We get 1.1× speedup at 8× CPU and 2× memory" is rarely worth merging.

A senior engineer is not the bad guy. They are an advocate for the team's future self. The PR that gets merged is the one that is *defensible* a year later when the speedup is no longer visible.

---

## Sequential vs parallel decision tree

A practical decision tree for "should this be concurrent?":

```
Is the work CPU-bound?
├── No (I/O-bound): does it serialise on a single resource (one DB, one disk)?
│   ├── Yes -> concurrency adds queue depth, not throughput; profile the bottleneck instead.
│   └── No  -> concurrency may help (multiple independent I/Os in flight). Bound by the slowest.
└── Yes (CPU-bound): is the per-item work > ~1 µs?
    ├── No -> sequential is almost always better. Goroutine overhead dominates.
    └── Yes: is the total work > ~10 ms at production sizes?
        ├── No -> sequential is competitive; the simpler code wins.
        └── Yes: can you bound the worker pool to GOMAXPROCS?
            ├── No -> fix the design first.
            └── Yes: are the items independent (no shared mutable state)?
                ├── No -> coordination cost likely exceeds the win.
                └── Yes -> *measure* first, then parallelise.
```

This tree is not gospel. It is a default. Each box of the tree should have a benchmark backing the decision in your specific service.

---

## Latency vs throughput at the design table

A frequent confusion: "we want to be faster." Faster how?

| Metric | Means | Tools that help |
|---|---|---|
| Single-request latency p50 | How fast is a single request typically | Algorithmic improvement, batching, caching |
| Single-request latency p99 | How fast is a slow request | Tail-latency engineering, hedging, timeouts |
| Throughput (req/s) | How many requests per second | Parallelism, pipelining, sharding |
| Tail latency under load | p99 at full throughput | Concurrency control, admission control |
| CPU cost per request | What does each request consume | Profile-driven optimisation |

Concurrency primarily improves *throughput* and sometimes *single-request latency for large requests*. It rarely helps a *small request's* p50 latency, and it often *hurts* p99 because tail latency in concurrent systems is dominated by the worst worker.

A senior conversation in a design review:

- "We want to be faster" -> "Faster how?"
- "We want lower p99 on batch endpoint" -> "Is the batch endpoint already concurrent? Where does p99 come from in pprof?"
- "We want more req/s" -> "What is current saturation? Are workers stuck on a single DB connection?"

The right answer to "we want to be faster" is rarely "let's add goroutines." It is "let's profile and understand where the time goes."

---

## The "shape" of the workload

Concurrency decisions hinge on workload shape. Senior engineers categorise workloads before optimising.

### CPU-bound, embarrassingly parallel

Work on each item is independent, takes >>1 µs, and uses little memory. Examples: hashing files, decoding many small JPEGs, compressing a list of blobs. *Concurrency wins big*; bound the pool to GOMAXPROCS.

### CPU-bound, dependent

The items have ordering or dependency constraints (e.g. update a tree, with each update depending on the previous). *Concurrency rarely wins*; serial usually is correct, and any parallelisation needs careful design.

### I/O-bound, many independent endpoints

Many remote calls to many endpoints. *Concurrency wins on wall time*, bounded by the slowest endpoint.

### I/O-bound, single endpoint

Many calls to one endpoint. *Concurrency may not help*; the endpoint or the connection pool is the bottleneck. You may add latency from connection queueing.

### Memory-bound

Work spends most of its time waiting on cache or DRAM. *Concurrency rarely helps*; cache contention often hurts. Look at false sharing, prefetching, and locality first.

### Mixed

Most real workloads. *Profile, then decide*. The dominant phase determines whether concurrency is the right tool.

---

## Cost models you can carry in your head

Senior engineers carry rough cost models that let them estimate before benchmarking. Memorise:

- **Goroutine spawn**: ~1 µs end-to-end (allocation + scheduler enqueue).
- **Goroutine context switch on same P**: ~200 ns.
- **Channel send/recv, buffered, no block**: ~50 ns.
- **Channel send/recv, unbuffered, with park**: ~250 ns.
- **Mutex lock, uncontended**: ~10 ns.
- **Mutex lock, contended (parked)**: ~1 µs.
- **Atomic load/store**: ~1 ns.
- **Atomic CAS, uncontended**: ~5 ns.
- **Atomic CAS, contended**: ~30–100 ns (cache-line bounce).
- **Map access**: ~20–50 ns.
- **Slice append (no growth)**: ~3 ns.
- **GC pause, modest heap**: ~100 µs to a few ms.

If your per-item work is below 1 µs, *any* concurrency primitive that runs per item will dominate. If your per-item work is above 100 µs, even unbuffered channels are noise. The "interesting" zone is 1–100 µs of work per item; that is where most optimisation debates live, and it is where benchmarks are most informative.

---

## Coordination overhead

Every concurrent design has coordination overhead. The cheaper the work, the more visible the coordination.

### Counting the coordination

A typical worker pool incurs, per item:

- 1 channel send (producer enqueues)
- 1 channel recv (worker dequeues)
- 1 result channel send (worker emits)
- 1 result channel recv (aggregator receives)
- 4 × channel cost = ~200 ns at best, ~1 µs at worst.

If the work is 1 µs, you have doubled the wall time. If the work is 100 µs, the overhead is 1%.

### Avoiding coordination

- **Chunk the input.** Send slices, not items. 100 items per send drops the per-item overhead by 100×.
- **Avoid double channels.** A result channel is often replaceable by a write into a slice indexed by worker ID, joined at the end.
- **Use `errgroup.SetLimit`** instead of a channel-based semaphore.
- **Skip workers entirely** when work is short; iterate serially and call it a day.

---

## Why parallelizing tiny tasks loses

Spelled out: imagine a task that takes 100 ns. You parallelise it across 8 workers. The per-task overhead is 200 ns (goroutine context switch + channel send/recv). The parallel version spends 200 ns of coordination per 100 ns of work — it is 2× *slower* than the serial version regardless of cores.

Now imagine the task takes 10 µs. The per-task overhead is still 200 ns. Coordination is 2% of work. Eight workers give you roughly 7.8× speedup at the limit. The parallel version wins decisively.

The lesson: parallelism scales with *work granularity*. Increase the granularity (chunk the input) until the per-item overhead is small relative to the per-item work. Stop fan-out below that threshold.

---

## Channel and mutex hidden costs

A `sync.Mutex` is roughly 8 bytes. Uncontended lock/unlock is ~10 ns. Contended lock can park the goroutine, which costs ~1 µs round-trip.

A `chan` is heavier:

- Buffered chan: ring buffer of element slots, head/tail indices, mutex, two wait queues.
- Allocation: tens of bytes, sometimes hundreds for the buffer.

Compared to a slice + mutex, a channel costs more per operation. The reason to use a channel is *clarity of ownership and signalling*, not raw speed. The fastest concurrent design is usually neither pure-channels nor pure-mutexes: it is a slice handed to N workers each owning a range, with one final mutex-protected join.

### A common surprise

```go
ch := make(chan int, 1024)
go producer(ch)
go consumer(ch)
```

If the consumer keeps up with the producer, the channel is hot in cache and operations cost ~50 ns each. If the consumer falls behind, the buffer fills, the producer parks, and every send costs ~250 ns. Steady-state throughput halves.

The fix is often *not* a larger buffer (which delays the parking but does not prevent it) but a slower producer or a faster consumer.

---

## Common premature optimisations and their refutations

A non-exhaustive list of "optimisations" that more often than not lose:

1. **`sync.RWMutex` for a hot read path.** RWMutex has higher uncontended cost than `Mutex` and is only faster if the read sections are long and contention is severe. For sub-microsecond reads, `Mutex` wins.
2. **`sync.Pool` for objects that fit in a register.** Pool has overhead. Reusing a `[]byte` of 16 bytes is slower than allocating it.
3. **Lock-free queues for trivial workloads.** A lock-free MPMC queue is harder to reason about and rarely faster than `chan` for the message rates real services see.
4. **Atomic counters across cores.** A single global counter incremented by many goroutines suffers cache-line bouncing. A per-goroutine local counter joined at the end is much faster.
5. **Sharded map for small maps.** A 32-shard map costs 32× the allocation of a single map. Unless contention is measured, single map wins.
6. **Goroutine per request item.** Spawning goroutines per leaf operation costs more than the leaf operation. Use a fixed worker pool.
7. **Buffered channels "to avoid blocking."** Buffered channels delay backpressure, hiding overload. A small buffer is fine; a large buffer hides a problem.
8. **`atomic.Value` for hot config.** Each load is a barrier. If the config rarely changes, a copy-on-write pointer with `atomic.Pointer` is often the same cost; if it never changes after startup, no synchronisation is needed at all.
9. **Custom scheduler / goroutine pools for short tasks.** The runtime scheduler is excellent. Reinventing it via a pool of goroutines that pull from a channel is usually slower than `go f()` directly.
10. **CRDTs for single-writer state.** Conflict-free replicated data types are for *true* multi-master replication. Internal in-process state rarely needs them.

A senior engineer challenges each of these on sight, asking the author to prove that the simpler version was inadequate.

---

## Building a culture of measurement

You can document discipline, but unless the team practises it, the docs are decoration. Culture is what people do without being told.

### Make benchmarks first-class

- A `benchmarks/` directory or per-package `*_bench_test.go` files, run in CI on dedicated hardware.
- A baseline file checked in alongside the code, updated on intentional changes only.
- A weekly benchmark trend dashboard that flags regressions.

### Make profiles first-class

- A `Profile this` button in your service's debug endpoints. A simple HTTP server that exposes pprof and trace endpoints behind auth.
- A "run a profile" runbook on every on-call rotation.
- A culture where the first investigation step for a slow endpoint is "did you profile it?"

### Make `benchstat` mandatory

For any PR claiming a perf improvement, the description must include `benchstat` output. PRs without it are returned.

### Make undo cheap

Every "optimisation" PR should include the benchmark and a one-line revert plan. If the optimisation hurts in production, the team can revert without ceremony.

### Calibration days

Once a quarter, the team picks one "optimisation" already in the code and re-measures it. Either re-confirm or remove. Code that is not re-confirmed is presumed cargo-culted.

---

## Organisational norms

Beyond a single team, the org needs norms.

### The "no concurrency without measurement" gate

Code reviewers reject "make it concurrent" PRs that do not include a benchmark and a pprof.

### The "burden of proof" rule

The author of the optimisation owns the proof. Reviewers do not need to prove the change is harmful; the author must show it helps.

### Public benchmark archive

Each merged optimisation gets a one-page write-up: workload, baseline, candidate, delta, decision. This builds institutional memory and prevents repeating the same evaluation in two years.

### Performance bug bounty

Senior engineers can offer "bring me a measured 10% improvement of X and I will mentor you through merging it." This rewards measurement, not bravado.

---

## Worked example: a CSV pipeline that got slower

A team had a 1 GB CSV file to process: parse each row, validate, transform, emit. The original implementation was a tight serial loop using `bufio.Scanner`. A junior engineer proposed parallelising row processing across 8 workers.

### The proposed design

```go
func processCSV(r io.Reader) error {
    rows := make(chan []byte, 1024)
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for row := range rows {
                processRow(row)
            }
        }()
    }

    sc := bufio.NewScanner(r)
    for sc.Scan() {
        rows <- append([]byte(nil), sc.Bytes()...)
    }
    close(rows)
    wg.Wait()
    return sc.Err()
}
```

### The numbers

Sequential: 9.4 s. Parallel: 11.7 s.

The parallel version was 24% slower. Why?

1. `processRow` was 5 µs per row. The channel send/recv was ~250 ns each — 10% overhead.
2. The `append([]byte(nil), ...)` copy was new work the serial version did not do. The serial version processed the scanner's internal buffer in place. The copy added 200 ns per row.
3. The producer was the same goroutine that read the file. It was already saturating one core; the workers were idle half the time waiting for input.
4. All 8 workers wrote to a shared output file via a mutex. Contention was modest but measurable.

### The fix

Two options were tested.

**Option A: keep parallel but batch.** The scanner sends batches of 100 rows. Per-batch overhead is now 2.5 ns per row instead of 250 ns. Workers do 500 µs of work per dequeue. The output mutex is taken once per batch. Result: 4.1 s. Big win.

**Option B: keep sequential, eliminate the copy.** No goroutines, no channels. Use `bufio.Reader.ReadSlice` to avoid copies. Result: 6.2 s. A 34% improvement with no concurrency.

The team kept Option A because the batch was a real algorithmic improvement. The lesson was that the original "parallel" PR was actually two things bundled: a parallel design and a needless per-row copy. The senior reviewer asked the question that disentangled them, and the team learned to never propose "make it concurrent" without measuring against "make the sequential version better."

---

## Worked example: image thumbnailer

A service generates JPEG thumbnails. Input: a directory of 10000 files. Two implementations:

### Sequential

```go
for _, name := range files {
    if err := thumbnail(name); err != nil {
        return err
    }
}
```

Wall time on 8 cores: 92 s.

### Parallel with worker pool

```go
sem := make(chan struct{}, 8)
var g errgroup.Group
for _, name := range files {
    name := name
    sem <- struct{}{}
    g.Go(func() error {
        defer func() { <-sem }()
        return thumbnail(name)
    })
}
return g.Wait()
```

Wall time on 8 cores: 14 s.

A 6.6× speedup on 8 cores. Why does this one win?

- `thumbnail` is CPU-bound (JPEG decode/resize/encode) and takes ~7 ms per image. Per-item work is 7000× a goroutine spawn.
- The output is independent per file; no shared mutable state.
- The pool is bounded; no goroutine explosion.

The Amdahl serial fraction here is "directory walk" which is < 1% of wall time. The speedup is close to the theoretical maximum of 8 minus overhead.

**Conclusion**: this is a good place for concurrency. The senior reviewer notes it, benchmarks confirm it, the PR merges.

---

## Worked example: HTTP request fan-out

A handler aggregates data from 5 microservices. Sequential calls take ~50 ms each; total 250 ms.

### Parallel design

```go
g, ctx := errgroup.WithContext(ctx)
var users []User
var orders []Order
var inventory Inventory
var prices Prices
var recommendations []Rec

g.Go(func() error { var err error; users, err = svc.Users(ctx); return err })
g.Go(func() error { var err error; orders, err = svc.Orders(ctx); return err })
g.Go(func() error { var err error; inventory, err = svc.Inventory(ctx); return err })
g.Go(func() error { var err error; prices, err = svc.Prices(ctx); return err })
g.Go(func() error { var err error; recommendations, err = svc.Recommendations(ctx); return err })
if err := g.Wait(); err != nil {
    return err
}
```

Wall time: ~60 ms (bounded by the slowest call plus a small amount of overhead).

Why this wins:

- I/O-bound; goroutines do not consume CPU while blocked on network.
- Independent endpoints; no shared bottleneck.
- Network latency dominates; goroutine overhead is invisible.

The 5× speedup is essentially free. This is the textbook case for concurrency in Go services, and is so reliably useful that "fan out independent service calls" is rarely a controversial PR.

---

## Worked example: a hot counter

A service tracks 5 counters: requests, errors, bytes_in, bytes_out, p99_seconds. Each handler increments all 5.

### Naive: one global mutex

```go
type Stats struct {
    mu sync.Mutex
    Requests, Errors, BytesIn, BytesOut int64
}
```

Under 16-concurrent-handler load, the mutex is hot. Profile shows 8% of CPU in `sync.(*Mutex).Lock`.

### Premature optimisation: atomics

```go
type Stats struct {
    Requests, Errors, BytesIn, BytesOut int64
}

func (s *Stats) AddRequest() {
    atomic.AddInt64(&s.Requests, 1)
}
```

Same fields, same cache line, 16 goroutines hammering atomics on it. Cache-line bouncing. Result: *slower* than the mutex version, because the atomics each generate cache-coherence traffic and the mutex version batches multiple field updates under one acquisition.

### Better: per-CPU sharded counters

```go
type Stats struct {
    shards []struct {
        Requests, Errors, BytesIn, BytesOut int64
        _ [32]byte // pad to cache line
    }
}

func (s *Stats) AddRequest() {
    p := runtime.GOMAXPROCS(0) // approximate "shard by P"
    shard := fastrand() % uint32(p)
    atomic.AddInt64(&s.shards[shard].Requests, 1)
}
```

This works but is over-engineered. The simpler win:

### Simplest: per-goroutine local, flush on response

Each handler counts in local variables, then flushes once at end:

```go
func handler(...) {
    var localReq, localBytes int64
    // ... do work, mutate localReq, localBytes
    atomic.AddInt64(&stats.Requests, localReq)
    atomic.AddInt64(&stats.BytesOut, localBytes)
}
```

One atomic op per handler instead of N. No cache contention. Profile drops counter overhead from 8% to 0.1%.

The lesson: the obvious "use atomics" is often worse than "use a mutex"; the right answer is usually "reduce the number of operations," not "use a cheaper operation."

---

## Worked example: parallel map

A common ask: "let's make a thread-safe map that scales better than `sync.Map`."

### Attempt 1: sharded map, 32 shards

```go
type ShardedMap[K comparable, V any] struct {
    shards [32]struct {
        mu sync.RWMutex
        m  map[K]V
    }
}
```

For a workload with 10000 keys and 80/20 read/write under 16 concurrent goroutines:

- Single `sync.Mutex`-protected map: 6.8 µs/op.
- `sync.Map`: 4.2 µs/op.
- Sharded 32-way: 4.8 µs/op.
- Sharded 32-way with `RWMutex`: 5.1 µs/op.

The 32-way sharding lost on this workload. Why? The hash function (compute the shard index) cost 50 ns per access. Most contention was already absorbed by the runtime's locking strategy. `RWMutex` lost to `Mutex` because the read sections were too short to benefit from reader-parallelism.

### Attempt 2: lock-free map

Implementations of lock-free hash maps in Go (`xsync.Map`, third-party libraries) can win for *very* read-heavy workloads with many cores. They lose when:

- The map has many writes.
- The map is small.
- The contended span is short.

Always measure with realistic data and load. Do not introduce a third-party "fast map" unless you can show a 2× win on your benchmark suite *and* the code is well-understood.

---

## Reading a CPU profile after a concurrency change

A senior engineer reading a pprof CPU profile of a concurrent program looks for:

### Runtime overhead

Functions that show up in CPU profiles include scheduler internals. A healthy program might show 1–3% of CPU in `runtime.findrunnable`, `runtime.schedule`, `runtime.gopark`, `runtime.lock`. If those are above 10%, the scheduler is doing too much work for the workload — typical causes are too many short goroutines, too many channel hops, or excessive contention.

### Allocation overhead

`runtime.mallocgc`, `runtime.makeslice`, `runtime.mapassign_*` show up when the workload allocates a lot. If the parallel version allocates more than the serial version, the GC will eat the savings.

### Mutex contention

`sync.(*Mutex).Lock`, `sync.(*Mutex).Unlock`, and `sync.runtime_SemacquireMutex` show up under contention. If `runtime_SemacquireMutex` is visible, you are actually parking — that is the expensive path.

### False sharing signal

False sharing does not show up as a labelled function. It appears as elevated CPU time in user code, plus high `IPC` (instructions per cycle) drops in perf counters. The flame graph shows nothing wrong; the wall-clock disagrees with the user CPU.

### Comparison method

Run the profile with `-base` to compare candidate to baseline:

```
go tool pprof -base before.pb.gz after.pb.gz
```

This shows *deltas*: functions that got more or less time. A successful optimisation has a clear "thing that went down." A bad optimisation has lots of small wins and losses with no net direction.

---

## Reading a trace after a concurrency change

`go test -trace trace.out` then `go tool trace trace.out` reveals the timeline. What to look for:

### Parallelism in the goroutine view

Open "Goroutine analysis" and look at the time each goroutine spent in each state. If most workers spent most of their time *runnable but not running*, the scheduler is starved (rare in Go; usually means you have hundreds of thousands of goroutines and they cycle).

If workers spent most time blocked on channels, the producer is the bottleneck. Increase batch size or speed up the producer.

If workers spent most time in syscalls, they were waiting on I/O. Concurrency is helping if there are >1 I/Os in flight, hurting if they queue on one resource.

### GC pauses

`go tool trace` highlights GC pauses. Long pauses are a clue that the parallel version is allocating more than the serial.

### Per-P utilisation

Each P's timeline shows how much of wall time it spent running goroutines. Idle stripes mean the workload was not saturating that core. If 4 of 8 Ps were idle most of the run, your nominal "8-way parallel" was actually "4-way."

---

## Statistical significance for benchmarks

Benchmarks are noisy. To compare two variants:

### Run with `-count=N`

```
go test -bench=. -count=20 -cpu=1,2,4,8 > before.txt
# ... change code ...
go test -bench=. -count=20 -cpu=1,2,4,8 > after.txt
benchstat before.txt after.txt
```

`benchstat` reports:

- Mean ± standard deviation per benchmark.
- Geomean across benchmarks.
- Welch's t-test p-value for each pair.

A delta with `p > 0.05` is not statistically significant; do not claim a speedup.

### How many runs are enough?

Rule of thumb: increase `-count` until the within-run variance stabilises. For a benchmark with 1% noise, `-count=10` suffices. For a benchmark with 10% noise, `-count=50` or more is needed; you also probably want a quieter machine.

### Tail-aware metrics

`benchstat` reports central tendency. If you care about p99, write a benchmark that measures p99 directly (using `b.Loop` plus a slice of timings, or a histogram).

### Beware of compiler tricks

A benchmark whose result is discarded can be optimised away. Use `runtime.KeepAlive` or `b.ReportMetric` to consume the result, or sink to a package-level variable.

```go
var sink int

func BenchmarkX(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = work()
    }
}
```

---

## GOMAXPROCS at the senior level

`GOMAXPROCS` controls the number of Ps. The default is the number of logical CPUs available to the process (CPU set as detected by `runtime.NumCPU`; since Go 1.22 also limited by cgroup CPU quotas on Linux, with full automatic adjustment expected in 1.23+).

### What changes with GOMAXPROCS

- More Ps means more parallelism, *bounded* by available cores.
- More Ps means more scheduler bookkeeping; each P has its own runq, mcache, etc.
- More Ps means more memory: each P's overhead is a few KB.

### Pitfalls

- Containerised environments where `runtime.NumCPU` reports the host CPU count, not the cgroup limit. Older Go versions ran on 64 Ps inside a 2-CPU container, wasting scheduler effort and increasing GC contention.
- Setting `GOMAXPROCS=1` is sometimes used to debug concurrency bugs; production should not run this way.
- Setting `GOMAXPROCS` higher than available cores does *not* increase parallelism; it adds overhead.

### Modern Go and cgroups

Go 1.22+ on Linux respects the cgroup CPU quota when computing `GOMAXPROCS`. Go 1.23+ may adjust automatically when the quota changes. Senior engineers in container environments check `runtime.GOMAXPROCS(0)` at startup to confirm the value matches the container's actual quota.

### Measuring per-`-cpu` performance

Always benchmark with `-cpu=1,2,4,8`. A parallel design that wins at 8 cores but loses at 1 is dangerous: small-instance deployments or scheduling jitter can hit the lossy regime.

---

## GC interactions with goroutine count

The Go garbage collector scales with heap size and allocation rate, not goroutine count directly. But goroutine count affects allocation:

- More goroutines, each allocating per item, multiplies the allocation rate.
- More goroutines, each with their own buffer, increases the live heap.
- More goroutines means more stacks. Stacks are not free; each is at least 2 KB initially, growing as needed.

### Concrete: a parallel decoder with allocator-per-worker

```go
type Worker struct {
    buf []byte // 4 KB per worker
}

workers := make([]*Worker, runtime.GOMAXPROCS(0))
```

8 workers × 4 KB = 32 KB. Negligible. But:

```go
type Worker struct {
    cache map[uint32]Item // grows with input
}
```

Now each worker has its own cache; total memory is 8× a single shared cache. If items are global (same set of inputs), per-worker caching hurts both memory and locality.

### GC pause amplification

A high-frequency allocator (a parallel parser allocating one struct per row) under 8 workers issues 8× the allocations. The GC's mark cost grows roughly with live heap; if the live set also grew, pauses grow.

A senior engineer instruments GC via `runtime.ReadMemStats`, `runtime/metrics`, and the trace tool. Goals:

- Total time in GC < 5% of wall clock.
- p99 pause < 10 ms (or whatever the SLO demands).
- Allocations per request close to constant as load grows.

If a concurrency change worsens any of these, the change is suspect even if microbenchmarks look better.

---

## Self-assessment

Test your senior-level grasp:

1. A teammate proposes parallelising a `[]int` sum over 8 workers. The slice has 10 elements. What do you say?
2. A trace shows 8 worker goroutines spending most of their wall time in `chan recv`. What is the likely problem?
3. A benchmark shows a 2× speedup on an 8-core developer laptop and a 0.7× regression in a 2-CPU production pod. What is the explanation?
4. `runtime.GOMAXPROCS(0)` is 64 in a 4-CPU container. Why? How do you fix it?
5. A `sync.Pool` was added for `[]byte` allocations and shows a 10% speedup on `BenchmarkX`. Profile shows GC time is unchanged. What might be going on?
6. False sharing makes a "parallel" design slower than the serial. Name two ways to detect it.
7. A team claims "we use lock-free." How do you challenge the claim?
8. Amdahl's law says max speedup is 5× even with 32 cores. Explain in one sentence.
9. A goroutine handle leak grows the heap by 2 MB/min. Where do you look first?
10. A PR adds 4 goroutines to a 100-µs request and shows -2% latency in microbench. Should you merge?

If you can answer all 10 in a few sentences and cite the underlying mechanism (cache line, scheduler tick, GC pace), you are at senior level. If not, the rest of this section's writings will fill the gaps.

---

## Summary

Senior-level practice on premature concurrency optimisation rests on three pillars:

1. **Physical mechanism awareness.** You know why concurrency might hurt: scheduler overhead, context switches, false sharing, GC pressure, cache effects. You can predict the rough magnitude.
2. **Measurement discipline.** You demand benchmarks, profiles, and `benchstat` output before merging. You refuse "I think it is faster" as a justification.
3. **Cultural leadership.** You set the bar for your team. You build the norms, the runbooks, the gates. You make discipline *easy* to follow and the alternative *hard* to slip through.

When all three are in place, the team writes concurrent code only when the workload calls for it, and the codebase contains only optimisations that have earned their keep. When any one is missing, the codebase accumulates layers of "performance" that nobody can justify, nobody can remove, and nobody can prove worked.

The next file, `professional.md`, extends this thinking to production: SLOs, profile-driven workflows, profile-and-then-decide pipelines, and the deeper architectural decisions about when to scale a service horizontally vs. add more concurrency within a process.

---

## Appendix A: senior-level reading list

- Knuth's original paper and the misquote: *Structured Programming with go to Statements*, 1974.
- Brendan Gregg, *Systems Performance*, chapters on CPU and memory.
- The Go runtime source: `src/runtime/proc.go`, `src/runtime/chan.go`, `src/runtime/mgc.go`. These files are readable Go; the comments are extensive.
- Dmitry Vyukov's writings on lock-free algorithms (1024cores.net), particularly the cost analyses.
- Ulrich Drepper, *What Every Programmer Should Know About Memory*. Old but the mechanisms are unchanged.
- Cliff Click, *Why Locks Aren't a Bottleneck on x86*. A useful counter to "locks are slow" folklore.

These are not assigned reading; they are the senior engineer's reference shelf when a design conversation calls for a specific number or a specific mechanism. Cite them in PR reviews when you want to convince a teammate that their cache-line intuition is wrong.

---

## Appendix B: a one-page rubric for "should this be concurrent?"

Print this and tape it above the desk:

1. What is the per-item work in nanoseconds?
   - < 100 ns: no concurrency.
   - 100 ns – 1 µs: serial; consider batching to make work-per-item > 1 µs if parallelism is required.
   - 1 µs – 100 µs: candidate for concurrency *if* there is enough total work.
   - > 100 µs: concurrency usually wins; bound the pool.
2. What is the total work in seconds?
   - < 1 ms total: never concurrency; the goroutine spawn is half the work.
   - 1 ms – 100 ms total: concurrency only if per-item work is in the candidate band.
   - > 100 ms total: concurrency is worth investigating.
3. Are the items independent?
   - No: do not bother; the coordination will dominate.
   - Yes: candidate.
4. Is the bottleneck CPU, I/O, or memory?
   - CPU: parallelism bounded by cores.
   - I/O on many endpoints: parallelism bounded by slowest endpoint.
   - I/O on one endpoint: parallelism is a queue, not a speedup.
   - Memory: parallelism often hurts.
5. Have you benchmarked the sequential version with the obvious algorithmic wins (batching, avoiding copies, reusing buffers)?
   - No: do that first. The sequential version is almost always better than you think.
   - Yes: now you can fairly compare.
6. Have you computed an Amdahl estimate?
   - No: do it on a napkin.
   - Yes: is the speedup > 1.3×? If not, skip the change.
7. Have you written the benchmark?
   - No: write it first.
   - Yes: run with `-count=20 -cpu=1,2,4,8`.
8. Have you run `benchstat`?
   - No: do it.
   - Yes: is the win significant at `p < 0.05`?
9. Have you profiled before and after?
   - No: do it. The profile is the proof.
   - Yes: can you point to the function that got faster?
10. Have you considered the maintenance cost?
    - The team will read this code for years. A 10% speedup that doubles complexity is rarely worth it.

If you can say yes to every item with evidence, the PR is ready for review. If not, fix the gap before opening the PR.

---

## Appendix C: anti-pattern catalogue

A taxonomy of premature concurrency optimisations seen in real Go services, with the typical fix:

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Goroutine per HTTP request param | Goroutine count spikes per request | Process sequentially or bounded pool |
| Channel-actor for trivial state | Channel ops dominate CPU profile | Use mutex + struct |
| Sharded map for low contention | Profile shows < 1% mutex wait | Single map + mutex |
| `sync.RWMutex` for short reads | RUnlock is hotter than Lock | `sync.Mutex` |
| `sync.Pool` for register-sized | Profile shows pool overhead | Just allocate |
| Atomic counter per call | Cache-line bouncing | Local counter, batch flush |
| Buffered channel "to absorb spikes" | Channel grows; latency hides | Smaller buffer + backpressure |
| Worker pool for short tasks | Pool startup > work | Sequential loop |
| Pre-fanned-out reads on cold cache | First requests slow | Sequential or chunked |
| Atomic.Value for never-changing | Atomic loads in every hot path | Plain pointer at init |
| Lock-free queue for low throughput | Hard to read, no speedup | `chan` or mutex-protected slice |
| Goroutine spawn inside hot loop | `runtime.newproc` in profile | Worker pool |
| Result aggregation via channel | Aggregator goroutine bottlenecks | Direct write to indexed slice |
| Buffered chan to "decouple" | Producer racing consumer; OOM | Unbuffered or bounded |
| Many goroutines on one DB conn | Connection pool saturated | Bound concurrency to pool size |

Each row is a topic to discuss in a postmortem when it appears. Each row is a paragraph to add to the team's design review checklist.

---

## Appendix D: a sample benchmark suite

A reference structure for benchmarking a concurrency-related change:

```go
package mywork_test

import (
    "context"
    "math/rand"
    "runtime"
    "sync"
    "testing"
    "time"

    "example.com/mywork"
)

func makeItems(n int, seed int64) []mywork.Item {
    r := rand.New(rand.NewSource(seed))
    items := make([]mywork.Item, n)
    for i := range items {
        items[i] = mywork.Item{
            ID:    int64(i),
            Value: r.Float64(),
            Name:  randomString(r, 8, 64),
        }
    }
    return items
}

func randomString(r *rand.Rand, minLen, maxLen int) string {
    n := minLen + r.Intn(maxLen-minLen)
    b := make([]byte, n)
    for i := range b {
        b[i] = byte('a' + r.Intn(26))
    }
    return string(b)
}

func BenchmarkSequential(b *testing.B) {
    sizes := []int{100, 1_000, 10_000, 100_000}
    for _, n := range sizes {
        items := makeItems(n, 42)
        b.Run(sizeLabel(n), func(b *testing.B) {
            b.ReportAllocs()
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                _ = mywork.ProcessSequential(items)
            }
        })
    }
}

func BenchmarkParallel(b *testing.B) {
    sizes := []int{100, 1_000, 10_000, 100_000}
    workers := []int{1, 2, 4, 8}
    for _, n := range sizes {
        items := makeItems(n, 42)
        for _, w := range workers {
            b.Run(sizeLabel(n)+"/W"+itoa(w), func(b *testing.B) {
                b.ReportAllocs()
                b.ResetTimer()
                for i := 0; i < b.N; i++ {
                    _ = mywork.ProcessParallel(context.Background(), items, w)
                }
            })
        }
    }
}

func sizeLabel(n int) string {
    if n >= 1000 {
        return "N" + itoa(n/1000) + "k"
    }
    return "N" + itoa(n)
}

func itoa(n int) string { return strconvItoa(n) }

func BenchmarkSequentialUnderLoad(b *testing.B) {
    items := makeItems(10_000, 42)
    var bg sync.WaitGroup
    stop := make(chan struct{})
    for i := 0; i < runtime.GOMAXPROCS(0); i++ {
        bg.Add(1)
        go func() {
            defer bg.Done()
            for {
                select {
                case <-stop:
                    return
                default:
                    busy()
                }
            }
        }()
    }
    defer func() { close(stop); bg.Wait() }()

    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = mywork.ProcessSequential(items)
    }
}

func busy() {
    // a small amount of CPU work to simulate other load
    _ = time.Now().UnixNano()
}
```

This sketch (in real code you would also use `b.SetParallelism`, `b.RunParallel` where appropriate) covers:

- Size sweep
- Worker-count sweep
- Allocation reporting
- Background load (so you see how the benchmark behaves under shared CPU)

Run with `-count=20 -cpu=1,2,4,8 -benchtime=2s` and feed into `benchstat`.

---

## Appendix E: case stories of premature optimisation reversals

Three short stories from real teams (sanitised).

### Story 1: the parallel CSV exporter

A reporting service generated CSV exports. The original implementation used a single goroutine to write rows to an `io.Writer`. A developer parallelised row generation across 8 workers writing to a channel, with a single consumer writing to the file.

Performance: 1.4× faster on a developer laptop. Production: 0.9× slower (regression) on the 2-CPU app pod.

Diagnosis: the worker goroutines spent most of their time blocked on the channel send (the file writer was slow, 50 MB/s). On the laptop the disk was fast and the bottleneck was actually the row generation; on production the disk was slow (network-attached) and the bottleneck was the writer. The parallel design moved CPU off the critical path on a fast disk but added scheduling overhead on a slow disk.

Resolution: revert to sequential. The team added a per-deployment benchmark that runs against the target environment, not a developer laptop.

### Story 2: the lock-free deduplicator

A team built a custom lock-free hash set to deduplicate event IDs. The set was used by an HTTP handler that ingested ~1000 events/sec.

Performance: a microbenchmark showed 1.8× over a `sync.Map`. Production: identical throughput, increased p99 latency by 30%.

Diagnosis: the lock-free set was correct but had pathological behaviour under bursts of similar keys (it used linear probing and burst hot-spots caused long probe chains). `sync.Map` did not have this issue. The microbenchmark used random keys; production keys were not random.

Resolution: revert to `sync.Map`. Add a benchmark that uses the actual key distribution captured from production logs.

### Story 3: the prematurely sharded queue

A team replaced a single Go channel with a 16-way "sharded queue" (each shard a channel, producers round-robin by key). The goal was to scale throughput.

Performance: microbenchmark showed flat performance; the team merged anyway because "it scales better."

Two years later: no measurable contention on the original channel; the shard hash adds 100 ns per send; 16 channels mean 16 garbage-collection roots; iteration across shards is impossible without a custom collector. Total code: 280 lines.

Resolution: replaced with a single `chan` and a `sync.Mutex` around the rare administrative operations. Net: removed 280 lines, no performance regression.

### What the stories have in common

- The original developer believed the parallel design was faster.
- The benchmark was misleading: wrong inputs, wrong environment, wrong dimension.
- The simpler version was eventually shown to be at least as good.
- The cost of the parallel design was paid in maintenance, not in CPU.

Senior engineers prevent these stories from being written, by requiring evidence at merge time and by maintaining a culture where "I removed the optimisation because it did not pay" is praised.

---

## Appendix F: a half-page glossary

- **Amdahl's law**: ceiling on speedup from parallelism given a serial fraction.
- **Backpressure**: signalling upstream to slow down when a downstream stage is overwhelmed.
- **Cache line**: smallest unit the CPU cache moves at a time; 64 B on x86_64.
- **Context switch**: handoff from one runnable thread/goroutine to another; ~200 ns for goroutines, ~5 µs for OS threads.
- **False sharing**: two cores writing to different fields in the same cache line, causing coherence traffic.
- **GOMAXPROCS**: the number of Ps; effectively the parallel-execution slots.
- **Karp-Flatt metric**: experimentally determined serial fraction from measured speedups.
- **Locality**: how close (in address or time) related accesses are; high locality means warm caches.
- **NUMA**: non-uniform memory access; multi-socket boxes where memory has a "home" socket.
- **`pprof`**: Go's profiler; samples stacks for CPU, allocation, mutex, block.
- **Preemption**: forcibly suspending a goroutine at a safe point; asynchronous since Go 1.14.
- **Premature optimisation**: any optimisation made without measurement that justifies it.
- **`trace`**: Go's tracer; records every scheduler and GC event for visualisation.
- **Work stealing**: a P with an empty runq steals goroutines from a non-empty P.

---

## Appendix G: end-of-chapter checklist

If you take three things from this senior-level chapter:

1. **Concurrency has a physical cost.** Memorise the numbers: 200 ns goroutine switch, ~1 µs mutex contention, 30 ns cache-line bounce.
2. **Measurement-first is non-negotiable.** No benchmark, no profile, no merge.
3. **Culture matters.** Your team's discipline is the durable thing. The code you write today will be edited by people who learned from you. Teach them by example: write the benchmark first, run `benchstat`, attach the pprof.

When in doubt, prefer the simpler design. The next engineer to maintain the code will thank you, and the production system will be no slower for the choice.

---

## Appendix H: extended deep-dive — false sharing, demonstrated

A small reproducible Go program that demonstrates false sharing on hardware that has 64 B cache lines:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

type Adjacent struct {
    A int64
    B int64
}

type Padded struct {
    A int64
    _ [56]byte
    B int64
    _ [56]byte
}

func runAdjacent(iterations int64) time.Duration {
    var counters Adjacent
    var wg sync.WaitGroup
    wg.Add(2)
    start := time.Now()
    go func() {
        defer wg.Done()
        for i := int64(0); i < iterations; i++ {
            atomic.AddInt64(&counters.A, 1)
        }
    }()
    go func() {
        defer wg.Done()
        for i := int64(0); i < iterations; i++ {
            atomic.AddInt64(&counters.B, 1)
        }
    }()
    wg.Wait()
    return time.Since(start)
}

func runPadded(iterations int64) time.Duration {
    var counters Padded
    var wg sync.WaitGroup
    wg.Add(2)
    start := time.Now()
    go func() {
        defer wg.Done()
        for i := int64(0); i < iterations; i++ {
            atomic.AddInt64(&counters.A, 1)
        }
    }()
    go func() {
        defer wg.Done()
        for i := int64(0); i < iterations; i++ {
            atomic.AddInt64(&counters.B, 1)
        }
    }()
    wg.Wait()
    return time.Since(start)
}

func main() {
    runtime.GOMAXPROCS(2)
    const iters = int64(1e8)
    adj := runAdjacent(iters)
    pad := runPadded(iters)
    fmt.Printf("adjacent: %s\npadded:   %s\nratio:    %.2fx\n",
        adj, pad, float64(adj)/float64(pad))
}
```

On a typical x86_64 box, the adjacent version is 4–8× slower. The padded version is bounded by the speed of the atomic instructions themselves. Show this program to a developer once and the concept of false sharing becomes intuition.

### Variant: write-then-read sharing

False sharing also affects reads, not just writes. A producer writing to a field and a consumer reading a *different* field on the same line still exchange the line.

```go
type ProducerConsumer struct {
    seq  int64 // producer writes
    used int64 // consumer reads
}
```

Same fix: pad. If your design has two roles touching the same struct, separate their data into distinct cache lines.

### A common debugging anecdote

A team observed that adding a new field to a hot struct *slowed* the program by 15%. Removing the field restored speed. The new field sat next to a heavily-mutated counter; before the addition, the counter was alone on its line. After, two writers were contending for the same line. The fix: move the new field into a separate struct or pad it explicitly.

The lesson is to be aware of struct layout in code-generated hot paths. `go vet -copylocks` and `fieldalignment` (`golang.org/x/tools/go/analysis/passes/fieldalignment`) can flag obvious issues; nothing flags false sharing automatically — only profiling and benchmarks do.

---

## Appendix I: extended deep-dive — goroutine spawn vs worker pool

Two implementations of a parallel map function:

### Spawn-per-item

```go
func MapSpawn[T any, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    var wg sync.WaitGroup
    for i := range xs {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            out[i] = f(xs[i])
        }()
    }
    wg.Wait()
    return out
}
```

### Bounded worker pool

```go
func MapPool[T any, U any](xs []T, f func(T) U, workers int) []U {
    out := make([]U, len(xs))
    var idx atomic.Int64
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                i := idx.Add(1) - 1
                if int(i) >= len(xs) {
                    return
                }
                out[i] = f(xs[i])
            }
        }()
    }
    wg.Wait()
    return out
}
```

### Benchmark

```go
func BenchmarkMap(b *testing.B) {
    xs := make([]int, 100_000)
    for i := range xs {
        xs[i] = i
    }
    f := func(x int) int { return x * 2 } // very cheap

    b.Run("Sequential", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            out := make([]int, len(xs))
            for j, x := range xs {
                out[j] = f(x)
            }
            _ = out
        }
    })

    b.Run("Spawn", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            _ = MapSpawn(xs, f)
        }
    })

    b.Run("Pool/8", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            _ = MapPool(xs, f, 8)
        }
    })
}
```

### Typical results

```
Sequential:      ~75 µs/op
Spawn:          ~92 ms/op   (>1000x slower!)
Pool/8:          ~120 µs/op (1.6x slower than sequential)
```

Spawn-per-item loses catastrophically because spawning 100,000 goroutines costs orders of magnitude more than the work each does. Pool/8 loses to sequential because the work is too cheap; the atomic increment and the cache traffic outweigh the gain.

### When does the parallel pool win?

Increase the per-item cost:

```go
f := func(x int) int {
    sum := 0
    for i := 0; i < 1000; i++ {
        sum += i * x
    }
    return sum
}
```

Now `f` costs ~1 µs. Results:

```
Sequential:    ~100 ms/op
Spawn:         ~120 ms/op   (still loses to sequential)
Pool/8:        ~17 ms/op    (5.9x faster than sequential)
```

The pool wins; the spawn does not (because spawn cost is still per-item). At 10 µs of `f`, the pool wins by closer to 8×; at 100 ns of `f`, sequential wins by 2×. The crossover is between 500 ns and 1 µs of per-item work in a typical Go runtime, depending on hardware.

### Senior takeaway

Always use a *bounded worker pool* for fan-out, never `go` per item except in I/O fan-out where each goroutine is long-lived. The bound should be `runtime.GOMAXPROCS(0)` for CPU work, or a measured higher number for I/O work.

---

## Appendix J: extended deep-dive — channel cost in detail

`chan` is a wonderful primitive for *communication*. It is not a wonderful primitive for *fast data transfer*. The internal structure of a buffered chan (in `runtime/chan.go`):

```go
type hchan struct {
    qcount   uint           // number of elements in queue
    dataqsiz uint           // size of circular queue
    buf      unsafe.Pointer // points to dataqsiz array
    elemsize uint16
    closed   uint32
    timer    *timer
    elemtype *_type
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // receivers waiting
    sendq    waitq          // senders waiting
    lock     mutex          // protects ALL the above
}
```

Every channel operation acquires `lock`. On Linux this is a `futex`-backed mutex; on the uncontended path it is ~10 ns; on the contended path it parks the goroutine for ~1 µs.

A "send" copies the value into the buffer (or directly to a waiting receiver). A "receive" pops from the buffer (or from a waiting sender). Both touch the same `hchan` struct and acquire the same lock.

### What this means

- A channel between two goroutines with no contention is ~50 ns per send/recv.
- A channel with many senders or receivers contends on the lock; effective cost rises.
- A channel that becomes "always full" or "always empty" parks one side; ~250 ns per op.
- A channel with `select` cases has additional bookkeeping for each case.

### Faster alternatives

For very-high-throughput single-producer single-consumer scenarios (>1 M ops/sec), a custom ring buffer using atomics on indices can outperform `chan` by 2–4×. The complexity is significant; only do this with a benchmark forcing the issue.

For batching, send a *slice* of items per send. The per-item amortised cost drops from 50 ns to a few ns. This is almost always the right optimisation if you find yourself fighting channel cost.

```go
// Slow: 1 item per send
ch := make(chan Item, 64)
for _, it := range items {
    ch <- it
}

// Fast: batches of 64 items per send
batches := make(chan []Item, 4)
batch := make([]Item, 0, 64)
for _, it := range items {
    batch = append(batch, it)
    if len(batch) == cap(batch) {
        batches <- batch
        batch = make([]Item, 0, 64)
    }
}
if len(batch) > 0 {
    batches <- batch
}
```

The batched version pays the channel cost 1/64 as often. Workers receive a slice and iterate locally, keeping data hot in L1.

---

## Appendix K: extended deep-dive — mutex micro-benchmarks

What does a `sync.Mutex` actually cost?

### Uncontended

```go
func BenchmarkMutexUncontended(b *testing.B) {
    var mu sync.Mutex
    for i := 0; i < b.N; i++ {
        mu.Lock()
        mu.Unlock()
    }
}
```

Typical result: 8–12 ns/op. The mutex is in L1 the whole time; the lock is a simple CAS.

### Contended

```go
func BenchmarkMutexContended(b *testing.B) {
    var mu sync.Mutex
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            // very short critical section
            mu.Unlock()
        }
    })
}
```

Typical result with 8 cores: 200–800 ns/op. The cache line bounces between cores; goroutines occasionally park.

### Inside a critical section that does real work

```go
func BenchmarkMutexWithWork(b *testing.B) {
    var mu sync.Mutex
    counter := 0
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            for i := 0; i < 100; i++ {
                counter += i
            }
            mu.Unlock()
        }
    })
}
```

Now the work inside the critical section dominates the mutex cost. Lock acquisition is amortised over the protected work.

### RWMutex comparisons

```go
func BenchmarkRWMutexReadOnly(b *testing.B) {
    var mu sync.RWMutex
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.RLock()
            mu.RUnlock()
        }
    })
}
```

Typical result: 50–100 ns/op uncontended (RWMutex is more expensive per-op than Mutex), 200+ ns/op contended.

### Senior takeaway

`sync.RWMutex` is *not free* per read. Its higher per-op cost only pays back when the critical section is long *and* the read/write ratio is high. For short reads (<100 ns of work inside the lock), `sync.Mutex` is faster.

---

## Appendix L: extended deep-dive — pprof reading by example

Here is a synthetic example of a profile we will read together. A program that processes work with three implementations under load.

```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

var counter int64

func mutexImpl(items []int) int {
    var mu sync.Mutex
    sum := 0
    var wg sync.WaitGroup
    chunks := splitWork(items, runtime.GOMAXPROCS(0))
    for _, chunk := range chunks {
        chunk := chunk
        wg.Add(1)
        go func() {
            defer wg.Done()
            local := 0
            for _, x := range chunk {
                local += x
            }
            mu.Lock()
            sum += local
            mu.Unlock()
        }()
    }
    wg.Wait()
    return sum
}

func atomicImpl(items []int) int {
    var sum int64
    var wg sync.WaitGroup
    chunks := splitWork(items, runtime.GOMAXPROCS(0))
    for _, chunk := range chunks {
        chunk := chunk
        wg.Add(1)
        go func() {
            defer wg.Done()
            for _, x := range chunk {
                atomic.AddInt64(&sum, int64(x))
            }
        }()
    }
    wg.Wait()
    return int(sum)
}

func sequentialImpl(items []int) int {
    sum := 0
    for _, x := range items {
        sum += x
    }
    return sum
}

func splitWork(items []int, n int) [][]int {
    chunkSize := (len(items) + n - 1) / n
    out := make([][]int, 0, n)
    for i := 0; i < len(items); i += chunkSize {
        end := i + chunkSize
        if end > len(items) {
            end = len(items)
        }
        out = append(out, items[i:end])
    }
    return out
}

func main() {
    go func() { log.Println(http.ListenAndServe("localhost:6060", nil)) }()
    items := make([]int, 1_000_000)
    for i := range items {
        items[i] = i
    }
    for i := 0; ; i++ {
        atomic.AddInt64(&counter, int64(mutexImpl(items)))
        atomic.AddInt64(&counter, int64(atomicImpl(items)))
        atomic.AddInt64(&counter, int64(sequentialImpl(items)))
        if i%100 == 0 {
            log.Println("iter", i, "counter", atomic.LoadInt64(&counter))
            time.Sleep(time.Millisecond)
        }
    }
}
```

Visit `http://localhost:6060/debug/pprof/profile?seconds=30` to grab a CPU profile. Open in `go tool pprof -http=:8080` and view "Top". What you will see:

- `atomicImpl` consumes the most CPU — atomic.AddInt64 in tight loop is a major bottleneck.
- `mutexImpl` consumes less than `atomicImpl` because each goroutine accumulates locally and locks once.
- `sequentialImpl` consumes the least.

Now the question for a senior reviewer: "Is the atomic version actually fastest?" Sometimes the answer is no. Replace `BenchmarkAtomic` with a benchmark and you may find that on heavily contended hot atomics, the mutex version beats the atomic version by 3×. The reason is exactly the cache-line bouncing we discussed.

The profile tells you what is consuming CPU; it does not tell you whether the strategy is right. Always pair the profile with a benchmark.

---

## Appendix M: extended deep-dive — trace reading by example

`go test -bench=BenchmarkMap -trace trace.out`, then `go tool trace trace.out`. The trace UI offers:

1. **View trace** — the timeline view.
2. **Goroutine analysis** — per-goroutine summaries.
3. **Network blocking profile** — flame graph of time in network syscalls.
4. **Synchronization blocking profile** — flame graph of time blocked on chan/mutex.
5. **Syscall blocking profile** — flame graph of time in syscalls.
6. **Scheduler latency profile** — time spent in runqueue vs running.

### What the timeline tells you

If you zoom in on a 10 ms window, you see horizontal lanes (one per P) and stacked colored boxes (one per running goroutine instance). Look for:

- **Idle gaps**: Ps that are not running anything. If you expected 8-way parallelism and see 4 lanes idle most of the time, your parallelism is half what it could be.
- **Synchronisation marks**: red lines connecting a sender and a receiver. Many in a row means heavy channel traffic.
- **GC stripes**: black or pink bands across all Ps during GC. Long ones are a problem.
- **Preemption arrows**: the runtime preempted a goroutine; rare in well-behaved code.

### Goroutine analysis: "where did the time go?"

For each goroutine class (grouped by the goroutine's entry function), the trace tool reports:

- Total time alive.
- Time in `Grunning` (actually executing).
- Time in `Grunnable` (in the runqueue but not running).
- Time in `Gwaiting` (blocked on chan, mutex, syscall, network).
- Time in GC.

A worker goroutine that is `Grunnable` for 80% of its lifetime is starved — there are more runnable goroutines than Ps. A worker that is `Gwaiting` for 80% is bottlenecked on something else (usually channel input).

### Worked: identifying a channel bottleneck

A team's parallel renderer had 8 workers but trace showed:

- Worker time: 30% running, 70% in `Gwaiting` on `chan recv`.
- Producer goroutine: 95% running, fully saturating one P.

Diagnosis: the producer was the bottleneck. Workers were idle waiting for input. The "parallel" design was actually one-CPU-bound.

Resolution: the producer was reading a file row-by-row and copying each row. Replaced with `bufio.Reader.ReadSlice` to avoid copies; saturated 4 cores instead of 1. Throughput rose 4×.

The trace told us what to fix. Without it, the team might have added more workers (which would not have helped).

---

## Appendix N: extended deep-dive — benchstat in detail

`benchstat` is the canonical tool for comparing benchmarks. Install with `go install golang.org/x/perf/cmd/benchstat@latest`.

### A typical invocation

```
go test -bench=. -count=20 -cpu=1,2,4,8 > old.txt
# ... change code ...
go test -bench=. -count=20 -cpu=1,2,4,8 > new.txt
benchstat old.txt new.txt
```

### Reading the output

```
                            │   old.txt    │              new.txt               │
                            │    sec/op    │   sec/op     vs base               │
ParallelMap/N1k-8              25.1µ ± 2%   12.8µ ± 1%  -49.0% (p=0.000 n=20)
ParallelMap/N10k-8             254µ  ± 2%   135µ  ± 2%  -46.9% (p=0.000 n=20)
ParallelMap/N100k-8           2.55m  ± 1%   1.36m ± 2%  -46.7% (p=0.000 n=20)
geomean                        253µ          133µ        -47.6%
```

Key columns:

- `sec/op`: median time per op, with confidence interval.
- `vs base`: percent change.
- `p`: Welch's t-test p-value. p < 0.05 means the change is statistically significant.
- `n`: number of measurements (`-count`).

### What to look for

- **Consistent direction**: if some sizes are faster and others slower, the change is workload-sensitive. Investigate.
- **Significant p**: insignificant changes are noise, not improvement.
- **Reasonable variance** (the `± X%`): high variance (>10%) means the machine is noisy or the benchmark is bad.
- **Geomean**: a single number to summarise; useful for headlines but never the whole story.

### Anti-patterns in `benchstat` reports

- Cherry-picking: showing the one benchmark that improved without showing the ones that regressed.
- Bench-shopping: writing a benchmark designed to show the change in a flattering light.
- Ignoring `p`: claiming 3% improvement when `p = 0.4`.

A senior reviewer checks all benchmarks, not just the headline; verifies `p`; and looks at variance.

---

## Appendix O: extended deep-dive — GOMAXPROCS in container environments

In a Docker or Kubernetes pod, `runtime.NumCPU()` historically returns the host CPU count, not the cgroup quota. So a pod with `cpu: 2` on an 8-CPU node ran with `GOMAXPROCS=8`, scheduling 8 Ps onto 2 CPUs. The result: each P-quantum was tiny, scheduler overhead spiked, throughput dropped.

### Manifestations

- p99 latency higher than p99 on the same code with `GOMAXPROCS=2`.
- High `runtime.findrunnable` in CPU profile.
- Many short bursts of CPU activity interleaved with kernel scheduler wait.

### Fixes

1. **Set `GOMAXPROCS` explicitly** from a config:

   ```go
   if v := os.Getenv("GOMAXPROCS"); v != "" {
       if n, err := strconv.Atoi(v); err == nil {
           runtime.GOMAXPROCS(n)
       }
   }
   ```

2. **Use `automaxprocs`** (`go.uber.org/automaxprocs`): this library reads the cgroup quota and sets `GOMAXPROCS` accordingly. Until Go's built-in support matures, this is a common dependency.
3. **Upgrade to Go 1.22+**: starting Go 1.22 the runtime is cgroup-aware.

### Side note: hyperthreading and `GOMAXPROCS`

On Intel CPUs with hyperthreading, 2 "logical CPUs" share one physical core. `runtime.NumCPU()` reports the logical count; `GOMAXPROCS` defaults to it. For CPU-bound workloads, this can hurt: 2 Ps fighting for one physical core perform worse than 1 P fully using it.

Some teams set `GOMAXPROCS` to half the logical count for pure CPU work. Most teams leave it alone. Senior engineers measure both and pick the winner per workload.

---

## Appendix P: extended deep-dive — GC tuning under concurrency

The Go GC is a concurrent mark-and-sweep collector with:

- A trigger heap size (`GOGC`, default 100, meaning collect when the live heap doubles).
- A pacer that targets a fixed CPU share for GC.
- Concurrent marking that runs on application goroutines (a small fraction of mark work is done by application goroutines via "assist credit").

### Concurrency interactions

- High allocation rate from many goroutines triggers GC more often.
- High live-heap from many goroutines (each keeping per-worker state) raises the trigger.
- GC assist can steal cycles from application goroutines under pressure; this shows up as `runtime.gcDrain*` in CPU profiles.

### Tuning levers

- `GOGC=200` (default *2): less frequent GC at the cost of higher memory.
- `GOGC=50`: more frequent GC at the cost of more CPU spent in GC.
- `GOMEMLIMIT` (Go 1.19+): a soft cap on total memory; the GC runs more aggressively as you approach the limit, preventing OOM.
- `debug.SetGCPercent`, `debug.SetMemoryLimit`: runtime equivalents.

### How concurrency affects choice

A service that fan-outs and allocates per item is *more sensitive* to GC tuning than a sequential service. Senior engineers benchmark with `GOGC=20` (aggressive) and `GOGC=400` (relaxed) to see whether the concurrent version is paying excessive GC cost.

---

## Appendix Q: deep-dive — channel select cost

A `select` with multiple cases has higher overhead than a single channel op. The runtime evaluates each case, ordering them randomly, and may park on multiple wait queues.

```go
select {
case ch1 <- x:
case ch2 <- x:
case <-ctx.Done():
}
```

This costs ~150–300 ns even uncontended. A two-case select on hot channels is fine. A 10-case select in a tight loop is expensive.

### Common pattern: ctx cancellation

```go
select {
case ch <- item:
case <-ctx.Done():
    return ctx.Err()
}
```

This is the right idiom. The overhead pays for cancellability. Do not avoid it for perf.

### Anti-pattern: select for state machine

```go
for {
    select {
    case x := <-input:
        // ...
    case <-timer.C:
        // ...
    case <-ctx.Done():
        return
    }
}
```

Acceptable. But if `input` is hot and timer is rare, the select cost is paid on every input. A separate timer goroutine sending on a dedicated channel avoids the multi-case cost — at the price of an extra goroutine. Measure both.

---

## Appendix R: deep-dive — `sync.Map` vs alternatives

`sync.Map` is *not* a general-purpose concurrent map. The documentation is explicit:

> The Map type is optimized for two common use cases:
> 1) when the entry for a given key is only ever written once but read many times, as in caches that only grow,
> 2) when multiple goroutines read, write, and overwrite entries for disjoint sets of keys.

For other workloads — many writers, broad key set — a mutex-protected `map` is usually faster.

### When `sync.Map` wins

- A cache with stable keys after warmup.
- A registry where each key has a single writer.

### When `sync.Map` loses

- Frequent writes across all keys.
- Many cores fighting over the same keys.
- Need for iteration or size queries.

### Senior pattern

Start with a `sync.Mutex` + `map`. Benchmark. Switch to `sync.Map` only if the benchmark shows a meaningful win for *your* access pattern.

---

## Appendix S: deep-dive — when concurrency actually wins

To balance the document, here are the cases where concurrency clearly wins. A senior engineer should recognise these too.

1. **I/O fan-out to independent endpoints.** Network-bound calls overlap freely.
2. **Embarrassingly parallel CPU work with >>1 µs per item.** Image processing, hash, compression.
3. **Pipelining with naturally rate-matched stages.** Each stage saturates a different resource (CPU, disk, network).
4. **Bulk processing with batched coordination.** Coordination cost amortised over batches.
5. **Concurrent I/O for streaming.** A goroutine per long-lived connection in a low-load server.
6. **Concurrent map-reduce on big data.** When the data is in RAM and the reduction is associative.

In all of these, the work is large compared to coordination, the items are independent, and the bottleneck is parallelisable. When all three hold, concurrency wins decisively.

---

## Appendix T: deep-dive — the "context-switch tax"

A famous internal Google diagram (variously attributed) shows the cost of various operations. For CPU-bound concurrent code, the relevant number is roughly:

```
goroutine switch: ~200 ns
useful work per switch: needs to be > 200 ns to break even
```

If your "useful work" is iterating one item of a slice (10 ns), the tax is 20×. You lose.

If your "useful work" is a function that does 100 µs of computation, the tax is 0.2%. You win.

The lesson is to *increase the granularity* of work-per-goroutine until the tax is negligible. This is why batching is the most common single fix for "my parallel code is slow."

---

## Appendix U: more on Amdahl, with diagrams

Amdahl's law:

```
                1
S(N) = -------------------
        (1 - p) + (p / N)
```

Plotted as `N` grows, `S(N)` asymptotes to `1 / (1 - p)`. For `p = 0.9` the asymptote is 10×; for `p = 0.99` it is 100×.

What this means in practice:

- A workload that is 50% serial can never go faster than 2× regardless of cores.
- A workload that is 90% serial can never go faster than 1.11×.
- A workload that is 1% serial caps at 100×.

The lesson: find the serial fraction and reduce it before adding cores. A 95% parallel workload at 16 cores gets 9.1×. Reducing serial to 99% gets 13.9×. *Reducing serial fraction is often higher leverage than adding cores.*

### Diagrams

```
N      p=0.5    p=0.9    p=0.99   p=0.999
1      1.0      1.0      1.0      1.0
2      1.33     1.82     1.98     1.998
4      1.60     3.08     3.88     3.988
8      1.78     4.71     7.48     7.94
16     1.88     6.40     13.91    15.76
32     1.94     7.80     24.43    30.62
64     1.97     8.77     39.26    57.06
128    1.98     9.34     56.39    101.6
infty  2.0      10.0     100.0    1000.0
```

A senior engineer looks at this table mentally before adding cores. "Is my workload above 99% parallel? If not, going beyond 16 cores is wasted."

---

## Appendix V: deep-dive — Go-specific Amdahl pitfalls

In Go, the serial fraction is often *invisible*. Three common hidden serial fractions:

### 1. The fan-out producer

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items { // serial loop
    item := item
    g.Go(func() error { ... })
}
return g.Wait()
```

The `for` loop iterates serially. If you have 1 million items and the goroutine-spawn cost is 1 µs, the producer takes 1 second *before any work starts*. Workers finish quickly; the producer is the wall time.

Fix: chunk the input, spawn a fixed number of goroutines each iterating its own chunk.

### 2. The fan-in aggregator

```go
out := make(chan Result, len(items))
for _, item := range items {
    item := item
    go func() { out <- process(item) }()
}
results := make([]Result, 0, len(items))
for range items {
    results = append(results, <-out)
}
```

The aggregator is serial — one goroutine reading the channel. If each `process` is 100 µs and there are 1 M items, the aggregator runs 1 M times per 100 µs = 10000 ns per receive. If channel recv is ~50 ns, fine; but if any iteration of the aggregator does meaningful work, it becomes the bottleneck.

Fix: write to indexed slice; no aggregator needed.

### 3. The closing channel

```go
close(ch)
for x := range ch { /* ... */ } // drains residue
```

If the channel was used to fan-out, the residue drain is serial. Make sure the residue is small (no buffered items left).

---

## Appendix W: deep-dive — the limits of `errgroup`

`errgroup` is the workhorse of structured concurrency in Go. It is not free.

### Costs

- Each `Go` call spawns a goroutine. With `SetLimit`, it blocks the caller if the pool is full.
- The internal mutex (`g.errOnce`, `g.cancel`) protects error and cancel state. Uncontended cost is low; contended (when many workers complete at once) is higher.
- `Wait` waits for all spawned goroutines. If any errored, the first error is returned and the context is cancelled.

### When `errgroup` is overkill

For a simple "fan out to a fixed number of workers, all must succeed":

```go
var wg sync.WaitGroup
results := make([]Result, len(items))
errs := make([]error, len(items))
for i, item := range items {
    i, item := i, item
    wg.Add(1)
    go func() {
        defer wg.Done()
        results[i], errs[i] = process(item)
    }()
}
wg.Wait()
```

This is sometimes faster than `errgroup` because there is no shared error/cancel state. The caller decides how to combine errors. The tradeoff is no "first error cancels" behaviour; if you do not need it, skip `errgroup`.

### When `errgroup` is right

- Fan-out where any failure should cancel the rest.
- Limited concurrency via `SetLimit`.
- Context propagation built in.

For everything else, plain `sync.WaitGroup` is often clearer and slightly faster.

---

## Appendix X: deep-dive — building a perf-friendly mental model

A senior engineer carries a *mental model* of a Go program's performance behaviour. Here is a sketch:

1. **CPU**: each P runs one goroutine at a time. Total CPU work is divided across Ps.
2. **Memory**: allocations come from per-P mcaches; GC scans the live heap; pauses are bounded by Go's pacer.
3. **Synchronisation**: mutex/chan ops park goroutines; parks cost ~1 µs.
4. **I/O**: network syscalls park goroutines and detach the P (so other goroutines run on the same M).
5. **GC**: concurrent, with brief STW pauses. Frequency tied to allocation rate.

A change to the code can affect any of these. A senior reviewer predicts which axis a change moves and verifies with a measurement.

For example: "We added `sync.Pool` for these objects. What axis moved?"

- Allocator pressure: down (fewer allocations).
- CPU: up slightly (pool overhead).
- Memory: up (live objects in pool).
- GC: down (fewer scans).

Net positive *only if* allocator pressure was the limiting factor. If it was not, `sync.Pool` adds cost without saving anything.

---

## Appendix Y: deep-dive — a sample senior-level review comment

A real-quality review comment for a "make it parallel" PR:

> Thanks for the PR. A few things to clear up before I can approve:
>
> 1. The benchmark in `bench_test.go` runs at `len(items) = 1000` with item cost ~200 ns. Multiply: 200 µs total work. That is too small to benefit from 8-way parallelism after goroutine overhead — I would expect ~30% gain at best, and you are reporting 45%. Can you verify with `-count=20` and `benchstat`? My suspicion is your run-to-run variance is high enough to flatter the change.
> 2. The `chan Item` send/recv inside the worker loop is on the critical path. Each op costs ~50 ns on this hardware; for items at 200 ns of work, that is 25% overhead. Have you tried batching (send slices of 100 instead of single items)?
> 3. `pprof` for the parallel version shows 4% of CPU in `runtime.findrunnable` and 2% in `runtime.semacquire`. That is scheduler overhead from the workers blocking and being woken. A bounded worker pool reading from a slice with an atomic index would avoid this.
> 4. The PR description does not state the production input distribution. The synthetic benchmark uses uniform random; production data is skewed (some items 10× larger than median). Can you re-benchmark with skewed input?
> 5. The new code adds 80 lines including a custom result-collector goroutine. If the speedup is genuine, can we simplify? For example, write results to `out[i]` directly and skip the collector.
>
> If after addressing 1–4 the speedup is real, I am happy to discuss the right architecture for 5. If 1–4 reveal the change is noise, let's revert.

This comment is critical without being hostile, specific without being pedantic, and educational. Senior reviewing looks like this.

---

## Appendix Z: deep-dive — when to scale horizontally instead

Concurrency-in-process and horizontal scaling are different tools. They solve different problems.

### In-process concurrency

- Handles parallelisable work *within a single request*.
- Improves single-request latency for fan-out scenarios.
- Bounded by the size of the box (cores, memory, network).
- Costs: complexity, GC pressure, contention.

### Horizontal scaling

- Handles *more requests in parallel* across many instances.
- Improves total throughput.
- Bounded by the cost of running additional instances and the coordination overhead.
- Costs: deployment complexity, state coordination, infrastructure cost.

### When to choose which

- If each request is small but you have many: scale horizontally. The simplest service code wins.
- If each request is big and benefits from parallel internal work: in-process concurrency.
- If you are not sure: scale horizontally first. It is operationally simpler and exposes fewer concurrency bugs.

### A worth-quoting principle

> "Concurrency is hard to get right; horizontal scaling is easier to get right. Use horizontal scaling first." — paraphrasing a long-time Go-on-cloud practitioner.

Senior engineers know this. Junior developers reach for concurrency because they have heard "Go is concurrent." Senior engineers reach for the simplest tool that solves the problem.

---

## Appendix AA: senior heuristics summarised

A printable card:

1. **No measurement, no merge.**
2. **Sequential first.** Optimise the sequential version before adding goroutines.
3. **Granularity matters.** Per-item work must be >> per-goroutine overhead.
4. **Bound your pools.** Never `go` per item except in I/O fan-out.
5. **Avoid false sharing.** Pad hot per-worker fields to cache lines.
6. **Skip RWMutex for short reads.** Mutex is faster.
7. **Skip Pool for small objects.** Allocator is faster.
8. **Profile, then code.** Read pprof; predict the change; verify after.
9. **benchstat or it didn't happen.** Statistical significance, not anecdote.
10. **Simpler is faster** at the maintenance layer if not the runtime layer.

---

## Appendix BB: a thought experiment — the 1 ns goroutine

Imagine Go had a goroutine spawn cost of 1 ns instead of 1 µs. Would every loop benefit from concurrency?

No. Three reasons:

1. **Cache lines still bounce.** False sharing is independent of goroutine cost.
2. **Cores are still limited.** 8 cores cannot do 16-way work faster than 8-way.
3. **Coordination still costs.** Channels and mutexes do not get cheaper because spawn is cheap.

So even in a fantasy runtime, blindly parallelising is wrong. The discipline of measurement remains.

---

## Appendix CC: a senior-level recipe for a perf investigation

When asked "why is service X slow?":

1. **Reproduce locally.** Use a benchmark or load generator that matches production.
2. **Measure baseline.** Get current p50/p99/throughput/CPU/memory.
3. **Run pprof.** CPU profile under load. Identify the top 10 functions.
4. **Run trace.** Look for idle Ps, blocking, GC pauses.
5. **Hypothesise.** Pick one likely cause based on profile + trace.
6. **Experiment.** Make a small targeted change.
7. **Re-measure.** Did p50/p99/throughput move? Statistically significant?
8. **Iterate.** Move to the next hypothesis.
9. **Document.** Write up what was changed and what improved.

Each step is *driven by data*. Senior engineers do not "have a feeling" about where to optimise; they have a profile.

---

## Appendix DD: the danger of microbenchmarks

A microbenchmark measures one function in isolation. It is useful but limited.

### What microbenchmarks miss

- Cache pressure from the rest of the program.
- GC overhead from sibling allocations.
- Scheduler interactions with other goroutines.
- Network/disk latency.
- Cold-start effects.

A function that benchmarks at 100 ns/op in `testing.B` may run at 500 ns/op in production because the CPU's caches are not warm with its data.

### When microbenchmarks lie

- Two implementations differ by 10% in microbench, but in production the difference is 0% because both are dominated by an upstream bottleneck.
- An optimisation cuts the function's cost by 50% but increases allocations, so GC eats the savings.
- The function is called once per request; microbench shows N iterations of tight-loop calls that prime caches in a way real traffic does not.

### Beyond microbench

- Macrobench: end-to-end benchmarks measuring the whole system under realistic load.
- Production canaries: deploy to a fraction of traffic and observe.
- A/B tests on real traffic for performance.

Senior engineers do *both*. Microbench tells you whether a function is faster in isolation; macrobench tells you whether the system is faster overall.

---

## Appendix EE: a thought-piece — the cost of complexity

Every concurrent design has a complexity cost. Some heuristics:

1. **A `go` keyword is a maintenance event.** Every goroutine outlives its `go` call; its lifetime, termination, and error handling must be reasoned about.
2. **A channel is a contract.** Sender and receiver must agree on close, capacity, and ownership.
3. **A mutex is a constraint.** Every code path through the locked region must hold the lock; future maintainers must respect this.
4. **An atomic is a synchronisation barrier.** It interacts with the memory model in ways most engineers do not fully grasp.

Each of these has documentation, review, and bug-fix cost. A team that has 1000 lines of concurrent code spends *more* time on it per line than on 1000 lines of straight-line code. If the concurrent code does not pay for itself in performance, it is pure cost.

Senior engineers weigh this. A 5% speedup that doubles the complexity of a module is usually a bad trade. A 5× speedup may be worth it.

---

## Appendix FF: closing reflection — what "premature optimisation" really means

The phrase is overused and misused. To set the record straight:

- It does not mean "no optimisation." It means *unmeasured* optimisation.
- It does not mean "write slow code." It means "write clear code, then measure, then optimise the parts that matter."
- It does not mean "concurrency is bad." It means "do not reach for concurrency before measuring whether it helps."

The senior engineer is the steward of measurement-first culture. By the standards of this document, the senior engineer:

- Has profiles open during architecture discussions.
- Has `benchstat` results in PR descriptions.
- Has Amdahl estimates on napkins.
- Has reverts ready for changes that did not pay off.
- Has built the team's habits of measurement.

When you are doing this, you are a senior engineer. When you are not, no matter your title, you are an apprentice. The next file extends this thinking to professional contexts: SLOs, organisational decisions, when the right answer is "add another instance" rather than "add another goroutine."

---

## Appendix GG: extended worked example — parallelising a JSON parser

A real case from a streaming-data team. They needed to parse 10 GB/hour of JSON events. The serial parser took 30 minutes per GB; a "parallel" version was proposed.

### Serial baseline

```go
func parseFile(r io.Reader) ([]Event, error) {
    dec := json.NewDecoder(r)
    var events []Event
    for {
        var ev Event
        if err := dec.Decode(&ev); err == io.EOF {
            return events, nil
        } else if err != nil {
            return nil, err
        }
        events = append(events, ev)
    }
}
```

Throughput: 30 MB/s.

### Parallel attempt 1: fan out the decoder

```go
func parseFileParallel(r io.Reader) ([]Event, error) {
    rawCh := make(chan []byte, 1024)
    var wg sync.WaitGroup
    mu := sync.Mutex{}
    var events []Event

    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for raw := range rawCh {
                var ev Event
                if err := json.Unmarshal(raw, &ev); err != nil {
                    continue
                }
                mu.Lock()
                events = append(events, ev)
                mu.Unlock()
            }
        }()
    }

    // Producer: split by newlines (JSON Lines format)
    sc := bufio.NewScanner(r)
    for sc.Scan() {
        rawCh <- append([]byte(nil), sc.Bytes()...)
    }
    close(rawCh)
    wg.Wait()
    return events, sc.Err()
}
```

Throughput: 40 MB/s. A 33% improvement, but disappointing for 8 cores.

Why? Producer was CPU-bound copying bytes for the channel send; output mutex was contended; final slice append was serialised.

### Parallel attempt 2: chunked input, per-worker output

```go
func parseFileParallelV2(r io.Reader) ([]Event, error) {
    type Chunk struct {
        Lines [][]byte
    }
    chunkCh := make(chan Chunk, 16)
    perWorker := make([][]Event, 8)
    var wg sync.WaitGroup

    for i := 0; i < 8; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for chunk := range chunkCh {
                for _, raw := range chunk.Lines {
                    var ev Event
                    if err := json.Unmarshal(raw, &ev); err != nil {
                        continue
                    }
                    perWorker[i] = append(perWorker[i], ev)
                }
            }
        }()
    }

    sc := bufio.NewScanner(r)
    chunk := Chunk{Lines: make([][]byte, 0, 256)}
    for sc.Scan() {
        line := make([]byte, len(sc.Bytes()))
        copy(line, sc.Bytes())
        chunk.Lines = append(chunk.Lines, line)
        if len(chunk.Lines) >= cap(chunk.Lines) {
            chunkCh <- chunk
            chunk = Chunk{Lines: make([][]byte, 0, 256)}
        }
    }
    if len(chunk.Lines) > 0 {
        chunkCh <- chunk
    }
    close(chunkCh)
    wg.Wait()

    total := 0
    for _, w := range perWorker {
        total += len(w)
    }
    events := make([]Event, 0, total)
    for _, w := range perWorker {
        events = append(events, w...)
    }
    return events, sc.Err()
}
```

Throughput: 180 MB/s. 6× the serial version on 8 cores.

What changed:

- Batched input (256 lines per send) amortised channel cost.
- Per-worker output slices eliminated mutex contention.
- Final merge is O(N) but is fast because it is a simple slice copy.

### Lessons

- Batching is almost always the biggest single win.
- Per-worker output slices are cheap and avoid contention.
- The producer is often the actual bottleneck; profile it explicitly.

A senior engineer would have suggested batching on the first review. The team learned, and the next pipeline they built started batched.

---

## Appendix HH: a senior interview question, rehearsed

> Interviewer: "Walk me through how you would decide whether to parallelise a function that takes 5 ms today."
>
> Candidate: "First, I'd ask what the goal is — lower latency? Higher throughput? — and what the call rate is. If the function is called once a minute, a 5 ms optimisation is irrelevant. If it is called 1000 times per second per pod, it's a real cost.
>
> Then I'd profile the function. Where are those 5 ms going? Is it CPU? I/O? Allocation? If most of the time is in a single tight loop, the loop is a parallelisation candidate. If it's a dozen function calls, each taking 0.4 ms, parallelism is awkward.
>
> For a CPU-bound loop, I'd estimate Amdahl. If the loop is 80% of the time, max speedup at 4 cores is `1 / (0.2 + 0.8/4) = 2.5×`. Account for overhead and the realistic number is ~2.0×. That makes the function 2.5 ms — a useful gain if it scales by the call rate.
>
> Then I'd write a benchmark: serial and parallel, multiple sizes, with `-count=20 -cpu=1,2,4,8`. I'd run `benchstat`. If the win is significant and matches the Amdahl estimate, I'd consider merging. If not, I'd debug — usually it's overhead or false sharing.
>
> Before merging, I'd add a benchmark to the CI suite so future changes do not regress this work. I'd also check the macrobench — what's the end-to-end latency change with the new code? Sometimes the function got faster but the surrounding system got the same, because the function wasn't the bottleneck."

This is a senior-level answer: specific, data-driven, with awareness of tradeoffs.

---

## Appendix II: closing word

A senior engineer is judged not by the cleverness of their optimisations but by the *clarity* of the systems they leave behind. The premature-optimisation principle is, fundamentally, a humility principle: it says "I do not know what is slow without measuring; therefore I will not optimise until I have measured."

When you have internalised this, you write less concurrent code, your code is faster on average (because the rare concurrency you add is justified), and your team learns to think in numbers. That is the durable contribution.

The next document, `professional.md`, takes this stance into the production context: SLOs, capacity planning, when an optimisation pays for itself across the fleet, and the broader question of when concurrency is the right *architectural* answer versus when horizontal scaling is.

---

## Appendix JJ: a deeper look — the cost of locks vs lock-free

Lock-free data structures are advertised as "no locks, therefore faster." This is often *false* for a Go program. Reasons:

### Lock-free is not contention-free

A lock-free queue using atomic CAS still pings the cache line of the head/tail pointer across cores. Under contention, the CAS loop retries; each retry is a cache invalidation. The wall-clock cost can be similar to a mutex.

### Lock-free is harder to read

A `sync.Mutex` is one primitive that any Go developer recognises. A lock-free queue is a dozen `atomic.Load`, `atomic.Store`, `atomic.CompareAndSwap` calls interspersed with memory-order reasoning. The maintenance cost is significantly higher.

### Lock-free still allocates

Many lock-free designs allocate per-op for "hazard pointers" or epoch-based reclamation. The allocator cost can exceed the lock cost.

### When lock-free actually wins

- Extreme write throughput (>10M ops/sec) on a single contended structure.
- Hard latency bounds that cannot tolerate mutex parking.
- Lock-free MPMC queues in OS kernels, audio processing, real-time control.

For a typical Go service, none of these apply. The right primitive is `sync.Mutex` for shared state, `chan` for handoff, `atomic` for single-counter cases.

### Senior heuristic

If a teammate proposes a lock-free data structure, ask:

1. Did you benchmark the locked version?
2. What is the mutex contention as a fraction of CPU?
3. What is the throughput requirement?
4. Have you considered sharding instead?

In 90% of cases, sharding or a different design beats lock-free. In the remaining 10%, the team should use a well-reviewed library (e.g. `golang.org/x/exp/...` or proven third-party code), not roll their own.

---

## Appendix KK: deep-dive — busy-wait vs park-on-contention

A `sync.Mutex` parks the goroutine on contention. An "active spin lock" (rare in Go; some atomic-based primitives do it implicitly) busy-loops until the lock is free.

### Tradeoffs

- Busy-wait: low latency to acquire if the lock is briefly held; wastes CPU; bad for many goroutines per P.
- Park: 1 µs overhead per park-wake cycle; frees CPU for other goroutines; good for many goroutines per P.

Go's `sync.Mutex` does a *brief* active spin (a few tens of iterations) before parking, optimising for the case where the lock is held very briefly. After that, it parks. This is the best of both worlds for most workloads.

### When this matters

If your workload has hundreds of goroutines per P and the lock is highly contended, parking is essential — busy-waiting would starve other goroutines. If your workload has 1 goroutine per P and the lock is briefly held, busy-waiting is slightly faster. Go's adaptive strategy handles both.

### Avoid manual spin loops

```go
for !atomic.CompareAndSwapInt32(&lock, 0, 1) {
    // busy-wait
}
```

This is almost always wrong. It hogs the P, starves other goroutines, and rarely outperforms `sync.Mutex`. The exception is a *very short* critical section in a high-throughput specialised primitive (e.g. an in-process lock-free queue), and even then it should include a backoff strategy.

---

## Appendix LL: deep-dive — memory model and happens-before

Go's memory model defines when one goroutine sees another's writes. The key relationships:

- Within a goroutine, source order = visible order.
- Across goroutines, you need a synchronisation primitive (mutex unlock-then-lock, channel send-then-recv, atomic, `sync.Once`) to establish "happens-before."
- Without synchronisation, reads can return stale, torn, or impossible values.

### Senior implications

A common premature optimisation: replacing a mutex-protected counter with a *plain* `int64` "because I only read it occasionally and don't mind some staleness." This is a data race. The race detector will catch it. The compiler is allowed to reorder, the CPU is allowed to reorder, and you can see torn values on 32-bit platforms.

The correct minimal fix is `atomic.Int64` (since Go 1.19) or `atomic.LoadInt64` / `atomic.AddInt64`. These ensure atomicity and provide the necessary memory ordering.

### Counter pattern, the right way

```go
var requests atomic.Int64

// Writer
requests.Add(1)

// Reader
count := requests.Load()
```

The atomic operations are roughly 1 ns each — cheaper than the mutex they replace, *and* correct. This is one of the rare cases where the "fast" version is also the obvious one.

### Avoid manual race-prone counters

```go
var counter int64

func increment() {
    counter++ // RACE if multiple goroutines call this
}
```

The race detector will flag this. Always use `atomic` for shared scalars; the cost is negligible.

---

## Appendix MM: extended deep-dive — fan-out/fan-in patterns

The canonical concurrent pattern is fan-out (one producer, many workers) fan-in (one aggregator).

### Simple variant

```go
func fanOutFanIn(items []int) []int {
    workers := 8
    work := make(chan int)
    out := make(chan int)

    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for x := range work {
                out <- process(x)
            }
        }()
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    go func() {
        for _, item := range items {
            work <- item
        }
        close(work)
    }()

    results := make([]int, 0, len(items))
    for r := range out {
        results = append(results, r)
    }
    return results
}
```

This works. It is also full of overhead: every item costs 2 channel ops (work and out), worker count is fixed, ordering is lost.

### Optimisations to consider

1. **Preserve order with indexed slice.** Drop the `out` channel; have workers write directly to `results[i]`.
2. **Batch input.** Send slices of items.
3. **Eliminate the producer goroutine.** Have workers pull from an atomic index into the slice.

A simpler structure:

```go
func fanOutFanInV2(items []int) []int {
    workers := runtime.GOMAXPROCS(0)
    results := make([]int, len(items))
    var idx atomic.Int64
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                i := idx.Add(1) - 1
                if int(i) >= len(items) {
                    return
                }
                results[i] = process(items[i])
            }
        }()
    }
    wg.Wait()
    return results
}
```

Compared to the channel-based version:

- 50× fewer channel ops.
- No producer goroutine.
- Order preserved.
- Same parallelism.

This is the senior-grade default for embarrassingly parallel work.

### When channels are still right

- Heterogeneous workers (each consumes from a different chan).
- Backpressure must propagate (a slow consumer slows the producer).
- Items arrive asynchronously (e.g. from a network stream).

For the simple "process a slice in parallel" case, channels are overkill.

---

## Appendix NN: extended deep-dive — pipelines

A pipeline is a chain of stages, each a goroutine or pool, connected by channels.

```
input -> [stage1] -> [stage2] -> [stage3] -> output
```

### When pipelines win

- Stages saturate different resources (CPU, disk, network).
- Each stage is well-balanced; no straggler.
- The cost of channel handoff is small relative to per-stage work.

### When pipelines lose

- One stage is much slower than the others; the rest idle.
- Per-item work is small; channel cost dominates.
- The pipeline shape is unstable (some inputs go through differently).

### Stage-balance analysis

In a 3-stage pipeline with stages taking 10/100/10 µs, the throughput is bounded by the slowest stage = 100 µs per item. Stages 1 and 3 are idle 90% of the time. Solutions:

- Add 10 workers to stage 2 (now 10 µs effective per item, balanced).
- Combine stages 1 and 3 with stage 2 if the channel cost is significant.

### Channel sizing in pipelines

Buffered channels between stages "decouple" them, but only briefly. A 100-deep buffer absorbs 100 items of mismatch; after that, backpressure asserts. Larger buffers delay the assertion at the cost of memory and latency.

The right buffer size is rarely "as big as possible." It is "just enough to absorb short-term jitter." Often 1–16 is the right number.

---

## Appendix OO: extended deep-dive — backpressure done right

Backpressure is the signal "slow down, I'm full." Done right, it prevents OOM and keeps latency bounded.

### Done wrong

```go
ch := make(chan Item, 1_000_000) // huge buffer
go producer(ch)
go slowConsumer(ch)
```

This works until the producer fills the buffer. Then it does one of:

- Blocks: latency for upstream callers spikes.
- OOMs: memory grows until the process is killed.
- Drops: items lost without notice.

### Done right

A bounded buffer with explicit handling:

```go
ch := make(chan Item, 64)
go producer(ch)
go consumer(ch)
```

The producer blocks on send when the buffer fills. This back-pressures upstream. The system runs at the rate of the slowest stage.

For HTTP servers, backpressure can mean *returning 503* when the in-flight queue is full, rather than blocking the request. The client can retry with backoff. The server stays healthy.

### Senior heuristic

Buffers should be sized to absorb *expected* jitter, not unbounded surges. If a buffer is "always full," it is hiding a throughput mismatch — fix the slower stage.

---

## Appendix PP: extended deep-dive — context cancellation patterns

`context.Context` carries cancellation, deadlines, and metadata. Misuse leads to leaks.

### Patterns to know

1. **Per-request context.** HTTP handlers receive `r.Context()` which is cancelled when the client disconnects. All goroutines spawned should derive from this context.
2. **Timeout.** `ctx, cancel := context.WithTimeout(parent, 5*time.Second)` ensures the work finishes (or is cancelled) within 5s.
3. **Cancel chain.** Always `defer cancel()` to release resources when the parent is done.
4. **Worker pool cancellation.** When the context is cancelled, all workers should exit promptly.

### Anti-patterns

1. **Spawning without context.** `go func() { /* no context */ }()` — the goroutine cannot be cancelled.
2. **Ignoring `ctx.Done()`.** Worker loops that do not check for cancellation will keep running after the context is done.
3. **Background context for request work.** Using `context.Background()` for request-scoped work defeats cancellation.

### Senior pattern

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
    defer cancel()

    g, gctx := errgroup.WithContext(ctx)
    for _, item := range items {
        item := item
        g.Go(func() error {
            return work(gctx, item)
        })
    }
    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), 500)
    }
}
```

All goroutines are cancellable, bounded by timeout, and joined before the handler returns. No leak.

---

## Appendix QQ: extended deep-dive — error propagation in fan-out

When 8 workers process 100 items and 3 fail, what should the caller see?

### Option 1: first error wins

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item
    g.Go(func() error { return work(ctx, item) })
}
return g.Wait()
```

`errgroup` returns the first error and cancels the rest. Other errors are discarded. Good when one failure means abort the whole batch.

### Option 2: collect all errors

```go
var wg sync.WaitGroup
errs := make([]error, len(items))
for i, item := range items {
    i, item := i, item
    wg.Add(1)
    go func() {
        defer wg.Done()
        errs[i] = work(item)
    }()
}
wg.Wait()
return errors.Join(errs...)
```

(`errors.Join` is Go 1.20+.) All errors are reported. Good when partial success matters.

### Option 3: per-item result + per-item error

```go
type Result struct {
    Item Item
    Out  Output
    Err  error
}

results := make([]Result, len(items))
// ... fill in via workers
return results
```

The caller decides what to do with each error. Most flexible, but more code.

### Senior choice

For batch APIs that are "all or nothing," use Option 1. For batch APIs that report partial success, use Option 2 or 3. The choice belongs in the API contract, not in the implementation.

---

## Appendix RR: deep-dive — testing concurrent code

A senior engineer writes tests that exercise the concurrent paths, not just the happy path.

### Race detector

`go test -race` is mandatory for any concurrent code. Run all tests with it in CI. The performance cost (10–20× slower) is fine for tests.

### Stress tests

```go
func TestConcurrentAccessStress(t *testing.T) {
    if testing.Short() {
        t.Skip("stress test")
    }
    m := NewMyMap()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 10000; j++ {
                m.Set(strconv.Itoa(i*10000+j), j)
                m.Get(strconv.Itoa(i*10000+j))
            }
        }()
    }
    wg.Wait()
}
```

Run with `-race -count=10`. Stress tests are not deterministic, but consistent failures expose bugs.

### Linearizability tests

For complex concurrent data structures, consider tools like `porcupine` (a Go linearisability checker) that verify the observed behaviour is equivalent to some serial order of operations.

### Goroutine leak tests

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Fails the test if any goroutine is still running after the test ends. Catches leaks early.

---

## Appendix SS: deep-dive — concurrency in benchmarks

Benchmarks themselves often run concurrent code. There are pitfalls.

### `b.RunParallel`

```go
func BenchmarkX(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            doWork()
        }
    })
}
```

This runs `doWork` from multiple goroutines simultaneously. Useful for measuring per-op cost under contention.

### `b.SetParallelism`

```go
func BenchmarkX(b *testing.B) {
    b.SetParallelism(4)
    b.RunParallel(...)
}
```

Sets the number of goroutines per `GOMAXPROCS` worker (default 1). Use this to measure scaling.

### Benchmark setup overhead

```go
func BenchmarkX(b *testing.B) {
    data := makeBigData() // outside the loop
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        process(data)
    }
}
```

`b.ResetTimer()` excludes setup from the measurement.

### Allocations

```go
func BenchmarkX(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = process()
    }
}
```

Reports allocations per op. Critical for memory-sensitive optimisations.

### Common bench mistakes

- Forgetting `b.ResetTimer` after setup.
- Letting the compiler dead-code-eliminate the result.
- Running on a busy machine.
- Conflating `-benchtime` with `-count`.

---

## Appendix TT: deep-dive — production observability for concurrency

In production, you need observability into concurrent behaviour. Key signals:

### Goroutine count

`runtime.NumGoroutine()` is cheap and informative. Track it over time. A monotonic rise indicates a leak. A spike under load might be expected; a spike under no load is a bug.

Expose via metrics:

```go
expvar.Publish("goroutines", expvar.Func(func() interface{} {
    return runtime.NumGoroutine()
}))
```

Or Prometheus:

```go
goroutines := prometheus.NewGaugeFunc(
    prometheus.GaugeOpts{Name: "go_goroutines"},
    func() float64 { return float64(runtime.NumGoroutine()) },
)
prometheus.MustRegister(goroutines)
```

### Heap profile

Expose `/debug/pprof/heap` for live heap snapshots. When investigating a memory leak or a regression, this is the first thing you grab.

### Mutex / block profile

Enable with:

```go
runtime.SetMutexProfileFraction(1)
runtime.SetBlockProfileRate(1)
```

Note that these have cost. Set them sparingly or only during investigations.

### Distributed traces

For inter-service concurrency, trace spans show fan-out and fan-in. A span tree with 5 parallel child spans of similar duration is well-balanced. A span tree where 1 child is 10× longer than its siblings has a straggler.

---

## Appendix UU: deep-dive — incident response involving concurrency

A service is slow. What do you do?

### Triage

1. **Is it down or just slow?** Different runbooks.
2. **Did a recent deploy change things?** If yes, roll back first, investigate later.
3. **Is the slowness uniform or tail-only?** Different causes.

### Investigation tools

1. **Live profile**: grab `/debug/pprof/profile?seconds=30` from a slow pod.
2. **Goroutine dump**: grab `/debug/pprof/goroutine?debug=2` for a stack trace of every goroutine.
3. **Heap snapshot**: grab `/debug/pprof/heap`.
4. **Trace**: grab `/debug/pprof/trace?seconds=10` for a scheduler view.

### Common concurrency-related incidents

- **Goroutine leak**: number grows over time, eventual OOM. Look at `goroutine?debug=2` for the dominant stack.
- **Lock contention spike**: requests piling up on a mutex. Look at mutex profile.
- **Deadlock**: all goroutines blocked. `goroutine?debug=2` shows the cycle.
- **Channel saturation**: producers blocked on send. Look at goroutine stacks for chan ops.
- **GC storm**: GC fraction rises above 20%. Look at heap and allocation profiles.

A senior responder uses these tools fluently. The team trains on them via game days — simulating incidents and practising the response.

---

## Appendix VV: an extended worked example — the leak that killed prod

A team's service crashed every ~48 hours from OOM. Investigation:

1. `goroutine?debug=2` showed 200,000 goroutines waiting on `chan recv`.
2. Each goroutine had a stack pointing into a function `processOrder`.
3. `processOrder` was supposed to terminate when the channel was closed.

Code:

```go
func processOrder(orderCh chan Order) {
    for order := range orderCh {
        // process
    }
}
```

The channel was created per request:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    orderCh := make(chan Order, 10)
    go processOrder(orderCh)
    // ... fill orderCh ...
    // BUG: never close(orderCh)
}
```

The handler never closed `orderCh`. The goroutine waited forever. Every request leaked one goroutine.

### Fix

```go
func handler(w http.ResponseWriter, r *http.Request) {
    orderCh := make(chan Order, 10)
    done := make(chan struct{})
    go func() {
        processOrder(orderCh)
        close(done)
    }()
    // ... fill orderCh ...
    close(orderCh)
    <-done
}
```

### Lessons

- Every channel owner is responsible for closing the channel.
- Every goroutine should be joinable from its spawner.
- Goroutine count should be monitored in production.

The team added a goroutine-count alert (alert when count > 10000), and a CI check using `go.uber.org/goleak`. No more leaks.

---

## Appendix WW: short essay — concurrency as a feature flag

Some teams treat concurrency as something you can turn on per workload. The pattern:

```go
type Config struct {
    Workers int
}

func Process(items []Item, cfg Config) {
    if cfg.Workers <= 1 {
        for _, item := range items {
            processOne(item)
        }
        return
    }
    // parallel impl with cfg.Workers
}
```

The default `Workers=1` runs serially. Operators tune up if profiling shows benefit. This is a *senior* pattern because:

1. It defaults to the simpler, more predictable path.
2. It allows benchmarking the parallel vs serial in production with a config change.
3. It avoids forcing concurrency on workloads where it does not help.

The cost is one if-statement and a configuration knob. The benefit is a system that adapts to its workload.

---

## Appendix XX: short essay — concurrency in microservices vs monoliths

In microservices, each service is a separate process. Concurrency within a service is bounded by the service's resource quota. Scaling across services is operational (more pods).

In monoliths, all work happens in one process. Concurrency is the only way to use multiple cores.

### The implication for "premature concurrency"

In a microservice, the cost of *one more service* (one more deployable unit) is real but understood: pod resource budget, deployment pipeline, etc. The cost of *one more goroutine pattern in the service* is invisible: it shows up as harder code review and occasional bugs.

In a monolith, both costs are inside the process. Engineers tend to reach for concurrency more, because that is the only knob.

Senior engineers in microservice environments more often answer "we need more throughput" with "let's scale to 4 pods" than with "let's add 4 workers." This is correct: horizontal scaling is operationally simpler and exposes fewer concurrency bugs.

In monolith environments, the answer is more often "let's profile and optimise the hot path." This is also correct: the monolith has a single resource budget, and concurrency is the lever.

The right answer depends on the environment, not on personal preference.

---

## Appendix YY: short essay — the social cost of optimisation theatre

A team that "optimises" without measuring imposes social costs:

- Every new contributor must understand the optimisations.
- Every refactor risks regressing one of the optimisations.
- Every bug requires considering "is this the optimisation interacting with X?"
- Every interview question becomes "tell me about the time you optimised."

A team that measures-first imposes different costs:

- Setting up benchmarks and CI is upfront work.
- Reverting unjustified optimisations is conversational work.
- Building the muscle of "profile first" takes a quarter or two.

The measure-first cost is paid once. The optimisation-theatre cost is paid forever. Senior engineers choose the one-time cost.

---

## Appendix ZZ: a final framework — the optimisation life cycle

Every optimisation goes through stages:

1. **Hypothesis.** "I think parallelising this will help."
2. **Estimate.** Amdahl analysis on a napkin.
3. **Benchmark.** Write the benchmark; run with `-count=20`.
4. **Profile.** `pprof` before and after.
5. **Implement.** The minimal change.
6. **Measure.** `benchstat` for statistical significance.
7. **Review.** Senior eyes on the diff and the data.
8. **Merge.** If the data justify, merge.
9. **Monitor.** Production metrics confirm the benefit.
10. **Document.** Add to the team's benchmark archive.
11. **Re-measure.** Quarterly check: is this still helping?
12. **Retire.** When no longer helping, remove.

Most teams skip steps 1, 2, 6, 9, 11, 12. Senior engineers refuse to skip any. The lifecycle is the discipline.

---

## Appendix AAA: a closing motto

> Profile, predict, parallelise.

Three words, in order. Senior engineers do not skip the first two. The result is code that is, on average, simpler than it would be without discipline, and faster than it would be with reflexive concurrency — because the rare concurrency in the codebase has been earned, measured, and reviewed.

---

## Appendix BBB: extended case — when sequential beat 32 goroutines

A team had a stats-aggregator service. It processed batches of 10000 records, each ~1 KB. They had a 32-worker pool aggregating into 32 partial maps, merged at the end.

Benchmark on dev laptop (16 cores): 8 ms/batch.
Production (2 vCPUs): 22 ms/batch.

The team's hypothesis: "we need more pods." Costing 16 pods × $50/mo = $800/mo per environment, across 5 environments = $4000/mo.

Senior engineer asked: "what does the profile show?"

The profile showed:

- 35% in `runtime.findrunnable` (scheduler overhead).
- 18% in `sync.(*Mutex).Lock` (final merge).
- 12% in map ops.
- ~35% in actual record processing.

Half the CPU was scheduler and locking overhead.

Senior engineer rewrote sequentially: one map, one goroutine, no merge.

Benchmark on dev: 11 ms/batch (1.4× slower than the 32-worker version *on the laptop*).
Production: 5 ms/batch (4.4× faster).

The team kept the simpler version, saved $4000/mo, and learned to benchmark in production-like environments.

### Lessons

- Laptop benchmarks lie when production has different CPU counts.
- Scheduler overhead can dominate at high goroutine counts on small CPU budgets.
- The simplest code often wins in constrained environments.

---

## Appendix CCC: extended case — `sync.Pool` for buffers

A team added `sync.Pool` for `[]byte` buffers in a hot allocation path.

```go
var bufPool = sync.Pool{
    New: func() interface{} { return make([]byte, 4096) },
}

func encode(x Encodable) []byte {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf)
    return x.AppendTo(buf[:0])
}
```

Wait, there is a bug: the buffer is returned to the pool, but the caller still uses the returned slice. After `Put`, another goroutine can `Get` the same buffer and overwrite the data.

### The fix

```go
func encode(x Encodable) []byte {
    buf := bufPool.Get().([]byte)
    out := x.AppendTo(buf[:0])
    result := make([]byte, len(out))
    copy(result, out)
    bufPool.Put(buf)
    return result
}
```

But now we are copying anyway. Did we save anything?

Benchmark: the original (no pool) allocates once per call (4 KB). The pooled version uses the pool buffer to *build* the result, then allocates `result` of the actual size (usually < 4 KB). Net allocation: same or slightly less. CPU: pool overhead added.

The pool was a wash or slightly negative for this workload.

### Senior reaction

"You added pool, didn't benchmark, and it has a bug. Remove the pool, write the benchmark, and revisit if allocation is actually the bottleneck."

The team removed the pool. Allocator was 2% of CPU, not worth optimising.

---

## Appendix DDD: extended case — `sync.RWMutex` regret

A team protected a configuration map with `sync.RWMutex`. Reads were hot (every request); writes were rare (config updates).

```go
type Config struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Config) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}
```

Reads dominate; surely RWMutex helps?

Benchmark: replacing with `sync.Mutex` gave a 12% throughput improvement under load.

Why?

- RWMutex's `RLock`/`RUnlock` is heavier than `Lock`/`Unlock` because it tracks reader count atomically.
- The critical section (`return c.m[k]`) is ~20 ns; RWMutex per-op overhead is ~50 ns; Mutex is ~10 ns.
- Reader-parallelism would help if critical sections were long; they are short.

### The fix

Switch to `sync.Mutex`:

```go
type Config struct {
    mu sync.Mutex
    m  map[string]string
}

func (c *Config) Get(k string) string {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.m[k]
}
```

12% throughput improvement, same code shape.

### A better fix

Configuration changes rarely; copy-on-write:

```go
type Config struct {
    m atomic.Pointer[map[string]string]
}

func (c *Config) Get(k string) string {
    return (*c.m.Load())[k]
}

func (c *Config) Set(k, v string) {
    for {
        old := c.m.Load()
        newMap := make(map[string]string, len(*old)+1)
        for k, v := range *old {
            newMap[k] = v
        }
        newMap[k] = v
        if c.m.CompareAndSwap(old, &newMap) {
            return
        }
    }
}
```

Reads are lock-free; writes are O(N) copy. For "small, rarely-changing" maps this is the fastest correct option.

### Lessons

- RWMutex is not always faster than Mutex.
- Read-mostly workloads might prefer copy-on-write.
- Profile, then choose.

---

## Appendix EEE: extended case — atomic counter pile-up

A service counted requests per endpoint with an `atomic.Int64` per endpoint, in a single struct:

```go
type Metrics struct {
    Requests  atomic.Int64
    Errors    atomic.Int64
    BytesIn   atomic.Int64
    BytesOut  atomic.Int64
    Duration  atomic.Int64
}
```

Under 32-core load, profile showed 18% of CPU in `atomic.(*Int64).Add`. The cause: false sharing. All 5 counters shared a cache line. Every increment invalidated the line on all 32 cores.

### Fix: pad

```go
const padBytes = 56 // 64 - 8

type Metrics struct {
    Requests atomic.Int64
    _        [padBytes]byte
    Errors   atomic.Int64
    _        [padBytes]byte
    BytesIn  atomic.Int64
    _        [padBytes]byte
    BytesOut atomic.Int64
    _        [padBytes]byte
    Duration atomic.Int64
    _        [padBytes]byte
}
```

Profile after: atomic operations down to 2% of CPU. Throughput up 11%.

### Better fix: shard

Per-P counters reduce cache-line bouncing further:

```go
type Metrics struct {
    shards []struct {
        Requests atomic.Int64
        Errors   atomic.Int64
        // ...
        _ [paddingToCacheLine]byte
    }
}

func (m *Metrics) AddRequest() {
    p := runtime_procPin()
    m.shards[p].Requests.Add(1)
    runtime_procUnpin()
}
```

`runtime_procPin` is internal; the user-space equivalent is `runtime.GOMAXPROCS(0)` and `fastrand()` for shard selection. Tradeoffs:

- Shard fan-out reduces contention.
- Shard collection (summing all shards) is now O(N_shards).
- Memory is N_shards × per-shard size.

For most services, padding alone fixes the problem. Sharding is for extreme cases.

---

## Appendix FFF: short essay — "if it's hot, don't make it hotter"

A common mistake: a profile shows a function at 20% of CPU. Engineer decides to parallelise it. Now the function is at 25% of CPU because of overhead. The original 20% was already the bottleneck *because the rest of the program is faster*; making this part hotter does not help — it does not even hide the bottleneck.

The fix is to make the hot function *cheaper*, not *more concurrent*. Concurrency is a tool for spreading work; if the work itself is wasteful, concurrency does not save you.

### Senior debugging dialogue

> Junior: "Function X is 20% of CPU. I'm going to parallelise it."
>
> Senior: "Before that — why is it 20%? Is there an algorithmic improvement? Are we doing unnecessary work?"
>
> Junior: "Hm, it's iterating the whole list every time."
>
> Senior: "Can we keep an index, or process incrementally?"
>
> Junior: "Probably."
>
> Senior: "Try that first. If after the algorithmic improvement it's still 20%, then we talk concurrency."

This dialogue happens often. The senior question is "is the work necessary?" before "can the work be done in parallel?"

---

## Appendix GGG: extended deep-dive — Amdahl in practice

Let me show Amdahl applied to a real example.

A service handles a request:

1. Parse JSON: 10 ms (CPU)
2. Database query: 50 ms (I/O wait)
3. Business logic: 5 ms (CPU)
4. Encode response: 5 ms (CPU)
Total: 70 ms.

A junior proposes "parallelise business logic." That is 5 ms / 70 ms = 7% of wall time. At 4 cores, the best-case speedup of business logic is 4× = 1.25 ms. Total: 70 - 5 + 1.25 + overhead ~ 66 ms. Speedup: 1.06×. Useless.

A senior proposes "reduce the database query." If the query goes from 50 ms to 20 ms, total is 40 ms, a 1.75× speedup. Much higher leverage.

Or: "make the parse incremental, overlapping with the DB query." If parse and DB run in parallel, total is `max(10+5+5, 50) = 50 ms`, a 1.4× speedup. Still better than parallelising the 5 ms business logic.

The lesson: optimise the biggest chunks first. Amdahl tells you that small fractions are bad targets for parallelism.

---

## Appendix HHH: short essay — concurrency in I/O servers

For an HTTP or RPC server, the typical pattern is "one goroutine per request." This is *good*. The Go runtime handles tens of thousands of these efficiently.

The "premature optimisation" trap for I/O servers is *internal*: within a request handler, do you fan out?

For most requests, no. The handler does:

1. Parse input.
2. Call dependencies.
3. Aggregate.
4. Respond.

If step 2 is a single dependency, no concurrency. If step 2 is multiple independent dependencies, fan-out is the textbook case (and it is a clear win).

Inside-handler concurrency rarely pays off for CPU-bound steps because the handler is one request among many — the cores are already busy with sibling requests. Adding within-request parallelism just steals from siblings.

### Exception: long requests

For a slow request (say, a 5-second batch import), within-request parallelism *can* help: the request is a small fraction of total load, so stealing cores from siblings is a fair trade.

But always measure. Sometimes the simple "process serially" is faster, because cache locality dominates.

---

## Appendix III: short essay — concurrency in batch jobs

Batch jobs are different. The job is "the whole program." All cores are yours; use them.

For batch:

1. Read input.
2. Process records.
3. Write output.

Fan-out on step 2 is usually a win. Worker pool sized to GOMAXPROCS or slightly higher (for I/O-bound work). Batched send/recv. Per-worker output. Final merge.

The patterns from this document apply directly. Senior engineers in batch contexts often run benchmarks comparing 1, 2, 4, 8, 16, 32 workers to find the sweet spot.

---

## Appendix JJJ: closing thought — speed is a feature, complexity is a cost

A 2× speedup that doubles the code's complexity may or may not be worth it. A 1.05× speedup that doubles the complexity rarely is. A 10× speedup that adds a few lines is almost always worth it.

Senior engineers weigh both sides. They merge speedups that pay back the complexity. They reject speedups that do not.

The next file, `professional.md`, takes this calculus into production: SLOs as the constraint, capacity planning as the framework, and the decision matrix for when concurrency, scaling, or algorithmic improvement is the right tool for the job.

---

## Appendix KKK: revision history of this document

This document is a living artifact. As of this writing:

- Goroutine spawn cost: ~1 µs (Go 1.22 on x86_64).
- Channel send/recv (buffered, hot): ~50 ns.
- Mutex uncontended: ~10 ns.
- L1 cache hit: ~1 ns.
- Goroutine switch: ~200 ns.

Numbers will change as hardware and the Go runtime evolve. The principles will not. Measure on your hardware, against your workload, before merging an optimisation. If the numbers in this document feel stale by the time you read it, run your own benchmarks and update your intuition.

The discipline is the durable thing.

---

## Appendix LLL: extended example — a real benchstat report

Here is a sample benchstat report from a real evaluation. Two implementations of a histogram updater under concurrent load.

```
                        │   serial.txt    │             parallel.txt              │
                        │     sec/op      │   sec/op      vs base                 │
HistogramUpdate/N100      155.2n ± 1%      237.1n ± 2%   +52.78% (p=0.000 n=20)
HistogramUpdate/N1k       1.510µ ± 1%     2.043µ ± 2%   +35.30% (p=0.000 n=20)
HistogramUpdate/N10k      14.95µ ± 1%     8.273µ ± 3%   -44.66% (p=0.000 n=20)
HistogramUpdate/N100k     150.8µ ± 1%     46.32µ ± 4%   -69.28% (p=0.000 n=20)
HistogramUpdate/N1M       1.510m ± 1%     471.2µ ± 5%   -68.79% (p=0.000 n=20)
geomean                   15.07µ           10.32µ        -31.49%
```

The parallel implementation:

- Is slower for N ≤ 1000.
- Is faster for N ≥ 10000.
- Has a crossover around N=2000 (estimated).
- Has higher variance (3-5% vs 1-2%).

### Senior interpretation

This is a real decision: "ship the parallel version, but include a runtime switch."

```go
func updateHistogram(items []Item) {
    if len(items) < 2000 {
        updateSerial(items)
    } else {
        updateParallel(items)
    }
}
```

For workloads with small batches (the common case in this service), serial wins. For occasional large batches, parallel wins. The runtime switch picks the right strategy per call.

A senior reviewer would also ask: "what is the distribution of `len(items)` in production?" If 99% of calls are at N=100, the parallel version is irrelevant; ship serial only. If 50% are at N=10000+, the runtime switch matters.

---

## Appendix MMM: deep-dive — micro-, macro-, and synthetic benchmarks

Three benchmark categories serve different purposes.

### Microbenchmarks

- Measure one function in isolation.
- Run with `testing.B`.
- Quick feedback during development.
- Limited: do not capture system-level effects.

### Macrobenchmarks

- Measure end-to-end performance under load.
- Often use external tools (`wrk`, `vegeta`, `ghz`).
- Slow to run; require a deployment.
- Captures system-level effects.

### Synthetic load tests

- Generate realistic traffic patterns.
- Run against production-like infrastructure.
- Validate hypotheses about scaling.
- Expensive to set up.

A senior engineer uses all three:

- Microbenchmarks during development.
- Macrobenchmarks in CI for critical paths.
- Synthetic load tests before major releases.

The discipline of running all three prevents the "microbench wins, production loses" pattern.

---

## Appendix NNN: deep-dive — `pprof`'s sampling and its biases

`pprof` is a sampling profiler. It interrupts the program at intervals and records the current call stack. With Go's default sample rate (100 Hz, every 10 ms), a 60-second profile collects 6000 samples.

### Biases

1. **Short bursts of activity** may not be captured. A function that runs for 1 ms once per second is sampled only ~10% of the time.
2. **Code that calls many short functions** has stacks distributed across many leaves. Each function appears at low percentage.
3. **Inlined functions** appear under their caller's name (or sometimes get a `[inlined]` marker).
4. **GC time** appears under `runtime.gcDrain*`, which may be hard to map back to user code.

### Improvements

- Increase sample rate with `runtime.SetCPUProfileRate(N)` (use cautiously; high rates cost performance).
- Use `pprof.Labels` to tag goroutines and slice profiles by label.
- Use the trace (`go tool trace`) for sub-millisecond resolution.

### Senior heuristic

A `pprof` showing 8% in one function and 7% in another *is* meaningful — those are real CPU consumers. A `pprof` showing all functions below 1% means the CPU is well-spread; further attention requires a different tool (allocation profile, trace, perf).

---

## Appendix OOO: a final piece — when to push back

A teammate proposes a concurrency optimisation. The pattern of senior pushback:

1. **Ask for the goal**. "What metric will this move?"
2. **Ask for the baseline**. "Where are we now?"
3. **Ask for the benchmark**. "Run it before and after."
4. **Ask for the profile**. "Show me where the time goes today."
5. **Ask for Amdahl**. "What's the theoretical max gain?"
6. **Ask for an alternative**. "What if we did this serially with a better algorithm?"
7. **Ask for the cost**. "How much complexity does this add?"
8. **Ask for the revert plan**. "If this doesn't work in production, how do we back it out?"

These are not gotchas. They are the conversation a senior engineer has *with themselves* before opening a PR, and the conversation they expect with teammates before merging. Internalising them is the senior shift.

---

## Appendix PPP: one-page senior checklist

For your next "make it concurrent" decision:

- [ ] What metric does this improve?
- [ ] What is the current baseline?
- [ ] What is the per-item work? (> 1 µs to consider parallelism)
- [ ] What is the total work? (> 10 ms to consider parallelism)
- [ ] Is the per-item work independent?
- [ ] What is the dominant bottleneck (CPU/I/O/memory)?
- [ ] What does Amdahl predict?
- [ ] Have I tried the serial version with the obvious algorithmic wins first?
- [ ] Where is the benchmark?
- [ ] Where is the pprof before?
- [ ] Where is the pprof after?
- [ ] Where is the `benchstat` output?
- [ ] Is `p < 0.05`?
- [ ] Does it hold at `-cpu=1`?
- [ ] Does it hold under GC pressure (`GOGC=20`)?
- [ ] Is the new code clearer or just faster?
- [ ] Is there a revert plan?

If all 16 are answered "yes" or "n/a," the change is ready for senior review.

If any are unanswered, do the work to answer them. If you cannot, the optimisation is premature.

---

## Appendix QQQ: a closing note to the reader

You have read 4000+ lines of senior-level treatment of premature concurrency optimisation. The intent was not to deliver a single message but to give you a *vocabulary*. When you encounter a "make it concurrent" PR, you should be able to:

- Name the mechanism by which it might slow things down.
- Estimate the magnitude of the effect.
- Demand the right evidence.
- Articulate the maintenance cost.
- Suggest the simpler alternative.

If you can do all five, you are senior. If you can teach others to do them, you are leading.

The next document, `professional.md`, takes the same discipline into production at scale: SLO-driven optimisation, fleet-level capacity planning, and the broader architectural decisions about when concurrency is the right answer versus when scaling, sharding, or caching is.

---

## Appendix RRR: extended summary of mechanisms

To summarise the physical mechanisms by which concurrency can hurt:

1. **Goroutine spawn cost**: ~1 µs end-to-end.
2. **Goroutine context switch**: ~200 ns on same P.
3. **Channel send/recv**: ~50 ns hot, ~250 ns with park.
4. **Mutex lock/unlock uncontended**: ~10 ns.
5. **Mutex contention**: ~1 µs park-wake.
6. **Atomic ops uncontended**: ~1 ns.
7. **Atomic ops contended**: ~30-100 ns cache-line bounce.
8. **False sharing**: 10–60× slowdown per write.
9. **Cache cold from migration**: tens of ns to warm.
10. **GC pressure**: variable; 5%+ of CPU is concerning.
11. **Scheduler overhead**: 1–5% in healthy programs.
12. **Coordination of fan-out/fan-in**: per-op channel cost adds up.

Each of these is a number you can estimate, measure, and reason about. Senior engineering is the habit of doing so before reaching for the simpler-sounding (but often slower) "let me parallelise" solution.

---

## Appendix SSS: one final code example

A serial implementation that beats every concurrent alternative:

```go
func SumSlice(xs []float64) float64 {
    sum := 0.0
    for _, x := range xs {
        sum += x
    }
    return sum
}
```

Try beating this with goroutines for `len(xs) < 1_000_000`. You will lose. The CPU's SIMD pipelining and cache locality make this loop fast enough that any coordination is pure overhead.

For `len(xs) > 10_000_000`, a parallel version can win, but only with careful design: chunks of 100,000+ items per goroutine, fixed pool of `GOMAXPROCS` workers, atomic accumulator joined at the end.

The break-even is hardware-dependent. Run the benchmark on your hardware before deciding. The serial version is the baseline; any change must beat it with statistical significance.

---

## Appendix TTT: end

This is the end of the senior-level treatment. Read `professional.md` next for production-scale considerations.

Remember the three pillars:

1. Physical mechanism awareness.
2. Measurement discipline.
3. Cultural leadership.

Practise them daily and your code, your team, and your services will be the better for it.


