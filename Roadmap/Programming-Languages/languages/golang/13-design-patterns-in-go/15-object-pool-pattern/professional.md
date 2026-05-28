# Object Pool — Professional

> Focus: staff/principal-level decisions. A pool is not an optimization; it is a contract between the application and the runtime about who owns memory and for how long. The CPU savings are measurable; the operational consequences — pool exhaustion at 03:00, a poisoned connection that survived a backend deploy, a 4 GB resident-set anomaly on a 200 MB working set — are what you actually get paid to manage. Opinionated where the field agrees, explicit about trade-offs where it does not.

---

## 1. Pooling as a system primitive

Object pooling is one member of a family of allocation strategies. Conflating it with the others is the first mistake.

| Primitive | Lifetime | Reuse model | Failure model | Typical use |
|---|---|---|---|---|
| Pool (`sync.Pool`, typed pools) | Per-borrow, returned individually | One object reused N times, in arbitrary order | Object may be evicted; `New` runs | Buffers, parsers, scratch structs |
| Arena | Bulk, freed all at once | Many allocations live together, freed together | No per-object free; reset wipes all | Per-request scratch (Go's `arena` experiment, Zig, C++ pmr) |
| Slab allocator (Bonwick, 1994) | Long-lived, sized buckets | Free list per object-size class | Internal fragmentation per class | Linux kernel SLUB, mcache (§5) |
| Free list (intrusive) | Per-object | Caller pushes/pops a singly-linked list embedded in the object | Caller-controlled; no eviction | `kmem_cache`, BSD `pool_get` |
| Bump allocator | Short, monotonic | Pointer increments; no free | Reset frees everything | Compilers' AST nodes, JIT scratch |
| Object cache (per-CPU) | Long-lived, hot | One free list per CPU, no locks | Cross-CPU drain on imbalance | Go's mcache, jemalloc tcache |

The pool's distinguishing trait: **objects are individually returnable in arbitrary order**, and **the pool may drop them**. Arenas reset wholesale and never drop one element. Slabs are an implementation technique for the allocator itself, not an application primitive. A free list is the unsynchronized version of a pool — fast and correct only when one goroutine owns it.

Three observations hold across all six:

1. **The win is amortization of initialization, not of allocation.** Go's allocator already costs ~10 ns for a small object. Pooling saves the *zero-fill plus the call to `New`* plus the GC scan of the live object. When `New` is cheap and the object holds no live pointers, the pool wins almost nothing.
2. **Pools shift work from GC to humans.** The GC was scanning your buffers for you; the pool now requires correct `Reset` discipline. You buy CPU with a debugging burden.
3. **Pools are caches, and caches need eviction.** Without a size cap, the largest-ever buffer becomes the steady-state buffer. Without a TTL, an idle pool wastes memory. Without health checks, broken connections survive forever. Every property a serious cache needs, a serious pool needs.

Bonwick's *The Slab Allocator* (USENIX 1994) is the foundational paper; the Linux kernel SLUB rewrite (2007) is the modern incarnation; Go's mcache (§5) ports the per-CPU cache idea into a managed runtime.

---

## 2. Quantitative cost analysis

Per-borrow CPU and allocation matter on data planes (per-packet protocols, per-request HTTP). They are irrelevant on control planes (one connection per minute). Numbers below are Go 1.22, amd64, warm cache, single goroutine unless noted.

### 2.1 The allocator baseline

`runtime.mallocgc` for a 64-byte struct: ~10 ns on a hot mcache, no GC. For a 4 KB buffer: ~18 ns. For a 1 MB buffer: a span allocation, ~150 ns plus the zero-fill at memory bandwidth (~0.4 ms/MB on DDR4). Pooling a 64-byte struct cannot save more than 10 ns; the pool ops cost about that much. Pooling a 1 MB buffer saves several hundred microseconds.

### 2.2 `sync.Pool` operations

```
BenchmarkSyncPoolGetPut       5 ns/op    0 B/op   0 allocs/op   (uncontested, P-local hit)
BenchmarkSyncPoolMiss        45 ns/op  varies    1 alloc/op    (empty pool, New runs)
BenchmarkSyncPoolCrossP      35 ns/op    0 B/op   0 allocs/op   (steal from another P)
BenchmarkChannelPoolGetPut   55 ns/op    0 B/op   0 allocs/op   (chan-based typed pool)
BenchmarkMutexPoolGetPut     30 ns/op    0 B/op   0 allocs/op   (slice + Mutex)
```

The P-local fast path is so cheap because it avoids atomics entirely — each P holds a private slot plus a local list, accessed with `runtime.procPin`. Cross-P steal pays one CAS. After GC, the pool is partially drained: subsequent `Get` may run `New`. The deferred reuse is the win; the deferred eviction is the catch.

### 2.3 Comparison table

| Object kind | Alloc cost | Init cost | `sync.Pool` win per borrow | Worth pooling? |
|---|---|---|---|---|
| 64-byte struct, no pointers | ~10 ns | 0 | ~5 ns | No — pool noise dominates |
| `*bytes.Buffer` that grows to 1 KB | ~18 ns alloc + grow | ~30 ns growth | ~40 ns | Yes |
| `*bytes.Buffer` that grows to 64 KB | ~250 ns + zero-fill | ~3 µs growth | ~3 µs | Strong yes |
| `*gzip.Writer` (huffman tables) | ~250 µs | ~250 µs | ~250 µs | Mandatory |
| `*json.Decoder` reusing a `*bytes.Reader` | ~20 ns | ~150 ns | ~150 ns | Yes for hot paths |
| `*sql.DB` connection | ~10 ms (TCP + TLS + auth) | included | ~10 ms | Mandatory — never `sync.Pool` |
| Goroutine (worker) | ~2 µs spawn + ~2 KB stack | 0 | ~2 µs | Sometimes — backpressure matters more |

The rule that emerges: **pool when init cost ≥ 50 ns per borrow, or when the object holds a resource the runtime cannot recreate cheaply**. The latter is the real reason connection pools exist; CPU is secondary.

### 2.4 Per-P contention

`sync.Pool` is per-P, so contention is invisible until `runtime.GOMAXPROCS` changes or a P is descheduled. A 64-thread machine has 64 local pools; an idle one still holds objects. Under heavy traffic the cross-P steal path runs often — still cheap (a CAS), but it explains why pool-hit rate is not 100% even on a saturated system.

---

## 3. Pool sizing — Little's Law

Sizing a connection pool is the same problem as sizing a queue. Little's Law gives the only honest answer.

$$L = \lambda W$$

where `L` is the average number of in-use connections, `λ` is the arrival rate (requests/sec), and `W` is the average service time (seconds per request).

Worked example. An API service receives 2 000 req/s; the average DB query takes 5 ms; the p99 takes 40 ms.

| Metric | Value |
|---|---|
| Mean concurrent in-use connections | 2 000 × 0.005 = **10** |
| p99 concurrent in-use (using p99 service time) | 2 000 × 0.040 = **80** |
| Recommended `MaxOpenConns` | ~80–100 (cover p99 with headroom) |
| Recommended `MaxIdleConns` | ~10 (cover the mean; lower idles waste sockets) |
| `ConnMaxLifetime` | 5–15 min (rotate behind LB drains) |
| `ConnMaxIdleTime` | 1–5 min (release sockets the backend is closing anyway) |

The two pitfalls:

1. **Sizing for the mean.** A pool of 10 satisfies average demand and blocks during every spike. The arrival process is bursty; queue theory says the 99th percentile of *queue length* is far above the mean even at low utilization.
2. **Sizing without the backend.** Postgres typically caps connections at a few hundred. Ten app instances × 100 conns each = 1 000 connections — the database melts before the app does. Front the DB with PgBouncer (transaction mode) so the app pool is generous and the DB pool stays small (§5.1, §6).

A defensible target: utilization `ρ = λW / capacity` ≤ 0.7 in steady state. Above that, queueing dominates latency; the M/M/c formulas explode as `ρ → 1`.

### 3.1 The pool as a queue

Pool wait time is queue wait time. Instrument it:

```go
acquireLatency := prometheus.NewHistogramVec(prometheus.HistogramOpts{
    Name:    "db_pool_acquire_seconds",
    Buckets: prometheus.ExponentialBuckets(0.0001, 4, 12), // 100 µs .. 7 min
}, []string{"pool"})

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    t0 := time.Now()
    defer func() { acquireLatency.WithLabelValues(p.name).Observe(time.Since(t0).Seconds()) }()
    select {
    case c := <-p.idle:
        return c, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

A p99 acquire under 1 ms means the pool is sized correctly. A p99 above 100 ms means it is the bottleneck.

---

## 4. Memory characteristics and `GOMEMLIMIT`

Pools interact with the GC in non-obvious ways.

### 4.1 What `sync.Pool` does at GC

`sync.poolCleanup` runs at the start of every GC. It moves each P's `local` list into a `victim` list and clears the victim from the previous cycle. Objects survive **one** GC cycle in the victim; on the next cycle they are dropped and reclaimable.

Consequences:

- A pool used at < 1 op per GC cycle keeps no objects; `Get` runs `New` almost every call.
- A pool used at thousands of ops per cycle keeps a hot working set.
- A pool whose traffic drops to zero releases its memory within two GC cycles — about a minute at default pacing under modest load.

The pool is therefore **self-pruning under sustained idleness** but **not bounded under sustained load**. If the working set grows during a spike, the pool retains it through the next cycle, then drops the unused fraction. This is the right default behavior for most caches; it is wrong when the spike installed a 100 MB buffer that will never shrink.

### 4.2 `GOMEMLIMIT` interaction (Go 1.19+)

`GOMEMLIMIT` is a soft cap on total heap + non-heap. When the runtime nears the limit, it runs GC more aggressively. Two effects on pooling:

- **Pools held memory counts against the limit.** A pool retaining 200 MB of buffers pushes the live heap higher, triggering earlier GCs, which evict the pool, which forces `New` to allocate again. The pool and the limit are in tension.
- **`GOGC=off` + `GOMEMLIMIT`** is the recommended pattern for memory-bounded services. Pools then live until the limit is reached, at which point an emergency GC drains them. Plan for the drain — `New` must remain fast.

For pools with size-cap discipline (e.g., drop buffers > 64 KB on return), `GOMEMLIMIT` cooperates well. For pools that grow unbounded, the limit becomes a thrashing trigger.

### 4.3 RSS vs working set

A pool of 1 000 4 KB buffers shows 4 MB of pool memory, but each buffer maps to a separate page. Touching one buffer faults in 4 KB. After GC drops the pool's victim, the pages remain in RSS until the OS reclaims them — `madvise(MADV_DONTNEED)` is what `runtime.ReadMemStats` accounts for under `HeapReleased`. RSS lags HeapInUse on shrinking heaps by tens of seconds to minutes. Dashboards must show both.

```go
var ms runtime.MemStats
runtime.ReadMemStats(&ms)
// ms.HeapInuse    — currently-allocated heap bytes
// ms.HeapIdle     — span memory the runtime holds but doesn't use
// ms.HeapReleased — returned to OS; counts against RSS only via the OS
```

---

## 5. Real implementations

Reading the source is the only way to internalize the design choices.

### 5.1 `jackc/pgx` connection pool

`pgxpool` (in `pgx/v5`) is the reference Go connection pool. Key design points:

- **Bounded by `MaxConns`.** Hard cap; `Acquire` blocks (with context) when exhausted.
- **`MinConns` warm pool.** A background goroutine keeps at least `MinConns` connections open, so the first request of the morning doesn't pay TLS handshake cost.
- **Health checks.** Connections are pinged on acquire if older than `HealthCheckPeriod`; failed pings trigger close and re-dial.
- **`MaxConnLifetime` and `MaxConnIdleTime`** rotate connections behind load balancer drains and backend reboots.
- **`AfterRelease` hook** lets you destroy connections that learned bad state (a session variable was set, a transaction left dangling).

```go
cfg, _ := pgxpool.ParseConfig(dsn)
cfg.MaxConns          = 80
cfg.MinConns          = 10
cfg.MaxConnLifetime   = 15 * time.Minute
cfg.MaxConnIdleTime   = 5  * time.Minute
cfg.HealthCheckPeriod = 30 * time.Second
cfg.AfterRelease = func(c *pgx.Conn) bool {
    return c.PgConn().TxStatus() == 'I'   // keep only if idle (no open tx)
}
pool, _ := pgxpool.NewWithConfig(ctx, cfg)
```

The `AfterRelease == false` path is the cleanest example of a *poisoned object*: the connection survived the borrow but is no longer safe; the pool destroys it.

### 5.2 `gomodule/redigo` and `redis/go-redis` pools

Redigo's `redis.Pool` is a `sync.Mutex` + slice + condvar. Simple, correct, well-tested. `go-redis` (now `redis/go-redis/v9`) maintains a similar pool with idle list, wait queue, and per-connection write-buffer reuse. Both expose `PoolStats()`:

```go
type PoolStats struct {
    Hits, Misses, Timeouts uint32
    TotalConns, IdleConns, StaleConns uint32
}
```

The hit/miss ratio over time is the single best indicator of pool sizing health.

### 5.3 `valyala/fasthttp`

`fasthttp` is the most aggressive Go application of pooling, achieving 10× `net/http` throughput on micro-benchmarks. Every request and response object is pooled; URI, args, header collections are pooled; even byte slices are pooled in `bytebufferpool`. The trade-off is encoded in the public API: returned objects' lifetimes are scoped to the handler, and references must not escape. The library is fast specifically because it does not pretend to honor Go's "the GC will save you" contract.

Don't use it as a default. Do read it to understand pooling discipline at the limit.

```go
// bytebufferpool — the canonical size-aware pool
var pool bytebufferpool.Pool
buf := pool.Get()
defer pool.Put(buf)
buf.WriteString("hello")
// internally: discards buffers whose Cap() exceeds the calibrated upper bound,
// using running percentiles of observed sizes — a self-tuning size cap.
```

`bytebufferpool` recalibrates its size cap based on percentiles of observed sizes, dropping pathologically large buffers automatically. That self-tuning is rare and worth studying.

### 5.4 Go runtime mcache

The runtime itself runs per-P caches (`mcache`) in front of central caches (`mcentral`) in front of `mheap`. Allocation of small objects hits mcache without locks; refills happen in 32-object batches; under memory pressure `runtime.GC` drains mcaches. This three-tier hierarchy — per-CPU local, shared central, global heap — is the *same shape* as a well-built application connection pool: per-replica local with a sidecar shared pool with a central database (§6). The pattern recurs because the trade-offs (latency vs cache locality vs total capacity) are identical.

### 5.5 Standard library — `encoding/json`

`encoding/json` pools encoder state internally:

```go
// $GOROOT/src/encoding/json/encode.go
var encodeStatePool sync.Pool

func newEncodeState() *encodeState {
    if v := encodeStatePool.Get(); v != nil {
        e := v.(*encodeState)
        e.Reset()
        if len(e.ptrSeen) > 0 { panic("...") }
        e.ptrLevel = 0
        return e
    }
    return &encodeState{ptrSeen: make(map[any]struct{})}
}
```

Note the discipline: `Reset`, sanity check on `ptrSeen`, explicit clearing of `ptrLevel`. This is the canonical "pooling a struct with sub-allocations" reference.

---

## 6. Distributed pooling — sidecar multiplexers

Pools are local. Connections are global resources. At scale, the gap between them is the single largest source of database incidents.

### 6.1 The fan-out problem

Ten Go pods × `MaxOpenConns=100` = 1 000 connections to Postgres, which often caps at 200. The pool's local view (100 conns is fine) is decoupled from the global view (200 total is the limit). When the deploy adds an eleventh pod, the database OOMs.

### 6.2 PgBouncer in transaction mode

PgBouncer sits between the app and Postgres. Apps connect to PgBouncer (cheaply, no real TCP/TLS to the DB); PgBouncer multiplexes thousands of client connections onto a handful of real DB connections. In *transaction pooling mode*, a backend is returned to PgBouncer at every `COMMIT` / `ROLLBACK`, so utilization stays high.

| Mode | Backend held for | Compatible with |
|---|---|---|
| Session | Whole client connection | Anything |
| Transaction | One transaction | Most ORMs; no prepared statements unless server-side disabled or pgbouncer 1.21+ |
| Statement | One statement | Auto-commit only |

Transaction mode is the default for high-fan-out Go services. Application code must avoid features that pin a session: server-side prepared statements (use `query_mode=simple_protocol` or `default_query_exec_mode=exec` with pgx), `SET LOCAL` variables, `LISTEN/NOTIFY`, advisory locks.

### 6.3 The two-tier sizing rule

| Tier | Sizing |
|---|---|
| App pool (per pod) | Generous — enough to never block on `Acquire` |
| Sidecar pool (PgBouncer) | Modest — enough to saturate the backend at p99 |
| Backend (Postgres) | The hard cap; everything above it is queued |

Two-tier sizing decouples app autoscaling from DB capacity. New pods cost ~zero DB connections.

### 6.4 Service-mesh and Envoy connection pools

For HTTP/gRPC, the same pattern lives in Envoy's `cluster.circuit_breakers` and connection pool configuration: per-mesh-instance pools with global limits enforced upstream. The mental model is identical to PgBouncer; the substrate is L7.

---

## 7. Observability — metrics that matter

A pool is well-instrumented when an operator can answer "are we over- or under-pooled?" without reading code.

### 7.1 Required metrics

| Metric | Type | Why |
|---|---|---|
| `pool_acquire_seconds` | Histogram | p50/p99/p999 wait time — the queue |
| `pool_in_use` | Gauge | Active borrowed objects |
| `pool_idle` | Gauge | Available objects |
| `pool_max` | Gauge | Configured cap (alerts compare in_use to this) |
| `pool_creates_total` | Counter | `New` invocations — high = misses or churn |
| `pool_destroys_total{reason}` | Counter | Reasons: `health_fail`, `lifetime`, `idle_time`, `manual` |
| `pool_wait_count` | Counter | Number of borrows that had to wait > 0 |
| `pool_wait_seconds_total` | Counter | Cumulative wait time — derives utilization |
| `pool_timeouts_total` | Counter | Borrows that hit context deadline |
| `pool_hits_total` / `pool_misses_total` | Counter | Hit rate |

```go
var (
    poolInUse = prometheus.NewGaugeVec(prometheus.GaugeOpts{Name: "pool_in_use"}, []string{"pool"})
    poolIdle  = prometheus.NewGaugeVec(prometheus.GaugeOpts{Name: "pool_idle"},   []string{"pool"})
    poolWait  = prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "pool_acquire_seconds",
        Buckets: prometheus.ExponentialBuckets(0.0001, 4, 12),
    }, []string{"pool"})
    poolCreates  = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "pool_creates_total"},  []string{"pool"})
    poolDestroys = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "pool_destroys_total"}, []string{"pool", "reason"})
)
```

### 7.2 Canonical alerts

```promql
# Saturation — p99 acquire wait above 100 ms for 5 min
histogram_quantile(0.99, sum(rate(pool_acquire_seconds_bucket[5m])) by (le, pool)) > 0.1

# Exhaustion — pool at its cap
pool_in_use / pool_max > 0.95

# Churn — creates per second above destroys + steady-state allowance
rate(pool_creates_total[5m]) > 5

# Poisoned-object epidemic — health failures spiking
rate(pool_destroys_total{reason="health_fail"}[5m]) > 1
```

### 7.3 Tracing borrows

Borrow-and-return spans are how you correlate pool waits with downstream latency.

```go
func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    ctx, span := tracer.Start(ctx, "pool.acquire",
        trace.WithAttributes(attribute.String("pool", p.name)))
    defer span.End()
    c, err := p.acquire(ctx)
    if err != nil { span.RecordError(err); return nil, err }
    span.SetAttributes(attribute.Int("pool.in_use", int(p.inUse.Load())))
    return c, nil
}
```

A flame graph that shows `pool.acquire` taking 80% of a request is unambiguous — the pool is the bottleneck, not the database.

---

## 8. Failure modes

### 8.1 Pool exhaustion under burst

The textbook scenario: a downstream slowdown raises `W`; `L = λW` exceeds the cap; new borrows block; upstream timeouts pile up; clients retry; effective `λ` doubles; thundering herd.

Three defenses, layered:

1. **Bounded wait with context deadline.** Never block forever. The deadline becomes a fast failure rather than a slow one — the system fails open to the caller.
2. **Circuit breaker on the pool.** When `pool_in_use / pool_max > 0.9` for some window, shed load at the edge; return 503 with `Retry-After` instead of queueing more.
3. **Backpressure to the producer.** A bounded `chan` in front of the pool transfers the queue from the borrow site to an explicit, instrumented queue.

### 8.2 Poisoned objects

A pooled object can learn state that makes it unsafe to reuse:

- A DB connection in an aborted transaction (`TxStatus != 'I'`).
- An HTTP/2 client whose stream count exceeds the server's `MAX_CONCURRENT_STREAMS`.
- A buffer that ended a borrow mid-write because of panic, leaving a partial token.
- A parser whose state machine sits in a non-initial state after an error.

The contract: **on every return path, validate or destroy**. The pgx `AfterRelease` hook (§5.1) is the canonical mechanism; `bytebufferpool`'s size check is another. A pool without a poison check is a footgun waiting for one borrow to corrupt every subsequent one.

```go
func (p *ConnPool) Put(c *Conn, err error) {
    if err != nil || !c.IsHealthy() {
        c.Close()
        poolDestroys.WithLabelValues(p.name, "health_fail").Inc()
        return
    }
    select {
    case p.idle <- c:
    default:
        c.Close()
        poolDestroys.WithLabelValues(p.name, "overflow").Inc()
    }
}
```

### 8.3 Thundering herd on `New`

When a pool is empty and N callers arrive simultaneously, all N call `New`. If `New` does I/O (TCP dial, TLS handshake), the backend sees a sudden spike. Two fixes:

- **Singleflight on `New`** — only one in-flight creation; the rest wait on the same future. `golang.org/x/sync/singleflight` is the standard tool.
- **Warm pool** — `MinConns` connections always open; `New` is a background concern, not a request-path concern.

### 8.4 Slow `Put`

A `Put` that runs cleanup synchronously (closing a transaction, releasing a lock) extends the apparent borrow time. If `Put` is not deferred, panic paths skip it. The discipline:

```go
c, err := pool.Get(ctx)
if err != nil { return err }
defer pool.Put(c)   // first line after Get, always
```

### 8.5 GC-induced eviction during spikes

`sync.Pool` evicts at GC. During a CPU-bound spike, GC frequency rises; the pool drains; `New` runs; allocations rise; GC frequency rises further. The feedback loop is rare but real on services that have built up a several-hundred-MB pool. The mitigation: tune `GOGC` / `GOMEMLIMIT` so GC is not running every 100 ms, or move to a typed pool for the hot objects.

### 8.6 Cross-data-center stale connections

A connection idle for hours on a multi-region backend may be silently dropped by a NAT or LB. The next borrow finds the connection broken; the request fails; the pool re-dials. Set `MaxConnIdleTime` shorter than the shortest middlebox idle timeout in the path (typically 5 minutes for AWS NLB, 30 minutes for many corporate firewalls). Use TCP keepalives (`SO_KEEPALIVE` plus `TCP_KEEPIDLE` set to ~60 s) as a belt-and-suspenders defense.

---

## 9. Security & schema evolution

### 9.1 Cross-tenant leakage via shared state

A pooled object that carried tenant A's state into tenant B's borrow is a data leak. Concrete vectors:

- A DB connection that ran `SET search_path = tenant_a_schema` is borrowed by tenant B.
- A buffer with tenant A's PII is returned without `Reset`; tenant B writes 100 bytes; tenant B's response trails with tenant A's data.
- A logger with tenant A's context fields is reused for tenant B.

The rule: **the borrow boundary is a security boundary**. Every borrowed object must be reset to a tenant-neutral state on `Put`, and tenant-scoped state should be set on the *machine* (the holder of the pooled object) not on the pooled object itself. For DB pools, `RESET ALL` on release is the safe form; for `pgx`, `AfterRelease` enforces it.

### 9.2 Credential rotation under a long-lived pool

A connection opened 24 hours ago authenticated against the old password. After rotation, it still works (the session is authorized) until the next dial. `ConnMaxLifetime` of 5–15 minutes bounds the window during which old credentials linger; below 5 minutes, dial churn becomes the cost.

### 9.3 TLS expiry inside the pool

A connection that completed a TLS handshake 90 days ago still has the original cert in its session. If the issuer's certificate rotated, the connection works (the session was authenticated) but introspection shows stale chain data. Most pools handle this implicitly via lifetime caps; explicit re-handshake is rare.

### 9.4 Schema evolution and pooled prepared statements

A pooled DB connection often caches server-side prepared statements. If a table is altered (`ALTER TABLE ADD COLUMN`), the cached plan is invalidated by Postgres automatically; pgx handles the re-prepare. A worse failure mode: the application updated its column list but a pooled connection still references the old name. The cleanest defense is to invalidate prepared-statement caches on schema migrations — many migration tools (e.g., goose, sqlc with regeneration) make this implicit; some require an explicit kick.

For expand/contract migrations (add column → backfill → cut over → drop old), pool churn during the cutover is welcome — `ConnMaxLifetime` of 15 minutes guarantees no connection survives the cutover.

---

## 10. Anti-patterns at scale and closing principles

| Anti-pattern | Symptom | Fix |
|---|---|---|
| **Using `sync.Pool` for connections** | Connections vanish after GC; reconnect storms; slow first response | Typed pool with explicit size cap and lifetime |
| **No size cap on returned buffers** | Steady-state RSS climbs to the largest-ever request | Drop buffers above an absolute cap (`bytebufferpool` style or hard `Cap()` check) |
| **Pooling without `Reset`** | Tenant leakage, partial-write corruption, parser confusion | `Reset` is the first line of every borrow path |
| **`Get` without deferred `Put`** | Slow leak; pool empties; `New` becomes the hot path | `defer pool.Put(x)` on the line after `Get` — no exceptions |
| **Pool sized for the mean** | p99 acquire latency dwarfs the work; tail latencies follow `1/(1-ρ)` | Size for p99 demand; alert on acquire p99 |
| **No poison check on return** | One bad borrow corrupts every future one | Validate health on return; destroy on failure |
| **App pool larger than backend cap** | Database OOM during scale-out | Two-tier pool with PgBouncer (§6) |
| **`New` does I/O on the borrow path** | Thundering herd on cold start; tail-latency spikes after GC eviction | Singleflight on `New`; warm pool with `MinConns` |
| **One global pool for heterogeneous workloads** | Long queries starve short ones; tail latency is bimodal | Split pools by latency class (`shortQuery`, `longQuery`, `bulk`) |
| **No metrics on borrow latency** | Operators cannot tell if the pool is the bottleneck | `pool_acquire_seconds` histogram is non-negotiable |
| **Pooling immutable shared singletons** | Pool overhead with no upside | Hold one instance globally |
| **Pooling per-request when the object is per-process** | Allocations didn't happen anyway; pool adds overhead | Audit with `-benchmem` before pooling |
| **Workers blocked on a pool without context** | Goroutines stack up forever during a slow downstream | Every `Get` takes a `context.Context`; deadline-driven failure |
| **Mixing arena-style and pool-style lifetimes** | "Object freed twice" bugs; "still borrowed" panics | One ownership model per object; document it |

The deepest anti-pattern: **using a pool as a substitute for capacity planning**. The pool hides demand from the operator: it queues borrowers silently, smooths over backend slowdowns, masks load until the queue itself is the failure. A pool with no acquire-latency dashboard is a system with no observability for its most contended resource. The pattern is not the planning.

### Closing principles

A pool is a contract: the application promises to return objects in clean state; the runtime promises to amortize initialization. Honor both ends.

1. **Pool when init cost exceeds 50 ns or when the object owns a non-recreatable resource.** Below that, the pool is a tax on every borrow and a debugging surface for no reward. Benchmark with `-benchmem` before pooling anything; benchmark again after.
2. **The borrow boundary is the reset boundary, the security boundary, and the metric boundary.** On every `Get`, the object must be clean; on every `Put`, validated or destroyed. Every borrow updates `pool_acquire_seconds` and `pool_in_use`. Without those three properties, the pool is a leak waiting to be discovered.
3. **Size for p99 demand using Little's Law, not for the mean.** A pool sized for the average is a pool that blocks during every interesting hour of the day. Acquire latency is the queue, and queues obey M/M/c — keep utilization below 0.7 or accept the tail.
4. **Two-tier pooling at scale.** The app pool is local and generous; the sidecar pool (PgBouncer, Envoy) is global and modest; the backend cap is the only hard limit. App autoscaling must not be coupled to backend capacity.
5. **Determinism on return.** `Put` must run on every code path — `defer pool.Put(x)` on the line after `Get`, with no exceptions for happy paths. A pool with a leak path will leak; the only question is when.

Get those right and the Object Pool becomes invisible: the code reads as `Get / Reset / use / Put`; the runtime tells you the pool is healthy via acquire latency below 1 ms; the audit log tells you what each connection did under every tenant. Get them wrong and the pool is the on-call incident — the one where the dashboards looked fine until they didn't.

---

## Further reading

- Jeff Bonwick, *The Slab Allocator: An Object-Caching Kernel Memory Allocator* (USENIX 1994) — https://www.usenix.org/legacy/publications/library/proceedings/bos94/full_papers/bonwick.pdf
- Christoph Lameter, *SLUB allocator design* — Linux kernel documentation, `Documentation/vm/slub.txt`
- Go runtime source — `src/sync/pool.go`, `src/runtime/mcache.go`, `src/runtime/mcentral.go`
- `jackc/pgx` pool — https://github.com/jackc/pgx; `pgxpool` package docs
- `valyala/fasthttp` and `valyala/bytebufferpool` — https://github.com/valyala/fasthttp, https://github.com/valyala/bytebufferpool
- `redis/go-redis` connection pool — https://github.com/redis/go-redis
- PgBouncer — https://www.pgbouncer.org; transaction-mode caveats: https://www.pgbouncer.org/features.html
- Envoy connection pool & circuit breakers — https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/connection_pooling
- Little's Law and M/M/c — Kleinrock, *Queueing Systems Vol. 1* (1975)
- W3C Trace Context — https://www.w3.org/TR/trace-context/
- Go 1.19 release notes on `GOMEMLIMIT` — https://go.dev/doc/go1.19#runtime
- Vincent Blanchon, *Go: Understand the Design of sync.Pool* — https://medium.com/a-journey-with-go
- Brad Fitzpatrick, *singleflight* design — `golang.org/x/sync/singleflight`
