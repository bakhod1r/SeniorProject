---
layout: default
title: Hardware Barriers — Find the Bug
parent: Hardware Barriers
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/find-bug/
---

# Hardware Memory Barriers — Find the Bug

> Each snippet contains a real concurrency bug related to memory ordering, missing barriers, or incorrect use of `sync/atomic`. Find it, explain it, fix it.

---

## Bug 1 — Plain flag for publish-subscribe

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

var (
    data  int
    ready bool
)

func main() {
    runtime.GOMAXPROCS(2)
    go func() {
        for !ready {
            // spin
        }
        fmt.Println(data)
    }()
    time.Sleep(10 * time.Millisecond)
    data = 42
    ready = true
    time.Sleep(100 * time.Millisecond)
}
```

**Bug.** Both `data` and `ready` are plain `int`/`bool`. The compiler may cache `ready` in a register (loop never terminates) or reorder the writes (`ready = true` before `data = 42`). On ARM the reader can see `ready == true` with stale `data == 0`. The race detector flags this immediately.

**Fix.** Use `atomic.Int64` and `atomic.Bool` (or `atomic.Pointer[Data]` for richer data):
```go
var (
    data  atomic.Int64
    ready atomic.Bool
)
// writer
data.Store(42)
ready.Store(true)
// reader
for !ready.Load() { runtime.Gosched() }
fmt.Println(data.Load())
```

---

## Bug 2 — Atomic store after data store on multiple values

```go
type Stats struct {
    count atomic.Int64
    total atomic.Int64
}

func (s *Stats) Update(v int64) {
    s.count.Add(1)
    s.total.Add(v)
}

func (s *Stats) Snapshot() (count, total int64) {
    return s.count.Load(), s.total.Load()
}
```

**Bug.** Atomicity is per-variable, not across variables. A reader calling `Snapshot()` can see `count == 10, total == 0` (between the two `Add`s of a single `Update` call). The reader observes an inconsistent (count, total) pair.

**Fix.** Use a sequence lock, a mutex, or pack count+total into a single `atomic.Uint64` (if they fit in 32 bits each).

---

## Bug 3 — `wg.Add` inside the goroutine

```go
func Process(items []Item) {
    var wg sync.WaitGroup
    var results []Result
    var mu sync.Mutex
    for _, it := range items {
        go func(it Item) {
            wg.Add(1)
            defer wg.Done()
            r := process(it)
            mu.Lock()
            results = append(results, r)
            mu.Unlock()
        }(it)
    }
    wg.Wait()
    fmt.Println(len(results))
}
```

**Bug.** `wg.Add(1)` is inside the goroutine. The main may reach `wg.Wait()` before any `Add` has run; with counter 0, `Wait` returns immediately. Not directly a memory-barrier bug but a sync-primitive misuse that compounds when atomics elsewhere mask the symptom.

**Fix.** Move `Add(1)` outside `go`.

---

## Bug 4 — Mixed atomic and plain access

```go
var n int64

func writer() {
    atomic.AddInt64(&n, 1)
}

func reader() int64 {
    return n
}
```

**Bug.** Writer uses atomic; reader uses plain access. Reader may see stale or torn values. On 32-bit ARM, this may even tear at 4-byte boundaries. Race detector flags it.

**Fix.** Use `atomic.LoadInt64(&n)` for the read. Better: use `atomic.Int64`.

---

## Bug 5 — Plain pointer reassignment

```go
var config *Config

func update(c *Config) {
    config = c
}

func get() *Config {
    return config
}
```

**Bug.** Plain pointer assignment is not atomic on all platforms (on 32-bit ARM, a 64-bit pointer assignment can tear). Even where atomic, the compiler may reorder or cache the value. Race detector flags it.

**Fix.** Use `atomic.Pointer[Config]`.

---

## Bug 6 — Double-checked locking, hand-rolled

```go
var (
    once     int32
    instance *Singleton
    mu       sync.Mutex
)

func Get() *Singleton {
    if atomic.LoadInt32(&once) == 1 {
        return instance
    }
    mu.Lock()
    defer mu.Unlock()
    if instance == nil {
        instance = &Singleton{}
        atomic.StoreInt32(&once, 1)
    }
    return instance
}
```

**Bug.** Subtle: the order of operations on the slow path. After `instance = &Singleton{}`, the *fields* of the Singleton are written. Then `atomic.StoreInt32(&once, 1)` publishes. So far so good. But the `instance` *pointer itself* is written non-atomically. A racing goroutine on the fast path that sees `once == 1` will read `instance` non-atomically — possibly seeing a half-written pointer on 32-bit platforms.

**Fix.** Use `sync.Once`. Or use `atomic.Pointer[Singleton]` for `instance` and atomic stores throughout.

---

## Bug 7 — Forgotten release on close

```go
var (
    closed atomic.Bool
    data   []int
)

func appendData(v int) {
    data = append(data, v) // not safe under concurrency
    closed.Store(true)
}

func consume() {
    if closed.Load() {
        for _, v := range data { fmt.Println(v) }
    }
}
```

**Bug.** Multiple issues: (1) `append` to a shared slice is a race; (2) even if it weren't, the slice header read on the reader side is non-atomic; (3) `closed` is meant to be a release flag but the data write isn't synchronised with it.

**Fix.** Use a mutex for the slice, and publish the snapshot via `atomic.Pointer[[]int]`.

---

## Bug 8 — `Store` before fields are written

```go
type Job struct {
    ID     int64
    Result string
}

var current atomic.Pointer[Job]

func runJob(id int64) {
    j := &Job{ID: id}
    current.Store(j)
    j.Result = compute(id) // BUG: write after publication!
}

func reader() {
    j := current.Load()
    if j != nil {
        fmt.Println(j.ID, j.Result) // may see Result == ""
    }
}
```

**Bug.** The writer publishes `j` before populating `Result`. The reader may load `j`, see the ID, but `Result` is still empty. Even with `atomic.Pointer`, the fields after publication are no longer safe.

**Fix.** Populate the struct *before* publishing:
```go
j := &Job{ID: id, Result: compute(id)}
current.Store(j)
```

---

## Bug 9 — Reading 64-bit value with 32-bit operation on 32-bit ARM

```go
var counter int64

func read() int32 {
    return int32(counter) // tearing risk on 32-bit ARM
}

func write() {
    atomic.StoreInt64(&counter, time.Now().UnixNano())
}
```

**Bug.** On 32-bit ARM, accessing the lower 32 bits of a 64-bit aligned int64 is technically atomic (a single LDR), but reading via a non-atomic cast bypasses the atomic store semantics. Plus the compiler may load the int64 in two halves on 32-bit platforms.

**Fix.** Use `atomic.LoadInt64(&counter)` and convert in Go.

---

## Bug 10 — Spin loop without any barrier

```go
var flag bool

func wait() {
    for !flag {
        // tight spin
    }
}

func signal() {
    flag = true
}
```

**Bug.** The compiler is allowed to load `flag` once at the start of `wait()` (it's not declared volatile/atomic), find it false, and spin forever even after `signal()` runs. This is a compiler reordering / dead-code-elimination problem, not specifically a hardware barrier issue, but the symptom is identical: writes are not visible.

**Fix.** Use `atomic.Bool`.

---

## Bug 11 — `atomic.Pointer.Load` then field-mutate

```go
var current atomic.Pointer[Config]

func tweak() {
    c := current.Load()
    c.Timeout = 30 // BUG: mutating a published, possibly-shared Config
}
```

**Bug.** Other readers may be observing this `c` concurrently. Mutating its fields is a race on every field.

**Fix.** Treat published `*Config` as immutable. To change, build a new one and `Store` it.

---

## Bug 12 — Forgetting `Add` returns the *new* value, not the old

```go
var id atomic.Int64

func nextID() int64 {
    id.Add(1)
    return id.Load()
}
```

**Bug.** Two-step Add then Load is racy: another goroutine's Add can interleave between them, causing duplicates or skips.

**Fix.** `Add` returns the new value:
```go
func nextID() int64 {
    return id.Add(1)
}
```

This is also faster (one atomic op vs two).

---

These twelve bugs span the full spectrum: from the most beginner-level ("forgot to use atomic") to subtle ("published before populated"). Each maps to a real production bug encountered in real Go codebases. Use them as a self-test or as code-review checklist material.
