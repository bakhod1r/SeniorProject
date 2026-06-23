---
layout: default
title: Find the Bug
parent: Backpressure
grand_parent: Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/01-backpressure/find-bug/
---

# Backpressure — Find the Bug

This page contains 12 buggy Go snippets, each with a backpressure-related defect. For each:

1. Read the code carefully.
2. Spot the bug.
3. Describe the failure mode.
4. Compare with the reference answer below.

The bugs range from junior to senior level. Do not skim the answers — try to spot each before reading.

---

## Bug 1: The unbounded slice queue

```go
package main

import (
    "sync"
)

type Queue struct {
    mu    sync.Mutex
    items []string
}

func (q *Queue) Push(x string) {
    q.mu.Lock()
    q.items = append(q.items, x)
    q.mu.Unlock()
}

func (q *Queue) Pop() (string, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    if len(q.items) == 0 {
        return "", false
    }
    x := q.items[0]
    q.items = q.items[1:]
    return x, true
}

func main() {
    q := &Queue{}
    go func() {
        for {
            q.Push("hello")
        }
    }()
    // ... slow consumer elsewhere
}
```

### Answer

The queue is unbounded. `append` grows forever; the heap balloons until OOM. There is no backpressure signal.

**Fix:** replace with `make(chan string, N)` and add either blocking, non-blocking, or context-aware semantics.

---

## Bug 2: Hidden unboundedness via a huge buffer

```go
func main() {
    events := make(chan Event, 100_000_000)
    go process(events)
    for {
        events <- newEvent() // never blocks in practice
    }
}
```

### Answer

A 100M-slot channel is unbounded in practice. Under sustained load, the buffer fills with millions of events, each one carrying memory. The process OOMs long before the buffer is technically full.

**Fix:** small buffer (100–10,000) plus a deliberate policy (drop, reject, or sustained block).

---

## Bug 3: Spawn-per-request without a limit

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        doExpensiveWork(r)
    }()
    fmt.Fprintln(w, "accepted")
}
```

### Answer

Each request spawns an unbounded goroutine. Under load, goroutine count climbs without limit. Memory grows; eventually OOM.

**Fix:** use a bounded worker pool. Submit the work; if full, return 503.

---

## Bug 4: Forgotten close

```go
func produce() {
    ch := make(chan int, 10)
    go consume(ch)
    for i := 0; i < 100; i++ {
        ch <- i
    }
    // (no close)
}

func consume(ch <-chan int) {
    for x := range ch {
        process(x)
    }
}
```

### Answer

The consumer's `for x := range ch` waits forever after the producer finishes. The goroutine leaks; the channel is never closed.

**Fix:** `close(ch)` after the loop. Or use a context to signal completion.

---

## Bug 5: Double-close panic

```go
type Stream struct {
    ch     chan int
    closed bool
    mu     sync.Mutex
}

func (s *Stream) Close() {
    s.mu.Lock()
    if !s.closed {
        close(s.ch)
        s.closed = true
    }
    s.mu.Unlock()
}
```

### Answer

This *looks* safe but there is a race: between the check `!s.closed` and `close(s.ch)`, another goroutine could observe the same state and also try to close. The mutex makes it safe — but only because of the mutex. If you used atomic without `Lock`, double-close would panic.

The bigger bug: a goroutine that sends on `s.ch` after `Close()` returns will panic. The `closed` flag is checked inside the struct, but external callers do not check it.

**Fix:** `sync.Once` for close, and a separate "is closed?" check used by senders before they send.

---

## Bug 6: Blocking send in a handler

```go
var jobCh = make(chan Job, 100)

func handler(w http.ResponseWriter, r *http.Request) {
    j := parseJob(r)
    jobCh <- j // blocks if channel full
    fmt.Fprintln(w, "queued")
}
```

### Answer

When the channel is full, the handler blocks. Other requests still arrive at the server. Handler goroutines accumulate. The system slowly leaks goroutines until OOM.

**Fix:** non-blocking send with `select default` (drop) or context-bound send (return 503 on timeout).

---

## Bug 7: Drop without metric

```go
func tryEnqueue(ch chan<- Event, e Event) {
    select {
    case ch <- e:
    default:
        // dropped
    }
}
```

### Answer

Dropping is fine when it is the right policy. But without a counter, operators have no signal that drops are happening. The system silently loses data.

**Fix:** increment an atomic counter; log at low rate.

```go
default:
    atomic.AddUint64(&drops, 1)
    if atomic.LoadUint64(&drops)%1000 == 0 {
        log.Printf("dropped %d events total", drops)
    }
```

---

## Bug 8: Race between `len` and act

```go
func submit(ch chan Job, j Job) bool {
    if len(ch) < cap(ch) {
        ch <- j
        return true
    }
    return false
}
```

### Answer

Between `len(ch) < cap(ch)` and the send, another goroutine could fill the channel. The send then blocks. The function does not behave as "non-blocking check-then-send."

**Fix:** use `select` with `default` for an atomic non-blocking send.

```go
select {
case ch <- j:
    return true
default:
    return false
}
```

---

## Bug 9: Missing context check in worker

```go
func worker(jobs <-chan Job) {
    for j := range jobs {
        result := doWork(j)
        store(result)
    }
}
```

### Answer

The worker has no way to be cancelled. If `doWork` is long, shutting down requires waiting for every in-flight job. Worse, if `doWork` itself blocks forever, the worker hangs.

**Fix:** accept a context and check `ctx.Err()` between work steps. Pass the context to `doWork` so it can be cancelled too.

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case j, ok := <-jobs:
            if !ok { return }
            doWork(ctx, j)
        case <-ctx.Done():
            return
        }
    }
}
```

---

## Bug 10: Sending to a closed channel via slow shutdown

```go
func (p *Pool) Submit(j Job) {
    p.jobs <- j
}

func (p *Pool) Shutdown() {
    close(p.jobs)
}

// Caller:
go p.Submit(j1)
p.Shutdown()
go p.Submit(j2) // may panic
```

### Answer

After `Shutdown`, any concurrent `Submit` may try to send on a closed channel and panic. The lifecycle is not protected.

**Fix:** add an atomic "closed" flag and check it in `Submit`. Use `sync.Once` for `close`.

```go
func (p *Pool) Submit(j Job) error {
    if p.closed.Load() { return ErrClosed }
    p.jobs <- j
    return nil
}
func (p *Pool) Shutdown() {
    p.once.Do(func() {
        p.closed.Store(true)
        close(p.jobs)
    })
}
```

Note: there is still a race — a Submit can check `closed`, find false, then `close` happens before the send. Mitigate with a `select` and a closed-detection channel:

```go
func (p *Pool) Submit(j Job) error {
    select {
    case <-p.done:
        return ErrClosed
    case p.jobs <- j:
        return nil
    }
}
```

Where `p.done` is closed in `Shutdown` *before* closing `p.jobs`.

---

## Bug 11: Naive retry that amplifies overload

```go
func Send(ctx context.Context, msg Msg) error {
    for {
        err := client.Do(ctx, msg)
        if err == nil { return nil }
        if !isTransient(err) { return err }
        time.Sleep(10 * time.Millisecond)
    }
}
```

### Answer

Two bugs. (1) Infinite retry with no maximum. (2) Fixed delay with no jitter. A transient outage triggers many clients to retry every 10 ms in sync — amplifying the load by 100×.

**Fix:** cap retries, use exponential backoff with jitter, and honour ctx.Done.

```go
for i := 0; i < maxRetries; i++ {
    err := client.Do(ctx, msg)
    if err == nil { return nil }
    if !isTransient(err) { return err }
    delay := baseDelay * time.Duration(1<<i)
    jitter := time.Duration(rand.Int63n(int64(delay)/2))
    select {
    case <-time.After(delay + jitter):
    case <-ctx.Done(): return ctx.Err()
    }
}
return errors.New("retries exhausted")
```

---

## Bug 12: Misplaced `defer` releases semaphore early

```go
func handler(w http.ResponseWriter, r *http.Request) {
    sem <- struct{}{}
    defer func() { <-sem }()
    go expensiveWork(r) // continues after handler returns
    fmt.Fprintln(w, "queued")
}
```

### Answer

The semaphore is released when the handler returns. But `expensiveWork` continues to run in a goroutine. The slot is freed but the work is still in flight. New requests can grab the slot while the previous work is still consuming resources.

**Fix:** either do the work synchronously in the handler (and let backpressure work as designed), or move work to a worker pool that has its own admission. Do *not* mix "semaphore in handler" with "work in goroutine."

---

## Bonus Bugs

### Bug 13: Wrong direction of close

```go
func consume(ch chan Event) {
    for e := range ch {
        process(e)
    }
    close(ch) // wrong direction
}
```

The consumer should not close the channel; the sender should. Closing from the consumer means future sends panic. Sometimes the sender is still active; this is a clear bug.

**Fix:** producer closes; consumer just reads.

---

### Bug 14: Unbounded inner buffer

```go
type Pool struct {
    jobs chan Job
}
func (p *Pool) Submit(j Job) {
    select {
    case p.jobs <- j:
    default:
        go func() { p.jobs <- j }() // "make room" by spawning more
    }
}
```

The "fix" is worse than the disease. Spawning a goroutine that blocks on the full channel is just hiding the unboundedness in goroutine count. Memory still grows.

**Fix:** drop or reject; do not pretend overflow does not exist.

---

## Reflection

If you missed many bugs, the most common pattern is: **the bug is at the boundary**. Look at where data enters or leaves a goroutine. The bug usually lives in:

- The send (or receive) operation.
- The buffer size.
- The shutdown path.
- The handler's interaction with workers.
- The retry/backoff logic.

Backpressure bugs cluster at these seams. Train your eyes to look there first.

---

## Code Review Checklist for Backpressure Bugs

When reviewing PRs, flag each of these:

- [ ] Unbounded slices used as queues.
- [ ] Huge channel buffers (> 10,000) without justification.
- [ ] `go func()` in HTTP handlers without limits.
- [ ] `for range ch` without context cancellation.
- [ ] `select` cases with sends but no `default` or `ctx.Done()` — unless blocking is intentional.
- [ ] `close(ch)` from a non-sole-owner.
- [ ] Counters incremented without ever being read.
- [ ] Drop / reject branches without metrics.
- [ ] Retries without exponential backoff and jitter.
- [ ] Retries without a maximum.
- [ ] Per-request resource acquisition outside the request goroutine.

A 5-minute review with this checklist prevents months of incidents.

---

## Closing

Backpressure bugs are insidious because they hide until production. The buggy code "works" — until the buffer fills. Drill these patterns until you spot them in seconds.

---

## Bug 15: Hedged request that doubles load on overloaded downstream

```go
func hedgedGet(ctx context.Context, fns []func(context.Context) ([]byte, error)) ([]byte, error) {
    out := make(chan []byte, len(fns))
    for _, fn := range fns {
        fn := fn
        go func() {
            d, err := fn(ctx)
            if err == nil { out <- d }
        }()
    }
    return <-out, nil
}
```

### Answer

This sends *all* requests immediately, not hedged. There is no delay between starts. When the downstream is overloaded, sending N parallel duplicates makes it worse.

**Fix:** Send the first request; if no response within `delay`, send the second; etc. Cancel losers.

---

## Bug 16: Sleep-based "draining"

```go
func (p *Pool) Shutdown() {
    p.acceptNew = false
    time.Sleep(30 * time.Second)
    close(p.jobs)
}
```

### Answer

Sleep is not synchronisation. If work takes longer than 30s, it is killed mid-flight. If work takes shorter, the shutdown wastes time. There is no signal "are we done?"

**Fix:** `sync.WaitGroup` for in-flight work. `Close` waits on the WaitGroup with a context timeout.

---

## Bug 17: Drop-oldest that spins

```go
func (q *Queue) Push(x int) {
    for {
        select {
        case q.ch <- x: return
        default: <-q.ch
        }
    }
}
```

### Answer

Under heavy concurrent contention, the `<-q.ch` might pop an item just popped by another goroutine, then both retry. The loop can spin without progress.

**Fix:** acquire a mutex around the operation, or use a single-slot semaphore to serialise drop-oldest:

```go
func (q *Queue) Push(x int) {
    select {
    case q.ch <- x:
    default:
        select {
        case <-q.ch: // drop one
        default:
        }
        q.ch <- x // now there is room (probably); but blocks if many concurrent pushes
    }
}
```

For high concurrency, use a mutex.

---

## Bug 18: Adaptive limiter that never escapes overload

```go
type AIMD struct {
    limit int
}
func (a *AIMD) OnFailure() {
    a.limit = a.limit / 2
}
```

### Answer

Two issues. (1) Not thread-safe. (2) Halving without a floor: limit can reach 0. After that, no requests succeed; no observations happen; the limit never recovers.

**Fix:** mutex, minimum limit floor, growth on success.

---

## Bug 19: Buffer sized larger than worker pool can drain in SLO

```go
const workers = 8
const buffer = 10000
const perJob = 100 * time.Millisecond
// p99 SLO: 200ms
```

### Answer

A queue depth of 10,000 means the last job in queue waits `10000/8 × 100ms = 125 seconds`. p99 latency is unbounded under load. The SLO is violated as soon as the queue has more than ~16 items.

**Fix:** size buffer to `(SLO - per-job) × workers / per-job = (200-100) × 8 / 100 = 8`. Set buffer to 8. Beyond that, reject.

---

## Bug 20: Context inherits parent but not deadline

```go
func process(parent context.Context, j Job) error {
    ctx := context.Background() // new root context!
    return doWork(ctx, j)
}
```

### Answer

The function creates a *new* root context instead of deriving from `parent`. The parent's deadline does not propagate. Even if the caller cancels, `doWork` runs forever.

**Fix:** `ctx := parent`, or derive with `context.WithTimeout(parent, ...)`.

---

## Final Notes

The bugs in this page are not theoretical. Every one has shipped in real Go code at some point. Reading them is a useful exercise; spotting them in unfamiliar code is the real skill.

When reviewing code with concurrency, develop a "smell check":

1. Where is data buffered? Is the buffer bounded?
2. Where does a goroutine block? Can it ever wake up?
3. Where does work cross a boundary? Is there admission control?
4. Where is `close` called? Is it from a single owner?
5. Where does the system shut down? Does it drain?

Five questions, applied consistently, catch the majority of backpressure bugs.

