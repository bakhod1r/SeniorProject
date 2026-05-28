# Object Pool — Hands-on Tasks

## 1. How to use this file

Fifteen progressive tasks, from "first `sync.Pool`" to "build a mini pgx-style connection pool". Each task has:

- **Goal** — one sentence on what you build and why.
- **Starter** — an incomplete sketch. Type it out by hand; do not paste.
- **Hints** — bullets you read when stuck. Skip them on the first pass.
- **Reference solution** — a collapsible, complete Go program. Senior decisions are called out in `// Senior decision:` comments inside the code.

The code targets Go 1.22+ (generics, `errors.Join`, `log/slog`, `atomic.Int64`). Every solution is self-contained `package main` unless noted — `go run file.go` works.

The arc: `sync.Pool` + `bytes.Buffer`, prove the win via benchmark, cap buffer sizes on Put, build a worker pool with graceful shutdown, layer in generics, then leave `sync.Pool` behind and build a real connection pool with health checks, max-lifetime, max-idle-time, exhaustion policy, metrics, and finally a small but production-shaped pgx-style runtime.

Run `go test -bench=. -benchmem` on at least three tasks. The Object Pool is the one pattern where benchmarks are not optional — without them you do not know whether you have improved or regressed.

---

## 2. Difficulty legend

| Tag | Level | What it means |
|-----|-------|---------------|
| **B** | Beginner | `sync.Pool`, basic structs, channels. Junior.md territory. |
| **I** | Intermediate | Size caps, worker pools, generics, graceful shutdown. middle.md territory. |
| **A** | Advanced | Real connection pools, health checks, lifetime caps, metrics, exhaustion policy. |
| **S** | Stretch | One bigger project that combines everything into a pgx-like pool. |

---

## 3. Tasks

### Task 1 (B) — First `sync.Pool` with `bytes.Buffer`

**Goal:** The smallest possible pooled buffer. Borrow, write, return. The whole task fits in 30 lines, but every line matters — forgetting `Reset` or `Put` is the source of every production bug in this pattern.

**Starter:**

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

// TODO: var bufPool = sync.Pool{ New: ... }
// TODO: func render(name string) string — Get, Reset, write, copy out, Put
// TODO: main calls render twice and prints both
```

**Hints:**

- `sync.Pool.New` returns `any`. Cast on Get: `buf := bufPool.Get().(*bytes.Buffer)`.
- Always `Reset()` immediately after Get. The previous borrower's bytes are still in there.
- Always `defer bufPool.Put(buf)` so a panic does not leak the buffer.
- The caller of `render` must not keep a reference into `buf.Bytes()`. Copy out.

<details><summary>Reference solution</summary>

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

// Senior decision: pool at package scope. Re-creating it per call is
// just a slow allocator. One pool serves the whole process lifetime.
var bufPool = sync.Pool{
    New: func() any {
        // Cheap zero-value. No I/O, no big alloc in New — if New is
        // expensive, the pool's benefit erodes on every miss.
        return new(bytes.Buffer)
    },
}

func render(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    // Senior decision: Reset BEFORE writing. The previous borrower left
    // whatever it wrote in there. Skipping this is the #1 production bug.
    buf.Reset()
    // Senior decision: defer Put right after Get. If anything panics,
    // the deferred Put still runs and the pool stays healthy.
    defer bufPool.Put(buf)
    buf.WriteString("hello, ")
    buf.WriteString(name)
    // Senior decision: copy out. The buffer goes back to the pool; its
    // internal slice is shared with the next borrower.
    return buf.String()
}

func main() {
    fmt.Println(render("alice"))
    fmt.Println(render("bob"))
    fmt.Println(render("carol"))
}
```

</details>

---

### Task 2 (B) — Reset-before-use demo

**Goal:** Deliberately skip `buf.Reset()`, watch the second call's output get prefixed with the first call's bytes, then fix it. Feel the failure mode so you remember it forever.

**Starter:**

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

// TODO: dirty(name) — intentionally forgets Reset
// TODO: clean(name) — resets correctly
// TODO: main calls both and shows the corruption
```

**Hints:**

- Corruption only manifests if the *same* pooled buffer is reused. Sequential calls in one goroutine do that.
- The fix is one line: `buf.Reset()` right after Get.
- `Reset` keeps the backing array. The next caller writes into the same memory with no re-allocation.

<details><summary>Reference solution</summary>

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

// dirty: deliberately broken.
func dirty(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    // No Reset! Old content stays.
    buf.WriteString("hello, ")
    buf.WriteString(name)
    return buf.String()
}

func clean(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    // Senior decision: Reset is mandatory for any growable container
    // (Buffer, slice, map). The pool reuses memory, not values.
    buf.Reset()
    buf.WriteString("hello, ")
    buf.WriteString(name)
    return buf.String()
}

func main() {
    fmt.Println("=== dirty ===")
    fmt.Println(dirty("alice"))
    fmt.Println(dirty("bob"))   // -> "hello, alicehello, bob"
    fmt.Println(dirty("carol")) // -> "hello, alicehello, bobhello, carol"
    fmt.Println("=== clean ===")
    fmt.Println(clean("alice"))
    fmt.Println(clean("bob"))
    fmt.Println(clean("carol"))
}
```

</details>

---

### Task 3 (B) — Benchmark with vs without pool

**Goal:** Two benchmarks, one allocating, one pooled. Run `go test -bench=. -benchmem`. Walk away with a number you trust, not a folklore intuition.

**Starter:**

```go
// File: bufbench_test.go
package bufbench

import (
    "bytes"
    "sync"
    "testing"
)

// TODO: BenchmarkNoPool — fresh Buffer each iteration
// TODO: BenchmarkWithPool — sync.Pool reuse
// TODO: same non-trivial workload in both
```

**Hints:**

- Use a non-trivial workload (a few hundred bytes). Writing one byte is too cheap; pool overhead dominates and the comparison is meaningless.
- `b.ReportAllocs()` prints `B/op` and `allocs/op`. Without it you only see `ns/op` and you cannot tell *why* the pool helps.
- Run with `-benchtime=3s` for warmer samples.

<details><summary>Reference solution</summary>

```go
// File: bufbench_test.go — go test -bench=. -benchmem -benchtime=3s
package bufbench

import (
    "bytes"
    "strconv"
    "sync"
    "testing"
)

// Senior decision: 256-byte workload. Roughly an HTTP header block.
// Too small and pool overhead swamps the savings.
func write256(buf *bytes.Buffer, i int) {
    buf.WriteString("user=")
    buf.WriteString(strconv.Itoa(i))
    buf.WriteString(" path=/api/v1/orders/")
    buf.WriteString(strconv.Itoa(i))
    buf.WriteString(" method=GET ts=2026-05-28 ua=Mozilla/5.0")
}

func BenchmarkNoPool(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var buf bytes.Buffer
        write256(&buf, i)
        _ = buf.String()
    }
}

func BenchmarkWithPool(b *testing.B) {
    pool := sync.Pool{New: func() any { return new(bytes.Buffer) }}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        buf := pool.Get().(*bytes.Buffer)
        buf.Reset()
        write256(buf, i)
        _ = buf.String()
        pool.Put(buf)
    }
}

// Senior decision: jagged workload exposes the size-cap trap (task 5).
func BenchmarkWithPoolJagged(b *testing.B) {
    pool := sync.Pool{New: func() any { return new(bytes.Buffer) }}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        buf := pool.Get().(*bytes.Buffer)
        buf.Reset()
        n := 256
        if i%1000 == 0 {
            n = 64 << 10
        }
        for j := 0; j < n/8; j++ {
            buf.WriteString("xxxxxxxx")
        }
        pool.Put(buf)
    }
}

/*
Typical output:
  BenchmarkNoPool-10       8000000  180 ns/op  256 B/op  2 allocs/op
  BenchmarkWithPool-10    20000000   60 ns/op    0 B/op  0 allocs/op
With pool: 3x faster, allocations near zero.
*/
```

</details>

---

### Task 4 (B) — Pool a struct with a slice

**Goal:** Pool a `Request` struct holding a `[]byte` body and a `map[string]string` headers. Reuse both inner allocations across borrows without dropping them.

**Starter:**

```go
package main

import "sync"

type Request struct {
    Headers map[string]string
    Body    []byte
}

// TODO: reqPool with pre-sized map and slice
// TODO: borrow / return helpers
// TODO: main fills two requests in sequence; show the same pointer is reused
```

**Hints:**

- Do not assign `r.Headers = map[string]string{}` — that throws the old map away. Use `for k := range r.Headers { delete(r.Headers, k) }` (or `clear` in Go 1.21+).
- For the slice: `r.Body = r.Body[:0]` truncates length, keeps capacity.
- `fmt.Printf("%p\n", r)` confirms the same address is reused.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

type Request struct {
    Headers map[string]string
    Body    []byte
}

var reqPool = sync.Pool{
    New: func() any {
        // Senior decision: pre-size inner allocations. The point of
        // pooling is to avoid grow-and-copy. First borrow pays the cost,
        // every subsequent borrow reuses the grown structures.
        return &Request{
            Headers: make(map[string]string, 16),
            Body:    make([]byte, 0, 4096),
        }
    },
}

func borrowRequest() *Request { return reqPool.Get().(*Request) }

func returnRequest(r *Request) {
    // Senior decision: CLEAR, do not REPLACE. Replacing throws away the
    // very memory we wanted to reuse — and the new empty map/slice will
    // grow again on the next borrower.
    for k := range r.Headers {
        delete(r.Headers, k)
    }
    r.Body = r.Body[:0]
    reqPool.Put(r)
}

func handle(method, path string, body []byte) {
    r := borrowRequest()
    defer returnRequest(r)
    r.Headers["method"] = method
    r.Headers["path"] = path
    r.Body = append(r.Body, body...)
    fmt.Printf("addr=%p %s %s body-cap=%d\n", r, method, path, cap(r.Body))
}

func main() {
    handle("GET", "/api/v1/orders", []byte(`{"page":1}`))
    handle("POST", "/api/v1/orders", []byte(`{"item":"book"}`))
    handle("DELETE", "/api/v1/orders/42", nil)
}
```

</details>

---

### Task 5 (I) — Buffer pool with size cap on Put

**Goal:** Extend task 1 with an upper bound. If the buffer's capacity on return exceeds 64 KB, drop it (let GC reclaim) instead of returning to the pool. Without this cap, one big request balloons resident memory forever. This is exactly what `encoding/json` does.

**Starter:**

```go
package main

import (
    "bytes"
    "sync"
)

const maxBufCap = 64 << 10

var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

// TODO: getBuf / putBuf — drop if too big
// TODO: main demos a 1 MB buffer being dropped instead of pooled
```

**Hints:**

- The drop is an early `return` before `Put`. The big buffer goes out of scope and becomes garbage.
- Pick a cap from your real workload. 64 KB covers most HTTP responses. Document why.
- Increment a debug counter so future-you can tell at 3 AM how often this fires.

<details><summary>Reference solution</summary>

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

// Senior decision: 64 KB is defensible for HTTP. Largest "normal"
// response is ~16 KB; 4x that absorbs spikes without one outlier
// pinning a megabyte of memory forever.
const maxBufCap = 64 << 10

var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func getBuf() *bytes.Buffer {
    b := bufPool.Get().(*bytes.Buffer)
    b.Reset()
    return b
}

func putBuf(b *bytes.Buffer) {
    // Senior decision: cap check at Put, not Get. Catching bloat on
    // return is the standard form — encoding/json's encodeStatePool
    // does exactly this.
    if b.Cap() > maxBufCap {
        fmt.Printf("[pool] dropping oversized buf cap=%d\n", b.Cap())
        return
    }
    bufPool.Put(b)
}

func renderSmall() {
    b := getBuf()
    defer putBuf(b)
    for i := 0; i < 100; i++ {
        b.WriteString("hello\n")
    }
}

func renderHuge() {
    b := getBuf()
    defer putBuf(b)
    for i := 0; i < 1<<20; i++ {
        b.WriteByte('x')
    }
}

func main() {
    renderSmall()
    renderHuge()  // drops on Put
    renderSmall() // gets a fresh (or pooled small) buf
}
```

</details>

---

### Task 6 (I) — Worker pool with `chan func()`

**Goal:** Fixed-size worker pool. Workers read closures off a channel and execute them. Submit is non-blocking up to the channel buffer; past that it blocks (backpressure). Roughly 30 lines.

**Starter:**

```go
package main

import "sync"

type WorkerPool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

// TODO: New(workers, depth)
// TODO: Submit(f)
// TODO: Close() — close channel, wait for drain
```

**Hints:**

- Worker body: `for f := range p.jobs { f() }`. When the channel closes, the range loop exits and the goroutine ends.
- `sync.WaitGroup` lives on the pool. `Add(1)` per worker at startup, `Done()` when the worker exits.
- `Close()` is `close(p.jobs); p.wg.Wait()`. Order matters.
- Queue depth ~ `workers*4`. Too small: Submit blocks. Too large: backpressure hidden.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type WorkerPool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func New(workers, queueDepth int) *WorkerPool {
    p := &WorkerPool{
        // Senior decision: buffered channel. queueDepth gives bursts
        // a place to land; past it Submit blocks — backpressure for free.
        jobs: make(chan func(), queueDepth),
    }
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *WorkerPool) worker() {
    defer p.wg.Done()
    // Senior decision: do NOT recover panics unless you know why.
    // A panic indicates a bug; swallowing hides it and the goroutine still dies.
    for f := range p.jobs {
        f()
    }
}

func (p *WorkerPool) Submit(f func()) { p.jobs <- f }

func (p *WorkerPool) Close() {
    close(p.jobs)
    p.wg.Wait()
}

func main() {
    p := New(4, 16)
    var done int64
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        i := i
        p.Submit(func() {
            defer wg.Done()
            time.Sleep(time.Duration(i%5) * time.Millisecond)
            atomic.AddInt64(&done, 1)
        })
    }
    wg.Wait()
    p.Close()
    fmt.Println("completed:", done)
}
```

</details>

---

### Task 7 (I) — Graceful shutdown with `context` + `WaitGroup`

**Goal:** Extend task 6 with context-aware shutdown. `Shutdown(ctx)` stops accepting work, drains the queue up to a deadline, and cancels in-flight workers when the deadline expires. The form every long-running service ends up with.

**Starter:**

```go
package main

import (
    "context"
    "sync"
)

type WorkerPool struct {
    jobs    chan func(context.Context)
    wg      sync.WaitGroup
    ctx     context.Context
    cancel  context.CancelFunc
}

// TODO: New, Submit (errors on closed), Shutdown(ctx)
```

**Hints:**

- Two contexts: the pool's lifetime context (cancelled on Shutdown), and the caller's deadline context.
- Track shutdown with `atomic.Bool` so Submit can refuse new work cheaply.
- On Shutdown: close `jobs`, wait for `wg.Wait()` OR `ctx.Done()`. If ctx fires first, call `p.cancel()` to interrupt workers, then still wait.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type WorkerPool struct {
    jobs   chan func(context.Context)
    wg     sync.WaitGroup
    ctx    context.Context
    cancel context.CancelFunc
    closed atomic.Bool
}

var ErrPoolClosed = errors.New("pool: closed")

func New(workers, depth int) *WorkerPool {
    ctx, cancel := context.WithCancel(context.Background())
    p := &WorkerPool{jobs: make(chan func(context.Context), depth), ctx: ctx, cancel: cancel}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *WorkerPool) worker() {
    defer p.wg.Done()
    // Senior decision: pass pool ctx to the job so jobs that respect
    // ctx.Done() can be interrupted on hard shutdown.
    for f := range p.jobs {
        f(p.ctx)
    }
}

func (p *WorkerPool) Submit(f func(context.Context)) error {
    if p.closed.Load() {
        return ErrPoolClosed
    }
    select {
    case p.jobs <- f:
        return nil
    case <-p.ctx.Done():
        return ErrPoolClosed
    }
}

func (p *WorkerPool) Shutdown(ctx context.Context) error {
    if !p.closed.CompareAndSwap(false, true) {
        return ErrPoolClosed
    }
    close(p.jobs)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        p.cancel()
        return nil
    case <-ctx.Done():
        // Senior decision: cancel, then STILL wait for wg. Returning
        // early would leave goroutines running past Shutdown.
        p.cancel()
        <-done
        return ctx.Err()
    }
}

func main() {
    p := New(2, 8)
    var done int64
    for i := 0; i < 5; i++ {
        i := i
        _ = p.Submit(func(ctx context.Context) {
            select {
            case <-time.After(100 * time.Millisecond):
                atomic.AddInt64(&done, 1)
            case <-ctx.Done():
                fmt.Printf("job %d cancelled\n", i)
            }
        })
    }
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    if err := p.Shutdown(ctx); err != nil {
        fmt.Println("shutdown:", err)
    }
    fmt.Println("done:", done)
    if err := p.Submit(func(context.Context) {}); err != nil {
        fmt.Println("expected:", err)
    }
}
```

</details>

---

### Task 8 (I) — Pool-backed JSON encoder

**Goal:** Pool both the `*bytes.Buffer` *and* the `*json.Encoder`. The encoder holds non-trivial internal state (a type cache); creating one per call wastes the cache.

**Starter:**

```go
package main

import (
    "bytes"
    "encoding/json"
    "sync"
)

// TODO: pool a {buf, enc} pair created together
// TODO: marshal(v) — borrow, encode, copy out, cap-checked Put
```

**Hints:**

- Pool a *pair* — `{buf, enc}` — created together in `New`. Pooling just the buffer forces a new Encoder per call.
- `enc.Encode(v)` writes a trailing newline. Strip if you do not want it.
- `enc.SetEscapeHTML(false)` is the common API choice; set it once in `New`.

<details><summary>Reference solution</summary>

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "sync"
)

const maxBufCap = 64 << 10

// encState bundles a buffer with its encoder. Pooling just the buffer
// would force a new Encoder per call, throwing away the type cache.
type encState struct {
    buf *bytes.Buffer
    enc *json.Encoder
}

var encPool = sync.Pool{
    New: func() any {
        buf := new(bytes.Buffer)
        enc := json.NewEncoder(buf)
        // Senior decision: configure once at New. The encoder is reused
        // with the same settings on every borrow.
        enc.SetEscapeHTML(false)
        return &encState{buf: buf, enc: enc}
    },
}

func marshal(v any) ([]byte, error) {
    st := encPool.Get().(*encState)
    defer putState(st)
    st.buf.Reset()
    if err := st.enc.Encode(v); err != nil {
        return nil, fmt.Errorf("marshal: %w", err)
    }
    b := st.buf.Bytes()
    if n := len(b); n > 0 && b[n-1] == '\n' {
        b = b[:n-1]
    }
    // Senior decision: copy out. The pool reclaims st.buf next.
    out := make([]byte, len(b))
    copy(out, b)
    return out, nil
}

func putState(st *encState) {
    if st.buf.Cap() > maxBufCap {
        return
    }
    encPool.Put(st)
}

func main() {
    type User struct {
        ID   int      `json:"id"`
        Name string   `json:"name"`
        Tags []string `json:"tags,omitempty"`
    }
    for _, u := range []User{{1, "alice", []string{"admin"}}, {2, "bob", nil}} {
        b, _ := marshal(u)
        fmt.Println(string(b))
    }
}
```

</details>

---

### Task 9 (I) — Typed generic pool (Go 1.18+)

**Goal:** Wrap `sync.Pool` with a generic helper. `Pool[T].Get() *T` returns a typed pointer; `Put(*T)` resets and returns. Internally still `sync.Pool`, but the API is type-safe.

**Starter:**

```go
package main

import "sync"

type Pool[T any] struct {
    inner sync.Pool
    reset func(*T)
}

// TODO: NewPool, Get, Put
// TODO: demo with a Request type holding a slice + map
```

**Hints:**

- `sync.Pool.New` must return `any`; wrap the user's `newFn` to do the conversion.
- The reset function is a constructor parameter — the caller knows how to clean the type.
- Calling `reset` on Put (not Get) means borrowers always receive a clean object.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

// Senior decision: a typed wrapper that keeps sync.Pool's per-P fast
// path and adds (a) compile-time type safety, (b) a Reset hook so the
// user does not have to remember it on Get.
type Pool[T any] struct {
    inner sync.Pool
    reset func(*T)
}

func NewPool[T any](newFn func() *T, resetFn func(*T)) *Pool[T] {
    return &Pool[T]{
        inner: sync.Pool{New: func() any { return newFn() }},
        reset: resetFn,
    }
}

func (p *Pool[T]) Get() *T { return p.inner.Get().(*T) }

func (p *Pool[T]) Put(x *T) {
    if p.reset != nil {
        p.reset(x)
    }
    p.inner.Put(x)
}

type Request struct {
    Headers map[string]string
    Body    []byte
}

func newRequest() *Request {
    return &Request{Headers: make(map[string]string, 16), Body: make([]byte, 0, 4096)}
}

func resetRequest(r *Request) {
    for k := range r.Headers {
        delete(r.Headers, k)
    }
    r.Body = r.Body[:0]
}

var reqPool = NewPool(newRequest, resetRequest)

func main() {
    r1 := reqPool.Get()
    r1.Headers["path"] = "/api/orders"
    r1.Body = append(r1.Body, []byte(`{"page":1}`)...)
    fmt.Printf("r1=%p body=%s\n", r1, r1.Body)
    reqPool.Put(r1)
    r2 := reqPool.Get()
    fmt.Printf("r2=%p headers=%d body-len=%d cap=%d\n",
        r2, len(r2.Headers), len(r2.Body), cap(r2.Body))
    reqPool.Put(r2)
}
```

</details>

---

### Task 10 (A) — Connection pool with `chan *Conn`, dial-on-demand

**Goal:** Step beyond `sync.Pool`. A real connection pool: a buffered channel of `*Conn`, dial-on-demand fallback when empty, fixed max size. `sync.Pool` is unsuitable for connections — it can evict during GC. A `chan *Conn` cannot.

**Starter:**

```go
package main

import (
    "context"
    "sync"
)

type Conn struct { ID int; Closed bool }

type Pool struct {
    mu      sync.Mutex
    idle    chan *Conn
    open    int
    max     int
    dial    func(ctx context.Context) (*Conn, error)
}

// TODO: New, Get(ctx), Put(c), Close
```

**Hints:**

- `Get` is a select on `<-idle`, dial-if-under-max, and `ctx.Done()`.
- `open` (checked-out + idle) needs the mutex. The channel buffer alone only counts idle.
- `Put` to channel if room; otherwise close the connection.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type Conn struct {
    ID     int
    Closed bool
}

func (c *Conn) Close() { c.Closed = true }

type Pool struct {
    mu      sync.Mutex
    idle    chan *Conn
    open    int
    max     int
    closed  bool
    dial    func(ctx context.Context) (*Conn, error)
}

var ErrPoolClosed = errors.New("pool: closed")

func NewPool(max int, dial func(ctx context.Context) (*Conn, error)) *Pool {
    return &Pool{idle: make(chan *Conn, max), max: max, dial: dial}
}

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    p.mu.Lock()
    if p.closed {
        p.mu.Unlock()
        return nil, ErrPoolClosed
    }
    p.mu.Unlock()
    // Senior decision: try non-blocking idle first. Otherwise a fresh
    // request would wait for a free conn even when we could dial cheaply.
    select {
    case c := <-p.idle:
        return c, nil
    default:
    }
    p.mu.Lock()
    if p.open < p.max {
        p.open++
        p.mu.Unlock()
        c, err := p.dial(ctx)
        if err != nil {
            p.mu.Lock()
            p.open--
            p.mu.Unlock()
            return nil, fmt.Errorf("dial: %w", err)
        }
        return c, nil
    }
    p.mu.Unlock()
    select {
    case c := <-p.idle:
        return c, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}

func (p *Pool) Put(c *Conn) {
    if c == nil {
        return
    }
    if c.Closed {
        p.mu.Lock()
        p.open--
        p.mu.Unlock()
        return
    }
    select {
    case p.idle <- c:
    default:
        c.Close()
        p.mu.Lock()
        p.open--
        p.mu.Unlock()
    }
}

func (p *Pool) Close() {
    p.mu.Lock()
    if p.closed {
        p.mu.Unlock()
        return
    }
    p.closed = true
    close(p.idle)
    p.mu.Unlock()
    for c := range p.idle {
        c.Close()
    }
}

var nextID atomic.Int64

func fakeDial(ctx context.Context) (*Conn, error) {
    select {
    case <-time.After(5 * time.Millisecond):
        return &Conn{ID: int(nextID.Add(1))}, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}

func main() {
    p := NewPool(3, fakeDial)
    defer p.Close()
    ctx := context.Background()
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            c, err := p.Get(ctx)
            if err != nil {
                fmt.Printf("w%d err: %v\n", i, err)
                return
            }
            defer p.Put(c)
            time.Sleep(20 * time.Millisecond)
            fmt.Printf("w%d used conn id=%d\n", i, c.ID)
        }(i)
    }
    wg.Wait()
}
```

</details>

---

### Task 11 (A) — Health-checked connection pool

**Goal:** Add a `Health(c *Conn) error` callback. Before handing out, check the connection. If broken, close it, decrement count, dial fresh. Bound retries. Skip the check on "hot" connections.

**Starter:**

```go
package main

// Reuse task 10. Add:
// TODO: a Health func in the Pool
// TODO: a Get loop that re-dials on health failure, up to N attempts
// TODO: skipIfFresh window so we do not check on every Get
```

**Hints:**

- Health check should be cheap — a ping with a tight timeout, not a full round-trip.
- Bound the retry loop. A networkwide blip could otherwise loop forever.
- Skip the check on connections used within the last few hundred ms.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type Conn struct {
    ID       int
    Closed   bool
    LastUsed time.Time
    Broken   bool
}

func (c *Conn) Close() { c.Closed = true }

type Pool struct {
    mu          sync.Mutex
    idle        chan *Conn
    open        int
    max         int
    closed      bool
    dial        func(ctx context.Context) (*Conn, error)
    health      func(*Conn) error
    skipIfFresh time.Duration
}

func NewPool(max int, dial func(context.Context) (*Conn, error), h func(*Conn) error) *Pool {
    return &Pool{
        idle: make(chan *Conn, max), max: max, dial: dial, health: h,
        skipIfFresh: 500 * time.Millisecond,
    }
}

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    const maxRetries = 3
    for attempt := 0; attempt < maxRetries; attempt++ {
        c, err := p.getOne(ctx)
        if err != nil {
            return nil, err
        }
        // Senior decision: skip health check on hot conns. Check has a
        // cost (a round-trip in real life); a conn used 50ms ago is
        // very likely still alive.
        if time.Since(c.LastUsed) < p.skipIfFresh {
            return c, nil
        }
        if err := p.health(c); err == nil {
            return c, nil
        }
        c.Close()
        p.mu.Lock()
        p.open--
        p.mu.Unlock()
    }
    return nil, errors.New("pool: gave up after retries")
}

func (p *Pool) getOne(ctx context.Context) (*Conn, error) {
    select {
    case c := <-p.idle:
        return c, nil
    default:
    }
    p.mu.Lock()
    if p.open < p.max {
        p.open++
        p.mu.Unlock()
        c, err := p.dial(ctx)
        if err != nil {
            p.mu.Lock()
            p.open--
            p.mu.Unlock()
            return nil, err
        }
        return c, nil
    }
    p.mu.Unlock()
    select {
    case c := <-p.idle:
        return c, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}

func (p *Pool) Put(c *Conn) {
    if c == nil || c.Closed || c.Broken {
        if c != nil {
            p.mu.Lock()
            p.open--
            p.mu.Unlock()
        }
        return
    }
    c.LastUsed = time.Now()
    select {
    case p.idle <- c:
    default:
        c.Close()
        p.mu.Lock()
        p.open--
        p.mu.Unlock()
    }
}

var nextID atomic.Int64

func main() {
    p := NewPool(3,
        func(ctx context.Context) (*Conn, error) { return &Conn{ID: int(nextID.Add(1)), LastUsed: time.Now()}, nil },
        func(c *Conn) error {
            if c.Broken {
                return errors.New("broken")
            }
            return nil
        },
    )
    ctx := context.Background()
    c1, _ := p.Get(ctx)
    c1.Broken = true
    c1.LastUsed = time.Now().Add(-2 * time.Second) // force a real check next time
    p.idle <- c1
    p.mu.Lock()
    p.open++ // cheat past Put for the demo
    p.mu.Unlock()
    c2, _ := p.Get(ctx)
    fmt.Println("got fresh:", c2.ID, "(broken one discarded)")
}
```

</details>

---

### Task 12 (A) — Conn pool with max-lifetime + max-idle-time

**Goal:** Add `MaxLifetime` (close even-healthy conns after N) and `MaxIdleTime` (close conns idle for too long). Add a janitor goroutine that sweeps. Every real DB driver does this — guards against LB silent kills and against accumulated idle conns.

**Starter:**

```go
package main

// Continue from task 11. Add:
// TODO: CreatedAt on Conn; PoolConfig{MaxLifetime, MaxIdleTime}
// TODO: janitor goroutine sweeping idle conns on a ticker
// TODO: Get rejects conns past MaxLifetime
```

**Hints:**

- Janitor tick interval ~ `MaxIdleTime / 4`. Frequent enough to catch expiries, infrequent enough not to thrash.
- Enforce MaxLifetime even on Get: a 2-hour conn might still pass health but should be recycled.
- `Stop` the janitor on Close — leaking a goroutine in a long-running service eventually hurts.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type Conn struct {
    ID        int
    CreatedAt time.Time
    LastUsed  time.Time
    Closed    bool
}

func (c *Conn) Close() { c.Closed = true }

type Config struct {
    Max         int
    MaxLifetime time.Duration
    MaxIdleTime time.Duration
}

type Pool struct {
    mu      sync.Mutex
    idle    chan *Conn
    open    int
    cfg     Config
    closed  bool
    dial    func(ctx context.Context) (*Conn, error)
    stopJan chan struct{}
    janDone chan struct{}
}

func NewPool(cfg Config, dial func(context.Context) (*Conn, error)) *Pool {
    p := &Pool{
        idle: make(chan *Conn, cfg.Max), cfg: cfg, dial: dial,
        stopJan: make(chan struct{}), janDone: make(chan struct{}),
    }
    go p.janitor()
    return p
}

// Senior decision: the janitor sweeps idle conns and closes ones over
// MaxIdleTime or MaxLifetime. It does NOT touch checked-out conns —
// they may be mid-query.
func (p *Pool) janitor() {
    defer close(p.janDone)
    interval := p.cfg.MaxIdleTime / 4
    if interval < time.Second {
        interval = time.Second
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-p.stopJan:
            return
        case <-t.C:
            p.sweep()
        }
    }
}

func (p *Pool) sweep() {
    now := time.Now()
    var keep []*Conn
loop:
    for {
        select {
        case c := <-p.idle:
            if now.Sub(c.LastUsed) > p.cfg.MaxIdleTime || now.Sub(c.CreatedAt) > p.cfg.MaxLifetime {
                c.Close()
                p.mu.Lock()
                p.open--
                p.mu.Unlock()
            } else {
                keep = append(keep, c)
            }
        default:
            break loop
        }
    }
    for _, c := range keep {
        p.idle <- c
    }
}

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    for {
        c, err := p.getOne(ctx)
        if err != nil {
            return nil, err
        }
        // Senior decision: enforce lifetime cap on Get. Cheap, guarantees
        // a hot conn cannot survive past MaxLifetime.
        if time.Since(c.CreatedAt) > p.cfg.MaxLifetime {
            c.Close()
            p.mu.Lock()
            p.open--
            p.mu.Unlock()
            continue
        }
        return c, nil
    }
}

func (p *Pool) getOne(ctx context.Context) (*Conn, error) {
    select {
    case c := <-p.idle:
        return c, nil
    default:
    }
    p.mu.Lock()
    if p.open < p.cfg.Max {
        p.open++
        p.mu.Unlock()
        c, err := p.dial(ctx)
        if err != nil {
            p.mu.Lock()
            p.open--
            p.mu.Unlock()
            return nil, err
        }
        c.CreatedAt = time.Now()
        c.LastUsed = c.CreatedAt
        return c, nil
    }
    p.mu.Unlock()
    select {
    case c := <-p.idle:
        return c, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}

func (p *Pool) Put(c *Conn) {
    if c == nil || c.Closed {
        if c != nil {
            p.mu.Lock()
            p.open--
            p.mu.Unlock()
        }
        return
    }
    c.LastUsed = time.Now()
    select {
    case p.idle <- c:
    default:
        c.Close()
        p.mu.Lock()
        p.open--
        p.mu.Unlock()
    }
}

func (p *Pool) Close() {
    p.mu.Lock()
    p.closed = true
    p.mu.Unlock()
    close(p.stopJan)
    <-p.janDone
    close(p.idle)
    for c := range p.idle {
        c.Close()
    }
}

var nextID atomic.Int64

func main() {
    cfg := Config{Max: 3, MaxLifetime: 30 * time.Second, MaxIdleTime: 2 * time.Second}
    p := NewPool(cfg, func(ctx context.Context) (*Conn, error) {
        return &Conn{ID: int(nextID.Add(1))}, nil
    })
    defer p.Close()
    ctx := context.Background()
    for i := 0; i < 3; i++ {
        c, _ := p.Get(ctx)
        fmt.Println("checked out:", c.ID)
        p.Put(c)
    }
    time.Sleep(3500 * time.Millisecond)
    c, _ := p.Get(ctx)
    fmt.Println("after sweep, got:", c.ID, "(old ones swept)")
    p.Put(c)
    _ = errors.New
}
```

</details>

---

### Task 13 (A) — Pool exhaustion: queue vs fail-fast

**Goal:** Add a `WaitPolicy`. Two modes: `PolicyQueue` (Get blocks until a conn is free or ctx fires) and `PolicyFailFast` (returns `ErrPoolExhausted` immediately when at cap). Real systems toggle these depending on upstream traffic shape.

**Starter:**

```go
package main

// Continue from task 12.
type WaitPolicy int

const (
    PolicyQueue WaitPolicy = iota
    PolicyFailFast
)

// TODO: WaitPolicy on the config
// TODO: in the at-cap branch, choose between blocking and ErrPoolExhausted
```

**Hints:**

- Queue is the default; fail-fast is opt-in for latency-sensitive paths (think payments under tight SLAs).
- A bounded wait (`WaitTimeout`) sits between the two: "block for up to 50ms, then fail".
- Surface this in metrics: `pool_exhaustion_total` is one of the most useful production gauges.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type WaitPolicy int

const (
    PolicyQueue WaitPolicy = iota
    PolicyFailFast
)

var (
    ErrPoolClosed    = errors.New("pool: closed")
    ErrPoolExhausted = errors.New("pool: exhausted")
)

type Conn struct {
    ID     int
    Closed bool
}

func (c *Conn) Close() { c.Closed = true }

type Config struct {
    Max         int
    WaitPolicy  WaitPolicy
    WaitTimeout time.Duration
}

type Pool struct {
    mu          sync.Mutex
    idle        chan *Conn
    open        int
    cfg         Config
    dial        func(ctx context.Context) (*Conn, error)
    exhausted   atomic.Int64
}

func NewPool(cfg Config, dial func(context.Context) (*Conn, error)) *Pool {
    return &Pool{idle: make(chan *Conn, cfg.Max), cfg: cfg, dial: dial}
}

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    select {
    case c := <-p.idle:
        return c, nil
    default:
    }
    p.mu.Lock()
    if p.open < p.cfg.Max {
        p.open++
        p.mu.Unlock()
        return p.dial(ctx)
    }
    p.mu.Unlock()

    switch p.cfg.WaitPolicy {
    case PolicyFailFast:
        // Senior decision: fail-fast surfaces exhaustion to the caller
        // immediately, letting them load-shed or return 503. Pair with
        // a circuit breaker upstream.
        p.exhausted.Add(1)
        return nil, ErrPoolExhausted
    case PolicyQueue:
        waitCtx := ctx
        if p.cfg.WaitTimeout > 0 {
            var cancel context.CancelFunc
            waitCtx, cancel = context.WithTimeout(ctx, p.cfg.WaitTimeout)
            defer cancel()
        }
        select {
        case c := <-p.idle:
            return c, nil
        case <-waitCtx.Done():
            p.exhausted.Add(1)
            return nil, fmt.Errorf("%w: %v", ErrPoolExhausted, waitCtx.Err())
        }
    }
    return nil, errors.New("pool: unknown wait policy")
}

func (p *Pool) Put(c *Conn) {
    if c == nil || c.Closed {
        if c != nil {
            p.mu.Lock()
            p.open--
            p.mu.Unlock()
        }
        return
    }
    select {
    case p.idle <- c:
    default:
        c.Close()
        p.mu.Lock()
        p.open--
        p.mu.Unlock()
    }
}

func (p *Pool) Exhaustions() int64 { return p.exhausted.Load() }

func main() {
    var nextID atomic.Int64
    dial := func(ctx context.Context) (*Conn, error) {
        return &Conn{ID: int(nextID.Add(1))}, nil
    }
    p := NewPool(Config{Max: 2, WaitPolicy: PolicyFailFast}, dial)
    ctx := context.Background()
    c1, _ := p.Get(ctx)
    c2, _ := p.Get(ctx)
    _, err := p.Get(ctx)
    fmt.Println("fail-fast 3rd:", err, "is-exhausted:", errors.Is(err, ErrPoolExhausted))
    p.Put(c1)
    p.Put(c2)

    p2 := NewPool(Config{Max: 2, WaitPolicy: PolicyQueue, WaitTimeout: 200 * time.Millisecond}, dial)
    c3, _ := p2.Get(ctx)
    c4, _ := p2.Get(ctx)
    t0 := time.Now()
    _, err = p2.Get(ctx)
    fmt.Printf("queue 3rd: waited=%v err=%v\n", time.Since(t0), err)
    p2.Put(c3)
    p2.Put(c4)
    fmt.Println("exhaustions:", p2.Exhaustions())
}
```

</details>

---

### Task 14 (A) — Pool metrics

**Goal:** Expose a `Stats()` snapshot: open, idle, in-use, total dials, total puts, exhaustions, health-check failures. Wire to `expvar`. Operations needs these to set alerts and right-size `MaxSize`.

**Starter:**

```go
package main

import "sync/atomic"

type Stats struct {
    Open, Idle, InUse int
    Dials, Puts       int64
    Exhaustions       int64
    HealthFails       int64
}

// TODO: extend Pool with atomic counters
// TODO: Stats() — non-blocking snapshot
// TODO: register with expvar at /debug/vars
```

**Hints:**

- Counters that only increase: `atomic.Int64`. The mutex-guarded `open` gives gauges.
- `expvar.Publish("pool", expvar.Func(...))` is enough for a quick endpoint.
- Document what "open" means (checked-out + idle? only checked-out?).

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "encoding/json"
    "errors"
    "expvar"
    "fmt"
    "net/http"
    "sync"
    "sync/atomic"
    "time"
)

type Conn struct {
    ID     int
    Closed bool
}

func (c *Conn) Close() { c.Closed = true }

type Stats struct {
    Open        int   `json:"open"` // checked-out + idle
    Idle        int   `json:"idle"`
    InUse       int   `json:"in_use"`
    Dials       int64 `json:"dials_total"`
    Puts        int64 `json:"puts_total"`
    Exhaustions int64 `json:"exhaustions_total"`
    HealthFails int64 `json:"health_check_fails_total"`
}

type Pool struct {
    mu          sync.Mutex
    idle        chan *Conn
    open        int
    max         int
    dial        func(context.Context) (*Conn, error)
    health      func(*Conn) error
    dials       atomic.Int64
    puts        atomic.Int64
    exhausted   atomic.Int64
    healthFails atomic.Int64
}

var ErrPoolExhausted = errors.New("pool: exhausted")

func NewPool(max int, dial func(context.Context) (*Conn, error), h func(*Conn) error) *Pool {
    return &Pool{idle: make(chan *Conn, max), max: max, dial: dial, health: h}
}

func (p *Pool) Stats() Stats {
    p.mu.Lock()
    open := p.open
    p.mu.Unlock()
    idle := len(p.idle)
    return Stats{
        Open: open, Idle: idle, InUse: open - idle,
        Dials:       p.dials.Load(),
        Puts:        p.puts.Load(),
        Exhaustions: p.exhausted.Load(),
        HealthFails: p.healthFails.Load(),
    }
}

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    select {
    case c := <-p.idle:
        if err := p.health(c); err != nil {
            p.healthFails.Add(1)
            c.Close()
            p.mu.Lock()
            p.open--
            p.mu.Unlock()
        } else {
            return c, nil
        }
    default:
    }
    p.mu.Lock()
    if p.open < p.max {
        p.open++
        p.mu.Unlock()
        c, err := p.dial(ctx)
        if err != nil {
            p.mu.Lock()
            p.open--
            p.mu.Unlock()
            return nil, err
        }
        p.dials.Add(1)
        return c, nil
    }
    p.mu.Unlock()
    select {
    case c := <-p.idle:
        return c, nil
    case <-ctx.Done():
        p.exhausted.Add(1)
        return nil, fmt.Errorf("%w: %v", ErrPoolExhausted, ctx.Err())
    }
}

func (p *Pool) Put(c *Conn) {
    if c == nil {
        return
    }
    p.puts.Add(1)
    if c.Closed {
        p.mu.Lock()
        p.open--
        p.mu.Unlock()
        return
    }
    select {
    case p.idle <- c:
    default:
        c.Close()
        p.mu.Lock()
        p.open--
        p.mu.Unlock()
    }
}

func main() {
    var nextID atomic.Int64
    p := NewPool(4,
        func(ctx context.Context) (*Conn, error) { return &Conn{ID: int(nextID.Add(1))}, nil },
        func(c *Conn) error { return nil },
    )
    // Senior decision: publish as expvar so ops can scrape without
    // adding a Prometheus dep. Swap for GaugeFunc if you have prom.
    expvar.Publish("conn_pool", expvar.Func(func() any { return p.Stats() }))
    ctx := context.Background()
    var conns []*Conn
    for i := 0; i < 3; i++ {
        c, _ := p.Get(ctx)
        conns = append(conns, c)
    }
    for _, c := range conns {
        p.Put(c)
    }
    b, _ := json.MarshalIndent(p.Stats(), "", "  ")
    fmt.Println(string(b))
    go func() { _ = http.ListenAndServe("127.0.0.1:9090", nil) }()
    time.Sleep(50 * time.Millisecond)
    fmt.Println("expvar at http://127.0.0.1:9090/debug/vars")
}
```

</details>

---

### Task 15 (S) — Mini pgx-style pool

**Goal:** Combine everything: a generic connection pool with dial-on-demand, health checks, max-lifetime, max-idle-time, configurable wait policy, metrics, graceful shutdown, and a clean public API. The result should look and behave like a stripped-down `pgxpool.Pool` and be reusable for any protocol by swapping dial + health.

**Starter:**

```go
package main

import (
    "context"
    "io"
)

// TODO: Pool[C io.Closer] generic over the conn type
// TODO: Config{MaxSize, MinIdle, MaxLifetime, MaxIdleTime, WaitTimeout, Dial, Health}
// TODO: Acquire(ctx) (*PooledConn[C], ReleaseFunc, error)
// TODO: Stats, Close, janitor with MinIdle re-warm
```

**Hints:**

- Acquire returns a `release` closure (not a separate Put). Pgx idiom: `defer release()` makes "remember to return" the caller's responsibility through `defer`. Hard to skip.
- `MinIdle` is the inverse of MaxIdle: keep at least N conns warm so the first request after a quiet period doesn't pay the dial cost.
- Janitor: idle sweep, age sweep, re-warm to MinIdle.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "io"
    "sync"
    "sync/atomic"
    "time"
)

var (
    ErrPoolClosed    = errors.New("minipool: closed")
    ErrPoolExhausted = errors.New("minipool: exhausted")
)

type PooledConn[C io.Closer] struct {
    Conn      C
    CreatedAt time.Time
    LastUsed  time.Time
    broken    bool
}

func (p *PooledConn[C]) Break() { p.broken = true }

type Config struct {
    MaxSize     int
    MinIdle     int
    MaxLifetime time.Duration
    MaxIdleTime time.Duration
    WaitTimeout time.Duration
    Dial        func(ctx context.Context) (any, error)
    Health      func(any) error
}

type Stats struct {
    Open, Idle, InUse int
    Dials, Puts       int64
    Exhaustions       int64
    HealthFails       int64
}

type Pool[C io.Closer] struct {
    mu      sync.Mutex
    idle    chan *PooledConn[C]
    open    int
    closed  bool
    cfg     Config
    stopJan chan struct{}
    janDone chan struct{}
    dials       atomic.Int64
    puts        atomic.Int64
    exhausted   atomic.Int64
    healthFails atomic.Int64
}

type ReleaseFunc func()

func NewPool[C io.Closer](cfg Config) *Pool[C] {
    if cfg.MaxSize <= 0 {
        cfg.MaxSize = 10
    }
    if cfg.MaxLifetime <= 0 {
        cfg.MaxLifetime = 30 * time.Minute
    }
    if cfg.MaxIdleTime <= 0 {
        cfg.MaxIdleTime = 5 * time.Minute
    }
    p := &Pool[C]{
        idle: make(chan *PooledConn[C], cfg.MaxSize), cfg: cfg,
        stopJan: make(chan struct{}), janDone: make(chan struct{}),
    }
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    for i := 0; i < cfg.MinIdle; i++ {
        pc, err := p.dialOne(ctx)
        if err != nil {
            continue
        }
        p.idle <- pc
    }
    go p.janitor()
    return p
}

func (p *Pool[C]) dialOne(ctx context.Context) (*PooledConn[C], error) {
    raw, err := p.cfg.Dial(ctx)
    if err != nil {
        return nil, err
    }
    c, ok := raw.(C)
    if !ok {
        return nil, fmt.Errorf("minipool: Dial returned %T", raw)
    }
    p.dials.Add(1)
    p.mu.Lock()
    p.open++
    p.mu.Unlock()
    now := time.Now()
    return &PooledConn[C]{Conn: c, CreatedAt: now, LastUsed: now}, nil
}

// Acquire is the only borrow path. Always pair with `defer release()`.
func (p *Pool[C]) Acquire(ctx context.Context) (*PooledConn[C], ReleaseFunc, error) {
    p.mu.Lock()
    if p.closed {
        p.mu.Unlock()
        return nil, nil, ErrPoolClosed
    }
    p.mu.Unlock()
    var pc *PooledConn[C]
    var err error
    select {
    case pc = <-p.idle:
    default:
    }
    if pc == nil {
        p.mu.Lock()
        if p.open < p.cfg.MaxSize {
            p.mu.Unlock()
            pc, err = p.dialOne(ctx)
            if err != nil {
                return nil, nil, err
            }
        } else {
            p.mu.Unlock()
            waitCtx := ctx
            if p.cfg.WaitTimeout > 0 {
                var cancel context.CancelFunc
                waitCtx, cancel = context.WithTimeout(ctx, p.cfg.WaitTimeout)
                defer cancel()
            }
            select {
            case pc = <-p.idle:
            case <-waitCtx.Done():
                p.exhausted.Add(1)
                return nil, nil, fmt.Errorf("%w: %v", ErrPoolExhausted, waitCtx.Err())
            }
        }
    }
    // Senior decision: enforce MaxLifetime here, before handing out.
    if time.Since(pc.CreatedAt) > p.cfg.MaxLifetime {
        p.discard(pc)
        return p.Acquire(ctx)
    }
    // Health check, skip on hot conns.
    if time.Since(pc.LastUsed) > 500*time.Millisecond {
        if hErr := p.cfg.Health(any(pc.Conn)); hErr != nil {
            p.healthFails.Add(1)
            p.discard(pc)
            return p.Acquire(ctx)
        }
    }
    pc.LastUsed = time.Now()
    return pc, func() { p.release(pc) }, nil
}

func (p *Pool[C]) release(pc *PooledConn[C]) {
    p.puts.Add(1)
    if pc.broken {
        p.discard(pc)
        return
    }
    pc.LastUsed = time.Now()
    p.mu.Lock()
    if p.closed {
        p.mu.Unlock()
        _ = pc.Conn.Close()
        return
    }
    p.mu.Unlock()
    select {
    case p.idle <- pc:
    default:
        p.discard(pc)
    }
}

func (p *Pool[C]) discard(pc *PooledConn[C]) {
    _ = pc.Conn.Close()
    p.mu.Lock()
    p.open--
    p.mu.Unlock()
}

func (p *Pool[C]) janitor() {
    defer close(p.janDone)
    interval := p.cfg.MaxIdleTime / 4
    if interval < time.Second {
        interval = time.Second
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-p.stopJan:
            return
        case <-t.C:
            p.sweep()
            p.refillMinIdle()
        }
    }
}

func (p *Pool[C]) sweep() {
    now := time.Now()
    var keep []*PooledConn[C]
loop:
    for {
        select {
        case pc := <-p.idle:
            if now.Sub(pc.LastUsed) > p.cfg.MaxIdleTime || now.Sub(pc.CreatedAt) > p.cfg.MaxLifetime {
                p.discard(pc)
            } else {
                keep = append(keep, pc)
            }
        default:
            break loop
        }
    }
    for _, pc := range keep {
        p.idle <- pc
    }
}

func (p *Pool[C]) refillMinIdle() {
    p.mu.Lock()
    need := p.cfg.MinIdle - len(p.idle)
    room := p.cfg.MaxSize - p.open
    if need > room {
        need = room
    }
    p.mu.Unlock()
    if need <= 0 {
        return
    }
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    for i := 0; i < need; i++ {
        pc, err := p.dialOne(ctx)
        if err != nil {
            return
        }
        p.idle <- pc
    }
}

func (p *Pool[C]) Stats() Stats {
    p.mu.Lock()
    open := p.open
    p.mu.Unlock()
    idle := len(p.idle)
    return Stats{Open: open, Idle: idle, InUse: open - idle,
        Dials: p.dials.Load(), Puts: p.puts.Load(),
        Exhaustions: p.exhausted.Load(), HealthFails: p.healthFails.Load()}
}

func (p *Pool[C]) Close() {
    p.mu.Lock()
    if p.closed {
        p.mu.Unlock()
        return
    }
    p.closed = true
    p.mu.Unlock()
    close(p.stopJan)
    <-p.janDone
    close(p.idle)
    for pc := range p.idle {
        _ = pc.Conn.Close()
    }
}

type fakeConn struct {
    id     int
    broken bool
}

func (f *fakeConn) Close() error { return nil }

var nextID atomic.Int64

func main() {
    cfg := Config{
        MaxSize: 5, MinIdle: 2,
        MaxLifetime: time.Minute, MaxIdleTime: 3 * time.Second,
        WaitTimeout: 500 * time.Millisecond,
        Dial: func(ctx context.Context) (any, error) {
            return &fakeConn{id: int(nextID.Add(1))}, nil
        },
        Health: func(c any) error {
            if c.(*fakeConn).broken {
                return errors.New("broken")
            }
            return nil
        },
    }
    p := NewPool[*fakeConn](cfg)
    defer p.Close()
    ctx := context.Background()
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            pc, release, err := p.Acquire(ctx)
            if err != nil {
                fmt.Printf("w%d: %v\n", i, err)
                return
            }
            defer release()
            time.Sleep(50 * time.Millisecond)
            fmt.Printf("w%d used conn %d\n", i, pc.Conn.id)
        }(i)
    }
    wg.Wait()
    time.Sleep(4 * time.Second)
    fmt.Printf("stats: %+v\n", p.Stats())
}
```

</details>

---

## 4. How to grade yourself

Rate yourself honestly against these 12 items after finishing all 15 tasks. Senior: 10+. Strong middle: 7-9. Junior: 3-6.

1. **You know when pooling helps and when it does not.** You can articulate the three conditions (hot path, costly init, scoped lifecycle) and name at least three cases where the answer is "do not pool".
2. **You always Reset before use.** Internalized — you reach for `buf.Reset()` automatically the line after `pool.Get()`.
3. **You cap buffer size on Put.** You know `encoding/json` does this. You picked a defensible cap for your workload and can justify it.
4. **You cleared maps/slices in place rather than re-allocating.** You know `r.Body = r.Body[:0]` is right and `r.Body = []byte{}` is wrong, and can explain why in one sentence.
5. **You benchmarked.** Ran `go test -bench=. -benchmem` on at least three tasks and read `B/op` and `allocs/op`, not just `ns/op`.
6. **You do not use `sync.Pool` for connections.** You know why (GC eviction, no size cap, no health check) and reached for `chan *Conn` instead.
7. **You have a health check.** Your connection pool does not blindly hand out stale TCP sessions; it checks before handing out and re-dials on failure.
8. **You bound retries.** Your health-checked Get does not loop forever when every connection is broken — it gives up after N attempts with a clear error.
9. **You have a max-lifetime cap.** You know that a healthy conn at minute 1 may be silently killed by an LB at minute 60, and you recycle proactively.
10. **You chose an exhaustion policy deliberately.** Queue, fail-fast, or bounded-wait — you picked one with the upstream traffic shape in mind, not by default.
11. **Your pool exposes metrics.** You can answer "how many connections does it have right now?" without a heap dump.
12. **Your pool shuts down cleanly.** No leaked goroutines, no leaked file descriptors, no panics on a second `Close()`.

---

## 5. Stretch challenges

### Stretch A — Multi-tier buffer pool

Three internal `sync.Pool`s, sized roughly by powers of two: small (up to 4 KB), medium (up to 64 KB), large (up to 1 MB). `Get(size)` picks the tier; `Put(b)` returns to the matching tier or drops if outsized. A 100 KB request does not pin a small-pool buffer, and a 100-byte request does not borrow a 1 MB one. Pattern used by `fasthttp` and `tcell`.

Acceptance: benchmark vs single-tier from task 5 on a jagged workload (90% small, 9% medium, 1% large). Multi-tier matches the small-case speed and uses 5-10x less peak resident memory.

### Stretch B — Sharded connection pool

N sub-pools (one per shard, sharded by `hash(key) % N`). Each shard has its own MaxSize and dial. How Redis Cluster clients and sharded read-replica pools work. API: `Acquire(ctx, key)`.

Acceptance: under uniform-key workload across 8 shards, one slow shard does not block the others. The other 7 keep serving.

### Stretch C — Failover pool

Wrap a primary pool with a "warm spare" secondary. If the primary's exhaustion count crosses a threshold within a sliding window, route to the secondary for K seconds, then probe the primary again. Bones of an active-passive HA pattern.

Acceptance: under a simulated 30-second outage of the primary backend, requests fail through to the secondary within 1 second of detection, and resume on the primary within 1 second of recovery. No lost requests.

---

## Further reading

- `sync.Pool` source: `src/sync/pool.go` — read the per-P fast path. ~300 lines, eye-opening.
- `encoding/json` — search for `encodeStatePool` and observe the cap check on Put.
- `database/sql/sql.go` — the stdlib reference pool. `connectionOpener`, `connectionRequest`, `release` are the core loops.
- `jackc/pgx` `pgxpool/pool.go` — closest production analog to task 15. Readable, well-commented.
- `valyala/fasthttp` — pools everything. Worth a read for aggressive-pooling style and multi-tier buffer pool.
- `golang/sync/errgroup` — complements worker-pool code; "wait for any error" group.
