# The Memory Hierarchy — Professional Level

> **Topic:** [The Memory Hierarchy](README.md)
> **Focus:** Profiling the hierarchy in production — perf counters, roofline, top-down analysis — plus hardware-level detail (MSHRs, DRAM banks, prefetch tuning) and war stories where the hierarchy decided the outcome.

---

## Table of Contents

- [Introduction](#introduction)
- [Measuring the Hierarchy: the Counters That Matter](#measuring-the-hierarchy-the-counters-that-matter)
- [Top-Down Microarchitecture Analysis](#top-down-microarchitecture-analysis)
- [The Roofline Model](#the-roofline-model)
- [Hardware Detail You Eventually Need](#hardware-detail-you-eventually-need)
  - [MSHRs and memory-level parallelism](#mshrs-and-memory-level-parallelism)
  - [DRAM internals: banks, rows, and the page-hit gamble](#dram-internals-banks-rows-and-the-page-hit-gamble)
  - [Prefetcher tuning and its limits](#prefetcher-tuning-and-its-limits)
  - [Non-temporal stores and write bandwidth](#non-temporal-stores-and-write-bandwidth)
- [War Stories](#war-stories)
- [A Production Profiling Playbook](#a-production-profiling-playbook)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At this level you stop reasoning about the hierarchy abstractly and start *measuring* it on real hardware under real load, then attributing wall-clock time to specific levels with hardware performance counters. The questions become precise: Is this loop bound by L3 latency or DRAM bandwidth? Are we losing 20% to TLB walks? Is a single false-sharing line costing us a core? The tools are `perf`, `toplev`, `likwid`, Intel VTune, AMD uProf, and the roofline model — and the fixes are informed by how the silicon actually behaves.

---

## Measuring the Hierarchy: the Counters That Matter

Every modern CPU exposes hardware performance monitoring counters (PMCs). The Linux entry point is `perf`.

```bash
# Cache miss overview for a workload
perf stat -e cycles,instructions,\
cache-references,cache-misses,\
L1-dcache-loads,L1-dcache-load-misses,\
LLC-loads,LLC-load-misses,\
dTLB-loads,dTLB-load-misses ./app

# Where in the code the misses happen (sampling on LLC misses)
perf record -e LLC-load-misses:pp -c 1000 ./app
perf report
```

How to read the results:

- **IPC (instructions / cycles).** Below ~1.0 on a 4-wide+ core usually means stalls — frequently memory. Near 0.2–0.5 screams "memory-bound."
- **LLC-load-misses** are the expensive ones: each is ~a DRAM round trip (~100 ns). Multiply count × ~100 ns to bound the DRAM-stall time. If that approaches your runtime, you're DRAM-latency-bound.
- **dTLB-load-misses → page walks.** A high ratio (and high `dtlb_load_misses.walk_active` cycles) means you're translation-bound — reach for huge pages.
- **Miss *ratios* mislead.** A 2% miss ratio sounds great but if it's 2% of 100 billion loads at 100 ns each, it's the whole runtime. Always convert to *time*, not ratio.

For NUMA, use `numastat -p <pid>` and the uncore counters (`perf stat -e uncore_imc/.../` or PCM) to see per-socket memory traffic and remote-access fractions. `perf c2c` (cache-to-cache) is the dedicated tool for **finding false sharing** — it pinpoints the exact line and the two functions fighting over it.

---

## Top-Down Microarchitecture Analysis

Counting misses tells you *what* is happening; **Top-Down Microarchitecture Analysis (TMA)** tells you *whether it matters*. TMA buckets every pipeline slot into four categories:

```
                 ┌─ Frontend Bound   (instruction supply: I-cache, iTLB, branch mispredict)
Pipeline slot ───┼─ Bad Speculation  (wasted work)
                 ├─ Retiring         (useful work — what you want)
                 └─ Backend Bound ───┬─ Core Bound   (execution ports/divider)
                                     └─ Memory Bound ┬─ L1/L2/L3 Bound
                                                     ├─ DRAM Bound (latency vs bandwidth)
                                                     └─ Store Bound
```

Run it with Andi Kleen's `toplev` (`pmu-tools`) or VTune's "Microarchitecture Exploration":

```bash
toplev.py -l3 --no-desc ./app    # drill 3 levels deep
```

The payoff: TMA tells you the *fraction of pipeline slots* lost to "DRAM Bound" or "L3 Bound." If a loop is 60% DRAM-Bound, no amount of clever arithmetic helps — you must cut bytes moved or improve locality. If it's "Core Bound," memory tuning is wasted effort. This single discipline stops the most common senior mistake: optimizing the wrong layer.

---

## The Roofline Model

The roofline plots attainable FLOP/s (or ops/s) against **arithmetic intensity** = useful ops per byte moved from DRAM.

```
 Performance (ops/s)
   ^            ____________________  <- compute roof (peak FLOP/s)
   |           /
   |          /  <- this slope = peak memory bandwidth (GB/s)
   |         /
   |        /
   +-------+----------------------> arithmetic intensity (ops/byte)
        ridge point
```

- A kernel **left of the ridge point** is **memory-bound**: its ceiling is `bandwidth × intensity`. The only way up is raising intensity (reuse data more — blocking/tiling) or moving fewer bytes (SoA, compression, smaller types).
- A kernel **right of the ridge** is **compute-bound**: vectorize, use more cores, better algorithms.

Most data-processing and "AI inference on CPU" kernels live to the *left* — they're memory-bound, and the hierarchy is the binding constraint. Measure your kernel's intensity (FLOPs ÷ bytes from `perf`'s memory traffic counters) and plot where it sits before optimizing. `likwid-perfctr -g MEM_DP` or Intel Advisor's roofline automate this.

---

## Hardware Detail You Eventually Need

### MSHRs and memory-level parallelism

A core hides DRAM latency by keeping multiple misses **in flight** simultaneously, tracked by **MSHRs (Miss Status Handling Registers)** — typically ~10–20 per core. This is the hardware reason sequential scans hit bandwidth while pointer chasing hits latency: a scan generates many *independent* misses that fill all MSHRs and overlap; a pointer chase has exactly one outstanding miss at a time (the next address is unknown), so the core sees full latency on each, serialized.

Practical implication: to saturate DRAM bandwidth from one core you need **enough independent in-flight accesses** to cover the latency-bandwidth product (Little's Law: concurrency = latency × bandwidth). One stream often can't; **multiple streams or multiple cores** are needed to reach peak bandwidth. This is why a single-threaded `memcpy` rarely hits the chip's rated bandwidth and why you sometimes need several cores just to fill the memory pipe.

### DRAM internals: banks, rows, and the page-hit gamble

DRAM isn't flat. It's organized into channels → ranks → **banks**, each bank a 2D array with a **row buffer**. Accessing a column in the *currently open row* (a **row hit**) is fast; accessing a different row (**row miss / conflict**) forces a precharge + activate — much slower. Sequential access tends to stay within open rows (row hits); random access thrashes rows (constant precharge/activate). This is a *second*, finer-grained reason random DRAM access is slower than the headline latency suggests, and why interleaving across channels/banks matters for bandwidth. You rarely program to this directly, but it explains benchmark anomalies and is why "DRAM latency" is a distribution, not a constant.

### Prefetcher tuning and its limits

Server CPUs expose multiple prefetchers (L2 streamer, adjacent-line, DCU/IP-stride) togglable via MSRs (on Intel, MSR `0x1A4`). For *most* code, leave them on. But:
- For **streaming-once** workloads (read huge data once, no reuse), aggressive prefetch can *pollute* cache and waste bandwidth; some HPC/DB shops disable specific prefetchers.
- Prefetchers **don't cross page boundaries**, so 4 KB-fragmented access loses prefetch even when sequential within a page — another argument for **huge pages** beyond TLB savings.
- Software prefetch (`prefetcht0/1/2/nta`) helps only at the *right distance* (enough lookahead to cover latency, not so far it evicts useful lines). Tuning it is empirical; measure, don't assume.

### Non-temporal stores and write bandwidth

When you write data you will *not* read back soon (e.g. producing a large output buffer), normal stores waste bandwidth on **RFO (Read-For-Ownership)** — the CPU reads the line just to overwrite it — and pollute cache. **Non-temporal / streaming stores** (`movnti`, `_mm_stream_ps`, `memset` variants) bypass the cache and write straight to memory, roughly *halving* write traffic and sparing the cache. Used in optimized `memcpy`/`memset`, video pipelines, and large array initialization. The catch: they need fencing (`sfence`) and hurt if you *do* re-read the data soon.

---

## War Stories

**1. The 40% NUMA tax nobody saw.** A Go service on a 2-socket box degraded under load. CPU wasn't saturated; `perf stat` showed low IPC and `numastat` showed ~45% remote memory accesses. The cause: a startup routine allocated and zeroed all caches/buffers on one goroutine (one socket), then the runtime scheduled workers across both sockets. Fix: NUMA-aware sharding of the buffers with per-shard worker affinity (and pinning with `GOMAXPROCS` + `numactl --cpunodebind`). Throughput rose ~35%.

**2. A single line that cost a core.** A lock-free counter array `int64 hits[NumCPU]` showed near-zero scaling past 4 threads. `perf c2c` flagged one 64-byte line carrying eight adjacent counters — textbook false sharing, the line bouncing between cores thousands of times per millisecond. Padding each counter to its own line restored linear scaling. The diff was four lines; the speedup was 3×.

**3. The hash map that was secretly disk-bound.** An "in-memory" cache spilled past RAM into swap on a memory-pressured node. Latency p99 jumped from microseconds to tens of milliseconds. `vmstat` showed `si/so` (swap-in/out) activity; the working set had quietly exceeded RAM and the kernel was paging to SSD. The hierarchy's bottom level had silently joined the hot path. Fix: cap the cache size below available RAM and add admission control — never let the working set cross the RAM→swap cliff.

**4. Tiling a matrix kernel off the roofline.** A naive matrix multiply ran at a fraction of peak. Roofline analysis put it deep in the memory-bound region (intensity ~ O(1) because each element was re-fetched from DRAM). Blocking into L1/L2-sized tiles raised arithmetic intensity by reusing each loaded tile O(tile) times, moving the kernel toward the compute roof — a multi-× speedup with identical FLOP count.

---

## A Production Profiling Playbook

1. **Establish boundness with TMA first.** `toplev -l1`. If not Backend/Memory-Bound, stop tuning memory.
2. **Localize with sampling.** `perf record -e LLC-load-misses:pp` → `perf report` to find the offending lines/functions.
3. **Convert misses to time**, not ratios: `LLC-load-misses × ~100 ns` vs runtime.
4. **Check the TLB** (`dtlb_load_misses.walk_active` cycles). High → huge pages.
5. **Check NUMA** (`numastat -p`, uncore IMC counters per socket). High remote % → fix placement.
6. **Hunt false sharing** with `perf c2c` if a parallel section scales poorly.
7. **Place the kernel on a roofline** to decide whether to cut bytes or add compute.
8. **Verify with the same counters after the fix** — confirm the bucket you targeted actually shrank.

---

## Best Practices

1. **Profile before, attribute precisely, verify after.** TMA + perf counters, every time. Never optimize memory by guesswork.
2. **Engineer for the RAM→swap cliff.** Size working sets safely under RAM; monitor swap activity in prod. The bottom of the hierarchy is a latency cliff, not a slope.
3. **Use huge pages for large/sparse working sets** — wins on both TLB and prefetch.
4. **Reach for non-temporal stores** when producing large write-only buffers; **disable specific prefetchers** only for measured streaming-once workloads.
5. **Pin memory and threads on NUMA hardware**; co-locate data with the cores that use it via parallel first-touch and affinity.
6. **Treat single-thread bandwidth as limited** (MSHR/Little's Law); parallelize streaming to fill the memory pipe.

---

## Edge Cases & Pitfalls

- **Counter skid and attribution error.** Non-precise events attribute misses to the wrong instruction; use `:pp` (PEBS/IBS) precise sampling for memory events.
- **Microbenchmarks that fit in cache.** They report fantasy numbers; size test data above the relevant cache level and include realistic TLB/NUMA conditions.
- **Frequency scaling and uncore.** Turbo, C-states, and uncore frequency shift latency/bandwidth between runs; pin frequency for repeatable measurement.
- **Huge pages backfiring.** Transparent Huge Pages can cause latency spikes from `khugepaged` compaction; for latency-critical services many shops disable THP and use explicit hugepages instead.
- **Non-temporal stores hurting reuse.** If the "write-only" buffer is read back soon, NT stores force a re-fetch from DRAM — a net loss. Validate the access pattern.
- **Optimizing a non-bottleneck.** A loop that's 5% of runtime, perfectly tuned, saves ~5%. TMA + profiling exist precisely to keep you on the dominant cost.

---

## Summary

- Use **perf counters + Top-Down (TMA)** to *attribute* wall-clock time to specific hierarchy levels, and **convert misses to time, not ratios**.
- The **roofline model** tells you whether a kernel is memory- or compute-bound and therefore whether locality or compute tuning pays.
- Hardware reality shapes the rules: **MSHRs** cap in-flight misses (latency vs bandwidth), **DRAM banks/rows** make random access doubly slow, **prefetchers** don't cross pages, and **non-temporal stores** save write bandwidth.
- The most expensive production surprises come from the **bottom of the hierarchy** (swap) and from **coherence/NUMA** (false sharing, remote memory) — all measurable with `perf c2c`, `numastat`, and `vmstat`.
- The professional discipline: **measure → attribute → fix the dominant level → verify with the same counter.**
