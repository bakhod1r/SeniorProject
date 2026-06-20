# Profiling

> *"A profile shows you where time and memory actually go — which is almost never where you'd guess."*

This section is the **diagnostic half of [Performance](../README.md)** — the tooling and reading-skills that turn a vague "it's slow" into a specific "this function allocates 80% of the heap on the hot path."

The four sub-sections cover the four most common profile shapes:

| # | Sub-section | What it measures |
|---|---|---|
| [01](01-cpu-profiling/) | **CPU Profiling** | Wall-clock vs CPU time per function; on-CPU sampling profilers |
| [02](02-memory-profiling/) | **Memory Profiling** | Heap snapshots, retained sets, leak detection |
| [03](03-allocation-profiling/) | **Allocation Profiling** | Allocation rate and call-sites — distinct from "what's resident" |
| [04](04-flame-graphs/) | **Flame Graphs** | The visualisation that made profile reading tractable; how to read one without lying to yourself |

---

## Why split CPU / Memory / Allocation

A common mistake: "profile memory" and look at heap usage. But high *allocation rate* can wreck GC pause times even when the heap stays small. They are different signals captured by different tools — separating them is the first step toward useful profiling.

---

## Related

- **[Benchmarking](../02-benchmarking-and-microbenchmarks/)** — controlled comparison; profiling is exploration.
- **[Memory Optimization](../05-memory-and-allocation-profiling/)** — once allocation profile points the finger, this is where you act on it.
- **[Diagnostics → Diagnostic Endpoints](../../../diagnostics/diagnostic-endpoints/)** — `/debug/pprof` and JFR-style live profile capture.
- **[Language Internals → Memory Management](../../../language-internals/memory-management/)** — *why* allocations are expensive, not just where.
