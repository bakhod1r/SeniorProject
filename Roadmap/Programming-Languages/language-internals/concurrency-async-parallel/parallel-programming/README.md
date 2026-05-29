# Parallel Programming

> *"If your problem isn't CPU-bound, parallelism won't make it faster — it'll just make it more complicated."*

This roadmap is about **using multiple cores (and SIMD lanes, and sometimes GPUs) to do real CPU work faster**. It is the half of the [Concurrency, Async & Parallel](../README.md) trio that targets *compute-bound* workloads — the place where Amdahl's Law, false sharing, cache lines, and work-stealing all start to matter.

> Looking for *non-blocking I/O* (event loops, `async/await`)? See **[Async Programming](../async-programming/)**.
>
> Looking for *concurrency primitives* (mutex, channels, threads)? See **[Concurrency](../concurrency/)**.
>
> Looking for *distributed compute* (multi-node, MapReduce, Spark)? That belongs in the System Design and Data tracks — parallelism *across machines* is a different problem from parallelism *within one machine*, which is what this roadmap covers.

---

## Why a Dedicated Roadmap

Parallel programming is the part of "make this faster" that the textbooks underplay:

- A naive 8-core parallelisation often gives **3×**, not 8× — and the reason (Amdahl, contention, cache-line bouncing) isn't obvious from the code.
- **Concurrency** primitives let two tasks share state safely; **parallel** programming asks how to *partition* work so they don't have to share state at all.
- The right abstraction depends on shape: **data-parallel** (the same op on many items) vs **task-parallel** (different ops in parallel) vs **pipeline** (stages flowing through cores).

| Roadmap | Question it answers |
|---|---|
| [Concurrency](../concurrency/README.md) | How do logical flows coordinate? |
| [Async Programming](../async-programming/README.md) | How do I do thousands of waits at once? |
| **Parallel Programming** (this) | How do I keep all the cores busy on the same problem? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-amdahl-and-gustafson/) | Amdahl & Gustafson | The two laws that bound how much speedup parallelism can give; serial fraction; strong vs weak scaling |
| [02](02-data-parallelism/) | Data Parallelism | Parallel `map`, `reduce`, `forEach`; SIMD-style at high level; Java parallel streams, Rust Rayon, .NET PLINQ |
| [03](03-task-parallelism/) | Task Parallelism | Independent task graphs; `Future` join trees; pipelining stages |
| [04](04-fork-join/) | Fork-Join | Divide-and-conquer pattern; cilk-style, Java `ForkJoinPool`, Rust `join!` |
| [05](05-work-stealing/) | Work-Stealing | How modern parallel runtimes balance load (Tokio, Rayon, ForkJoinPool, TBB); when it helps and hurts |
| [06](06-simd-and-vectorization/) | SIMD & Vectorization | Auto-vectorization; intrinsics (SSE/AVX/NEON); Rust `std::simd`, Go SIMD packages |
| [07](07-parallel-collections/) | Parallel Collections | Java parallel streams, Scala par-collections, Rust Rayon — pros, cons, and when they silently regress |
| [08](08-cache-and-false-sharing/) | Cache & False Sharing | Cache lines, padding, `@Contended`, cache-friendly layouts (SoA vs AoS for parallel scans) |
| [09](09-numa-aware-parallelism/) | NUMA-aware Parallelism | Why putting threads on the wrong socket halves your performance |
| [10](10-gpu-and-accelerator-offload/) | GPU & Accelerator Offload | CUDA / OpenCL / Metal at conceptual level, when "throw it at a GPU" works and when it doesn't |
| [11](11-benchmarking-parallel-code/) | Benchmarking Parallel Code | Why microbenchmarks lie; warm-up, JIT, contention noise; flame graphs vs lock-contention profilers |
| [12](12-anti-patterns/) | Anti-patterns | "Parallel for-loop everywhere"; over-parallelisation; lock-as-coordination disguised as parallelism |

---

## Languages

Cross-language comparison: **Java** (`ForkJoinPool`, parallel streams, `@Contended`), **Rust** (Rayon, `std::simd`), **C++** (TBB, OpenMP, intrinsics), **Go** (`runtime.GOMAXPROCS`, manual fan-out — deliberately *no* parallel-collections magic), **C#** (PLINQ, `Parallel.For`).

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *The Art of Multiprocessor Programming* — Herlihy & Shavit
- *Structured Parallel Programming* — McCool, Robison, Reinders
- *What Every Programmer Should Know About Memory* — Ulrich Drepper (the cache-line classic)
- *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — Paul McKenney (free)
- Aleksey Shipilëv — JVM concurrency talks on false sharing, `@Contended`

---

## Project Context

Part of the [Senior Project](../../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
