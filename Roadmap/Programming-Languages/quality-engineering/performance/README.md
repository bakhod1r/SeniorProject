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

| # | Topic | Focus |
|---|---|---|
| [01](01-profiling/) | Profiling | CPU / memory / allocation profiles, flame graphs, pprof / perf / Instruments / async-profiler |
| [02](02-benchmarking/) | Benchmarking | Micro-benchmarks done right (avoiding DCE, JIT warm-up, branch prediction noise); macro-benchmarks; stability |
| [03](03-latency-budgets/) | Latency Budgets | Tail-latency thinking, the p99 trap, per-component budgets, error budgets |
| [04](04-throughput-vs-latency/) | Throughput vs Latency | The Little's-Law triangle (throughput · latency = concurrency), when each matters |
| [05](05-memory-optimization/) | Memory Optimization | Allocation rate, escape analysis, GC pressure, fragmentation, working set, allocators |
| [06](06-cache-friendly-code/) | Cache-Friendly Code | Cache lines, false sharing, SoA vs AoS, prefetching, NUMA |
| [07](07-concurrency-overhead/) | Concurrency Overhead | Amdahl, contention, lock convoying, scheduler effects, scaling curves |
| 08 | Regression Detection | CI benchmarks, statistical thresholds (Mann-Whitney U), trend dashboards, alerts |
| 09 | Performance Anti-patterns | "Optimise without measuring," premature optimisation, micro-benchmark theatre, "it's fine on my Mac" |

> Sections 08–09 are planned but not yet scaffolded as sub-folders — they'll be added as content is filled in.

---

## Languages

Examples in **Go** (`pprof`, `benchstat`, `runtime/trace`), **Java** (JFR, async-profiler, JMH, GC logs), **Python** (`cProfile`, `py-spy`, `tracemalloc`, `pytest-benchmark`), **Rust** (`cargo bench`, `criterion`, `perf`, flamegraph), and **C/C++** (`perf`, Intel VTune, valgrind callgrind).

---

## Status

⏳ **Structure defined; 7 sub-folders scaffolded. Sections 08–09 planned. Per-topic files (junior / middle / senior / professional / interview) pending.**

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
