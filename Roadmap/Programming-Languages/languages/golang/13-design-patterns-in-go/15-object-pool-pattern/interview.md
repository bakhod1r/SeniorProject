# Object Pool — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus three live-coding prompts, concept checks, and the signals interviewers grade on. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**.

Read top to bottom first pass; skim short answers on revision. Type the live-coding answers once — don't just read them. Object Pool is the rare pattern where interviewers expect numbers (allocs/op, ns/op, hit rate); don't show up without having benchmarked something recently.

---

## 2. Junior questions (Q1–Q7)

### Q1. What is the Object Pool pattern?

**Short answer:** Object Pool reuses expensive objects instead of allocating fresh ones every time. You keep a cache; callers borrow, use, return; the next caller gets the same physical object back. The pattern targets allocation pressure (which Go's GC has to clean up) and initialization cost. The textbook example in Go is `sync.Pool`, built into the standard library because pooling is common enough to deserve a primitive.

**Follow-up to expect:** Is Object Pool a GoF pattern? Answer: no — not in the original Gang of Four catalog. It shows up in PoEAA and language-specific guides. GoF modeled C++ in 1994; their concern was object structure, not GC pressure.

---

### Q2. Why pool objects in Go? Doesn't the GC handle it?

**Short answer:** GC handles it correctly but not for free. Every allocation eventually becomes garbage; every cycle pauses briefly and burns CPU scanning. For most code this is invisible. For hot paths — JSON encoders per request, parser scratch buffers, byte buffers in a log pipeline — allocation rate can dominate the work itself. Pooling cuts allocation rate and with it GC CPU and pause frequency.

**Follow-up to expect:** How do you know GC is your problem? Answer: `GODEBUG=gctrace=1` shows per-GC pauses; `runtime.MemStats` exposes `PauseTotalNs` and `NumGC`; pprof's allocs profile shows top sites. >5% CPU in `runtime.gcBgMarkWorker` puts pooling on the table; <1% means it's premature optimization.

---

### Q3. Show a minimal `sync.Pool` in Go.

**Short answer:**

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func format(name string) []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.WriteString("hello ")
    buf.WriteString(name)
    // Copy out — caller can't keep a pointer into the pooled buffer.
    out := make([]byte, buf.Len())
    copy(out, buf.Bytes())
    return out
}
```

Three pieces: pool with `New` constructor; `Get()` to borrow (type assertion because the pool stores `any`); `Put()` to return. `Reset()` is mandatory — the buffer still holds previous data. The `copy` is mandatory — once you `Put`, someone else may write.

**Follow-up to expect:** Why the type assertion? Answer: `sync.Pool` predates generics — `Get()` returns `any`. A generic wrapper is straightforward (Q17). Stdlib hasn't migrated because it would break the documented API.

---

### Q4. Why does `Reset()` matter? What happens if you forget it?

**Short answer:** A pooled object carries previous state. If you `Get()` a `*bytes.Buffer` and write without resetting, you append to whatever the last caller left — the next response has the wrong prefix, the next parser sees stale tokens, the next request gets someone else's headers. Forgetting `Reset()` is the most common pool bug.

**Follow-up to expect:** Where should `Reset()` live — `Get`, `Put`, or call site? Answer: reset-on-Put wastes work if the caller skips `Put` (panic, early return). Reset-on-Get is safer — if a borrower panics, the next one still gets clean state.

---

### Q5. What does the `New` function in `sync.Pool` do?

**Short answer:** `New` is the fallback constructor — `sync.Pool` calls it when `Get()` finds the pool empty. It runs on first borrow per P, after GC clears the pool, and whenever the per-P local is empty. `New` should be cheap; expensive construction erodes the pool's benefit. If `New` is `nil`, `Get()` from an empty pool returns `nil` — usually a bug.

**Follow-up to expect:** What if `New` allocates 50 KB? Answer: pool still helps under steady load — once per P, then reuse. The risk is cold paths (process start, post-GC, spikes). Prewarm at startup by calling `Get`/`Put` N times so each P has a cached object.

---

### Q6. Where is pooling used in the standard library?

**Short answer:** `encoding/json` pools `encodeState`. `fmt` pools `*pp` structs (printer state) so every `Sprintf` doesn't allocate. `net/http` pools chunked readers and `bufio.Reader`/`Writer` for connections. `compress/gzip` pools internal buffers. The pattern shows up wherever there's a per-call scratch object bounded by the call.

**Follow-up to expect:** Any pool that was removed? Answer: `regexp` simplified pooled state over Go versions as the allocator improved. Lesson: rebenchmark old pools periodically — they aren't always still wins.

---

### Q7. What does pooling do to GC pressure?

**Short answer:** A working pool keeps allocation rate near zero. Fewer allocations = fewer GC cycles, shorter mark phases, smaller heap working set. Measure: `go test -benchmem` shows N allocs/op without the pool; with it, you want 0 or 1. If allocs/op doesn't drop, `New` is running every call — figure out why before declaring victory.

**Follow-up to expect:** Can pooling make GC worse? Answer: yes. (1) The pool allocates internal nodes; `Put`s the pool drops are waste. (2) Long-lived pooled objects can pin large backing arrays — the buffer-size trap (Q10). Pooling shifts cost; doesn't always eliminate it.

---

## 3. Middle questions (Q8–Q15)

### Q8. When does `sync.Pool` clear its contents?

**Short answer:** During GC. The GC hooks into `sync.Pool` and may clear at any cycle — opportunistic retention, a hint not a guarantee. Modern Go (1.13+) splits into "primary" and "victim" caches; GC only clears victim, giving objects two cycles. But the principle stands: never rely on `sync.Pool` for retention. For strict retention (connections), use a typed channel pool.

**Follow-up to expect:** Why the victim cache? Answer: pre-1.13, clearing every GC caused thundering-herd reallocation after each cycle. The victim cache means objects survive one extra cycle, smoothing the cliff.

---

### Q9. What's "per-P" and why does it matter?

**Short answer:** Go's runtime has a fixed number of P's (`GOMAXPROCS`). `sync.Pool` keeps a local cache per P. `Get()` looks at the current P's local first — near-lock-free. Only if empty does it fall back to shared (lock) or steal from another P. That's why `sync.Pool` scales under contention: most ops never touch a shared mutex.

```go
// Get -> p.local.private (no lock) -> p.local.shared (lock) -> steal -> New
// Put -> p.local.private             -> p.local.shared
```

**Follow-up to expect:** Goroutine migration? Answer: goroutines can be rescheduled between `Get` and `Put`. The `Put` lands on the new P's cache. Fine for correctness; you just can't reason about occupancy per goroutine.

---

### Q10. The buffer-size trap.

**Short answer:** Pool a `*bytes.Buffer` naively, one borrower writes 10 MB. `Reset()` clears length but keeps the backing array. That 10 MB stays in the pool forever; multiply by per-P caches and you've leaked tens of megabytes for process lifetime. Fix: check `Cap()` before `Put`, discard buffers that grew too large.

```go
func putBuf(b *bytes.Buffer) {
    if b.Cap() > 64<<10 { return } // drop oversized; let GC reclaim
    b.Reset()
    bufPool.Put(b)
}
```

`encoding/json` does exactly this. Pick the threshold from p95 of normal request size.

**Follow-up to expect:** Why not shrink? Answer: `bytes.Buffer` has no public shrink. Allocating a smaller buffer and copying defeats the purpose. Dropping and letting GC reclaim is cleaner.

---

### Q11. `sync.Pool` vs buffered channel — when does each win?

**Short answer:** `sync.Pool` wins when (a) the object is cheap to recreate, (b) you don't care about pool size, (c) GC-clearing is acceptable. A channel pool wins when (a) creation is expensive (network connection), (b) you must cap total objects, (c) you need health-check semantics. `sync.Pool` is faster (per-P, lock-free) but uncontrollable. Channel pool is slower (shared lock) but predictable.

**Follow-up to expect:** Hide both behind one interface? Answer: yes. `database/sql.DB` is a typed connection pool. Build a small `Pool[T]` with two impls; call sites stay identical, choice moves to construction.

---

### Q12. Why is `sync.Pool` wrong for database connections?

**Short answer:** Three reasons. (1) `sync.Pool` may evict during GC — a 50 ms-to-dial connection can't be lost casually. (2) No size cap; Postgres `max_connections=100` is a real limit and an unbounded pool will exceed it. (3) No health check; a TCP-reset connection surfaces a confusing error at next `Query`. Real pools (`database/sql.DB`, `pgxpool`) implement all three.

**Follow-up to expect:** Pooling HTTP clients? Answer: don't — `*http.Client` is safe for concurrent use and meant to be shared. The standard `http.Transport` already pools per-host TCP connections (`MaxIdleConnsPerHost`). Reaching for `sync.Pool` around `*http.Client` misreads the stdlib.

---

### Q13. Pooling a struct with maps/slices — the gotcha?

**Short answer:** The struct's inner allocations come back too. A naive `Put` returns the struct but map keys are still there, or the slice has capacity from someone else's growth. Reset inner state, carefully — replacing the map with a new one defeats the pool; clearing keys preserves the allocation.

```go
func putRequest(r *Request) {
    for k := range r.Headers { delete(r.Headers, k) } // or clear() in Go 1.21+
    r.Body = r.Body[:0] // length 0, capacity kept
    reqPool.Put(r)
}
```

Replacing either with a new allocation throws away the whole point.

**Follow-up to expect:** Nested pooled values? Answer: outer reset must `Put` inner objects before nilling pointers. Easy to get wrong. Pool flat structs; for nested pooling, write tests verifying nothing leaks across borrows.

---

### Q14. Build a fixed-size worker pool.

**Short answer:** Worker pool isn't `sync.Pool`; same name, different pattern. N goroutines reading jobs from a channel; the pool bounds concurrency and amortizes goroutine startup.

```go
type Pool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func New(workers int) *Pool {
    p := &Pool{jobs: make(chan func(), workers*4)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go func() { defer p.wg.Done(); for f := range p.jobs { f() } }()
    }
    return p
}

func (p *Pool) Submit(f func()) { p.jobs <- f }
func (p *Pool) Close()          { close(p.jobs); p.wg.Wait() }
```

**Follow-up to expect:** Why not goroutine-per-job? Answer: goroutines are cheap (~2 KB) but not free, and per-request goroutines remove natural backpressure — unbounded growth eats memory. A bounded worker pool gives backpressure for free: `Submit` blocks when full, propagating to the caller and upstream.

---

### Q15. How do you benchmark a pool?

**Short answer:** Two benchmarks — with and without — and three numbers: `allocs/op`, `B/op`, `ns/op`. Pool wins if all three drop; if any gets worse, the pool is harmful. Include `Reset` cost — it's part of using the pool.

```go
func BenchmarkPool(b *testing.B) {
    b.ReportAllocs()
    pool := sync.Pool{New: func() any { return new(bytes.Buffer) }}
    for i := 0; i < b.N; i++ {
        buf := pool.Get().(*bytes.Buffer)
        buf.Reset()
        buf.WriteString("hello world")
        _ = buf.String()
        pool.Put(buf)
    }
}
```

Run `go test -bench=. -benchmem -benchtime=5s`. Rule of thumb: <256 B rarely beats the allocator; >1 KB usually does. The 256 B–1 KB region needs measurement.

**Follow-up to expect:** Contention? Answer: `b.RunParallel` with `b.SetParallelism(N)`. `sync.Pool`'s per-P design only shows up under concurrent load; single-goroutine understates the win.

---

## 4. Senior questions (Q16–Q22)

### Q16. Walk through `sync.Pool`'s internals.

**Short answer:** Five components. (1) **`poolLocal` array**, one per P: each has a `private` field (single object, owning P only, no lock) and a `shared` ring buffer (lockable when stealing). (2) **`Get` fast path** — check `private`, return; no lock, no atomic — the 99% case. (3) **`Get` slow paths** — pop `shared` (lock-free), steal from other Ps, fall back to victim cache, finally `New`. (4) **Victim cache** — GC moves primary to victim and clears victim; objects survive one extra cycle, dramatically improving hit rate. (5) **`Put` fast path** — write `private` if empty, else push `shared`. Almost always lock-free.

`sync.Pool` is designed for goroutine-to-P locality, which holds in nearly all Go programs because the scheduler keeps work on the same P.

**Follow-up to expect:** `runtime_procPin`? Answer: pins the goroutine to its P so per-P access isn't preempted. Without it, a context switch between "read P index" and "access local[i]" would race with the runtime migrating the goroutine.

---

### Q17. Generic `Pool[T]` — write one. Trade-offs vs `sync.Pool`?

**Short answer:**

```go
type Pool[T any] struct{ p sync.Pool }

func New[T any](newFn func() T) *Pool[T] {
    return &Pool[T]{p: sync.Pool{New: func() any { return newFn() }}}
}
func (p *Pool[T]) Get() T  { return p.p.Get().(T) }
func (p *Pool[T]) Put(t T) { p.p.Put(t) }
```

Compiles, works, callers skip the assertion. Trade-off: every `Get` still does the `any.(T)` assertion under the hood — no raw speed gain. The gain is API safety; compiler catches `pool.Put(wrongType)`.

Libraries like `puzpuzpuz/xsync` reimplement per-P logic to avoid `any` boxing — faster for value types. Worth knowing they exist; usually not worth rolling your own.

**Follow-up to expect:** Box cost for value types? Answer: `[1024]byte` in `sync.Pool` boxes into `any`, allocating a heap header — defeating the purpose. Standard fix: pool pointers (`*[1024]byte`). For pointer types `sync.Pool` is fine; for value types, generics or hand-written per-P pools matter.

---

### Q18. When does `Get()` allocate even though there's "stuff in the pool"?

**Short answer:** Five cases. (1) **Pool cleared by GC** — primary and victim empty, `New` runs. (2) **First call on this P** — local empty, shared empty, steals fail. (3) **Contention loss** — goroutines on the same P fight for `private`; losers fall to `shared`. (4) **Type assertion escape** — assigning `any`→`*T` through an `interface{}` parameter allocates. Check `go build -gcflags="-m"`. (5) **`New`'s own work** — `New` that allocates 50 KB is a 50 KB allocation every call. Traffic spikes after idle reveal this.

Senior move: when someone says "we pool but still see allocs", walk these five and identify which. Usually #1 or #5.

**Follow-up to expect:** Measure hit rate? Answer: `atomic.AddInt64(&hits, 1)` on fast path, `&misses` when `New` runs; export the ratio. <50% means the pool isn't worth it; aim >95% steady.

---

### Q19. How does `GOMEMLIMIT` interact with pools?

**Short answer:** `GOMEMLIMIT` (Go 1.19) caps runtime memory; near the limit, GC runs more aggressively. More GC = more pool clears = more `New` = more allocations — exactly when you can least afford them. A pool under `GOMEMLIMIT` pressure performs worse than the same pool with headroom. Practical advice: set to ~80% of container memory, not 99%. If pool hit rate drops with high memory, that's the runtime telling you you're close to the limit.

**Follow-up to expect:** Size pools based on `GOMEMLIMIT`? Answer: not directly. For typed pools use Little's law, then sanity-check `pool_size * object_size` fits under `GOMEMLIMIT - working_set`. If not, you're over-pooling.

---

### Q20. Sizing math for a typed pool.

**Short answer:** Little's law. Pool size = `arrival_rate * service_time` minimum. 5000 req/s × 20 ms = 100 connections to never wait. Add 1.5–2x headroom for variance.

```text
N = QPS * avg_latency_seconds * safety_factor
```

Breaks down on bimodal latency: 95% take 10 ms but 5% take 1 s; the 5% pin connections during spikes. Either size for worst case (expensive) or set a hard timeout that returns 503 when exhausted — Postgres chose option two (`max_connections` + client `pool_timeout`).

**Follow-up to expect:** Cost of over-sizing? Answer: idle objects hold memory and (for connections) slots on the remote server. 20 services × 200 connections = 4000, over a 200-slot database. Pool sizing is an org-wide capacity question.

---

### Q21. Pool has 30% hit rate. What do you investigate?

**Short answer:** 70% of `Get` runs `New` — pool is doing work without paying back. Five causes: (1) **GC too aggressive** — check `gctrace=1`; if GC fires every few seconds with memory headroom, pacing is misconfigured. (2) **Goroutines >> GOMAXPROCS** — per-P local holds one object; 10k goroutines on 8 Ps spill to shared. (3) **Cold path dominates** — bursty traffic empties the pool between bursts; prewarm. (4) **Wrong object pooled** — if `New` is cheaper than pool overhead, hit rate is low and there's no perf gain. Pool isn't broken, just useless — remove it. (5) **Caller doesn't `Put`** — leak. Instrument `Put` count vs `Get`.

Senior move: don't guess. Add metrics, watch during normal load, deploy, spikes. The shape of when hit rate drops tells you which.

**Follow-up to expect:** Healthy hit rate? Answer: >95% steady, >80% spikes. Below 50% = debt.

---

### Q22. Health-check items in a connection pool?

**Short answer:** Two strategies, often combined. (1) **Check on borrow** — `Ping()` before handing out; fails → close, retry. Costs one round trip; useful with high connection mortality (cloud DBs with aggressive idle timeouts). (2) **Check on return** — `Put()` checks last-error/last-use and discards stale. Cheaper than borrow-check; catches bad connections before the next caller suffers. A background reaper complements both: close anything idle > N minutes. Sync your reaper with server-side `tcp_keepalive` and `idle_in_transaction_session_timeout`, or get cryptic "connection reset by peer" during quiet periods.

**Follow-up to expect:** Why not let the DB error and reconnect? Answer: the error surfaces at the *application's* request, not the pool's. User-facing 500 is worse than a 20-µs `Ping`. The pool's job is to give callers a working connection.

---

## 5. Staff/Architect questions (Q23–Q25)

### Q23. Design a resilient connection pool for a flaky upstream.

**Short answer:** Six components. (1) **Bounded size with two limits** — `min_idle` (keep N warm) and `max_total` (hard ceiling). Smooths cold start; prevents resource exhaustion. (2) **Health-check on borrow** — `Ping` with 50–100 ms timeout; failed → close, retry. (3) **Circuit breaker around `Get`** — N consecutive failures open the breaker; `Get` returns `ErrUnavailable` for the cool-down, preventing reconnect storms. (4) **Background reaper** — closes idle-too-long, replaces failed up to `min_idle`. (5) **Metrics required** — `pool_size`, `pool_idle`, `pool_borrowed`, `pool_wait_seconds` histogram, `pool_create_total`, `pool_close_total`, `pool_health_check_fail_total`. Without these, on-call burns hours. (6) **Context-aware `Get`** — honors `ctx.Done()`; 10 ms deadline against 500 ms wait → fail fast.

Staff candidate names the **tail-tolerance gap**: upstream p99=5 s with 100 connections at 10 K req/s — the 1% slow tail pins all 100, blocking the 99% fast majority. Mitigations: hedged requests, bulkheading (separate pool per tenant), `pool_wait_seconds` SLO alerts that fire before exhaustion.

**Follow-up to expect:** Hedged request cost? Answer: double upstream load for the hedged fraction — hedge only when local latency exceeds a threshold ("no response in 50 ms → send a second"). Doubles load for the slowest 5%, not all. Dean's "The Tail at Scale" is canonical.

---

### Q24. Multi-tier pool design: small/medium/large buffers.

**Short answer:** One pool for variable sizes triggers the buffer-size trap. Fix at scale: **size-segregated pools** — one per size class, each storing only buffers in its band. Callers pick by size; oversize bypasses pooling.

```go
var (
    small  = &sync.Pool{New: func() any { b := make([]byte, 0, 1<<10);   return &b }}
    medium = &sync.Pool{New: func() any { b := make([]byte, 0, 16<<10);  return &b }}
    large  = &sync.Pool{New: func() any { b := make([]byte, 0, 256<<10); return &b }}
)

func Get(size int) *[]byte {
    switch {
    case size <= 1<<10:   return small.Get().(*[]byte)
    case size <= 16<<10:  return medium.Get().(*[]byte)
    case size <= 256<<10: return large.Get().(*[]byte)
    default:
        b := make([]byte, 0, size)
        return &b
    }
}

func Put(b *[]byte) {
    c := cap(*b); *b = (*b)[:0]
    switch {
    case c <= 1<<10:   small.Put(b)
    case c <= 16<<10:  medium.Put(b)
    case c <= 256<<10: large.Put(b)
    // else: drop
    }
}
```

This is what TCMalloc, jemalloc, and Go's allocator do internally — size classes. Pick 3–5 tiers, log-scale spacing. A staff candidate wraps `Get(size)` in a `Bytes(size)` helper returning slice + `Release` — call site is one line, size-class logic invisible.

**Follow-up to expect:** What does `fasthttp` do? Answer: `valyala/fasthttp` uses size-bucketed pools for everything — bodies, headers, hash buckets. Aggressive end-of-spectrum. Companion library `bytebufferpool` is the idiomatic reference.

---

### Q25. Expensive `Reset` — what do you do?

**Short answer:** Sometimes resetting is non-trivial — clearing N hash keys, nilling pointers so GC can reclaim, zeroing an embedded buffer for security. If `Reset` approaches `New`, the pool's benefit collapses. Three responses: (1) **Amortize** — clear lazily on `Get`, only the parts you'll use; tombstone-mark and check on read. (2) **Generation counters** — give the object `gen int64`, bump on `Put`; borrowers carry the gen; reads check `if entry.gen != current.gen { entry = zero }`. Reset becomes O(1); per-access check costs a load. (3) **Stop pooling that object** — if cost is irreducible and approaches `New`, the pool is debt; drop it. Senior signal is recognizing option 3 exists.

Staff framing: "every pooled object pays a reset tax. If the tax exceeds the savings, the pool is a memorial to good intentions."

**Follow-up to expect:** Security-sensitive zeroing? Answer: separate problem. A buffer holding a password must be zeroed before returning, or the next borrower may `String()` it and log it. Explicit `for i := range b { b[i] = 0 }` usually suffices. Zeroing is part of reset cost — sometimes pooling crypto state is the wrong call.

---

## 6. Live-coding prompts

### Prompt 1: Typed buffer pool with size cap

**Problem.** Implement `BufferPool` wrapping `sync.Pool` for `*bytes.Buffer`. Provide `Get()`, `Put()`. `Put` resets and discards capacity > 64 KB. Provide a `Borrow` helper returning the buffer and a release function for `defer release()`.

**Answer.**

```go
package bufpool

import (
    "bytes"
    "sync"
)

// maxCap: largest buffer we keep. Bigger ones get dropped so the pool
// doesn't accumulate huge backing arrays. 64 KB = encoding/json's
// heuristic — fits typical responses, 1000 cached stays at 64 MB.
const maxCap = 64 << 10

type BufferPool struct{ p sync.Pool }

func New() *BufferPool {
    return &BufferPool{p: sync.Pool{New: func() any { return new(bytes.Buffer) }}}
}

func (bp *BufferPool) Get() *bytes.Buffer {
    b := bp.p.Get().(*bytes.Buffer)
    // Reset on Get is panic-tolerant: a caller that skips Put still
    // leaves the pool with clean state for the next borrower.
    b.Reset()
    return b
}

func (bp *BufferPool) Put(b *bytes.Buffer) {
    if b == nil || b.Cap() > maxCap { return }
    bp.p.Put(b)
}

// Borrow + release: idiomatic Go. Caller writes `defer release()`
// and can't forget to Put.
func (bp *BufferPool) Borrow() (*bytes.Buffer, func()) {
    b := bp.Get()
    return b, func() { bp.Put(b) }
}

// Example:
//   buf, release := pool.Borrow(); defer release()
//   buf.WriteString("hello "); buf.WriteString(name)
//   return buf.String() // String copies; safe to release.
```

Senior moves: `Reset()` in `Get` (panic-tolerant); cap named and commented; `Borrow` returns release so the call site is one `defer`; `b.String()` is safe after release because `String` copies — knowing which `bytes.Buffer` methods alias (`Bytes`, `Next`) and which don't is part of the job.

---

### Prompt 2: Generic connection pool with health check

**Problem.** Implement `ConnPool[C]` generic over a connection type with `Close() error` and `Ping() error`. Fixed pool size at construction. `Get(ctx)` returns a connection or `ctx.Err()`; failed `Ping` → close and create new. `Put` returns unless the pool is full, in which case `Close`. Show graceful shutdown.

**Answer.**

```go
package connpool

import (
    "context"
    "errors"
    "sync"
)

// Conn: narrow interface — pool doesn't care what the connection does,
// only that it can be checked and closed. App layer adds Query/Exec.
type Conn interface {
    Ping() error
    Close() error
}

type ConnPool[C Conn] struct {
    factory func() (C, error)
    pool    chan C
    mu      sync.Mutex
    closed  bool
}

func New[C Conn](size int, factory func() (C, error)) *ConnPool[C] {
    return &ConnPool[C]{factory: factory, pool: make(chan C, size)}
}

var ErrClosed = errors.New("connpool: pool is closed")

func (p *ConnPool[C]) Get(ctx context.Context) (C, error) {
    var zero C
    p.mu.Lock()
    if p.closed { p.mu.Unlock(); return zero, ErrClosed }
    p.mu.Unlock()
    select {
    case c := <-p.pool:
        // Health-check before handing out — a stale conn here causes
        // a confusing error five layers deeper at query time.
        if err := c.Ping(); err != nil { _ = c.Close(); return p.factory() }
        return c, nil
    case <-ctx.Done():
        return zero, ctx.Err()
    default:
        // Pool empty. Production pools enforce max_total here.
        return p.factory()
    }
}

func (p *ConnPool[C]) Put(c C) {
    p.mu.Lock()
    if p.closed { p.mu.Unlock(); _ = c.Close(); return }
    p.mu.Unlock()
    select {
    case p.pool <- c:
    default:
        _ = c.Close() // full — close instead of leaking
    }
}

func (p *ConnPool[C]) Close() error {
    p.mu.Lock()
    if p.closed { p.mu.Unlock(); return ErrClosed }
    p.closed = true
    close(p.pool)
    p.mu.Unlock()
    var firstErr error
    for c := range p.pool {
        if err := c.Close(); err != nil && firstErr == nil { firstErr = err }
    }
    return firstErr
}
```

Senior moves: narrow `Conn` interface; borrow-side health check surfaces failures at the pool layer not the query; context-aware `Get` honors caller deadlines; `Put` closes on full pool instead of silently leaking; comments name the production gaps left out (`max_total`, retries, metrics) so the interviewer knows you know.

---

### Prompt 3: Worker pool with graceful shutdown

**Problem.** Build a `WorkerPool` running N goroutines processing `Job func(ctx) error`. `Submit(job)` blocks if the queue is full. `Shutdown(ctx)` stops accepting new jobs, waits for in-flight work, returns the first error.

**Answer.**

```go
package workerpool

import (
    "context"
    "errors"
    "sync"
)

type Job func(ctx context.Context) error

type WorkerPool struct {
    jobs     chan Job
    wg       sync.WaitGroup
    mu       sync.Mutex
    closed   bool
    firstErr error
    ctx      context.Context
    cancel   context.CancelFunc
}

// queueSize controls backpressure: small = Submit blocks quickly
// (signal upstream); large = hides pressure until OOM. Default ~= workers*2.
func New(workers, queueSize int) *WorkerPool {
    ctx, cancel := context.WithCancel(context.Background())
    p := &WorkerPool{jobs: make(chan Job, queueSize), ctx: ctx, cancel: cancel}
    for i := 0; i < workers; i++ { p.wg.Add(1); go p.worker() }
    return p
}

func (p *WorkerPool) worker() {
    defer p.wg.Done()
    for job := range p.jobs {
        if err := job(p.ctx); err != nil {
            p.mu.Lock()
            // First error only — later ones are usually consequences.
            if p.firstErr == nil { p.firstErr = err }
            p.mu.Unlock()
        }
    }
}

var ErrPoolClosed = errors.New("workerpool: closed")

func (p *WorkerPool) Submit(job Job) error {
    p.mu.Lock()
    if p.closed { p.mu.Unlock(); return ErrPoolClosed }
    p.mu.Unlock()
    p.jobs <- job // blocking is the backpressure
    return nil
}

func (p *WorkerPool) Shutdown(ctx context.Context) error {
    p.mu.Lock()
    if p.closed { p.mu.Unlock(); return ErrPoolClosed }
    p.closed = true
    close(p.jobs)
    p.mu.Unlock()
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-ctx.Done():
        // Deadline hit — cancel workers' ctx so they abort.
        // Jobs ignoring ctx.Done still hang; that's a job bug.
        p.cancel()
        <-done
    }
    p.mu.Lock()
    defer p.mu.Unlock()
    return p.firstErr
}
```

Senior moves: queue size is a documented backpressure knob; only the first error kept (`errors.Join` of 100 cancelled-ctx errors is noise); `Shutdown` honors a deadline and cancels worker ctx on timeout; the contract "jobs must respect ctx.Done" is named (a job that ignores it hangs shutdown); `Submit`'s `ErrPoolClosed` lets HTTP handlers return 503 instead of blocking on a closed channel.

---

## 7. Concept checks

If you can't answer these in one breath, study more.

- `sync.Pool` vs channel-based pool? (`sync.Pool`: unbounded, evicts at GC, lock-free per-P. Channel: bounded, no eviction, shared lock.)
- Why does `sync.Pool` clear during GC? (Opportunistic retention; pool is a hint.)
- Per-P architecture? (One cache per processor; lock-free local fast path; shared/steal slow path.)
- Why `Reset()`? (Object carries previous state; using it without reset corrupts both outputs.)
- Buffer-size trap? (Growable buffer that gets large once stays large forever. Cap on Put.)
- Why not pool DB connections in `sync.Pool`? (No size cap, GC eviction, no health check.)
- Victim cache? (Secondary list populated by GC; objects survive one extra cycle.)
- When does `Get()` allocate? (GC clear, first call on P, contention loss, assertion escape, expensive `New`.)
- Healthy hit rate? (>95% steady, >80% spikes. <50% = debt.)
- How do you benchmark a pool? (With/without, `allocs/op` `B/op` `ns/op`, `RunParallel` for per-P benefit.)
- `GOMEMLIMIT` and pools? (More GC = more clears = lower hit rate. Set with headroom.)
- Pooling structs with maps? (Inner allocations don't reset themselves; clear keys / truncate slices on Put.)
- Little's law for sizing? (`N = QPS * holding_time * safety`. Below = wait; above = waste.)
- Health-check on borrow or return? (Both. Borrow catches stale before caller; return skips broken from re-entry.)
- Worker pool vs object pool? (Goroutines on a channel vs N stored objects. Same word, different patterns.)

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **Pooling without benchmarking.** Adds `sync.Pool` because "it should be faster" with no `-benchmem` numbers.
- **`Reset()` forgotten.** Writes to a pooled buffer without reset; no recognition the next borrower inherits the data.
- **Caller keeps a reference past `Put`.** Returns `buf.Bytes()` without copying, then `Put`s. Classic data race.
- **`sync.Pool` for connections.** No acknowledgment of eviction, size cap, or health check. Hasn't run a real pool.
- **No `New` function.** Expects `Get` to return non-nil from `sync.Pool{}`. Hasn't read the docs.
- **No cap on growable buffers.** Pools `*bytes.Buffer` without `Cap()` check on Put.
- **"Pools are free."** No mention of reset, type-assertion, contention, or hit-rate measurement.
- **Pooling tiny objects.** Wraps `sync.Pool` around an 8-byte struct; pool overhead exceeds allocation cost.
- **No GC interaction.** Doesn't know the pool clears. Hasn't read `pool.go`.
- **One pool for all sizes.** No size-class segregation for variable-size buffers.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Brings numbers, not opinions.** "Profiled, allocs/op dropped from 12 to 1, p99 dropped 8 ms."
- **Picks `sync.Pool` vs typed pool deliberately.** Names when each wins and the trade-off.
- **Reset lives at `Get`** — or wraps `Borrow` to enforce the contract. Recognizes panics-skip-Put.
- **Caps buffer size on `Put`.** Unprompted mention of the trap and the 64 KB threshold.
- **Walks through `sync.Pool` internals.** Per-P locals, victim cache, lock-free fast path.
- **Names Little's law for sizing.** `N = QPS * latency * safety`; doesn't pull numbers from the air.
- **Hit-rate metric.** Instruments hits, misses, ratio. Knows the pool is invisible without metrics.
- **Size-segregated pools at scale.** Tiered pools for variable sizes; references `bytebufferpool`.
- **Acknowledges removal as valid.** Mentions pools they wrote that got removed when benchmarks didn't justify them.
- **Distinguishes worker pool from object pool.** Different problems with the same name.

---

## 10. Further reading

- **`sync/pool.go` source**: <https://cs.opensource.google/go/go/+/refs/tags/go1.22.0:src/sync/pool.go> — canonical implementation, ~300 lines including the victim cache. Read once.
- **`encoding/json` encoder pool**: <https://cs.opensource.google/go/go/+/refs/tags/go1.22.0:src/encoding/json/encode.go> — production `sync.Pool` with size-cap-on-Put.
- **Vincent Blanchon, *Go: Understand the Design of `sync.Pool`***: <https://medium.com/a-journey-with-go/go-understand-the-design-of-sync-pool-2dde3024e277> — clearest walkthrough of per-P architecture and victim cache.
- **`valyala/bytebufferpool`**: <https://github.com/valyala/bytebufferpool> — production size-class buffer pool from the `fasthttp` ecosystem.
- **Dean & Barroso, *The Tail at Scale***: <https://research.google/pubs/the-tail-at-scale/> — required reading for pool sizing under tail latency.
