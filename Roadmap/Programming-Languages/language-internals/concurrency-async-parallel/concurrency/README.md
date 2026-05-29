# Concurrency (Language Internals)

The language-level substrate that makes concurrent code _possible_ — threading models, primitives, and the pathologies that come with them. The two adjacent sub-sections — [Async Programming](../async-programming/) and [Parallel Programming](../parallel-programming/) — build on this foundation but tackle different problem shapes (non-blocking I/O vs CPU-bound work). Specific language tracks (Go goroutines, Java threads, Python asyncio, etc.) build on all three in [languages/](../../../languages/).

> Content under this section is being filled in. Sub-sections already laid out are listed below; deeper pages will fill in as the Roadmap grows.

---

## Sub-sections

- **[01 — Models](01-models/)** — preemptive vs cooperative, OS threads vs green threads / fibers / goroutines, actor model, CSP.
- **[02 — Primitives](02-primitives/)** — mutex, RWMutex, semaphores, barriers, atomics, channels, condition variables.
- **[03 — Patterns](03-patterns/)** — fan-in / fan-out, pipelines, worker pools, bounded concurrency, structured concurrency.
- **[05 — Race Conditions](05-race-conditions/)** — data races vs race conditions, the memory model, happens-before, race detectors.
- **[06 — Deadlock Detection](06-deadlock-detection/)** — lock ordering, cycle detection, timeouts, lock-free alternatives.

> _Async / await_ moved to its own sibling section: [Async Programming](../async-programming/).

---

## Related

- **[Async Programming](../async-programming/)** — event loops, coroutines, futures, runtimes (Tokio, libuv, asyncio).
- **[Parallel Programming](../parallel-programming/)** — SIMD, work-stealing, fork-join, data parallelism.
- **[Memory Management](../../memory-management/)** — the model under which concurrent reads/writes interleave.
- **[Languages › Go › Concurrency](../../../languages/golang/07-concurrency/)** — the most fleshed-out concrete track today.
- **[Quality Engineering › Performance](../../../quality-engineering/performance/)** — contention, scheduling, scaling limits.
