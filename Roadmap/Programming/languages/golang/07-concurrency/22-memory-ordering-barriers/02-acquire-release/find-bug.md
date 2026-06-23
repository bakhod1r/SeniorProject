---
layout: default
title: Find Bug
parent: Acquire Release
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/02-acquire-release/find-bug/
---

# Acquire / Release — Find the Bug

Each section presents a buggy snippet involving acquire/release semantics. Identify the bug, explain why it's wrong, and propose a fix.

## Bug 1: Plain boolean flag

```go
var ready bool
var data string

go func() {
    data = "hello"
    ready = true
}()

for !ready { }
fmt.Println(data)
```

**Bug:** Both `ready` and `data` are accessed without synchronization. The reader's `for !ready` may spin forever (the compiler may hoist `ready` out of the loop). Even if not hoisted, the writer's `ready=true` may be observed before `data="hello"`, leading to `data=""`.

**Fix:** Use `atomic.Bool` for `ready`:

```go
var ready atomic.Bool
var data string

go func() {
    data = "hello"
    ready.Store(true)
}()

for !ready.Load() { }
fmt.Println(data)
```

Now `Store` is a release; `Load` is an acquire. The write to `data` is visible after the reader observes `ready=true`.

---

## Bug 2: Store flag before value

```go
var done atomic.Bool
var value int

go func() {
    done.Store(true) // RACE
    value = 42
}()

for !done.Load() { }
fmt.Println(value) // may see 0
```

**Bug:** The flag is stored *before* the value. The release on `done` doesn't publish the later write to `value`.

**Fix:** Store the value first, then the flag:

```go
go func() {
    value = 42
    done.Store(true)
}()
```

Now the release on `done` publishes the write to `value`.

---

## Bug 3: Atomic with plain read

```go
var counter atomic.Int64

go func() {
    counter.Add(1)
}()

go func() {
    if counter > 0 { // RACE: plain read
        // ...
    }
}()
```

**Bug:** `counter > 0` is a plain field read, not an atomic load. This is a data race.

**Fix:** Use `Load`:

```go
if counter.Load() > 0 { ... }
```

---

## Bug 4: Mutating published pointer

```go
var snap atomic.Pointer[Snapshot]

go func() {
    s := &Snapshot{Count: 0}
    snap.Store(s)
    s.Count = 1 // RACE: mutation after publish
}()

go func() {
    s := snap.Load()
    if s != nil {
        fmt.Println(s.Count)
    }
}()
```

**Bug:** After `Store(s)`, the writer mutates `s.Count`. Readers that already loaded `s` see the mutation: race condition.

**Fix:** Treat published values as immutable. To update, allocate a new snapshot:

```go
old := snap.Load()
new := &Snapshot{Count: old.Count + 1}
snap.Store(new)
```

---

## Bug 5: Double close of channel

```go
type Server struct {
    stop chan struct{}
}

func (s *Server) Stop() {
    close(s.stop) // panic on second call
}
```

**Bug:** Calling `Stop` twice (e.g., from a signal handler and from main) panics.

**Fix:** Use `sync.Once`:

```go
type Server struct {
    stop     chan struct{}
    stopOnce sync.Once
}

func (s *Server) Stop() {
    s.stopOnce.Do(func() { close(s.stop) })
}
```

---

## Bug 6: WaitGroup race

```go
var wg sync.WaitGroup
go func() {
    wg.Add(1)
    defer wg.Done()
    work()
}()
wg.Wait() // may return before Add
```

**Bug:** `Add` is called inside the goroutine; `Wait` may run first, see counter=0, return immediately.

**Fix:** Call `Add` before spawning:

```go
wg.Add(1)
go func() {
    defer wg.Done()
    work()
}()
wg.Wait()
```

---

## Bug 7: Captured loop variable (pre-Go 1.22)

```go
for i := 0; i < 10; i++ {
    go func() {
        fmt.Println(i) // captures by reference
    }()
}
```

**Bug (pre-1.22):** All goroutines capture the same `i`, possibly already incremented to 10.

**Fix:** Shadow inside the loop:

```go
for i := 0; i < 10; i++ {
    i := i
    go func() {
        fmt.Println(i)
    }()
}
```

Or upgrade to Go 1.22+, which fixes the loop variable scoping.

---

## Bug 8: Map concurrent access

```go
var users = map[int]string{}

go func() { users[1] = "alice" }()
go func() { _ = users[1] }()
```

**Bug:** Maps are not safe for concurrent access. Reads concurrent with writes can panic.

**Fix:** Use a mutex or `sync.Map`:

```go
var mu sync.RWMutex
var users = map[int]string{}

go func() {
    mu.Lock()
    users[1] = "alice"
    mu.Unlock()
}()

go func() {
    mu.RLock()
    _ = users[1]
    mu.RUnlock()
}()
```

---

## Bug 9: Goroutine leak via blocked channel

```go
ch := make(chan int)
go func() {
    result := compute()
    ch <- result // blocks forever if no receiver
}()
// (forgot to receive)
```

**Bug:** Without a receiver, the goroutine blocks forever, leaking memory.

**Fix:** Use a buffered channel or context cancellation:

```go
ch := make(chan int, 1)
ctx, cancel := context.WithCancel(parent)
defer cancel()
go func() {
    select {
    case ch <- compute():
    case <-ctx.Done():
    }
}()
```

---

## Bug 10: Mismatched atomic types

```go
var v int32

go func() {
    atomic.StoreInt32(&v, 1)
}()

go func() {
    if v == 1 { /* ... */ } // RACE: plain read
}()
```

**Bug:** Mixing atomic and plain access.

**Fix:** Use atomic everywhere:

```go
if atomic.LoadInt32(&v) == 1 { ... }
```

Or, prefer `atomic.Int32`:

```go
var v atomic.Int32
// ...
v.Store(1)
// ...
if v.Load() == 1 { ... }
```

---

## Bug 11: Once panic

```go
var once sync.Once
var cfg *Config

func GetCfg() *Config {
    once.Do(func() {
        cfg = loadCfg() // panics on transient error
    })
    return cfg
}
```

**Bug:** If `loadCfg` panics, `once` considers itself done. Future callers return nil.

**Fix:** Recover, or use a retriable pattern:

```go
func GetCfg() *Config {
    once.Do(func() {
        defer func() {
            if r := recover(); r != nil {
                // log; cfg remains nil
            }
        }()
        cfg = loadCfg()
    })
    return cfg
}
```

For retry-on-error, build a custom `RetriableOnce`.

---

## Bug 12: Time-based "synchronization"

```go
go func() { x = 1 }()
time.Sleep(100 * time.Millisecond)
fmt.Println(x) // RACE
```

**Bug:** `time.Sleep` doesn't establish happens-before. The read of `x` races with the write.

**Fix:** Use a channel or atomic:

```go
done := make(chan struct{})
go func() { x = 1; close(done) }()
<-done
fmt.Println(x)
```

---

## Bug 13: Slow I/O under mutex

```go
mu.Lock()
defer mu.Unlock()
result := slowHTTPCall() // holds lock for seconds
cache[k] = result
```

**Bug:** The mutex is held during slow I/O, serializing all callers.

**Fix:** Drop the lock during I/O:

```go
mu.Lock()
if v, ok := cache[k]; ok {
    mu.Unlock()
    return v
}
mu.Unlock()

result := slowHTTPCall()

mu.Lock()
cache[k] = result
mu.Unlock()
return result
```

(But beware: this is a TOCTOU race — two goroutines may both fetch. Single-flight pattern handles it correctly.)

---

## Bug 14: Forgotten cancellation

```go
func work() {
    for {
        doSomething()
        time.Sleep(time.Second)
    }
}

go work() // no way to stop
```

**Bug:** The goroutine runs forever, no cancellation.

**Fix:** Pass context:

```go
func work(ctx context.Context) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            doSomething()
        }
    }
}

ctx, cancel := context.WithCancel(parent)
defer cancel()
go work(ctx)
```

---

## Bug 15: CAS on stale read

```go
for {
    old := counter.Load()
    new := transform(old)
    counter.Store(new) // RACE: not CAS!
    break
}
```

**Bug:** Concurrent writers can interleave, losing updates.

**Fix:** Use `CompareAndSwap` in a retry loop:

```go
for {
    old := counter.Load()
    new := transform(old)
    if counter.CompareAndSwap(old, new) {
        break
    }
}
```

---

## Bug 16: Slice header race

```go
var data []int

go func() {
    data = []int{1, 2, 3}
}()

go func() {
    for len(data) == 0 { }
    fmt.Println(data[0])
}()
```

**Bug:** A slice is a three-word header; non-atomic assignment can be observed mid-update.

**Fix:** Publish a pointer:

```go
var data atomic.Pointer[[]int]

go func() {
    d := []int{1, 2, 3}
    data.Store(&d)
}()

go func() {
    for data.Load() == nil { }
    fmt.Println((*data.Load())[0])
}()
```

---

## Bug 17: Lost wakeup with sync.Cond

```go
mu.Lock()
if !ready {
    cond.Wait()
}
mu.Unlock()
```

**Bug:** `if` should be `for`. Spurious wakeups can occur; the condition must be re-checked.

**Fix:**

```go
mu.Lock()
for !ready {
    cond.Wait()
}
mu.Unlock()
```

---

## Bug 18: Mutex held during channel send

```go
mu.Lock()
ch <- v // may block, deadlocking other Lock callers
mu.Unlock()
```

**Bug:** If `ch` is unbuffered or full, the send blocks while holding the mutex. Other goroutines blocked on the mutex can deadlock if they also receive from `ch`.

**Fix:** Send outside the lock, or use a select with default:

```go
mu.Lock()
v := pickValue()
mu.Unlock()
ch <- v
```

---

## Bug 19: Read-then-CAS race

```go
if x.Load() < 100 {
    x.Add(1) // RACE: another goroutine may have incremented
}
```

**Bug:** Between the Load and the Add, x may have changed. No atomicity for the check-then-set.

**Fix:** Use CAS:

```go
for {
    cur := x.Load()
    if cur >= 100 { break }
    if x.CompareAndSwap(cur, cur+1) { break }
}
```

---

## Bug 20: Returning internal mutable state

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func (c *Cache) Items() map[string]string {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.m // RACE: caller iterates after lock released
}
```

**Bug:** The returned map is the internal one. Caller iterates without lock; concurrent writes panic.

**Fix:** Return a copy:

```go
func (c *Cache) Items() map[string]string {
    c.mu.Lock()
    defer c.mu.Unlock()
    cp := make(map[string]string, len(c.m))
    for k, v := range c.m {
        cp[k] = v
    }
    return cp
}
```

---

## How to Use This File

For each bug:

1. Read the snippet.
2. Identify the bug before reading the explanation.
3. Compare your answer.
4. Try the fix in code; verify with `go test -race`.

This trains your eye to spot concurrency bugs.

End of find-bug.md.
