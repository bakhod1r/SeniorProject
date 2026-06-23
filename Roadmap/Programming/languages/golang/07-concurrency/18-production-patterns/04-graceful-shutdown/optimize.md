---
layout: default
title: Optimize
parent: Graceful Shutdown
grand_parent: Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/optimize/
---

# Graceful Shutdown — Optimization

> Optimizing graceful shutdown is less about Go runtime tricks and more about *system-level* tuning: latencies, deadlines, ordering, parallelism. Each entry below states the problem, shows a "before," shows an "after," and gives the realistic gain.

---

## Optimization 1 — Reduce p99 shutdown by capping per-handler timeout

**Problem.** A specific endpoint occasionally takes 20 seconds because of a slow downstream. During shutdown, in-flight requests on this endpoint dominate drain time.

**Before:**
```go
mux.HandleFunc("/export", handleExport)
```

p999 shutdown: 22 seconds. Force-close at 25-second budget happens ~0.1% of the time.

**After:**
```go
mux.HandleFunc("/export", timeoutMiddleware(10*time.Second, handleExport))
```

p999 shutdown: 11 seconds (handler aborts at 10s; drain finishes quickly).

**Gain.** Force-close rate drops to near-zero. Drain p999 cut in half.

---

## Optimization 2 — Parallelise drain of multiple subsystems

**Problem.** HTTP and gRPC drain serially, doubling the total drain time.

**Before:**
```go
_ = httpSrv.Shutdown(ctx)  // 12s
_ = grpcSrv.GracefulStop() // 8s
```

Total: 20 seconds.

**After:**
```go
eg, ectx := errgroup.WithContext(ctx)
eg.Go(func() error { return httpSrv.Shutdown(ectx) })
eg.Go(func() error { return drainGRPC(ectx, grpcSrv) })
_ = eg.Wait()
```

Total: max(12s, 8s) = 12 seconds.

**Gain.** 40% reduction in inbound-drain time.

---

## Optimization 3 — `BaseContext` for handler-level cancellation

**Problem.** Handlers don't observe shutdown; they finish on their own schedule. Drain p99 = handler p99.

**Before:**
```go
srv := &http.Server{Addr: ":8080", Handler: mux}
```

Handlers run to completion. Drain p99 = handler p99 = 5s.

**After:**
```go
srv := &http.Server{
    Addr: ":8080",
    Handler: mux,
    BaseContext: func(_ net.Listener) context.Context {
        return rootCtx
    },
}
```

Handlers observe `r.Context()`. On shutdown, they bail out immediately. Drain p99 = ~100ms (the time for handlers to notice).

**Gain.** 50x reduction in drain p99.

**Cost.** Handlers must be written to respect `r.Context()`. Some operations (database queries) require passing ctx; others (CPU-bound code) need explicit checks.

---

## Optimization 4 — Aggressive `Server` timeouts

**Problem.** Slow clients (Slowloris-style) hold connections open during shutdown.

**Before:**
```go
srv := &http.Server{Addr: ":8080"}
```

Default timeouts are zero (unlimited). A slow client can keep a connection open indefinitely.

**After:**
```go
srv := &http.Server{
    Addr:              ":8080",
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       120 * time.Second,
}
```

Slow clients are cut off within seconds. Drain doesn't wait for them.

**Gain.** Variable; on a service with adversarial clients, can cut p999 drain by 30+ seconds.

---

## Optimization 5 — `preStop` hook for LB drain overlap

**Problem.** During the `readyDelay` sleep, the application is idle but still in the SIGTERM-to-SIGKILL window.

**Before:**
```go
// In application code:
ready.Store(false)
time.Sleep(3 * time.Second) // wastes 3 seconds of grace period
_ = srv.Shutdown(ctx)
```

Wastes 3 seconds of the shutdown budget.

**After:** Move the delay to `preStop`:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sleep", "3"]
```

```go
// In application code:
ready.Store(false)
_ = srv.Shutdown(ctx)
```

preStop's 3 seconds happen *before* SIGTERM. They don't count against the shutdown budget.

**Gain.** 3 additional seconds available for actual drain.

---

## Optimization 6 — Parallel close of outbound clients

**Problem.** Closing Redis, Kafka, and DB serially adds latencies.

**Before:**
```go
_ = redisClient.Close()    // 200ms
_ = kafkaProducer.Close()  // 800ms
_ = db.Close()              // 500ms
```

Total: 1.5 seconds.

**After:**
```go
var wg sync.WaitGroup
wg.Add(3)
go func() { defer wg.Done(); _ = redisClient.Close() }()
go func() { defer wg.Done(); _ = kafkaProducer.Close() }()
go func() { defer wg.Done(); _ = db.Close() }()
wg.Wait()
```

Total: max(200, 800, 500) = 800ms.

**Gain.** ~50% reduction in outbound-close time.

**Caveat.** Order matters if any client uses another (e.g., db pool used by a goroutine still running). Make sure no in-flight work uses these clients before parallelising their close.

---

## Optimization 7 — Bound `wg.Wait` with a deadline

**Problem.** `wg.Wait()` blocks forever if even one goroutine never decrements.

**Before:**
```go
wg.Wait()
```

**After:**
```go
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
case <-shutdownCtx.Done():
    log.Println("goroutines did not exit; continuing")
}
```

**Gain.** No deadlocks even with leaky goroutines.

---

## Optimization 8 — Tune `terminationGracePeriodSeconds` to actual drain time

**Problem.** Default 30s is "what everyone uses" but may be too long or too short.

**Diagnosis.** Look at `shutdown_duration_seconds` histogram. Find p99.

**Tuning.**
- If p99 is 5s and TGS is 30s: you're wasting 25s per pod on deploy. Lower TGS to 15s (10s drain + 5s margin).
- If p99 is 28s and TGS is 30s: you're at the cliff. Raise TGS to 45s or lower handler timeouts.

**Gain.** 50% faster deploys (lower TGS) or 99x fewer force-closes (higher TGS), depending on direction.

---

## Optimization 9 — Skip the polling tail by using HTTP/1.1 close header

**Problem.** Even after `Shutdown` is called, idle keep-alive connections wait for the next request before closing. The polling loop waits up to 500ms before closing them.

**Before:** Idle connections close at next poll iteration (~500ms).

**After:** Send `Connection: close` on every response during the draining period:

```go
mux := http.NewServeMux()
mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
    if !ready.Load() {
        w.Header().Set("Connection", "close")
    }
    // ... rest of handler ...
})
```

Clients close the connection after the response. No keep-alive idle period.

**Gain.** Faster shutdown for high-keep-alive workloads.

---

## Optimization 10 — `errgroup.SetLimit` for bounded drain parallelism

**Problem.** Closing 1000 WebSocket connections at once spikes CPU.

**Before:**
```go
for _, conn := range allConns {
    go conn.Close()
}
```

CPU spike; many concurrent close ops.

**After:**
```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(50)
for _, conn := range allConns {
    conn := conn
    g.Go(func() error { return conn.Close() })
}
_ = g.Wait()
```

50 concurrent closes; total time only slightly longer; CPU smooth.

**Gain.** Smoother shutdown profile; less impact on neighbours.

---

## Optimization 11 — Lazy startup of dependencies

**Problem.** Some dependencies (e.g., a rare-feature client) take 2 seconds to initialise but are only used for 0.1% of requests. They're always initialised at startup, slowing deploys.

**Before:**
```go
client := slowClient.New() // 2s at every startup
```

**After:**
```go
var clientOnce sync.Once
var client *slowClient.Client
func getClient() *slowClient.Client {
    clientOnce.Do(func() { client = slowClient.New() })
    return client
}
```

Initialisation happens only on first use. New pods start serving traffic 2 seconds faster.

**Gain.** Faster startup means new pods become healthy sooner during rolling deploys. Equivalent to "faster deploys" without changing shutdown logic.

**Caveat.** Cold-start latency for the first request of each pod. Trade-off.

---

## Optimization 12 — Idempotency for in-flight requests

**Problem.** Force-close drops requests. Clients retry, but if the request is non-idempotent, retries cause duplication.

**Before:** Force-close → client retries → duplicate work.

**After:** Add idempotency keys:

```
POST /api/charge
Idempotency-Key: 7b1c-...
```

The server stores `key → response`. Retries return the previous response.

**Gain.** Force-close becomes safe. Reduces the cost of imperfect drains.

---

## Optimization 13 — Reduce per-handler memory allocations

**Problem.** Handlers allocate many slices/maps per request. During shutdown, GC runs more often (under memory pressure), adding latency.

**Before:** No allocation control.

**After:** Pool large buffers:

```go
var bufPool = sync.Pool{New: func() interface{} { return make([]byte, 0, 4096) }}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf[:0])
    // ... use buf ...
}
```

GC pressure drops; handlers complete faster; shutdown drain faster.

**Gain.** 10-20% reduction in handler p99 latency, indirect improvement in shutdown.

---

## Optimization 14 — Pre-warm caches before flipping readiness

**Problem.** New pods serve their first requests slowly (cold cache). During rolling deploy, the rolling-in pods cause latency spikes.

**Before:** Pod starts → flips ready → first 100 requests are slow.

**After:** Pre-warm cache during startup; only flip ready when cache is warm.

```go
// startup
if err := cache.PrewarmTop1000(rootCtx); err != nil {
    return fmt.Errorf("prewarm: %w", err)
}
ready.Store(true)
```

First requests are fast. No deploy-time latency bump.

**Gain.** Deploys are smoother; no transient p99 latency spike.

---

## Optimization 15 — Skip flushing on healthy shutdown

**Problem.** Sentry flush, OTLP flush, etc. add ~1s of shutdown latency. On a perfect deploy, no errors are pending; the flushes are unnecessary.

**Before:**
```go
defer sentry.Flush(2 * time.Second)
defer tp.Shutdown(ctx) // OTLP
```

Always 1-2 seconds of flush.

**After:** Skip if buffer is empty:

```go
if sentry.Count() > 0 {
    sentry.Flush(2 * time.Second)
}
```

Most shutdowns skip the flush.

**Gain.** Faster typical shutdown. Slower outlier (when there are errors to flush).

**Caveat.** Few teams implement this; the 1-2s is usually acceptable.

---

## Optimization 16 — Coalesce metrics emission

**Problem.** Each phase emits 5 metrics individually. Network overhead.

**Before:** 5 metric pushes per phase.

**After:** Batch:

```go
metricBatch := []prom.Metric{...}
prom.PushBatch(metricBatch)
```

Or use a buffered exporter that batches periodically.

**Gain.** Marginal; metrics exporters typically already batch.

---

## Optimization 17 — Avoid heavy work in `OnShutdown` hooks

**Problem.** `OnShutdown` hooks run in goroutines but `Shutdown` does not wait for them. Heavy hooks can race with the rest of shutdown.

**Before:**
```go
srv.RegisterOnShutdown(func() {
    expensiveCleanup() // takes 5 seconds
})
```

If `Shutdown` returns in 1 second but the hook runs for 5, the hook's work may be cut off when main exits.

**After:** Make the hook either truly fast or coordinate with main:

```go
hookDone := make(chan struct{})
srv.RegisterOnShutdown(func() {
    defer close(hookDone)
    expensiveCleanup()
})

// in main:
_ = srv.Shutdown(ctx)
<-hookDone // wait for hook
```

**Gain.** Correctness, not speed. The hook's work actually completes.

---

## Optimization 18 — Profile-guided budget tuning

**Problem.** The budget is guessed. It's either too tight or too loose.

**Approach.** Collect data:

- Run for a month with comfortable budget (e.g., 60s TGS).
- Plot histograms of `shutdown_duration_seconds`.
- Find your real p99 and p999.
- Tighten the budget to p999 + 25% margin.

For most services, this reduces TGS from 60s to 15-20s, doubling deploy speed without risk.

**Gain.** 2-3x faster deploys with no force-close increase.

---

## Optimization 19 — Reduce the readyDelay through faster probes

**Problem.** readyDelay must cover LB propagation. Default probes (every 10s) need 30s of readyDelay.

**Before:**
```yaml
readinessProbe:
  periodSeconds: 10
  failureThreshold: 3
```

Total detection: 30s. readyDelay must be ≥ 30s.

**After:**
```yaml
readinessProbe:
  periodSeconds: 1
  failureThreshold: 2
```

Total detection: 2s. readyDelay can be 3s.

**Gain.** 27 seconds saved per shutdown. Massive deploy-speed improvement.

**Caveat.** More probe traffic. Negligible cost.

---

## Optimization 20 — Skip drain on uncertain workloads

**Problem.** Some workloads have no in-flight state (e.g., a stateless transformer). Graceful drain adds latency for no benefit.

**Before:** Always graceful.

**After:** Detect "nothing in flight":

```go
if srv.ActiveConnCount() == 0 {
    _ = srv.Close() // brutal but instant
    return
}
_ = srv.Shutdown(ctx) // graceful for in-flight
```

For stateless workloads with no in-flight requests, shutdown is microseconds.

**Gain.** Marginal but real on idle servers.

---

## Final Notes

Graceful shutdown optimization is about understanding where time is spent. Profile your actual shutdown:

- Per-phase metrics tell you which phase dominates.
- Per-handler latency tells you which endpoint causes the tail.
- The histogram of total duration tells you whether tuning is worth it.

Many of these optimizations have negligible benefit on a well-engineered service; some have huge benefit on a poorly engineered one. Measure first; optimise where it matters.

Most services should focus on:

1. Per-handler timeouts (Optimization 1).
2. `BaseContext` for handler cancellation (Optimization 3).
3. Parallel drain of inbound (Optimization 2).
4. Reasonable Server timeouts (Optimization 4).
5. `preStop` for LB drain (Optimization 5).

These five give 80% of the benefit. The rest are for the last 20%.

Onwards.
