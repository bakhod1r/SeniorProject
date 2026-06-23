# Future / Promise Pattern — Find the Bug

Twelve broken future implementations. Each one compiles. Each one is wrong. Your job: identify the bug, predict the failure mode, and propose a fix.

---

## Bug 1. The classic leak

```go
func loadAsync(id int) <-chan User {
    out := make(chan User)
    go func() {
        u := db.Load(id)
        out <- u
    }()
    return out
}

func main() {
    fut := loadAsync(42)
    select {
    case u := <-fut:
        fmt.Println(u)
    case <-time.After(100 * time.Millisecond):
        fmt.Println("timed out")
    }
}
```

**Bug:** the channel is unbuffered. If the timeout fires first, the goroutine blocks forever on `out <- u` because nobody is reading.

**Failure mode:** goroutine leak. Every timed-out request leaves a goroutine alive forever. Eventually exhausts memory.

**Fix:** `out := make(chan User, 1)`.

---

## Bug 2. Double-await on a single-shot future

```go
fut := computeAsync()
v := <-fut
log.Println(v)
// later...
w := <-fut
log.Println(w)
```

**Bug:** a single-shot future's capacity-1 buffer holds exactly one value. The first `<-fut` empties it. The second `<-fut` blocks forever.

**Failure mode:** the program hangs on the second read.

**Fix:** either save `v` in a variable and reuse it, or build a memoized future.

---

## Bug 3. The pre-1.22 loop variable bug

```go
futs := make([]<-chan int, 0, 10)
for i := 0; i < 10; i++ {
    ch := make(chan int, 1)
    go func() {
        ch <- i * i
    }()
    futs = append(futs, ch)
}
for _, f := range futs {
    fmt.Println(<-f)
}
```

**Bug:** the goroutine captures `i` by reference (pre-Go 1.22). By the time any goroutine runs, `i` is `10`. All futures resolve to `100`.

**Failure mode:** wrong results. All ten futures print `100`.

**Fix:** in pre-1.22 code, shadow the variable: `i := i` immediately inside the loop. In Go 1.22+ this is fixed by the language.

---

## Bug 4. Capacity matches reader count, not writer count

```go
func fanOutAsync(work []int) <-chan int {
    out := make(chan int, len(work)) // looks fine?
    for _, w := range work {
        w := w
        go func() {
            out <- compute(w)
        }()
    }
    return out
}
```

**Bug:** the function returns the channel but never closes it. Callers using `range` will hang. Also, the buffer being sized for all writers is fine in itself — but only as long as nobody short-reads.

**Failure mode:** caller's `for v := range out` hangs after receiving all values.

**Fix:** add a closer goroutine with a WaitGroup:

```go
var wg sync.WaitGroup
for _, w := range work {
    w := w
    wg.Add(1)
    go func() {
        defer wg.Done()
        out <- compute(w)
    }()
}
go func() {
    wg.Wait()
    close(out)
}()
```

---

## Bug 5. AwaitAny with ignored ctx

```go
func AwaitAny[T any](futs ...*Future[T]) (T, error) {
    type r struct { v T; err error }
    out := make(chan r, len(futs))
    for _, fu := range futs {
        fu := fu
        go func() {
            v, err := fu.Await(context.Background())
            out <- r{v, err}
        }()
    }
    x := <-out
    return x.v, x.err
}
```

**Bug:** when the first result arrives, the function returns. The other forwarder goroutines stay blocked on their `fu.Await(context.Background())`. They cannot be cancelled because we used `Background()`. Even worse, they will eventually push into `out` which has buffer `len(futs)` — okay for not blocking, but the goroutines stay alive for the duration of the work.

**Failure mode:** goroutine leak per `AwaitAny` call. Memory grows.

**Fix:** pass a cancellable ctx, and ensure the futures honour it:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
for _, fu := range futs {
    go func() {
        v, err := fu.Await(ctx)
        select { case out <- r{v, err}: case <-ctx.Done(): }
    }()
}
```

The deferred `cancel()` lets the losers exit promptly.

---

## Bug 6. Memo with a value channel

```go
type Memo[T any] struct {
    once sync.Once
    val  T
    err  error
    done chan struct{}
    fn   func() (T, error)
}

func (m *Memo[T]) Await(ctx context.Context) (T, error) {
    m.once.Do(func() {
        m.val, m.err = m.fn()
        m.done <- struct{}{}    // BUG
    })
    <-m.done
    return m.val, m.err
}
```

**Bug:** `m.done` is unbuffered. The first call sends into `m.done`, but `m.once.Do` is synchronous — the send happens inside `Do`. After `Do` returns, the same goroutine receives from `m.done` (line `<-m.done`). That works for the first caller. The second caller calls `Do`, finds it already done (skipping the func), and then `<-m.done` — but nothing was ever sent for them. Hang.

**Failure mode:** second and subsequent awaits hang forever.

**Fix:** close the channel instead of sending:

```go
m.once.Do(func() {
    m.val, m.err = m.fn()
    close(m.done)
})
```

A closed channel returns to *every* receiver.

---

## Bug 7. Spawned futures inside a loop without bounds

```go
func processItems(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, it := range items {
        it := it
        g.Go(func() error {
            return process(ctx, it)
        })
    }
    return g.Wait()
}
```

**Bug:** if `len(items)` is large (say, 100,000), this spawns 100,000 goroutines simultaneously. Each may try to open a network connection, allocate buffers, etc. CPU thrashes, file descriptors run out, downstream services are overwhelmed.

**Failure mode:** "production goes down" mode. Connection pool exhaustion, timeouts cascading.

**Fix:** `g.SetLimit(K)` for some reasonable `K`:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(runtime.GOMAXPROCS(0) * 8)
```

---

## Bug 8. Hedge that doubles load forever

```go
func Hedge[T any](ctx context.Context, do func(context.Context) (T, error)) (T, error) {
    out := make(chan T, 2)
    go func() {
        v, _ := do(ctx)
        out <- v
    }()
    time.Sleep(5 * time.Millisecond)    // BUG: no chance for first to win cheaply
    go func() {
        v, _ := do(ctx)
        out <- v
    }()
    return <-out, nil
}
```

**Bug:** the `time.Sleep` blocks unconditionally. The first request has not had a chance to be checked. The second goroutine *always* fires. Hedge factor: 200%. Also, the first error is swallowed (`v, _ :=`).

**Failure mode:** downstream sees double the load. SREs page you.

**Fix:** use `select` with a timer to check whether the first finished:

```go
select {
case v := <-out:
    return v, nil
case <-time.After(delay):
    // fire hedge
}
```

Also propagate the error.

---

## Bug 9. The "I'll close it at the end" mistake

```go
func StreamSquaresAsync(n int) <-chan int {
    out := make(chan int, 1)
    go func() {
        for i := 0; i < n; i++ {
            out <- i * i
        }
        // forgot to close(out)
    }()
    return out
}

func main() {
    for sq := range StreamSquaresAsync(10) {
        fmt.Println(sq)
    }
}
```

**Bug:** the producer sends 10 values then exits, but never closes the channel. The consumer's `range` waits forever after the 10th value.

**Failure mode:** consumer hangs after consuming all values.

**Fix:** `defer close(out)` inside the goroutine.

Side note: this is no longer a "future" — it's a stream. Single-shot futures with one value don't need close. Streams do.

---

## Bug 10. Returning a writable channel

```go
func computeAsync() chan int {
    ch := make(chan int, 1)
    go func() { ch <- 42 }()
    return ch
}

// somewhere else, by accident:
fut := computeAsync()
go func() { fut <- 99 }()  // compiles!
fmt.Println(<-fut)
```

**Bug:** the function returns `chan int` (bidirectional). Some code can send into it accidentally — perhaps thinking it is some other channel. The reader might receive `42` or `99`.

**Failure mode:** non-deterministic value. Worse: a malicious or careless caller can poison the result.

**Fix:** return `<-chan int`:

```go
func computeAsync() <-chan int {
    ch := make(chan int, 1)
    go func() { ch <- 42 }()
    return ch
}
```

---

## Bug 11. Panic in the goroutine

```go
func loadAsync(id int) <-chan Result[User] {
    out := make(chan Result[User], 1)
    go func() {
        u := db.Load(id) // can panic on bad id
        out <- Result[User]{Val: u}
    }()
    return out
}
```

**Bug:** if `db.Load` panics, the goroutine dies. Because there is no `recover`, the panic crashes the *entire program*. The caller awaiting `<-out` never sees a result — the process is gone.

**Failure mode:** an unrelated request crashes the server because of one bad input.

**Fix:** recover and forward as an error:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            out <- Result[User]{Err: fmt.Errorf("panic: %v", r)}
        }
    }()
    u := db.Load(id)
    out <- Result[User]{Val: u}
}()
```

Some teams prefer letting the goroutine kill the process (so the operator sees the bug). For user-input-driven workers, recover is the right policy.

---

## Bug 12. Memoized future with ctx-aware work that gets cancelled by the first caller

```go
type Memo[T any] struct {
    once sync.Once
    val  T
    err  error
    done chan struct{}
    fn   func(context.Context) (T, error)
}

func (m *Memo[T]) Await(ctx context.Context) (T, error) {
    m.once.Do(func() {
        go func() {
            defer close(m.done)
            m.val, m.err = m.fn(ctx)   // BUG: uses the first caller's ctx
        }()
    })
    select {
    case <-m.done:
        return m.val, m.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

**Bug:** the first caller's `ctx` is captured by the work goroutine. If that caller's ctx is cancelled (timeout, client disconnect), the *work* is cancelled too — even if subsequent callers have plenty of time left. The cached result is effectively "first caller's deadline".

**Failure mode:** subsequent callers receive `context.Canceled` even though they had a long deadline.

**Fix:** detach the work from the caller's ctx:

```go
m.once.Do(func() {
    go func() {
        defer close(m.done)
        m.val, m.err = m.fn(context.Background())
    }()
})
```

This is what `singleflight.Group.Do` does. Trade-off: the work cannot be cancelled when all callers leave. For a refcounted version, see senior.md.

---

## Bug 13. Reading from a future inside an `errgroup.Go` without ctx

```go
g, ctx := errgroup.WithContext(parentCtx)
fut := computeAsync()
g.Go(func() error {
    v := <-fut          // BUG: ignores ctx
    return process(ctx, v)
})
```

**Bug:** `<-fut` is unconditional. If `parentCtx` is cancelled while waiting for the future, the goroutine still waits for the future to finish before noticing. If the future itself doesn't honour ctx, this blocks indefinitely.

**Failure mode:** errgroup `Wait()` blocks past its deadline. Cascading slow shutdown.

**Fix:** `select`:

```go
g.Go(func() error {
    select {
    case v := <-fut:
        return process(ctx, v)
    case <-ctx.Done():
        return ctx.Err()
    }
})
```

---

## Bug 14. AwaitAll that fails on the first error but doesn't cancel

```go
func AwaitAll[T any](ctx context.Context, futs ...*Future[T]) ([]T, error) {
    results := make([]T, len(futs))
    for i, fu := range futs {
        v, err := fu.Await(ctx)
        if err != nil {
            return nil, err
        }
        results[i] = v
    }
    return results, nil
}
```

**Bug (subtle):** when the first error returns, the other futures continue running. Their work keeps consuming resources until they complete (or their own ctx fires). If `ctx` is the parent context, the other futures keep running until the *parent* finishes — which might be the whole request lifetime.

**Failure mode:** wasted resources after a fail-fast return.

**Fix:** derive a child ctx that the futures share, and cancel on early return:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
// pass ctx to the futures at construction
// when we return early, cancel() fires and they stop
```

Or use `errgroup`, which does this for you.

---

## Bug 15. The "shared mutable state" gotcha

```go
type Cache struct {
    data map[string]string
}

func (c *Cache) GetAsync(key string) <-chan string {
    out := make(chan string, 1)
    go func() {
        out <- c.data[key]   // BUG: concurrent read of map
    }()
    return out
}
```

**Bug:** if any other goroutine writes to `c.data` concurrently, this race-conditions. Even if `data` is read-only after construction, the lack of synchronisation is undefined behaviour for `map` access — Go maps are not concurrent-safe.

**Failure mode:** `fatal error: concurrent map read and map write` crashes the process.

**Fix:** protect with a mutex, or use `sync.Map`, or guarantee single-threaded access by design.

```go
func (c *Cache) GetAsync(key string) <-chan string {
    out := make(chan string, 1)
    go func() {
        c.mu.RLock()
        v := c.data[key]
        c.mu.RUnlock()
        out <- v
    }()
    return out
}
```

---

## Bug 16. Forgetting to drain after a timeout-cancelled await

```go
ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
defer cancel()

fut := slowAsync()
select {
case v := <-fut.ch:
    use(v)
case <-ctx.Done():
    return ctx.Err()
}
```

**Bug:** the timeout fires, we return `ctx.Err()`. The producer goroutine is still running; eventually it sends into `fut.ch`. If `fut.ch` is buffered (cap 1), no problem — the value sits in the buffer and is garbage collected with `fut`. If it is *unbuffered*, the producer is now blocked forever.

**Failure mode:** condition on whether the channel was buffered. Unbuffered = leak.

**Fix:** always buffer the result channel. (This is the same lesson as Bug 1, but in a more subtle context: even with ctx, the buffer rule still applies.)

---

## Bug 17. The `Done()` method that consumes the value

This is the bug I mentioned in middle.md:

```go
func (f *Future[T]) Done() <-chan struct{} {
    done := make(chan struct{})
    go func() {
        <-f.ch         // BUG: consumes the value
        close(done)
    }()
    return done
}
```

**Bug:** `Done()` reads `f.ch`, which empties the capacity-1 buffer. Any later `Await()` call on the same future blocks forever — the value is gone.

**Failure mode:** mixing `Done()` and `Await()` deadlocks the awaiter.

**Fix:** redesign as a memoized future. Store the result in fields, signal completion via `close(done)`. Then `Done()` and `Await()` both observe the close without consuming the value.

---

## Bug 18. Closing a channel from the consumer

```go
fut := computeAsync()
select {
case v := <-fut:
    use(v)
default:
    close(fut)        // BUG: receiver closes, also fut is <-chan T
}
```

**Bug (a):** Go forbids closing a receive-only channel — this won't compile if `fut` is `<-chan T`. But if it is `chan T`:

**Bug (b):** Closing a channel that the producer is still writing to causes a panic on the producer's send.

**Failure mode:** compile error (if `<-chan`) or producer panic.

**Fix:** never close from the receive side. Only the producer (or a coordinator) closes. For futures, you typically don't close at all.

---

## Bug 19. Goroutine that sends after a panic recover

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recovered:", r)
        }
    }()
    v := mayPanic()
    out <- v        // unreachable if panic; never sent
}()
```

**Bug:** the recover logs the panic but does not send anything to `out`. The awaiter `<-out` blocks forever.

**Failure mode:** silent hang. Especially insidious because the log line "recovered" appears, leading the operator to think it's handled.

**Fix:** send an error on panic:

```go
defer func() {
    if r := recover(); r != nil {
        out <- Result[T]{Err: fmt.Errorf("panic: %v", r)}
    }
}()
```

---

## Bug 20. Mixing `<-fut` with a `select` over `fut.Done()`

```go
type Future[T any] struct {
    val  T
    err  error
    done chan struct{}
}

select {
case <-f.done:
    use(f.val, f.err)
case v := <-someOtherChannel:
    ...
}
```

This one is *correct* — but only because `f.done` is closed (not sent into) and `f.val`/`f.err` are written before the close.

A common mistake is to forget the memory-model ordering:

```go
// in some goroutine:
f.val = compute()
close(f.done)         // close synchronizes
```

is fine, but:

```go
go func() { f.val = compute() }()
go func() { close(f.done) }()  // BUG: races with the write to f.val
```

is broken. The write to `f.val` is not ordered before the close.

**Failure mode:** intermittent zero/garbage values for `f.val`.

**Fix:** do both in the same goroutine, in order.

---

## Wrapping up

If you can find and fix all 20 bugs without consulting the solutions, you have internalised the future pattern at the senior level. The bugs cluster around four themes:

1. **Channel buffering** — capacity 1 is non-negotiable.
2. **Context propagation** — ctx must reach every blocking call.
3. **Memory model** — sends/closes happen-before receives; lone writes from another goroutine race.
4. **Cancellation discipline** — when you return early, derived contexts let the rest of the system stop too.

These four themes are the entire pattern. The rest is taste.
