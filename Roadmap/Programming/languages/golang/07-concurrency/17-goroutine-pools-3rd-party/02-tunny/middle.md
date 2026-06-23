---
layout: default
title: Middle
parent: tunny
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/02-tunny/middle/
---

# tunny — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Worker Interface](#the-worker-interface)
5. [Why an Interface and Not Just a Function](#why-an-interface-and-not-just-a-function)
6. [Process — Recap and Refinement](#process-recap-and-refinement)
7. [BlockUntilReady — Throttling Acceptance](#blockuntilready-throttling-acceptance)
8. [Interrupt — Server-Side Cancellation](#interrupt-server-side-cancellation)
9. [Terminate — Worker Shutdown](#terminate-worker-shutdown)
10. [tunny.New — Worker Factories](#tunny-new-worker-factories)
11. [ProcessTimed — Deadlines per Call](#processtimed-deadlines-per-call)
12. [ProcessCtx — Context-Aware Cancellation](#processctx-context-aware-cancellation)
13. [tunny.NewCallback — Free-Form Closures](#tunny-newcallback-free-form-closures)
14. [State, Reuse, and the Worker Lifecycle](#state-reuse-and-the-worker-lifecycle)
15. [Pool Sizing Revisited](#pool-sizing-revisited)
16. [Worked Examples](#worked-examples)
17. [Patterns](#patterns)
18. [Clean Code](#clean-code)
19. [Error Handling](#error-handling)
20. [Performance Tips](#performance-tips)
21. [Best Practices](#best-practices)
22. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
23. [Common Mistakes](#common-mistakes)
24. [Common Misconceptions](#common-misconceptions)
25. [Tricky Points](#tricky-points)
26. [Test Yourself](#test-yourself)
27. [Tricky Questions](#tricky-questions)
28. [Cheat Sheet](#cheat-sheet)
29. [Self-Assessment Checklist](#self-assessment-checklist)
30. [Summary](#summary)
31. [What You Can Build Now](#what-you-can-build-now)
32. [Further Reading](#further-reading)
33. [Related Topics](#related-topics)
34. [Diagrams](#diagrams)

---

## Introduction
> Focus: "How do I give each worker its own state, enforce a deadline on each call, propagate a context, and decide between the three constructors?"

At the junior level you treated tunny as a single function: `NewFunc(n, f)`. That works for many real workloads, but it has three serious limits:

1. The worker function is stateless — there is no way to give each of the `n` workers a private buffer, a decoder, a database connection, or a model loaded in memory.
2. There is no way to cancel an in-flight call. If `Process` is waiting and the caller wants to give up, it cannot.
3. There is no way for a worker to refuse to accept more work — for example, when a downstream rate limit has not yet replenished.

The middle level introduces the **`Worker` interface**, which solves all three. You will also learn the deadline-aware variants `ProcessTimed` and `ProcessCtx`, and the convenience constructor `NewCallback`.

After this file you should be able to:

- Define a `Worker` type for a stateful workload (e.g. an image decoder with reusable buffers).
- Choose the right constructor (`NewFunc` vs `New` vs `NewCallback`) for a given problem.
- Use `ProcessTimed` and `ProcessCtx` correctly, understanding what they actually do.
- Implement `BlockUntilReady` for downstream backpressure.
- Implement `Interrupt` so cancellation reaches the worker.
- Build a typed wrapper over the middle-level API that hides the `any` plumbing.

---

## Prerequisites

- Comfortable with everything in [junior.md](junior.md). If you cannot reproduce the parallel SHA-256 example from memory, go back.
- Familiar with **interfaces in Go**, especially how to satisfy an interface implicitly with a struct.
- Familiar with **`context.Context`** — at least `context.WithTimeout`, `context.WithCancel`, and how to check `ctx.Err()`.
- Familiar with **`time.Duration`** and `time.After` or `time.NewTimer`.
- Familiar with **`sync.Pool`** — the standard-library object pool. We use it together with tunny.
- Familiar with **`sync.Mutex` and `sync/atomic`** for protecting worker-local state.

If you are weak on `context.Context`, take a detour to that chapter. The middle-level tunny API is mostly about plumbing cancellation; you need a feel for how Go does that idiomatically.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`Worker` interface** | The interface a tunny worker must satisfy: `Process`, `BlockUntilReady`, `Interrupt`, `Terminate`. |
| **`tunny.New`** | The full constructor. Takes a *factory* function that returns a fresh `Worker` for each of the `n` slots. |
| **Factory** | A `func() tunny.Worker`. Called `n` times by `tunny.New` to populate the pool. |
| **`tunny.NewCallback`** | A convenience constructor where each payload is itself a `func()`. The worker just calls it. |
| **`ProcessTimed`** | Submit a payload with a per-call timeout. Returns `(result, error)`; error is `tunny.ErrJobTimedOut` on timeout. |
| **`ProcessCtx`** | Submit a payload bound to a `context.Context`. Returns when the context is done or the worker finishes. |
| **`Interrupt()`** | Method on `Worker` invoked by tunny when a timeout fires or a context is cancelled. The worker should react: stop computing, return early. |
| **`BlockUntilReady()`** | Method on `Worker` invoked *before* tunny hands the worker a payload. The worker can block to apply downstream backpressure. |
| **`Terminate()`** | Method on `Worker` invoked once, when the pool is closed. The worker should release its resources. |
| **Per-worker state** | Memory or resources owned by a single worker instance, surviving across many `Process` calls, but not shared across workers. |
| **`tunny.ErrPoolNotRunning`** | Returned by `ProcessTimed`/`ProcessCtx` if the pool has been closed. |
| **`tunny.ErrJobTimedOut`** | Returned by `ProcessTimed` when the deadline elapses before the worker finishes. |

---

## The Worker Interface

This is the interface that tunny's machinery is built around:

```go
package tunny

type Worker interface {
    // Process is called by the pool with the payload from a Process call.
    // The return value becomes the result of the original Process call.
    Process(payload interface{}) interface{}

    // BlockUntilReady is called *before* Process. It can block to apply
    // backpressure: a worker can refuse to accept work until a downstream
    // resource is available.
    BlockUntilReady()

    // Interrupt is called when a ProcessTimed deadline elapses or a
    // ProcessCtx context is cancelled while the worker is mid-call.
    // The worker should use this to abort cooperatively.
    Interrupt()

    // Terminate is called once when the pool is closed. The worker
    // should release any owned resources here.
    Terminate()
}
```

Four methods, no generics, no hidden state. The Go interface in its purest form.

To create a pool, you write a struct that satisfies this interface, then a factory:

```go
type myWorker struct {
    // per-worker state here
}

func (w *myWorker) Process(p interface{}) interface{} { ... }
func (w *myWorker) BlockUntilReady()                  {}
func (w *myWorker) Interrupt()                        {}
func (w *myWorker) Terminate()                        {}

pool := tunny.New(runtime.NumCPU(), func() tunny.Worker {
    return &myWorker{}
})
defer pool.Close()
```

That is the whole shape. The methods you do not need can be empty.

---

## Why an Interface and Not Just a Function

This is a design choice worth pausing on. Other pool libraries (notably `ants`) take a closure on `Submit`. Tunny takes an object on `New`. Why?

Three reasons:

### 1. Per-worker state is first-class

If your worker needs an expensive resource — a 200 MB ML model, a database connection, a buffered codec — you want to create it once per worker and reuse it across many calls. With a closure-on-submit model, you would have to either share the resource across goroutines (more locking) or recreate it per call (wasted work). With a method on a struct, the resource lives naturally in a field.

```go
type modelWorker struct {
    model *ml.Model  // loaded once, used for thousands of inferences
    buf   bytes.Buffer
}

func (w *modelWorker) Process(p interface{}) interface{} {
    req := p.(InferReq)
    w.buf.Reset()
    return w.model.Predict(req, &w.buf)
}
```

That `model` field is the entire reason `tunny.New` exists.

### 2. Cancellation has a hook

A bare function cannot be cancelled — the runtime cannot reach into a running function and stop it. But a struct with an `Interrupt` method can be notified: "you should stop". Whether the worker actually stops is up to the worker's implementation — it can poll a flag, close a sub-context, or do nothing if cancellation is not meaningful.

### 3. Backpressure is symmetric

Junior tunny gives backpressure to the caller (the pool channel is bounded by `n`). Middle tunny adds the dual: workers can apply backpressure too, via `BlockUntilReady`. This is essential when the bottleneck is downstream of the worker — a rate-limited API, a quota'd cloud service, a slow database.

These three powers are unlocked only by promoting "the worker" from a function to an object. The cost — a few more lines of boilerplate — is small compared to the flexibility.

---

## Process — Recap and Refinement

`Process` on the `Worker` interface is the same idea as the function passed to `NewFunc`:

```go
func (w *Worker) Process(payload interface{}) interface{}
```

It is called by the pool when a payload has been assigned to this worker. It runs in the worker's goroutine. It must:

- Be deterministic given the payload (no hidden state with surprising effects).
- Be safe to call repeatedly — many `Process` calls per worker over the worker's lifetime.
- Not block forever — pair every potentially-blocking operation with a way to interrupt.

It must NOT:

- Spawn long-lived goroutines without tying them to the worker's lifetime.
- Hold locks across calls (locks should be acquired and released within one `Process` invocation).
- Touch state that another worker also touches, unless that state is synchronised.

A canonical `Process`:

```go
func (w *imageWorker) Process(p interface{}) interface{} {
    req := p.(ResizeReq)
    w.buf.Reset()                // reuse worker-local buffer
    img, err := decode(req.Data, &w.buf)
    if err != nil {
        return ResizeRes{Err: err}
    }
    out, err := resize(img, req.W, req.H)
    if err != nil {
        return ResizeRes{Err: err}
    }
    return ResizeRes{Image: out}
}
```

Each `Process` does the same kind of work, with the same input/output shape, against the same worker-local buffer.

---

## BlockUntilReady — Throttling Acceptance

`BlockUntilReady` is called by the pool *before* `Process` is called. The pool guarantees: "I have a payload for you. Are you ready?" The worker can:

- Return immediately (the default behaviour — empty method).
- Block for any amount of time until it is willing to accept.

Why is this useful? Consider three scenarios.

### Scenario A — token bucket rate limit

The downstream service allows 10 requests per second. Without `BlockUntilReady`, you would need a rate limiter inside `Process`, where it adds latency *after* the worker has already been assigned. With `BlockUntilReady`, the worker simply does not raise its hand until a token is available — leaving the pool free to dispatch elsewhere.

```go
type rateLimitedWorker struct {
    lim *rate.Limiter
}

func (w *rateLimitedWorker) BlockUntilReady() {
    _ = w.lim.Wait(context.Background())
}

func (w *rateLimitedWorker) Process(p interface{}) interface{} {
    // ... no token check needed; we already have one
    return callDownstream(p)
}
```

### Scenario B — GPU slot

One GPU, four workers, each worker can only run when the GPU is free.

```go
type gpuWorker struct {
    gpuSem chan struct{}  // buffered, size 1, shared across workers
    gpu    *GPUDevice
}

func (w *gpuWorker) BlockUntilReady() {
    w.gpuSem <- struct{}{} // acquire
}

func (w *gpuWorker) Process(p interface{}) interface{} {
    defer func() { <-w.gpuSem }() // release
    return w.gpu.Run(p)
}
```

Note: the semaphore is *shared* across worker instances. Workers do not share `Process` state, but they can share orthogonal resources.

### Scenario C — circuit breaker

If a circuit breaker is open, do not accept work:

```go
func (w *circuitWorker) BlockUntilReady() {
    for {
        if w.breaker.State() == "closed" {
            return
        }
        time.Sleep(100 * time.Millisecond)
    }
}
```

Better: use a context-aware wait, but you get the idea.

### When to leave `BlockUntilReady` empty

For most CPU-bound workers without external rate limits, the method is empty. Do not add a `BlockUntilReady` "just in case" — leave it empty until you have a concrete reason.

---

## Interrupt — Server-Side Cancellation

`Interrupt` is the pool's way of telling the worker: "the caller has given up; stop if you can."

It is invoked by tunny:

- When a `ProcessTimed` deadline elapses while the worker is mid-call.
- When a `ProcessCtx` context is cancelled while the worker is mid-call.

`Interrupt` runs in a different goroutine from `Process` — typically the goroutine that was waiting on the result. So it must be safe to call concurrently with `Process`.

Implementations vary:

### Pattern 1 — atomic flag

The worker checks a flag periodically inside `Process`:

```go
type cancellableWorker struct {
    stop atomic.Bool
}

func (w *cancellableWorker) Process(p interface{}) interface{} {
    w.stop.Store(false)
    n := p.(int)
    sum := 0
    for i := 0; i < n; i++ {
        if w.stop.Load() {
            return -1
        }
        sum += slowOp(i)
    }
    return sum
}

func (w *cancellableWorker) Interrupt() {
    w.stop.Store(true)
}
```

This is the most flexible pattern. The granularity of cancellation is whatever you choose: every iteration, every 1000 iterations, every second.

### Pattern 2 — close a per-call channel

```go
type cancellableWorker struct {
    cancel chan struct{}
}

func (w *cancellableWorker) Process(p interface{}) interface{} {
    w.cancel = make(chan struct{})
    select {
    case <-time.After(5 * time.Second):
        return "done"
    case <-w.cancel:
        return "cancelled"
    }
}

func (w *cancellableWorker) Interrupt() {
    close(w.cancel)
}
```

Beware: if `Interrupt` is called after `Process` returns, `close` on a stale channel panics. Guard with `sync.Once` or a state machine.

### Pattern 3 — cancel a sub-context

If your worker does its work via a function that takes a `context.Context`, the cleanest pattern:

```go
type ctxWorker struct {
    mu     sync.Mutex
    cancel context.CancelFunc
}

func (w *ctxWorker) Process(p interface{}) interface{} {
    ctx, cancel := context.WithCancel(context.Background())
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    defer cancel()

    return doWork(ctx, p)
}

func (w *ctxWorker) Interrupt() {
    w.mu.Lock()
    if w.cancel != nil {
        w.cancel()
    }
    w.mu.Unlock()
}
```

This is the production pattern for any worker whose underlying functions accept a `context.Context`. We will see in `ProcessCtx` that you should propagate the *caller's* context where possible — but the above shape is the right skeleton.

### When `Interrupt` is a no-op

For a truly atomic operation that cannot be interrupted mid-way — say, a CGo call into a synchronous C library — `Interrupt` cannot do anything. Leave the method empty. The deadline will fire from the caller's perspective, the worker will finish naturally a bit later, and the worker's result will be discarded by tunny.

That last sentence is important: even if `Interrupt` is a no-op, the deadline still fires correctly from the caller's side. The worker just keeps wasting CPU until it returns. So while a no-op `Interrupt` is legal, it is wasteful.

---

## Terminate — Worker Shutdown

`Terminate` is called exactly once on each worker, when the pool is closed. The worker should:

- Close any owned files.
- Close any owned network connections.
- Free any large buffers (let GC happen sooner).
- Stop any goroutines the worker spawned (rare, but possible).

Example:

```go
type dbWorker struct {
    conn *sql.Conn
}

func (w *dbWorker) Terminate() {
    if w.conn != nil {
        _ = w.conn.Close()
    }
}
```

`Terminate` is **not** called when the worker is busy. The pool waits for the worker to finish its current `Process` before calling `Terminate`. So you do not have to defend against racing with `Process`.

What you must defend against: `Terminate` is called once. Make it idempotent if you can. Setting fields to `nil` after closing them is a small defensive habit:

```go
func (w *dbWorker) Terminate() {
    if w.conn != nil {
        _ = w.conn.Close()
        w.conn = nil
    }
}
```

This protects against future code paths that might accidentally call `Terminate` again.

---

## tunny.New — Worker Factories

The full constructor:

```go
func New(n int, ctor func() Worker) *Pool
```

`ctor` is the factory. It is called `n` times, once for each worker slot. Each call should return a fresh, independent `Worker` instance.

A typical factory:

```go
func newImageWorker() tunny.Worker {
    return &imageWorker{
        buf: make([]byte, 0, 64*1024),
    }
}

pool := tunny.New(runtime.NumCPU(), newImageWorker)
```

The factory may panic if construction fails. The panic will propagate out of `tunny.New`. So fail-fast initialisation (cannot load model, cannot open file) is fine in the factory — your program crashes at startup, which is what you want for fatal config errors.

What the factory does NOT do:

- It does not run on every `Process` call. Only at pool construction (and on `SetSize` for the new slots).
- It does not run in a goroutine you control. Tunny calls it from the goroutine that called `New`.
- It does not need to be reentrant — it is called sequentially.

A common subtle bug: capturing a *shared* resource by reference, then mutating it in each factory call:

```go
// WRONG
shared := &Config{}
pool := tunny.New(4, func() tunny.Worker {
    shared.WorkerID++  // ???
    return &worker{cfg: shared}
})
```

All four workers end up with the same `cfg` pointer; the `WorkerID` counter is shared via that pointer. If you wanted independent IDs, you needed to take a copy or pass a value, not a pointer.

The right shape is to pass values, not shared pointers, unless sharing is intentional:

```go
var nextID atomic.Int64
pool := tunny.New(4, func() tunny.Worker {
    return &worker{id: nextID.Add(1)}
})
```

---

## ProcessTimed — Deadlines per Call

```go
func (p *Pool) ProcessTimed(payload interface{}, timeout time.Duration) (interface{}, error)
```

`ProcessTimed` is like `Process` but with a deadline. If the deadline elapses, it returns `tunny.ErrJobTimedOut` and the result is discarded.

Critical: there are **two phases** during which the timeout matters:

1. **Waiting for a worker.** If all workers are busy, the caller is queued. The deadline ticks during this wait.
2. **Worker is running.** Once a worker has been assigned, the deadline continues to tick.

In both phases, the timeout is total. So `ProcessTimed(x, 5*time.Second)` means "give me a result or an error within 5 seconds total."

If the timeout fires during phase 1 (waiting), the caller gets the error without ever having dispatched the payload. No worker runs.

If the timeout fires during phase 2 (worker is running), tunny calls `Interrupt()` on the worker. The worker is expected to abort cooperatively. Tunny returns the error to the caller. The worker's eventual return value is discarded.

Example:

```go
result, err := pool.ProcessTimed(req, 200*time.Millisecond)
if err == tunny.ErrJobTimedOut {
    return ErrSlow
}
if err == tunny.ErrPoolNotRunning {
    return ErrShuttingDown
}
return result.(MyResult), nil
```

Two distinct errors. Handle both. There are no others (today).

### Timeout granularity

`time.Duration` is nanosecond precision. Tunny does not promise nanosecond-precision deadlines — under load, deadline detection is typically within a few hundred microseconds. For most workloads this is more than precise enough.

### What `Interrupt` actually does when timeout fires

A subtlety: tunny calls `Interrupt` once, immediately when the timeout fires. The worker's `Process` is still running. The worker's `Process` might or might not honour the interrupt. If it does not, the worker just continues running. The caller already has its error and has moved on. The pool will not give that worker a new payload until `Process` finally returns. Meanwhile other workers are still serving traffic.

This is "graceful, eventually." The worker that was running a timed-out job is effectively a write-off until its current call completes. If you have many calls timing out, you can starve the pool. Plan timeouts to be longer than the typical work duration.

---

## ProcessCtx — Context-Aware Cancellation

```go
func (p *Pool) ProcessCtx(ctx context.Context, payload interface{}) (interface{}, error)
```

`ProcessCtx` is the context-aware counterpart of `ProcessTimed`. It returns when either:

- The worker finishes its `Process` — you get `(result, nil)`.
- `ctx.Done()` closes — you get `(nil, ctx.Err())`. Internally, `Interrupt()` is invoked on the worker.

In modern Go, this is the preferred shape, because `context.Context` carries more than just a deadline — it can be cancelled by the caller for any reason (user clicked stop, parent operation aborted, etc).

Example:

```go
ctx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
defer cancel()
result, err := pool.ProcessCtx(ctx, req)
if err != nil {
    if errors.Is(err, context.DeadlineExceeded) {
        return ErrSlow
    }
    if errors.Is(err, context.Canceled) {
        return ErrClientGone
    }
    if errors.Is(err, tunny.ErrPoolNotRunning) {
        return ErrShuttingDown
    }
    return err
}
return result.(MyResult), nil
```

`ProcessCtx` is what you should use in HTTP handlers. The request's context (via `r.Context()`) already encodes the client's lifetime; passing it to `ProcessCtx` means client disconnect propagates all the way to the worker.

### When `ctx` already has a deadline

`ProcessCtx` honours whatever cancellation behaviour the context has. There is no separate timeout argument. If the caller wants a timeout, they put it in the context. This is the idiomatic Go shape.

### What if `Process` does not honour Interrupt?

Same as before. The caller gets the error immediately. The worker keeps running. Eventually the worker finishes and is returned to the pool. You have effectively rented out a worker for the duration of the (now-discarded) operation.

The lesson: if you use `ProcessCtx` or `ProcessTimed`, you owe yourself a thoughtful `Interrupt` implementation. Otherwise you have given the *caller* an SLA you did not give the *worker*.

---

## tunny.NewCallback — Free-Form Closures

The third constructor:

```go
func NewCallback(n int) *Pool
```

`NewCallback` creates a pool whose payload is a `func()`. The worker just calls it.

```go
pool := tunny.NewCallback(runtime.NumCPU())
defer pool.Close()

pool.Process(func() {
    fmt.Println("hello from a callback")
})
```

When to use:

- Lots of small, independent CPU-bound tasks with different shapes.
- You do not want to define a payload type for each.
- You do not need a result back (the callback's return value is discarded).

When NOT to use:

- You need a typed return value (use `NewFunc` or `New`).
- You need cancellation (callbacks do not see deadlines).
- You care about avoiding closure allocation per call (every payload is a new closure).

In practice, `NewCallback` is more of a curiosity than a workhorse. You will likely use `NewFunc` or `New` for almost every real workload.

A concrete example where `NewCallback` makes sense:

```go
pool := tunny.NewCallback(runtime.NumCPU())
defer pool.Close()

// Many heterogeneous one-off tasks.
var wg sync.WaitGroup
for _, task := range tasks {
    task := task
    wg.Add(1)
    pool.Process(func() {
        defer wg.Done()
        task.Run()
    })
}
wg.Wait()
```

The `wg.Done` lives inside the closure. The closure's signature is rigid (`func()`) so all coordination must be inside it.

---

## State, Reuse, and the Worker Lifecycle

Each worker is created once, used many times, destroyed once. Visually:

```
              construct (ctor())
                     │
                     ▼
                  ┌──────┐
            ┌────▶│ Idle │◀────┐
            │     └──────┘     │
   BlockUntilReady             │
            │                  │
            ▼                  │
       ┌─────────┐             │
       │ Process │─── return ──┘
       └─────────┘
            │
            └── (on pool close, after current Process)
                     │
                     ▼
                Terminate()
```

The Idle → BlockUntilReady → Process → Idle loop runs many times. Then exactly one Terminate at the end.

This shape is similar to a Java thread-pool worker, a Tokio task, a CLR thread-pool work item. The names differ; the lifecycle is universal.

### State across calls

The worker struct's fields are private to that worker. You can mutate them freely inside `Process` without locks, as long as nothing else touches them. (Note: `Interrupt` and `Terminate` run in different goroutines — if they read the same fields, you need synchronisation.)

A typical pattern:

```go
type worker struct {
    // Process-only state: no locks needed.
    buf  []byte
    enc  *json.Encoder

    // Shared with Interrupt: needs synchronisation.
    mu     sync.Mutex
    cancel context.CancelFunc

    // Shared with Terminate: needs synchronisation (or only-once semantics).
    closed atomic.Bool
}
```

Discipline yourself: every field has exactly one "owner" set of methods. Document who can touch each field.

---

## Pool Sizing Revisited

At the middle level, sizing decisions become a bit richer:

- For pure CPU-bound work without external constraints: `runtime.NumCPU()`.
- For workers that wait on a downstream resource (rate limiter, GPU, database): size = max parallelism allowed by the downstream. There is no point having more workers than slots.
- For workers that mix CPU and IO: `2 * runtime.NumCPU()` is a defensible default; measure.
- For workers with very large per-worker memory: smaller is better. If each worker holds a 500 MB model, you may have `n = 2` on a 1 GB box even with 16 cores.

A useful framing: `pool size = min(CPU cores, downstream parallelism, memory budget / per-worker footprint)`.

Three constraints, one of them is the bottleneck, that one sets `n`.

---

## Worked Examples

### Example 1 — image worker with reusable buffer

```go
package main

import (
    "bytes"
    "image"
    _ "image/jpeg"
    "image/png"
    "log"
    "os"
    "path/filepath"
    "runtime"
    "sync"

    "github.com/Jeffail/tunny"
    "golang.org/x/image/draw"
)

type ResizeJob struct {
    InPath, OutPath string
    W, H            int
}

type ResizeResult struct {
    Path string
    Err  error
}

type imageWorker struct {
    buf bytes.Buffer
}

func (w *imageWorker) Process(p interface{}) interface{} {
    job := p.(ResizeJob)
    f, err := os.Open(job.InPath)
    if err != nil {
        return ResizeResult{Path: job.InPath, Err: err}
    }
    defer f.Close()

    w.buf.Reset()
    if _, err := w.buf.ReadFrom(f); err != nil {
        return ResizeResult{Path: job.InPath, Err: err}
    }
    src, _, err := image.Decode(&w.buf)
    if err != nil {
        return ResizeResult{Path: job.InPath, Err: err}
    }

    dst := image.NewRGBA(image.Rect(0, 0, job.W, job.H))
    draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)

    out, err := os.Create(job.OutPath)
    if err != nil {
        return ResizeResult{Path: job.InPath, Err: err}
    }
    defer out.Close()
    if err := png.Encode(out, dst); err != nil {
        return ResizeResult{Path: job.InPath, Err: err}
    }
    return ResizeResult{Path: job.InPath}
}

func (w *imageWorker) BlockUntilReady() {}
func (w *imageWorker) Interrupt()       {}
func (w *imageWorker) Terminate()       {}

func main() {
    inputs, _ := filepath.Glob("input/*.jpg")
    pool := tunny.New(runtime.NumCPU(), func() tunny.Worker {
        return &imageWorker{}
    })
    defer pool.Close()

    var wg sync.WaitGroup
    for _, in := range inputs {
        in := in
        out := filepath.Join("output", filepath.Base(in)+".png")
        wg.Add(1)
        go func() {
            defer wg.Done()
            r := pool.Process(ResizeJob{in, out, 128, 128}).(ResizeResult)
            if r.Err != nil {
                log.Printf("resize %s: %v", r.Path, r.Err)
            }
        }()
    }
    wg.Wait()
}
```

Notice: the `bytes.Buffer` lives on the worker. Across thousands of calls, it grows once to the size of the largest JPEG and stays that size, eliminating GC pressure from re-allocating buffers per call.

### Example 2 — cancellable worker

```go
type cancellableWorker struct {
    mu     sync.Mutex
    cancel context.CancelFunc
}

func (w *cancellableWorker) Process(p interface{}) interface{} {
    ctx, cancel := context.WithCancel(context.Background())
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    defer func() {
        w.mu.Lock()
        w.cancel = nil
        w.mu.Unlock()
        cancel()
    }()

    return slowWork(ctx, p)
}

func (w *cancellableWorker) BlockUntilReady() {}

func (w *cancellableWorker) Interrupt() {
    w.mu.Lock()
    if w.cancel != nil {
        w.cancel()
    }
    w.mu.Unlock()
}

func (w *cancellableWorker) Terminate() {}

func slowWork(ctx context.Context, p any) any {
    select {
    case <-time.After(2 * time.Second):
        return "done"
    case <-ctx.Done():
        return ctx.Err().Error()
    }
}
```

Use with `ProcessCtx`:

```go
pool := tunny.New(4, func() tunny.Worker { return &cancellableWorker{} })
defer pool.Close()

ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
defer cancel()

r, err := pool.ProcessCtx(ctx, "hello")
fmt.Println(r, err) // "context deadline exceeded" via slowWork; err is ctx.Err()
```

When the timeout fires, tunny calls `Interrupt`, which cancels the worker's inner context, which unblocks the `select` in `slowWork`, which returns. The caller receives `ctx.Err()` as `err`.

### Example 3 — rate-limited downstream

```go
import (
    "context"
    "fmt"
    "net/http"
    "sync"
    "time"

    "github.com/Jeffail/tunny"
    "golang.org/x/time/rate"
)

type apiWorker struct {
    client *http.Client
    lim    *rate.Limiter
}

func (w *apiWorker) BlockUntilReady() {
    _ = w.lim.Wait(context.Background())
}

func (w *apiWorker) Process(p interface{}) interface{} {
    url := p.(string)
    resp, err := w.client.Get(url)
    if err != nil {
        return err
    }
    resp.Body.Close()
    return resp.StatusCode
}

func (w *apiWorker) Interrupt() {}
func (w *apiWorker) Terminate() {}

func main() {
    sharedLimiter := rate.NewLimiter(rate.Every(100*time.Millisecond), 1) // 10 req/s
    sharedClient := &http.Client{Timeout: 5 * time.Second}

    pool := tunny.New(8, func() tunny.Worker {
        return &apiWorker{client: sharedClient, lim: sharedLimiter}
    })
    defer pool.Close()

    urls := []string{ /* 100 URLs */ }
    var wg sync.WaitGroup
    for _, u := range urls {
        u := u
        wg.Add(1)
        go func() {
            defer wg.Done()
            switch v := pool.Process(u).(type) {
            case int:
                fmt.Println(u, "->", v)
            case error:
                fmt.Println(u, "err:", v)
            }
        }()
    }
    wg.Wait()
}
```

Eight workers, but all share one limiter. The pool's "8" caps the latency parallelism; the limiter's "10 req/s" caps the throughput. Both constraints are honoured.

### Example 4 — pool with a DB connection per worker

```go
type dbWorker struct {
    db *sql.DB
}

func (w *dbWorker) Process(p interface{}) interface{} {
    q := p.(string)
    var out string
    err := w.db.QueryRow(q).Scan(&out)
    if err != nil {
        return err
    }
    return out
}

func (w *dbWorker) BlockUntilReady() {}
func (w *dbWorker) Interrupt()       {}
func (w *dbWorker) Terminate()       { _ = w.db.Close() }

func main() {
    pool := tunny.New(4, func() tunny.Worker {
        db, err := sql.Open("postgres", "...")
        if err != nil {
            panic(err)
        }
        return &dbWorker{db: db}
    })
    defer pool.Close()
    // use pool.Process(...)
}
```

A minor concern: `sql.DB` is itself a connection pool. Wrapping it inside another pool is sometimes unnecessary. But if your "work" is more than a single query — say, a multi-statement transaction with intermediate logic — a tunny worker around a DB cursor can simplify the code.

### Example 5 — generic typed wrapper at the middle level

```go
type Pool[In, Out any] struct {
    inner *tunny.Pool
}

type WorkerFunc[In, Out any] interface {
    Process(In) Out
    Interrupt()
    Terminate()
}

func New[In, Out any](n int, factory func() WorkerFunc[In, Out]) *Pool[In, Out] {
    return &Pool[In, Out]{
        inner: tunny.New(n, func() tunny.Worker {
            return &adapter[In, Out]{w: factory()}
        }),
    }
}

type adapter[In, Out any] struct {
    w WorkerFunc[In, Out]
}

func (a *adapter[In, Out]) Process(p interface{}) interface{} {
    return a.w.Process(p.(In))
}
func (a *adapter[In, Out]) BlockUntilReady() {}
func (a *adapter[In, Out]) Interrupt()       { a.w.Interrupt() }
func (a *adapter[In, Out]) Terminate()       { a.w.Terminate() }

func (p *Pool[In, Out]) Process(in In) Out {
    return p.inner.Process(in).(Out)
}
func (p *Pool[In, Out]) Close() { p.inner.Close() }
```

Now the caller writes:

```go
type myW struct{}
func (myW) Process(n int) int { return n * 2 }
func (myW) Interrupt()        {}
func (myW) Terminate()        {}

p := New[int, int](4, func() WorkerFunc[int, int] { return myW{} })
defer p.Close()
fmt.Println(p.Process(7)) // 14
```

This is the production-grade shape. The `interface{}` is invisible. The compiler enforces types.

---

## Patterns

### Pattern: worker with retryable Interrupt

Sometimes `Interrupt` may be called multiple times for one `Process`. To be safe, idempotent:

```go
func (w *worker) Interrupt() {
    w.mu.Lock()
    defer w.mu.Unlock()
    if w.cancel != nil {
        w.cancel()
        w.cancel = nil
    }
}
```

### Pattern: composite worker

Some workers internally orchestrate sub-workers. A simple example:

```go
type pipelineWorker struct {
    decode *imageWorker
    resize *resizeWorker
    encode *encodeWorker
}

func (w *pipelineWorker) Process(p interface{}) interface{} {
    img := w.decode.Process(p)
    if err, ok := img.(error); ok {
        return err
    }
    resized := w.resize.Process(img)
    if err, ok := resized.(error); ok {
        return err
    }
    return w.encode.Process(resized)
}
```

Note: the sub-workers here are NOT in their own tunny pools. They are plain types reused inside the orchestrating worker. The shape is fine, but you have lost compile-time clarity about which step is "expensive". Use it sparingly.

### Pattern: optional interface satisfaction

If you only need `Process` and the other methods are always empty, define a helper:

```go
type emptyHooks struct{}

func (emptyHooks) BlockUntilReady() {}
func (emptyHooks) Interrupt()       {}
func (emptyHooks) Terminate()       {}

type quickWorker struct {
    emptyHooks
    // ... real fields
}
```

This is a tiny ergonomics win — embedding a type that satisfies three of the four methods. Common in libraries that wrap tunny.

### Pattern: per-call cancellation propagation

When using `ProcessCtx`, your worker should ideally accept a `context.Context` for the actual work. Wire it through:

```go
type ctxAware struct {
    mu     sync.Mutex
    cancel context.CancelFunc
}

func (w *ctxAware) Process(p interface{}) interface{} {
    ctx, cancel := context.WithCancel(context.Background())
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    defer cancel()
    return doWork(ctx, p)
}

func (w *ctxAware) Interrupt() {
    w.mu.Lock()
    if w.cancel != nil {
        w.cancel()
    }
    w.mu.Unlock()
}

func (w *ctxAware) BlockUntilReady() {}
func (w *ctxAware) Terminate()       {}
```

This is the most robust shape for production workers. Anything that respects `ctx.Done()` is automatically cancellable.

### Pattern: encoding deadlines in the payload

If you want to give *each call* its own deadline without using `ProcessTimed`, pack it into the payload:

```go
type Job struct {
    Deadline time.Time
    Data     []byte
}

func (w *worker) Process(p interface{}) interface{} {
    j := p.(Job)
    if time.Now().After(j.Deadline) {
        return ErrDeadline
    }
    // ... do work, periodically check time.Now().After(j.Deadline)
}
```

This loses the pool-level wait timeout but gives you fine-grained, payload-driven deadlines.

---

## Clean Code

A few habits that pay off at the middle level:

- **Group method definitions on the worker together.** All four `Worker` methods next to each other, in the canonical order (`Process`, `BlockUntilReady`, `Interrupt`, `Terminate`). Reviewers expect this order.
- **Document fields by lifetime.** Comment each field with which methods read or write it.
- **Keep the worker struct flat.** If you have nested structs with logic, you have a sub-system and not a worker. Refactor.
- **Name the worker type after the workload, not the library.** `imageWorker`, not `tunnyWorker`. The fact that tunny is the transport is an implementation detail.
- **Hide the `tunny.Pool` behind a typed wrapper at module boundaries.** Internally you may use `*tunny.Pool` directly; externally, expose a typed interface.
- **Use `BlockUntilReady` only when you actually need it.** An empty `BlockUntilReady` is fine and expected.

---

## Error Handling

The middle API gives you two real error returns:

- `tunny.ErrJobTimedOut` from `ProcessTimed`.
- `tunny.ErrPoolNotRunning` from `ProcessTimed` and `ProcessCtx` after `Close`.

`ProcessCtx` also returns `ctx.Err()` — either `context.DeadlineExceeded` or `context.Canceled` — when the context fires before the worker finishes.

Standard handling:

```go
result, err := pool.ProcessCtx(ctx, req)
switch {
case errors.Is(err, context.DeadlineExceeded):
    metrics.Inc("pool.timeout")
    return ErrTimeout
case errors.Is(err, context.Canceled):
    metrics.Inc("pool.cancelled")
    return ErrCancelled
case errors.Is(err, tunny.ErrPoolNotRunning):
    metrics.Inc("pool.closed")
    return ErrShuttingDown
case err != nil:
    return fmt.Errorf("unexpected pool error: %w", err)
}
// success
return result.(MyResult), nil
```

Anything else returned is an unexpected error. Always handle the catch-all.

### Worker-side errors

Inside the worker, the `Process` method has no `error` return — it returns `any`. The convention is to encode errors in the result struct:

```go
type res struct {
    Out string
    Err error
}
```

Or, in some codebases, return either a result value or an `error`:

```go
func (w *worker) Process(p any) any {
    out, err := doWork(p)
    if err != nil {
        return err
    }
    return out
}
```

The caller then does:

```go
switch v := r.(type) {
case error:
    handleErr(v)
case Result:
    handle(v)
default:
    panic(fmt.Sprintf("unexpected: %T", v))
}
```

The `switch v := r.(type)` pattern is fine but every callsite has to remember to handle errors. The result struct pattern is more disciplined.

---

## Performance Tips

Mid-level performance levers:

1. **Reuse buffers on the worker struct.** This is the #1 reason to use `tunny.New` over `NewFunc`. A 50 KB buffer reused across 100k calls saves ~5 GB of allocation. GC pressure plummets.
2. **Minimise per-call allocations inside `Process`.** Profile with `pprof` — any line that allocates is a candidate for hoisting to a worker field.
3. **Beware of contention in `BlockUntilReady`.** A `rate.Limiter` shared across workers requires a CAS internally. Under high call rates this can become hot.
4. **Avoid `time.After` in `Process`.** It allocates a timer per call. Use `time.NewTimer` and `Reset`:

```go
type worker struct {
    timer *time.Timer
}

func newWorker() *worker {
    t := time.NewTimer(0)
    if !t.Stop() {
        <-t.C
    }
    return &worker{timer: t}
}

func (w *worker) Process(p any) any {
    w.timer.Reset(50 * time.Millisecond)
    defer w.timer.Stop()
    select {
    case <-someChan:
    case <-w.timer.C:
    }
    return nil
}
```

5. **Pin the GC if needed.** For deterministic-latency workloads, consider `debug.SetGCPercent(-1)` and explicit `runtime.GC()` between batches. This is advanced and only sometimes appropriate.

6. **Avoid `interface{}` heap escapes.** When passing a payload through `Process`, the compiler may heap-allocate it. For very hot paths, batch payloads to amortise.

---

## Best Practices

- One pool per workload, sized for the workload's bottleneck.
- Workers own their state; methods touch only their own fields.
- `Interrupt` is meaningful for any long-running `Process`. Implement it.
- `Terminate` is the place to release expensive resources. Implement it.
- Use `ProcessCtx` in HTTP handlers — propagate the request context.
- Use `ProcessTimed` for batch jobs with hard SLAs.
- Wrap the pool in a typed module-internal type. Hide `interface{}`.
- Test under realistic concurrency. A pool that handles 4 concurrent callers is not the same as a pool handling 4000.

---

## Edge Cases and Pitfalls

### `Interrupt` runs concurrently with `Process`

Common mistake: assuming `Interrupt` runs after `Process`. It does not — it runs *during*. Any field touched by both must be synchronised.

### `Terminate` does not run if you do not call `Close`

If your program exits without calling `Close`, `Terminate` is never invoked. Resources held by workers will not be released. The OS will clean up file descriptors, but any external state (database transactions, lock files) may be left in a bad state.

Always `defer pool.Close()`.

### Factory panics fail-fast

If the factory passed to `tunny.New` panics during `n` calls, the panic propagates and the pool is not constructed. Any workers that were already built are leaked goroutines until their factories also fail or you call `Close`. Actually — they were not yet started; `tunny.New` constructs lazily in the standard implementation. Check the source for your version. Either way: do not panic in the factory unless that crash is acceptable at startup.

### `BlockUntilReady` blocks the pool's dispatch loop

If `BlockUntilReady` takes a long time, the worker is effectively unavailable. Other workers can still serve, but this one is paused. That is the intended behaviour — but be aware: a deadlock in `BlockUntilReady` deadlocks one worker permanently. The pool can survive losing one worker; it cannot survive losing all of them.

### `ProcessTimed`'s timeout is total, not per-phase

If the queue is full and your timeout is short, you may time out before reaching a worker. From the caller's view this is fine. From the operations view, you might expect "the worker is just slow", but the worker has not even started.

A monitoring practice: separately count `queue-time` and `work-time`. We will see this in `professional.md`.

### `ProcessCtx` versus `Process` semantic differences

- `Process` returns `any`.
- `ProcessCtx` returns `(any, error)`.

If you wrap them generically:

```go
func (p *MyPool) Process(in In) Out {
    return p.inner.Process(in).(Out)
}

func (p *MyPool) ProcessCtx(ctx context.Context, in In) (Out, error) {
    r, err := p.inner.ProcessCtx(ctx, in)
    if err != nil {
        var zero Out
        return zero, err
    }
    return r.(Out), nil
}
```

Note the zero-value handling on error. This is easy to forget.

### `Interrupt` should be safe to call when `Process` is *not* running

Tunny may, in some edge cases, call `Interrupt` shortly after `Process` returned. Be defensive — check internal state before acting:

```go
func (w *worker) Interrupt() {
    w.mu.Lock()
    defer w.mu.Unlock()
    if w.cancel == nil {
        return // not running, nothing to do
    }
    w.cancel()
}
```

### Worker panics propagate to the goroutine

If `Process` panics, the panic happens in the worker goroutine. The pool does not catch it. The program crashes. Recover inside `Process` if you cannot trust the work:

```go
func (w *worker) Process(p any) (out any) {
    defer func() {
        if r := recover(); r != nil {
            out = fmt.Errorf("panic: %v", r)
        }
    }()
    return riskyWork(p)
}
```

There is some subtlety about whether the worker is then usable for more calls. In modern tunny, yes — the wrapper function is built so a recovered panic does not kill the worker goroutine. In older versions, the worker goroutine could die. Always run `defer recover` to be safe regardless of version.

---

## Common Mistakes

### Mistake 1 — forgetting to implement all four methods

If your worker type does not implement `BlockUntilReady`, the program does not compile. (Good.) But it is easy to type the name wrong (`BlockUntilReady` vs `BlockReady`) and end up with an implicit cast error. Pin down the method names; copy-paste them from the docs.

### Mistake 2 — sharing mutable state across worker instances

```go
shared := make([]byte, 1024)
pool := tunny.New(4, func() tunny.Worker {
    return &worker{buf: shared}
})
```

All four workers share the same byte slice. When they all `Process` at once, races ensue. Make the slice per-worker:

```go
pool := tunny.New(4, func() tunny.Worker {
    return &worker{buf: make([]byte, 1024)}
})
```

### Mistake 3 — using `Process` then `ProcessCtx` interchangeably

`Process` returns `any`. `ProcessCtx` returns `(any, error)`. Mixing them up leads to runtime panics:

```go
r := pool.ProcessCtx(ctx, x).(MyResult) // does not compile — 2 return values
```

Either always use `Process` (no cancellation) or wrap so the caller never sees the difference.

### Mistake 4 — using `BlockUntilReady` for per-call delays

`BlockUntilReady` is invoked before every call, but its semantic intent is "I am ready/not ready as a worker." If you put `time.Sleep(100ms)` in there to simulate rate limiting, the pool throughput drops to one call per worker per 100 ms — which may be what you want, but more likely you wanted a shared limiter as in the example earlier.

### Mistake 5 — forgetting to make `cancel()` no-op when not running

A worker that calls `cancel()` on a nil `CancelFunc` panics. Always check:

```go
if w.cancel != nil {
    w.cancel()
}
```

### Mistake 6 — calling `Close` while `Process` is in flight

If your `Close` runs before all in-flight `Process` calls have returned, those in-flight calls may panic on send-on-closed-channel. Always coordinate: complete all `Process` calls before `Close`.

The `sync.WaitGroup` pattern in the junior examples is the standard answer.

---

## Common Misconceptions

### "tunny.New is harder than NewFunc"

It is a bit more code. But the moment you need per-worker state, `tunny.New` is *easier* — the alternative (closures-over-globals or sync.Pool inside NewFunc) is messier.

### "Interrupt cancels Process synchronously"

It does not. `Interrupt` sends a signal. `Process` keeps running until it observes the signal and returns. The caller's wait, however, has already ended — they got the timeout error.

### "ProcessCtx and ProcessTimed are the same"

ProcessCtx propagates *all* cancellation reasons. ProcessTimed only propagates timeout. ProcessCtx is the strictly more general API. Prefer it.

### "Workers run forever"

Workers run until the pool is closed. They are not immortal across pools — different `*tunny.Pool` instances have different workers.

### "NewCallback is for fire-and-forget"

It is not — it is still synchronous. You can call `pool.Process(func(){ ... })`, but `Process` still blocks until the callback returns.

---

## Tricky Points

### `BlockUntilReady` interacts with `ProcessTimed` in a non-obvious way

If a worker is blocked in `BlockUntilReady` and the caller's `ProcessTimed` deadline elapses, the worker is still blocked in `BlockUntilReady`. The caller gets `ErrJobTimedOut`. The worker does *not* receive an `Interrupt` because it has not yet started `Process`. So a long `BlockUntilReady` can effectively make a worker useless even though it is alive.

Best practice: keep `BlockUntilReady` reactive (poll a flag) so deadlines can still bail it out. Or use a context-aware wait:

```go
func (w *worker) BlockUntilReady() {
    _ = w.lim.Wait(context.Background()) // does not respect deadlines from callers
}
```

A more deadline-aware version requires plumbing the caller's context into the worker, which tunny does not give you directly. You may need to use the payload as a carrier:

```go
type Job struct {
    Ctx     context.Context
    Payload string
}
```

…and check `ctx.Done()` inside `Process`. The Worker interface itself does not connect the caller's context to `BlockUntilReady`.

### Worker reuse means worker state can carry over

If your worker has a `bytes.Buffer` field, it carries content from one call to the next unless you reset it. Common bug:

```go
func (w *worker) Process(p any) any {
    // forgot w.buf.Reset()
    w.buf.WriteString(p.(string))
    return w.buf.String()
}
```

After 3 calls, you have appended three strings. Always reset.

### The factory is called sequentially, not in parallel

If your factory is slow (loads a 1 GB model), constructing a pool of 16 workers takes 16 * factory_time. Tunny does not parallelise factory calls. If you need parallel construction, do it yourself:

```go
workers := make([]tunny.Worker, 16)
var wg sync.WaitGroup
for i := range workers {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        workers[i] = newExpensiveWorker()
    }()
}
wg.Wait()
i := 0
pool := tunny.New(16, func() tunny.Worker {
    w := workers[i]
    i++
    return w
})
```

This is a workaround. Use it when factory time is genuinely expensive.

---

## Test Yourself

1. Define a `Worker` for a SHA-256 hasher with a reusable `hash.Hash` instance.
2. Implement `Interrupt` for a worker whose `Process` does a 10-second `time.Sleep`.
3. Write a `ProcessCtx` call that respects an HTTP request's context.
4. Explain when `BlockUntilReady` is called and when it is not.
5. Explain the difference between `ProcessTimed`'s timeout and `BlockUntilReady`'s wait.
6. Implement a worker that holds a `*sql.Conn` and releases it in `Terminate`.
7. Write a typed wrapper `Pool[In, Out]` over `tunny.New`.
8. Implement a worker that recovers from panics in `Process` and reports them as a result error.
9. Why is `Interrupt` called from a different goroutine than `Process`?
10. When is `NewCallback` the right choice?

---

## Tricky Questions

**Q1.** Your worker's `BlockUntilReady` does `time.Sleep(100 * time.Millisecond)` on every call. The pool has 8 workers. What is the maximum throughput?

**A1.** 80 calls per second. Each worker can serve 10 calls per second (1 / 100 ms). With 8 workers, 80. The `Process` time is on top of this — if `Process` takes 50 ms, the actual throughput is 1 / (100 + 50) ms per worker = ~6.67 per worker per second, ~53 per second total.

**Q2.** A worker's `Process` is mid-call. You call `Pool.Close()`. What happens?

**A2.** `Close` waits for the in-flight `Process` to finish. Then it calls `Terminate` on each worker. Then it returns. While waiting, calls to `Process` on the closed pool panic.

**Q3.** A worker holds a `*sql.Tx`. It crashes in the middle of `Process` due to a panic. What is the state of the database?

**A3.** Depends on driver and what was happening. The transaction is likely abandoned and will be rolled back when the connection times out or returns to the pool. To be safe, wrap `Process` in a `defer recover()` that explicitly rolls back the transaction.

**Q4.** `ProcessCtx` is called with a `ctx` that has already been cancelled. What happens?

**A4.** `ProcessCtx` returns `(nil, ctx.Err())` essentially immediately. The worker may or may not be invoked depending on race conditions in the queue. Best practice: do not pass already-cancelled contexts.

**Q5.** Your `Interrupt` does nothing. What is the user-visible effect of `ProcessTimed`?

**A5.** From the caller's view, `ProcessTimed` correctly returns `ErrJobTimedOut` after the deadline. From the worker's view, `Process` keeps running until it finishes naturally. The result is discarded. The worker is unavailable to other callers until `Process` returns. So timeouts work, but slowly — and your effective pool size drops while timed-out workers are still running.

**Q6.** What happens if two `Interrupt` calls land while one `Process` is running?

**A6.** Both calls invoke your `Interrupt` method. If your method is idempotent (closing an already-closed cancel context is safe), no problem. If not (e.g. `close(ch)` on an already-closed channel), you panic. Make it idempotent.

**Q7.** Why does `BlockUntilReady` exist? Couldn't I just block at the start of `Process`?

**A7.** Yes, you could — but then the worker has been "assigned" to a payload while still waiting. That means the caller has been queued onto this worker; if other workers free up, they cannot pick up that caller. With `BlockUntilReady`, the worker is not assigned until ready, so the dispatcher can route to whichever worker is actually free first.

**Q8.** How does the pool decide which worker handles a given Process call?

**A8.** Whichever worker is currently in `BlockUntilReady` and just returned, basically. The dispatch is a channel send to whichever worker is reading. It is essentially "first available worker wins". You cannot prefer one worker over another.

**Q9.** Can I have heterogeneous workers in one pool?

**A9.** Technically yes — your factory could return different concrete types satisfying `Worker`. But the dispatch is round-robin-ish — there is no way to route a payload to a *specific* worker type. So heterogeneous workers in one pool only make sense if all of them can handle every payload.

**Q10.** Why does Process not take a `context.Context` directly?

**A10.** Because `Process` is part of an interface designed before contexts were idiomatic. `ProcessCtx` is the bolt-on. Inside the worker, you can plumb the payload to carry the context. Tunny does not give you the caller's context for free, but you can simulate it.

---

## Cheat Sheet

```text
Constructors:

  NewFunc(n, fn func(any) any)             - simple stateless
  New(n, factory func() Worker)            - full Worker interface
  NewCallback(n)                           - payload is a func()

Worker interface:

  Process(any) any         - do the work
  BlockUntilReady()        - wait until ready (rate limit, GPU)
  Interrupt()              - cancellation signal from pool
  Terminate()              - resource cleanup on Close

Calling:

  Process(payload)                                - blocking, no cancel
  ProcessTimed(payload, d)        -> (result, err) - timeout
  ProcessCtx(ctx, payload)        -> (result, err) - context-aware

Errors:

  ErrJobTimedOut       - ProcessTimed deadline elapsed
  ErrPoolNotRunning    - pool was closed
  ctx.Err()            - ProcessCtx context fired

Lifecycle:

  factory() -> worker
                |
                v
  Idle -> BlockUntilReady -> Process -> Idle (repeat)
                |
                v
              Close
                |
                v
          Terminate()
```

---

## Self-Assessment Checklist

- [ ] Can implement a stateful `Worker` with a per-worker buffer.
- [ ] Can implement `Interrupt` with three different mechanisms.
- [ ] Can decide between `NewFunc`, `New`, and `NewCallback`.
- [ ] Can use `ProcessTimed` and explain its two phases.
- [ ] Can use `ProcessCtx` in an HTTP handler with `r.Context()`.
- [ ] Can write a `BlockUntilReady` that integrates with `rate.Limiter`.
- [ ] Can write a typed wrapper that exposes only `In`/`Out`.
- [ ] Can recover from worker panics so they do not crash the process.
- [ ] Know when a long `BlockUntilReady` becomes problematic.
- [ ] Can explain why `Interrupt` runs concurrently with `Process`.

---

## Summary

- The `Worker` interface promotes a worker from a function to an object with lifecycle hooks.
- `tunny.New` is the constructor for stateful workers; `NewFunc` is shorthand for stateless ones; `NewCallback` is a convenience for free-form closures.
- `ProcessTimed` adds a per-call timeout; `ProcessCtx` adds a per-call `context.Context`.
- `BlockUntilReady`, `Interrupt`, and `Terminate` are the three lifecycle hooks that turn the worker into a first-class concurrent object.
- Per-worker state is the killer feature: buffers, connections, models, decoders — all reused.
- Cancellation requires cooperation from your `Interrupt` implementation. Plumb it through.
- Hide the `interface{}` plumbing behind a typed wrapper.

---

## What You Can Build Now

- A production-grade image processing service with per-worker decode buffers.
- A rate-limited API client with a shared `rate.Limiter` and `BlockUntilReady`.
- A CPU-bound HTTP service that respects request cancellation via `ProcessCtx`.
- A batch processor with hard SLAs using `ProcessTimed`.
- A typed pool wrapper module suitable for sharing across a company.

---

## Further Reading

- The tunny repository's example folder.
- The `golang.org/x/time/rate` package — pairs naturally with `BlockUntilReady`.
- The `context` package — `WithCancel`, `WithDeadline`, `WithValue`.
- Various blog posts on the "Worker interface vs closure-on-submit" debate.

---

## Related Topics

- **Junior tunny** ([junior.md](junior.md)) — the `NewFunc` foundation.
- **Senior tunny** ([senior.md](senior.md)) — internals of the workerWrapper.
- **Channels** ([../../02-channels/](../../02-channels/)) — what `Interrupt` essentially uses.
- **`context` package** ([../../../05-context/](../../../05-context/)) — required for `ProcessCtx`.
- **`sync.Pool`** ([../../03-sync-package/](../../03-sync-package/)) — composable with tunny.
- **`rate.Limiter`** ([../../../09-rate-limiting/](../../../)) — composable with `BlockUntilReady`.

---

## Diagrams

### Diagram 1 — Worker lifecycle

```
                  ctor()
                    │
                    ▼
              ┌───────────┐
              │ Worker    │
              │ instance  │
              └─────┬─────┘
                    │
                    ▼
          ┌─────────────────────┐
          │ for each payload:    │
          │   BlockUntilReady()  │
          │   Process(payload)   │
          └─────────┬─────────────┘
                    │ (loop)
                    │
            (pool.Close called)
                    │
                    ▼
              Terminate()
                    │
                    ▼
              goroutine exit
```

### Diagram 2 — ProcessTimed sequence

```
caller goroutine               pool/worker goroutine

ProcessTimed(p, 100ms) ─┐
                        │── send to internal channel
                        │
                        │     <─ worker picks up
                        │        BlockUntilReady()
                        │        Process(p) (running)
   start timer 100ms    │
                        │
   timer fires          │── send Interrupt signal ──> worker.Interrupt()
                        │
   return ErrTimeout    │
                        │
   (caller continues)    │     ... worker eventually returns,
                        │         result discarded
```

### Diagram 3 — Worker state ownership

```
       ┌───────────────────────────────────────────┐
       │            myWorker (one instance)         │
       ├───────────────────────────────────────────┤
       │ Process-only fields:                       │
       │   buf  []byte                              │  no synchronisation
       │   enc  *json.Encoder                       │
       │                                            │
       │ Shared with Interrupt:                     │
       │   mu     sync.Mutex                        │  mutex-protected
       │   cancel context.CancelFunc                │
       │                                            │
       │ Shared with Terminate:                     │
       │   conn   net.Conn                          │  closed once
       └───────────────────────────────────────────┘
```

### Diagram 4 — BlockUntilReady throttling

```
                  rate.Limiter (10 req/s)
                          │
       ┌──────────┬───────┴───────┬──────────┐
       ▼          ▼               ▼          ▼
   Worker 1   Worker 2        Worker 3   Worker 4
   acquire    waiting          processing waiting
   token      for token        a payload  for token

   ── pool dispatcher routes only to acquiring workers ──
```

The middle level is enough to handle most real production workloads. The senior file dives into what the library actually does under the hood — useful when you need to debug edge cases or extend tunny in subtle ways.

---

## Extended Case Study — Image Pipeline at Scale

To put everything from this file together, let us build a complete, realistic image processing pipeline. It will:

- Read JPEGs from a watch directory.
- Resize to thumbnail.
- Apply a watermark.
- Upload to S3 (simulated).
- Respect a per-second rate limit on the upload step.
- Honour context cancellation throughout.

This is the kind of program you might find in a real production codebase. We will write it in stages, each stage exercising one of the middle-level features.

### Stage 1 — types and contracts

```go
package pipeline

import (
    "context"
    "image"
    "time"
)

// Job is one unit of work flowing through the pipeline.
type Job struct {
    ID       string
    InPath   string
    OutKey   string
    Width    int
    Height   int
    Deadline time.Time
}

// Result is what comes back from the pipeline for a single job.
type Result struct {
    JobID    string
    Bytes    int64
    Took     time.Duration
    Err      error
}

// Stage is a node in the pipeline. Each stage consumes an input
// type and produces an output type.
type Stage[In, Out any] interface {
    Process(ctx context.Context, in In) (Out, error)
    Close() error
}

type decoded struct {
    JobID string
    Img   image.Image
    Took  time.Duration
}

type resized struct {
    JobID string
    Img   image.Image
    Took  time.Duration
}

type uploaded struct {
    JobID string
    Bytes int64
    Took  time.Duration
}
```

These are pure data types. No tunny yet. We are designing the shape of the pipeline first.

### Stage 2 — decode stage on top of tunny.New

```go
package pipeline

import (
    "bytes"
    "context"
    "image"
    _ "image/jpeg"
    "os"
    "runtime"
    "sync"
    "time"

    "github.com/Jeffail/tunny"
)

type decodeWorker struct {
    buf bytes.Buffer

    mu     sync.Mutex
    cancel context.CancelFunc
}

func (w *decodeWorker) Process(p interface{}) interface{} {
    job := p.(Job)
    start := time.Now()

    ctx, cancel := context.WithCancel(context.Background())
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    defer func() {
        w.mu.Lock()
        w.cancel = nil
        w.mu.Unlock()
        cancel()
    }()

    f, err := os.Open(job.InPath)
    if err != nil {
        return Result{JobID: job.ID, Err: err}
    }
    defer f.Close()

    w.buf.Reset()
    if _, err := w.buf.ReadFrom(f); err != nil {
        return Result{JobID: job.ID, Err: err}
    }

    type imgErr struct {
        img image.Image
        err error
    }
    ch := make(chan imgErr, 1)
    go func() {
        img, _, err := image.Decode(&w.buf)
        ch <- imgErr{img, err}
    }()

    select {
    case <-ctx.Done():
        return Result{JobID: job.ID, Err: ctx.Err()}
    case r := <-ch:
        if r.err != nil {
            return Result{JobID: job.ID, Err: r.err}
        }
        return decoded{JobID: job.ID, Img: r.img, Took: time.Since(start)}
    }
}

func (w *decodeWorker) BlockUntilReady() {}

func (w *decodeWorker) Interrupt() {
    w.mu.Lock()
    if w.cancel != nil {
        w.cancel()
    }
    w.mu.Unlock()
}

func (w *decodeWorker) Terminate() {}

// DecodeStage wraps a tunny pool with a typed API.
type DecodeStage struct {
    pool *tunny.Pool
}

func NewDecodeStage() *DecodeStage {
    return &DecodeStage{
        pool: tunny.New(runtime.NumCPU(), func() tunny.Worker {
            return &decodeWorker{}
        }),
    }
}

func (s *DecodeStage) Decode(ctx context.Context, j Job) (decoded, error) {
    r, err := s.pool.ProcessCtx(ctx, j)
    if err != nil {
        return decoded{}, err
    }
    switch v := r.(type) {
    case decoded:
        return v, nil
    case Result:
        return decoded{}, v.Err
    default:
        return decoded{}, fmt.Errorf("unexpected: %T", v)
    }
}

func (s *DecodeStage) Close() { s.pool.Close() }
```

Notes:

- The buffer `buf` lives on the worker. Across many decodes, it grows once and stays.
- `Interrupt` cancels the worker's local context. The goroutine doing the actual decode finishes naturally; the `select` returns `ctx.Err()` immediately.
- The `DecodeStage` wrapper gives callers a typed `Decode` function.
- The return type from `Process` is `interface{}`. We type-switch on it to recover either a `decoded` or an error-bearing `Result`. This is a quirk of the `any` return; you cannot return either of two types cleanly without it.

### Stage 3 — resize stage with shared CPU budget

```go
type resizeWorker struct {
    mu     sync.Mutex
    cancel context.CancelFunc
}

func (w *resizeWorker) Process(p interface{}) interface{} {
    pair := p.(struct {
        d decoded
        j Job
    })
    start := time.Now()

    ctx, cancel := context.WithCancel(context.Background())
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    defer func() {
        w.mu.Lock()
        w.cancel = nil
        w.mu.Unlock()
        cancel()
    }()

    dst := image.NewRGBA(image.Rect(0, 0, pair.j.Width, pair.j.Height))
    ch := make(chan image.Image, 1)
    go func() {
        draw.CatmullRom.Scale(dst, dst.Bounds(), pair.d.Img, pair.d.Img.Bounds(), draw.Over, nil)
        ch <- dst
    }()

    select {
    case <-ctx.Done():
        return Result{JobID: pair.j.ID, Err: ctx.Err()}
    case img := <-ch:
        return resized{JobID: pair.j.ID, Img: img, Took: time.Since(start)}
    }
}

func (w *resizeWorker) BlockUntilReady() {}

func (w *resizeWorker) Interrupt() {
    w.mu.Lock()
    if w.cancel != nil {
        w.cancel()
    }
    w.mu.Unlock()
}

func (w *resizeWorker) Terminate() {}

type ResizeStage struct {
    pool *tunny.Pool
}

func NewResizeStage() *ResizeStage {
    return &ResizeStage{
        pool: tunny.New(runtime.NumCPU(), func() tunny.Worker { return &resizeWorker{} }),
    }
}

func (s *ResizeStage) Resize(ctx context.Context, d decoded, j Job) (resized, error) {
    r, err := s.pool.ProcessCtx(ctx, struct {
        d decoded
        j Job
    }{d, j})
    if err != nil {
        return resized{}, err
    }
    switch v := r.(type) {
    case resized:
        return v, nil
    case Result:
        return resized{}, v.Err
    default:
        return resized{}, fmt.Errorf("unexpected: %T", v)
    }
}

func (s *ResizeStage) Close() { s.pool.Close() }
```

Same pattern as decode. The size matters: resize and decode are both CPU-bound, and they share the same CPU budget. You might wonder whether to put them in *one* pool (with a discriminated payload) or two separate pools. The trade-off:

- **One pool, two-shape payload**: each worker can do either job, so the pool is fully utilised even if the workload is imbalanced. But every worker has to hold buffers and state for both shapes.
- **Two separate pools**: cleaner code, more granular metrics, but if one pool is idle and the other is overloaded you cannot rebalance.

For most workloads, separate pools win on clarity. Pick separate pools unless you have measured contention.

### Stage 4 — upload stage with rate limit

```go
type uploadWorker struct {
    lim    *rate.Limiter
    bucket string
    client uploaderClient
}

type uploaderClient interface {
    Upload(ctx context.Context, key string, body []byte) error
}

func (w *uploadWorker) Process(p interface{}) interface{} {
    pair := p.(struct {
        r resized
        j Job
    })
    start := time.Now()

    var buf bytes.Buffer
    if err := png.Encode(&buf, pair.r.Img); err != nil {
        return Result{JobID: pair.j.ID, Err: err}
    }
    body := buf.Bytes()

    if err := w.client.Upload(context.Background(), pair.j.OutKey, body); err != nil {
        return Result{JobID: pair.j.ID, Err: err}
    }
    return uploaded{
        JobID: pair.j.ID,
        Bytes: int64(len(body)),
        Took:  time.Since(start),
    }
}

func (w *uploadWorker) BlockUntilReady() {
    _ = w.lim.Wait(context.Background())
}

func (w *uploadWorker) Interrupt()  {}
func (w *uploadWorker) Terminate()  {}

type UploadStage struct {
    pool *tunny.Pool
}

func NewUploadStage(bucket string, client uploaderClient, rps int) *UploadStage {
    lim := rate.NewLimiter(rate.Limit(rps), rps)
    return &UploadStage{
        pool: tunny.New(8, func() tunny.Worker {
            return &uploadWorker{lim: lim, bucket: bucket, client: client}
        }),
    }
}

func (s *UploadStage) Upload(ctx context.Context, r resized, j Job) (uploaded, error) {
    out, err := s.pool.ProcessCtx(ctx, struct {
        r resized
        j Job
    }{r, j})
    if err != nil {
        return uploaded{}, err
    }
    switch v := out.(type) {
    case uploaded:
        return v, nil
    case Result:
        return uploaded{}, v.Err
    default:
        return uploaded{}, fmt.Errorf("unexpected: %T", v)
    }
}

func (s *UploadStage) Close() { s.pool.Close() }
```

The upload stage uses `BlockUntilReady` to throttle. All 8 workers share the same limiter — the limiter is created once, captured in the factory's closure. Each worker calls `Wait` before accepting work.

If we had set the rate limit inside `Process` (after the dispatcher has already assigned a worker), the assigned worker would be "claimed" but blocked, while other workers might be ready. The whole point of `BlockUntilReady` is that the dispatcher can route to the *first* worker that is actually ready.

### Stage 5 — composing into a pipeline

```go
type Pipeline struct {
    decode *DecodeStage
    resize *ResizeStage
    upload *UploadStage
}

func NewPipeline(uploader uploaderClient, bucket string, rps int) *Pipeline {
    return &Pipeline{
        decode: NewDecodeStage(),
        resize: NewResizeStage(),
        upload: NewUploadStage(bucket, uploader, rps),
    }
}

func (p *Pipeline) Run(ctx context.Context, j Job) Result {
    start := time.Now()

    d, err := p.decode.Decode(ctx, j)
    if err != nil {
        return Result{JobID: j.ID, Err: fmt.Errorf("decode: %w", err)}
    }
    r, err := p.resize.Resize(ctx, d, j)
    if err != nil {
        return Result{JobID: j.ID, Err: fmt.Errorf("resize: %w", err)}
    }
    u, err := p.upload.Upload(ctx, r, j)
    if err != nil {
        return Result{JobID: j.ID, Err: fmt.Errorf("upload: %w", err)}
    }
    return Result{JobID: j.ID, Bytes: u.Bytes, Took: time.Since(start)}
}

func (p *Pipeline) Close() {
    p.decode.Close()
    p.resize.Close()
    p.upload.Close()
}
```

Three pools, three sizes, three different policies, one pipeline. The composition is straightforward because each stage has a clean typed API.

### Stage 6 — driving from a directory

```go
func ProcessDir(ctx context.Context, dir string, pipeline *Pipeline) []Result {
    inputs, _ := filepath.Glob(filepath.Join(dir, "*.jpg"))
    results := make([]Result, len(inputs))

    var wg sync.WaitGroup
    for i, in := range inputs {
        i, in := i, in
        wg.Add(1)
        go func() {
            defer wg.Done()
            j := Job{
                ID:     fmt.Sprintf("job-%d", i),
                InPath: in,
                OutKey: filepath.Base(in) + ".png",
                Width:  128,
                Height: 128,
            }
            results[i] = pipeline.Run(ctx, j)
        }()
    }
    wg.Wait()
    return results
}
```

`ctx` propagates all the way through. If the caller cancels, every stage sees it within milliseconds. The throughput is limited by the slowest stage — typically the upload stage because of its rate limit.

This pipeline is robust, observable (we can add metrics per stage), and naturally bounded. It is the production shape that real services converge on.

---

## Pool Composition — Two Patterns

The image pipeline above shows one common composition: **chained pools**. Each stage is its own pool. Items flow from pool to pool.

There is another pattern: **nested pools**. Worker A's `Process` calls into Worker B's pool. This composes more loosely but is more dangerous (deadlock risk).

### Chained pools (recommended)

```
Job ──> [decode pool] ──> [resize pool] ──> [upload pool] ──> Result
```

Each stage is a separate pool. The orchestrator drives them in sequence. Throughput is the minimum of stage throughputs. Latency is the sum of stage latencies.

Pros:
- Easy to reason about.
- Each stage's pool size is independently tuned.
- Errors at any stage propagate cleanly.
- Metrics per stage.

Cons:
- The orchestrator's goroutine is suspended while the chain runs. With many concurrent jobs this is many suspended goroutines.

### Nested pools (use with care)

```
Outer pool: Worker.Process() calls Inner pool.Process()
```

For example, an outer "request" pool and an inner "validation" pool. The outer worker's `Process` calls `inner.Process(...)`.

Pros:
- One coordinator goroutine per request.
- Internal stages are not surfaced to the caller.

Cons:
- **Deadlock risk.** If the inner pool is full and all outer workers are waiting for inner slots, you have a deadlock.
- Backpressure no longer propagates cleanly.

Rule: if you nest, ensure the inner pool has at least as many slots as the outer pool. Otherwise, you can run out of inner slots and starve.

---

## Worker Lifetime Quirks

A few subtle facts worth knowing at the middle level.

### Worker goroutines are not reused across pools

When you call `Close` and then `tunny.New` again, you get fresh worker goroutines. There is no caching. Workers do not "rest in a pool of pools."

This means: if your worker construction is expensive (loading an ML model), you pay that cost every time you construct a new pool. Pools should be long-lived.

### Worker state is not reset between calls automatically

The worker struct's fields hold whatever you left them at. If your `Process` writes to `w.buf` and forgets to reset, the next call sees the leftovers. Always reset.

### Workers do not yield voluntarily

Go's runtime preempts goroutines automatically (since 1.14). You do not need to call `runtime.Gosched()` in a worker. If your worker is in a tight loop with no function calls and no backward branches, async preemption catches it.

### Workers see all `Process` calls — but in arbitrary order across workers

Caller A calls `Process(1)` at time T. Caller B calls `Process(2)` at time T+1. Which worker handles which call? The dispatcher chooses based on which worker is ready. You cannot predict the order. If you need ordering, you must serialise at the caller side (or use a pool of size 1, which is its own design choice).

### Workers do not see each other

Worker A does not know that Worker B exists. There is no broadcast, no shared state by default. If you want shared state, you provide it via the factory (a shared field).

---

## Advanced: Building a `Result[T]` Style API

In real codebases you often want a typed `Result` shape that wraps either success or error. Let us build one.

```go
type Result[T any] struct {
    Value T
    Err   error
}

func Ok[T any](v T) Result[T]     { return Result[T]{Value: v} }
func Err[T any](e error) Result[T] { var z T; return Result[T]{Value: z, Err: e} }

func (r Result[T]) Unwrap() (T, error) { return r.Value, r.Err }
```

Now a typed worker:

```go
type Worker[In, Out any] struct {
    fn func(context.Context, In) (Out, error)

    mu     sync.Mutex
    cancel context.CancelFunc
}

func (w *Worker[In, Out]) Process(p interface{}) interface{} {
    in := p.(In)
    ctx, cancel := context.WithCancel(context.Background())
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    defer func() {
        w.mu.Lock()
        w.cancel = nil
        w.mu.Unlock()
        cancel()
    }()

    out, err := w.fn(ctx, in)
    if err != nil {
        return Err[Out](err)
    }
    return Ok[Out](out)
}

func (w *Worker[In, Out]) BlockUntilReady() {}

func (w *Worker[In, Out]) Interrupt() {
    w.mu.Lock()
    if w.cancel != nil {
        w.cancel()
    }
    w.mu.Unlock()
}

func (w *Worker[In, Out]) Terminate() {}

type Pool[In, Out any] struct {
    inner *tunny.Pool
}

func NewPool[In, Out any](n int, fn func(context.Context, In) (Out, error)) *Pool[In, Out] {
    return &Pool[In, Out]{
        inner: tunny.New(n, func() tunny.Worker {
            return &Worker[In, Out]{fn: fn}
        }),
    }
}

func (p *Pool[In, Out]) Run(ctx context.Context, in In) (Out, error) {
    r, err := p.inner.ProcessCtx(ctx, in)
    if err != nil {
        var z Out
        return z, err
    }
    res := r.(Result[Out])
    return res.Value, res.Err
}

func (p *Pool[In, Out]) Close() { p.inner.Close() }
```

Usage:

```go
p := NewPool[string, int](runtime.NumCPU(), func(ctx context.Context, s string) (int, error) {
    if s == "" {
        return 0, errors.New("empty")
    }
    return len(s), nil
})
defer p.Close()

n, err := p.Run(context.Background(), "hello")
fmt.Println(n, err) // 5 <nil>
```

This is the *production* typed wrapper. The `interface{}` survives only inside the wrapper. Callers see clean types throughout.

You can stop here and use this as your standard tunny adapter for the rest of your career. It is small, generic, and correct.

---

## Working With Heterogeneous Tasks

Sometimes you have many *kinds* of tasks, not one. Three approaches:

### Approach 1 — one pool per task type

Recommended in most cases. Different pools, different sizes, different metrics. We saw this in the image pipeline.

### Approach 2 — one pool with a discriminated payload

```go
type taskKind int
const (
    kindResize taskKind = iota
    kindHash
    kindValidate
)

type Task struct {
    Kind taskKind
    Data any
}

type universalWorker struct {
    resizeBuf bytes.Buffer
    hasher    hash.Hash
}

func (w *universalWorker) Process(p interface{}) interface{} {
    t := p.(Task)
    switch t.Kind {
    case kindResize:
        return w.resize(t.Data.(ResizeIn))
    case kindHash:
        return w.hash(t.Data.(HashIn))
    case kindValidate:
        return w.validate(t.Data.(ValidateIn))
    }
    return errors.New("unknown task kind")
}
```

Pros: single pool, simpler ops.
Cons: worker carries state for all kinds; type assertions everywhere; metrics conflate kinds.

This works for small services. For large ones, prefer Approach 1.

### Approach 3 — one pool that dispatches to sub-workers

```go
type orchestrator struct {
    resize *Pool[ResizeIn, ResizeOut]
    hash   *Pool[HashIn, HashOut]
}

func (o *orchestrator) Run(ctx context.Context, t Task) (any, error) {
    switch t.Kind {
    case kindResize:
        return o.resize.Run(ctx, t.Data.(ResizeIn))
    case kindHash:
        return o.hash.Run(ctx, t.Data.(HashIn))
    }
    return nil, errors.New("unknown")
}
```

Hybrid: a typed dispatcher in front of typed pools. This is what most production codebases look like once they have grown a bit.

---

## Memory Considerations

A few practical points about memory.

### `bytes.Buffer` growth

A `bytes.Buffer` on a worker grows monotonically. If one call writes 10 MB and the next writes 1 KB, the buffer is still 10 MB. Across thousands of calls, the buffer trends to the worst-case size.

For most workloads this is fine — memory is amortised. But if you process occasionally enormous inputs, consider explicit `buf.Truncate` or replacing the buffer:

```go
if w.buf.Cap() > 1<<20 { // > 1 MB
    w.buf = bytes.Buffer{}
}
```

### `sync.Pool` inside a worker

Sometimes the right shape is "worker holds long-lived state, but a sync.Pool gives per-call scratch":

```go
type worker struct {
    decoder *ml.Decoder // 200 MB, never freed
    scratch sync.Pool   // scratch buffers per call
}
```

The decoder lives on the worker. Scratch buffers live in the worker's `sync.Pool`. Each `Process` call gets a clean buffer, uses it, returns it.

This pattern composes well when the worker has many transient resources but a stable expensive resource.

### Worker-local goroutines

Avoid spawning long-lived goroutines from within `Process`. They will outlive `Process` and may outlive the pool. If you need them, track their lifetime explicitly:

```go
type worker struct {
    bgDone chan struct{}
    bgWG   sync.WaitGroup
}

func newWorker() *worker {
    w := &worker{bgDone: make(chan struct{})}
    w.bgWG.Add(1)
    go func() {
        defer w.bgWG.Done()
        for {
            select {
            case <-w.bgDone:
                return
            case <-time.After(time.Second):
                // do background tick
            }
        }
    }()
    return w
}

func (w *worker) Terminate() {
    close(w.bgDone)
    w.bgWG.Wait()
}
```

Clean termination: the background goroutine exits when `Terminate` is called.

---

## Observability Hooks

At the middle level, here are easy observability additions:

### Metric: time-in-queue

If your dispatcher is overwhelmed, measuring how long callers wait for a worker is gold. You cannot measure this from inside `Process` because by then the wait is over. Measure at the caller:

```go
start := time.Now()
result, err := pool.ProcessCtx(ctx, j)
metrics.ObserveQueueAndWork(time.Since(start), result, err)
```

Splitting queue time from work time:

```go
start := time.Now()
result, err := pool.ProcessCtx(ctx, jobWithStartTime{start: start, j: j})
// inside Process: workStart := time.Now(); queueTime = workStart - j.start
```

You need to pack the start time into the payload to split the two times. Worth it for hot paths.

### Metric: in-flight count

```go
var inflight atomic.Int64

func (w *worker) Process(p interface{}) interface{} {
    inflight.Add(1)
    defer inflight.Add(-1)
    metrics.Gauge("pool.inflight", float64(inflight.Load()))
    return doWork(p)
}
```

### Metric: error count by kind

```go
defer func() {
    if r := recover(); r != nil {
        metrics.Inc("pool.panics")
        out = errPanic
    }
}()
```

### Metric: queue length

```go
metrics.Gauge("pool.queue", float64(pool.QueueLength()))
```

Sample this on a timer or every few requests. A growing queue is a sign of overload.

### Tracing

If you use OpenTelemetry, wrap `Process` in a span:

```go
func (w *worker) Process(p interface{}) interface{} {
    ctx := context.Background() // or recover from payload
    ctx, span := tracer.Start(ctx, "worker.Process")
    defer span.End()
    return doWork(ctx, p)
}
```

Pass the trace context through the payload if you want true cross-process correlation.

---

## Subtle Concurrency Bugs

A small collection of bugs that have actually been spotted in production tunny code.

### Bug — `Interrupt` reads `w.cancel` without a lock

```go
func (w *worker) Interrupt() {
    if w.cancel != nil { // race with Process writing w.cancel
        w.cancel()
    }
}
```

Race. The race detector catches it. Always synchronise.

### Bug — `Interrupt` cancels too eagerly

```go
func (w *worker) Process(p interface{}) interface{} {
    w.cancel() // accidentally cancels itself
    ...
}
```

If `cancel` is set from a previous call and not reset, you cancel the current call. Be careful with ordering:

```go
func (w *worker) Process(p interface{}) interface{} {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    // ...
}
```

Always create the new context *before* writing `w.cancel`.

### Bug — `Close` while writes are in flight

```go
go pool.Process(x) // (1)
pool.Close()       // (2)
```

If (2) runs before (1) has executed, you may send on a closed channel inside (1). Always coordinate. The fix is in the junior file: use `sync.WaitGroup` or careful ordering.

### Bug — worker spawned a goroutine that outlives the pool

```go
func (w *worker) Process(p interface{}) interface{} {
    go w.doStuff() // leaks
    return nil
}
```

The spawned goroutine has no lifecycle. It keeps running after `Process` returns and after `Terminate`. Track lifetimes explicitly.

### Bug — `BlockUntilReady` reads a closed channel

```go
func (w *worker) BlockUntilReady() {
    <-w.ready // panic if w.ready is closed
}
```

Closing `ready` would actually *not* panic on receive — it returns zero immediately. But it would cause the worker to immediately accept all work, defeating the throttle. Decide whether closing `ready` should mean "shut down" or "all work allowed" and document it.

---

## Why Tunny's Design Is What It Is

A short philosophical note. The `Worker` interface seems heavy for simple workloads. Why force four methods when most are empty?

Two reasons:

1. **Backwards compatibility.** Once an interface exists, adding methods breaks every implementer. Better to over-specify upfront.
2. **Designed for the hard case.** The simple case (`NewFunc`) is a few lines of adapter on top of `New`. The hard case (long-lived expensive workers with cancellation) is the one that motivates the interface. Tunny's author chose to optimise the API for the hard case.

If you only need the easy case, use `NewFunc`. The interface is right there waiting for when you grow into needing it.

This is the inverse of the `ants` library's philosophy, which optimises for "submit a closure" — the easy case. Both choices are defensible. They produce different code patterns. Pick the one that fits your workload.

---

## Performance Comparison — tunny vs hand-rolled channel pool

For curiosity: how does tunny compare to a hand-rolled pool?

Hand-rolled:

```go
func makePool(n int, work func(any) any) (chan<- any, <-chan any) {
    in := make(chan any)
    out := make(chan any, n)
    for i := 0; i < n; i++ {
        go func() {
            for p := range in {
                out <- work(p)
            }
        }()
    }
    return in, out
}
```

This is simpler in code but has none of:
- `Process` synchronous semantics (results may arrive out of order).
- Cancellation.
- Per-worker state (no `Worker` interface).
- `BlockUntilReady`.
- `Terminate` cleanup.

Tunny is the production-shaped wrapper for this same idea. It is not faster — it does the same things. It is *correct in more edge cases* and *more readable at the call site*.

For one-off scripts where you do not care about cancellation or shutdown, the hand-rolled version is fine. For services that have to handle deployment events, request cancellation, and observability, tunny saves you weeks of debugging.

---

## Recap of the Three Constructors

A compact comparison.

| Constructor    | Best for                          | Worker state         | Cancellation feasibility |
|----------------|-----------------------------------|----------------------|--------------------------|
| `NewFunc`      | Simple stateless CPU/IO           | None (closure only)  | Poor (no Interrupt hook) |
| `New`          | Stateful workers, expensive setup | First-class fields   | Excellent (Interrupt)    |
| `NewCallback`  | Ad-hoc heterogeneous tasks        | None                 | None                     |

A rule of thumb:

- Start with `NewFunc`.
- Move to `New` when you find yourself wanting per-worker buffers, connections, or cancellation.
- Use `NewCallback` only when nothing else fits.

---

## Closing Thoughts on the Middle Level

The middle level is the level at which tunny becomes genuinely useful in production. The `Worker` interface unlocks per-worker resources; `ProcessCtx` connects callers to workers through cancellation; `BlockUntilReady` lets you compose with rate limiters and semaphores naturally.

If you can write the typed `Pool[In, Out]` adapter from memory and reason about `Interrupt`, you have absorbed everything important about tunny. The senior file covers internals — useful for debugging but rarely required for normal use.

Before moving on, build one realistic middle-level program. Suggestions:

- An HTTP service that resizes images with `ProcessCtx` honouring request cancellation.
- A batch hasher that times out on `ProcessTimed` and writes successes to a JSON file.
- A rate-limited API client where each worker is a real HTTP client with a long-lived connection pool.

Working through one of these end-to-end will solidify the material in a way that reading cannot.

Onward to `senior.md` when ready. The internals are short and surprising — they will demystify what `Process` actually does to the runtime.

---

## Appendix — Twenty Middle-Level Recipes

### Recipe 1 — Worker that holds a `gzip.Reader`

```go
type gzWorker struct {
    r *gzip.Reader
}

func (w *gzWorker) Process(p any) any {
    b := p.([]byte)
    if w.r == nil {
        var err error
        w.r, err = gzip.NewReader(bytes.NewReader(b))
        if err != nil {
            return err
        }
    } else {
        if err := w.r.Reset(bytes.NewReader(b)); err != nil {
            return err
        }
    }
    out, err := io.ReadAll(w.r)
    if err != nil {
        return err
    }
    return out
}

func (w *gzWorker) BlockUntilReady() {}
func (w *gzWorker) Interrupt()       {}
func (w *gzWorker) Terminate() {
    if w.r != nil {
        _ = w.r.Close()
    }
}
```

`gzip.Reader.Reset` re-uses the underlying state, avoiding per-call allocation.

### Recipe 2 — Worker that pools `bytes.Buffer`

```go
type bufWorker struct {
    bufs sync.Pool
}

func (w *bufWorker) Process(p any) any {
    buf := w.bufs.Get().(*bytes.Buffer)
    buf.Reset()
    defer w.bufs.Put(buf)
    // ... use buf
    return doSomething(buf, p)
}

func (w *bufWorker) BlockUntilReady() {}
func (w *bufWorker) Interrupt()       {}
func (w *bufWorker) Terminate()       {}

func newBufWorker() tunny.Worker {
    return &bufWorker{
        bufs: sync.Pool{New: func() any { return &bytes.Buffer{} }},
    }
}
```

### Recipe 3 — Worker that uses `errgroup` internally

```go
func (w *worker) Process(p any) any {
    g, ctx := errgroup.WithContext(context.Background())
    job := p.(Job)

    var aResult string
    g.Go(func() error {
        var err error
        aResult, err = subTaskA(ctx, job)
        return err
    })

    var bResult int
    g.Go(func() error {
        var err error
        bResult, err = subTaskB(ctx, job)
        return err
    })

    if err := g.Wait(); err != nil {
        return Result{Err: err}
    }
    return Result{A: aResult, B: bResult}
}
```

Inside `Process`, fan out to internal goroutines and join. The worker still appears single-threaded to the pool.

### Recipe 4 — Conditional `BlockUntilReady`

```go
func (w *worker) BlockUntilReady() {
    if w.degraded.Load() {
        time.Sleep(100 * time.Millisecond) // back off in degraded mode
    }
}
```

A degraded mode lets you slow workers down in response to external signals (health check failures, etc).

### Recipe 5 — Stopping a worker mid-loop on Interrupt

```go
func (w *worker) Process(p any) any {
    items := p.([]int)
    sum := 0
    for i, v := range items {
        if i%100 == 0 && w.stop.Load() {
            return Result{Partial: sum, Err: errInterrupted}
        }
        sum += v
    }
    return Result{Partial: sum}
}

func (w *worker) Interrupt() {
    w.stop.Store(true)
}
```

Granularity: every 100 items. Tune to balance responsiveness vs overhead.

### Recipe 6 — Worker with retry inside Process

```go
func (w *worker) Process(p any) any {
    job := p.(Job)
    var last error
    for attempt := 0; attempt < 3; attempt++ {
        out, err := w.try(job)
        if err == nil {
            return out
        }
        last = err
        time.Sleep(time.Duration(attempt) * 100 * time.Millisecond)
    }
    return Result{Err: last}
}
```

Inside-the-worker retry is one option. Outside (in the orchestrator) is another. Inside is simpler but less observable.

### Recipe 7 — Timed worker via `time.NewTimer`

```go
type timedWorker struct {
    timer *time.Timer
}

func newTimedWorker() tunny.Worker {
    t := time.NewTimer(0)
    if !t.Stop() {
        <-t.C
    }
    return &timedWorker{timer: t}
}

func (w *timedWorker) Process(p any) any {
    w.timer.Reset(50 * time.Millisecond)
    defer w.timer.Stop()
    return doWork(p, w.timer.C)
}

func (w *timedWorker) BlockUntilReady() {}
func (w *timedWorker) Interrupt()       {}
func (w *timedWorker) Terminate()       {}
```

Reusing a timer avoids per-call allocation.

### Recipe 8 — Worker with shared cache

```go
type cachedWorker struct {
    cache *lru.Cache // shared across workers
}

func (w *cachedWorker) Process(p any) any {
    key := p.(string)
    if v, ok := w.cache.Get(key); ok {
        return v
    }
    v := expensiveLookup(key)
    w.cache.Add(key, v)
    return v
}
```

Multiple workers share one `lru.Cache`. The LRU must be thread-safe (most implementations are).

### Recipe 9 — Detect orphaned workers via Terminate

```go
func (w *worker) Terminate() {
    metrics.Inc("worker.terminated")
    log.Printf("worker %p terminated", w)
}
```

If you see fewer terminations than constructions over time, you have leaking pools.

### Recipe 10 — Pool with `ProcessCtx` and metrics

```go
func (s *Service) Do(ctx context.Context, in In) (Out, error) {
    start := time.Now()
    defer func() { metrics.Observe("service.do.duration", time.Since(start)) }()
    r, err := s.pool.ProcessCtx(ctx, in)
    if err != nil {
        metrics.Inc("service.do.err")
        var z Out
        return z, err
    }
    return r.(Result[Out]).Unwrap()
}
```

### Recipe 11 — Worker that batches inputs

```go
type batcher struct {
    mu      sync.Mutex
    buf     []Job
    flushAt int
    done    chan []Result
}

func (b *batcher) Process(p any) any {
    b.mu.Lock()
    b.buf = append(b.buf, p.(Job))
    if len(b.buf) >= b.flushAt {
        batch := b.buf
        b.buf = nil
        b.mu.Unlock()
        return processBatch(batch)
    }
    b.mu.Unlock()
    // ... wait somehow
    return nil
}
```

Batching inside a worker is subtle. We expand on it in `optimize.md`.

### Recipe 12 — Health probe for the pool

```go
func (s *Service) Health() error {
    if s.pool.QueueLength() > 1000 {
        return errors.New("backlog too long")
    }
    return nil
}
```

### Recipe 13 — Pool drain helper

```go
func (s *Service) Drain(ctx context.Context) error {
    for s.pool.QueueLength() > 0 {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(100 * time.Millisecond):
        }
    }
    return nil
}
```

Useful before `Close` to give in-flight work a chance to finish.

### Recipe 14 — Resize pool based on queue length

```go
go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for range t.C {
        ql := pool.QueueLength()
        sz := pool.GetSize()
        if ql > 100 && sz < 32 {
            pool.SetSize(sz + 4)
        } else if ql == 0 && sz > runtime.NumCPU() {
            pool.SetSize(sz - 1)
        }
    }
}()
```

Auto-scaling based on queue length. Use carefully — flapping is real.

### Recipe 15 — Workerless waiting via `BlockUntilReady` + semaphore

```go
type w struct {
    sem chan struct{}
}

func (w *w) BlockUntilReady() {
    w.sem <- struct{}{}
}
func (w *w) Process(p any) any {
    defer func() { <-w.sem }()
    return work(p)
}
```

A shared semaphore further bounds concurrency below the pool size. E.g. pool of 16 but only 4 concurrent calls allowed at a time.

### Recipe 16 — Typed `ProcessCtx` wrapper

Already shown in `Pool[In, Out].Run`. Refer back if needed.

### Recipe 17 — Worker that publishes to an event bus

```go
func (w *worker) Process(p any) any {
    out := work(p)
    bus.Publish("processed", out)
    return out
}
```

Mind that Publish should not block forever — that would tie up the worker.

### Recipe 18 — Worker that emits structured logs

```go
func (w *worker) Process(p any) any {
    job := p.(Job)
    logger := slog.With("job", job.ID)
    logger.Info("starting")
    start := time.Now()
    defer logger.Info("done", "took", time.Since(start))
    return work(job)
}
```

### Recipe 19 — Worker that updates a shared counter atomically

```go
type w struct {
    count *atomic.Int64
}

func (w *w) Process(p any) any {
    defer w.count.Add(1)
    return work(p)
}
```

### Recipe 20 — Termination with grace period

```go
func (s *Service) Stop(ctx context.Context) error {
    done := make(chan struct{})
    go func() {
        s.pool.Close()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

`Close` itself blocks until all workers terminate. Wrapping it in a context-aware goroutine gives you a deadline-aware shutdown.

---

## Appendix — One More Case Study: Worker Pool for a Token Validator

A real example from production: an HTTP service validates incoming OAuth tokens by calling an introspection endpoint. The introspection endpoint is rate-limited at 100 RPS. The service receives 1000 RPS on its main API. We need to keep the introspection downstream from exploding, while not adding too much latency.

```go
type Validator struct {
    pool *tunny.Pool
}

type tokenWorker struct {
    client *http.Client
    lim    *rate.Limiter

    mu     sync.Mutex
    cancel context.CancelFunc
}

func (w *tokenWorker) Process(p any) any {
    token := p.(string)
    ctx, cancel := context.WithCancel(context.Background())
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    defer func() {
        w.mu.Lock()
        w.cancel = nil
        w.mu.Unlock()
        cancel()
    }()

    req, _ := http.NewRequestWithContext(ctx, "POST",
        "https://auth.example.com/introspect", strings.NewReader("token="+token))
    req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

    resp, err := w.client.Do(req)
    if err != nil {
        return ValidateResult{Err: err}
    }
    defer resp.Body.Close()
    var v map[string]any
    if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
        return ValidateResult{Err: err}
    }
    return ValidateResult{Active: v["active"] == true, Subject: v["sub"].(string)}
}

func (w *tokenWorker) BlockUntilReady() {
    _ = w.lim.Wait(context.Background())
}

func (w *tokenWorker) Interrupt() {
    w.mu.Lock()
    if w.cancel != nil {
        w.cancel()
    }
    w.mu.Unlock()
}

func (w *tokenWorker) Terminate() {}

type ValidateResult struct {
    Active  bool
    Subject string
    Err     error
}

func NewValidator(rps int) *Validator {
    sharedClient := &http.Client{Timeout: 2 * time.Second}
    sharedLim := rate.NewLimiter(rate.Limit(rps), rps)
    return &Validator{
        pool: tunny.New(32, func() tunny.Worker {
            return &tokenWorker{client: sharedClient, lim: sharedLim}
        }),
    }
}

func (v *Validator) Validate(ctx context.Context, token string) (ValidateResult, error) {
    r, err := v.pool.ProcessCtx(ctx, token)
    if err != nil {
        return ValidateResult{}, err
    }
    return r.(ValidateResult), nil
}

func (v *Validator) Close() { v.pool.Close() }
```

Design notes:

- 32 workers, each with its own state but a shared `*http.Client` and limiter. The client itself maintains an internal connection pool — workers are not competing for connections.
- The limiter is the throttle. With 100 RPS budget, the 32 workers cannot exceed it.
- `ProcessCtx` so that callers' contexts propagate. If the inbound HTTP request is cancelled, the introspection request is cancelled.
- Pool size of 32 is chosen for latency: at 100 RPS and 10 ms per call, we need ~1 concurrent call on average; 32 gives plenty of headroom for spikes.

Integration in an HTTP middleware:

```go
func authMiddleware(v *Validator) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tok := r.Header.Get("Authorization")
            if tok == "" {
                http.Error(w, "missing token", 401)
                return
            }
            res, err := v.Validate(r.Context(), tok)
            if err != nil {
                if errors.Is(err, context.Canceled) {
                    return // client gave up
                }
                http.Error(w, "validation failed", 502)
                return
            }
            if !res.Active {
                http.Error(w, "inactive token", 401)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

This is the production shape. We use tunny correctly: bounded concurrency, shared rate limit, context-propagated cancellation, typed results.

---

## Appendix — Building a Custom Pool on Top of Tunny

Sometimes you want behavior tunny doesn't directly provide — priority queues, fairness, etc. You can build it on top.

Example: priority pool (high-priority items skip the queue).

```go
type PriorityPool[In, Out any] struct {
    high *tunny.Pool
    low  *tunny.Pool
}

func NewPriority[In, Out any](n int, fn func(In) Out) *PriorityPool[In, Out] {
    factory := func() tunny.Worker {
        return &priorityWorker[In, Out]{fn: fn}
    }
    return &PriorityPool[In, Out]{
        high: tunny.New(n/2+1, factory),
        low:  tunny.New(n/2, factory),
    }
}

func (p *PriorityPool[In, Out]) High(ctx context.Context, in In) (Out, error) {
    r, err := p.high.ProcessCtx(ctx, in)
    if err != nil {
        var z Out
        return z, err
    }
    return r.(Out), nil
}

func (p *PriorityPool[In, Out]) Low(ctx context.Context, in In) (Out, error) {
    r, err := p.low.ProcessCtx(ctx, in)
    if err != nil {
        var z Out
        return z, err
    }
    return r.(Out), nil
}

func (p *PriorityPool[In, Out]) Close() {
    p.high.Close()
    p.low.Close()
}
```

Two pools, each with its own size. The "priority" emerges from separation: high callers go to the high pool, low to the low. No mixing. This is a simple way to give different classes of work different resources.

For richer priorities (5 levels, fairness, aging), you would build your own scheduler in front of one tunny pool. That is past middle-level scope — see `senior.md` for ideas.

---

## Appendix — Migration Path From Goroutines+Channels to Tunny

If your codebase currently has a hand-rolled pattern like:

```go
sem := make(chan struct{}, 8)
for _, task := range tasks {
    task := task
    sem <- struct{}{}
    go func() {
        defer func() { <-sem }()
        work(task)
    }()
}
```

…migrating to tunny is straightforward:

1. Replace `sem` with a `*tunny.Pool`.
2. Replace `work(task)` with `pool.Process(task)`.
3. Add `defer pool.Close()` to the lifetime.

```go
pool := tunny.NewFunc(8, func(p any) any {
    work(p)
    return nil
})
defer pool.Close()
var wg sync.WaitGroup
for _, task := range tasks {
    task := task
    wg.Add(1)
    go func() {
        defer wg.Done()
        pool.Process(task)
    }()
}
wg.Wait()
```

The migration is mechanical. The gains:

- The semaphore is now first-class — it has a name (`pool`), a size method (`GetSize`), a queue length method (`QueueLength`).
- You can layer per-worker state if needed.
- You get `ProcessTimed`/`ProcessCtx` for cancellation.

For many codebases this is the simplest first refactor toward better concurrency hygiene.

---

## Appendix — When Tunny Is Wrong

A short cautionary list. These cases call for a different tool.

- **You want to start a goroutine and forget about it.** Use the `go` keyword. Tunny forces you to wait for a result.
- **You have millions of cheap tasks.** Use `ants` — its dynamic pool sizing and overflow behaviour fit better.
- **You need priority queues, fairness, or scheduling policies.** Tunny does not have these. Build them on top, or use a different library.
- **Your work is mostly waiting on IO.** A simple semaphore over goroutines is fine. Tunny is overkill.
- **Your work has wildly different costs.** Tunny round-robins; one slow job ties up one worker. Consider work-stealing schedulers or per-cost pools.

None of these are tunny "failing" — they are simply not what tunny is for. Use the right tool.

---

## Appendix — Reading the Worker Source

For full understanding, read `tunny/tunny.go` line by line after this file. You will recognise:

- `Pool` struct holding workers and the dispatcher channels.
- `workerWrapper` driving each worker through its lifecycle.
- The select inside `workerWrapper.run` that handles process / interrupt / terminate.

The library is small enough that reading the source is rewarding, not exhausting. It takes about 20 minutes. Do it.

---

Closing for real this time. The middle level gives you everything needed to write production-grade tunny code. The senior level is for when you must debug deep edge cases or extend the library. Take a break, build something, come back to senior when curiosity strikes.
