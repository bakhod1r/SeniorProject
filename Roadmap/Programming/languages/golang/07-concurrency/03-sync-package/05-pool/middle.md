# sync.Pool — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Reset Discipline](#reset-discipline)
3. [Escape Analysis and Pool Pessimisations](#escape-analysis-and-pool-pessimisations)
4. [Generic Pool Wrappers](#generic-pool-wrappers)
5. [Bounding Pool Memory Growth](#bounding-pool-memory-growth)
6. [Pools Inside HTTP Handlers](#pools-inside-http-handlers)
7. [Pools Inside Encoders, Decoders, and Hashers](#pools-inside-encoders-decoders-and-hashers)
8. [Measuring Pool Effectiveness](#measuring-pool-effectiveness)
9. [Pool Anti-Patterns](#pool-anti-patterns)
10. [Self-Assessment](#self-assessment)
11. [Summary](#summary)

---

## Introduction

At junior level you learned the four-line dance: `Get`, `Reset`, `defer Put`, use. At middle level you stop dancing and start designing. The questions change:

- How do I prevent pooled buffers from drifting into 10 MB after one bad request?
- What does the compiler do with `Put`? When does pooling actually *increase* allocations?
- How do I write a generic `Pool[T]` that does not erode type safety with `any` assertions?
- How do I split one pool into capacity classes so a request expecting 200 bytes does not accidentally borrow a 1 MB buffer?
- When `BenchmarkX` says `0 allocs/op`, what does that *really* mean about my pool?

After this file you will:

- Design `Reset` methods that are O(1) and safe across reuse.
- Recognise when a pool is being defeated by escape analysis and fix it.
- Build a generic `Pool[T]` wrapper that hides `any` from callers.
- Cap pool memory by dropping oversized items before `Put`.
- Read `-benchmem` and `pprof -alloc_objects` output critically and make decisions from it.

---

## Reset Discipline

The pool gives you back an object in whatever state the previous user left it in. `Reset` is the convention that makes reuse safe.

### The `Reset` interface

Many stdlib types implement a method called `Reset`:

```go
buf.Reset()           // bytes.Buffer
sb.Reset()            // strings.Builder
h := sha256.New(); h.Reset()
gz.Reset(w)           // *gzip.Writer — also rebinds the writer
zr.Reset(r)           // *gzip.Reader — also rebinds the reader
```

When you write your own pooled type, write a `Reset()` method. Use the canonical name and signature so the type composes with `io.ReaderFrom`/`io.WriterTo` mental models.

### What `Reset` must do

`Reset` must restore the object to a state indistinguishable from `New()`. In practice that means:

1. **Clear logical state** — counters, flags, slice lengths, channel references.
2. **Keep allocated capacity** — that is the whole reason to pool.
3. **Drop references that prevent GC.** This is the subtle one: if your object holds a pointer to a user-supplied input, `Reset` must `nil` it out, or the GC will keep that input alive as long as the buffer lives in the pool.

```go
type Decoder struct {
    scratch  [4096]byte
    input    []byte            // reference to user data
    state    parseState
}

func (d *Decoder) Reset() {
    d.input = nil               // critical: drop user data
    d.state = parseState{}      // zero state
    // scratch keeps its bytes — we want that
}
```

Forgetting to nil `input` is a classic memory leak: every pooled `Decoder` pins the last request's data until the pool evicts it.

### `Reset` cost should be amortised away

A pool only helps if `Reset` is cheaper than `New`. For `bytes.Buffer`, `Reset` is one integer write (`b.off = 0; b.buf = b.buf[:0]`). For a hash, `Reset` rewrites a small block. For a 16 MB struct with many fields, `Reset` may be hundreds of microseconds — at which point pooling buys you less than you think.

Benchmark `Reset` standalone:

```go
func BenchmarkReset(b *testing.B) {
    d := new(Decoder)
    for i := 0; i < b.N; i++ {
        d.Reset()
    }
}
```

If `Reset` shows up in your CPU profile, optimise it before pooling.

---

## Escape Analysis and Pool Pessimisations

This is the most counterintuitive middle-level topic. Sometimes adding a pool *increases* allocations. The cause is **escape analysis**.

### Recap: escape analysis decides stack vs heap

The Go compiler analyses each variable: if its address never leaves the function frame, it lives on the stack — free, no GC. If the variable escapes (its address is stored in a longer-lived location), it must live on the heap.

```go
func a() *bytes.Buffer {
    var b bytes.Buffer       // b's address returned — escapes
    return &b
}

func b() {
    var b bytes.Buffer       // address never escapes
    b.WriteString("hello")
    _ = b.String()           // stays on stack — 0 allocs
}
```

Run `go build -gcflags="-m" main.go` and the compiler tells you what escaped.

### How `Put` defeats escape analysis

```go
var pool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func pooled() string {
    buf := pool.Get().(*bytes.Buffer)
    defer pool.Put(buf)
    buf.Reset()
    buf.WriteString("hello")
    return buf.String()
}
```

`pool.Put(buf)` makes `buf` "escape to the heap" *from the compiler's point of view* even though it was on the heap to begin with. That part is fine. But consider the **un-pooled** version:

```go
func plain() string {
    var buf bytes.Buffer    // might stay on stack
    buf.WriteString("hello")
    return buf.String()
}
```

If `buf` does not escape (because `String()` copies into a fresh string), the entire buffer lives on the *stack* — zero allocations. The "naive" version may be faster and cheaper than the pooled one.

### The lesson: profile before you pool

Always benchmark `pooled` vs `plain`:

```go
func BenchmarkPlain(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = plain()
    }
}
```

If `plain` reports `1 allocs/op` and `pooled` reports `1 allocs/op` and the times are within 5%, the pool is pure complexity — drop it. The pool pays off only when the un-pooled version reports many allocs/op.

### Heuristics for "does pooling help?"

| Buffer size | Pool likely helps? |
|---|---|
| < 64 B | No — stack-allocated, compiler folds it. |
| 64 B – 1 KB | Maybe — depends on whether the bytes escape. |
| 1 KB – 64 KB | Yes — heap-allocated, GC sees it. |
| > 64 KB | Yes for the buffer itself; risk of memory bloat from pool. |

Buffers that escape to the heap *always* benefit from pooling. Buffers that the compiler keeps on the stack *never* benefit. The middle ground requires measurement.

---

## Generic Pool Wrappers

Pre-1.18, `sync.Pool` returns `any`. Every `Get` needs a type assertion. The assertion is correct most of the time but fragile and noisy. Generics turn this into a typed API.

### A minimal generic wrapper

```go
package gpool

import "sync"

type Pool[T any] struct {
    p sync.Pool
}

func New[T any](newFn func() T) *Pool[T] {
    return &Pool[T]{
        p: sync.Pool{
            New: func() any { return newFn() },
        },
    }
}

func (p *Pool[T]) Get() T {
    return p.p.Get().(T)
}

func (p *Pool[T]) Put(v T) {
    p.p.Put(v)
}
```

Usage:

```go
var bufPool = gpool.New(func() *bytes.Buffer { return new(bytes.Buffer) })

buf := bufPool.Get()
buf.Reset()
defer bufPool.Put(buf)
```

No more `Get().(*bytes.Buffer)` — the assertion lives inside the wrapper.

### Adding a `Reset` callback

Take it one step further: have the wrapper handle `Reset` for you so callers cannot forget.

```go
type Pool[T any] struct {
    p     sync.Pool
    reset func(T)
}

func New[T any](newFn func() T, reset func(T)) *Pool[T] {
    return &Pool[T]{
        p:     sync.Pool{New: func() any { return newFn() }},
        reset: reset,
    }
}

func (p *Pool[T]) Get() T {
    v := p.p.Get().(T)
    if p.reset != nil {
        p.reset(v)
    }
    return v
}

func (p *Pool[T]) Put(v T) {
    p.p.Put(v)
}

// usage:
var bufPool = gpool.New(
    func() *bytes.Buffer { return new(bytes.Buffer) },
    func(b *bytes.Buffer) { b.Reset() },
)

buf := bufPool.Get() // already reset
defer bufPool.Put(buf)
```

Trade-off: callers can no longer rely on the convention "Get returns a dirty object." That is intentional — the dirt is invisible.

### A `Put` validator to bound capacity

```go
type Pool[T any] struct {
    p       sync.Pool
    reset   func(T)
    canKeep func(T) bool
}

func (p *Pool[T]) Put(v T) {
    if p.canKeep != nil && !p.canKeep(v) {
        return // drop, do not pool
    }
    p.p.Put(v)
}

// usage:
var bufPool = gpool.New(
    func() *bytes.Buffer { return new(bytes.Buffer) },
    func(b *bytes.Buffer) { b.Reset() },
    func(b *bytes.Buffer) bool { return b.Cap() < 1<<20 }, // < 1 MB only
)
```

Now caller code stays simple, and the pool bounds itself.

### When *not* to wrap

If your pool sits in a single hot file and is used ten lines apart, the wrapper is noise. Use the wrapper when:

- The same pooled type is touched across many files / packages.
- You have a strong convention that `Reset` must be called.
- You want a single chokepoint to add metrics, tracing, or capacity guards.

A 200-line file with one `sync.Pool` does not need a wrapper.

---

## Bounding Pool Memory Growth

`sync.Pool` has no size limit. If your code reliably `Put`s a 10 MB buffer once per minute, the pool may collect dozens of them before the next GC. Total: hundreds of MB of pooled buffers no one is asking for.

### Strategy 1: drop pathological items

The simplest fix:

```go
const maxBufSize = 64 << 10 // 64 KB

func returnBuf(buf *bytes.Buffer) {
    if buf.Cap() > maxBufSize {
        return // let GC reclaim it; do not pool
    }
    bufPool.Put(buf)
}
```

Pick a cap based on your p99 buffer size. A buffer that grew past the cap is an outlier; reusing it costs more memory than it saves.

### Strategy 2: per-size sub-pools

If you have a bimodal distribution — half your requests use 200 B, half use 50 KB — split:

```go
var (
    smallPool = sync.Pool{New: func() any { return bytes.NewBuffer(make([]byte, 0, 1024)) }}
    largePool = sync.Pool{New: func() any { return bytes.NewBuffer(make([]byte, 0, 65536)) }}
)

func getBuf(estimate int) *bytes.Buffer {
    if estimate > 4096 {
        return largePool.Get().(*bytes.Buffer)
    }
    return smallPool.Get().(*bytes.Buffer)
}

func putBuf(buf *bytes.Buffer) {
    if buf.Cap() > 16384 {
        largePool.Put(buf)
    } else if buf.Cap() < 8192 {
        smallPool.Put(buf)
    }
    // else: drop, ambiguous size
}
```

The downside is bookkeeping. Use this when profiling shows that one pool serves wildly different sizes.

### Strategy 3: `runtime.SetFinalizer` to log oversize items in dev

```go
runtime.SetFinalizer(buf, func(b *bytes.Buffer) {
    if b.Cap() > 1<<20 {
        log.Printf("huge pool item finalised: %d", b.Cap())
    }
})
```

Use only in development. Finalizers do not run on a known schedule and add overhead.

### What about a size limit option?

There is none in the standard library. If you need a strictly-bounded pool, use a channel:

```go
type Bounded struct {
    ch  chan *bytes.Buffer
    new func() *bytes.Buffer
}

func (b *Bounded) Get() *bytes.Buffer {
    select {
    case x := <-b.ch:
        return x
    default:
        return b.new()
    }
}

func (b *Bounded) Put(x *bytes.Buffer) {
    select {
    case b.ch <- x:
    default:
        // pool full; drop
    }
}
```

A buffered channel of capacity N gives you a hard limit of N pooled objects. The trade-off: a channel costs more per `Get`/`Put` than `sync.Pool`, and it cannot release memory on GC. We compare these in the senior file.

---

## Pools Inside HTTP Handlers

The hottest place to pool in a typical Go service is the HTTP handler. Each request flows through:

1. Parsing request body.
2. Validating / decoding.
3. Producing a response (often via `bytes.Buffer` or `json.Encoder`).
4. Writing the response.

Every step is a candidate for pooling.

### Pooling the response buffer

```go
var respPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := respPool.Get().(*bytes.Buffer)
    defer func() {
        if buf.Cap() < 1<<20 {
            respPool.Put(buf)
        }
    }()
    buf.Reset()

    fmt.Fprintf(buf, `{"ok":true,"id":%d}`, r.Context().Value("id"))
    w.Header().Set("Content-Type", "application/json")
    w.Write(buf.Bytes())
}
```

Key points:

- `defer` runs even on panic — the panic-safe pattern.
- We check `Cap()` before `Put` to drop bloated buffers.
- We write `buf.Bytes()` directly. Beware: once `Put` runs, that slice is no longer ours. The `w.Write` call must complete before `Put` — `defer` orders correctly.

### Pooling the encoder

For JSON-heavy services:

```go
type respEncoder struct {
    buf *bytes.Buffer
    enc *json.Encoder
}

var encPool = sync.Pool{
    New: func() any {
        b := new(bytes.Buffer)
        return &respEncoder{buf: b, enc: json.NewEncoder(b)}
    },
}

func writeJSON(w http.ResponseWriter, v any) error {
    e := encPool.Get().(*respEncoder)
    defer encPool.Put(e)
    e.buf.Reset()
    if err := e.enc.Encode(v); err != nil {
        return err
    }
    _, err := w.Write(e.buf.Bytes())
    return err
}
```

`json.NewEncoder(b)` is a non-trivial allocation: an `Encoder` struct, a scratch field, and a typed `io.Writer`. Pooling saves all three.

### Pooling middleware-allocated context

Some middleware allocates per-request structs (logger context, tracing context). Pool them:

```go
type reqCtx struct {
    traceID string
    spanID  string
    tags    []string
}

var ctxPool = sync.Pool{New: func() any { return &reqCtx{tags: make([]string, 0, 8)} }}

func tagging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        rc := ctxPool.Get().(*reqCtx)
        rc.tags = rc.tags[:0]
        rc.traceID = newTraceID()
        rc.spanID = newSpanID()
        defer ctxPool.Put(rc)

        // attach to request
        next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, rc)))
    })
}
```

Caveat: do not let the handler retain `rc` beyond `ServeHTTP`. If any goroutine spawned by the handler captures `rc`, your pool's `Put` happens before the goroutine reads — a race.

### Mistake: pooling the request body

```go
var bodyPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func handler(w http.ResponseWriter, r *http.Request) {
    body := bodyPool.Get().(*bytes.Buffer)
    defer bodyPool.Put(body)
    body.Reset()
    io.Copy(body, r.Body) // BUG: if r.Body has 10 MB, body grows to 10 MB
    // ...
}
```

Without an upper bound on `r.Body` size, the pool can swell. Either set a request size limit (`http.MaxBytesReader`) or drop oversized buffers.

---

## Pools Inside Encoders, Decoders, and Hashers

A different shape of pooling: where the pooled object has internal state machinery, not just a buffer.

### `gzip.Writer` reuse via `Reset(w)`

```go
var gzPool = sync.Pool{
    New: func() any {
        return gzip.NewWriter(io.Discard) // dummy writer; we Reset before use
    },
}

func compress(out io.Writer, data []byte) error {
    gz := gzPool.Get().(*gzip.Writer)
    gz.Reset(out) // rebind to the real writer + clears internal state
    defer gzPool.Put(gz)

    if _, err := gz.Write(data); err != nil {
        return err
    }
    return gz.Close()
}
```

`gzip.Writer.Reset(w io.Writer)` is special: it both resets state *and* rebinds the underlying writer. Without that method, you would have to construct a new `gzip.Writer` per call (~10 KB allocation).

### `crypto/sha256.Hash` pool

```go
var shaPool = sync.Pool{New: func() any { return sha256.New() }}

func sum(b []byte) [32]byte {
    h := shaPool.Get().(hash.Hash)
    h.Reset()
    h.Write(b)
    var out [32]byte
    copy(out[:], h.Sum(nil))
    shaPool.Put(h)
    return out
}
```

`h.Sum(nil)` allocates a new slice; copying into `out` avoids retaining that allocation. Note: `h.Sum(buf)` reuses an existing buffer, which can save the extra alloc if you have one.

### Protocol buffer message pools

Many gRPC services pool `*proto.Message` instances. The catch is that protobuf-generated structs may grow internal slices over time. A `Reset` (`proto.Reset(m)`) clears fields but does not shrink slice capacity — perfect for pooling.

```go
var reqPool = sync.Pool{New: func() any { return new(MyRequest) }}

func handle(ctx context.Context, b []byte) (*MyResponse, error) {
    req := reqPool.Get().(*MyRequest)
    proto.Reset(req)
    defer reqPool.Put(req)

    if err := proto.Unmarshal(b, req); err != nil {
        return nil, err
    }
    return process(req)
}
```

Beware of returning fields of `req` to the caller. After `Put`, those slices belong to the pool. Always copy out.

---

## Measuring Pool Effectiveness

You added a pool. Did it actually help? Three lenses.

### Lens 1: `go test -bench . -benchmem`

```go
func BenchmarkPooled(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = formatPooled(i)
    }
}

func BenchmarkNaive(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = formatNaive(i)
    }
}
```

Output:

```
BenchmarkPooled-8   40000000   30 ns/op    8 B/op   1 allocs/op
BenchmarkNaive-8    10000000  120 ns/op  200 B/op   3 allocs/op
```

Look at three numbers: time, bytes, allocs. The pool should drop allocs and bytes; it may or may not drop time (the pool itself has overhead).

### Lens 2: `testing.AllocsPerRun`

Sometimes you want a precise allocation count for a single call:

```go
func TestPoolZeroAllocsAfterWarmup(t *testing.T) {
    // Warm up: prime the pool with one item.
    bufPool.Put(bufPool.Get())

    n := testing.AllocsPerRun(1000, func() {
        buf := bufPool.Get().(*bytes.Buffer)
        buf.Reset()
        buf.WriteString("hi")
        _ = buf.Len()
        bufPool.Put(buf)
    })
    if n > 0.1 {
        t.Fatalf("pool path allocates: %.2f allocs/op", n)
    }
}
```

`AllocsPerRun` runs the function N times (after one warm-up) and reports the average allocations. Use it in tests to lock in "this path is zero-alloc."

### Lens 3: GC trace under production-like load

```bash
GODEBUG=gctrace=1 ./service > trace.log 2>&1
```

Output lines look like:

```
gc 5 @0.421s 0%: 0.014+0.51+0.005 ms clock, 0.11+0.21/0.32/0.69+0.043 ms cpu, 4->5->2 MB, 5 MB goal, 8 P
```

Watch `4->5->2 MB` — the heap size before, during, and after GC. Pools should reduce the rate at which the heap grows between GCs, lengthening the interval between GC cycles and shrinking pause times.

Compare GC traces before and after introducing the pool, under the same load. If the heap-growth rate or GC frequency does not drop, the pool is not helping.

---

## Pool Anti-Patterns

### Anti-pattern 1: pool of small structs

```go
type Point struct { X, Y int }
var pp = sync.Pool{New: func() any { return new(Point) }}
```

A `Point` is 16 bytes. The pool's per-P bookkeeping plus the `any` interface header is 16–32 bytes already. You spent more memory than you saved. Just allocate.

### Anti-pattern 2: pool inside a tight loop where escape was avoided

```go
for i := 0; i < N; i++ {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    buf.WriteString("x")
    _ = buf.String()
    bufPool.Put(buf)
}
```

If the original code was `var buf bytes.Buffer` inside the loop and the compiler kept `buf` on the stack, pooling adds heap allocation. Run with `-gcflags="-m"` to check.

### Anti-pattern 3: pool of channels, mutexes, or other primitives

```go
var muPool = sync.Pool{New: func() any { return new(sync.Mutex) }}
```

Pooling a `Mutex` is meaningless — it is 8 bytes. Worse, locking a mutex while it lives in a pool is a category error. Don't.

### Anti-pattern 4: shared pool between unrelated types

```go
var anyPool sync.Pool

anyPool.Put(buf)
anyPool.Put(decoder)
v := anyPool.Get()        // *bytes.Buffer or *Decoder? have to type-switch
```

Each `Get` requires a type switch and may return the wrong type. Use one pool per type, even if you end up with many pools.

### Anti-pattern 5: pool that never warms up because traffic is sparse

A pool only helps when `Put` precedes `Get` reliably. If your service handles 1 RPS, every GC empties the pool and every `Get` calls `New`. The pool is overhead with no benefit. Pools shine above ~100 RPS sustained.

### Anti-pattern 6: pooling for memory savings instead of GC reduction

Pools do not save memory; they often *spend* it (the pool holds extra unused objects). What pools save is GC work. If your problem is "I am running out of memory," a pool will not help and may worsen it. Optimise for fewer or smaller allocations, not for pooling.

---

## Self-Assessment

- [ ] I can describe how `Reset` must clear references that pin user data.
- [ ] I have run `go build -gcflags="-m"` and identified an escape that pooling cannot fix.
- [ ] I can write a generic `Pool[T]` wrapper with a `Reset` callback and a `Put` validator.
- [ ] I can describe at least two strategies to bound pool memory growth.
- [ ] I have pooled a `gzip.Writer` or `json.Encoder` and benchmarked the result.
- [ ] I know what `testing.AllocsPerRun` measures and how to use it in a test.
- [ ] I have read a `GODEBUG=gctrace=1` line and identified the heap-growth column.
- [ ] I can list three anti-patterns where pooling actively hurts.

---

## Summary

At middle level, `sync.Pool` stops being "the four-line dance" and becomes a design decision. `Reset` must clear references that pin user data, not just logical state. Escape analysis can make pooling pointless or even harmful — measure before you pool. Generic wrappers (Go 1.18+) hide the `any` and centralise convention. Capacity-guarded `Put` prevents pathologically large items from bloating memory.

The right test for "did the pool help?" combines `-benchmem`, `testing.AllocsPerRun`, and `GODEBUG=gctrace=1` under realistic load. Two of those three must show improvement; otherwise the pool is just complexity. Pools belong on hot paths with > 100 RPS sustained, with mid-size buffers (1 KB – 64 KB), in code where the un-pooled version unambiguously allocates on the heap.

The senior file moves into the runtime: per-P shards, the steal path, the victim cache, and the architectural decisions that flow from those internals.
