# Coordination Anti-Patterns — Find the Bug

> **Category:** [Concurrency Anti-Patterns](../README.md) → **Coordination** — *two or more lock holders that fail to make progress together.*
> **Covers (collectively):** Lock Ordering Inconsistency → Deadlock · Holding a Lock During I/O · Wrong Lock Granularity

---

This file is **critical-reading practice** for the hardest class of concurrency bug: the one where every individual line is correct and every function passes its unit test, yet the *combination* deadlocks, stalls, or melts your throughput under the right interleaving or load. Coordination bugs are not crashes — they are **failures to make progress together**. They show up at 3 a.m. under production traffic and vanish the moment you attach a debugger.

For each snippet, read it the way an on-call engineer reviewing a "service hangs intermittently" incident would, and answer three questions:

> **What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?**

A note on vocabulary you'll need throughout. A **deadlock** is a cycle in the *wait-for graph*: a directed graph whose nodes are threads and whose edge `A → B` means "thread A is blocked waiting for a lock currently held by thread B." If that graph ever contains a cycle, every thread on the cycle is blocked forever — none can release the lock the next one needs. The four Coffman conditions for deadlock are **mutual exclusion**, **hold-and-wait**, **no preemption**, and **circular wait**; breaking *any one* prevents the deadlock, and "establish a global lock order" is simply the standard way to break **circular wait**.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you are training is constructing the bad interleaving in your head, not recalling the pattern's name. Several snippets combine two anti-patterns, and at least one is a deliberate trap — code that *looks* deadlock-prone but is provably safe.

> **A note on Python:** the GIL serializes bytecode execution, but it does **not** save you here. Two threads can still each hold one `threading.Lock` and block forever waiting for the other — the GIL is released while a thread is blocked on a lock. Holding a lock across a `requests.get()` is just as ruinous in Python as in Go or Java. The GIL prevents *data races on a single object*, not *coordination deadlocks*.

---

## Table of Contents

1. [Transfer between two accounts](#snippet-1--transfer-between-two-accounts)
2. [The cache that calls the database](#snippet-2--the-cache-that-calls-the-database)
3. [The registry with a notify callback](#snippet-3--the-registry-with-a-notify-callback)
4. [One lock to rule the service](#snippet-4--one-lock-to-rule-the-service)
5. [The graph with a lock per node](#snippet-5--the-graph-with-a-lock-per-node)
6. [Two managers, two mutexes](#snippet-6--two-managers-two-mutexes)
7. [The rate limiter that phones home](#snippet-7--the-rate-limiter-that-phones-home)
8. [The ordered transfer that looks safe](#snippet-8--the-ordered-transfer-that-looks-safe)
9. [The metrics map under one mutex](#snippet-9--the-metrics-map-under-one-mutex)
10. [The connection pool and the logger](#snippet-10--the-connection-pool-and-the-logger)
11. [Striped locks with a cross-stripe move](#snippet-11--striped-locks-with-a-cross-stripe-move)
12. [The read lock that upgrades](#snippet-12--the-read-lock-that-upgrades)
13. [The single mutex that only looks scary](#snippet-13--the-single-mutex-that-only-looks-scary)
14. [The event bus that fans out under lock](#snippet-14--the-event-bus-that-fans-out-under-lock)

---

## Snippet 1 — Transfer between two accounts

```go
// Go — moving money between two locked accounts
type Account struct {
    mu      sync.Mutex
    balance int64
}

func Transfer(from, to *Account, amount int64) error {
    from.mu.Lock()
    defer from.mu.Unlock()
    to.mu.Lock()
    defer to.mu.Unlock()

    if from.balance < amount {
        return errors.New("insufficient funds")
    }
    from.balance -= amount
    to.balance += amount
    return nil
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Lock Ordering Inconsistency → Deadlock.** The lock order is *data-dependent*: `Transfer(A, B, …)` locks `A` then `B`, while `Transfer(B, A, …)` locks `B` then `A`. Two transfers in opposite directions can interleave into a wait-for cycle.

**The exact interleaving** (call `Transfer(A, B, 10)` on thread 1 and `Transfer(B, A, 5)` on thread 2):

| Step | Thread 1 | Thread 2 |
|---|---|---|
| 1 | `A.mu.Lock()` ✓ | — |
| 2 | — | `B.mu.Lock()` ✓ |
| 3 | `B.mu.Lock()` blocks (T2 holds B) | — |
| 4 | — | `A.mu.Lock()` blocks (T1 holds A) |

Wait-for graph: `T1 → T2` (T1 wants B, held by T2) and `T2 → T1` (T2 wants A, held by T1). That is a **cycle**; both threads are blocked forever. Under low traffic it may never happen; under bursty bidirectional transfers it's a statistical certainty.

**Fix — impose a global lock order** so all callers acquire locks in the same sequence, breaking the circular-wait condition. Order by a stable unique key (here, an account ID):

```go
func Transfer(from, to *Account, amount int64) error {
    first, second := from, to
    if from.id > to.id {            // always lock the lower id first
        first, second = to, from
    }
    first.mu.Lock();  defer first.mu.Unlock()
    second.mu.Lock(); defer second.mu.Unlock()

    if from.balance < amount {
        return errors.New("insufficient funds")
    }
    from.balance -= amount
    to.balance += amount
    return nil
}
```

Now *every* transfer locks the lower-id account first, so no two threads can ever hold locks in opposing orders — the wait-for graph can never contain a cycle. (Guard against `from == to` separately so you don't deadlock on yourself.)

</details>

---

## Snippet 2 — The cache that calls the database

```java
// Java — a write-through cache shared by all request threads
public class ProductCache {
    private final Map<Long, Product> map = new HashMap<>();
    private final ReentrantLock lock = new ReentrantLock();

    public Product get(long id) {
        lock.lock();
        try {
            Product p = map.get(id);
            if (p == null) {
                p = db.loadProduct(id);     // network + DB round-trip, 20–500 ms
                map.put(id, p);
            }
            return p;
        } finally {
            lock.unlock();
        }
    }
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Holding a Lock During I/O.** The single `lock` is held across `db.loadProduct(id)` — a blocking network call. There is no deadlock here; the failure mode is **throughput collapse under load**.

**How it manifests:** the lock serializes *every* `get`, including cache *hits*. While one thread waits 200 ms on the DB for a cache miss on product 42, **every other request thread** — even those asking for already-cached product 7 — blocks on `lock.lock()`. A handful of slow DB queries converts a fully concurrent cache into a single-file queue. Latency is now `queue_depth × DB_latency`; p99 explodes and the thread pool fills with threads parked on the mutex. This is **cascading latency**: one slow dependency, amplified by the lock, stalls the whole service. (It also causes a **cache stampede** — N threads all missing the same key still can't dedupe because each holds the lock in turn.)

**Fix — never hold a lock across I/O.** Lock only the in-memory map operations; do the slow load *outside* the lock. The clean idiom in Java is a `ConcurrentHashMap` whose `computeIfAbsent` does the load, but note `computeIfAbsent` itself locks the bin during the mapping function, so for genuinely slow loaders prefer an explicit per-key future to also dedupe stampedes:

```java
private final ConcurrentMap<Long, CompletableFuture<Product>> map = new ConcurrentHashMap<>();

public Product get(long id) {
    return map.computeIfAbsent(id, k ->
        CompletableFuture.supplyAsync(() -> db.loadProduct(k))   // load off the lock
    ).join();
}
```

Cache hits are now lock-free reads of a completed future; a miss triggers exactly one load (stampede deduped); no request ever blocks behind another request's DB call.

</details>

---

## Snippet 3 — The registry with a notify callback

```go
// Go — an observable registry; listeners are invoked on every change
type Registry struct {
    mu        sync.Mutex
    items     map[string]int
    listeners []func(key string)
}

func (r *Registry) Set(key string, val int) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.items[key] = val
    for _, fn := range r.listeners {
        fn(key)                       // call listener while holding r.mu
    }
}

func (r *Registry) Get(key string) int {
    r.mu.Lock()
    defer r.mu.Unlock()
    return r.items[key]
}

// A listener registered elsewhere:
reg.listeners = append(reg.listeners, func(key string) {
    log.Printf("changed %s -> %d", key, reg.Get(key))   // re-enters reg.mu
})
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Self-deadlock via a re-entrant callback** (a lock-order inversion where the cycle has length one). `Set` holds `r.mu`, then synchronously invokes each listener *while still holding the lock*. The listener calls `reg.Get(key)`, which tries to `r.mu.Lock()` again — on the **same goroutine that already holds it**.

**Why it deadlocks immediately:** Go's `sync.Mutex` is **not re-entrant**. A goroutine that already holds the mutex and calls `Lock()` again blocks forever waiting for *itself* to unlock. No special interleaving needed — the very first `Set` whose listener reads back through the registry hangs the goroutine on the first call. The wait-for "cycle" is a self-loop: the goroutine waits for a lock it itself holds.

**Why it's insidious:** the listener was registered "elsewhere," far from `Set`. The author of `Set` never sees that it calls foreign code under the lock, and the author of the listener never sees that it runs inside `Set`'s critical section. Calling **unknown/foreign code while holding a lock** is the root sin — even a re-entrant lock (Java's `ReentrantLock`) only hides it until two *different* locks invert.

**Fix — never call out to foreign code under a lock.** Snapshot what you need, release the lock, then invoke callbacks:

```go
func (r *Registry) Set(key string, val int) {
    r.mu.Lock()
    r.items[key] = val
    listeners := make([]func(string), len(r.listeners))
    copy(listeners, r.listeners)        // snapshot under lock
    r.mu.Unlock()                        // release BEFORE calling out

    for _, fn := range listeners {       // listeners run lock-free; may re-enter safely
        fn(key)
    }
}
```

Now a listener may call `reg.Get` (or even `reg.Set`) freely — the lock is no longer held when foreign code runs.

</details>

---

## Snippet 4 — One lock to rule the service

```go
// Go — the only synchronization in a high-QPS pricing service
type PricingService struct {
    mu       sync.Mutex
    rates    map[string]float64   // currency -> rate, updated ~once/minute
    requests uint64               // total served
}

func (s *PricingService) Price(item Item, currency string) float64 {
    s.mu.Lock()
    defer s.mu.Unlock()

    s.requests++
    rate := s.rates[currency]
    base := item.cents
    // ... 40 lines of pure CPU pricing math using base and rate ...
    return float64(base) * rate * marginFor(item) // marginFor is pure, ~5µs
}

func (s *PricingService) UpdateRates(r map[string]float64) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.rates = r
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Wrong Lock Granularity — a single global lock serializing an entire hot path.** There is no deadlock and no I/O. The bug is that `Price`, the hottest method in the service, holds one process-wide mutex for its **entire body** — 40 lines of pure CPU math that need no mutual exclusion at all. The only genuinely shared, mutable state is `s.requests` (a counter) and `s.rates` (read often, written rarely).

**How it manifests:** under high QPS the service cannot use more than **one CPU core** for pricing, no matter how many you give it. Every request funnels through `s.mu`; the math runs single-file. You'll see one core pegged, the rest idle, and throughput flat-lined at `1 / (lock_hold_time)`. Adding hardware does nothing — the lock is the bottleneck. This is the over-coarse end of "wrong granularity": correct, but it throws away all parallelism.

**Fix — shrink the lock to the smallest consistent unit, and pick the right primitive per field.** The counter wants an atomic; the rarely-written rate map wants a read-mostly structure (RWMutex or an atomically-swapped immutable map). Neither should gate the pricing math:

```go
type PricingService struct {
    rates    atomic.Pointer[map[string]float64]  // swapped wholesale on update
    requests atomic.Uint64
}

func (s *PricingService) Price(item Item, currency string) float64 {
    s.requests.Add(1)                  // lock-free counter
    rates := *s.rates.Load()           // lock-free read of an immutable snapshot
    rate := rates[currency]
    base := item.cents
    return float64(base) * rate * marginFor(item)   // math runs fully parallel
}

func (s *PricingService) UpdateRates(r map[string]float64) {
    s.rates.Store(&r)                  // publish a new immutable map
}
```

The pricing math now scales across every core; only the trivial counter and pointer-swap touch shared state.

</details>

---

## Snippet 5 — The graph with a lock per node

```go
// Go — a concurrent graph; each node guards its own edges
type Node struct {
    mu    sync.Mutex
    id    int
    edges map[*Node]int
}

// Adds a bidirectional edge, locking both endpoints.
func Connect(a, b *Node, weight int) {
    a.mu.Lock()
    defer a.mu.Unlock()
    b.mu.Lock()
    defer b.mu.Unlock()
    a.edges[b] = weight
    b.edges[a] = weight
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Over-fine locking that re-introduces an ordering deadlock.** Someone replaced one coarse graph lock with a lock *per node* to get parallelism — a reasonable granularity instinct — but `Connect(a, b, …)` locks `a` then `b` based on **argument position**, not on any global order. Two concurrent `Connect` calls on the same pair in opposite argument order deadlock exactly like Snippet 1.

**The exact interleaving:** thread 1 runs `Connect(X, Y, 3)`, thread 2 runs `Connect(Y, X, 7)`.

| Step | Thread 1 | Thread 2 |
|---|---|---|
| 1 | `X.mu.Lock()` ✓ | — |
| 2 | — | `Y.mu.Lock()` ✓ |
| 3 | `Y.mu.Lock()` blocks | — |
| 4 | — | `X.mu.Lock()` blocks |

Wait-for cycle `T1 → T2 → T1`; both hang forever. The lesson: **finer locks don't remove the ordering obligation — they multiply it.** With one lock per node you now must define a total order over *all* nodes and respect it on every multi-node operation.

**Fix — lock the two nodes in a canonical order** (by their stable `id`), so every caller acquires them in the same sequence:

```go
func Connect(a, b *Node, weight int) {
    first, second := a, b
    if a.id > b.id {
        first, second = b, a
    }
    first.mu.Lock();  defer first.mu.Unlock()
    second.mu.Lock(); defer second.mu.Unlock()
    a.edges[b] = weight
    b.edges[a] = weight
}
```

Now the wait-for graph is acyclic by construction. (If a third operation ever needs three nodes, sort all three by id and lock in that order — the rule generalizes.)

> **Combines two patterns:** Wrong Lock Granularity (the motivation) directly *caused* a Lock Ordering Inconsistency. Granularity decisions and ordering discipline are not independent.

</details>

---

## Snippet 6 — Two managers, two mutexes

```java
// Java — two subsystems that occasionally need to coordinate
class UserManager {
    private final Object lock = new Object();
    private final SessionManager sessions;

    void logout(long userId) {
        synchronized (lock) {                 // (1) UserManager.lock
            clearUserState(userId);
            sessions.endAll(userId);          // calls into SessionManager
        }
    }
    void onSessionExpired(long userId) {      // called BY SessionManager
        synchronized (lock) {                 // (4) UserManager.lock
            clearUserState(userId);
        }
    }
}

class SessionManager {
    private final Object lock = new Object();
    private UserManager users;

    void endAll(long userId) {
        synchronized (lock) {                 // (2) SessionManager.lock
            killSessions(userId);
        }
    }
    void expire(long userId) {                // background reaper thread
        synchronized (lock) {                 // (3) SessionManager.lock
            killSessions(userId);
            users.onSessionExpired(userId);   // calls back into UserManager
        }
    }
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Lock Ordering Inconsistency across two subsystems, hidden behind synchronous callbacks** — the classic, hard-to-see production deadlock. Trace which lock each path acquires *first* and *second*:

- `UserManager.logout` takes **UserManager.lock**, then (via `sessions.endAll`) **SessionManager.lock**. Order: `User → Session`.
- `SessionManager.expire` takes **SessionManager.lock**, then (via `users.onSessionExpired`) **UserManager.lock**. Order: `Session → User`.

Two code paths acquire the same two locks in **opposite orders** — but you can't see it locally, because each function only ever takes *its own* lock; the second acquisition is buried inside a call to the other manager.

**The exact interleaving:** a user clicks "log out" (thread 1 enters `logout`, grabs UserManager.lock) at the same moment the background reaper expires one of their sessions (thread 2 enters `expire`, grabs SessionManager.lock).

| Step | Thread 1 (logout) | Thread 2 (reaper) |
|---|---|---|
| 1 | acquire `User.lock` ✓ | — |
| 2 | — | acquire `Session.lock` ✓ |
| 3 | `sessions.endAll` → wants `Session.lock`, blocks | — |
| 4 | — | `users.onSessionExpired` → wants `User.lock`, blocks |

Wait-for cycle `T1 → T2 → T1`. Both threads hang; `logout` never returns and the session reaper stops reaping. Re-entrant `synchronized` does **not** help — these are two *different* monitors.

**Fix — don't hold a lock while calling into another lock-holding subsystem.** Release before the cross-subsystem call (do the foreign work outside your critical section), or establish and document one global lock order that *both* classes obey. The release-first fix:

```java
void logout(long userId) {
    synchronized (lock) { clearUserState(userId); }   // release before calling out
    sessions.endAll(userId);                           // no UserManager.lock held here
}
void expire(long userId) {
    synchronized (lock) { killSessions(userId); }      // release before calling back
    users.onSessionExpired(userId);                    // no SessionManager.lock held here
}
```

With neither call made under a lock, the two locks are never held simultaneously, so no cycle can form.

> **Combines two patterns:** the trigger is a callback-induced lock-order inversion (like Snippet 3), but across *two* subsystems with *two* locks — the genuinely cyclic case, not a self-deadlock.

</details>

---

## Snippet 7 — The rate limiter that phones home

```python
# Python — a distributed rate limiter consulted on every request
import threading, requests

class RateLimiter:
    def __init__(self):
        self._lock = threading.Lock()
        self._counts = {}   # key -> int, in-process fallback

    def allow(self, key, limit):
        with self._lock:
            # Ask the central quota service whether this key is over budget.
            resp = requests.post("http://quota-svc/check",
                                 json={"key": key}, timeout=2.0)   # network call
            remaining = resp.json()["remaining"]
            self._counts[key] = remaining
            return remaining > 0
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Holding a Lock During I/O** — in Python, where people wrongly assume the GIL makes locks unnecessary. The single `self._lock` is held across `requests.post`, an HTTP call that can take up to the full 2-second timeout.

**Why the GIL doesn't save you:** the GIL serializes *bytecode*, but a thread blocked in a C-level socket read (inside `requests`) **releases the GIL** so other threads can run — except they immediately block on `self._lock`, which the network-bound thread still holds. So the GIL frees the *interpreter* but your explicit lock re-serializes everything. Every request to the rate limiter — for *any* key — waits behind one slow HTTP round-trip.

**How it manifests:** the rate limiter is on the hot path of every request. Under load, or the instant `quota-svc` gets slow (the exact moment you most need the limiter to be fast), all worker threads pile up on `self._lock`. The limiter, meant to *protect* the system, becomes the **single point of serialization** that takes it down — a self-inflicted cascading failure. If `quota-svc` hangs near the timeout, the whole app freezes for ~2 s per cycle.

**Fix — do the network call outside the lock; lock only the local state mutation.** Better still, the per-key state means you don't need one global lock at all:

```python
class RateLimiter:
    def __init__(self):
        self._lock = threading.Lock()
        self._counts = {}

    def allow(self, key, limit):
        resp = requests.post("http://quota-svc/check",
                             json={"key": key}, timeout=2.0)   # no lock held
        remaining = resp.json()["remaining"]
        with self._lock:                                       # lock only the dict write
            self._counts[key] = remaining
        return remaining > 0
```

A slow `quota-svc` now slows only the requests that actually call it, not every thread touching the limiter. (If `_counts` is only ever a per-key write/read, a `ConcurrentDict`-style structure or per-key lock removes even this contention.)

</details>

---

## Snippet 8 — The ordered transfer that looks safe

```go
// Go — like Snippet 1, but the author "fixed" the ordering. Did they?
type Account struct {
    mu  sync.Mutex
    id  int
    bal int64
}

func lockBoth(a, b *Account) (first, second *Account) {
    if a.id <= b.id {
        a.mu.Lock()
        b.mu.Lock()
        return a, b
    }
    b.mu.Lock()
    a.mu.Lock()
    return b, a
}

func Transfer(from, to *Account, amt int64) error {
    f, s := lockBoth(from, to)
    defer f.mu.Unlock()
    defer s.mu.Unlock()
    if from.bal < amt {
        return errors.New("insufficient")
    }
    from.bal -= amt
    to.bal += amt
    return nil
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Trap: there is no deadlock here.** This is the deliberate "looks dangerous, is actually safe" snippet. Two locks, acquired on two objects, defers unlocking in a different variable order — all the surface markers of Snippet 1's bug. But trace it carefully: `lockBoth` **always acquires the lower-`id` account's mutex first**, regardless of which is `from` and which is `to`. That is a consistent global lock order, so the **circular-wait condition is broken** — the wait-for graph can never contain a cycle, and no interleaving deadlocks.

The mismatched `defer` order (`f` then `s`, i.e. lower-id unlocked first) is harmless: unlock order doesn't matter for deadlock freedom — only *acquire* order does. Releasing locks in any order is always safe.

**The one real bug to call out** is a different, latent one: if `from == to` (transfer to self), `lockBoth` takes the `a.id <= b.id` branch and calls `a.mu.Lock()` then `b.mu.Lock()` on the **same mutex** → self-deadlock on a non-re-entrant `sync.Mutex`. So the ordering is correct; the missing guard is the equal-pointer case.

**Fix — keep the ordering (it's correct) and add the self-transfer guard:**

```go
func Transfer(from, to *Account, amt int64) error {
    if from == to {
        return nil                       // no-op; avoids double-locking one mutex
    }
    f, s := lockBoth(from, to)
    defer f.mu.Unlock()
    defer s.mu.Unlock()
    ...
}
```

**The reading lesson:** don't pattern-match "two locks + mismatched variable order = deadlock." Verify the actual *acquisition* order. Consistent ordering is exactly the cure, and code that already applies it is safe by design — interrogate the edge cases (self, nil) instead.

</details>

---

## Snippet 9 — The metrics map under one mutex

```go
// Go — per-endpoint latency metrics, written on every request
type Metrics struct {
    mu      sync.Mutex
    byRoute map[string]*Histogram
}

func (m *Metrics) Observe(route string, latency time.Duration) {
    m.mu.Lock()
    defer m.mu.Unlock()
    h, ok := m.byRoute[route]
    if !ok {
        h = NewHistogram()
        m.byRoute[route] = h
    }
    h.Record(latency)        // updates the histogram's internal buckets
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Wrong Lock Granularity — too coarse.** A single mutex guards both the *map* (which only needs protection when a new route is first seen — rare) and *every histogram update* (which happens on every single request — extremely hot). Recording latency for `/checkout` blocks recording latency for `/health`, even though the two histograms share nothing.

**How it manifests:** in a service serving thousands of requests per second across dozens of routes, `Observe` is on every request's critical path. The one mutex serializes *all* metric recording, so the metrics layer — pure in-memory arithmetic — becomes a contention hotspot visible as lock-wait time in a profile. No deadlock, no I/O; just unnecessary serialization of independent work, the same shape as Snippet 4 but localized.

**Fix — separate the two concerns by granularity.** Protect the rarely-mutated map with a read-mostly lock (or build it once at startup), and give each histogram its own lock (or make `Histogram.Record` internally lock-free / atomic). The common path — recording into an existing histogram — should not touch the map lock:

```go
type Metrics struct {
    mu      sync.RWMutex
    byRoute map[string]*Histogram
}

func (m *Metrics) Observe(route string, latency time.Duration) {
    m.mu.RLock()
    h, ok := m.byRoute[route]
    m.mu.RUnlock()
    if !ok {
        m.mu.Lock()
        if h, ok = m.byRoute[route]; !ok {   // re-check under write lock
            h = NewHistogram()
            m.byRoute[route] = h
        }
        m.mu.Unlock()
    }
    h.Record(latency)        // Histogram has its own internal sync / atomics
}
```

Now route lookups run concurrently (read lock), the write lock is taken only the first time each route appears, and per-histogram recording is independent across routes.

</details>

---

## Snippet 10 — The connection pool and the logger

```java
// Java — a JDBC-style pool whose checkout logs via a shared audit logger
class ConnectionPool {
    private final Object poolLock = new Object();
    private final AuditLogger audit;          // shared, also used elsewhere

    Connection acquire() {
        synchronized (poolLock) {
            Connection c = waitForFree();      // blocks until a conn frees up
            audit.record("acquire", c.id());   // (A) poolLock -> auditLock
            return c;
        }
    }
}

class AuditLogger {
    private final Object auditLock = new Object();
    private ConnectionPool pool;               // logger writes audit rows to the DB!

    void record(String ev, long id) {
        synchronized (auditLock) {
            buffer.add(ev, id);
            if (buffer.full()) {
                Connection c = pool.acquire();  // (B) auditLock -> poolLock
                flushToDb(c);
            }
        }
    }
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Lock Ordering Inconsistency *plus* Holding a Lock During a blocking operation** — two anti-patterns stacked. Two locks, `poolLock` and `auditLock`, are acquired in opposite orders on two paths:

- `ConnectionPool.acquire` holds **poolLock**, then calls `audit.record` which takes **auditLock**. Order: `pool → audit`.
- `AuditLogger.record` holds **auditLock**, then (when the buffer fills) calls `pool.acquire` which takes **poolLock**. Order: `audit → pool`.

**The exact interleaving:** thread 1 acquires a connection while thread 2's audit buffer happens to fill at the same time.

| Step | Thread 1 (acquire) | Thread 2 (audit flush) |
|---|---|---|
| 1 | `poolLock` ✓ | — |
| 2 | — | `auditLock` ✓ |
| 3 | `audit.record` → wants `auditLock`, blocks | — |
| 4 | — | buffer full → `pool.acquire` → wants `poolLock`, blocks |

Wait-for cycle `T1 → T2 → T1`. Deadlock. Worse, this is also a **lock held across a blocking operation**: `acquire` holds `poolLock` across `waitForFree()`, so even without the cycle, a connection shortage stalls everyone (Snippet 2's disease).

**The deeper smell:** a circular *dependency* between the pool and the logger — the pool logs through the logger, and the logger writes through the pool. Coordination bugs often trace back to a structural cycle in the object graph.

**Fix — break the cycle and stop holding locks across blocking/foreign calls.** Log *after* releasing `poolLock`, and never let the audit flush re-borrow from the same pool (give it a dedicated connection or an async writer):

```java
Connection acquire() {
    Connection c;
    synchronized (poolLock) { c = takeFreeIfAvailable(); }   // don't block under lock
    if (c == null) c = waitForFreeOutsideLock();
    audit.record("acquire", c.id());        // logged after releasing poolLock
    return c;
}
// AuditLogger flushes asynchronously on its own thread + its own dedicated connection,
// so record() never calls back into the request-path pool while holding auditLock.
```

No path now holds one of the two locks while reaching for the other, and no lock is held across the blocking `waitForFree`.

</details>

---

## Snippet 11 — Striped locks with a cross-stripe move

```java
// Java — a sharded map using lock striping for throughput
class StripedStore {
    private final Object[] stripes = new Object[16];
    private final Map<String, Long>[] buckets = new HashMap[16];
    // (constructor fills stripes[i] = new Object() and buckets[i] = new HashMap())

    private int idx(String k) { return (k.hashCode() & 0x7fffffff) % 16; }

    // Move a value from one key to another (possibly different stripe).
    void move(String src, String dst, long delta) {
        synchronized (stripes[idx(src)]) {       // lock src's stripe
            synchronized (stripes[idx(dst)]) {   // lock dst's stripe
                buckets[idx(src)].merge(src, -delta, Long::sum);
                buckets[idx(dst)].merge(dst, delta, Long::sum);
            }
        }
    }
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Wrong Lock Granularity (striping) that re-introduces a Lock Ordering Inconsistency** — the same trap as Snippet 5, dressed up as a respectable optimization. Lock striping is a *good* granularity technique (16 independent locks instead of one), but `move` acquires `stripes[idx(src)]` then `stripes[idx(dst)]` in **key order**, not stripe order. Two concurrent `move`s with swapped src/dst that land on two different stripes deadlock.

**The exact interleaving:** `move("a", "b", 5)` where `idx("a") == 3`, `idx("b") == 7`, running against `move("x", "y", 2)` where `idx("x") == 7`, `idx("y") == 3`.

| Step | Thread 1: move(a→b) | Thread 2: move(x→y) |
|---|---|---|
| 1 | lock stripe 3 ✓ | — |
| 2 | — | lock stripe 7 ✓ |
| 3 | wants stripe 7, blocks | — |
| 4 | — | wants stripe 3, blocks |

Wait-for cycle on stripes 3 and 7. Note it deadlocks even though the *keys* differ — what matters is the **stripe index** order, and the code orders by key, not by index.

**Fix — acquire stripes in a canonical order: by stripe index.** Also handle the same-stripe case so you don't lock one monitor twice (Java `synchronized` *is* re-entrant, so a same-stripe double-lock is safe here — but acquiring in index order is the rule that generalizes):

```java
void move(String src, String dst, long delta) {
    int i = idx(src), j = idx(dst);
    int lo = Math.min(i, j), hi = Math.max(i, j);
    synchronized (stripes[lo]) {
        synchronized (stripes[hi]) {          // lo == hi is fine: synchronized is reentrant
            buckets[i].merge(src, -delta, Long::sum);
            buckets[j].merge(dst, delta, Long::sum);
        }
    }
}
```

Every `move` now locks the lower-indexed stripe first, so the wait-for graph stays acyclic. Striping keeps its throughput win without the ordering hazard.

> **Combines two patterns:** the granularity choice (striping) and the ordering discipline are coupled — getting the first right does not exempt you from the second.

</details>

---

## Snippet 12 — The read lock that upgrades

```go
// Go — a config store using RWMutex, with a "refresh if stale" read path
type Config struct {
    mu      sync.RWMutex
    data    map[string]string
    fetched time.Time
}

func (c *Config) Get(key string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()

    if time.Since(c.fetched) > time.Minute {   // stale?
        c.mu.Lock()                            // try to upgrade to write lock
        c.data = reload()
        c.fetched = time.Now()
        c.mu.Unlock()
    }
    return c.data[key]
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Lock-upgrade self-deadlock** — a coordination bug specific to reader-writer locks. Inside `Get`, the goroutine already holds the **read** lock (`RLock`), then attempts `c.mu.Lock()` to acquire the **write** lock while still holding the read lock. Go's `sync.RWMutex` does **not support upgrading**: a writer must wait for *all* readers (including this very goroutine) to release. The goroutine is therefore waiting for itself to `RUnlock` — which it won't do until the deferred unlock at function return, which it can't reach because it's blocked. Self-deadlock.

**Why it's worse under load:** even a single caller can hang the moment the config goes stale. But `RWMutex` also makes it *more* likely to wedge the whole service: once a writer is *pending*, Go's `RWMutex` blocks **new readers** to prevent writer starvation. So while thread A is stuck mid-upgrade, every other `Get` caller now blocks on `RLock` too — one stale-config read freezes the entire config subsystem. The deadlock cascades from one goroutine to all of them.

**Fix — never hold the read lock while taking the write lock.** Release the read lock first, acquire the write lock, **re-check** the staleness condition (another goroutine may have reloaded while you had no lock), reload if still needed, then re-read:

```go
func (c *Config) Get(key string) string {
    c.mu.RLock()
    stale := time.Since(c.fetched) > time.Minute
    if !stale {
        defer c.mu.RUnlock()
        return c.data[key]
    }
    c.mu.RUnlock()                 // drop read lock BEFORE taking write lock

    c.mu.Lock()
    if time.Since(c.fetched) > time.Minute {   // double-check; someone may have reloaded
        c.data = reload()
        c.fetched = time.Now()
    }
    val := c.data[key]
    c.mu.Unlock()
    return val
}
```

The read and write locks are never held simultaneously by the same goroutine, so the upgrade self-deadlock is impossible, and the double-check prevents redundant reloads under a thundering herd of stale reads.

</details>

---

## Snippet 13 — The single mutex that only looks scary

```go
// Go — a bounded job queue; producers and consumers share one mutex + cond
type Queue struct {
    mu    sync.Mutex
    cond  *sync.Cond
    items []Job
    max   int
}

func (q *Queue) Push(j Job) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == q.max {
        q.cond.Wait()              // releases mu while waiting, re-acquires on wake
    }
    q.items = append(q.items, j)
    q.cond.Broadcast()
}

func (q *Queue) Pop() Job {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.cond.Wait()
    }
    j := q.items[0]
    q.items = q.items[1:]
    q.cond.Broadcast()
    return j
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Trap: this is correct.** It *looks* alarming — producers and consumers blocking inside locked critical sections, `Wait()` calls that appear to hold the mutex while sleeping — but it is the textbook-correct bounded-buffer with a condition variable, and it neither deadlocks nor busy-waits.

Two facts make it safe:

1. **`sync.Cond.Wait()` atomically releases the mutex while it sleeps** and re-acquires it before returning. So a `Push` waiting on a full queue is *not* holding `q.mu` — a `Pop` can proceed, remove an item, `Broadcast`, and wake the producer. No "lock held while blocked" hazard, despite appearances.

2. There is **only one lock**. With a single mutex there is no second lock to acquire in an inconsistent order — **circular wait is impossible** with one lock, so this class of deadlock cannot occur by construction.

3. The `for` loop around `Wait()` (not an `if`) correctly re-checks the predicate after waking, handling spurious wakeups and the "another thread won the race" case. Using `Broadcast` (rather than `Signal`) is conservative but safe.

**The reading lesson:** "a thread blocks inside a locked section" is *not* automatically a bug — condition variables are *designed* to release the lock while waiting. And a single-lock design, however hot, cannot deadlock on lock ordering. Don't flag coordination structures by their silhouette; verify whether the lock is actually held during the wait and whether more than one lock exists.

> The only thing to *consider* (not a correctness bug) is throughput: one mutex serializes push and pop. If profiling shows contention, you'd move to a lock-free ring or split locks — but that's a granularity *optimization*, not a fix for a defect. Correct first; this is correct.

</details>

---

## Snippet 14 — The event bus that fans out under lock

```go
// Go — an in-process event bus delivering to all subscribers synchronously
type Bus struct {
    mu   sync.Mutex
    subs map[string][]chan Event
}

func (b *Bus) Subscribe(topic string) <-chan Event {
    b.mu.Lock()
    defer b.mu.Unlock()
    ch := make(chan Event)            // UNBUFFERED channel
    b.subs[topic] = append(b.subs[topic], ch)
    return ch
}

func (b *Bus) Publish(topic string, e Event) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, ch := range b.subs[topic] {
        ch <- e                       // blocks until a receiver is ready
    }
}
```

> What's the coordination bug? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Holding a Lock During a blocking send — escalating into a deadlock.** `Publish` holds `b.mu` while sending on each subscriber's **unbuffered** channel. An unbuffered send `ch <- e` blocks until some goroutine is ready to receive. So the bus's lock is held for as long as the *slowest subscriber* takes to read — pure "lock held during a blocking operation," with the same throughput-collapse as Snippet 2: one slow consumer stalls all publishing.

It gets worse, because it can fully **deadlock**. Suppose a subscriber's handler, upon receiving an event, calls `b.Subscribe(...)` (e.g., to listen for a follow-up topic) or `b.Publish(...)`:

| Step | Publisher goroutine | Subscriber goroutine |
|---|---|---|
| 1 | `Publish` acquires `b.mu` ✓ | — |
| 2 | `ch <- e` blocks (waiting for receiver) | — |
| 3 | — | receives `e`, handler calls `b.Subscribe` |
| 4 | — | `Subscribe` → wants `b.mu`, blocks |

Now the publisher holds `b.mu` and waits for the subscriber to receive the *next* send (or to drain), while the subscriber holds nothing but is blocked wanting `b.mu` that the publisher won't release until its sends complete. The send and the lock acquisition deadlock against each other — a wait-for cycle that mixes a channel and a mutex. Even with a single subscriber, a handler that re-enters the bus hangs everything.

**Fix — snapshot subscribers under the lock, release it, then deliver; and don't let a slow consumer block the publisher** (use buffered channels or non-blocking sends):

```go
func (b *Bus) Publish(topic string, e Event) {
    b.mu.Lock()
    subs := append([]chan Event(nil), b.subs[topic]...)  // snapshot under lock
    b.mu.Unlock()                                        // release before delivering

    for _, ch := range subs {
        select {
        case ch <- e:                  // deliver without holding b.mu
        default:                       // drop or queue if subscriber is slow; never block the bus
        }
    }
}
```

The lock now guards only the map read; delivery happens lock-free, so a handler may freely call `Subscribe`/`Publish` (no re-entrancy deadlock), and a slow subscriber no longer stalls every other delivery.

> **Combines two patterns:** holding a lock during a blocking operation (the channel send) *and* a callback-induced lock-order inversion (the handler re-entering the bus) — exactly the kind of layered coordination failure that survives code review.

</details>

---

## Summary — how to spot coordination bugs

You don't catch coordination bugs by reading a line — you catch them by **constructing the bad interleaving** and by **tracing locks across function and subsystem boundaries**. The repeatable moves from these fourteen snippets:

- **List the locks each path acquires, in acquisition order.** If two paths take the same two locks in opposite orders, you have a potential **circular wait** — draw the wait-for graph and look for a cycle (Snippets 1, 5, 6, 10, 11). The fix is almost always a **global lock order** keyed on something stable (id, index): always lock the lower one first.
- **Follow the calls made *while a lock is held*.** Any I/O, network call, channel send, or call into foreign/unknown code under a lock is a hazard: it either collapses throughput (Snippets 2, 7, 14) or, if that foreign code re-enters your locks, deadlocks (Snippets 3, 6, 14). The rule: **snapshot what you need under the lock, release, then do the slow/foreign work.**
- **Watch for re-entrancy and lock upgrades.** A non-re-entrant mutex re-locked on the same thread is an instant self-deadlock (Snippets 3, 8-self-case); an `RWMutex` read lock that tries to become a write lock deadlocks against its own readers (Snippet 12). Drop the lock and re-acquire with a double-check instead.
- **Right-size the lock.** One global lock around a hot CPU path or an independent-per-route map throws away all parallelism (Snippets 4, 9); the cure is to shrink the lock to the smallest *consistent* unit and pick the right primitive (atomic counter, RWMutex, immutable snapshot, per-item lock). But beware: **finer locks multiply the ordering obligation** (Snippets 5, 11) — granularity and ordering are not independent decisions.
- **Resist false positives.** A single mutex can never deadlock on lock ordering; a `cond.Wait()` releases its mutex while sleeping; a consistently-ordered two-lock acquire is safe regardless of `defer` order (Snippets 8, 13). Verify the *actual* acquisition order and whether the lock is truly held during a wait — don't flag a structure by its silhouette.

The meta-lesson: **every coordination bug is invisible in any single function.** `Transfer` looks fine; `logout` looks fine; `Publish` looks fine. The defect lives in the *interleaving* of two threads, or in the *transitive call* that reaches a second lock, or in the *load profile* that turns a held lock into a queue. To find it you must simulate two threads at once and trace locks through the calls they make — exactly the muscle these snippets train.

---

## Related Topics

- [`tasks.md`](tasks.md) — small concurrent programs to fix from the writing side.
- [`junior.md`](junior.md) — what a deadlock and a lock-held-during-I/O look like for the first time.
- [`middle.md`](middle.md) — detecting these in review and the safer default patterns.
- [`senior.md`](senior.md) — debugging a deadlock in production and refactoring a contended path.
- [`professional.md`](professional.md) — lock-free alternatives and memory-ordering depth.
- [`optimize.md`](optimize.md) — implementations to make both safe *and* fast.
- [Synchronization Misuse → Find the Bug](../01-synchronization/find-bug.md) — the sibling category (locks and memory primitives applied wrongly).
- [Shared State → Find the Bug](../03-shared-state/find-bug.md) — the sibling category (mutable state crossing threads).
- [Concurrency Roadmap](../../../concurrency/) — the positive patterns and primitives behind these cures.
- [Async Anti-Patterns](../../04-async/README.md) — the event-loop sibling chapter where deadlocks take an async form.
- [Distributed Systems](../../../../../Backend/distributed-systems/README.md) — coordination at the network scale (distributed locks, leader election).
