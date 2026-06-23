# Fan-Out — Junior Level

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
> Focus: "I have one channel of work. How do I have N goroutines process it in parallel?"

You wrote a function that does one thing slowly — say, fetching a URL or hashing a password. You called it inside a `for` loop. The loop is sequential and your eight CPU cores sit idle. You want the work to run in parallel.

The simplest pattern for this in Go is **fan-out**: take a single channel that carries jobs, and start N goroutines (the *workers*) that all read from the same channel. Each worker takes one job, processes it, and loops. When the input channel is closed and drained, every worker exits.

Fan-out is the dual of fan-in. Fan-in merges N inputs into one channel; fan-out splits one channel into N parallel readers. The two patterns are usually used together: a producer feeds a channel, fan-out distributes the work, each worker writes its output to a result channel, and fan-in merges those results back into a single stream. That whole shape is called "fan-out, fan-in".

After reading this file you will:
- Understand what fan-out means and why it speeds up work
- Be able to start N workers reading from one channel
- Know how to wait for every worker to finish using `sync.WaitGroup`
- Understand how to combine fan-out with fan-in to produce one merged result stream
- Recognise the difference between fan-out and a worker pool
- Know the basic shutdown rule: close the input, then `wg.Wait`

You do **not** need `errgroup`, `context`, or generics yet — those land in the middle level.

---

## Prerequisites

- **Required:** Comfort with goroutines and channels (`chan`, `<-`, `range`, `close`).
- **Required:** Knowing what `sync.WaitGroup` does.
- **Helpful:** Having read the Channels chapter and the Fan-In page.
- **Helpful:** Knowing the difference between buffered and unbuffered channels.

If you can spawn three goroutines that all read from the same channel and finish when it is closed, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Fan-out** | A pattern that distributes values from one input channel across N concurrent worker goroutines. |
| **Worker** | A goroutine that loops on `for job := range in { ... }` and processes one job at a time. |
| **Pool size** | The number of workers, usually called `n` or `numWorkers`. Common defaults are `runtime.NumCPU()` for CPU-bound work and a tuned higher number for IO-bound work. |
| **Job** | One unit of work — usually a struct or a primitive. The input channel's element type. |
| **Result** | The output of processing one job. Workers may emit a result channel of these. |
| **Fan-out, fan-in** | The combined pattern: a producer feeds one channel, N workers process in parallel, their outputs are merged back into one channel. |
| **Worker pool** | A long-lived structure of workers, often with lifecycle management. Fan-out is a snapshot of a worker pool's distribution behaviour. |
| **Saturation** | The state where every worker is busy. Adding more producers no longer increases throughput. |
| **Backpressure** | The slowdown felt by producers when workers cannot keep up — `ch <- job` blocks until a worker is ready. |

---

## Core Concepts

### One channel, many readers

A Go channel allows multiple goroutines to receive from it. Each value is delivered to exactly one receiver — never to two. So if you launch N goroutines that all run `for job := range in { process(job) }`, the runtime distributes each job to exactly one of them.

```go
in := make(chan int)
for i := 0; i < 4; i++ {
    go func() {
        for v := range in {
            fmt.Println("worker got", v)
        }
    }()
}
for i := 0; i < 10; i++ {
    in <- i
}
close(in)
```

This works, but the program exits before the workers finish because `main` does not wait. Fan-out always pairs with a `WaitGroup`.

### The skeleton with WaitGroup

```go
func fanOut(in <-chan int, n int, work func(int)) {
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                work(v)
            }
        }()
    }
    wg.Wait()
}
```

The producer is responsible for closing `in` when there are no more jobs. Each worker exits when its `range` loop sees the closed channel. After all workers exit, `wg.Wait` returns.

### Workers all read the same channel

This is the load-balancing trick. Whichever worker is *ready* on its `range` (i.e. blocked in receive) gets the next value. Fast workers naturally pick up more jobs; slow workers pick up fewer. There is no scheduler logic to write — the runtime handles it.

### Fan-out + fan-in: producing results

Most real fan-outs return values, not just side effects. Each worker writes to a shared output channel, and the caller reads merged results.

```go
func fanOutInts(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v * v
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Notice the closer goroutine: it waits for every worker, then closes `out`. This is exactly the same pattern as fan-in. In fact, this whole function *is* a fan-in of N invisible per-worker streams, all writing into one shared `out` channel.

### Fan-out vs worker pool

The terms are close cousins. The differences:

| Aspect | Fan-out | Worker pool |
|--------|---------|-------------|
| Lifecycle | Created and destroyed per call. | Long-lived, often started at program init. |
| Focus | Distribution semantics. | Resource management (queue, max workers, idle timeout). |
| Typical signature | `fanOut(in chan T, n int)`. | `pool.Submit(job)`. |
| Identity | Workers are anonymous. | Workers may have ids or roles. |

Junior code usually starts with fan-out. Worker pools come later when you want to bound concurrency for the entire process.

---

## Real-World Analogies

### A grocery store checkout
One queue feeds N cashiers. Each cashier serves whichever customer is at the front of the queue when they become free. Fast cashiers naturally process more customers; slow ones process fewer. Customers do not pre-assign themselves to a cashier.

### A taxi rank
One queue of arriving passengers, several taxis at the head of the rank. The next taxi takes the next passenger. New taxis can be added without coordinating with the queue.

### A printer queue
One queue of print jobs, several printers. Each printer takes the next job when ready.

### A pizza chain dispatching deliveries
The kitchen prints pickup tickets onto a single rack. Several drivers are on call. Whoever is back from a previous delivery picks up the next ticket.

### A McDonald's drive-through with parallel cooks
A single ticket printer feeds N cooks. Each cook takes the next ticket and prepares the order independently. Output is a steady stream of finished orders.

---

## Mental Models

### Model 1: "All workers wait at the same gate"
Every worker is parked in `<-in`. The runtime hands the next value to whichever worker happens to be ready — typically a uniform random one. The faster a worker finishes, the sooner it returns to the gate.

### Model 2: "The input channel is the work queue"
Do not build a separate queue. The channel is the queue. Buffering it controls how much work the producer can stage ahead of consumers.

### Model 3: "Closing the input is the shutdown signal"
There is no Stop method. To stop the workers, close the input channel. They will drain remaining values and exit.

### Model 4: "Fan-out adds workers, not parallelism"
Workers can run in parallel only if the work is parallelisable. CPU-bound work scales up to GOMAXPROCS; IO-bound work scales much higher because most workers are blocked on the network.

### Model 5: "Producer rate × worker capacity = throughput"
If your producer can only emit 100 jobs/sec, adding more workers above that point does nothing. If your workers each handle 50 jobs/sec, two workers cap throughput at 100. The bottleneck moves between producer and consumers as N changes.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Simple to implement (loop + WaitGroup). | All workers share one channel — single slow worker reduces effective parallelism only at the bottleneck. |
| Free load balancing via channel select. | No per-worker priority — every worker is equal. |
| Scales linearly for IO-bound work. | CPU-bound work stops scaling at GOMAXPROCS. |
| Composes with fan-in cleanly. | Cancellation needs a separate mechanism (ctx). |
| Easy to test — just count results. | Pool sizing requires measurement. |
| No external dependency. | Errors need extra design (errgroup, result struct). |

---

## Use Cases

- **Parallel HTTP fetcher** — one channel of URLs, N workers fetching them concurrently.
- **File processor** — list of file paths, N workers reading and parsing in parallel.
- **Image transformation batch** — N workers resizing images.
- **Database batch loader** — N workers writing rows in parallel within a connection pool.
- **CSV ingester** — one parser feeds a channel, N workers convert and store rows.
- **Webhook deliveries** — outbound queue, N workers POSTing to external endpoints.
- **Hash computation** — N workers computing SHA-256 of files for deduplication.

---

## Code Examples

### Example 1: minimum fan-out

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    in := make(chan int)
    var wg sync.WaitGroup
    n := 3

    wg.Add(n)
    for i := 0; i < n; i++ {
        i := i
        go func() {
            defer wg.Done()
            for v := range in {
                fmt.Printf("worker %d got %d\n", i, v)
            }
        }()
    }

    for j := 0; j < 9; j++ {
        in <- j
    }
    close(in)
    wg.Wait()
}
```

### Example 2: fan-out with results (fan-out, fan-in)

```go
func square(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v * v
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 5; i++ {
            in <- i
        }
    }()

    var sum int
    for v := range square(in, 4) {
        sum += v
    }
    fmt.Println("sum of squares:", sum) // 55
}
```

### Example 3: parallel HTTP fetch

```go
func fetch(urls <-chan string, n int) <-chan string {
    out := make(chan string)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for url := range urls {
                resp, err := http.Get(url)
                if err != nil {
                    out <- fmt.Sprintf("%s: %v", url, err)
                    continue
                }
                resp.Body.Close()
                out <- fmt.Sprintf("%s: %d", url, resp.StatusCode)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

### Example 4: counting per-worker totals

```go
func countByWorker(in <-chan int, n int) []int {
    counts := make([]int, n)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        i := i
        go func() {
            defer wg.Done()
            for range in {
                counts[i]++
            }
        }()
    }
    wg.Wait()
    return counts
}
```

This pattern is fine because each worker writes only to its own slot. There is no race.

### Example 5: graceful drain

```go
func main() {
    in := make(chan int, 10)
    go func() {
        defer close(in)
        for i := 0; i < 50; i++ {
            in <- i
        }
    }()

    out := square(in, 8)
    for v := range out {
        fmt.Println(v)
    }
    fmt.Println("done")
}
```

When the producer closes `in`, the eight workers drain remaining buffered values, each calls `wg.Done`, then the closer closes `out`, then the consumer's `range` exits.

---

## Coding Patterns

### Pattern: explicit worker count
Take `n int` as a parameter. Do not hardcode a number. Document the suggested default for IO vs CPU.

### Pattern: closer goroutine
A goroutine that waits on the WaitGroup and closes the output channel. Same as fan-in.

### Pattern: capture loop variable safely
`i := i` (or use `for i := range slice` and pass `i` as a closure argument). Without this, all workers share the same `i`.

### Pattern: separate worker function
Pull the worker body into a named function for readability:

```go
func worker(in <-chan Job, out chan<- Result) {
    for j := range in {
        out <- process(j)
    }
}
```

### Pattern: producer closes input, fan-out closes output
The producer (caller) is responsible for `close(in)`. The fan-out function is responsible for `close(out)`. Never the reverse.

---

## Clean Code

- Name workers anonymously inside the function — there is no need to expose them.
- Use `n` for the worker count parameter.
- Keep job and result types in a small, named struct.
- Document the worker count behaviour in a comment ("recommended N = NumCPU for CPU-bound work").
- Keep the fan-out function short. If it grows beyond ~30 lines, extract a worker function.
- Buffer the output channel to a small constant (e.g. `n`) only after measuring.

---

## Product Use / Feature

In production, fan-out usually appears in two places:

1. **Background ingest workers.** Your service receives a stream of events from Kafka, Pub/Sub, or an HTTP endpoint. A producer goroutine pushes parsed events onto a channel. N workers run heavier processing (DB writes, API calls). The number N is tuned per environment.

2. **Per-request fan-out.** Inside one request handler, you need to make M outgoing calls in parallel (e.g. fetch product info from M services). A fan-out scoped to that request reads from a slice of jobs, makes the calls, returns the results, and shuts down. This is "ephemeral fan-out" — it lives only for one request.

A junior implementation should usually pick option 2 for request-scoped work and option 1 for background work. Both use the same channel-and-WaitGroup skeleton.

---

## Error Handling

Three ways to handle errors in fan-out:

1. **Result struct with error.** Each worker emits `Result{V: ..., Err: err}`. The consumer inspects `Err` per item.
2. **Separate error channel.** Workers write errors to one channel and successes to another. Two consumers (or one with `select`) read both.
3. **First-error cancellation.** If any worker fails, cancel the rest. This is the `errgroup` pattern, covered in middle.md.

For junior code, option 1 is usually best:

```go
type Result struct {
    URL    string
    Status int
    Err    error
}
```

---

## Security Considerations

- **Resource exhaustion.** Fan-out can saturate downstream resources (DB, external API). Bound N to what those resources can handle, or use a token-bucket rate limiter.
- **Fork bomb.** If each worker spawns more workers without bound, you can OOM in seconds. Keep fan-out flat.
- **Shared state.** Workers must not write the same map, slice, or struct field without synchronisation. Per-worker output is safer than shared collections.

---

## Performance Tips

- For CPU-bound work, set `n = runtime.NumCPU()` as the starting point.
- For IO-bound work, set `n` to "the smallest number that saturates the downstream resource". Often 8x to 100x NumCPU.
- Buffer the input channel slightly so the producer does not block on every send.
- Avoid sending tiny values (single bytes) — batch them into chunks first.
- Profile with `pprof` and watch the `select` time on workers; if it dominates, your job is too small relative to the channel overhead.

---

## Best Practices

1. Always pair fan-out with a `WaitGroup`.
2. Always close the input channel from the producer side.
3. Always have a single closer goroutine that closes the output.
4. Always document the worker count behaviour (defaults, recommended values).
5. Always test with N=1 and N=many.
6. Always handle errors via a result struct or a dedicated error channel.
7. Always run `go test -race`.

---

## Edge Cases & Pitfalls

- **N = 0.** No workers, no draining; the producer blocks on first `in <- v`. Reject N=0 in your fan-out function.
- **N > number of jobs.** Some workers idle the entire run. That is fine; they just exit when input closes.
- **Producer never closes input.** Workers never exit. Make the producer close the channel.
- **Worker panics.** A panic kills the worker goroutine, leaving the WaitGroup counter too high; the closer never fires. Recover inside workers if any job can panic.
- **Workers share a `*bytes.Buffer` or a `map`.** Race condition. Each worker should have its own scratch space, or use a mutex.

---

## Common Mistakes

1. Calling `wg.Add` inside the goroutine — race with `wg.Wait`.
2. Closing the output channel from inside a worker — panics when the next worker writes.
3. Passing a non-buffered output to fan-in workers and a slow consumer — workers all block, deadlock.
4. Writing to shared `[]int` without synchronisation — race.
5. Forgetting to close the input — workers hang.
6. Capturing `i` by reference in a closure — every worker prints the same id.
7. Using `runtime.NumCPU()` for IO-bound work — wildly under-provisioned.

---

## Common Misconceptions

- "Fan-out means each worker gets a copy of every value." It does not. Each value goes to exactly one worker. If you want broadcast, use a different pattern.
- "More workers always = more speed." Only up to a bottleneck. After that, more workers add overhead.
- "Workers must be the same function." They can vary, but usually they are identical to keep distribution fair.
- "Fan-out preserves input order." It does not. Faster workers finish earlier; the merged output is reordered.
- "The output channel must be closed by every worker." No. The closer goroutine closes it once.

---

## Tricky Points

- **Channel select fairness.** Go's runtime distributes values uniformly *over time* but not in any particular pattern. Do not rely on round-robin.
- **Workers blocked on output.** If `out` is unbuffered and the consumer is slow, all workers block on `out <-`. The producer also blocks. Total throughput is the consumer's rate.
- **Result ordering.** If you need the i-th input's result at index i in a slice, use indexed jobs (`Job{ID, Payload}`) and place results by ID.
- **Cancellation.** Without ctx, there is no clean way to stop workers mid-job. Junior code drains to completion. Middle level introduces ctx.

---

## Test

```go
package main

import (
    "sync"
    "testing"
)

func square(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v * v
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func TestSquareFanOut(t *testing.T) {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 4; i++ {
            in <- i
        }
    }()

    sum := 0
    for v := range square(in, 3) {
        sum += v
    }
    if sum != 1+4+9+16 {
        t.Fatalf("got %d, want 30", sum)
    }
}
```

Run with `go test -race`.

---

## Tricky Questions

1. **Why does each value go to exactly one worker?** Because Go's channel is a FIFO queue with one delivery per send.
2. **What happens if I close the output before the workers finish?** Panic on next `out <-`.
3. **How do I stop workers mid-job?** Use `context.Context` and `select`. Junior code does not.
4. **Why might 100 workers be slower than 10?** Channel and scheduler overhead exceeds the marginal speedup if jobs are tiny.
5. **What is the difference between fan-out and a worker pool?** Fan-out is a one-shot distribution; a worker pool is a long-lived structure with lifecycle.
6. **What happens if N = 0?** No workers; producer blocks on first send forever (deadlock).
7. **Can workers all be different functions?** Yes — but then it is not really fan-out, it is a switchboard.
8. **What if my workers need configuration?** Pass it via a closure or a struct, not via the input channel.

---

## Cheat Sheet

```go
// Canonical fan-out, fan-in.
func process[T, R any](in <-chan T, n int, work func(T) R) <-chan R {
    out := make(chan R)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                out <- work(v)
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

| Step | Code |
|------|------|
| Output channel | `out := make(chan R)` |
| Count workers | `wg.Add(n)` |
| Spawn workers | `for i := 0; i < n; i++ { go ... }` |
| Worker body | `for v := range in { out <- work(v) }` |
| Closer | `go func() { wg.Wait(); close(out) }()` |
| Producer side | `defer close(in)` after sending |

---

## Self-Assessment Checklist

- [ ] I can write a fan-out skeleton from memory.
- [ ] I know who closes the input and who closes the output.
- [ ] I can combine fan-out with fan-in.
- [ ] I can pick a reasonable N for IO vs CPU work.
- [ ] I can describe what happens at N=0 and N=very-large.
- [ ] I can handle errors via a Result struct.
- [ ] I can test the function with `-race` and pass.

---

## Summary

Fan-out distributes work from one channel to N workers. Each worker reads with `for v := range in` and writes results into a shared output channel. A `WaitGroup` lets a closer goroutine close the output once every worker has exited. Combined with fan-in, fan-out is the foundation of every parallel batch job in Go.

---

## What You Can Build

- A parallel URL prober that tells you which URLs return 200.
- A directory hasher that computes SHA-256 of every file in a tree using N workers.
- A bulk image resizer that processes images from a slice in parallel.

---

## Further Reading

- The Go Blog: "Go Concurrency Patterns: Pipelines and cancellation".
- Cox-Buday, *Concurrency in Go*, chapter on fan-out.
- The `golang.org/x/sync/errgroup` package documentation.

---

## Related Topics

- Fan-in (the dual pattern).
- Pipeline (uses fan-out for parallel stages).
- Worker pools (long-lived fan-out).
- `errgroup` (errors + cancellation, middle.md).

---

## Diagrams & Visual Aids

```
                fan-out
        ┌──▶ worker 1 ─┐
in ─────┼──▶ worker 2 ─┼──▶ out
        ├──▶ worker 3 ─┤
        └──▶ worker N ─┘

Each value from `in` goes to exactly one worker.
Workers all write into `out`.
Closer goroutine closes `out` after wg.Wait.
```

```
Lifecycle:
  producer ─▶ close(in)
  workers  ─▶ drain ─▶ wg.Done
  closer   ─▶ wg.Wait ─▶ close(out)
  consumer ─▶ range exits
```
