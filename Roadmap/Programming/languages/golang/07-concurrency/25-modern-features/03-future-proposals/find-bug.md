---
layout: default
title: Future Proposals — Find the Bug
parent: Future Concurrency Proposals
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/find-bug/
---

# Future Proposals — Find the Bug

[← Back](../)

Early adoption of experimental features is the fastest way to write code that breaks on the
next Go release. The bugs below come from real patterns engineers introduced while testing Go
1.23 and 1.24 features. Some are subtle; most are obvious in hindsight.

For each snippet, try to spot the bug before reading the explanation. Most are 5-10 lines.

---

## Bug 1 — Synctest bubble with real network I/O

```go
//go:build goexperiment.synctest

func TestFetch(t *testing.T) {
    synctest.Run(func() {
        ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
        defer cancel()
        resp, err := http.Get("https://example.com")
        _ = resp
        _ = err
    })
}
```

**Bug:** `http.Get` performs real network I/O, which is outside the bubble. Synctest sees the
goroutine as blocked on something it cannot advance. The synthetic clock will not move because
there is no point at which "all goroutines in the bubble are durably blocked on synctest-aware
operations." The test hangs until the real-time `http.Get` returns — defeating the purpose of
synctest.

**Fix:** mock the transport with `httptest.NewServer` running inside the bubble, or with an
`http.RoundTripper` that returns immediately. Synctest is for testing your code's timing
logic, not its network behavior.

---

## Bug 2 — Forgetting to call stop on iter.Pull

```go
func first(seq iter.Seq[int]) int {
    next, _ := iter.Pull(seq)
    v, _ := next()
    return v
}
```

**Bug:** the `stop` function is discarded. The coroutine backing the iterator never
terminates; its stack leaks until GC eventually reclaims it via cleanup, which is non-
deterministic. Under load, you can build up thousands of leaked coroutine stacks.

**Fix:**

```go
func first(seq iter.Seq[int]) int {
    next, stop := iter.Pull(seq)
    defer stop()
    v, _ := next()
    return v
}
```

Treat the `stop` function exactly like a `Close()` on a resource: always defer.

---

## Bug 3 — Calling iter.Pull next from multiple goroutines

```go
next, stop := iter.Pull(seq)
defer stop()
for i := 0; i < 4; i++ {
    go func() {
        for {
            v, ok := next()
            if !ok {
                return
            }
            process(v)
        }
    }()
}
```

**Bug:** `iter.Pull` is not goroutine-safe. The `next` function manipulates the coroutine
stack, and concurrent calls corrupt it. The race detector will flag this, but only if you
exercise both goroutines simultaneously.

**Fix:** use a channel adapter. One goroutine drains `next` and sends to a channel; many
workers receive from it.

```go
ch := make(chan int)
go func() {
    defer close(ch)
    for {
        v, ok := next()
        if !ok {
            return
        }
        ch <- v
    }
}()
for i := 0; i < 4; i++ {
    go func() {
        for v := range ch {
            process(v)
        }
    }()
}
```

---

## Bug 4 — Treating weak.Pointer.Value() as stable

```go
func get(p weak.Pointer[Entry]) *Entry {
    if p.Value() == nil {
        return nil
    }
    return p.Value()
}
```

**Bug:** the first `Value()` returns a non-nil pointer, but the GC may collect the object
between the two calls. The second `Value()` could return nil, leading to a nil deref in the
caller — except the caller is unprepared because the first check passed.

**Fix:** call `Value()` once, store the result in a local, check the local:

```go
func get(p weak.Pointer[Entry]) *Entry {
    e := p.Value()
    if e == nil {
        return nil
    }
    return e
}
```

The local variable also keeps the object alive for the rest of the function, preventing
collection while you use it.

---

## Bug 5 — AddCleanup capturing the object being cleaned

```go
func newBuffer() *Buffer {
    b := &Buffer{fd: open()}
    runtime.AddCleanup(b, func(b *Buffer) { syscall.Close(b.fd) }, b)
    return b
}
```

**Bug:** the cleanup function captures `b` as its argument. This means the cleanup holds a
strong reference to `b`, so `b` is never collected, so the cleanup never runs. The whole
purpose of `AddCleanup` is to not have a reference to the cleanup target.

**Fix:** capture only what you need (the fd):

```go
runtime.AddCleanup(b, func(fd int) { syscall.Close(fd) }, b.fd)
```

This is exactly the API improvement over `SetFinalizer` — the API is shaped to make the bug
harder by not handing you the pointer.

---

## Bug 6 — Mixing SetFinalizer and AddCleanup expecting cooperation

```go
runtime.SetFinalizer(db, func(db *DB) { db.flush() })
runtime.AddCleanup(db, func(f *os.File) { f.Close() }, db.f)
```

**Bug:** both run, in unspecified order, on different goroutines. `flush()` may run after
`f.Close()`, writing to a closed fd, or vice versa. The Go 1.24 release notes explicitly say
"do not mix `SetFinalizer` and `AddCleanup` on the same object."

**Fix:** use one or the other. The recommended path is to migrate fully to `AddCleanup`.

---

## Bug 7 — Reading GOMAXPROCS at init before automaxprocs runs

```go
// in package a
var workers = runtime.GOMAXPROCS(0) // captured at init time
```

```go
// in package main
import _ "go.uber.org/automaxprocs"
```

**Bug:** Go init order is package-dependency-driven, not alphabetical. If `a` initializes
before `automaxprocs`, `workers` captures the wrong value (host CPU count, not container
quota). When the proposal for runtime auto-detection lands, this becomes irrelevant, but right
now it's a real footgun.

**Fix:** read `runtime.GOMAXPROCS(0)` lazily, after main starts:

```go
var workersOnce sync.Once
var workers int

func numWorkers() int {
    workersOnce.Do(func() {
        workers = runtime.GOMAXPROCS(0)
    })
    return workers
}
```

---

## Bug 8 — Goroutine-local storage emulated via map[goroutineID]

```go
var gls sync.Map // map[int64]any

func set(v any) { gls.Store(goroutineID(), v) }
func get() any  { v, _ := gls.Load(goroutineID()); return v }
```

**Bug:** there is no public API to get a goroutine ID. People scrape it from `runtime.Stack`,
but goroutine IDs are reused after a goroutine exits, so a child goroutine may inherit a
parent's ID and see stale GLS data. This is exactly the reason the Go team rejects GLS —
every implementation is unsound in some corner.

**Fix:** stop emulating GLS. Pass `context.Context` explicitly. If you really cannot, use
`runtime/pprof.Labels` for diagnostic-only labels.

---

## Bug 9 — Structured concurrency without cancellation propagation

```go
type Group struct {
    wg sync.WaitGroup
}

func (g *Group) Go(f func()) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        f()
    }()
}

func (g *Group) Wait() { g.wg.Wait() }
```

**Bug:** if one goroutine panics or returns an error, the others keep running until they
finish. This is "structured" in the sense that `Wait` blocks until all done, but it's not
"structured" in the sense that errors abort siblings. Real structured concurrency requires a
shared cancellation signal.

**Fix:** use `errgroup.WithContext` — it cancels the shared context when any goroutine
returns an error, and the others see `ctx.Done()` and exit. The lesson: half-built structured
concurrency is worse than `errgroup` because it gives a false sense of safety.

---

## Bug 10 — Atomic vector polyfill that's actually racy

```go
type Tagged struct {
    ptr unsafe.Pointer
    gen uint64
}

var t Tagged // global

func CAS(oldPtr unsafe.Pointer, oldGen uint64, newPtr unsafe.Pointer) bool {
    if t.ptr != oldPtr || t.gen != oldGen {
        return false
    }
    t.ptr = newPtr
    t.gen = oldGen + 1
    return true
}
```

**Bug:** the load-compare-store sequence on `t.ptr` and `t.gen` is not atomic. Between the
comparison and the store, another goroutine can swap in. The whole point of ABA-resistant CAS
is that the comparison and the store are one atomic step. Without `LOCK CMPXCHG16B` you cannot
do this without a mutex.

**Fix:** wrap the whole function in a `sync.Mutex.Lock()/Unlock()`. The polyfill becomes
correct but loses lock-freedom — which is why the real `atomic` vector proposal in
[#50860](https://go.dev/issue/50860) is non-trivial and still stalled.

---

## Bug 11 — Range-over-func with goroutine in the body

```go
func main() {
    var wg sync.WaitGroup
    for v := range Fibonacci() {
        wg.Add(1)
        go func() {
            defer wg.Done()
            process(v)
        }()
        if v > 1000 {
            break
        }
    }
    wg.Wait()
}
```

**Bug:** before Go 1.22, the loop variable `v` was shared across iterations, so all goroutines
would see the same final value. In Go 1.22+ loop variables are per-iteration, so this is
correct in modern Go. But there is a second bug: the goroutines outlive the loop and have no
context for cancellation. If `process` is slow, you accumulate goroutines unboundedly.

**Fix:** use `errgroup.WithContext` and pass cancellation. Even if the loop variable is per-
iteration, the goroutines need a parent scope:

```go
g, ctx := errgroup.WithContext(context.Background())
for v := range Fibonacci() {
    v := v
    g.Go(func() error {
        return process(ctx, v)
    })
    if v > 1000 {
        break
    }
}
if err := g.Wait(); err != nil {
    panic(err)
}
```

---

## Bug 12 — Weak pointer used as the only reference

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]weak.Pointer[Entry]
}

func (c *Cache) Add(key string, e *Entry) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[key] = weak.Make(e)
    // caller drops e
}

func (c *Cache) Get(key string) *Entry {
    c.mu.Lock()
    defer c.mu.Unlock()
    if wp, ok := c.m[key]; ok {
        return wp.Value()
    }
    return nil
}
```

**Bug:** `Add` stores a weak pointer, but the caller may drop its strong reference
immediately. The next GC collects `e`, the weak pointer becomes nil, and `Get` returns nil.
The cache is always empty.

**Fix:** the cache must hold a strong reference to entries it owns. Weak pointers are useful
for entries that someone else owns and the cache merely caches access to. If the cache is the
sole owner, use a regular pointer with explicit eviction.

---

## Bug 13 — Synctest test that asserts wall-clock elapsed

```go
//go:build goexperiment.synctest

func TestTimeout(t *testing.T) {
    synctest.Run(func() {
        realStart := time.Now()
        _ = doWork()
        realElapsed := time.Since(realStart)
        if realElapsed > 10*time.Millisecond {
            t.Fatalf("doWork took %v wall time", realElapsed)
        }
    })
}
```

**Bug:** `time.Now()` inside a synctest bubble returns the synthetic clock, not the wall
clock. You cannot measure real wall time from inside the bubble. The assertion is meaningless.

**Fix:** if you want to assert real wall time, measure outside the bubble:

```go
func TestTimeout(t *testing.T) {
    wallStart := time.Now()
    synctest.Run(func() {
        _ = doWork()
    })
    wallElapsed := time.Since(wallStart)
    if wallElapsed > 10*time.Millisecond {
        t.Fatalf("wall = %v", wallElapsed)
    }
}
```

If you want to assert synthetic elapsed, that's fine inside the bubble — but use a different
variable name to make the intent clear.

---

## Bug 14 — Cleanup that grabs the wrong mutex

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]*Entry
}

func (c *Cache) Add(key string, e *Entry) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[key] = e
    runtime.AddCleanup(e, func(k string) {
        c.mu.Lock()
        delete(c.m, k)
        c.mu.Unlock()
    }, key)
}
```

**Bug:** if the cleanup runs while another goroutine holds `c.mu`, the cleanup blocks. If many
cleanups pile up on the cleanup worker pool, you exhaust workers, and other cleanups stall.
Worse: if the cleanup is somehow called from within the `Add` lock scope (it isn't here, but
in similar patterns it could be), you'd deadlock.

**Fix:** keep cleanup functions short and non-blocking. Use `c.mu.TryLock` if available, or
defer cleanup to a separate worker that picks up dead keys lazily:

```go
runtime.AddCleanup(e, func(k string) {
    select {
    case deadKeys <- k:
    default:
        // drop if channel is full; cleanup is best-effort
    }
}, key)
```

A separate goroutine drains `deadKeys` and removes entries under the lock.
