---
layout: default
title: Steady-State — Optimize
parent: Steady-State
grand_parent: Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/06-steady-state/optimize/
---

# Steady-State — Optimize

[← Back](../)

A tuning playbook. Each section is a knob, a trade-off, and a procedure for finding the right value. Treat these as defaults to start from, not absolutes.

## Table of Contents

1. [Pick `GOMEMLIMIT` first](#pick-gomemlimit-first)
2. [Pick `GOGC` second](#pick-gogc-second)
3. [Channel buffer sizing](#channel-buffer-sizing)
4. [Worker count for a CPU-bound pool](#worker-count-for-a-cpu-bound-pool)
5. [Worker count for an IO-bound pool](#worker-count-for-an-io-bound-pool)
6. [`sql.DB` pool sizing](#sqldb-pool-sizing)
7. [`http.Transport` pool sizing](#httptransport-pool-sizing)
8. [Queue depth as a control signal](#queue-depth-as-a-control-signal)
9. [Object pooling with `sync.Pool`](#object-pooling-with-syncpool)
10. [Reducing per-request allocation](#reducing-per-request-allocation)
11. [GC pause and stop-the-world](#gc-pause-and-stop-the-world)
12. [Knob priority — what to tune in what order](#knob-priority--what-to-tune-in-what-order)

---

## Pick `GOMEMLIMIT` first

`GOMEMLIMIT` is the safety belt. Set it before anything else. Recipe:

1. Find the container's memory limit (`memory.max` on cgroup v2, `memory.limit_in_bytes` on v1).
2. Set `GOMEMLIMIT` to ninety percent of that, leaving headroom for goroutine stacks, cgo, and unsynced runtime overhead.
3. If your process has known cgo memory (e.g., a SQLite database mapped into memory), subtract that too.

```go
// At program start, before any user allocation:
debug.SetMemoryLimit(int64(float64(cgroupMax) * 0.9))
```

Why ninety percent? The runtime's accounting is approximate; the kernel's enforcement is exact. Leaving ten percent margin avoids the case where `GOMEMLIMIT` says "we are still inside the budget" while the cgroup says "you are dead."

### Trade-off

A tighter `GOMEMLIMIT` makes GC run more often (the runtime is trying to keep below it), which raises CPU. A looser limit lets the heap grow toward the cgroup ceiling, raising OOM risk. The right value is the one that wastes the least memory while remaining safely below the cgroup limit.

---

## Pick `GOGC` second

`GOGC` controls how aggressively GC runs in the *absence* of memory pressure. With `GOMEMLIMIT` set, `GOGC` matters less near saturation but still matters at low utilisation.

Recipe:

1. Default is `100`. Start here.
2. Run a representative load test for at least thirty minutes.
3. Plot post-GC heap, GC CPU fraction, and p99 latency.
4. If GC CPU is below five percent and you want lower latency at the cost of memory: raise to `200` or `500`.
5. If memory is tight and GC CPU is acceptable: lower to `50` or `25`.

```go
debug.SetGCPercent(200)
```

### Trade-off

`GOGC=200` lets the heap double *twice* before the next GC. Latency improves because GC runs half as often, but each GC has more to scan. `GOGC=50` halves the heap headroom: more, shorter GCs. Pick by benchmark, not intuition.

---

## Channel buffer sizing

A common confusion: bigger buffers are *not* faster in steady-state. They are a one-time burst absorber. Recipe:

- Unbuffered (`make(chan T)`): producer and consumer rendezvous on every send. Use when synchronisation is the point.
- Buffer of one: the producer can deposit one item ahead. Use for "next-token" signals.
- Buffer equal to worker count: every worker has one in-hand task plus one queued. Use for short jobs.
- Buffer equal to `2 * workers` up to `4 * workers`: absorb bursts of length `O(burst size)`. Use for typical request queues.
- Buffer of hundreds or thousands: rarely a good idea. The queue *should* never be that deep; if it is, you have a producer-consumer rate mismatch that no buffer will fix.

### Procedure

1. Start with `2 * workers`.
2. Run a load test at the expected peak rate.
3. Measure `len(channel)` over time.
4. If the average depth is consistently more than half the capacity, you are at the wrong operating point — either raise workers or shed on full.
5. If the average depth is consistently near zero, the buffer is fine.

---

## Worker count for a CPU-bound pool

The rule of thumb: `workers = runtime.GOMAXPROCS(0)`. The Go scheduler will time-slice them, but adding more workers than CPUs gives the OS scheduler more goroutines to wake without producing more useful work.

### Refinement

If your job consists of a CPU phase followed by a short IO phase (e.g., compute then send), `workers = GOMAXPROCS * (1 + IO_time / CPU_time)`. For a job that is ninety-five percent CPU and five percent IO, that's `GOMAXPROCS * 1.05`, effectively `GOMAXPROCS`.

```go
workers := runtime.GOMAXPROCS(0)
pool := NewPool(workers, 4*workers)
```

---

## Worker count for an IO-bound pool

Now the rule is different. A goroutine waiting on a syscall is essentially free (a few kilobytes of stack, no CPU). The constraint is downstream:

- Workers calling a database: bounded by the database's connection limit (or your pool's `MaxOpenConns`).
- Workers calling an HTTP upstream: bounded by the upstream's rate limit and your `MaxConnsPerHost`.
- Workers writing to disk: bounded by IO throughput; usually a few dozen are enough.

Pick `workers = downstream_capacity` and trust the runtime to schedule them.

---

## `sql.DB` pool sizing

Three knobs, all important:

```go
db.SetMaxOpenConns(N)
db.SetMaxIdleConns(M)
db.SetConnMaxLifetime(L)
```

Recipe:

- `N` = the number of concurrent queries you expect under load, plus a small headroom (say, 20%). Constrained from above by the database server's `max_connections` divided by the number of replicas.
- `M` = `N` for hot paths (every idle worker keeps a warm connection); lower if connections are expensive on the database side.
- `L` = thirty minutes is a good default. It rotates connections so that database-side restarts and credential rotations land gracefully.

### Why not just set `N` to a huge number?

Each connection on the database side costs memory (Postgres: about ten megabytes per connection). A pool of 1000 connections per service times 50 services equals 500 GiB on the database, which is more memory than the database server has. The right size is *small*.

### Measurement

Watch `db.Stats().WaitCount`. If it is climbing, the pool is too small. If `InUse` rarely approaches `MaxOpenConns`, the pool may be oversized.

---

## `http.Transport` pool sizing

Default is `MaxIdleConnsPerHost = 2`. Wrong for almost any production service.

```go
tr := &http.Transport{
    MaxIdleConns:        200,
    MaxIdleConnsPerHost: 50,
    MaxConnsPerHost:     100,
    IdleConnTimeout:     90 * time.Second,
}
```

### Picking `MaxIdleConnsPerHost`

If your service makes K RPS to a host with M ms median latency, expect about `K * M / 1000` concurrent in-flight requests. Set `MaxIdleConnsPerHost` near that.

### Picking `MaxConnsPerHost`

Set this to the *peak* concurrent in-flight requests, plus headroom. It is the hard cap; if you hit it, calls queue inside `Transport.RoundTrip`. Set it; don't leave it at zero (unlimited) for any service that talks to a high-RPS upstream.

### `IdleConnTimeout`

Keep idle connections warm for a while, but not forever. Ninety seconds is a default — long enough to amortise TLS handshakes across a burst, short enough that idle hosts release their FDs.

---

## Queue depth as a control signal

A queue depth that is rising is a leading indicator of saturation. Use it.

### Static threshold

If `len(queue) > 0.8 * cap(queue)` for more than thirty seconds, alert. The pool is keeping up but only just.

### Trend threshold

Fit a linear regression to depth over the last five minutes. If the slope is positive and persistent, you are losing the race. The queue will fill and shed within minutes.

### Back-pressure

When the queue passes a high watermark, slow upstream intake — refuse new connections, lower the Kafka poll rate, return 503 to load balancers. When it drops below a low watermark, resume. This is the steady-state cousin of the [drain pattern](../05-drain-pattern/).

---

## Object pooling with `sync.Pool`

`sync.Pool` is a per-P pool of reusable objects. Use it for objects that are allocated and freed many times per request and are large enough that the allocation cost matters (kilobytes, not bytes).

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handle() {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufPool.Put(buf)
    }()
    // use buf
}
```

### Caveats

- Pool entries are dropped on every GC. Do not rely on the pool to keep anything for a long time.
- The `New` function must produce a valid empty object.
- Always `Reset` before `Put`.
- Do not pool objects that are very small (the bookkeeping cost exceeds the saved allocation).

### Measure

Run `go test -bench=. -benchmem` before and after. If `allocs/op` drops and throughput improves, the pool earned its keep.

---

## Reducing per-request allocation

Beyond `sync.Pool`, the highest-impact changes are usually:

1. **Preallocate slices.** `make([]T, 0, N)` instead of `var s []T` followed by appends.
2. **Avoid `fmt.Sprintf` in hot paths.** Use `strconv.AppendInt`, `[]byte` builders, or a pre-rendered template.
3. **Avoid map literals in hot paths.** Reuse a map and clear it.
4. **Use `[]byte` over `string` for transient text.** No allocation on slicing.
5. **Use streaming parsers.** `json.Decoder` over `json.Unmarshal` for large payloads.

### Tool

`go test -benchmem` and `pprof -alloc_space` (cumulative allocations, not heap). Identify the top allocator, fix it, repeat.

---

## GC pause and stop-the-world

Modern Go has very short stop-the-world pauses (sub-millisecond on typical heaps), but they are not zero. Reduce them by:

- Reducing live heap (fewer long-lived objects).
- Reducing pointer count in long-lived objects (every pointer is an edge the GC must traverse).
- Using `[N]T` arrays instead of `[]T` slices when the size is fixed.
- Using value types over pointers where possible.

The histogram metric `/gc/pauses:seconds` tells you the truth. Watch the p99 and p999 of pauses, not the mean.

---

## Knob priority — what to tune in what order

When a service is drifting and you have one hour to stabilise it, tune in this order:

1. **`GOMEMLIMIT`** — set it. Even if the value is conservative, having a limit beats not having one.
2. **`sql.DB` pool** — `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`. The most common production miss.
3. **`http.Transport` pool** — raise `MaxIdleConnsPerHost`, set `MaxConnsPerHost`, set `IdleConnTimeout`.
4. **Bounded queues** — replace any unbounded channel or slice-as-queue with a capacity and a shedding policy.
5. **Goroutine cap** — convert any "spawn per request" into a worker pool.
6. **`GOGC`** — only after the above, because GC tuning matters less when the rest of the system is sized correctly.
7. **Object pooling** — last, because it is a micro-optimisation compared with the structural changes above.

The order is not arbitrary. Each step above eliminates a class of failure that would otherwise dominate the metrics. Tuning `GOGC` first is a classic mistake: you spend an afternoon picking the perfect value, then discover the real issue was a `MaxIdleConnsPerHost` of two.

---

## A word on benchmarks

Never trust a benchmark shorter than the steady-state's natural time scale. A five-second benchmark cannot see a leak that grows at five megabytes per hour. For each knob, run for at least thirty minutes; for the harder ones, an overnight run is the only ground truth.

`benchstat` is the right comparison tool — it accounts for variance and tells you when the difference is statistically significant. A "ten percent faster" result with `p=0.4` is noise.

---

## Tuning the `time.Timer` and `time.Ticker` patterns

Timers and tickers seem cheap, but at scale their cost compounds. Three patterns:

### Hoist tickers out of loops

```go
// BAD: creates a new ticker every call
func tick() {
    t := time.NewTicker(time.Second)
    select {
    case <-t.C:
    }
}
```

```go
// GOOD: one ticker, reused
var globalTicker = time.NewTicker(time.Second)

func tick() {
    select {
    case <-globalTicker.C:
    }
}
```

### Reuse `time.Timer` across iterations

```go
t := time.NewTimer(d)
defer t.Stop()
for {
    select {
    case <-events:
        // reset, drain if needed
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(d)
    case <-t.C:
        t.Reset(d)
    }
}
```

In Go 1.23+, the drain is no longer needed; `Reset` handles it.

### Use `time.NewTimer` over `time.After` in hot paths

```go
// BAD: new timer every iteration
for {
    select {
    case <-ch:
    case <-time.After(d):
    }
}
```

Even at moderate `ch` rates this creates measurable timer-heap pressure. The hoisted-`Timer` pattern is preferred.

---

## Tuning lock contention

Locks become a steady-state issue when many goroutines contend for the same one. Symptoms:

- `runtime/metrics` mutex wait time rising.
- p99 latency rising while CPU stays low.
- Mutex profile (`SetMutexProfileFraction`) shows one lock dominating.

### Patterns

- **Shard the lock.** Replace `mu sync.Mutex` over one map with N shards, each with its own mutex.
- **Use `sync.RWMutex` for read-heavy.** Reads can be concurrent; writes serialise.
- **Use atomics where possible.** A `sync.Mutex` protecting a single counter is overkill; use `atomic.Int64`.
- **Move work outside the critical section.** Compute the new value first, then `Lock`, assign, `Unlock`.

### Measurement

```go
runtime.SetMutexProfileFraction(1)
// ... let the service run ...
// Then:
// go tool pprof http://localhost:6060/debug/pprof/mutex
```

The profile shows where contention is.

---

## Tuning runtime/metrics samplers

Polling `runtime/metrics` too often is itself overhead. Each `metrics.Read` call walks the runtime's internal stats.

Recommended cadence:

- Production: every 15 seconds.
- Development: every second is fine.
- Tests: only when you need the data.

For high-cardinality metrics (per-goroutine, per-shard), consider whether you need them at all. The cost of exporting often exceeds the value of the metric.

---

## Tuning `GOMAXPROCS` in containers

Go reads `runtime.GOMAXPROCS` from the kernel's `NPROC` or from an explicit env var. In containers, the kernel reports the *host* CPU count, not the container's CPU limit. Result: a Go process in a 2-CPU container thinks it has 64 CPUs.

The fix: set `GOMAXPROCS` from the cgroup CPU limit:

```go
import "go.uber.org/automaxprocs"

func init() {
    // automaxprocs init reads the cgroup and sets GOMAXPROCS
}
```

Without this, the Go runtime creates more OS threads than CPUs are available, the scheduler has more parallel goroutines than CPUs can run, and you pay extra context switches. The library is small and the fix is usually a measurable performance win.

---

## Tuning batch sizes

When your workload processes items in batches, the batch size is a steady-state lever:

- Small batches: more overhead per item, lower latency per item.
- Large batches: less overhead, more latency, more memory per batch.

The right size:

1. Run a benchmark sweep at sizes 1, 10, 100, 1000, 10000.
2. Measure throughput (items per second) and p99 latency.
3. Pick the smallest size that achieves your throughput target.

For Kafka consumers, `MaxPollRecords` of 500 is a common default. For database batched inserts, batches of 100 rows balance throughput against transaction size.

---

## Tuning idle behaviour

A service at zero traffic should consume zero CPU and stable memory. Common anti-patterns:

- Tight loops that poll instead of waiting on a channel.
- Tickers that fire even at zero load.
- Periodic compactions that run regardless of need.

Fix:

- Use blocking receives, not non-blocking + sleep.
- Gate periodic tasks on a load signal.
- Use `select` with no `default` clause when you want to wait.

```go
// BAD: tight polling loop
for {
    select {
    case x := <-ch:
        do(x)
    default:
        time.Sleep(time.Millisecond)
    }
}
```

```go
// GOOD: block on receive
for x := range ch {
    do(x)
}
```

The first burns CPU even at zero load; the second consumes zero CPU.

---

## Tuning under failover

A failover event (database restart, network partition recovery, leader election) is a steady-state excursion. The system should recover quickly. Practical patterns:

- Pre-warm pools after reconnect.
- Use shorter `ConnMaxLifetime` so the pool is fresh enough to survive.
- Use a connection-check on borrow (`SELECT 1` or driver-specific ping) to detect dead connections early.
- Implement a circuit breaker so callers fail fast during the recovery window.

Without these, the failover is a multi-minute incident. With them, the failover is a five-second blip.

---

## Tuning at the OS level

A few `sysctl`s that affect long-running Go services:

- `net.ipv4.tcp_keepalive_time` — when do idle connections get keepalive probes?
- `net.ipv4.tcp_keepalive_intvl` — interval between probes.
- `net.ipv4.tcp_tw_reuse` — reuse `TIME_WAIT` sockets.
- `fs.file-max` — system-wide FD limit.
- `vm.swappiness` — set to 0 for memory-bound services (we never want to swap).

These are sysadmin-level tweaks. For most services the defaults are fine; for very high-throughput services, tune them deliberately.

---

## A complete tuning protocol

The recipe for tuning an existing service:

1. **Baseline.** Run a representative workload for one hour. Record `p50`, `p99`, RSS, GC CPU%, queue depths, error rates.
2. **Set `GOMEMLIMIT`** to ninety percent of container memory.
3. **Set explicit pool sizes** for every connection pool.
4. **Replace any unbounded channel** with a bounded one plus shed-or-block.
5. **Cap any per-request goroutine spawn** with a worker pool or semaphore.
6. **Add pprof** on a localhost listener.
7. **Add saturation metrics** for every resource.
8. **Run a one-hour load test.** Measure post-GC heap slope, goroutine slope, FD slope. All should be near zero.
9. **Run a 48-hour staging test.** Same measurements.
10. **Tune `GOGC`** only if the previous steps have not solved the issue.

This protocol is roughly two weeks of work for an existing service. The payoff is a service that runs for months without paging anyone.

---

## Tuning gRPC keepalive

gRPC clients and servers have matching keepalive configuration. They must agree or the server will disconnect the client.

### Client side

```go
import "google.golang.org/grpc/keepalive"

conn, err := grpc.Dial(addr,
    grpc.WithTransportCredentials(creds),
    grpc.WithKeepaliveParams(keepalive.ClientParameters{
        Time:                30 * time.Second,
        Timeout:             10 * time.Second,
        PermitWithoutStream: false,
    }),
)
```

### Server side

```go
srv := grpc.NewServer(
    grpc.KeepaliveParams(keepalive.ServerParameters{
        MaxConnectionIdle:     5 * time.Minute,
        MaxConnectionAge:      30 * time.Minute,
        MaxConnectionAgeGrace: 30 * time.Second,
        Time:                  30 * time.Second,
        Timeout:               10 * time.Second,
    }),
    grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
        MinTime:             30 * time.Second,
        PermitWithoutStream: false,
    }),
)
```

### Why these values

- **`Time = 30s`** — ping every thirty seconds. Shorter than typical NAT timeouts (60s).
- **`Timeout = 10s`** — give the peer ten seconds to respond.
- **`MaxConnectionIdle = 5m`** — close connections that have been idle.
- **`MaxConnectionAge = 30m`** — recycle long-lived connections.
- **`MinTime` matches client `Time`** — otherwise the server kicks the client.

These defaults match across most production gRPC services. Adjust only with measurements.

---

## Tuning `runtime.GOMAXPROCS`

In containers, `GOMAXPROCS` should match the CPU quota, not the host CPU count. Use `automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

This sets `GOMAXPROCS` from the cgroup CPU limit at init time. Without it, a Go process in a 2-CPU container thinks it has 64 CPUs and creates 64 OS threads, leading to scheduler thrashing.

For workloads with explicit parallelism control (worker pools sized by `GOMAXPROCS`), this is a measurable performance improvement.

---

## Tuning shutdown deadlines

The graceful shutdown deadline must satisfy:

```
shutdown_deadline < kubernetes_grace_period
                  < load_balancer_propagation
                  < dns_ttl
```

Typical values:

- Kubernetes default `terminationGracePeriodSeconds = 30`.
- Load balancer propagation: 10-20 seconds.
- Internal DNS TTL: 30-60 seconds.

Set the application's shutdown deadline to about 25 seconds, leaving 5 seconds margin for the kernel to send SIGKILL after the grace period.

```go
shutdownCtx, cancel := context.WithTimeout(
    context.Background(), 25*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx)
```

For services with longer running operations (long DB queries, large file uploads), increase `terminationGracePeriodSeconds` in the Kubernetes manifest, and increase the application's deadline correspondingly.

---

## Tuning the `pprof` overhead

`pprof` is not free. The overhead:

- **Heap profile.** Minimal (a few microseconds per allocation when enabled, which is by default at a low rate).
- **Goroutine profile.** Cheap to collect.
- **CPU profile.** Significant. Enable for short windows (`?seconds=10`).
- **Block / mutex profile.** Adds per-block / per-lock instrumentation. Enable selectively.

For continuous production, leave heap and goroutine enabled (they are by default). Enable CPU, block, and mutex profiles only when actively diagnosing.

```go
runtime.SetBlockProfileFraction(0)  // disabled
runtime.SetMutexProfileFraction(0)  // disabled
// Enable for an hour during diagnosis:
runtime.SetMutexProfileFraction(100)
time.AfterFunc(time.Hour, func() {
    runtime.SetMutexProfileFraction(0)
})
```

---

## Tuning JSON encoding

`encoding/json` is convenient but allocates heavily. For high-throughput services, alternatives:

- **`segmentio/encoding/json`** — drop-in replacement, faster.
- **`json-iterator/go`** — faster, slightly different API.
- **`mailru/easyjson`** — code generation, fastest, requires generated code.
- **`bytedance/sonic`** — JIT-compiled, very fast on AMD64.

The decision tree:

1. Is JSON encoding a measurable hot spot? If no, stick with stdlib.
2. Is the schema stable? If yes, easyjson is fastest.
3. Otherwise, sonic or segmentio.

In all cases, measure before and after with `benchstat`. The throughput difference can be 2x or more for some workloads.

---

## Final tuning checklist

A consolidated checklist for tuning a service for steady-state:

1. `GOMEMLIMIT` set to 90% of cgroup memory.
2. `GOGC` measured, not assumed.
3. `GOMAXPROCS` matches cgroup CPU quota.
4. Bounded queues everywhere, with explicit shed-or-block policy.
5. `sql.DB.SetMaxOpenConns` sized to fleet × pod = 80% of database max.
6. `sql.DB.SetConnMaxLifetime` set to 30 minutes.
7. `http.Transport.MaxIdleConnsPerHost` set to expected concurrent in-flight.
8. `http.Transport.MaxConnsPerHost` set; not zero.
9. `IdleConnTimeout` set to 90 seconds.
10. gRPC keepalive configured on both client and server.
11. Server-side `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout` set.
12. Every external call has a context timeout.
13. Every cache has a size limit or TTL.
14. Every `time.NewTicker` has `defer t.Stop()`.
15. `pprof` enabled on a localhost listener.
16. `runtime/metrics` exported.
17. `db.Stats()` exported.
18. Open FD count exported.
19. Slope alerts on heap, goroutines, FDs.
20. Graceful shutdown bounded by a deadline.
21. Chaos harness running in CI nightly.
22. Long-runner staging pod active.

A service that ticks all twenty-two has been tuned for steady-state. Further optimisation is a micro-optimisation game; the structural decisions are already correct.

---

## Diminishing returns

Tuning has a curve. The first few changes give large wins (sized pools, `GOMEMLIMIT`, bounded queues). Each subsequent change gives smaller returns. At some point, you should stop.

A useful rule: if a tuning change requires more than a day of work and produces less than a five percent improvement, defer it. Spend the engineering hours on a more impactful change.

The exception is when the change is on a critical path (a payment authorisation, a high-fanout API). For those, every percentage point matters; the curve is worth chasing.

For everything else, the eighty-twenty rule applies. Eighty percent of the steady-state win comes from the first twenty percent of the tuning effort.

---

## When to stop

A service is "tuned enough" when:

- Dashboards are flat in steady-state.
- Alerts fire only on real problems.
- Deploys are uneventful.
- The on-call rotation is bored.

Beyond that, tuning is a hobby, not engineering. Move on to the next service.
