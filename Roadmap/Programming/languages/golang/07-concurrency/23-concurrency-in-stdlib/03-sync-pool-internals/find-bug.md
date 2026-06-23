---
layout: default
title: sync.Pool Internals — Find the Bug
parent: sync.Pool Internals
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/03-sync-pool-internals/find-bug/
---

# sync.Pool Internals — Find the Bug

[← Back](../)

> Each snippet contains a real bug related to `sync.Pool` use. Find it, explain it, fix it.

---

## Bug 1 — Forgetting to reset

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

var bufPool = sync.Pool{New: func() any { return &bytes.Buffer{} }}

func greet(name string) string {
    b := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(b)
    b.WriteString("Hello, ")
    b.WriteString(name)
    return b.String()
}

func main() {
    fmt.Println(greet("Alice"))
    fmt.Println(greet("Bob"))
}
```

**Symptom.** The second line prints `Hello, AliceHello, Bob`.

**Bug.** The buffer is never reset before reuse. The contents from the previous call are still there.

**Fix.** Call `b.Reset()` immediately after `Get`, before any writes. Equivalently, reset right before `Put` — both forms work, but resetting after `Get` is more defensive (the previous caller might have forgotten).

```go
b := bufPool.Get().(*bytes.Buffer)
b.Reset()
defer bufPool.Put(b)
```

---

## Bug 2 — Returning a slice that aliases pooled memory

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func render(items []string) []byte {
    b := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(b)
    b.Reset()
    for _, s := range items {
        b.WriteString(s)
        b.WriteByte('\n')
    }
    return b.Bytes()
}
```

**Symptom.** Sometimes the returned `[]byte` mysteriously changes after the caller has stored it.

**Bug.** `bytes.Buffer.Bytes()` returns a slice that aliases the buffer's internal array. After `Put`, another goroutine may `Get` the same buffer, `Reset`, and overwrite that array — corrupting the returned slice.

**Fix.** Copy out:

```go
out := append([]byte(nil), b.Bytes()...)
return out
```

Or restructure so the caller writes into a buffer they own.

---

## Bug 3 — Putting a reused reference

```go
var slicePool = sync.Pool{New: func() any { return make([]int, 0, 1024) }}

func process(input []int) {
    buf := slicePool.Get().([]int)
    buf = append(buf[:0], input...)
    // ... use buf ...
    slicePool.Put(buf)
    // ... later ...
    slicePool.Put(buf) // BUG: double-put
}
```

**Symptom.** Two consumers may `Get` the same slice and race on its contents.

**Bug.** The same slice is `Put` twice. The pool happily accepts duplicate puts; nothing detects this. The second consumer thinks it has exclusive access.

**Fix.** `Put` exactly once. Always pair with `defer pool.Put(buf)` at the start of the function, and never `Put` again outside that defer.

---

## Bug 4 — Holding the reference past Put

```go
type Worker struct {
    buf *bytes.Buffer
}

var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func newWorker() *Worker {
    w := &Worker{buf: bufPool.Get().(*bytes.Buffer)}
    bufPool.Put(w.buf) // BUG: putting back something we still hold
    return w
}
```

**Symptom.** Eventually `w.buf` will be modified by another goroutine that `Get`s the same buffer.

**Bug.** After `Put`, the pool considers the object available for reuse. Holding a reference is a use-after-free in spirit. The race detector may not catch this if the racy use happens later.

**Fix.** Either keep the buffer (never `Put` it) for the worker's lifetime and `Put` only when the worker exits, or `Get` a fresh buffer per use.

---

## Bug 5 — Pool of non-isolated state

```go
type Encoder struct {
    schemaCache map[string]int
}

var encPool = sync.Pool{New: func() any {
    return &Encoder{schemaCache: make(map[string]int)}
}}

func encode(v any) []byte {
    e := encPool.Get().(*Encoder)
    defer encPool.Put(e)
    // ... uses e.schemaCache, possibly mutating it ...
    return e.encode(v)
}
```

**Symptom.** Random map-read/map-write panics under load.

**Bug.** `e.schemaCache` may be shared between concurrent goroutines if one Put-Get cycle races. More importantly, the map's keys from previous calls leak into subsequent calls, breaking schema isolation.

**Fix.** Clear the map on `Get`:

```go
for k := range e.schemaCache {
    delete(e.schemaCache, k)
}
```

Or rethink: if the cache should outlive a single call, it does not belong on a pooled object.

---

## Bug 6 — Storing a slice of pooled values

```go
type Result struct {
    Buf *bytes.Buffer
}

var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func collect() []Result {
    results := make([]Result, 0, 10)
    for i := 0; i < 10; i++ {
        b := bufPool.Get().(*bytes.Buffer)
        b.Reset()
        fmt.Fprintf(b, "item %d", i)
        results = append(results, Result{Buf: b})
        bufPool.Put(b) // BUG: putting while still referenced from results
    }
    return results
}
```

**Symptom.** All results in the returned slice are corrupted to the last value.

**Bug.** Same as Bug 4 — we hold the pointer in `results` while having Put it back to the pool. Subsequent Gets get the same buffer.

**Fix.** Don't pool buffers whose contents must outlive the function. Or copy the contents out:

```go
results = append(results, Result{Data: append([]byte(nil), b.Bytes()...)})
bufPool.Put(b)
```

---

## Bug 7 — Pooling a tiny struct

```go
type Point struct {
    X, Y int
}

var pointPool = sync.Pool{New: func() any { return &Point{} }}

func midpoint(a, b Point) Point {
    p := pointPool.Get().(*Point)
    defer pointPool.Put(p)
    p.X = (a.X + b.X) / 2
    p.Y = (a.Y + b.Y) / 2
    return *p
}
```

**Symptom.** No bug per se, but the benchmark is much slower than just returning a `Point` value directly.

**Bug.** The object is so cheap (16 bytes, no constructor cost) that the pool's overhead exceeds the cost of allocation. Worse, the pointer means escape analysis cannot keep it on the stack.

**Fix.** Don't pool. Return the value directly. The compiler will allocate it on the caller's stack.

---

## Bug 8 — Using Pool as a cache

```go
type Cache struct {
    pool sync.Pool
}

func (c *Cache) Lookup(key string) (string, bool) {
    v := c.pool.Get()
    if v == nil {
        return "", false
    }
    pair := v.(*kv)
    if pair.k == key {
        c.pool.Put(pair)
        return pair.v, true
    }
    c.pool.Put(pair)
    return "", false
}
```

**Symptom.** Cache hit rate is wildly inconsistent across runs.

**Bug.** `sync.Pool` is not a cache. There is no key-based lookup; `Get` returns *some* item. The code happens to find the right one if the pool has exactly one entry — otherwise it returns whichever entry happened to be popped. Also, items disappear at GC.

**Fix.** Use a real cache (`map` + `sync.RWMutex`, or `golang.org/x/sync/singleflight`, or a dedicated LRU library). `sync.Pool` is the wrong tool.

---

## Bug 9 — Putting nil

```go
var pool = sync.Pool{New: func() any { return new(int) }}

func release(p *int) {
    if p == nil {
        return
    }
    pool.Put(nil) // BUG: should be Put(p)
}
```

**Symptom.** Pool fills with nil entries; `Get` returns nil interfaces (not nil-typed pointers) and subsequent type assertions panic.

**Bug.** Typo — `Put(nil)` instead of `Put(p)`. `sync.Pool.Put` does check for nil (since Go 1.10 or so) and ignores it — see `src/sync/pool.go:101-103`. But the typo means the value is silently discarded; you get cache misses instead of crashes.

**Fix.** `pool.Put(p)`. Always check the variable you intended to put.

---

## Bug 10 — Pool keyed by goroutine

```go
var pool sync.Pool

func init() {
    pool.New = func() any {
        return new(int) // intended: per-goroutine counter
    }
}

func count() {
    c := pool.Get().(*int)
    *c++
    pool.Put(c)
}
```

**Symptom.** Multiple goroutines see their counters jump randomly.

**Bug.** The pool is shared. There is no goroutine-affinity in `sync.Pool` — only P-affinity, which is not the same. A goroutine that gets preempted between Get and Put may even end up incrementing two different counters in two consecutive calls.

**Fix.** Use a `map[goid]*int` (with `linkname`-d `runtime.getg`) — though this is rarely the right design. The right design is usually one explicit counter per goroutine that the goroutine carries through its call stack.
