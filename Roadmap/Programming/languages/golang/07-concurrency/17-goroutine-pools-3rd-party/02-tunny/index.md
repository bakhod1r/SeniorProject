---
layout: default
title: Index
parent: tunny
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/02-tunny/
---

# Jeffail/tunny

[Back](../)

`Jeffail/tunny` is a small, opinionated goroutine pool library written by Ashley Jeffail. It is built around a single mental model: **a fixed-size pool of long-lived workers, each of which receives a payload, processes it, and returns a result synchronously to the caller.** This is fundamentally different from the "fire-and-forget submit a closure" style of pools such as `ants`. With tunny, calling code blocks on `pool.Process(payload)` until a worker has finished and produced an answer.

Where `ants` optimises for **massive task fan-out** with millions of stateless jobs, tunny optimises for **CPU-bound, request/response style workloads** where:

- The amount of work per task is significant (image resizing, PDF rendering, JSON-schema validation, cryptographic operations, ML inference batching).
- The worker can keep expensive per-worker state alive between calls — a decoder, a buffer pool, a connection to a sidecar process, a model loaded in memory.
- Back-pressure must propagate naturally to the caller: if every worker is busy, the next `Process` call blocks until one is free.

The two flagship APIs are:

- **`tunny.NewFunc(n, func(any) any)`** — a one-line constructor that wraps a plain function as a stateless worker. Best for simple CPU-bound work.
- **`tunny.New(n, func() tunny.Worker)`** — a constructor that takes a factory of objects implementing the `Worker` interface. Best when each worker owns expensive state, must implement timeouts, or must clean up on shutdown.

The `Worker` interface itself is the heart of tunny:

```go
type Worker interface {
    Process(payload any) any
    BlockUntilReady()
    Interrupt()
    Terminate()
}
```

Four methods, no generics, no callbacks scattered across files — every concurrency primitive a worker needs is right there on one type. `Process` does the work. `BlockUntilReady` is the throttle: a worker can refuse to accept new payloads until a downstream resource (rate limit token, GPU slot, DB cursor) is free. `Interrupt` is how `ProcessTimed` and `ProcessCtx` deliver cancellation to the running worker. `Terminate` releases the worker's resources when the pool shuts down.

## Sub-pages

- [junior.md](junior.md) — `tunny.NewFunc`, calling `Process`, return values, `Close`, simple examples, the mental model
- [middle.md](middle.md) — The `Worker` interface in depth, `ProcessTimed`, `ProcessCtx`, `NewCallback`, pool sizing, common patterns
- [senior.md](senior.md) — Internals: `workerWrapper`, payload channels, request/response model, comparison with stdlib worker-pool patterns
- [professional.md](professional.md) — Production: CPU-bound pipelines, image processing, HTTP handler integration, observability, graceful shutdown, case studies
- [specification.md](specification.md) — API reference: types, methods, the `Worker` contract, error and panic semantics
- [interview.md](interview.md) — 30+ Q&A from entry level to architect, covering API, internals, and production trade-offs
- [tasks.md](tasks.md) — 15+ hands-on exercises: simple pools, image resizers, timeout enforcement, custom workers
- [find-bug.md](find-bug.md) — Buggy snippets to debug: leaked pools, blocked Process calls, payload races, double-close
- [optimize.md](optimize.md) — Performance scenarios: sizing, request batching, reducing payload allocations, sync.Pool integration

## When to read which file

If you have never used tunny before, start with `junior.md`. If you have used `pool.Process` once or twice but never written a custom `Worker`, jump to `middle.md`. If you need to understand exactly what happens between `Process(x)` and the worker goroutine — go to `senior.md`. If you are about to deploy a tunny-based service to production, `professional.md` is the canonical reference.

## When NOT to use tunny

Tunny is a **deliberately small** library. It does not give you:

- Dynamic pool resizing while running (use `ants`).
- Non-blocking submission with overflow queues (use `workerpool` or a custom channel).
- Per-task priorities or fair scheduling (build it yourself on top of channels).
- Goroutine-per-task semantics for IO-bound work (just use `go f()` with a `sync.WaitGroup`).

If your workload is "100k cheap network calls", tunny is the wrong shape. If your workload is "8 GPUs, 8 workers, each task takes 50 ms and returns a tensor", tunny is exactly the right shape.

## Mental anchor

> A tunny pool is a **bounded queue of identical workers**. You give it a payload, it gives you a result. The pool guarantees that no more than `N` payloads are being processed at any moment, regardless of how many goroutines are calling `Process` concurrently.

Everything else — timeouts, contexts, custom state, batching — is a thin layer on top of that single guarantee.

## Minimal example

```go
package main

import (
    "fmt"
    "runtime"

    "github.com/Jeffail/tunny"
)

func main() {
    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        n := payload.(int)
        return n * n
    })
    defer pool.Close()

    fmt.Println(pool.Process(7)) // 49
}
```

Three lines of pool code. The constructor takes a size and a function. `Process` is synchronous. `Close` is idempotent-ish — call it once, in a `defer`.

## How tunny compares to its siblings on this page

| Property            | tunny                          | ants                          | workerpool                    |
|---------------------|--------------------------------|-------------------------------|-------------------------------|
| Mental model        | Request/response worker        | Submit closure, fire-forget   | Submit closure, fire-forget   |
| Pool size           | Fixed at construction          | Dynamic, with options         | Fixed at construction         |
| Backpressure        | Callers block on Process       | Configurable                  | Bounded queue                 |
| Per-worker state    | First-class (Worker interface) | Possible but awkward          | Possible but awkward          |
| Best for            | CPU-bound, stateful workers    | Massive fan-out, IO-bound     | Stdlib-feel, simple jobs      |

Pick tunny when each task is **expensive, stateful, and synchronous**. Pick the others when each task is **cheap, stateless, and asynchronous**.
