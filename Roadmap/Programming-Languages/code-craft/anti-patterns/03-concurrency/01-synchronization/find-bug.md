# Synchronization Misuse Anti-Patterns — Find the Bug

> **Category:** [Concurrency Anti-Patterns](../README.md) → **Synchronization Misuse** — *locks and memory primitives applied wrongly.*
> **Covers (collectively):** Double-Checked Locking · Volatile Misuse / Wrong Memory Ordering · Race-Prone Lazy Init

---

This file is **critical-reading practice for races.** Each snippet is a plausible chunk of real Go, Java, or Python. Unlike structural anti-patterns, these are *inherently* bugs — the whole family is about subtle memory-visibility and interleaving failures. Your job is to read each one the way a reviewer who has been burned before does, and answer three questions:

> **What's the race or bug? Under what interleaving does it manifest? How do you fix it?**

The danger of this family is that the code **works almost every time.** A missing memory barrier or a check-then-act gap fails once in millions of runs — on the customer's machine, under load, on a weak-memory CPU (ARM), never on your x86 laptop. You cannot find these by running the code; you find them by *reasoning about the interleaving and the memory model*. That's the skill this file trains.

> **How to use this file:** read each snippet and construct the breaking interleaving *yourself* — write down "Thread A does X, then Thread B does Y" — before expanding the answer. Naming the anti-pattern is worth little; being able to draw the schedule that corrupts state is the whole game.
>
> One snippet is a deliberate **trap**: code that *looks* racy but is actually correct. Train yourself to say "this is fine, and here's precisely why," not to flag everything that touches a shared variable.

---

## Table of Contents

1. [The lazy singleton that skips the lock](#snippet-1--the-lazy-singleton-that-skips-the-lock)
2. [The connection pool everyone shares](#snippet-2--the-connection-pool-everyone-shares)
3. [The shutdown flag](#snippet-3--the-shutdown-flag)
4. [The Java config holder from 2004](#snippet-4--the-java-config-holder-from-2004)
5. [The hit counter that uses atomics](#snippet-5--the-hit-counter-that-uses-atomics)
6. [The sync.Once that wasn't](#snippet-6--the-syncone-that-wasnt)
7. [The volatile balance](#snippet-7--the-volatile-balance)
8. [The metrics registry](#snippet-8--the-metrics-registry)
9. [The correct double-checked lock](#snippet-9--the-correct-double-checked-lock)
10. [The Python lazy cache](#snippet-10--the-python-lazy-cache)
11. [The feature-flag refresh](#snippet-11--the-feature-flag-refresh)
12. [The "atomic" bank transfer](#snippet-12--the-atomic-bank-transfer)
13. [The lazily-built map and its volatile guard](#snippet-13--the-lazily-built-map-and-its-volatile-guard)
14. [The Go double-checked lock with a flag](#snippet-14--the-go-double-checked-lock-with-a-flag)

---

## Snippet 1 — The lazy singleton that skips the lock

```java
// Java — a singleton that "optimizes away" the lock on the hot path
public class Config {
    private static Config instance;

    private final Map<String, String> values;

    private Config() {
        this.values = loadFromDisk();   // ~50ms; runs exactly once, we hope
    }

    public static Config getInstance() {
        if (instance == null) {                 // 1st check, no lock
            synchronized (Config.class) {
                if (instance == null) {          // 2nd check, under lock
                    instance = new Config();     // publish
                }
            }
        }
        return instance;
    }
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Double-Checked Locking, done wrong — the classic Java pre-1.5 bug.** `instance` is not `volatile`.

The line `instance = new Config()` is not atomic. The JVM (and the CPU) may reorder it into roughly:

1. allocate memory for the `Config`,
2. **publish the reference into `instance`**,
3. run the constructor (which sets `values`).

**The breaking interleaving:**
- Thread A enters the lock, reaches step 2 — `instance` now points at a half-built object whose `values` field is still `null`.
- Thread B calls `getInstance()`, sees `instance != null` on the **first check** (no lock, so no happens-before edge with A's constructor), skips the `synchronized` block entirely, and returns the reference.
- Thread B calls `instance.values.get("x")` → **`NullPointerException`** on a `final` field that "can never be null."

Without `volatile`, there is no happens-before relationship between A's write of `values` inside the constructor and B's read of it. B can observe the reference write while *not* observing the field writes. (`final` fields have publication guarantees only under *safe* publication — DCL through a non-volatile field is exactly the unsafe publication that defeats them.)

**Why you never see it on your laptop:** x86 has a strong memory model that rarely reorders stores this way, and the window is nanoseconds wide. It surfaces on ARM/POWER, under JIT optimization, under load.

**Fix — add `volatile`, which inserts the necessary barrier so the reference is published only after the constructor completes:**

```java
private static volatile Config instance;   // the one word that makes DCL correct
```

Or, better, sidestep DCL entirely with the **initialization-on-demand holder** idiom — the JVM guarantees class-init happens-before and lazily:

```java
public class Config {
    private Config() { /* ... */ }
    private static class Holder { static final Config INSTANCE = new Config(); }
    public static Config getInstance() { return Holder.INSTANCE; }
}
```

</details>

---

## Snippet 2 — The connection pool everyone shares

```go
// Go — package-level lazy initialization of a shared DB pool
package store

var pool *ConnPool

func Pool() *ConnPool {
    if pool == nil {
        pool = newConnPool(32)   // opens 32 sockets, starts a health-check goroutine
    }
    return pool
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Race-Prone Lazy Init** — the unguarded `if x == nil { x = make() }` idiom. Two problems, both serious.

**Problem 1 — duplicate initialization (lost work / resource leak).** The breaking interleaving:
- Goroutine A reads `pool == nil` → true, and is paused by the scheduler *before* assigning.
- Goroutine B reads `pool == nil` → still true, calls `newConnPool(32)`, assigns `pool`, returns its pool.
- A resumes, calls `newConnPool(32)` **again**, overwrites `pool`, and returns its own pool.

Now there are **two** pools, each with 32 sockets and a background health-check goroutine. One is reachable via `pool`; the other is orphaned but still holds 32 open file descriptors and a leaked goroutine. Callers who grabbed the first pool and callers who grab the second are using different pools — connection accounting and limits are silently violated. Under a thundering-herd startup (many goroutines calling `Pool()` at once) you can leak dozens of pools.

**Problem 2 — data race on `pool` itself.** Concurrent read and write of the `pool` variable with no synchronization is a data race by the Go memory model; `go test -race` flags it, and the compiler is permitted to do surprising things (e.g. a reader observing a non-nil-but-not-fully-written pointer on a weak-memory arch).

**Fix — `sync.Once` guarantees the initializer runs exactly once with the correct happens-before edge:**

```go
var (
    pool     *ConnPool
    poolOnce sync.Once
)

func Pool() *ConnPool {
    poolOnce.Do(func() { pool = newConnPool(32) })
    return pool
}
```

`Once.Do` blocks all callers until the first invocation completes, and establishes that the initializer's writes *happen-before* every subsequent return — so every caller sees the same fully-constructed pool. This is the canonical Go answer to this whole family.

</details>

---

## Snippet 3 — The shutdown flag

```go
// Go — a worker loop that should stop when asked
type Worker struct {
    stopped bool   // set by Stop(), read by the loop
}

func (w *Worker) Run() {
    for !w.stopped {        // poll the flag
        job := dequeue()
        process(job)
    }
}

func (w *Worker) Stop() {
    w.stopped = true        // flip it from another goroutine
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Wrong Memory Ordering via an unsynchronized flag** (Go's analogue of "volatile misuse" — here the misuse is using a *plain* variable where you need a synchronizing one).

`stopped` is read by `Run`'s goroutine and written by `Stop`'s goroutine with **no synchronization between them.** This is a data race, and the consequence is not just theoretical "undefined behavior" — there is a concrete failure mode:

**The breaking interleaving (a missed-update, effectively infinite loop):** the Go memory model gives the compiler and CPU no reason to ever re-read `w.stopped` from memory inside the loop. A compiler may **hoist the read out of the loop** — load `stopped` once into a register, and loop forever on that cached `false` — because within that goroutine nothing it can see modifies `stopped`. `Stop()` sets the field in memory, but `Run`'s goroutine never observes it. The worker spins forever even though `Stop()` "succeeded." On weak-memory hardware, even without hoisting, the write may simply never become visible to the reading core.

This is the single most common "my goroutine won't stop" bug.

**Fix — use a synchronizing primitive that carries a happens-before edge.** The idiomatic Go answer is a `context` or a `chan struct{}`:

```go
type Worker struct{ done chan struct{} }

func NewWorker() *Worker { return &Worker{done: make(chan struct{})} }

func (w *Worker) Run() {
    for {
        select {
        case <-w.done:
            return
        default:
            process(dequeue())
        }
    }
}

func (w *Worker) Stop() { close(w.done) }   // channel close is a release; the receive is an acquire
```

If you genuinely want a flag, `sync/atomic` (`atomic.Bool`) gives the visibility guarantee a plain `bool` lacks:

```go
var stopped atomic.Bool
for !stopped.Load() { ... }   // Stop(): stopped.Store(true)
```

> **Java note:** the identical bug is the textbook reason `volatile boolean running` exists — a non-`volatile` flag can be hoisted by the JIT into an infinite loop. **Python note:** under CPython's GIL a plain `bool` flag *usually* works because the GIL forces memory coherence and bytecode-level atomicity, so this exact spin-forever rarely bites — but it's still not guaranteed by the language spec, relies on the GIL you may not have (free-threaded 3.13+, or other interpreters), and breaks for compound operations (see Snippet 10).

</details>

---

## Snippet 4 — The Java config holder from 2004

```java
// Java — lifted from a real codebase; the author "knew about" double-checked locking
public class ServiceRegistry {
    private static ServiceRegistry instance;
    private final Map<String, Service> services = new HashMap<>();

    private ServiceRegistry() {
        services.put("auth", new AuthService());
        services.put("billing", new BillingService());
    }

    public static ServiceRegistry get() {
        ServiceRegistry r = instance;          // read once into a local — "for performance"
        if (r == null) {
            synchronized (ServiceRegistry.class) {
                r = instance;
                if (r == null) {
                    r = new ServiceRegistry();
                    instance = r;
                }
            }
        }
        return r;
    }
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Double-Checked Locking, still broken** — *and a snippet designed to fool you,* because the author added the "read into a local `r`" refinement that real DCL guides recommend. That refinement is a genuine *performance* optimization (one volatile read instead of two), but it is **not** the fix. The actual defect is unchanged: **`instance` is not `volatile`.**

The local-variable trick only helps *once the field is already volatile* — it reduces the number of volatile reads. With a plain field, the first read `ServiceRegistry r = instance;` outside the lock still has no happens-before relationship with the constructor that ran inside another thread's lock.

**The breaking interleaving** is exactly Snippet 1's:
- Thread A constructs the registry, the store `instance = r` becomes visible to Thread B *before* the `services.put(...)` writes inside the constructor are visible (allowed reordering / no barrier).
- Thread B's first check reads a non-null `instance`, returns it, calls `get("auth")` on a `HashMap` whose entries aren't there yet → returns `null`, and downstream `NullPointerException`.

The `final`-field publication guarantee does not save you here either: the `services` reference is `final`, but its *contents* are mutated in the constructor; safe publication of `final` fields covers the final reference, not deep mutations, and only under *safe* publication — which non-volatile DCL is not.

**The lesson:** recognizing the DCL *shape* and even applying the local-variable micro-opt is worthless without the one load-bearing keyword.

**Fix:**

```java
private static volatile ServiceRegistry instance;   // <-- the actual fix
// (keeping the local-variable read is fine and slightly faster, but it was never the cure)
```

Or use the holder idiom (Snippet 1) and delete the hand-rolled DCL altogether.

</details>

---

## Snippet 5 — The hit counter that uses atomics

```go
// Go — counting requests across many goroutines
import "sync/atomic"

var hits int64

func handle(w http.ResponseWriter, r *http.Request) {
    atomic.AddInt64(&hits, 1)
    // ... serve the request ...
}

func currentHits() int64 {
    return atomic.LoadInt64(&hits)
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Trap snippet — this is correct.** Resist the urge to flag every shared variable.

`hits` is a *single, independent* counter. Every mutation is a single `atomic.AddInt64` (an indivisible read-modify-write at the hardware level), and every read is an `atomic.LoadInt64`. There is no compound check-then-act, no invariant spanning two variables, no half-constructed object to publish. This is precisely the case `atomic` exists for: an independent counter with no consistency relationship to any other state.

- No lost updates: `AddInt64` is atomic, so two concurrent increments both land (unlike `hits++`, which is a non-atomic read-modify-write and *would* lose updates).
- No torn reads: `LoadInt64` reads the value atomically; you never observe a half-written 64-bit value, even on a 32-bit platform where a plain `int64` read could tear.
- Memory ordering is sufficient *for this use*: a monitoring read of a counter doesn't need to be coherent with any other variable, so you don't need a mutex.

**When it would become a bug:** the moment you make a *decision* that couples `hits` to other state — e.g. `if currentHits() == limit { rejectAll() }` where `rejectAll` reads a second variable — you'd have a check-then-act race (the value can change between the load and the action) and atomics alone would no longer be enough. See Snippet 12 for exactly that mistake.

**The lesson:** "uses a shared variable" is not the diagnostic. "Is there an invariant across multiple operations or variables that the synchronization fails to protect?" is. Here there isn't, so the atomic is right and a mutex would only be slower.

</details>

---

## Snippet 6 — The sync.Once that wasn't

```go
// Go — lazy initialization that "uses Once" but reintroduces the race
type Cache struct {
    once sync.Once
    data map[string]string
}

func (c *Cache) Get(key string) string {
    if c.data == nil {                 // fast path: skip Once if already built
        c.once.Do(func() {
            c.data = loadAll()         // expensive
        })
    }
    return c.data[key]
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Race-Prone Lazy Init dressed up as `sync.Once`** — the author wrapped the init in `once.Do` (good) but then guarded it with an **unsynchronized read of `c.data`** (fatal). It is a hand-rolled, broken double-checked lock layered on top of a primitive that was already correct on its own.

Two distinct races:

**Race 1 — data race on `c.data` (the outer check).** One goroutine writes `c.data` inside `once.Do`; another reads `c.data == nil` in the `if` with no synchronization. That read/write pair has no happens-before edge, so it's a data race (`-race` flags it). On weak hardware the reader can see `c.data` as non-nil while the map's internal fields aren't yet visible — and then `c.data[key]` operates on a half-published map → crash or garbage.

**Race 2 — the final `return c.data[key]` also races.** Even when the `if` is false, the read of `c.data` to index it is *still* unsynchronized with the initializing goroutine's write. `once.Do` only synchronizes goroutines that actually *enter* `Do`; fast-path readers bypass it and get no happens-before guarantee.

**The breaking interleaving:** Goroutine A enters `Get`, `c.data == nil` true, enters `once.Do`, starts building the map. Goroutine B reads `c.data` (the outer `if` or the final return) concurrently — racing A's write — and may read a torn/partial pointer.

**Fix — call `once.Do` *unconditionally*; it is already a fast, correctly-synchronized fast path.** Never put your own nil-check in front of it:

```go
func (c *Cache) Get(key string) string {
    c.once.Do(func() { c.data = loadAll() })   // Do() is cheap after the first call,
    return c.data[key]                          // and establishes happens-before for ALL callers
}
```

`Once.Do` internally does an atomic fast-path check *and* provides the memory barrier; your manual `if c.data == nil` both duplicates the check incorrectly (no barrier) and defeats the guarantee. The whole point of `Once` is that you don't write the double-checked lock yourself.

</details>

---

## Snippet 7 — The volatile balance

```java
// Java — a thread-safe-looking account
public class Account {
    private volatile int balance;

    public Account(int initial) { this.balance = initial; }

    public int balance() { return balance; }

    public void withdraw(int amount) {
        if (balance >= amount) {        // check
            balance = balance - amount; // act
        }
    }
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Volatile Misuse** — treating `volatile` as if it provided **mutual exclusion.** It does not. `volatile` gives you *visibility* and *ordering* for a single read or a single write; it gives you nothing for a **compound check-then-act** like `withdraw`.

`withdraw` is three separate operations: read `balance`, compare, write `balance`. `volatile` makes each individual read and write visible across threads, but it does **not** make the read-compare-write sequence atomic. Two threads interleave freely between the check and the act.

**The breaking interleaving (overdraft / lost update):** start with `balance == 100`; two threads each withdraw 100.
1. Thread A reads `balance` → 100, passes `100 >= 100`.
2. Thread B reads `balance` → 100 (A hasn't written yet), passes `100 >= 100`.
3. Thread A computes `100 - 100 = 0`, writes `balance = 0`.
4. Thread B computes `100 - 100 = 0`, writes `balance = 0`.

Both withdrawals "succeeded," 200 was dispensed against a 100 balance, and the final balance is `0` instead of an impossible `-100`. The overdraft check was bypassed by the interleaving. (The same race produces lost updates for a `balance = balance + amount` deposit.)

**Fix — use mutual exclusion so the check and the act are one atomic unit:**

```java
public class Account {
    private int balance;                         // no longer needs volatile under the lock

    public Account(int initial) { this.balance = initial; }

    public synchronized int balance() { return balance; }

    public synchronized void withdraw(int amount) {
        if (balance >= amount) {
            balance -= amount;
        }
    }
}
```

For a single counter with no check, `AtomicInteger` would do; but here the *check-then-act invariant* ("never go below the requested amount") requires holding exclusivity across both steps — that is what a lock is for and what `volatile` can never provide.

> **Rule:** `volatile` (Java) / `atomic` (Go) is for **publishing a value**, not for **protecting an invariant that spans more than one operation.**

</details>

---

## Snippet 8 — The metrics registry

```go
// Go — lazily register a metric the first time it's used
type Registry struct {
    mu      sync.Mutex
    metrics map[string]*Counter
}

func (r *Registry) Counter(name string) *Counter {
    r.mu.Lock()
    c, ok := r.metrics[name]
    r.mu.Unlock()                       // release before creating — "don't hold the lock during allocation"
    if !ok {
        c = newCounter(name)
        r.mu.Lock()
        r.metrics[name] = c
        r.mu.Unlock()
    }
    return c
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Race-Prone Lazy Init reborn from a dropped lock** — the author correctly used a mutex but then **released it in the gap between the check and the act**, recreating the very race the lock was meant to close. This is a double-checked-locking-style bug expressed with an explicit mutex.

**The breaking interleaving (duplicate metric, lost increments):**
- Goroutine A locks, reads `metrics["qps"]` → `ok == false`, **unlocks**.
- Goroutine B locks, reads `metrics["qps"]` → still `ok == false` (A hasn't inserted yet), unlocks.
- A creates counter `cA`, locks, stores `metrics["qps"] = cA`, unlocks, returns `cA`.
- B creates counter `cB`, locks, stores `metrics["qps"] = cB` (**overwriting `cA`**), unlocks, returns `cB`.

Now two callers hold two *different* `*Counter` objects for the same name. Every increment one of them records is lost from the canonical map entry, and the metric undercounts non-deterministically. (If the counter registered a background flusher, you also leaked a goroutine — cf. Snippet 2.)

The intention — "don't hold the lock while allocating" — is a real concern, but the cure here broke correctness. The check and the insert must be atomic *with respect to each other*.

**Fix — keep the whole check-then-insert under one lock:**

```go
func (r *Registry) Counter(name string) *Counter {
    r.mu.Lock()
    defer r.mu.Unlock()
    if c, ok := r.metrics[name]; ok {
        return c
    }
    c := newCounter(name)
    r.metrics[name] = c
    return c
}
```

If `newCounter` is genuinely expensive and you must not hold the lock across it, the correct pattern is **re-check after re-acquiring** (and discard your speculative object if someone beat you):

```go
func (r *Registry) Counter(name string) *Counter {
    r.mu.Lock()
    if c, ok := r.metrics[name]; ok { r.mu.Unlock(); return c }
    r.mu.Unlock()

    c := newCounter(name)              // expensive work outside the lock

    r.mu.Lock()
    defer r.mu.Unlock()
    if existing, ok := r.metrics[name]; ok {   // someone else won the race
        return existing                         // throw away our c
    }
    r.metrics[name] = c
    return c
}
```

The re-check under the second lock is non-negotiable — it's what makes "check, drop lock, work, reacquire" safe.

</details>

---

## Snippet 9 — The correct double-checked lock

```java
// Java — reviewed in a PR; a reviewer wants to flag it as "the classic DCL bug"
public final class IdGenerator {
    private static volatile IdGenerator instance;
    private final long epoch;

    private IdGenerator() { this.epoch = System.currentTimeMillis(); }

    public static IdGenerator getInstance() {
        IdGenerator local = instance;            // single volatile read
        if (local == null) {
            synchronized (IdGenerator.class) {
                local = instance;
                if (local == null) {
                    local = new IdGenerator();
                    instance = local;            // volatile write — publishes safely
                }
            }
        }
        return local;
    }
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Trap snippet — this DCL is correct.** A reviewer who reflexively shouts "classic DCL bug!" is wrong, and this trains you to check the *one detail that matters* rather than pattern-matching the shape.

Why it's safe:
- `instance` **is `volatile`.** The volatile write `instance = local` is a *release*; the volatile read `IdGenerator local = instance;` is an *acquire*. This establishes a happens-before edge: everything the constructing thread did *before* the volatile write (i.e. setting `epoch`) is visible to any thread that *reads* the non-null `instance`. No half-constructed object can be observed.
- The double check is correct: the outer check avoids locking on the hot path; the inner check (under the lock) ensures only one thread constructs.
- The local-variable read is a legitimate micro-optimization (one volatile read on the fast path instead of two) and does not affect correctness.

Compare directly with Snippet 1 and Snippet 4: those are byte-for-byte the same *shape* but **missing `volatile`** — and that one word is the entire difference between correct and broken. That contrast is the point.

**The lesson:** the diagnostic for DCL is binary and local — *is the published field `volatile` (or an `AtomicReference`, or a `final` field of a safely-published holder)?* If yes, the idiom is sound; if no, it's the publication bug. Don't grade DCL on vibes.

> **Style note, not a correctness issue:** even though this DCL is correct, the initialization-on-demand **holder idiom** is still preferable — it's shorter, impossible to get subtly wrong, and gives the same lazy + thread-safe semantics without any explicit synchronization. Prefer it; reserve hand-written DCL for the rare case where the lazy value depends on a runtime parameter the holder can't capture.

</details>

---

## Snippet 10 — The Python lazy cache

```python
# Python — lazily build an expensive lookup table, shared across threads
import threading

class Geo:
    def __init__(self):
        self._table = None

    def lookup(self, ip):
        if self._table is None:           # check
            self._table = self._build()   # act: ~2s, downloads + parses a GeoIP DB
        return self._table.get(ip)

    def _build(self):
        ...   # returns a dict
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it? (Mind the GIL.)

<details>
<summary>Answer</summary>

**Race-Prone Lazy Init — and a good illustration of what the GIL does and does not protect.**

A common myth is "the GIL makes Python thread-safe, so this is fine." Wrong. The GIL guarantees that a *single bytecode operation* won't be interrupted mid-instruction (so `self._table.get(ip)` won't tear), but it freely switches threads *between* bytecodes. `if self._table is None: self._table = self._build()` is many bytecodes, and `_build()` is a 2-second operation that the GIL is *released* during for I/O.

**The breaking interleaving (duplicate expensive build):**
- Thread A evaluates `self._table is None` → `True`, calls `_build()`, and the GIL is released while it does network I/O.
- Thread B runs, evaluates `self._table is None` → still `True` (A hasn't assigned yet), and *also* calls `_build()`.
- Both download and parse the GeoIP DB (two 2-second builds, double the bandwidth and memory). Whichever assigns last wins; the other's work is discarded.

The result here is wasted work and a transient memory spike rather than corruption — because the GIL *does* make the final pointer assignment and the dict read atomic, so you won't observe a half-built dict the way you would in Java/Go. **That's the GIL's actual contribution: it converts a memory-safety race into a "merely" duplicated-work race.** It does **not** prevent the check-then-act from running twice. (On free-threaded CPython 3.13+ without the GIL, even the memory-safety guarantee weakens.)

**Fix — guard the check-then-act with a lock, and re-check inside it (double-checked, done right):**

```python
import threading

class Geo:
    def __init__(self):
        self._table = None
        self._lock = threading.Lock()

    def lookup(self, ip):
        table = self._table
        if table is None:
            with self._lock:
                if self._table is None:        # re-check under the lock
                    self._table = self._build()
                table = self._table
        return table.get(ip)
```

Or, simplest and idiomatic, let the standard library memoize it for you with built-in locking:

```python
from functools import cached_property   # NB: not thread-safe by itself pre-3.12 nuances
# or, for a module-level singleton:
import functools

@functools.lru_cache(maxsize=1)
def geo_table():
    return _build()      # lru_cache holds a lock around the miss path
```

> The double-checked pattern *is* safe in Python (no weak-memory reordering across the GIL), unlike the naive Java version — another reminder that the right fix is memory-model-specific.

</details>

---

## Snippet 11 — The feature-flag refresh

```java
// Java — feature flags reloaded periodically from a config service
public class Flags {
    private volatile Map<String, Boolean> flags = new HashMap<>();

    // called by a background scheduler every 30s
    public void refresh(Map<String, Boolean> latest) {
        flags.clear();              // mutate the live map in place
        flags.putAll(latest);
    }

    public boolean isOn(String name) {
        return flags.getOrDefault(name, false);   // read by request threads
    }
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Volatile Misuse — the `volatile` protects the *reference*, but the code mutates the *object the reference points to*.** The author reached for `volatile` thinking it made the map thread-safe. It only makes *reassignments of the `flags` field* visible; it does nothing for concurrent access to the `HashMap`'s internals.

`refresh` never reassigns `flags` — it calls `clear()` then `putAll()` on the *same* map instance that request threads are reading via `getOrDefault`. So:

**The breaking interleaving:**
- The scheduler calls `flags.clear()` — for a window, the map is **empty**. A request thread calling `isOn("checkout")` during this window reads `false` for a flag that is actually on → the feature flickers off for some requests every 30 seconds.
- Worse, `HashMap` is not thread-safe. A reader iterating/hashing while `putAll` is resizing the table can hit a corrupted internal state — historically an **infinite loop** during concurrent `HashMap` resize, or a `ConcurrentModificationException`, or simply a wrong/`null` result.

`volatile` gave a false sense of safety: the field is volatile, but the *contents* are mutated unsafely and read unsafely.

**Fix — publish a brand-new immutable map by a single volatile write (copy-on-write).** The volatile reference now does real work: readers either see the old complete map or the new complete map, never a half-cleared one.

```java
public class Flags {
    private volatile Map<String, Boolean> flags = Map.of();

    public void refresh(Map<String, Boolean> latest) {
        this.flags = Map.copyOf(latest);   // build fully, then publish atomically
    }

    public boolean isOn(String name) {
        return flags.getOrDefault(name, false);   // reads a consistent immutable snapshot
    }
}
```

Now `volatile` is used the way it should be: to **publish an immutable value**, with the new map fully constructed *before* the reference is swapped. No reader ever sees a torn or transiently-empty map.

> **Rule restated:** `volatile`/`atomic` protect *the act of swapping a reference*. If you mutate the referent in place, you're back to needing a lock or an immutable-snapshot swap.

</details>

---

## Snippet 12 — The "atomic" bank transfer

```go
// Go — moving money between two atomic balances
import "sync/atomic"

type Bank struct {
    checking atomic.Int64
    savings  atomic.Int64
}

func (b *Bank) Transfer(amount int64) bool {
    if b.checking.Load() >= amount {                  // check
        b.checking.Add(-amount)                       // debit
        b.savings.Add(amount)                         // credit
        return true
    }
    return false
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Using atomics where mutual exclusion was needed** — *combining* Volatile/Atomic Misuse with a check-then-act race across **multiple variables.** Each `atomic` operation is individually correct (cf. Snippet 5), but the *invariants spanning them* are unprotected.

Two layered bugs:

**Bug 1 — check-then-act on `checking` (overdraft).** The `Load() >= amount` check and the `Add(-amount)` debit are separate atomic ops with a gap between them. Two concurrent `Transfer`s when `checking == 100`, each moving 100:
- A loads 100, passes the check.
- B loads 100, passes the check.
- A debits → `checking == 0`.
- B debits → `checking == -100`.

Both "succeeded"; checking is now negative. Atomicity of each op didn't help — the *check and the act* weren't atomic together. (Identical in spirit to Snippet 7's `volatile` overdraft.)

**Bug 2 — no atomicity *across* the two balances (broken invariant + torn reads).** Even with one transferer, the debit and credit are two separate atomic writes. A concurrent auditor doing `checking.Load() + savings.Load()` can observe a moment where checking is already debited but savings is **not yet credited** — money has vanished from the books. The invariant "checking + savings is constant" is violated in every window between the two `Add`s. No per-variable atomic can enforce a relationship *between* variables.

**Fix — a lock makes the check, the debit, and the credit one indivisible transaction:**

```go
type Bank struct {
    mu       sync.Mutex
    checking int64
    savings  int64
}

func (b *Bank) Transfer(amount int64) bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.checking < amount {
        return false
    }
    b.checking -= amount
    b.savings += amount     // debit + credit now atomic together; invariant holds
    return true
}
```

> **Rule:** atomics protect *one independent variable*. The moment correctness depends on a *relationship between two variables* or on a *check-then-act sequence*, you need a lock (or a single atomic CAS loop on a combined value, where applicable). This is the most common way "we used atomics for performance" introduces a money bug.

</details>

---

## Snippet 13 — The lazily-built map and its volatile guard

```java
// Java — lazy, cached parse of a big immutable lookup, "made safe" with a volatile flag
public class Parser {
    private Map<String, Rule> rules;     // the expensive thing
    private volatile boolean ready;      // the guard flag

    public Rule ruleFor(String key) {
        if (!ready) {                    // 1st check (volatile read)
            synchronized (this) {
                if (!ready) {            // 2nd check
                    rules = parseAll();  // build
                    ready = true;        // signal done (volatile write)
                }
            }
        }
        return rules.get(key);           // read the non-volatile field
    }
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Double-Checked Locking with the barrier on the *wrong* field** — a subtle combination of DCL and volatile misuse. The author made the *flag* `volatile` but left the *data* (`rules`) non-volatile, assuming the volatile flag would order the data write too. It almost does — but there's a fast-path hole.

Inside the synchronized block, `rules = parseAll()` happens-before `ready = true` (program order). A reader that does a volatile read of `ready == true` is guaranteed by the acquire/release edge on `ready` to see the `rules` write too — *for readers that go through the `if (!ready)` check.*

**The trap is the fast path's hidden dependency.** The last line `return rules.get(key)` reads `rules` directly. When `ready` is already `true`, this code happens to be safe **only because** every call still performs the `if (!ready)` volatile read first, which acts as the acquire fence before the `rules` dereference. The safety hinges on an *invisible coupling*: every read of `rules` must be preceded by a volatile read of `ready`. Nothing enforces that.

So it is **one refactor from broken.** Cache `ready` into a local, reorder the return above the check, or add another method that reads `rules` without first reading `ready`, and the happens-before edge vanishes — readers then see `rules == null` or a half-built map → `NullPointerException`. Splitting the guard flag from the guarded data is the latent defect.

**Fix — make the *data reference itself* the volatile guard, so there is no separate flag to get out of sync.** Null *is* the "not ready" signal:

```java
public class Parser {
    private volatile Map<String, Rule> rules;   // the reference is the guard

    public Rule ruleFor(String key) {
        Map<String, Rule> r = rules;            // one volatile read
        if (r == null) {
            synchronized (this) {
                r = rules;
                if (r == null) {
                    r = parseAll();
                    rules = r;                  // volatile write publishes the fully-built map
                }
            }
        }
        return r.get(key);                      // reads the local — provably the published map
    }
}
```

Now there's a single volatile field doing both jobs, read into a local exactly once, and the happens-before edge is on the field you actually dereference. Or, again, prefer the **holder idiom** and delete all of this.

</details>

---

## Snippet 14 — The Go double-checked lock with a flag

```go
// Go — a hand-rolled lazy init that mirrors Java's DCL
type Service struct {
    mu    sync.Mutex
    ready bool
    conn  *Conn
}

func (s *Service) Conn() *Conn {
    if !s.ready {                 // fast path, no lock
        s.mu.Lock()
        if !s.ready {
            s.conn = dial()
            s.ready = true
        }
        s.mu.Unlock()
    }
    return s.conn
}
```

> What's the race or bug? Under what interleaving does it manifest? How do you fix it?

<details>
<summary>Answer</summary>

**Double-Checked Locking ported to Go — and broken, because Go has no `volatile` and a plain `bool` carries no happens-before edge.** This is the Go-vs-`sync.Once` contrast: the manual DCL is wrong, the one-liner `sync.Once` is right.

The outer `if !s.ready` reads `ready` **without holding the mutex.** In the Go memory model, a read of `ready` that is not synchronized with the write of `ready` (which happens under the lock in another goroutine) has *no* happens-before relationship. Therefore:

**The breaking interleaving:**
- Goroutine A locks, `s.conn = dial()`, `s.ready = true`, unlocks. These writes are ordered *relative to A*, but A's unlock only synchronizes with a goroutine that subsequently *locks* the same mutex.
- Goroutine B calls `Conn()`, reads `s.ready` on the **fast path without locking.** B may observe `ready == true` (the bool write became visible) while *not* observing the `s.conn = dial()` write — there's no acquire fence on B's unsynchronized read. B falls through and returns `s.conn`, which it sees as `nil` (or a partially-published pointer on weak hardware) → nil dereference downstream.

Equivalently, the concurrent unsynchronized read/write of `ready` (and of `conn`) is a **data race** that `go test -race` reports outright; the compiler is free to assume no race and optimize accordingly.

Go deliberately provides no `volatile`. The language's answer to "lazy-init exactly once with correct visibility" is `sync.Once`, which bakes in both the once-only guarantee *and* the happens-before edge for *all* callers (including the fast path).

**Fix — delete the hand-rolled DCL; use `sync.Once`:**

```go
type Service struct {
    once sync.Once
    conn *Conn
}

func (s *Service) Conn() *Conn {
    s.once.Do(func() { s.conn = dial() })   // exactly-once + happens-before for every caller
    return s.conn
}
```

If you truly need the value to depend on a parameter or to be re-initializable, use a `sync.Mutex` and read `conn` **under the lock** (or `sync/atomic` for the pointer), never on an unsynchronized fast path:

```go
func (s *Service) Conn() *Conn {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.conn == nil {
        s.conn = dial()
    }
    return s.conn       // read under the same lock that guards the write
}
```

> **The contrast to remember:** in Go, manual double-checked locking is *never* the right tool — there's no `volatile` to make it correct. `sync.Once` exists precisely so you never write Snippet 14.

</details>

---

## Summary — how to reason about interleavings

You cannot find these bugs by running the code; the failing schedule appears once in millions of runs, on hardware you don't own. You find them by **reasoning about interleavings and the memory model.** The repeatable moves from these fourteen snippets:

- **Find every check-then-act and ask "what if a thread runs between the check and the act?"** Withdraw (7), transfer (12), lazy-init (2, 6, 8, 10, 14) all break in exactly that gap. If the check and the act must be one indivisible decision, only a lock (or a single CAS) can make them so — `volatile`/`atomic` cannot.
- **For any lazy initialization, draw the schedule where two threads both pass the nil-check.** That's the Race-Prone Lazy Init signature: duplicate connection pools, duplicate metrics, duplicate expensive builds, lost writes (Snippets 2, 6, 8, 10). The cure is `sync.Once` / holder idiom / DCL-done-right — pick the one your language blesses.
- **For Double-Checked Locking, the diagnosis is one local detail: is the published field `volatile` / `AtomicReference` (Java) — or does Go even allow this (no)?** Same shape, opposite verdict: Snippet 9 is correct because of one `volatile`; Snippets 1 and 4 are the classic pre-Java-5 bug because it's missing; Snippet 14 is unfixable-as-written because Go has no `volatile` and wants `sync.Once`.
- **Separate "publish a reference" from "protect the referent."** `volatile`/`atomic` make a *reference swap* visible; they do nothing for in-place mutation of the object (Snippet 11) or for an invariant spanning two variables (Snippet 12). Publish immutable snapshots, or take a lock.
- **Don't put your own check in front of a primitive that already has one.** Wrapping `sync.Once.Do` in an unsynchronized `if x == nil` (Snippet 6) or splitting a `volatile` flag from its data (Snippet 13) reintroduces the race the primitive was built to remove. Call the primitive unconditionally.
- **Resist false positives.** A lone independent counter under `atomic.Add`/`Load` is *correct* (Snippet 5); a correctly-`volatile` DCL is *correct* (Snippet 9). "Touches a shared variable" is not the diagnostic — "is there an unprotected invariant across operations or variables?" is.
- **Know what your platform's memory model and runtime give you.** Go has no `volatile` and demands `sync.Once`/channels/atomics for visibility; Java's `volatile` provides acquire/release on a single field; Python's GIL turns many memory-safety races into mere duplicated-work races but never closes a check-then-act. The right fix is always memory-model-specific.

The meta-lesson: **synchronization that "looks taken" usually wasn't.** A missing `volatile` published a half-built object; a `volatile` flag was mistaken for a lock; atomics protected each variable but not the relationship between them; a dropped lock reopened the very window it guarded. When you see a shared variable, don't ask "does this line look right?" — ask "draw me the interleaving, and show me the happens-before edge that makes it safe." If you can't draw the edge, it isn't there.

---

## Related Topics

- [`tasks.md`](tasks.md) — small concurrent programs to make correct *and* race-free from the writing side.
- [`junior.md`](junior.md) — what each synchronization-misuse bug looks like and why it's so hard to reproduce.
- [`middle.md`](middle.md) — detecting these with the race detector and choosing the safer primitive.
- [`senior.md`](senior.md) — debugging a visibility bug in production and refactoring a hand-rolled DCL.
- [`professional.md`](professional.md) — memory models, acquire/release semantics, and lock-free publication.
- [`interview.md`](interview.md) — Q&A across all levels on synchronization misuse.
- [`optimize.md`](optimize.md) — implementations to make both safe and fast.
- [Coordination Anti-Patterns](../02-coordination/find-bug.md) and [Shared State Anti-Patterns](../03-shared-state/find-bug.md) — the sibling find-bug files in this chapter.
- [Clean Code → Immutability](../../../clean-code/14-immutability/README.md) — eliminating shared mutability so these races can't form.
- [Concurrency Roadmap](../../../../concurrency/README.md) — the positive patterns: `sync.Once`, channels, memory models.
- [Distributed Systems](../../../../../Backend/distributed-systems/README.md) — the same check-then-act races at network scale.
