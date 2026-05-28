# Object Pool Pattern — Specification

## 1. Origins

The Object Pool pattern was canonised in *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides, 1994) under the broader heading of object-management techniques:

> "Manage the reuse of objects whose creation is expensive or whose number must be bounded, by holding a set of initialised instances ready for use and returning them to the pool when the client is finished."

Historical predecessors:

- **Smalltalk MemoryPool (1980s)** — early Smalltalk-80 systems pre-allocated object headers in slabs to amortise GC pressure; the idea of "pre-built objects ready for reuse" pre-dates GoF by a decade.
- **Bonwick's SLAB allocator (1994)** — Jeff Bonwick's *The Slab Allocator: An Object-Caching Kernel Memory Allocator* (USENIX 1994) introduced the kernel-level model of caching same-size objects with constructor/destructor hooks. The SLAB design directly inspired modern object pools in user-space runtimes.
- **Apache Commons Pool (2001)** — Java's `commons-pool` library codified Borrow/Return semantics, eviction policies, and `PooledObjectFactory` interfaces; many JDBC and HTTP-client pools wrap it.
- **Microsoft .NET ObjectPool (2003)** — `System.Collections.ObjectPool<T>` ships with ASP.NET Core; the API (`Get`, `Return`) and the per-thread fast path mirror what Go would later adopt.
- **C++ memory arenas and slab allocators (1990s–)** — game engines and high-frequency-trading systems have used object pools and arena allocators continuously since pointer-based languages had GCs to escape.

Go-specific history:

- **`database/sql.DB` connection pool (Go 1.0, 2012)** — the first first-class pool in the standard library; bounded, health-checked, configurable via `SetMaxOpenConns`/`SetMaxIdleConns`.
- **`sync.Pool` (Go 1.3, 2014)** — Dmitry Vyukov's design landed a GC-aware per-P object cache aimed at request-scoped buffers. The package documentation explicitly states it is a *hint*, not a guarantee.
- **`sync.Pool` per-P locals reworked (Go 1.13, 2019)** — the victim-cache mechanism replaced the previous "drop everything at GC" behaviour, surviving one GC cycle before eviction; latency improved measurably for hot pools.
- **Generics-typed pools (Go 1.18+, 2022)** — `Pool[T]` wrappers built atop `sync.Pool` eliminated the `.(*T)` type assertion; libraries such as `bytedance/gopkg` and internal Google packages shipped generic pool helpers.
- **Arena experiment (Go 1.20, 2023, experimental)** — `arena` package proposed bulk allocation with explicit `Free`; design moved towards `runtime/metrics` and the `weak` package experiments rather than landing in stable Go.

Go's idiom is plural: `sync.Pool` covers transient GC-friendly objects; channel-based pools cover bounded scarce resources; `database/sql.DB` is the reference for connection pools. Choosing the right shape is the senior skill.

---

## 2. Go language mechanics

### 2.1 `sync.Pool` semantics (Get/Put/New)

`sync.Pool` exposes three operations: `Get() any`, `Put(any)`, and the `New func() any` factory field. `Get` either returns a cached object (fast path) or invokes `New` when the pool is empty (slow path). `Put` returns an object for reuse; the pool may discard it at the next GC.

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    // ... use buf ...
}
```

The pool is a *hint*. Calling `Put` does not guarantee the next `Get` returns the same object; the runtime may evict at any GC. Code must assume `New` can run on every call.

### 2.2 GC eviction

`sync.Pool` cooperates with the garbage collector via a `runtime_registerPoolCleanup` hook. At each GC cycle, the pool's local caches are demoted into a *victim cache*; if the victim is not consumed before the next GC, it is dropped. The two-cycle survival window (added in Go 1.13) prevents thrashing for pools that are touched once per request.

The implication: pooled objects must be reclaimable at any moment. Resources requiring explicit lifecycle (connections, file descriptors, kernel handles) are unsuitable for `sync.Pool`.

### 2.3 Per-P locals (lock-free fast path)

Internally, `sync.Pool` maintains a `poolLocal` array indexed by P (logical processor). Each `poolLocal` has a private slot and a shared queue. `Get` first checks its P's private slot (no atomic op), then the shared queue (atomic), then steals from other Ps (atomic with retry), and finally calls `New`.

```text
Get fast path : load private slot      (no synchronisation)
Get medium    : pop from shared head   (CAS)
Get slow      : steal from another P   (CAS loop)
Get fallback  : call New
```

Under uncontended load, `Get`/`Put` cost a few nanoseconds — comparable to a function call. This is what makes `sync.Pool` competitive with raw allocation for hot loops.

### 2.4 Typed pools via generics (Go 1.18+)

The pre-generics API forces a type assertion at every `Get`. Generics let libraries wrap `sync.Pool` into a typed front:

```go
type Pool[T any] struct {
    p sync.Pool
}

func New[T any](factory func() *T) *Pool[T] {
    return &Pool[T]{p: sync.Pool{New: func() any { return factory() }}}
}

func (p *Pool[T]) Get() *T  { return p.p.Get().(*T) }
func (p *Pool[T]) Put(v *T) { p.p.Put(v) }
```

The assertion still happens at runtime; generics only move it out of caller code. The pool stores `any` because the underlying `sync.Pool` is monomorphic.

### 2.5 chan-based pools for connections

For bounded resources (database connections, gRPC channels, file handles), a buffered channel is the idiomatic structure. `len(ch)` is the in-pool count; `cap(ch)` is the maximum; `select` provides non-blocking semantics.

```go
type ConnPool struct {
    pool chan *Conn
    new  func() (*Conn, error)
}

func (p *ConnPool) Get(ctx context.Context) (*Conn, error) {
    select {
    case c := <-p.pool:   return c, nil
    case <-ctx.Done():    return nil, ctx.Err()
    }
}
```

The channel guarantees strict reuse — no GC eviction, no random discard. Closing the channel signals shutdown.

---

## 3. Canonical Go shapes

### 3.1 `sync.Pool` with `bytes.Buffer`

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func format(v any) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    fmt.Fprint(buf, v)
    return buf.String() // copies; safe to release the buf
}
```

The most common shape. `Reset` keeps the backing array; the caller must not retain `buf.Bytes()` after `Put`.

### 3.2 `sync.Pool` with size cap on Put

```go
const maxBuf = 64 << 10 // 64 KB

func putBuf(b *bytes.Buffer) {
    if b.Cap() > maxBuf {
        return // drop oversize buffer; let GC reclaim
    }
    b.Reset()
    bufPool.Put(b)
}
```

Without the cap, a single 50 MB request grows a pooled buffer permanently; the pool's resident memory grows unboundedly. `encoding/json` and `klauspost/compress` both implement this guard.

### 3.3 `chan T` connection pool

```go
type Pool struct {
    pool    chan *Conn
    factory func() (*Conn, error)
    cap     int
}

func (p *Pool) Put(c *Conn) {
    select {
    case p.pool <- c:
    default:
        c.Close() // pool full; discard
    }
}
```

Strict, bounded, no GC eviction. Used for connections, sessions, and any resource where re-creation is expensive enough to justify the bookkeeping.

### 3.4 Worker goroutine pool

```go
type WorkerPool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func New(n int) *WorkerPool {
    p := &WorkerPool{jobs: make(chan func(), n*4)}
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for f := range p.jobs {
                f()
            }
        }()
    }
    return p
}

func (p *WorkerPool) Submit(f func()) { p.jobs <- f }
```

The pooled "object" is the goroutine itself. Bounds concurrency, reuses goroutine stacks, gives backpressure for free.

### 3.5 Generic typed pool

```go
type Typed[T any] struct {
    pool sync.Pool
}

func NewTyped[T any](factory func() *T) *Typed[T] {
    return &Typed[T]{pool: sync.Pool{New: func() any { return factory() }}}
}

func (p *Typed[T]) Get() *T  { return p.pool.Get().(*T) }
func (p *Typed[T]) Put(v *T) { p.pool.Put(v) }
```

Removes the `.(*T)` cast from call sites. The assertion still runs but is hidden behind a single, audited helper.

---

## 4. Standard library use

### 4.1 `encoding/json` encoder pool

`encoding/json` pools its `*encodeState` to reuse the underlying `bytes.Buffer`:

```go
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

A cap on the buffer size guards against keeping multi-megabyte JSON responses resident.

### 4.2 `fmt` printer pool

`fmt` keeps a `*pp` printer in a `sync.Pool`:

```go
var ppFree = sync.Pool{
    New: func() any { return new(pp) },
}

func newPrinter() *pp {
    p := ppFree.Get().(*pp)
    p.panicking = false
    p.erroring = false
    p.wrapErrs = false
    p.fmt.init(&p.buf)
    return p
}
```

Every `fmt.Sprintf`, `fmt.Fprintf`, and `fmt.Println` hits this pool. Without it, formatted printing would allocate a printer struct per call.

### 4.3 `bufio` Reader/Writer pool

`net/http` and `database/sql` both pool `*bufio.Reader` and `*bufio.Writer` to reuse the 4 KB internal buffers across requests:

```go
var bufioReaderPool sync.Pool

func newBufioReader(r io.Reader) *bufio.Reader {
    if v := bufioReaderPool.Get(); v != nil {
        br := v.(*bufio.Reader)
        br.Reset(r)
        return br
    }
    return bufio.NewReader(r)
}
```

The `Reset(r)` rebinds the buffer to a new source without reallocating the underlying byte slice.

### 4.4 `net/http` internal pools

The `net/http` package maintains multiple pools: response writers, transfer headers, gzip readers, chunked-encoding writers. The server's per-connection lifecycle is heavily pooled to keep request-handling allocations near zero on the steady state.

### 4.5 `database/sql.DB` connection pool

`*sql.DB` is itself a connection pool, configurable via:

```go
db.SetMaxOpenConns(50)
db.SetMaxIdleConns(10)
db.SetConnMaxIdleTime(5 * time.Minute)
db.SetConnMaxLifetime(time.Hour)
```

Implementation uses a slice of idle connections plus a channel-based request queue. Connections are health-checked (driver-specific `Ping`), retired after `ConnMaxLifetime`, and bounded by `MaxOpenConns`. This is the reference pool design for scarce, expensive resources.

---

## 5. Real library use

### 5.1 `jackc/pgx` connection pool

`github.com/jackc/pgx/v5/pgxpool` ships a PostgreSQL-specific pool with health checks, lazy connection setup, and `Acquire`/`Release` semantics:

```go
pool, _ := pgxpool.New(ctx, dsn)
conn, _ := pool.Acquire(ctx)
defer conn.Release()
```

Tunables include `MaxConns`, `MinConns`, `HealthCheckPeriod`, and `MaxConnLifetimeJitter` for staggered renewal. `pgxpool` is the most-cited Go connection pool outside `database/sql`.

### 5.2 `valyala/fasthttp` request pools

`fasthttp` pools nearly every object it touches: `*Request`, `*Response`, `*RequestCtx`, header parsers, body buffers. The package documentation states bluntly that the API is shaped around pool semantics — callers must not retain references after the handler returns:

```go
var requestPool sync.Pool
var responsePool sync.Pool

func AcquireRequest() *Request {
    v := requestPool.Get()
    if v == nil { return &Request{} }
    return v.(*Request)
}

func ReleaseRequest(req *Request) {
    req.Reset()
    requestPool.Put(req)
}
```

This is why `fasthttp` benchmarks an order of magnitude lower allocations per request than `net/http`.

### 5.3 `klauspost/compress` buffer pools

`klauspost/compress` (the high-performance gzip/zstd/snappy fork) pools encoder workspaces and decompression buffers. For zstd, the encoder state can be several megabytes; without pooling, each `NewWriter` would allocate that anew.

### 5.4 `go-redis` connection pool

`github.com/redis/go-redis/v9` uses a chan-based pool with idle timeouts:

```go
client := redis.NewClient(&redis.Options{
    Addr:         "localhost:6379",
    PoolSize:     50,
    MinIdleConns: 10,
    PoolTimeout:  4 * time.Second,
    ConnMaxIdleTime: 5 * time.Minute,
})
```

The pool wraps the TCP connection with the RESP protocol state machine; misuse (returning a connection mid-pipeline) is detected and the connection is discarded.

### 5.5 `protobuf-go` message pools

`google.golang.org/protobuf` exposes optional message reuse via `proto.Reset` and recommends pooling for hot decode paths. gRPC's transport layer pools `*http2.Framer` workspaces and the protobuf marshalling buffers to keep per-RPC allocations bounded.

---

## 6. Formal specification

A Go Object Pool consists of:

| Element | Description |
|---------|-------------|
| **Pool** | Container holding zero or more idle objects ready for reuse. |
| **Borrow** (`Get`/`Acquire`) | Operation returning a usable object; allocates via factory on miss. |
| **Return** (`Put`/`Release`) | Operation surrendering an object back to the pool. |
| **Reset hook** | Function clearing an object's state before reuse (or before `Put`). |
| **Size cap** | Upper bound on idle count or per-object size beyond which Return drops the object. |
| **Factory** (`New`) | Constructor invoked when the pool is empty. Must produce a usable zero-state object. |
| **Lifecycle hooks** | Optional `OnEvict`, `OnHealthCheck`, `OnClose` for resource-owning pools. |

**Invariants:**

1. After `Get` returns, the caller has exclusive ownership of the object until `Put`. No other goroutine may observe or mutate it. Violating exclusivity is a data race.
2. After `Put`, the caller must not read, write, or retain a reference to the returned object. The pool may hand it to another goroutine immediately.
3. `New` (the factory) must produce an object that is safe to use without further initialisation. If `New` returns a partially constructed object, every `Get` consumer must repeat the missing setup — defeating the pool's purpose.
4. `sync.Pool` may return `nil` from `Get` only if `New` is unset. With `New` set, `Get` always returns a non-nil object.
5. A pooled object's state at `Put` time must be reachable to the state at fresh-from-`New` time via `Reset`. If reset is impossible, the object is not poolable.

---

## 7. Anti-patterns

### 7.1 Pooling cheap objects

```go
var intPool = sync.Pool{New: func() any { return new(int) }}
```

An `int` allocation is a few nanoseconds; `sync.Pool.Get` is also a few nanoseconds. Pooling integers (or any value small enough to fit in a CPU cache line and cheaper to allocate than to fetch) is a wash or a regression. **Fix:** benchmark before introducing the pool; if `BenchmarkWithPool` is not measurably faster than `BenchmarkNoPool`, delete the pool.

### 7.2 Forgotten Reset

```go
buf := bufPool.Get().(*bytes.Buffer)
defer bufPool.Put(buf)
buf.WriteString("hello") // previous content still there
```

The buffer contains whatever the previous borrower left. The next response is `<old-content>hello`. **Fix:** `buf.Reset()` on `Get` or on `Put` — pick one location and enforce it everywhere.

### 7.3 Reference after Put (race)

```go
buf := bufPool.Get().(*bytes.Buffer)
go func() { log.Print(buf.String()) }() // buf may already be in another goroutine
bufPool.Put(buf)
```

Once `Put` runs, the buffer is owned by the pool — and potentially by the next `Get` caller. The logging goroutine races with the new owner. **Fix:** copy the data before `Put`; never let pointers escape the borrow scope.

### 7.4 `sync.Pool` for connections

```go
var connPool = sync.Pool{New: func() any { return dial() }}
```

`sync.Pool` evicts during GC. A 50 ms TCP handshake re-runs on every dropped connection. The pool also has no size cap, no health check, no idle timeout. **Fix:** use a `chan *Conn` with explicit bounds, or `database/sql.DB`, or a library like `pgxpool` or `go-redis`.

### 7.5 No size cap (memory bloat)

```go
func putBuf(b *bytes.Buffer) {
    bufPool.Put(b) // no cap check
}
```

A single 100 MB request inflates one pooled buffer. The runtime keeps that buffer alive across GCs (via the victim cache or active use). Multiplied across Ps, the pool retains hundreds of MB. **Fix:** drop oversize objects on `Put`; let the GC reclaim them.

### 7.6 Per-request pool variable

```go
func handler(w http.ResponseWriter, r *http.Request) {
    pool := sync.Pool{New: func() any { return new(bytes.Buffer) }}
    // ...
}
```

A fresh pool per request defeats the point — there is never anything cached. Pools must be package-level (or struct-field-level on a long-lived service) to accumulate reusable objects. **Fix:** hoist the pool to a `var` outside the handler.

### 7.7 Pooling value types instead of pointers

```go
var pool = sync.Pool{New: func() any { return bytes.Buffer{} }} // value, not pointer
```

`sync.Pool` boxes the value into `any`, allocating on every `Put` and `Get`. The allocation that pooling was meant to eliminate now happens twice per use. **Fix:** always pool pointers — `*bytes.Buffer`, `*Request`, `*encodeState`.

---

## 8. Variants and dialects

| Variant | Description |
|---------|-------------|
| **sync.Pool** | Per-P, GC-evictable, hint-based; for transient request-scoped objects. |
| **chan-based** | Bounded buffered channel, strict reuse; for connections and worker slots. |
| **Slab** | Same-size objects pre-allocated in contiguous regions, no GC interaction; rare in Go but used in cgo bridges. |
| **Arena** | Bulk allocation freed in one operation; experimental in Go, common in C++ and game engines. |
| **Worker pool** | Reusable goroutines reading jobs from a channel; bounds concurrency. |
| **Connection pool** | Resource handles with health checks, idle timeouts, max-lifetime — `database/sql.DB`, `pgxpool`, `go-redis`. |

---

## 9. Naming conventions

- **Type names:** `Pool`, `BufferPool`, `ConnPool`, `WorkerPool` — suffix-`Pool` is idiomatic.
- **Borrow/Return verbs:** standard library uses `Get`/`Put`; resource pools prefer `Acquire`/`Release` (pgx, fasthttp) or `Borrow`/`Return` (commons-pool legacy). Pick one pair per package; do not mix.
- **Factory field:** `New func() T` for `sync.Pool` compatibility; `Factory` or `Dial` for connection pools.
- **Reset method:** `Reset()` is universal — `bytes.Buffer.Reset`, `bufio.Reader.Reset`, `http.Request.Reset` (in `fasthttp`).
- **Close method:** `Close()` for pools owning resources; releases all idle objects and signals shutdown.
- **Capacity/limit:** `Size`, `MaxOpenConns`, `MaxIdleConns`, `PoolSize`, `MinIdleConns` — domain-flavoured but always nouns.
- **Acquire helpers:** `AcquireRequest`, `AcquireResponse` (fasthttp); `Get` for `sync.Pool` wrappers.

---

## 10. Related patterns

| Pattern | Distinction |
|---------|-------------|
| **Singleton** | One shared instance for the program lifetime; Object Pool keeps many reusable instances, each borrowed by exactly one client at a time. |
| **Flyweight** | Shared immutable objects keyed by intrinsic state; Object Pool lends mutable objects exclusively then reclaims them. |
| **Factory** | Constructs new objects on demand; Object Pool reuses existing ones, falling back to a factory only on miss. |
| **Prototype** | Clones a template into a new instance; Object Pool recycles old instances rather than cloning. |
| **Resource Acquisition Is Initialisation (RAII)** | Bind resource lifetime to a scope; Object Pool's `defer Put(x)` is the Go equivalent of RAII over a borrowed resource. |
| **Memento** | Stores object state for later restoration; orthogonal to pooling — a memento might restore a pooled object's state. |

---

## 11. Further reading

- **GoF (1994)** — original Object Pool framing within the broader pattern catalogue.
- **`sync.Pool` source code** — `src/sync/pool.go` in the Go runtime; ~300 lines including the victim-cache logic.
- **Vincent Blanchon, *Go: Understand the Design of sync.Pool*** — definitive walkthrough of per-P locals and GC cooperation.
- **Jeff Bonwick, *The Slab Allocator: An Object-Caching Kernel Memory Allocator* (USENIX 1994)** — the SLAB paper; foundational reading for any object-cache design.
- **`jackc/pgx` documentation** — `pgxpool` package; reference connection-pool design in modern Go.
- **`valyala/fasthttp` source** — `request.go`, `response.go`, `bytesconv.go`; aggressive pooling throughout.
- **Little's Law overview** — `L = λW`; the queueing-theory result that bounds the pool size you need for a given throughput and hold time.
- **`database/sql` package documentation** — `SetMaxOpenConns`, `SetConnMaxLifetime`; the canonical Go connection-pool API.
- **`pkg.go.dev/sync#Pool`** — official documentation; reads the caveats carefully and updates with each release.

Object Pool in Go is a profiling-driven optimization. Senior skill is identifying the rare objects where pooling pays — and resisting the urge to pool everything else.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Pool** | Container of reusable objects, parameterised by a factory and (optionally) a size cap. |
| **Borrow** | Operation removing an object from the pool for exclusive caller use; spelled `Get` or `Acquire`. |
| **Return** | Operation surrendering a borrowed object back to the pool; spelled `Put` or `Release`. |
| **Reset** | Function restoring a pooled object's observable state to its zero-equivalent before reuse. |
| **Factory** | The `New` function the pool calls when its cache is empty; must produce a usable object. |
| **Size cap** | Bound on idle pool population or per-object size; oversize objects are dropped on `Put`. |
| **Per-P local** | `sync.Pool`'s per-processor cache enabling lock-free `Get`/`Put` under low contention. |
| **Victim cache** | Secondary cache in `sync.Pool` (Go 1.13+) that holds evicted items for one extra GC cycle. |
| **Pool hit/miss** | Hit: `Get` returned a cached object. Miss: `Get` invoked `New`. The hit rate measures pool effectiveness. |
| **Connection pool** | Bounded pool of network/database resources with health checks, idle timeouts, and lifetime limits. |
| **Worker pool** | Pool of long-running goroutines consuming jobs from a channel; reuses goroutine stacks and bounds concurrency. |
| **Slab/Arena** | Allocation strategies pooling same-size or bulk-allocated objects; outside `sync.Pool`'s remit but conceptually related. |
