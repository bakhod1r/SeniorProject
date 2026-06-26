# Memory Management Roadmap

> *"There are only two hard things in Computer Science: cache invalidation and naming things — and the first one is really about memory."*

This roadmap is about **how programs use, share, and reclaim memory** — from the hardware layout up through allocators, garbage collectors, and language-level ownership models. Most performance, correctness, and security problems eventually reduce to a memory question.

> Looking for the *operating-systems angle* (virtual memory, paging, kernel allocators)? See [Architecture → CS → OS → Memory Management](../../../Architecture/computer-science/01-operating-systems/02-memory-management/).
>
> Looking for *performance-tuning* of an existing program? See [Performance → Memory & Allocation Profiling](../../quality-engineering/performance/05-memory-and-allocation-profiling/) and [Performance → Memory Profiling](../../quality-engineering/performance/01-profiling/02-memory-profiling/).
>
> Looking for *Go-specific* internals? See [Golang → Runtime → Memory Allocator](../../languages/golang/14-runtime-and-internals/04-memory-allocator/) and [Golang → Memory Management in Depth](../../languages/golang/11-advanced-topics/01-memory-management-in-depth/).

---

## Why a Dedicated Roadmap

Each language tells you *how* it manages memory but rarely *why* its choices differ from the next language. This roadmap is the cross-cutting layer that makes "Go's GC is concurrent and tri-color," "Rust's ownership is compile-time RAII," and "Java's G1 is region-based" land as variations on shared underlying ideas.

| Roadmap | Question it answers |
|---|---|
| [Performance](../../quality-engineering/performance/README.md) | Is my code fast? |
| [Concurrency](../concurrency-async-parallel/README.md) | How do threads share state? |
| **Memory Management** (this) | Where does data live, who owns it, and when does it go away? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-memory-hierarchy/) | The Memory Hierarchy | Registers, L1/L2/L3, RAM, swap, NUMA, why locality dominates |
| [02](02-stack-vs-heap/) | Stack vs Heap | What each is for, the cost models, escape analysis |
| [03](03-manual-memory-management/) | Manual Memory Management | `malloc` / `free`, RAII (C++/Rust), the failure modes (UAF, double-free, leaks) |
| [04](04-reference-counting/) | Reference Counting | Cycles, increment/decrement cost, atomic vs non-atomic, Python / Swift / `Rc<T>` / `Arc<T>` |
| [05](05-tracing-garbage-collection/) | Tracing Garbage Collection | Mark-sweep, mark-compact, generational, tri-color, concurrent vs stop-the-world |
| [06](06-ownership-and-borrowing/) | Ownership & Borrowing | Rust's model, compile-time GC, lifetimes, `Box` / `Rc` / `Arc` trade-offs |
| [07](07-allocators/) | Allocators | `jemalloc`, `mimalloc`, slab/buddy/bump, custom arenas |
| [08](08-escape-analysis/) | Escape Analysis | What stays on the stack, what escapes, when it matters (Go, Java, GraalVM) |
| [09](09-memory-layout/) | Memory Layout | Struct packing, cache lines, false sharing, alignment, SoA vs AoS |
| [10](10-gc-tuning-in-production/) | GC Tuning in Production | Throughput vs latency, GC pauses, sizing the heap, ZGC / Shenandoah / G1 |
| [11](11-memory-safety/) | Memory Safety | Bounds checks, ASan/MSan, MIRI, what "safe" actually means |
| [12](12-memory-bugs/) | Memory Bugs | Leaks, fragmentation, churn, "the program runs fine for 6 hours and then OOMs" |
| [13](13-weak-references/) | Weak / Soft / Phantom References | Why strong refs aren't always what you want; caches, observers, listener leaks; Java's four ref tiers, Swift `weak`/`unowned`, Python `weakref`, Rust `Weak<T>` |
| [14](14-finalizers-and-destructors/) | Finalizers & Destructors | RAII destructors vs GC finalizers; resurrection, ordering, "do not rely on `finalize`," Go `runtime.SetFinalizer`, Python `__del__`, why most stdlibs deprecated them |
| [15](15-object-pinning/) | Object Pinning & Movable Heaps | Compacting GCs move objects; how FFI / JNI / cgo pin memory; GC handles, fixed buffers, the cost of pinning |
| [16](16-off-heap-memory/) | Off-heap / Native Memory | JVM direct buffers, Go `mmap`, Rust `mmap`, native pools; why you'd leave the managed heap; metrics that don't show up in normal heap dumps |
| [17](17-memory-pressure-and-oom/) | Memory Pressure & OOM | OOM killer, cgroup limits, container memory limits, GC behavior under pressure, swap thrashing, soft vs hard limits |

---

## Languages

Comparisons across **Go** (concurrent tri-color, escape analysis, `pprof`), **Java** (G1, ZGC, Shenandoah, JVM heap tuning), **Python** (refcount + cyclic GC, `tracemalloc`, the GIL's effect on alloc), and **Rust** (ownership, `Box` / `Rc` / `Arc`, no GC) — chosen to span the whole design space from "no GC at all" to "concurrent generational GC."

---

## Status

✅ **Content-complete — all 17 topics written across the six-file set (junior / middle / senior / professional / interview / tasks).**

---

## References

- *The Garbage Collection Handbook* — Jones, Hosking, Moss (the canonical reference)
- *What Every Programmer Should Know About Memory* — Ulrich Drepper (2007)
- *Systems Performance* — Brendan Gregg (memory chapters)
- Aleksey Shipilëv — JVM GC engineering talks and writeups

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
