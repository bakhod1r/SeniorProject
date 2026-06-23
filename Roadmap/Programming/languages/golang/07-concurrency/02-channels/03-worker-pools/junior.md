# Worker Pools — Junior Level

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
> Focus: "I have 10,000 things to do and I want N goroutines to do them in parallel without melting my laptop."

A **worker pool** is the most useful concurrency pattern you will write in Go. The idea is small enough to fit on a napkin: instead of spawning one goroutine per task — which runs out of memory at scale and floods downstream services — you start a fixed number of goroutines (workers) and feed them tasks through a channel.

Three pieces, three lines of mental model:

1. A **jobs channel** — producers send tasks here.
2. **N workers** — each worker is a goroutine that loops, reading from the jobs channel.
3. A **results channel** (optional) — workers push outputs here.

That is the entire pattern. It bounds concurrency to N, applies backpressure when workers are busy, and shuts down cleanly when the jobs channel is closed.

After reading this file you will:
- Understand why "one goroutine per task" is a beginner trap
- Know the canonical jobs / workers / results layout
- Be able to write a correct worker pool with `sync.WaitGroup`
- Understand graceful shutdown via `close(jobs)`
- Know when to choose buffered vs unbuffered channels for jobs and results
- Recognise the four classic deadlocks in worker-pool code
- Be able to size your pool with rough rules of thumb

You do **not** need to know about `errgroup`, `context.Context`, dynamic resizing, or `sync.Pool` yet. Those come at the middle and senior levels. This file is about getting your first pool working without leaks, deadlocks, or silent data drops.

---

## Prerequisites

- **Required:** Working Go installation (1.18+). Check with `go version`.
- **Required:** Comfort with goroutines (`go func() { ... }()`).
- **Required:** Familiarity with unbuffered and buffered channels (`make(chan T)`, `make(chan T, N)`).
- **Required:** Understanding of `for v := range ch` and `close(ch)`.
- **Helpful:** Having read [Buffered vs Unbuffered Channels](../01-buffered-vs-unbuffered/junior.md). Without that, the buffer-sizing decisions in this file will feel arbitrary.
- **Helpful:** Basic `sync.WaitGroup` usage (`Add`, `Done`, `Wait`).

If you can write a simple `go func() { ch <- 42 }()` and read it back without deadlocking, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Worker pool** | A fixed number of long-lived goroutines that consume tasks from a shared channel. |
| **Worker** | A single goroutine inside the pool. Loops over the jobs channel until it is closed. |
| **Job** | A single unit of work. Usually a struct describing what to do (`type Job struct { ID int; Payload []byte }`). |
| **Result** | The output a worker produces from one job. Sent to a results channel. |
| **Jobs channel** | The channel producers use to send work to workers. Closed when no more jobs will be produced. |
| **Results channel** | The channel workers use to send outputs to consumers. Closed when all workers are done. |
| **Backpressure** | The natural slow-down that happens when workers are full and producers block on `jobs <- job`. |
| **Bounded concurrency** | A guarantee that no more than N tasks run in parallel. Workers enforce this. |
| **Graceful shutdown** | Stopping the pool such that every dispatched job finishes before the program exits. |
| **`sync.WaitGroup`** | A counter used to wait for a known number of goroutines to finish. The standard tool for "wait for all workers to exit." |
| **Pool size** | The number of workers. Often called `N`, `numWorkers`, or `workerCount`. |
| **Producer** | The goroutine (often `main`) that pushes jobs onto the jobs channel. |
| **Consumer** | The goroutine that pulls results off the results channel. |

---

## Core Concepts

### The naive "one goroutine per task" trap

Beginners write this:

```go
for _, url := range urls {
    go fetch(url)
}
```

This works for 10 URLs. It does not work for 100,000. You will:
- Open 100,000 sockets.
- OOM on the goroutine stacks (each ~2 KiB minimum, often more).
- Get rate-limited or banned by the remote server.
- Hammer your DNS resolver.
- Lose the ability to know when the work is done.

A worker pool fixes all of these by capping concurrency at N.

### The three-channel anatomy

```text
producers ──► [ jobs chan ] ──► worker 1 ──┐
                              │            │
                              ├─► worker 2 ─┼──► [ results chan ] ──► consumer
                              │            │
                              └─► worker N ─┘
```

- One **jobs** channel. Many producers (often one) write; many workers read.
- One **results** channel. Many workers write; one or more consumers read.
- Workers themselves do the loop: `for job := range jobs { results <- process(job) }`.

### Why a fixed number of workers?

Because the *real* expensive resource is rarely "a goroutine." It is what each goroutine *uses*: a TCP connection, a database session, a CPU core, a file handle, a remote API quota. A pool of N workers means at most N of those resources are in flight at any moment.

### Closing the jobs channel signals "no more work"

The producer signals it is done by calling `close(jobs)`. Each worker's `for job := range jobs` loop ends naturally when the channel is closed *and* drained. This is the graceful-shutdown handshake.

You almost never close the jobs channel from a worker — only the producer who owns it should close it. (Closing a channel is the producer's responsibility, always.)

### Closing the results channel after all workers exit

The results channel is closed by whoever waits for the workers to finish. Pattern:

```go
go func() {
    wg.Wait()
    close(results)
}()
```

The consumer's `for r := range results` loop ends when this `close` happens.

### `sync.WaitGroup` is the headcount

`WaitGroup` is a counter. Every worker spawn does `wg.Add(1)`. Every worker exit does `wg.Done()`. The orchestrator does `wg.Wait()` to block until the count reaches zero.

Three rules that prevent 90% of WaitGroup bugs:

1. Call `wg.Add(N)` *before* spawning goroutines (not inside them).
2. Always pair `wg.Add` with a `defer wg.Done()` at the top of the goroutine.
3. Only one goroutine should call `wg.Wait()` for a given group.

### Backpressure is automatic when channels are unbuffered

If you use an unbuffered jobs channel, a producer that tries to send blocks until a worker is ready. That is backpressure for free — producers slow down naturally to match worker throughput.

If you buffer the jobs channel with capacity B, you allow up to B "in-flight but unprocessed" jobs before producers block. Larger B = more burst tolerance, less smoothing.

---

## Real-World Analogies

**1. A coffee shop with three baristas.** Customers (jobs) line up at the counter (jobs channel). The shop has three baristas (workers). When all three are busy, the line grows (backpressure). When the shop closes for the day (`close(jobs)`), the baristas finish the customers in line and then leave. They do not keep hiring new baristas just because more customers walked in.

**2. A car wash conveyor.** Cars enter at one end (jobs channel), pass through N parallel wash bays (workers), and exit (results channel). The conveyor controls throughput; you cannot wash more than N cars at once even if 1,000 are queued.

**3. A restaurant kitchen.** The expediter (producer) places tickets on the rail (jobs channel). The line cooks (workers) pull tickets one at a time. Plated dishes go to the pass (results channel) where a server (consumer) carries them out. The kitchen has a fixed number of stations; you cannot add more by yelling.

**4. A team of movers.** Boxes (jobs) get loaded into the truck. The truck has a crew of N people (workers). When the boxes are gone (`close(jobs)`), the crew finishes what they are carrying and goes home. You do not hire 10,000 movers because there are 10,000 boxes — you hire 5 and they keep moving.

---

## Mental Models

### Model 1 — A pool is a *throttle*, not a *speedup*

A worker pool does not magically make your work faster. It bounds concurrency. The benefit is *predictability*: 8 cores, 8 workers, no thrashing. The lesson: pick N for the *resource* you are throttling, not for the size of the input.

### Model 2 — Channels are queues; workers are servers

Think Little's Law: `inflight = arrival_rate × service_time`. Workers are servers, jobs channel is the queue. If arrival > N × (1/latency), the queue grows. Buffered channels delay this; they do not prevent it.

### Model 3 — `close(jobs)` is the drumbeat that ends the song

Workers cannot guess that work is done. They only know "the channel is closed." Until you close, every worker stays in `range`, alive but idle. Forgetting to close is the #1 cause of a hung pool.

### Model 4 — One owner per channel

Every channel has exactly one *closer*. For jobs, the producer. For results, whoever waits on the WaitGroup. Multiple closers is a panic. Zero closers is a leak.

### Model 5 — A pool is a "structured concurrency" boundary

Inside `Wait()` returning, you have N goroutines plus a producer. After `Wait()` returns, you have 0 worker goroutines. The function that spawns the pool should also wait for it — keep the lifecycle local.

---

## Pros & Cons

### Pros

- **Bounded concurrency.** You cannot accidentally spawn 100k goroutines.
- **Backpressure for free.** Producers slow down when workers cannot keep up.
- **Lifecycle is explicit.** Spawn, dispatch, close, wait. No hidden goroutines.
- **Maps to real resources.** N workers ≈ N DB connections / N HTTP clients / N CPU cores.
- **Easy to reason about.** The shape is the same in every program: jobs in, results out.
- **Testable.** A pool with a mock processor is straightforward to unit-test.
- **Minimal dependencies.** Just `sync` and `chan`. No external libraries needed for the basic form.

### Cons

- **Picking N is hard.** Too few and you starve. Too many and you thrash.
- **Result ordering is not preserved.** Workers finish in random order; if you need ordered output you need extra machinery.
- **Error handling is awkward.** Workers cannot easily signal "stop everything"; you bolt on context or errgroup.
- **One slow job blocks one worker.** No work-stealing; if 1 of N jobs is 100x slower, that worker is occupied for the duration.
- **Static sizing is rigid.** Adapting N at runtime is more complex than it looks.
- **Channel close discipline is a gotcha.** Double-close panics. No-close hangs. Off-by-one is fatal.
- **WaitGroup `Add` placement is a recurring source of races.**

---

## Use Cases

| Use case | Job | Worker | Why a pool? |
|----------|-----|--------|-------------|
| Web scraper | URL to fetch | HTTP GET + parse | Bound concurrent requests to be polite to servers and avoid local socket exhaustion. |
| Image thumbnailer | Image path | Resize and write | CPU-bound; N ≈ NumCPU. |
| Batch DB inserter | Row to insert | Insert via pooled conn | Bound to DB connection pool size. |
| Email sender | Message | SMTP send | Throttle to provider rate limit. |
| Log shipper | Log batch | POST to remote | Bound network sockets. |
| File hasher | File path | SHA-256 | CPU-bound parallelism on multi-core machines. |
| Webhook fanout | Event | POST to subscribed URL | Limit outbound concurrency per provider. |
| Test runner | Test name | Spawn subprocess | Bound parallelism by core count. |

---

## Code Examples

### Example 1 — The smallest worker pool that works

```go
package main

import (
    "fmt"
    "sync"
)

type Job struct{ N int }
type Result struct{ N, Square int }

func worker(id int, jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
    defer wg.Done()
    for j := range jobs {
        results <- Result{N: j.N, Square: j.N * j.N}
        _ = id // could log id, omitted for brevity
    }
}

func main() {
    const numWorkers = 3
    jobs := make(chan Job, 5)
    results := make(chan Result, 5)
    var wg sync.WaitGroup

    for w := 1; w <= numWorkers; w++ {
        wg.Add(1)
        go worker(w, jobs, results, &wg)
    }

    // Producer
    go func() {
        for n := 1; n <= 5; n++ {
            jobs <- Job{N: n}
        }
        close(jobs)
    }()

    // Closer
    go func() {
        wg.Wait()
        close(results)
    }()

    // Consumer
    for r := range results {
        fmt.Printf("%d^2 = %d\n", r.N, r.Square)
    }
}
```

Read the four anonymous goroutines as four roles: **workers** (3), **producer** (1), **closer** (1), **consumer** (main). The closer is the goroutine that turns "all workers exited" into "results channel is closed."

### Example 2 — Removing the closer goroutine when work is finite

If you know exactly how many results to expect, you can drain that many and skip the closer goroutine:

```go
const total = 5
for i := 0; i < total; i++ {
    r := <-results
    fmt.Println(r)
}
// no close, no range, no closer goroutine
```

This is brittle: if a worker fails to produce a result, you hang forever. Prefer the `close(results)` pattern.

### Example 3 — Pool with `sync.WaitGroup` only (no results channel)

If workers only have side effects (writing files, calling APIs) and you don't need return values:

```go
package main

import (
    "fmt"
    "sync"
)

func worker(id int, jobs <-chan int, wg *sync.WaitGroup) {
    defer wg.Done()
    for j := range jobs {
        fmt.Printf("worker %d processed job %d\n", id, j)
    }
}

func main() {
    jobs := make(chan int, 100)
    var wg sync.WaitGroup
    for w := 1; w <= 4; w++ {
        wg.Add(1)
        go worker(w, jobs, &wg)
    }
    for n := 1; n <= 10; n++ {
        jobs <- n
    }
    close(jobs)
    wg.Wait()
}
```

Notice the symmetry: producer closes `jobs`, `wg.Wait()` blocks until all workers see the close and exit.

### Example 4 — Returning values without a results channel using a slice

For small fan-in patterns where you collect into a slice (not streaming):

```go
results := make([]Result, len(inputs))
var wg sync.WaitGroup
sem := make(chan struct{}, 4) // 4-wide semaphore
for i, in := range inputs {
    wg.Add(1)
    sem <- struct{}{}
    go func(i int, in Input) {
        defer wg.Done()
        defer func() { <-sem }()
        results[i] = process(in)
    }(i, in)
}
wg.Wait()
```

This preserves ordering (each goroutine writes its own slot) and bounds concurrency without a long-lived worker. We will revisit this "semaphore" form at middle and senior level.

### Example 5 — A pool that prints its identity

Useful for first-time learners — see which worker handled which job:

```go
func worker(id int, jobs <-chan int, results chan<- string, wg *sync.WaitGroup) {
    defer wg.Done()
    for j := range jobs {
        results <- fmt.Sprintf("worker=%d job=%d", id, j)
    }
}
```

When you run this with `numWorkers=3` and 10 jobs, you will see the workload distribute *unevenly* — Go's scheduler does not round-robin. That is normal.

### Example 6 — Pool with a heavyweight job (sleep)

Models I/O latency; helps you observe the pool actually parallelising:

```go
import "time"

func worker(id int, jobs <-chan int, wg *sync.WaitGroup) {
    defer wg.Done()
    for j := range jobs {
        time.Sleep(500 * time.Millisecond)
        fmt.Printf("[worker %d] finished job %d\n", id, j)
    }
}
```

With 4 workers and 8 jobs, total wall time is ~1 second (8 × 0.5s / 4), not 4 seconds.

### Example 7 — Producer that errors out mid-way

This is the question the next level answers in detail; the junior fix is "close jobs in the producer's defer":

```go
go func() {
    defer close(jobs)
    for _, in := range inputs {
        if err := validate(in); err != nil {
            return // close still runs
        }
        jobs <- toJob(in)
    }
}()
```

Workers exit naturally even on early termination of the producer.

### Example 8 — Anatomy in a single function

```go
func RunPool(inputs []int, numWorkers int) []int {
    jobs := make(chan int)
    results := make(chan int)
    var wg sync.WaitGroup

    // Workers
    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- j * j
            }
        }()
    }

    // Producer
    go func() {
        for _, in := range inputs {
            jobs <- in
        }
        close(jobs)
    }()

    // Closer
    go func() {
        wg.Wait()
        close(results)
    }()

    // Drain
    out := make([]int, 0, len(inputs))
    for r := range results {
        out = append(out, r)
    }
    return out
}
```

Caller does not see any goroutines. They do not need to. This is the structured-concurrency endpoint of the pattern at junior level.

---

## Coding Patterns

### Pattern: Defer-close in producer

```go
go func() {
    defer close(jobs)
    for _, in := range inputs {
        jobs <- toJob(in)
    }
}()
```

Closes even if the producer panics or returns early.

### Pattern: Defer-Done in worker

```go
go func() {
    defer wg.Done()
    for j := range jobs {
        // ...
    }
}()
```

Done runs even on panic.

### Pattern: Closer goroutine

```go
go func() { wg.Wait(); close(results) }()
```

Two-line idiom for "close results once all workers exit."

### Pattern: Range over the consumer side

```go
for r := range results {
    // handle r
}
```

Simpler than counting expected results.

### Pattern: Capture the loop variable when spawning

```go
for w := 0; w < N; w++ {
    w := w // shadow
    go func() { worker(w, ...) }()
}
```

In Go 1.22+ this is no longer required for `for` range loops, but the habit costs nothing.

---

## Clean Code

- **Name workers consistently.** `worker(id, jobs, results, wg)` is the canonical signature.
- **Pass channels with directions.** `<-chan Job` for input, `chan<- Result` for output. Lets the compiler catch mistakes.
- **One file per pool.** A 100-line pool function is fine; do not split into 5 files until the design needs it.
- **No magic numbers.** Define `const numWorkers = ...` or pass it as a parameter.
- **Pool builder returns drain function or output channel, never goroutines.** The caller should not need to know how many goroutines you spawned.

---

## Product Use / Feature

A user uploads a 100-image batch. The web handler enqueues each image into a worker pool that resizes them. The handler returns a "processing started" response in milliseconds; an async consumer collects results and updates the database. The pool size is tuned to the number of CPU cores available on the worker machine. If a pool of 4 can handle 8 images per second, the queue absorbs short bursts and applies backpressure on sustained overload — preventing OOM during a flash sale.

---

## Error Handling

At junior level, two strategies cover most code:

### 1. Embed the error in the result

```go
type Result struct {
    Out int
    Err error
}
```

The consumer decides what to do per result — log, retry, abort.

### 2. Worker recovers from panics

```go
go func() {
    defer wg.Done()
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v", r)
        }
    }()
    for j := range jobs {
        // process
    }
}()
```

Without `recover`, one bad job crashes the whole program.

The middle level introduces `errgroup` for "stop everyone when anyone fails." At junior, embedding the error in the result is the right reflex.

---

## Security Considerations

- **Bounded concurrency mitigates DoS amplification.** A pool of 8 workers calling external services cannot accidentally turn into 8,000 outbound requests.
- **Per-job timeouts prevent slowloris-style starvation.** If one job hangs forever, the worker is stuck. Always set a timeout (covered at middle level).
- **Validate jobs before enqueue.** Untrusted input on the jobs channel can crash workers; sanitise at the producer.
- **Resource accounting per job.** A job that uses a database session must release it on every exit path (use `defer`).
- **Don't share secrets across workers via globals.** Pass per-worker state explicitly.

---

## Performance Tips

- **Match N to the bottleneck.** CPU-bound: N ≈ `runtime.NumCPU()`. I/O-bound: N can be much larger (50, 100, or whatever the remote service tolerates).
- **Buffer the jobs channel modestly.** A buffer of `2 × N` smooths bursts without piling up memory.
- **Buffer the results channel symmetrically.** Otherwise workers stall on send when the consumer is slow.
- **Profile before tuning.** `go test -bench` and `pprof` answer "is this even worth optimising?"
- **Avoid per-job allocations in hot loops.** If a worker allocates 1 KiB per job and processes 1M jobs, that is 1 GiB of garbage. Use `sync.Pool` (senior topic) or reuse buffers.

---

## Best Practices

- **One closer per channel.** The producer closes `jobs`. The closer goroutine closes `results`.
- **Close from the writer side, never the reader.** Closing a channel you only read from panics on the next send by the writer.
- **Use directional channel types in function signatures.** `chan<- T` and `<-chan T` document intent and catch bugs.
- **Encapsulate the pool in a function.** Return the output channel or a drain function. Do not leak goroutines.
- **Always pair `wg.Add` with `wg.Done`, ideally `Add` outside the goroutine.**
- **Never close a channel inside a worker.** Workers are readers; readers do not close.
- **Test with `-race`.** Worker pools touch shared state (channels) heavily; race detection catches bugs early.

---

## Edge Cases & Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Forgot to `close(jobs)` | Pool hangs on `wg.Wait()` | Add `close(jobs)` after the producer loop |
| Closed `jobs` while a producer was still sending | Panic: "send on closed channel" | Single owner closes; add a barrier (sync.Once or context) |
| Forgot to drain `results` | Workers block on `results <- r`; pool hangs | Always range over `results` or count expected outputs |
| Closed `results` from a worker | Panic when another worker sends | Close from the closer goroutine, never from a worker |
| `wg.Add(1)` inside the goroutine | Race with `wg.Wait()` returning early | Move `Add(1)` before `go func()` |
| Pool of size 0 | Hangs forever | Validate `N >= 1` |
| Producer panics | Channel never closed; pool hangs | `defer close(jobs)` in producer |
| One slow job | Worker stuck on it; throughput drops | Add per-job timeout (middle level) |

---

## Common Mistakes

1. **Spawning a goroutine per task instead of using a pool.** First instinct is wrong at scale.
2. **Closing the jobs channel inside a worker.** Workers read; closers write the close.
3. **Calling `wg.Wait()` without ever calling `wg.Done()`.** Hang forever.
4. **Calling `wg.Add` after the goroutine has started.** `Wait` may return before all workers register.
5. **Mismatched `Add` and `Done` counts.** `Add(N); spawn N-1` — Wait blocks forever.
6. **Sending on a closed channel.** Crash. Usually from a producer that didn't see the cancellation.
7. **Forgetting the closer goroutine.** Consumer hangs in `for r := range results`.
8. **Dropping results because the consumer exited.** Workers block on send; pool grinds to a halt.
9. **Not using `-race` during development.** Pool bugs are very often races.
10. **Hard-coding the pool size to 10.** Always parameterise.

---

## Common Misconceptions

- **"More workers = faster."** Only up to the bottleneck. Past it, more workers just thrash.
- **"Workers process in order."** They do not. The Go scheduler is not round-robin.
- **"Closing the jobs channel kills running workers."** No — it lets them finish their current job, then exits the `range` loop.
- **"You need to close the jobs channel from each worker."** No — close it exactly once, from the producer.
- **"`sync.WaitGroup` waits for `time.Sleep` to finish."** No — it waits for `wg.Done()` calls. Sleep is irrelevant.
- **"Channels are slow; pools must be slow."** Channels have some overhead but are very fast for typical job sizes (microseconds of work or more).

---

## Tricky Points

- **`Add` is unsynchronised with `Wait`.** If a goroutine you forgot to count calls `Done`, the counter goes negative — panic. Symmetric: if you `Add` a count that never gets `Done`'d, you hang forever.
- **`for j := range jobs` exits when the channel is closed *and drained***. Not when it is closed. So a closed channel with 100 buffered items will keep delivering them until empty.
- **A `nil` channel blocks forever.** `var ch chan int; ch <- 1` deadlocks. Useful in `select` (later topic) but a junior-level trap.
- **Channels are FIFO per send/receive but not across workers.** Worker A might process job 5 before worker B processes job 3.
- **WaitGroup is by value-or-pointer?** Always pointer in shared code. Copying a `WaitGroup` is silently wrong.

---

## Test

```go
package pool

import (
    "sync"
    "testing"
)

func TestPoolSquaresAll(t *testing.T) {
    inputs := []int{1, 2, 3, 4, 5}
    expected := map[int]int{1: 1, 2: 4, 3: 9, 4: 16, 5: 25}

    jobs := make(chan int, len(inputs))
    results := make(chan struct{ in, out int }, len(inputs))
    var wg sync.WaitGroup
    for w := 0; w < 3; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- struct{ in, out int }{j, j * j}
            }
        }()
    }
    for _, in := range inputs {
        jobs <- in
    }
    close(jobs)
    go func() { wg.Wait(); close(results) }()

    got := map[int]int{}
    for r := range results {
        got[r.in] = r.out
    }
    if len(got) != len(expected) {
        t.Fatalf("missing results: got %d want %d", len(got), len(expected))
    }
    for k, v := range expected {
        if got[k] != v {
            t.Fatalf("got[%d] = %d want %d", k, got[k], v)
        }
    }
}
```

Run with `go test -race`. A correct pool should pass under race detection.

---

## Tricky Questions

1. **Why not just `go fetch(url)` in a loop?** Unbounded concurrency: OOM, socket exhaustion, downstream rate-limit. A pool bounds it.
2. **Who closes the jobs channel?** The producer that owns it. Always exactly one closer.
3. **Who closes the results channel?** The "closer" goroutine, after `wg.Wait()` returns.
4. **What happens if I `close(jobs)` twice?** Panic.
5. **What happens if I send to a closed `jobs`?** Panic.
6. **Why `Add(1)` before `go func()` and not inside?** Because `Wait` could observe a zero counter and return before any goroutine has registered.
7. **How big should the buffer be?** Start with `numWorkers` for jobs and `numWorkers` for results. Tune with measurement.
8. **What if my consumer is slower than my producer?** Workers block on `results <- r`. The pool throttles automatically. That is desired backpressure.
9. **Do I need a results channel?** No — for fire-and-forget side effects, drop it.
10. **Can workers spawn sub-workers?** Yes, but you must wait for them too. Often a sign you want a second pool.

---

## Cheat Sheet

```go
jobs := make(chan Job, N)
results := make(chan Result, N)
var wg sync.WaitGroup

// 1. Spawn workers
for w := 0; w < N; w++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            results <- process(j)
        }
    }()
}

// 2. Produce
go func() {
    defer close(jobs)
    for _, in := range inputs {
        jobs <- toJob(in)
    }
}()

// 3. Close results when all workers are done
go func() { wg.Wait(); close(results) }()

// 4. Consume
for r := range results {
    handle(r)
}
```

Memorise this skeleton. 80% of pools are minor variations.

---

## Self-Assessment Checklist

- [ ] I can write a 30-line worker pool from scratch without looking at notes.
- [ ] I know which goroutine closes `jobs` and which closes `results`.
- [ ] I always pair `wg.Add(1)` with `defer wg.Done()`.
- [ ] I run `go test -race` on pool code.
- [ ] I have an answer for "how big should the pool be?"
- [ ] I know what happens if the consumer stops draining.
- [ ] I can explain backpressure in one sentence.
- [ ] I never close a channel from the receiver side.
- [ ] I use directional channel types in function signatures.
- [ ] I know how to recover from a worker panic.

---

## Summary

A worker pool is N goroutines reading jobs from a channel, processing them, and pushing results into another channel. It bounds concurrency, applies backpressure, and is the foundation of every nontrivial Go concurrent program. The mechanics are mostly about closing the right channel from the right goroutine at the right time — which is why most pool bugs are deadlocks or panics on close, not logic errors in `process(job)`.

You learned: the jobs/workers/results layout, how `sync.WaitGroup` tracks worker exits, how `close(jobs)` triggers shutdown, how to size N for CPU-bound and I/O-bound work, and the dozen ways the pattern can deadlock. From here you graduate to `errgroup`, `context`, dynamic resizing, and production observability.

---

## What You Can Build

- A parallel file hasher that walks a directory and prints SHA-256 for each file.
- A polite web scraper that fetches a list of URLs with N=8 concurrency.
- A bulk image thumbnailer (CPU-bound, N = NumCPU).
- A batch CSV importer that parses lines in parallel and writes them via a single DB session.
- A log-line classifier that reads stdin, classifies in parallel, prints in original order using a sequence number.

---

## Further Reading

- Go Tour — Concurrency: <https://go.dev/tour/concurrency/1>
- Effective Go — Concurrency: <https://go.dev/doc/effective_go#concurrency>
- "Go Concurrency Patterns: Pipelines and cancellation" — <https://go.dev/blog/pipelines>
- "Share Memory by Communicating" — <https://go.dev/blog/codelab-share>
- `sync` package documentation — <https://pkg.go.dev/sync>

---

## Related Topics

- [Buffered vs Unbuffered Channels](../01-buffered-vs-unbuffered/junior.md) — Why buffer sizes matter inside a pool.
- [Select Statement](../02-select-statement/junior.md) — Used at middle level to add cancellation and timeouts.
- [Goroutines](../../01-goroutines/01-overview/junior.md) — The primitive workers are built on.
- Middle level [middle.md](middle.md) — Pool sizing, errgroup, context.
- Senior level [senior.md](senior.md) — Backpressure modelling, dynamic resizing, work stealing.

---

## Diagrams & Visual Aids

```text
                   ┌────────────────┐
   inputs[] ──►   │   PRODUCER     │
                   │ (closes jobs)  │
                   └───────┬────────┘
                           │
                           ▼
                   ┌────────────────┐
                   │  jobs channel  │
                   │  (cap = N)     │
                   └───────┬────────┘
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
       ┌────────┐    ┌────────┐    ┌────────┐
       │ worker │    │ worker │    │ worker │
       │   1    │    │   2    │    │   N    │
       └───┬────┘    └───┬────┘    └───┬────┘
           │            │              │
           └────────────┼──────────────┘
                        ▼
                ┌────────────────┐
                │ results channel│
                │   (cap = N)    │
                └───────┬────────┘
                        ▼
                ┌────────────────┐
                │   CONSUMER     │
                └────────────────┘

WaitGroup tracks: 1 Add per worker spawn, 1 Done per worker exit.
Closer: go func(){ wg.Wait(); close(results) }()
```

```text
LIFECYCLE TIMELINE

   t=0 ─── spawn N workers (wg.Add N)
   t=1 ─── producer starts pushing jobs
   t=2 ─── workers process in parallel, push results
   t=3 ─── producer finishes inputs, close(jobs)
   t=4 ─── workers see close(jobs), drain remaining, exit (wg.Done)
   t=5 ─── wg.Wait() returns; close(results)
   t=6 ─── consumer's range loop ends
```

```text
BACKPRESSURE

  fast producer + slow workers
  ──────────────────────────────
  jobs:       [█][█][█][█][█]   ← full; producer blocks here
  workers:    busy busy busy
  results:    [r1]               ← drains as consumer reads
```
