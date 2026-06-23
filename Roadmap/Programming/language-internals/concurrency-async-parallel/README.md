# Concurrency, Async & Parallel

Three closely-related but distinct domains in language internals — grouped here because the conceptual boundaries between them are the first thing a senior engineer needs to internalise, and the most common source of "we picked the wrong model" pain in real systems.

> *"Concurrency is about dealing with lots of things at once. Parallelism is about doing lots of things at once."* — Rob Pike

---

## The three sub-sections

| Section | Problem shape | Typical building blocks |
|---|---|---|
| **[Concurrency](concurrency/)** | Multiple logical flows that may overlap in time | Threads, mutexes, channels, actor model, CSP |
| **[Async Programming](async-programming/)** | I/O-bound work — don't block the thread on the network / disk | Event loops, coroutines, futures, `async/await`, runtimes (Tokio, libuv, asyncio) |
| **[Parallel Programming](parallel-programming/)** | CPU-bound work — use all the cores | SIMD, fork-join, work-stealing, parallel collections, GPU offload |

The three overlap in mechanism (an async runtime usually sits on a thread pool; a parallel framework usually relies on concurrency primitives), but they answer different questions. Mixing them up — "let's use `async` to make this faster" when the problem is CPU-bound — is the most common architectural mistake in this whole area.

---

## How to read this section

1. Start with **Concurrency** for the conceptual foundation (models, primitives, race conditions, deadlocks).
2. Read **Async Programming** when you're building services that talk to networks, databases, or files — anywhere the wall-clock time is dominated by waiting.
3. Read **Parallel Programming** when you have a measurably CPU-bound workload (image processing, simulation, large in-memory aggregation).

Most production systems eventually need bits of all three.

---

## Related

- **[Memory Management](../memory-management/)** — the memory model is what makes concurrent reads/writes well-defined (or not).
- **[Languages › Go › Concurrency](../../languages/golang/07-concurrency/)** — the most fleshed-out concrete track today.
- **[Quality Engineering › Performance](../../quality-engineering/performance/)** — where the practical payoff of getting this right shows up.
