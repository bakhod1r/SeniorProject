---
layout: default
title: Middle
parent: Graceful Shutdown
grand_parent: Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/middle/
---

# Graceful Shutdown — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Beyond One Server: Multiple Subsystems](#beyond-one-server-multiple-subsystems)
3. [Context Cancellation Propagation](#context-cancellation-propagation)
4. [Dependency Shutdown Order](#dependency-shutdown-order)
5. [Time Budgets and Sub-Deadlines](#time-budgets-and-sub-deadlines)
6. [`errgroup` for Coordinated Lifetime](#errgroup-for-coordinated-lifetime)
7. [Draining the HTTP Server in Detail](#draining-the-http-server-in-detail)
8. [Draining the gRPC Server](#draining-the-grpc-server)
9. [Draining Workers and Queues](#draining-workers-and-queues)
10. [Draining Outbound Connections](#draining-outbound-connections)
11. [Kubernetes Cooperation: preStop and Readiness](#kubernetes-cooperation-prestop-and-readiness)
12. [Observability of Shutdown](#observability-of-shutdown)
13. [Real-World Patterns](#real-world-patterns)
14. [Anti-Patterns](#anti-patterns)
15. [Testing the Shutdown Path](#testing-the-shutdown-path)
16. [Code Recipes](#code-recipes)
17. [Pitfalls](#pitfalls)
18. [Self-Assessment](#self-assessment)
19. [Summary](#summary)

---

## Introduction

The junior file covered one server, one signal, one `Shutdown` call. Real services are messier: an HTTP API plus a gRPC server plus three workers plus a Redis client plus a database pool plus a Kafka consumer plus a metrics exporter. Shutting all of them down correctly — in the right order, within a fixed time budget, while still respecting backpressure and not dropping in-flight work — is the difference between a junior and a mid-level service.

This file teaches:

- How to coordinate the lifetimes of many subsystems with `golang.org/x/sync/errgroup`.
- How to think about *dependency order* when shutting down: who depends on whom, and what closes first.
- How to budget your shutdown time across phases: drain, flush, close.
- How to cooperate with Kubernetes: `preStop` hooks, readiness probes, and the relationship between `terminationGracePeriodSeconds` and your code's deadline.
- How to observe shutdown: metrics, logs, traces that diagnose slow drains.
- A library of concrete recipes you can drop into a real service.

The patterns shift from "type these lines into `main`" (junior) to "design the lifecycle of a service composed of many parts" (middle). Senior-level architecture and runtime internals come later.

---

## Beyond One Server: Multiple Subsystems

A realistic Go service is not a single `*http.Server`. The shape is more like:

```
Service
├── HTTP API (8080)
├── gRPC API (9090)
├── Metrics server (9091)
├── Background workers (queue consumer, cron, refresher)
├── Database pool
├── Redis client
├── Message broker producer/consumer
├── Tracing exporter
└── Log writer
```

Each is its own lifetime, each has its own "stop" semantics, each contributes to the total shutdown latency. The job of the lifecycle layer is to compose them.

The naive composition spawns each in a goroutine, signals shutdown by cancelling a shared context, and waits for everyone to finish:

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()

var wg sync.WaitGroup
wg.Add(1); go func() { defer wg.Done(); runHTTP(ctx) }()
wg.Add(1); go func() { defer wg.Done(); runGRPC(ctx) }()
wg.Add(1); go func() { defer wg.Done(); runWorkers(ctx) }()

<-ctx.Done()

done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
case <-time.After(30 * time.Second):
    log.Println("shutdown timed out; goroutines still running")
}
```

This works for a small number of subsystems. It is the structure you graduate from. The problem is that it does not handle:

- Errors from any subsystem (panic? log? what?)
- Order (do you really want the DB closed before HTTP drains?)
- Partial failure (what if HTTP drains succeed but the queue consumer hangs?)

Each of these gets its own section below.

---

## Context Cancellation Propagation

Cancellation flows through context derivation. A child context is cancelled whenever its parent is cancelled, transitively. This means you can build a tree of contexts where cancellation at the root reaches every leaf without explicit wiring.

```go
rootCtx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()

// HTTP requests get a derived context with their own per-request timeout
httpCtx, httpCancel := context.WithCancel(rootCtx)
defer httpCancel()

// Workers get a different derived context (so we can stop them independently)
workerCtx, workerCancel := context.WithCancel(rootCtx)
defer workerCancel()
```

When `SIGTERM` arrives, `rootCtx` is cancelled. Both `httpCtx` and `workerCtx` are cancelled too. Every goroutine watching `<-X.Done()` wakes up.

The derivation tree is also how you implement *partial cancellation*. If you want to stop workers but keep the HTTP server running (a strange but legitimate scenario), call `workerCancel()`. `httpCtx` is unaffected.

### Two patterns for "request-scoped" vs "service-scoped"

A subtle point: when an HTTP handler is invoked, it gets `r.Context()` which is cancelled when the *request* is done (client disconnects, response finishes). It is NOT automatically tied to your service's `rootCtx`. If you want a handler to bail out on service shutdown, you must explicitly link them:

```go
mux.HandleFunc("/work", func(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithCancel(r.Context())
    defer cancel()
    // also watch the service-wide context
    go func() {
        select {
        case <-rootCtx.Done():
            cancel()
        case <-ctx.Done():
        }
    }()
    doWork(ctx)
})
```

This pattern shows up often enough that frameworks like chi, gin, and echo offer middlewares for it. The principle is: `r.Context()` is per-request; `rootCtx` is per-process; cancellation of either should bail the handler.

### `RegisterOnShutdown` vs propagation

`http.Server.RegisterOnShutdown(fn)` registers a callback that runs at the *start* of `Shutdown` (before draining begins). It is meant for resources that the HTTP server itself does not track — typically WebSocket connections.

```go
srv.RegisterOnShutdown(func() {
    // signal all hijacked connections to close
    websocketRegistry.CloseAll()
})
```

Note: `RegisterOnShutdown` is fire-and-forget. The server does not wait for the callback to finish before draining. If you need to wait, manage that yourself.

---

## Dependency Shutdown Order

The right rule is simple: **shut down in reverse order of startup**. The thing you opened last, you close first.

A typical startup order:

```
1. Open database
2. Open Redis
3. Open Kafka producer
4. Build HTTP handler (uses DB, Redis, Kafka)
5. Start HTTP server (uses handler)
6. Start workers (use DB, Redis, Kafka)
```

Shutdown order should be:

```
1. Stop accepting new HTTP requests (drain server)
2. Stop workers (let them finish in-flight)
3. Close Kafka producer (flush buffered messages)
4. Close Redis
5. Close database (only after no one is using it)
```

Why this order? Because each level uses the one below it. If you close the database first, in-flight HTTP handlers and workers will hit "use of closed database" errors mid-operation. If you close the listener last, you keep accepting new requests during the drain, which prolongs everything.

### Visualising it

```
startup:    listener -> workers -> kafka -> redis -> db -> serve forever
shutdown:   stop listener -> drain workers -> flush kafka -> close redis -> close db
                                   ^
                                   |
                            (clients use these)
```

The "stop listener" step is what makes the in-flight queue drain. Once no new requests arrive and the existing ones finish, the resources below can be safely closed.

### Implementing reverse-order shutdown

The simplest implementation is a stack of cleanup functions. Each opened resource pushes a `Close` onto the stack; shutdown pops them in reverse order.

```go
type Stack struct {
    fns []func(context.Context) error
}

func (s *Stack) Push(fn func(context.Context) error) {
    s.fns = append(s.fns, fn)
}

func (s *Stack) Shutdown(ctx context.Context) error {
    var errs []error
    for i := len(s.fns) - 1; i >= 0; i-- {
        if err := s.fns[i](ctx); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}
```

Usage:

```go
var stack Stack

db := openDB()
stack.Push(func(ctx context.Context) error { return db.Close() })

rdb := openRedis()
stack.Push(func(ctx context.Context) error { return rdb.Close() })

srv := buildServer()
stack.Push(func(ctx context.Context) error { return srv.Shutdown(ctx) })

go srv.ListenAndServe()
<-rootCtx.Done()

ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
_ = stack.Shutdown(ctx)
```

This pattern scales. Adding a new dependency is one `Push` line.

---

## Time Budgets and Sub-Deadlines

A 30-second total budget is one thing. Splitting it across phases is another. A typical breakdown:

| Phase | Time |
|---|---|
| readyDelay (flip to 503, wait for LB) | 3 s |
| HTTP server drain | 15 s |
| Worker drain | 5 s |
| Kafka flush | 2 s |
| Redis / DB close | 1 s |
| Margin | 4 s |

Total: 30 s. The margin is for "unexpected slowness in one step doesn't blow the budget."

Implementing this with `context.WithTimeout` per phase:

```go
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

// Phase 1: drain HTTP (max 18s, leaving 12s)
httpCtx, httpCancel := context.WithTimeout(ctx, 18*time.Second)
_ = srv.Shutdown(httpCtx)
httpCancel()

// Phase 2: drain workers (max 8s, leaving 4s)
workerCtx, workerCancel := context.WithTimeout(ctx, 8*time.Second)
_ = workers.Wait(workerCtx)
workerCancel()

// Phase 3: flush Kafka (max 3s, leaving 1s)
flushCtx, flushCancel := context.WithTimeout(ctx, 3*time.Second)
_ = producer.Flush(flushCtx)
flushCancel()

// Phase 4: close DB (best effort)
_ = db.Close()
```

Each `cancel()` is fine to call early (it just releases resources sooner). The parent `ctx` puts a hard 30s cap on everything; the per-phase contexts are softer per-phase limits.

### Why per-phase deadlines matter

If you put all your time on one phase, a single stuck dependency can eat the entire budget and leave nothing for the others. The per-phase split forces you to *think* about how long each step should take, and to fail loudly when one of them doesn't meet expectations.

```go
if errors.Is(err, context.DeadlineExceeded) {
    log.Printf("phase %s exceeded its budget", phaseName)
    metrics.PhaseTimeout.WithLabelValues(phaseName).Inc()
}
```

Now your dashboards show, over weeks, *which* phase is the slow one on which deploys. Without this, "shutdown was slow" is a useless data point.

### Adapting deadlines to environment

Local development typically wants a shorter total deadline (5 seconds, not 30) so iteration is fast. Production wants the full budget. Make the deadline configurable:

```go
type Config struct {
    ShutdownTimeout time.Duration `envconfig:"SHUTDOWN_TIMEOUT" default:"30s"`
    ReadyDelay      time.Duration `envconfig:"READY_DELAY" default:"3s"`
}
```

In tests, set `ShutdownTimeout=1s` and verify the timeout path executes (i.e., `Close` is called).

---

## `errgroup` for Coordinated Lifetime

`golang.org/x/sync/errgroup` is the Go community's de facto standard for managing groups of goroutines with shared cancellation and a single error return. For shutdown coordination, it is excellent.

```go
import "golang.org/x/sync/errgroup"

g, gctx := errgroup.WithContext(rootCtx)

g.Go(func() error {
    if err := srv.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        return err
    }
    return nil
})

g.Go(func() error {
    return runWorkers(gctx)
})

g.Go(func() error {
    <-gctx.Done()
    log.Println("group context cancelled; draining HTTP")
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
    defer cancel()
    return srv.Shutdown(shutdownCtx)
})

if err := g.Wait(); err != nil {
    log.Printf("shutdown error: %v", err)
}
```

Two things this pattern gives you:

1. **Shared cancellation.** When any goroutine returns a non-nil error, `gctx` is cancelled. Every other goroutine sees the cancellation. This handles "one subsystem crashes → all subsystems shut down" automatically.
2. **Single error.** `g.Wait()` returns the first non-nil error. Errors from later-failing goroutines are discarded (unless you log them inside the goroutine).

The "shutdown coordinator" goroutine (the third `Go` call) is a common idiom: it waits for `gctx.Done()` and then triggers the actual drain. This means `gctx` is what links the signal to the drain.

### `errgroup` with `SetLimit`

Go 1.20+ added `errgroup.Group.SetLimit(n)` which caps the number of concurrent goroutines. Useful if you have many drain steps and want to run them with bounded parallelism. Not common for top-level shutdown coordination, but handy for "fan out the drain to 100 connections, but only 10 at a time."

### `errgroup` versus `sync.WaitGroup`

- `WaitGroup` is simpler but does not propagate errors and does not auto-cancel.
- `errgroup` is the right choice when you want "all-or-nothing" coordination.
- For a small main with two or three goroutines, either works. For five or more, `errgroup` saves boilerplate.

### A complete `main` using `errgroup`

```go
func run() error {
    rootCtx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    cfg := mustLoadConfig()
    db, err := openDB(cfg)
    if err != nil {
        return err
    }
    defer db.Close()

    srv := buildServer(cfg, db)
    workers := buildWorkers(cfg, db)

    g, gctx := errgroup.WithContext(rootCtx)

    g.Go(func() error {
        if err := srv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            return fmt.Errorf("http: %w", err)
        }
        return nil
    })

    g.Go(func() error {
        return workers.Run(gctx)
    })

    g.Go(func() error {
        <-gctx.Done()
        ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
        defer cancel()
        if err := srv.Shutdown(ctx); err != nil {
            _ = srv.Close()
            return fmt.Errorf("http shutdown: %w", err)
        }
        return nil
    })

    return g.Wait()
}
```

This is the canonical mid-level shape. Memorise it.

---

## Draining the HTTP Server in Detail

`http.Server.Shutdown` is one method, but underneath it does several things. Understanding the steps helps debug "why is shutdown slow?"

### Step 1 — Set the state to `srvShuttingDown`

After this, `ListenAndServe` (if not already returned) returns `http.ErrServerClosed`. New connections after this point are rejected at the listener (because step 2 closes the listener).

### Step 2 — Close all listeners

Listeners stop accepting new connections. The OS-level `accept` returns `EINVAL` or "use of closed network connection." Existing connections are unaffected.

### Step 3 — Run `OnShutdown` callbacks

Each registered callback runs in its own goroutine. Used for resources outside the server's tracking (WebSockets, etc.).

### Step 4 — Close idle connections

A connection in keep-alive state with no active handler is closed immediately. This is what makes shutdown fast on idle servers.

### Step 5 — Poll for active connections to become idle

The server enters a loop:

```
for active connections > 0:
    if ctx.Done():
        return ctx.Err()
    sleep shutdownPollIntervalMax (500ms)
```

This is the slow part of shutdown. Each active connection counts; the loop ends when all are done or the context fires.

### Knobs you can tune

The polling interval is a constant (`shutdownPollIntervalMax` in `net/http`). You cannot change it directly. What you can change:

- `ReadTimeout` — caps how long a connection waits for the next byte. Lowering it speeds up shutdown for slow clients.
- `WriteTimeout` — caps how long a write can take. Lowering it bounds slow downloads.
- `IdleTimeout` — caps keep-alive idle time. After this, idle connections are auto-closed regardless of shutdown.
- `ReadHeaderTimeout` — caps reading the request headers.

Aggressive timeouts speed up shutdown but can also cut off legitimate slow clients. Tuning is a per-service exercise.

### What `Shutdown` does NOT do

- Does not wait for hijacked connections (WebSockets, HTTP/2 raw streams).
- Does not flush buffered logs.
- Does not close the database or other resources the handlers use.
- Does not run any user-defined cleanup beyond `OnShutdown` callbacks.
- Does not propagate to per-request contexts. A handler's `r.Context()` is NOT cancelled by `Shutdown` (this is sometimes surprising). Long-running handlers must be force-closed via `Close`, or they continue until the deadline elapses.

This last point is important. If you have a streaming handler that runs for an hour, `Shutdown` will wait for it (up to the deadline). The handler's `r.Context()` is NOT cancelled by `Shutdown` itself; it is only cancelled if `Close` is called as the fallback. If you want handlers to bail out on shutdown, link them to `rootCtx` as shown earlier.

---

## Draining the gRPC Server

`grpc.Server` has its own drain API:

```go
grpcSrv := grpc.NewServer()
// ... register services
go func() {
    if err := grpcSrv.Serve(listener); err != nil {
        log.Printf("grpc: %v", err)
    }
}()

<-rootCtx.Done()
done := make(chan struct{})
go func() { grpcSrv.GracefulStop(); close(done) }()
select {
case <-done:
case <-time.After(20 * time.Second):
    log.Println("grpc graceful stop did not complete; forcing stop")
    grpcSrv.Stop()
}
```

Key differences from `http.Server`:

- `GracefulStop()` is *synchronous* and blocks until all in-flight RPCs complete. There is *no deadline parameter*. You enforce a deadline by running it in a goroutine and racing against `time.After`.
- `Stop()` is the force-close equivalent.
- gRPC streams (server-streaming, client-streaming, bidi) count as in-flight RPCs until they close. A long-running stream prolongs shutdown until the deadline or `Stop`.
- gRPC's keep-alive and idle-timeout settings come from `grpc.KeepaliveParams` and `grpc.MaxConnectionIdle`, not from `http.Server` knobs.

The pattern is otherwise identical to HTTP: signal triggers drain, drain has a deadline, fall back to force-close on timeout.

### A combined HTTP + gRPC drain

If you run both in one process (common for serving HTTP for browsers and gRPC for services):

```go
g.Go(func() error {
    <-gctx.Done()
    ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
    defer cancel()

    eg, _ := errgroup.WithContext(ctx)
    eg.Go(func() error {
        if err := httpSrv.Shutdown(ctx); err != nil {
            _ = httpSrv.Close()
            return err
        }
        return nil
    })
    eg.Go(func() error {
        done := make(chan struct{})
        go func() { grpcSrv.GracefulStop(); close(done) }()
        select {
        case <-done:
            return nil
        case <-ctx.Done():
            grpcSrv.Stop()
            return ctx.Err()
        }
    })
    return eg.Wait()
})
```

Both shutdowns share the same context, so they share the same deadline. They run in parallel — there is no reason to drain them serially.

---

## Draining Workers and Queues

Workers — goroutines that pull from a queue and process — have a different drain shape. The two-phase model still applies, but "stop accepting" looks different.

### Pattern 1: Stop the producer

If your service produces its own work (e.g., a cron that ticks every minute and dispatches jobs to workers), the simplest drain is "stop the producer." The workers' input channel is closed; the workers `range` over it and exit naturally.

```go
func runCron(ctx context.Context, out chan<- Job) {
    defer close(out)
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            out <- buildJob()
        }
    }
}

func runWorker(in <-chan Job, results chan<- Result) {
    for j := range in {
        results <- process(j)
    }
}
```

On cancellation, `runCron` returns and closes `out`. Workers' `range` loops exit. The pipeline drains naturally.

### Pattern 2: External queue (Kafka, RabbitMQ, SQS)

When the queue lives outside the service, "stop accepting" means "stop calling Receive." The consumer loop checks the context before each `Receive`:

```go
func runConsumer(ctx context.Context, q Queue) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        msg, err := q.Receive(ctx) // pass ctx so Receive can be cancelled
        if err != nil {
            if errors.Is(err, context.Canceled) {
                return
            }
            log.Printf("receive: %v", err)
            continue
        }
        process(msg)
        if err := q.Ack(msg); err != nil {
            log.Printf("ack: %v", err)
        }
    }
}
```

The key detail: pass `ctx` to `Receive`. Most well-designed Go queue clients accept a context. If they do not (some older clients), wrap them.

### Pattern 3: In-flight message must be acked or returned

This is where queue consumers differ from HTTP. An HTTP handler that finishes "wins" — the response is sent, the request is done. A queue handler that finishes must *ack* the message (committing to "I processed this") OR *nack* it (returning it to the queue for retry).

If a worker is processing a message when shutdown begins, the choice is:

- **Finish + ack.** Continues processing until done, then acks. Pro: no duplicate work. Con: extends shutdown.
- **Stop + nack.** Releases the message back to the queue. Pro: fast shutdown. Con: another worker will reprocess (idempotency required).

The right choice depends on the cost of duplicate work vs the cost of long shutdowns. Idempotent operations usually pick "stop + nack." Non-idempotent ones pick "finish + ack."

```go
func process(ctx context.Context, msg Message) {
    workDone := make(chan struct{})
    go func() {
        defer close(workDone)
        doWork(msg)
    }()
    select {
    case <-workDone:
        ack(msg)
    case <-ctx.Done():
        if isIdempotent(msg) {
            nack(msg)
        } else {
            // wait for completion
            <-workDone
            ack(msg)
        }
    }
}
```

### Pattern 4: Worker pool with `sync.WaitGroup`

A pool of N workers consuming from a shared channel:

```go
func RunPool(ctx context.Context, n int, in <-chan Job) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-in:
                    if !ok {
                        return
                    }
                    process(ctx, j)
                }
            }
        }()
    }
    wg.Wait()
}
```

Each worker watches both `ctx.Done()` and the input channel. On shutdown, workers stop pulling new jobs. The pool's `Wait` returns when all workers have exited.

Bound this with a context in the caller:

```go
poolDone := make(chan struct{})
go func() { RunPool(ctx, 10, in); close(poolDone) }()

<-ctx.Done()
shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
select {
case <-poolDone:
    log.Println("pool drained")
case <-shutdownCtx.Done():
    log.Println("pool did not drain in time")
}
```

---

## Draining Outbound Connections

Closing inbound connections is one half of the story. Outbound — database pools, Redis clients, gRPC dial connections, HTTP clients — is the other half.

### Database pools

`database/sql.DB.Close()` is blocking: it closes idle connections and waits for in-use connections to be returned to the pool. After `Close`, all subsequent operations fail.

The order matters. Close the DB *after* the HTTP server is fully drained:

```go
_ = srv.Shutdown(ctx)
_ = db.Close()
```

Closing in the wrong order produces "sql: database is closed" errors in handlers that were still finishing up.

### Redis

`go-redis` (the most common Redis client) has `rdb.Close()` which is fire-and-forget; it does not wait for in-flight commands. Most Redis commands complete in milliseconds, so this is rarely a problem. The pattern is the same: close after the server is drained.

### gRPC client connections

`grpc.ClientConn.Close()` cancels in-flight RPCs and closes the underlying TCP connection. If you have outbound gRPC calls in flight at shutdown, they will fail. Idempotency-wrap the calls or accept the failures.

### HTTP clients

`http.Client` does not have a "close" method. Its underlying `*http.Transport` has `CloseIdleConnections()`. Idle keep-alive connections are closed; active connections continue until their handlers finish.

```go
client := &http.Client{Transport: transport}
// at shutdown:
transport.CloseIdleConnections()
```

This is rarely necessary at the application level — when the process exits, the OS closes all sockets. But for long-running tests or for memory-conscious code, it helps.

### Tracing exporters

OpenTelemetry exporters (Jaeger, OTLP) need to *flush* buffered spans on shutdown:

```go
tp := buildTracerProvider()
defer tp.Shutdown(context.Background())
```

If you skip this, the last few seconds of traces are lost. Always defer `tp.Shutdown` before returning from `main`.

---

## Kubernetes Cooperation: preStop and Readiness

Kubernetes is the dominant runtime for Go services. Its pod-termination lifecycle is intricate.

### The lifecycle, step by step

1. **kubectl delete pod / rolling update.** The API server marks the pod as Terminating.
2. **kube-proxy / Service controller** removes the pod from Service endpoints. New traffic stops.
3. **kubelet** sends the `preStop` hook (if defined) to the container.
4. **kubelet** delivers `SIGTERM` to PID 1 in the container.
5. **kubelet starts a timer** for `terminationGracePeriodSeconds` (default 30).
6. **When the timer fires**, kubelet delivers `SIGKILL`.

Step 2 and step 4 are *not* synchronised. The "remove from endpoints" propagation can take 1–5 seconds. If your code starts refusing connections immediately on SIGTERM, you have a 1–5 second window where the LB is still routing to you. The result: connection resets for those clients.

### The `preStop` solution

A `preStop` hook runs *before* SIGTERM. If you put a `sleep 5` there, you delay SIGTERM by 5 seconds — during which the endpoint removal propagates.

```yaml
spec:
  terminationGracePeriodSeconds: 35
  containers:
  - name: app
    lifecycle:
      preStop:
        exec:
          command: ["sleep", "5"]
```

`terminationGracePeriodSeconds` is the *total* budget *including* the preStop. With `preStop: sleep 5` and a 30-second drain budget, set `terminationGracePeriodSeconds: 35`.

### Doing the same in code

If you do not want a `preStop`, you can implement the equivalent in Go:

```go
// on SIGTERM:
ready.Store(false)        // /readyz returns 503
time.Sleep(readyDelay)    // wait for endpoint removal
// then start the actual drain
```

This is the `readyDelay` pattern from the junior file. It works, but `preStop` is cleaner because it puts the delay outside the application code (so a buggy application that crashes on startup still does the delay).

### Liveness vs readiness during shutdown

- **Liveness**: keep returning 200. You are alive (still serving). If you flip liveness to fail during shutdown, the kubelet may *restart* the container, which is bad.
- **Readiness**: flip to 503. You are no longer ready to serve new traffic. The kubelet removes you from Service endpoints.

This distinction is non-negotiable. A surprising amount of buggy code conflates the two.

### Common Kubernetes shutdown mistakes

- **`terminationGracePeriodSeconds` too short.** Default 30 is fine for most services. A service that needs longer should bump it explicitly.
- **`terminationGracePeriodSeconds` too long.** Some teams set 600 because "we want to be careful." This delays deploys catastrophically; rolling out 100 pods serially takes an hour.
- **No `preStop` and no `readyDelay`.** Connection resets during deploys.
- **Liveness fails during shutdown.** kubelet restarts the container mid-drain.
- **Readiness probe path is the same as the API.** Mixing readiness with regular traffic means traffic shaping is harder.

---

## Observability of Shutdown

Shutdown is a critical event. Logging and metrics for it cost almost nothing and pay off the first time you investigate a slow drain.

### Logs to emit

- "signal received" (with which signal).
- "readiness flipped to draining."
- "draining HTTP server."
- "HTTP server drained in X seconds."
- "draining workers."
- "workers drained in X seconds."
- "shutdown complete in X total seconds."

A clean shutdown produces a small, structured log narrative. A failed shutdown shows exactly where it got stuck.

### Metrics to export

- `shutdown_started` — counter, +1 when signal arrives.
- `shutdown_phase_duration_seconds{phase="http"}` — histogram, per-phase drain time.
- `shutdown_phase_timeout_total{phase="http"}` — counter, +1 on phase timeout.
- `shutdown_total_duration_seconds` — histogram, total time from signal to exit.
- `inflight_requests_at_shutdown_start` — gauge, snapshot at signal time.
- `inflight_requests_remaining_at_force_close` — gauge, if force-close fires.

Over months, these metrics show you which deploys produced slow shutdowns and on which services. That data is gold.

### Traces

If you have distributed tracing, emit a trace per shutdown:

```go
ctx, span := tracer.Start(context.Background(), "shutdown")
defer span.End()

httpCtx, httpSpan := tracer.Start(ctx, "shutdown.http")
_ = srv.Shutdown(httpCtx)
httpSpan.End()

workerCtx, workerSpan := tracer.Start(ctx, "shutdown.workers")
_ = workers.Wait(workerCtx)
workerSpan.End()
```

The trace shows you the timing of each phase. Slow phases stand out. The span attributes can include "inflight count at start" for context.

### Putting it together

```go
shutdownStart := time.Now()
metrics.ShutdownStarted.Inc()
log.Println("shutdown signal received")

ready.Store(false)
time.Sleep(readyDelay)

httpStart := time.Now()
ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
err := srv.Shutdown(ctx)
cancel()
httpDuration := time.Since(httpStart)
metrics.ShutdownPhaseDuration.WithLabelValues("http").Observe(httpDuration.Seconds())
if err != nil {
    metrics.ShutdownPhaseTimeout.WithLabelValues("http").Inc()
    log.Printf("http shutdown: %v", err)
}

// ... other phases ...

totalDuration := time.Since(shutdownStart)
metrics.ShutdownTotalDuration.Observe(totalDuration.Seconds())
log.Printf("shutdown complete in %v", totalDuration)
```

---

## Real-World Patterns

### Pattern: dependency tree shutdown

A service with many dependencies builds them into a tree where parents depend on children:

```
+-- Server
|   +-- HTTPHandler
|       +-- UserService
|           +-- DB
|           +-- Cache (Redis)
|       +-- OrderService
|           +-- DB
|           +-- Kafka producer
```

Shutdown traverses the tree in reverse: server first, then handler, then services, then their dependencies.

A simple implementation uses an in-order stack of `Close` calls; a complex one uses dependency injection frameworks (Wire, Fx) that compute the order automatically.

### Pattern: zero-downtime deploys

The mid-level addition to graceful shutdown: pair it with a deployment strategy that has at least N+1 instances. If you have 3 replicas, the rolling update brings up the new version, waits for it to be ready, then shuts down one old replica. There is always at least one ready instance.

Combined with graceful shutdown, this gives true zero-downtime deploys. The shutdown is the application-side contract; the rolling update is the orchestrator-side contract.

### Pattern: connection draining at the load balancer

Cloud load balancers (ALB, GCP LB, Envoy) support "connection draining" — when an instance is removed from the pool, the LB stops sending new requests but keeps the existing ones routed to that instance until they complete (up to a configured timeout).

This is the LB's contract that mirrors the application's shutdown. Configuring the LB's drain timeout to be slightly longer than your application's drain timeout produces clean handoffs.

```
LB drain timeout:        35s
preStop sleep:            5s
Application shutdown:    25s
terminationGracePeriod:  35s
```

The numbers cascade: each level is slightly longer than the one inside it, giving margin.

### Pattern: phased shutdown announcement

For very high-traffic services, "stop accepting" can be done in phases. Phase 1: reduce capacity by 50% (via weight changes). Phase 2: reduce to 10%. Phase 3: drain fully. This avoids "thundering herd" effects when many instances drain simultaneously.

Most services don't need this level of sophistication. Mention it here for completeness.

### Pattern: in-process job queue with persistence

A worker that pulls from a database-backed queue:

```go
func runWorker(ctx context.Context, db *sql.DB) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        tx, err := db.BeginTx(ctx, nil)
        if err != nil { /* handle */ continue }
        var job Job
        err = tx.QueryRowContext(ctx, `
            SELECT id, payload FROM jobs
            WHERE state = 'pending'
            ORDER BY created_at
            LIMIT 1 FOR UPDATE SKIP LOCKED
        `).Scan(&job.ID, &job.Payload)
        if err == sql.ErrNoRows {
            tx.Rollback()
            time.Sleep(100 * time.Millisecond)
            continue
        }
        process(ctx, job)
        tx.ExecContext(ctx, `UPDATE jobs SET state='done' WHERE id=$1`, job.ID)
        tx.Commit()
    }
}
```

The `FOR UPDATE SKIP LOCKED` and the transactional update give "process exactly once" semantics. Shutdown rolls back the transaction of any in-flight job; another worker picks it up. Idempotency-free because the queue is the source of truth.

---

## Anti-Patterns

### Anti-pattern: closing channels to signal shutdown

```go
// BAD
close(shutdownChan) // every reader sees it
```

It works for one-way signalling but is fragile: closing twice panics, you can't share the channel across multiple shutdowns, and `select` on closed-channels is a common bug source. `context.Context` is strictly better.

### Anti-pattern: global "shutting down" flag

```go
// BAD
var shuttingDown atomic.Bool
```

Better to pass `ctx`. The flag does not propagate timeouts, does not let you derive child contexts, and is invisible to function signatures.

### Anti-pattern: `time.Sleep` instead of polling on context

```go
// BAD
time.Sleep(5 * time.Second) // not cancellable
```

```go
// GOOD
select {
case <-ctx.Done():
    return ctx.Err()
case <-time.After(5 * time.Second):
}
```

### Anti-pattern: `defer cancel()` inside a loop

```go
// BAD
for _, x := range xs {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel() // accumulates across iterations
    do(ctx, x)
}
```

`defer` accumulates across iterations of the loop, releasing only when the function returns. If the loop has 1000 iterations, you have 1000 pending defers. The fix is to call `cancel()` explicitly at the bottom of each iteration:

```go
for _, x := range xs {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    do(ctx, x)
    cancel()
}
```

Or extract a helper function so the `defer` is scoped to one iteration:

```go
for _, x := range xs {
    func() {
        ctx, cancel := context.WithTimeout(parent, time.Second)
        defer cancel()
        do(ctx, x)
    }()
}
```

### Anti-pattern: ignoring the error from `Shutdown`

```go
// BAD
_ = srv.Shutdown(ctx)
```

Always check the error. `context.DeadlineExceeded` is the trigger for `Close`. Suppressing it silently means stuck shutdowns produce no diagnostic.

### Anti-pattern: signal subscription inside a goroutine

```go
// BAD
go func() {
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, ...)
    <-sigCh
    shutdown()
}()
```

`shutdown()` here is unsynchronised with `main`. `main` may have returned by the time `shutdown` runs. Subscribe in `main`; pass the resulting context down.

### Anti-pattern: not testing the shutdown path

```go
// (no test)
```

The shutdown path is the most likely to regress, because nobody exercises it during day-to-day development. A small integration test that asserts "process exits within 5 seconds of SIGTERM" is your insurance.

---

## Testing the Shutdown Path

### Unit tests

For library-level code (a `*Worker` struct, a `*Pool` struct), unit tests can exercise shutdown directly:

```go
func TestWorkerStopsOnContextCancel(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    w := NewWorker(...)
    done := make(chan struct{})
    go func() { w.Run(ctx); close(done) }()
    cancel()
    select {
    case <-done:
    case <-time.After(time.Second):
        t.Fatal("worker did not exit on cancel")
    }
}
```

### Integration tests

For the whole service, an integration test that spins up a subprocess:

```go
func TestGracefulShutdown(t *testing.T) {
    cmd := exec.Command(binPath)
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    require.NoError(t, cmd.Start())
    defer cmd.Process.Kill()

    waitForReady(t, "http://localhost:8080/readyz")

    // Start a slow request
    reqDone := make(chan *http.Response, 1)
    go func() {
        resp, _ := http.Get("http://localhost:8080/slow?d=2s")
        reqDone <- resp
    }()

    time.Sleep(100 * time.Millisecond)
    require.NoError(t, cmd.Process.Signal(syscall.SIGTERM))

    // Slow request should still complete
    select {
    case resp := <-reqDone:
        require.NotNil(t, resp)
        require.Equal(t, 200, resp.StatusCode)
    case <-time.After(5 * time.Second):
        t.Fatal("slow request did not complete")
    }

    // Process should exit cleanly
    done := make(chan error, 1)
    go func() { done <- cmd.Wait() }()
    select {
    case err := <-done:
        require.NoError(t, err)
    case <-time.After(10 * time.Second):
        t.Fatal("process did not exit cleanly")
    }
}
```

### `t.Cleanup` for test servers

Inside Go tests, `httptest.NewServer` and `t.Cleanup` interact nicely:

```go
func TestSomething(t *testing.T) {
    srv := httptest.NewServer(handler)
    t.Cleanup(srv.Close) // implicit shutdown when test ends
    // ... test body ...
}
```

This is the testing version of graceful shutdown. `httptest.Server.Close` is identical to `http.Server.Close` — brutal but correct for tests.

### Property-style tests

A robust shutdown can be tested with property-style:

- For any sequence of requests, after SIGTERM, all in-flight requests complete OR are rejected with 503.
- For any timing of SIGTERM, the process exits within `shutdownTimeout + readyDelay + margin`.
- For any number of concurrent requests, no request returns a connection-reset error during shutdown (given a properly configured LB or no LB).

These properties can be tested with a small "chaos" client that issues many requests with random timing while SIGTERM is fired.

---

## Code Recipes

### Recipe: a "lifecycle manager" struct

```go
type Lifecycle struct {
    mu      sync.Mutex
    closers []func(context.Context) error
}

func (l *Lifecycle) Add(c func(context.Context) error) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.closers = append(l.closers, c)
}

func (l *Lifecycle) Shutdown(ctx context.Context) error {
    l.mu.Lock()
    closers := append([]func(context.Context) error(nil), l.closers...)
    l.mu.Unlock()

    var errs []error
    for i := len(closers) - 1; i >= 0; i-- {
        if err := closers[i](ctx); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}
```

Use:

```go
lc := &Lifecycle{}
db := openDB()
lc.Add(func(ctx context.Context) error { return db.Close() })
srv := buildServer()
lc.Add(func(ctx context.Context) error { return srv.Shutdown(ctx) })
go srv.ListenAndServe()
<-rootCtx.Done()
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
_ = lc.Shutdown(ctx)
```

### Recipe: parallel drain with timeout

```go
func DrainParallel(ctx context.Context, drains ...func(context.Context) error) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, d := range drains {
        d := d
        g.Go(func() error { return d(gctx) })
    }
    return g.Wait()
}
```

Use:

```go
err := DrainParallel(ctx,
    httpSrv.Shutdown,
    grpcShutdown,
    workerPool.Drain,
)
```

### Recipe: `wg.Wait` with timeout

```go
func WaitTimeout(wg *sync.WaitGroup, d time.Duration) error {
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-time.After(d):
        return errors.New("timeout waiting for goroutines")
    }
}
```

### Recipe: readiness toggle

```go
type Readiness struct {
    v atomic.Bool
}

func (r *Readiness) SetReady(ok bool) { r.v.Store(ok) }
func (r *Readiness) Ready() bool      { return r.v.Load() }

func (r *Readiness) Handler() http.HandlerFunc {
    return func(w http.ResponseWriter, _ *http.Request) {
        if !r.Ready() {
            http.Error(w, "draining", http.StatusServiceUnavailable)
            return
        }
        w.WriteHeader(http.StatusOK)
    }
}
```

### Recipe: signal-to-cause cancellation

For richer logging of *which* signal caused shutdown:

```go
func notifyWithCause(parent context.Context, sigs ...os.Signal) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancelCause(parent)
    ch := make(chan os.Signal, 1)
    signal.Notify(ch, sigs...)
    go func() {
        s := <-ch
        cancel(fmt.Errorf("signal: %v", s))
    }()
    return ctx, func() {
        signal.Stop(ch)
        cancel(nil)
    }
}
```

Use:

```go
ctx, stop := notifyWithCause(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()
<-ctx.Done()
log.Printf("shutting down: %v", context.Cause(ctx))
```

### Recipe: bounded fallback shutdown

```go
func ShutdownWithFallback(srv *http.Server, timeout time.Duration) error {
    ctx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        _ = srv.Close()
        return err
    }
    return nil
}
```

### Recipe: deferred metric on shutdown duration

```go
defer func(start time.Time) {
    metrics.ShutdownTotalDuration.Observe(time.Since(start).Seconds())
}(time.Now())
```

---

## Pitfalls

### Pitfall: `ListenAndServe` returns before `Shutdown` is called

If startup itself fails (e.g., port already bound), `ListenAndServe` returns with a real error and your `<-ctx.Done()` blocks forever waiting for a signal that may never come. Handle this with the `select` between `ctx.Done()` and `serverErr`:

```go
serverErr := make(chan error, 1)
go func() {
    err := srv.ListenAndServe()
    serverErr <- err
}()
select {
case <-ctx.Done():
    // normal shutdown
case err := <-serverErr:
    if !errors.Is(err, http.ErrServerClosed) {
        return err
    }
}
```

### Pitfall: `errgroup` swallowing all errors but the first

`errgroup.Wait` returns the first non-nil error. Later errors are *discarded*. If you care about all of them, log them inside each goroutine before returning.

### Pitfall: `Shutdown` called on a server that never started

A nil `*http.Server` panics. Defensive code:

```go
if srv != nil {
    _ = srv.Shutdown(ctx)
}
```

This rarely happens in practice but matters in tests where teardown runs even when setup failed.

### Pitfall: hung shutdown because one dependency hangs

If you drain serially and one dependency hangs, the whole shutdown hangs. The fix: per-dependency deadlines.

```go
for _, d := range drains {
    ctx, cancel := context.WithTimeout(parent, d.MaxTime)
    _ = d.Drain(ctx)
    cancel()
}
```

### Pitfall: keep-alive connections in `http.Server`

A client with keep-alive will hold a connection open between requests. `Shutdown` closes idle keep-alives immediately; this is correct, but if a client is mid-request (even if the request is *almost* done), the connection is counted as active and shutdown waits. Aggressive timeouts (`ReadTimeout`, `WriteTimeout`) prevent this from prolonging shutdown.

### Pitfall: signal forwarded twice

In a Docker container, if your Go binary is not PID 1 (e.g., started by a shell), SIGTERM may not reach it. Use `exec` in the entrypoint, or build with no shell wrapper:

```dockerfile
ENTRYPOINT ["/app/server"]  # not: CMD ["sh", "-c", "/app/server"]
```

Or use a tiny init like `tini` to handle signal forwarding.

### Pitfall: TLS handshake in progress at shutdown

`http.Server.Shutdown` waits for connections to become idle. A connection mid-TLS-handshake counts as active. If you have a slow client doing a slow handshake, this can extend shutdown. Tight `ReadHeaderTimeout` helps.

### Pitfall: `OnShutdown` hooks blocking

`RegisterOnShutdown` callbacks run in their own goroutines but `Shutdown` does *not* wait for them. If you need synchronisation, build it yourself:

```go
var hookWG sync.WaitGroup
hookWG.Add(1)
srv.RegisterOnShutdown(func() {
    defer hookWG.Done()
    // ... do work ...
})

_ = srv.Shutdown(ctx)
hookWG.Wait() // wait for hook too
```

---

## Self-Assessment

After reading this file, you should be able to:

- [ ] Build a service with HTTP + gRPC + workers and shut them all down cleanly with `errgroup`.
- [ ] Explain why dependency order matters and apply the reverse-startup-order rule.
- [ ] Allocate a time budget across multiple shutdown phases with `context.WithTimeout`.
- [ ] Describe the Kubernetes pod-termination lifecycle and the role of `preStop` and readiness probes.
- [ ] Write metrics and logs that diagnose slow shutdowns.
- [ ] Identify and fix the common anti-patterns: closing channels, global flags, `time.Sleep`, etc.
- [ ] Test the shutdown path with both unit and integration tests.
- [ ] Coordinate worker draining with idempotency vs finish-and-ack trade-offs.

If any of these are uncertain, re-read the corresponding section.

---

## Summary

The middle-level shutdown story:

1. **Multiple subsystems.** Use `errgroup` or a lifecycle manager to coordinate.
2. **Reverse-order shutdown.** Close in reverse order of open.
3. **Per-phase time budgets.** Split your 30 seconds across drain, flush, close.
4. **Workers and queues.** Stop accepting work first, then drain in-flight, with idempotency-aware ack/nack.
5. **K8s cooperation.** `preStop` + readiness flip + `terminationGracePeriodSeconds` form one budget.
6. **Observability.** Log every transition, export metrics per phase, trace if you can.
7. **Test the path.** Both unit and integration. The shutdown path regresses easily.

The senior file builds on this with architectural concerns: phase machines, observability at scale, load-balancer drain choreography, and per-environment tuning.

---

## Extended Topic: Detailed `errgroup` Patterns

`errgroup` is so central to mid-level shutdown that a deeper look is worthwhile.

### `errgroup.WithContext` vs `errgroup.Group{}`

`errgroup.WithContext(parent)` returns a group whose internal context is cancelled when the first goroutine returns a non-nil error. The plain `errgroup.Group{}` does not.

```go
// With shared cancellation
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { ... return err }) // if non-nil, ctx is cancelled
g.Go(func() error { ... watch ctx ... })

// Without shared cancellation
var g errgroup.Group
g.Go(func() error { ... })
g.Go(func() error { ... })
```

For shutdown coordination, you almost always want `WithContext`.

### `g.Wait` blocking behaviour

`g.Wait()` blocks until *all* `g.Go`-spawned goroutines have returned. It returns the first non-nil error (or nil). The first error cancels `ctx`, which the other goroutines should observe; but `Wait` still waits for them to *return*, not just to observe the cancellation.

This matters: if a goroutine ignores `ctx` and runs forever, `g.Wait()` blocks forever. The shutdown deadline you put around `g.Wait` is your only protection.

### Wrapping `Wait` with a timeout

```go
errCh := make(chan error, 1)
go func() { errCh <- g.Wait() }()
select {
case err := <-errCh:
    return err
case <-time.After(35 * time.Second):
    return errors.New("group did not complete within 35s")
}
```

The 35-second number is `terminationGracePeriodSeconds`. If you reach it, you have already lost; the orchestrator is about to SIGKILL.

### `errgroup` + `SetLimit`

Go 1.20+ adds `g.SetLimit(n)` to cap concurrent goroutines. For shutdown of many dependencies, this is useful:

```go
g.SetLimit(10)
for _, conn := range allConnections {
    conn := conn
    g.Go(func() error { return conn.Close() })
}
g.Wait()
```

You drain 10 connections at a time, not 1000 at once. Useful for "close 10 000 WebSockets at shutdown" scenarios.

### `errgroup` versus `sync.WaitGroup` versus `sync.errgroup`

There is no `sync.errgroup`; the package is `golang.org/x/sync/errgroup`. It is an "extended" standard library, maintained by the Go team, considered stable. Use it without hesitation.

### `errgroup` panic behaviour

`errgroup` does *not* recover panics in spawned goroutines. A panic propagates up and crashes the program. If you want recover-on-panic semantics, wrap each goroutine:

```go
g.Go(func() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return work()
})
```

This converts panics into errors and lets the group continue. Whether you *want* this depends on your error-handling philosophy.

---

## Extended Topic: Dependency Injection and Shutdown

In larger services, dependency injection (DI) frameworks like Uber's `fx` or Google's `wire` automate the open/close order.

### How `fx` handles it

`fx.Lifecycle` is an injected dependency. Each component registers `OnStart` and `OnStop` hooks:

```go
func newServer(lc fx.Lifecycle, ...) *http.Server {
    srv := &http.Server{...}
    lc.Append(fx.Hook{
        OnStart: func(ctx context.Context) error {
            go srv.ListenAndServe()
            return nil
        },
        OnStop: func(ctx context.Context) error {
            return srv.Shutdown(ctx)
        },
    })
    return srv
}
```

`fx` ensures `OnStart` hooks run in dependency order (DB first, server last) and `OnStop` hooks in reverse. The dependency graph is computed at startup.

### When DI is worth it

For services with 5 or fewer dependencies, manual ordering is fine. For services with 20 dependencies arranged in a complex graph, `fx` is worth the boilerplate.

### Manual lifecycle without `fx`

A poor-man's `Lifecycle` can be just a slice:

```go
type Lifecycle struct {
    starts []func(context.Context) error
    stops  []func(context.Context) error
}

func (l *Lifecycle) Append(start, stop func(context.Context) error) {
    l.starts = append(l.starts, start)
    l.stops = append(l.stops, stop)
}

func (l *Lifecycle) Start(ctx context.Context) error {
    for _, s := range l.starts {
        if err := s(ctx); err != nil { return err }
    }
    return nil
}

func (l *Lifecycle) Stop(ctx context.Context) error {
    var errs []error
    for i := len(l.stops) - 1; i >= 0; i-- {
        if err := l.stops[i](ctx); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}
```

Use it in `main`:

```go
lc := &Lifecycle{}
attachDB(lc, &db)
attachServer(lc, &srv)
attachWorkers(lc, &workers)

ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()

if err := lc.Start(ctx); err != nil { return err }
<-ctx.Done()
sctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
return lc.Stop(sctx)
```

The pattern scales linearly with the number of dependencies. Adding a new one is one helper function.

---

## Extended Topic: HTTP/2 and Shutdown

HTTP/2 multiplexes many streams over one TCP connection. This complicates "drain" because a single connection can be carrying 100 concurrent requests.

### How `http.Server` handles HTTP/2 drain

Go's HTTP/2 implementation sends a `GOAWAY` frame at the start of `Shutdown`. `GOAWAY` tells the client "no new streams on this connection; finish the ones you have." The client respects this and stops opening new streams on this connection.

For a well-behaved client (browsers, well-written clients), this works. For misbehaving clients, the connection lingers until all active streams complete or the deadline fires.

### Knobs

`http.Server` does not expose direct HTTP/2 tuning; that lives in `golang.org/x/net/http2`. If you build the HTTP/2 server explicitly:

```go
h2s := &http2.Server{}
srv := &http.Server{
    Addr:    ":8080",
    Handler: h2c.NewHandler(handler, h2s),
}
```

Then `h2s` has fields like `MaxConcurrentStreams`. Lowering this during shutdown can speed up drain.

### gRPC over HTTP/2

gRPC uses HTTP/2 underneath. `grpc.Server.GracefulStop` does the equivalent of GOAWAY for gRPC streams. The same logic applies: streams must end or the deadline fires.

---

## Extended Topic: Connection Hijacking and WebSockets

`http.ResponseWriter.Hijack` lets a handler take over the underlying TCP connection. WebSockets, HTTP/2 with custom framing, and `net.Conn`-level protocols all do this.

After hijacking, the connection is *out of the `http.Server`'s tracking*. `Shutdown` does not know about it. The handler is responsible for cleanup.

### Pattern: WebSocket registry

```go
type WSRegistry struct {
    mu    sync.Mutex
    conns map[*websocket.Conn]struct{}
}

func (r *WSRegistry) Add(c *websocket.Conn) {
    r.mu.Lock()
    r.conns[c] = struct{}{}
    r.mu.Unlock()
}

func (r *WSRegistry) Remove(c *websocket.Conn) {
    r.mu.Lock()
    delete(r.conns, c)
    r.mu.Unlock()
}

func (r *WSRegistry) CloseAll(ctx context.Context) error {
    r.mu.Lock()
    conns := make([]*websocket.Conn, 0, len(r.conns))
    for c := range r.conns {
        conns = append(conns, c)
    }
    r.mu.Unlock()

    var wg sync.WaitGroup
    for _, c := range conns {
        wg.Add(1)
        go func(c *websocket.Conn) {
            defer wg.Done()
            c.WriteControl(websocket.CloseMessage,
                websocket.FormatCloseMessage(1001, "server shutting down"),
                time.Now().Add(time.Second))
            c.Close()
        }(c)
    }

    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Register the registry with `RegisterOnShutdown`:

```go
srv.RegisterOnShutdown(func() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    _ = registry.CloseAll(ctx)
})
```

Or call `registry.CloseAll` from your shutdown coordinator goroutine alongside `srv.Shutdown`.

---

## Extended Topic: Long-Lived Connections (SSE, gRPC streams)

Server-Sent Events (SSE) and gRPC streams are intentionally long-lived. They are not bugs to be fixed; they are the design.

For SSE:

```go
func sseHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    flusher := w.(http.Flusher)
    for {
        select {
        case <-r.Context().Done():
            return
        case event := <-events:
            fmt.Fprintf(w, "data: %s\n\n", event)
            flusher.Flush()
        }
    }
}
```

During shutdown, `r.Context()` is NOT cancelled by `Shutdown`. The handler does not know about shutdown. To make it shutdown-aware:

```go
func sseHandler(serviceCtx context.Context) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithCancel(r.Context())
        defer cancel()
        go func() {
            select {
            case <-serviceCtx.Done():
                cancel()
            case <-ctx.Done():
            }
        }()
        // ... loop on ctx.Done() ...
    }
}
```

Now the handler exits on either request cancellation OR service shutdown.

For gRPC streams, the same idea applies but using `stream.Context()` and explicit cancellation.

---

## Extended Topic: Sentry and APM During Shutdown

Application Performance Monitoring tools (Sentry, Datadog, New Relic) buffer events and flush asynchronously. On shutdown, you need to flush before exit, or the last seconds of errors are lost.

### Sentry

```go
sentry.Init(sentry.ClientOptions{...})
defer sentry.Flush(2 * time.Second)
```

`sentry.Flush` blocks until events are sent or the timeout elapses. Place it in `main`'s defer (so it runs even on `log.Fatalf`... no wait, `log.Fatalf` does `os.Exit` which skips defers — but `sentry.Flush` should still be called *before* `log.Fatalf`). The pattern:

```go
func run() error {
    // ... main logic ...
}

func main() {
    defer sentry.Flush(2 * time.Second)
    if err := run(); err != nil {
        sentry.CaptureException(err)
        sentry.Flush(2 * time.Second)
        log.Fatalf("fatal: %v", err)
    }
}
```

### Datadog

```go
tracer.Stop()              // stops accepting new spans
profiler.Stop()            // stops profiler if enabled
metrics.Flush()            // flushes buffered metrics
```

Order matters: stop accepting new data, then flush. Without "stop accepting," the flush keeps racing with new data.

### OpenTelemetry

```go
tp := buildTracerProvider()
// ...
shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
_ = tp.Shutdown(shutdownCtx)
```

`TracerProvider.Shutdown` flushes spans and stops the exporter.

### The pattern

All APM tools share the shape:

1. Stop new data ingestion.
2. Flush buffered data.
3. Close transport.

Wire each one into your dependency stack, after the application has drained.

---

## Extended Topic: Configuration of Timeouts in Production

Defaults work for most. When they do not, here is how to think about each timeout.

### `http.Server.ReadTimeout`

Default: 0 (no limit). Set to a few seconds for most APIs. Long-running uploads need a longer value. Aggressive setting speeds shutdown but cuts off slow clients.

### `http.Server.WriteTimeout`

Default: 0 (no limit). Should be longer than the longest expected response. For streaming responses, set this carefully; for normal APIs, 30 seconds is reasonable.

### `http.Server.IdleTimeout`

Default: 0 (uses `ReadTimeout` for next-request idle). Set to 60–120 seconds to allow keep-alive reuse without holding connections forever.

### `http.Server.ReadHeaderTimeout`

Default: 0. Set to 5–10 seconds to defend against Slowloris (slow header attacks). Aggressive.

### `terminationGracePeriodSeconds`

Default in K8s: 30. Should be `(your shutdown deadline) + (preStop sleep) + a few seconds margin`. Raising it gives more time but slows deploys.

### Your `Shutdown` deadline

Should be the *primary* time budget. Set to `terminationGracePeriodSeconds - preStop sleep - margin`. Typical: 25 seconds with 30-second grace period.

### Per-phase deadlines

Split your shutdown deadline across phases. HTTP gets the biggest share (drain is slowest). Workers and DB closes are usually fast.

A reasonable starting allocation for 25 seconds total:

| Phase | Budget |
|---|---|
| HTTP drain | 15s |
| Worker drain | 6s |
| Producer/consumer flush | 2s |
| DB / Redis / etc. close | 1s |
| Margin | 1s |

Tune based on metrics.

---

## Extended Topic: Per-Environment Timeouts

Local development should iterate quickly:

```
SHUTDOWN_TIMEOUT=2s
READY_DELAY=0s
```

Production:

```
SHUTDOWN_TIMEOUT=25s
READY_DELAY=3s
```

Staging is usually production-like. Some teams add an "integration test" environment with even tighter timeouts to catch slow-shutdown bugs early.

### Pattern: env-driven config

```go
type Config struct {
    ShutdownTimeout time.Duration `envconfig:"SHUTDOWN_TIMEOUT" default:"25s"`
    ReadyDelay      time.Duration `envconfig:"READY_DELAY" default:"3s"`
    ListenAddr      string        `envconfig:"LISTEN_ADDR" default:":8080"`
}
```

In `main`:

```go
var cfg Config
if err := envconfig.Process("", &cfg); err != nil {
    return err
}
```

Test the shutdown path with `SHUTDOWN_TIMEOUT=100ms` to force the timeout-and-`Close` fallback.

---

## Extended Topic: Cooperative Versus Forceful Cancellation

`http.Server.Shutdown` is cooperative: it waits for handlers to finish. `http.Server.Close` is forceful: it interrupts them. The middle ground is "cancel the request's context, then wait."

```go
// Cooperative + forceful hybrid
type requestRegistry struct {
    mu     sync.Mutex
    active map[string]context.CancelFunc
}

func (r *requestRegistry) Add(id string, cancel context.CancelFunc) {
    r.mu.Lock(); defer r.mu.Unlock()
    r.active[id] = cancel
}

func (r *requestRegistry) Remove(id string) {
    r.mu.Lock(); defer r.mu.Unlock()
    delete(r.active, id)
}

func (r *requestRegistry) CancelAll() {
    r.mu.Lock(); defer r.mu.Unlock()
    for _, cancel := range r.active {
        cancel()
    }
}
```

Wire it into middleware:

```go
func requestRegistryMiddleware(reg *requestRegistry) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            ctx, cancel := context.WithCancel(r.Context())
            id := uuid.New().String()
            reg.Add(id, cancel)
            defer reg.Remove(id)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

On shutdown, after `Shutdown`'s deadline elapses:

```go
if err := srv.Shutdown(ctx); err != nil {
    log.Println("deadline; cancelling all handlers")
    reg.CancelAll()
    _ = srv.Close()
}
```

Handlers that watch `ctx.Done()` exit promptly. Handlers that ignore the context still get interrupted by `Close`, but now you have *also* given them a chance to exit cleanly via cancellation.

---

## Extended Topic: Database Migrations on Shutdown

Some teams run schema migrations on application startup. The graceful-shutdown corollary is: migrations are *not* graceful-shutdown work. They are startup work that should complete before the application accepts traffic. If a migration is mid-run when SIGTERM arrives, you have a problem — the schema is in an inconsistent state.

The right pattern is:

1. Run migrations to completion before flipping readiness to true.
2. Once accepting traffic, never run migrations.
3. On shutdown, do not roll back migrations.

If you must support "graceful interruption of migration," the migration tool itself must be transactional. Goose, golang-migrate, and Atlas all support transactional migrations on databases that support DDL transactions (PostgreSQL: yes, MySQL: no for most DDL).

---

## Extended Topic: Distributed Tracing and Shutdown Spans

A trace of the shutdown is invaluable when investigating slow drains in production.

```go
import "go.opentelemetry.io/otel"

func runShutdown(rootCtx context.Context, srv *http.Server, workers *Workers) {
    tracer := otel.Tracer("shutdown")
    ctx, span := tracer.Start(rootCtx, "shutdown")
    defer span.End()
    span.SetAttributes(attribute.Int("inflight_at_start", inflightCount()))

    {
        ctx2, span := tracer.Start(ctx, "ready_off")
        ready.Store(false)
        time.Sleep(readyDelay)
        span.End()
        _ = ctx2
    }

    {
        ctx2, span := tracer.Start(ctx, "http_drain")
        sctx, cancel := context.WithTimeout(ctx2, 15*time.Second)
        err := srv.Shutdown(sctx)
        cancel()
        if err != nil {
            span.SetAttributes(attribute.Bool("timed_out", true))
            span.RecordError(err)
            _ = srv.Close()
        }
        span.End()
    }

    {
        ctx2, span := tracer.Start(ctx, "worker_drain")
        workers.Wait(ctx2)
        span.End()
    }
}
```

The trace shows per-phase timings. Outliers stand out. In aggregate, the histograms show the distribution of each phase across deploys.

---

## Extended Topic: Reload Without Restart

A close cousin to graceful shutdown is *graceful reload* — replacing the running configuration without killing the process. Common for:

- Reloading TLS certificates after renewal.
- Reloading routing tables in a reverse proxy.
- Reloading feature flags from disk.

Pattern with `SIGHUP`:

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM)

for {
    s := <-sigCh
    switch s {
    case syscall.SIGHUP:
        log.Println("reloading config")
        if err := reloadConfig(); err != nil {
            log.Printf("reload failed: %v", err)
            continue
        }
    case syscall.SIGINT, syscall.SIGTERM:
        log.Println("shutting down")
        triggerShutdown()
        return
    }
}
```

`SIGHUP` should not exit; it should hot-reload. Many daemons (nginx, postgres, rsyslog) follow this convention.

### Reloading TLS certificates

For HTTPS, `http.Server.TLSConfig.GetCertificate` is a callback that picks a certificate per connection. Replacing the callback's source dynamically updates served certs:

```go
type CertManager struct {
    mu   sync.RWMutex
    cert *tls.Certificate
}

func (cm *CertManager) GetCertificate(_ *tls.ClientHelloInfo) (*tls.Certificate, error) {
    cm.mu.RLock()
    defer cm.mu.RUnlock()
    return cm.cert, nil
}

func (cm *CertManager) Reload(path string) error {
    cert, err := tls.LoadX509KeyPair(path+".crt", path+".key")
    if err != nil { return err }
    cm.mu.Lock()
    cm.cert = &cert
    cm.mu.Unlock()
    return nil
}
```

In `main`:

```go
cm := &CertManager{}
cm.Reload("/etc/tls/server")
srv := &http.Server{
    TLSConfig: &tls.Config{GetCertificate: cm.GetCertificate},
    ...
}

// on SIGHUP
cm.Reload("/etc/tls/server")
```

New connections use the new certificate; existing connections keep the old one until they close. This is the cleanest cert rotation pattern available.

---

## Extended Topic: Zero-Downtime Process Replacement (exec self)

Some servers achieve zero downtime by `exec`ing a new process while keeping the listening socket open:

```go
// On SIGUSR1
listener, _ := getListener()
fd, _ := listener.(filer).File().Fd()
execPath, _ := os.Executable()
syscall.Exec(execPath, os.Args, append(os.Environ(),
    fmt.Sprintf("LISTENER_FD=%d", fd)))
```

The new process inherits the file descriptor. It starts serving immediately on the same port. The old process drains in-flight requests and exits. No connection resets, no port unavailability.

This pattern is used by nginx, HAProxy, and Go libraries like `cloudflare/tableflip`. It is complex and overkill for most services. K8s rolling updates with multiple replicas achieve the same effect more simply.

Worth knowing it exists; rarely worth implementing.

---

## Extended Topic: Liveness vs Readiness in Depth

The two probes serve different purposes; conflating them causes outages.

### Readiness probe

- Question: "Should the load balancer send me traffic?"
- Behaviour on failure: pod is removed from Service endpoints. No restart.
- During shutdown: flip to fail. LB stops sending traffic.

### Liveness probe

- Question: "Is this container alive enough to keep running?"
- Behaviour on failure: kubelet restarts the container.
- During shutdown: keep returning 200. You are alive, just draining.

### Common mistake

Returning 503 from both probes during shutdown. Liveness 503 triggers a restart. The kubelet kills your container mid-drain. Your shutdown logic does not finish.

The right separation:

```go
mux.HandleFunc("/livez", func(w http.ResponseWriter, _ *http.Request) {
    w.WriteHeader(http.StatusOK) // always 200 unless truly dead
})
mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
    if !ready.Load() {
        http.Error(w, "draining", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})
```

### Startup probe

Some services have slow starts (loading large caches, warming caches, running migrations). Without a `startupProbe`, the liveness probe would fire while startup is still in progress, and the kubelet would restart the container before it ever became ready. `startupProbe` blocks liveness and readiness until it passes.

```yaml
startupProbe:
  httpGet:
    path: /healthz/startup
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```

Failure threshold * period = maximum startup time. 30 * 10 = 5 minutes.

---

## Extended Topic: PodDisruptionBudget

`PodDisruptionBudget` (PDB) tells K8s "do not voluntarily disrupt more than N pods at a time." If you have 3 replicas and `maxUnavailable: 1`, K8s will only kill one pod at a time during rolling updates, drains, or node maintenance.

PDB does not affect non-voluntary disruptions (node crashes), but it does keep your rolling update safe.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: myservice
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: myservice
```

With a PDB, your graceful shutdown is the application contract; the PDB is the orchestration contract.

---

## Extended Topic: HorizontalPodAutoscaler and Shutdown

When HPA scales down, it deletes pods one at a time, each going through the full termination lifecycle. Graceful shutdown is per-pod; HPA does not change the per-pod story.

What HPA does change: the *frequency* of shutdowns. A bursty service that scales 1 → 100 → 1 every hour does 99 shutdowns per cycle. Each must work cleanly. Your shutdown code is exercised constantly.

This is a good thing — frequent exercise prevents regressions. But it means any shutdown bug is felt 99 times per cycle.

---

## Extended Topic: Multi-Region and Shutdown

A globally distributed service with regional clusters has its own shutdown choreography. The mechanism varies by traffic-routing layer:

- **Global LB (Cloudflare, GCP global LB):** Per-region health checks. Failing health checks in one region routes traffic to other regions. Drain is per-cluster.
- **DNS-based routing:** Slower. DNS TTL means shutdown announcements take minutes to propagate. Set short TTLs (60 seconds) if you want timely shutdowns.
- **Anycast:** Fastest. BGP withdraws the region's IP from the announcement. Traffic redistributes within seconds.

In any case, the per-pod shutdown story stays the same: drain in-flight, exit cleanly. The regional layer just changes who is sending you traffic.

---

## Extended Topic: Health Check Endpoints Best Practices

Beyond liveness/readiness, consider:

### `/healthz` — process is alive

Always 200 unless something internal is fundamentally broken. Used by basic liveness checks.

### `/readyz` — accepting traffic

200 when ready, 503 during shutdown or before startup completes.

### `/healthz/detailed` — diagnostic

Returns JSON with details:

```json
{
  "status": "ready",
  "shutdown": false,
  "db": "connected",
  "redis": "connected",
  "kafka": "connected",
  "inflight_requests": 12,
  "goroutines": 350,
  "uptime_seconds": 3600
}
```

Use for human debugging, not for orchestrator decisions. (Orchestrators should make decisions on `/readyz` and `/livez`; complex JSON is hard to reason about in YAML.)

### `/metrics` — Prometheus

Standard. Should not require auth (inside a private cluster) or should require dedicated metrics-server auth.

### `/debug/pprof` — Go profiling

`net/http/pprof` package adds these endpoints automatically when imported with `_`. Useful in production; lock down access.

Never expose `/debug/pprof` on the same port as user-facing traffic. Use a separate `metricsSrv` on a separate port.

---

## Extended Topic: Production Incident Postmortem Outline

When a shutdown-related incident happens, the postmortem should answer:

1. **What happened?** "During the 14:30 deploy, 5 pods entered `CrashLoopBackOff` because their shutdown took longer than `terminationGracePeriodSeconds`."
2. **Why?** "A downstream service became slow; our request handlers blocked on it. Our `Shutdown` deadline was 30s but our `terminationGracePeriodSeconds` was 25s. The pod was SIGKILLed mid-drain."
3. **Who noticed?** "Customer reports of intermittent 502s; on-call paged at 14:35."
4. **Detection.** "5xx-rate alerts. Pod-restart-count alerts."
5. **Action items.**
   - Set `Shutdown` deadline to 20s (5s margin under TGP).
   - Set per-handler request timeout to 15s (so handlers cannot block drain indefinitely).
   - Add metric `shutdown_force_close_total` and an alert on it.
   - Run a chaos test that simulates slow downstream during shutdown.
6. **Lessons learned.** "Shutdown deadlines should always be shorter than the orchestrator's. Per-handler timeouts protect drain."

A postmortem like this turns one incident into a system-level improvement. The middle-level engineer is the one who writes these.

---

## Extended Topic: Chaos Testing for Shutdown

Chaos engineering applied to shutdown: deliberately induce failure modes during shutdown to verify robustness.

### Chaos scenarios to test

1. **Slow downstream during drain.** Make a dependent service intentionally slow; verify shutdown still completes within budget.
2. **SIGTERM during startup.** Send SIGTERM 100ms after process starts. Verify clean exit.
3. **SIGTERM during database connection.** Drop DB connectivity at SIGTERM. Verify failure mode.
4. **Concurrent SIGTERMs.** Send SIGTERM twice in quick succession. Should be idempotent.
5. **SIGTERM followed by SIGKILL after 2 seconds.** Simulate kubelet timeout. Verify partial-progress behaviour.

A chaos test for #1:

```go
func TestSlowDownstreamDuringDrain(t *testing.T) {
    // start slow fake downstream
    downstream := httptest.NewServer(http.HandlerFunc(
        func(w http.ResponseWriter, r *http.Request) {
            time.Sleep(20 * time.Second)
            w.Write([]byte("ok"))
        }))
    defer downstream.Close()

    cmd := startServer(t, "DOWNSTREAM_URL="+downstream.URL)
    defer cmd.Process.Kill()

    // issue request that will trigger downstream call
    go func() {
        _, _ = http.Get("http://localhost:8080/proxy")
    }()
    time.Sleep(500 * time.Millisecond)

    // signal shutdown
    require.NoError(t, cmd.Process.Signal(syscall.SIGTERM))

    // expect exit within 10 seconds (force-close kicks in)
    done := make(chan error, 1)
    go func() { done <- cmd.Wait() }()
    select {
    case <-done:
    case <-time.After(10 * time.Second):
        t.Fatal("did not exit; force-close did not kick in")
    }
}
```

This test verifies your fallback `Close` actually works.

---

## Extended Topic: A Production Checklist

Print this and tape it to your monitor.

- [ ] `signal.NotifyContext` is called in `main` (or top-level `Run`).
- [ ] Both `SIGINT` and `SIGTERM` are caught.
- [ ] `defer stop()` is present.
- [ ] `http.Server.Shutdown` is bounded with `context.WithTimeout`.
- [ ] `http.Server.Close` is the fallback.
- [ ] `errors.Is(err, http.ErrServerClosed)` is used.
- [ ] Background goroutines all take and observe `ctx`.
- [ ] Database is closed *after* the server is drained.
- [ ] WebSocket / hijacked connections are tracked and drained.
- [ ] Readiness flips to 503 during shutdown; liveness stays 200.
- [ ] `terminationGracePeriodSeconds` is set explicitly in the manifest.
- [ ] `preStop` hook is configured for the LB-drain window (or done in code).
- [ ] Metrics: `shutdown_started`, `shutdown_duration_seconds`, per-phase timings.
- [ ] Logs: every transition (signal, readiness, drain, exit).
- [ ] Integration test: process exits within X seconds of SIGTERM.
- [ ] Chaos test: slow downstream during shutdown.
- [ ] Tracing: spans for each phase (if you have tracing).

A service that passes every item is production-grade. Most services pass 6 of these on day one. Bring them up to 10 within a quarter and you have eliminated a class of incidents.

---

## Extended Topic: Common Production-Hardening PRs

The pattern of "first PR makes shutdown work; second makes it bulletproof":

### PR 1 — Add basic graceful shutdown

```go
// Adds signal handler, Shutdown call, deadline.
+ ctx, stop := signal.NotifyContext(context.Background(), ...)
+ ...
+ if err := srv.Shutdown(shutdownCtx); err != nil {
+     _ = srv.Close()
+ }
```

Typically 50–80 lines added. Eliminates 90% of deploy-time errors.

### PR 2 — Add readiness flip and preStop

```go
// Adds /readyz, atomic ready bool, readyDelay sleep
+ var ready atomic.Bool
+ ready.Store(true)
+ mux.HandleFunc("/readyz", ...)
+ // on shutdown:
+ ready.Store(false)
+ time.Sleep(readyDelay)
```

```yaml
+ readinessProbe:
+   httpGet: { path: /readyz, port: 8080 }
+ lifecycle:
+   preStop:
+     exec: { command: ["sleep", "3"] }
```

Adds LB drain. Eliminates the last few connection resets.

### PR 3 — Add observability

```go
+ metrics.ShutdownStarted.Inc()
+ defer func(t time.Time) {
+     metrics.ShutdownTotalDuration.Observe(time.Since(t).Seconds())
+ }(time.Now())
+ // per-phase metrics
```

Adds visibility. Now slow drains show up on dashboards.

### PR 4 — Add chaos test

```go
+ func TestSlowDownstreamShutdown(t *testing.T) { ... }
```

Prevents regression.

### PR 5 — Tune timeouts

```yaml
- terminationGracePeriodSeconds: 30
+ terminationGracePeriodSeconds: 35  # = preStop 5s + drain 25s + margin 5s
```

Based on measured drain times. Brings worst-case below limit.

Five PRs, each small, each independently reviewable. Total impact: production-grade shutdown.

---

## Extended Topic: Misconceptions Common at the Mid Level

### "Shutdown should never error"

`Shutdown` *can* error. `context.DeadlineExceeded` is the typical case. Handle it; do not assume it.

### "If `Shutdown` returns nil, everything is closed"

`Shutdown` returns nil when the HTTP server is drained. It does not vouch for your database, your queue producer, your tracer, or your background goroutines. You wait for each one separately.

### "`defer cancel()` is decoration"

Forgetting `defer cancel()` after `context.WithCancel` leaks the context tree. The leak is small (a few hundred bytes) but appears in test goroutine counts and pprof. Treat the defer as required.

### "I should test only the happy path"

The happy path of shutdown is the easy path. The interesting tests are the failure paths: slow handler, dead downstream, panic during shutdown, double-SIGTERM.

### "Kubernetes will tell my code when it's draining"

Kubernetes tells your container by sending SIGTERM. There is no other notification. If your code does not handle the signal, K8s assumes you do not need a graceful shutdown.

### "30 seconds is plenty"

For most services, yes. For services with multi-second handlers (long uploads, heavy computations), 30 may not be enough. Measure your p99 handler time and ensure `Shutdown` deadline exceeds it.

---

## Extended Topic: Verifying Shutdown in CI

Add a CI job that runs the integration test on every PR. Failure is loud and immediate. The shape:

```yaml
# .github/workflows/test.yml
- name: Run shutdown integration test
  run: go test ./internal/server -run TestGracefulShutdown -timeout 30s
```

CI catches the regressions before merge. The cost of running the test is single-digit seconds; the cost of *not* running it is occasional production incidents.

---

## Closing Thoughts on Mid-Level Shutdown

Junior-level shutdown is a *recipe*: copy these 15 lines into `main`. Mid-level shutdown is an *architectural concern*: dependency order, time budgets, observability, orchestrator cooperation. You are now designing for a service of many parts, each with its own lifecycle, all coordinated.

The senior file zooms out further: how do you design a *fleet* of services where each shuts down well, where the LB drains correctly, where deploys are fully observable, where slow drains are diagnosed in seconds not days?

Onwards.

---

## Appendix: Worked Example — Full E-Commerce Service Shutdown

A composite example that ties together every topic in this file. A fictional "checkout" service has:

- HTTP API for `POST /checkout`
- gRPC API for internal inventory queries
- Metrics server on a separate port
- Workers consuming "order created" events from Kafka
- Database pool (Postgres)
- Redis client for session cache
- Tracer (OTLP exporter)
- Sentry for error reporting

The complete `main.go`:

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log"
    "net"
    "net/http"
    "os/signal"
    "sync/atomic"
    "syscall"
    "time"

    "github.com/getsentry/sentry-go"
    "golang.org/x/sync/errgroup"
    "google.golang.org/grpc"
)

func main() {
    if err := run(); err != nil {
        log.Fatalf("fatal: %v", err)
    }
}

func run() error {
    defer sentry.Flush(2 * time.Second)

    cfg, err := loadConfig()
    if err != nil { return fmt.Errorf("config: %w", err) }

    rootCtx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    if err := initTracer(rootCtx, cfg); err != nil {
        return fmt.Errorf("tracer: %w", err)
    }

    db, err := openDB(rootCtx, cfg.DBURL)
    if err != nil { return fmt.Errorf("db: %w", err) }

    rdb, err := openRedis(rootCtx, cfg.RedisURL)
    if err != nil { return fmt.Errorf("redis: %w", err) }

    kafkaProducer, err := openKafkaProducer(cfg.KafkaBrokers)
    if err != nil { return fmt.Errorf("kafka: %w", err) }

    var ready atomic.Bool
    ready.Store(true)

    apiSrv := buildAPIServer(cfg, db, rdb, kafkaProducer, &ready)
    grpcSrv, grpcLis := buildGRPCServer(cfg, db)
    metricsSrv := buildMetricsServer(cfg)
    workers := buildWorkers(cfg, db, rdb)

    g, gctx := errgroup.WithContext(rootCtx)

    // ---- launch ----
    g.Go(func() error {
        log.Println("API listening on", cfg.APIAddr)
        if err := apiSrv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            return fmt.Errorf("api: %w", err)
        }
        return nil
    })

    g.Go(func() error {
        log.Println("gRPC listening on", cfg.GRPCAddr)
        if err := grpcSrv.Serve(grpcLis); err != nil {
            return fmt.Errorf("grpc: %w", err)
        }
        return nil
    })

    g.Go(func() error {
        log.Println("metrics listening on", cfg.MetricsAddr)
        if err := metricsSrv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            return fmt.Errorf("metrics: %w", err)
        }
        return nil
    })

    g.Go(func() error {
        return workers.Run(gctx)
    })

    // ---- shutdown coordinator ----
    g.Go(func() error {
        <-gctx.Done()
        log.Printf("shutdown signal: %v", gctx.Err())

        // Phase 1: readiness flip
        ready.Store(false)
        log.Println("readiness flipped to draining")
        time.Sleep(3 * time.Second)

        // Phase 2: drain inbound APIs in parallel
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
        defer cancel()

        eg, ectx := errgroup.WithContext(shutdownCtx)

        eg.Go(func() error {
            log.Println("draining API server")
            if err := apiSrv.Shutdown(ectx); err != nil {
                _ = apiSrv.Close()
                return fmt.Errorf("api shutdown: %w", err)
            }
            log.Println("API drained")
            return nil
        })

        eg.Go(func() error {
            log.Println("draining gRPC server")
            done := make(chan struct{})
            go func() { grpcSrv.GracefulStop(); close(done) }()
            select {
            case <-done:
                log.Println("gRPC drained")
                return nil
            case <-ectx.Done():
                grpcSrv.Stop()
                return ectx.Err()
            }
        })

        if err := eg.Wait(); err != nil {
            log.Printf("inbound drain error: %v", err)
        }

        // Phase 3: stop workers (they have already received gctx cancellation)
        if err := workers.Wait(shutdownCtx); err != nil {
            log.Printf("workers shutdown error: %v", err)
        }

        // Phase 4: flush Kafka, close outbound clients
        if err := kafkaProducer.Flush(shutdownCtx); err != nil {
            log.Printf("kafka flush: %v", err)
        }
        kafkaProducer.Close()
        rdb.Close()
        db.Close()
        metricsSrv.Shutdown(shutdownCtx)

        log.Println("all subsystems closed")
        return nil
    })

    return g.Wait()
}
```

This 130-line `main` is the production-grade lifecycle for a real service. Every concept from the file is present: signal handling, errgroup, readiness flip, parallel drain of inbound, sequential drain of outbound, fallback close, structured logging.

### Key design decisions

- **Order:** readiness off → APIs drain (parallel) → workers wait → Kafka flush → close outbound (in dependency order).
- **Parallelism:** the two inbound servers drain at the same time. Workers wait sequentially after, because they may use the same DB connections as drained handlers.
- **Single time budget:** `shutdownCtx` is the parent of all phase contexts. If 20 seconds elapses, every phase ends.
- **Structured logging:** every transition is logged with a sentence the on-call can grep for.
- **Sentry flush:** deferred at the top of `run()`, runs even on `log.Fatalf`.

### What's missing (and is in the senior file)

- Distributed tracing for shutdown.
- Per-environment timeouts.
- A more sophisticated "phase machine" that gates phases on metric thresholds.
- Multi-process zero-downtime techniques.
- Performance tuning of `Shutdown`'s 500ms polling.

Onwards to senior.md.

---

## Appendix: Detailed Walkthrough of `gctx` vs `rootCtx`

A subtle source of bugs: the `errgroup`'s context (`gctx`) vs the signal context (`rootCtx`).

```go
rootCtx, stop := signal.NotifyContext(context.Background(), ...)
g, gctx := errgroup.WithContext(rootCtx)
```

- `rootCtx` cancels when the signal arrives.
- `gctx` cancels when `rootCtx` cancels OR when any `g.Go` goroutine returns a non-nil error.

If a goroutine inside the group returns an error (say, `apiSrv.ListenAndServe` fails to bind the port), `gctx` cancels. Other goroutines see the cancellation and exit. The shutdown coordinator (which is also a goroutine in the group) sees `gctx.Done()` and starts the drain.

This is *desirable* behaviour: a startup error triggers full shutdown.

But it can be surprising. If the shutdown coordinator itself triggers shutdown by reading `gctx.Done()`, the relationship is circular: the coordinator drains the API server, which causes the API goroutine to return, which (if it returns an error) would cancel `gctx`, which is *already cancelled*. The cycle is benign because each cancellation is idempotent.

The bigger gotcha: if you pass `gctx` to `srv.Shutdown`, and the API goroutine returns *before* the shutdown coordinator starts draining, then `gctx` is already cancelled when `Shutdown` is called. `Shutdown(canceled)` returns immediately with `context.Canceled` — no actual drain happens. **This is why we use `context.WithTimeout(context.Background(), 20*time.Second)` as the shutdown context, not `gctx`.**

The rule: **never pass a derived-from-rootCtx context to `Shutdown`**. Use `context.Background()` plus your timeout. The root context is for cancellation propagation during *normal* operation; the shutdown context is for *shutdown-phase* timing.

---

## Appendix: Slow Connection Patterns

A surprising fraction of shutdown delays come from slow clients, not slow handlers.

### The "Slowloris" problem during shutdown

A malicious or buggy client opens a connection, sends one byte of the request, and stops. Without timeouts, `http.Server.Shutdown` waits until the read times out — potentially forever.

Defense: `ReadHeaderTimeout`. With `5*time.Second`, an incomplete header causes the server to close the connection within 5 seconds.

### Long-polling clients

A long-polling client holds a connection waiting for a server-side event. If the event takes 30 seconds, the handler runs for 30 seconds. During shutdown, this prolongs drain by up to 30 seconds.

Mitigation: handlers should observe `r.Context()` *and* `serviceCtx`. On either cancellation, send a 503 and return.

### Streaming uploads

A client uploads a 10 GB file. The handler is mid-upload at shutdown. The drain waits until the upload completes (slow) or the deadline fires.

Mitigation: enforce a per-handler deadline:

```go
mux.HandleFunc("/upload", func(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
    defer cancel()
    handleUpload(ctx, w, r)
})
```

The deadline bounds even cooperative clients.

### TCP keep-alive but no application keep-alive

Some clients keep the TCP connection open indefinitely between HTTP requests. `IdleTimeout` (Go's `http.Server` setting) handles this:

```go
srv.IdleTimeout = 120 * time.Second
```

After 120 seconds of idle (no requests), the server closes the connection. Without this, idle keep-alives accumulate.

---

## Appendix: gRPC Streams and Shutdown

gRPC supports four call types: unary, server-streaming, client-streaming, bidirectional. Each has different drain implications.

### Unary RPCs

Like HTTP: a request, a response. `GracefulStop` waits for in-flight unary calls (typically milliseconds). Fast.

### Server-streaming

Server sends many responses over time. The stream stays open until the server sends "end of stream" or the context is cancelled.

`GracefulStop` waits for the stream to end. If the server is producing infinite events, the stream never ends and shutdown blocks until force-stopped.

Mitigation: the streaming handler must observe `stream.Context()`:

```go
func (s *Server) Stream(req *Req, stream pb.Service_StreamServer) error {
    for {
        select {
        case <-stream.Context().Done():
            return stream.Context().Err()
        case e := <-events:
            if err := stream.Send(&Resp{...}); err != nil {
                return err
            }
        }
    }
}
```

But `stream.Context()` is NOT cancelled by `GracefulStop`. It is cancelled only by the client disconnecting or by `Stop` (force).

To make streaming handlers shutdown-aware, link them to the service context:

```go
// in handler
ctx, cancel := context.WithCancel(stream.Context())
defer cancel()
go func() {
    select {
    case <-serviceCtx.Done():
        cancel()
    case <-ctx.Done():
    }
}()
// ... use ctx for cancellation
```

This is verbose. A middleware unary interceptor + stream interceptor can centralise it:

```go
func ShutdownInterceptor(serviceCtx context.Context) grpc.StreamServerInterceptor {
    return func(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
        ctx, cancel := context.WithCancel(ss.Context())
        defer cancel()
        go func() {
            select {
            case <-serviceCtx.Done(): cancel()
            case <-ctx.Done():
            }
        }()
        return handler(srv, wrapServerStream(ss, ctx))
    }
}
```

Now every streaming handler is automatically shutdown-aware.

### Client-streaming and bidirectional

Same as server-streaming. The principle: link stream context to service context.

---

## Appendix: Cleanup Order Gotchas

A few subtle ordering issues that show up in real services.

### Logger flush vs application drain

If your logger buffers writes (zap, zerolog with buffered writer), flushing must happen *after* the last log message. Order:

1. Shutdown application.
2. Log "shutdown complete."
3. Flush logger.

If you flush before logging the completion, the "shutdown complete" line never appears in the log.

### Metrics flush vs application drain

Same principle. Last metric increment (e.g., `shutdown_total`) should happen before the metrics exporter is flushed.

### Sentry flush vs main return

`sentry.Flush` blocks until events are sent. Place it as the last `defer` in `main` (or first deferred, since defers run LIFO):

```go
func main() {
    defer sentry.Flush(2 * time.Second) // runs LAST
    // ... other defers ...
    run()
}
```

Order of `defer`:

```go
defer A() // runs LAST
defer B() // runs middle
defer C() // runs FIRST
```

So the LAST-deferred function runs FIRST, and the FIRST-deferred function runs LAST. Read carefully.

### Database close vs read-only background goroutine

A background goroutine that reads from the database every minute (a cache refresher, for example) must exit *before* the database is closed. Otherwise it hits a closed connection.

The ordering:

1. Cancel `serviceCtx` (background goroutine's loop observes Done).
2. Wait for goroutine to exit (via `WaitGroup` or `errgroup`).
3. Close database.

This is why mid-level main code uses `errgroup`: it gives a clean place to wait for all background goroutines before closing dependencies.

---

## Appendix: Race Conditions in Shutdown Code

Shutdown code is prone to its own race conditions.

### Race 1: signal arrives during startup

```go
ctx, stop := signal.NotifyContext(...)
defer stop()
// SIGTERM arrives here, before db.Open returns
db, err := openDB(ctx) // db.Open observes ctx.Err() and aborts
```

The fix: pass `ctx` to startup operations. They observe cancellation and abort cleanly. The whole `run()` returns the cancellation error. `main`'s `log.Fatalf` reports it.

### Race 2: shutdown coordinator starts before listener is ready

```go
g.Go(func() error {
    return srv.ListenAndServe() // doesn't start until scheduled
})
g.Go(func() error {
    <-gctx.Done()
    return srv.Shutdown(ctx) // may run before ListenAndServe started
})
```

In practice, `Shutdown` on a server that never called `ListenAndServe` is a no-op. Not a race so much as "redundant call." Safe.

### Race 3: double-shutdown

If two paths trigger shutdown concurrently (signal + crashing goroutine), both call `Shutdown` on the same server. Calls after the first return `http.ErrServerClosed`. Idempotent and safe.

### Race 4: goroutine reads channel concurrently with close

```go
go func() { for j := range jobs { ... } }()
close(jobs)
```

Safe. `close` and `range` are race-free by design.

```go
go func() { for { select { case j := <-jobs: ... } } }()
close(jobs)
```

After close, `<-jobs` returns the zero value and `ok=false`. Code that doesn't check `ok` silently processes zero-value jobs. The fix:

```go
case j, ok := <-jobs:
    if !ok { return }
    process(j)
```

### Race 5: `atomic.Bool` plus `time.Sleep`

```go
ready.Store(false)
time.Sleep(readyDelay)
srv.Shutdown(ctx)
```

What if `time.Sleep` is interrupted? It is not. `time.Sleep` is not cancellable. To make it cancellable in shutdown:

```go
ready.Store(false)
select {
case <-time.After(readyDelay):
case <-shutdownCtx.Done():
}
srv.Shutdown(shutdownCtx)
```

Now the readyDelay does not exceed the total budget if the budget shrinks.

---

## Appendix: Reading List

Resources to deepen mid-level understanding:

- Brad Fitzpatrick, "Go's HTTP/2 server" — covers GOAWAY semantics.
- Russ Cox, "context.Context" — origin story and design rationale.
- Kubernetes docs, "Pod Lifecycle" — definitive source for termination order.
- nginx documentation, "Graceful Shutdown" — non-Go but informative parallel.
- Envoy docs, "Connection draining" — LB-side view of the same problem.
- Dave Cheney, "Don't just check errors, handle them gracefully" — applies to shutdown errors too.

Each is a 20-minute read. A weekend spent on this list pays off for years.

---

## Closing

If you walked away from the junior file with "shutdown is a recipe," walk away from this one with "shutdown is a coordinated system." The next file zooms further out: how a fleet of services shut down together, and the architectural patterns that make it possible at scale.

---

## Appendix: Final Mid-Level Checklist

A condensed list of mid-level decisions every service must make:

- **Which signals do I catch?** `SIGINT` and `SIGTERM` at minimum. `SIGHUP` if you want reload.
- **What is my total shutdown budget?** Pick a number. Default 25 seconds.
- **What is my `terminationGracePeriodSeconds`?** Should be budget + preStop sleep + margin.
- **Do I have a readiness probe?** Yes. Flip to 503 during shutdown.
- **Do I have a `preStop` hook?** Yes, or implement `readyDelay` in code.
- **What is my dependency order?** Listener first to drain, dependencies in reverse-startup order.
- **What runs in parallel?** Inbound servers (HTTP + gRPC). Outbound clients can be parallel too.
- **What runs in sequence?** DB close must follow application drain.
- **Do I observe shutdown?** Metrics: started, duration, phase timings. Logs: every transition.
- **Do I test shutdown?** Integration test that asserts clean exit within budget.
- **Do I chaos-test shutdown?** Slow downstream, double SIGTERM, SIGKILL fallback.

A service that has answers for each is mid-level production-ready. Senior layer adds architecture and fleet concerns.

---

## Appendix: Trade-offs Cheatsheet

| Decision | Option A | Option B | Trade-off |
|---|---|---|---|
| Worker mid-job at shutdown | Finish + ack | Stop + nack | Latency vs duplication |
| Drain inbound | Parallel | Sequential | Speed vs isolation |
| `preStop` hook | yes (5s sleep) | no | Cleaner vs simpler |
| `terminationGracePeriodSeconds` | 30s | 60s | Deploy speed vs drain safety |
| HTTP timeouts | aggressive (5s) | lenient (60s) | Drain speed vs client tolerance |

There is no universally correct choice; each service balances differently. The mid-level engineer's job is to make these trade-offs explicit and document them.




