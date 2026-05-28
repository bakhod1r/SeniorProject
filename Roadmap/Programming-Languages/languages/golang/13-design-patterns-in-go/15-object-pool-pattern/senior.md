# Object Pool — Senior

## 1. Mental model — Pool as allocation amortizer

At junior level, Object Pool is "reuse expensive objects". At middle level, it is "know when `sync.Pool` wins and avoid the buffer-size trap". At senior level, the framing shifts again: **a pool is not a cache and not a free list — it is an allocation amortizer that trades throughput regularity for lower steady-state pressure on the allocator and the GC**. Everything else — `sync.Pool`, connection pools, worker pools — specializes that idea against a different constraint.

The Go allocator is fast: a small object takes 20–40 ns from a per-P `mcache`. The GC is concurrent and low-latency; a normal cycle costs single-digit milliseconds of stop-the-world even at multi-gigabyte heaps. Against that baseline, **pooling pays off only when one of three pressures is real**:

| Pressure | What pooling buys | Where it shows up |
|----------|-------------------|-------------------|
| **Allocation rate** | Fewer allocations per request → fewer scan roots → smaller GC pauses | High-QPS HTTP/RPC servers, log shippers, lexers |
| **Object init cost** | Skips expensive setup (TLS handshake, slice grow, regex compile) | Connection pools, parser pools, encoder pools |
| **Working-set size** | Caps resident memory at "capacity × object size" | Buffer pools in proxies, encoders in gRPC servers |

If none of those apply, pooling is ceremony and likely a regression. The senior question is not "should I pool this" but "which pressure am I relieving, and is the pool's cost worth the relief". Most of the time the answer is no; when it is yes, the win is visible in a flame graph.

The pool is also a contract about identity. The borrower may not assume anything about the pooled object's contents — every field is potentially poisoned by the previous borrower. Returning the object means renouncing every reference to it; using a returned object is a data race. These two invariants are the whole social contract of pooling, and breaking either is the leading source of pool-related bugs.

---

## 2. `sync.Pool` internals — per-P poolLocal, victim cache, GC clear

`sync.Pool` is small, clever, and worth reading once in the standard library source (`src/sync/pool.go`). The senior-level understanding is built around four structures.

### 2.1 Per-P local pool

Each `P` (logical processor) owns a `poolLocal`:

```go
type poolLocalInternal struct {
    private any        // only this P touches
    shared  poolChain  // local P pushHead/popHead; any P popTail
}
```

`private` is a single object only the owning P touches — no synchronization. `shared` is a lock-free deque: local P pushes/pops at the head, other Ps steal from the tail. A 128-byte pad on `poolLocal` prevents false sharing between adjacent entries.

`Get` tries, in order: `private`, `shared.popHead` (local), `shared.popTail` (steal from other Ps), the victim cache, then `New`. `Put` writes to `private` if empty, otherwise `shared.pushHead`.

The senior consequence: **pooled access is nearly free under steady load** — the common case is `private` non-nil and `Get` is a single read. Under contention, work-stealing keeps throughput high; the only synchronization is on the lock-free shared queue.

### 2.2 Victim cache

Since Go 1.13, `sync.Pool` uses a two-generation victim cache. On each GC:

1. `victim` is dropped (memory reclaimed).
2. `local` is moved into `victim`.
3. `local` is reset to empty.

A pooled object survives **at most two** GC cycles. After one cycle it is demoted to the victim cache (still reachable from `Get`). After two cycles it is gone. The victim cache was added to smooth the cliff: before Go 1.13, every GC cleared the pool completely, and high-allocation workloads spiked immediately after every GC. The two-generation design means there is always something to hand out post-GC.

### 2.3 GC clear discipline

`runtime.GC` calls `poolCleanup` (registered via `runtime_registerPoolCleanup`). This is the only way pool contents are released — there is no LRU, no size cap, no explicit `Drain`. The working set is bounded only by put rate and GC frequency.

The senior consequence: **`sync.Pool` is not suitable for objects whose creation is expensive enough that you cannot afford to lose them on a GC**. A connection that took 50 ms to dial cannot live in `sync.Pool` — the GC will throw it away. That is why every real connection pool in the ecosystem (`database/sql`, `pgx`, `redis-go`, `grpc-go`) is hand-written, not built on `sync.Pool`.

### 2.4 Hidden costs

| Cost | When it matters |
|------|-----------------|
| **Interface boxing** | One allocation per `Put` if the value isn't a pointer — always pool through pointers |
| **Race detector overhead** | `Get`/`Put` instrumented under `-race`; production unaffected |
| **False sharing** | Mitigated by the 128-byte pad; rarely an issue |

The practical trap is the first. `Put(buf)` where `buf` is `[]byte` allocates an `interface{}` box every time, and the pool you thought was free now allocates per `Put`. Always pool through a pointer: `Put(&buf)` or wrap the slice in a struct.

---

## 3. GC & allocation interaction — GOGC, GOMEMLIMIT

A pool's real effect is on the GC. Two knobs frame the picture.

### 3.1 GOGC

`GOGC` is the heap growth percentage that triggers the next GC. With `GOGC=100` (default), GC fires when the live heap doubles. If an app allocates 1 GB/s of garbage with 200 MB live, GC fires every 200 ms. Pooling shifts allocations from "garbage" to "reused" — the heap stops growing, GC pressure drops, the trigger pushes out.

The senior measurement is not "ns/op of `Get`/`Put`" — it is **the change in GC frequency and pause time after the pool is added**. Run with `GODEBUG=gctrace=1`:

```
gc 42 @1.234s 0%: 0.020+1.3+0.011 ms clock, ...
```

The middle number (`1.3`) is mark-phase wall time. Pooling a hot per-request buffer in an HTTP server typically drops this by 20–60% — fewer roots, less heap to traverse.

### 3.2 GOMEMLIMIT (Go 1.19+)

`GOMEMLIMIT` is a soft memory ceiling. The runtime tightens GC aggressiveness as the heap approaches it, ignoring `GOGC` if the limit would be breached. Pooling interacts with `GOMEMLIMIT` two ways:

| Effect | Direction | Why |
|--------|-----------|-----|
| **Reduces allocation rate** | Helpful | Pushes out GC triggers under tight limits |
| **Pins memory in the pool** | Harmful | Pooled objects look like resident memory |

A buffer pool with 10000 entries of 64 KB each pins 640 MB the runtime cannot reclaim. Under `GOMEMLIMIT=1GiB` that pool starves the rest of the app. The senior rule: **cap pool entries by size and count**, and treat the pool's footprint as part of the memory budget.

### 3.3 Allocation profile

`go test -bench -benchmem -memprofile=mem.prof` then `go tool pprof -alloc_objects mem.prof` shows top allocators. Senior pooling targets the top three or four call sites — not sprinkled across the codebase. Every other pool is overhead.

---

## 4. Real ecosystem — encoding/json, fasthttp, pgx, klauspost/compress

### 4.1 `encoding/json` — the encoder pool

`encoding/json` pools encoder state:

```go
// encoding/json/stream.go (paraphrased)
var encodeStatePool sync.Pool

func newEncodeState() *encodeState {
    if v := encodeStatePool.Get(); v != nil {
        e := v.(*encodeState)
        e.Reset()
        if len(e.ptrSeen) > 0 {
            panic("ptrEncoder.encode should have emptied ptrSeen via defers")
        }
        e.ptrLevel = 0
        return e
    }
    return &encodeState{ptrSeen: make(map[any]struct{})}
}
```

The encoder's buffer and cycle-detection map (`ptrSeen`) are pooled together. `Reset` clears length but keeps capacity. On `Put`, the encoder is validated clean — the `ptrSeen` panic guards against returning a corrupted encoder.

The senior takeaway: **the pool is for the encoder, not the JSON output**. The output `[]byte` is freshly allocated on each `Marshal` because the caller keeps it. Mixing "pooled internal scratch" with "freshly allocated output" is the canonical safe shape.

### 4.2 `valyala/fasthttp` — pools at every level

fasthttp is the most aggressively pooled HTTP stack in Go. The whole `RequestCtx` (headers, URI, request and response bodies) is pooled per-connection:

| Pool | Object | What it amortizes |
|------|--------|-------------------|
| `ctxPool` | `*RequestCtx` | Per-request state, headers, body buffers |
| `readerPool` | `*bufio.Reader` | Connection read buffer |
| `writerPool` | `*bufio.Writer` | Connection write buffer |
| `hijackConnPool` | `*hijackConn` | Hijacked connection wrappers |

The cost: the handler must finish with the `RequestCtx` before returning. fasthttp's signature is `func(*RequestCtx)`, not `func(ResponseWriter, *Request)`, precisely because the ctx is reused — the framework cannot let it escape. The senior lesson: **deep pooling forces API restrictions on the caller**. fasthttp serves several times the QPS of `net/http` on micro-benchmarks, but callers must obey strict "do not retain references" rules. Most production services accept the slower API for the safer contract.

### 4.3 `pgx` connection pool

`jackc/pgx/v5/pgxpool` is the canonical Go connection pool — explicitly not built on `sync.Pool`. What pgx does that `sync.Pool` cannot:

- **Enforces max conns.** Beyond `MaxConns`, callers block on a waiters list with a context.
- **Maintains min conns.** A background goroutine dials to keep `len(conns) >= minConns`.
- **Health checks.** Every `healthCheckPeriod`, idle conns past `maxConnIdleTime` are closed; conns past `maxConnLifetime` are retired even if hot.
- **Acquire-time predicate.** `beforeAcquire(ctx, conn) bool` runs before handing out; returning false destroys the conn and dials a fresh one — how "server restarted while idle" is handled.
- **Release predicate.** `afterRelease(conn) bool` decides whether to return to the pool or destroy.

The senior pattern is those hooks: **a real connection pool has a lifecycle, not just a free list**. Every connection pool you build should have at least `maxConnLifetime`, `healthCheck`, and `beforeAcquire`.

### 4.4 `klauspost/compress` — encoder/decoder pools

`klauspost/compress` (`gzip`, `zstd`, `flate`, `s2`) pools encoder state. `zstd.Encoder` carries internal dictionaries, match buffers, and a goroutine for parallel encoding. Creation costs hundreds of microseconds; pooling is mandatory for high-throughput compression.

```go
var encoderPool = sync.Pool{
    New: func() any {
        e, _ := NewWriter(io.Discard, WithEncoderLevel(SpeedDefault))
        return e
    },
}

func borrowEncoder(w io.Writer) *Encoder {
    e := encoderPool.Get().(*Encoder)
    e.Reset(w)
    return e
}

func returnEncoder(e *Encoder) {
    e.Reset(io.Discard) // detach from caller's writer
    encoderPool.Put(e)
}
```

The senior detail: **on `Put`, the encoder is reset against `io.Discard`** to drop the caller's `io.Writer` reference. Skip this, and the pooled encoder keeps a pointer to the caller's writer — perhaps a `*bytes.Buffer` that gets reused for another request — and the leak chain is silent. The discipline: **return pooled objects in a neutral state, not the state they ended up in**.

---

## 5. Connection pools — invariants, health check, dial-on-demand

Connection-pool failure modes are operational, not algorithmic.

### 5.1 Five invariants

| Invariant | Why | How |
|-----------|-----|-----|
| **No conn handed out twice** | Two goroutines on one socket corrupts the protocol | Track ownership; checkout under lock |
| **Closed conns never re-handed-out** | Returning a dead conn causes silent EOFs | `beforeAcquire` predicate; socket close detection |
| **Bounded total count** | Exceeding DB limits stalls the fleet | Counting semaphore; block at max |
| **No leaks** | Lent-not-returned drains the pool | Context-bound checkout; finalizer as safety net |
| **Graceful shutdown** | Close racing with in-flight queries panics | Wait for checkouts to return before closing |

The senior failure mode is the fifth. Closing conns while they are checked out produces "use of closed network connection" errors that look like a network outage but are actually a shutdown race. Track in-flight count and wait on a `WaitGroup` or closed channel before tearing down.

### 5.2 Health check

The canonical health-check loop:

```go
func (p *Pool) healthCheckOnce(ctx context.Context) {
    p.mu.Lock()
    candidates := append([]*Conn(nil), p.idleConns...)
    p.mu.Unlock()

    now := time.Now()
    for _, c := range candidates {
        switch {
        case now.Sub(c.createdAt) > p.maxConnLifetime:
            p.destroy(c)
        case now.Sub(c.lastUsed) > p.maxConnIdleTime:
            p.destroy(c)
        case !p.ping(ctx, c):
            p.destroy(c)
        }
    }
}
```

Three stacked policies: max lifetime (retire even healthy long-lived conns), max idle time (close conns DBs and load balancers silently drop), and ping (active probe). The combination catches almost every "stale connection" flavor.

The senior tuning rule: **set `maxConnLifetime` shorter than any upstream-side timeout**. If PgBouncer closes idle conns after 5 minutes, set `maxConnIdleTime` to 4 minutes. If a load balancer rotates backends every hour, set `maxConnLifetime` to 50 minutes. The pool must retire conns *before* the upstream does, or you get sporadic EOFs at random times.

### 5.3 Dial-on-demand vs pre-warmed

| Strategy | Trade-off |
|----------|-----------|
| **Lazy / dial-on-demand** | Cold-start spikes; first N requests pay dial cost |
| **Pre-warm to min conns at startup** | Slower startup; predictable steady-state latency |
| **Background top-up** | Recovers from transient outages without traffic |

Production pools combine all three. The senior gotcha: **never block startup on full pre-warm**. If the DB is down at startup, waiting for `MinConns` dials means your service never starts. Pre-warm with a timeout; log failures and let the service come up. Dial-on-demand fills the pool once traffic arrives.

---

## 6. Generics-based typed pools (Go 1.18+)

`sync.Pool` predates generics and returns `any`, so every borrower writes the same cast. Generics let you wrap it:

```go
type Pool[T any] struct{ p sync.Pool }

func New[T any](newFn func() *T) *Pool[T] {
    return &Pool[T]{p: sync.Pool{New: func() any { return newFn() }}}
}

func (p *Pool[T]) Get() *T  { return p.p.Get().(*T) }
func (p *Pool[T]) Put(v *T) { p.p.Put(v) }

var bufPool = New(func() *bytes.Buffer { return new(bytes.Buffer) })
buf := bufPool.Get(); defer bufPool.Put(buf); buf.Reset()
```

The cast happens once inside the wrapper; callers see typed pointers. Overhead is one non-inlined method call (~1–2 ns), and the API is no longer error-prone — you cannot `Put` a `*foo` into a pool typed for `*bar`. Two senior refinements make this production-grade.

### 6.1 Reset hook

The wrapper can enforce the reset discipline:

```go
type Pool[T any] struct {
    p     sync.Pool
    reset func(*T)
}

func (p *Pool[T]) Get() *T {
    v := p.p.Get().(*T)
    if p.reset != nil {
        p.reset(v)
    }
    return v
}
```

Calling `reset` on `Get` (not `Put`) is deliberate — on `Put`, the borrower might forget; on `Get`, the wrapper guarantees freshness regardless of how the previous borrower returned the object. This is one of the rare cases where library code should do work the user might forget.

### 6.2 Size cap

The buffer-bloat trap from the middle file generalizes:

```go
func (p *Pool[T]) PutBounded(v *T, ok func(*T) bool) {
    if !ok(v) {
        return // dropped — let GC reclaim
    }
    p.p.Put(v)
}

// Usage:
bufPool.PutBounded(buf, func(b *bytes.Buffer) bool {
    return b.Cap() <= 64*1024
})
```

A generic pool that does not let you cap returned objects is incomplete. Every production pool of growable objects needs this.

---

## 7. Worker pools at scale — bounded concurrency, backpressure

A worker pool is the same idea applied to goroutines. The middle-level shape (fixed workers, buffered channel) handles moderate scale. At senior scale, four refinements matter.

### 7.1 Bounded concurrency with `errgroup`

For request-scoped fan-out with a concurrency limit:

```go
func ProcessBatch(ctx context.Context, items []Item) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(8) // at most 8 concurrent goroutines

    for _, item := range items {
        item := item
        g.Go(func() error { return process(gctx, item) })
    }
    return g.Wait()
}
```

`errgroup.SetLimit(n)` (Go 1.20+) bounds concurrency without manual semaphores, propagates the first error, and cancels the group's context on failure. This is the senior default for one-off fan-out — no permanent worker pool needed.

### 7.2 Weighted semaphore for asymmetric work

For long-lived bounded concurrency where jobs have different costs:

```go
type Worker struct{ sem *semaphore.Weighted }

func (w *Worker) Process(ctx context.Context, item Item) error {
    if err := w.sem.Acquire(ctx, item.Cost); err != nil {
        return err
    }
    defer w.sem.Release(item.Cost)
    return process(ctx, item)
}
```

The weighted semaphore lets you express "this job costs 4 units, this one costs 1" — useful for heterogeneous workloads like image transcodes of varying size.

### 7.3 Backpressure shape

| Buffer | Producer behavior | When |
|--------|-------------------|------|
| **Unbuffered** | Blocks until worker takes the job | Strict back-pressure; producer matches worker rate |
| **Small (workers × 2)** | Smooths short bursts | Default; low tail latency |
| **Large (hundreds)** | Hides backend slowness | Latency tail explodes |
| **Reject when full** | `select` with `default` returns busy | API-style backpressure; producer retries |

The senior anti-pattern is the unbounded buffer: `make(chan Job, 100000)` hides a backlog that eventually OOMs. Bounded buffers (workers × 2 is a good default) satisfy Little's Law — in-flight is bounded by (workers + buffer), tail latency by buffer time.

### 7.4 Graceful shutdown

A worker pool must shut down without dropping in-flight jobs:

```go
type Pool struct {
    jobs   chan func()
    wg     sync.WaitGroup
    closed chan struct{}
}

func (p *Pool) Submit(ctx context.Context, f func()) error {
    select {
    case p.jobs <- f:
        return nil
    case <-p.closed:
        return errors.New("pool closed")
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (p *Pool) Shutdown(ctx context.Context) error {
    close(p.closed) // block new submissions first
    close(p.jobs)   // workers drain remaining jobs and exit
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Close the input (`p.jobs`), let workers drain naturally, wait with a timeout. The senior addition is the `closed` channel that prevents new submissions during shutdown — closing `p.jobs` alone is not enough, because `Submit` racing with `close(p.jobs)` panics on send to closed channel.

---

## 8. Observability — hit/miss metrics, leak detection

A pool is the kind of optimization that fails silently. A buffer pool with no size cap looks correct, has correct semantics, and silently uses 10x the intended memory. Observability is how you catch this.

### 8.1 Hit / miss metrics

Push the count into the `New` callback — the cleanest way to distinguish "served from pool" from "served via `New`":

```go
type CountingPool[T any] struct {
    p      sync.Pool
    gets   atomic.Int64
    misses atomic.Int64
}

func NewCounting[T any](newFn func() *T) *CountingPool[T] {
    cp := &CountingPool[T]{}
    cp.p.New = func() any {
        cp.misses.Add(1)
        return newFn()
    }
    return cp
}

func (cp *CountingPool[T]) Get() *T {
    cp.gets.Add(1)
    return cp.p.Get().(*T)
}
// hits = gets - misses
```

The hit rate is the single most useful pool metric. Three regimes:

| Hit rate | Diagnosis | Action |
|----------|-----------|--------|
| **> 95%** | Pool is doing its job | Leave it alone |
| **50–95%** | Workload is bursty or pool is GC-cleared too often | Increase load smoothness or accept it |
| **< 50%** | Pool is mostly running `New` | Either the pool is too small / too cold, or it should not exist |

A pool with a 10% hit rate is allocating 90% of the time *plus* the pool overhead. Delete it.

### 8.2 Size and resident memory

`sync.Pool` does not expose internal counts. For custom pools, export:

| Metric | Type | Reason |
|--------|------|--------|
| `pool_size` | gauge | Current idle objects |
| `pool_capacity` | gauge | Max objects (for bounded pools) |
| `pool_in_use` | gauge | Currently checked out — also a leak detector |
| `pool_resident_bytes` | gauge | Bytes pinned by the pool |

`pool_in_use` is the leak detector — if it climbs without bound, there is a `Get` without `Put`. An alert on "pool_in_use has grown monotonically for 24 hours" catches almost every leak before exhaustion.

### 8.3 Leak detection in development

For `sync.Pool` there is no `in_use` count. The development trick: set a finalizer on `Get` and clear it on `Put`:

```go
func devGet[T any](p *sync.Pool) *T {
    v := p.Get().(*T)
    runtime.SetFinalizer(v, func(_ *T) {
        // GC found this unreachable without a Put — leak.
        atomic.AddInt64(&leakCount, 1)
    })
    return v
}

func devPut[T any](p *sync.Pool, v *T) {
    runtime.SetFinalizer(v, nil)
    p.Put(v)
}
```

The finalizer fires only when the GC finds the object unreachable — which, for a Put object, never happens until the pool itself drops it. Non-zero `leakCount` after a soak test is a leak. Disable in production; finalizers are not free.

### 8.4 Profiling diff

```bash
go tool pprof -base before.prof after.prof
```

This shows the *difference* before vs after enabling the pool. A successful pool produces a negative delta in `bytes.makeSlice` (or wherever the allocation moved from). A pool that does nothing shows no delta. A regression shows a positive delta at the pool's call sites.

---

## 9. When NOT to pool + closing principles

The senior judgment is when *not* to reach for a pool. Five cases.

**9.1 The allocation is sub-100 ns.** Pooling a 16-byte struct is harmful. The pool's overhead (~5 ns plus interface boxing if you mishandle pointers) exceeds the ~10–20 ns it saves. The pooled version benchmarks slower.

**9.2 The object outlives a request.** `sync.Pool` is designed for sub-request lifetimes. An object held for minutes crosses GC cycles and gets evicted before reuse — the pool degenerates to "call `New` every time". Use a hand-written pool if you need long-lived reuse.

**9.3 The object holds external resources.** Sockets, file handles, epoll registrations, mmaps — none belong in `sync.Pool`. The GC may evict the object; the underlying resource leaks. `sync.Pool` calls no finalizer and no close hook. Use a hand-written pool with explicit lifecycle.

**9.4 The object varies in size by orders of magnitude.** A buffer pool holding 64-byte to 1 MB buffers ends up storing the largest. Segment by size (small-buffer pool, large-buffer pool) or do not pool — the buffer-size trap will eat you.

**9.5 The object is shared and immutable.** `*regexp.Regexp` after compilation, `*template.Template` after parsing, compiled gRPC descriptors — stateless after construction. Store one global instance, not a pool. Pooling immutables is pure ceremony.

### 9.6 Closing principles

**A pool is an amortizer, not a cache.** It does not promise reuse — it promises that *when* reuse happens, the cost is paid once. Design for the world where every `Get` runs `New`; let the pool make the common case faster.

**The borrower owes a clean object.** Reset on `Put`, or have the pool reset on `Get`. Never leave it to "we'll remember". Make the contract explicit in the wrapper (§6.1).

**Cap everything that can grow.** Buffer size, slice capacity, map count — every growable property needs an upper-bound check on return. Otherwise the pool's working set becomes the workload's worst-case allocation forever.

**Measure first, last, and during.** Pooling without a benchmark is cargo cult. Track ns/op and allocs/op (micro), GC frequency and pause time (system), hit rate and pool size (operational). A pool that improves none of these should be deleted.

**Use the right pool for the resource.** `sync.Pool` for GC relief; hand-written typed pool for bounded count and lifecycle; channel-based pool for FIFO and backpressure; `errgroup`/`semaphore` for bounded concurrency.

**Reach for it last, not first.** Go's default is "allocate; let GC do its job". Add a pool when a profile points to a call site that pooling can demonstrably fix; remove it the day the benchmark stops showing a win. A pool that paid off six months ago but does not help today is a maintenance liability disguised as an optimization.

---

## Further reading

- `src/sync/pool.go` — the `sync.Pool` implementation, worth reading end-to-end
- Dmitry Vyukov, "sync.Pool: per-P storage and victim cache" — runtime design notes
- `encoding/json/stream.go` — canonical pool usage in the stdlib
- `valyala/fasthttp` — aggressive pooling and the API restrictions it forces
- `jackc/pgx/v5/pgxpool` — production typed connection pool
- `klauspost/compress/zstd` — heavyweight encoder pools with reset discipline
- `golang.org/x/sync/errgroup`, `golang.org/x/sync/semaphore` — bounded concurrency
- Runtime docs for `GOGC` and `GOMEMLIMIT`; `runtime/debug.SetGCPercent`, `SetMemoryLimit`
