# Futures & Promises — Find the Bug

## 1. How to use this file

Fifteen buggy snippets of Futures, Promises, `errgroup`, `singleflight`, and `context`-bound concurrency. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer. Every bug here has been seen in real Go production code.

Future bugs almost never crash on the happy path. They leak one goroutine per request, double-close a `done` channel under load, or silently drop the cancellation signal halfway down a context chain. The skill is asking three questions on every snippet:

1. *Who owns the producer goroutine, and what makes it return?*
2. *Who closes the result channel, and how many times can it close?*
3. *What happens if the consumer gives up before the producer finishes?*

If a snippet can't answer all three, there's a bug.

---

## Bug 1 — Unbuffered result channel + no consumer

```go
func FetchUser(ctx context.Context, id string) <-chan User {
    out := make(chan User)                      // UNBUFFERED
    go func() {
        u, _ := db.Get(ctx, id)
        out <- u                                // blocks until someone receives
    }()
    return out
}

func handler(ctx context.Context) {
    fch := FetchUser(ctx, "alice")
    if shouldShortCircuit(ctx) {
        return                                  // never reads from fch
    }
    use(<-fch)
}
```

<details><summary>Answer</summary>

**Bug:** `out` is unbuffered. The producer goroutine blocks on `out <- u` forever if nobody reads. The handler may return early on `shouldShortCircuit` without ever receiving — that branch leaks one goroutine and one channel per invocation. Under load you accrue thousands of parked goroutines, each pinning a `User` allocation.

**Why subtle:** The producer goroutine has all the right shape — uses `ctx`, fetches the value, sends one result. The leak only triggers on the early-return path, which probably isn't covered by tests.

**Spot:** Any `<-chan T` future built on `make(chan T)` (no capacity) where the consumer has a conditional path that may skip the receive.

**Fix:** Buffer by 1 (`make(chan User, 1)`) or wrap the send in `select { case out <- u: case <-ctx.Done(): }`. The buffered form is the idiom for one-shot futures.

**Why common:** "Unbuffered channels are idiomatic" gets remembered from the synchronization context. For a one-shot result channel the synchronization is built in, so unbuffered just adds a footgun on the early-return path.
</details>

---

## Bug 2 — Double close from Resolve then Reject without `sync.Once`

```go
type Future[T any] struct {
    done chan struct{}
    val  T
    err  error
}

func (f *Future[T]) Resolve(v T) {
    f.val = v
    close(f.done)
}

func (f *Future[T]) Reject(err error) {
    f.err = err
    close(f.done)
}

func produce(f *Future[int]) {
    v, err := compute()
    if err != nil { f.Reject(err); return }
    f.Resolve(v)
    if needsRevision() { f.Reject(errors.New("stale")) } // BUG
}
```

<details><summary>Answer</summary>

**Bug:** No `sync.Once`. Any path that calls `Resolve` then `Reject` (or two goroutines racing to resolve) closes `done` twice. Closing an already-closed channel panics with `close of closed channel`. The same shape appears if a primary and a fallback both think they're "the one".

**Why subtle:** The `produce` function reads fine top-to-bottom. The `needsRevision` branch was added later by a different author and looks innocent — just another `Reject` call. The panic surfaces only when both branches run on the same future.

**Spot:** Any `Future` / `Promise` type whose `Resolve` / `Reject` methods call `close(done)` directly without `sync.Once` (or without a `closed bool` flag guarded by a mutex).

**Fix:**

```go
type Future[T any] struct {
    done chan struct{}
    val  T
    err  error
    once sync.Once
}

func (f *Future[T]) Resolve(v T) {
    f.once.Do(func() { f.val = v; close(f.done) })
}

func (f *Future[T]) Reject(err error) {
    f.once.Do(func() { f.err = err; close(f.done) })
}
```

`sync.Once` is the canonical guard — first call wins, subsequent calls are no-ops.

**Why common:** Blog-post Future implementations skip `sync.Once` for clarity. Production copies the blog post. The double-fulfilment path looks impossible until someone adds a watchdog that calls `Reject` on timeout while the primary finishes successfully.
</details>

---

## Bug 3 — Reading the result channel twice

```go
func FetchOrders(ctx context.Context, uid string) <-chan []Order {
    out := make(chan []Order, 1)
    go func() {
        defer close(out)
        orders, _ := db.Query(ctx, uid)
        out <- orders
    }()
    return out
}

func handler(ctx context.Context) {
    ch := FetchOrders(ctx, "alice")
    orders := <-ch
    log.Printf("got %d orders", len(orders))
    // ... later, in the same handler:
    more := <-ch                                // returns zero value, len=0
    log.Printf("got %d more", len(more))
}
```

<details><summary>Answer</summary>

**Bug:** The future is one-shot — the producer sends one value and `close()`s the channel. The second `<-ch` reads from a closed channel: it returns the zero value (`nil` slice) without blocking. The log says `got 0 more` suggesting "no extra orders", when really the channel was already drained.

**Why subtle:** No panic, no error, no goroutine leak. A `nil` slice is semantically valid in Go — `len(nil) == 0`, `range nil` does nothing. The bug is a *meaning* error.

**Spot:** Any future-channel read more than once. Use `v, ok := <-ch` to detect the closed case; `ok == false` means "drained".

**Fix:** Cache the value on first read, reuse the variable thereafter. If you need fan-out, use a `Future[T]` with an idempotent `Await`:

```go
func (f *Future[T]) Await(ctx context.Context) (T, error) {
    <-f.done
    return f.val, f.err
}
```

`f.done` is `close()`d once; every `<-f.done` returns immediately after.

**Why common:** Channels feel like queues. "Reading more than once" feels like it should give "more elements". For a one-shot future channel, it gives the zero value silently.
</details>

---

## Bug 4 — `errgroup.Go` capturing loop variable (pre-Go-1.22)

```go
// go.mod: go 1.21
g, gctx := errgroup.WithContext(ctx)
for _, id := range userIDs {
    g.Go(func() error {
        u, err := fetchUser(gctx, id)           // id captured by reference
        if err != nil { return err }
        results[id] = u                         // also wrong slot
        return nil
    })
}
if err := g.Wait(); err != nil { return err }
```

<details><summary>Answer</summary>

**Bug:** Pre-Go-1.22, the loop variable `id` is one variable reused across iterations. Every goroutine spawned by `g.Go` captures the same address. By the time the goroutines run, `id` holds the *last* value — the group fetches the last user N times into the last slot. Go 1.22+ changed the spec; legacy modules still hit it.

**Why subtle:** If `userIDs` is short and goroutines run before the loop advances, it can pass in tests. Under load, with longer slices, the bug always wins.

**Spot:** Pre-1.22 module, `for _, x := range xs { g.Go(func() error { use(x) }) }`. `go vet -loopclosure` flags it.

**Fix:** Add a per-iteration shadow (`id := id`) before the `g.Go`, or upgrade `go.mod` to `go 1.22+`. Note: writing into `results[id]` from multiple goroutines is *also* a concurrent map write — separate bug. Use a mutex or a pre-allocated slice indexed by position.

**Why common:** It was *the* Go gotcha for a decade. Even 1.22+ codebases still inherit it through dependencies, copy-paste, and older `go` directives.
</details>

---

## Bug 5 — Missing `defer cancel()` on `context.WithTimeout`

```go
func FetchWithTimeout(parent context.Context, url string) (Result, error) {
    ctx, _ := context.WithTimeout(parent, 5*time.Second)  // cancel discarded
    return doFetch(ctx, url)
}
```

<details><summary>Answer</summary>

**Bug:** `context.WithTimeout` returns a `CancelFunc` that must be called to release timer resources. The author discarded it with `_`. The internal timer stays alive until the deadline expires — even if `doFetch` returned in 50ms. Under load this leaks one timer per call into the runtime's timer heap. `go vet` flags it.

**Why subtle:** The function *appears* to work — deadline fires, downstream observes cancellation, result is correct. The leak is silent: timer count grows over hours.

**Spot:** Any `context.WithTimeout` / `WithDeadline` / `WithCancel` whose returned `cancel` is `_`'d or never called.

**Fix:** `ctx, cancel := context.WithTimeout(parent, 5*time.Second); defer cancel()`. `defer cancel()` is unconditional — idempotent, and releases the timer immediately even if the deadline already fired.

**Why common:** The signature reads as "two return values, second one is optional cleanup". It isn't optional. The `go vet` warning gets silenced because "the timeout takes care of it".
</details>

---

## Bug 6 — Producer goroutine doesn't observe `ctx`

```go
func Async[T any](ctx context.Context, fn func() (T, error)) *Future[T] {
    f := NewFuture[T]()
    go func() {
        v, err := fn()                          // ignores ctx entirely
        if err != nil { f.Reject(err); return }
        f.Resolve(v)
    }()
    return f
}

// caller:
ctx, cancel := context.WithTimeout(parent, 1*time.Second)
defer cancel()
result, err := Async(ctx, slowComputation).Await(ctx)
```

<details><summary>Answer</summary>

**Bug:** `Async` accepts `ctx` and passes it nowhere. The consumer's `Await(ctx)` returns after 1 second with `ctx.Err()` (good), but the producer goroutine keeps running `slowComputation()` for as long as it takes. Every cancelled call leaks one goroutine pinned on whatever resources `fn` is using.

**Why subtle:** The consumer side *looks* cancellable — `Await` exits promptly. The producer-side leak is invisible to the caller.

**Spot:** Any `Async` / `Promise` / `Future` helper that accepts `context.Context` but doesn't pass it to the work function. The signature is the lie.

**Fix:** Change `fn` to take `context.Context` and thread `ctx` in:

```go
func Async[T any](ctx context.Context, fn func(context.Context) (T, error)) *Future[T] {
    f := NewFuture[T]()
    go func() {
        v, err := fn(ctx)
        if err != nil { f.Reject(err); return }
        f.Resolve(v)
    }()
    return f
}
```

**Why common:** Generic Future helpers feel "value-level" — they wrap a `func() (T, error)`. Adding `context.Context` to the closure feels like leakage, but without it cancellation never reaches the producer.
</details>

---

## Bug 7 — Panic in producer goroutine crashes the program

```go
func FetchAll(ctx context.Context, ids []string) []*Future[User] {
    futures := make([]*Future[User], len(ids))
    for i, id := range ids {
        i, id := i, id
        f := NewFuture[User]()
        futures[i] = f
        go func() {
            u := mustFetchUser(ctx, id)         // panics if id is empty
            f.Resolve(u)
        }()
    }
    return futures
}
```

<details><summary>Answer</summary>

**Bug:** No `defer recover()` in the producer goroutine. If `mustFetchUser` panics, the panic propagates out of the goroutine and takes down the entire process — including unrelated in-flight futures and the HTTP server. Even without process exit, the future never resolves: consumers block forever (or until their own `ctx.Done()`).

**Why subtle:** "It only panics if the input is bad" — except `ids` came from a JSON body or upstream service. The first malformed input is enough to crash.

**Spot:** Any goroutine launched with `go func() { ... }()` where the body can panic and the only path to `Resolve` / `Reject` is at the bottom.

**Fix:**

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            f.Reject(fmt.Errorf("fetch panicked: %v", r))
        }
    }()
    u := mustFetchUser(ctx, id)
    f.Resolve(u)
}()
```

Log + metric + alert on the panic; a healthy system has zero.

**Why common:** `recover` feels like exception handling, which Go discourages. The result is "recover is only for libraries". A goroutine that resolves a future *is* a library boundary.
</details>

---

## Bug 8 — `errgroup.SetLimit(N)` with N too high

```go
func processAll(ctx context.Context, items []Item) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(10_000)                          // arbitrarily large
    for _, item := range items {
        item := item
        g.Go(func() error {
            return process(gctx, item)          // opens a DB conn each
        })
    }
    return g.Wait()
}
```

<details><summary>Answer</summary>

**Bug:** `SetLimit(10_000)` allows up to ten thousand concurrent goroutines, each calling `process` which opens one DB connection. Your pool has 100 connections; the first 100 goroutines grab them, the remaining 9,900 block, and a downstream call inside the holding 100 needing another pool slot deadlocks. Even without deadlock you spend ~80MB just on goroutine stacks (8KB × 10,000).

**Why subtle:** It does the right thing on small inputs. The pathology shows only when `len(items)` is in the thousands — exactly when concurrency starts to matter.

**Spot:** Any `SetLimit(n)` where `n` was chosen by "make it big enough not to bottleneck", not by measuring downstream capacity.

**Fix:** Match `n` to the limiting resource (DB pool size, HTTP max-conns-per-host):

```go
g.SetLimit(min(len(items), dbPool.MaxConns()/2))
```

If unsure, start with `runtime.GOMAXPROCS(0)` and benchmark.

**Why common:** `SetLimit` exists to prevent the disaster, not to enable it. "More concurrency = faster" is wrong past the limiting resource's capacity.
</details>

---

## Bug 9 — `errgroup.Wait` called before all `Go` calls

```go
func fetchAll(ctx context.Context, ids []string) (map[string]User, error) {
    g, gctx := errgroup.WithContext(ctx)
    out := make(map[string]User)
    var mu sync.Mutex

    if len(ids) == 0 {
        return out, g.Wait()                    // Wait on empty group
    }

    g.Go(func() error {
        u, err := fetchUser(gctx, ids[0])
        if err != nil { return err }
        mu.Lock(); out[ids[0]] = u; mu.Unlock()
        return nil
    })

    if err := g.Wait(); err != nil { return nil, err }    // BUG: too early

    for _, id := range ids[1:] {
        id := id
        g.Go(func() error {
            u, err := fetchUser(gctx, id)
            if err != nil { return err }
            mu.Lock(); out[id] = u; mu.Unlock()
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return out, nil
}
```

<details><summary>Answer</summary>

**Bug:** The first `g.Wait()` is called after only one `g.Go`. It returns as soon as that goroutine finishes. The author then adds more `g.Go` calls and waits again — but **`errgroup.Group` is single-use**. After the first `Wait` returns, the group's context is considered "done", and the "first error cancels all" guarantee no longer covers later waves.

**Why subtle:** The first `Wait` looks like an early-exit optimization. The author thinks waves are independent. `errgroup` is structured for one wave of `Go` followed by one `Wait`.

**Spot:** Any `g.Wait()` followed by more `g.Go(...)` on the same group. Also any `g.Wait()` inside a loop that launches goroutines.

**Fix:** Launch every `g.Go` before the single `g.Wait()`. If you genuinely have phased work, build a new group per wave:

```go
g, gctx := errgroup.WithContext(ctx)
for _, id := range ids {
    id := id
    g.Go(func() error {
        u, err := fetchUser(gctx, id)
        if err != nil { return err }
        mu.Lock(); out[id] = u; mu.Unlock()
        return nil
    })
}
if err := g.Wait(); err != nil { return nil, err }
return out, nil
```

**Why common:** `errgroup` *looks* like a pool you can push tasks into and drain in waves. It isn't — it's one-shot. The API doesn't enforce this, so the misuse compiles and "works" in tests.
</details>

---

## Bug 10 — `singleflight` panic shared across all callers

```go
var g singleflight.Group

func GetUser(ctx context.Context, id string) (User, error) {
    v, err, _ := g.Do(id, func() (any, error) {
        u, err := db.Query(ctx, id)
        if err != nil { return nil, err }
        return u.MustNormalize(), nil           // panics if u.Name is empty
    })
    if err != nil { return User{}, err }
    return v.(User), nil
}
```

<details><summary>Answer</summary>

**Bug:** If `u.MustNormalize()` panics inside the `singleflight` work function, the panic is captured and **re-raised in every caller** sharing that `Do` call. One thousand goroutines calling `GetUser("alice")` concurrently — when the work panics, all one thousand callers panic. If any of them runs the HTTP `accept` loop, the server crashes.

`singleflight` does this by design: it can't return a "panic result" via `(value, error)`, so it re-panics. The author's mental model is "shared result" — but "result" includes panics.

**Why subtle:** With one caller, `singleflight` is indistinguishable from a direct call. The amplification only appears under concurrent load — exactly when you wanted `singleflight` in the first place.

**Spot:** Any `singleflight.Do` work function that calls `Must*` helpers, panics, or accesses nil maps without checks.

**Fix:** Recover inside the work function and convert the panic to an error.

```go
v, err, _ := g.Do(id, func() (_ any, retErr error) {
    defer func() {
        if r := recover(); r != nil {
            retErr = fmt.Errorf("singleflight work panicked: %v", r)
        }
    }()
    u, err := db.Query(ctx, id)
    if err != nil { return nil, err }
    return u.MustNormalize(), nil
})
```

Every caller now gets the same *error*, not the same panic.

**Why common:** `singleflight`'s "shared result" framing makes the panic-sharing surprising. The code feels like a memoization cache — you don't think of caches as panic-amplifiers.
</details>

---

## Bug 11 — Future returned but consumer never reads

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]*Future[Item]
}

func (c *Cache) Get(ctx context.Context, key string) *Future[Item] {
    c.mu.Lock()
    if f, ok := c.data[key]; ok {
        c.mu.Unlock()
        return f
    }
    f := NewFuture[Item]()
    c.data[key] = f
    c.mu.Unlock()

    go func() {
        item, err := fetch(ctx, key)
        if err != nil { f.Reject(err); return }
        f.Resolve(item)
    }()
    return f
}

// caller:
_ = cache.Get(ctx, key)                         // discards the future
```

<details><summary>Answer</summary>

**Bug:** The cache returns a `*Future[Item]` and the caller discards it. The future does get resolved, but the consumer never calls `Await`, so the value sits there forever, pinned by `c.data[key]`. The cache grows monotonically — every `Get` inserts, nothing evicts. The future isn't the leak; the unbounded `data` map is. The discarded future hides it.

**Why subtle:** Caches that grow forever look fine in tests and demos. The leak only matters when the keyspace is unbounded (user IDs, opaque tokens, paths from input).

**Spot:** Any cache keyed by a high-cardinality value without TTL, LRU, or explicit eviction. Also any `Get` whose return is sometimes discarded.

**Fix:** Bound the cache with an LRU/TTL, and rename the discard pattern to `Prefetch` so the intent is explicit and metered:

```go
type Cache struct {
    mu   sync.Mutex
    data *lru.Cache[string, *Future[Item]]      // LRU with max size
}
```

If the caller really doesn't want the value, don't call the cache at all.

**Why common:** Caches "look free" — you only pay for what you store. The cost is in entries you never re-read, which a future-shaped cache hides because every entry "completed successfully". Without an eviction policy, every cache is a memory leak with extra steps.
</details>

---

## Bug 12 — Timer not reset after `select` (drift)

```go
func poller(ctx context.Context, ch <-chan Event) {
    timer := time.NewTimer(5 * time.Second)
    for {
        select {
        case ev := <-ch:
            handle(ev)
            // BUG: timer not reset; first event resets nothing, deadline drifts
        case <-timer.C:
            heartbeat()
            timer = time.NewTimer(5 * time.Second)  // also wrong shape
        case <-ctx.Done():
            return
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** Two compounded problems. (1) After handling an event on `ch`, the timer is not reset — the intent was "heartbeat 5s after last activity", but the timer still fires at its original deadline. (2) The heartbeat branch creates a *new* `time.NewTimer` instead of resetting the existing one, leaking the old timer until GC.

**Why subtle:** The first event arrives within 5 seconds, so `timer.C` doesn't fire and the missing reset doesn't matter — yet. The next event at second 9 sees the timer fire at second 5, in the middle of nowhere.

**Spot:** Any `time.NewTimer` in a `for { select { ... } }` where a non-timer branch fires but the timer isn't `Reset()` afterward. Same with `time.After` inside a loop — fresh timer per iteration, not GC'd until it fires.

**Fix:** Reuse one timer and `Reset` it after every branch, with the documented drain dance:

```go
timer := time.NewTimer(5 * time.Second)
for {
    select {
    case ev := <-ch:
        handle(ev)
        if !timer.Stop() { select { case <-timer.C: default: } }
        timer.Reset(5 * time.Second)
    case <-timer.C:
        heartbeat()
        timer.Reset(5 * time.Second)
    case <-ctx.Done():
        timer.Stop(); return
    }
}
```

Go 1.23+ removes the drain requirement.

**Why common:** `time.After` is a one-liner and looks right. In a long-running loop it's a slow leak; the correct version is `NewTimer` + `Reset`.
</details>

---

## Bug 13 — `context.WithTimeout(context.Background(), ...)` ignoring parent

```go
func (s *Server) handleRequest(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    user, err := s.fetchUser(ctx, r.URL.Query().Get("id"))
    if err != nil { http.Error(w, err.Error(), 500); return }
    json.NewEncoder(w).Encode(user)
}
```

<details><summary>Answer</summary>

**Bug:** The handler builds its own `ctx` from `context.Background()` instead of `r.Context()`. The new context has a deadline but no link to the request's cancellation. If the client disconnects, `r.Context().Done()` fires, but `ctx` keeps going. Every downstream call keeps working for up to 10 seconds on behalf of a client who's already gone.

**Why subtle:** The function has a context, has a deadline, threads it everywhere. The defect is one identifier — `context.Background()` instead of `r.Context()`.

**Spot:** Any HTTP / gRPC handler whose `context.WithTimeout` is built on `context.Background()` rather than the incoming request context.

**Fix:** `ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second); defer cancel()` — now you have both client-disconnect propagation *and* a server-side cap.

**Why common:** Tutorials show `context.Background()` for top-level usage. Handlers feel "top-level" — they're the entry point. The fact that `r.Context()` is the real parent isn't always clear.
</details>

---

## Bug 14 — Future resolved with pointer to local that escapes

```go
type Stats struct { Hits, Misses int64 }

func ComputeStats(ctx context.Context, uid string) *Future[*Stats] {
    f := NewFuture[*Stats]()
    go func() {
        var s Stats
        for ev := range stream(ctx, uid) {
            if ev.Hit { s.Hits++ } else { s.Misses++ }
        }
        f.Resolve(&s)                            // pointer to local
        // goroutine returns; s escapes to heap via the pointer
        time.Sleep(0)
        s.Hits = -1                              // mutation after Resolve
    }()
    return f
}
```

<details><summary>Answer</summary>

**Bug:** The producer resolves with `&s` and then mutates `s.Hits` afterward. The consumer's `Await` returns the same pointer — by the time the consumer reads `result.Hits`, the producer may have written `-1`. It's a data race; `go test -race` catches it. Even without the explicit mutation, sharing a pointer the producer still owns is fragile: any later write reaches the consumer.

**Why subtle:** `&s` looks like a normal way to return a struct built up over a loop. Go's escape analysis heap-allocates `s`, so there's no "use-after-free" warning. The race only fires if something below `f.Resolve` writes to `s`.

**Spot:** Any `f.Resolve(&local)` where `local` is a struct variable the goroutine may continue to access. Same with `ch <- &local`.

**Fix:** Use a value-typed future and resolve by value:

```go
f := NewFuture[Stats]()
...
f.Resolve(s)
```

For large structs, document the immutability convention: "once you've called `Resolve(p)`, you don't touch `*p`".

**Why common:** Pointers are the default for "return a thing" in Go. The boundary between "my struct" and "the consumer's struct" is invisible to the compiler, especially when the producer goroutine continues running after the resolve.
</details>

---

## Bug 15 — `errgroup` abort skipped because error is wrapped silently

```go
g, gctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item
    g.Go(func() error {
        if err := process(gctx, item); err != nil {
            log.Printf("process %v: %v", item.ID, err)
            return nil                          // BUG: swallow, return nil
        }
        return nil
    })
}
if err := g.Wait(); err != nil { return err }
// proceeds as if everything succeeded
```

<details><summary>Answer</summary>

**Bug:** The goroutine logs the error and returns `nil`. `errgroup` only triggers its "first error cancels all" semantics when a goroutine returns a non-nil error. `g.Wait()` returns `nil`; the caller proceeds with a partially-failed batch and no signal that anything went wrong. A twist on the same theme: returning a *wrapped* error whose caller-side classifier silently drops it.

**Why subtle:** Logging *feels* like handling. In an HTTP handler, log + return 500 is handled. In an `errgroup`, the only way to surface failure is to return non-nil.

**Spot:** Any `g.Go` whose body contains `log.Printf(...); return nil`. Also any error mapping that turns a real error into `nil` without an explicit reason.

**Fix:** Return the error and let the caller decide:

```go
g.Go(func() error {
    if err := process(gctx, item); err != nil {
        return fmt.Errorf("process %v: %w", item.ID, err)
    }
    return nil
})
```

If some errors really are non-fatal (intentional partial-failure model), use a separate result channel rather than `errgroup`. Mixing "fatal" and "non-fatal" inside one `errgroup` defeats its whole point.

**Why common:** "Log the error" is muscle memory from synchronous code. In a concurrent group with a first-error abort contract, logging is *secondary*; the primary signal is the return value.
</details>

---

## Summary

These bugs cluster into four families.

**Channel and close discipline (1, 2, 3, 12):** unbuffered futures stalling the producer, double-close from missing `sync.Once`, reading a one-shot channel twice, timer not reset in a loop. A future is a one-shot synchronization point — buffer it, close it exactly once, and read its value into a variable rather than re-reading the channel.

**Context propagation (5, 6, 13):** missing `defer cancel()`, producer ignoring `ctx`, building children off `context.Background()` instead of the parent. The cancellation chain only works if every link is connected: parent → derived ctx → producer goroutine → downstream calls. One break and the chain is decorative.

**`errgroup` and `singleflight` semantics (4, 8, 9, 10, 15):** loop-variable capture, oversized `SetLimit`, `Wait` called too early, panic sharing in `singleflight`, swallowing errors as `nil`. These libraries have small, sharp contracts — match the contract or use a different primitive.

**Goroutine and resource hygiene (7, 11, 14):** unrecovered panic killing the program, unbounded cache pinning futures, publishing a pointer the producer still mutates. Goroutines that resolve futures are library boundaries: recover, bound, and don't share mutable state across the resolve.

Review checklist for any Futures / Promises / `errgroup` / `singleflight` PR:

- [ ] Is every result channel either buffered (one-shot futures) or used with a `select { case ch <- v: case <-ctx.Done(): }` send?
- [ ] Does every `Future` / `Promise` type use `sync.Once` to guard `Resolve` / `Reject` against double-close?
- [ ] Is each result channel read into a variable on the first receive, with the variable reused thereafter (never `<-ch` twice)?
- [ ] Does `context.WithTimeout` / `WithCancel` / `WithDeadline` always have a matching `defer cancel()`, even when the deadline is expected to fire?
- [ ] Is `context.Background()` only used at true top-level entry points — never inside a request handler that has its own context?
- [ ] Does every producer goroutine accept `ctx` and observe it (e.g. via a context-aware downstream call), so consumer cancellation actually stops the producer?
- [ ] Is every goroutine launched from a `Future` / `Promise` helper wrapped in `defer recover()` that converts the panic into `Reject(err)`?
- [ ] Is `errgroup.SetLimit(n)` chosen from a measured downstream capacity (DB pool, HTTP max conns) — not "as high as possible"?
- [ ] Are all `g.Go` calls launched before the single `g.Wait()`, with no `Wait` / `Go` / `Wait` waves on the same group?
- [ ] Inside `singleflight.Do` work functions, is there a `defer recover()` that converts panics into errors so they don't get amplified across every caller?
- [ ] Are `Future` / `Promise` instances stored in caches bounded by TTL, LRU, or explicit eviction — never an unbounded map keyed by user input?
- [ ] Do producers `Resolve` with values (or freshly-allocated pointers) rather than pointers into mutable locals that the goroutine continues to touch?
