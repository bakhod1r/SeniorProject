# Performance Roadmap

> *"Make it work, make it right, make it fast — in that order, but only if 'fast' is on the requirements list."*

This roadmap is about **measuring, profiling, and optimising the runtime cost of code** — latency, throughput, memory, cache behaviour, contention — and protecting hot paths against regression over the lifetime of a system.

> Looking for *language-internals* substrate (memory model, scheduler, GC algorithms)? See [Language Internals](../../language-internals/).
>
> Looking for *system-design* level capacity planning (back-of-envelope QPS, sharding, load balancing)? See [System Design](../../../Architecture/system-design/) and the `system-design-estimation` skill.
>
> Looking for *production diagnostics* (when slow becomes an incident)? See [Diagnostics](../../diagnostics/).

---

## Why a Dedicated Roadmap

Most performance content is either *intro-level* ("use a hash map for lookup") or *deep specialisation* ("here's how SSE intrinsics work for image filtering"). The senior middle ground — *how to measure honestly, what flame graphs are actually telling you, when not to optimise* — is rarely consolidated.

| Roadmap | Question it answers |
|---|---|
| [Testing](../testing/README.md) | Does it work? |
| [Build Systems](../build-systems/README.md) | Can I build it reproducibly? |
| **Performance** (this) | Is it fast enough — and how do I keep it that way? |

---

## Sections

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus | Status |
|---|---|---|---|
| [01](01-profiling/) | Profiling | CPU / memory / allocation profiles, flame graphs, pprof / perf / Instruments / async-profiler | ✅ |
| [02](02-benchmarking-and-microbenchmarks/) | Benchmarking & Microbenchmarks | Micro-benchmarks done right (avoiding DCE, JIT warm-up, branch-prediction noise); macro-benchmarks; statistical stability | ✅ |
| [03](03-latency-and-throughput/) | Latency & Throughput | Little's Law, the p99 trap, tail-at-scale, coordinated omission, queueing, budgets | ✅ |
| [04](04-cpu-bound-optimization/) | CPU-Bound Optimization | Profile-first, the memory hierarchy, branch prediction, SIMD, data layout, PGO | ✅ |
| [05](05-memory-and-allocation-profiling/) | Memory & Allocation Optimization | Allocation rate vs residency, escape analysis, GC pressure, allocators, GOMEMLIMIT/OOMKills | ✅ |
| [06](06-concurrency-and-contention/) | Concurrency & Contention | Amdahl & USL, lock contention, false sharing, cache coherence, scheduler effects, scaling curves | ✅ |
| [07](07-performance-budgets-and-regression-testing/) | Performance Budgets & Regression Testing | Budgets as SLOs, benchstat/Mann-Whitney, change-point detection, CI gates, trend dashboards | ✅ |

> The 01-profiling section is further split into four sub-topics — [CPU](01-profiling/01-cpu-profiling/), [Memory](01-profiling/02-memory-profiling/), [Allocation](01-profiling/03-allocation-profiling/), and [Flame Graphs](01-profiling/04-flame-graphs/) — each with the full five-tier set.

---

## Languages

Examples in **Go** (`pprof`, `benchstat`, `runtime/trace`), **Java** (JFR, async-profiler, JMH, GC logs), **Python** (`cProfile`, `py-spy`, `tracemalloc`, `pytest-benchmark`), **Rust** (`cargo bench`, `criterion`, `perf`, flamegraph), and **C/C++** (`perf`, Intel VTune, valgrind callgrind).

---

## Status

✅ **Content-complete.** All 7 sections — including the 4 profiling sub-topics — are written across the full five-tier set (junior / middle / senior / professional / interview): 50 topic files in total.

---

## References

- *Systems Performance* — Brendan Gregg (the canonical text; the USE method)
- *Java Performance: The Definitive Guide* — Scott Oaks
- *Designing Data-Intensive Applications* — Martin Kleppmann (response-time chapters)
- *Methodology* talks — Aleksey Shipilëv (JMH and "the magic of `-XX:+PrintCompilation`")
- *Tail at Scale* — Dean & Barroso (the classic on p99 latency)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
