# Closing Channels — Optimization

> When close is a hot path, when it isn't, and what to do about each.

---

## Introduction

Close is *almost never* the bottleneck in a Go program. Channels themselves can be hot — many sends and receives per second — but close is a one-shot event per channel lifetime. Optimising "close performance" usually means optimising what surrounds it: the lifetime of the channel, the cost of signalling many goroutines, the avoidance of leaks.

This file covers:

- The actual cost of `close` and when it matters.
- Patterns that scale broadcast to thousands of receivers.
- When to *replace* close with cheaper primitives.
- How to detect and reduce channel-related allocation.
- Avoiding pathological cases.

---

## Cost Baseline

Approximate costs on a modern x86_64 CPU (Go 1.22, GOMAXPROCS=8):

| Operation | Cost |
|---|---|
| `make(chan T)` (unbuffered) | ~100 ns + allocation (~96 B header) |
| `make(chan T, 64)` (buffered) | ~150 ns + ~96 B header + 64 × elemsize |
| `close(ch)` on empty queues | ~50 ns |
| `close(ch)` with N receivers | ~50 ns + ~200 ns × N |
| Receive on closed empty channel | ~30 ns |
| Receive on open channel (rendezvous) | ~100–300 ns |
| Send on open channel (rendezvous) | ~100–300 ns |
| Send on closed (panic) | ~500 ns + stack walk |
| `recover` after panic | ~1 µs |

Take-aways:

- `close` is cheaper than a channel operation. It is not the bottleneck.
- Close is O(N) in the number of parked goroutines, but each is constant time.
- Broadcast is *efficient* — one close wakes 1000 goroutines in ~200 µs.

---

## Optimisation 1: replace per-receiver send with close

**Anti-pattern.** Wake N receivers by sending N values:

```go
ch := make(chan struct{}, 1000)
for i := 0; i < 1000; i++ {
    ch <- struct{}{} // wake one
}
```

Cost: ~300 ns × 1000 = 300 µs. Plus all the senders have to coordinate.

**Optimised.** One close:

```go
ch := make(chan struct{})
close(ch)
```

Cost: ~200 µs to wake all 1000 (similar order), *but*:

- One operation in the closer; no loop.
- Idempotent for late-arriving receivers (closed channel stays closed).
- Memory: one channel, not N.

**When to use close vs per-value send.**

- Need to wake "everyone": close.
- Need to wake "the first one": send to buffered channel.
- Need to broadcast *data* (not just a signal): use slice of channels or `sync.Cond`.

---

## Optimisation 2: avoid per-request channel creation

**Anti-pattern.** Allocate a channel per request:

```go
func handle(req Request) Response {
    ch := make(chan Response, 1)
    go work(req, ch)
    return <-ch
}
```

Cost per request: ~100 ns channel allocation + GC pressure.

**Optimised.** If the work doesn't need to be in a goroutine, just call it. If it does (e.g., for cancellation), reuse channels from a pool or use direct returns.

```go
func handle(req Request) Response {
    return work(req)
}
```

For thousands of requests per second, even a tiny channel allocation adds up. Channels are not free.

---

## Optimisation 3: prefer `chan struct{}` for signals

**Anti-pattern.** `chan bool` for a done signal:

```go
done := make(chan bool)
// ...
done <- true
```

`bool` is 1 byte; the channel buffer (if buffered) costs N bytes plus alignment.

**Optimised.** `chan struct{}`:

```go
done := make(chan struct{})
// ...
close(done)
```

`struct{}` is zero-size. The buffer (if any) is still N "slots" but each slot is zero bytes. More importantly, `close` is the broadcast — better than send.

---

## Optimisation 4: signal channels are reusable across receivers

A closed `chan struct{}` can be used as a "this happened" flag indefinitely. Any goroutine that does `<-doneCh` after the close gets the signal immediately, no extra cost.

```go
type Event struct {
    done chan struct{}
    once sync.Once
}

func (e *Event) Fire() {
    e.once.Do(func() { close(e.done) })
}

func (e *Event) Wait() {
    <-e.done
}
```

`Fire` is O(1) + O(N) wake. `Wait` is O(1) after fire. Once fired, no allocation needed for new waiters.

Compare to `sync.Cond.Broadcast`: also O(N) wake, but `Cond` requires a mutex. `chan struct{}` + close is often simpler and equally fast.

---

## Optimisation 5: batched signalling

If your design closes many channels in rapid succession (e.g., per-connection done channels on server shutdown), the wake-ups can swamp the scheduler.

**Pattern.** Have one global done channel that all connections select on, instead of per-connection done.

```go
type Server struct {
    done chan struct{} // one channel for all
    once sync.Once
}

func (s *Server) Shutdown() {
    s.once.Do(func() { close(s.done) })
}

// each connection:
func conn(s *Server, c net.Conn) {
    for {
        select {
        case <-s.done:
            return
        case ... :
        }
    }
}
```

One close wakes 100 000 connections. The scheduler distributes the wakes across cores.

Compare to per-connection close: 100 000 close operations, 100 000 scheduler queue insertions. Total cost similar, but the global pattern is simpler and harder to misuse.

---

## Optimisation 6: bounded buffer prevents close-related stalls

**Scenario.** A producer with `defer close(ch)` is mid-loop. The consumer stopped reading. The producer's next send blocks; close never runs.

**Optimised.** Use a buffered channel sized for the realistic worst case:

```go
ch := make(chan int, 1024)
```

The producer sends to the buffer without blocking. When the consumer stops, the buffer fills, then the producer blocks — but at least 1024 items have been sent. With `select` + `ctx.Done()`, the producer escapes cleanly.

Tradeoff: memory. 1024 × elemsize bytes per channel. For `chan int`, ~8 KB; cheap.

---

## Optimisation 7: drain on cancel without leaking

A drainer goroutine consumes whatever the producer has in flight, allowing the producer to observe cancellation:

```go
cancel()
go func() {
    for range out {
    }
}()
```

This drainer goroutine exits when `out` closes. If `out` never closes (bug elsewhere), the drainer leaks.

**Optimised drain with timeout.**

```go
cancel()
drained := make(chan struct{})
go func() {
    defer close(drained)
    for range out {
    }
}()
select {
case <-drained:
case <-time.After(5 * time.Second):
    log.Println("drain timeout")
}
```

If drain doesn't complete in 5 s, log and move on. Better to leak than hang.

---

## Optimisation 8: avoid recover-based "safe close"

```go
func safeClose(ch chan int) {
    defer func() { recover() }()
    close(ch)
}
```

`recover` costs ~1 µs per panic. If called frequently, this adds up. Worse, it hides bugs.

**Optimised.** `sync.Once`:

```go
var once sync.Once
once.Do(func() { close(ch) })
```

`Once.Do` is ~10–20 ns when already done, ~100 ns on first call. Always faster than recover.

---

## Optimisation 9: lock-free fast path in `chansend`/`chanrecv`

The runtime has lock-free fast paths for non-blocking channel operations. Closed-channel operations hit the fast path:

- Send to closed: lock-free panic (still slow due to panic).
- Receive from closed-drained: lock-free return of zero value (~30 ns).

This means a `for { <-doneCh; ... }` loop, where `doneCh` is closed, runs at ~30 ns per iteration — fast enough that the *real* concern is the spin, not the channel cost.

**Avoid spinning on a closed channel.**

```go
for {
    <-doneCh
    // do something
}
```

If `doneCh` is closed, this loops forever at high CPU. Always pair with logic that exits the loop:

```go
for {
    <-doneCh
    return
}
```

Or just `return` once after `<-doneCh`:

```go
<-doneCh
return
```

---

## Optimisation 10: avoid close in benchmarks

A benchmark that creates and closes a channel per iteration measures the allocator more than channel operations:

```go
func BenchmarkClose(b *testing.B) {
    for i := 0; i < b.N; i++ {
        ch := make(chan int) // alloc dominates
        close(ch)
    }
}
```

To benchmark close alone, allocate once:

```go
func BenchmarkClose(b *testing.B) {
    chs := make([]chan int, b.N)
    for i := range chs {
        chs[i] = make(chan int)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        close(chs[i])
    }
}
```

Typical result: ~50 ns/op for close on an unbuffered channel.

---

## Optimisation 11: alternatives to close for one-shot events

For a one-shot event with one waiter, `close` is overkill. Alternatives:

| Primitive | Use case |
|---|---|
| `close(chan struct{})` | Broadcast to N waiters. |
| `sync.WaitGroup` | "Wait for N goroutines to finish." |
| `sync.Once` | "Run f exactly once." |
| `atomic.Bool` | One-bit flag, no waiting. |
| `context.Context` | Cancellation across function boundaries. |
| `chan struct{}` with buffered single send | One-shot wake of one waiter. |

For pure "wake one goroutine when ready":

```go
ready := make(chan struct{}, 1)
ready <- struct{}{}
// receiver: <-ready
```

Slightly cheaper than close-based broadcast for single receiver because no queue drain.

---

## Optimisation 12: minimise close for short-lived channels

Sometimes a function creates a channel, uses it briefly, and returns. The channel is then garbage-collected. Closing is *not required* for GC; an unreferenced open channel is collected.

```go
func compute() int {
    ch := make(chan int, 1)
    go func() {
        ch <- expensive()
    }()
    return <-ch
    // ch goes out of scope, GC reclaims it
    // no close needed
}
```

Closing here is harmless but unnecessary. The runtime does not "leak" open channels — GC handles them.

Caveat: if the goroutine that holds the channel reference leaks, the channel leaks too. The channel itself is fine; the goroutine is the bug.

---

## Optimisation 13: structure close to minimise stack walk

When close panics, Go captures a stack trace. Stack walks cost microseconds. Frequent panics from close-related bugs slow down hot paths.

**Optimised.** Structure code to *avoid* panics rather than catch them:

- Use `sync.Once` instead of `recover`-based safe close.
- Verify ownership; never have multiple senders that might close.
- Use a done channel so close is decoupled from send.

If panics happen at all in production, treat them as bugs to fix, not as performance issues.

---

## Optimisation 14: profile channel operations with pprof

`go tool pprof -http=:8080 cpu.pprof` and look for:

- `runtime.closechan` — close cost.
- `runtime.chansend` and `runtime.chanrecv` — send/receive cost.
- `runtime.gopark` — time spent blocking on channels.

If close is a noticeable fraction of CPU, you have unusual usage. Common cause: a hot loop that creates and closes channels per iteration.

Memory profile:

```bash
go tool pprof -alloc_objects mem.pprof
```

`runtime.makechan` allocations show the rate of channel creation. If it's high (millions per second), reduce.

---

## Optimisation 15: cache channels with `sync.Pool`

For a hot-path that creates a `chan T` repeatedly, `sync.Pool` can reduce GC pressure. *But* channels are stateful (buffer contents, closed flag) — reusing a closed channel doesn't work; you must `make` a new one.

```go
var chanPool = sync.Pool{
    New: func() any { return make(chan int, 16) },
}

func getChan() chan int {
    ch := chanPool.Get().(chan int)
    // assume ch is open and empty
    return ch
}

func putChan(ch chan int) {
    // drain
    for {
        select {
        case <-ch:
        default:
            goto done
        }
    }
done:
    // do not put closed channels back
    chanPool.Put(ch)
}
```

This is rarely worthwhile. Just make a fresh channel; the allocator is fast enough.

---

## Optimisation 16: structured shutdown for fast process exit

When a process is shutting down (e.g., container terminate signal), graceful close of every channel and goroutine takes time. For latency-critical fast restart:

1. Have a tight time budget: ~5 seconds.
2. Use `context.WithTimeout` to bound shutdown.
3. After timeout, log and exit; the OS reclaims all memory anyway.

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
if err := server.Shutdown(ctx); err != nil {
    log.Println("shutdown timed out, exiting forcefully")
}
os.Exit(0)
```

Don't optimise "close everything cleanly." Optimise "exit within budget."

---

## Optimisation 17: closure efficiency in close paths

A `defer close(ch)` allocates a deferred function call (~50 ns). For long-lived goroutines, this is irrelevant. For very short-lived goroutines (microsecond lifetime), the defer cost is comparable to the goroutine's work.

```go
go func() {
    defer close(ch)
    ch <- v
}()
```

If you spawn millions of these per second, the `defer` cost adds up. Alternatives:

```go
go func() {
    ch <- v
    close(ch)
}()
```

No defer; close runs after send. Risk: if send panics, close doesn't run. For a single-send-then-close pattern with no risk, the no-defer form is slightly faster.

---

## Optimisation 18: avoid contention on a single done channel

If 100 000 goroutines `select` on the same `done` channel every iteration, the close-event wakes all of them. The scheduler must distribute 100 000 ready goroutines across Ps. This is one of the few cases where close can have a measurable cost (~10 ms).

**Optimisation.** Tree of done channels:

```go
// root
rootDone := make(chan struct{})
// branches
branchDones := make([]chan struct{}, 100)
for i := range branchDones {
    branchDones[i] = make(chan struct{})
    go func(i int) {
        <-rootDone
        close(branchDones[i])
    }(i)
}
// leaves listen on branches
```

When `rootDone` closes, 100 goroutines wake, each closing one branch. Then 1000 leaves per branch wake on their branch. Total wakes are the same, but the work parallelises across cores.

This is over-engineering for most cases. Only useful for >100K-receiver broadcasts.

---

## Optimisation 19: pre-close channels for "always done" semantics

```go
var alwaysDone = func() <-chan struct{} {
    ch := make(chan struct{})
    close(ch)
    return ch
}()

// use as a "no-op done" channel
func always() <-chan struct{} { return alwaysDone }
```

A pre-closed channel returns immediately from any receive. Useful for default cases in selects, or for "no context" patterns. Saves nothing if you use `context.Background()`, but in tight loops where you allocate, this is the cheapest "always selectable" primitive.

---

## Optimisation 20: monitor close-related metrics in production

Even with perfect code, monitoring catches regressions:

- `runtime.NumGoroutine()`: rising trend = leak.
- Per-package goroutine counts (via pprof tags): identifies leak source.
- Channel-creation rate (custom counter): spikes indicate per-request channel allocation.
- "channel closed" log lines: count per second; sudden zero indicates close path missed.

A regression test:

```go
func TestNoLeak(t *testing.T) {
    base := runtime.NumGoroutine()
    runWorkload()
    time.Sleep(100 * time.Millisecond) // let things finish
    after := runtime.NumGoroutine()
    if after > base {
        t.Fatalf("leaked %d goroutines", after-base)
    }
}
```

Run this in CI for every PR.

---

## Summary

Close is rarely a hot path. The interesting optimisation questions are:

1. Replace per-receiver sends with close (broadcast).
2. Use `chan struct{}` for signal channels.
3. Avoid per-request channel creation if possible.
4. Use `sync.Once` instead of recover for idempotent close.
5. Use a global done channel for service-wide cancellation.
6. Profile with pprof if you suspect close-related cost.
7. Don't over-optimise; correctness first.

The biggest wins come from avoiding *leaks*, not from making `close` faster. A leaked goroutine costs 2 KB plus everything it holds; a slow `close` costs nanoseconds. Always fix leaks first.

For broadcast at scale (>100K receivers), consider a tree of done channels. For everything else, the standard `chan struct{}` + close pattern is fast enough.

The most important rule: **measure before optimising**. The runtime's channel implementation is highly tuned. Most "optimisations" are micro-changes whose effects are dwarfed by allocation, GC, or scheduler activity. Profile, identify the real bottleneck, and only then optimise.
