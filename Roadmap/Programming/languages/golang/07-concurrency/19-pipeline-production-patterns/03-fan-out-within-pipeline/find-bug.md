---
layout: default
title: Find the Bug
parent: Fan-Out Within Pipeline
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/03-fan-out-within-pipeline/find-bug/
---

# Fan-Out Within a Pipeline Stage — Find the Bug

Each snippet contains at least one bug. Identify the bug, predict the runtime behaviour, and propose a fix.

## Bug 1: Closer in the wrong place

```go
func fanOut(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v * 2
            }
        }()
    }
    wg.Wait()
    close(out)
    return out
}
```

**Bug:** `wg.Wait()` runs in the caller's goroutine, before `return out`. Workers are sending to `out`, but the caller is the consumer and has not started reading — it is still inside `fanOut`. The workers block. `wg.Wait` blocks forever. Deadlock.

**Fix:** Move `wg.Wait()` and `close(out)` into a separate goroutine:
```go
go func() { wg.Wait(); close(out) }()
return out
```

## Bug 2: Worker closes the output

```go
func fanOut(in <-chan int, n int) <-chan int {
    out := make(chan int)
    for i := 0; i < n; i++ {
        go func() {
            defer close(out)
            for v := range in {
                out <- v * 2
            }
        }()
    }
    return out
}
```

**Bug:** Each worker calls `close(out)` on exit. The first worker that exits closes the channel; the next worker that tries to send panics with `send on closed channel`.

**Fix:** Use a single closer goroutine guarded by a WaitGroup. No worker should call `close(out)`.

## Bug 3: `wg.Add` in the wrong place

```go
func fanOut(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        go func() {
            wg.Add(1)        // BUG
            defer wg.Done()
            for v := range in {
                out <- v * 2
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** `wg.Add(1)` is called inside the worker goroutine. Race: the closer's `wg.Wait()` may run before any `Add` and return immediately (counter is 0). Closer closes `out`. Workers panic on send.

**Fix:** Call `wg.Add(1)` *before* `go func()`:
```go
wg.Add(1)
go func() {
    defer wg.Done()
    ...
}()
```

## Bug 4: Captured loop variable (Go < 1.22)

```go
func fanOut(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v + i   // BUG (pre-1.22)
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** Workers share `i`, which is `n` by the time they run. Pre-1.22 they all use the same value (probably `n-1` or `n` depending on timing). Output is wrong; not a panic, just a silent correctness bug.

**Fix:** Pass `i` as a parameter:
```go
go func(i int) {
    defer wg.Done()
    for v := range in {
        out <- v + i
    }
}(i)
```
In Go 1.22+, the loop variable is per-iteration; the bug does not occur.

## Bug 5: Missing range over closed channel

```go
func fanOut(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                v := <-in            // BUG
                out <- v * 2
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** `v := <-in` returns the zero value forever after `in` is closed. The worker never exits. `wg.Wait` never returns. Goroutines leak; output spams zero values.

**Fix:** Use `for v := range in` (which exits when the channel closes), or `v, ok := <-in; if !ok { return }`.

## Bug 6: Closing the input from inside the worker

```go
func fanOut(in chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            defer close(in)         // BUG
            for v := range in {
                out <- v * 2
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** Workers close the input. The first worker to exit closes `in`. The producer's next send panics. Multiple workers each call `close(in)` — the second causes `panic: close of closed channel`.

**Fix:** Workers are consumers of `in`, not its owner. The producer closes `in`. Remove `defer close(in)`. Also: `in` should be `<-chan int` to make this kind of error a compile error.

## Bug 7: Unbuffered output with slow consumer

```go
func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 1_000_000; i++ {
            in <- i
        }
    }()
    out := fanOut(in, 8)
    time.Sleep(time.Hour)
    for range out {
    }
}
```

**Bug:** The consumer sleeps for an hour before reading. Workers block on send to `out`. The producer blocks on send to `in`. Everything stalls. After an hour, when the consumer finally reads, processing resumes — but you have already wasted the time.

**Fix:** The consumer must start reading before the pipeline can flow. If the intent is queueing, use a buffer or a real queue. The `time.Sleep` is the smell.

## Bug 8: Misuse of `select` default

```go
for {
    select {
    case <-ctx.Done():
        return
    case v, ok := <-in:
        if !ok {
            return
        }
        out <- v * 2
    default:
        // busy-loop
    }
}
```

**Bug:** The `default` case turns the `select` into a busy-loop. The worker spins on CPU with no work to do. CPU usage shoots up; throughput collapses; everything is "fine" except the machine is hot.

**Fix:** Remove the `default` case. A `select` without `default` blocks until one of its cases is ready — exactly what we want.

## Bug 9: Sequence-number reorder buffer waits forever

```go
func reorder(in <-chan Tagged[int]) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        next := int64(0)
        pending := make(map[int64]int)
        for t := range in {
            pending[t.Seq] = t.Val
            for {
                v, ok := pending[next]
                if !ok {
                    break
                }
                out <- v
                delete(pending, next)
                next++
            }
        }
    }()
    return out
}
```

```go
// producer sends seqs 0, 1, 2, 4, 5  (skipping 3)
```

**Bug:** After `in` closes, the reorder buffer has items `4` and `5` in `pending` waiting for `next == 3` that never arrives. The function exits without emitting them.

**Fix:** Either the producer guarantees contiguous sequence numbers, or the reorder buffer detects the close-and-gap condition and emits remaining items in seq order (with a documented possibility of gaps). For windowed reorder, advance `next` when the gap exceeds the window.

## Bug 10: `errgroup.SetLimit` and a long worker

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(2)
for _, j := range jobs {
    j := j
    g.Go(func() error {
        return process(j) // no ctx awareness
    })
}
return g.Wait()
```

```go
func process(j Job) error {
    time.Sleep(1 * time.Hour) // ignores ctx
    return nil
}
```

**Bug:** Even on first error from another worker, `gctx` is cancelled — but `process` does not observe ctx and sleeps for an hour. `g.Wait()` hangs for an hour. Cancellation is cooperative; the worker must check ctx.

**Fix:** Make `process` ctx-aware:
```go
func process(ctx context.Context, j Job) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(1 * time.Hour):
        return nil
    }
}
```

## Bug 11: Output send not in select with ctx

```go
for {
    select {
    case <-ctx.Done():
        return
    case v, ok := <-in:
        if !ok {
            return
        }
        out <- work(v)       // BUG: blocks forever if consumer gone
    }
}
```

**Bug:** The receive from `in` is in a select with `ctx.Done()`, but the send to `out` is not. If the consumer abandoned `out` and ctx is cancelled, the worker is stuck on `out <- work(v)` forever.

**Fix:** Wrap the output send in a select too:
```go
select {
case <-ctx.Done():
    return
case out <- work(v):
}
```

## Bug 12: Per-key fan-out with shared map

```go
results := make(map[string][]int)
for i := 0; i < n; i++ {
    go func() {
        for j := range queues[i] {
            results[j.Key] = append(results[j.Key], j.Val) // BUG: race
        }
    }()
}
```

**Bug:** All workers write to `results` concurrently. Concurrent map writes panic with `fatal error: concurrent map writes` (not a normal panic; the runtime aborts).

**Fix:** Use a `sync.Mutex` around map access, or use `sync.Map`, or — better — write results to a channel and have a single goroutine aggregate.

## Bug 13: Forgot `defer wg.Done()`

```go
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() {
        for v := range in {
            if v == 42 {
                return    // forgot wg.Done()
            }
            out <- v
        }
        wg.Done()
    }()
}
```

**Bug:** On the early-return path (`v == 42`), `wg.Done()` is not called. The WaitGroup counter never reaches zero on that worker. Closer's `wg.Wait()` blocks forever. Output never closes. Consumer hangs.

**Fix:** Use `defer wg.Done()` as the very first statement after the goroutine starts. It runs on every exit path.

## Bug 14: Wrong context in nested errgroup

```go
g, gctx := errgroup.WithContext(ctx)
for _, j := range jobs {
    j := j
    g.Go(func() error {
        innerG, _ := errgroup.WithContext(ctx) // BUG: parent ctx, not gctx
        innerG.SetLimit(2)
        for _, sub := range j.SubJobs {
            sub := sub
            innerG.Go(func() error {
                return process(sub)
            })
        }
        return innerG.Wait()
    })
}
return g.Wait()
```

**Bug:** The inner errgroup uses `ctx` (parent), not `gctx` (outer group's context). When the outer group's context is cancelled (due to another worker's error), the inner group's sub-workers do not observe the cancellation.

**Fix:** Use `gctx` for the inner errgroup:
```go
innerG, _ := errgroup.WithContext(gctx)
```

## Bug 15: Buffered output sized for the wrong scenario

```go
out := make(chan Result, 10_000_000)
```

**Bug:** The output buffer is enormous. Even if the consumer is slow, items pile up in the buffer to 10 million entries (likely OOM). Backpressure is masked; the bug appears only when memory is exhausted, far from where it was caused.

**Fix:** Use a modest buffer (N to 2N where N is the worker count). If you need to absorb bursts, model the burst explicitly with a sized queue or a separate stage; do not abuse the channel buffer.

## Bug 16: A `nil` channel that never panics, never proceeds

```go
var in chan int                 // nil; not initialised
out := fanOut(in, 4)
for v := range out {
    fmt.Println(v)
}
```

**Bug:** `in` is nil. Receives from a nil channel block forever. The workers' `range in` blocks. WaitGroup never reaches zero. Closer hangs. Consumer hangs. No panic, no error — just a silent forever-block.

**Fix:** Always initialise channels with `make(chan T)`. If you have a code path that legitimately uses a nil channel (in a `select`, to disable a case), document it carefully.

## Bug 17: Double close attempt under cancellation race

```go
go func() {
    wg.Wait()
    close(out)
}()
go func() {
    <-ctx.Done()
    close(out)         // BUG
}()
```

**Bug:** Two goroutines may both call `close(out)`. If both fire, the second `close` panics. Even if only one fires in normal runs, the latent bug is real.

**Fix:** Exactly one goroutine closes the output. Cancellation works through the workers, who exit via ctx and call `wg.Done`; the closer then runs once and closes.

## Bug 18: Slice index race

```go
results := make([]int, n)
for i := 0; i < n; i++ {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range in {
            results[i] = results[i] + v   // BUG: not atomic
        }
    }()
}
```

**Bug:** Each worker reads and writes its own index, but the operation is not atomic. If you later switched to a shared index (e.g., a counter), the race would corrupt the result. As-written, no race — but the pattern is fragile.

**Fix:** For aggregate counters, use `atomic.AddInt64`. For per-worker counters indexed by worker ID, the per-worker write is fine but consider cache-line padding to avoid false sharing.

---

## Summary of Bug Categories

1. **Closer in wrong place** (Bugs 1, 2, 5, 13): WaitGroup or close misused.
2. **Loop variable capture** (Bug 4): pre-1.22 closures.
3. **Cancellation gaps** (Bugs 10, 11): missing select on ctx.Done.
4. **Channel direction** (Bug 6): worker closes its input.
5. **Reorder edge cases** (Bug 9): sequence gaps.
6. **Buffer abuse** (Bugs 7, 15): hiding backpressure with huge buffers.
7. **Shared state without synchronisation** (Bugs 12, 18): race conditions.
8. **Wrong context** (Bug 14): nested errgroup.
9. **`nil` channels** (Bug 16): silent block.
10. **Double close** (Bug 17): race between closers.

Memorise these categories. Most production fan-out bugs map to one of them.
