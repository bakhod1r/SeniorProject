---
layout: default
title: Steady-State — Middle
parent: Steady-State
grand_parent: Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/06-steady-state/middle/
---

# Steady-State — Middle

[← Back](../)

## Table of Contents

1. [Where we are](#where-we-are)
2. [Bounded queues — three shedding policies](#bounded-queues--three-shedding-policies)
3. [The worker pool, revisited](#the-worker-pool-revisited)
4. [Per-tenant resource isolation](#per-tenant-resource-isolation)
5. [Goroutine budgets via `semaphore.Weighted`](#goroutine-budgets-via-semaphoreweighted)
6. [Connection pool steady-state — `sql.DB`](#connection-pool-steady-state--sqldb)
7. [Connection pool steady-state — `http.Transport`](#connection-pool-steady-state--httptransport)
8. [Connection pool steady-state — gRPC](#connection-pool-steady-state--grpc)
9. [Leak budgets and accounting](#leak-budgets-and-accounting)
10. [Cache TTL and bounded LRUs](#cache-ttl-and-bounded-lrus)
11. [Background work — tickers and timers, done right](#background-work--tickers-and-timers-done-right)
12. [Putting it together — a steady-state service](#putting-it-together--a-steady-state-service)
13. [Tricky points](#tricky-points)
14. [Common middle-tier mistakes](#common-middle-tier-mistakes)
15. [Self-assessment](#self-assessment)
16. [Summary](#summary)

---

## Where we are

The junior page taught the three habits: bound the queue, cap the goroutines, pair every acquire with a release. With those three you avoid most production incidents. The middle page is about the next layer: making those habits *robust* under real workloads where tenants are unequal, upstreams are flaky, and queues are not the only resources you have to manage.

After this page you will:

- Choose between shed-on-full, block-on-full, and load-shedding based on workload semantics.
- Implement a per-tenant semaphore that bounds blast radius.
- Tune `sql.DB`, `http.Transport`, and gRPC `ClientConn` for steady-state behaviour.
- Define a leak budget and an alert that fires when the budget is exceeded.
- Build a cache that has a real bound, not just a hope.

---

## Bounded queues — three shedding policies

When a queue is full, the producer faces a decision. There are three good policies; pick the one that matches your workload.

### Policy 1 — Shed (drop)

The producer drops the new item and returns an error or increments a counter.

```go
select {
case jobs <- job:
    return nil
case <-ctx.Done():
    return ctx.Err()
default:
    droppedCounter.Inc()
    return ErrQueueFull
}
```

Use when:

- Upstream can retry (or the data is best-effort: metrics, sampled logs, analytics events).
- Latency matters more than completeness.
- The cost of holding the item is high (e.g., a request that holds a transactional lock).

### Policy 2 — Block

The producer waits until a slot opens. Latency degrades; no data is lost.

```go
select {
case jobs <- job:
    return nil
case <-ctx.Done():
    return ctx.Err()
}
```

Use when:

- Data is mandatory (financial transactions, audit logs).
- Upstream can absorb back-pressure (a synchronous RPC handler).
- The context has a deadline so the wait is bounded.

### Policy 3 — Load-shed (admission control)

A variant of shed: the producer rejects items *probabilistically* based on queue depth. Above a low watermark, ramp up the rejection probability. This smooths the transition from "fully accepting" to "fully rejecting."

```go
func shedProbability(depth, cap int) float64 {
    low := cap * 7 / 10
    high := cap * 9 / 10
    if depth < low {
        return 0
    }
    if depth >= high {
        return 1
    }
    return float64(depth-low) / float64(high-low)
}

func submitWithLoadShed(job Job) error {
    if rand.Float64() < shedProbability(len(jobs), cap(jobs)) {
        return ErrShed
    }
    select {
    case jobs <- job:
        return nil
    default:
        return ErrQueueFull
    }
}
```

Use when:

- You want a graceful degradation curve instead of a cliff.
- Tail-latency matters and you can tolerate a small rejection rate to preserve headroom.

In practice, load-shedding shows up at the API gateway, not inside individual workers. But the principle applies anywhere there is a hot queue.

---

## The worker pool, revisited

The junior pool was a fixed number of workers and a bounded queue. The middle pool adds:

1. **Per-worker metrics.** In-flight count, processing time histogram, errors.
2. **Configurable policy.** Shed, block, or block-with-deadline.
3. **Graceful stop.** Drain in-flight jobs, deny new ones, bounded by a deadline.

```go
type Pool struct {
    jobs chan func()
    wg   sync.WaitGroup
    metrics PoolMetrics
    closed atomic.Bool
}

type PoolMetrics struct {
    InFlight   atomic.Int64
    Submitted  atomic.Int64
    Dropped    atomic.Int64
    Completed  atomic.Int64
    DurationNS atomic.Int64
}

func NewPool(workers, queueSize int) *Pool {
    p := &Pool{jobs: make(chan func(), queueSize)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for job := range p.jobs {
        p.metrics.InFlight.Add(1)
        start := time.Now()
        job()
        p.metrics.DurationNS.Add(int64(time.Since(start)))
        p.metrics.Completed.Add(1)
        p.metrics.InFlight.Add(-1)
    }
}

type SubmitMode int

const (
    Shed SubmitMode = iota
    Block
    BlockWithCtx
)

func (p *Pool) Submit(ctx context.Context, mode SubmitMode, job func()) error {
    if p.closed.Load() {
        return ErrClosed
    }
    p.metrics.Submitted.Add(1)
    switch mode {
    case Shed:
        select {
        case p.jobs <- job:
            return nil
        default:
            p.metrics.Dropped.Add(1)
            return ErrQueueFull
        }
    case Block:
        p.jobs <- job
        return nil
    case BlockWithCtx:
        select {
        case p.jobs <- job:
            return nil
        case <-ctx.Done():
            p.metrics.Dropped.Add(1)
            return ctx.Err()
        }
    }
    return errors.New("unknown mode")
}

func (p *Pool) Stop(ctx context.Context) error {
    if !p.closed.CompareAndSwap(false, true) {
        return ErrAlreadyClosed
    }
    close(p.jobs)
    done := make(chan struct{})
    go func() {
        p.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

### What changed

- Submit takes a mode argument. The caller decides the policy.
- Metrics are atomic counters, exported separately.
- Stop is bounded by a context, so a stuck worker cannot block forever.
- A `closed` flag prevents new submissions after Stop.

### What to expose

Wire the metrics to your monitoring system:

- `pool_in_flight` — current concurrent jobs.
- `pool_submitted_total` — counter of all submits.
- `pool_dropped_total` — counter of all drops.
- `pool_completed_total` — counter of all completions.
- `pool_duration_seconds` — histogram of job duration.

Then dashboards can show: drop rate as a fraction of submit rate, in-flight as a fraction of worker count, p99 duration over time.

---

## Per-tenant resource isolation

A service that handles many tenants must not let one tenant's pathology consume all the resources. Otherwise: a single misbehaving customer's traffic spike makes every other customer's latency rise.

### The semaphore-per-tenant pattern

Give each tenant a weighted semaphore. Calls from tenant T must `Acquire` the tenant's semaphore before doing work. If tenant T is oversubscribed, *only T's* calls queue. Other tenants are unaffected.

```go
import "golang.org/x/sync/semaphore"

type TenantLimit struct {
    mu        sync.Mutex
    sems      map[string]*semaphore.Weighted
    perTenant int64
    lastUsed  map[string]time.Time
    idleTTL   time.Duration
}

func NewTenantLimit(perTenant int64, idleTTL time.Duration) *TenantLimit {
    t := &TenantLimit{
        sems:      make(map[string]*semaphore.Weighted),
        perTenant: perTenant,
        lastUsed:  make(map[string]time.Time),
        idleTTL:   idleTTL,
    }
    go t.gc()
    return t
}

func (t *TenantLimit) get(tenant string) *semaphore.Weighted {
    t.mu.Lock()
    defer t.mu.Unlock()
    sem, ok := t.sems[tenant]
    if !ok {
        sem = semaphore.NewWeighted(t.perTenant)
        t.sems[tenant] = sem
    }
    t.lastUsed[tenant] = time.Now()
    return sem
}

func (t *TenantLimit) Do(ctx context.Context, tenant string, fn func()) error {
    sem := t.get(tenant)
    if err := sem.Acquire(ctx, 1); err != nil {
        return err
    }
    defer sem.Release(1)
    fn()
    return nil
}

// gc removes tenants that haven't been used for idleTTL.
// Without this, the map grows forever for any service whose
// tenant IDs rotate.
func (t *TenantLimit) gc() {
    ticker := time.NewTicker(t.idleTTL / 2)
    defer ticker.Stop()
    for range ticker.C {
        cutoff := time.Now().Add(-t.idleTTL)
        t.mu.Lock()
        for tenant, last := range t.lastUsed {
            if last.Before(cutoff) {
                delete(t.sems, tenant)
                delete(t.lastUsed, tenant)
            }
        }
        t.mu.Unlock()
    }
}
```

### Why the GC matters

The first version of this pattern in many production services *forgot* the GC. It looked like:

```go
func (t *TenantLimit) get(tenant string) *semaphore.Weighted {
    if sem, ok := t.sems[tenant]; ok {
        return sem
    }
    sem := semaphore.NewWeighted(t.perTenant)
    t.sems[tenant] = sem
    return sem
}
```

This works perfectly until tenant IDs rotate (session IDs, request IDs, ephemeral users). Then `sems` grows by one entry per request, forever. A classic steady-state bug. The GC goroutine is the price of admission.

### When to use it

- Any multi-tenant service.
- Any service whose hot path can be parameterised by a "shard key" — customer ID, organisation ID, API key.
- Services that have explicit SLOs per tenant (you can give "premium" tenants a higher weight).

### When not to

- A service with a small, fixed number of tenants (the per-tenant semaphore overhead may exceed the benefit).
- A service where tenants are effectively trusted to behave (intra-service calls between trusted teams).

---

## Goroutine budgets via `semaphore.Weighted`

`semaphore.Weighted` is the standard way to cap concurrent goroutines for a given workload — alternative to or in combination with a fixed worker pool.

```go
import "golang.org/x/sync/semaphore"

var globalSem = semaphore.NewWeighted(100) // 100 concurrent goroutines

func handler(ctx context.Context) error {
    if err := globalSem.Acquire(ctx, 1); err != nil {
        return err
    }
    defer globalSem.Release(1)
    // do work
    return nil
}
```

### Compared with a worker pool

- A worker pool has *fixed* goroutines pulling from a queue. Best when jobs are short and the per-spawn cost matters.
- A semaphore allows the *caller* to choose when to spawn. Best when the caller already has work-specific code and just needs concurrency control.

### Weighted variants

The "1" in `Acquire(ctx, 1)` is the weight. You can also have heterogeneous jobs:

```go
// Small jobs cost 1, large jobs cost 10.
sem := semaphore.NewWeighted(100)

func small(ctx context.Context) error {
    sem.Acquire(ctx, 1)
    defer sem.Release(1)
    // ...
    return nil
}

func large(ctx context.Context) error {
    sem.Acquire(ctx, 10)
    defer sem.Release(10)
    // ...
    return nil
}
```

This lets you express "at most ten large jobs concurrently, or one hundred small jobs, or any combination that sums to one hundred."

---

## Connection pool steady-state — `sql.DB`

`database/sql.DB` is a connection *pool*, not a connection. Configuration is your responsibility.

### The four knobs

```go
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(25)
db.SetConnMaxLifetime(30 * time.Minute)
db.SetConnMaxIdleTime(5 * time.Minute)
```

- **`MaxOpenConns`** — hard cap on total connections (in-use + idle). Beyond this, callers block on `Acquire` until a connection is returned.
- **`MaxIdleConns`** — pool of warm idle connections. Lower than `MaxOpenConns` is wasteful (the pool will close usable connections); equal is the most common choice.
- **`ConnMaxLifetime`** — max age before recycling. Defends against stale connections after database-side restarts and credential rotations.
- **`ConnMaxIdleTime`** — max idle time before closing. Defends against pools that grow during burst and never shrink.

### Picking `MaxOpenConns`

Start from the database's `max_connections` divided by the number of replicas of your service. If Postgres is set to 200 and your service has eight replicas, you have twenty-five connections per replica before you risk denying service to other clients.

Then, within that budget, pick a number large enough to saturate your workload. A simple heuristic: if your peak QPS is Q and the median query time is T seconds, you need about `Q * T` concurrent connections. Add headroom (maybe 50%).

Example: Q = 200 RPS, T = 10 ms. Concurrent connections ≈ 2; with headroom, 5. Set `MaxOpenConns = 5`. This is much less than most teams default to, and it tends to be *correct*.

### Picking `ConnMaxLifetime`

Half an hour is a reasonable default. Lower (5–10 minutes) if your database has frequent restarts or your DNS routing is dynamic. Higher (an hour) if dial cost is high and your environment is stable.

### Monitoring

`db.Stats()` returns a `sql.DBStats` struct:

```go
type DBStats struct {
    MaxOpenConnections int
    OpenConnections    int
    InUse              int
    Idle               int
    WaitCount          int64        // cumulative
    WaitDuration       time.Duration // cumulative
    MaxIdleClosed      int64
    MaxIdleTimeClosed  int64
    MaxLifetimeClosed  int64
}
```

The two that matter for steady-state: `WaitCount` and `WaitDuration`. If they are climbing, your pool is too small. Export them as counters and compute the rate.

### A common bug — leaked rows

```go
rows, err := db.QueryContext(ctx, "SELECT ...")
if err != nil {
    return err
}
// BUG: missing defer rows.Close()
for rows.Next() {
    ...
}
return nil
```

`rows.Next()` returns `false` at the end of a result set and closes the underlying connection. But if an error in the loop body causes an early return *before* the loop finishes, the connection is leaked back into the pool. Always:

```go
defer rows.Close()
```

The deferred `Close` is a no-op if the rows are already closed, so it is safe to add unconditionally.

---

## Connection pool steady-state — `http.Transport`

The default `http.Client` uses a shared `http.DefaultTransport`. Its defaults are unsuitable for most production services.

### The default

```go
// What http.DefaultTransport looks like, approximately:
&http.Transport{
    MaxIdleConns:        100,
    MaxIdleConnsPerHost: 2,    // very low
    IdleConnTimeout:     90 * time.Second,
    TLSHandshakeTimeout: 10 * time.Second,
}
```

The killer is `MaxIdleConnsPerHost = 2`. If your service makes a hundred RPS to a single upstream, you can keep at most two connections warm. Every other call dials a fresh TCP+TLS connection, and you pay the latency and FD cost.

### A production baseline

```go
tr := &http.Transport{
    MaxIdleConns:        200,
    MaxIdleConnsPerHost: 50,
    MaxConnsPerHost:     100, // hard cap on concurrent in-flight + idle
    IdleConnTimeout:     90 * time.Second,
    TLSHandshakeTimeout: 5 * time.Second,
    ResponseHeaderTimeout: 10 * time.Second,
    ExpectContinueTimeout: 1 * time.Second,
}
client := &http.Client{
    Transport: tr,
    Timeout:   30 * time.Second,
}
```

Why each value:

- `MaxIdleConnsPerHost = 50`: enough to keep most calls on warm connections at typical fan-out.
- `MaxConnsPerHost = 100`: hard cap; calls queue inside Transport if exceeded. Prevents runaway connection counts during burst.
- `IdleConnTimeout = 90s`: long enough to amortise TLS handshakes across reasonable gaps, short enough that idle hosts release FDs.
- `TLSHandshakeTimeout = 5s`: protects against slow upstreams blocking new dials.
- `Client.Timeout = 30s`: a backstop. Every request must complete or fail within thirty seconds.

### Always drain the body

The most common steady-state bug with `http.Client` is forgetting to drain the response body:

```go
resp, err := client.Do(req)
if err != nil {
    return err
}
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

Without the drain, the connection cannot return to the keep-alive pool. The next call dials a new connection. The pool fragments.

### Per-host transport

If your service talks to many upstreams with different characteristics, give each its own transport. A slow upstream's connections won't be evicted by traffic to a fast upstream.

```go
type UpstreamClient struct {
    Slow  *http.Client // tuned for slow upstream
    Fast  *http.Client // tuned for fast upstream
}
```

---

## Connection pool steady-state — gRPC

gRPC multiplexes many streams over one HTTP/2 connection. The pool is implicit: one `ClientConn` per upstream.

### Keepalive

The most important configuration for steady-state:

```go
import "google.golang.org/grpc/keepalive"

conn, err := grpc.Dial(addr,
    grpc.WithTransportCredentials(creds),
    grpc.WithKeepaliveParams(keepalive.ClientParameters{
        Time:                30 * time.Second, // ping every 30s
        Timeout:             10 * time.Second, // wait 10s for ack
        PermitWithoutStream: false,            // only ping if streams in flight
    }),
)
```

Why:

- Without keepalive, an HTTP/2 connection can sit idle for hours, traverse a NAT timeout, and become a half-open connection. The next call hangs.
- The server has matching `keepalive.ServerParameters` and `EnforcementPolicy`. They must agree, or the server will disconnect you for pinging too often.

### Connection reuse

Each `ClientConn` is itself a small pool internally. Reuse it across calls; never create one per request.

### Load balancing

If your upstream has multiple instances, use `grpc.WithDefaultServiceConfig` to configure a load balancing policy (`round_robin` is a common default). Otherwise the client may pin to a single upstream pod and miss load balancing entirely.

### Idle connections

gRPC does not have an `IdleConnTimeout` equivalent. A `ClientConn` lives until you explicitly `Close()` it. For long-running services this is fine; for services that create connections dynamically (e.g., one per tenant), you must track and close them.

---

## Leak budgets and accounting

A leak budget is an explicit acceptance that some growth is allowed. The discipline is:

1. Pick a budget. "Memory growth no greater than fifty megabytes per day."
2. Verify deploys reset it. "We deploy at least weekly, so the maximum drift is three hundred fifty megabytes — well below the container limit."
3. Alert on excursions. "Growth greater than the budget for two consecutive hours is a page."

### Why leak budgets are useful

Without a budget, you have two options:

- "No growth ever." Hard to achieve, often requires more engineering than the leak is worth.
- "Growth is fine." No alert ever fires, until the day the leak rate spikes.

A budget converts a binary decision into a continuous one. You can ship the simpler code that has a small leak, as long as the leak is small and bounded.

### Implementing the budget

A budget needs a measurement and an alert:

```promql
# Prometheus example: alert on heap growth beyond budget
deriv(go_memstats_heap_inuse_bytes[1h]) > 50 * 1024 * 1024 / 86400
# i.e., growth rate above 50 MB per day
```

The `deriv` function computes the slope. Multiply your budget by the appropriate time unit. Alert when the slope is sustained over an observation window.

### When budgets break down

- **Deploy cadence is irregular.** A budget that assumes weekly deploys is invalidated by a two-week pause.
- **Leak rate is non-linear.** A leak that grows exponentially can be inside budget for a week and then explode in a day.
- **Multiple leaks compose.** Two budgets of fifty megabytes per day each become a hundred megabytes per day combined.

Treat the budget as a tool, not a guarantee. Periodically audit the actual leak rate; investigate any change.

---

## Cache TTL and bounded LRUs

A `map[K]V` used as a cache is a leak unless you bound it. There are two ways to bound: by size or by age. Most production caches use both.

### A bounded LRU

`github.com/hashicorp/golang-lru/v2` is the standard. It is fixed-size and evicts the least-recently-used entry on overflow.

```go
import lru "github.com/hashicorp/golang-lru/v2"

cache, _ := lru.New[string, []byte](10000) // hard cap at 10000 entries
cache.Add("foo", []byte("bar"))
v, ok := cache.Get("foo")
```

The cache is steady-state by construction: it cannot grow past 10000 entries.

### TTL-based eviction

`github.com/dgraph-io/ristretto` or your own ticker-based sweeper:

```go
type TTLCache struct {
    mu sync.RWMutex
    m  map[string]ttlEntry
}

type ttlEntry struct {
    value     []byte
    expiresAt time.Time
}

func (c *TTLCache) Set(k string, v []byte, ttl time.Duration) {
    c.mu.Lock()
    c.m[k] = ttlEntry{value: v, expiresAt: time.Now().Add(ttl)}
    c.mu.Unlock()
}

func (c *TTLCache) Get(k string) ([]byte, bool) {
    c.mu.RLock()
    e, ok := c.m[k]
    c.mu.RUnlock()
    if !ok || time.Now().After(e.expiresAt) {
        return nil, false
    }
    return e.value, true
}

func (c *TTLCache) Sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    for k, e := range c.m {
        if now.After(e.expiresAt) {
            delete(c.m, k)
        }
    }
}

func (c *TTLCache) RunSweeper(ctx context.Context, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            c.Sweep()
        }
    }
}
```

Lazy TTL alone is *not* steady-state — entries that are written and never read again will live until something evicts them. The sweeper is required.

### Combining size and TTL

For most production caches, combine: an LRU bounds the worst-case memory, a TTL bounds the staleness. The `ristretto` library does both; so does `groupcache/lru` with a sweeper added.

---

## Background work — tickers and timers, done right

### `time.Ticker` — always `Stop`

```go
t := time.NewTicker(1 * time.Second)
defer t.Stop()  // required
for {
    select {
    case <-t.C:
        // ...
    case <-ctx.Done():
        return
    }
}
```

Without `Stop`, the ticker's internal goroutine keeps running until the program exits. If you create tickers in request handlers, this is a slow leak.

### `time.After` — avoid in loops

```go
// BAD
for {
    select {
    case x := <-ch:
        handle(x)
    case <-time.After(5 * time.Second):
        // ...
    }
}
```

Every iteration where `ch` fires creates a new timer that is never cleaned up until it eventually fires (five seconds later) or the runtime garbage-collects it. Under high `ch` rate, you accumulate thousands of timers.

```go
// GOOD
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    select {
    case x := <-ch:
        handle(x)
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(5 * time.Second)
    case <-t.C:
        // heartbeat
        t.Reset(5 * time.Second)
    }
}
```

This is uglier but reuses a single timer across iterations.

### `time.AfterFunc` — also leaks on early exit

```go
timer := time.AfterFunc(5*time.Second, func() { ... })
// later, when no longer needed:
timer.Stop()
```

Always stop the timer when you no longer want it to fire. Otherwise the function will still be scheduled on a goroutine when the time expires.

---

## Putting it together — a steady-state service

```go
package main

import (
    "context"
    "database/sql"
    "io"
    "log"
    "net/http"
    "os"
    "os/signal"
    "runtime/debug"
    "syscall"
    "time"

    _ "net/http/pprof"
    _ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
    debug.SetMemoryLimit(int64(3.6 * 1024 * 1024 * 1024)) // 3.6 GiB

    ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
    defer cancel()

    // Database with steady-state-friendly settings.
    db, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    db.SetMaxOpenConns(25)
    db.SetMaxIdleConns(25)
    db.SetConnMaxLifetime(30 * time.Minute)
    db.SetConnMaxIdleTime(5 * time.Minute)

    // HTTP client with steady-state-friendly transport.
    tr := &http.Transport{
        MaxIdleConns:        200,
        MaxIdleConnsPerHost: 50,
        MaxConnsPerHost:     100,
        IdleConnTimeout:     90 * time.Second,
    }
    client := &http.Client{Transport: tr, Timeout: 30 * time.Second}

    // Worker pool with bounded queue and shed-on-full.
    pool := NewPool(4, 16)
    defer pool.Stop(context.Background())

    // Per-tenant isolation.
    tenants := NewTenantLimit(10, 5*time.Minute)

    // Localhost-only pprof.
    go func() {
        _ = http.ListenAndServe("127.0.0.1:6060", nil)
    }()

    // Application HTTP server.
    srv := &http.Server{
        Addr:    ":8080",
        Handler: handler(db, client, pool, tenants),
    }
    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            log.Println(err)
        }
    }()

    <-ctx.Done()

    // Graceful shutdown.
    shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 25*time.Second)
    defer shutdownCancel()
    _ = srv.Shutdown(shutdownCtx)
    _ = pool.Stop(shutdownCtx)
}

func handler(db *sql.DB, client *http.Client, pool *Pool, tenants *TenantLimit) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        tenant := r.Header.Get("X-Tenant-ID")
        if tenant == "" {
            http.Error(w, "missing tenant", http.StatusBadRequest)
            return
        }
        if err := tenants.Do(r.Context(), tenant, func() {
            // do tenant-isolated work
            _, _ = db.ExecContext(r.Context(), "SELECT 1")
            resp, err := client.Get("https://upstream.example.com/")
            if err != nil {
                return
            }
            io.Copy(io.Discard, resp.Body)
            resp.Body.Close()
        }); err != nil {
            http.Error(w, err.Error(), http.StatusServiceUnavailable)
        }
    })
}
```

Notice every steady-state habit is here:

- `GOMEMLIMIT` set explicitly.
- Database with sized pool and lifetime.
- HTTP transport with sized pool and timeouts.
- Worker pool with bounded queue.
- Per-tenant isolation with idle GC.
- pprof on localhost only.
- Graceful shutdown bounded by a deadline.

This is roughly five hundred lines of boilerplate spread across utility packages. Every production Go service has some version of it.

---

## Tricky points

### `MaxIdleConns` interaction

If `MaxIdleConnsPerHost = 50` but `MaxIdleConns = 10`, you can't actually keep fifty idle connections per host. The global cap dominates. Make sure your numbers are consistent.

### `MaxConnsPerHost = 0` means unlimited

This is the default. The first time you forget to set it, your service opens a hundred connections to one upstream during a burst and trips a rate limiter. Always set it.

### `sql.DB.Close()` does not stop in-flight queries

If a query is running when you call `db.Close()`, the query continues to run on the database side. The client just stops waiting. In a graceful shutdown, use `db.Stats().InUse` to know when it's safe to call `Close()`.

### Tenant semaphore weights interact with downstream

A tenant semaphore of weight 10 lets one tenant use up to 10 concurrent goroutines. If those 10 goroutines each take a database connection, you have committed 10 of the 25 database connections to that one tenant. Plan the math.

### `time.NewTimer.Reset` is tricky

The standard pattern requires draining the channel:

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
t.Reset(d)
```

In Go 1.23+, `Reset` was simplified — calling it on a fired or stopped timer is safe. Check your Go version.

---

## Common middle-tier mistakes

### Mistake — Sizing the pool from the high-water mark

You measured peak concurrent queries at 50, so you set `MaxOpenConns = 50`. But the high-water mark was during an unusual incident. Most of the time, 25 is enough. Now your service permanently holds 25 connections it does not need, costing memory on the database side.

The right approach: size from steady-state, with headroom for short bursts. Use a circuit breaker to handle bursts that exceed the headroom.

### Mistake — Tenant semaphore without GC

The single most common production bug in tenant isolation: the map grows forever. Always include a GC sweeper. Test the GC sweeper.

### Mistake — `IdleConnTimeout = 0` (unlimited)

Means idle connections live forever. Each one holds a TCP socket and a TLS session. Under traffic that fans out to many hosts, you accumulate hundreds or thousands of idle connections. Set a timeout, even if a generous one.

### Mistake — Forgetting `defer rows.Close()`

Easy to forget, especially on error returns. Add a linter rule. Or use `db.QueryRowContext` (single row) whenever possible — it doesn't expose the leak path.

---

## Self-assessment

1. What are the three shedding policies, and when do you choose each?
2. Why does a tenant semaphore map need a GC sweeper?
3. What is the difference between `MaxIdleConns` and `MaxIdleConnsPerHost`?
4. Why is `MaxIdleConnsPerHost = 2` (the default) usually wrong?
5. What is a leak budget, and how do you alert on it?
6. Why is `time.After` in a hot loop a leak?
7. What does `sql.DBStats.WaitCount` tell you?
8. What's the difference between a worker pool and a `semaphore.Weighted` for capping concurrency?

---

## Backpressure in detail

Backpressure is the mechanism by which a slow consumer slows down its producer. Without backpressure, a fast producer with a slow consumer produces unbounded queueing — exactly the steady-state failure mode we are trying to prevent.

### Where backpressure happens

In a typical pipeline:

```
[ingress] -> [queue 1] -> [stage A] -> [queue 2] -> [stage B] -> [output]
```

Each queue is a place where backpressure can apply. If queue 2 is full, stage A's `submit` blocks. If stage A's input is slow because of that, queue 1 fills. If queue 1 is full, ingress's accept blocks. The slow consumer at the end has propagated backpressure all the way to the front.

### Implementing backpressure in Go

The simplest backpressure: a buffered channel acting as a queue, with the producer blocking on full.

```go
ch := make(chan Job, 16)
// Producer:
ch <- job  // blocks if full
// Consumer:
for j := range ch {
    process(j)
}
```

For HTTP servers, backpressure means: return a 503 (or hold the connection) when the worker pool's queue is full.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    err := pool.Submit(r.Context(), Shed, func() {
        // work
    })
    if errors.Is(err, ErrQueueFull) {
        w.Header().Set("Retry-After", "1")
        http.Error(w, "service overloaded", http.StatusServiceUnavailable)
        return
    }
}
```

A 503 with `Retry-After` tells the load balancer to shift load. The load balancer may also remove the pod from rotation if 503s persist.

### Kubernetes readiness gates

A pod that is overloaded can flip its readiness probe to fail:

```go
var isReady atomic.Bool
isReady.Store(true)

http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
})
http.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
    if !isReady.Load() {
        w.WriteHeader(http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})

// Monitor queue depth; flip readiness if sustained overload:
go func() {
    for {
        time.Sleep(1 * time.Second)
        if pool.QueueDepth() > pool.Capacity()*8/10 {
            isReady.Store(false)
        } else {
            isReady.Store(true)
        }
    }
}()
```

The load balancer removes the pod when readiness fails, restores it when readiness recovers. This is fleet-level backpressure.

---

## Background-task scheduling

Long-running services have periodic work: cache eviction, log rotation, snapshot compaction, metric aggregation. Each of these is a small steady-state engineering problem of its own.

### The basic pattern

```go
func runPeriodic(ctx context.Context, name string, interval time.Duration, work func(context.Context) error) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            // Bound the work duration so the next tick is not delayed.
            workCtx, cancel := context.WithTimeout(ctx, interval/2)
            if err := work(workCtx); err != nil {
                log.Printf("%s: %v", name, err)
            }
            cancel()
        }
    }
}
```

Three rules baked in:

1. The ticker is bounded by `defer t.Stop()` — no leak when the function returns.
2. The work runs with a context budget — it cannot block the next tick.
3. Errors are logged but do not panic — the task survives transient failures.

### Stagger across instances

If you have ten replicas all running a "snapshot every hour" task, they all run at minute zero of the hour — a synchronised spike that may overwhelm a downstream. Stagger by hashing the pod name:

```go
hash := fnv.New64a()
hash.Write([]byte(os.Getenv("POD_NAME")))
offset := time.Duration(hash.Sum64() % uint64(interval))
time.Sleep(offset)
runPeriodic(ctx, name, interval, work)
```

Each pod's task fires at a different offset. The downstream sees smooth load.

### Idle-time work

Some tasks should run only when the system is idle: a background reindex, a cache pre-warm. The pattern is to gate the work on a load signal.

```go
func runIdle(ctx context.Context, work func(context.Context) error) {
    t := time.NewTicker(30 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            if !isIdle() {
                continue
            }
            work(ctx)
        }
    }
}

func isIdle() bool {
    var stats runtime.MemStats
    runtime.ReadMemStats(&stats)
    // simple heuristic: idle if GC pause is low
    return stats.PauseNs[(stats.NumGC+255)%256] < uint64(time.Millisecond)
}
```

For more sophisticated load signals, sample the request queue depth, the worker pool's in-flight count, or the scheduler's latency from `runtime/metrics`.

---

## Saturation metrics for the middle layer

The senior page goes deep on the USE method. At the middle level, you need at least four metrics per resource:

| Resource | Metric |
|---|---|
| Worker pool | queue depth |
| Worker pool | in-flight count |
| Worker pool | drop count (cumulative) |
| Worker pool | per-job duration histogram |
| Database pool | `Stats().InUse` |
| Database pool | `Stats().WaitCount` (cumulative) |
| Database pool | `Stats().WaitDuration` (cumulative) |
| Database pool | `Stats().MaxLifetimeClosed` (cumulative) |
| HTTP transport | outstanding requests |
| HTTP transport | dial failures (cumulative) |
| HTTP transport | response time histogram |
| Tenant semaphore | acquired weight by tenant |
| Tenant semaphore | acquire wait time histogram |

Wire each to your monitoring system. The dashboard then has one row per resource and one panel per metric. A glance at the dashboard tells you which resource is closest to saturation.

### Building it once

A small library can wrap each resource and expose the metrics consistently:

```go
package steady

import (
    "database/sql"
    "time"
)

type DBStatsExporter struct {
    DB     *sql.DB
    Prefix string
    Send   func(name string, value float64)
}

func (e *DBStatsExporter) Start(ctx context.Context, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    var lastWaitCount int64
    var lastWaitDuration time.Duration
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            s := e.DB.Stats()
            e.Send(e.Prefix+"_in_use", float64(s.InUse))
            e.Send(e.Prefix+"_idle", float64(s.Idle))
            e.Send(e.Prefix+"_max_open", float64(s.MaxOpenConnections))
            e.Send(e.Prefix+"_wait_count_per_sec",
                float64(s.WaitCount-lastWaitCount)/interval.Seconds())
            e.Send(e.Prefix+"_wait_seconds_per_sec",
                (s.WaitDuration-lastWaitDuration).Seconds()/interval.Seconds())
            lastWaitCount = s.WaitCount
            lastWaitDuration = s.WaitDuration
        }
    }
}
```

Compose: one exporter per database, one per HTTP client, one per worker pool. Each pod ships consistent metrics.

---

## Connection pool warm-up

After process start, the connection pool is empty. The first N requests pay the dial cost. If you serve a thousand RPS and `MaxIdleConns = 25`, the first twenty-five requests are slow; the rest are fast.

To smooth this out, pre-warm at startup:

```go
func prewarmDB(ctx context.Context, db *sql.DB, n int) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
            defer cancel()
            conn, err := db.Conn(ctx)
            if err != nil {
                return
            }
            conn.Close() // returns to pool
        }()
    }
    wg.Wait()
}

func main() {
    db, _ := sql.Open(...)
    db.SetMaxOpenConns(25)
    db.SetMaxIdleConns(25)

    prewarmDB(context.Background(), db, 25)
    // pool is now warm
}
```

Same idea for HTTP. Send a few warmup requests to each upstream during startup, before declaring readiness.

### The trade-off

Warm-up delays "ready" by a second or two. In exchange, the first hundred user requests are fast, not slow. Acceptable for most services.

In Kubernetes, warmup happens between `livenessProbe` (pod is alive) and `readinessProbe` (pod can serve). If `readinessProbe` returns 200 only after warmup, the load balancer never sends a slow first request.

---

## Resource ownership patterns

A subtle middle-tier concern: who owns a resource determines who closes it. Get this wrong and you have leaks.

### Pattern: caller owns

```go
func MakeClient() *http.Client {
    return &http.Client{...}
}

func main() {
    client := MakeClient()
    // caller is responsible for not abandoning it
}
```

The function returns the resource; the caller decides its lifetime. Simple, but it places the burden on the caller.

### Pattern: callee owns, returns handle

```go
type Service struct {
    db *sql.DB
}

func NewService() (*Service, error) {
    db, err := sql.Open(...)
    if err != nil {
        return nil, err
    }
    return &Service{db: db}, nil
}

func (s *Service) Close() error {
    return s.db.Close()
}
```

The callee owns the resource and exposes Close. The caller calls Close. This is the most common pattern for long-lived services.

### Pattern: scoped (functional)

```go
func WithDB(fn func(db *sql.DB) error) error {
    db, err := sql.Open(...)
    if err != nil {
        return err
    }
    defer db.Close()
    return fn(db)
}
```

The resource lives only inside the call. Caller cannot forget to close. Useful for short-lived resources (a database used only at startup, or a temporary file).

Pick the pattern that fits the lifetime of the resource. Mismatches (long-lived resource with functional scoping; short-lived resource with caller ownership) are common steady-state bugs.

---

## A walk through realistic numbers

Let's design a hypothetical service end-to-end and pick every number.

### The workload

A user-profile API. Peak QPS: 500. p50 latency target: 20 ms. p99 latency target: 200 ms. Container memory limit: 2 GiB. Fleet maximum: 20 pods.

### The math

- Concurrent in-flight at peak ≈ 500 RPS × 0.02 s = 10 requests per pod.
- With burst absorption of 2x: 20 concurrent in-flight per pod.

### The numbers

```go
// GOMEMLIMIT: 90% of 2 GiB = 1.8 GiB
debug.SetMemoryLimit(int64(0.9 * 2 * 1024 * 1024 * 1024))

// Worker pool: 20 workers, queue twice that.
pool := NewPool(20, 40)

// Database pool: fleet max 20 pods, database max_connections 500;
// fair share is 25, take 80% to leave headroom: 20.
db.SetMaxOpenConns(20)
db.SetMaxIdleConns(20)
db.SetConnMaxLifetime(30 * time.Minute)

// HTTP transport to upstream A (a service we call about 100 times/s):
// concurrent in-flight ≈ 100 * 0.02 = 2; with 2x burst, 4. Round up to 8.
trA := &http.Transport{
    MaxIdleConnsPerHost: 8,
    MaxConnsPerHost:     20,
    IdleConnTimeout:     90 * time.Second,
}

// Per-tenant semaphore: 5 concurrent in-flight per tenant.
tenants := NewTenantLimit(5, 5*time.Minute)

// Server timeouts.
srv := &http.Server{
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       120 * time.Second,
    MaxHeaderBytes:    1 << 16,
}
```

Each number has a justification. None is arbitrary. This is the discipline.

---

## Edge cases at the middle tier

### Bursty traffic at the queue limit

The queue is sized for typical burst, not extreme burst. An extreme burst causes drops or blocks. This is *correct behaviour* — the alternative is unbounded queueing and OOM. The team needs to be comfortable seeing occasional drops in the metric.

### Tenant with weight > pool capacity

A tenant configured with weight 30 in a pool with capacity 20 cannot use all 30 even alone. The math has to be consistent. Validate at startup.

### Connection pool with `MaxOpenConns < MaxIdleConns`

Go silently caps `MaxIdleConns` to `MaxOpenConns`. Don't rely on the silent fix; set them consistently.

### Per-tenant pool of zero

A tenant configured with weight 0 (disabled) should fail fast on acquire, not block forever. `semaphore.NewWeighted(0)` behaves correctly; rolling your own probably does not.

### Multi-goroutine `Close`

What happens when two goroutines both call `pool.Stop()`? You may panic on `close(jobs)`. Guard with `atomic.Bool.CompareAndSwap`:

```go
func (p *Pool) Stop(ctx context.Context) error {
    if !p.closed.CompareAndSwap(false, true) {
        return ErrAlreadyClosed
    }
    close(p.jobs)
    // ...
}
```

---

## Best practices

A consolidated list:

1. Every long-lived resource has a name, a configured size, and a metric.
2. Every queue has a capacity and a shedding policy.
3. Every goroutine has an exit condition (context or close).
4. Every `Open`/`Acquire` is followed by a `defer Close`/`Release`.
5. Every cache has a bound (size, TTL, or both).
6. Every periodic task has a ticker that is stopped and a context-bounded run budget.
7. Every connection pool is pre-warmed at startup.
8. Every per-tenant resource has an idle GC.
9. Every metric is exported with its saturation indicator (queue depth, wait count, etc.).
10. Every alert has a runbook entry.

If your service follows all ten, you have a middle-tier steady-state service. The senior page builds on this to make the service stable under adversarial conditions; the professional page hardens it against the rare and ugly failure modes.

---

## Summary

Middle-tier steady-state is the layer above the basics:

- Bounded queues with explicit policies (shed, block, load-shed).
- Per-tenant isolation with idle GC.
- Connection pools sized to match the workload, not defaults.
- Cache structures with real bounds (LRU + TTL).
- Tickers and timers that are always `Stop`ped.
- Leak budgets with alerts on excursions.
- Backpressure that propagates from slow consumer to fast producer.
- Background tasks that are staggered and budget-aware.
- Resource ownership made explicit.

The pattern across all of these is: every long-lived resource has a name, a bound, a metric, and an alert. The job of the middle-tier engineer is to enforce that discipline across the service. The senior page goes deeper into the architecture-level decisions; the professional page tells you what happens when one of these levers is set wrong in production.

---

## Annex — Reusable building blocks

A few small utility types that every middle-tier service ends up writing. Lightly battle-tested versions of these exist in most teams' internal libraries.

### A small `runtime/metrics` exporter

```go
package rtm

import (
    "context"
    "runtime/metrics"
    "time"
)

type Sink interface {
    Gauge(name string, value float64)
    Histogram(name string, mean, p99 float64)
}

func Run(ctx context.Context, sink Sink, interval time.Duration) {
    samples := []metrics.Sample{
        {Name: "/memory/classes/heap/objects:bytes"},
        {Name: "/memory/classes/heap/free:bytes"},
        {Name: "/memory/classes/heap/released:bytes"},
        {Name: "/memory/classes/total:bytes"},
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/gc/cycles/total:gc-cycles"},
        {Name: "/gc/pauses:seconds"},
        {Name: "/gc/cpu/percent:%"},
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            metrics.Read(samples)
            for _, s := range samples {
                switch s.Value.Kind() {
                case metrics.KindUint64:
                    sink.Gauge(s.Name, float64(s.Value.Uint64()))
                case metrics.KindFloat64:
                    sink.Gauge(s.Name, s.Value.Float64())
                case metrics.KindFloat64Histogram:
                    h := s.Value.Float64Histogram()
                    sink.Histogram(s.Name, histMean(h), histQuantile(h, 0.99))
                }
            }
        }
    }
}

func histMean(h *metrics.Float64Histogram) float64 {
    var total, count float64
    for i := range h.Counts {
        mid := (h.Buckets[i] + h.Buckets[i+1]) / 2
        total += mid * float64(h.Counts[i])
        count += float64(h.Counts[i])
    }
    if count == 0 {
        return 0
    }
    return total / count
}

func histQuantile(h *metrics.Float64Histogram, q float64) float64 {
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    target := uint64(float64(total) * q)
    var seen uint64
    for i, c := range h.Counts {
        seen += c
        if seen >= target {
            return h.Buckets[i+1]
        }
    }
    return h.Buckets[len(h.Buckets)-1]
}
```

### A small `DBStats` exporter

```go
package dbm

import (
    "context"
    "database/sql"
    "time"
)

type Sink interface {
    Gauge(name string, value float64)
}

func Run(ctx context.Context, db *sql.DB, prefix string, sink Sink, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    var lastWait int64
    var lastWaitDur time.Duration
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            s := db.Stats()
            sink.Gauge(prefix+".in_use", float64(s.InUse))
            sink.Gauge(prefix+".idle", float64(s.Idle))
            sink.Gauge(prefix+".max", float64(s.MaxOpenConnections))
            sink.Gauge(prefix+".wait_count_delta", float64(s.WaitCount-lastWait))
            sink.Gauge(prefix+".wait_duration_seconds_delta", (s.WaitDuration-lastWaitDur).Seconds())
            lastWait = s.WaitCount
            lastWaitDur = s.WaitDuration
        }
    }
}
```

### A small bounded LRU wrapper

If you don't want to pull in `hashicorp/golang-lru`, here is a minimal implementation:

```go
package lru

import "sync"

type LRU[K comparable, V any] struct {
    mu       sync.Mutex
    cap      int
    items    map[K]*node[K, V]
    head     *node[K, V] // most recent
    tail     *node[K, V] // least recent
}

type node[K comparable, V any] struct {
    key  K
    val  V
    prev *node[K, V]
    next *node[K, V]
}

func New[K comparable, V any](cap int) *LRU[K, V] {
    return &LRU[K, V]{cap: cap, items: make(map[K]*node[K, V])}
}

func (l *LRU[K, V]) Get(k K) (V, bool) {
    l.mu.Lock()
    defer l.mu.Unlock()
    n, ok := l.items[k]
    if !ok {
        var zero V
        return zero, false
    }
    l.moveToFront(n)
    return n.val, true
}

func (l *LRU[K, V]) Set(k K, v V) {
    l.mu.Lock()
    defer l.mu.Unlock()
    if n, ok := l.items[k]; ok {
        n.val = v
        l.moveToFront(n)
        return
    }
    n := &node[K, V]{key: k, val: v}
    l.items[k] = n
    l.pushFront(n)
    if len(l.items) > l.cap {
        old := l.tail
        l.remove(old)
        delete(l.items, old.key)
    }
}

func (l *LRU[K, V]) moveToFront(n *node[K, V]) {
    l.remove(n)
    l.pushFront(n)
}

func (l *LRU[K, V]) pushFront(n *node[K, V]) {
    if l.head == nil {
        l.head, l.tail = n, n
        return
    }
    n.next = l.head
    l.head.prev = n
    l.head = n
}

func (l *LRU[K, V]) remove(n *node[K, V]) {
    if n.prev != nil {
        n.prev.next = n.next
    } else {
        l.head = n.next
    }
    if n.next != nil {
        n.next.prev = n.prev
    } else {
        l.tail = n.prev
    }
    n.prev, n.next = nil, nil
}
```

About a hundred lines. Acceptable for a small service; prefer the standard libraries for anything bigger.

### A small graceful-shutdown helper

```go
package gs

import (
    "context"
    "os/signal"
    "syscall"
    "time"
)

type Closer interface {
    Close(ctx context.Context) error
}

func RunUntilSignal(timeout time.Duration, run func(ctx context.Context) error, closers ...Closer) error {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGTERM, syscall.SIGINT)
    defer stop()

    errCh := make(chan error, 1)
    go func() {
        errCh <- run(ctx)
    }()

    select {
    case err := <-errCh:
        return err
    case <-ctx.Done():
    }

    shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel()

    for _, c := range closers {
        _ = c.Close(shutdownCtx)
    }
    return nil
}
```

Wire your service up like:

```go
gs.RunUntilSignal(25*time.Second, srv.ListenAndServe, srv, pool, db)
```

Each of these utilities is small enough to copy into any service. They embed steady-state discipline without requiring a big library dependency.

---

## Pattern catalogue summary

This middle page covered, in roughly this order:

- Three shedding policies (shed, block, load-shed).
- Worker pool with metrics and graceful stop.
- Per-tenant semaphore with idle GC.
- Goroutine budgets via `semaphore.Weighted`.
- `sql.DB` tuning (`MaxOpenConns`, `MaxIdleConns`, `ConnMaxLifetime`).
- `http.Transport` tuning (`MaxIdleConnsPerHost`, `MaxConnsPerHost`).
- gRPC keepalive.
- Leak budgets and slope-based alerts.
- Bounded LRU caches with TTL.
- Tickers and timers done right.
- Backpressure with readiness gates.
- Background task scheduling.
- Saturation metrics per resource.
- Connection pool warm-up.
- Resource ownership patterns.

Each pattern stands on its own. The senior page composes them into architecture; the professional page tells the war stories of what happens when they are missing.

---

## A worked example — adding steady-state to an existing service

To make the patterns concrete, here is how you might convert an existing "works on my laptop" Go service into a steady-state-ready production service. The before and after.

### The before — works but drifts

```go
package main

import (
    "database/sql"
    "encoding/json"
    "io"
    "log"
    "net/http"

    _ "github.com/jackc/pgx/v5/stdlib"
)

var db *sql.DB

func main() {
    var err error
    db, err = sql.Open("pgx", "postgres://...")
    if err != nil {
        log.Fatal(err)
    }
    http.HandleFunc("/profile", handleProfile)
    log.Fatal(http.ListenAndServe(":8080", nil))
}

func handleProfile(w http.ResponseWriter, r *http.Request) {
    userID := r.URL.Query().Get("user_id")
    var name string
    err := db.QueryRow("SELECT name FROM users WHERE id=$1", userID).Scan(&name)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    resp, _ := http.Get("https://upstream/" + userID)
    var data map[string]any
    _ = json.NewDecoder(resp.Body).Decode(&data)
    json.NewEncoder(w).Encode(map[string]any{
        "name": name,
        "data": data,
    })
}
```

What's wrong:

- No `GOMEMLIMIT`.
- No connection pool sizing.
- `http.Get` uses the default transport with `MaxIdleConnsPerHost = 2`.
- `resp.Body` is not drained or closed.
- No timeouts on the upstream call.
- No graceful shutdown.
- No metrics.
- No pprof.

The service may work in development. In production it will drift, leak FDs, and accumulate goroutines under sustained traffic.

### The after — steady-state ready

```go
package main

import (
    "context"
    "database/sql"
    "encoding/json"
    "io"
    "log"
    "net/http"
    "os"
    "os/signal"
    "runtime/debug"
    "syscall"
    "time"

    _ "github.com/jackc/pgx/v5/stdlib"
    _ "net/http/pprof"
)

var (
    db     *sql.DB
    client *http.Client
)

func main() {
    debug.SetMemoryLimit(int64(0.9 * 2 * 1024 * 1024 * 1024)) // 1.8 GiB

    var err error
    db, err = sql.Open("pgx", os.Getenv("DATABASE_URL"))
    if err != nil {
        log.Fatal(err)
    }
    db.SetMaxOpenConns(20)
    db.SetMaxIdleConns(20)
    db.SetConnMaxLifetime(30 * time.Minute)
    db.SetConnMaxIdleTime(5 * time.Minute)
    defer db.Close()

    client = &http.Client{
        Transport: &http.Transport{
            MaxIdleConns:        100,
            MaxIdleConnsPerHost: 25,
            MaxConnsPerHost:     50,
            IdleConnTimeout:     90 * time.Second,
        },
        Timeout: 5 * time.Second,
    }

    // Localhost-only pprof
    go func() {
        _ = http.ListenAndServe("127.0.0.1:6060", nil)
    }()

    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGTERM, syscall.SIGINT)
    defer stop()

    srv := &http.Server{
        Addr:              ":8080",
        Handler:           http.HandlerFunc(handleProfile),
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       30 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       120 * time.Second,
        MaxHeaderBytes:    1 << 16,
    }

    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            log.Println(err)
        }
    }()

    <-ctx.Done()

    shutdownCtx, cancel := context.WithTimeout(
        context.Background(), 25*time.Second)
    defer cancel()
    _ = srv.Shutdown(shutdownCtx)
}

func handleProfile(w http.ResponseWriter, r *http.Request) {
    userID := r.URL.Query().Get("user_id")
    if userID == "" {
        http.Error(w, "missing user_id", http.StatusBadRequest)
        return
    }

    ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
    defer cancel()

    var name string
    err := db.QueryRowContext(ctx,
        "SELECT name FROM users WHERE id=$1", userID).Scan(&name)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    req, _ := http.NewRequestWithContext(ctx, "GET",
        "https://upstream/"+userID, nil)
    resp, err := client.Do(req)
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadGateway)
        return
    }
    defer func() {
        io.Copy(io.Discard, resp.Body)
        resp.Body.Close()
    }()

    var data map[string]any
    if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
        http.Error(w, err.Error(), http.StatusBadGateway)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]any{
        "name": name,
        "data": data,
    })
}
```

What changed:

- `GOMEMLIMIT` set at startup.
- Database pool explicitly sized with sane defaults.
- Custom `http.Transport` with higher per-host idle conn limit.
- Response body always drained and closed.
- Explicit per-call context with 3-second timeout.
- Server-side timeouts for read/write/idle.
- `signal.NotifyContext` triggers graceful shutdown.
- `srv.Shutdown` bounded by a 25-second deadline.
- pprof on a localhost listener.

The added code is about fifty lines. The service is now production-grade.

### What's still missing

This service is good but not great. For "great," add:

- Metrics: per-route latency, queue depth if added.
- Saturation alerts: `db.Stats().WaitCount`, etc.
- A worker pool with per-tenant isolation (only if multi-tenant).
- A circuit breaker for the upstream call.
- A chaos harness running in CI.
- Runbooks for each alert.

The senior page covers each of these. For most middle-tier services, the "after" code above is already a major upgrade.

---

## Trade-off: simplicity vs robustness

The "after" code is more complex than the "before." This is the price of admission to steady-state engineering. Three observations:

1. **The complexity is largely boilerplate.** Every service has a similar shape. Extract it into a shared library and the per-service cost drops.
2. **The complexity prevents real incidents.** Each line corresponds to a class of failure that the "before" code would suffer.
3. **The complexity is teachable.** Once you have written it once, you can write it again in fifteen minutes. The first time is the expensive one.

The trade-off is a one-time engineering cost against an ongoing operational benefit. For services with non-trivial lifetimes, the trade pays off quickly.

---

## Closing for the middle tier

The middle page has been long because the middle tier is wide. The junior page is one habit applied to one thing; the middle page is the same habits applied to many things, with the trade-offs that emerge.

If you finish the middle page and feel "I understand each pattern but the connection is unclear," that is normal. The connection is the senior page's subject: architecture, alerts, harnesses, the design of a service that is steady at the system level, not just the line level.

Move on to the senior page when you are ready to think about steady-state as a property of systems, not of code.
