# Memory Model — Find the Bug

> Each snippet has a memory-model bug. Diagnose, then read the explanation.

---

## Bug 1 — Unsynchronised flag

```go
var done bool

go func() {
    for !done {
        work()
    }
}()

done = true
```

**What is wrong?**

Race on `done`. The goroutine reads `done`; the main writes. No synchronisation. Without happens-before, the main's write may never be visible to the goroutine — the compiler may hoist the read of `done` out of the loop, observing only `false`.

**Fix.**

```go
var done atomic.Bool

go func() {
    for !done.Load() { work() }
}()

done.Store(true)
```

Or use a `context.Context`.

---

## Bug 2 — Counter increment

```go
var n int64

for i := 0; i < 100; i++ {
    go func() {
        n++
    }()
}
```

**What is wrong?**

`n++` is read-modify-write — three operations. Concurrent increments lose updates. Race detector flags it.

**Fix.**

```go
var n atomic.Int64
// ...
n.Add(1)
```

---

## Bug 3 — Map concurrent writes

```go
m := map[string]int{}

for i := 0; i < 10; i++ {
    go func(i int) {
        m[fmt.Sprintf("k%d", i)] = i
    }(i)
}
```

**What is wrong?**

Concurrent writes to a built-in map. The runtime detects this and panics: "fatal error: concurrent map writes."

**Fix A:** Mutex.

```go
var mu sync.Mutex
mu.Lock()
m["k"] = i
mu.Unlock()
```

**Fix B:** `sync.Map`.

---

## Bug 4 — Read while writing

```go
m := map[string]int{"x": 1}

go func() { m["x"] = 2 }()
fmt.Println(m["x"])
```

**What is wrong?**

Concurrent read and write on a map. Race detector flags it. The runtime may or may not panic, depending on internal state. Either way, undefined behaviour.

**Fix:** mutex or `sync.Map`.

---

## Bug 5 — `WaitGroup.Add` inside goroutine

```go
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    go func() {
        wg.Add(1)
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

**What is wrong?**

`wg.Add(1)` is racing with `wg.Wait()`. `Wait()` may run before any goroutine has called `Add`, returning immediately. Some goroutines may not be waited for.

**Fix:** call `Add` in the parent.

```go
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
```

---

## Bug 6 — Lazy init race

```go
var inst *Resource

func get() *Resource {
    if inst == nil {
        inst = newResource()
    }
    return inst
}
```

**What is wrong?**

Two goroutines may both see `inst == nil` and both create a `*Resource`. One assignment wins; the other is discarded. Worse, partial visibility: a goroutine may see `inst != nil` but the pointed-to struct may not be fully constructed.

**Fix:** `sync.Once`.

```go
var (
    once sync.Once
    inst *Resource
)

func get() *Resource {
    once.Do(func() { inst = newResource() })
    return inst
}
```

---

## Bug 7 — Double-checked locking (broken in Go)

```go
var inst *Resource
var mu sync.Mutex

func get() *Resource {
    if inst == nil {
        mu.Lock()
        defer mu.Unlock()
        if inst == nil {
            inst = newResource()
        }
    }
    return inst
}
```

**What is wrong?**

The outer `if inst == nil` is unsynchronised. Even though the mutex protects the slow path, the fast path reads `inst` without sync — race.

(Double-checked locking is OK if the outer read is atomic and the construction is synchronised — but this version is not.)

**Fix:** `sync.Once`, or use `atomic.Pointer`:

```go
var inst atomic.Pointer[Resource]

func get() *Resource {
    if p := inst.Load(); p != nil { return p }
    mu.Lock()
    defer mu.Unlock()
    if p := inst.Load(); p != nil { return p }
    p := newResource()
    inst.Store(p)
    return p
}
```

But really, just use `sync.Once`.

---

## Bug 8 — Slice header race

```go
buf := make([]byte, 100)
go func() { buf[0] = 1 }()
go func() { buf[99] = 2 }()
```

**What is wrong?**

Even though the indices are disjoint, both goroutines write through the same slice header. The race detector flags accesses to the slice variable itself (or to the underlying array). Logically: when does each goroutine "see" the other's write? Without sync, undefined.

**Fix:** partition into separate slices.

```go
half1 := buf[:50]
half2 := buf[50:]
go func() { half1[0] = 1 }()
go func() { half2[49] = 2 }()
```

Each goroutine has its own slice value. The race detector is happy.

---

## Bug 9 — Pointer publication

```go
type Config struct {
    Timeout time.Duration
}

var cfg *Config

go func() {
    cfg = &Config{Timeout: time.Second}
}()

if cfg != nil {
    use(cfg.Timeout)
}
```

**What is wrong?**

Without synchronisation, the main goroutine may see `cfg != nil` but the `*cfg` struct fields may not yet be fully written (partial publication). Or the compiler may reorder the writes.

**Fix:** `atomic.Pointer`.

```go
var cfg atomic.Pointer[Config]

go func() {
    cfg.Store(&Config{Timeout: time.Second})
}()

if c := cfg.Load(); c != nil {
    use(c.Timeout)
}
```

---

## Bug 10 — Closure captures loop variable

```go
for i := 0; i < 5; i++ {
    go func() {
        fmt.Println(i)
    }()
}
```

**What is wrong? (pre-Go 1.22)**

All goroutines share `i`. By the time they run, `i == 5`. Output: `5 5 5 5 5`.

Not strictly a memory-model bug (no race per se), but a common confusion. Go 1.22+ gives each iteration its own `i`.

**Fix:**

```go
for i := 0; i < 5; i++ {
    go func(i int) { fmt.Println(i) }(i)
}
```

---

## Bug 11 — `time.Sleep` as synchronisation

```go
var data []int

go func() {
    data = loadData()
}()

time.Sleep(time.Second)
process(data)
```

**What is wrong?**

`time.Sleep` does not establish happens-before. The main may not see `data` after the sleep. Also, on slow systems, 1 s may not be enough.

**Fix:** wait via a channel or `WaitGroup`.

---

## Bug 12 — Atomic with non-atomic read

```go
var counter atomic.Int64

go func() { counter.Add(1) }()

n := *(*int64)(unsafe.Pointer(&counter)) // BUG
```

**What is wrong?**

The atomic store is correct. The read is `unsafe` and bypasses atomic semantics. The race detector may not catch it (depending on instrumentation), but the read may see a torn value or miss synchronisation.

**Fix:** use `counter.Load()`.

---

## Bug 13 — Reusing a sync.Mutex by value

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]int
}

func (c Cache) Get(k string) int {  // value receiver
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.m[k]
}
```

**What is wrong?**

`Get` has a value receiver — `c` is a copy. The mutex inside is a copy too. Locking the copy does not protect the original. `go vet` warns about copying a mutex.

**Fix:** pointer receiver.

```go
func (c *Cache) Get(k string) int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.m[k]
}
```

---

## Bug 14 — `range` over a shared map while writing

```go
go func() {
    for k, v := range m {
        process(k, v)
    }
}()

m["new"] = 1 // concurrent write
```

**What is wrong?**

`range` over a map while another goroutine writes is undefined. Even if no race detector report, the iteration may include the new key, exclude it, panic, or corrupt internal state.

**Fix:** lock during range, or copy the map first under lock.

---

## Bug 15 — Atomic operations on non-aligned 64-bit values (32-bit ARM)

```go
type S struct {
    a int32
    b int64 // BUG on 32-bit ARM: not 8-byte aligned
}

s := S{}
atomic.AddInt64(&s.b, 1) // may panic on 32-bit ARM
```

**What is wrong?**

On 32-bit ARM, 64-bit atomic operations require 8-byte alignment of the address. `s.b` is 4-byte aligned (after `a`), not 8. Crash at runtime.

**Fix:** put 64-bit fields first, or use `atomic.Int64` (which the compiler aligns correctly).

```go
type S struct {
    b atomic.Int64 // always correctly aligned
    a int32
}
```

---

## Bug 16 — `sync.RWMutex` read during write

```go
var (
    mu sync.RWMutex
    m  = map[string]int{}
)

go func() {
    mu.RLock()
    for k, v := range m {
        process(k, v)
    }
    mu.RUnlock()
}()

mu.Lock()
m["new"] = 1
mu.Unlock()
```

**What is wrong?**

This is actually OK. `RWMutex` allows multiple readers or one writer. While the reader holds `RLock`, the writer's `Lock` blocks until `RUnlock`. No race.

(Just a sanity check question — this code is correct.)

---

## Bug 17 — Recursive Mutex (not supported)

```go
var mu sync.Mutex

func outer() {
    mu.Lock()
    defer mu.Unlock()
    inner()
}

func inner() {
    mu.Lock()
    defer mu.Unlock()
    // ...
}
```

**What is wrong?**

`sync.Mutex` is not reentrant. The second `Lock` deadlocks.

**Fix:** Either restructure so locks do not nest, or use an unlocked helper function:

```go
func outer() {
    mu.Lock()
    defer mu.Unlock()
    innerLocked()
}

func innerLocked() {
    // assumes mu is held
}
```

---

## Bug 18 — Closing a channel from a receiver

```go
ch := make(chan int)
go func() {
    for v := range ch {
        process(v)
    }
    close(ch) // BUG: closing from receiver
}()

ch <- 1
ch <- 2
close(ch)
```

**What is wrong?**

The main closes `ch`. The receiver loop exits. Then the receiver also calls `close(ch)` — close of closed channel panics.

**Fix:** receiver should not close. Only the sender (or designated owner) closes.

---

## Bug 19 — `atomic.Value` type confusion

```go
var v atomic.Value
v.Store(1)
v.Store("hello") // PANIC: inconsistent type
```

**What is wrong?**

`atomic.Value` requires all stored values to be of the same concrete type. Storing `int` then `string` panics.

**Fix:** Use `atomic.Pointer[T]` for type safety, or wrap in a single type:

```go
type Item struct { v interface{} }
v.Store(Item{1})
v.Store(Item{"hello"})
```

---

## Bug 20 — Goroutine writes via captured pointer

```go
func process() {
    result := &Result{}
    go func() {
        result.value = compute()
    }()
    return result
}
```

**What is wrong?**

The function returns `result` while a goroutine still writes to `result.value`. Callers may read `result.value` before it is written, or while it is being written — race.

**Fix:** wait for the goroutine.

```go
func process() *Result {
    result := &Result{}
    done := make(chan struct{})
    go func() {
        result.value = compute()
        close(done)
    }()
    <-done
    return result
}
```

Or use `sync.WaitGroup`.

---

## Bug 21 — Shared bytes.Buffer

```go
var buf bytes.Buffer
go func() { buf.WriteString("a") }()
go func() { buf.WriteString("b") }()
```

**What is wrong?**

`bytes.Buffer` is not safe for concurrent use. Writes can interleave and corrupt internal state.

**Fix:** mutex around access.

```go
var (
    mu sync.Mutex
    buf bytes.Buffer
)
go func() {
    mu.Lock()
    buf.WriteString("a")
    mu.Unlock()
}()
```

---

## Bug 22 — Conditional locking

```go
func (c *Cache) MaybeLock(key string) {
    if c.needsLock(key) {
        c.mu.Lock()
    }
    c.process(key)
    if c.needsLock(key) {
        c.mu.Unlock()
    }
}
```

**What is wrong?**

`needsLock(key)` may return different values on the two calls (because state changed). Result: Lock without Unlock or vice versa. Deadlock or panic.

**Fix:** Always lock, or never lock — don't make it conditional.

---

## Bug 23 — `atomic.LoadInt64` and unaligned struct fields

```go
type S struct {
    flag bool
    n    int64
}

s := &S{}
atomic.AddInt64(&s.n, 1)
```

**What is wrong?**

On 32-bit ARM, `s.n` after a `bool` may not be 8-byte aligned, causing the atomic op to crash at runtime.

**Fix:** Put 64-bit fields first, pad explicitly, or use `atomic.Int64`.

---

## Bug 24 — `sync.WaitGroup` reused after Wait

```go
var wg sync.WaitGroup

for i := 0; i < 3; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); work() }()
}
wg.Wait()

// Reuse:
for i := 0; i < 3; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); work() }()
}
wg.Wait()
```

**What is wrong?**

Actually, this is OK. `WaitGroup` can be reused after `Wait` returns. The Go docs explicitly allow this. But:

**Subtle bug:** If `Add` is called concurrently with `Wait`, the behaviour is undefined. So the second `Add(1)` must happen *after* the first `Wait` returns.

In this code, the sequence is fine. But if you do:

```go
go func() { wg.Add(1) }() // race with Wait
wg.Wait()
```

That is bug.

---

## Bug 25 — Reading via context value

```go
ctx := context.WithValue(parent, "key", &MutableData{})

go func() {
    data := ctx.Value("key").(*MutableData)
    data.field++ // unsynchronised
}()

go func() {
    data := ctx.Value("key").(*MutableData)
    fmt.Println(data.field) // race
}()
```

**What is wrong?**

`context.Context` is goroutine-safe for `Value()`, but the values themselves are not synchronised by the context. Mutating the same `*MutableData` from multiple goroutines is a race.

**Fix:** Store immutable data in contexts. Or use proper synchronisation around the mutable value.

---

## Closing

Memory-model bugs cluster around:

- Unsynchronised reads/writes (atomic, mutex, channel).
- Concurrent map access.
- Captured loop variables (pre-1.22).
- Lazy init without `sync.Once`.
- Pointer publication without atomic publication.
- `time.Sleep` instead of proper synchronisation.
- 64-bit atomic alignment on 32-bit ARM.
- Closing channels from receivers.
- `RWMutex` patterns done wrong (forgetting `RUnlock`, etc.).

The race detector catches most of these. Run `-race` in CI. Add `goleak` for leak detection. Use `pgregory.net/rapid` or stress runs for rare orderings.

The discipline is: every shared variable must have a documented synchronisation strategy. If you cannot articulate it, you have a bug.
