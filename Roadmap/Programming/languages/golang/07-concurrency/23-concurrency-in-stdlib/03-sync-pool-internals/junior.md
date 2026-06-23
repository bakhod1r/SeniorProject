---
layout: default
title: sync.Pool Internals — Junior
parent: sync.Pool Internals
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/03-sync-pool-internals/junior/
---

# sync.Pool Internals — Junior

[← Back](../)

This page is a from-scratch tour of `sync.Pool` aimed at developers who have probably typed `sync.Pool{}` once or twice, copied an example off the standard library, and walked away feeling like they got away with something. We want to leave you with a working mental model: what `sync.Pool` actually is, when it earns its keep, when it hurts more than it helps, and what classes of bugs you must avoid the first time you reach for it.

We will not touch the per-P shard, the victim cache, the `local`/`localPool`/`poolChainElt` data structures, atomic CAS games, or the GC hooks. Those live in the middle and senior pages. This page treats the pool as a small black box that "may give you back an object you previously gave it, or may give you a fresh one." That is the entire contract, and most of the bugs people hit with `sync.Pool` come from forgetting that one sentence.

## 1. Why pooling exists in the first place

Go's runtime is very good at allocation. The compiler will happily promote short-lived objects to the stack via escape analysis, and the garbage collector is concurrent and short-pause. So your first question, before you read any further, should be: do I have a problem that pooling actually solves?

The problem pooling solves is not "allocation is slow." Allocation in Go is roughly a pointer bump in the local allocator. The problem pooling solves is "allocation produces work for the garbage collector." That work is real, and on a hot path it shows up as CPU time and as longer GC cycles.

Here is the concrete chain:

1. Your hot code path allocates a buffer.
2. The buffer becomes garbage almost immediately.
3. The garbage collector needs to scan, mark, and reclaim it.
4. The next iteration allocates another buffer. Repeat.

The cost of this loop, on a busy server, is not the malloc; it is the mark-sweep work proportional to the live heap and the allocation rate. If you can take one buffer per goroutine and reuse it for every request that goroutine processes, the GC has fewer objects to mark and your live-heap growth slows down dramatically.

That, in one paragraph, is the entire reason `sync.Pool` exists. It is a GC-pressure release valve. It is not a generic cache. It is not a resource manager.

### 1.1 A first measurement of allocation pressure

Let's see allocation pressure as a number before we touch a pool. We will build a tiny benchmark that formats integers into a buffer 1000 times per iteration and look at `B/op` and `allocs/op`.

```go
package poolintro

import (
    "bytes"
    "fmt"
    "testing"
)

func formatLoopNoPool(n int) string {
    var buf bytes.Buffer
    for i := 0; i < n; i++ {
        fmt.Fprintf(&buf, "value=%d\n", i)
    }
    return buf.String()
}

func BenchmarkFormatLoopNoPool(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = formatLoopNoPool(1000)
    }
}
```

Run it:

```
go test -bench=FormatLoopNoPool -benchmem ./...
```

You will see something like (the absolute numbers depend on hardware):

```
BenchmarkFormatLoopNoPool-8   30000  41234 ns/op  8192 B/op   5 allocs/op
```

The numbers we care about are `B/op` (bytes allocated per call) and `allocs/op` (number of heap allocations per call). Every call here creates a `bytes.Buffer`, grows its internal slice a few times, and produces a string. The GC has to clean up all of that.

Now imagine this code is on a request hot path. At 10,000 requests per second, that is 80 MB of churn per second, all of which the GC must walk over.

### 1.2 What pooling promises

Pooling promises: if I am willing to hand the buffer back when I am done with it, I might get the same buffer back next time, with its underlying byte slice already grown to the size I need. The first request pays the allocation cost; subsequent requests pay almost nothing.

There are three words in that promise that matter:

- "willing to hand back" — you must explicitly `Put` it.
- "might get the same buffer back" — the pool can drop your buffer at any time.
- "the same buffer" — the buffer is shared serially, never concurrently. Once you `Put` it, somebody else owns it.

We will return to each of those words.

## 2. The sync.Pool API

The entire API of `sync.Pool` fits on a postcard.

```go
type Pool struct {
    New func() any
    // ... unexported fields
}

func (p *Pool) Get() any
func (p *Pool) Put(x any)
```

Three things:

- `New`: a function you optionally set that constructs a fresh object when the pool is empty.
- `Get()`: gives you back either a previously-`Put` object, or (if the pool is empty and `New` is set) a fresh one.
- `Put(x)`: gives an object to the pool. The pool may keep it, or may throw it away, at any time.

The smallest possible useful pool:

```go
package poolintro

import (
    "bytes"
    "sync"
)

var bufPool = sync.Pool{
    New: func() any {
        return new(bytes.Buffer)
    },
}
```

And using it:

```go
func formatLoopWithPool(n int) string {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset() // CRITICAL — see section 4

    for i := 0; i < n; i++ {
        fmt.Fprintf(buf, "value=%d\n", i)
    }
    out := buf.String()

    bufPool.Put(buf) // return it
    return out
}
```

Two new things to notice:

1. `bufPool.Get()` returns `any` (which is `interface{}`). We have to type-assert: `.(*bytes.Buffer)`. This is the boxing cost we will talk about in section 8.
2. `buf.Reset()` clears any state left over from the last user. Forgetting this is the single most common pool bug. We will spend an entire section on it.

### 2.1 The defer pattern

In real code, almost every pool usage looks like this:

```go
func handle(req *Request) (*Response, error) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    // ... use buf ...

    return buildResponse(buf.Bytes()), nil
}
```

`defer bufPool.Put(buf)` guarantees the buffer goes back to the pool even if the function returns early because of an error. Without that defer, an early `return` can leak the buffer (which is not catastrophic — it will be GC'd eventually — but it defeats the point of pooling).

We will see in section 12 that there is a subtle bug hidden in this exact pattern when the buffer's backing memory escapes via `buf.Bytes()`.

### 2.2 Zero value works

`sync.Pool`'s zero value is a usable, empty pool. You do not need to call any constructor:

```go
var bufPool sync.Pool

func get() *bytes.Buffer {
    if b := bufPool.Get(); b != nil {
        return b.(*bytes.Buffer)
    }
    return new(bytes.Buffer)
}
```

If `New` is `nil`, `Get` returns `nil` when the pool is empty. You then have to handle that case yourself. Almost always it is cleaner to set `New` and skip the nil check.

## 3. The contract — and what it isn't

The Go documentation has one sentence about `sync.Pool` that is worth memorizing:

> Any item stored in the Pool may be removed automatically at any time without notification.

That sentence is the contract. Every misuse of `sync.Pool` boils down to violating it. Let's unpack what it really means.

### 3.1 "Removed automatically"

The Go runtime is allowed, at any moment, to delete every object in every `sync.Pool`. It will not call any finalizer you might have set. It will not notify you. The objects simply become unreferenced and eligible for GC.

Concretely, this happens at every GC cycle. After a GC cycle, items that were in the pool from before may be gone. (The exact policy involves a "victim cache" that we cover in the middle page — the point for now is: assume the pool empties.)

If your code depends on an object being in the pool — for example, "I put a database connection in here, I will get it back later" — you have already lost. The pool may have dropped it.

### 3.2 "Without notification"

You do not get a callback. There is no `OnEvict`. There is no `Len()`, no `Cap()`, no way to inspect the pool. From outside, the only observable behavior is that `Get` sometimes returns objects you put in, and sometimes returns fresh ones (or nil).

### 3.3 What this means for you

- You may NOT use `sync.Pool` for anything that needs deterministic lifecycle: file handles, database connections, network sockets, mutexes that own state. Use a real resource pool (`database/sql`'s connection pool, a buffered channel, a third-party library).
- You may NOT rely on `Put` plus later `Get` to mean "I cached this." It might be gone the next instant.
- You MUST treat every `Get` as potentially fresh. The object you get out should be reset to a known state.

A useful slogan: `sync.Pool` is a hint, not a contract. You hint to the runtime "I might want one of these later." The runtime may comply, or may not.

### 3.4 A small experiment showing the contract

Let's prove that GC drains the pool. We will put a sentinel value in, force a GC, and try to get it back.

```go
package poolintro

import (
    "fmt"
    "runtime"
    "sync"
)

type Marker struct {
    Name string
}

func DemoGCDrain() {
    var p sync.Pool
    p.New = func() any { return &Marker{Name: "fresh"} }

    // Put a labelled object in.
    p.Put(&Marker{Name: "put-by-me"})

    // Immediately get it back — likely the same one.
    got := p.Get().(*Marker)
    fmt.Println("first get:", got.Name) // probably "put-by-me"

    // Put it back, then force GC.
    p.Put(got)
    runtime.GC()
    runtime.GC() // belt and suspenders; see section 13

    // After GC, the pool is likely empty.
    next := p.Get().(*Marker)
    fmt.Println("after GC get:", next.Name) // likely "fresh"
}
```

When you run this, the first `Get` returns your labelled object. After `runtime.GC()`, the pool has been drained and you get back a freshly-constructed `Marker{Name: "fresh"}`.

This is not a bug. This is the documented contract. The pool is designed to be empty after GC. The whole point is that the pool holds objects "until the next GC," not "until you remove them."

## 4. Reset before Put — the most common bug

Imagine the following innocent-looking helper:

```go
package poolintro

import (
    "bytes"
    "fmt"
    "sync"
)

var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

// BUG: does not reset.
func renderLine(prefix string, n int) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    fmt.Fprintf(buf, "%s=%d", prefix, n)
    return buf.String()
}
```

The first call returns `"x=1"`. The second call returns `"x=1y=2"`. The third returns `"x=1y=2z=3"`. The buffer accumulates state because nothing reset it.

Worse, this bug is non-deterministic. If GC drains the pool between calls, you get a fresh buffer and the bug seems to disappear. Under low load (in dev), you can't reproduce it. In production, when the same buffer is reused for 10,000 requests in a row, the buffer grows without bound.

The fix is one line:

```go
func renderLine(prefix string, n int) string {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()           // <- this
    defer bufPool.Put(buf)
    fmt.Fprintf(buf, "%s=%d", prefix, n)
    return buf.String()
}
```

### 4.1 Where to put the Reset

There are two schools:

- **Reset on Get** (above): the consumer is responsible for clearing state before use.
- **Reset on Put**: the producer is responsible for handing back a clean object.

Both are valid. The standard library tends toward "reset on Put" so that what is sitting in the pool is always in a clean state. The reason is locality — when you `Put`, you have just finished using the object and you know what state it is in. When you `Get`, you might forget.

Either way, **always** reset somewhere. The pool does not reset for you.

```go
// Pattern: reset on Put.
func renderLineV2(prefix string, n int) string {
    buf := bufPool.Get().(*bytes.Buffer)
    fmt.Fprintf(buf, "%s=%d", prefix, n)
    out := buf.String()

    buf.Reset()
    bufPool.Put(buf)
    return out
}
```

### 4.2 What "reset" means depends on the type

For `bytes.Buffer`, `Reset()` truncates the internal slice to length zero but keeps the capacity. Capacity is what you want to keep — that's why you're pooling.

For your own struct, you may need to write a `reset()` method:

```go
type RequestContext struct {
    User    *User
    Trace   []Span
    Tags    map[string]string
    Started time.Time
}

func (r *RequestContext) reset() {
    r.User = nil
    r.Trace = r.Trace[:0] // keep cap
    for k := range r.Tags {
        delete(r.Tags, k) // keep map
    }
    r.Started = time.Time{}
}
```

Two things to notice:

- For slices, `r.Trace = r.Trace[:0]` keeps the underlying array.
- For maps, you have to `delete` keys (or replace with a new map). There is also `clear(m)` in Go 1.21+.

This pattern — explicitly reset fields, keep underlying allocations — is the whole reason pooling pays off. If your `reset` re-allocates everything, you've gained nothing.

### 4.3 Forgetting to nil pointer fields is a leak

Suppose `RequestContext.User` is a `*User` pointer. If `reset` does not set it to `nil`, the pooled `RequestContext` keeps that `User` alive as long as the pool keeps the context. That's a memory leak that scales with pool size.

```go
// BAD
func (r *RequestContext) reset() {
    r.Trace = r.Trace[:0]
    // forgot User! It still points at the previous request's user.
}
```

Rule: when resetting, set every pointer-bearing field to nil (or zero), unless you specifically want to keep its allocation (slices, maps).

## 5. The classic stdlib example — buffers in encoding/json and fmt

Both `encoding/json` and the `fmt` package internally pool intermediate buffers. Let's look at a simplified version of what `fmt` does, because it is the canonical "pool a buffer, format into it, return the result" pattern.

```go
package poolintro

import (
    "fmt"
    "strconv"
    "sync"
)

type printBuf struct {
    bs []byte
}

var printBufPool = sync.Pool{
    New: func() any {
        return &printBuf{bs: make([]byte, 0, 64)}
    },
}

func Itoa(n int) string {
    p := printBufPool.Get().(*printBuf)
    p.bs = p.bs[:0]
    p.bs = strconv.AppendInt(p.bs, int64(n), 10)
    s := string(p.bs) // copy into immutable string
    printBufPool.Put(p)
    return s
}
```

A few patterns to internalize:

1. We pool a small struct (`printBuf`) instead of pooling a raw `[]byte`. We will see in section 8 why that matters.
2. We pre-size the slice (`make([]byte, 0, 64)`) so the first user doesn't pay the growth cost.
3. We reset by slicing (`p.bs[:0]`), which keeps the underlying array.
4. We copy the result into a string (`string(p.bs)`), which makes an immutable copy. We can safely return the slice to the pool because nobody outside this function can ever see the slice itself.

The string copy is interesting: `string(p.bs)` allocates. So we have not eliminated allocation entirely; we have moved it from "buffer plus result" to "just result." On hot paths where the result is consumed and discarded quickly (logging, error messages), even that is too much, and the stdlib uses tricks like writing directly to an `io.Writer` to avoid the copy.

### 5.1 fmt.Sprintf-style helper

Here is a more complete example: format anything into a pooled buffer and return a string.

```go
func Sprintf(format string, args ...any) string {
    p := printBufPool.Get().(*printBuf)
    p.bs = p.bs[:0]
    // Pretend we have an internal formatter that writes into p.bs.
    p.bs = fmt.Appendf(p.bs, format, args...)
    s := string(p.bs)
    printBufPool.Put(p)
    return s
}
```

Note `fmt.Appendf` (Go 1.19+) — it formats into an existing byte slice, which is exactly the pool-friendly shape we want.

## 6. When NOT to use sync.Pool

This section is more important than any other in this page. The pool pays off only in specific situations. Using it elsewhere is at best a wash and at worst a serious bug.

### 6.1 Cheap-to-allocate objects

If allocating the object is cheap and the object is small, pooling probably costs more than it saves. The overhead of `Get` (interface boxing, atomic operations under the hood, the type assertion) is a few nanoseconds. Allocating a small struct on the heap is also a few nanoseconds. Net win: zero, maybe negative.

```go
// Don't bother pooling this.
type Point struct {
    X, Y float64
}
```

A pool helps when:

- The object holds an expensive-to-create resource (a big preallocated slice, a tree, a parser state machine).
- The object is allocated and discarded at a high rate (many thousands per second per goroutine).
- The escape analyzer can't prove it stays on the stack.

### 6.2 Scarce resources

Database connections, file descriptors, sockets, GPU contexts — anything where the operating system or remote service has a hard cap on how many can exist — **do not belong in `sync.Pool`**. Why? Because `sync.Pool` is allowed to drop them. If your DB connection pool has 10 connections, and the pool drops 5, you have leaked 5 connections to the database (they remain open on the server side until they time out) and you must reopen 5 when you need them again.

Use a real connection pool:

- `database/sql.DB` for SQL connections (it has its own pool).
- A buffered channel of `*Resource` for hand-rolled pools.
- Library-specific pools (e.g., `redis.Pool` in older redigo, `pgxpool.Pool` in pgx).

The distinguishing question to ask: *is it a problem if this object disappears unexpectedly?* If yes, do not use `sync.Pool`.

### 6.3 Objects you need to enumerate

`sync.Pool` has no `Len`, no iteration, no inspection. If you want to "look at all cached XYZ objects," `sync.Pool` is wrong. Use a map guarded by a mutex, or a separate cache library.

### 6.4 Objects with finalizers

`runtime.SetFinalizer` and pooling interact poorly. The pool can drop an object, the GC then runs the finalizer, but the next `Get` might construct a fresh object via `New` rather than running the finalizer. If your finalizer is doing important work (closing a fd, releasing a lock), you cannot rely on it. Worse, if your `reset` resurrects pointers, finalizers can fire in unexpected orders. Simple rule: don't combine `sync.Pool` with `SetFinalizer`.

### 6.5 Objects that contain pointers to large graphs

This is more subtle. Suppose your pooled object has a pointer to a 100 MB cache. When the pool keeps your object alive, it also keeps that 100 MB alive. The pool was supposed to reduce GC pressure, but by holding a reference to a huge graph, it has actually pinned a lot of memory.

A useful guideline: pooled objects should be small leaf data structures. Reset any pointers they hold to deeper graphs.

### 6.6 Pools that are not hot

`sync.Pool` is a runtime feature designed for hot paths. If your code allocates a buffer once per HTTP request that takes 50ms to process, the buffer is not your bottleneck. Don't pool. The cognitive overhead and the bug surface are not worth it.

A heuristic: don't pool unless `pprof` or `go test -benchmem` has told you that an allocation is showing up as a problem.

## 7. The Put-after-Reset idiom

Putting these together gives the canonical idiom. Almost every well-written pool user looks like this:

```go
func work() *Result {
    obj := pool.Get().(*Obj)
    defer func() {
        obj.reset() // clean before returning to pool
        pool.Put(obj)
    }()

    // use obj
    return computeResult(obj)
}
```

Or, if `reset` is cheap and you prefer to reset on get:

```go
func work() *Result {
    obj := pool.Get().(*Obj)
    obj.reset()
    defer pool.Put(obj)

    // use obj
    return computeResult(obj)
}
```

The mistakes to avoid:

- Forgetting `defer` and returning early without `Put` (leaks the buffer — not catastrophic but defeats pooling).
- Forgetting `reset` (state leaks into the next user).
- Calling `Put` twice (one buffer ends up in the pool from two goroutines, with both "owning" it — a data race waiting to happen).
- Calling `Put` and then continuing to use the buffer (another goroutine may now also own it).

The last two share a theme: once you `Put`, you have transferred ownership. Treat the variable as if it no longer exists. Many bugs come from "I'll just read one more thing off it after Put" — by then, somebody else might be writing to it.

### 7.1 Sentinel-style enforcement

If you want compile-time-ish help, you can return a "release" function:

```go
func GetBuf() (*bytes.Buffer, func()) {
    b := bufPool.Get().(*bytes.Buffer)
    b.Reset()
    return b, func() {
        b.Reset()
        bufPool.Put(b)
    }
}

func use() {
    b, release := GetBuf()
    defer release()
    // ... use b ...
}
```

This makes the lifecycle explicit at the call site and prevents accidental forgotten `Put`s. The downside is one closure allocation per call (which may or may not get inlined; check with `go build -gcflags=-m`).

## 8. The boxing cost — Pool stores `any`

`sync.Pool.Get()` returns `any`, which is `interface{}`. `Put` takes `any`. That means every object you put in or take out is wrapped in an interface header (two words: type pointer and data pointer).

For **pointer types**, this is essentially free. An interface holding a `*bytes.Buffer` stores the type pointer plus the pointer value, no allocation needed.

For **value types**, the boxing requires the value to live on the heap, because an interface header points to it. So if you pool `bytes.Buffer` by value:

```go
var bufPool = sync.Pool{
    New: func() any { return bytes.Buffer{} }, // VALUE, not pointer
}
```

Then every `Put(buf)` allocates a new heap location to hold the buffer, defeating the whole point of pooling.

**Rule: pool pointers, not values.** Always `return new(T)` or `return &T{}` from `New`, never `return T{}`.

### 8.1 What if I want to pool a small value?

Pool a wrapper struct that holds a slice or other reusable allocation:

```go
type intBuf struct {
    vals []int
}

var intBufPool = sync.Pool{
    New: func() any {
        return &intBuf{vals: make([]int, 0, 32)}
    },
}
```

The `*intBuf` is the thing in the interface. The `vals` slice is what we actually want to reuse.

### 8.2 Generics?

In Go 1.18+, you might want a generic `Pool[T]`. The standard library doesn't have one because the interface boxing happens regardless of how you type things at the public surface — `sync.Pool` is internally `any`-typed. But you can write a thin wrapper:

```go
type TypedPool[T any] struct {
    p   sync.Pool
    New func() *T
}

func (tp *TypedPool[T]) Get() *T {
    if v := tp.p.Get(); v != nil {
        return v.(*T)
    }
    return tp.New()
}

func (tp *TypedPool[T]) Put(x *T) {
    tp.p.Put(x)
}
```

This is a small ergonomic win but does not change the boxing cost; the interior `sync.Pool` still works in `any`. It does, however, prevent you from accidentally putting the wrong type in.

## 9. Benchmarking — proving the pool is worth it

You should never add a pool without measuring. The boxing cost, the cache-line bouncing under contention, and the cognitive overhead all push the other way. Here is a complete benchmark suite for a small example.

```go
package poolintro

import (
    "bytes"
    "fmt"
    "sync"
    "testing"
)

var globalBufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func formatNoPool(n int) string {
    var buf bytes.Buffer
    for i := 0; i < n; i++ {
        fmt.Fprintf(&buf, "value=%d\n", i)
    }
    return buf.String()
}

func formatWithPool(n int) string {
    buf := globalBufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer globalBufPool.Put(buf)
    for i := 0; i < n; i++ {
        fmt.Fprintf(buf, "value=%d\n", i)
    }
    return buf.String()
}

func BenchmarkFormatNoPool(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = formatNoPool(100)
    }
}

func BenchmarkFormatWithPool(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = formatWithPool(100)
    }
}
```

Sample output:

```
BenchmarkFormatNoPool-8     200000   7250 ns/op   2240 B/op   8 allocs/op
BenchmarkFormatWithPool-8   300000   6100 ns/op   1024 B/op   1 allocs/op
```

The pooled version allocates 8x fewer bytes and 8x fewer objects per call. The wall-time difference is smaller, because allocation in Go is fast — the win shows up under GC pressure, not in microbenchmarks.

### 9.1 Why GC pressure doesn't show in micro-benchmarks

`testing.B` runs a tight loop. Go's GC is concurrent and amortized, so in a benchmark the GC time is averaged across many calls. To really see the win, you need a benchmark with `-benchtime=10s` and a comparison of GC time:

```
go test -bench=. -benchmem -benchtime=10s -gcflags=
```

Or use `runtime.ReadMemStats` to measure `NumGC` and `PauseTotalNs` before and after.

### 9.2 Parallel benchmarks

`sync.Pool` is designed for concurrent use. To exercise that, use `b.RunParallel`:

```go
func BenchmarkFormatWithPoolParallel(b *testing.B) {
    b.ReportAllocs()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = formatWithPool(100)
        }
    })
}
```

Now multiple goroutines are hammering the same pool. If the pool is working well, you should see allocs/op stay near 1 even under parallelism. (This is where the per-P sharding inside `sync.Pool` shines, but we are saving the details for the senior page.)

### 9.3 The "no pool" baseline can lie

If the compiler can prove your buffer doesn't escape, it might be stack-allocated, in which case `BenchmarkFormatNoPool` shows zero allocs and the pool actually loses. Always check escape analysis:

```
go build -gcflags='-m' ./...
```

If the no-pool version reports `does not escape`, the pool is probably overkill.

## 10. Concurrency — the pool is safe to use from many goroutines

`sync.Pool` is safe for concurrent use. Multiple goroutines can call `Get` and `Put` at the same time without external synchronization. You do not need to wrap it in a mutex.

What the pool guarantees:

- No data races inside the pool itself.
- Each object returned by `Get` is owned by exactly one goroutine until that goroutine `Put`s it back.

What the pool does NOT guarantee:

- Order. You may get back an object that some other goroutine put in two seconds ago, or one your own goroutine put in a microsecond ago, or a fresh one.
- Locality. The pool is internally sharded per processor, so under low contention you tend to get back what you yourself just put in. But do not depend on this — it is an optimization, not a contract.

### 10.1 What you must NOT do across goroutines

```go
// BAD
buf := bufPool.Get().(*bytes.Buffer)
go func() {
    buf.WriteString("hello") // RACE: another goroutine may now own this buffer
}()
bufPool.Put(buf)
```

Once you call `Put`, the buffer's ownership is given up. Spawning a goroutine that continues to use it is a use-after-put bug — exactly equivalent to a use-after-free in C.

The reverse mistake:

```go
// BAD
buf := bufPool.Get().(*bytes.Buffer)
go bufPool.Put(buf)
buf.WriteString("hello") // RACE
```

Putting from a different goroutine while the original goroutine still uses the buffer is also a race.

Rule: the goroutine that called `Get` should be the one that calls `Put`, and there should be no use between `Put` and the function returning.

### 10.2 Passing the buffer to another goroutine deliberately

Sometimes you want to hand off a buffer to a goroutine that finishes the work. That is fine — the new goroutine then owns the buffer and is responsible for putting it back. Just be explicit:

```go
func handoff() {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    // We are giving this to the goroutine; do NOT Put here.
    go func() {
        defer bufPool.Put(buf)
        fmt.Fprintf(buf, "background work\n")
        // ... use buf ...
    }()
}
```

The discipline is the same as with any owned resource: ownership transfers at the channel or function call boundary.

## 11. Pooling slices — the slice-header subtlety

Pooling `[]byte` directly is tempting but tricky. Let's see why.

```go
var bytePool = sync.Pool{
    New: func() any {
        b := make([]byte, 0, 1024)
        return b
    },
}
```

Wait — what type is in the pool? `[]byte` is a value type (a slice header: pointer, length, capacity). When you `Put` a `[]byte`, the slice header gets boxed into an interface, which usually means a small heap allocation just for the header.

So we end up allocating to *avoid* allocating, which is exactly backward. The fix is to pool a pointer:

```go
var bytePool = sync.Pool{
    New: func() any {
        b := make([]byte, 0, 1024)
        return &b
    },
}

func work() {
    pb := bytePool.Get().(*[]byte)
    *pb = (*pb)[:0] // reset length

    *pb = append(*pb, "hello, world"...)

    // ... use *pb ...

    bytePool.Put(pb)
}
```

This pools the pointer to the slice. The slice header is on the heap (as part of whatever struct contains it, or as a standalone heap value), but it is the *same* heap location every time, and the underlying byte array is reused.

### 11.1 The cap-growth problem

Even with pointer-pooled slices, there is a sneaky behavior. If a consumer appends a lot of data, the underlying array grows. The cap can become 10 MB even though most users only need 1 KB. Now every buffer in the pool is 10 MB.

```go
pb := bytePool.Get().(*[]byte)
*pb = (*pb)[:0]
for i := 0; i < 1_000_000; i++ {
    *pb = append(*pb, byte(i))
}
// underlying array is now ~1 MB
bytePool.Put(pb)
```

After this, every subsequent user of the pool inherits the 1 MB capacity. Over time, the pool's memory footprint creeps up.

The defense is to discard buffers that have grown beyond a threshold:

```go
func putByteBuf(pb *[]byte) {
    if cap(*pb) > 64*1024 {
        // Too big; let GC reclaim it.
        return
    }
    *pb = (*pb)[:0]
    bytePool.Put(pb)
}
```

This is a real pattern used in the standard library and in popular packages like `bytes.Buffer` users. The threshold depends on your application.

### 11.2 sync.Pool's own size-class behavior

`sync.Pool` does not know or care about the size of what you put in. It just stores a reference. So if you put a 1 MB slice in, it stores a reference to a 1 MB slice. The size policing must come from you.

## 12. Pool-backed memory escaping — a common bug

This is one of the most insidious bugs you can hit. Consider:

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render() []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    fmt.Fprintf(buf, "hello, %s", "world")
    return buf.Bytes() // BUG: shares the backing array
}
```

`buf.Bytes()` returns a `[]byte` that aliases the buffer's internal byte slice. When `defer bufPool.Put(buf)` runs, the buffer goes back to the pool. The next call to `render` (or any other pool user) might get the same buffer, reset it, and start writing to it — corrupting the slice we returned.

To the caller, the bytes silently mutate. There is no panic, no error, just garbage data.

### 12.1 The fix

Copy the bytes out of the pool before returning:

```go
func render() []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    fmt.Fprintf(buf, "hello, %s", "world")

    out := make([]byte, buf.Len())
    copy(out, buf.Bytes())
    return out
}
```

Or, if the caller can accept a string (which is immutable and gets a fresh allocation):

```go
return buf.String() // safe — string makes a copy
```

`buf.String()` allocates a string with its own backing memory. The allocation is unavoidable here, but at least the result is safe.

### 12.2 The general rule

Anything that survives past `Put` must not alias pool-backed memory. Specifically:

- `bytes.Buffer.Bytes()` aliases. Don't return it.
- `bytes.Buffer.String()` does not alias. Safe to return.
- Slicing a pooled `[]byte` aliases. Don't return slices of it.
- Strings created via `string(bs)` do not alias. Safe.

When in doubt, copy.

### 12.3 A second variant — appending to a returned slice

```go
func render() []byte {
    p := bytePool.Get().(*[]byte)
    *p = (*p)[:0]
    *p = append(*p, "hello"...)
    out := *p
    bytePool.Put(p)
    return out // BUG: out aliases the pooled slice
}
```

Same bug, same fix. Either copy or use a string conversion.

## 13. GC and the pool — what you can observe

We hinted at this in section 3. Let's make it concrete and write the code to observe it.

The lifecycle is:

1. You `Put` objects.
2. The pool keeps them.
3. A GC cycle runs.
4. The pool drops them. (In modern Go, there is a "victim cache" that keeps objects across one extra GC, but assume drop after two cycles.)
5. The next `Get` either calls `New` or, if anyone has `Put` since the last GC, returns one of those.

You can see the drop by forcing GC:

```go
package poolintro

import (
    "fmt"
    "runtime"
    "sync"
)

type Beacon struct{ id int }

var beaconPool = sync.Pool{
    New: func() any { return &Beacon{id: -1} },
}

func DemoVictim() {
    // Put a clearly-marked item.
    beaconPool.Put(&Beacon{id: 42})

    // Force two GCs to drain even the victim cache.
    runtime.GC()
    runtime.GC()

    b := beaconPool.Get().(*Beacon)
    fmt.Println("id:", b.id) // -1 — the pool is empty
}
```

If you remove the second `runtime.GC()`, you may still get `id: 42` back, because the victim cache holds it for one extra cycle. The exact behavior is a runtime detail; what is documented is the contract: "may be removed at any time."

### 13.1 Pause behavior

When the GC runs, it triggers per-pool draining. In high-allocation services, GC can run many times per second, which means the pool is drained many times per second, which means the first request after each GC pays the `New` cost. For most services this is fine; for ultra-low-latency services it is something to know about.

### 13.2 You cannot influence the policy

`sync.Pool` does not have:

- A `MaxSize`.
- A `MinSize`.
- An `OnEvict`.
- Any way to inspect or steer when GC drains it.

If you need any of those, build a real cache (see the middle page for what people typically do instead).

## 14. ASCII visualization — the pool emptying at GC

Here is a simplified picture of what happens at GC. The pool internally has per-P shards (we cover that in the middle page) and a victim cache; here we just show "main" and "victim" buckets.

```
Time t0: program startup.

  Pool main:    []
  Pool victim:  []

After many Puts:

  Pool main:    [b1, b2, b3, b4]
  Pool victim:  []

GC cycle #1 runs:
  - main becomes victim.
  - new main is empty.

  Pool main:    []
  Pool victim:  [b1, b2, b3, b4]

After Puts and Gets between GCs, main fills up again:

  Pool main:    [b5, b6]
  Pool victim:  [b1, b2, b3, b4]

GC cycle #2 runs:
  - victim is discarded (b1..b4 become garbage).
  - main becomes victim.
  - new main is empty.

  Pool main:    []
  Pool victim:  [b5, b6]
```

The key insight: an object you `Put` survives at most two GC cycles. Usually it survives one. After that, it is gone.

This is by design. The pool exists to absorb churn between GCs, not to be a long-term cache. If your "long-term cache" is what you wanted, `sync.Pool` is the wrong tool.

## 15. A complete worked example — JSON-encoding HTTP handler

Let's bring everything together. Suppose we have an HTTP handler that responds with JSON. Without pooling, each request allocates:

- A `bytes.Buffer` for the JSON output.
- A `json.Encoder` wrapping the buffer.
- The JSON-encoded bytes.

The buffer and encoder are good candidates for pooling. The output bytes ultimately need to leave the function (in this case, via `w.Write`), so we have to be careful about the aliasing bug from section 12.

```go
package poolintro

import (
    "bytes"
    "encoding/json"
    "net/http"
    "sync"
)

// Pool holds reusable encoder+buffer pairs.
// Pooling the pair together means we don't pay to re-wire the encoder.
type encodeKit struct {
    buf *bytes.Buffer
    enc *json.Encoder
}

var encodeKitPool = sync.Pool{
    New: func() any {
        buf := new(bytes.Buffer)
        return &encodeKit{
            buf: buf,
            enc: json.NewEncoder(buf),
        }
    },
}

func writeJSON(w http.ResponseWriter, v any) error {
    kit := encodeKitPool.Get().(*encodeKit)
    kit.buf.Reset()
    defer encodeKitPool.Put(kit)

    if err := kit.enc.Encode(v); err != nil {
        return err
    }

    // kit.buf.Bytes() aliases pool memory; copy via Write into the
    // ResponseWriter, which itself copies into its own buffer.
    w.Header().Set("Content-Type", "application/json")
    _, err := w.Write(kit.buf.Bytes())
    return err
}

type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}

func userHandler(w http.ResponseWriter, r *http.Request) {
    u := &User{ID: 1, Name: "alice"}
    if err := writeJSON(w, u); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
    }
}

func main() {
    http.HandleFunc("/user", userHandler)
    _ = http.ListenAndServe(":8080", nil)
}
```

Several things to notice:

- We pool the `(buf, enc)` pair, not just the buffer. `json.NewEncoder(buf)` saves repeated allocation of the encoder struct. The encoder holds a pointer to the buffer; we don't have to re-wire them.
- We `Reset` the buffer on every `Get`. The encoder does not need explicit resetting; its state lives in its buffer and a few small fields.
- We copy out via `w.Write(kit.buf.Bytes())` — and that is safe because `Write` synchronously copies into its own buffer before returning. The aliasing window is bounded by the function.
- We `defer encodeKitPool.Put(kit)`.

Run a benchmark on this and you will see that `allocs/op` drops dramatically.

### 15.1 Variation — streaming directly

If we don't care about response status checks and just want to write directly to the wire, we can skip the intermediate buffer entirely:

```go
func writeJSONStream(w http.ResponseWriter, v any) error {
    enc := encoderPool.Get().(*json.Encoder)
    // ... but how do we re-attach the writer?
}
```

This is harder because `json.Encoder` is wired to a writer at construction time. There is `Encoder.SetIndent`, `SetEscapeHTML`, etc., but no public `SetWriter`. So streaming-and-pooling is awkward; the buffer-then-Write pattern is more common.

### 15.2 Variation — sized buffers

If most responses are around 4 KB but some are 4 MB, you may want to put the 4 MB buffer back to the GC rather than pooling it:

```go
func writeJSON(w http.ResponseWriter, v any) error {
    kit := encodeKitPool.Get().(*encodeKit)
    kit.buf.Reset()
    defer func() {
        if kit.buf.Cap() > 64*1024 {
            // discard — too big.
            return
        }
        encodeKitPool.Put(kit)
    }()
    // ...
}
```

This is the discipline we introduced in section 11.1, applied to a more complex pooled object.

## 16. Interview question — "What happens to objects in sync.Pool during GC?"

This question comes up in Go interviews. The textbook answer:

> At each garbage collection cycle, the items currently in the pool's "main" bucket are moved to a "victim" bucket, and any items previously in the victim bucket are released. After two GCs without any further `Get`/`Put`, the pool is effectively empty. Therefore, you cannot rely on `sync.Pool` for long-term storage or for any object whose lifetime you need to control.

A more conversational version, the kind you would say in an interview:

> sync.Pool is designed to absorb short-lived allocation churn between garbage collections. The runtime considers anything in the pool to be eligible for cleanup at GC time. Concretely, there is a two-level cache — items survive one GC but not two — and after that they are released back to the heap. As a developer, the implication is that I treat the pool as a hint to the runtime, never as a guarantee that the object is still there. Anything I `Put` may or may not come back. That's why pooled objects must always be in a clean state on Get, and why pooled objects must not be the only reference holding scarce resources alive.

### 16.1 Follow-up questions and good answers

**"Why two cycles instead of one?"**

Because some workloads see the pool drained between every batch of work, and forcing them to re-`New` the object every cycle eats into the benefit. The victim cache adds a one-cycle grace period so that warm pools stay warm across a single GC.

**"What if I want a real cache that survives across GCs?"**

Use a different data structure: a `map` guarded by a mutex, or an LRU cache, or a `freelist` you manage explicitly. `sync.Pool` is the wrong tool for that job.

**"Is it safe to use sync.Pool from many goroutines?"**

Yes. `Get` and `Put` are safe for concurrent use without external synchronization. Internally, the pool shards per processor to reduce contention, but that is an implementation detail; from the API's perspective it is just safe.

**"Should I always pool buffers?"**

No. Pool only when you have measured allocation pressure on a hot path. The boxing cost, the discipline cost (every consumer must Reset), and the GC drain make pooling a net loss for cold or already-cheap code.

**"What is the difference between sync.Pool and a free list?"**

A free list you manage holds objects until you explicitly remove them. `sync.Pool` holds them until the next GC. The free list is more predictable but contends on every `Get`/`Put` unless you also shard it.

**"Why is the pool sharded per P?"**

To eliminate atomic contention on the fast path. Each P has its own bucket; Gets and Puts on the local bucket need no atomic operations. Cross-P stealing is a fallback. (We cover this in detail in the middle page.)

## 17. Common pitfalls — a short checklist

Before you ship code that uses `sync.Pool`, audit each of these:

1. **Reset every Get (or every Put), without exception.**
2. **Pool pointers, not values** — `return new(T)`, not `return T{}` from `New`.
3. **Never use a pooled object after Put.** Once put, ownership transferred.
4. **Don't pool scarce resources** — sockets, file handles, DB connections.
5. **Don't return aliased memory** from a function whose pooled buffer is about to be Put.
6. **Beware unbounded cap growth** — discard oversized objects on Put.
7. **Don't use SetFinalizer on pooled objects.**
8. **Measure first.** Pooling is a runtime optimization, not a design pattern.

A more nuanced list, with examples:

| # | Pitfall | Example | Symptom |
|---|---------|---------|---------|
| 1 | Forgetting Reset | `buf := pool.Get().(*Buffer); fmt.Fprintf(buf, "x")` | Data from previous user leaks. |
| 2 | Pooling values | `New: func() any { return Buffer{} }` | Every Put allocates a heap box. |
| 3 | Use-after-Put | `pool.Put(buf); buf.WriteString("...")` | Data race; the next user is writing too. |
| 4 | Pooling DB conns | `pool.Put(conn)` | Connections leak; GC drains them. |
| 5 | Returning Bytes() | `defer pool.Put(buf); return buf.Bytes()` | Caller sees corrupt bytes. |
| 6 | Cap growth | `*p = append(*p, mb...)` then Put | Pool memory creeps up. |
| 7 | Finalizers | `runtime.SetFinalizer(obj, ...); pool.Put(obj)` | Unpredictable cleanup. |
| 8 | Pooling cold code | One pool call per second | Code is more complex; benchmark wins are zero. |

## 18. A second worked example — XML/CSV exporter

Let's do another full example to cement the pattern. We will write a CSV exporter that converts rows of data into CSV bytes for download.

```go
package poolintro

import (
    "bytes"
    "encoding/csv"
    "io"
    "strconv"
    "sync"
)

type csvKit struct {
    buf *bytes.Buffer
    w   *csv.Writer
}

var csvKitPool = sync.Pool{
    New: func() any {
        buf := new(bytes.Buffer)
        return &csvKit{
            buf: buf,
            w:   csv.NewWriter(buf),
        }
    },
}

type Row struct {
    ID    int
    Name  string
    Score float64
}

func RowsToCSV(rows []Row, out io.Writer) error {
    kit := csvKitPool.Get().(*csvKit)
    kit.buf.Reset()
    // csv.Writer holds a pointer to the buffer; nothing else to reset.
    defer csvKitPool.Put(kit)

    if err := kit.w.Write([]string{"id", "name", "score"}); err != nil {
        return err
    }
    var idStr, scoreStr []byte
    for _, r := range rows {
        idStr = strconv.AppendInt(idStr[:0], int64(r.ID), 10)
        scoreStr = strconv.AppendFloat(scoreStr[:0], r.Score, 'f', 2, 64)
        if err := kit.w.Write([]string{
            string(idStr), r.Name, string(scoreStr),
        }); err != nil {
            return err
        }
    }
    kit.w.Flush()
    if err := kit.w.Error(); err != nil {
        return err
    }
    _, err := out.Write(kit.buf.Bytes())
    return err
}
```

Things worth noting:

- We pool the `csvKit` (buffer + writer) so the writer doesn't need re-wiring.
- We `Reset` the buffer; the writer's state lives in the buffer.
- We use `strconv.AppendInt`/`AppendFloat` with local scratch slices to avoid allocating strings for numbers. (Those slices are not pooled here because they live for the function only and escape analysis can keep them on the stack.)
- The final `out.Write(kit.buf.Bytes())` is safe because `Write` consumes synchronously.

If you benchmark this against a non-pooled version, you will see the `csv.Writer` allocation disappear and the `bytes.Buffer` allocation amortize out.

## 19. Pool of pools — anti-pattern

Sometimes people try to build a `map[size]*sync.Pool`, where each bucket holds buffers of a particular size class. This is rarely a good idea. The standard library does it once (in `crypto/tls`) but for very specific reasons. For application code, prefer:

- A single pool with a `New` that allocates a "good default" size.
- A per-call decision: if you need a buffer much bigger than the default, allocate it directly and skip the pool.

Multiple pools also defeat the per-P sharding inside each pool: each pool has its own shards, and bouncing between them ruins cache locality.

If you really do have a multi-modal size distribution and you really do see allocation pressure across all modes, build a size-classed allocator and back each class with its own pool — but expect this to be uncommon.

## 20. Pool vs free channel — when to pick which

A common alternative to `sync.Pool` is a buffered channel acting as a free list:

```go
type ChanPool struct {
    ch chan *Buffer
}

func NewChanPool(size int) *ChanPool {
    return &ChanPool{ch: make(chan *Buffer, size)}
}

func (p *ChanPool) Get() *Buffer {
    select {
    case b := <-p.ch:
        return b
    default:
        return new(Buffer)
    }
}

func (p *ChanPool) Put(b *Buffer) {
    select {
    case p.ch <- b:
    default:
        // pool full, drop it
    }
}
```

This pool is predictable: items survive across GCs, the size is bounded, and you can inspect it (channel length). It is also slower under high contention than `sync.Pool` because every operation goes through the channel's mutex.

When to choose:

- `sync.Pool`: GC-pressure relief, hot path, churn between GCs. Don't care if it drains.
- Buffered-channel pool: predictable lifecycle, bounded size, lower churn, willing to take the per-op cost.

For HTTP server buffer pooling, `sync.Pool` is almost always the right answer. For background workers consuming a fixed pool of expensive worker objects, a channel-based pool is often better.

## 21. Pool warming — when and how

Sometimes the cold-start cost matters. The very first `Get` calls `New`, which is expensive (allocating a big buffer, parsing a config, etc.). To smooth this out, you can pre-populate the pool:

```go
func warmPool(p *sync.Pool, n int) {
    items := make([]any, n)
    for i := 0; i < n; i++ {
        items[i] = p.New()
    }
    for _, it := range items {
        p.Put(it)
    }
}
```

We collect first, then `Put` second, so that the runtime cannot reclaim the items between the two loops. Each `Put` adds to the pool.

In practice, warming a `sync.Pool` is rare. By the time the first GC fires, your warmed objects are gone anyway. Warm only if your initialization cost is high and your service's first few hundred requests are critical.

## 22. Pooling and panics

If a goroutine panics between `Get` and `Put`, the pooled object is lost. That is fine — losing one pooled item is not a disaster. But you should think about state. If the panic happens *while you are modifying* the pooled object, the object is now in an inconsistent state. Should it be returned to the pool?

Two options:

1. **Don't return on panic.** `defer pool.Put(buf)` runs even during panic recovery, so this requires being more careful. You can guard with a flag:

   ```go
   func work() (err error) {
       buf := pool.Get().(*Buffer)
       buf.Reset()
       ok := false
       defer func() {
           if ok {
               pool.Put(buf)
           }
       }()

       riskyOperation(buf) // may panic
       ok = true
       return nil
   }
   ```

2. **Reset on Put unconditionally.** If your `reset` puts the object into a known-good state regardless of prior state, you can safely return it even after a panic:

   ```go
   defer func() {
       buf.Reset()
       pool.Put(buf)
   }()
   ```

Option 2 is usually cleaner. Just make sure `Reset` is bulletproof and never panics.

## 23. Pool and method values

A subtle issue. If your pooled type has a method that captures a method value, that method value pins the receiver:

```go
type Worker struct {
    name string
}

func (w *Worker) Run() {
    // ...
}

var workerPool = sync.Pool{
    New: func() any { return &Worker{} },
}

func use() {
    w := workerPool.Get().(*Worker)
    w.name = "alice"

    fn := w.Run // captures w

    go fn() // goroutine holds onto w forever

    workerPool.Put(w) // BUG: the goroutine still uses w
}
```

The method value `w.Run` is `func() { (&Worker).Run(w) }` — it captures `w`. If we then `Put` w and let another goroutine `Get` it, both goroutines see the same `*Worker`. Race.

The defense is the same as section 10: once you `Put`, treat the object as gone. Don't take method values into goroutines that outlive the function unless you also transfer ownership.

## 24. Embedding sync.Pool

`sync.Pool` is a struct, not a pointer-only type, but you should always use it by pointer or by embedded value at top level:

```go
// Good: package-level.
var bufPool = sync.Pool{ New: ... }

// Good: embedded in a long-lived type.
type Server struct {
    bufPool sync.Pool
}

// Bad: stack-local. Defeats the per-P sharding cache; you create a new pool every call.
func work() {
    var p sync.Pool
    p.New = func() any { return new(bytes.Buffer) }
    // ...
}
```

The pool's internal sharding is keyed by the pool object's address. A new pool every call means a new set of shards every call, all empty, all to be garbage-collected. You get all the costs and none of the benefits.

Rule: pools live as long as the program (package-level) or as long as a server (embedded in `Server`). Never function-local.

## 25. Why is the type `any`?

People sometimes ask: why doesn't `sync.Pool` use generics? Go has them now. The honest answer is historical: `sync.Pool` predates generics, and the implementation uses `any` (formerly `interface{}`) under the hood for runtime flexibility. A future "typed pool" might be added (it has been proposed many times), but as of today the API is `any`.

You can wrap it in a generic facade (see section 8.2), which gives you the ergonomic win of avoiding type assertions. The underlying boxing cost is unchanged.

## 26. A side note on goroutine-local "caches"

Sometimes people use `sync.Pool` as a stand-in for goroutine-local storage. Don't. The pool is not goroutine-local; it is processor-local. A goroutine can be moved to a different processor between two `Get` calls. If you really want goroutine-local data, pass it through function arguments or use `context.Context`.

There is no `runtime.GoroutineLocal()` in Go, and there is unlikely to ever be one. The Go community considers goroutine-local storage an anti-pattern.

## 27. Summary

The shortest possible summary of `sync.Pool`:

1. It is a hint cache for short-lived objects, drained by the GC.
2. Use it to reduce allocation pressure on hot paths, measured.
3. Always `Reset` and always `Put`. Never use after `Put`.
4. Pool pointers, not values.
5. Don't store anything you need to keep.
6. Beware aliased memory escaping past `Put`.

If you internalize those six rules, you will not write the common `sync.Pool` bugs. The rest is performance work, and the middle and senior pages take you into the runtime details.

## 28. Practice exercises

Try these at the REPL or in a `_test.go` file. The goal is to make the patterns muscle memory.

1. Write a `BenchmarkNoPool` and `BenchmarkWithPool` for a function that formats 100 floats into a `bytes.Buffer` and returns the string.
2. Reproduce the "state leak" bug by writing a `formatNoReset` function. Show that calling it 10 times in a row produces increasing string lengths.
3. Reproduce the "aliased return" bug by writing a function that returns `buf.Bytes()` and showing that two parallel callers can corrupt each other's output.
4. Write a small `TypedPool[T any]` wrapper and use it to pool `*[]int` slices.
5. Add a cap-growth defense to your `TypedPool` that discards slices whose cap exceeds 1 MB.
6. Force a `runtime.GC()` after a `Put` and observe that the next `Get` calls `New`.
7. Write a small HTTP handler that uses a pooled JSON encoder, and benchmark it against a non-pooled version under `wrk` or `hey`.

For each exercise, look at `go test -bench -benchmem` output to see allocations. If the pooled version doesn't show a clear reduction, ask yourself: is the object cheap enough that pooling is pointless? Is `New` being called every time because the pool is empty? Is the buffer being Reset?

## 29. Cheatsheet

```go
// Define
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

// Use
func handle() {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)
    // ... write into buf ...
    // ... if you return any bytes, COPY them out of buf ...
}

// Pool a slice via pointer
var slicePool = sync.Pool{
    New: func() any {
        s := make([]byte, 0, 1024)
        return &s
    },
}
ps := slicePool.Get().(*[]byte)
*ps = (*ps)[:0]
// ... use *ps ...
if cap(*ps) <= 64*1024 {
    slicePool.Put(ps)
}

// Pool a struct with reset()
type Ctx struct {
    Tags []string
    Map  map[string]int
}
func (c *Ctx) reset() {
    c.Tags = c.Tags[:0]
    for k := range c.Map {
        delete(c.Map, k)
    }
}
var ctxPool = sync.Pool{
    New: func() any {
        return &Ctx{Map: make(map[string]int)}
    },
}
c := ctxPool.Get().(*Ctx)
defer func() {
    c.reset()
    ctxPool.Put(c)
}()
// ... use c ...
```

## 30. Worked walkthrough — building a logging library

Let's design a small logging library to internalize how a real package uses `sync.Pool`. We'll build something like `log.Printf`, with a pooled buffer per call.

Requirements:

- `log.Infof(format, args...)` writes a line to `os.Stderr`.
- The format should support level prefixes (`INFO`, `ERROR`).
- It should be allocation-efficient under load.

Naive implementation:

```go
package logger

import (
    "fmt"
    "os"
    "time"
)

func Infof(format string, args ...any) {
    line := fmt.Sprintf("INFO %s "+format+"\n",
        append([]any{time.Now().Format(time.RFC3339)}, args...)...)
    os.Stderr.WriteString(line)
}
```

This works, but `fmt.Sprintf` allocates a string, then `WriteString` copies it. Two allocations per call.

Pooled version:

```go
package logger

import (
    "fmt"
    "os"
    "sync"
    "time"
)

type lineBuf struct {
    bs []byte
}

var lineBufPool = sync.Pool{
    New: func() any { return &lineBuf{bs: make([]byte, 0, 256)} },
}

func Infof(format string, args ...any) {
    lb := lineBufPool.Get().(*lineBuf)
    lb.bs = lb.bs[:0]
    lb.bs = append(lb.bs, "INFO "...)
    lb.bs = time.Now().AppendFormat(lb.bs, time.RFC3339)
    lb.bs = append(lb.bs, ' ')
    lb.bs = fmt.Appendf(lb.bs, format, args...)
    lb.bs = append(lb.bs, '\n')

    os.Stderr.Write(lb.bs)

    if cap(lb.bs) <= 4*1024 {
        lineBufPool.Put(lb)
    }
}
```

Notice:

- We use `AppendFormat` and `Appendf` to avoid intermediate strings.
- We `Reset` by slicing.
- We discard oversized buffers.
- We `Write` directly from the pooled buffer to stderr, *while still owning it*. As soon as `Write` returns, we Put.

Benchmarks of this against the naive version typically show 5-10x fewer allocs/op for short messages.

### 30.1 Subtle bug: stderr and ownership

`os.Stderr.Write` is synchronous on POSIX. By the time it returns, the kernel has copied the bytes into its own buffer (or sent them to the pipe). So we are safe to `Put` immediately.

If we instead wrote to an `io.Writer` that is asynchronous — say a `bufio.Writer` that flushes on a timer, or a network writer that buffers — the bytes would not yet be consumed by the time we return. Putting the pool buffer back would race with the asynchronous flush.

Rule: only `Put` after every consumer of the pool buffer's memory is done with it. For most synchronous writers, that is "before the function returns." For asynchronous writers, you may need to copy first.

## 31. A more advanced example — request-scoped scratch arena

Sometimes you want a "scratch space" for an entire HTTP request: a place to allocate strings, intermediate slices, parsed structs, etc. A single pool of large buffers can serve as a poor man's arena.

```go
package arena

import "sync"

type Arena struct {
    buf []byte
}

const arenaSize = 64 * 1024

var arenaPool = sync.Pool{
    New: func() any {
        return &Arena{buf: make([]byte, 0, arenaSize)}
    },
}

func GetArena() *Arena {
    a := arenaPool.Get().(*Arena)
    a.buf = a.buf[:0]
    return a
}

func PutArena(a *Arena) {
    if cap(a.buf) > 2*arenaSize {
        return
    }
    arenaPool.Put(a)
}

// AllocBytes returns a slice of n bytes from the arena.
// The slice is valid only until the next reset.
func (a *Arena) AllocBytes(n int) []byte {
    start := len(a.buf)
    if start+n > cap(a.buf) {
        return make([]byte, n) // arena overflow, fall back
    }
    a.buf = a.buf[:start+n]
    return a.buf[start : start+n]
}
```

A handler can grab an arena at the start, allocate all per-request scratch space from it, and return it at the end:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    a := arena.GetArena()
    defer arena.PutArena(a)

    scratch := a.AllocBytes(1024)
    // ... use scratch ...
}
```

This pattern is used in some high-performance Go servers. The gotcha is the same as section 12: any data in the arena becomes garbage when the arena is reset. Don't let slices from the arena escape past `PutArena`.

In real arenas (Go's `runtime` had an experimental `arena` package), the runtime tracks references and panics if you violate the constraint. With a hand-rolled arena on top of `sync.Pool`, you have to discipline yourself.

## 32. FAQ

**Q: Can I have multiple `New` functions?**

No. Each `sync.Pool` has one `New`. If you need different objects, use different pools.

**Q: Can I dynamically change `New`?**

You can assign to `p.New` after construction, but you usually don't want to — the pool may already hold objects from the old `New`.

**Q: How big does the pool get?**

Up to the working set between GCs. There is no fixed cap. The size depends on how many goroutines are simultaneously holding-then-releasing objects.

**Q: Does `sync.Pool` work in tests?**

Yes, but be careful: `go test` runs tests sequentially per package by default, but `t.Parallel()` introduces concurrency. The pool is concurrency-safe, so it works fine, but a test that relies on the pool's GC behavior may be flaky.

**Q: Does `sync.Pool` work with `runtime.GC`?**

Yes. `runtime.GC()` triggers a GC cycle, which triggers the pool drain. This is how the demo programs in this page work.

**Q: Is there a per-pool `Drain()` method?**

No. You cannot explicitly drain a `sync.Pool` from user code. The only way to empty it is `runtime.GC()`, and that drains every pool.

**Q: Can I use `sync.Pool` for goroutines themselves?**

You could, but Go has a builtin "goroutine pool" called the scheduler. Spawning a goroutine is very cheap. Pooling them rarely helps.

**Q: Will my `New` ever be called from multiple goroutines simultaneously?**

Yes. `New` must be safe for concurrent use. Typically it just calls `new(T)` or `make(...)`, which are inherently safe.

**Q: Does `sync.Pool` interact with `GOMAXPROCS`?**

The pool's internal sharding is per-P (per processor), where the number of P's is `GOMAXPROCS`. Changing GOMAXPROCS at runtime would cause the pool to re-shard, which is one reason GOMAXPROCS changes are rare in production.

**Q: My pool's `Get` always calls `New`. Why?**

Most likely: (a) you're not actually `Put`ting (check for an early return), (b) GC is running often (check `GODEBUG=gctrace=1`), (c) the pool is function-local rather than package-level, (d) your benchmark is too short and the pool hasn't had a chance to retain anything.

**Q: Can I share a `sync.Pool` across packages?**

Yes. There's nothing magic about it. It's just a value. Export it (or wrap it in a function) and use it from anywhere.

## 33. Closing thoughts

`sync.Pool` is one of those tools that feels small until you understand the contract. The API is two methods. The implementation is a few hundred lines. But every line of code that uses it has to live by the contract: ownership transfers at `Put`, state must be reset, aliased memory must not escape, and the pool may empty at any time.

When you ship code that uses `sync.Pool`, you are signing up for those constraints. In exchange, you get a runtime feature designed to lower GC pressure on hot paths, sharded per processor, with no atomic contention in the common case.

For most projects, you should use `sync.Pool` for a few critical hot paths — typically buffer pooling — and leave the rest of your code alone. Don't sprinkle pools liberally. Don't pool things that aren't hot. Don't pool things you can't easily reset.

The middle page (`middle.md`) shows you what is going on inside — the per-P shards, the local/shared splits, the atomic operations, the GC hook. The senior page (`senior.md`) goes deeper into design tradeoffs and real-world stories. The interview page collects common questions. The optimize page shows production tuning. But everything in those pages builds on what you have here: the API is small, the contract is small, and the bugs come from forgetting either.

Build a small benchmark right now. Pick a hot path in your project. Pool a buffer. Measure. If allocations drop and latency stays the same, you've won. If not, take the pool back out. Don't be afraid to remove a pool; the simplest code that meets your performance goals is the right code.

[← Back](../)
