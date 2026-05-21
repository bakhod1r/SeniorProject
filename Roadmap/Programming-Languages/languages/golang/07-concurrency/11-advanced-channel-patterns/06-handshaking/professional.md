---
layout: default
title: Handshaking — Professional
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/professional/
---

# Handshaking — Professional

[← Back](../)

> What handshakes look like in real services — the patterns that survive contact with on-call rotations, chaos engineering, and twelve-month uptime requirements.

## Table of Contents
1. [The professional mindset](#the-professional-mindset)
2. [Worker pool with health-check handshake](#worker-pool-with-health-check-handshake)
3. [Leader election with promotion ack](#leader-election-with-promotion-ack)
4. [Connection pool drain](#connection-pool-drain)
5. [Distributed handshake analogues](#distributed-handshake-analogues)
6. [Observability for handshakes](#observability-for-handshakes)
7. [Code review checklist](#code-review-checklist)

---

## The professional mindset

By the time you write production handshakes you have stopped asking "does this compile" and started asking "what happens when X fails at the worst possible moment." The questions to internalise:

1. **What does my goroutine guarantee to clean up before returning?** Files closed, connections returned, metrics flushed, locks released.
2. **What does my caller guarantee before letting me return?** Resources allocated, dependencies started, sentinel state observed.
3. **What does the handshake *prove*?** Not that the protocol completed — but that the *resource state* is consistent on both sides.

Every handshake in this file answers all three. If you cannot answer them about your own code, the handshake is not done.

---

## Worker pool with health-check handshake

A production worker pool needs three handshakes:

1. **Startup ack** — each worker confirms it has connected to its backing store before the pool reports ready.
2. **Health probe** — periodic ping/pong on a side channel; failure removes the worker.
3. **Drain on shutdown** — workers finish in-flight jobs before returning.

```go
package pool

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Job struct {
    Payload []byte
    Reply   chan Result
}

type Result struct {
    Body []byte
    Err  error
}

type Worker struct {
    id       int
    jobs     chan Job
    ping     chan struct{}
    pong     chan struct{}
    quit     chan struct{}
    stopped  chan struct{}
    started  chan struct{}
    dependency *backend // connection or whatever
}

func newWorker(id int) *Worker {
    return &Worker{
        id:      id,
        jobs:    make(chan Job),
        ping:    make(chan struct{}),
        pong:    make(chan struct{}, 1),
        quit:    make(chan struct{}),
        stopped: make(chan struct{}),
        started: make(chan struct{}),
    }
}

func (w *Worker) Run() {
    defer close(w.stopped)
    // initialise dependency before signalling started
    b, err := connectBackend()
    if err != nil {
        // started is never closed; the pool will observe a timeout
        return
    }
    w.dependency = b
    close(w.started)

    for {
        select {
        case <-w.quit:
            w.dependency.Close()
            return
        case <-w.ping:
            select {
            case w.pong <- struct{}{}:
            default:
            }
        case j := <-w.jobs:
            j.Reply <- w.handle(j)
        }
    }
}

func (w *Worker) handle(j Job) Result {
    body, err := w.dependency.Do(j.Payload)
    return Result{Body: body, Err: err}
}

func (w *Worker) WaitStarted(ctx context.Context) error {
    select {
    case <-w.started:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (w *Worker) HealthCheck(timeout time.Duration) bool {
    // drain stale pong
    select {
    case <-w.pong:
    default:
    }
    select {
    case w.ping <- struct{}{}:
    case <-time.After(timeout):
        return false
    }
    select {
    case <-w.pong:
        return true
    case <-time.After(timeout):
        return false
    }
}

func (w *Worker) Stop(ctx context.Context) error {
    close(w.quit)
    select {
    case <-w.stopped:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

type Pool struct {
    mu      sync.RWMutex
    healthy []*Worker
    quit    chan struct{}
}

func New(size int, startupTimeout time.Duration) (*Pool, error) {
    p := &Pool{quit: make(chan struct{})}
    workers := make([]*Worker, size)
    for i := range workers {
        workers[i] = newWorker(i)
        go workers[i].Run()
    }
    ctx, cancel := context.WithTimeout(context.Background(), startupTimeout)
    defer cancel()
    for _, w := range workers {
        if err := w.WaitStarted(ctx); err != nil {
            // tear down anyone who started
            for _, w := range workers {
                _ = w.Stop(context.Background())
            }
            return nil, fmt.Errorf("worker %d did not start: %w", w.id, err)
        }
    }
    p.healthy = workers
    go p.healthLoop()
    return p, nil
}

func (p *Pool) healthLoop() {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-p.quit:
            return
        case <-t.C:
            p.mu.Lock()
            alive := p.healthy[:0]
            for _, w := range p.healthy {
                if w.HealthCheck(500 * time.Millisecond) {
                    alive = append(alive, w)
                }
            }
            p.healthy = alive
            p.mu.Unlock()
        }
    }
}
```

What the handshakes accomplish:

- **Startup**: `New` returns only after every worker has connected. The caller can assume every worker is functional.
- **Health**: `ping/pong` is a tiny handshake — send a struct, expect one back within a deadline. A worker that has deadlocked on its dependency cannot respond and is evicted.
- **Drain on shutdown**: `Stop` closes `quit`, then waits on `stopped`. The dependency is closed inside the goroutine, on the same line that owns it.

---

## Leader election with promotion ack

In a leader-elected service, the freshly-promoted leader must wait for the old leader to step down before accepting writes. Otherwise two nodes simultaneously hold the lease in the application's eyes — split-brain.

The handshake (run inside each node):

```go
type Node struct {
    role        atomic.Pointer[Role]
    stepDown    chan struct{}
    steppedDown chan struct{}
    promoted    chan struct{}
}

type Role struct {
    Name string // "leader" or "follower"
}

func (n *Node) Promote(ctx context.Context) error {
    select {
    case <-n.promoted:
        // already promoted
        return nil
    default:
    }
    // 1. Wait for any prior tenure to clean up.
    select {
    case <-n.steppedDown:
    case <-ctx.Done():
        return ctx.Err()
    }
    // 2. Atomic role swap.
    r := &Role{Name: "leader"}
    n.role.Store(r)
    close(n.promoted)
    return nil
}

func (n *Node) Demote(ctx context.Context) error {
    select {
    case <-n.stepDown:
        // already demoting
    default:
        close(n.stepDown)
    }
    select {
    case <-n.steppedDown:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (n *Node) RunLeader() {
    defer close(n.steppedDown)
    for {
        select {
        case <-n.stepDown:
            // drain in-flight writes
            n.drainWrites()
            return
        case req := <-n.writes:
            n.handleWrite(req)
        }
    }
}
```

The lease-management code calls `Demote` on the losing node and `Promote` on the winning node. `Promote` blocks until `steppedDown` is closed, which the losing node closes only after `drainWrites` has flushed every pending operation. The window of "two leaders" is closed.

Why a channel and not just a flag?

A flag — `atomic.LoadInt32(&isLeader)` — tells you only the *current* value. It does not tell you that the previous tenant has *finished*. Only the channel close — paired with the `defer` placement on the last line before return — proves that.

---

## Connection pool drain

Database and HTTP connection pools (e.g., `database/sql.DB`, `*http.Transport`) expose a `Close` that performs an internal handshake: stop accepting new checkouts, wait for in-flight checkouts to return, then close idle connections. Inside `database/sql.DB`:

```go
func (db *DB) Close() error {
    // 1. Mark closed; new connections fail fast.
    db.mu.Lock()
    db.closed = true
    // 2. Cancel cleaner goroutine; wait for it.
    close(db.stop)
    db.mu.Unlock()
    <-db.cleanerCh // implicit "stopped"
    // 3. Close pooled connections.
    return db.closeAll()
}
```

When you wrap third-party code in your own service, mirror this contract. The user of your library expects `Close()` to be a complete handshake — input refused, in-flight drained, resources released — by the time it returns.

---

## Distributed handshake analogues

The patterns above generalise to gRPC and HTTP services.

### Readiness probe

Kubernetes pulls `/readyz` until it returns 200. Your handler is the moral equivalent of the `started` channel — it must report ready *only after* the service has finished connecting to its dependencies.

```go
type App struct {
    readyAt atomic.Pointer[time.Time]
}

func (a *App) Startup() {
    // ... connect to DB, warm caches
    now := time.Now()
    a.readyAt.Store(&now)
}

func (a *App) ReadyHandler(w http.ResponseWriter, r *http.Request) {
    if a.readyAt.Load() == nil {
        http.Error(w, "starting up", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
}
```

### Graceful shutdown over SIGTERM

The pod receives SIGTERM. The expected sequence: stop accepting new connections; drain in-flight requests; report unready to the load balancer; exit.

```go
func main() {
    srv := &http.Server{Addr: ":8080", Handler: app}
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)

    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatal(err)
        }
    }()

    <-sigs
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    _ = srv.Shutdown(ctx) // implicit handshake: returns when drain completes
}
```

`Shutdown` is the language-level handshake; `terminationGracePeriodSeconds` in the pod spec is the orchestrator-level one. Both must agree, or Kubernetes will `SIGKILL` you mid-drain.

---

## Observability for handshakes

You cannot debug what you cannot see. Production handshakes need three signals:

### 1. Counter on each terminal state

```go
var (
    workersStarted = promauto.NewCounter(prom.CounterOpts{Name: "worker_started_total"})
    workersStopped = promauto.NewCounter(prom.CounterOpts{Name: "worker_stopped_total"})
)

func (w *Worker) Run() {
    defer workersStopped.Inc()
    // ...
    workersStarted.Inc()
}
```

A divergence — started > stopped + N goroutines — points at a leak.

### 2. Histogram of handshake duration

```go
var startupDuration = promauto.NewHistogram(prom.HistogramOpts{
    Name:    "worker_startup_seconds",
    Buckets: prom.ExponentialBuckets(0.001, 2, 15),
})

start := time.Now()
// ... setup
close(started)
startupDuration.Observe(time.Since(start).Seconds())
```

p99 startup time is the first thing to spike when a backing service degrades.

### 3. Log every step

```go
log.Info("worker starting", "id", w.id)
// ... setup
log.Info("worker ready", "id", w.id, "took", time.Since(start))
defer log.Info("worker stopped", "id", w.id)
```

Structured logs let you correlate a goroutine's lifecycle with the rest of the request trace. A goroutine that logs "starting" and never "ready" tells you exactly where it parked.

---

## Code review checklist

Before approving a PR that introduces a new handshake:

- [ ] Every channel has a documented owner (the goroutine that allocates and closes it).
- [ ] Every `close(c)` is reachable from exactly one goroutine, or guarded by `sync.Once`.
- [ ] Every blocking receive has either a `select` with `<-ctx.Done()` or a defensible justification.
- [ ] Reply channels are buffered with capacity 1 unless rendezvous is desired.
- [ ] Started handshakes signal *after* observable state is initialised.
- [ ] Stop handshakes have a paired `stopped` channel.
- [ ] Metrics and structured logs exist for both ends of each handshake.
- [ ] Unit tests exercise the timeout path: cancel the context *before* the handshake completes.

The list is short. Walk it before merging anything in a service that runs in production. The bugs you do not catch here you will catch at 3 AM.
