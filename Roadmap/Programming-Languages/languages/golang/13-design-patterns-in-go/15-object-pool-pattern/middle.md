# Object Pool — Middle

## 1. Where pooling actually pays off

The Object Pool pattern is unusual in Go because the language already has a fast allocator and a generational-ish GC. Naively pooling objects often produces *no* benefit — and sometimes regresses. The middle-level skill is knowing **when** pooling actually helps.

Pool pays off when **all three** are true:
1. The object holds **non-trivial state** to initialize (a buffer that grows to several KB; a parser with internal tables).
2. It's used in a **hot path** (per-request in an HTTP server, per-message in a queue worker, per-symbol in a lexer).
3. The object's lifecycle is **short** and **scoped** — you can clearly say "I'm done with this now".

When any of those isn't true, you can usually skip the pool and let the GC do its job.

---

## 2. `sync.Pool` semantics, properly understood

`sync.Pool` has three behaviors that surprise newcomers:

**It can drop objects at any time.** During GC, all pooled objects may be cleared. So a pool is **not** a guarantee of reuse — it's a *hint*. If you need strict reuse (a connection that must not be re-dialed), use a typed pool, not `sync.Pool`.

**It's per-P (per logical processor).** Internally, `sync.Pool` keeps a local cache for each P, with a slow-path shared list. This is why pooled access is nearly lock-free under contention.

**The `New` function is the fallback.** When the pool is empty (first call, post-GC, contention loss), `New` is called to create a fresh object. `New` should be cheap; if creation is expensive, the pool's benefit erodes when `New` runs.

```go
var bufPool = sync.Pool{
    New: func() any {
        // Cheap: zero-value, no I/O, no allocation beyond struct.
        return &bytes.Buffer{}
    },
}
```

---

## 3. The "buffer pool" pattern (most common)

A typical pooled buffer:

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func renderResponse(r *http.Request) []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()

    buf.WriteString("user=")
    buf.WriteString(r.URL.Query().Get("user"))
    buf.WriteString(" ts=")
    buf.WriteString(time.Now().Format(time.RFC3339))

    // Must copy: caller can't keep the buf reference.
    out := make([]byte, buf.Len())
    copy(out, buf.Bytes())
    return out
}
```

Two crucial things:

- **`buf.Reset()`** clears the length to zero but **keeps the backing array**. That's exactly what we want — the buffer grows once, then is reused.
- **The caller can't keep a pointer to the buffer's internal slice** (`buf.Bytes()`). We `copy` it out. Otherwise, the next borrower writes over the caller's "result".

---

## 4. The buffer-size trap

Naive pooling of `bytes.Buffer` (or any growable container) has a memory problem. If one borrower grows the buffer to 1 MB, the buffer stays 1 MB in the pool forever. With 1000 cached buffers, that's 1 GB of resident memory.

The fix: **cap the buffer size on return**:

```go
func putBuf(b *bytes.Buffer) {
    if b.Cap() > 64<<10 { // > 64 KB
        return // drop it; let GC reclaim
    }
    bufPool.Put(b)
}
```

`encoding/json` does exactly this. Most production buffer pools have an upper-bound check.

---

## 5. Pooling structs with sub-allocations

Pooling a struct that contains slices/maps is more subtle: returning the struct alone isn't enough — its inner allocations must be reset too.

```go
type Request struct {
    Headers map[string]string
    Body    []byte
}

var reqPool = sync.Pool{
    New: func() any {
        return &Request{
            Headers: make(map[string]string, 16),
            Body:    make([]byte, 0, 4096),
        }
    },
}

func putRequest(r *Request) {
    // Clear, don't drop, the inner allocations.
    for k := range r.Headers { delete(r.Headers, k) }
    r.Body = r.Body[:0]
    reqPool.Put(r)
}
```

The map keys are deleted (not replaced with a new map); the slice is truncated (length to 0, capacity kept). This is the whole point: we want to *reuse* the underlying allocations.

---

## 6. Connection pools (a different beast)

`sync.Pool` is **not** suitable for connections. Why:
- It may evict pooled items during GC — you'd lose connections that took 50ms to dial.
- It has no size cap — you can't limit the number of pooled items.
- It has no health check.

For connections, use a typed pool. Go gives you `database/sql.DB` for free; for everything else, you usually wrap a `chan T`:

```go
type ConnPool struct {
    pool    chan *grpc.ClientConn
    factory func() (*grpc.ClientConn, error)
}

func New(size int, f func() (*grpc.ClientConn, error)) *ConnPool {
    return &ConnPool{pool: make(chan *grpc.ClientConn, size), factory: f}
}

func (p *ConnPool) Get(ctx context.Context) (*grpc.ClientConn, error) {
    select {
    case c := <-p.pool:
        return c, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    default:
        return p.factory()
    }
}

func (p *ConnPool) Put(c *grpc.ClientConn) {
    select {
    case p.pool <- c:
    default:
        c.Close() // pool full; discard
    }
}
```

This is a fixed-size pool that prefers reuse but falls back to creating a new connection if the pool is empty. Real implementations also: track health (close broken connections), add timeouts, and limit total connection count.

---

## 7. Pooling worker goroutines

A worker pool is a different application of the same idea: instead of spawning a goroutine per job (which is cheap in Go but not free), keep a fixed set of workers reading from a channel:

```go
type Pool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func New(workers int) *Pool {
    p := &Pool{jobs: make(chan func(), workers*4)}
    for i := 0; i < workers; i++ {
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

func (p *Pool) Submit(f func()) { p.jobs <- f }

func (p *Pool) Close() {
    close(p.jobs)
    p.wg.Wait()
}
```

Trade-offs vs spawning per job:
- Bounds the concurrency (good — backpressure for free).
- Reuses stack memory (small win — goroutines are small).
- Adds a coordination point (the channel).

You'll see this in queue consumers, batch processors, and migration scripts.

---

## 8. Benchmarking is mandatory

Object pooling is the rare pattern where you **must** benchmark. Otherwise you don't know whether it helps:

```go
func BenchmarkNoPool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var buf bytes.Buffer
        buf.WriteString("hello")
        _ = buf.String()
    }
}

func BenchmarkWithPool(b *testing.B) {
    pool := sync.Pool{New: func() any { return new(bytes.Buffer) }}
    for i := 0; i < b.N; i++ {
        buf := pool.Get().(*bytes.Buffer)
        buf.Reset()
        buf.WriteString("hello")
        _ = buf.String()
        pool.Put(buf)
    }
}
```

Run with `go test -bench=. -benchmem`. Look at allocs/op and ns/op. A pool that increases allocs/op or doesn't reduce ns/op is doing harm.

Rule of thumb: pooling small structs (< 256 bytes) rarely beats the allocator. Pooling buffers > 1 KB usually does.

---

## 9. Common middle-level mistakes

- **`Reset()` forgotten.** A returned `*bytes.Buffer` still contains the previous response. The next borrower writes after the old data — the next response has the wrong prefix.
- **Pool leak.** `Get` without `Put` (or `Put` skipped on a panic path because no `defer`). The pool slowly empties; `New` runs on every call; performance collapses.
- **Caller keeps the borrowed pointer.** A `*Buffer` returned to the pool is now usable by other goroutines. If the caller still holds a reference and writes to it, that's a data race.
- **Pooling per-request when one global suffices.** Some objects (e.g., zap loggers, validators) are safe to share. Pooling them is overkill.
- **Pooling everything because "it might help".** The pool itself costs ~5 ns per op. For objects that cost less than that to allocate, the pool is a regression.

---

## 10. When to *not* use a pool

- Object init is cheap (< 50 ns).
- Object is used rarely (< 1k QPS).
- Object holds resources (sockets, files) — use a real connection pool.
- Object varies wildly in size — pooling traps the largest.
- The object is shared and immutable — just keep one instance.

---

## 11. Summary

Middle-level pooling means: know when `sync.Pool` actually wins (hot path, costly init, scoped lifecycle); always Reset before use; cap buffer sizes on Put to avoid memory bloat; use typed pools for connections and worker pools; benchmark before and after. The pool is a hint, not a guarantee — design for the case where `New` runs on every call, and let the pool save you when it can.

---

## Further reading
- `sync.Pool` source code: `src/sync/pool.go`
- Vincent Blanchon, "Go: Understand the Design of sync.Pool"
- `encoding/json` — see `cachedTypeFields` and encoder pooling
- `bytes.NewBuffer` vs pooled `*bytes.Buffer` benchmark patterns
- `valyala/fasthttp` — aggressive pooling throughout
- `pkg.go.dev/sync#Pool` — official docs and caveats
