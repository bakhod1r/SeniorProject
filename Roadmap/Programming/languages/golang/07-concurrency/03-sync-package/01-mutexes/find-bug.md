# Mutexes — Find the Bug

> Each snippet below contains a real, production-grade mutex bug: a copied lock, a missed `Unlock`, a recursive lock attempt, a wrong receiver type, a sneaky lock-ordering inversion, and the long tail of synchronisation footguns that keep on-call engineers awake. Read the code, find the bug, explain why it is a bug, then fix it. Every example compiles. Most of them only fail under the race detector or under load — which is exactly how they reach production.

---

## Bug 1 — Mutex passed by value

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {       // value receiver
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func main() {
    var c Counter
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); c.Inc() }()
    }
    wg.Wait()
    fmt.Println("counter:", c.n) // 0
}
```

**What's wrong?** `Inc` has a *value* receiver. Every call copies the entire `Counter`, including its `sync.Mutex`. Each goroutine locks its **own** copy of the mutex, mutates a copy of `n`, and the changes are thrown away when the method returns. The original `c.n` never moves. `go vet` will scream `Inc passes lock by value: Counter contains sync.Mutex`.

**Fix:** use a pointer receiver. `sync.Mutex` must never be copied after first use:

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

Run `go vet ./...` in CI. This bug is one of the most common Go concurrency mistakes and `vet` catches it for free.

---

## Bug 2 — Forgotten `Unlock` on the error path

```go
type Cache struct {
    mu sync.Mutex
    m  map[string][]byte
}

func (c *Cache) Load(key string) ([]byte, error) {
    c.mu.Lock()
    v, ok := c.m[key]
    if !ok {
        return nil, fmt.Errorf("missing %q", key) // BUG: still locked!
    }
    c.mu.Unlock()
    return v, nil
}
```

**What's wrong?** The error branch returns before reaching `c.mu.Unlock()`. The mutex stays locked forever. The next call to `Load` blocks; soon every goroutine touching the cache is parked on `c.mu`, and the program looks "frozen" with no panic and no log line. Live deadlock with no diagnostic.

**Fix:** use `defer` so `Unlock` runs no matter how the function exits — return, panic, branch, anything:

```go
func (c *Cache) Load(key string) ([]byte, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    v, ok := c.m[key]
    if !ok {
        return nil, fmt.Errorf("missing %q", key)
    }
    return v, nil
}
```

The cost of `defer` (a few nanoseconds) is negligible compared to a deadlock. Make `defer mu.Unlock()` muscle memory immediately after every `mu.Lock()`.

---

## Bug 3 — Lock-ordering deadlock between two mutexes

```go
type Account struct {
    mu      sync.Mutex
    balance int
}

func Transfer(from, to *Account, amount int) {
    from.mu.Lock()
    defer from.mu.Unlock()

    to.mu.Lock()
    defer to.mu.Unlock()

    from.balance -= amount
    to.balance += amount
}

// Two goroutines:
//   go Transfer(&a, &b, 10)
//   go Transfer(&b, &a, 10)
```

**What's wrong?** Goroutine 1 locks `a`, then waits for `b`. Goroutine 2 locks `b`, then waits for `a`. Classic lock-ordering deadlock — neither will ever proceed. In production this only fires when two transfers cross paths, so it might survive months of testing and trigger once a week under load.

**Fix:** establish a global lock order. The simplest stable order is to compare pointer addresses (or any other stable identity) and always lock the lower one first:

```go
func Transfer(from, to *Account, amount int) {
    first, second := from, to
    if uintptr(unsafe.Pointer(first)) > uintptr(unsafe.Pointer(second)) {
        first, second = second, first
    }
    first.mu.Lock()
    defer first.mu.Unlock()
    second.mu.Lock()
    defer second.mu.Unlock()

    from.balance -= amount
    to.balance += amount
}
```

For accounts identified by an `ID` field, prefer comparing IDs over pointer addresses (more readable, deterministic across runs). The point is: pick *one* order and use it everywhere.

---

## Bug 4 — Writer starvation under `RWMutex`

```go
type Stats struct {
    mu    sync.RWMutex
    hits  int
}

func (s *Stats) Hit() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.hits++
}

func (s *Stats) Read() int {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.hits
}

// Workload: 10,000 readers per second, 1 writer per second.
// In production: writer waits seconds, sometimes minutes.
```

**What's wrong?** Pre-Go 1.18, `RWMutex` could starve a writer indefinitely if readers kept arriving — the writer would block in `Lock()` and never get a turn. Even with the modern fairness fix, an `RWMutex` with overwhelmingly more readers than writers still favours readers; a writer trying to acquire the lock can stall noticeably under high read pressure. The deeper bug: `RWMutex` is being used to protect a single `int`, and the read path is so cheap that the lock itself becomes the bottleneck.

**Fix:** match the primitive to the workload. For a counter, use `sync/atomic`. The mutex is gone, so the starvation is gone:

```go
import "sync/atomic"

type Stats struct {
    hits atomic.Int64
}

func (s *Stats) Hit()      { s.hits.Add(1) }
func (s *Stats) Read() int64 { return s.hits.Load() }
```

If the protected state is genuinely complex (a map, a slice, a struct), keep `RWMutex` but make sure your reads are *long* enough that the read-locking overhead pays for itself. Profiling answers the question; intuition lies.

---

## Bug 5 — Read without a lock (data race)

```go
type Config struct {
    mu     sync.RWMutex
    values map[string]string
}

func (c *Config) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.values[k] = v
}

func (c *Config) Get(k string) string {
    return c.values[k] // BUG: no RLock
}
```

**What's wrong?** `Get` reads the map while `Set` may concurrently write to it. Even if it "looks atomic," map reads in Go are *not* safe alongside concurrent writes — the runtime can detect this and crash with `fatal error: concurrent map read and map write`, or, worse, return arbitrary garbage. `go run -race` flags this immediately.

**Fix:** acquire `RLock` for every read. Symmetry between reads and writes is non-negotiable — either *all* accesses go through the mutex, or *none* of them do:

```go
func (c *Config) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.values[k]
}
```

Run `go test -race ./...` in CI. The race detector will not catch every bug, but it catches this entire class of bug, and it costs you a few seconds of test time.

---

## Bug 6 — Recursive lock attempt (Go mutexes are not reentrant)

```go
type Service struct {
    mu sync.Mutex
}

func (s *Service) Outer() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.Inner() // BUG: same lock, same goroutine, deadlock
}

func (s *Service) Inner() {
    s.mu.Lock()
    defer s.mu.Unlock()
    // ...
}
```

**What's wrong?** Go's `sync.Mutex` is **non-reentrant**. The same goroutine that already holds the lock cannot acquire it again. `Outer` locks `s.mu`, calls `Inner`, which calls `s.mu.Lock()` and blocks forever — waiting for itself. The runtime *might* report `all goroutines are asleep - deadlock!` if every goroutine ends up parked, but if there is even one other live goroutine, the deadlock is silent and only this code path hangs.

**Fix:** split the API into a public, locking version and a private, lock-already-held version. Document it loudly:

```go
func (s *Service) Outer() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.innerLocked() // already holds s.mu
}

func (s *Service) Inner() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.innerLocked()
}

// innerLocked must be called with s.mu held.
func (s *Service) innerLocked() {
    // ...
}
```

If you find yourself wanting reentrancy, that is usually a sign the API is wrong, not that the language is wrong. Reentrancy hides bugs; this split makes the contract explicit.

---

## Bug 7 — Forgotten `defer` plus an early return

```go
func (q *Queue) Push(v int) error {
    q.mu.Lock()
    if len(q.items) >= q.cap {
        return errors.New("queue full") // BUG: still locked
    }
    q.items = append(q.items, v)
    q.mu.Unlock()
    return nil
}
```

**What's wrong?** Same shape as Bug 2, deserves its own entry because it shows up in code review constantly. The lock is acquired, an early return happens for the "queue full" case, and `Unlock` is never reached. Once a single `Push` hits the cap, the queue is permanently locked. Every subsequent `Push` and `Pop` blocks forever.

**Fix:** the moment you write `mu.Lock()`, write `defer mu.Unlock()` on the very next line. Make this a non-negotiable rule for code review:

```go
func (q *Queue) Push(v int) error {
    q.mu.Lock()
    defer q.mu.Unlock()
    if len(q.items) >= q.cap {
        return errors.New("queue full")
    }
    q.items = append(q.items, v)
    return nil
}
```

If the function is so hot that `defer`'s sub-microsecond overhead matters, that's a profiling discussion — but you must demonstrate the cost with a benchmark, not assume it.

---

## Bug 8 — Mutex on a value receiver where pointer is required

```go
type Buffer struct {
    mu   sync.Mutex
    data []byte
}

// value receiver: same family as Bug 1, but here the *intent* differs.
func (b Buffer) Write(p []byte) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.data = append(b.data, p...) // appends to the COPY
}

func main() {
    var b Buffer
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            b.Write([]byte{byte(i)})
        }(i)
    }
    wg.Wait()
    fmt.Println(len(b.data)) // 0 — surprising at first glance
}
```

**What's wrong?** Value receiver again, but here the bug is visible in two ways: the lock does nothing useful (each goroutine locks its own copy) **and** the mutation is invisible because `append` happens on the copy. The original `b.data` is never modified. There is no race because there is no *shared* memory — but the program is still wrong.

**Fix:** pointer receiver, always, for any struct that contains a mutex or has methods that mutate state:

```go
func (b *Buffer) Write(p []byte) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.data = append(b.data, p...)
}
```

A solid rule: *if a type has a mutex, every method on it takes a pointer receiver*. Mixing pointer and value receivers on a mutex-bearing type is asking for the copy bug.

---

## Bug 9 — Double `Unlock` panic

```go
func (s *Server) handle(req *Request) error {
    s.mu.Lock()
    err := s.process(req)
    s.mu.Unlock()
    if err != nil {
        s.mu.Unlock() // BUG: defensive Unlock on error path
        return err
    }
    return nil
}
```

**What's wrong?** The author thought they were being "defensive" by unlocking again on the error path. Calling `Unlock` on an already-unlocked mutex panics with `sync: unlock of unlocked mutex`. Worse, the panic happens far away from the real bug — readers of the trace see a panic in `handle` but the cause was a misunderstanding about who owns the lock.

**Fix:** one `Lock`, one `Unlock`, deferred. That way every code path runs `Unlock` exactly once and the structure is impossible to get wrong:

```go
func (s *Server) handle(req *Request) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.process(req)
}
```

If you ever feel the urge to "make sure it gets unlocked" by sprinkling `Unlock` calls, stop and rewrite the function with a single `defer`.

---

## Bug 10 — `TryLock` misuse: treating `false` as success

```go
func (c *Cache) UpdateIfFree(key string, v []byte) {
    if !c.mu.TryLock() {
        // BUG: silently skip the update on contention
        return
    }
    defer c.mu.Unlock()
    c.m[key] = v
}
```

**What's wrong?** `TryLock` returns `true` when the lock was acquired and `false` when it was not. The above code intends to skip the update when the lock is busy — but in practice, under load, *most* calls will return `false`, the cache will go stale, and the bug only surfaces as "writes occasionally don't land" with no error in the logs. `TryLock` should almost never be used in normal application code; it exists mainly for very specific lock-free constructions (cancellation, debug-time deadlock detection, certain rare scheduling primitives).

**Fix:** if you genuinely need a lock, use `Lock()`. If you are willing to skip work on contention, log it loudly so the silent dropping is visible in metrics:

```go
func (c *Cache) Update(key string, v []byte) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[key] = v
}

// If you really do want best-effort:
func (c *Cache) UpdateBestEffort(key string, v []byte) bool {
    if !c.mu.TryLock() {
        cacheUpdateSkipped.Inc() // metric, log, etc.
        return false
    }
    defer c.mu.Unlock()
    c.m[key] = v
    return true
}
```

The Go standard library docs explicitly warn that `TryLock` is rarely the right tool. Trust them.

---

## Bug 11 — Lock held across an expensive operation

```go
type Cache struct {
    mu sync.Mutex
    m  map[string][]byte
}

func (c *Cache) GetOrFetch(key string, fetch func() ([]byte, error)) ([]byte, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.m[key]; ok {
        return v, nil
    }
    v, err := fetch(key) // BUG: network call holding the lock
    if err != nil {
        return nil, err
    }
    c.m[key] = v
    return v, nil
}
```

**What's wrong?** `fetch` is expensive — a network round-trip, a database query, a disk read — and the mutex is held for the entire duration. Every other goroutine that wants the cache (even for an unrelated key) is blocked behind a single in-flight network request. Throughput collapses, latency tail explodes, and a slow downstream becomes a global outage. This is the *classic* hot-path contention bug.

**Fix:** drop the lock during the slow operation, then re-acquire to write the result. Use the double-check pattern to avoid duplicate fetches racing each other:

```go
func (c *Cache) GetOrFetch(key string, fetch func(string) ([]byte, error)) ([]byte, error) {
    c.mu.Lock()
    if v, ok := c.m[key]; ok {
        c.mu.Unlock()
        return v, nil
    }
    c.mu.Unlock()

    v, err := fetch(key) // outside the lock
    if err != nil {
        return nil, err
    }

    c.mu.Lock()
    defer c.mu.Unlock()
    if existing, ok := c.m[key]; ok {
        return existing, nil // someone else won the race
    }
    c.m[key] = v
    return v, nil
}
```

For the production-grade version of this pattern, use `golang.org/x/sync/singleflight` — it deduplicates concurrent fetches of the same key with one network call, not N. Either way, the rule is: **never hold a mutex across I/O.**

---

## Bug 12 — Sharing a `sync.Once` by value

```go
type Loader struct {
    once sync.Once
    cfg  *Config
}

func (l Loader) Get() *Config { // value receiver again
    l.once.Do(func() {
        l.cfg = loadFromDisk()
    })
    return l.cfg
}
```

**What's wrong?** Closely related to the copy-of-mutex bug. `sync.Once` (which contains a mutex internally) is being copied on every call because of the value receiver. Each copy has its own `done` flag, so `loadFromDisk` runs *every* time — defeating the entire point of `Once`. Also, `l.cfg = ...` assigns to the copy and is invisible to the caller.

**Fix:** pointer receiver, as always for any sync primitive:

```go
func (l *Loader) Get() *Config {
    l.once.Do(func() {
        l.cfg = loadFromDisk()
    })
    return l.cfg
}
```

`go vet` catches `sync.Once` copies the same way it catches `sync.Mutex` copies.

---

## Bug 13 — Locking a different mutex than you think

```go
type Bank struct {
    mu       sync.Mutex
    accounts map[int]*Account
}

type Account struct {
    mu      sync.Mutex
    balance int
}

func (b *Bank) Deposit(id, amount int) {
    b.mu.Lock()                  // BUG: bank lock, not account lock
    defer b.mu.Unlock()
    a := b.accounts[id]
    a.balance += amount
}
```

**What's wrong?** The bank-level mutex is held while an account is mutated, but other code paths might mutate `a.balance` while holding `a.mu` instead. Two different mutexes are now "protecting" the same field, and they don't know about each other. Result: a data race that the race detector will gleefully flag, but only when the two paths actually collide.

**Fix:** decide *which* mutex protects each field, and stick to it. Either:

```go
// Option A: only bank-level locking
func (b *Bank) Deposit(id, amount int) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.accounts[id].balance += amount
}
```

```go
// Option B: account-level locking (preferred for parallelism)
func (b *Bank) Deposit(id, amount int) {
    b.mu.Lock()
    a := b.accounts[id]
    b.mu.Unlock()

    a.mu.Lock()
    defer a.mu.Unlock()
    a.balance += amount
}
```

Document which lock guards which field directly above the field declaration: `// guarded by mu` next to each. That single-line comment prevents this bug entirely.

---

## Bug 14 — Returning the protected value with no copy

```go
type Registry struct {
    mu sync.Mutex
    m  map[string][]string
}

func (r *Registry) Tags(key string) []string {
    r.mu.Lock()
    defer r.mu.Unlock()
    return r.m[key] // BUG: caller mutates this slice, lock-free
}
```

**What's wrong?** The slice header returned to the caller still points at the same backing array that other goroutines mutate under the lock. The caller can read or write the slice without ever holding `r.mu`, racing with whoever holds the lock next. The lock looks correct *inside* `Tags`, but the value escapes the critical section by reference.

**Fix:** copy the slice before returning so the caller owns an independent buffer:

```go
func (r *Registry) Tags(key string) []string {
    r.mu.Lock()
    defer r.mu.Unlock()
    src := r.m[key]
    out := make([]string, len(src))
    copy(out, src)
    return out
}
```

Same applies to maps (`maps.Clone` since Go 1.21), pointers to internal structs, and channels you allow callers to write to. If a value is reachable from outside the lock, it has effectively escaped the lock.

---

## Bug 15 — Holding a lock while sending on a channel

```go
type Hub struct {
    mu       sync.Mutex
    clients  []chan Event
}

func (h *Hub) Broadcast(e Event) {
    h.mu.Lock()
    defer h.mu.Unlock()
    for _, c := range h.clients {
        c <- e // BUG: blocking send under lock
    }
}
```

**What's wrong?** If any client channel is full (or its receiver is slow), the send blocks. While `Broadcast` is blocked, no other goroutine can join, leave, or trigger another broadcast. One slow consumer freezes the entire hub. In production this looks like "the service stops emitting events" with no error.

**Fix:** copy the slice of channels under the lock, then send outside the lock. Optionally use a non-blocking send so a single misbehaving consumer doesn't block the whole hub:

```go
func (h *Hub) Broadcast(e Event) {
    h.mu.Lock()
    snapshot := make([]chan Event, len(h.clients))
    copy(snapshot, h.clients)
    h.mu.Unlock()

    for _, c := range snapshot {
        select {
        case c <- e:
        default:
            // drop or buffer; do not block the broadcaster
        }
    }
}
```

The rule from Bug 11 generalises: never hold a mutex across an operation that can block on something *you* don't control — I/O, channel sends, sleeps, RPCs, locks owned by callbacks.

---

## Bug 16 — Initialising a mutex when you didn't need to

```go
type Server struct {
    mu *sync.Mutex
}

func NewServer() *Server {
    return &Server{} // BUG: mu is nil
}

func (s *Server) Handle() {
    s.mu.Lock() // panic: nil pointer dereference
    defer s.mu.Unlock()
}
```

**What's wrong?** The author wrote `*sync.Mutex` (pointer to a mutex) instead of `sync.Mutex` (the mutex itself). The zero value of a pointer is `nil`; the zero value of `sync.Mutex` is a perfectly usable unlocked mutex. The first call to `Lock()` panics with a nil dereference.

**Fix:** embed `sync.Mutex` by value, never by pointer. There is essentially no reason to use `*sync.Mutex` in Go — the value type is already small and the zero value is ready to use:

```go
type Server struct {
    mu sync.Mutex // ready to use, no constructor needed
}
```

If you really do need to share a mutex between two structs (rare, suspicious), construct it explicitly:

```go
type Server struct {
    mu *sync.Mutex
}

func NewServer() *Server {
    return &Server{mu: &sync.Mutex{}}
}
```

But ask yourself first whether the design is right. Two structs sharing a lock often means they should be one struct.

---

## Bug 17 — Closure captures the wrong loop variable under the lock

```go
type Group struct {
    mu sync.Mutex
    m  map[int]int
}

func (g *Group) Init() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            g.mu.Lock()
            defer g.mu.Unlock()
            g.m[i] = i * i // BUG: captured i, not the loop value
        }()
    }
    wg.Wait()
}
```

**What's wrong?** Pre-Go 1.22, `i` is a single variable shared across iterations; by the time the goroutines run, `i` is `10`, so every goroutine writes `g.m[10] = 100` ten times. The mutex *is* working — there's no data race — but the program is still wrong. The lock made the code look safe, masking the real bug.

**Fix:** on Go 1.22+, the loop variable is per-iteration so the bug is gone. On earlier versions, capture `i` explicitly:

```go
for i := 0; i < 10; i++ {
    i := i // shadow
    go func() {
        // ...
        g.m[i] = i * i
    }()
}
```

The mutex protects against *races*, not against *logic bugs*. A correctly synchronised program can still be wrong.

---

## Bug 18 — `defer` inside a loop, mutex held until end of function

```go
func (s *Store) BatchUpdate(items []Item) {
    for _, it := range items {
        s.mu.Lock()
        defer s.mu.Unlock()  // BUG: defers stack up, only run at function exit
        s.m[it.Key] = it.Value
    }
}
```

**What's wrong?** Every iteration `Lock()`s, then schedules an `Unlock()` to run *when the function returns*, not at end of iteration. Iteration 1 locks; iteration 2 tries to lock — but iteration 1 hasn't unlocked yet. Self-deadlock on the second iteration. Even if it didn't deadlock, the deferred `Unlock` calls would all stack until the function finally returned, holding the lock across the entire batch.

**Fix:** scope the lock per iteration with an inline anonymous function, or just call `Unlock` directly:

```go
func (s *Store) BatchUpdate(items []Item) {
    for _, it := range items {
        func() {
            s.mu.Lock()
            defer s.mu.Unlock()
            s.m[it.Key] = it.Value
        }()
    }
}
```

Even better, lock once and update all of them inside one critical section if the work is small:

```go
func (s *Store) BatchUpdate(items []Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, it := range items {
        s.m[it.Key] = it.Value
    }
}
```

`defer` runs at *function* return, not block return. Always.

---

## Bug 19 — Atomic pointer swap "protected" by a mutex (it isn't)

```go
type Service struct {
    mu  sync.Mutex
    cur *Config
}

func (s *Service) Reload(new *Config) {
    s.mu.Lock()
    s.cur = new
    s.mu.Unlock()
}

func (s *Service) Use() *Config {
    return s.cur // BUG: read with no lock
}
```

**What's wrong?** Writes hold the lock; reads do not. A read may observe a torn pointer (on architectures where pointer writes are not atomic for the reader), or — more commonly — observe stale memory from before publication, missing fields the writer set. Even if the pointer assignment is atomic on your hardware, the Go memory model does not guarantee the reader sees `*new`'s initialised contents without synchronisation.

**Fix:** if the value is a pointer that is updated infrequently and read very often, use `atomic.Pointer[T]` instead of a mutex. It is purpose-built for "publish and read":

```go
import "sync/atomic"

type Service struct {
    cur atomic.Pointer[Config]
}

func (s *Service) Reload(new *Config) { s.cur.Store(new) }
func (s *Service) Use() *Config        { return s.cur.Load() }
```

Or, if you keep the mutex for the writer, also `RLock()` for the reader. **Never** mix "writer locks, reader doesn't" — that pattern is broken on every modern architecture under the Go memory model.

---

## Bug 20 — Lock leaked through a returned closure

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Locker() func() {
    c.mu.Lock()
    return func() {
        c.n++
        c.mu.Unlock() // BUG: caller may never call this
    }
}
```

**What's wrong?** The lock is acquired *inside* `Locker`, but unlock depends on the caller actually invoking the returned closure — and on doing so exactly once. If the caller forgets, panics, returns early, or stores the closure for later, the mutex is held indefinitely. The control flow of the lock has been smeared across an API boundary, and any future maintainer has to read both call sites to know the lock is balanced.

**Fix:** keep `Lock`/`Unlock` lexically paired in the same function. Pass *work* into the locked region rather than passing the lock out of it:

```go
func (c *Counter) Do(f func(*int)) {
    c.mu.Lock()
    defer c.mu.Unlock()
    f(&c.n)
}

// caller:
counter.Do(func(n *int) { *n++ })
```

This is sometimes called the "callback locking" or "scoped locking" pattern. The caller cannot forget to unlock because they never had access to the lock in the first place.

---

## Bug 21 — `RLock` upgraded to `Lock` mid-flight

```go
func (c *Cache) GetOrInit(key string) []byte {
    c.mu.RLock()
    if v, ok := c.m[key]; ok {
        c.mu.RUnlock()
        return v
    }
    // BUG: still holding RLock here, attempt to "upgrade"
    c.mu.Lock()
    defer c.mu.Unlock()
    v := compute(key)
    c.m[key] = v
    return v
}
```

**What's wrong?** `sync.RWMutex` does not support upgrading an `RLock` to a `Lock`. The code holds the read lock when it calls `Lock()` — and `Lock()` waits for all readers to release, including this very goroutine. Self-deadlock if no other goroutine wakes it up; if there are other readers, it just blocks longer. Even when the visible bug is "fixed" by sometimes unlocking the read first, you have a TOCTOU window: between releasing the read lock and acquiring the write lock, another goroutine may have already initialised the entry, and you'd compute it twice.

**Fix:** release the read lock, take the write lock, and *re-check* under the write lock (the standard double-checked pattern):

```go
func (c *Cache) GetOrInit(key string) []byte {
    c.mu.RLock()
    if v, ok := c.m[key]; ok {
        c.mu.RUnlock()
        return v
    }
    c.mu.RUnlock()

    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.m[key]; ok { // someone else may have initialised
        return v
    }
    v := compute(key)
    c.m[key] = v
    return v
}
```

For high-traffic deduplication of the *compute* step, prefer `singleflight`. The double-check pattern still benefits: cheap reads on the hot path, exclusive writes on the cold path.

---

## Bug 22 — Mutex contention reported as "slow disk"

```go
type Logger struct {
    mu sync.Mutex
    w  io.Writer
}

func (l *Logger) Write(line string) {
    l.mu.Lock()
    defer l.mu.Unlock()
    fmt.Fprintln(l.w, line) // syscall under lock
}

// 200 goroutines logging at ~10k lines/sec each.
// Latency spikes blamed on "slow disk."
```

**What's wrong?** Every log call serializes through `l.mu` and then performs a write syscall while holding the lock. With 200 goroutines, only one writes at a time; the rest queue up. Profiling shows enormous time in `runtime.semacquire` — that's the mutex queue, not the disk. The team replaces the SSD; nothing improves.

**Fix:** move the write outside the critical section by buffering, or by using a per-goroutine buffer that flushes asynchronously. For most logging, a channel-based asynchronous logger is the right structure:

```go
type Logger struct {
    ch chan string
}

func NewLogger(w io.Writer) *Logger {
    l := &Logger{ch: make(chan string, 4096)}
    go func() {
        bw := bufio.NewWriter(w)
        defer bw.Flush()
        for line := range l.ch {
            fmt.Fprintln(bw, line)
        }
    }()
    return l
}

func (l *Logger) Write(line string) { l.ch <- line }
```

Now there is no contention on a mutex, only on a channel, and the consumer batches writes to the underlying writer. Profile with `go test -mutexprofile=mu.out` to *prove* contention before redesigning — but once you see it, the solution is structural, not a tuning knob.

---

## Summary

Most production mutex bugs come from one of five sins:

1. **Copying the mutex** (value receiver, struct embedded by value, returning a struct that contains a mutex). `go vet` catches these — wire it into CI.
2. **Forgetting to unlock**, or unlocking in only some branches. The cure is unconditional: `defer mu.Unlock()` on the next line after `mu.Lock()`. Always.
3. **Holding the lock too long** — across I/O, channel sends, slow callbacks, or the entire batch of work. Critical sections should be small enough to read at a glance.
4. **Mixing locked and unlocked accesses** to the same field. If a field has a mutex, *every* access — read or write — goes through that mutex, or the program has a data race regardless of how the rest of the code looks.
5. **Reaching for `RWMutex`, `TryLock`, or recursion** before measuring. Each of these has narrow, justified uses and many tempting wrong uses. Reach for the simpler primitive first; reach for the advanced one only with a profile in hand.

Run `go vet` and `go test -race` on every PR. Profile mutex contention with `-mutexprofile` when in doubt. And remember: a mutex protects *memory*, not *correctness*. The lock can be perfect and the program can still be wrong.
