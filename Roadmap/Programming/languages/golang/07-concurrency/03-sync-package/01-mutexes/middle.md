# Mutexes — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Lock Granularity](#lock-granularity)
3. [The Copy-Of-Mutex Bug](#the-copy-of-mutex-bug)
4. [Pointer Receivers Are Mandatory](#pointer-receivers-are-mandatory)
5. [Deadlocks: The Three Common Shapes](#deadlocks-the-three-common-shapes)
6. [`TryLock` and Why You Probably Don't Need It](#trylock-and-why-you-probably-dont-need-it)
7. [Read-Modify-Write Patterns](#read-modify-write-patterns)
8. [Mutex vs Channel vs Atomic](#mutex-vs-channel-vs-atomic)
9. [Lock Ordering and Hierarchies](#lock-ordering-and-hierarchies)
10. [Mutex Profiling Basics](#mutex-profiling-basics)
11. [Common Patterns](#common-patterns)
12. [Real-World Examples](#real-world-examples)
13. [Edge Cases](#edge-cases)
14. [Best Practices](#best-practices)
15. [Tricky Questions](#tricky-questions)
16. [Summary](#summary)

---

## Introduction

You've used `sync.Mutex` to protect a counter and a map. You know `defer mu.Unlock()`. The race detector is your friend. So why does this file exist?

Because every non-trivial Go service eventually hits one of these:

- A struct that gets accidentally copied and the lock stops working.
- A method that calls another method on the same object and deadlocks.
- A profile that shows 30% of CPU time is spent in `runtime.lock()`.
- A code review that says "use RWMutex here" — but is it actually faster?
- Two locks acquired in different orders by two goroutines, and the system freezes once a week in production.

This file is about turning "I can use a mutex" into "I know which mutex, where, why, and at what cost."

After reading you will:
- Understand granularity trade-offs (one big lock vs many small locks).
- Recognise the copy-of-mutex bug and know how `go vet` catches it.
- Have a working mental model of deadlocks and a strategy to avoid them.
- Know when (and when not) to use `TryLock`.
- Be able to compare `sync.Mutex`, `sync.RWMutex`, channels, and `sync/atomic` for a given scenario.
- Read a basic mutex profile from `pprof`.

---

## Lock Granularity

The first design decision when adding mutexes to a struct is *how much it covers*.

### Coarse-grained: one lock for everything

```go
type Server struct {
    mu       sync.Mutex // protects every field below
    sessions map[string]*Session
    cache    map[string][]byte
    metrics  Metrics
}
```

Pros: simple, easy to reason about, never out of order.
Cons: a goroutine reading the cache contends with one updating an unrelated session.

### Fine-grained: one lock per field

```go
type Server struct {
    sessionsMu sync.RWMutex
    sessions   map[string]*Session

    cacheMu sync.RWMutex
    cache   map[string][]byte

    metricsMu sync.Mutex
    metrics   Metrics
}
```

Pros: parallel access to unrelated fields.
Cons: more locks to acquire, more chances to mis-order them.

### Sharded: one lock per partition of one field

```go
const shards = 32

type ShardedMap struct {
    parts [shards]struct {
        mu sync.Mutex
        m  map[string]string
    }
}

func (s *ShardedMap) Get(k string) string {
    h := fnv32(k) % shards
    s.parts[h].mu.Lock()
    defer s.parts[h].mu.Unlock()
    return s.parts[h].m[k]
}
```

Pros: linear scaling up to `shards` concurrent operations on different keys.
Cons: more memory, slightly slower for single-threaded use.

### Rule of thumb

Start coarse. If the profiler shows the lock as a bottleneck, split. Premature sharding is hard to undo because callers depend on what the lock covers.

---

## The Copy-Of-Mutex Bug

This is the most-asked-about Go bug in production support.

### What goes wrong

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() { // value receiver — copies the mutex
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func main() {
    var c Counter
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Inc()
        }()
    }
    wg.Wait()
    fmt.Println(c.n) // not 1000, but also not even consistent
}
```

Each call to `c.Inc()` makes a *copy* of `c`, including the mutex. A thousand independent mutexes means no mutual exclusion at all. To make matters worse, `c.n++` operates on the copy, so even the value disappears.

### Why this happens

Go passes structs by value by default. A `sync.Mutex` is a struct (`{state int32; sema uint32}`). Copying it produces a fresh, unlocked mutex with no relation to the original.

### How `go vet` catches it

```bash
$ go vet ./...
./main.go:9:9: Inc passes lock by value: command-line-arguments.Counter contains sync.Mutex
```

`go vet` is part of `go test` by default and runs on every `go build` in many editor integrations. Trust it.

### The fix

```go
func (c *Counter) Inc() { // pointer receiver
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

Pointer receivers do not copy the receiver, so the embedded mutex is shared.

### Less obvious copies

```go
// 1) Returning a struct that contains a mutex
func GetCounter() Counter { return Counter{} } // each caller gets its own mutex — usually fine

// 2) Storing in a slice by value
counters := []Counter{{}, {}, {}}
counters[0].Inc() // OK if Inc has pointer receiver and len doesn't change
                  // DANGEROUS if append reallocates the backing array

// 3) Range-over-slice loop variable (until Go 1.22)
for _, c := range counters {
    go c.Inc() // c is a copy on each iteration; mutex is per-copy
}

// 4) Map values
mp := map[string]Counter{}
mp["a"].Inc() // compile error if Inc has pointer receiver — Go forbids taking addr of map value
              // even with value receiver, you'd lock a copy

// FIX: use map[string]*Counter
```

---

## Pointer Receivers Are Mandatory

A struct that contains a mutex is *not safe* to use with mixed value and pointer receivers. Pick one rule and follow it: **any method on a struct that contains a mutex must use a pointer receiver.**

```go
type Logger struct {
    mu sync.Mutex
    n  int
}

// REQUIRED: pointer receivers everywhere
func (l *Logger) Log(s string) { ... }
func (l *Logger) Count() int   { ... }
func (l *Logger) Reset()       { ... }
```

Embedding the mutex via pointer (rare) is the alternative:

```go
type Logger struct {
    *sync.Mutex
    n int
}
```

But this clutters the public API (callers can call `Logger.Lock()` themselves) and is generally discouraged.

---

## Deadlocks: The Three Common Shapes

### Shape 1 — Forgotten Unlock on early return

```go
func (s *Store) Get(k string) (string, error) {
    s.mu.Lock()
    if s.closed {
        return "", errClosed // FORGOT to Unlock — every future Lock blocks forever
    }
    v := s.m[k]
    s.mu.Unlock()
    return v, nil
}
```

Fix: `defer s.mu.Unlock()` immediately after `s.mu.Lock()`.

### Shape 2 — Reentrant lock in the same goroutine

```go
func (s *Store) Add(k, v string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.AddIfMissing(k, v) // calls s.mu.Lock() again — DEADLOCK
}

func (s *Store) AddIfMissing(k, v string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if _, ok := s.m[k]; !ok {
        s.m[k] = v
    }
}
```

Fix: factor out an internal "already locked" version:

```go
func (s *Store) Add(k, v string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.addIfMissingLocked(k, v)
}

func (s *Store) addIfMissingLocked(k, v string) {
    if _, ok := s.m[k]; !ok {
        s.m[k] = v
    }
}
```

### Shape 3 — Lock ordering inversion

```go
// Goroutine A
a.mu.Lock()
b.mu.Lock()
// ...
b.mu.Unlock()
a.mu.Unlock()

// Goroutine B (acquired in opposite order)
b.mu.Lock()
a.mu.Lock()
// ...
a.mu.Unlock()
b.mu.Unlock()
```

If A holds `a.mu` and tries to take `b.mu`, while B holds `b.mu` and tries to take `a.mu`, neither can proceed. Classic deadlock.

Fix: define a global lock order. Always acquire `a.mu` before `b.mu`. Document it.

```go
// Lock order: aMu < bMu (aMu must be acquired first)
```

For locking a pair of objects (e.g. transferring between two accounts), order by pointer or by ID:

```go
func transfer(a, b *Account, amount int) {
    first, second := a, b
    if uintptr(unsafe.Pointer(b)) < uintptr(unsafe.Pointer(a)) {
        first, second = b, a
    }
    first.mu.Lock()
    second.mu.Lock()
    defer first.mu.Unlock()
    defer second.mu.Unlock()
    // transfer
}
```

The runtime detects deadlocks of *all* goroutines (the famous `fatal error: all goroutines are asleep - deadlock!`), but partial deadlocks (some goroutines stuck while others run) are silent. The only cure is discipline.

---

## `TryLock` and Why You Probably Don't Need It

Go 1.18 added `Mutex.TryLock` and `RWMutex.TryLock`/`TryRLock`:

```go
if mu.TryLock() {
    defer mu.Unlock()
    // got the lock
} else {
    // didn't get it, do something else
}
```

The official documentation states:

> Note that while correct uses of TryLock do exist, they are rare, and use of TryLock is often a sign of a deeper problem in a particular use of mutexes.

Why? Because `TryLock`-based logic is usually "lock-free retry loops" or "fall back to something stale" — both of which have better designs:

- For "give up if busy," prefer a context-aware queue or a separate fast-path data structure.
- For "is there work to do?", use a channel.

The legitimate uses are mostly diagnostic: "report whether the lock is contended" in logs, or in lock-checking utilities. If you reach for `TryLock` in business code, pause and reconsider.

---

## Read-Modify-Write Patterns

A common bug:

```go
// WRONG
mu.RLock()
v := m[k]
mu.RUnlock()
mu.Lock()
m[k] = compute(v)
mu.Unlock()
```

Between the read unlock and the write lock, another goroutine may have changed `m[k]`. The pattern is "TOCTOU" (time-of-check to time-of-use).

Correct:

```go
// CORRECT
mu.Lock()
defer mu.Unlock()
v := m[k]
m[k] = compute(v)
```

If `compute(v)` is expensive, a different design is appropriate (snapshot-and-CAS, or per-key locks), but never split the read and write of the same key under different locks.

---

## Mutex vs Channel vs Atomic

When should each be used? Go's proverb says "Don't communicate by sharing memory; share memory by communicating," but in practice mutexes are extremely common and idiomatic.

| Scenario | Best tool | Why |
|----------|-----------|-----|
| Single counter incremented from many goroutines | `atomic.Int64.Add` | Lockless, fastest |
| Multi-field struct mutated together | `sync.Mutex` | Atomic updates of related fields |
| Read-heavy cache (≥ 5× more reads than writes) | `sync.RWMutex` | Concurrent readers |
| Producer/consumer pipeline | channel | Coordination + flow control |
| Single owner of state with many requesters | channel + actor goroutine | Eliminates locking |
| Pointer-swap of an immutable config blob | `atomic.Value` or `atomic.Pointer[T]` | Lockless reads |
| Lazy one-shot init | `sync.Once` | Built for this exact case |
| Bounded counter with overflow checks | `sync.Mutex` | Branching logic doesn't fit atomics |

Rule of thumb: prefer the tool that yields the simplest correct code. Optimise after measurement, not before.

---

## Lock Ordering and Hierarchies

Real systems have many locks. To prevent deadlocks across them, define a *partial order*:

```
         ┌─────────────┐
         │   global    │
         └──────┬──────┘
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
   sessions  cache   metrics
       │
       ▼
   per-session
```

The rule: a goroutine that holds a lower (less-deep) lock may acquire a deeper one, but never the reverse.

Document this order at the top of each file. Code reviewers should reject any acquisition path that violates it.

For dynamic structures (locking two arbitrary objects), order by some stable key — pointer address, ID, or hash. Consistent ordering across all callers prevents inversion deadlocks.

---

## Mutex Profiling Basics

Go's runtime can sample mutex contention:

```bash
go test -bench=. -mutexprofile=mu.prof
go tool pprof mu.prof
```

In `pprof`:

```
(pprof) top
Showing nodes accounting for 1.25s, 100% of 1.25s total
      flat  flat%   sum%        cum   cum%
     1.10s 88.00% 88.00%      1.10s 88.00%  sync.(*Mutex).Lock
     0.15s 12.00% 100%       0.15s 12.00%  ...
```

Or as a graph:

```bash
go tool pprof -web mu.prof
```

In production, expose `net/http/pprof`:

```go
import _ "net/http/pprof"
go http.ListenAndServe(":6060", nil)
```

Then:

```bash
curl http://localhost:6060/debug/pprof/mutex?seconds=30 > mu.prof
go tool pprof mu.prof
```

The runtime sample rate defaults to off; enable with:

```go
runtime.SetMutexProfileFraction(1) // sample 1 of every 1 contention events
```

A "hot" mutex shows up as a line consuming significant time. The fix is usually to:

1. Shorten the critical section.
2. Replace with `RWMutex` if reads dominate.
3. Shard the lock.
4. Replace with atomics or channels.

---

## Common Patterns

### Pattern: Snapshot under lock, work outside

```go
func (s *Service) Process() error {
    s.mu.RLock()
    snapshot := make([]Item, len(s.items))
    copy(snapshot, s.items)
    s.mu.RUnlock()

    // Work on the snapshot without holding the lock
    for _, it := range snapshot {
        process(it)
    }
    return nil
}
```

### Pattern: Lock-and-wait via condition variable

```go
type Queue struct {
    mu    sync.Mutex
    cond  *sync.Cond
    items []Item
}

func NewQueue() *Queue {
    q := &Queue{}
    q.cond = sync.NewCond(&q.mu)
    return q
}

func (q *Queue) Push(it Item) {
    q.mu.Lock()
    q.items = append(q.items, it)
    q.cond.Signal()
    q.mu.Unlock()
}

func (q *Queue) Pop() Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.cond.Wait()
    }
    it := q.items[0]
    q.items = q.items[1:]
    return it
}
```

### Pattern: Single-flight initialisation

If many goroutines might trigger an expensive load, but you want only one actually to do it, prefer `sync.Once` or `golang.org/x/sync/singleflight`. A naive mutex would serialise *every* call, even after init is done.

```go
var (
    once sync.Once
    val  Heavy
)

func Get() Heavy {
    once.Do(func() {
        val = computeOnce()
    })
    return val
}
```

---

## Real-World Examples

### Connection pool

```go
type Pool struct {
    mu    sync.Mutex
    free  []*Conn
}

func (p *Pool) Get() *Conn {
    p.mu.Lock()
    defer p.mu.Unlock()
    if len(p.free) == 0 {
        return newConn()
    }
    c := p.free[len(p.free)-1]
    p.free = p.free[:len(p.free)-1]
    return c
}

func (p *Pool) Put(c *Conn) {
    p.mu.Lock()
    defer p.mu.Unlock()
    p.free = append(p.free, c)
}
```

Critical section: tiny. No I/O. Perfect mutex use.

### Rate counter

```go
type RateCounter struct {
    mu    sync.Mutex
    bucket [60]int64 // requests per second, last 60 s
    head   int
    last   int64
}

func (r *RateCounter) Inc() {
    now := time.Now().Unix()
    r.mu.Lock()
    defer r.mu.Unlock()
    if now != r.last {
        gap := int(now - r.last)
        if gap > 60 {
            gap = 60
        }
        for i := 0; i < gap; i++ {
            r.head = (r.head + 1) % 60
            r.bucket[r.head] = 0
        }
        r.last = now
    }
    r.bucket[r.head]++
}
```

Multi-step state mutation — exactly what mutexes are for.

### Per-user state map

```go
type UserStore struct {
    mu    sync.RWMutex
    users map[int64]*User
}

func (s *UserStore) Get(id int64) (*User, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    u, ok := s.users[id]
    return u, ok
}

func (s *UserStore) Update(id int64, fn func(*User)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if u, ok := s.users[id]; ok {
        fn(u)
    }
}
```

But now consider: while `Update` holds the lock, every `Get` blocks. If `fn` is slow, you've serialised the whole store on one user's update.

Better:

```go
func (s *UserStore) Update(id int64, fn func(*User)) {
    s.mu.RLock()
    u, ok := s.users[id]
    s.mu.RUnlock()
    if !ok {
        return
    }
    u.mu.Lock()
    defer u.mu.Unlock()
    fn(u)
}
```

Now per-user updates are serialised only on that user's mutex. The store-level lock is only held for the map lookup.

---

## Edge Cases

- **Mutex inside a slice:** appending to the slice may reallocate, copying the mutex. Use `[]*T` instead of `[]T` whenever `T` contains a mutex.
- **Mutex inside a map value:** Go forbids taking the address of a map value, so you can't even call a pointer-receiver method. Use `map[K]*T`.
- **Zero-initialised global mutex:** safe; that's the whole point of "zero value is usable."
- **Locking a mutex inside a `defer`:** valid but rare. Usually the unlock is the deferred call, not the lock.
- **Recover-on-panic with a held lock:** `defer recover()` runs before `defer Unlock()` if recover is deferred later. Order matters: defer the unlock *first*, then the recover.
- **`go vet` does not catch every copy.** It can miss copies through interface satisfaction or reflection. Code review still matters.

---

## Best Practices

- Document which fields each mutex protects. A one-line comment saves hours.
- Prefer pointer receivers exclusively for any type with a mutex.
- Lock at the boundary of a method, never deeper. The whole method should be inside one critical section, or none at all.
- Never call user code while holding a lock. If you must call a callback, snapshot under lock and call after.
- When sharding, choose 16, 32, or 64 shards as a default. Power of two for cheap modulo.
- Run `-race` in CI. Always.
- Run `go vet` in CI. Always.

---

## Tricky Questions

**Q: Why doesn't `go vet` complain about every value receiver on a struct that has a mutex?**

A: Because not every value receiver actually copies the receiver in a way that matters. `go vet`'s `copylocks` check looks at function calls, returns, range loops, and assignments — places where a copy is observable. It misses some indirect copies through interfaces, but it catches the common cases.

**Q: Is `sync.Mutex.Lock()` interruptible?**

A: No. There is no `LockContext`. A goroutine waiting in `Lock` cannot be cancelled. If you need cancellable locking, use a channel-based lock (`semaphore` from `golang.org/x/sync`) or a custom design.

**Q: Why isn't there `Lock(timeout)`?**

A: The Go team intentionally kept `sync.Mutex` minimal. `TryLock` (Go 1.18+) is the only escape hatch, and it's discouraged in regular code. For timeouts, use channels.

**Q: Can I use `RWMutex` if there is exactly one writer goroutine?**

A: Sure, but a regular `Mutex` may be slightly faster because `RWMutex` has more bookkeeping. Measure first.

**Q: Two goroutines call `RLock` simultaneously. Do they both get it?**

A: Yes — that's the whole point of `RWMutex`. They share read access. A waiting writer, however, blocks new readers (under fairness mode) to prevent starvation.

**Q: What happens to a goroutine waiting on `Lock` when the program exits?**

A: It dies with the program; no cleanup is run. If your shutdown depends on goroutines exiting cleanly, design with `context.Context` and select-on-done, not blocking locks.

**Q: I see `runtime.semacquire` taking 80% of CPU in pprof. What does that mean?**

A: Heavy mutex contention. Many goroutines are queued waiting for the same lock. Look at the call stacks in pprof to identify which mutex.

---

## Summary

Middle-level mutex use is about *granularity, ordering, and measurement*. Coarse locks are simple but bottleneck. Fine-grained locks scale but multiply deadlock risk. The copy-of-mutex bug is the single most common Go concurrency surprise — `go vet` catches most cases but pointer receivers are your real defence. Lock ordering must be consistent. `TryLock` exists but is rarely the right answer. When the profile says a mutex is hot, you have a small toolkit: shorten the critical section, switch to `RWMutex`, shard, or move to atomics or channels.

The senior file goes deeper on the runtime mechanics; the optimize file shows worked examples of each remediation.
