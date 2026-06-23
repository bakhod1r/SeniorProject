# Mutexes — Hands-on Tasks

A graded set of exercises. Difficulty grows from trivial counter to production-style sharded structures with profiling. Each task includes hints and a sample solution.

---

## Task 1 — Make This Counter Safe

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    n int
}

func (c *Counter) Inc() { c.n++ }

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
    fmt.Println(c.n) // not 1000 — make it 1000 every run
}
```

**Hints:**
- Add a `sync.Mutex` field.
- Use `defer mu.Unlock()`.
- Run with `go run -race main.go` to confirm no races.

**Solution:**

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

---

## Task 2 — Goroutine-safe Map

Implement a `SafeMap[K comparable, V any]` with `Get`, `Set`, `Delete`, and `Len` methods. Reads should not block each other.

**Skeleton:**

```go
type SafeMap[K comparable, V any] struct {
    // TODO
}

func New[K comparable, V any]() *SafeMap[K, V] { /* TODO */ }
func (s *SafeMap[K, V]) Get(k K) (V, bool)     { /* TODO */ }
func (s *SafeMap[K, V]) Set(k K, v V)          { /* TODO */ }
func (s *SafeMap[K, V]) Delete(k K)            { /* TODO */ }
func (s *SafeMap[K, V]) Len() int              { /* TODO */ }
```

**Solution:**

```go
type SafeMap[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
}

func New[K comparable, V any]() *SafeMap[K, V] {
    return &SafeMap[K, V]{m: make(map[K]V)}
}

func (s *SafeMap[K, V]) Get(k K) (V, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    v, ok := s.m[k]
    return v, ok
}

func (s *SafeMap[K, V]) Set(k K, v V) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.m[k] = v
}

func (s *SafeMap[K, V]) Delete(k K) {
    s.mu.Lock()
    defer s.mu.Unlock()
    delete(s.m, k)
}

func (s *SafeMap[K, V]) Len() int {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return len(s.m)
}
```

---

## Task 3 — Bank Transfer Without Deadlock

Implement `Transfer(from, to *Account, amount int)` that locks both accounts and moves money. Two concurrent transfers between the same accounts in opposite directions must not deadlock.

```go
type Account struct {
    id      int
    mu      sync.Mutex
    balance int
}
```

**Hints:**
- Order locks by `id` (or pointer address) — always lock the lower-id account first.
- Use `defer` for both unlocks.

**Solution:**

```go
func Transfer(from, to *Account, amount int) error {
    if amount < 0 {
        return errors.New("negative amount")
    }
    a, b := from, to
    if b.id < a.id {
        a, b = b, a
    }
    a.mu.Lock()
    defer a.mu.Unlock()
    b.mu.Lock()
    defer b.mu.Unlock()
    if from.balance < amount {
        return errors.New("insufficient funds")
    }
    from.balance -= amount
    to.balance += amount
    return nil
}
```

---

## Task 4 — Read-heavy Cache with RWMutex

Build a `Cache` with `Get`, `Set`, and `Stats() (hits, misses int64)`. Reads should be concurrent.

```go
type Cache struct {
    mu     sync.RWMutex
    m      map[string]string
    hits   int64
    misses int64
}
```

**Twist:** updating `hits` and `misses` requires a write lock or atomic operations — choose one and justify.

**Solution (atomics for stats, RWMutex for the map):**

```go
type Cache struct {
    mu     sync.RWMutex
    m      map[string]string
    hits   atomic.Int64
    misses atomic.Int64
}

func New() *Cache { return &Cache{m: make(map[string]string)} }

func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    v, ok := c.m[k]
    c.mu.RUnlock()
    if ok {
        c.hits.Add(1)
    } else {
        c.misses.Add(1)
    }
    return v, ok
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    c.m[k] = v
    c.mu.Unlock()
}

func (c *Cache) Stats() (int64, int64) {
    return c.hits.Load(), c.misses.Load()
}
```

Reads may run concurrently; stats are updated lock-free. Best of both worlds.

---

## Task 5 — Sharded Counter

Implement a counter sharded across N partitions for high write throughput. Provide `Add(delta int64)` and `Total() int64`.

**Hint:** Each goroutine should pick a shard by goroutine-local hash or round-robin. `Total` sums all shards.

**Solution:**

```go
const shards = 64

type ShardedCounter struct {
    parts [shards]struct {
        n atomic.Int64
        _ [56]byte // pad to 64 bytes (size of cache line)
    }
}

func (c *ShardedCounter) Add(delta int64) {
    h := uint64(runtime_procPin())
    runtime_procUnpin()
    c.parts[h%shards].n.Add(delta)
}

func (c *ShardedCounter) Total() int64 {
    var t int64
    for i := range c.parts {
        t += c.parts[i].n.Load()
    }
    return t
}
```

(`runtime_procPin` is internal; in real code use `goid` or a thread-local index. Or just pick a shard at random.)

---

## Task 6 — Single-Producer Queue with `sync.Cond`

Implement a queue where producers append items and a single consumer goroutine waits on `sync.Cond`. Bonus: support graceful shutdown.

**Solution:**

```go
type Queue struct {
    mu     sync.Mutex
    cond   *sync.Cond
    items  []int
    closed bool
}

func NewQueue() *Queue {
    q := &Queue{}
    q.cond = sync.NewCond(&q.mu)
    return q
}

func (q *Queue) Push(v int) {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.items = append(q.items, v)
    q.cond.Signal()
}

func (q *Queue) Pop() (int, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 && !q.closed {
        q.cond.Wait()
    }
    if len(q.items) == 0 {
        return 0, false
    }
    v := q.items[0]
    q.items = q.items[1:]
    return v, true
}

func (q *Queue) Close() {
    q.mu.Lock()
    q.closed = true
    q.cond.Broadcast()
    q.mu.Unlock()
}
```

---

## Task 7 — Replace a Mutex with `atomic.Pointer`

The following config struct is updated rarely but read often:

```go
type Config struct {
    mu      sync.RWMutex
    timeout time.Duration
    retries int
}
```

Convert to lock-free reads using copy-on-write.

**Solution:**

```go
type Config struct {
    Timeout time.Duration
    Retries int
}

var current atomic.Pointer[Config]

func Init() {
    current.Store(&Config{Timeout: 5 * time.Second, Retries: 3})
}

func Current() *Config { return current.Load() }

func Update(timeout time.Duration, retries int) {
    current.Store(&Config{Timeout: timeout, Retries: retries})
}
```

Readers never block. Writers replace the entire pointer atomically. The old `Config` is GC'd once no reader has it.

**Important:** the loaded `Config` must be treated as immutable. Never mutate `*current.Load()`.

---

## Task 8 — Detect Lock Hold Time

Wrap a `sync.Mutex` to log when the lock is held longer than 100ms.

**Solution:**

```go
type LoggedMutex struct {
    mu       sync.Mutex
    acquired time.Time
}

func (m *LoggedMutex) Lock() {
    m.mu.Lock()
    m.acquired = time.Now()
}

func (m *LoggedMutex) Unlock() {
    if held := time.Since(m.acquired); held > 100*time.Millisecond {
        log.Printf("mutex held for %v", held)
    }
    m.mu.Unlock()
}
```

This is fine for diagnostics. For production, prefer `runtime.SetMutexProfileFraction` and pprof.

---

## Task 9 — Implement `RLocker`

Without using `sync.RWMutex.RLocker`, write a wrapper that turns an `*RWMutex` into a `sync.Locker` whose `Lock` / `Unlock` calls `RLock` / `RUnlock`.

**Solution:**

```go
type rlocker struct{ *sync.RWMutex }

func (r rlocker) Lock()   { r.RLock() }
func (r rlocker) Unlock() { r.RUnlock() }

func AsLocker(rw *sync.RWMutex) sync.Locker {
    return rlocker{rw}
}
```

---

## Task 10 — Reentrancy Check

Write a `RecursiveMutex` that allows the *same goroutine* to lock multiple times (and requires the same number of unlocks). Bonus: explain why this is a bad idea.

**Hint:** You'll need the goroutine ID. Go doesn't expose it directly; use the `petermattis/goid` library or parse `runtime.Stack`.

**Solution sketch:**

```go
type RecursiveMutex struct {
    mu    sync.Mutex
    owner int64
    depth int
}

func (m *RecursiveMutex) Lock() {
    g := goid()
    if atomic.LoadInt64(&m.owner) == g {
        m.depth++
        return
    }
    m.mu.Lock()
    atomic.StoreInt64(&m.owner, g)
    m.depth = 1
}

func (m *RecursiveMutex) Unlock() {
    m.depth--
    if m.depth == 0 {
        atomic.StoreInt64(&m.owner, 0)
        m.mu.Unlock()
    }
}
```

**Why this is a bad idea:** it encourages "I have the lock, so the data is consistent" reasoning across nested calls, but the outer caller may still be in the middle of a multi-step update. The Go team rejected reentrancy on purpose. Use this only if you absolutely must port reentrant code from another language.

---

## Task 11 — Find the Hot Lock

Run this benchmark and use `-mutexprofile` to identify the hot lock:

```go
type Server struct {
    mu sync.Mutex
    n  int
}

func (s *Server) Handle() {
    s.mu.Lock()
    defer s.mu.Unlock()
    time.Sleep(time.Millisecond) // simulate work
    s.n++
}

func BenchmarkHandle(b *testing.B) {
    s := &Server{}
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            s.Handle()
        }
    })
}
```

```bash
go test -bench=. -mutexprofile=mu.prof
go tool pprof mu.prof
(pprof) top
(pprof) list Handle
```

**Question:** how would you fix the bottleneck if `Handle` really did need to do that work?

**Answer:** move the work outside the lock if it doesn't need shared state, shard the lock by request type or key, or replace the counter with an atomic.

---

## Task 12 — Compose Two Locks Safely

A `Game` has a `Player` and an `Enemy`, each with their own mutex. Implement `Engage(g *Game)` that locks both and resolves combat. There may be multiple `Game` objects in play at once.

**Hint:** Within one game, the order is fixed (player first, enemy second). But if a goroutine processes two games simultaneously, ensure no inversion across games.

**Solution:**

```go
type Player struct {
    id int
    mu sync.Mutex
    hp int
}
type Enemy struct {
    id int
    mu sync.Mutex
    hp int
}
type Game struct {
    p *Player
    e *Enemy
}

func (g *Game) Engage(damage int) {
    g.p.mu.Lock()
    g.e.mu.Lock()
    g.p.hp -= damage
    g.e.hp -= damage
    g.e.mu.Unlock()
    g.p.mu.Unlock()
}
```

Within a game, fixed order. Across games, each game's mutexes are independent.

---

## Task 13 — Build a Counting Semaphore from a Mutex + Cond

Implement a counting semaphore (limit N concurrent operations).

**Solution:**

```go
type Sem struct {
    mu sync.Mutex
    cond *sync.Cond
    n, max int
}

func NewSem(max int) *Sem {
    s := &Sem{max: max}
    s.cond = sync.NewCond(&s.mu)
    return s
}

func (s *Sem) Acquire() {
    s.mu.Lock()
    defer s.mu.Unlock()
    for s.n >= s.max {
        s.cond.Wait()
    }
    s.n++
}

func (s *Sem) Release() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.n--
    s.cond.Signal()
}
```

In production prefer `golang.org/x/sync/semaphore` or a buffered channel.

---

## Task 14 — Refactor a God-Lock

Given:

```go
type Service struct {
    mu       sync.Mutex
    sessions map[string]*Session
    cache    map[string][]byte
    metrics  Metrics
}
```

`mu` is held during every operation. The mutex profile shows it as the dominant bottleneck. Refactor into per-field locks; document the lock order.

**Solution:**

```go
type Service struct {
    sessionsMu sync.RWMutex
    sessions   map[string]*Session

    cacheMu sync.RWMutex
    cache   map[string][]byte

    metrics Metrics // uses atomics internally
}

// Lock order (top → bottom): sessionsMu < cacheMu
// metrics has no lock (atomics).
```

Update each method to take only the locks it needs. If a method needs both (rare), acquire `sessionsMu` first.

---

## Task 15 — Production-Style Test

Write a test that proves a concurrent stack is safe under load. Use `-race`. Make the test fail if goroutines are not properly synchronised.

**Solution:**

```go
type Stack struct {
    mu   sync.Mutex
    data []int
}

func (s *Stack) Push(v int) {
    s.mu.Lock(); defer s.mu.Unlock()
    s.data = append(s.data, v)
}

func (s *Stack) Pop() (int, bool) {
    s.mu.Lock(); defer s.mu.Unlock()
    if len(s.data) == 0 { return 0, false }
    v := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    return v, true
}

func TestStack(t *testing.T) {
    s := &Stack{}
    var wg sync.WaitGroup
    const N = 1000
    pushed := make(map[int]bool, N)
    var pmu sync.Mutex

    for i := 0; i < N; i++ {
        wg.Add(1)
        go func(v int) {
            defer wg.Done()
            s.Push(v)
            pmu.Lock(); pushed[v] = true; pmu.Unlock()
        }(i)
    }
    wg.Wait()

    seen := make(map[int]bool, N)
    for {
        v, ok := s.Pop()
        if !ok { break }
        if seen[v] {
            t.Fatalf("duplicate pop: %d", v)
        }
        seen[v] = true
    }
    for i := 0; i < N; i++ {
        if !seen[i] {
            t.Fatalf("missing: %d", i)
        }
    }
}
```

Run with `go test -race -run TestStack`. If you remove the mutex, the test fails with a data race report.

---

## Closing Notes

Most production mutex bugs are not exotic — they are missed `defer Unlock`s, value receivers on locked structs, or two locks acquired in inconsistent orders. The exercises above target these mistakes specifically. Once you've worked through them once, you're well past "knows what a mutex is" and approaching "knows when not to use one."
