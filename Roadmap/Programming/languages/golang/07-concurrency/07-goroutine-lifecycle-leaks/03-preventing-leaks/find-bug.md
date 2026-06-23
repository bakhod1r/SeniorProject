# Preventing Goroutine Leaks — Find the Bug

> Twenty-plus bugged programs across the prevention catalogue. For each snippet: predict the failure mode (leak, deadlock, panic, race, hang), name the broken prevention principle, and sketch the fix before reading the answer.
>
> If you have absorbed the rest of this subsection, every bug here should be recognisable as a violation of a specific pattern from junior, middle, or senior level.

---

## How to Use This File

1. Read the snippet completely before forming an opinion.
2. Decide: what is the visible symptom? Slow shutdown? Memory growth? Hang? Panic?
3. Name the broken principle: missing owner, severed context, busy-wait without cancel, mutex around channel, ticker without stop, etc.
4. Sketch the fix in your head or on paper.
5. Read the answer and compare.

---

## Easy

### Bug 1 — The Eternal Heartbeat

```go
func startHeartbeat() {
    go func() {
        t := time.NewTicker(time.Second)
        for range t.C {
            ping()
        }
    }()
}
```

**Observation.** `pprof/goroutine` shows one goroutine in this function, forever. Nothing stops it. After 100 deploys in a long-lived testbed, 100 of them.

**Find the bug.**

---

**Answer.** Pattern 5 — no owner, no cancellation, no `Stop`. Even if `for range t.C` exits (which it never will because the ticker is never stopped), the goroutine still has no signal to leave.

Fix: wrap in a struct with `Close`, use `select` with `<-ctx.Done()`, `defer t.Stop()`.

---

### Bug 2 — The Forgotten Cancel

```go
func processBatch(parent context.Context, items []Item) error {
    ctx, _ := context.WithTimeout(parent, 5*time.Second)
    return doBatch(ctx, items)
}
```

**Observation.** `go vet` warns. Memory profiles show timers piling up under load.

**Find the bug.**

---

**Answer.** Missing `cancel`. The timeout will eventually fire and release the context, but until then, the parent context's internal cancellation tree has a registration that's not released. Worse, if `doBatch` returns early, the timer continues to live until expiry.

Fix:
```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

---

### Bug 3 — The Severed Chain

```go
func (s *Service) Process(req Request) error {
    return s.do(context.Background(), req)
}

func (s *Service) do(ctx context.Context, req Request) error {
    return s.db.Query(ctx, req.SQL)
}
```

**Observation.** When the client disconnects mid-request, the database query keeps running. Connection pool fills up under load.

**Find the bug.**

---

**Answer.** `Process` does not accept the caller's `ctx`, severing the cancellation chain. The fresh `context.Background()` has no cancellation, so `db.Query` runs to completion even if the caller has given up.

Fix:
```go
func (s *Service) Process(ctx context.Context, req Request) error {
    return s.do(ctx, req)
}
```

---

### Bug 4 — The Captured Context

```go
type Worker struct {
    ctx context.Context
}

func New(ctx context.Context) *Worker {
    return &Worker{ctx: ctx}
}

func (w *Worker) Do(req Request) error {
    return process(w.ctx, req)
}
```

**Observation.** Each call to `Do` uses the *constructor's* context, not the caller's. If the constructor was called with a short-lived context, every subsequent `Do` returns "context canceled" immediately.

**Find the bug.**

---

**Answer.** Storing `ctx` in a struct field as a per-call parameter. The stored context is stale.

Fix: pass `ctx` to `Do`:
```go
func (w *Worker) Do(ctx context.Context, req Request) error {
    return process(ctx, req)
}
```

---

### Bug 5 — The Greedy Buffer

```go
func fanOut(items []Item) []Result {
    ch := make(chan Result, 100)
    for _, item := range items {
        go func(item Item) { ch <- compute(item) }(item)
    }
    results := make([]Result, 0, len(items))
    for i := 0; i < len(items); i++ {
        results = append(results, <-ch)
    }
    return results
}
```

**Observation.** Fine for `len(items) <= 100`. For `len(items) = 1000`, all results arrive, but `pprof` after the function returns shows a brief spike of 900 goroutines.

**Find the bug.**

---

**Answer.** Buffer is fixed at 100, but the sender count is `len(items)`. Senders 101–1000 block until the receiver makes room. They do exit eventually, but for a window they are alive and blocked. If the function were modified to take only the first result and return, the rest would leak forever.

Fix: `make(chan Result, len(items))`. Or, better, use `errgroup`:
```go
g, ctx := errgroup.WithContext(parent)
results := make([]Result, len(items))
for i, item := range items {
    i, item := i, item
    g.Go(func() error {
        results[i] = compute(ctx, item)
        return nil
    })
}
return results, g.Wait()
```

---

## Medium

### Bug 6 — The Sleeping Worker

```go
func startReporter(ctx context.Context) {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            default:
            }
            time.Sleep(time.Second)
            report()
        }
    }()
}
```

**Observation.** After `cancel()`, the goroutine continues for up to 1 second. In a tight shutdown budget, this is unacceptable.

**Find the bug.**

---

**Answer.** The `select` with `default` is a non-blocking poll that runs in a separate iteration. The `time.Sleep` does not honour cancellation, so cancellation latency is up to 1 second.

Fix:
```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Second):
        report()
    }
}
```

Or, better, use `time.NewTicker` and `defer t.Stop()`.

---

### Bug 7 — The Race to Close

```go
type Reader struct {
    in chan []byte
}

func (r *Reader) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            close(r.in) // BUG
            return
        case data := <-source():
            r.in <- data
        }
    }
}
```

**Observation.** Receivers of `r.in` see the close cleanly. But if another goroutine also writes to `r.in` (or if `Run` is called more than once), `close(r.in)` panics on the second call.

**Find the bug.**

---

**Answer.** Closing from a non-unique sender, or calling `Run` more than once. The rule: `close` is called exactly once, by the unique sender.

Fix: ensure exactly one goroutine writes to `r.in` and only that goroutine closes it. Or use `sync.Once`:
```go
var closeOnce sync.Once
// ...
closeOnce.Do(func() { close(r.in) })
```

---

### Bug 8 — The Mutex Trap

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]string
    ch   chan string
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[k] = v
    c.ch <- k // notify watcher
}
```

**Observation.** If the watcher stops reading `c.ch`, `Set` blocks. Worse, any other goroutine waiting on `c.mu` (a `Get`, for example) also blocks. Whole service stalls.

**Find the bug.**

---

**Answer.** Mutex held across a channel send. Pattern 4.

Fix:
```go
func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    c.data[k] = v
    c.mu.Unlock()
    select {
    case c.ch <- k:
    default:
        // dropped notification
    }
}
```

Or use a buffered channel sized to absorb expected bursts. Or use a callback list that runs after the unlock.

---

### Bug 9 — The Eager Shutdown

```go
func run(ctx context.Context) error {
    srv := &http.Server{Addr: ":8080"}
    g, gctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            return err
        }
        return nil
    })

    g.Go(func() error {
        <-gctx.Done()
        return srv.Shutdown(gctx)
    })

    return g.Wait()
}
```

**Observation.** When SIGTERM arrives and `ctx` cancels, `srv.Shutdown(gctx)` returns immediately because `gctx` is already cancelled. In-flight requests are dropped.

**Find the bug.**

---

**Answer.** `srv.Shutdown` is given an already-cancelled context. It cannot wait for in-flight requests.

Fix: use a fresh shutdown context with a timeout.
```go
g.Go(func() error {
    <-gctx.Done()
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    return srv.Shutdown(shutdownCtx)
})
```

---

### Bug 10 — Submit After Close

```go
type Pool struct {
    in     chan Job
    cancel context.CancelFunc
}

func (p *Pool) Submit(j Job) {
    p.in <- j
}

func (p *Pool) Close() {
    p.cancel()
    close(p.in)
}
```

**Observation.** After `Close`, any concurrent `Submit` panics with "send on closed channel."

**Find the bug.**

---

**Answer.** `Submit` doesn't know about the close. Two fixes are both common:

Fix A: make `Submit` honour a context:
```go
func (p *Pool) Submit(ctx context.Context, j Job) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-p.closed:
        return ErrPoolClosed
    case p.in <- j:
        return nil
    }
}
```

Fix B: don't close the input channel; rely solely on context cancellation:
```go
func (p *Pool) Close() {
    p.cancel()
    p.wg.Wait()
}
```

Workers exit via `<-ctx.Done()`; `Submit` either succeeds before close or sees the cancel.

---

### Bug 11 — The Untracked Spawn

```go
func (s *Service) Handle(req Request) error {
    go s.logAsync(req)
    return s.process(req)
}
```

**Observation.** On shutdown, in-flight `logAsync` goroutines are killed mid-write. Audit logs go missing.

**Find the bug.**

---

**Answer.** Fire-and-forget. No owner, no wait, no shutdown coordination.

Fix: a logging queue with a documented background worker. `Handle` calls `s.audit.Submit(req)`; the audit type owns a goroutine that drains the queue on shutdown.

---

### Bug 12 — The Time.After Loop

```go
func watchFile(ctx context.Context, path string) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(time.Second):
            check(path)
        }
    }
}
```

**Observation.** Looks correct. But `pprof` under prolonged load shows hundreds of `*time.Timer` objects in the heap.

**Find the bug.**

---

**Answer.** `time.After` allocates a fresh `Timer` every iteration. The timer is not GC'd until it fires (or until the runtime cleans it up later). In a tight loop, timers accumulate.

Fix: use `time.NewTicker` once.
```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        check(path)
    }
}
```

Or, on Go 1.23+, `time.After` no longer leaks the timer until it fires, but for older Go versions, `NewTicker` is the safe choice.

---

## Hard

### Bug 13 — The Phantom Wait

```go
type Worker struct {
    wg sync.WaitGroup
}

func (w *Worker) Start(ctx context.Context) {
    go func() {
        w.wg.Add(1)
        defer w.wg.Done()
        work(ctx)
    }()
}

func (w *Worker) Wait() {
    w.wg.Wait()
}
```

**Observation.** `Wait` sometimes returns immediately, even though `work` is still running.

**Find the bug.**

---

**Answer.** `wg.Add(1)` happens inside the goroutine. If the caller calls `Wait` before the goroutine gets scheduled, the counter is still 0 and `Wait` returns immediately.

Fix: `Add` before `go`:
```go
func (w *Worker) Start(ctx context.Context) {
    w.wg.Add(1)
    go func() {
        defer w.wg.Done()
        work(ctx)
    }()
}
```

---

### Bug 14 — The Recursive Spawn

```go
func crawl(ctx context.Context, url string) {
    links := fetchLinks(ctx, url)
    for _, link := range links {
        go crawl(ctx, link)
    }
}
```

**Observation.** Memory climbs without bound. The crawler eventually gets OOM-killed.

**Find the bug.**

---

**Answer.** Unbounded recursion via `go`. Each call spawns more goroutines than it has fanned in. No `WaitGroup`, no bound on concurrency, no cycle detection.

Fix: use `errgroup` with `SetLimit`, or a worker pool. And use a `sync.Map` (or visited set with a mutex) to dedupe URLs.

```go
func crawl(ctx context.Context, root string, maxConcurrency int) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(maxConcurrency)
    var visited sync.Map
    var doCrawl func(url string)
    doCrawl = func(url string) {
        if _, loaded := visited.LoadOrStore(url, struct{}{}); loaded {
            return
        }
        g.Go(func() error {
            links, err := fetchLinks(ctx, url)
            if err != nil {
                return err
            }
            for _, l := range links {
                doCrawl(l)
            }
            return nil
        })
    }
    doCrawl(root)
    return g.Wait()
}
```

(There's still a subtle issue with `g.Go` being called from inside `g.Go`, but it works as long as `SetLimit` is large enough to avoid deadlock; for production, use a separate work queue.)

---

### Bug 15 — The Two-Owner Tangle

```go
type Manager struct {
    workers []*Worker
}

func (m *Manager) Close() {
    for _, w := range m.workers {
        w.Stop()
    }
}

type Worker struct {
    cancel context.CancelFunc
    parent *Manager
}

func (w *Worker) onFailure() {
    w.parent.Close() // BUG
}

func (w *Worker) Stop() {
    w.cancel()
}
```

**Observation.** On a worker failure, `parent.Close` is called, which iterates and calls `Stop` on every worker — including the one that triggered the failure. Then the manager's caller also calls `Close`. Double-stop, sometimes deadlock, sometimes panic.

**Find the bug.**

---

**Answer.** Two owners. The worker thinks it owns the right to stop the manager; the manager's external caller also owns the manager. They race.

Fix: workers do not stop their parent. Instead, they report failure (via an error channel or callback) and the manager's owning goroutine decides what to do. The hierarchy must be strictly downward: parents stop children, never the other way.

---

### Bug 16 — The Lazy Singleton

```go
var (
    singletonOnce sync.Once
    singleton     *Service
)

func GetService() *Service {
    singletonOnce.Do(func() {
        ctx, cancel := context.WithCancel(context.Background())
        singleton = &Service{cancel: cancel}
        go singleton.run(ctx)
    })
    return singleton
}
```

**Observation.** The singleton's goroutine starts on first call, but there is no path to stop it. Process shutdown kills it mid-flight without cleanup.

**Find the bug.**

---

**Answer.** The singleton has a `cancel` but no public `Close`. Worse, the implicit context root is `Background()`, so there is no upstream to cancel it.

Fix: replace the singleton with an explicit lifecycle. Construct in `main`, pass through dependency injection, `defer service.Close()` in `main`.

If a singleton must exist (e.g., to avoid threading through every function), expose a `Close` and ensure something calls it (signal handler, `defer` in `main`).

---

### Bug 17 — The Errgroup Trap

```go
func doAll(ctx context.Context, items []Item) error {
    g := errgroup.Group{}
    for _, item := range items {
        item := item
        g.Go(func() error {
            return process(ctx, item)
        })
    }
    return g.Wait()
}
```

**Observation.** When `process` for item 5 fails, items 6–N keep running. No cancellation.

**Find the bug.**

---

**Answer.** `errgroup.Group{}` does not derive a context. Use `errgroup.WithContext(ctx)`:

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

The derived `ctx` is cancelled on first error, signalling siblings.

---

### Bug 18 — The Forgotten Drain

```go
type Logger struct {
    in     chan string
    cancel context.CancelFunc
}

func (l *Logger) Submit(msg string) {
    l.in <- msg
}

func (l *Logger) Close() {
    l.cancel()
}
```

**Observation.** On shutdown, pending messages in `l.in` are dropped. Audit log misses entries.

**Find the bug.**

---

**Answer.** Cancellation aborts work in progress; it does not drain. For lossy work this is fine; for audit logs it is a data loss bug.

Fix:
```go
func (l *Logger) Close() error {
    close(l.in)             // tell drain loop "no more"
    <-l.done                // wait for drain to finish
    return nil
}

// In the goroutine:
for msg := range l.in {
    write(msg)
}
close(l.done)
```

Note we no longer use cancellation for the normal shutdown path. The choice depends on the durability requirement. For best-of-both, drain *and* respect a timeout via context.

---

### Bug 19 — The Slow Reader

```go
func startTailer(ctx context.Context, path string) {
    f, _ := os.Open(path)
    go func() {
        defer f.Close()
        buf := make([]byte, 4096)
        for {
            select {
            case <-ctx.Done():
                return
            default:
            }
            n, err := f.Read(buf)
            if err != nil {
                return
            }
            process(buf[:n])
        }
    }()
}
```

**Observation.** When `f.Read` is blocked (a pipe with no data), the goroutine ignores cancellation indefinitely.

**Find the bug.**

---

**Answer.** A blocking syscall (`read`) does not see `ctx.Done()`. The polling `select` runs only between reads. If a read blocks, cancellation is ignored.

Fix (for sockets/pipes): use `SetReadDeadline` to interrupt the read:
```go
f.SetReadDeadline(time.Now())
```

Wire `Close` to call `SetReadDeadline` after cancelling the context. This is exactly the pattern senior.md describes for connection-owning structs.

---

### Bug 20 — The Hidden Goroutine

```go
type HTTPClient struct {
    cli *http.Client
}

func New() *HTTPClient {
    return &HTTPClient{
        cli: &http.Client{
            Transport: &http.Transport{},
        },
    }
}

func (c *HTTPClient) Do(req *http.Request) (*http.Response, error) {
    return c.cli.Do(req)
}
```

**Observation.** Tests pass goleak normally, but a hard-reload test (creating and discarding many `HTTPClient` instances) leaks goroutines.

**Find the bug.**

---

**Answer.** `http.Transport` owns connection-pool goroutines (keep-alive readers). Discarding a `Transport` without calling `CloseIdleConnections` leaves them parked.

Fix:
```go
func (c *HTTPClient) Close() {
    c.cli.CloseIdleConnections()
}
```

Better: share one `Transport` across the application; don't make new ones per `HTTPClient`.

---

### Bug 21 — The Select Without a Cancel

```go
func consumer(ctx context.Context, ch chan Job) {
    for j := range ch {
        if err := process(j); err != nil {
            log.Println(err)
        }
    }
}
```

**Observation.** If `ch` is never closed (e.g., the producer panics), the consumer blocks on receive forever.

**Find the bug.**

---

**Answer.** No cancellation case. The `for range` waits on the channel and ignores the context.

Fix:
```go
for {
    select {
    case <-ctx.Done():
        return
    case j, ok := <-ch:
        if !ok {
            return
        }
        if err := process(j); err != nil {
            log.Println(err)
        }
    }
}
```

---

### Bug 22 — The Misordered Shutdown

```go
func main() {
    db := NewDB()
    cache := NewCache(db)
    api := NewAPI(cache)

    defer db.Close()
    defer cache.Close()
    defer api.Close()

    api.Serve()
}
```

**Observation.** On exit, `db.Close()` runs *first* (LIFO defer), then `cache.Close()`, then `api.Close()`. In-flight API requests query the cache, which queries the closed DB. Panics.

**Find the bug.**

---

**Answer.** `defer` runs in LIFO order, so the *first* defer runs *last*. But here the intent was the opposite. Reverse:

```go
defer api.Close()    // close first on exit
defer cache.Close()  // then
defer db.Close()     // db last
```

LIFO defers actually make the reverse-construction order natural — if you defer in construction order, you get the right shutdown order. The bug was reading the defers wrong.

---

### Bug 23 — The Goroutine That Outlives Its Test

```go
func TestProcess(t *testing.T) {
    ctx, _ := context.WithCancel(context.Background())
    go process(ctx)
    // ... test assertions ...
}
```

**Observation.** Test passes. The next test starts and sometimes fails because of stale state from the previous test's goroutine.

**Find the bug.**

---

**Answer.** Missing `cancel` (assigned to `_`), so the goroutine never receives cancellation. It outlives the test.

Fix:
```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
go process(ctx)
```

Add `goleak.VerifyNone(t)` or `goleak.VerifyTestMain(m)` to catch this kind of bug automatically.

---

### Bug 24 — The Cancel That Doesn't Wait

```go
type Service struct {
    cancel context.CancelFunc
}

func (s *Service) Stop() {
    s.cancel()
}
```

**Observation.** Tests pass goleak intermittently. Production shutdowns sometimes drop the last few requests.

**Find the bug.**

---

**Answer.** `Stop` signals but does not wait. The goroutine may still be running when `Stop` returns and the caller proceeds.

Fix: add a wait mechanism (a `done` channel or `WaitGroup`):
```go
type Service struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func (s *Service) Stop() {
    s.cancel()
    <-s.done
}
```

---

### Bug 25 — The Goroutine in the Constructor

```go
func NewProcessor() *Processor {
    p := &Processor{in: make(chan Job)}
    go p.run()
    return p
}
```

**Observation.** No way to stop. No context. No `Close` method. Every `NewProcessor` call leaks a goroutine for life.

**Find the bug.**

---

**Answer.** The library-design rule from senior.md: every type that spawns a goroutine in its constructor exposes a `Close`. This type violates it on every count.

Fix: senior pattern.
```go
type Processor struct {
    cancel context.CancelFunc
    done   chan struct{}
    in     chan Job
}

func NewProcessor(ctx context.Context) *Processor {
    ctx, cancel := context.WithCancel(ctx)
    p := &Processor{cancel: cancel, done: make(chan struct{}), in: make(chan Job)}
    go func() {
        defer close(p.done)
        p.run(ctx)
    }()
    return p
}

func (p *Processor) Close() error {
    p.cancel()
    <-p.done
    return nil
}
```

---

## Summary Table

| # | Pattern | Fix |
|---|---------|-----|
| 1 | Ticker without stop | `defer t.Stop()`, struct ownership |
| 2 | Forgotten cancel | `defer cancel()` |
| 3 | Severed context | Pass `ctx` through every layer |
| 4 | Stored ctx in struct | Pass `ctx` per call |
| 5 | Buffer too small | `len(items)` or use `errgroup` |
| 6 | Sleep ignoring cancel | `select` with `time.After` or ticker |
| 7 | Non-unique closer | One sender, one close; or `sync.Once` |
| 8 | Mutex around channel | Release mutex before send |
| 9 | Shutdown ctx already cancelled | Fresh `WithTimeout(Background, ...)` |
| 10 | Submit after close | Select on closed channel + ctx.Done |
| 11 | Fire-and-forget logging | Queue with owned worker |
| 12 | `time.After` in loop | `time.NewTicker` once |
| 13 | `wg.Add` after `go` | Add before `go` |
| 14 | Recursive go spawn | Bounded concurrency, dedupe |
| 15 | Two owners | One owner, downward stop only |
| 16 | Lazy singleton no close | Explicit lifecycle in `main` |
| 17 | Bare errgroup | `errgroup.WithContext` |
| 18 | Cancellation drops data | Drain (close + wait) |
| 19 | Blocking syscall | `SetReadDeadline` |
| 20 | Discarded transport | `CloseIdleConnections` |
| 21 | `for range` without cancel | `select` with `ctx.Done` |
| 22 | Wrong defer order | Construction-order defers |
| 23 | Discarded cancel | Always defer cancel |
| 24 | Stop without wait | Wait on `done`/`WaitGroup` |
| 25 | Constructor with no close | Senior library pattern |

Every bug here is one of the patterns from junior.md, middle.md, or senior.md applied wrong. The skill is reading code with these patterns in mind and seeing where they're missing.
