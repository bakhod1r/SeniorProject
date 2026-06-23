# Async Programming

> *"Async/await is what you reach for when the bottleneck is waiting, not computing."*

This roadmap is about **non-blocking programming models** — the runtime mechanics, language syntax, and patterns that let a single thread (or a small pool of them) keep thousands of in-flight operations alive at once. It is the half of the [Concurrency, Async & Parallel](../README.md) trio that targets *I/O-bound* workloads.

> Looking for *concurrency primitives* (mutex, channels, threads)? See **[Concurrency](../concurrency/)**.
>
> Looking for *CPU-bound* parallelism (SIMD, fork-join)? See **[Parallel Programming](../parallel-programming/)**.
>
> Looking for *language-specific async* — Python `asyncio`, JS Promises, Rust `tokio`, C# `Task`, Kotlin coroutines? Each `languages/<lang>/` track covers its own async story; this section is the cross-language substrate.

---

## Why a Dedicated Roadmap

Every modern mainstream language has an async story — and they're all subtly different:

- **JavaScript** invented the modern shape (callbacks → Promises → `async/await`) on a single-threaded event loop
- **Python** retrofitted `asyncio` onto an existing language and shipped two competing function-coloring worlds
- **Rust** made async zero-cost but pays for it in compile-time complexity (`Future`, `Pin`, `Send` bounds)
- **C#** popularised `async/await` syntax with a heavy multi-threaded `Task` runtime underneath
- **Go** rejected the syntax and made every function effectively async by giving it the goroutine
- **Kotlin** unified async + structured concurrency into coroutines, treated as first-class

Without the cross-language picture you can use any one of these, but you can't *judge between* them — and you don't see why one team's "make it async" rewrite turned a small problem into a 6-month rewrite.

| Roadmap | Question it answers |
|---|---|
| [Concurrency](../concurrency/README.md) | How do logical flows coordinate? |
| [Parallel Programming](../parallel-programming/README.md) | How do I keep all the cores busy? |
| **Async Programming** (this) | How do I do thousands of things at once without thousands of threads? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-why-async/) | Why Async (vs Threads) | The C10K problem, thread-per-connection cost, when async actually helps |
| [02](02-event-loop/) | The Event Loop | Reactor pattern, selectors (`epoll` / `kqueue` / `io_uring` / IOCP), single-thread loops vs work-stealing |
| [03](03-coroutines-and-generators/) | Coroutines & Generators | Stackful vs stackless, suspend/resume, the machinery underneath `async fn` |
| [04](04-futures-promises-tasks/) | Futures, Promises, Tasks | What each name means, eager vs lazy execution, completion vs continuation models |
| [05](05-async-await-syntax/) | `async` / `await` Syntax | Function colouring, what the compiler rewrites, state-machine codegen |
| [06](06-cancellation-and-timeouts/) | Cancellation & Timeouts | Cooperative cancellation, `CancellationToken`, Go's `context.Context`, structured cancellation |
| [07](07-backpressure/) | Back-pressure | When the producer outruns the consumer; bounded channels, `Stream` back-pressure, reactive-streams |
| [08](08-structured-concurrency/) | Structured Concurrency | Scoped lifetimes, no orphan tasks, Kotlin's `coroutineScope`, Swift's `TaskGroup`, Trio nurseries |
| [09](09-async-runtimes/) | Async Runtimes | Tokio (Rust), libuv (Node), asyncio (Python), .NET ThreadPool — what they do, how they differ |
| [10](10-mixing-async-and-blocking/) | Mixing Async and Blocking | Why `runBlocking` / `block_on` / sync calls inside async destroy performance; offloading patterns |
| [11](11-debugging-async-code/) | Debugging Async Code | Async stack traces, why a panic loses context, tracing across `await` points |
| [12](12-anti-patterns/) | Anti-patterns | "Async all the way down" mythology, fake async, fire-and-forget leaks, deadlocks via single-threaded loops |

---

## Languages

Cross-language comparison is the whole point. Examples in **JavaScript** (the original event-loop model), **Python** (`asyncio`), **Rust** (`tokio`, `async-std`), **C#** (`Task` / `async`), **Kotlin** (coroutines), and **Go** (the alternative-universe answer — no `async` keyword, just goroutines).

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Concurrency in C# Cookbook* — Stephen Cleary
- *Async/Await: The Why and How* — Bob Nystrom (the "What Color is Your Function" classic)
- *Asynchronous Programming in Rust* — official async book
- *Fluent Python* — Luciano Ramalho (asyncio chapters)
- *200 OK: Async I/O* — Brendan Burns and others on the runtime side

---

## Project Context

Part of the [Senior Project](../../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
