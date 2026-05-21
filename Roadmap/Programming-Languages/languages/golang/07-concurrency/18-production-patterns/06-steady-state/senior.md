---
layout: default
title: Steady-State — Senior
parent: Steady-State
grand_parent: Production Patterns
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/06-steady-state/senior/
---

# Steady-State — Senior

[← Back](../)

## Table of Contents

1. [Where we are](#where-we-are)
2. [The four slow-decline failure modes](#the-four-slow-decline-failure-modes)
3. [Memory drift in detail](#memory-drift-in-detail)
4. [FD exhaustion in detail](#fd-exhaustion-in-detail)
5. [Deadline drift in detail](#deadline-drift-in-detail)
6. [Allocator fragmentation in detail](#allocator-fragmentation-in-detail)
7. [`GOGC` tuning under sustained load](#gogc-tuning-under-sustained-load)
8. [`GOMEMLIMIT` interaction with `GOGC`](#gomemlimit-interaction-with-gogc)
9. [Saturation metrics and the USE method](#saturation-metrics-and-the-use-method)
10. [Designing alerts that catch drift](#designing-alerts-that-catch-drift)
11. [Building a steady-state chaos harness](#building-a-steady-state-chaos-harness)
12. [Architecture-level patterns](#architecture-level-patterns)
13. [Cross-cutting concerns](#cross-cutting-concerns)
14. [Steady-state under autoscaling](#steady-state-under-autoscaling)
15. [The on-call reality](#the-on-call-reality)
16. [Self-assessment](#self-assessment)
17. [Summary](#summary)

---

## Where we are

The junior page taught the basics: bounded queues, capped goroutines, paired resource lifecycles. The middle page taught how to apply those at the next layer: per-tenant isolation, connection pools, leak budgets. The senior page is about architecture. It is the page for engineers who own the design of a service, define its alerts, sign off on its launch, and carry the pager when something drifts.

After reading this page you will:

- Recognise the four slow-decline failure modes by their fingerprints.
- Tune `GOGC` and `GOMEMLIMIT` together against measured workloads.
- Design saturation metrics that catch drift before it pages.
- Build a chaos harness that exercises steady-state in CI.
- Make architecture decisions about per-shard isolation, burst tolerance, and runtime-knob defaults.

---

## The four slow-decline failure modes

Across hundreds of post-mortems, four failure modes account for the vast majority of "service drifted out of steady-state" incidents. Each has a different fingerprint, a different diagnosis, and a different fix. Recognise them; the on-call diagnosis time drops from hours to minutes.

### 1. Memory drift

The resident set grows. Heap-profile diff between two snapshots shows a single growing consumer. The fix is structural (deduplicate or bound the growing data) or a leak budget (acknowledge and alert).

### 2. FD exhaustion

The open file count grows. `lsof` or `/proc/$PID/fd` shows accumulating sockets or pipes. The fix is finding the missing `Close` or `drain`.

### 3. Deadline drift

Latency at p99 climbs slowly over hours or days. CPU is fine; memory is fine. Tracing reveals one downstream component's tail growing in lockstep. The fix is timeout discipline and circuit breaking.

### 4. Allocator fragmentation

The runtime's reported heap stays small, but the resident set grows. The Go runtime has freed memory but the OS has not reclaimed the pages. The fix is reducing the variance of long-lived allocation sizes, or accepting the floor (via `debug.SetGCPercent(-1)` and explicit GC, in extreme cases).

Each of the next four sections takes one of these in depth.

---

## Memory drift in detail

### Fingerprint

- `runtime.MemStats.HeapInuse` or `/memory/classes/heap/objects:bytes` grows monotonically across many hours.
- The shape on the dashboard is a slope, not a step. A step suggests an event; a slope suggests an accumulation.
- The growth survives GC: post-GC heap rises across cycles.

### Diagnosis procedure

1. Take two heap snapshots, T0 and T1, separated by at least thirty minutes.
2. `go tool pprof -base T0.pb.gz T1.pb.gz`.
3. `top -cum` to identify the top *growing* consumer.
4. `list <function>` to see the line that allocated the growth.
5. If the growing consumer is a known cache or pool, the bug is in the eviction logic; otherwise it is in the lifecycle of whatever the function allocates.

### Common roots

- A map used as a cache, never expired.
- A slice appended to without a corresponding truncation.
- A goroutine that holds references on its stack across iterations.
- A `sync.Pool` whose `Put` is missing on some return path (so the pool grows linearly with un-pooled allocations).
- A finalizer that takes too long; the runtime queues unfinalized objects.

### The two-snapshot trick

Some leaks only show up on the diff, not the absolute snapshot. The absolute snapshot is dominated by the legitimate working set; the leak is a small percentage and easy to miss. The diff highlights it directly:

```bash
go tool pprof -base T0.pb.gz T1.pb.gz
(pprof) top -cum 20
(pprof) list myLeakingFunction
```

`-cum` sorts by cumulative growth — the leak is usually within the top three entries.

### The escape hatch

When the leak is in third-party code and you cannot fix it in the short term:

1. Define a leak budget.
2. Set up restart at a heap threshold (`livenessProbe` that fails when `MemStats.HeapInuse > X`).
3. Schedule deploys often enough to stay under the budget.

This is unappealing but pragmatic. Document the budget and the workaround so the next engineer is not surprised.

---

## FD exhaustion in detail

### Fingerprint

- The "open files" metric grows.
- Eventually `accept` fails with `too many open files` or a similar errno.
- Symptoms upstream often look unrelated: rate-limit errors, dial failures, "context canceled."

### Diagnosis procedure

1. On the affected pod, list open FDs and their targets:
   ```bash
   ls -l /proc/$PID/fd | awk '{print $11}' | sort | uniq -c | sort -nr
   ```
2. Look for repeated targets: many socket FDs to the same upstream is a connection-pool problem; many pipe FDs is a subprocess problem; many regular files is a file-handle leak.
3. Cross-reference with `pprof goroutine?debug=1`: find goroutines that look related to the leaked FD type.

### Common roots

- `http.Response.Body` not drained before close.
- Subprocess stdout/stderr pipes not drained.
- `os.File.Close()` missing on an error path.
- `net.Listener.Accept` connections not closed in a worker error path.
- `inotify` or `epoll` instances created and not closed.

### The drain pattern, revisited

For HTTP:

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

For subprocess:

```go
stdout, _ := cmd.StdoutPipe()
stderr, _ := cmd.StderrPipe()
done := make(chan struct{}, 2)
go func() { io.Copy(io.Discard, stdout); done <- struct{}{} }()
go func() { io.Copy(io.Discard, stderr); done <- struct{}{} }()
cmd.Start()
// always drain, even if you Kill:
defer func() {
    <-done
    <-done
    cmd.Wait()
}()
```

For your own resources, give them a `Close() error` and call it.

### Setting the limit

In Kubernetes:

```yaml
spec:
  containers:
  - name: app
    resources:
      limits:
        cpu: 2
        memory: 4Gi
    securityContext:
      capabilities:
        add: ["SYS_RESOURCE"]
```

In systemd:

```ini
[Service]
LimitNOFILE=65536
```

Higher limits let you accumulate more before exhaustion. But raising the limit is a *workaround*, not a fix. The fix is finding the leak.

---

## Deadline drift in detail

### Fingerprint

- `p99` of latency rises slowly over many hours.
- `p50` is constant; only the tail is growing.
- CPU and memory are flat.
- One specific downstream call's tail is co-rising.

### Diagnosis procedure

1. Plot the latency histogram. Confirm the tail is growing; if the whole distribution is rising, it's a different problem.
2. Pull a trace from the slow tail (using OpenTelemetry, Jaeger, or pprof execution traces).
3. Identify the downstream call(s) responsible.
4. Examine *their* timeout configuration.

### Common root: missing timeouts

A surprisingly common cause. The downstream timeout is "infinite" because it inherits a context that itself has no deadline. When the downstream's latency grows slowly, your service waits patiently, and your tail grows with theirs.

Fix:

```go
// Every outbound call gets a deadline.
ctx, cancel := context.WithTimeout(parentCtx, 500*time.Millisecond)
defer cancel()
resp, err := client.GetContext(ctx, url)
```

### Common root: deadline propagation without budget

A request comes in with no deadline. Your handler creates a five-second deadline. The handler calls downstream A with that five-second deadline. Downstream A calls downstream B with the remaining deadline. As B's latency creeps up, A's tail grows; as A's tail grows, your handler's tail grows.

Fix: each call gets its *own* budget, not the inherited remaining time. Or use an explicit "budget" library that splits the budget along the call tree.

### Common root: circuit-breaker missing

The downstream service is slow but not failing. Without a circuit breaker, you wait. With one, after a threshold of slow responses, you fail fast and don't hold up your own callers.

```go
import "github.com/sony/gobreaker"

cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        "downstreamA",
    MaxRequests: 1,
    Interval:    60 * time.Second,
    Timeout:     30 * time.Second,
    ReadyToTrip: func(counts gobreaker.Counts) bool {
        return counts.ConsecutiveFailures > 5
    },
})

result, err := cb.Execute(func() (interface{}, error) {
    return callDownstreamA(ctx)
})
```

---

## Allocator fragmentation in detail

### Fingerprint

- `MemStats.HeapInuse` is stable. But `MemStats.HeapSys` and `RSS` grow.
- `MemStats.HeapReleased` grows, but slower than `HeapIdle`.
- The OS-level resident set is much larger than the live heap.

### Why this happens

The Go runtime allocates memory from the OS in large chunks (mostly 8 MiB arenas). When the allocator wants to satisfy a small allocation, it picks a free span inside one of these arenas. Spans can be split into smaller pieces. Over time, with long-lived allocations of varying sizes, the arenas become "Swiss cheese" — full of free spans that are too small to satisfy larger requests.

The runtime can return entire arenas to the OS only when they are completely empty. Partial arenas stay mapped, even if mostly empty. The RSS reflects mapped memory, not live data.

### Mitigations

The Go runtime does its best. Beyond that:

1. **Reduce the variance of long-lived allocation sizes.** Use `sync.Pool` with a single object size, not a mix.
2. **Allocate large fixed-size buffers, not many small varying ones.** `make([]byte, 64*1024)` reused across requests is friendlier than per-request `make([]byte, randomSize)`.
3. **`debug.FreeOSMemory()` after big allocations.** A hint to the runtime to return idle pages to the OS. Use sparingly.
4. **Accept the floor.** If the resident set plateaus at, say, twice the live heap, that's the cost of running this workload.

### When it matters

For most services it does not. The Go runtime is good at managing arenas. Fragmentation matters when:

- Long-running service (months without restart).
- High variance of long-lived allocation sizes.
- Tight container memory limit (no slack to absorb the floor).
- Hostile inputs (e.g., user-controlled allocation sizes).

If two snapshots taken weeks apart show similar live heap but rising RSS, fragmentation is a candidate. Cross-check with `MemStats.HeapIdle` and `MemStats.HeapReleased`.

---

## `GOGC` tuning under sustained load

`GOGC` controls how often the GC runs. Default is `100`, meaning GC runs when the heap has roughly doubled since the last cycle. Lower values (e.g., `50`) run GC more often, keeping the heap smaller at the cost of CPU. Higher values (e.g., `200`, `500`) run GC less often, costing memory but reducing CPU.

### The decision tree

1. **Is `GOMEMLIMIT` set?** If yes, `GOGC` is less critical — the memory limit takes over near saturation. Pick `100` as a default and only adjust if the GC CPU fraction is unsatisfactory.

2. **Is memory the tight resource?** Lower `GOGC` (try `50`, then `25`). Each step roughly halves the steady-state heap, doubles the GC frequency. Run a benchmark; watch `p99` latency.

3. **Is CPU the tight resource?** Raise `GOGC` (try `200`, `500`). Each step roughly doubles the steady-state heap, halves the GC frequency. Run a benchmark; watch resident set size.

4. **Is the workload heavily allocating?** Consider pooling allocations with `sync.Pool` *before* tuning `GOGC`. Reducing allocation rate is usually a bigger win than changing `GOGC`.

### Measurement

Run a representative load test for at least thirty minutes. Record:

- `/gc/cpu/percent:%` — fraction of CPU spent in GC.
- `/gc/pauses:seconds` — histogram of pause durations.
- `MemStats.HeapInuse` over time — average steady-state heap.
- p99 latency on the application's own SLI.

Try `GOGC` at 50, 100, 200, 500. Compare. Pick the value that balances your latency and memory budgets.

### When to set `GOGC=off`

Almost never in long-running services. Even `GOGC=10000` (very rarely GC) is safer than `off`. The only legitimate uses are batch jobs that run to completion in seconds.

---

## `GOMEMLIMIT` interaction with `GOGC`

Set together, the two knobs cooperate:

- Far below the limit, `GOGC` controls behaviour. GC runs at the heap-doubling ratio.
- Approaching the limit, `GOMEMLIMIT` takes over. GC runs aggressively to keep memory inside the limit.
- At the limit, the runtime is in "emergency" mode: more frequent GCs, more memory returned to OS, but allocations still succeed.

### The dance

A useful mental model:

```
heap
^
|                                                . . . . (limit)
|        /\        /\         /\          /\
|       /  \  /\  /  \  /\   /  \   /\  /  \   /\
|      /    \/  \/    \/ \  /    \ /  \/    \ /
|     /                                          \
+-------------------------------------------------> time
```

Each peak is a GC trigger. With `GOGC=100`, peaks are spaced at "live + live" — i.e., heap doubles before each GC. With `GOMEMLIMIT=L`, peaks are capped at L: as the heap approaches L, GC runs more often even if `GOGC` says "no" yet.

### Setting both wisely

```
GOMEMLIMIT = 90% of cgroup memory limit
GOGC       = value that minimises p99 latency at the chosen GOMEMLIMIT
```

The order is important: set `GOMEMLIMIT` first (it's the safety belt), then tune `GOGC` (the trade-off dial). Tuning `GOGC` alone, without `GOMEMLIMIT`, is asking for an OOM.

### When `GOGC` becomes irrelevant

In a memory-tight environment, the workload is constantly close to the limit, so `GOMEMLIMIT` is always driving GC. `GOGC` has almost no effect: GC is going to run aggressively regardless. In this regime, lower `GOGC` to save memory (the GC will run anyway, so you might as well let it run on a smaller heap).

### When `GOGC` becomes critical

In a memory-loose environment (twenty percent utilisation), GC is driven entirely by `GOGC`. Lower values cost more CPU; higher values waste more memory. Pick the value that minimises the dollar cost of your hosting bill.

---

## Saturation metrics and the USE method

Brendan Gregg's USE method: for every resource, ask three questions.

- **Utilisation** — how much of the resource is in use?
- **Saturation** — how much queueing or waiting is happening for the resource?
- **Errors** — how often does access fail?

For steady-state, saturation is the more important signal. Utilisation tells you "we are using 80% of CPU." Saturation tells you "callers are waiting for CPU." Saturation is the leading indicator.

### Per-resource saturation metrics

| Resource | Utilisation | Saturation | Errors |
|---|---|---|---|
| CPU | `process_cpu_seconds_total` rate | scheduling latency (`/sched/latencies:seconds`) | (none directly) |
| Heap | `HeapInuse` | GC CPU fraction | OOM kills |
| Goroutines | `NumGoroutine` | scheduling latency | (panics) |
| `sql.DB` pool | `InUse / MaxOpenConns` | `WaitCount`, `WaitDuration` | query errors |
| `http.Transport` | active conn count | (no direct signal; use a custom counter) | dial errors |
| FDs | open FD count / `RLIMIT_NOFILE` | (no signal; lookups fail with errno) | `EMFILE` |
| Worker pool | `InFlight / WorkerCount` | queue depth, queue wait time | dropped jobs |
| Tenant semaphore | acquired weight / max weight | acquire wait time | acquire failures |

### Building the dashboard

The dashboard for a service in production should have one panel per row in this table. Each panel should plot utilisation, saturation, and error rate on a single chart. A glance at the dashboard tells you which resource is the bottleneck.

For steady-state specifically, the saturation column is what alerts on. A pool's `WaitCount` is climbing? Alert. Queue wait time is rising? Alert. GC CPU fraction is above five percent? Alert.

---

## Designing alerts that catch drift

Naive alerts are absolute thresholds: "alert if heap > 3 GiB." These miss drift entirely if 3 GiB is reached gradually over weeks. They also page noisily during transient spikes.

### Better: slope alerts

Alert on the slope of a metric over a long window:

```promql
deriv(go_memstats_heap_inuse_bytes[6h]) > 50 * 1024 * 1024 / 86400
# heap growing more than 50 MiB per day, averaged over the last 6 hours
```

This catches drift before it crosses the absolute threshold, while ignoring transient spikes (because the slope averages out).

### Better: trend + absolute

Combine: alert if both the absolute value is concerning *and* the trend is positive.

```promql
go_memstats_heap_inuse_bytes > 2 * 1024 * 1024 * 1024
  AND
deriv(go_memstats_heap_inuse_bytes[6h]) > 0
```

This fires only when we are near the limit *and* still moving toward it. False positives are rare.

### Better: per-metric runbooks

Every alert has a runbook. The runbook tells the on-call:

1. What metric tripped.
2. What the historical baseline is.
3. The first three things to check (recent deploy, recent traffic change, recent upstream change).
4. The first three diagnostics to run (heap diff, goroutine profile, FD count).
5. The escalation path.

Without runbooks, alerts page someone who then spends fifteen minutes orienting themselves. With runbooks, the time-to-mitigation drops dramatically.

### Anti-pattern: noisy alerts

If an alert fires more than once a week, the on-call learns to ignore it. The alert is then *worse than useless*. Either tune the threshold, fix the underlying problem, or delete the alert.

---

## Building a steady-state chaos harness

A chaos harness is a long-running test that exercises steady-state under realistic load and failure conditions. It runs in CI nightly or in a permanent staging environment.

### Components

1. **Load generator.** Produces request rate at peak production levels, plus some headroom.
2. **Failure injector.** Periodically introduces upstream slowness, dropped connections, GC pressure, etc.
3. **Metric collector.** Records `runtime/metrics`, application metrics, OS counters.
4. **Invariant checker.** At the end of the run, asserts steady-state invariants.

### Skeleton

```go
package chaos

type Harness struct {
    Load         func(ctx context.Context) error
    InjectChaos  func(ctx context.Context)
    Sample       func() Sample
    Invariants   []Invariant
    Duration     time.Duration
    SampleEvery  time.Duration
    ChaosEvery   time.Duration
}

type Sample struct {
    T              time.Time
    HeapBytes      uint64
    Goroutines     int
    OpenFDs        int
    QueueDepth     int
}

type Invariant func(samples []Sample) error

func (h *Harness) Run(ctx context.Context) error {
    ctx, cancel := context.WithTimeout(ctx, h.Duration)
    defer cancel()

    var samples []Sample
    var sampleMu sync.Mutex

    // Load goroutine
    go func() {
        for ctx.Err() == nil {
            _ = h.Load(ctx)
        }
    }()

    // Chaos goroutine
    go func() {
        t := time.NewTicker(h.ChaosEvery)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                h.InjectChaos(ctx)
            }
        }
    }()

    // Sampling goroutine
    sampleTicker := time.NewTicker(h.SampleEvery)
    defer sampleTicker.Stop()
    for {
        select {
        case <-ctx.Done():
            // Final checks
            sampleMu.Lock()
            defer sampleMu.Unlock()
            for _, inv := range h.Invariants {
                if err := inv(samples); err != nil {
                    return err
                }
            }
            return nil
        case <-sampleTicker.C:
            s := h.Sample()
            sampleMu.Lock()
            samples = append(samples, s)
            sampleMu.Unlock()
        }
    }
}
```

### Example invariants

```go
func HeapSlope(maxBytesPerHour float64) Invariant {
    return func(samples []Sample) error {
        if len(samples) < 10 {
            return nil
        }
        x, y := slopeData(samples, func(s Sample) float64 { return float64(s.HeapBytes) })
        slope := linearRegressionSlope(x, y)
        // slope is bytes per nanosecond; convert
        bytesPerHour := slope * float64(time.Hour)
        if bytesPerHour > maxBytesPerHour {
            return fmt.Errorf("heap drift %v B/hour exceeds budget %v",
                bytesPerHour, maxBytesPerHour)
        }
        return nil
    }
}

func GoroutineMax(max int) Invariant {
    return func(samples []Sample) error {
        for _, s := range samples {
            if s.Goroutines > max {
                return fmt.Errorf("goroutine count %d exceeded budget %d",
                    s.Goroutines, max)
            }
        }
        return nil
    }
}
```

### Running it

In CI:

```bash
# nightly job
go test -run TestChaosOneHour -timeout=2h ./chaos/...
```

In staging:

A continuously-running pod that hits the staging API endpoint and reports invariant violations to the team's chat. Long-running staging chaos catches things CI cannot — slow leaks measured in days.

### What chaos finds

In our experience:

- Per-request goroutines without bound (caught quickly, often in the first hour).
- Missing `defer Close` on error paths (caught in the first day).
- Cache without TTL (caught over several days as the cache slowly fills).
- Allocator fragmentation (caught only over weeks, in long-running staging).

---

## Architecture-level patterns

### Per-shard isolation

A service that sharards its workload by some key (tenant ID, user ID, region) can have *independent* steady-state per shard. A pathology in one shard does not affect the others.

The trade-off:

- More resources per node (each shard has its own pool, its own goroutines).
- Less load smoothing across shards.
- More complex code.

For services with hostile tenant patterns, per-shard isolation is worth the complexity. For uniform-load services, a single shared pool is fine.

### Backpressure as a system property

Backpressure is not a single line of code; it is a property of the whole system. The pattern:

1. The slowest downstream slows down.
2. Goroutines waiting on it are bounded (semaphore, pool).
3. New work that would create new waiting goroutines is rejected or queued.
4. The queue is bounded.
5. When the queue is full, the load balancer is told (via 503, readiness=false) and shifts traffic elsewhere.

This is the steady-state cousin of the [drain pattern](../05-drain-pattern/). Where drain is "wind down on shutdown," backpressure is "wind down when overloaded."

### Burst tolerance vs sustained throughput

These are two different design points.

- **Burst tolerance:** the system can absorb a short spike (one or two seconds) above sustained capacity without losing requests. Implementation: oversized buffers, larger pool maximum.
- **Sustained throughput:** the system can handle a steady load at capacity X forever. Implementation: workers sized to X, queues sized to absorb burst only.

Confusing the two leads to overprovisioning (sized for burst) or to outages (sized for sustained, no burst absorber). Be explicit about which you are designing for. Most production services need both: a small burst absorber over a sustained-throughput base.

### The control loop

For services that adapt to load (autoscalers, batch sizers, rate limiters), the steady-state pattern is a *control loop*:

1. Measure a signal (queue depth, latency, error rate).
2. Compare to a target.
3. Adjust a control variable (worker count, rate limit, batch size).
4. Repeat at a frequency that is slow enough to be stable, fast enough to react.

Classic control theory applies. PI controllers (proportional + integral) are the workhorse. PID is overkill for most services.

---

## Cross-cutting concerns

### Logging

Logs are a steady-state resource. A service that logs at one MB per second produces 86 GiB per day. Disk fills; log shippers fall behind; the application's logging-write latency rises.

Steady-state for logs:

- Cap the log rate per request type.
- Use sampling for high-volume events (one log per 1000 requests, plus all errors).
- Use rotation: `logrotate`, `lumberjack`, or your platform's equivalent. Rotate by size and time.
- Set retention: delete files older than N days.

### Metrics

A service exporting metrics at high cardinality creates a steady-state problem for the monitoring system, not the service itself. The pattern:

- No unbounded label values (user ID, request ID, IP address).
- Bounded label dimensions (status code yes; full URL no).
- Histogram bucket counts in the low tens, not hundreds.

Cardinality explosion is a "leak in someone else's service."

### Tracing

Trace sampling: in steady-state, sample one in a thousand requests, plus all errors and slow ones. Full tracing is for development.

Trace storage: bounded retention. Tracing buffer overflow is a backpressure event.

### Background tasks

Periodic compaction, cache eviction, snapshot rotation, etc.:

- Schedule on a fixed interval.
- Stagger across instances to avoid synchronised peaks.
- Budget CPU and memory; pause if the system is loaded.

The pattern: every background task should be a goroutine with a ticker, a context, and an explicit budget.

```go
func backgroundCompaction(ctx context.Context, db *DB, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            // Budgeted run; aborts if it runs too long.
            ctx, cancel := context.WithTimeout(ctx, interval/2)
            _ = db.Compact(ctx)
            cancel()
        }
    }
}
```

The half-interval budget ensures the next tick fires on time. A task that overruns its budget is a steady-state violation.

---

## Steady-state under autoscaling

Autoscaling changes the steady-state question from "this pod is stable" to "the fleet is stable."

### Scale-out steady-state

When traffic rises, the autoscaler spins up new pods. Each new pod goes through:

1. Boot (Go runtime initialisation, dependency dials).
2. Warm-up (cache pre-warm, connection pool fill).
3. Steady-state.

The combined latency curve of the fleet during scale-out can be ugly: new pods are slow, old pods are unaffected, the average degrades. Mitigations:

- Readiness gates that hold a pod out of rotation until warm.
- Pre-warm scripts that fetch a cache snapshot from shared storage at boot.
- Pool pre-warm: open all pool connections during init, before serving.

### Scale-in steady-state

When traffic drops, the autoscaler removes pods. The drain pattern (linked above) handles this. From the steady-state angle: ensure the fleet's total resources don't drop below the load's needs. Scale-in policies should be conservative (slow ramp-down).

### Steady-state across scales

A service whose per-pod steady-state is good can still have a fleet-level steady-state problem. Example: the database is sized for ten pods; the autoscaler grows to forty during a spike; database connection limits are now exceeded.

Per-pod resource budgets must be sized assuming the maximum fleet size. If `MaxOpenConns = 25` per pod and the database supports 200 connections, the max fleet is eight pods. Going above eight risks denial of service to the database.

This is a common production miss: the per-pod settings look fine in isolation but the fleet exceeds upstream capacity.

---

## The on-call reality

Steady-state design is most valuable when no one is looking. The metric that matters is: how many alerts about steady-state drift did the on-call get last month?

### A good month

Zero or one. Maybe one minor alert that was diagnosed and silenced within an hour. No incidents, no escalations, no late-night debugging.

### A bad month

Five or more. Each one consumes ninety minutes of investigation. The team is exhausted. The dashboards aren't quite right. The runbooks point to dead links.

### The transition

To get from bad-month to good-month:

1. Triage the alerts. For each: was it actionable? Did the runbook help? What was the root cause?
2. For each non-actionable alert: tune or delete.
3. For each actionable alert: fix the root cause if possible, otherwise improve the runbook.
4. For root causes that are architectural: prioritise the architectural fix on the roadmap.

The pattern is iterative. Three months of focused work usually brings even a bad-month service to a good-month state. The cost is real engineering hours; the benefit is real engineer wellbeing.

---

## Self-assessment

1. Name the four slow-decline failure modes and one diagnostic for each.
2. Why does `GOGC` matter less when `GOMEMLIMIT` is set?
3. What is the difference between utilisation and saturation as metrics?
4. How do you design an alert that catches drift but ignores transient spikes?
5. What invariants would a chaos harness check at the end of a one-hour run?
6. When is per-shard isolation worth the complexity?
7. What is the steady-state implication of `MaxOpenConns = 25` per pod across forty autoscaled pods, talking to a database with `max_connections = 200`?
8. Why are runbooks more important than alerts?
9. What is the relationship between burst tolerance and sustained throughput?
10. How do you tell allocator fragmentation from a heap leak?

---

## Architecture decision records

For every steady-state-relevant decision, write a brief ADR. Three sections: context, decision, consequences.

### Example ADR

**Title:** Per-shard isolation for the user-profile service.

**Context:** The user-profile service serves tens of thousands of tenants. Two tenants account for 40% of traffic. Their occasional pathology (request bursts, large payloads) degraded the median latency for all other tenants by 30%.

**Decision:** Adopt per-shard isolation. Shard by tenant ID modulo 16. Each shard has its own worker pool (capacity 8), its own database connection pool (5 connections), its own metrics. Tenants are mapped to shards by consistent hash.

**Consequences:**

- Resource cost: 16x worker pools per pod, 16x DB pool entries. Memory cost about 50 MiB per pod (acceptable).
- Code complexity: one new abstraction (`Shard`), about 200 lines.
- Blast radius: one shard's pathology no longer affects the other 15.
- Observability: per-shard metrics now available; one dashboard panel per shard.

These ADRs become the institutional memory of why decisions were made. Future engineers can read them, understand the context, and revise if the context has changed.

---

## Sizing for steady-state in a multi-process model

A common production pattern is one Go binary per worker process per CPU. A pod with 4 CPUs runs 4 processes, each with its own runtime, heap, and pools.

This affects sizing:

- Per-process `GOMEMLIMIT` must be sized so that 4 processes do not exceed the container memory limit.
- Per-process `MaxOpenConns` must be sized so that 4x that does not exceed the database's fair share.
- Per-process worker count is the per-CPU count divided by 4.

The math is harder than the single-process case, but the principles are the same. The penalty for getting it wrong is the same: drift, drift, drift.

For most services, a single process per pod is simpler and equally performant. The multi-process pattern is for very specific workloads (very large heaps that overflow goroutine scheduling, services that need process-level isolation).

---

## Steady-state at process boundaries

A service rarely lives alone. It calls others; it is called by others. Each boundary is a steady-state question.

### Upstream-induced drift

Your service is steady, but the upstream is drifting. Their p99 grows, your p99 follows. Your only defences are timeouts (cut off the slow upstream calls), circuit breakers (refuse to call when failure rate is high), and bulkheads (limit concurrent calls to that upstream).

### Downstream-induced drift

The downstream caller is slowing down. You absorb more concurrent in-flight calls than expected. Defences: bound concurrent in-flight calls per caller (per-tenant semaphore), reject excess (503).

### Resource consumption visible to operators

A common production miss: a service that drifts up to 90% memory consumption is not visible to the operator unless they specifically look. The on-call dashboard should make resource utilisation a *prominent* metric, not buried under SLOs.

Pattern: a "service health" panel at the top of every dashboard. Three numbers: memory utilisation, CPU utilisation, queue saturation. If any is in the yellow, the service is at risk.

---

## Steady-state versus elasticity

A service can be designed for either steady-state or elasticity, not always both.

- **Steady-state design:** sized for the average load, with a small burst absorber, autoscaler ramping slowly. Cheap to run, predictable, gentle on dependencies.
- **Elastic design:** sized for low load, autoscaler ramps quickly, can absorb 10x bursts. Expensive overhead per scale event, dependencies see correlated load.

Most production services choose steady-state with bounded elasticity. The autoscaler can add or remove pods up to a configured limit; beyond that, requests shed. The system has both a steady operating point and a graceful degradation curve.

For services with extreme bursts (Black Friday, sporting events, news cycles), elasticity dominates. For services with predictable load (internal APIs, periodic batch), steady-state dominates. The decision depends on the workload.

---

## Build vs buy on steady-state libraries

Several common steady-state components are available off-the-shelf:

- **`KimMachineGun/automemlimit`** — sets `GOMEMLIMIT` from cgroup at startup.
- **`hashicorp/golang-lru`** — bounded LRU cache.
- **`dgraph-io/ristretto`** — TTL + size-bounded cache with sharding.
- **`sony/gobreaker`** — circuit breaker.
- **`golang.org/x/sync/semaphore`** — weighted semaphore.
- **`golang.org/x/time/rate`** — token-bucket rate limiter.

Most of these are well-tested, narrow in scope, and small in code. Use them. Reinventing them produces bugs that the library has already fixed.

The exception: a worker pool with bounded queue is so simple and varies so much by application that most teams write their own. The version in this section is a starting point.

---

## Defensive design under partial failures

A service is "in steady-state" when *all components* are steady. What if one is not?

### One pod is sick

The fleet remains steady because the load balancer routes around the sick pod (readiness=false). The sick pod is restarted. Steady-state is fleet-level.

### One shard is overwhelmed

Other shards remain steady because they have independent resources. The overwhelmed shard's tenants experience errors; other tenants do not.

### One upstream is slow

Your service's calls to that upstream are bounded (per-upstream timeout, per-upstream circuit breaker, per-upstream pool). The rest of your service is unaffected.

### One downstream caller is hostile

Per-caller rate limiting and per-caller semaphore. The hostile caller is throttled. Other callers are unaffected.

The thread: every cross-boundary interaction has a *bound* in your code. Bounded calls, bounded queues, bounded pools, bounded resources. The pathology at any boundary is contained, not amplified.

---

## Continuous steady-state verification

The best steady-state engineering is verified continuously, not at release time. The pattern:

1. The chaos harness runs in CI every night. Failed invariants block the next release.
2. A canary deployment runs the new code on 1% of traffic. Steady-state metrics are watched for one hour before full rollout.
3. Production dashboards are reviewed weekly. Slow drift caught at week 1, not month 6.
4. A "long-runner" staging pod runs the latest code continuously for two weeks. New deploys go there first; only after two weeks of clean steady-state does the code go to production.

This sounds expensive. It is — until you compare it to the cost of a 3 a.m. production incident, the cost of customer-facing tail-latency, the cost of unbounded engineer hours spent on fire-fighting. Continuous verification is cheap relative to ad-hoc fire-fighting.

---

## A more complete sample service

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "io"
    "log"
    "net/http"
    "net/http/pprof"
    "os"
    "os/signal"
    "runtime/debug"
    "sync/atomic"
    "syscall"
    "time"

    _ "github.com/jackc/pgx/v5/stdlib"
)

type Service struct {
    db       *sql.DB
    client   *http.Client
    pool     *Pool
    tenants  *TenantLimit
    isReady  atomic.Bool
}

func NewService() (*Service, error) {
    db, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
    if err != nil {
        return nil, err
    }
    db.SetMaxOpenConns(20)
    db.SetMaxIdleConns(20)
    db.SetConnMaxLifetime(30 * time.Minute)
    db.SetConnMaxIdleTime(5 * time.Minute)

    client := &http.Client{
        Transport: &http.Transport{
            MaxIdleConns:        200,
            MaxIdleConnsPerHost: 50,
            MaxConnsPerHost:     100,
            IdleConnTimeout:     90 * time.Second,
        },
        Timeout: 30 * time.Second,
    }

    s := &Service{
        db:      db,
        client:  client,
        pool:    NewPool(20, 40),
        tenants: NewTenantLimit(5, 5*time.Minute),
    }
    return s, nil
}

func (s *Service) Warmup(ctx context.Context) error {
    // Pre-warm DB pool.
    if err := prewarmDB(ctx, s.db, 20); err != nil {
        return err
    }
    // Could pre-warm HTTP, caches, etc.
    s.isReady.Store(true)
    return nil
}

func (s *Service) Routes() http.Handler {
    mux := http.NewServeMux()
    mux.HandleFunc("/healthz", s.healthz)
    mux.HandleFunc("/readyz", s.readyz)
    mux.HandleFunc("/api/profile", s.handleProfile)
    // pprof on a separate localhost listener typically; mounted here for simplicity.
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    return mux
}

func (s *Service) healthz(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
}

func (s *Service) readyz(w http.ResponseWriter, r *http.Request) {
    if !s.isReady.Load() {
        w.WriteHeader(http.StatusServiceUnavailable)
        return
    }
    // Optional: degrade readiness under sustained queue overload.
    if s.pool.QueueDepth() > s.pool.Capacity()*9/10 {
        w.WriteHeader(http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
}

func (s *Service) handleProfile(w http.ResponseWriter, r *http.Request) {
    tenant := r.Header.Get("X-Tenant-ID")
    if tenant == "" {
        http.Error(w, "missing X-Tenant-ID", http.StatusBadRequest)
        return
    }
    err := s.tenants.Do(r.Context(), tenant, func() {
        ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
        defer cancel()
        _, _ = s.db.ExecContext(ctx, "SELECT 1")
    })
    if err != nil {
        if errors.Is(err, context.DeadlineExceeded) {
            http.Error(w, "timeout", http.StatusGatewayTimeout)
            return
        }
        http.Error(w, err.Error(), http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
}

func (s *Service) Close(ctx context.Context) error {
    s.isReady.Store(false)
    if err := s.pool.Stop(ctx); err != nil {
        log.Println("pool stop:", err)
    }
    return s.db.Close()
}

func main() {
    // Set GOMEMLIMIT before any user allocation. In real code, use
    // automemlimit; for the example we hard-code.
    debug.SetMemoryLimit(int64(0.9 * 2 * 1024 * 1024 * 1024))

    ctx, cancel := signal.NotifyContext(context.Background(),
        syscall.SIGTERM, syscall.SIGINT)
    defer cancel()

    svc, err := NewService()
    if err != nil {
        log.Fatal(err)
    }

    if err := svc.Warmup(ctx); err != nil {
        log.Fatal(err)
    }

    srv := &http.Server{
        Addr:              ":8080",
        Handler:           svc.Routes(),
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

    shutdownCtx, shutdownCancel := context.WithTimeout(
        context.Background(), 25*time.Second)
    defer shutdownCancel()

    _ = srv.Shutdown(shutdownCtx)
    _ = svc.Close(shutdownCtx)

    // Drain the rest of the response bodies we might still hold.
    _, _ = io.Copy(io.Discard, nil) // placeholder
}
```

Every steady-state principle from junior, middle, and senior appears in this 130-line program. The pattern is reproducible — for any service you build, the skeleton looks similar.

---

## Anti-patterns at the senior level

### Premature optimisation of `GOGC`

Don't tune `GOGC` until you have set `GOMEMLIMIT`, fixed the bounded queues, and tuned the connection pools. Tuning the wrong knob first wastes time.

### Custom-rolled circuit breakers

If you have not measured the failure rate distribution and threshold-tuned the breaker, you have a placeholder. Use `sony/gobreaker` or measure carefully.

### Alerts on absolute thresholds, not slopes

Catches incidents only after they have already crossed a line. Slope alerts catch them earlier.

### Ignoring the chaos harness output

If the chaos harness fails an invariant in CI, fix the failure. Don't muffle the test. The harness is the canary; muting it makes the next incident worse.

### Treating the budget as the goal

"Stay under fifty MiB per day leak rate" is a *budget*, not an aspiration. The aspiration is zero. The budget is a tolerance, not a target.

---

## A senior's reading list

Beyond the immediate Go ecosystem:

- Russ Cox's articles on the Go runtime, especially the scheduler and memory model.
- Brendan Gregg's "Systems Performance" — the USE method, latency analysis.
- Cindy Sridharan's "Distributed Systems Observability" — telemetry strategy.
- Postmortems from companies that publish them: Cloudflare's, Stripe's, GitHub's.
- The Go runtime source, especially `runtime/mgcpacer.go` and `runtime/mgc.go`.

The pattern across all of these: production engineering is *empirical*. You measure, hypothesise, change, measure again. Theory informs the hypothesis; data confirms or rejects.

---

## Self-assessment, extended

1. Walk through how you would tune `GOGC` and `GOMEMLIMIT` for a service with peak 80% memory utilisation and 5% GC CPU.
2. Design an alert that catches deadline drift in p99 latency over 24 hours.
3. Sketch the architecture of a chaos harness that injects three failure modes.
4. Justify per-shard isolation versus a single shared pool for a service with 10,000 tenants.
5. Explain how `MaxOpenConns` at the pod level interacts with database `max_connections` at the fleet level.
6. Identify the resource axes a complete dashboard tracks.
7. Describe the difference between scale-out and scale-in steady-state.
8. Explain the role of readiness probes in fleet-level backpressure.
9. Distinguish allocator fragmentation from a heap leak.
10. Describe one ADR you would write for a recent decision and why.

---

## Summary

Senior steady-state engineering is design, not coding. The core skills:

- Recognise the four slow-decline failure modes by fingerprint.
- Tune `GOGC` and `GOMEMLIMIT` to a measured workload.
- Build saturation-based dashboards and slope-based alerts.
- Run a chaos harness against the service in CI and staging.
- Make architecture decisions about isolation, backpressure, burst absorption.
- Maintain runbooks that turn alerts into mitigations.
- Write ADRs that capture the rationale for future engineers.

The product is not a clever piece of code. It is a service that runs for months without paging anyone. The professional page tells the war stories of services that did and did not achieve this; treat them as case studies in the principles above.

---

## Appendix A — `runtime/metrics` reference

The metrics worth wiring into your saturation dashboard, with rationale:

### Memory class

- `/memory/classes/heap/objects:bytes` — live heap (post-GC).
- `/memory/classes/heap/free:bytes` — free spans held by the runtime.
- `/memory/classes/heap/released:bytes` — memory returned to the OS.
- `/memory/classes/heap/stacks:bytes` — goroutine stacks.
- `/memory/classes/heap/unused:bytes` — heap memory not in use but not yet returned.
- `/memory/classes/total:bytes` — sum of all classes.

Plot all together on one panel. Their sum should be flat in steady-state. If any one is rising, that's the leaking class.

### GC class

- `/gc/cycles/total:gc-cycles` — total GC cycles. Rate per minute tells you how often GC is running.
- `/gc/heap/allocs:bytes` — total allocations. Rate tells you how much your code allocates per second.
- `/gc/heap/frees:bytes` — total frees. Rate should match allocs rate in steady-state.
- `/gc/pauses:seconds` — histogram of pause durations. Watch p99, not mean.
- `/gc/cpu/percent:%` — CPU fraction spent in GC. Watch p99; above 5% is concerning.

### Scheduler class

- `/sched/goroutines:goroutines` — current goroutine count.
- `/sched/latencies:seconds` — histogram of goroutine wake-to-run delay.
- `/sched/gomaxprocs:threads` — `GOMAXPROCS` value.

The scheduling latency histogram is one of the most powerful but underused diagnostic signals. p99 of scheduling latency rising means goroutines are waiting for a CPU; the service is CPU-saturated.

### Sync class

- `/sync/mutex/wait/total:seconds` — cumulative time blocked on mutex acquire.

Compute the rate per second: if it's growing, mutex contention is rising. Cross-reference with the mutex profile.

### CPU class

- `/cpu/classes/gc/total:cpu-seconds` — CPU spent in GC.
- `/cpu/classes/idle:cpu-seconds` — CPU spent idle.
- `/cpu/classes/total:cpu-seconds` — total CPU consumed.
- `/cpu/classes/user:cpu-seconds` — CPU in user code.

The user/total ratio tells you what fraction of CPU is doing useful work versus overhead.

---

## Appendix B — Detailed `pprof` workflows

### Heap diff

The single most useful diagnostic for a memory leak.

```bash
# Take snapshot at T0
curl -s http://localhost:6060/debug/pprof/heap > T0.pb.gz

# Wait 30 minutes
sleep 1800

# Take snapshot at T1
curl -s http://localhost:6060/debug/pprof/heap > T1.pb.gz

# Compare
go tool pprof -base T0.pb.gz T1.pb.gz
(pprof) top 20
(pprof) list <function name>
(pprof) web    # opens browser with call graph
(pprof) traces # shows allocation paths
```

The output of `top` shows the functions whose live allocation grew between the snapshots. The leak is almost always at the top of this list.

### Goroutine analysis

```bash
# Compact list with counts per stack
curl -s http://localhost:6060/debug/pprof/goroutine?debug=1

# Full stack of every goroutine
curl -s http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
```

The compact list is the right starting point. Look for stacks with counts in the hundreds or thousands; those are leaks.

### Allocation profile (cumulative)

```bash
go tool pprof -alloc_space http://localhost:6060/debug/pprof/allocs
(pprof) top 20
```

`-alloc_space` measures *cumulative* allocations, not live ones. A function that allocates and immediately frees still shows up here. Useful for identifying allocation hotspots that drive GC pressure.

### Block profile

```bash
runtime.SetBlockProfileFraction(100) // sample 1% of blocking events

# Later:
go tool pprof http://localhost:6060/debug/pprof/block
```

Shows where goroutines are blocked. Channel sends, channel receives, mutex acquires.

### Mutex profile

```bash
runtime.SetMutexProfileFraction(100)

# Later:
go tool pprof http://localhost:6060/debug/pprof/mutex
```

Shows mutex contention. Different from block: this measures time spent in `Lock` contention, not in general blocking.

### Execution trace

```bash
curl -s http://localhost:6060/debug/pprof/trace?seconds=5 > trace.out
go tool trace trace.out
```

Opens a browser-based UI showing every goroutine's timeline, every GC event, every scheduler decision. Heavyweight; use for short windows.

---

## Appendix C — Anti-pattern reference

A list of the patterns that *break* steady-state, with citations to the pages where each is discussed:

| Anti-pattern | Cited in | Failure mode |
|---|---|---|
| Unbounded channel buffer | junior, find-bug | Heap explosion under sustained overload. |
| Per-request goroutine | junior, find-bug | Goroutine count grows with traffic. |
| Map as cache | middle, find-bug | Unbounded growth. |
| Missing `defer Close` | junior, middle | FD or connection leak. |
| `time.After` in loop | middle, find-bug | Timer accumulation. |
| Tenant map without GC | middle, find-bug | Map grows forever with rotating tenant IDs. |
| `MaxIdleConnsPerHost=2` | middle, optimize | Connection churn under load. |
| `MaxOpenConns=0` (unlimited) | middle, find-bug | Database connection exhaustion. |
| No `context.Timeout` | senior, professional | Deadline drift. |
| No `signal.NotifyContext` | senior | Hard kills, lost work. |
| `GOMEMLIMIT` after first alloc | find-bug, professional | Pools allocate before limit is enforced. |
| `GOGC=off` in long-running | optimize | Memory grows unbounded. |
| `GOMAXPROCS` from host CPU count | optimize | Thread oversubscription in containers. |

Each anti-pattern has a known fix. Treat this table as a checklist during code review.

---

## Appendix D — Sketch of a steady-state library

Most production engineering teams accumulate their own internal "steady-state library." A sketch of what it might contain:

### Package `pool`

- `Pool` — bounded worker pool with submit modes.
- `AutoScaler` — control loop for adjusting worker count.
- `Stats` — pool metrics exporter.

### Package `tenant`

- `Limit` — per-tenant semaphore with idle GC.
- `RateLimiter` — per-tenant token-bucket rate limit.

### Package `memlimit`

- `SetFromCgroup` — read cgroup and call `SetMemoryLimit`.

### Package `metrics`

- `RuntimeExporter` — periodic poll of `runtime/metrics`.
- `DBStatsExporter` — periodic poll of `sql.DBStats`.

### Package `chaos`

- `Harness` — long-running load + chaos + invariant checker.

### Package `healthz`

- Standard handlers for `/healthz` and `/readyz`.

A team that has built this library, and uses it consistently across services, has institutionalised steady-state engineering. New services inherit the patterns by default.

---

## Appendix E — When steady-state is *not* the goal

Not every Go program needs steady-state engineering. Examples where it does not apply:

- **CLI tools.** Run to completion in seconds. Allocation patterns are dominated by program structure, not by long-time-scale effects.
- **Build tools.** Same as CLI.
- **One-off scripts.** Maintain operational hygiene, but the cost of full steady-state engineering is wasted.
- **Embedded sidecars** with very short lifetimes (function execution, lambda-style).
- **Batch jobs** that run for a known duration with bounded input.

For these, you can skip:

- `GOMEMLIMIT` (the OS handles it on exit).
- Chaos harnesses.
- Saturation dashboards.
- Per-tenant isolation.

You should still:

- Pair `Open` with `Close`.
- Handle errors.
- Use bounded resources where they apply.

The discipline scales with the service's lifetime. A two-week project deserves less; a six-year mature production service deserves all of it.

---

## Appendix F — Quick reference cards

### When the heap is climbing

1. Take two snapshots 30 min apart.
2. `go tool pprof -base T0 T1`.
3. `top 20`, `list <top function>`.
4. Find the line that allocates; find the reference that prevents collection.
5. Fix or budget.

### When goroutines are climbing

1. `curl /debug/pprof/goroutine?debug=1`.
2. Find the stack with the highest count.
3. Locate that stack in code.
4. Trace what should make the goroutine exit; find why it doesn't.
5. Fix the exit path.

### When FDs are climbing

1. `ls /proc/$PID/fd | wc -l`.
2. `ls -l /proc/$PID/fd | awk '{print $11}' | sort | uniq -c | sort -nr`.
3. Identify the type of FD (socket, pipe, file).
4. Locate the code path that opens that type; find the missing close.

### When p99 is climbing

1. Sample latency histogram per minute over the last 6 hours.
2. Identify the downstream call(s) with co-rising tails.
3. Check their timeouts and circuit breakers.
4. Add timeouts; consider a circuit breaker.

### When pool wait time is climbing

1. `db.Stats()` or equivalent.
2. Is `InUse` near `MaxOpenConns`? Pool is too small or downstream is slow.
3. Is `WaitCount` growing while `InUse` is below max? Lock contention; size pool up.
4. Decide: raise the pool limit, or fix the slow downstream.

These cards belong in a printable form near the on-call's desk.

---

## Appendix G — Cross-service steady-state

Single services are easier than systems-of-services. When your steady-state depends on three downstream services, each of which depends on more, the math compounds.

### Coupling through retries

Retries propagate load: if your service retries on failure, and the downstream is slow, your service generates more load than the originating QPS suggests. Two services in a retry loop can multiply load by factors of three or four.

Mitigations:

- Exponential backoff with jitter.
- Bounded retry count.
- Circuit breaker so failures stop retries instead of generating more load.
- Cross-service budgets: "total retries per request" is a shared budget across the call chain.

### Coupling through caching

A cache miss in service A causes a request to service B. If service B is slow, the cache miss is slow; if many requests miss at once (a "thundering herd"), service B is overwhelmed.

Mitigations:

- Single-flight: only one request per cache key is in flight at a time; others wait for the first.
- Cache warming: pre-populate the cache from a snapshot.
- Soft TTL: serve stale data while a single refresh is in flight.

### Coupling through shared databases

Multiple services hitting the same database share its `max_connections` and its CPU. Service A's burst can starve service B.

Mitigations:

- Per-service connection pool limits sum to less than the database's `max_connections`.
- Per-service rate limits on queries.
- Database-level resource limits (Postgres' `application_name` plus `pg_stat_statements` for accountability).
- Long-term: split the database, or use read replicas.

### Steady-state as a contract

When services interact, steady-state becomes a *contract*: each side guarantees certain bounds, and consumes the other's bounds. Document them:

- "Our service makes at most N requests per second to yours."
- "Our service holds at most M connections at any time."
- "Our timeout for calls to your service is T."
- "We retry at most R times with exponential backoff starting at B."

When both sides know these, capacity planning across the system becomes possible. Without them, every team is sized for their own bursts, the union is oversubscribed, and the failure mode is correlated across services.

---

## Appendix H — Steady-state and observability

Observability is the discipline of asking unknown questions of running systems. Steady-state is the discipline of bounding what those systems can do. The two are complementary.

### Telemetry coverage matrix

A steady-state-aware observability matrix has rows for resources and columns for telemetry types:

| Resource | Metric | Trace | Log |
|---|---|---|---|
| Heap | post-GC size, GC pauses | (no) | OOM events |
| Goroutines | count, scheduling latency | (no) | panic stacks |
| FDs | count by pid | (no) | EMFILE errors |
| Pool — DB | InUse, WaitCount, WaitDuration | yes (query) | slow query log |
| Pool — HTTP | active conns, dial failures | yes (HTTP span) | dial errors |
| Queue | depth, dropped, processing time | yes (per item) | (no) |
| Tenant sem | held, waiters | yes (per tenant) | denied requests |
| External call | count, p99, errors | yes (full) | error details |

A good observability strategy fills in each cell with the right telemetry.

### Sampling

In a service that handles ten thousand requests per second, exporting one metric per request is not feasible. Sample:

- 100% of errors.
- 100% of slow requests (above a threshold).
- 0.1% of normal requests (sampled by deterministic hash on request ID).

This gives you full visibility into rare events and enough visibility into common ones to spot trends.

### Distributed traces

A request flowing through five services produces one trace with five spans. The trace identifies which service is the bottleneck. Without traces, you guess.

Steady-state benefits:

- Long-tail traces reveal which downstream is causing your tail.
- Trace counts per service identify hot paths.
- Trace duration histograms feed slope-based alerts.

OpenTelemetry has become the de facto standard. Wire it through your service.

### Logs

A few rules for steady-state-friendly logs:

- Structured (JSON or logfmt).
- One line per request at most (sampled).
- Errors always logged, never sampled.
- No PII in logs (separate compliance concern; also a privacy risk).
- Cap log volume: a bug that triggers a log on every request can swamp the log ingestion pipeline.

If your service is logging at one MB per second, that is 86 GB per day. Most platforms cannot ingest that economically. Sample.

---

## Appendix I — Service-level objectives and steady-state

An SLO is a numerical commitment: "99.9% of requests succeed within 200 ms." Steady-state is what makes SLOs achievable.

### SLOs that depend on steady-state

- **Availability SLO.** Achievable only if the service does not crash or hang. Steady-state engineering prevents both.
- **Latency SLO.** Achievable only if p99 stays bounded. Steady-state prevents tail-latency drift.
- **Throughput SLO.** Achievable only if the service handles the load. Steady-state ensures it does not buckle under sustained load.
- **Correctness SLO.** Achievable only if in-flight work survives transient conditions. Drain pattern plus steady-state ensures this.

### The error budget

An SLO of 99.9% allows 0.1% errors. If your service is exceeding the SLO (e.g., 99.99%), you have an error budget to spend on risk: ship features faster, deploy more often. If you are missing the SLO, you must spend more time on reliability.

Steady-state engineering converts error budget into runway. A service in steady-state can deploy on Friday afternoon. A service drifting needs the reliability work first.

### Setting the SLO

The right SLO is the one that:

- Reflects customer experience (not "internal happiness").
- Is achievable with reasonable engineering effort.
- Is measurable from real user traffic, not from synthetic probes.
- Has a defined error budget and budget-burn alerts.

Steady-state targets are aligned to the SLO. If the SLO is 99.9% availability with 200 ms p99 latency, steady-state aims for "p99 stays under 200 ms for the full month."

---

## Appendix J — A retrospective question for the team

Once a quarter, ask the team:

1. What was the most recent incident, and was it a steady-state failure?
2. If yes, what alert *should have* caught it, and is that alert now in place?
3. If no, what category of failure was it, and what defences would have prevented it?
4. What is the *next* most likely steady-state failure, given the current architecture?
5. What investment would prevent it?

Treat the answers seriously. The "next most likely failure" is the one to prevent.

If the team cannot name any recent incident, the question becomes: are we drifting toward complacency? A long incident-free period is a sign of either great engineering or that the next incident will be especially nasty.

---

## Appendix K — Onboarding a new engineer to steady-state

A junior engineer joining the team should see:

- Day 1: introduction to the dashboards. Walk through each panel, what it measures, what good and bad look like.
- Day 2: introduction to the runbook. Pick one alert; walk through what it would look like firing.
- Day 3: shadow on-call. Observe how the on-call engineer triages and diagnoses.
- Week 1: read this section's pages, starting with junior.
- Week 2: take on a small reliability ticket. Add a metric, write a test, tune a parameter.
- Month 1: be on the secondary on-call rotation. Get paged at least once (deliberate test alert), respond, write the post-mortem.
- Month 3: lead the response to a real incident.
- Month 6: write a steady-state ADR for some upcoming change.

By month six, the engineer should be operating independently in production. The discipline is teachable; the timeline is teachable. Build the program; the engineers grow.

---

## Appendix L — The cost of not engineering for steady-state

To make the case for steady-state investment to non-engineers:

- An incident costs ~$X per hour in engineering time (sum of responders).
- An incident costs $Y per minute in customer impact (lost revenue, SLA penalties).
- A page at 3 AM costs $Z in engineer morale (hard to quantify; real).
- A culture of frequent pages costs M engineers per year in attrition (engineers leave teams that page them often).

Sum across a year, and the cost of *not* engineering for steady-state is concrete:

- 5 major incidents × 8 hours × $200/hour × 5 engineers = $40,000.
- 50 minor incidents × 30 minutes × $200/hour × 2 engineers = $10,000.
- 1 engineer attrition × $100,000 onboarding cost = $100,000.

Total: $150,000 per year of incident-driven cost, conservatively. The cost of *engineering* for steady-state (one engineer working part-time on reliability) is far less.

This math is approximate but real. The product manager who asks "why are we spending on reliability?" is asking the wrong question. The right question is: "how do we spend less on incidents this year?"

---

## Appendix M — When steady-state meets feature work

The product team wants to ship a new feature. The reliability backlog has unfinished items. How do you balance?

Decision principles:

- Features that depend on steady-state (e.g., a new high-throughput endpoint) must wait until the steady-state work is done.
- Features that *consume* engineering capacity (new on-call rotation, new dashboards) get smaller until reliability is healthy.
- Features in service of reliability (better metrics, better alerts, better runbooks) are *also* features; they ship with the same rigour.

A team that ships features faster than it engineers for steady-state will eventually slow down by way of incidents. The growth curve of reliability investment should match the growth curve of feature velocity.

---

## Appendix N — Working with platform teams

Many organisations have a platform team that owns shared infrastructure: Kubernetes, the deploy pipeline, observability, perhaps a service mesh. Steady-state engineering depends on the platform but is the service team's responsibility.

Negotiate clearly:

- The platform provides cgroups; the service uses them via `GOMEMLIMIT`.
- The platform provides metric ingestion; the service emits metrics.
- The platform provides alerting; the service defines the alert rules and runbooks.
- The platform provides chaos infrastructure; the service writes the chaos tests.

A platform team that does the work *for* services creates dependency. A platform team that gives services the tools and the patterns is more scalable.

This applies to internal libraries too: the steady-state library belongs to a centre of excellence, not embedded in every service.

---

## Senior summary, expanded

The senior engineer's job is not to write the most clever code. It is to make production *boring*. Specifically:

- Pick the metrics that matter, and only those.
- Set the alerts that catch real problems, not noise.
- Design the architecture so that one failure does not cascade.
- Document the decisions so future engineers can understand the why.
- Train the team so the discipline survives turnover.
- Engineer the tools so the work is repeatable.

When you read a post-mortem and think "we already caught that one earlier in the chain because we had alert X and runbook Y," you have arrived. The on-call shift was uneventful because of work done months or years ago.

That is the senior engineer's product.

---

## Appendix O — A taxonomy of "drift"

Drift comes in many shapes. Naming them helps the team communicate quickly during an incident.

### Linear drift

Resource grows by a constant amount per unit time. Easiest to detect: linear regression catches it. Examples: a counter incremented per request, a map entry added per session.

### Logarithmic drift

Resource grows quickly at first, then slowly. Often the result of a working set that approaches but never reaches some bound. Examples: a cache approaching its size limit, a connection pool approaching its `MaxOpenConns`.

This is the *expected* shape for many resources during warm-up. The danger is when it does not plateau.

### Exponential drift

Resource grows by a multiplicative factor per unit time. Rare but catastrophic. Examples: retries that beget more retries, feedback loops in queue depth.

Slope-based alerts may miss this until the slope itself crosses the threshold; the resource may already be at dangerous levels.

### Step drift

Resource jumps at discrete events. Examples: each deploy adds a goroutine; each user session adds a cache entry. Step drift is invisible to linear regression unless you sample frequently.

### Sawtooth drift

Resource rises, then a periodic process drops it, then it rises again. Examples: log rotation that is just barely keeping up, GC that runs more often as the heap nears `GOMEMLIMIT`.

The danger is when the rise rate exceeds the periodic drop rate; the sawtooth shifts upward over time.

### Stochastic drift

Resource grows on average but with high variance. Examples: connection pool fragmentation, depending on traffic patterns.

Requires longer observation windows. A six-hour slope can hide stochastic drift; a six-day slope reveals it.

Each shape has a different alerting strategy. A team that has seen all six is well prepared.

---

## Appendix P — When to roll back versus debug

During an incident, the choice between "roll back" and "stay forward and debug" is critical. Wrong choice extends the incident.

### Roll back when

- The drift started immediately after a deploy.
- A rollback restores known-good steady-state.
- The forward fix is not obvious within ten minutes.
- The cost of remaining in the drifted state is high.

### Stay forward when

- The drift started before the most recent deploy.
- The forward fix is obvious (a config change, a feature flag).
- A rollback would lose required functionality.
- The cost of remaining is low (a leak budget being exceeded by a small margin).

### The bias

When in doubt, roll back. Rollbacks are cheap; bad debugging in production is expensive. Save the debugging for a calmer environment.

This bias goes against engineering instinct (engineers want to *fix*, not retreat). But the on-call's job is to minimise customer impact, not to write the perfect fix. Roll back, breathe, then debug.

---

## Appendix Q — Steady-state across language boundaries

A Go service that calls into cgo (C++ libraries, kernel ioctls, GPU drivers) inherits the steady-state behaviour of the called code. The Go runtime cannot see C-side memory; the GC cannot collect C-side allocations.

Common pitfalls:

- **cgo allocations not freed.** Every `C.malloc` requires a `C.free`. The Go GC does not help.
- **C-side threads.** Some C libraries spawn threads. Each thread has its own stack. The Go runtime sees these as `M` threads but cannot bound them.
- **C-side caches.** A library's internal LRU is not visible to Go telemetry. It must be configured explicitly.

For Go services that use cgo heavily, the steady-state engineering effort includes:

- Auditing every cgo call for resource lifecycle.
- Wrapping cgo allocations in Go finalizers (with the caveat that finalizers run late).
- Configuring cgo library bounds (cache sizes, connection pools, thread pools) explicitly.
- Adding telemetry for cgo memory: read `/proc/self/status` (`VmRSS` minus the Go-visible portion).

The challenge is that cgo errors do not appear in Go-side dashboards. You have to know they exist.

---

## Appendix R — Steady-state and security overlap

Many resource bounds are also security defences. Maintaining steady-state is, in part, maintaining a hardened security posture.

| Steady-state bound | Security benefit |
|---|---|
| Bounded queue capacity | Defence against flood / denial of service |
| `MaxOpenConns` | Defence against database resource exhaustion |
| `ReadHeaderTimeout` | Defence against Slowloris |
| `MaxHeaderBytes` | Defence against oversized headers |
| Per-tenant rate limit | Defence against single-tenant abuse |
| `GOMEMLIMIT` | Defence against memory-pressure DoS |
| Bounded retry | Defence against retry amplification |
| `FD` count alert | Defence against FD exhaustion |

The engineer who has built a steady-state service has built half the security work for that service. The remaining half (authentication, authorisation, data validation, encryption) is separate, but the resource side is shared.

This is one of the under-sold benefits of steady-state engineering: it pays dividends in two unrelated columns of the operational budget.

---

## Appendix S — The economics of overprovisioning

A common alternative to careful steady-state engineering is "just throw more resources at it." Bigger pods, more replicas, larger pools. Sometimes this works.

When it works:

- The workload is genuinely growing and would have needed more resources anyway.
- The cost of resources is low relative to the engineering cost of optimisation.
- The drift is slow enough that overprovisioning buys enough time for a real fix.

When it does not:

- The drift is in goroutine count, not memory; bigger pods do not help.
- The drift is in FDs; raising `RLIMIT_NOFILE` only delays the problem.
- The drift compounds at scale; more replicas means more drift.
- The cost of resources is high (GPU instances, cross-region traffic).

The judgement call is one of the senior engineer's responsibilities. Overprovisioning is a legitimate tool when used deliberately. It becomes a problem when it is the *only* tool.

A useful question: "If we doubled the resources, would the service be stable for a year?" If yes, overprovisioning is fine. If no, you need real engineering.

---

## Appendix T — Long-term steady-state mindset

The senior engineer thinks not just about today's incident but about next year's incident. Habits that build this mindset:

- **After each incident, ask: what would have caught this at week one?** Build that detector.
- **After each deploy, monitor for an hour.** Even if nothing alarms, develop the habit of looking.
- **After each architectural change, ask: what new failure modes does this introduce?** Document them.
- **After each chaos run that *passed*, ask: what failure would we have missed?** Plan the next chaos scenario.

These habits compound. A team that has been practising them for years has a catalogue of detectors, runbooks, and patterns that outlives any individual engineer.

The product of senior engineering is not code. It is the team's resilience to a long tail of failure modes. The code is a side effect.

---

## Closing

If you have read all the way to this point, you have absorbed several thousand lines of steady-state material. The lessons:

- Steady-state is a *property*, engineered into a service by hundreds of small decisions made consistently.
- The four habits — bound queues, cap goroutines, pair lifecycles, set memory limits — solve most of the problem.
- Saturation metrics with slope alerts catch the remaining drift.
- Chaos harnesses catch what alerts miss.
- Runbooks turn alerts into mitigations.
- Post-mortems turn mitigations into prevention.

The journey from "service that works" to "service that is in steady-state for a year" is concrete. The pages in this section are the map.

Now go run a service for a year. The lessons here will become real.
