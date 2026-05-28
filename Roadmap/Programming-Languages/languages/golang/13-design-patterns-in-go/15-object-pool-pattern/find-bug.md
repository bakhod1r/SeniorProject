# Object Pool — Find the Bug

## 1. How to use this file

Fifteen buggy Object-Pool snippets. Read each one, spot the defect in 30-60 seconds, then expand `<details>` for the answer. Every bug here has shown up in real Go production code — pools look like a five-line copy-paste, which is exactly why they regress so quietly. Pooling bugs rarely crash; they corrupt one response per million, leak a megabyte an hour, or silently disable themselves. The skill is reading `Get`/`Put` and asking: *what does the next borrower see, and what does the previous one still hold?*

---

## Bug 1 — Forgotten Reset()

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func renderUser(w http.ResponseWriter, u *User) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)

    buf.WriteString("name=" + u.Name + " email=" + u.Email)
    w.Write(buf.Bytes())
}
```

<details><summary>Answer</summary>

**Bug:** `buf.Reset()` is never called before writing. The borrowed buffer still contains the previous borrower's bytes, so the response is prefixed with whatever the previous request wrote. User A sees user B's email leak into their response body.

**Why it's subtle:** Local development never reproduces it — single-threaded usage hits `New`-fresh buffers. Failures appear only when a buffer cycles `Put` → `Get` under traffic.

**Spot in review:** Any `pool.Get()` that *writes* to the returned object without an explicit `Reset()` / `[:0]` / `clear()` first.

**Fix:** add `buf.Reset()` immediately after the `defer`:

```go
buf := bufPool.Get().(*bytes.Buffer)
defer bufPool.Put(buf)
buf.Reset()                          // first line after Get
```

**Why common:** Examples in articles often show pools used with fresh objects from `New`. The fact that `Reset` is part of the contract is implicit, and copy-pasted code drops the `Reset` line because "the buffer is empty, right?"
</details>

---

## Bug 2 — Get without Put

```go
var encoderPool = sync.Pool{
    New: func() any { return json.NewEncoder(io.Discard) },
}

func validate(payload map[string]any) error {
    enc := encoderPool.Get().(*json.Encoder)

    if err := enc.Encode(payload); err != nil {
        return fmt.Errorf("encode: %w", err)
    }
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** `validate` returns without ever calling `encoderPool.Put(enc)`. Each call drains one item; the next `Get` runs `New` again. The pool degenerates into "allocate every time, drop on the floor" — strictly worse than no pool, since the unused cache entries linger until GC.

**Why it's subtle:** No panic, no heap leak — each encoder is short-lived. The only symptom is "the pool isn't helping", invisible without a before/after benchmark.

**Spot in review:** Every `pool.Get()` needs a matching `pool.Put()` on every return path. The idiom is `Get` immediately followed by `defer Put`.

**Fix:** add `defer encoderPool.Put(enc)` immediately after `Get`.

**Why common:** Early returns multiply quickly. The author wrote `Put` at the end of the happy path; the first `if err != nil { return }` added later silently skips it.
</details>

---

## Bug 3 — Put without defer (panic path)

```go
func handle(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()

    body := mustDecodeJSON(r.Body)        // panics on malformed input
    buf.WriteString(body.User + ":" + body.Token)

    w.Write(buf.Bytes())
    bufPool.Put(buf)                       // only runs on success
}
```

<details><summary>Answer</summary>

**Bug:** `bufPool.Put(buf)` is on the final line, not deferred. If `mustDecodeJSON` panics, the buffer never returns to the pool. The pool slowly bleeds buffers on every malformed input; after a few hours of attackers sending garbage, every request allocates fresh.

**Why it's subtle:** The happy path works. Benchmarks pass. The leak only shows under adversarial or bug-triggering traffic, where it compounds quickly.

**Spot in review:** Any `pool.Put(x)` as a normal statement instead of `defer pool.Put(x)`. The defer guarantees the buffer returns on panic or early return.

**Fix:** move `Put` to a `defer` on the line after `Get`.

```go
buf := bufPool.Get().(*bytes.Buffer)
defer bufPool.Put(buf)
buf.Reset()
// ... rest unchanged ...
```

**Why common:** Single-line beginnings grow into multi-failure functions, but the `Put` stays where it was originally typed.
</details>

---

## Bug 4 — Pointer to pool internals after Put

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func renderToken(user string) []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.WriteString("user=")
    buf.WriteString(user)
    return buf.Bytes()                     // aliased to pooled buffer
}

func handler(w http.ResponseWriter, r *http.Request) {
    token := renderToken(r.URL.Query().Get("u"))
    w.Header().Set("X-Token", string(token))
    w.Write(token)                          // reads token after Put has run
}
```

<details><summary>Answer</summary>

**Bug:** `renderToken` returns `buf.Bytes()` — a slice aliasing the buffer's internal array. The deferred `Put` runs at return, so by the time `handler` reads `token`, the buffer is back in the pool. The next goroutine calls `Get`, `Reset`, writes — corrupting `token` mid-handler.

**Why it's subtle:** Looks like a clean borrow-return cycle. The bug is the slice lifetime — it outlives the borrow.

**Spot in review:** Any function that `Put`s a pooled buffer and returns `buf.Bytes()` or a sub-slice. Data must be copied before `Put` runs.

**Fix:** copy out of the pool before `Put` runs:

```go
defer bufPool.Put(buf)
buf.Reset()
buf.WriteString("user=")
buf.WriteString(user)
return append([]byte(nil), buf.Bytes()...)  // owned copy
```

**Why common:** `buf.Bytes()` looks like a getter; nothing in its signature hints "this is a window into a shared array". Surfaces only under concurrent traffic.
</details>

---

## Bug 5 — Buffer grows unbounded (no size cap)

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func encodeReport(records []Record) []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()

    enc := json.NewEncoder(buf)
    for _, r := range records {
        enc.Encode(r)
    }
    out := make([]byte, buf.Len())
    copy(out, buf.Bytes())
    return out
}
```

<details><summary>Answer</summary>

**Bug:** `Put` accepts the buffer regardless of size. A nightly 50 MB report fills the buffer; on `Put` the buffer goes back to the pool retaining that 50 MB array. Across 16 Ps, up to 800 MB of pooled memory holds a one-time spike. RSS climbs; nobody can find where the memory went.

**Why it's subtle:** Function correct, pool works, memory technically reclaimable on GC — but the next borrow re-anchors the giant buffer.

**Spot in review:** Any pool `Put` of a growable container (`*bytes.Buffer`, `[]byte`, `*strings.Builder`) without a size-based gate.

**Fix:**

```go
const maxPooledBuf = 64 << 10               // 64 KiB

func putBuf(b *bytes.Buffer) {
    if b.Cap() > maxPooledBuf {
        return                              // drop oversized; let GC reclaim
    }
    bufPool.Put(b)
}

defer putBuf(buf)
```

`encoding/json` does exactly this in its internal encoder pool. Pick a cap that fits 99% of real traffic; let the outliers re-allocate.

**Why common:** Naive pool examples never mention the cap. Until you've watched a heap profile climb after a single oversized request, the failure mode isn't intuitive.
</details>

---

## Bug 6 — Pooling a value type (not pointer)

```go
type Scratch struct {
    data [4096]byte
    n    int
}

var scratchPool = sync.Pool{
    New: func() any { return Scratch{} },   // value, not pointer
}

func process(input []byte) int {
    s := scratchPool.Get().(Scratch)        // copy out
    s.n = 0
    copy(s.data[:], input)
    n := work(s.data[:len(input)])
    s.n = n
    scratchPool.Put(s)                      // copy back
    return n
}
```

<details><summary>Answer</summary>

**Bug:** `sync.Pool` stores `interface{}`. Putting a value-type `Scratch` boxes it — heap allocation plus a 4 KB copy in; `Get` copies 4 KB back out. Every cycle does two copies and one heap alloc — strictly worse than `var s Scratch` on the stack. Worse, mutations live in the local copy, so `Put(s)` stores a snapshot — state that was supposed to be reset is carried forward.

**Why it's subtle:** Code compiles, tests pass, escape analysis is silent. The benchmark shows zero improvement and the developer concludes "pools don't help here".

**Spot in review:** `New: func() any { return T{} }` (value) instead of `return &T{}` (pointer). `staticcheck` flags this as `SA6002`.

**Fix:** return a pointer from `New`, assert to a pointer in `Get`, mutate through the pointer:

```go
New: func() any { return &Scratch{} },
// ...
s := scratchPool.Get().(*Scratch)
defer scratchPool.Put(s)
s.n = 0
```

**Why common:** Go's value/pointer fluidity hides the boxing cost; `vet` doesn't flag it.
</details>

---

## Bug 7 — sync.Pool for *grpc.ClientConn — evicted at GC

```go
var connPool = sync.Pool{
    New: func() any {
        c, err := grpc.Dial("svc:9000", grpc.WithInsecure())
        if err != nil { panic(err) }
        return c
    },
}

func call(ctx context.Context, req *Req) (*Resp, error) {
    c := connPool.Get().(*grpc.ClientConn)
    defer connPool.Put(c)
    return NewSvcClient(c).Do(ctx, req)
}
```

<details><summary>Answer</summary>

**Bug:** `sync.Pool` may evict any item at any GC. For `*bytes.Buffer` that's fine. For `*grpc.ClientConn` it's a disaster: `New` dials the upstream (30-200 ms), so every GC throws away connections and tail latency spikes on the first request after each GC. Evicted connections are *never closed* — `sync.Pool` just drops the reference — so you leak FDs until the process is killed. Bonus: `New`'s `panic(err)` on dial failure kills the calling goroutine.

**Why it's subtle:** Works in dev (no GC pressure, fast dial) and short load tests. Long-running production triggers GC and everything degrades.

**Spot in review:** `sync.Pool` of any kernel-FD resource (`net.Conn`, `*grpc.ClientConn`, `*sql.DB`, `*os.File`). These belong in typed pools with explicit eviction, health checks, and `Close`.

**Fix:** use a typed channel-pool — bounded size, explicit `Close` on overflow:

```go
type ConnPool struct {
    pool    chan *grpc.ClientConn
    factory func() (*grpc.ClientConn, error)
}

func (p *ConnPool) Get() (*grpc.ClientConn, error) {
    select {
    case c := <-p.pool: return c, nil
    default:            return p.factory()
    }
}

func (p *ConnPool) Put(c *grpc.ClientConn) {
    select {
    case p.pool <- c:
    default: c.Close()                       // pool full; close, don't drop
    }
}
```

For SQL, `database/sql.DB` implements all of this for you.

**Why common:** `sync.Pool` is the only "pool" most Go developers know. The GC-eviction caveat is buried in the docs.
</details>

---

## Bug 8 — Reset that reallocates ([]byte = make instead of [:0])

```go
type Encoder struct {
    buf []byte
}

func (e *Encoder) Reset() {
    e.buf = make([]byte, 0, 4096)            // fresh allocation each Reset
}

var encPool = sync.Pool{
    New: func() any { return &Encoder{buf: make([]byte, 0, 4096)} },
}

func encode(v any) []byte {
    e := encPool.Get().(*Encoder)
    defer encPool.Put(e)
    e.Reset()
    e.buf = appendJSON(e.buf, v)
    out := make([]byte, len(e.buf))
    copy(out, e.buf)
    return out
}
```

<details><summary>Answer</summary>

**Bug:** `Reset` does `e.buf = make(...)` — a fresh allocation. Every borrow throws away the previously grown backing array. The whole point of pooling — reusing the grown allocation — is silently undone. allocs/op stays at 1 per call, exactly as if there were no pool.

**Why it's subtle:** The function is called `Reset` and it does set length to zero. It's just that "reset" here means "throw it away" instead of "rewind". Without a benchmark vs the no-pool path, the regression hides.

**Spot in review:** Any `Reset` method on a pooled type that contains a `make(...)` call. The correct idiom is `s = s[:0]`, `clear(m)`, or `b.Reset()` on a `*bytes.Buffer`.

**Fix:** truncate, don't allocate. Slices use `s = s[:0]`; maps use `clear(m)` (Go 1.21+); `bytes.Buffer.Reset` does the right thing already.

```go
func (e *Encoder) Reset() {
    e.buf = e.buf[:0]                         // keep capacity, reset length
}
```

**Why common:** `make` is what new code starts with. When someone later adds `Reset`, they reach for the same `make` — not realizing "reset" in a pooled context means "preserve the allocation".
</details>

---

## Bug 9 — Worker pool blocked on unbuffered channel

```go
type WorkerPool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func New(workers int) *WorkerPool {
    p := &WorkerPool{jobs: make(chan func())}    // unbuffered
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for f := range p.jobs { f() }
        }()
    }
    return p
}

func (p *WorkerPool) Submit(f func()) { p.jobs <- f }      // blocks if all busy
```

<details><summary>Answer</summary>

**Bug:** `jobs` is unbuffered. `Submit` blocks until a worker is actively receiving. With N workers all busy, the (N+1)th `Submit` blocks indefinitely. The request hangs; the client retries; the retry hangs too. Callers can't tell the pool is saturated. Buffering with capacity N just delays the deadlock by N jobs — the real fix is a bounded queue *plus* a backpressure signal.

**Why it's subtle:** Unbuffered channels are idiomatic for handoffs. The failure mode "no worker ready" is modeled as "block forever".

**Spot in review:** Any worker-pool with `make(chan T)` (no buffer) and a `Submit` that just sends.

**Fix:** bound the queue and expose backpressure (deadline-aware or non-blocking):

```go
jobs := make(chan func(), queueSize)

func (p *WorkerPool) Submit(ctx context.Context, f func()) error {
    select {
    case p.jobs <- f:    return nil
    case <-ctx.Done():   return ctx.Err()
    }
}

func (p *WorkerPool) TrySubmit(f func()) bool {
    select {
    case p.jobs <- f: return true
    default:          return false           // pool full; caller decides
    }
}
```

**Why common:** "Workers and a channel" is the textbook design. The missing buffer / context / try-send is invisible until production load makes them mandatory.
</details>

---

## Bug 10 — Reader.Reset(wrongSrc)

```go
var gzPool = sync.Pool{
    New: func() any {
        r, _ := gzip.NewReader(bytes.NewReader([]byte{0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0}))
        return r
    },
}

func decompress(data []byte) ([]byte, error) {
    r := gzPool.Get().(*gzip.Reader)
    defer gzPool.Put(r)

    // forgot: r.Reset(bytes.NewReader(data))
    return io.ReadAll(r)
}
```

<details><summary>Answer</summary>

**Bug:** `decompress` never calls `r.Reset(newSrc)`. The reader still points at the dummy source from `New`, or at the *previous* caller's source. `io.ReadAll` reads from whatever stream the previous goroutine left attached — EOF, partially consumed, or worse, still in use elsewhere.

For pooled `gzip.Reader`, `flate.Reader`, `bufio.Reader`, `cipher.Stream`, `csv.Reader`, calling `Reset(newSrc)` is **the** purpose of pooling. Skipping it makes the pool a source of cross-request data leaks.

**Why it's subtle:** It looks like `Put` "released" the reader. But `Put` returns only the object; its internal state (the wrapped source) is unchanged.

**Spot in review:** Every type with a `Reset(src)` method should have a matching call at the top of every pooled-borrow block. Search for `.Get().(*T)` and verify a `Reset(...)` immediately follows.

**Fix:** call `r.Reset(bytes.NewReader(data))` right after `Get`, check its error, *then* `io.ReadAll`.

**Why common:** The `Reset(src)` API is unique to pooled types. Newcomers expect "fresh from the pool means clean" — Go's convention requires explicit re-binding.
</details>

---

## Bug 11 — Pooling time.Timer incorrectly

```go
var timerPool = sync.Pool{
    New: func() any { return time.NewTimer(time.Hour) },
}

func waitFor(d time.Duration, ch <-chan struct{}) bool {
    t := timerPool.Get().(*time.Timer)
    defer timerPool.Put(t)

    t.Reset(d)
    select {
    case <-t.C:
        return false                          // timed out
    case <-ch:
        return true                           // signaled
    }
}
```

<details><summary>Answer</summary>

**Bug:** Two layered bugs. *(a)* `time.Timer.Reset(d)` is only safe on a timer that has expired-and-been-received-from, or has been successfully stopped. Calling `Reset` on a still-armed timer races with its original tick. *(b)* On the `ch` success path, `t.C` may still receive after `Put`. The pool now holds a timer with a queued tick; the next borrower's `select <-t.C` returns immediately — fake timeout.

**Why it's subtle:** Pooling `*time.Timer` looks like a clean optimization. The race window is small; single-waiter tests never reproduce it.

**Spot in review:** Any `sync.Pool` of `*time.Timer` without paired Stop/drain on `Put`.

**Fix:** stop-and-drain on `Put`, then `Reset` on next borrow:

```go
defer func() {
    if !t.Stop() {
        select {
        case <-t.C:                           // drain if already fired
        default:
        }
    }
    timerPool.Put(t)
}()
```

Go 1.23+ made timer channels unbuffered and `Stop`/`Reset` race-free. For legacy targets, *don't pool timers* — `time.NewTimer` is cheap.

**Why common:** Pooling concentrates every edge case from the `*time.Timer` docs into a single shared object.
</details>

---

## Bug 12 — Memory growing despite pool (cap check misses)

```go
const maxBuf = 64 << 10

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
    if cap(r.Body) > maxBuf {                 // cap check on Body
        return
    }
    for k := range r.Headers {
        delete(r.Headers, k)
    }
    r.Body = r.Body[:0]
    reqPool.Put(r)
}
```

<details><summary>Answer</summary>

**Bug:** The cap checks `cap(r.Body)` but not `len(r.Headers)`. A request with 5,000 headers is accepted. The `delete` loop empties the map but does *not* shrink the bucket array — Go's runtime keeps map storage proportional to the largest size ever reached. The 5,000-bucket map is permanent baggage on every future borrower; RSS climbs while the `cap(Body)` gate waves small payloads through.

**Why it's subtle:** The cap idea is right; the implementation only covers one growable field. Map capacity is invisible — `len(m)` after `delete` is zero.

**Spot in review:** Any pooled struct with multiple growable sub-allocations. Each one needs its own gate. For maps, the rule is: if it ever grew large, drop the whole struct.

**Fix:** gate every growable field; for maps, replace rather than `delete`-loop since `delete` doesn't shrink:

```go
const (
    maxBuf     = 64 << 10
    maxHeaders = 64
)

func putRequest(r *Request) {
    if cap(r.Body) > maxBuf || len(r.Headers) > maxHeaders {
        return                                // drop oversized
    }
    clear(r.Headers)
    r.Body = r.Body[:0]
    reqPool.Put(r)
}
```

**Why common:** Cap checks get added after the first OOM postmortem. The reviewer adds the gate that matched the *previous* incident; the second growable field stays uncovered until its turn in production.
</details>

---

## Bug 13 — Per-request `pool := sync.Pool{...}` (new pool per request)

```go
func handler(w http.ResponseWriter, r *http.Request) {
    pool := sync.Pool{                        // declared INSIDE the handler
        New: func() any { return new(bytes.Buffer) },
    }
    buf := pool.Get().(*bytes.Buffer)
    defer pool.Put(buf)
    buf.Reset()
    renderTo(buf, r)
    w.Write(buf.Bytes())
}
```

<details><summary>Answer</summary>

**Bug:** `pool` is declared inside the handler. Every request constructs a fresh `sync.Pool`, calls `New` once, uses the buffer, and `Put`s it back into a pool about to go out of scope. The whole pool — buffer included — becomes garbage at end of request. Identical to no pool, except slower.

**Why it's subtle:** Code reads correctly. `Get`/`Put` are paired. `Reset` is called. The bug is *scope*, not *logic*.

**Spot in review:** `sync.Pool{...}` literal appearing inside any function that runs per-request, per-message, or per-iteration. Pools must be package-level, struct-field, or otherwise long-lived.

**Fix:** lift the pool to package scope (or hang it on a long-lived `*Server` for testability):

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}
```

**Why common:** A developer reads "don't share global state" and reflexively scopes the pool inside the function. The pool's whole purpose — sharing across calls — is exactly what was sacrificed.
</details>

---

## Bug 14 — Concurrent Read while another goroutine has Put

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

type Result struct{ bytes []byte }            // aliases pooled buffer

func render(req *Request) *Result {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    renderTo(buf, req)
    res := &Result{bytes: buf.Bytes()}        // share, don't copy
    bufPool.Put(buf)                          // return to pool immediately
    return res
}

func handler(w http.ResponseWriter, r *http.Request) {
    res := render(parseRequest(r))
    go logAudit(res.bytes)                    // reads after render returned
    w.Write(res.bytes)
}
```

<details><summary>Answer</summary>

**Bug:** `render` returns `*Result` containing a slice aliased to the pooled buffer, then immediately `Put`s the buffer back. The audit goroutine and `w.Write` share that slice with whatever future borrower receives the same buffer — a concurrent `Get`/`Reset`/write overwrites `res.bytes` in real time. `-race` catches it; production sees corrupted log lines and partial responses. Same root cause as Bug 4, but the failure mode is worse: *multiple concurrent readers* share a re-issued buffer.

**Why it's subtle:** The bug isn't in `render` alone — it's in the contract with the caller. The signature gives no hint that the bytes are pool-aliased.

**Spot in review:** Any function that `Put`s before its return value is fully consumed.

**Fix:** copy out, or invert the API to a callback that runs *while the buffer is borrowed*:

```go
func render(req *Request) *Result {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    renderTo(buf, req)
    return &Result{bytes: append([]byte(nil), buf.Bytes()...)}
}
```

**Why common:** "Avoid the copy, just return the bytes" is a tempting micro-optimization. Under `-race` it lights up immediately; without `-race` it produces sporadic corruption.
</details>

---

## Bug 15 — Type assertion panic (New returns wrong type)

```go
// Original — New returns *bytes.Buffer; call sites assert *bytes.Buffer.
var bufPool = sync.Pool{
    New: func() any { return bytes.NewBuffer(nil) },
}

func encode(v any) []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    json.NewEncoder(buf).Encode(v)
    return append([]byte(nil), buf.Bytes()...)
}

// Months later, somebody refactors New:
var bufPool = sync.Pool{
    New: func() any {
        b := bytes.NewBuffer(nil)
        return *b                                         // bytes.Buffer (value!)
    },
}
```

<details><summary>Answer</summary>

**Bug:** The refactor returns a *value* `bytes.Buffer` instead of a pointer. The next `pool.Get().(*bytes.Buffer)` panics with `interface conversion: bytes.Buffer is not *bytes.Buffer`. Every call site crashes. The compiler can't catch it because `sync.Pool.New` is `func() any` — concrete type erased.

**Why it's subtle:** Tests pass until the refactor's call path is exercised. Review sees two correct-looking snippets that don't add up.

**Spot in review:** When changing `New`, audit every `pool.Get()` call site. Better — wrap the pool in a typed helper.

**Fix:** wrap the pool in a typed helper so the assertion lives in one place:

```go
type BufferPool struct{ p sync.Pool }

func NewBufferPool() *BufferPool {
    return &BufferPool{p: sync.Pool{
        New: func() any { return new(bytes.Buffer) },
    }}
}

func (b *BufferPool) Get() *bytes.Buffer  { return b.p.Get().(*bytes.Buffer) }
func (b *BufferPool) Put(x *bytes.Buffer) { b.p.Put(x) }
```

Now `bufPool.Get()` is typed at compile time and the assertion can't drift. Or use a generic `Pool[T any]` wrapper for the same effect.

**Why common:** `sync.Pool`'s API predates generics. The assertion at each `Get` looks routine, but it's a refactor hazard concentrated at every call site.
</details>

---

## Summary

These bugs cluster into four families.

**Borrow-return discipline (1, 2, 3, 10):** forgotten `Reset`, missing `Put`, non-deferred `Put`, missing `Reset(src)`. The pool's contract is *Get, Reset, use, Put* — every shortcut around that sequence is a bug.

**Lifetime leaks across the borrow boundary (4, 14):** returning slices that alias the buffer; sharing the result with another goroutine. A pooled object's data is *only* valid between `Get` and `Put`. Crossing that boundary corrupts the next borrower.

**Memory hygiene (5, 8, 12):** no size cap, `Reset` that re-allocates, partial cap checks. Pools that don't gate growth turn one large payload into a permanent memory increase.

**Wrong tool for the job (6, 7, 9, 11, 13, 15):** value types, connection objects, unbuffered worker channels, `time.Timer`, per-request pools, wrong assertion type. Half the bugs are "applied `sync.Pool` to a thing it isn't designed for".

Review checklist for any Object-Pool PR:

- [ ] Is the pool declared at package or long-lived struct scope — never inside a per-request function?
- [ ] Does `New` return a **pointer** type (`return &T{}`), not a value?
- [ ] Is every `pool.Get()` immediately followed by `defer pool.Put(...)` on the next line?
- [ ] Does the borrow block call `Reset()` (or `Reset(src)`, or `[:0]`, or `clear()`) before any writes?
- [ ] Does `Reset` *preserve* the underlying allocation (no `make` inside)?
- [ ] Is there a size cap on `Put` for every growable sub-allocation (buffers, slices, maps)?
- [ ] Do returned slices that alias the pooled buffer get **copied out** before `Put` runs?
- [ ] For resources holding file descriptors (`*grpc.ClientConn`, `net.Conn`, `*sql.DB`): is a typed channel-pool used instead of `sync.Pool`?
- [ ] Are `*time.Timer` borrows wrapped in proper Stop/drain logic — or, better, not pooled at all?
- [ ] Does the type assertion at every `Get` match what `New` returns? Consider a typed wrapper or generic pool.
- [ ] Is the worker-pool channel buffered, and does `Submit` expose backpressure (try-send, context cancellation)?
- [ ] Have you benchmarked with `-benchmem` and confirmed allocs/op actually decreased? If not, delete the pool.
