# Object Pool — Optimization

## 1. How to use this file

Twelve scenarios where object-pool code is slower, allocates more, or wastes memory it didn't need to. Each entry has a **Scenario**, a **Before** (code + benchmark), and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT). Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them.

Pooling is the rare pattern where the wrong default does worse than no pattern at all. A pool adds ~5 ns per `Get`/`Put`, a `sync.Pool` may evict items every GC cycle, and a poorly-bounded pool can hold tens of MB indefinitely. The trade is one of: code clarity, memory ceiling, or generality. Make it only when a benchmark or a flame graph points at it. Reading order: Exercise 1 (should I pool?), then 2 and 8 (generics + cap), then 5 (sizing), then the rest.

---

## 2. Exercise 1 — No pool on a hot allocating path

A handler that builds a small response per request allocates a fresh `bytes.Buffer` every call. At 50k QPS the allocator and the GC do constant work to free memory the next request immediately re-allocates.

**Before:**

```go
func renderHello(w io.Writer, name string) {
    var buf bytes.Buffer
    buf.WriteString("hello, ")
    buf.WriteString(name)
    buf.WriteString("!\n")
    w.Write(buf.Bytes())
}
```

```
BenchmarkNoPool-8    20000000    78 ns/op    64 B/op    1 allocs/op
```

<details><summary>After</summary>

Pool the buffer. Reset on borrow, Put on return — first request allocates, every subsequent one reuses.

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func renderHello(w io.Writer, name string) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.WriteString("hello, ")
    buf.WriteString(name)
    buf.WriteString("!\n")
    w.Write(buf.Bytes())
}
```

```
BenchmarkPooled-8    100000000    14 ns/op    0 B/op    0 allocs/op
```

~5.6× faster, zero allocations on the steady-state path.

**Why faster:** No `mallocgc` per request. The backing array is reused. GC pressure drops — smaller mark phase, fewer write barriers.

**Trade-off:** `buf.Bytes()` is a slice into the pooled array — unsafe to read after `Put`. Write inside the borrow or copy out. `defer` adds ~2 ns; inline `Put` in the tightest loops.

**When NOT:** Below ~1k QPS the overhead and complexity buy nothing.
</details>

---

## 3. Exercise 2 — Untyped sync.Pool with type assertion on every Get

`sync.Pool.Get` returns `any`; the classic form casts `Get().(*T)` on every call. The cast is cheap (~1 ns) but it's a runtime check that can panic on misconfigured `New`, and it shows up as noise in benchmark histograms.

**Before:**

```go
var rawPool = sync.Pool{New: func() any { return &Encoder{} }}

func encode(v any) []byte {
    e := rawPool.Get().(*Encoder) // assertion every call
    defer rawPool.Put(e)
    e.Reset()
    return e.Encode(v)
}
```

```
BenchmarkUntypedPool-8    50000000    34 ns/op    0 B/op    0 allocs/op
```

<details><summary>After</summary>

Wrap `sync.Pool` in a generic typed pool. The cast is gone; the API is self-documenting.

```go
type Pool[T any] struct{ p sync.Pool }

func NewPool[T any](newFn func() *T) *Pool[T] {
    return &Pool[T]{p: sync.Pool{New: func() any { return newFn() }}}
}

func (p *Pool[T]) Get() *T  { return p.p.Get().(*T) }
func (p *Pool[T]) Put(v *T) { p.p.Put(v) }

var encPool = NewPool(func() *Encoder { return &Encoder{} })

func encode(v any) []byte {
    e := encPool.Get()
    defer encPool.Put(e)
    e.Reset()
    return e.Encode(v)
}
```

```
BenchmarkTypedPool-8    60000000    28 ns/op    0 B/op    0 allocs/op
```

~1.2× faster on Get/Put. More importantly, callers can no longer accidentally borrow the wrong type.

**Why faster:** The cast is monomorphized into a single inlinable site. Go 1.23 inlines `Pool[*Encoder].Get` and folds the type check.

**Trade-off:** Slight indirection. You still must call `Reset()` — generics don't enforce lifecycle. Keep the pool keyed on `*T`; pooling values defeats the purpose.

**When NOT:** Single-call-site pools — the wrapper is overkill for a one-function pool.
</details>

---

## 4. Exercise 3 — `make([]byte, 4096)` per request

A handler reads a small message into a 4 KB slice sized "big enough for almost all messages", allocated fresh per request.

**Before:**

```go
func handle(conn net.Conn) error {
    buf := make([]byte, 4096) // 4 KB, every request
    n, err := conn.Read(buf)
    if err != nil { return err }
    return process(buf[:n])
}
```

```
BenchmarkAllocSlice-8    5000000    230 ns/op    4096 B/op    1 allocs/op
```

<details><summary>After</summary>

Pool a `*[]byte` with a fixed cap. Use a pointer to a slice header so `sync.Pool`'s "stored as `any`" path doesn't box the slice header.

```go
var bytePool = sync.Pool{New: func() any { b := make([]byte, 4096); return &b }}

func handle(conn net.Conn) error {
    bp := bytePool.Get().(*[]byte)
    defer bytePool.Put(bp)
    buf := (*bp)[:4096] // restore full length
    n, err := conn.Read(buf)
    if err != nil { return err }
    return process(buf[:n])
}
```

```
BenchmarkPoolSlice-8    100000000    13 ns/op    0 B/op    0 allocs/op
```

~17× faster, zero per-request allocation.

**Why faster:** 4 KB sits at the page boundary where `mcache` falls back to the central allocator — the most expensive size class. Pooling eliminates that round-trip per request.

**Trade-off:** Store `*[]byte`, not the slice — boxing a slice header into `any` allocates a stubborn 24 B/op. Never grow past original cap before `Put`; a grown slice pins the larger backing array forever.

**When NOT:** Variable-size messages — use a per-power-of-two sized-class pool instead.
</details>

---

## 5. Exercise 4 — `bytes.Buffer.Reset()` when a slice would do

`bytes.Buffer` carries a `lastRead` field, an internal offset, and `io.Reader`/`io.Writer` boilerplate — overkill for a pure write-then-flush path.

**Before:**

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

type Batch struct{ Body *bytes.Buffer }

func (b *Batch) Append(line string) {
    b.Body.WriteString(line)
    b.Body.WriteByte('\n')
}

func reset(b *Batch) { b.Body.Reset() }
```

```
BenchmarkBufferReset-8    80000000    18 ns/op    0 B/op    0 allocs/op
```

<details><summary>After</summary>

Use raw `[]byte` and `b = b[:0]` to clear — keeps the backing array, length is zero, no `Buffer` overhead.

```go
type Batch struct{ Body []byte }

func (b *Batch) Append(line string) {
    b.Body = append(b.Body, line...)
    b.Body = append(b.Body, '\n')
}

func reset(b *Batch) { b.Body = b.Body[:0] }

var batchPool = sync.Pool{New: func() any {
    return &Batch{Body: make([]byte, 0, 4096)}
}}
```

```
BenchmarkSliceReset-8    300000000    4.6 ns/op    0 B/op    0 allocs/op
```

~3.9× faster on the reset path, and writes themselves are ~15% faster because `append` is one builtin instead of an interface-method-dispatched `WriteString`.

**Why faster:** `Buffer.Reset` does three field writes; `b = b[:0]` does one. `WriteString` has an extra empty-case branch; `append` doesn't.

**Trade-off:** Loses `io.Writer`/`io.Reader` compatibility. Reading requires tracking your own offset.

**When NOT:** Anything that streams through `io.Copy` or feeds `encoding/json` / `text/template` writers — keep the buffer.
</details>

---

## 6. Exercise 5 — Undersized `chan T` connection pool

A `chan *Conn` of size 8 looks reasonable on a laptop but under 200 concurrent requests with a 30 ms downstream call, 192 goroutines line up waiting for a slot.

**Before:**

```go
type Pool struct{ ch chan *Conn }

func New() *Pool { return &Pool{ch: make(chan *Conn, 8)} } // arbitrary

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    select {
    case c := <-p.ch: return c, nil
    case <-ctx.Done(): return nil, ctx.Err()
    }
}
```

```
BenchmarkChanPool8-8    300000    4800 ns/op   // p99 includes queue wait
```

<details><summary>After</summary>

Size with Little's Law: `L = λ × W`. For 200 req/s × 0.030 s = 6 in-flight; double for safety → cap 12. For 2000 req/s × 0.030 s = 60 → cap ~120.

```go
func New(arrivalsPerSec, serviceSec float64) *Pool {
    capacity := int(math.Ceil(arrivalsPerSec*serviceSec)) * 2 // peak headroom
    if capacity < 4 { capacity = 4 }
    return &Pool{ch: make(chan *Conn, capacity)}
}
```

```
BenchmarkChanPoolSized-8    5000000    240 ns/op   // no queue wait at target load
```

~20× faster on p99 latency — the queue wait disappears.

**Why faster:** Goroutines stop blocking at the receive. The channel absorbs spikes instead of serializing every request behind a tiny pool.

**Trade-off:** Bigger pools hold more idle sockets and may exceed downstream limits — cap to a hard ceiling. If service time itself is the bottleneck, fix the downstream; no pool sizing helps.

**When NOT:** Low-QPS callers (≤10 req/s) — cap of 4 is fine, bigger pools hold sockets the remote may close.
</details>

---

## 7. Exercise 6 — Unbuffered worker channel

An unbuffered job channel forces the producer to wait for a worker on every job — for short jobs the handshake is most of the cost.

**Before:**

```go
type Pool struct{ jobs chan func() }

func New(workers int) *Pool {
    p := &Pool{jobs: make(chan func())} // unbuffered
    for i := 0; i < workers; i++ {
        go func() { for f := range p.jobs { f() } }()
    }
    return p
}

func (p *Pool) Submit(f func()) { p.jobs <- f }
```

```
BenchmarkUnbufWorkers-8    2000000    580 ns/op    // 4 workers, 1µs job
```

<details><summary>After</summary>

Buffer the channel to `workers * 4` or so. The producer can stage several jobs without a handshake; workers pick from a small backlog with one acquire each.

```go
func New(workers int) *Pool {
    p := &Pool{jobs: make(chan func(), workers*4)}
    for i := 0; i < workers; i++ {
        go func() { for f := range p.jobs { f() } }()
    }
    return p
}
```

```
BenchmarkBufWorkers-8    8000000    140 ns/op
```

~4× faster Submit throughput.

**Why faster:** Unbuffered send forces wakeup-and-park per job. A small buffer lets producer enqueue in batches; no scheduler ping-pong.

**Trade-off:** Buffers mask slow workers — always cap. Larger buffers also delay shutdown; drain explicitly with a bounded wait.

**When NOT:** Latency-sensitive jobs (video frames). Buffering trades latency for throughput.
</details>

---

## 8. Exercise 7 — `interface{}` boxing on Get

Pre-generics pools returned `interface{}` and the caller cast back. Even with `any` (Go 1.18+) the API signature materializes an `eface`/`iface` pair per Put for non-pointer types.

**Before:**

```go
type Pool struct{ pool sync.Pool }
func (p *Pool) Get() any  { return p.pool.Get() }
func (p *Pool) Put(v any) { p.pool.Put(v) }
```

```
BenchmarkAnyPool-8    50000000    32 ns/op    0 B/op    0 allocs/op
```

0 B/op because `*bytes.Buffer` is a pointer — its iface fits in registers. Pool a value type and the box allocates.

<details><summary>After</summary>

Generics keep the `*T` type through the API. Pool body still stores `any` (sync.Pool's constraint), but user-visible methods are typed and inlined (see Exercise 2's `Pool[T]` definition).

```
BenchmarkTypedPool-8    60000000    25 ns/op    0 B/op    0 allocs/op
```

~1.3× faster, no callsite cast.

**Why faster:** Generics let the compiler inline `Put`'s `any(v)` when `T` is a pointer — no per-call iface materialization. `Get`'s cast folds into the caller.

**Trade-off:** `sync.Pool` doesn't support generic value types — pool `*T`, not `T`. The wrapper bakes that constraint into the API.

**When NOT:** Already-typed pools (your own `chan *Conn`) — they were never boxing.
</details>

---

## 9. Exercise 8 — Pool with no upper bound on item size

A pooled `bytes.Buffer` that grows to 4 MB during one outlier stays 4 MB forever — 1000 cached buffers × 4 MB = gigabytes pinned.

**Before:**

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func put(b *bytes.Buffer) {
    b.Reset()
    bufPool.Put(b)
}
```

```
BenchmarkPoolUncapped-8    50000000    18 ns/op    0 B/op    0 allocs/op
// memory: heap profile shows 4MB × N pinned in pool
```

<details><summary>After</summary>

Drop oversize items on return. The pool keeps "normal" buffers; outliers get released to the GC.

```go
const maxBufCap = 64 << 10 // 64 KiB

func put(b *bytes.Buffer) {
    if b.Cap() > maxBufCap {
        return // let GC reclaim
    }
    b.Reset()
    bufPool.Put(b)
}
```

```
BenchmarkPoolCapped-8    50000000    19 ns/op    0 B/op    0 allocs/op
// memory: heap profile stable at 64KB × pool size
```

Nearly identical CPU cost. Memory ceiling reduced by ~64×.

**Why faster (steady state):** Same ns/op for borrow/return — the win is working-set size. Smaller set means smaller mark phase, fewer L3 evictions, fewer page faults. On a memory-constrained host this is the difference between "OOM" and "fine".

**Trade-off:** A workload that normally needs 80 KB buffers will re-allocate. Tune `maxBufCap` to ~p99 of observed sizes. `encoding/json` uses 64 KiB as default.

**When NOT:** Fixed-class pools where every item is identical-size by construction.
</details>

---

## 10. Exercise 9 — `Get()` inside a hot loop

Borrowing per iteration of a tight loop pays pool overhead N times instead of once.

**Before:**

```go
func formatLines(out io.Writer, items []Item) {
    for _, it := range items {
        buf := bufPool.Get().(*bytes.Buffer)
        buf.Reset()
        buf.WriteString(it.Name)
        buf.WriteByte('\n')
        out.Write(buf.Bytes())
        bufPool.Put(buf)
    }
}
```

```
BenchmarkGetPerIter-8    100000    18000 ns/op    // 1000 items
```

<details><summary>After</summary>

Borrow once outside the loop. The single Reset replaces N Get/Put pairs.

```go
func formatLines(out io.Writer, items []Item) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    for _, it := range items {
        buf.Reset()
        buf.WriteString(it.Name)
        buf.WriteByte('\n')
        out.Write(buf.Bytes())
    }
}
```

```
BenchmarkGetOnce-8    400000    4200 ns/op
```

~4.3× faster on a 1000-item batch.

**Why faster:** Each `Get`/`Put` touches the per-P cache (5–10 ns). Doing it once saves ~10–20 ns × N.

**Trade-off:** Concurrent loops (`go ...`) need a borrow per goroutine — single-borrow form is a data race. Per-iteration borrow is correct for goroutine-per-item.

**When NOT:** Loops whose iterations write large outliers — holding one buffer for the whole loop pins the max size you ever wrote (Exercise 8).
</details>

---

## 11. Exercise 10 — New JSON encoder per call

`json.NewEncoder(w)` allocates an encoder struct, its scratch buffer, and an `*encodeState` per call — measurable at high request rates.

**Before:**

```go
func writeJSON(w io.Writer, v any) error {
    return json.NewEncoder(w).Encode(v)
}
```

```
BenchmarkJSONFresh-8    2000000    820 ns/op    480 B/op    7 allocs/op
```

<details><summary>After</summary>

Pool a `*bytes.Buffer` + a reusable encoder targeted at it. Marshal into the buffer; copy out (or stream to `w` and reset).

```go
type jsonScratch struct {
    buf *bytes.Buffer
    enc *json.Encoder
}

var jsonPool = sync.Pool{New: func() any {
    b := &bytes.Buffer{}
    return &jsonScratch{buf: b, enc: json.NewEncoder(b)}
}}

func writeJSON(w io.Writer, v any) error {
    s := jsonPool.Get().(*jsonScratch)
    defer func() {
        if s.buf.Cap() > 64<<10 { return } // cap on return
        s.buf.Reset(); jsonPool.Put(s)
    }()
    if err := s.enc.Encode(v); err != nil { return err }
    _, err := w.Write(s.buf.Bytes())
    return err
}
```

```
BenchmarkJSONPooled-8    10000000    310 ns/op    16 B/op    1 allocs/op
```

~2.6× faster, ~30× fewer bytes allocated per call (the remaining 16 B/op is `Encode`'s internal reflective state).

**Why faster:** Encoder struct, scratch slice, and buffer backing all survive across calls. Only small per-call bookkeeping is allocated fresh.

**Trade-off:** `Encode` appends a trailing newline — strip if unwanted. Cap-on-return is mandatory — one 2 MB payload pins 2 MB per slot. Don't share across goroutines.

**When NOT:** Streaming one large object per long-lived operation (export endpoints) — setup cost is dwarfed by I/O.
</details>

---

## 12. Exercise 11 — Acquire contention on a single pool

`sync.Pool` shards internally by P, but a *custom* `chan T` pool is a single channel — under heavy concurrency every Get takes a turn at the channel lock.

**Before:**

```go
type ConnPool struct{ ch chan *Conn }

func (p *ConnPool) Get() *Conn { return <-p.ch }
func (p *ConnPool) Put(c *Conn) { p.ch <- c }
```

```
BenchmarkSinglePool-8    2000000    580 ns/op   // 32 concurrent borrowers
```

<details><summary>After</summary>

Shard the pool by goroutine identity, route each `Get` to its shard. With 8 shards and 32 goroutines, contention drops to ~4-way per shard.

```go
const shards = 8

type ConnPool struct{ s [shards]chan *Conn }

// Cheap selector — locality, not perfect balance. Production uses
// runtime_procPin via assembly shim or a per-goroutine hash.
func shardIdx() int {
    var x int
    return int(uintptr(unsafe.Pointer(&x))>>4) & (shards - 1)
}

func (p *ConnPool) Get() *Conn { return <-p.s[shardIdx()] }
func (p *ConnPool) Put(c *Conn) {
    select {
    case p.s[shardIdx()] <- c:
    default: c.Close() // shard full
    }
}
```

```
BenchmarkShardedPool-8    20000000    62 ns/op
```

~9× faster under 32-way concurrent load.

**Why faster:** Each shard's lock is contended by ~`N/shards` goroutines. Cache lines stay on one CPU instead of bouncing across the bus.

**Trade-off:** Cross-shard mismatches (Put to A, Get from B) — borrowers create on miss. Shard count must be a power of two. Total size requires summing — no single counter.

**When NOT:** Low-concurrency callers (≤4 goroutines) — sharding adds bookkeeping that contention wasn't paying for.
</details>

---

## 13. Exercise 12 — `sync.Pool` object with a finalizer

A `runtime.SetFinalizer` on a pooled object is a contradiction: the pool keeps it reachable, the finalizer never runs, and the object spends every life on the GC's slow path.

**Before:**

```go
type Conn struct{ fd int }

func newConn() *Conn {
    c := &Conn{fd: openSocket()}
    runtime.SetFinalizer(c, func(c *Conn) { syscall.Close(c.fd) })
    return c
}

var pool = sync.Pool{New: func() any { return newConn() }}
```

```
BenchmarkPoolWithFinalizer-8    5000000    520 ns/op    72 B/op    1 allocs/op
```

<details><summary>After</summary>

Drop the finalizer. Use a real typed pool with explicit `Close`. `sync.Pool` is the wrong tool for anything with an FD.

```go
type ConnPool struct {
    mu   sync.Mutex
    idle []*Conn
    cap  int
}

func (p *ConnPool) Get() *Conn {
    p.mu.Lock(); defer p.mu.Unlock()
    if n := len(p.idle); n > 0 {
        c := p.idle[n-1]; p.idle = p.idle[:n-1]
        return c
    }
    return &Conn{fd: openSocket()}
}

func (p *ConnPool) Put(c *Conn) {
    p.mu.Lock()
    full := len(p.idle) >= p.cap
    if !full { p.idle = append(p.idle, c) }
    p.mu.Unlock()
    if full { syscall.Close(c.fd) }
}

func (p *ConnPool) Close() {
    p.mu.Lock(); defer p.mu.Unlock()
    for _, c := range p.idle { syscall.Close(c.fd) }
    p.idle = nil
}
```

```
BenchmarkPoolNoFinalizer-8    20000000    140 ns/op    0 B/op    0 allocs/op
```

~3.7× faster, no finalizer overhead, and FDs actually close at shutdown.

**Why faster:** Finalizers add ~50 ns per-allocation bookkeeping and force the object onto the GC's slow path. Explicit `Close` gives deterministic shutdown — finalizers don't run at program exit.

**Trade-off:** You must remember `defer pool.Close()`. For libraries embedded in unknown hosts, a single finalizer on the `*ConnPool` (not on each `*Conn`) is acceptable.

**When NOT:** Truly never — finalizers on pooled items are always wrong. Anything with an FD or cgo handle deserves a real typed pool, not `sync.Pool`.
</details>

---

## 14. When NOT to optimize

Most Go programs do not need a pool. The default allocator handles small short-lived objects efficiently; escape analysis places many on the stack. A handler at 100 req/s allocating a 256-byte struct generates 25 KB/s of garbage — noise. A CLI that runs once should never pool.

**Profile first.** Run `go test -bench=. -benchmem` and `pprof -alloc_objects`. If the suspect type isn't in the top 10 by allocation count *and* not a CPU bottleneck, leave it alone.

**Common premature optimizations:** pooling structs ≤256 bytes (the allocator wins), pooling objects used once per program lifetime, pooling without `Reset` (a correctness bug, not a perf win), pooling with no cap (Exercise 8), sharding (Exercise 11) under low contention, and putting back a connection whose health you didn't check. The pool is a hint, not a guarantee — design for the case where `New` runs every call.

---

## 15. Summary

**Always-ship wins** (apply by default in any new hot-path code):

- Use generic typed pool wrappers around `sync.Pool` (Exercise 2, Exercise 7).
- Cap buffer size on return (Exercise 8).
- Borrow once outside loops, not once per iteration (Exercise 9).
- Never set a finalizer on a pooled object (Exercise 12).
- Use `b = b[:0]` instead of `bytes.Buffer.Reset` when you don't need the `io.Writer` interface (Exercise 4).

**Wins behind a profile** (do these when measurements justify them):

- Add a pool to a hot allocating path (Exercise 1) — only when allocation shows up in pprof.
- Replace `make([]byte, N)` with a pooled fixed-size slice (Exercise 3) at 4 KB or larger sizes.
- Pool reusable `json.Encoder`s with shared buffers (Exercise 10) on serialization-heavy endpoints.
- Size connection pools with Little's Law (Exercise 5) when queue waits show up in p99 latency.
- Buffer worker channels (Exercise 6) when Submit throughput matters more than per-job latency.

**Specialty:**

- Shard a custom pool by P or goroutine ID (Exercise 11) when a flame graph shows acquire contention.
- Build a typed pool with explicit `Close` for resources with OS handles (Exercise 12).

Object pooling is a precision instrument: bloats memory on the wrong target, cuts GC pressure dramatically on the right one. Measure, profile, then pool.
