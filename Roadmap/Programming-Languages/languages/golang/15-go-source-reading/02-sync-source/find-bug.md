# sync — Find the Bug

## 1. How to use this file

Fourteen buggy snippets of `sync`-package code in Go: `Mutex`, `RWMutex`, `WaitGroup`, `Once`, `Pool`, `Map`, `Cond`, and `sync/atomic`. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer.

Sync bugs almost never produce a clean panic at the call site. They deadlock under a load you didn't reproduce, drop updates the race detector eventually catches, return early before goroutines finish, or quietly corrupt aligned state on a 32-bit ARM build nobody runs in CI. Three questions to ask every snippet:

1. *Who owns the lock/waitgroup/once, and can it be copied — by value receiver, by struct literal, by `append`?*
2. *What is the ordering between `Add`/`Done`/`Wait`, `Lock`/`Unlock`, `Get`/`Put` — and does any of them happen inside the goroutine instead of before it?*
3. *Does the primitive's contract (re-check condition, hold lock during `Wait`, alignment, retry-on-panic) match what the code actually does?*

If a snippet can't answer all three, there's a bug.

---

## Bug 1 — `sync.Mutex` copied by value receiver

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {           // BUG: value receiver
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

// caller
var c Counter
for i := 0; i < 1000; i++ {
    go c.Inc()
}
```

<details><summary>Answer</summary>

**Bug:** `Inc` has a value receiver, so each call copies the entire `Counter` — including the `sync.Mutex`. Each goroutine locks its own private `Mutex`, then mutates its own private `n`. The original `c.n` never changes; the lock provides zero mutual exclusion because there is no shared lock to begin with. `go vet` reports `Inc passes lock by value: Counter contains sync.Mutex`.

**Why subtle:** Compiles. Runs. Doesn't panic. Even `-race` may stay quiet — there's no race because the writes happen to disjoint memory. The bug surfaces only as "the counter is always zero after 1000 increments".

**Spot:** Any method on a struct embedding `sync.Mutex`/`sync.RWMutex`/`sync.WaitGroup`/`sync.Cond` with a value receiver. Also: passing such a struct to a function by value, assigning it (`a := b`), or putting it in a slice/map by value.

`src/sync/mutex.go` documents the contract:

> A Mutex must not be copied after first use.

The runtime detector for this lives in `cmd/vet/internal/cmd/vet/copylock.go` — `go vet` understands which types must not be copied via their `Lock()` method set.

**Fix:** Pointer receiver, always, for any type holding a sync primitive:

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

If the type must be passed by value (rare; usually an API mistake), embed a `*sync.Mutex` instead and document who owns it. The cleanest fix is to never embed a lock in a struct that will be copied.

**Why common:** Value receivers feel "more functional" and "immutable", and the Go FAQ encourages pointer receivers only when mutation or large structs are involved. `sync.Mutex` is small — eight bytes on 64-bit — so the size heuristic doesn't trigger. The mutation heuristic does, but it's invisible: the receiver itself doesn't *look* mutated. Pointer receiver every time for any struct with a lock.
</details>

---

## Bug 2 — `WaitGroup.Add(1)` inside the goroutine

```go
func processAll(items []Item) {
    var wg sync.WaitGroup
    for _, it := range items {
        go func(it Item) {
            wg.Add(1)            // BUG: Add inside goroutine
            defer wg.Done()
            process(it)
        }(it)
    }
    wg.Wait()
}
```

<details><summary>Answer</summary>

**Bug:** `wg.Add(1)` runs inside the goroutine, after the spawning loop has already enqueued every `go func` call. The main goroutine reaches `wg.Wait()` while the counter is still zero — `Wait` returns immediately because "zero goroutines outstanding" — and the function returns before any `process(it)` actually runs. If the scheduler races and one goroutine gets to `Add(1)` before `Wait` checks the counter, that single goroutine is waited on; the rest aren't. Result: silently dropped work, sometimes none, sometimes some.

**Why subtle:** No panic, no deadlock. The function returns "successfully". Tests with `wg.Wait` followed by reading a result count may pass on a slow machine where every goroutine wins the `Add`-vs-`Wait` race, and fail on the production box where it doesn't.

`src/sync/waitgroup.go` is unambiguous:

> Note that calls with a positive delta that occur when the counter is zero must happen before a Wait. Calls with a positive delta, or calls with a negative delta that start when the counter is greater than zero, may happen at any time.

In Go 1.4+, the runtime panics if `Add` is called concurrently with `Wait` and the counter transitions from zero — but only when the race is *detected*, which isn't guaranteed.

**Spot:** Any `wg.Add(1)` whose lexical position is inside a `go func` body. Or any `wg.Add(n)` *after* the loop that spawns the goroutines.

**Fix:** Add before spawn, always:

```go
for _, it := range items {
    wg.Add(1)
    go func(it Item) {
        defer wg.Done()
        process(it)
    }(it)
}
wg.Wait()
```

Or batch: `wg.Add(len(items))` once, outside the loop.

**Why common:** "Setup belongs at the top of the goroutine" reads like a clean rule. It is — except `Add` is *not* setup for the goroutine, it's a promise *to the caller* that a goroutine exists. That promise must be made before the caller can ask "are we done?", and the caller is the line that comes right after the `go` statement.
</details>

---

## Bug 3 — Forgotten `Done` on error path

```go
func fanOut(items []Item) error {
    var wg sync.WaitGroup
    errs := make(chan error, len(items))
    for _, it := range items {
        wg.Add(1)
        go func(it Item) {
            if it.Invalid() {
                errs <- fmt.Errorf("invalid: %v", it)
                return                       // BUG: forgot wg.Done()
            }
            defer wg.Done()
            process(it)
        }(it)
    }
    wg.Wait()                                // hangs forever if any item invalid
    close(errs)
    return collectErrors(errs)
}
```

<details><summary>Answer</summary>

**Bug:** The `defer wg.Done()` is registered *after* the early-return on `Invalid()`. Any invalid item exits without decrementing the counter. The `WaitGroup` counter never reaches zero, `wg.Wait()` blocks forever, the function never returns, and goroutines accumulate.

**Why subtle:** Happy-path tests pass — no invalid items, no skipped `Done`. The hang only happens on the rare-but-possible error branch. In production this looks like a goroutine leak ("why does this service slowly run out of memory after a bad input?") long after the bad input is gone.

**Spot:** Any `wg.Add(1)` whose matching `wg.Done()` is reached through some — but not all — code paths. The `defer wg.Done()` pattern fixes this by guaranteeing the decrement on every path, but it must be the *first* statement in the goroutine.

**Fix:** `defer wg.Done()` as the very first line:

```go
go func(it Item) {
    defer wg.Done()                          // first line; covers every return
    if it.Invalid() {
        errs <- fmt.Errorf("invalid: %v", it)
        return
    }
    process(it)
}(it)
```

`src/sync/waitgroup.go`'s `Done` is simply `wg.Add(-1)`; there's no magic, just an unbalanced counter when this rule is violated.

**Why common:** `defer wg.Done()` looks like "cleanup" and gets placed near the end of the function, after validation. Validation *can* fail, validation *can* `return`, and the defer hasn't registered yet. First line, always.
</details>

---

## Bug 4 — `RWMutex` read-to-write upgrade attempt

```go
type Cache struct {
    mu    sync.RWMutex
    items map[string]int
}

func (c *Cache) GetOrCompute(key string) int {
    c.mu.RLock()
    if v, ok := c.items[key]; ok {
        c.mu.RUnlock()
        return v
    }
    // miss: upgrade to write lock
    c.mu.Lock()                              // BUG: still holding RLock
    defer c.mu.Unlock()
    v := expensiveCompute(key)
    c.items[key] = v
    return v
}
```

<details><summary>Answer</summary>

**Bug:** The reader holds `RLock`. Then calls `Lock` while still holding it. `sync.RWMutex` does not support lock upgrade — `Lock` blocks until all readers release, but *this* reader hasn't released, so it blocks on itself. Two callers racing the same path deadlock against each other; a single caller deadlocks against itself.

`src/sync/rwmutex.go` documents:

> If a goroutine holds a RWMutex for reading and another goroutine might call Lock, no goroutine should expect to be able to acquire a read lock until the initial read lock is released. In particular, this prohibits recursive read locking.

The lock implementation uses a writer semaphore that `Lock` waits on after announcing intent via `writerSem`; that semaphore counts active readers, and the current goroutine *is* one of them. There's no "upgrade" primitive.

**Why subtle:** Single-threaded tests with a cache miss deadlock immediately and are caught. The trap is the *concurrent* case — under load, the same code path that worked single-threaded hangs because `Lock` waits for the reader (itself, plus others) to release.

**Spot:** Any code path inside an `RLock` block that calls `Lock` on the same mutex. Recursive `RLock` is also forbidden when a `Lock` is pending — a sleeping writer + a recursive reader is a deadlock by design (writer-preference prevents reader starvation).

**Fix:** Release the read lock, take the write lock, re-check (another goroutine may have computed it in the gap):

```go
func (c *Cache) GetOrCompute(key string) int {
    c.mu.RLock()
    if v, ok := c.items[key]; ok {
        c.mu.RUnlock()
        return v
    }
    c.mu.RUnlock()                           // release read lock first
    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.items[key]; ok {           // double-check after upgrade
        return v
    }
    v := expensiveCompute(key)
    c.items[key] = v
    return v
}
```

Or use `sync.Map.LoadOrStore`, or `singleflight.Group.Do` if `expensiveCompute` should be deduplicated. The double-checked `Lock` pattern is the orthodox `RWMutex` answer.

**Why common:** "Upgrade" feels like it should exist; databases have it. `sync.RWMutex` deliberately doesn't, because supporting it requires either deadlock-prone behaviour or starvation-prone behaviour. Go picked "no upgrade" — the cost is an extra unlock/relock and the double-check.
</details>

---

## Bug 5 — `sync.Once.Do` whose function panics

```go
var once sync.Once
var conn *sql.DB

func DB() *sql.DB {
    once.Do(func() {
        var err error
        conn, err = sql.Open("postgres", os.Getenv("DSN"))
        if err != nil {
            panic(err)                       // BUG: panic inside Once.Do
        }
        if err := conn.Ping(); err != nil {
            panic(err)
        }
    })
    return conn
}
```

<details><summary>Answer</summary>

**Bug:** `sync.Once` marks itself "done" *before* the function returns — specifically, after the function returns *or panics*. The next call to `once.Do` will not retry. So if the first call panics (DSN env var missing, DB down at startup), every subsequent caller gets the *same* uninitialised `conn` (nil) and no retry. The panic propagates once and is gone; from then on, callers see "nil pointer" on `conn.Query`.

`src/sync/once.go`:

```go
func (o *Once) Do(f func()) {
    if o.done.Load() == 0 {
        o.doSlow(f)
    }
}
func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done.Load() == 0 {
        defer o.done.Store(1)                // marks done even on panic
        f()
    }
}
```

The `defer o.done.Store(1)` runs whether `f()` returns normally *or* panics. This is intentional — "exactly once" means "the function ran once", not "the function succeeded once". The package doc says:

> If f panics, Do considers it to have returned; future calls of Do return without calling f.

**Why subtle:** First caller sees a clear panic and a stack trace. Second caller sees a nil DB and a generic "invalid memory address" panic far from the root cause. The two failures look unrelated.

**Spot:** Any `Once.Do(f)` where `f` can fail and the result is consumed elsewhere. Especially DB connections, lazy config loaders, plugin initialisers.

**Fix:** Either make `f` infallible (retry inside until success, with backoff), or use a custom once-with-retry. The canonical retry pattern stores the error and exposes it:

```go
var (
    once  sync.Once
    db    *sql.DB
    initErr error
)

func DB() (*sql.DB, error) {
    once.Do(func() {
        db, initErr = sql.Open("postgres", os.Getenv("DSN"))
        if initErr == nil {
            initErr = db.Ping()
        }
    })
    return db, initErr
}
```

Callers see the *real* error on every call, not a stale nil. If retry on the next call is desired, use a sentinel (`atomic.Bool` reset on failure) — `sync.Once` is deliberately not that.

**Why common:** `Once.Do` reads as "lazy init"; lazy init "should" retry on failure in many languages. Go's `Once` is `exactly-once-attempt`, not `exactly-once-success`. The distinction matters when `f` can panic.
</details>

---

## Bug 6 — `sync.Pool` storing stateful objects

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render(data Data) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)                   // BUG: not reset on Put
    buf.WriteString(data.Header)
    buf.WriteString(data.Body)
    return buf.String()
}
```

<details><summary>Answer</summary>

**Bug:** `bytes.Buffer` is stateful — `WriteString` appends to its internal slice. After `render` returns, `buf` is returned to the pool *with its contents intact*. The next `Get` hands the dirty buffer to a new caller, whose `WriteString` appends *after* the previous caller's bytes. The output of caller B is "caller-A-content" + "caller-B-content".

**Why subtle:** Under load you get state bleed between unrelated requests — caller B's response leaks caller A's data. Single-request tests pass perfectly (each starts with a fresh `New`-allocated buffer). The bug only appears once `Put` has happened and `Get` returns a recycled buffer.

`src/sync/pool.go` is explicit about who owns reset:

> Any item stored in the Pool may be removed automatically at any time without notification. If the Pool holds the only reference when this happens, the item might be deallocated.

> An appropriate use of a Pool is to manage a group of temporary items silently shared among and potentially reused by concurrent independent clients of a package. Pool provides a way to amortize allocation overhead across many clients.

It doesn't reset anything — that's the caller's job, because only the caller knows what "reset" means.

**Spot:** Any `Pool.Put(x)` where `x` carries state from its just-finished use. Buffers, gob encoders, http requests, JSON decoders — every "reusable scratch object" with internal state.

**Fix:** Reset on `Put` (or on `Get` — both work; pick one and document):

```go
func render(data Data) string {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()                              // clear before use
    defer bufPool.Put(buf)
    buf.WriteString(data.Header)
    buf.WriteString(data.Body)
    return buf.String()
}
```

If the buffer is huge (Get returned a 10MB buffer for a 100-byte job), also drop it instead of returning — most pool wrappers cap the returned size to avoid pinning large allocations forever. `fmt`'s `pp` pool, in `src/fmt/print.go`, does exactly this:

```go
func (p *pp) free() {
    if cap(p.buf) > 64<<10 { return }
    p.buf = p.buf[:0]
    ppFree.Put(p)
}
```

**Why common:** `sync.Pool` markets itself as "free allocation". The hidden cost is that you must own the reset/cleanup discipline — the pool is just a parking lot, not a janitor.
</details>

---

## Bug 7 — `sync.Map` used for write-heavy workload

```go
var counts sync.Map

func record(key string) {
    for {
        v, _ := counts.LoadOrStore(key, int64(1))
        old := v.(int64)
        if counts.CompareAndSwap(key, old, old+1) {
            return
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** `sync.Map` is optimised for two specific access patterns documented in `src/sync/map.go`:

> The Map type is optimized for two common use cases: (1) when the entry for a given key is only ever written once but read many times, as in caches that only grow, or (2) when multiple goroutines read, write, and overwrite entries for disjoint sets of keys.

The code above is neither. It's a global counter being written by every caller — high contention on a single key, with a CAS retry loop. `sync.Map` internally has a read-only `atomic.Value` map plus a `dirty` map guarded by a `Mutex`; under write contention every operation touches the dirty map under the lock. The CAS loop spins, and `sync.Map` adds tracking overhead that a plain `map[string]int64` with one `sync.Mutex` does not.

Benchmarks routinely show `sync.Map` is *slower* than `mutex + map` for write-heavy workloads — often 2-5x slower. The naïve "sync.Map is the concurrent map" intuition is wrong; it's a *specialised* concurrent map for read-heavy or disjoint-key workloads.

**Why subtle:** Code compiles, runs, gets the right answer. Profiles show high CPU in `sync.Map` internals, but that's only obvious if you compare against a mutex+map baseline. Most teams reach for `sync.Map` and never benchmark.

**Spot:** Any `sync.Map` whose primary operation is `Store`/`CompareAndSwap`/`Delete` across overlapping keys from many goroutines. Counters, write-through caches, anything that increments shared state.

**Fix:** Plain `map` behind a `sync.Mutex` (or `sync.RWMutex` if reads dominate):

```go
type Counters struct {
    mu sync.Mutex
    m  map[string]int64
}

func (c *Counters) Inc(key string) {
    c.mu.Lock()
    c.m[key]++
    c.mu.Unlock()
}
```

For hot-key counters specifically, sharded maps (`sync.Map` per shard hash, or a fixed array of `mutex+map`) outperform both — the contention moves off the single lock.

**Why common:** `sync.Map`'s name suggests "the obvious thread-safe map". The standard library's actual stance is "use it for these two patterns and benchmark if you're not sure" — most teams skip both.
</details>

---

## Bug 8 — `Cond.Wait` without holding the locker

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

func (q *Queue) Pop() Item {
    if len(q.items) == 0 {
        q.cond.Wait()                        // BUG: not holding q.mu
    }
    it := q.items[0]
    q.items = q.items[1:]
    return it
}
```

<details><summary>Answer</summary>

**Bug:** `sync.Cond.Wait` requires the associated Locker to be held by the caller. The implementation atomically (1) releases the lock and (2) suspends the goroutine, then re-acquires the lock on wake. If the lock isn't held when `Wait` is called, `Unlock` inside `Wait` panics with `sync: unlock of unlocked mutex`.

`src/sync/cond.go`:

```go
func (c *Cond) Wait() {
    c.checker.check()
    t := runtime_notifyListAdd(&c.notify)
    c.L.Unlock()                             // panics if not held
    runtime_notifyListWait(&c.notify, t)
    c.L.Lock()
}
```

The package doc:

> Because c.L is not locked while Wait is waiting, the caller typically cannot assume that the condition is true when Wait returns. Instead, the caller should Wait in a loop.

**Why subtle:** The panic is loud and clear once it triggers, but the snippet looks plausible — `cond` is constructed with `&q.mu`, so visually it "owns" the mutex. The contract that callers must lock it themselves before `Wait` is documented but easy to miss.

**Spot:** Any `cond.Wait()` call not lexically inside a `Lock`/`Unlock` pair on the cond's Locker. Same for `Broadcast`/`Signal` — those don't *require* the lock, but the receiver must hold it on wake, so the typical pattern locks around signal too.

**Fix:** Lock, loop-and-wait, do the work, unlock:

```go
func (q *Queue) Pop() Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.cond.Wait()                        // releases & reacquires q.mu
    }
    it := q.items[0]
    q.items = q.items[1:]
    return it
}

func (q *Queue) Push(it Item) {
    q.mu.Lock()
    q.items = append(q.items, it)
    q.cond.Signal()
    q.mu.Unlock()
}
```

For modern Go, prefer a channel-based queue — `sync.Cond` is rarely the right tool for queues; it's for *broadcast wakeup on condition change*. Channels handle "wait for next item" more idiomatically.

**Why common:** `sync.Cond` is the least-used `sync` primitive; people read the docs once and copy-paste. Forgetting which side holds the lock is the first bug everyone writes.
</details>

---

## Bug 9 — `Cond.Wait` without re-checking the condition

```go
func (q *Queue) Pop() Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    if len(q.items) == 0 {                   // BUG: if instead of for
        q.cond.Wait()
    }
    it := q.items[0]                         // panics: items still empty
    q.items = q.items[1:]
    return it
}
```

<details><summary>Answer</summary>

**Bug:** After `Wait` returns, the condition may *not* be true. Reasons: (1) spurious wakeups; (2) `Broadcast` woke many waiters but only one took the item; (3) another waiter grabbed the only item between `Signal` and this goroutine reacquiring the lock. The `if` checks once and trusts the wake; the correct form is `for`, which re-checks on every wake.

`src/sync/cond.go` makes the contract explicit in the doc comment on `Wait`:

> Because c.L is not locked while Wait is waiting, the caller typically cannot assume that the condition is true when Wait returns. Instead, the caller should Wait in a loop.

This isn't a Go quirk — it's pthread-condition-variable orthodoxy, going back decades. POSIX says the same; every textbook on cond vars says the same.

**Why subtle:** Single-producer/single-consumer tests almost never trigger it. Multi-consumer tests with `Broadcast` trigger it reliably — multiple goroutines wake, the first wins the item, the rest fall through and panic on `q.items[0]`. The fix is one character (`if` → `for`), but the bug is invisible to anyone who hasn't seen it before.

**Spot:** Any `cond.Wait()` lexically inside an `if`. Should always be inside a `for`.

**Fix:**

```go
for len(q.items) == 0 {
    q.cond.Wait()
}
```

Even if you're sure your wakeups are 1:1 with items, the `for` costs nothing and defends against future maintainers calling `Broadcast` instead of `Signal`.

**Why common:** `if` reads naturally — "if empty, wait; once we wake, we have an item". The hidden assumption is that wake = item, which is only true under tight invariants the cond-var contract doesn't promise.
</details>

---

## Bug 10 — `atomic.Int64` field misaligned on 32-bit ARM

```go
type Stats struct {
    name    string                           // 16 bytes on 64-bit, 8 on 32-bit
    enabled bool                             // 1 byte + 3 bytes pad on 32-bit
    count   int64                            // BUG: not 8-byte aligned on 32-bit
}

func (s *Stats) Inc() {
    atomic.AddInt64(&s.count, 1)             // crashes on 32-bit ARM, x86, MIPS
}
```

<details><summary>Answer</summary>

**Bug:** On 32-bit architectures, the Go compiler guarantees 4-byte alignment for struct fields but *not* 8-byte alignment unless the type is `int64`/`uint64` *and* it's at offset 0 of an allocated value (or its containing struct's first field). With `name string` (8 bytes on 32-bit) followed by `bool` (1 byte) + 3 bytes pad, `count` lands at offset 12 — 4-byte aligned, not 8. Any `atomic.AddInt64`/`LoadInt64`/etc on a misaligned 8-byte value crashes on ARM with a SIGBUS or panics in the runtime.

`src/sync/atomic/doc.go`:

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically. The first word in a variable or in an allocated struct, array, or slice can be relied upon to be 64-bit aligned.

**Why subtle:** Every 64-bit machine runs it fine. CI on amd64 is green. The bug surfaces only on 32-bit ARM (Raspberry Pi, some embedded, some Android NDK builds) or 32-bit x86. Many teams never build for those targets and ship the bug for years before someone files an issue from an embedded deployment.

`atomic.Int64` (the typed variant added in Go 1.19, defined in `src/sync/atomic/type.go`) has alignment hints — but the struct *containing* `atomic.Int64` still needs the field at an 8-byte-aligned offset. The type alone doesn't fix struct layout.

**Spot:** Any 64-bit atomic field (`int64`, `uint64`, `atomic.Int64`, `atomic.Uint64`) in a struct that *might* be built for 32-bit. Especially when it isn't the first field.

**Fix:** Put the 64-bit atomic *first* in the struct:

```go
type Stats struct {
    count   int64                            // first → guaranteed 8-byte aligned
    name    string
    enabled bool
}
```

Or use the typed `atomic.Int64` *and* put it first, which gives both compile-time API safety and alignment. The `go vet -checkalign` check (and `golang.org/x/tools/go/analysis/passes/structalign`) catches misalignment at build time.

The Go standard library itself has been bitten by this — there are historical commits in `runtime`, `expvar`, and `sync` moving 64-bit fields to the top of structs explicitly for this reason.

**Why common:** Most developers never test on 32-bit ARM. The constraint is documented but old, predating the typed atomics, and looks like an arcane footnote. It becomes a load-bearing footnote the moment your binary lands on a 32-bit target.
</details>

---

## Bug 11 — `defer m.Unlock()` after a conditional `Lock`

```go
func (s *Service) Process(req Request) error {
    if req.Priority < 0 {
        return errors.New("invalid priority")
    }
    s.mu.Lock()
    defer s.mu.Unlock()
    if req.Priority > 10 {
        s.mu.Unlock()                        // BUG: explicit Unlock then defer Unlocks again
        return s.processHighPriority(req)
    }
    return s.processNormal(req)
}
```

<details><summary>Answer</summary>

**Bug:** `defer s.mu.Unlock()` is registered after `Lock`. The conditional branch calls `s.mu.Unlock()` explicitly and returns. The deferred `Unlock` then fires on function exit — unlocking an already-unlocked mutex, which panics with `sync: unlock of unlocked mutex`.

`src/sync/mutex.go`:

```go
func (m *Mutex) Unlock() {
    new := atomic.AddInt32(&m.state, -mutexLocked)
    if new&mutexLocked == 0 {
        m.unlockSlow(new)
    }
}

func (m *Mutex) unlockSlow(new int32) {
    if (new+mutexLocked)&mutexLocked == 0 {
        fatal("sync: unlock of unlocked mutex")
    }
    // ...
}
```

There's no "is locked?" check — `Unlock` is a fast atomic that crashes the program (not just panics: `runtime.fatal`, uncatchable) if the count goes wrong.

**Why subtle:** The high-priority branch is the uncommon path. Normal-priority traffic runs cleanly forever. The first high-priority request crashes the process. No `recover` saves it — `fatal` is hard-kill.

**Spot:** Any function with both a `defer m.Unlock()` and an explicit `m.Unlock()` in a branch. Same anti-pattern with `defer wg.Done()` plus an explicit `wg.Done()`. Pick one discipline per function.

**Fix:** Use the defer; don't unlock explicitly. Restructure so the lock is released by exactly one path:

```go
func (s *Service) Process(req Request) error {
    if req.Priority < 0 {
        return errors.New("invalid priority")
    }
    s.mu.Lock()
    defer s.mu.Unlock()
    if req.Priority > 10 {
        return s.processHighPriority(req)    // defer handles unlock
    }
    return s.processNormal(req)
}
```

Or, if `processHighPriority` really *cannot* run under the lock (it makes a network call, or it would deadlock on a re-entry), don't take the lock in that branch at all — restructure the function so the branch with no lock is taken before `Lock`:

```go
func (s *Service) Process(req Request) error {
    if req.Priority > 10 {
        return s.processHighPriority(req)
    }
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.processNormal(req)
}
```

**Why common:** Refactor history. Someone adds an early-exit branch and copies the `m.Unlock()` to "be safe" without noticing the `defer` will fire anyway. Code review skims past it.
</details>

---

## Bug 12 — `WaitGroup` reused before `Wait` returned

```go
func batchProcess(batches [][]Item) {
    var wg sync.WaitGroup
    for _, batch := range batches {
        wg.Add(len(batch))
        for _, it := range batch {
            go func(it Item) {
                defer wg.Done()
                process(it)
            }(it)
        }
        wg.Wait()                            // wait this batch
    }                                        // BUG: Add for next batch races with previous Wait
}
```

<details><summary>Answer</summary>

**Bug:** This particular shape *can* be correct (`Wait` returns before the next `Add`), but the pattern is fragile. The real bug shows up when someone moves `Wait` outside the inner block, or fans the next batch out before checking, or starts the next batch's `Add` from a different goroutine. `sync.WaitGroup` docs in `src/sync/waitgroup.go`:

> Note that calls with a positive delta that start when the counter is greater than zero, may happen at any time. Typically this means the calls to Add should execute before the statement creating the goroutine or other event to be waited for. If a WaitGroup is reused to wait for several independent sets of events, new Add calls must happen after all previous Wait calls have returned.

The race detector enforces this: if `Add(positive)` happens concurrently with `Wait`, or if `Add` raises the counter from zero while another goroutine is in `Wait`, the runtime panics with:

> sync: WaitGroup misuse: Add called concurrently with Wait

In the loop above, the *intended* order is `Add → goroutines → Wait → Add → ...`, but if `process` is sometimes synchronous (returns immediately, calls `Done` before the goroutine fully starts the next iteration), the `Wait` of iteration *N* may still be returning when iteration *N+1*'s `Add` fires. Under contention this trips the misuse detector.

**Why subtle:** Works "most of the time" with slow workers. Fails under load with fast workers — the exact opposite of what most stress tests verify (slow workers + many goroutines). Hard to reproduce locally; trivial to hit in production.

**Spot:** Any `WaitGroup` reused across iterations or phases of a function. Any `Add` called from a goroutine spawned by a previous `Add`/`Done` cycle. The safe pattern: one `WaitGroup` per *complete* fan-out/fan-in cycle.

**Fix:** New `WaitGroup` per batch:

```go
for _, batch := range batches {
    var wg sync.WaitGroup
    wg.Add(len(batch))
    for _, it := range batch {
        go func(it Item) {
            defer wg.Done()
            process(it)
        }(it)
    }
    wg.Wait()
}
```

Allocating a `WaitGroup` per batch is free (it's three `int64` fields). Or use `errgroup.Group` whose `Wait` is single-shot and clearly delineated.

**Why common:** "Reuse the variable" feels like good style. For `WaitGroup` it's a footgun — the reuse contract requires `Wait` to have fully returned before any new `Add`, which is easy to violate as the function grows.
</details>

---

## Bug 13 — `sync.Pool` Get without matching Put

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render(data Data) string {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    buf.WriteString(data.Header)
    buf.WriteString(data.Body)
    return buf.String()                      // BUG: forgot bufPool.Put(buf)
}
```

<details><summary>Answer</summary>

**Bug:** Every call to `render` does `bufPool.Get()` and never returns the buffer. Each Get either reuses a parked buffer or calls `New` to allocate a fresh one. Without `Put`, the pool is never repopulated; every Get falls through to `New`. The pool degenerates into "every call allocates", same as `new(bytes.Buffer)` directly — except slower (atomic check on the per-P pool first) and with extra GC pressure (the buffers escape to the heap because they cross the pool boundary).

`src/sync/pool.go`:

> Each per-P Pool consists of a private pool (only the local P can access) and a shared pool (other Ps can steal from it). When Get is called, it first checks the private pool, then the shared pool, then calls New.

No `Put` means the per-P pool is always empty on Get.

**Why subtle:** Functionally correct — every caller gets a usable buffer. Performance bug only: allocation profile shows `bytes.Buffer` allocations equal to call count, which "should" be amortised by the pool but isn't. Discoverable only via `pprof` allocs.

**Spot:** Any `Pool.Get` whose function body doesn't end with a matching `Pool.Put` (or `defer Pool.Put`). Code review checklist item: every Get pairs with a Put on every exit path.

**Fix:** `defer Put`:

```go
func render(data Data) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.WriteString(data.Header)
    buf.WriteString(data.Body)
    return buf.String()
}
```

Watch out: the value the function returns must not alias `buf`'s storage (`buf.Bytes()` returns the internal slice — if you return that slice and `Put` the buffer, the next caller corrupts your data). `buf.String()` copies, so it's safe.

**Why common:** Refactoring removes the `Put` "while restructuring" and tests still pass. The cost is invisible until a profile reveals it.
</details>

---

## Bug 14 — `sync.Map.Range` and concurrent writes

```go
var m sync.Map

func observer() {
    for {
        time.Sleep(time.Second)
        m.Range(func(k, v any) bool {
            log.Printf("%v=%v", k, v)
            return true
        })
    }
}

func writer() {
    for i := 0; ; i++ {
        m.Store(fmt.Sprintf("key-%d", i), i)
        if i%10 == 0 {
            m.Range(func(k, v any) bool {
                if k.(string) == "key-0" {
                    log.Println("still see key-0")   // BUG: not guaranteed
                }
                return true
            })
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** `sync.Map.Range` does *not* guarantee a consistent snapshot, nor does it guarantee to see writes that happened-before the Range call. It iterates the "read-only" map (an `atomic.Value` snapshot) plus, in some cases, promotes the dirty map; if a key was `Store`d after the last promotion, `Range` may not see it.

`src/sync/map.go`:

> Range does not necessarily correspond to any consistent snapshot of the Map's contents: no key will be visited more than once, but if the value for any key is stored or deleted concurrently (including by f), Range may reflect any mapping for that key from any point during the Range call. Range does not block other methods on the receiver; even f itself may call any method on m.

That last point is intentional — `Range` is non-blocking by design, so it can't lock writers out, and the cost is that recent writes are not guaranteed visible.

**Why subtle:** Looks like a correctness bug ("I just stored it, why isn't it there?"). It's a documented relaxation, not a bug in `sync.Map`. Tests that race a store with a Range will see intermittent miss patterns.

**Spot:** Any code that uses `sync.Map.Range` to verify a `Store` "took effect", or to compute a consistent count/aggregation. Both assume snapshot semantics `sync.Map` doesn't provide.

**Fix:** Pick the right tool for what's needed:

- If you need a snapshot: use `map[K]V` behind a `sync.RWMutex`, take `RLock`, copy keys/values out, release, iterate the copy. Snapshot is consistent at the moment of the lock.
- If you need "happened-before" reads of specific keys: use `Load`/`LoadOrStore` on the key, not `Range`.
- If `Range` is genuinely the right primitive (e.g., periodic logging where missing one recent entry is fine): document the relaxation at the call site.

```go
type Map[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
}

func (m *Map[K, V]) Snapshot() map[K]V {
    m.mu.RLock()
    defer m.mu.RUnlock()
    out := make(map[K]V, len(m.m))
    for k, v := range m.m {
        out[k] = v
    }
    return out
}
```

**Why common:** `sync.Map`'s `Range` *looks* like `map`'s for-range. They behave differently; one is single-threaded with snapshot-of-that-moment semantics, the other is concurrent with deliberately relaxed semantics for performance. The same syntax for both invites the wrong assumption.
</details>

---

## Summary

These bugs cluster into four families.

**Lock discipline (1, 4, 8, 11):** `Mutex` copied by value receiver, `RWMutex` upgrade deadlock, `Cond.Wait` without the locker held, `defer Unlock` racing an explicit `Unlock`. Locks are tied to memory locations; copy or reorder them and the mutual exclusion they promised disappears or panics. Pointer receiver, no upgrades, hold the locker around `Wait`, one unlock per lock.

**Goroutine lifecycle (2, 3, 12):** `WaitGroup.Add` inside the goroutine, `Done` skipped on early-return, reusing a `WaitGroup` mid-flight. The counter is the synchronization; the rule is `Add` before spawn, `defer Done` as the first line, fresh `WaitGroup` per fan-out cycle. Violating any of these silently drops work, hangs forever, or panics under load.

**Pool and Map semantics (6, 7, 13, 14):** stateful objects returned to the pool dirty, `sync.Map` chosen for write-heavy workloads, Get without Put, Range seen as a consistent snapshot. Both `sync.Pool` and `sync.Map` are *specialized* primitives — read the docs, benchmark, and match the access pattern to the design.

**Quiet correctness traps (5, 9, 10):** `Once.Do` not retrying on panic, `Cond.Wait` without a re-check loop, 64-bit atomic misaligned on 32-bit ARM. These are documented contracts that fail silently outside their happy path — wrong DB returned forever, panic on second consumer, SIGBUS on a Raspberry Pi. Reading `sync` source pays for itself the first time one of these crosses your CI.

Review checklist for any PR touching `sync`/`sync/atomic`:

- [ ] Does every method on a type embedding a sync primitive use a pointer receiver, and does `go vet` (with copylock) pass?
- [ ] Is every `wg.Add(n)` placed *before* the `go` statement, and is `defer wg.Done()` the first line of every goroutine?
- [ ] Is each `WaitGroup`/`Once`/`Mutex` used for exactly one purpose and not reused across phases or recycled before `Wait` returns?
- [ ] On `RWMutex`, is there no path that holds `RLock` and then calls `Lock`? Is `Cond.Wait` always inside a `for` loop *and* called with the locker held?
- [ ] Does `Once.Do(f)` handle the panic-then-stale-result case (typed error returned, or infallible `f`)?
- [ ] For every `Pool.Get`, is there a matching `Put` on every exit path, and is state reset on `Get` or `Put`?
- [ ] Is `sync.Map` chosen only for read-mostly or disjoint-key workloads, and never used with `Range` as a "snapshot" of recent writes?
- [ ] Are all 64-bit atomics either typed (`atomic.Int64`) and placed as the first struct field, or otherwise guaranteed 8-byte aligned for 32-bit ARM/386 builds?
- [ ] Is every `Lock`/`Unlock` pair structured so exactly one unlock fires on each exit path — either all `defer` or none, never both?
