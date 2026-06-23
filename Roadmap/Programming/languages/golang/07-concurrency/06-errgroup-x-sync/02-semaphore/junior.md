# x/sync semaphore — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is a semaphore? When do I reach for `golang.org/x/sync/semaphore` instead of a buffered channel? How do I use it safely?"

A **semaphore** is a counter that limits how many things can happen at the same time. You set the capacity once, then every goroutine that wants to do the limited thing has to "take a slot" before starting and "give it back" when finished. If all slots are taken, latecomers wait until somebody returns one.

In Go, the most common semaphore tool from the standard ecosystem is the `golang.org/x/sync/semaphore` package. It provides a single type, `Weighted`, with three methods you will use over and over:

```go
import "golang.org/x/sync/semaphore"

sem := semaphore.NewWeighted(8) // capacity 8

if err := sem.Acquire(ctx, 1); err != nil {
    return err            // ctx cancelled before a slot was free
}
defer sem.Release(1)

doTheWork()
```

That is 90% of what you will write in your first month of using it. The remaining 10% — the *weighted* part, the context cancellation details, the comparison with channels — is what this file teaches.

After reading this file you will:

- Know what a counting semaphore is and how it differs from a mutex.
- Know how to call `NewWeighted`, `Acquire`, `TryAcquire`, and `Release`.
- Understand why the package is called *weighted* and why that matters for memory budgets.
- Be able to compare a semaphore with a buffered channel acting as one.
- Recognise the common bugs (missing `Release`, mismatched weights, blocking on `Acquire` forever).
- Have a working mental model of how `Acquire` blocks and how `Release` wakes a waiter.

You do not need to know the internal queue layout, the OS futex, or how the package was implemented at runtime level — those come at professional level.

---

## Prerequisites

- **Required:** Comfortable with goroutines and `go func() { ... }()` syntax.
- **Required:** Familiar with channels at the level of `make(chan T, N)`, send, receive, close. The "channel as semaphore" pattern is the first comparison we draw.
- **Required:** Awareness of `context.Context` — at minimum, `context.Background()`, `context.WithCancel`, `context.WithTimeout`. `Acquire` takes a `ctx` argument and you must understand why.
- **Required:** `sync.WaitGroup` — used in many examples to wait for spawned goroutines.
- **Helpful:** Have read the `goroutines/01-overview` section and the `channels/02-buffered` section. The fan-out pattern (`05-concurrency-patterns/02-fan-out`) is the natural setting for using a semaphore.

To install the package:

```bash
go get golang.org/x/sync/semaphore
```

This is the *extended sync* module — outside the standard library, but maintained by the Go team and used in production at every scale.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Semaphore** | A counter that controls access to N slots. Threads/goroutines acquire a slot before proceeding and release it after. Originally proposed by Edsger Dijkstra in 1965. |
| **Counting semaphore** | A semaphore with capacity > 1. Up to N holders can be inside the critical section simultaneously. The kind you usually mean when you say "semaphore". |
| **Binary semaphore** | A semaphore with capacity 1. Functionally equivalent to a mutex, with one subtle difference: any goroutine can release a binary semaphore, while a mutex must be released by the same goroutine that locked it. |
| **Weighted semaphore** | A semaphore where each acquire/release passes a weight (number of units). One operation may take 1 unit, another may take 256. The total may not exceed capacity. |
| **`semaphore.Weighted`** | The single type exported by `golang.org/x/sync/semaphore`. It is a weighted counting semaphore with FIFO ordering and context-aware acquisition. |
| **`NewWeighted(n int64)`** | Constructor. `n` is the total capacity. Returns `*Weighted`. |
| **`Acquire(ctx, n)`** | Reserve `n` units. Blocks until enough capacity is free or `ctx` cancels. Returns `nil` on success, `ctx.Err()` on cancellation. |
| **`TryAcquire(n)`** | Reserve `n` units if immediately possible. Returns `true` on success, `false` otherwise. Never blocks. |
| **`Release(n)`** | Return `n` units. Panics if cumulative releases exceed cumulative acquisitions. |
| **Capacity** | The maximum total weight that may be acquired at once. Fixed at construction. |
| **FIFO** | First-In-First-Out. `x/sync/semaphore` wakes waiters in the order they parked. |
| **Head-of-line blocking** | When a heavy waiter at the front of the queue prevents a light one behind it from proceeding, even if enough capacity is free for the light one. |
| **Bounded concurrency** | Limiting the number of goroutines doing work at once. The textbook use case for a semaphore. |

---

## Core Concepts

### A semaphore is a counter with a wait list

Picture a parking lot with 8 spaces. A car arriving when fewer than 8 are parked enters and parks. A car arriving when the lot is full waits at the gate. When a car leaves, the next waiting car enters. That is a counting semaphore with capacity 8.

```go
parkingLot := semaphore.NewWeighted(8)

// A car arrives
if err := parkingLot.Acquire(ctx, 1); err != nil {
    return err
}
defer parkingLot.Release(1)

// car is parked; do parking-lot things
```

Replace "car" with "goroutine doing an HTTP call" and you have the most common use case in Go.

### Capacity is set once and cannot change

```go
sem := semaphore.NewWeighted(8)
```

There is no `Resize(n)`. There is no `SetCapacity(n)`. The capacity is final at construction. If you need a dynamically sized pool, the semaphore is not your tool — you need a more elaborate worker pool with its own lifecycle.

### `Acquire` and `Release` are *not* lexically scoped, but `defer` makes them safer

The compiler does not enforce that a `Release` matches an `Acquire`. You can `Acquire` in one function and `Release` in another. You can even forget. The standard discipline is `defer sem.Release(n)` immediately after a successful `Acquire`:

```go
if err := sem.Acquire(ctx, 1); err != nil {
    return err
}
defer sem.Release(1)
```

This way, no matter how the function exits — return, panic, early break — the slot is freed.

### The *weighted* part: not every job costs 1 unit

This is the feature that distinguishes `x/sync/semaphore` from a buffered channel. With a channel you can only count slots: 8 slots, 8 holders. With `semaphore.Weighted` you can also describe **cost**.

```go
memoryBudget := semaphore.NewWeighted(1 << 30) // 1 GiB

// A small job: 4 MiB
sem.Acquire(ctx, 4<<20)
defer sem.Release(4<<20)

// A big job: 256 MiB
sem.Acquire(ctx, 256<<20)
defer sem.Release(256<<20)
```

Total acquired memory may not exceed 1 GiB. Up to 256 small jobs may run together, or 4 big jobs, or any mix totalling under the budget. This is impossible to express cleanly with a channel.

### Context is mandatory

`Acquire` takes `ctx context.Context` as its first argument. There is no version without it. The reason: if a waiter cannot get the slot for a long time, it must have a way to give up. `ctx` cancellation is that way.

```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()

if err := sem.Acquire(ctx, 1); err != nil {
    return fmt.Errorf("could not acquire semaphore: %w", err)
}
defer sem.Release(1)
```

If the wait exceeds 30 seconds, `Acquire` returns `context.DeadlineExceeded`. Importantly, **you do not need to call `Release` after a failed `Acquire`** — nothing was acquired.

### `Release` does not return an error

`Release(n)` is fire-and-forget. It will *panic* if you release more than was acquired, but a normal release simply decrements the internal counter and possibly wakes a parked waiter. There is no error path to handle.

---

## Real-World Analogies

### Library checkout desk

A library has 10 copies of a book. You can borrow at most 10 copies at once across all patrons; the eleventh patron waits at the desk. Each patron takes 1 copy (weight 1). The desk staff are the runtime; the checkout register is the semaphore.

### Hotel rooms

A 200-room hotel. Each booking takes some number of rooms (most people book 1, a tour group books 30). When all 200 rooms are booked, new bookings are put on a waitlist in arrival order. When somebody checks out, the next waiting booking is processed if its size fits. A group of 30 will not be skipped over by a single guest behind it, even if 5 rooms are free — that is FIFO head-of-line blocking.

### Restaurant tables

A restaurant has 40 seats. A party of 2 occupies 2 seats; a wedding party of 12 occupies 12 seats. The host seats parties in arrival order. This is exactly a weighted FIFO semaphore.

### Bandwidth limiter

A network link has 100 Mbps of bandwidth. Each open download is granted a slice of that bandwidth proportional to its priority. New downloads wait if the link is saturated. Bandwidth is the semaphore's capacity; downloads are weighted acquisitions.

---

## Mental Models

### Model 1: "A counter and a queue"

`semaphore.Weighted` is two things glued together:

1. A counter `used` from 0 to `N`.
2. A FIFO queue `Q` of waiters, each holding a desired weight.

`Acquire` either bumps `used` (if it fits and `Q` is empty) or appends to `Q`. `Release` decrements `used` and wakes as many head-of-queue waiters as fit.

If you keep these two pieces in mind, everything else follows.

### Model 2: "Lockless until contention"

When capacity is available and nobody is waiting, `Acquire` is just an integer add. It is fast. It becomes expensive only when capacity is exhausted — then the waiter parks on a channel and the OS scheduler is involved. This means putting a semaphore around cheap operations is fine as long as the capacity is generous; only saturated semaphores hurt.

### Model 3: "The slot returns the moment you call `Release`"

`Release(n)` is synchronous in the wake-up sense: by the time `Release` returns, any waiter that fits has been moved from the queue to "granted" status. Their `Acquire` calls may not have returned yet (the scheduler still has to run them), but the semaphore's bookkeeping is final.

### Model 4: "Context is your escape hatch"

The semaphore never times out by itself. The wait is unbounded. The *only* way to stop waiting is for `ctx` to cancel. Treat the `ctx` you pass to `Acquire` as the answer to "what is the worst-case wait I am willing to accept?"

---

## Pros & Cons

### Pros

- **Weighted acquisitions.** The killer feature. Memory budgets, GPU memory, file-handle budgets — any resource where jobs cost different amounts is a natural fit.
- **Context-aware.** Cancellation is a first-class signal. No goroutine ever has to wait forever.
- **FIFO fairness.** No waiter starves. The order is predictable.
- **Tiny API.** Three methods, one type. Easy to read in code review.
- **Production-tested.** Used inside the Go ecosystem and the standard library's `cmd/go`, plus many open-source projects.
- **No internal goroutine.** The semaphore does not spawn a manager. It is purely a struct with a mutex and a list.

### Cons

- **External dependency.** Lives in `golang.org/x/sync`, not the standard library. Adds a module to your `go.mod`.
- **Head-of-line blocking.** A heavy waiter at the front blocks light ones behind. In some workloads this is the wrong policy.
- **Panic on under-release.** Releasing more than acquired panics. The compiler does not help you balance.
- **Capacity is fixed.** No `Resize`. If your workload changes, you must replace the semaphore.
- **No "release on goroutine exit".** Forgetting `Release` leaks slots permanently. There is no automatic cleanup.
- **No introspection.** No `Used()`, no `Waiting()`, no `Available()`. You cannot observe the state from outside.

---

## Use Cases

| Scenario | Why semaphore |
|---|---|
| Bound HTTP outbound concurrency | Cap simultaneous calls so the upstream is not overwhelmed. Capacity = max concurrent. Weight = 1 per call. |
| Limit concurrent disk I/O | Disks have queue depth limits. Cap parallel readers at, say, 16. Weight = 1. |
| Memory budget for image processing | Each image needs roughly `width * height * 4` bytes. Capacity = memory budget; weight = bytes. |
| GPU memory gating | Each model load takes X bytes of VRAM. Capacity = VRAM size; weight = X. |
| Bounded fan-out worker pool | `for each task: go func() { sem.Acquire(ctx,1); defer sem.Release(1); work() }()`. Caps parallelism. |
| File descriptor budget | Capacity = OS fd limit minus headroom; weight = 1 per open file. |
| Rate limit with weight = 1 | Combine with `time.Tick` for a leaky bucket. (Note: better tools exist for pure rate limiting.) |
| Database connection pool gating | If the pool is shared across goroutines and you want to cap usage explicitly, semaphore makes the limit visible. |

| Scenario | Semaphore is wrong tool |
|---|---|
| Need strict order with cancellation per request | A priority queue is what you want. |
| Need to pass actual data between producer/consumer | Channels — semaphores don't carry payload. |
| Need to dynamically resize | Build a worker pool with its own goroutine. |
| Need `select`-able acquire | Use a buffered channel; semaphore cannot participate in `select`. |

---

## Code Examples

### Example 1: Bounded HTTP fetcher

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "sync"

    "golang.org/x/sync/semaphore"
)

func fetchAll(ctx context.Context, urls []string, maxParallel int64) {
    sem := semaphore.NewWeighted(maxParallel)
    var wg sync.WaitGroup

    for _, u := range urls {
        u := u
        wg.Add(1)
        go func() {
            defer wg.Done()
            if err := sem.Acquire(ctx, 1); err != nil {
                log.Printf("acquire %s: %v", u, err)
                return
            }
            defer sem.Release(1)

            resp, err := http.Get(u)
            if err != nil {
                log.Printf("get %s: %v", u, err)
                return
            }
            resp.Body.Close()
            fmt.Printf("%s -> %d\n", u, resp.StatusCode)
        }()
    }
    wg.Wait()
}
```

`maxParallel` HTTP calls run at a time. The remaining ones queue up at `Acquire`. No matter how many URLs you pass, you do not crush your upstream.

### Example 2: Weighted memory budget

```go
const totalBudget int64 = 512 << 20 // 512 MiB

memSem := semaphore.NewWeighted(totalBudget)

func processImage(ctx context.Context, img *Image) error {
    cost := int64(img.Width) * int64(img.Height) * 4 // RGBA
    if err := memSem.Acquire(ctx, cost); err != nil {
        return fmt.Errorf("could not reserve %d bytes: %w", cost, err)
    }
    defer memSem.Release(cost)

    return doExpensiveProcessing(img)
}
```

A 4K image is 8K * 4K * 4 ≈ 128 MiB. At most four 4K images process concurrently, but hundreds of 64x64 thumbnails can run together — exactly what the workload demands.

### Example 3: `TryAcquire` for non-blocking attempt

```go
sem := semaphore.NewWeighted(4)

func tryDoWork() {
    if !sem.TryAcquire(1) {
        // capacity exhausted — skip this round
        return
    }
    defer sem.Release(1)
    work()
}
```

Useful for "best effort" tasks that should give up rather than queue.

### Example 4: Combining with context timeout

```go
acqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()

if err := sem.Acquire(acqCtx, 1); err != nil {
    if errors.Is(err, context.DeadlineExceeded) {
        return errBusy
    }
    return err
}
defer sem.Release(1)
```

Wait at most 5 seconds for a slot, then give up cleanly.

### Example 5: Channel-as-semaphore (the alternative)

```go
slots := make(chan struct{}, 8) // capacity 8

func work() {
    slots <- struct{}{} // acquire
    defer func() { <-slots }() // release

    doWork()
}
```

This is simpler and standard-library-only. It works perfectly for the *unweighted* case (every slot is 1 unit). You cannot express weighted acquisitions this way.

### Example 6: The "channel can't do weighted" demo

Suppose every job has a memory cost between 1 and 64 units, budget 256.

With a channel: you would need a separate buffered channel per weight, or a complex tally — not practical.

With `semaphore.Weighted`:

```go
sem := semaphore.NewWeighted(256)

func job(cost int64) {
    sem.Acquire(ctx, cost)
    defer sem.Release(cost)
    work(cost)
}
```

One line per job. The semaphore handles the budgeting.

---

## Coding Patterns

### Pattern 1: Acquire-then-defer-Release

Always defer the release immediately after a successful acquire:

```go
if err := sem.Acquire(ctx, n); err != nil {
    return err
}
defer sem.Release(n)
// work
```

Never put work between `Acquire` and `defer Release`. If that work panics or returns early, the slot leaks.

### Pattern 2: Acquire outside the goroutine, release inside

Sometimes you want to *block* the caller until a slot is free before spawning the worker:

```go
for _, task := range tasks {
    if err := sem.Acquire(ctx, 1); err != nil {
        return err
    }
    go func(t Task) {
        defer sem.Release(1)
        process(t)
    }(task)
}
```

This is the standard "bounded fan-out" pattern. The producer blocks on `Acquire`, so the loop runs at semaphore speed. The goroutine releases when done.

### Pattern 3: Acquire then check context

After `Acquire` returns, the context might still be cancelled by the time you start the work. Check before doing anything expensive:

```go
if err := sem.Acquire(ctx, 1); err != nil {
    return err
}
defer sem.Release(1)

if ctx.Err() != nil {
    return ctx.Err()
}
work(ctx)
```

`work(ctx)` should also respect `ctx`.

### Pattern 4: Sentinel context for "must acquire"

When you really must acquire and there is no caller-supplied context, pass `context.Background()`:

```go
sem.Acquire(context.Background(), 1)
defer sem.Release(1)
```

This is honest — it says "I am willing to wait forever." Use sparingly; most production code should respect cancellation.

---

## Clean Code

- **Name your semaphore for what it gates.** Not `sem`, but `httpSlots`, `memBudget`, `gpuMem`. The variable name documents the resource.
- **Wrap the semaphore in a type if you have policy.** If acquires always take the same weight or have validation, hide the raw `Weighted` behind a method:
  ```go
  type Budget struct{ s *semaphore.Weighted }
  func (b *Budget) Reserve(ctx context.Context, bytes int64) (release func(), err error) {
      if err := b.s.Acquire(ctx, bytes); err != nil { return nil, err }
      return func() { b.s.Release(bytes) }, nil
  }
  ```
- **Pair every `Acquire` with one `Release` in the same function** when possible. Cross-function balancing is brittle.
- **Comment the capacity choice.** "256 MiB image-processing budget chosen empirically — see issue #1234" is much better than a bare `NewWeighted(256<<20)`.
- **Prefer `defer` over manual release.** Manual release is fine in tight loops, but `defer` is the safer default.

---

## Product Use / Feature

You are building a file-conversion service. Each request uploads an image and asks for a thumbnail. Conversions are CPU-bound and memory-hungry. Without limits, 1000 concurrent uploads OOM the box.

Design:

```go
type ConvertService struct {
    cpu *semaphore.Weighted // capacity == NumCPU
    mem *semaphore.Weighted // capacity == 512 MiB
}

func NewConvertService() *ConvertService {
    return &ConvertService{
        cpu: semaphore.NewWeighted(int64(runtime.GOMAXPROCS(0))),
        mem: semaphore.NewWeighted(512 << 20),
    }
}

func (c *ConvertService) Convert(ctx context.Context, img *Image) (*Thumbnail, error) {
    cost := int64(img.Width) * int64(img.Height) * 4
    if err := c.mem.Acquire(ctx, cost); err != nil {
        return nil, err
    }
    defer c.mem.Release(cost)

    if err := c.cpu.Acquire(ctx, 1); err != nil {
        return nil, err
    }
    defer c.cpu.Release(1)

    return c.convertLocked(img)
}
```

Two semaphores: one for CPU (capacity = number of cores), one for memory (capacity = available RAM). Acquire memory first, then CPU. This is real production shape. The order matters — acquiring memory before CPU prevents holding a CPU slot while waiting for memory.

---

## Error Handling

`Acquire` can return only `ctx.Err()`. Treat it like any other context error:

```go
if err := sem.Acquire(ctx, 1); err != nil {
    if errors.Is(err, context.Canceled) {
        return errors.New("operation cancelled")
    }
    if errors.Is(err, context.DeadlineExceeded) {
        return errors.New("operation timed out waiting for slot")
    }
    return err // future-proofing
}
```

`Release` does not return errors. If you call it with a wrong amount, you crash:

```go
sem.Acquire(ctx, 5)
sem.Release(10) // panic: semaphore: released more than held
```

To prevent this, *always release the same weight you acquired*, captured in a local variable:

```go
const cost int64 = 5
sem.Acquire(ctx, cost)
defer sem.Release(cost)
```

`TryAcquire` returns `bool`. There is no error. Handle the `false` case explicitly:

```go
if !sem.TryAcquire(1) {
    return errBusy
}
defer sem.Release(1)
```

---

## Security Considerations

- **Untrusted weights are a denial-of-service risk.** If user input controls the weight, a malicious caller can pass `math.MaxInt64`. `Acquire` will then block forever (or until ctx cancels). Validate and cap weights from untrusted sources.
- **Slot exhaustion is a DoS vector.** If an attacker can make many acquisitions without releasing (e.g., open many long-lived connections), they can lock out legitimate users. Always use a `ctx` with a timeout for untrusted-origin acquisitions.
- **Panics on under-release expose buggy code.** Run `go test -race` and load-test. A panic in production means a `Release` path is wrong somewhere.

---

## Performance Tips

- **Uncontended `Acquire` is fast.** A successful acquire when the queue is empty is one mutex + one integer compare-and-decrement. Tens of nanoseconds.
- **Contended `Acquire` is scheduler-bound.** Once you park, wakeup takes microseconds at best. Do not put a semaphore around nanosecond-scale work.
- **Weight = 1 is essentially free.** No special-cased fast path versus weight = 1000, but the math is the same.
- **Don't read the source under load.** There is no `Used()` method to call between operations. Other languages have one; Go's doesn't because it would invite TOCTOU bugs.
- **Reuse the semaphore.** Construct once per resource, share across goroutines. Constructing inside a hot loop defeats the purpose.

---

## Best Practices

1. **Pair `Acquire` and `Release` in the same function** with `defer`.
2. **Always pass a real `ctx`** — never `nil`.
3. **Use constants or captured variables for weights** so `Acquire` and `Release` cannot drift.
4. **Choose capacity based on a measured limit**, not a guess. Profile the resource, set the cap to 80% of what you can sustain.
5. **Prefer a channel-as-semaphore** for the simple "limit to N goroutines" case. Reach for `semaphore.Weighted` when weights vary or when context-aware cancellation matters.
6. **Wrap in a domain type** if you have policy (validation, metrics, logging around acquire/release).
7. **Document the capacity choice** in code comments. Future readers will thank you.
8. **Test the saturated path** — write a unit test that pushes more work than the semaphore can handle and verifies queueing and cancellation work.

---

## Edge Cases & Pitfalls

### `Acquire(ctx, n)` with `n > capacity`

```go
sem := semaphore.NewWeighted(8)
sem.Acquire(ctx, 100) // blocks until ctx cancels — never succeeds
```

The semaphore does not return an error for "impossible". It simply waits. If `ctx` has no deadline, this is a deadlock. Validate weights before acquiring.

### Forgetting `Release`

A leaked slot is a permanent loss. The remaining capacity is now `N - 1`. After enough leaks, the semaphore is permanently saturated and the program hangs.

```go
sem.Acquire(ctx, 1)
if cond {
    return // BUG: missed Release
}
sem.Release(1)
```

Always `defer`.

### Releasing the wrong weight

```go
sem.Acquire(ctx, 10)
sem.Release(5)  // leaks 5 units
sem.Release(20) // panic
```

The semaphore tracks the total `used` count, not individual reservations. Releasing less leaks; releasing more panics. Capture the cost.

### Acquire from a goroutine that may never run

```go
go func() {
    sem.Acquire(ctx, 1)
    defer sem.Release(1)
    work()
}()
```

If the main goroutine exits before the spawned one acquires, the program ends and nothing happens. That is not a semaphore issue, but a goroutine-lifecycle one — pair with `sync.WaitGroup` or `errgroup`.

### Reordering Acquire and Release

```go
sem.Release(1)
sem.Acquire(ctx, 1)
```

`Release(1)` panics because nothing has been acquired yet. The semaphore is not a "free counter"; it tracks balance.

### `TryAcquire` when queue is non-empty

```go
sem := semaphore.NewWeighted(10)
sem.Acquire(ctx, 10)               // sem is full
go func() { sem.Acquire(ctx, 5) }() // parked; queue length 1

time.Sleep(10 * time.Millisecond)
sem.Release(8)                     // 8 free, but queue head wants 5
ok := sem.TryAcquire(1)            // ok == false — queue is non-empty
```

`TryAcquire` respects FIFO. It cannot jump the queue.

---

## Common Mistakes

### Mistake 1: Passing `nil` context

```go
sem.Acquire(nil, 1) // panic: nil context.Context.Done called
```

Always pass `context.Background()` if you have nothing else.

### Mistake 2: Calling `Acquire` inside `Release`

```go
defer func() {
    sem.Release(1)
    sem.Acquire(ctx, 1) // ???
}()
```

Re-acquiring inside the defer of a release path is almost always wrong. The original consumer thinks it has released; the new acquire is a separate transaction.

### Mistake 3: Sharing a semaphore between unrelated workloads

```go
var globalSem = semaphore.NewWeighted(8)

// in HTTP handler
globalSem.Acquire(ctx, 1)

// in background worker
globalSem.Acquire(ctx, 1)
```

Now HTTP handlers and background workers fight for the same 8 slots. If the background worker holds 8 long-running slots, no HTTP request can proceed. Separate semaphores per resource.

### Mistake 4: Using `Acquire` on a hot path

Putting `sem.Acquire(ctx, 1)` around a function call that runs millions of times per second adds mutex contention even when the semaphore is not saturated. Reserve semaphores for coarse-grained gating.

### Mistake 5: Using the semaphore as a mutex

```go
sem := semaphore.NewWeighted(1)

// some critical section
sem.Acquire(ctx, 1)
critical()
sem.Release(1)
```

This works, but `sync.Mutex` is simpler, has no `ctx` overhead, and is faster. Use the semaphore when capacity > 1 or when context-aware locking matters.

### Mistake 6: Releasing in a deferred goroutine

```go
sem.Acquire(ctx, 1)
go func() {
    defer sem.Release(1)
    work()
}()
```

If `work()` runs after the calling function returns, this is fine — but make sure the calling code doesn't also `defer sem.Release(1)`. Double release panics.

---

## Common Misconceptions

### "A semaphore is a mutex"

A binary semaphore behaves like a mutex but is *not* one. With a mutex, only the locker can unlock. With a semaphore, *any* goroutine can release. This makes semaphores good for hand-off patterns and bad as a drop-in mutex replacement.

### "Channels do everything a semaphore does"

Almost — but not weighted acquisitions. A buffered channel of capacity 8 limits to 8 holders. It cannot express "this job costs 4, that job costs 1". For unweighted gating, the channel is simpler.

### "The semaphore times out by itself"

It does not. It waits forever unless `ctx` cancels. The capacity says nothing about wait time.

### "`TryAcquire` jumps the queue"

It does not. `TryAcquire` returns `false` when the queue is non-empty, even if capacity is free, to preserve FIFO order.

### "Release wakes the longest-waiting goroutine"

Yes — but only if its weight fits. If the longest-waiting wants 10 and only 5 freed up, nobody wakes. The 5 units sit idle until more is released.

### "Capacity is the maximum number of goroutines"

For weight = 1, yes. With variable weights, capacity is the maximum *sum* of weights. Two jobs of weight 3 each = 6 units used.

---

## Tricky Points

### Acquire of weight 0

`sem.Acquire(ctx, 0)` returns `nil` immediately. There is nothing to release. This is mostly useful in generic code that may pass 0.

### Capacity of 0

`semaphore.NewWeighted(0)` creates a semaphore that can never be acquired (with positive weight). Every `Acquire(ctx, 1)` blocks until ctx cancels. Useful as a "kill switch" that you never activate.

### Acquire returns nil but ctx is cancelled

After `Acquire` returns `nil`, `ctx.Err()` may be non-nil if the cancellation raced with the grant. The slot is yours regardless. Check `ctx.Err()` before doing work.

### The semaphore has no goroutine

There is no internal goroutine. Nothing runs in the background. If your program is hung in `Acquire`, only a `Release` from somebody else or a `ctx` cancel can free it.

### `Release` from a different goroutine than `Acquire`

Allowed and useful. You can `Acquire` in the producer and `Release` in the consumer to hand off a slot.

---

## Test

A minimal sanity test:

```go
package mypkg

import (
    "context"
    "testing"
    "time"

    "golang.org/x/sync/semaphore"
)

func TestSemaphoreBasic(t *testing.T) {
    sem := semaphore.NewWeighted(2)
    ctx := context.Background()

    if err := sem.Acquire(ctx, 1); err != nil { t.Fatal(err) }
    if err := sem.Acquire(ctx, 1); err != nil { t.Fatal(err) }
    if sem.TryAcquire(1) { t.Fatal("expected TryAcquire to fail") }
    sem.Release(1)
    if !sem.TryAcquire(1) { t.Fatal("expected TryAcquire to succeed") }
    sem.Release(1)
    sem.Release(1)
}

func TestSemaphoreCancel(t *testing.T) {
    sem := semaphore.NewWeighted(1)
    ctx := context.Background()

    sem.Acquire(ctx, 1) // saturate

    ctx2, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
    defer cancel()

    if err := sem.Acquire(ctx2, 1); err == nil {
        t.Fatal("expected timeout error")
    }
}
```

Run with `go test -race -count=10 ./...` to shake out concurrency bugs.

---

## Tricky Questions

**Q1.** What happens if I call `Acquire` with `n > capacity`?
**A.** It blocks forever or until `ctx` cancels. The semaphore does not return an error for impossible requests.

**Q2.** Can I `Release` more than I acquired?
**A.** No — it panics with `"semaphore: released more than held"`.

**Q3.** Is `semaphore.Weighted` safe for concurrent use?
**A.** Yes. All methods are safe to call from multiple goroutines.

**Q4.** Does `TryAcquire` jump the queue when capacity is free but waiters are queued?
**A.** No. `TryAcquire` returns `false` when the queue is non-empty.

**Q5.** What is the difference between a semaphore with capacity 1 and a mutex?
**A.** Functionally similar, but a mutex can only be unlocked by its locker; a semaphore can be released by any goroutine. Mutex is faster and simpler when both are an option.

**Q6.** When should I prefer a buffered channel over `semaphore.Weighted`?
**A.** Unweighted gating, `select`-based acquisition, or when you do not want an external dependency.

**Q7.** What if I forget to call `Release`?
**A.** The slot is gone for the lifetime of the semaphore. Eventually the semaphore is permanently saturated.

**Q8.** Is the FIFO ordering documented or accidental?
**A.** Documented. The package guarantees FIFO.

---

## Cheat Sheet

```go
import "golang.org/x/sync/semaphore"

// Construct
sem := semaphore.NewWeighted(N)

// Reserve, blocking
if err := sem.Acquire(ctx, weight); err != nil { return err }
defer sem.Release(weight)

// Reserve, non-blocking
if !sem.TryAcquire(weight) { /* busy */ }
defer sem.Release(weight) // only if true

// Return
sem.Release(weight)

// Channel equivalent (weight = 1 only)
slots := make(chan struct{}, N)
slots <- struct{}{}            // acquire
defer func() { <-slots }()     // release
```

Capacity rules:
- `weight > capacity` blocks forever.
- `weight = 0` returns nil immediately.
- `capacity = 0` semaphore cannot be acquired with positive weight.

---

## Self-Assessment Checklist

- [ ] I can explain what a counting semaphore is and how it differs from a mutex.
- [ ] I can use `NewWeighted`, `Acquire`, `TryAcquire`, `Release` confidently.
- [ ] I understand why the package is "weighted" and can give an example use case.
- [ ] I can compare a semaphore with a buffered channel acting as one and choose between them.
- [ ] I know how `ctx` cancellation interacts with `Acquire`.
- [ ] I know what happens when capacity is exceeded by a single acquire.
- [ ] I know that `Release` panics when over-released.
- [ ] I know the FIFO ordering guarantee.
- [ ] I have written a small program that uses a semaphore to bound HTTP concurrency.

---

## Summary

`golang.org/x/sync/semaphore` is the standard Go tool for weighted, FIFO, context-aware concurrency limiting. The API is three methods on one type. You construct with a capacity, acquire a weight before doing work, and release the same weight after. Context cancellation gives you a clean way out of an unbounded wait.

The most common use case is "bound the number of in-flight operations" with weight = 1, where it competes directly with a buffered channel. The semaphore wins when weights vary — memory budgets, GPU memory, variable-cost jobs — and when context-aware cancellation is needed.

The most common bugs are forgetting `Release`, releasing the wrong weight, and acquiring with `n > capacity`. Discipline with `defer` and constant weights eliminates most of them.

---

## What You Can Build

- A bounded HTTP fetcher that never opens more than N connections.
- A memory-budgeted image processor.
- A worker pool gated by both CPU count and memory.
- A file-descriptor budget for an application that opens many files.
- A rate-limited webhook dispatcher.
- A "best effort" probe that returns immediately if all probe slots are busy (`TryAcquire`).
- A custom worker pool that uses `errgroup` for error propagation and `semaphore` for concurrency limiting.

---

## Further Reading

- Package documentation: `pkg.go.dev/golang.org/x/sync/semaphore`
- Source code: `golang.org/x/sync/semaphore/semaphore.go` (~100 lines, read it)
- "The Little Book of Semaphores" by Allen Downey — for the algorithmic foundations.
- Dijkstra's 1965 paper "Cooperating Sequential Processes" — the original.
- The `errgroup` documentation in the same module — pairs nicely with semaphores.

---

## Related Topics

- `06-errgroup-x-sync/01-errgroup` — group goroutines and propagate the first error; pairs with semaphore for bounded workers with error handling.
- `03-sync-package/01-mutex` — for the capacity-1 case where a semaphore would be overkill.
- `05-concurrency-patterns/02-fan-out` — the fan-out worker pool that benefits most from semaphore gating.
- `02-channels/02-buffered` — the channel-as-semaphore alternative.
- `04-context/01-context-basics` — required reading for understanding `Acquire(ctx, n)`.
- `06-errgroup-x-sync/03-singleflight` — another `x/sync` tool for deduplicating concurrent work.

---

## Diagrams & Visual Aids

### Semaphore as counter + queue

```
capacity = 8
used = 5
free = 3

waiters (FIFO):
  head -> [w=4] -> [w=1] -> [w=2] -> tail
                                       <- new arrivals append here

If Release(3) is called: used drops to 2, free = 6.
Head wants 4, which fits. Wake head, used = 6, free = 2.
Next head wants 1, fits. Wake, used = 7, free = 1.
Next head wants 2, does NOT fit. Stop.
```

### Acquire flow

```
Acquire(ctx, n)
   |
   v
take s.mu
   |
   v
queue empty AND n <= free?
   |             |
   yes           no
   |             |
   v             v
cur += n     append(ctx, n, ready) to queue
release mu       release mu
return nil       select {
                   case <-ctx.Done(): cleanup, return err
                   case <-ready:      return nil
                 }
```

### Channel-as-semaphore vs `semaphore.Weighted`

```
chan struct{}, cap N:
  acquire: <- send  (blocks if full)
  release: <- recv  (always non-blocking after acquire)
  weighted? no
  selectable? yes
  context? no (need select with ctx.Done)

semaphore.Weighted, cap N:
  acquire: Acquire(ctx, w)  (blocks; returns on success or ctx)
  release: Release(w)
  weighted? yes
  selectable? no
  context? yes (built-in)
```
