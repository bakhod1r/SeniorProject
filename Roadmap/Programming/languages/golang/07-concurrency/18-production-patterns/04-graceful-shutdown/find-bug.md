---
layout: default
title: Find Bug
parent: Graceful Shutdown
grand_parent: Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/find-bug/
---

# Graceful Shutdown — Find the Bug

> Each snippet contains a real shutdown bug. Find it, explain it, fix it.

---

## Bug 1 — Unbuffered signal channel

```go
func main() {
    sigCh := make(chan os.Signal)
    signal.Notify(sigCh, syscall.SIGTERM)
    <-sigCh
    srv.Shutdown(context.Background())
}
```

**Bug.** The signal channel is unbuffered. `signal.Notify` uses non-blocking sends; if the channel is full or has no receiver, the signal is dropped. If SIGTERM arrives a microsecond before `<-sigCh` is reached, the send happens, succeeds (since nobody is reading), goes to the default branch in the runtime's send `select`, and is dropped.

**Fix.** Use a buffered channel:

```go
sigCh := make(chan os.Signal, 1)
```

Or use `signal.NotifyContext`, which handles this internally:

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer stop()
<-ctx.Done()
```

---

## Bug 2 — Forgotten `signal.Stop`

```go
func runServer() error {
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM)
    // ... use sigCh ...
    return nil
}
```

**Bug.** `signal.Stop` is never called. The channel is registered with the runtime forever. If `runServer` is called many times (e.g., in tests), each call accumulates a registration. The channel cannot be garbage-collected because the runtime holds a reference. Goroutine count drifts up.

**Fix.** `defer signal.Stop(sigCh)`:

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGTERM)
defer signal.Stop(sigCh)
```

Or use `signal.NotifyContext` and `defer stop()`.

---

## Bug 3 — Unbounded `Shutdown`

```go
<-ctx.Done()
srv.Shutdown(context.Background())
```

**Bug.** `Shutdown` is called with `context.Background()`, which has no deadline. If a handler hangs forever, `Shutdown` waits forever. The process never exits cleanly; Kubernetes eventually SIGKILLs.

**Fix.** Use `context.WithTimeout`:

```go
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := srv.Shutdown(shutdownCtx); err != nil {
    _ = srv.Close()
}
```

---

## Bug 4 — Missing `errors.Is(err, http.ErrServerClosed)`

```go
go func() {
    if err := srv.ListenAndServe(); err != nil {
        log.Fatalf("server: %v", err)
    }
}()
```

**Bug.** After `Shutdown`, `ListenAndServe` returns `http.ErrServerClosed`. This is the *success* return, but `log.Fatalf` treats it as an error and exits with non-zero. Every clean shutdown produces a "fatal" log line.

**Fix.**

```go
if err := srv.ListenAndServe(); err != nil &&
    !errors.Is(err, http.ErrServerClosed) {
    log.Fatalf("server: %v", err)
}
```

---

## Bug 5 — Database closed before drain

```go
defer db.Close()
ctx, stop := signal.NotifyContext(...)
defer stop()
go srv.ListenAndServe()
<-ctx.Done()
srv.Shutdown(ctx2)
```

**Bug.** `defer db.Close()` is registered before `srv.Shutdown` runs, but defers run in LIFO order at function return. `db.Close()` is the LAST registered defer (innermost), so it runs first. But more critically: `db.Close()` runs *after* `<-ctx.Done()` returns *and* `srv.Shutdown` returns — fine? Actually no: the deferred function runs at function exit, *not* immediately. So if `main` returns AFTER `srv.Shutdown`, then defers fire in LIFO order. The order is: stop (deferred earlier) → db.Close (deferred later) ... wait, this is correct?

Actually, the bug is more subtle. If `srv.Shutdown` runs while handlers are using `db`, and any of those handlers' deferred cleanup needs `db` to be open, you might have race conditions. The cleanest order is to call `db.Close()` *after* `Shutdown` returns (explicitly, not via defer in the function), to be sure no handler is mid-query.

**Fix.**

```go
ctx, stop := signal.NotifyContext(...)
defer stop()
go srv.ListenAndServe()
<-ctx.Done()
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
_ = srv.Shutdown(shutdownCtx)
db.Close() // explicit, after Shutdown returns
```

---

## Bug 6 — `time.Sleep` in background goroutine

```go
go func() {
    for {
        doWork()
        time.Sleep(5 * time.Second)
    }
}()
```

**Bug.** `time.Sleep` is not cancellable. When shutdown begins, this goroutine sleeps for up to 5 seconds before noticing. Add to shutdown latency.

**Fix.** Use a `time.Ticker` in `select`:

```go
go func() {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-t.C: doWork()
        }
    }
}()
```

---

## Bug 7 — Closing channel from multiple goroutines

```go
func worker(jobs <-chan Job, done chan<- struct{}) {
    defer close(done) // BUG
    for j := range jobs {
        process(j)
    }
}

// caller spawns 10 workers, each closing done
```

**Bug.** Each of the 10 workers tries to close `done`. The second close panics: "close of closed channel."

**Fix.** Use a `sync.WaitGroup`:

```go
var wg sync.WaitGroup
wg.Add(10)
done := make(chan struct{})
for i := 0; i < 10; i++ {
    go func() {
        defer wg.Done()
        for j := range jobs { process(j) }
    }()
}
go func() { wg.Wait(); close(done) }()
```

Now exactly one goroutine closes `done`.

---

## Bug 8 — `defer cancel()` in a loop

```go
for _, x := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel()
    do(ctx, x)
}
```

**Bug.** `defer cancel()` registers a defer for each iteration. The defers accumulate; they all run at function return. If `items` has 10,000 elements, 10,000 contexts are leaked until function exit.

**Fix.** Call `cancel()` explicitly per iteration:

```go
for _, x := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    do(ctx, x)
    cancel()
}
```

Or wrap in a helper function:

```go
for _, x := range items {
    func() {
        ctx, cancel := context.WithTimeout(parent, time.Second)
        defer cancel()
        do(ctx, x)
    }()
}
```

---

## Bug 9 — `os.Exit` inside a handler

```go
mux.HandleFunc("/critical", func(w http.ResponseWriter, r *http.Request) {
    if err := doCriticalThing(); err != nil {
        log.Printf("critical: %v", err)
        os.Exit(1) // BUG
    }
})
```

**Bug.** `os.Exit` skips all deferred functions in all goroutines. Active requests are dropped. The DB is closed without its defer. No shutdown logs. Disaster.

**Fix.** Return an error from the handler:

```go
mux.HandleFunc("/critical", func(w http.ResponseWriter, r *http.Request) {
    if err := doCriticalThing(); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
})
```

If you really need to terminate the process on a specific error, signal `main` via a channel:

```go
fatalCh <- err
```

And `main` reads from `fatalCh`, then triggers shutdown normally.

---

## Bug 10 — Subscribing to signals in a goroutine separate from main

```go
func main() {
    go func() {
        sigCh := make(chan os.Signal, 1)
        signal.Notify(sigCh, syscall.SIGTERM)
        <-sigCh
        shutdown()
    }()
    go srv.ListenAndServe()
    select {} // block forever
}
```

**Bug.** The signal handler is in a separate goroutine from `main`. If the shutdown goroutine completes and returns, the program is still in `select {}`. Worse: there's no synchronisation between shutdown completion and program exit. The `shutdown()` may not finish before `os.Exit` (which doesn't happen in `select{}`).

The more common form: `main` itself doesn't observe shutdown, just blocks. The pattern only works by accident.

**Fix.** Subscribe in main:

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
    defer stop()
    go srv.ListenAndServe()
    <-ctx.Done()
    shutdown()
}
```

---

## Bug 11 — Hijacked connection not tracked

```go
mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
    h, _ := w.(http.Hijacker).Hijack()
    go handleWS(h)
})
```

**Bug.** The hijacked connection is not in `http.Server.activeConn` anymore. `Shutdown` doesn't track it. The connection persists past `Shutdown`'s return. The process exits with the connection still open at the socket level — client sees RST.

**Fix.** Maintain a registry of active WebSockets. Register an `OnShutdown` callback that drains them.

```go
srv.RegisterOnShutdown(func() {
    wsRegistry.DrainAll(context.Background())
})
```

---

## Bug 12 — Sentry not flushed

```go
sentry.Init(sentry.ClientOptions{...})
// ... main work ...
// at end of main, just return
```

**Bug.** Sentry buffers events asynchronously. On clean exit, the last few events (including any final errors) are in the buffer, never sent. They are lost when the process exits.

**Fix.**

```go
defer sentry.Flush(2 * time.Second)
```

The defer runs before `main` returns, flushing the buffer.

---

## Bug 13 — `Shutdown` called twice

```go
go func() {
    <-ctx.Done()
    srv.Shutdown(shutdownCtx)
}()

// elsewhere
adminMux.HandleFunc("/admin/shutdown", func(w http.ResponseWriter, _ *http.Request) {
    srv.Shutdown(shutdownCtx)
})
```

**Bug.** Two paths call `Shutdown`. If both run simultaneously, the second returns `http.ErrServerClosed`. Generally safe but unexpected.

More subtle: if the admin endpoint triggers shutdown, but main's signal handler is also active, both paths race. Logs become confusing.

**Fix.** Centralise. Have the admin endpoint signal via a channel; main observes the channel; main calls `Shutdown` once.

```go
adminMux.HandleFunc("/admin/shutdown", func(w http.ResponseWriter, _ *http.Request) {
    select {
    case shutdownTrigger <- struct{}{}:
    default:
    }
})

// in main:
select {
case <-ctx.Done(): // signal
case <-shutdownTrigger: // admin
}
srv.Shutdown(shutdownCtx)
```

---

## Bug 14 — Wrong context passed to `Shutdown`

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer stop()
<-ctx.Done()
srv.Shutdown(ctx) // BUG: ctx is already cancelled
```

**Bug.** `ctx` is cancelled when the signal arrives. Passing it to `Shutdown` causes `Shutdown` to return immediately with `context.Canceled` — no drain happens.

**Fix.** Use a fresh context with timeout:

```go
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx)
```

The parent must be `context.Background()`, NOT the cancelled signal context.

---

## Bug 15 — PID 1 is a shell

```dockerfile
CMD ["sh", "-c", "/app/server"]
```

**Bug.** The shell is PID 1 in the container. SIGTERM goes to the shell. The shell does NOT forward to the Go binary (default behaviour). After `terminationGracePeriodSeconds`, SIGKILL lands on the shell, which dies, taking the Go binary with it. The Go binary never runs graceful shutdown.

**Fix.**

```dockerfile
ENTRYPOINT ["/app/server"]
```

Now the Go binary is PID 1. SIGTERM goes directly to it.

Or, if log redirection is needed:

```dockerfile
ENTRYPOINT ["/sbin/tini", "--", "/app/server"]
```

Tini forwards signals to its children.

---

## Bug 16 — Liveness probe fails during shutdown

```go
mux.HandleFunc("/livez", func(w http.ResponseWriter, _ *http.Request) {
    if !ready.Load() {
        http.Error(w, "draining", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})
```

**Bug.** Liveness should remain 200 during shutdown. Failing it causes kubelet to *restart* the container — interrupting the graceful shutdown.

**Fix.** Liveness stays 200 unconditionally (or based on other criteria like "DB is reachable"). Readiness is the one that flips to 503 during shutdown.

```go
mux.HandleFunc("/livez", func(w http.ResponseWriter, _ *http.Request) {
    w.WriteHeader(http.StatusOK)
})
mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
    if !ready.Load() {
        http.Error(w, "draining", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})
```

---

## Bug 17 — Background goroutine outlives main

```go
func main() {
    go runLogger() // never returns
    runServer()
}
```

**Bug.** Even if `runServer` returns cleanly, `runLogger` is still running. If `main` returns, the program exits, but `runLogger`'s deferred cleanup never runs (because main's exit kills all goroutines).

The bug is conceptual: the logger goroutine has no shutdown awareness.

**Fix.** Coordinate via `errgroup` or `WaitGroup`. Each goroutine accepts a context.

```go
g, gctx := errgroup.WithContext(rootCtx)
g.Go(func() error { return runLogger(gctx) })
g.Go(func() error { return runServer(gctx) })
return g.Wait()
```

---

## Bug 18 — Worker doesn't return on context cancel

```go
func runWorker(ctx context.Context, in <-chan Job) {
    for {
        select {
        case job := <-in:
            process(job)
        }
    }
}
```

**Bug.** No `<-ctx.Done()` case. The worker loops forever waiting on `in`. If `in` is never closed and the context is cancelled, the worker doesn't exit.

**Fix.** Add the case:

```go
for {
    select {
    case <-ctx.Done():
        return
    case job := <-in:
        process(job)
    }
}
```

Or close `in` when shutdown begins and use `range`:

```go
for job := range in {
    process(job)
}
```

The closer of `in` decides.

---

## Bug 19 — `runtime.Goexit` in deferred function

```go
defer func() {
    if shouldExit() {
        runtime.Goexit() // BUG
    }
}()
```

**Bug.** `runtime.Goexit()` from a deferred function is suspicious. It terminates the goroutine, running any remaining defers... but if there are other defers in the function, they run, possibly in unexpected order. And other goroutines are unaffected — the program continues running, just with one less goroutine.

In `main`'s defer, `runtime.Goexit` doesn't exit the program. Confusing.

**Fix.** Don't use `Goexit` in shutdown code. Return errors and let `main` exit normally.

---

## Bug 20 — Concurrent map access in shutdown

```go
type WSReg struct {
    conns map[*Conn]bool
}

func (r *WSReg) Add(c *Conn) { r.conns[c] = true }
func (r *WSReg) Remove(c *Conn) { delete(r.conns, c) }
func (r *WSReg) Close() {
    for c := range r.conns {
        c.Close()
    }
}
```

**Bug.** No mutex. Concurrent access from `Add`, `Remove`, and `Close` causes "concurrent map writes" panics.

**Fix.** Add a `sync.Mutex`:

```go
type WSReg struct {
    mu    sync.Mutex
    conns map[*Conn]bool
}

func (r *WSReg) Add(c *Conn) {
    r.mu.Lock(); defer r.mu.Unlock()
    r.conns[c] = true
}
// ... similar for others ...
```

---

## Final Notes

Each bug above is a real-world pattern. A senior engineer should recognise each within 30 seconds of seeing it.

Practice: cover the explanation, read each snippet, find the bug, then check against the answer.
