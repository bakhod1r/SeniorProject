# sync.Pool — Find the Bug

> A collection of broken `sync.Pool` programs. Each shows the code, a short symptom, and asks you to find the bug. Solutions are hidden after the question; resist peeking. Difficulty goes from "type-assertion crash" to "subtle race that only fires under `GOMAXPROCS=64` with the race detector off."

---

## Bug 1 — The forgotten `Reset`

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func format(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    fmt.Fprintf(buf, "hello %s", name)
    return buf.String()
}

func main() {
    fmt.Println(format("alice"))
    fmt.Println(format("bob"))
    fmt.Println(format("carol"))
}
```

**Symptom.** Output is:

```
hello alice
hello alicehello bob
hello alicehello bobhello carol
```

**Find the bug.**

<details>
<summary>Solution</summary>

`buf` is reused on each call but never `Reset`. Each call appends to whatever was there. Fix:

```go
buf := bufPool.Get().(*bytes.Buffer)
defer bufPool.Put(buf)
buf.Reset() // <-- add this
fmt.Fprintf(buf, "hello %s", name)
```

This is bug #1 of `sync.Pool` use. Always `Reset` immediately after `Get`.

</details>

---

## Bug 2 — Use after `Put`

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render(name string) *bytes.Buffer {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    buf.WriteString("hello ")
    buf.WriteString(name)
    bufPool.Put(buf)
    return buf
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            b := render(fmt.Sprintf("user%d", i))
            // some time later...
            fmt.Println(b.String())
        }(i)
    }
    wg.Wait()
}
```

**Symptom.** Run with `go run -race main.go`: race detector reports concurrent writes to the same `*bytes.Buffer`. Output occasionally shows garbled names ("hello user42user17").

**Find the bug.**

<details>
<summary>Solution</summary>

`render` calls `Put(buf)` then returns `buf`. After `Put`, the pool owns the buffer and may hand it to another goroutine immediately. The caller's `fmt.Println(b.String())` races with that goroutine's writes.

Fix: return the rendered string, not the buffer, and `Put` last:

```go
func render(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.WriteString("hello ")
    buf.WriteString(name)
    return buf.String()
}
```

Or, if you must return a buffer, do not pool it.

</details>

---

## Bug 3 — Wrong type in `New`

```go
var pool = sync.Pool{
    New: func() any { return *new(bytes.Buffer) }, // returns a value, not a pointer
}

func use() {
    buf := pool.Get().(*bytes.Buffer)
    buf.WriteString("hi")
}
```

**Symptom.** Runtime panic:

```
panic: interface conversion: interface {} is bytes.Buffer, not *bytes.Buffer
```

**Find the bug.**

<details>
<summary>Solution</summary>

`*new(bytes.Buffer)` returns a `bytes.Buffer` *value*, not a pointer. The type assertion to `*bytes.Buffer` fails. Fix:

```go
New: func() any { return new(bytes.Buffer) }, // pointer
```

Always pool pointers, not values — both for correctness and for avoiding a heap copy on every `Get`.

</details>

---

## Bug 4 — Pool field copied

```go
type Encoder struct {
    pool sync.Pool
}

func NewEncoder() *Encoder {
    return &Encoder{
        pool: sync.Pool{
            New: func() any { return new(bytes.Buffer) },
        },
    }
}

func (e Encoder) Encode(v any) string {  // BUG: e is a value receiver
    buf := e.pool.Get().(*bytes.Buffer)
    defer e.pool.Put(buf)
    buf.Reset()
    fmt.Fprintf(buf, "%v", v)
    return buf.String()
}

func main() {
    e := NewEncoder()
    fmt.Println(e.Encode("hi"))
}
```

**Symptom.** `go vet ./...` warns:

```
copylocks: Encode passes lock by value: pool.sync.Pool contains sync.noCopy
```

The program may run, but pool state is unpredictable across calls because each call copies the `sync.Pool`.

**Find the bug.**

<details>
<summary>Solution</summary>

The method has a value receiver `(e Encoder)`. This copies the entire struct — including the `sync.Pool` — every call. The pool's `noCopy` field is precisely a `go vet` hint to catch this.

Fix: use a pointer receiver.

```go
func (e *Encoder) Encode(v any) string { ... }
```

`sync.Pool` (and `sync.Mutex`, `sync.WaitGroup`, etc.) must never be copied after first use.

</details>

---

## Bug 5 — Pool holds references that pin user data

```go
type Decoder struct {
    scratch [4096]byte
    input   []byte // reference to user-supplied payload
}

var decPool = sync.Pool{
    New: func() any { return new(Decoder) },
}

func parse(payload []byte) Result {
    d := decPool.Get().(*Decoder)
    defer decPool.Put(d)
    d.input = payload // assigns reference
    return d.parse()
}

func main() {
    for {
        payload := make([]byte, 10<<20) // 10 MB
        _ = parse(payload)
    }
}
```

**Symptom.** Memory usage grows steadily even though `payload` should be garbage-collected immediately after `parse` returns. `pprof -alloc_space` shows the 10 MB allocations are reachable from the pool.

**Find the bug.**

<details>
<summary>Solution</summary>

The pooled `Decoder` keeps a reference to `payload` via `d.input`. Every `Put` returns a `Decoder` that still pins the last 10 MB payload. The pool holds the `Decoder`, which holds the payload — the GC cannot reclaim it.

Fix: clear the reference on `Put` (or in a `Reset` method).

```go
func parse(payload []byte) Result {
    d := decPool.Get().(*Decoder)
    defer func() {
        d.input = nil // clear reference before Put
        decPool.Put(d)
    }()
    d.input = payload
    return d.parse()
}
```

Or implement `Reset`:

```go
func (d *Decoder) Reset() { d.input = nil }
```

And call `Reset` before `Put` (or after `Get`).

</details>

---

## Bug 6 — `Get` from empty pool, no `New`

```go
var p sync.Pool

func handler(w http.ResponseWriter, r *http.Request) {
    buf := p.Get().(*bytes.Buffer)
    buf.WriteString("hi")
    p.Put(buf)
}
```

**Symptom.** First request panics:

```
panic: interface conversion: interface {} is nil, not *bytes.Buffer
```

**Find the bug.**

<details>
<summary>Solution</summary>

`p.New` is not set. When the pool is empty, `Get` returns `nil`. The type assertion to `*bytes.Buffer` panics on nil.

Fix:

```go
var p = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}
```

Always set `New`. There is essentially no reason to leave it unset.

</details>

---

## Bug 7 — Pool of slices, wrong slice header on `Put`

```go
var slicePool = sync.Pool{
    New: func() any { return make([]byte, 0, 1024) },
}

func process(input []byte) {
    buf := slicePool.Get().([]byte)
    buf = append(buf, input...)
    // do stuff with buf
    slicePool.Put(buf) // BUG
}
```

**Symptom.** After thousands of calls, some `Get`s return slices with unexpectedly large `len()` instead of 0. Logic that depends on `len(buf) == 0` after `Get` is wrong.

**Find the bug.**

<details>
<summary>Solution</summary>

`Put(buf)` stores the slice with `len(buf) > 0`. The next `Get`-er sees a non-empty slice header. They may write into `buf[len(buf):]` (using `append`), or they may forget to `[:0]` and process the previous user's data.

Fix:

```go
slicePool.Put(buf[:0])
```

Reset length to 0 before `Put`, preserving capacity. Always.

</details>

---

## Bug 8 — Returning `buf.Bytes()` after `Put`

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func encode(v any) []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    json.NewEncoder(buf).Encode(v)
    return buf.Bytes() // BUG: aliases pool buffer
}

func main() {
    a := encode(map[string]int{"a": 1})
    b := encode(map[string]int{"b": 2})
    fmt.Println(string(a), string(b))
}
```

**Symptom.** `a` and `b` sometimes print as the same thing. The contents of `a` change between the assignment and the `Println`.

**Find the bug.**

<details>
<summary>Solution</summary>

`buf.Bytes()` returns the internal slice — same underlying array as the pool's buffer. After `Put`, another `encode` call may use that buffer and write `{"b":2}` into the same bytes that `a` points to.

Fix: copy out.

```go
data := buf.Bytes()
out := make([]byte, len(data))
copy(out, data)
return out
```

Or use `bytes.Clone`:

```go
return bytes.Clone(buf.Bytes())
```

Or return a `string`, which copies:

```go
return []byte(buf.String())
```

</details>

---

## Bug 9 — Pool grows unbounded under DoS

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    io.Copy(buf, r.Body) // BUG: unbounded read
    process(buf.Bytes())
}
```

**Symptom.** Under traffic with crafted large requests (100 MB body each), the service's memory grows past 10 GB before crashing. Pool holds many oversized buffers.

**Find the bug.**

<details>
<summary>Solution</summary>

`io.Copy` reads `r.Body` to EOF with no upper bound. A malicious client can send a 100 MB body; the pooled buffer grows to 100 MB; `Put` returns it; the pool retains it. After 100 such requests, the pool holds 10 GB.

Fix: bound the request size, and drop oversized buffers before `Put`.

```go
const maxBody = 1 << 20 // 1 MB

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        if buf.Cap() < 64<<10 {
            bufPool.Put(buf)
        }
    }()
    buf.Reset()
    if _, err := io.CopyN(buf, r.Body, maxBody); err != nil && err != io.EOF {
        http.Error(w, "too large", http.StatusBadRequest)
        return
    }
    process(buf.Bytes())
}
```

Better: use `http.MaxBytesReader` to limit at the HTTP layer:

```go
r.Body = http.MaxBytesReader(w, r.Body, maxBody)
io.Copy(buf, r.Body)
```

</details>

---

## Bug 10 — Goroutine outlives the borrow

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render(name string) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    fmt.Fprintf(buf, "hello %s", name)

    go func() {
        time.Sleep(100 * time.Millisecond)
        log.Println(buf.String()) // BUG: buf is back in the pool
    }()
}
```

**Symptom.** `log.Println` occasionally prints rendered messages for *other* users. Sometimes prints garbage. The race detector reports a race.

**Find the bug.**

<details>
<summary>Solution</summary>

The goroutine captures `buf` but runs after the enclosing function returns — at which point `defer Put` has already run. The pool may have given `buf` to another `render` call. The goroutine reads `buf` while someone else writes it.

Fix: copy out before spawning, or pass ownership to the goroutine and `Put` from inside it.

```go
go func(msg string) {
    time.Sleep(100 * time.Millisecond)
    log.Println(msg)
}(buf.String())
```

Now the goroutine holds an immutable copy; the pool is free to reuse `buf`.

</details>

---

## Bug 11 — Forgotten `Put` on error path

```go
func encode(v any) ([]byte, error) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    if err := json.NewEncoder(buf).Encode(v); err != nil {
        return nil, err // BUG: forgot Put
    }
    defer bufPool.Put(buf)
    return buf.Bytes(), nil
}
```

**Symptom.** Memory profile shows buffers accumulating in the heap. The pool's "size" feels right, but the heap has many orphan `*bytes.Buffer` objects that were `Get`-ed but never `Put`.

**Find the bug.**

<details>
<summary>Solution</summary>

The error path returns before `defer Put` registers. The buffer is `Get`-ed but never `Put`-ed; it is now garbage that needs to be GC'd. Not a leak in the strict sense (GC reclaims it eventually) but pool hit rate drops, and the workload pays `New` on every error.

Fix: register `defer Put` *before* the error check.

```go
func encode(v any) ([]byte, error) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf) // <-- before error
    buf.Reset()
    if err := json.NewEncoder(buf).Encode(v); err != nil {
        return nil, err
    }
    return bytes.Clone(buf.Bytes()), nil
}
```

Pattern: `defer Put` is the second line after `Get`, always.

</details>

---

## Bug 12 — Pool of mutexes

```go
type Lock struct{ mu sync.Mutex }

var lockPool = sync.Pool{
    New: func() any { return new(Lock) },
}

func withLock(f func()) {
    l := lockPool.Get().(*Lock)
    l.mu.Lock()
    defer func() {
        l.mu.Unlock()
        lockPool.Put(l)
    }()
    f()
}
```

**Symptom.** The function is meant to serialise calls. It does not — two concurrent calls run `f()` in parallel.

**Find the bug.**

<details>
<summary>Solution</summary>

`sync.Pool` gives each caller a (likely) different `*Lock`. Two goroutines calling `withLock` get two different `*Lock` objects; locking on different mutexes does not serialise them.

A mutex is meaningful only because of *identity* — locking the same mutex from two places. A pool destroys identity. This is a categorical misuse.

Fix: use one shared mutex.

```go
var globalMu sync.Mutex

func withLock(f func()) {
    globalMu.Lock()
    defer globalMu.Unlock()
    f()
}
```

If you need many mutexes (e.g., one per key), use a `sync.Map` or a fixed sharded pool — but the lookup is by key, not by `Get`.

</details>

---

## Bug 13 — Pool init in `New` causes infinite recursion

```go
var pool = sync.Pool{
    New: func() any {
        return new(Foo).init() // init calls pool.Get internally
    },
}

type Foo struct{}

func (f *Foo) init() *Foo {
    helper := pool.Get().(*Foo) // BUG: recurses into New
    _ = helper
    return f
}
```

**Symptom.** Stack overflow on the first call.

**Find the bug.**

<details>
<summary>Solution</summary>

`New` calls `Get`, which calls `New`, which calls `Get`, ... The pool's `Get` never reaches "pool has an item" because `New` itself is the path. Stack overflows.

Fix: `New` must not call back into the same pool. Either construct without `helper`, or use a different pool, or restructure to avoid the cycle.

```go
New: func() any {
    return &Foo{} // no pool lookup
},
```

</details>

---

## Bug 14 — Pool retains large struct via field

```go
type Encoder struct {
    bigBuf [16 << 20]byte // 16 MB scratch
}

var encPool = sync.Pool{
    New: func() any { return new(Encoder) },
}

func encode(v any) []byte {
    enc := encPool.Get().(*Encoder)
    defer encPool.Put(enc)
    // use enc.bigBuf...
    return result
}
```

**Symptom.** Memory grows to (16 MB × GOMAXPROCS × ~2) after warm-up — 1+ GB on a 64-core box. The pool retains an `Encoder` (16 MB each) per P, doubled by the victim cache.

**Find the bug.**

<details>
<summary>Solution</summary>

Pooling a 16 MB struct means each P keeps one. With 64 Ps and a victim tier, you have 128 × 16 MB = 2 GB. The pool's per-P design works against you for large structs.

Fix: smaller struct (allocate the big buffer on demand from a separate, capped pool), or do not pool. If 16 MB per request really matters, use a hand-rolled bounded pool with a fixed maximum count.

```go
type Encoder struct {
    bigBuf []byte // allocated on demand
}

func (e *Encoder) Reset() {
    if cap(e.bigBuf) > 1<<20 { // shrink large allocations
        e.bigBuf = nil
    } else {
        e.bigBuf = e.bigBuf[:0]
    }
}
```

</details>

---

## Bug 15 — Concurrent `Reset` and write

```go
func worker(buf *bytes.Buffer) {
    buf.WriteString("from worker")
}

func main() {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)

    go worker(buf)
    buf.Reset() // BUG: worker may already be writing
    buf.WriteString("from main")
}
```

**Symptom.** Race detector reports a race on `bytes.Buffer`. Output is sometimes garbage.

**Find the bug.**

<details>
<summary>Solution</summary>

`bytes.Buffer` is not goroutine-safe. Two goroutines writing to one buffer is a race, regardless of pooling. The pool is irrelevant here; the bug would exist without the pool.

Fix: never share a `*bytes.Buffer` across goroutines. Each goroutine should `Get` its own.

```go
func worker() {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.WriteString("from worker")
    // do something with buf.String()
}
```

</details>

---

## Bug 16 — `Put` inside `New` ignores the gift

```go
var pool = sync.Pool{
    New: func() any {
        b := new(bytes.Buffer)
        pool.Put(b)  // BUG?
        return b
    },
}

func main() {
    a := pool.Get().(*bytes.Buffer)
    b := pool.Get().(*bytes.Buffer)
    a.WriteString("a"); b.WriteString("b")
}
```

**Symptom.** `a` and `b` are sometimes the same `*bytes.Buffer`. Output: `"ab"` written into one buffer.

**Find the bug.**

<details>
<summary>Solution</summary>

`New` puts a fresh buffer into the pool and *also* returns it. So `a` is a pointer that the pool also holds. The next `Get` may return the same pointer. Now `a` and `b` are aliases.

Fix: `New` should construct and return. Do not also `Put`.

```go
New: func() any { return new(bytes.Buffer) },
```

`New` is the policy for filling the pool *when it is empty for a caller*. It is not an opportunity to prewarm.

</details>

---

## Bug 17 — Pool eviction breaks long-running operation

```go
type Job struct { data []byte; result chan []byte }

var jobPool = sync.Pool{New: func() any { return &Job{} }}

func dispatch(j *Job) {
    go func() {
        result := process(j.data)
        j.result <- result
        jobPool.Put(j)
    }()
}

func main() {
    j := jobPool.Get().(*Job)
    j.data = make([]byte, 1024)
    j.result = make(chan []byte, 1)
    dispatch(j)
    fmt.Println(<-j.result)
}
```

**Symptom.** Sometimes the program panics with `nil pointer dereference` on `j.result <- result` deep in the goroutine.

**Find the bug.**

<details>
<summary>Solution</summary>

The goroutine outlives `dispatch`. Between `dispatch` returning and the goroutine running, the runtime may GC, evicting `j` from the pool. The pool no longer holds it, but the goroutine does. When the goroutine `Put`s back, it stores into a pool that has already been emptied — not a panic on its own.

But: `j.result` is set by the *caller*, not by `New`. After eviction and re-`Get` by another caller, `j.result` may be a *different* channel — or nil if `New` is called instead.

A subtler issue: pooling a struct with caller-set fields is fragile. `New` doesn't initialise the fields the caller relies on.

Fix: the worker should be self-contained — do not pool task structs whose fields are caller-supplied per call. Pool only the heavy reusable pieces, not the coordination primitives.

```go
func dispatch(data []byte) <-chan []byte {
    result := make(chan []byte, 1)
    go func() {
        // use pooled scratch buffers here, not pool the job itself
        result <- process(data)
    }()
    return result
}
```

</details>

---

## Bug 18 — Hidden allocation in `New`

```go
var pool = sync.Pool{
    New: func() any {
        list := make([]int, 1000)
        for i := range list {
            list[i] = i * i
        }
        return &list
    },
}
```

**Symptom.** Under high load, CPU profile shows time inside the for-loop in `New`. The pool feels useless.

**Find the bug.**

<details>
<summary>Solution</summary>

Every cache miss calls `New`, which allocates 1000 ints *and* computes squares. Under GC pressure, the pool may evict often, making `New` a hot path. The "miss penalty" is the entire 1000-iteration loop.

Fix: precompute once.

```go
var precomputed [1000]int

func init() {
    for i := range precomputed {
        precomputed[i] = i * i
    }
}

var pool = sync.Pool{
    New: func() any {
        list := make([]int, 1000)
        copy(list, precomputed[:])
        return &list
    },
}
```

Or, if all callers want the same values, do not pool — just expose `precomputed` (immutable).

</details>

---

## Bug 19 — Pool of `io.Reader`

```go
var rdrPool = sync.Pool{
    New: func() any { return bytes.NewReader(nil) },
}

func parse(data []byte) Result {
    r := rdrPool.Get().(*bytes.Reader)
    defer rdrPool.Put(r)
    r.Reset(data)
    return parseFrom(r)
}
```

**Symptom.** Works correctly. So what is the bug?

<details>
<summary>Solution</summary>

There is no bug *per se*. This is correct. However, there is a subtle issue:

`bytes.NewReader(nil)` creates a Reader with `len = 0, off = 0`. The first `r.Reset(data)` works fine. But if the caller of `parseFrom` retains `r` (e.g. wraps it in an `io.LimitReader`), then after `Put` the next `Reset` invalidates the wrapper's view.

The lesson: pooling reader/writer types is safe only if no caller captures the reader past the borrow. Document this. In the example above it is fine because `parseFrom` returns a value, not the reader.

Generalisation: pools of types that implement `io.Reader` / `io.Writer` interfaces are easy to misuse if the borrowed object is passed as an interface to code that may retain it.

</details>

---

## Bug 20 — Generic wrapper with default-zero

```go
type Pool[T any] struct{ p sync.Pool }

func NewPool[T any]() *Pool[T] {
    return &Pool[T]{
        p: sync.Pool{
            New: func() any {
                var zero T
                return zero
            },
        },
    }
}

func (p *Pool[T]) Get() T { return p.p.Get().(T) }
func (p *Pool[T]) Put(v T) { p.p.Put(v) }

// usage:
var pool = NewPool[*bytes.Buffer]()

func main() {
    buf := pool.Get() // BUG?
    buf.WriteString("hi") // panic: nil pointer dereference
}
```

**Symptom.** Nil pointer panic.

**Find the bug.**

<details>
<summary>Solution</summary>

`var zero T` for `T = *bytes.Buffer` gives `nil`. The pool returns nil pointers. The wrapper does not catch this because the type assertion `(T)` succeeds (nil is a valid `*bytes.Buffer`).

Fix: require a `newFn` parameter; do not default to zero.

```go
func NewPool[T any](newFn func() T) *Pool[T] {
    return &Pool[T]{
        p: sync.Pool{
            New: func() any { return newFn() },
        },
    }
}

var pool = NewPool(func() *bytes.Buffer { return new(bytes.Buffer) })
```

A "default-zero" generic wrapper is almost always wrong for pointer types.

</details>

---

## Reflection

If you found all twenty, you have a strong instinct for `sync.Pool` failure modes. If you struggled with the late bugs (12, 13, 16, 17, 18, 20), revisit the senior and professional files — they cover the underlying mechanisms in depth. The find-bug genre teaches mostly by pattern: most production pool bugs match one of these 20.

The single recurring lesson: **the pool gives you a reused object, not a fresh one**. Every bug above is some variation on forgetting that, or forgetting to release ownership on `Put`. Build the four-line dance (`Get`, `Reset`, `defer Put`, use) into muscle memory and you have eliminated 80% of the failure surface.
