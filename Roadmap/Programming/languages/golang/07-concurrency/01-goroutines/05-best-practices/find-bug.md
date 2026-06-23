# Goroutine Best Practices — Find the Bug

> Each section presents broken code. Read it carefully, predict the symptom, then read the explanation and fix. Each bug violates one or more of the twelve rules from junior — the goal is to recognise the pattern.

---

## How to use this file

1. Read the snippet.
2. State the symptom: panic, deadlock, leak, wrong output, race, flake?
3. Name the rule(s) being broken.
4. Sketch a fix.
5. Read the explanation and compare.

---

## Bug 1: `wg.Add` inside the goroutine

```go
func processAll(items []Item) {
    var wg sync.WaitGroup
    for _, item := range items {
        item := item
        go func() {
            wg.Add(1)
            defer wg.Done()
            process(item)
        }()
    }
    wg.Wait()
}
```

**Symptom.** Sometimes `processAll` returns before all items are processed. The race detector reports a race on the `WaitGroup` counter.

**Rule broken.** Rule 2 — `wg.Add` belongs in the parent, before `go`.

**Root cause.** `Wait` may run before any goroutine has reached its `Add`. The counter is 0, so `Wait` returns immediately.

**Fix.**

```go
for _, item := range items {
    item := item
    wg.Add(1)
    go func() {
        defer wg.Done()
        process(item)
    }()
}
wg.Wait()
```

---

## Bug 2: captured loop variable

```go
for _, url := range urls {
    go func() {
        fetch(url)
    }()
}
```

**Symptom.** On Go < 1.22, all goroutines fetch the same URL (the last one in `urls`). On Go ≥ 1.22, each gets its own — but the code still reads as ambiguous.

**Rule broken.** Rule 3 — pass loop variables as parameters.

**Root cause.** Pre-1.22, the closure captures the *variable*. By the time the goroutines run, the loop has finished and `url` holds the last value.

**Fix.**

```go
for _, url := range urls {
    url := url
    go func() { fetch(url) }()
}
// or, idiomatic:
for _, url := range urls {
    go func(url string) { fetch(url) }(url)
}
```

---

## Bug 3: `time.Sleep` to wait for a goroutine

```go
func compute() int {
    var result int
    go func() {
        result = expensive()
    }()
    time.Sleep(100 * time.Millisecond)
    return result
}
```

**Symptom.** Sometimes returns 0 (the goroutine hasn't run yet); sometimes returns the right value. Race detector reports a race on `result`.

**Rule broken.** Rules 8 and 9.

**Root cause.** `time.Sleep` is unrelated to the goroutine's completion. Even if `expensive()` typically finishes in under 100 ms, there's no guarantee on a busy machine. And `result` is read in the parent goroutine without synchronisation with the write — a data race.

**Fix.**

```go
func compute() int {
    ch := make(chan int, 1)
    go func() {
        ch <- expensive()
    }()
    return <-ch
}
```

The channel both synchronises and transfers the value.

---

## Bug 4: missing `defer wg.Done()`

```go
wg.Add(1)
go func() {
    if early() {
        return
    }
    work()
    wg.Done()
}()
```

**Symptom.** Sometimes `wg.Wait()` hangs forever.

**Rule broken.** Rule 2 — use `defer wg.Done()` so it runs on every exit path.

**Root cause.** The early-return path skips `wg.Done()`. The counter never reaches 0.

**Fix.**

```go
wg.Add(1)
go func() {
    defer wg.Done()
    if early() {
        return
    }
    work()
}()
```

---

## Bug 5: unrecovered panic

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        process(r)               // can panic on bad input
    }()
    w.WriteHeader(202)
}
```

**Symptom.** One malformed request crashes the whole HTTP server. Every other in-flight request dies.

**Rule broken.** Rule 5 — recover at the goroutine boundary.

**Root cause.** Goroutines spawned outside a request handler are not protected by `net/http`'s built-in recover. An unrecovered panic terminates the process.

**Fix.**

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("background panic: %v\n%s", r, debug.Stack())
        }
    }()
    process(r)
}()
```

Better: extract to a `safeGo` helper.

---

## Bug 6: leak via never-closed channel

```go
func producer() <-chan int {
    ch := make(chan int)
    go func() {
        for i := 0; i < 10; i++ {
            ch <- i
        }
    }()
    return ch
}

func main() {
    ch := producer()
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Symptom.** Prints 0..9, then deadlock: `fatal error: all goroutines are asleep`.

**Rule broken.** Rule 1 — clear exit story. The producer doesn't close.

**Root cause.** `for range` blocks waiting for the next value or for the channel to close. Producer sent 10 values and exited without closing.

**Fix.**

```go
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        ch <- i
    }
}()
```

---

## Bug 7: leak via never-read channel

```go
func compute(ctx context.Context) (int, error) {
    ch := make(chan int)
    go func() {
        ch <- expensive()       // blocks forever if no one reads
    }()
    select {
    case v := <-ch:
        return v, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

**Symptom.** On the ctx-cancellation branch, the goroutine is still blocked sending to `ch`. Memory leak — accumulates one goroutine per cancelled call.

**Rule broken.** Rule 1 — exit story doesn't hold on the cancellation path.

**Root cause.** Unbuffered channel; if the parent gives up on the receive, the sender has no one to deliver to.

**Fix.**

```go
ch := make(chan int, 1)             // buffered: send completes
```

Or have the goroutine watch `ctx.Done()` too:

```go
go func() {
    v := expensive()
    select {
    case ch <- v:
    case <-ctx.Done():
    }
}()
```

---

## Bug 8: context.Background() inside a child

```go
func process(ctx context.Context, items []Item) error {
    g, _ := errgroup.WithContext(ctx)
    for _, item := range items {
        item := item
        g.Go(func() error {
            return work(context.Background(), item)   // BUG
        })
    }
    return g.Wait()
}
```

**Symptom.** When `ctx` cancels (e.g., on shutdown), child `work` calls don't stop. Slow shutdown.

**Rule broken.** Rule 4 — thread context through.

**Root cause.** `work` is invoked with a fresh `Background()`, disconnected from `ctx`'s cancellation.

**Fix.** Capture the group's `ctx`:

```go
g, ctx := errgroup.WithContext(ctx)
// ...
g.Go(func() error { return work(ctx, item) })
```

---

## Bug 9: unbounded goroutines per input

```go
func consumer(in <-chan Msg) {
    for msg := range in {
        go handle(msg)
    }
}
```

**Symptom.** Under a backlog burst, the consumer spawns thousands of goroutines, OOMs the process.

**Rule broken.** Rule 10 — bound concurrency.

**Root cause.** No cap on in-flight `handle` calls. Input rate dictates goroutine count.

**Fix.** Use a worker pool:

```go
func consumer(ctx context.Context, in <-chan Msg, n int) error {
    g, ctx := errgroup.WithContext(ctx)
    for i := 0; i < n; i++ {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case msg, ok := <-in:
                    if !ok {
                        return nil
                    }
                    handle(ctx, msg)
                }
            }
        })
    }
    return g.Wait()
}
```

---

## Bug 10: recover in the wrong goroutine

```go
func safeGo(fn func()) {
    defer func() {                            // BUG: parent's defer
        if r := recover(); r != nil {
            log.Println("recover:", r)
        }
    }()
    go fn()
}
```

**Symptom.** Panics in `fn` still crash the process. The recover never fires.

**Rule broken.** Rule 5 — recover at the *goroutine boundary*, meaning inside the goroutine.

**Root cause.** `recover` only sees panics in *its own* goroutine. The defer here is in the parent.

**Fix.** Move the defer inside the goroutine body:

```go
func safeGo(fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Println("recover:", r)
            }
        }()
        fn()
    }()
}
```

---

## Bug 11: hand-rolled error channel sized too small

```go
func fetchAll(urls []string) error {
    var wg sync.WaitGroup
    errCh := make(chan error, 1)            // BUG
    for _, url := range urls {
        url := url
        wg.Add(1)
        go func() {
            defer wg.Done()
            if err := fetch(url); err != nil {
                errCh <- err
            }
        }()
    }
    wg.Wait()
    close(errCh)
    return <-errCh
}
```

**Symptom.** If two or more fetches fail, the second `errCh <- err` blocks forever. The goroutine leaks, and `wg.Wait()` hangs.

**Rule broken.** Rule 6 — prefer `errgroup` over hand-rolled. Also Rule 1 — exit story doesn't hold.

**Root cause.** Buffer capacity is smaller than the number of potential senders. Anyone past the first send blocks waiting for a reader.

**Fix.** Use `errgroup`:

```go
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    url := url
    g.Go(func() error { return fetch(ctx, url) })
}
return g.Wait()
```

Or, if you want all errors, use a buffer of `len(urls)`. But `errgroup` is the right answer.

---

## Bug 12: nested errgroup deadlock with SetLimit

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(2)

g.Go(func() error {
    g.Go(func() error {                     // BUG: nested Go inside a slot
        return inner()
    })
    return nil
})
g.Go(func() error { return work() })

return g.Wait()
```

**Symptom.** Can deadlock if both outer slots are full and the inner `Go` is blocked waiting for a slot.

**Rule broken.** Rule 10's edge — bounded concurrency must not be self-blocking.

**Root cause.** `g.Go` with `SetLimit` blocks until a slot is free. If the only way a slot frees up is for the current `Go` to return, and the current `Go` is calling `g.Go` waiting for a slot — deadlock.

**Fix.** Use a separate `errgroup` for the inner work, or don't nest.

---

## Bug 13: mutex held across channel send

```go
type Cache struct {
    mu sync.Mutex
    ch chan Update
}

func (c *Cache) Update(u Update) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.ch <- u                                // BUG: blocks while holding lock
}
```

**Symptom.** Under contention, every `Update` call serialises. If the channel is full, the lock is held while waiting, and every other caller queues up behind it.

**Rule broken.** Rule 7 — channels for flow, mutex for state. Don't combine them this way.

**Root cause.** Holding a mutex across a blocking channel operation is a contention disaster.

**Fix.** Release the lock first, or capture the value and send outside the critical section:

```go
func (c *Cache) Update(u Update) {
    c.mu.Lock()
    /* update internal state */
    c.mu.Unlock()
    c.ch <- u
}
```

Or send via a non-blocking `select` if it's OK to drop:

```go
select {
case c.ch <- u:
default:
    // drop or buffer
}
```

---

## Bug 14: `sync.Mutex` copied via value

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {                    // BUG: value receiver copies mutex
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

**Symptom.** Race on `n`. `go vet` flags it with "passes lock by value".

**Rule broken.** Rule 7 — state needs protection, and copying a mutex defeats it.

**Root cause.** A value receiver copies the struct, including the mutex. Each call has its own copy of the mutex. They're unrelated; no synchronisation.

**Fix.** Pointer receiver:

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

---

## Bug 15: forgot `defer cancel()`

```go
func work(parent context.Context) error {
    ctx, _ := context.WithTimeout(parent, time.Second)
    return doWork(ctx)
}
```

**Symptom.** Each call leaks the internal context timer. Over time, goroutine count creeps up. `pprof` shows many `context.WithTimeout` timers alive.

**Rule broken.** Rule 4 + Rule 1.

**Root cause.** `WithTimeout` allocates a timer goroutine internally that's released by calling `cancel`. Discarding `cancel` leaks it.

**Fix.**

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()
return doWork(ctx)
```

---

## Bug 16: shared map without synchronisation

```go
var visited = map[string]bool{}

func crawl(urls []string) {
    var wg sync.WaitGroup
    for _, url := range urls {
        url := url
        wg.Add(1)
        go func() {
            defer wg.Done()
            if visited[url] {              // race
                return
            }
            visited[url] = true            // race
            fetch(url)
        }()
    }
    wg.Wait()
}
```

**Symptom.** Race detector flags it. In production, occasional "fatal error: concurrent map writes" panic.

**Rule broken.** Rule 7 — state needs a mutex.

**Root cause.** Built-in `map` is not safe for concurrent use.

**Fix.**

```go
var (
    mu      sync.Mutex
    visited = map[string]bool{}
)
// ...
mu.Lock()
if visited[url] {
    mu.Unlock()
    return
}
visited[url] = true
mu.Unlock()
fetch(url)
```

Or use `sync.Map`. Or partition by URL hash.

---

## Bug 17: errgroup returning nil to signal completion

```go
g, ctx := errgroup.WithContext(ctx)
for _, x := range xs {
    x := x
    g.Go(func() error {
        if done(x) {
            return nil                       // intended: stop peers
        }
        return process(ctx, x)
    })
}
return g.Wait()
```

**Symptom.** When one worker returns `nil` (intending to signal "done"), peers keep running.

**Rule broken.** Rule 6 — understand `errgroup` semantics.

**Root cause.** `errgroup.WithContext` cancels only on a *non-nil* error. Returning `nil` means "I finished successfully, peers should continue."

**Fix.** Use a sentinel error or explicit cancel:

```go
var errStop = errors.New("stop signal")
g.Go(func() error {
    if done(x) {
        return errStop
    }
    return process(ctx, x)
})
// ...
err := g.Wait()
if errors.Is(err, errStop) {
    err = nil
}
return err
```

---

## Bug 18: leaking `time.Ticker`

```go
func loop(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.NewTicker(time.Second).C:    // BUG: new ticker each iter
            tick()
        }
    }
}
```

**Symptom.** Each iteration allocates a new `time.Ticker` and its goroutine. Over time, count balloons.

**Rule broken.** Rule 1 — clear exit. Each ticker has no `Stop` and lives until GC, but GC of the ticker is delayed.

**Root cause.** `time.NewTicker` returns a Ticker with a goroutine pushing to `.C`. You must `Stop` it.

**Fix.**

```go
ticker := time.NewTicker(time.Second)
defer ticker.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-ticker.C:
        tick()
    }
}
```

---

## Bug 19: goleak missing the leak

```go
func TestProcess(t *testing.T) {
    defer goleak.VerifyNone(t)
    go func() {
        time.Sleep(50 * time.Millisecond)
        log.Println("late goroutine")
    }()
    process()
}
```

**Symptom.** Sometimes the test passes; sometimes it fails. Flaky.

**Rule broken.** Rule 12 — leak detection should be reliable.

**Root cause.** `goleak.VerifyNone` runs immediately on defer. If the goroutine is still sleeping, it's caught. If somehow it had exited already, it's missed (rare here, but possible with shorter sleeps).

**Fix.** Don't spawn unbounded background goroutines in tests. Use synchronisation:

```go
done := make(chan struct{})
go func() {
    defer close(done)
    log.Println("explicit goroutine")
}()
process()
<-done
```

Now the test deterministically waits for the goroutine before `VerifyNone`.

---

## Bug 20: pool drain doesn't drain

```go
func Close(p *Pool) {
    close(p.jobs)
    // assume workers drain
}
```

**Symptom.** `Close` returns immediately; in-flight jobs may still be running. Caller assumes done.

**Rule broken.** Rule 1 — exit story includes drain.

**Root cause.** Closing `jobs` lets workers exit *after* they finish their current job. The pool's `Close` doesn't wait.

**Fix.**

```go
func Close(p *Pool) error {
    close(p.jobs)
    p.wg.Wait()                              // wait for workers
    return nil
}
```

If `Close` accepts a context, bound the wait:

```go
func Close(ctx context.Context, p *Pool) error {
    close(p.jobs)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

---

## Bug 21: undocumented concurrency safety

```go
type ConfigCache struct {
    entries map[string]*Config
}

func (c *ConfigCache) Get(k string) *Config {
    return c.entries[k]
}

func (c *ConfigCache) Set(k string, v *Config) {
    c.entries[k] = v
}
```

**Symptom.** Calling code uses `ConfigCache` from multiple goroutines, assuming it's safe (similar to `sync.Map`). Race condition; eventual "concurrent map writes" panic in production.

**Rule broken.** Rule 11 — document concurrency safety.

**Root cause.** No doc comment to say "not safe for concurrent use." Callers guess wrong.

**Fix.** Either make it safe (mutex/atomic) and document so, or document that it isn't safe:

```go
// ConfigCache is NOT safe for concurrent use by multiple goroutines.
// Wrap it with a sync.Mutex if used concurrently.
type ConfigCache struct { /* ... */ }
```

---

## Bug 22: WaitGroup reused

```go
var wg sync.WaitGroup
for batch := range batches {
    for _, item := range batch {
        item := item
        wg.Add(1)
        go func() { defer wg.Done(); process(item) }()
    }
    wg.Wait()
    // start next batch on same wg
}
```

**Symptom.** Race detector reports a race on the WaitGroup state, occasionally.

**Rule broken.** Rule 2 — `WaitGroup` reuse rules.

**Root cause.** Reusing a `WaitGroup` after `Wait` is allowed *only* if there are no concurrent `Add`s with the previous `Wait`. In practice, mixing parent and goroutine timing in a loop has been a source of subtle races historically (fixed in newer Go, but still confusing).

**Fix.** Use a fresh `WaitGroup` per batch, or — better — use `errgroup.WithContext` per batch:

```go
for batch := range batches {
    g, ctx := errgroup.WithContext(ctx)
    for _, item := range batch {
        item := item
        g.Go(func() error { return process(ctx, item) })
    }
    if err := g.Wait(); err != nil {
        return err
    }
}
```

---

## Bug 23: panic inside recover

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recovered:", r.(string))   // BUG: panics if r is not string
        }
    }()
    risky()
}()
```

**Symptom.** Sometimes the recover itself panics, the goroutine dies, the process exits anyway.

**Rule broken.** Rule 5 — recover safely.

**Root cause.** `r.(string)` panics if the recovered value is, say, `runtime.Error` or an `error`. The new panic occurs inside the deferred function, after the original recover succeeded — it's a *fresh* panic with no handler.

**Fix.** Format with `%v`:

```go
log.Printf("recovered: %v", r)
```

Or type-switch with a default:

```go
switch v := r.(type) {
case string:
    log.Println("string panic:", v)
case error:
    log.Println("error panic:", v)
default:
    log.Printf("unknown panic: %v", v)
}
```

---

## Bug 24: not running race detector in CI

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    steps:
      - run: go test ./...
```

**Symptom.** Data races slip into production. Discovered by users.

**Rule broken.** Rule 9.

**Root cause.** No `-race` job in CI. Local developer runs don't include it. Code that races on production hardware passes CI.

**Fix.**

```yaml
jobs:
  test:
    steps:
      - run: go test ./...
  race:
    steps:
      - run: go test -race ./...
```

Two jobs in parallel. Race job can take 5-10x longer; that's fine.

---

## Bug 25: leaking on the happy path

```go
func compute(ctx context.Context) (int, error) {
    result := make(chan int, 1)
    go func() {
        result <- expensive()                // OK, buffered
    }()
    select {
    case v := <-result:
        return v, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

**Symptom.** On `ctx.Done()`, the goroutine completes its send to the buffered channel and exits cleanly. *No leak.* This one is a trick: the bug is in **bug 7**'s version (unbuffered channel). The buffered version is correct.

**Rule confirmed.** Rule 1 — buffered channel of size 1 is the canonical fix for "send the result and exit even if no one reads."

---

## Summary: pattern recognition

Most goroutine bugs fall into one of these patterns:

| Pattern | Rule violated |
|---|---|
| Counter doesn't reach 0 | 2 — `wg.Done()` not deferred |
| Counter dropped to 0 prematurely | 2 — `wg.Add` inside goroutine |
| Captured loop variable | 3 |
| Wait failed | 8 — `time.Sleep` instead of event |
| Process crashed on bad input | 5 — no recover |
| Memory creep over hours | 1, 12 — leak |
| Concurrent map writes panic | 7, 11 |
| Mutex copied | 7 |
| Cancellation doesn't reach child | 4 — context not threaded |
| OOM under load burst | 10 — unbounded |

When you see one of these symptoms, jump to the corresponding rule and check.
