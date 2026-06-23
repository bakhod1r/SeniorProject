# sync/atomic — Bug Hunts

Each section presents code that looks correct or nearly so. Find the bug before reading the analysis. Many of these are taken from real bug reports — open-source projects, internal code reviews, and the Go issue tracker.

---

## Bug 1 — The Lost Increment

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

var counter int64

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt64(&counter, 1)
            counter++ // for "extra speed"
        }()
    }
    wg.Wait()
    fmt.Println(counter)
}
```

### What is wrong?

The program mixes atomic and non-atomic writes to the same variable. The `atomic.AddInt64` is correctly synchronised; the `counter++` line is a data race against every other goroutine's writes (atomic or not). Under `go run -race`, the detector flags `counter++`. Output of the program is unpredictable — some increments are lost.

### Fix

Remove the `counter++` line, or use atomic for both:

```go
atomic.AddInt64(&counter, 1)
atomic.AddInt64(&counter, 1)
```

Better still — switch to the typed API, which makes this bug impossible:

```go
var counter atomic.Int64
counter.Add(1)
counter.Add(1) // no non-atomic option
```

---

## Bug 2 — The 32-Bit Alignment Trap

```go
package metrics

import "sync/atomic"

type Stats struct {
    name  string
    count int64
    flag  bool
}

func (s *Stats) Inc() {
    atomic.AddInt64(&s.count, 1)
}
```

### What is wrong?

On 32-bit platforms (`GOARCH=386`, `GOARCH=arm`), the `count` field may be 4-byte aligned because `name` (a string header) is 8 bytes total. `atomic.AddInt64` requires 8-byte alignment of its argument; misalignment crashes the program with:

```
panic: unaligned 64-bit atomic operation
```

On 64-bit platforms (the default), the struct happens to be aligned correctly. The bug is invisible until the code is compiled for 32-bit ARM (Raspberry Pi, some embedded systems) or 386.

### Fix

Use the typed API. `atomic.Int64` is always 8-byte aligned regardless of struct position:

```go
type Stats struct {
    name  string
    count atomic.Int64
    flag  bool
}

func (s *Stats) Inc() { s.count.Add(1) }
```

Alternative for the legacy API: put 64-bit fields first.

```go
type Stats struct {
    count int64   // first field — 8-byte aligned
    name  string
    flag  bool
}
```

Fragile. Anyone reordering fields breaks 32-bit builds. The typed API is the right answer.

---

## Bug 3 — Mutating After Publication

```go
package config

import "sync/atomic"

type Config struct {
    Endpoints []string
}

var current atomic.Pointer[Config]

func Init() {
    current.Store(&Config{Endpoints: []string{"a", "b"}})
}

func AddEndpoint(e string) {
    cfg := current.Load()
    cfg.Endpoints = append(cfg.Endpoints, e) // BUG
}

func GetEndpoints() []string {
    return current.Load().Endpoints
}
```

### What is wrong?

`AddEndpoint` mutates the struct that `current.Load()` returns. Active readers calling `GetEndpoints` see the slice header midway through the `append`. If `append` allocates a new underlying array, readers see the old slice with the old length, missing the new entry. If `append` reuses the array, readers may see a partially constructed slice.

In either case, the race detector flags concurrent access to the slice header.

### Fix

Copy-on-write. Build a fresh `Config` for each update:

```go
func AddEndpoint(e string) {
    for {
        old := current.Load()
        newCfg := &Config{
            Endpoints: append([]string(nil), old.Endpoints...),
        }
        newCfg.Endpoints = append(newCfg.Endpoints, e)
        if current.CompareAndSwap(old, newCfg) {
            return
        }
    }
}
```

The CAS handles concurrent writers. The fresh allocation and copy ensure no reader of the old `*Config` sees mutation. The new readers see the fully constructed new config.

---

## Bug 4 — `wg.Add` Inside the Goroutine

```go
var wg sync.WaitGroup
var n atomic.Int64

for i := 0; i < 100; i++ {
    go func() {
        wg.Add(1)            // BUG
        defer wg.Done()
        n.Add(1)
    }()
}
wg.Wait()
fmt.Println(n.Load())
```

### What is wrong?

`wg.Add(1)` is called inside the goroutine, possibly after `wg.Wait()` has started. If `Wait` runs first (counter is zero, returns immediately), the goroutines effectively execute after the program has "finished waiting." The result is non-deterministic.

This is not strictly an atomic bug, but it shows up alongside atomic counters in many real reports.

### Fix

`wg.Add(1)` in the parent before `go`:

```go
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        n.Add(1)
    }()
}
wg.Wait()
```

---

## Bug 5 — Two Atomics Are Not One

```go
var firstSeen atomic.Int64
var lastSeen atomic.Int64

func observe(t int64) {
    if firstSeen.Load() == 0 {
        firstSeen.Store(t)
    }
    lastSeen.Store(t)
}
```

### What is wrong?

Two race conditions:

1. **`firstSeen.Load() == 0` then `Store(t)` is not atomic.** Two goroutines can both see 0 and both store, overwriting each other. The first one wins on the wall clock but loses in observed timestamps.

2. **`firstSeen` and `lastSeen` are independent.** A reader can see `firstSeen` updated but `lastSeen` not yet, or vice versa.

### Fix

For the first store, use CAS:

```go
firstSeen.CompareAndSwap(0, t)
```

The CAS succeeds for whichever goroutine got there first; subsequent calls see `firstSeen != 0` and the CAS fails — leaving the existing value alone.

For the two-variable consistency, pack into a struct:

```go
type Range struct{ First, Last int64 }
var r atomic.Pointer[Range]

func observe(t int64) {
    for {
        old := r.Load()
        var first int64
        if old == nil {
            first = t
        } else {
            first = old.First
        }
        new := &Range{First: first, Last: t}
        if r.CompareAndSwap(old, new) {
            return
        }
    }
}
```

---

## Bug 6 — `atomic.Value` Mismatched Type

```go
type Config struct{ /* ... */ }

var cfg atomic.Value

func reload(c *Config) {
    cfg.Store(c)
}

func init() {
    cfg.Store(Config{}) // BUG
    reload(&Config{})
}
```

### What is wrong?

The first `Store` uses a `Config` (value type); the second uses `*Config` (pointer type). `atomic.Value` panics on the second `Store`:

```
panic: sync/atomic: store of inconsistently typed value into Value
```

### Fix

Pick one type and stick with it. For pointer semantics:

```go
cfg.Store(&Config{})
reload(&Config{})
```

Even better — use `atomic.Pointer[Config]`. The generic parameter enforces the type at compile time:

```go
var cfg atomic.Pointer[Config]
cfg.Store(&Config{})    // OK
cfg.Store(Config{})     // compile error
```

---

## Bug 7 — CAS Loop That Forgets to Re-Read

```go
func update(v *atomic.Int64, fn func(int64) int64) {
    old := v.Load()
    new := fn(old)
    if !v.CompareAndSwap(old, new) {
        new = fn(v.Load()) // re-read, but no retry
        v.Store(new)        // BUG
    }
}
```

### What is wrong?

When the CAS fails (because someone else changed `v`), the code reads the new value and stores `fn(new)`. But between the second `Load` and the `Store`, yet another goroutine may have updated `v`. The `Store` blindly overwrites whatever it became.

This is a classic "almost-CAS-loop" bug. The fix is to loop:

```go
func update(v *atomic.Int64, fn func(int64) int64) {
    for {
        old := v.Load()
        new := fn(old)
        if v.CompareAndSwap(old, new) {
            return
        }
    }
}
```

The loop continues until the CAS succeeds — meaning no one changed `v` between our `Load` and our `CompareAndSwap`.

---

## Bug 8 — Refcount Over-Decrement

```go
type Resource struct {
    refs atomic.Int64
}

func (r *Resource) Acquire() {
    r.refs.Add(1)
}

func (r *Resource) Release() {
    r.refs.Add(-1)
    if r.refs.Load() == 0 {
        r.cleanup()
    }
}
```

### What is wrong?

The check `r.refs.Load() == 0` after `Add(-1)` is racy. Consider two threads both at count = 1, both calling `Release`:

1. T1: `Add(-1)` → count = 0.
2. T2: `Add(-1)` → count = -1.
3. T1: `Load()` → 0 (lucky) or -1 (unlucky).
4. T2: `Load()` → -1.

Now: count went negative (the refcount invariant is broken), `cleanup` may be called twice (if both threads see 0 at some point), or never (if both see -1).

### Fix

Use the *return value* of `Add(-1)`:

```go
func (r *Resource) Release() {
    if r.refs.Add(-1) == 0 {
        r.cleanup()
    }
}
```

`Add` returns the new value atomically with the addition. Exactly one caller observes 0.

Even better, also fix `Acquire` to refuse resurrection:

```go
func (r *Resource) Acquire() bool {
    for {
        n := r.refs.Load()
        if n == 0 {
            return false
        }
        if r.refs.CompareAndSwap(n, n+1) {
            return true
        }
    }
}
```

The CAS ensures we only increment a non-zero count.

---

## Bug 9 — `atomic.Value.Store(nil)`

```go
var v atomic.Value

func reset() {
    v.Store(nil) // panic
}
```

### What is wrong?

`atomic.Value` panics on `Store(nil)`:

```
panic: sync/atomic: store of nil value into Value
```

The runtime needs a non-nil interface to record the type for the first `Store`. A bare `nil` has no type.

### Fix

Store a typed nil pointer:

```go
var v atomic.Value
v.Store((*Config)(nil))     // OK — typed nil
c := v.Load().(*Config)     // c is nil
```

Or use `atomic.Pointer[T]`, which permits nil naturally:

```go
var p atomic.Pointer[Config]
p.Store(nil)              // OK
c := p.Load()             // c is nil
```

---

## Bug 10 — Reading the Old Pointer After CAS

```go
type Cache struct {
    data atomic.Pointer[map[string]int]
}

func (c *Cache) Update(k string, v int) {
    old := c.data.Load()
    if old == nil {
        m := map[string]int{k: v}
        c.data.CompareAndSwap(nil, &m)
        return
    }
    m := *old
    m[k] = v // BUG — mutating shared map
    c.data.Store(&m)
}
```

### What is wrong?

Two bugs in one. First, `m := *old` copies the map header but the underlying hash table is shared. `m[k] = v` writes to the shared table — concurrent readers see corruption.

Second, even if you `make(map[string]int)` and copy entries, the `Store` is unconditional and races with another writer doing the same thing — losing one of the updates.

### Fix

Copy the map entries to a fresh map and use CAS:

```go
func (c *Cache) Update(k string, v int) {
    for {
        old := c.data.Load()
        m := make(map[string]int)
        if old != nil {
            for kk, vv := range *old {
                m[kk] = vv
            }
        }
        m[k] = v
        if c.data.CompareAndSwap(old, &m) {
            return
        }
    }
}
```

This is expensive (O(n) per update). For frequent updates, a mutex-guarded map or `sync.Map` is better. Copy-on-write makes sense only when reads vastly outnumber writes.

---

## Bug 11 — `Swap` Return Value Misread

```go
var pending atomic.Int64

func snapshot() int64 {
    pending.Store(pending.Swap(0))
    return pending.Load()
}
```

### What is wrong?

`pending.Swap(0)` returns the *previous* value and sets `pending` to 0. The line `pending.Store(pending.Swap(0))` immediately stores the previous value back, undoing the reset. The function always returns the value that was there at the start.

This is what happens when you misread `Swap`'s return as "the new value."

### Fix

```go
func snapshot() int64 {
    return pending.Swap(0)
}
```

`Swap` already gives you what you want: the value before the reset.

---

## Bug 12 — Stale Loop Variable in Closure

```go
var counter atomic.Int64
for i := 0; i < 10; i++ {
    go func() {
        counter.Add(int64(i)) // BUG in Go < 1.22
    }()
}
```

### What is wrong?

In Go < 1.22, all closures share the same `i`. By the time they run, `i == 10`. The total added is `10 * 10 = 100`, not `0+1+...+9 = 45`.

In Go 1.22+, each iteration gets a fresh `i`. The total is 45.

### Fix

For any Go version, pass `i` as a parameter:

```go
for i := 0; i < 10; i++ {
    go func(i int) {
        counter.Add(int64(i))
    }(i)
}
```

The closure captures the parameter, which is its own variable per call.

---

## Bug 13 — Forgetting that Atomic Load Returns Current Value Only

```go
var rate atomic.Int64

func handler() {
    if rate.Load() > 1000 {
        return // rate-limited
    }
    rate.Add(1)
    process()
}
```

### What is wrong?

Between `Load() > 1000` (returns false at value 1000) and `Add(1)`, another goroutine can increment `rate`. The check is stale.

In practice, this means: under bursty traffic, more than 1000 requests may slip through before the check fails. The exact overshoot is bounded by the number of goroutines reaching the check simultaneously.

### Fix

CAS or a single atomic that combines test and increment:

```go
func handler() {
    for {
        n := rate.Load()
        if n >= 1000 {
            return // rate-limited
        }
        if rate.CompareAndSwap(n, n+1) {
            break
        }
    }
    process()
}
```

Now the increment only happens if the value is still under 1000. The CAS ensures no race.

Even better — use a proper token bucket or `golang.org/x/time/rate`. Hand-rolled rate limits are subtle.

---

## Bug 14 — Atomic on a Field Through an Interface

```go
type Counter interface {
    Inc()
    Value() int64
}

type counter struct {
    n atomic.Int64
}

func (c *counter) Inc()         { c.n.Add(1) }
func (c *counter) Value() int64 { return c.n.Load() }

func process(items []Item, c Counter) {
    for _, it := range items {
        go func(it Item) {
            c.Inc() // interface dispatch on every call
            handle(it)
        }(it)
    }
}
```

### What is wrong?

Not strictly a bug, but a performance trap. Each `c.Inc()` is an interface call: a vtable lookup, a function call, then the atomic add. The interface dispatch costs ~3 ns; the atomic costs ~2 ns. Total: ~5 ns instead of 2.

For a hot counter on a hot path, this is a 2.5x slowdown. Profiling reveals an unexpectedly slow `Inc`.

### Fix

If performance matters, pass the concrete type:

```go
func process(items []Item, c *counter) {
    for _, it := range items {
        go func(it Item) {
            c.Inc()
            handle(it)
        }(it)
    }
}
```

The compiler inlines `Inc` and emits the atomic op directly. Same code, 2.5x faster.

---

## Bug 15 — Multiple Atomics Where One Struct Would Do

```go
type Position struct {
    x atomic.Int32
    y atomic.Int32
    z atomic.Int32
}

func (p *Position) Set(x, y, z int32) {
    p.x.Store(x)
    p.y.Store(y)
    p.z.Store(z)
}
```

### What is wrong?

A reader doing `(p.x.Load(), p.y.Load(), p.z.Load())` can observe `(newX, oldY, oldZ)` or any combination. There is no consistent snapshot.

If consistency matters (it usually does for 3D coordinates), this is a bug.

### Fix

Pack into a struct, use `atomic.Pointer[Position]`:

```go
type Pos struct{ X, Y, Z int32 }

type Position struct {
    p atomic.Pointer[Pos]
}

func (p *Position) Set(x, y, z int32) {
    p.p.Store(&Pos{X: x, Y: y, Z: z})
}

func (p *Position) Get() Pos {
    if cur := p.p.Load(); cur != nil {
        return *cur
    }
    return Pos{}
}
```

One pointer load gives readers a consistent snapshot. Cost: allocation per `Set`, fine for occasional updates.

---

## Bug 16 — Spinning Without Yielding

```go
var ready atomic.Bool

func wait() {
    for !ready.Load() {
        // spin
    }
}
```

### What is wrong?

A pure spin loop burns 100% of one CPU core for as long as `ready` is false. On `GOMAXPROCS=1`, the writer can never execute because the spinner monopolises the only thread. Even on multi-core, the spinner steals CPU from useful work.

### Fix

Yield to the scheduler:

```go
for !ready.Load() {
    runtime.Gosched()
}
```

Or for "ready" specifically, use a channel:

```go
ready := make(chan struct{})

// signal
close(ready)

// wait
<-ready
```

The channel parks the waiting goroutine and the scheduler wakes it when ready is closed. No CPU spin.

---

## Bug 17 — Race on Interface Assignment Outside Atomic

```go
type Handler interface{ Handle() }

var current Handler

func update(h Handler) { current = h }  // BUG
func use()             { current.Handle() }
```

### What is wrong?

A Go interface is two words (type pointer + data pointer). Assigning to it is not atomic. A reader can observe the new type pointer with the old data pointer — and call `Handle()` on a misinterpretation of memory, crashing or returning garbage.

### Fix

Use `atomic.Value` or `atomic.Pointer[T]`:

```go
var current atomic.Pointer[Handler]
func update(h Handler) { current.Store(&h) }
func use() {
    if h := current.Load(); h != nil {
        (*h).Handle()
    }
}
```

Awkward because of the pointer-to-interface. Cleaner: wrap in a concrete struct.

```go
type wrapper struct{ h Handler }
var current atomic.Pointer[wrapper]

func update(h Handler) { current.Store(&wrapper{h: h}) }
func use() {
    if w := current.Load(); w != nil {
        w.h.Handle()
    }
}
```

---

## Bug 18 — `runtime.Gosched` in a CAS Loop "for Fairness"

```go
for {
    old := x.Load()
    if x.CompareAndSwap(old, old+1) {
        break
    }
    runtime.Gosched()
}
```

### What is wrong?

`runtime.Gosched` yields to the scheduler. Under heavy contention, the yield gives other goroutines a chance to run — which is the whole point of CAS contention. But under *low* contention, the yield is pure overhead. The CAS would have succeeded immediately; instead the goroutine bounces off the scheduler.

Worse, `Gosched` may cause the writer to lose its CPU just as it would have succeeded, prolonging the contention.

### Fix

Drop the yield. The CAS loop without yield exits in one iteration in the common case:

```go
for {
    old := x.Load()
    if x.CompareAndSwap(old, old+1) { break }
}
```

If you suspect heavy contention, profile and consider sharding instead of yielding.

Alternative for low-contention scenarios: backoff with exponential delay (in microseconds), but for atomic counters this is rarely needed.

---

## Bug 19 — Conflating "Atomic" with "Synchronised"

```go
var ready atomic.Bool
var data string

// goroutine A
data = "important"
ready.Store(true)

// goroutine B (BUG)
if ready.Load() {
    fmt.Println(data)
}

// also goroutine B (later)
data = "" // BUG — not synchronised; A may still be reading
```

### What is wrong?

The first reader of `data` is fine — Go's memory model guarantees that A's write to `data` is visible after B sees `ready == true`.

The *second* B write (`data = ""`) is not synchronised with anything. If A reads `data` after the second B write, B's write is invisible (or visible, or partial — undefined). This is a data race on `data`.

The trap: people assume "I used atomic somewhere, so everything is synchronised." Atomic synchronises the path that goes through the atomic op. Other writes need their own synchronisation.

### Fix

Use the atomic chain for every access:

```go
var data atomic.Pointer[string]

// A
s := "important"
data.Store(&s)
ready.Store(true)

// B
if ready.Load() {
    fmt.Println(*data.Load())
}
empty := ""
data.Store(&empty)
```

Or hold `data` access behind a mutex.

---

## Bug 20 — Double-Word Operations on Two Atomics

```go
var current atomic.Int64
var version atomic.Int64

func update(v int64) {
    current.Store(v)
    version.Add(1)
}

func read() (int64, int64) {
    return current.Load(), version.Load()
}
```

### What is wrong?

Readers want `(value, version)` to be consistent: the version corresponds to the value. The current code can return `(new value, old version)` or `(old value, new version)`. Subscribers using version to detect updates may miss them or process them twice.

### Fix

Pack into a struct:

```go
type Entry struct {
    Value, Version int64
}

var current atomic.Pointer[Entry]

func update(v int64) {
    for {
        old := current.Load()
        ver := int64(0)
        if old != nil {
            ver = old.Version + 1
        } else {
            ver = 1
        }
        new := &Entry{Value: v, Version: ver}
        if current.CompareAndSwap(old, new) {
            return
        }
    }
}

func read() *Entry { return current.Load() }
```

A single atomic load returns the full pair. Consistency restored. Cost: allocation per update.

---

## Final Notes

Some patterns repeat:

- **Mixing atomic and non-atomic access** — race detector catches it.
- **Two-variable consistency** — pack into a struct.
- **Mutation after publication** — copy-on-write.
- **`Load`-then-modify without CAS** — race window.
- **Type mismatch in `atomic.Value`** — prefer `atomic.Pointer[T]`.
- **Alignment on 32-bit** — use the typed API.

Most of these bugs are caught by `go test -race`. Some are subtle and require careful reading. Build the habit of running `-race` in CI; treat its warnings as production-blocking.
