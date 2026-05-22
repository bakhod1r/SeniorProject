# Push-Pull — Find the Bug

Each section presents a broken pipeline, asks you to find the bug *before* reading the analysis, then explains the failure mode and the fix. Reproduce with `go run -race`.

## Table of Contents
1. [Bug 1: Consumer Closes the Channel](#bug-1-consumer-closes-the-channel)
2. [Bug 2: `wg.Wait()` Before `close`](#bug-2-wgwait-before-close)
3. [Bug 3: Fan-In Closed by a Worker](#bug-3-fan-in-closed-by-a-worker)
4. [Bug 4: Unbounded Queue OOM](#bug-4-unbounded-queue-oom)
5. [Bug 5: Blocked Producer Leak on Cancel](#bug-5-blocked-producer-leak-on-cancel)
6. [Bug 6: Lost Work on Shutdown](#bug-6-lost-work-on-shutdown)
7. [Bug 7: Mutating a Pushed Item](#bug-7-mutating-a-pushed-item)
8. [Bug 8: Reused Batch Slice](#bug-8-reused-batch-slice)
9. [Bug 9: Deadlock with No Consumer](#bug-9-deadlock-with-no-consumer)
10. [Bug 10: Dropped Context Cancellation](#bug-10-dropped-context-cancellation)
11. [Bug 11: Pipeline Cycle Deadlock](#bug-11-pipeline-cycle-deadlock)
12. [Bug 12: Backpressure into the Accept Loop](#bug-12-backpressure-into-the-accept-loop)

---

## Bug 1: Consumer Closes the Channel

### Broken code
```go
func consume(ch chan int) {
    for v := range ch {
        process(v)
    }
    close(ch) // BUG: consumer closes
}
```
**What goes wrong?**

### Failure mode
The consumer should never close a channel it receives from. If the producer is still sending (or sends again), `ch <- v` panics with "send on closed channel." Even if the producer is done, closing here is meaningless (the range already ended on the producer's close) or double-closes (panic).

### Fix
The sender closes; the consumer just ranges.
```go
func produce(ch chan<- int) {
    defer close(ch) // sender owns close
    for i := 0; i < n; i++ { ch <- i }
}
func consume(ch <-chan int) {
    for v := range ch { process(v) } // never closes
}
```

---

## Bug 2: `wg.Wait()` Before `close`

### Broken code
```go
jobs := make(chan int, 8)
var wg sync.WaitGroup
for i := 0; i < 4; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); for j := range jobs { work(j) } }()
}
for i := 0; i < 100; i++ { jobs <- i }
wg.Wait()    // BUG: workers range an open channel forever
close(jobs)  // never reached
```
**What goes wrong?**

### Failure mode
The workers `range jobs`, which only ends when `jobs` is *closed*. But `close(jobs)` is after `wg.Wait()`, and `wg.Wait()` never returns because the workers never finish. Classic deadlock: `all goroutines are asleep - deadlock!`.

### Fix
Close first, then wait. Closing tells `range` to finish after draining.
```go
for i := 0; i < 100; i++ { jobs <- i }
close(jobs) // signal "no more"; ranges drain and end
wg.Wait()   // now workers finish
```

---

## Bug 3: Fan-In Closed by a Worker

### Broken code
```go
for w := 0; w < workers; w++ {
    go func() {
        for j := range jobs {
            results <- j * j
        }
        close(results) // BUG: each worker closes results
    }()
}
```
**What goes wrong?**

### Failure mode
Every worker tries to `close(results)`. The first close succeeds; the next worker that finishes calls `close` again → "close of closed channel" panic. Worse, a worker may still be doing `results <- ...` when another closes it → "send on closed channel" panic. Multiple senders must not close.

### Fix
Close `results` exactly once, after all senders finish, from a dedicated goroutine.
```go
var wg sync.WaitGroup
for w := 0; w < workers; w++ {
    wg.Add(1)
    go func() { defer wg.Done(); for j := range jobs { results <- j * j } }()
}
go func() { wg.Wait(); close(results) }()
```

---

## Bug 4: Unbounded Queue OOM

### Broken code
```go
type Queue struct {
    mu   sync.Mutex
    cond *sync.Cond
    buf  []Item
}
func (q *Queue) Push(it Item) {
    q.mu.Lock()
    q.buf = append(q.buf, it) // BUG: no bound; never blocks the producer
    q.cond.Signal()
    q.mu.Unlock()
}
```
**What goes wrong?**

### Failure mode
The producer never blocks, so if it outruns the consumer, `buf` grows without limit until the process is OOM-killed — losing *all* in-flight work, the opposite of what the design intended. There is no backpressure.

### Fix
Use a bounded channel (`make(chan Item, N)`), or bound the queue and block (or drop) when full.
```go
ch := make(chan Item, 1024) // producer blocks when full -> backpressure
```
If the producer must not block, add an explicit overflow policy (drop/reject) and a metric — never an unbounded buffer.

---

## Bug 5: Blocked Producer Leak on Cancel

### Broken code
```go
func produce(ctx context.Context, out chan<- int) {
    for i := 0; ; i++ {
        out <- i // BUG: blocks forever if the consumer stopped; ignores ctx
    }
}
```
**What goes wrong?**

### Failure mode
If the consumer exits (e.g., on `ctx` cancel) the channel fills and `out <- i` blocks forever. The producer goroutine leaks — it is parked on a send no one will ever receive, holding memory and any resources it captured. `ctx` is never consulted.

### Fix
Select on `ctx.Done()` for the send.
```go
func produce(ctx context.Context, out chan<- int) {
    defer close(out)
    for i := 0; ; i++ {
        select {
        case out <- i:
        case <-ctx.Done():
            return
        }
    }
}
```

---

## Bug 6: Lost Work on Shutdown

### Broken code
```go
// Intent: drain all buffered jobs on shutdown. But:
for w := 0; w < workers; w++ {
    go func() {
        for {
            select {
            case j := <-jobs:
                process(j)
            case <-ctx.Done(): // BUG: exits with items still buffered
                return
            }
        }
    }()
}
// shutdown:
cancel()
```
**What goes wrong?**

### Failure mode
On `cancel()`, the `case <-ctx.Done()` may win even when `jobs` still holds buffered items, so workers exit and those items are silently dropped. With drain intent, this loses work — a serious bug for payment/order pipelines.

### Fix
For *drain* semantics, do not put `ctx.Done()` in the worker loop. Close the input and let `range` finish.
```go
for w := 0; w < workers; w++ {
    go func() { defer wg.Done(); for j := range jobs { process(j) } }() // drains
}
// shutdown:
stopSource()
close(jobs)
wg.Wait() // every buffered job processed
```
(Use `ctx` in the loop only when you *want* abort/drop semantics.)

---

## Bug 7: Mutating a Pushed Item

### Broken code
```go
job := &Job{ID: 1}
for i := 0; i < 3; i++ {
    job.ID = i
    out <- job // BUG: same pointer pushed thrice; mutated after send
}
```
**What goes wrong?**

### Failure mode
The same `*Job` is sent three times and mutated in between. The consumer reads `job.ID` whenever it gets around to it, racing with the producer's writes — a data race with no happens-before edge (ownership transferred on send). Consumers may all see `ID == 2`, or torn values. `-race` flags it.

### Fix
Send a fresh value (or a fresh pointer) each time; never mutate after sending.
```go
for i := 0; i < 3; i++ {
    out <- &Job{ID: i} // distinct value per send
}
```

---

## Bug 8: Reused Batch Slice

### Broken code
```go
batch := make([]Item, 0, size)
for it := range in {
    batch = append(batch, it)
    if len(batch) == size {
        out <- batch       // send the batch
        batch = batch[:0]  // BUG: reuse the same backing array
    }
}
```
**What goes wrong?**

### Failure mode
`batch = batch[:0]` reuses the same backing array that was just sent. The consumer may still be reading the previous batch while the producer overwrites it with new items — a data race and corrupted data. `out <- batch` transferred ownership; the producer must not touch that array again.

### Fix
Allocate a fresh slice after each send.
```go
out <- batch
batch = make([]Item, 0, size) // new backing array; old one owned by consumer
```

---

## Bug 9: Deadlock with No Consumer

### Broken code
```go
func main() {
    ch := make(chan int) // unbuffered
    ch <- 1              // BUG: no receiver
    fmt.Println("done")
}
```
**What goes wrong?**

### Failure mode
An unbuffered send blocks until a receiver is ready. There is no receiver, and `main` is the only goroutine, so it blocks forever: `fatal error: all goroutines are asleep - deadlock!`.

### Fix
Start the consumer before (or concurrently with) the push, or use a buffer if a single in-flight item is acceptable.
```go
ch := make(chan int)
go func() { fmt.Println(<-ch) }() // consumer
ch <- 1
```

---

## Bug 10: Dropped Context Cancellation

### Broken code
```go
func stage(ctx context.Context, in <-chan int, out chan<- int) {
    defer close(out)
    for v := range in {
        out <- transform(v) // BUG: send ignores ctx; can block past cancel
    }
}
```
**What goes wrong?**

### Failure mode
If the downstream consumer cancels and stops reading `out`, this stage blocks forever on `out <- ...`, never observing `ctx`. It also never drains `in`, so the *upstream* stage blocks on its send to `in`, cascading the leak up the whole pipeline.

### Fix
Select on `ctx.Done()` for the send.
```go
for v := range in {
    select {
    case out <- transform(v):
    case <-ctx.Done():
        return
    }
}
```

---

## Bug 11: Pipeline Cycle Deadlock

### Broken code
```go
// A pushes to B; B pushes "retries" back to A. Both buffered, both fill.
a := make(chan Item, 4)
b := make(chan Item, 4)
go func() { for it := range a { b <- process(it) } }()        // A -> B
go func() { for it := range b { a <- retry(it) } }()          // B -> A (cycle!)
```
**What goes wrong?**

### Failure mode
A and B form a cycle. Under load both buffers fill: the A→B goroutine blocks on `b <- ...` (b full) while the B→A goroutine blocks on `a <- ...` (a full). Neither can drain the other — circular wait, deadlock. Backpressure has nowhere to terminate.

### Fix
Break the cycle. Route retries to a *separate* path with its own bound and a drop/spill policy, or use a single ordered queue with a retry counter rather than feeding output back into input.
```go
retries := make(chan Item, 64)
go func() {
    for it := range b {
        select {
        case retries <- it: // bounded, separate path
        default:            // drop or spill on overflow; no cycle into a
        }
    }
}()
```

---

## Bug 12: Backpressure into the Accept Loop

### Broken code
```go
func handler(w http.ResponseWriter, r *http.Request) {
    job := parse(r)
    jobs <- job // BUG: blocks the HTTP goroutine when the pipeline is saturated
    w.WriteHeader(http.StatusOK)
}
```
**What goes wrong?**

### Failure mode
When the pipeline is saturated, `jobs <- job` blocks the request handler. Connections pile up, clients time out and retry, retries add load — a metastable failure (retry storm) that does not self-recover. Backpressure propagated all the way into the unblockable inbound boundary.

### Fix
Terminate backpressure at the request boundary: try to enqueue without blocking, and reject with 503 when full.
```go
func handler(w http.ResponseWriter, r *http.Request) {
    job := parse(r)
    select {
    case jobs <- job:
        w.WriteHeader(http.StatusAccepted)
    default:
        w.Header().Set("Retry-After", "1")
        http.Error(w, "overloaded", http.StatusServiceUnavailable)
    }
}
```
Now overload sheds load cleanly instead of stalling the accept loop.
