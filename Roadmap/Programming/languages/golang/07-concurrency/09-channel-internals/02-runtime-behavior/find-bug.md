# Channel Runtime Behaviour — Find the Bug

Each exercise presents code that compiles and runs, but contains a defect tied to runtime behaviour: forgotten close, racy send, biased select, leaked sudog, etc. Read carefully, then check the explanation.

---

## Bug 1 — Multi-Producer Close Panic

```go
func process(items []Item) []Result {
    ch := make(chan Result)
    var wg sync.WaitGroup
    for _, item := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            ch <- transform(it)
        }(item)
    }
    go func() {
        wg.Wait()
        close(ch)
    }()
    var out []Result
    for r := range ch {
        out = append(out, r)
    }
    return out
}
```

**Hint.** Look at the relationship between `wg.Add`, the goroutine that calls `wg.Wait`, and the close.

**Bug.** Actually correct! This is a *good* multi-producer close pattern: `wg.Wait` runs only after all producers have called `wg.Done` (which is deferred after `ch <- transform(it)`), then `close(ch)` runs. The `for range` exits when the channel closes.

Many engineers, on first read, see "multiple senders + close = panic" and miss the wg.Wait. The pattern works because:

1. `wg.Add(1)` is called on the calling goroutine (in the loop), before spawning. This avoids the wg.Wait-runs-before-Add race.
2. Each producer goroutine defers `wg.Done` *after* its send completes. The defer fires when the goroutine returns.
3. The close goroutine waits for the wg, so it cannot run before all sends complete.

This is the canonical correct pattern. Where it commonly breaks:

```go
go func() {
    wg.Wait()
    close(ch)
}()
```

If you forget the goroutine and just call `wg.Wait(); close(ch)` synchronously, the main goroutine blocks on `wg.Wait` and the `for range` is never reached, so producers block on the unbuffered `ch <-` forever — deadlock.

---

## Bug 2 — Close on Wrong Side

```go
func consumer(ch chan int) {
    for v := range ch {
        if v < 0 {
            close(ch)
            return
        }
        process(v)
    }
}

func producer(ch chan int) {
    for i := 0; i < 1000; i++ {
        ch <- i
    }
    ch <- -1
    ch <- 0 // sentinel after -1
}
```

**Bug.** The consumer closes `ch` from the receiver side. After `close(ch)` returns, the producer's next `ch <- 0` panics with `send on closed channel`. The convention "the sender closes" exists precisely to avoid this.

Fix: have the producer signal end-of-stream by closing, or use a separate "stop" channel. If you really need the consumer to ask the producer to stop, use a `context.Context` or a bool channel.

---

## Bug 3 — Leaked Goroutine on Early Return

```go
func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
    ch := make(chan Result)
    for _, u := range urls {
        go func(url string) {
            ch <- fetch(url)
        }(u)
    }
    var results []Result
    for i := 0; i < len(urls); i++ {
        select {
        case r := <-ch:
            results = append(results, r)
            if r.Err != nil {
                return results, r.Err
            }
        case <-ctx.Done():
            return results, ctx.Err()
        }
    }
    return results, nil
}
```

**Bug.** When the loop returns early (either on `r.Err != nil` or `ctx.Done`), the remaining goroutines are still running, and each one is blocked on `ch <- fetch(url)` because nobody is reading. They are parked on `c.sendq` forever.

Fix: use a buffered channel large enough to hold all results (`make(chan Result, len(urls))`), so sends never block, even when the caller bails.

```go
ch := make(chan Result, len(urls)) // <-- key fix
```

Alternatively, pass a context to `fetch` and have it return early; but the buffered-channel fix is simpler.

---

## Bug 4 — Select with Always-Ready Case Starves the Others

```go
func dispatch(events <-chan Event, ticks <-chan time.Time, stop <-chan struct{}) {
    for {
        select {
        case e := <-events:
            handle(e)
        case <-ticks:
            tick()
        case <-stop:
            return
        }
    }
}
```

The `events` channel is buffered with high traffic. Question: will `tick` and `stop` ever run?

**Bug — wait, no, this is fine.** The runtime shuffles cases, so if all three are ready, each gets 1/3 probability. But: `tick` fires only every 1 second; `stop` fires once. They are usually *not* ready. The shuffle only matters when multiple cases are ready at the same time.

When `tick` does fire, both `tick` and `events` are ready. The shuffle picks each with 50% probability. So `tick` may be slightly delayed but not starved.

**Real bug.** If `events` is always ready and `tick` fires *while* events is also pending, the shuffle gives `tick` 50% chance to win. But the next iteration immediately checks `events` again — and `tick` is no longer pending. Net result: `tick` fires when expected, with at most one event of delay.

This is not actually a bug. The "starvation" concern is overblown for `select` because pseudo-random shuffle.

A real starvation can happen if you have many channels in the select and the always-ready one wins half the time and you process a million events per second — then the rarely-ready channels still get 1/N chance each tick, which is enough.

---

## Bug 5 — Nil Channel in Select

```go
func processor(in <-chan Job, errs chan<- error) {
    for {
        var failChan chan<- error
        var failVal error
        if pendingError != nil {
            failChan = errs
            failVal = pendingError
        }
        select {
        case job := <-in:
            if err := process(job); err != nil {
                pendingError = err
            }
        case failChan <- failVal:
            pendingError = nil
        }
    }
}
```

**Bug — wait, this is the *good* pattern.** When `pendingError == nil`, `failChan` is nil. A send on a nil channel blocks forever in `chansend`, so the `case failChan <- failVal` case is permanently not ready. The select effectively becomes a one-case select on `in`.

When `pendingError != nil`, `failChan` is `errs`, the case becomes live, and we send the error out and clear it.

This is the classic "selectively enable a select case" pattern. Sometimes called "the nil channel trick." Not a bug.

**Where it *would* be a bug.** If you forgot to reset `failChan` after sending:

```go
case failChan <- failVal:
    // missing: pendingError = nil
}
```

Then the case stays live and you spam the error over and over. Or if you accidentally set `failChan` to a closed channel — then the send panics, not blocks.

---

## Bug 6 — Send on Closed Channel via Race

```go
func server(ctx context.Context, results chan<- Result) {
    go func() {
        <-ctx.Done()
        close(results)
    }()
    for {
        r, ok := <-jobs
        if !ok {
            return
        }
        results <- process(r)
    }
}
```

**Bug.** Two goroutines have a race: the main loop sends to `results`, the inner goroutine closes `results` when context is cancelled. If `ctx.Done()` fires while the main loop is mid-iteration, the close may race against the send. Result: `send on closed channel` panic.

Fix: combine with `select`:

```go
for {
    select {
    case r, ok := <-jobs:
        if !ok {
            return
        }
        select {
        case results <- process(r):
        case <-ctx.Done():
            return
        }
    case <-ctx.Done():
        return
    }
}
```

And: do not close `results` from the cancellation goroutine. The owner of the channel (sender) closes it, on its way out.

---

## Bug 7 — Buffered Channel as Mailbox with Drop

```go
func notify(ch chan<- Event, e Event) {
    select {
    case ch <- e:
    default:
        // dropped — log it?
    }
}
```

**Bug.** Subtle. The `default` fires when the channel is full. But also when the channel is closed? Let's check.

`chansend` with `block=false` and channel closed: the fast path `if !block && c.closed == 0 && full(c) { return false }` does NOT apply because `c.closed == 0` is false. So we proceed to acquire the lock, see `c.closed != 0`, unlock, and panic.

So: `select { case ch <- v: default: }` on a closed channel *panics*, not "drops." This is a real bug if your code path might call `notify` after close.

Fix: do not close `ch` while `notify` may be called. Use a separate done-channel for cancellation.

---

## Bug 8 — Forgotten Range Termination

```go
func aggregate(in <-chan int) int {
    sum := 0
    for v := range in {
        sum += v
    }
    return sum
}

func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 100; i++ {
            ch <- i
        }
        // forgot close(ch)
    }()
    fmt.Println(aggregate(ch))
}
```

**Bug.** `aggregate`'s `for range` only exits when `ch` is closed. The producer goroutine exits after 100 sends without closing, so the range loop parks forever on `chanrecv`.

Fix: `defer close(ch)` in the producer.

---

## Bug 9 — Buffer Capacity 0 Where 1 Was Meant

```go
func startWorker() <-chan Result {
    ch := make(chan Result)  // unbuffered!
    go func() {
        defer close(ch)
        r := compute()
        ch <- r  // blocks until caller reads
    }()
    return ch
}

func use() {
    ch := startWorker()
    time.Sleep(time.Second)  // do other work
    fmt.Println(<-ch)
}
```

**Bug.** `startWorker` returns an unbuffered channel. The worker goroutine blocks on `ch <- r` until the caller reads. If the caller never reads (e.g., panics or returns early), the worker leaks.

Even in the happy path: the worker cannot exit and free resources until the caller reads. If you want the worker to be free to exit as soon as the result is computed, use a 1-buffered channel:

```go
ch := make(chan Result, 1)
```

This is one of the few cases where capacity-1 is meaningfully different from unbuffered and capacity > 1.

---

## Bug 10 — Time.After Goroutine Leak

```go
func waitForJobOrTimeout(jobs <-chan Job) (Job, bool) {
    select {
    case j := <-jobs:
        return j, true
    case <-time.After(10 * time.Second):
        return Job{}, false
    }
}
```

In a long-running loop calling this function, you see memory growth.

**Bug.** `time.After(10 * time.Second)` returns a channel and starts a timer. The timer fires after 10s and writes to the channel. If `<-jobs` fires first (the success case), the timer is still pending — it holds a reference to the channel, which holds a reference to a sudog, which holds a reference to a goroutine.

The runtime keeps timers alive until they fire or are explicitly stopped. So in a high-rate loop with 10s timers, you have thousands of pending timers, each holding goroutine resources.

Fix: use `time.NewTimer` + `Stop`:

```go
t := time.NewTimer(10 * time.Second)
defer t.Stop()
select {
case j := <-jobs:
    return j, true
case <-t.C:
    return Job{}, false
}
```

Note: even with `Stop`, if the timer fires before you call Stop, the channel has a pending value. `Stop` returns `false` in that case. For perfect cleanup, you may need to drain the channel:

```go
if !t.Stop() {
    <-t.C
}
```

But for the leak, a simple `Stop()` suffices because once stopped, the timer is no longer in the timer heap.

---

## Bug 11 — Double Close via Helper

```go
type Notifier struct {
    ch chan struct{}
}

func (n *Notifier) Stop() {
    close(n.ch)
}

// Caller code:
n.Stop()
// ...later...
n.Stop()  // panic: close of closed channel
```

**Bug.** `Stop` is not idempotent. Calling it twice panics.

Fix: `sync.Once`:

```go
type Notifier struct {
    ch   chan struct{}
    once sync.Once
}

func (n *Notifier) Stop() {
    n.once.Do(func() { close(n.ch) })
}
```

---

## Bug 12 — Range over Receiver-Direction Channel

```go
func consume(ch <-chan int) {
    for v := range ch {
        process(v)
    }
}
```

**Not a bug per se**, but a common misunderstanding: `for v := range ch` does *not* close the channel on exit, even though it consumes until close. The channel is closed by the sender side. The `consume` function correctly exits when `ch` closes.

The misconception is that `range` "owns" the channel; it does not. It is a syntactic convenience that calls `v, ok := <-ch` in a loop and exits when `ok == false`.

---

## Bug 13 — Lock Order with Channel of Mutexes

```go
type Item struct {
    mu  sync.Mutex
    val int
}

func swap(a, b *Item) {
    a.mu.Lock()
    b.mu.Lock()
    a.val, b.val = b.val, a.val
    b.mu.Unlock()
    a.mu.Unlock()
}
```

**Bug.** Two concurrent calls `swap(x, y)` and `swap(y, x)` deadlock. They acquire locks in different orders.

This is not specifically a channel bug — it is a general lock-order bug. But it relates to channel runtime: `selectgo` solves this problem by sorting locks by address. You can do the same:

```go
func swap(a, b *Item) {
    if uintptr(unsafe.Pointer(a)) > uintptr(unsafe.Pointer(b)) {
        a, b = b, a
    }
    a.mu.Lock()
    defer a.mu.Unlock()
    b.mu.Lock()
    defer b.mu.Unlock()
    a.val, b.val = b.val, a.val
}
```

This is the same lock-order-by-address trick `selectgo` uses internally.

---

## Bug 14 — `len(ch)` for Synchronisation

```go
func producer(ch chan int) {
    for i := 0; ; i++ {
        for len(ch) >= cap(ch) {
            time.Sleep(time.Millisecond)
        }
        ch <- i
    }
}
```

**Bug.** `len(ch)` returns `c.qcount` under a momentary lock and is immediately stale. Two goroutines reading `len(ch) < cap(ch)` simultaneously may both proceed to send, both succeed (if buffer had one slot), or one blocks. The behaviour is correct *because* `chansend` re-checks under the lock — but the loop is wasteful: it spins on a stale value.

Just call `ch <- i`. The runtime parks the goroutine if the buffer is full. No spin needed.

---

## Bug 15 — Recv on Wrong Channel After Select

```go
func waitAny(a, b <-chan int) int {
    select {
    case <-a:
        return <-b  // bug
    case <-b:
        return <-a  // bug
    }
}
```

**Bug.** After picking `a` (one of `a`'s values), the code receives from `b`. But the function name suggests "wait for either, return that value." The actual logic returns the *other* channel's next value.

Likely fix: return the value picked by the select.

```go
func waitAny(a, b <-chan int) int {
    select {
    case v := <-a:
        return v
    case v := <-b:
        return v
    }
}
```

This kind of logic bug is common in select-heavy code: the case is selected but the value is discarded, then we recurse or fetch elsewhere. Pay attention to the binding `case v := <-ch`.

---

## Bug 16 — Spurious Wakeup Assertion

You read the runtime source and notice `throw("chansend: spurious wakeup")`. When could this fire in your code?

**Answer.** Never, in normal code. This is a defensive runtime assertion. The only ways to trigger it:

- Memory corruption (use of `unsafe` to mess with `c.closed`).
- A bug in the runtime itself.

If you see this `throw` in production, it's a Go runtime bug — file an issue at golang.org with the stack trace.

---

## Bug 17 — Closed Channel as "Permanent Ready" Signal

```go
type Ready struct {
    ch chan struct{}
}

func (r *Ready) MarkReady() {
    close(r.ch)
}

func (r *Ready) Wait() {
    <-r.ch
}
```

**Looks correct.** `MarkReady` closes; `Wait` receives. After close, all current and future `Wait` calls return immediately. This is the standard pattern.

**Bug**: only if `MarkReady` is called more than once. Then `close` of already-closed channel panics. Use `sync.Once` for idempotent MarkReady.

---

## Bug 18 — Producer-Consumer with Wrong Buffer Size

```go
func pipeline(in <-chan Item) <-chan Result {
    out := make(chan Result, 1)
    go func() {
        defer close(out)
        for item := range in {
            r := slowTransform(item)
            out <- r
        }
    }()
    return out
}
```

**Bug.** The buffer of size 1 means the producer can run one step ahead of the consumer, then must wait. If `slowTransform` takes 100ms and the consumer takes 10ms per result, the consumer waits 100ms per result. The producer is the bottleneck *and* the producer is also the consumer's source of work — they should overlap.

If the buffer were size 0 (unbuffered), the producer would need to find the consumer ready, hand-off, then start next slowTransform. Strict serial.

If the buffer were size 10 or larger, the producer could run 10 steps ahead, the consumer drains at its pace, both run in parallel.

This is not a runtime bug; it's a tuning bug. The runtime correctly implements whatever capacity you choose.

---

## Bug 19 — Unsafe Send via Pointer-Cast

```go
type AnyChan struct {
    ptr unsafe.Pointer
}

func (a AnyChan) Send(v int) {
    ch := *(*chan int)(a.ptr)
    ch <- v
}
```

**Bug.** This dereferences `unsafe.Pointer` as a channel and sends. If the original channel was of a different type (say, `chan float64`), the type system is bypassed. The runtime's `typedmemmove` uses `c.elemtype`, so it copies `sizeof(float64)` bytes from `&v` — reading 8 bytes from a 4-byte `int` (depending on layout). Memory corruption, undefined behaviour.

The runtime cannot detect this. The lesson: do not type-pun channels via `unsafe`.

---

## Bug 20 — Goroutine Leak via `select` with Forgotten Branch

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case j := <-jobs:
            handle(j)
        case <-ctx.Done():
            // forgot return
        }
    }
}
```

**Bug.** The `ctx.Done` case fires, the case body runs (nothing), the `for` loops back. The next iteration may pick `jobs` again. The worker never actually exits on context cancellation.

Fix: add `return` after the ctx.Done case body.

---

## Bug 21 — Direct Hand-off Not Happening

You wrote a benchmark expecting direct hand-off:

```go
func BenchmarkHandoff(b *testing.B) {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < b.N; i++ {
            <-ch
        }
    }()
    for i := 0; i < b.N; i++ {
        ch <- i
    }
    wg.Wait()
}
```

But the benchmark shows ~2 μs/op, not the expected ~200 ns/op.

**Bug.** With GOMAXPROCS=1, both goroutines run on the same P. Each send-receive pair forces a context switch: send parks the sender, scheduler picks receiver, receiver reads, parks the receiver, scheduler picks sender. Two parks per round-trip.

With GOMAXPROCS=2, the goroutines run in parallel on two Ps. The sender finds the receiver parked (direct hand-off), copies, wakes. The receiver, on its own P, immediately runs.

Fix: `runtime.GOMAXPROCS(2)` or run with `go test -cpu=2`.

---

## Bug 22 — sudog Leak from Select Wake

This bug existed in older Go versions (pre-1.14 era) and is informative.

```go
// Hypothetical buggy implementation of selectgo cleanup:
func selectgoBuggy(...) {
    ...
    gopark(...)
    // bug: doesn't remove sudog from other channels' queues
}
```

**Result**: when one channel wakes the goroutine, its sudog on other channels remains on those queues. Later, those other channels see "a goroutine is waiting" and try to wake it — but it's already running or has moved on. Race condition.

The Go 1.14+ implementation correctly walks `gp.waiting` and removes from each non-firing channel. The lesson: select is conceptually simple but the implementation has many such details. Trust the runtime.

---

## Bug 23 — Race on Buffer Slot Type

```go
type Mixed struct {
    val any
}

ch := make(chan Mixed, 10)
go func() {
    ch <- Mixed{val: 42}
}()
go func() {
    ch <- Mixed{val: "hello"}
}()
v := <-ch
fmt.Println(v.val.(int))  // may panic if "hello" was the value
```

**Not a runtime bug per se.** The type assertion fails if `v.val` was a string. The channel correctly delivers whichever value was sent first.

The lesson: channel element type is fixed at `make` time. Using `any` as the element type lets you smuggle in mixed values, but the receiver must handle them with type assertions or switches.

This is a *design* bug, not a *runtime* bug. The runtime does exactly what you told it.

---

## Bug 24 — Closed Channel Drains Buffer Before Indicating Closed

```go
ch := make(chan int, 3)
ch <- 1; ch <- 2; ch <- 3
close(ch)

v1, ok1 := <-ch  // (1, true)
v2, ok2 := <-ch  // (2, true)
v3, ok3 := <-ch  // (3, true)
v4, ok4 := <-ch  // (0, false)
```

**Common misconception**: "close" makes the channel immediately return zero. Actually, buffered values are delivered first; only after the buffer is drained does `ok` go false.

This is by design. The runtime's `chanrecv` checks `qcount > 0` before checking `closed`. If buffer has data, return it.

---

## Bug 25 — Select Bias from Pre-Filled Channels

```go
a := make(chan int, 100)
b := make(chan int, 100)
go func() {
    for i := 0; i < 100; i++ {
        a <- i
    }
}()
go func() {
    for i := 0; i < 100; i++ {
        b <- i
    }
}()
time.Sleep(time.Millisecond) // both channels fill up

for i := 0; i < 200; i++ {
    select {
    case <-a:
    case <-b:
    }
}
```

**Bug — only sometimes.** If both channels are always full when the select runs (because the producers refill faster than the consumer), the shuffle picks each 50% of the time. No bias.

But if `a` is consistently fuller than `b` (e.g., `a`'s producer is faster), `a`'s case is always ready while `b`'s is sometimes empty. When `b` is empty, only `a` can fire. So `a` wins disproportionately.

This is not a runtime bug; it's expected behaviour. The "select fairness" guarantee is per-call: among *ready* cases, each has equal probability. Across many calls, the readiness distribution affects which channel wins overall.
