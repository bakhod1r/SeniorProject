# Goroutine Common Pitfalls — Middle Level

> Focus: how these pitfalls actually surface in real codebases. HTTP handlers, worker pools, errgroup misuse, context propagation, shutdown sequences, and observability for the failure modes.

## Table of Contents
1. [From snippets to systems](#from-snippets-to-systems)
2. [HTTP handlers and request lifetime](#http-handlers-and-request-lifetime)
3. [Worker pools and queues](#worker-pools-and-queues)
4. [`errgroup` misuse](#errgroup-misuse)
5. [Context propagation pitfalls](#context-propagation-pitfalls)
6. [Shutdown and draining](#shutdown-and-draining)
7. [WaitGroup at scale](#waitgroup-at-scale)
8. [Pitfalls in synchronisation primitives](#pitfalls-in-synchronisation-primitives)
9. [Pitfalls that hide in libraries](#pitfalls-that-hide-in-libraries)
10. [Observability for pitfalls](#observability-for-pitfalls)
11. [Refactoring checklist](#refactoring-checklist)
12. [Summary](#summary)

---

## From snippets to systems

The junior file taught the *shapes*. This file shows where the shapes hide in production-grade code.

In a 50-line example, a captured loop variable jumps out. In a 5000-line service, the same bug lurks inside a private helper that takes an `[]Item` and "fans out" — and the closure that captures the loop variable is three function calls below where the loop sits. The patterns are identical; the visibility is not.

The middle level is about *systems-level recognition*. You will see how:

- A pitfall that looks harmless in a unit test becomes a memory leak in a request handler.
- A pitfall that passes `-race` becomes a silent corruption under specific scheduling.
- A pitfall in a third-party library quietly drags your service down.
- A pitfall in shutdown code costs you data on every deploy.

---

## HTTP handlers and request lifetime

The HTTP server is the most common place these bugs surface.

### Pitfall: spawning a goroutine that outlives the request

```go
func (s *Service) Handle(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)

    go func() {
        // analytics: takes ~2s, we don't want to make the user wait
        s.recordAnalytics(body)
    }()

    w.WriteHeader(http.StatusAccepted)
}
```

**Failure modes.**

1. The goroutine holds `body` (and `s`, and any closure captures) until `recordAnalytics` returns. Under 10 000 RPS, this is 20 000 in-flight goroutines, each holding the body — often megabytes per request.
2. The `r.Body` reader's internal buffers belong to the HTTP server. The server expects you to be done with them when `Handle` returns. If the analytics goroutine reads from `r.Body` directly (not from the pre-read `body` copy), the server may have already recycled the buffer.
3. On shutdown, the server's `Shutdown` waits only for `Handle` to return — the analytics goroutine continues, possibly past process exit.

**Fix.**

```go
func (s *Service) Handle(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)

    select {
    case s.analyticsQueue <- body:
    default:
        // queue full; drop or log
    }

    w.WriteHeader(http.StatusAccepted)
}
```

A bounded worker pool drains `analyticsQueue`. The pool's goroutines are owned by the service, not the request. On shutdown, the pool is closed and waited on.

### Pitfall: handler captures the request context, then doesn't honour cancellation

```go
func (s *Service) Handle(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    go func() {
        // The handler might return long before this finishes.
        // ctx is the request's ctx — cancelled when the client disconnects.
        result := s.slowQuery(context.Background(), someArg)
        _ = result
    }()
    w.WriteHeader(http.StatusOK)
}
```

Notice `context.Background()` inside. The author "decoupled" from the request context — which means the goroutine *cannot be cancelled* when the client disconnects. Combined with the outlives-request pattern above, this is a memory leak per request.

**Fix.** If the work is request-scoped, honour `r.Context()`. If it is service-scoped, use a service-level context that is cancelled on shutdown.

### Pitfall: `r.Context()` propagated to a goroutine that runs concurrently with response write

```go
func (s *Service) Handle(w http.ResponseWriter, r *http.Request) {
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        s.writeHeaders(r.Context(), w)
    }()
    go func() {
        defer wg.Done()
        s.writeBody(r.Context(), w)
    }()
    wg.Wait()
}
```

`http.ResponseWriter` is not safe for concurrent use. Two goroutines writing to it is a race. The race detector may not catch it (the writes might never overlap in tests). In production you see truncated responses.

**Fix.** Serial writes from the handler goroutine. Or use a single goroutine that assembles the response in memory, then writes once.

---

## Worker pools and queues

Worker pools are the standard answer to "do these N things concurrently with bounded concurrency." They also harbour their own pitfalls.

### Pitfall: closing the input channel from the wrong place

```go
jobs := make(chan Job)
var wg sync.WaitGroup

for i := 0; i < 8; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            process(j)
        }
    }()
}

for _, j := range allJobs {
    jobs <- j
    if j.Final {
        close(jobs)         // BUG: closing mid-iteration
    }
}
wg.Wait()
```

If `j.Final` happens mid-loop, the next `jobs <- j` panics with `send on closed channel`. The producer is sending after closing.

**Fix.** Close *after* the producer loop completes.

```go
for _, j := range allJobs {
    jobs <- j
}
close(jobs)
wg.Wait()
```

### Pitfall: workers that exit on first error leave the channel undrained

```go
for i := 0; i < 8; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            if err := process(j); err != nil {
                errCh <- err
                return              // BUG: exits the for-range
            }
        }
    }()
}
```

If one worker fails and returns, the remaining workers still process. But if *all* workers fail and return, no one drains `jobs`. The producer blocks forever on the next send.

**Fix patterns.**

- Use `errgroup` with a cancelled context: workers check `ctx.Done()` and exit cleanly; the producer also checks `ctx.Done()`.
- Or have workers continue past errors (record them and keep draining), then aggregate.

### Pitfall: unbounded queue masquerades as bounded

```go
jobs := make(chan Job, 1_000_000)
```

Setting a huge buffer size is "not bounded" for practical purposes. Memory grows as the buffer fills. The original goal of bounded concurrency — to bound *memory* — is lost.

**Fix.** Pick a buffer size on the order of `workers * 2` to `workers * 10`. The buffer absorbs short bursts, not unlimited input.

### Pitfall: spawning a goroutine per item to "drain a queue faster"

```go
for j := range jobs {
    go process(j)               // BUG: unbounded fan-out
}
```

Defeats the worker-pool pattern. Now there is one goroutine per job, with no upper bound. Under bursty load, memory explodes.

**Fix.** A fixed pool of workers reading from `jobs`. The bound is the worker count.

---

## `errgroup` misuse

`errgroup.Group` is a common upgrade from raw `WaitGroup` for parallel tasks with error propagation. Its API is small but easy to misuse.

### Pitfall: capturing the loop variable in `g.Go`

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(parent)
for _, url := range urls {
    g.Go(func() error {
        return fetch(ctx, url)      // BUG (pre-1.22): captured url
    })
}
if err := g.Wait(); err != nil { ... }
```

Same family as the loop-variable bug. The fix is either Go 1.22+, or:

```go
for _, url := range urls {
    url := url
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
```

### Pitfall: `errgroup` tasks ignore `ctx.Done()`

```go
g, ctx := errgroup.WithContext(parent)
for _, url := range urls {
    url := url
    g.Go(func() error {
        return slowFetchIgnoringContext(url)        // BUG: ignores ctx
    })
}
```

`errgroup.WithContext` cancels the context on first error. If your tasks ignore the context, they keep running after a peer failed. The expected "fail fast" behaviour is lost.

**Fix.** Always thread `ctx` into the goroutine body and respect it in `Select`, HTTP requests, DB calls.

### Pitfall: calling `g.Go` after `g.Wait`

```go
g, _ := errgroup.WithContext(parent)
g.Go(task1)
g.Wait()
g.Go(task2)                     // BUG: undefined behaviour
g.Wait()
```

`errgroup.Group` is not reusable. After `Wait`, the group is "done." Subsequent `Go` calls behave unpredictably. Use a new group per batch.

### Pitfall: forgetting that `g.Wait` returns only the *first* error

```go
err := g.Wait()
log.Printf("error: %v", err)
```

If 10 tasks failed, you see one error. The others are discarded. If you need all errors, collect them yourself with a `sync.Mutex` and a slice, or use `errors.Join`.

### Pitfall: `SetLimit` race with `g.Go`

`Group.SetLimit(n)` in Go 1.20+ bounds concurrency. Calling `SetLimit` after any `Go` is a race. Call it once, before any `Go`.

---

## Context propagation pitfalls

`context.Context` is the standard cancellation channel. Misusing it is a category of pitfall on its own.

### Pitfall: forgetting `defer cancel()`

```go
ctx, _ := context.WithTimeout(parent, 5*time.Second)
result := doWork(ctx)
return result
```

The timer's child context stays alive until the deadline. With 1000 such calls per second, the runtime tracks 5000 dead contexts continuously. `go vet` warns: "the cancel function returned by context.WithTimeout should be called, not discarded."

### Pitfall: storing a context in a struct

```go
type Service struct {
    ctx context.Context
}

func (s *Service) Do() { ... use s.ctx ... }
```

Discouraged by the `context` package documentation: "Do not store Contexts inside a struct type; instead, pass a Context explicitly to each function that needs it." Storing freezes the context's lifetime to the struct's lifetime, which is usually wrong.

**Exception.** Some long-lived structs (e.g., a `Server` with a "service context") do hold a context. The pattern is fine *if* the context's lifetime really matches the struct's lifetime. Make it explicit in the type name (`srvCtx`).

### Pitfall: passing `context.Background()` deep inside a request path

```go
func (s *Service) Handle(w http.ResponseWriter, r *http.Request) {
    user := s.lookupUser(context.Background(), r.FormValue("id"))   // BUG
    ...
}
```

Cancellation of the request never reaches `lookupUser`. The query runs even after the client disconnects.

**Fix.** Propagate `r.Context()` (or a wrapped one) down every call.

### Pitfall: detaching context "to keep the work alive"

```go
go s.cleanup(context.Background())       // intentionally detached
```

Now the cleanup runs forever, with no shutdown signal. Even on `s.Shutdown`, the cleanup goroutine continues. If your service is a long-running process, you also want a shutdown signal — usually a service-level context that you cancel in `Shutdown`.

```go
go s.cleanup(s.shutdownCtx)
```

---

## Shutdown and draining

Shutdown is where most goroutine pitfalls become customer-visible.

### Pitfall: not waiting for spawned goroutines

```go
func (s *Service) Shutdown() {
    s.cancel()                  // signal the context
    // forgot to wait
}
```

Goroutines that respect `ctx.Done()` *start* shutting down. But there is no guarantee they have *finished* by the time `Shutdown` returns. If `Shutdown` returns and `main` exits, in-flight work is killed.

**Fix.** Pair `cancel()` with `wg.Wait()`.

```go
func (s *Service) Shutdown() {
    s.cancel()
    s.wg.Wait()
}
```

### Pitfall: deadlock during shutdown

```go
func (s *Service) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-s.jobs:
            s.results <- s.process(j)       // BUG: blocks if results is full
        }
    }
}
```

On shutdown, the consumer of `s.results` has already exited. The send blocks. `ctx.Done()` is no help — the goroutine is in the send, not the select. Shutdown hangs.

**Fix.**

```go
case j := <-s.jobs:
    select {
    case s.results <- s.process(j):
    case <-ctx.Done():
        return
    }
```

The select ensures the send respects cancellation.

### Pitfall: closing channels too early during shutdown

```go
func (s *Service) Shutdown() {
    close(s.jobs)               // signal workers
    s.cancel()
    s.wg.Wait()
}
```

Producers may still be sending on `s.jobs` (other goroutines, request handlers). Closing while senders are active panics. The correct order:

1. Cancel the context.
2. Wait for *producers* to stop sending (typically via a separate `WaitGroup` or by waiting for the request server to drain).
3. Close `s.jobs`.
4. Wait for consumers to drain (`s.wg.Wait()`).

### Pitfall: `sync.WaitGroup` reused for "rounds"

```go
for round := 0; round < 100; round++ {
    var wg sync.WaitGroup
    wg.Add(10)
    for i := 0; i < 10; i++ {
        go func() {
            defer wg.Done()
            doRound(round, i)
        }()
    }
    wg.Wait()
}
```

This *is* correct — a fresh `WaitGroup` per round. The pitfall is when developers move the `WaitGroup` outside the loop "to save allocation" and then try to `Add` more before `Wait` has returned in all paths. Resist that "optimisation."

---

## WaitGroup at scale

### Pitfall: `wg.Add(n)` with `n` computed from a slow source

```go
items, err := loadItems()
if err != nil { return err }
wg.Add(len(items))
for _, it := range items {
    go func(it Item) {
        defer wg.Done()
        process(it)
    }(it)
}
wg.Wait()
```

This works *if* `loadItems` returns the full list. If `items` is a slow source like a channel or a paginated API, you do not know `n` upfront. Calling `wg.Add` for each item just before `go` is correct:

```go
for it := range itemsCh {
    wg.Add(1)
    go func(it Item) {
        defer wg.Done()
        process(it)
    }(it)
}
wg.Wait()
```

### Pitfall: `WaitGroup` passed by value

```go
func spawn(wg sync.WaitGroup) {      // BUG: by value
    go func() {
        defer wg.Done()
        work()
    }()
}
```

`sync.WaitGroup` contains internal state; copying it makes a separate counter. The caller's `Wait` never sees the `Done`. Bonus: `go vet` warns about "passes lock by value: sync.WaitGroup contains sync.noCopy."

**Fix.** Always pass `*sync.WaitGroup`.

---

## Pitfalls in synchronisation primitives

### Pitfall: `sync.RWMutex` upgrade

```go
mu.RLock()
v := cache[key]
mu.RUnlock()
if v == nil {
    mu.Lock()
    cache[key] = compute(key)
    mu.Unlock()
}
```

Between `RUnlock` and `Lock`, another goroutine may have populated the cache. The second compute is wasted, and if `compute` has side effects, they happen twice.

**Fix.** Double-checked locking:

```go
mu.RLock()
v, ok := cache[key]
mu.RUnlock()
if ok { return v }

mu.Lock()
defer mu.Unlock()
if v, ok := cache[key]; ok { return v }
v = compute(key)
cache[key] = v
return v
```

Or use `singleflight` to deduplicate the compute.

### Pitfall: `sync.Once` that captures state from outside

```go
var once sync.Once
var instance *Service

func Get(cfg *Config) *Service {
    once.Do(func() {
        instance = NewService(cfg)
    })
    return instance
}
```

Subtle: the *first* caller's `cfg` wins. The second caller's `cfg` is silently ignored. If `cfg` is supposed to vary, this is wrong.

**Fix.** Either accept that init takes a fixed config (load from a global), or use a per-key sync (`sync.Map` of `sync.Once`).

### Pitfall: `sync.Pool` for stateful objects

```go
var bufPool = sync.Pool{
    New: func() any { return &bytes.Buffer{} },
}

func handle() {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    // BUG: forgot buf.Reset()
    buf.WriteString("data")
    ...
}
```

`sync.Pool` does not reset objects. The next user inherits whatever the previous user left. Always `Reset` (or equivalent) on `Get`.

### Pitfall: mutexes inside structs that are returned by value

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func NewCounter() Counter { return Counter{} }  // BUG: by value
```

The caller and the function each get separate copies of the mutex. `go vet` catches this with "passes lock by value."

**Fix.** Return `*Counter`.

---

## Pitfalls that hide in libraries

### Pitfall: HTTP client without timeout

```go
client := &http.Client{}        // no timeout
resp, _ := client.Get(url)
```

`http.Client{}` has no timeout. A misbehaving server can hold the connection open forever; the goroutine making the call is stuck. Repeated calls leak goroutines.

**Fix.** Always set `Timeout` on the client, or use `http.NewRequestWithContext` with a deadline.

### Pitfall: `database/sql` without `SetMaxOpenConns`

By default, `sql.DB` has *no* connection limit. Under load, it spawns connections until the database refuses. Every connection has a goroutine on the Go side. The runtime is fine — your DB is not.

**Fix.** `db.SetMaxOpenConns(N)` with a sensible `N`.

### Pitfall: third-party libraries that spawn unbounded goroutines

A logging library that fires off a goroutine per log line. A metrics library that retries forever with no backoff. A cache library that ticks every microsecond. Audit any library that does background work on import. `go test -run=^$ -count=1 -trace=trace.out` and inspect for goroutines you did not start.

### Pitfall: `time.Tick` returns a never-stopped ticker

```go
for t := range time.Tick(time.Second) {
    doTick(t)
}
```

`time.Tick` returns a channel from a `Ticker` that *cannot be stopped*. If the loop exits, the ticker still ticks until process exit, leaking memory.

**Fix.** Use `time.NewTicker` and `defer t.Stop()`.

---

## Observability for pitfalls

You cannot fix what you cannot see.

### `runtime.NumGoroutine()` as a health metric

Expose `runtime.NumGoroutine()` as a Prometheus metric. Spike alerts on rapid growth. Track baseline over time.

```go
go func() {
    ticker := time.NewTicker(15 * time.Second)
    defer ticker.Stop()
    for range ticker.C {
        goroutineGauge.Set(float64(runtime.NumGoroutine()))
    }
}()
```

### pprof endpoints for ad-hoc inspection

```go
import _ "net/http/pprof"
go http.ListenAndServe("localhost:6060", nil)
```

Then:

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Or open `http://localhost:6060/debug/pprof/goroutine?debug=2` for a full stack-by-stack dump. Read it on suspicion of a leak; you see what each leaked goroutine is waiting on.

### `goleak` in tests

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Fails any test that ends with extra goroutines compared to its start. Catches lots of regressions before production.

### Race detector in CI

Always. `go test -race ./...` on every PR. The cost is 2-5x slower tests and 5-10x memory; the catch rate is enormous.

### Tracing

`go tool trace` with a runtime trace of a problem window shows you goroutine-by-goroutine activity. Excellent for "why is this goroutine blocked?"

---

## Refactoring checklist

When inheriting a codebase with goroutine pitfalls, walk this list:

1. Grep for `go func()` and ask the exit question for each.
2. Grep for `time.Sleep` and check if it is synchronisation.
3. Grep for `wg.Add(` and verify each is in the parent.
4. Grep for `context.With` and verify each `cancel` is deferred.
5. Grep for `close(` on channels — confirm one closer per channel.
6. Grep for `recover()` and check each is inside `defer` and at a goroutine boundary if untrusted.
7. Grep for `sync.Pool` and check `Reset` on `Get`.
8. Grep for `sync.Map` and verify the access pattern matches its strengths.
9. Grep for `http.Client{}` and verify `Timeout`.
10. Grep for `time.Tick(` — replace with `NewTicker` + `Stop`.
11. Grep for `time.After(` inside `for` or `select` loops.
12. Run `go vet` and address every warning.
13. Run `go test -race` in CI.
14. Add `goleak.VerifyTestMain` to integration tests.
15. Expose `runtime.NumGoroutine()` as a metric.

---

## Summary

At the middle level, pitfalls stop being snippets and become *patterns in systems*. The HTTP handler that fires a goroutine, the worker pool that closes its input wrong, the `errgroup` that ignores the context, the shutdown path that races on close, the `WaitGroup` passed by value — each of these is a junior pitfall scaled up. The fixes scale up too: ownership of goroutines moves from "inline" to "service-level," cancellation propagates via `context.Context`, errors aggregate through `errgroup`, observability via `pprof` and `goleak` becomes a daily reflex.

The next level pushes further: how do these pitfalls become *architectural* concerns — supervisors, leak budgets, shutdown contracts? That is the senior file.
