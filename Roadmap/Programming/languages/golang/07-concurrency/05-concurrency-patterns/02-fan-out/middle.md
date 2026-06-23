# Fan-Out — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Generic Fan-Out, Fan-In](#generic-fan-out-fan-in)
3. [Cancellation](#cancellation)
4. [Errors with `errgroup`](#errors-with-errgroup)
5. [IO-Bound vs CPU-Bound Sizing](#io-bound-vs-cpu-bound-sizing)
6. [Static vs Dynamic Pool Size](#static-vs-dynamic-pool-size)
7. [Combining with Fan-In](#combining-with-fan-in)
8. [Backpressure and Saturation](#backpressure-and-saturation)
9. [Real-World Examples](#real-world-examples)
10. [Idiomatic Code](#idiomatic-code)
11. [Anti-Patterns](#anti-patterns)
12. [Testing Strategy](#testing-strategy)
13. [Performance Profile](#performance-profile)
14. [Tricky Cases](#tricky-cases)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

Junior level introduced fan-out as "N goroutines reading one channel". Middle level upgrades it: generics, `context.Context`, `errgroup`, and pool sizing rules. We focus on idiomatic production code that handles cancellation and errors cleanly, and we discuss how fan-out composes with fan-in.

The shape is unchanged: one input, N workers, one merged output. What changes is the discipline around it.

---

## Generic Fan-Out, Fan-In

A reusable helper:

```go
// Process applies `work` to each value in `in`, using `n` worker goroutines,
// and returns a channel of results. The output is closed when `in` is drained
// or `ctx` is cancelled.
func Process[T, R any](
    ctx context.Context,
    in <-chan T,
    n int,
    work func(context.Context, T) R,
) <-chan R {
    out := make(chan R)
    var wg sync.WaitGroup
    wg.Add(n)

    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-in:
                    if !ok {
                        return
                    }
                    r := work(ctx, v)
                    select {
                    case <-ctx.Done():
                        return
                    case out <- r:
                    }
                }
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

Two `select`s per iteration:
- One around the *receive* so workers exit promptly on cancel.
- One around the *send* so workers don't block forever if the consumer is gone.

This is the "two-select sandwich" — internalise it. Every cancellation-aware worker has this shape.

---

## Cancellation

Without ctx the only way to stop a fan-out is to close its input. That works for clean shutdown but not for "abort early on first error". Ctx is the missing piece.

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

out := Process(ctx, urls, 16, fetch)
for r := range out {
    if r.Err != nil {
        cancel() // tell every worker to stop
        // we still need to drain `out` to avoid leaking workers blocked on send
        for range out {}
        return r.Err
    }
}
```

Two important rules:

1. **Always call `cancel()`.** Even on success, defer it.
2. **Drain after cancel.** Workers may have a result in flight on `out <- r`. Without drain, they block on send and leak.

A cleaner version uses `errgroup`, which handles both rules automatically.

---

## Errors with `errgroup`

`golang.org/x/sync/errgroup` is the standard tool for fan-out with first-error cancellation:

```go
import "golang.org/x/sync/errgroup"

func FetchAll(ctx context.Context, urls []string, n int) ([]string, error) {
    g, ctx := errgroup.WithContext(ctx)
    in := make(chan string)
    out := make(chan string)

    // producer
    g.Go(func() error {
        defer close(in)
        for _, u := range urls {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case in <- u:
            }
        }
        return nil
    })

    // workers
    var wwg sync.WaitGroup
    for i := 0; i < n; i++ {
        wwg.Add(1)
        g.Go(func() error {
            defer wwg.Done()
            for u := range in {
                body, err := fetch(ctx, u)
                if err != nil {
                    return err
                }
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case out <- body:
                }
            }
            return nil
        })
    }

    // closer
    go func() { wwg.Wait(); close(out) }()

    var results []string
    for r := range out {
        results = append(results, r)
    }

    return results, g.Wait()
}
```

Notice:
- `errgroup.WithContext` derives a `ctx` that is cancelled the moment any goroutine returns an error.
- `g.Go` collects the first error and waits for all goroutines.
- The closer goroutine is *not* registered with `g.Go` because it must run regardless of errors.

This pattern is the bedrock of production fan-out in Go.

---

## IO-Bound vs CPU-Bound Sizing

The right `n` depends on what each worker does.

| Workload | Recommended N |
|----------|---------------|
| CPU-bound (hash, encode, parse) | `runtime.NumCPU()` ± 1 |
| IO-bound (HTTP, DB, file) | `K * NumCPU` for some K, often 8-100 |
| Network-bound with low CPU | Tune to the rate-limit of the downstream service |
| Mixed | Profile; start at `2 * NumCPU` and adjust |

Why not just always pick a huge N? Because each worker is a goroutine with its own stack (8 KB initial, growing), and the channel select adds scheduling overhead. At thousands of workers per process, the scheduler itself becomes the bottleneck.

A practical rule: measure. If `pprof` shows workers spending most of their time in `runtime.gopark` (waiting on channel), they are not the bottleneck — the producer or output is. Add workers only until throughput plateaus.

---

## Static vs Dynamic Pool Size

A static pool fixes N at startup. A dynamic pool grows and shrinks based on load.

| Aspect | Static | Dynamic |
|--------|--------|---------|
| Complexity | Trivial | Requires bookkeeping |
| Resource use | Constant | Adapts |
| Suitability | Most batch jobs | Long-lived servers with bursty load |
| Risk | Over-provisioning | Thrashing if not tuned |

For most systems, static is enough. Dynamic resizing is a senior topic.

A middle-ground "cap and queue" pattern: bound max workers, queue extra work in a buffered channel, rely on the queue depth as a back-signal:

```go
in := make(chan Job, 1024) // queue
// fan-out 16 workers from `in`
```

Throughput is bounded by 16 workers; latency rises when the queue fills.

---

## Combining with Fan-In

The output of a fan-out is already a fan-in (workers all write into one channel). When you want to fan-out *several* stages and merge them, write a higher-order helper:

```go
func Parallel[T, R any](
    ctx context.Context,
    in <-chan T,
    n int,
    work func(context.Context, T) R,
) <-chan R {
    workers := make([]<-chan R, n)
    for i := 0; i < n; i++ {
        workers[i] = oneWorker(ctx, in, work)
    }
    return Merge(ctx, workers...) // from fan-in
}

func oneWorker[T, R any](ctx context.Context, in <-chan T, work func(context.Context, T) R) <-chan R {
    out := make(chan R)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done(): return
            case v, ok := <-in:
                if !ok { return }
                select {
                case <-ctx.Done(): return
                case out <- work(ctx, v):
                }
            }
        }
    }()
    return out
}
```

The two implementations (`Process` and `Parallel`) produce the same observable behaviour but with different internal layouts. `Process` writes everyone into a shared channel; `Parallel` gives each worker its own channel and uses `Merge` to fan-in. They are interchangeable in practice.

---

## Backpressure and Saturation

Two backpressure points:

1. **Producer to workers.** The producer's `in <- v` blocks if no worker is ready and `in` is full or unbuffered.
2. **Workers to consumer.** The worker's `out <- r` blocks if the consumer is slow.

If the consumer is slow, all workers block on send. The producer eventually blocks because no worker is calling receive. The whole pipeline pauses. This is correct backpressure; do not "fix" it by buffering until everything fits in memory.

Saturation means every worker is busy. Adding more workers above saturation does nothing if downstream is capped (e.g. database connection pool). The right response is to raise the downstream cap or accept the throughput.

---

## Real-World Examples

### Parallel HTTP fetcher
A web crawler maintains an HTTP client with a connection pool. The fan-out is sized to match the pool size: `n = transport.MaxConnsPerHost`. Each worker fetches one URL, parses, queues new URLs to a separate channel.

### Image batch resizer
A batch job receives 50,000 image paths. The fan-out is sized to `runtime.NumCPU()` because resizing is CPU-bound (decode, resize, re-encode). The output is `<-chan ResizedImage` written by all workers and consumed by a single uploader.

### Database row processor
Read a million rows from one table, transform each, write to another. Workers pull from a row channel; each worker uses one DB connection from a pool. `n = poolSize - 1` (leave a connection for the writer).

### Per-request scatter-gather
A handler receives a request that needs data from M backend services. It spawns M workers in a fan-out, fetches in parallel, gathers results. Bounded by request timeout via ctx.

---

## Idiomatic Code

```go
// Process applies `work` to every value from `in`, using `n` workers.
// Workers exit on the first of:
//  - in is closed and drained, or
//  - ctx is cancelled.
//
// The returned channel is closed when all workers exit. Errors from `work`
// must be encoded in R; for first-error cancellation use errgroup.
func Process[T, R any](
    ctx context.Context,
    in <-chan T,
    n int,
    work func(context.Context, T) R,
) <-chan R
```

A doc comment of this kind makes intent unambiguous: cancellation, closing, error policy.

---

## Anti-Patterns

- **Capturing the loop variable in a goroutine without rebinding.** `for i := 0; i < n; i++ { go func() { fmt.Println(i) }() }` — all print `n`.
- **Ignoring `ctx` inside the worker body.** Workers run to completion and the cancel does nothing.
- **Closing the output from inside a worker.** Causes a panic when the next worker writes.
- **Letting workers communicate via shared state.** Use channels; if you must share, lock.
- **Sizing N by guesswork without measuring.** Profile first.

---

## Testing Strategy

Two test kinds:

1. **Correctness.** Submit a known set, assert the output set matches (sorted comparison; fan-out does not preserve order).
2. **Cancellation.** Submit infinite work; cancel after a few results; assert no goroutine leak (use `go.uber.org/goleak`).

```go
import "go.uber.org/goleak"

func TestProcessNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)

    ctx, cancel := context.WithCancel(context.Background())
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 1000; i++ {
            select {
            case <-ctx.Done(): return
            case in <- i:
            }
        }
    }()

    out := Process(ctx, in, 8, func(_ context.Context, v int) int {
        time.Sleep(time.Millisecond)
        return v * 2
    })

    var got int
    for range out {
        got++
        if got == 5 { cancel() }
    }
}
```

`goleak.VerifyNone` fails the test if any goroutine is still alive at the end.

---

## Performance Profile

`runtime.GOMAXPROCS(0)` gives you the parallelism cap. For CPU-bound work, throughput rises linearly until you hit GOMAXPROCS, then plateaus. For IO-bound work it rises until the downstream bottleneck.

A simple benchmark:

```go
func BenchmarkProcessCPU(b *testing.B) {
    ns := []int{1, 2, 4, 8, 16, 32}
    for _, n := range ns {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            in := make(chan int)
            go func() {
                defer close(in)
                for i := 0; i < b.N; i++ { in <- i }
            }()
            out := Process(context.Background(), in, n, cpuWork)
            for range out {}
        })
    }
}
```

Plot ns vs ns/op. The optimal `n` is the smallest one at which the curve plateaus.

---

## Tricky Cases

- **n = 0.** Producer blocks. Reject `n <= 0` at function entry.
- **n > number of jobs.** Some workers are idle. Harmless.
- **Worker panics on bad input.** Use `defer recover()` per worker, or treat the panic as a fatal error and let the program crash.
- **Consumer reads partial results.** If only the first K results are needed, cancel ctx after K and drain.

---

## Cheat Sheet

```go
func Process[T, R any](
    ctx context.Context,
    in <-chan T,
    n int,
    work func(context.Context, T) R,
) <-chan R {
    out := make(chan R)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done(): return
                case v, ok := <-in:
                    if !ok { return }
                    select {
                    case <-ctx.Done(): return
                    case out <- work(ctx, v):
                    }
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

| Choice | Pick |
|--------|------|
| Need errors? | `errgroup` |
| Need first-error abort? | `errgroup` + ctx |
| CPU-bound | n = NumCPU |
| IO-bound | n = K * NumCPU, profile |

---

## Summary

Middle-level fan-out adds ctx-driven cancellation, errgroup-driven error semantics, and pool-sizing discipline. The two-select sandwich is the cancellation idiom every worker uses. With these in hand you can build production fan-out, fan-in pipelines that shut down cleanly under all conditions and never leak goroutines.
