# Synchronization Misuse Anti-Patterns — Exercises

> **Category:** [Concurrency Anti-Patterns](../README.md) → **Synchronization Misuse** — *hands-on practice fixing locks and memory primitives applied wrongly.*
> **Covers (collectively):** Double-Checked Locking · Volatile Misuse / Wrong Memory Ordering · Race-Prone Lazy Init

---

These are **fix-it** exercises, not recognition quizzes. For each one you get a problem statement, starting code (in Go, Java, or Python — the language varies on purpose), acceptance criteria with hints, and a collapsible solution. The point is to *make the change*: turn a broken double-checked lock into a correct one (or delete it in favor of a safe idiom), replace a race-prone lazy initializer with `sync.Once` or a static holder, and stop using `volatile`/atomics where you needed a lock.

> **How to use this file.** Read the problem, write the fix in your editor *before* opening the solution, then compare. The "why it's correct" note under each solution is the real payload — concurrency is the one domain where code that passes every test you wrote can still be wrong, so the reasoning (the *happens-before* argument) matters more than the diff. A green test suite is not a proof; a memory-model argument is.

> **A word of warning before you start.** You cannot eyeball-verify concurrent code. "It worked when I ran it" means "the race did not lose this time." Treat the [race detector](#exercise-9--catch-the-race-with-the-detector) (`go test -race`, ThreadSanitizer, Java's `jcstress`) as a non-negotiable part of every fix. Refer back to [`junior.md`](junior.md) for what the bugs look like and [`middle.md`](middle.md) for the safe idioms.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Fix the race-prone lazy singleton with `sync.Once`](#exercise-1--fix-the-race-prone-lazy-singleton-with-synconce) | Race-Prone Lazy Init | Go | ★ easy |
| 2 | [Lazy init the Java way — the holder idiom](#exercise-2--lazy-init-the-java-way--the-holder-idiom) | Race-Prone Lazy Init | Java | ★ easy |
| 3 | [The Python lazy init that the GIL does *not* save](#exercise-3--the-python-lazy-init-that-the-gil-does-not-save) | Race-Prone Lazy Init | Python | ★ easy |
| 4 | [Turn the broken DCL into a correct one](#exercise-4--turn-the-broken-dcl-into-a-correct-one) | Double-Checked Locking + Volatile Misuse | Java | ★★ medium |
| 5 | [Delete the DCL — replace with a safe idiom](#exercise-5--delete-the-dcl--replace-with-a-safe-idiom) | Double-Checked Locking | Go | ★★ medium |
| 6 | [`volatile` is not a lock — fix the lost counter](#exercise-6--volatile-is-not-a-lock--fix-the-lost-counter) | Volatile Misuse | Java | ★★ medium |
| 7 | [Atomic load + atomic store ≠ atomic check-then-act](#exercise-7--atomic-load--atomic-store--atomic-check-then-act) | Volatile Misuse / Wrong Ordering | Go | ★★ medium |
| 8 | [Write a correct thread-safe lazy cache](#exercise-8--write-a-correct-thread-safe-lazy-cache) | Race-Prone Lazy Init + DCL | Go | ★★★ hard |
| 9 | [Catch the race with the detector](#exercise-9--catch-the-race-with-the-detector) | detection (all three) | Go | ★★ medium |
| 10 | [Judgment call — when atomics ARE enough](#exercise-10--judgment-call--when-atomics-are-enough) | Volatile Misuse (the *inverse*) | Go | ★★ medium |
| 11 | [The double-checked map cache, done right](#exercise-11--the-double-checked-map-cache-done-right) | DCL + Race-Prone Lazy Init | Java | ★★★ hard |
| 12 | [Compound CAS — atomic without a lock](#exercise-12--compound-cas--atomic-without-a-lock) | Volatile Misuse → correct CAS | Go | ★★★ hard |
| 13 | [Reordering bug you cannot reproduce on x86](#exercise-13--reordering-bug-you-cannot-reproduce-on-x86) | Wrong Memory Ordering | Java | ★★★★ deep |

---

## Exercise 1 — Fix the race-prone lazy singleton with `sync.Once`

**Anti-pattern:** Race-Prone Lazy Init · **Language:** Go · **Difficulty:** ★ easy

The classic check-then-act: two goroutines both observe `instance == nil`, both run the constructor, and one of the two objects is silently discarded — along with any state callers already stored in it.

```go
var instance *Registry

func GetRegistry() *Registry {
	if instance == nil {            // two goroutines can both pass this
		instance = newRegistry()    // ...and both run this; one result is lost
	}
	return instance
}
```

**Acceptance criteria**
- `newRegistry()` runs **exactly once**, no matter how many goroutines call `GetRegistry` concurrently.
- Every caller observes the *same* `*Registry`.
- `go test -race` is clean (there must be no data race on `instance`).
- No bare `if instance == nil` check remains.

**Hint:** Go ships the exact tool for this. `sync.Once.Do(f)` guarantees `f` runs once *and* establishes a happens-before edge: the writes `f` performs are visible to every goroutine that returns from `Do`.

<details>
<summary>Solution</summary>

```go
var (
	once     sync.Once
	instance *Registry
)

func GetRegistry() *Registry {
	once.Do(func() {
		instance = newRegistry()
	})
	return instance
}
```

**Why it's correct.** `sync.Once` solves two problems the original conflated. First, **mutual exclusion**: `Do` uses an internal mutex so the function body runs exactly once even under a stampede of goroutines. Second — and this is the part hand-rolled flags get wrong — **visibility**: the Go memory model guarantees that the completion of `once.Do(f)` *happens-before* the return of any `once.Do(f)` call. So the write to `instance` inside the function is guaranteed visible, fully constructed, to every later caller. There is no torn read, no half-built `Registry`, no second instance.

A common wrong "fix" is `if instance == nil { mu.Lock(); instance = newRegistry(); mu.Unlock() }` — the unsynchronized read before the lock is *still a data race* (see Exercise 4). `sync.Once` exists precisely so you never write that.

</details>

---

## Exercise 2 — Lazy init the Java way — the holder idiom

**Anti-pattern:** Race-Prone Lazy Init · **Language:** Java · **Difficulty:** ★ easy

This singleton lazily builds an expensive `Config` on first access. Two threads racing through `getInstance()` can each build one, and a reader can even see a *non-null but not-yet-constructed* object.

```java
public class Config {
    private static Config instance;

    private Config() { /* expensive: reads files, parses */ }

    public static Config getInstance() {
        if (instance == null) {        // unsynchronized read — race
            instance = new Config();   // unsynchronized write — race + visibility hole
        }
        return instance;
    }
}
```

**Acceptance criteria**
- Initialization is lazy (no `Config` built until first `getInstance()`), thread-safe, and lock-free on the hot path.
- No `synchronized` keyword on the accessor (the point is to avoid locking on every call).
- The construction happens exactly once and is fully visible to all threads.

**Hint:** Java's class-initialization rules already give you a one-time, thread-safe, lazy, lock-free initializer for free. The trick is to put the instance in a *nested static class* that the JVM only loads on first use — the **initialization-on-demand holder** idiom.

<details>
<summary>Solution</summary>

```java
public class Config {
    private Config() { /* expensive setup */ }

    private static class Holder {
        // The JVM initializes Holder on its first active use, under a lock it
        // takes internally — exactly once, with full memory visibility.
        static final Config INSTANCE = new Config();
    }

    public static Config getInstance() {
        return Holder.INSTANCE;   // first call triggers Holder's class init
    }
}
```

**Why it's correct.** The Java Language Specification (§12.4) guarantees that class initialization is **serialized**: the JVM acquires a per-class initialization lock, so `Holder.INSTANCE` is assigned exactly once even under concurrent access, and the JVM releases that lock with a happens-before edge to every thread that subsequently reads the class. Crucially, `Holder` is *not* initialized when `Config` loads — only when `getInstance()` first touches `Holder.INSTANCE` — so initialization stays **lazy**. And because the work happens inside the class initializer, the hot path after the first call is a plain static field read with **no locking at all**. This is strictly better than `synchronized getInstance()` (which locks on every call) and strictly safer than the broken double-checked lock (Exercise 4) — the JVM does the hard memory-model reasoning for you.

</details>

---

## Exercise 3 — The Python lazy init that the GIL does *not* save

**Anti-pattern:** Race-Prone Lazy Init · **Language:** Python · **Difficulty:** ★ easy

"Python has the GIL, so threads can't race" is a half-truth that bites here. The GIL makes individual bytecodes atomic, but `if _conn is None: _conn = connect()` is **many** bytecodes, and the interpreter can switch threads between them.

```python
_conn = None

def get_conn():
    global _conn
    if _conn is None:          # thread A passes here...
        _conn = connect()      # ...switches to thread B, which also passes the check
    return _conn               # connect() runs twice; one connection leaks
```

`connect()` opens a real socket; running it twice leaks a connection and may exhaust the server's pool.

**Acceptance criteria**
- `connect()` runs at most once across all threads.
- The fix does not rely on the GIL for correctness (state the reasoning).
- Works whether or not free-threaded / no-GIL CPython is in play.

**Hint:** the check-and-set must be **one atomic step**. Wrap it in a `threading.Lock`. (For module-level one-time setup you can also lean on import-time execution, but a lock is the direct analogue of the bug.)

<details>
<summary>Solution</summary>

```python
import threading

_conn = None
_lock = threading.Lock()

def get_conn():
    global _conn
    with _lock:
        if _conn is None:
            _conn = connect()
        return _conn
```

If the lock contention on every call bothers you, the *correct* double-checked form in Python is acceptable because the GIL prevents torn reads of an object reference — but the lock-free first check buys little in CPython, so prefer the simple version above unless profiling says otherwise:

```python
def get_conn():
    global _conn
    if _conn is None:           # cheap pre-check; reference read is atomic under CPython
        with _lock:
            if _conn is None:   # re-check while holding the lock
                _conn = connect()
    return _conn
```

**Why it's correct.** The GIL guarantees that a *single* bytecode does not interleave, but `if _conn is None: _conn = connect()` compiles to a `LOAD`, a `COMPARE`, a branch, a `CALL`, and a `STORE`. The interpreter is free to release the GIL (it does so every few thousand bytecodes, and on any blocking call like a socket connect) *between* the check and the store — so two threads can both see `None`. Holding `_lock` for the whole check-then-set makes the compound action atomic with respect to other threads, GIL or no GIL. This is why the fix does not *depend* on the GIL: under free-threaded CPython (PEP 703), where the GIL is gone, the lock is doing all the work and the code is still correct. The double-checked variant is only safe because reading an object reference is itself atomic in CPython; do not generalize that assumption to Java or Go.

</details>

---

## Exercise 4 — Turn the broken DCL into a correct one

**Anti-pattern:** Double-Checked Locking + Volatile Misuse · **Language:** Java · **Difficulty:** ★★ medium

This is the *most famous broken pattern in concurrent programming* — broken in Java before JSR-133 (Java 5) and still broken today if you drop the one keyword that fixes it. Make it correct without removing the double-check optimization.

```java
public class Singleton {
    private static Singleton instance;   // NOT volatile — this is the bug

    public static Singleton getInstance() {
        if (instance == null) {                 // 1st check, no lock
            synchronized (Singleton.class) {
                if (instance == null) {          // 2nd check, under lock
                    instance = new Singleton();  // (a) allocate (b) construct (c) publish
                }
            }
        }
        return instance;
    }
}
```

**Acceptance criteria**
- The double-check (lock-free fast path) is preserved.
- A second thread can **never** observe a non-null `instance` that is not fully constructed.
- Explain *why* the original is broken even though the write happens inside `synchronized`.

**Hint:** the write is inside the lock, but the **first read is not**. One keyword fixes the visibility and ordering. Since Java 5 it actually works; before that, DCL was unfixable in pure Java.

<details>
<summary>Solution</summary>

```java
public class Singleton {
    private static volatile Singleton instance;   // the fix: volatile

    public static Singleton getInstance() {
        if (instance == null) {                    // 1st check (volatile read)
            synchronized (Singleton.class) {
                if (instance == null) {            // 2nd check, under lock
                    instance = new Singleton();    // volatile write publishes safely
                }
            }
        }
        return instance;
    }
}
```

**Why the original is broken.** `instance = new Singleton()` is not one operation. The JVM and CPU may reorder it into: **(1)** allocate memory, **(2)** assign the reference to `instance`, **(3)** run the constructor. A second thread executing the *first*, unsynchronized `if (instance == null)` can observe `instance` after step (2) but before step (3) — a **non-null reference to a half-constructed object**. The `synchronized` block protects the *write* thread, but the reading thread on the fast path never takes the lock, so it sees stale or reordered memory. No amount of locking on the write side fixes a reader that does not synchronize.

**Why `volatile` fixes it.** A `volatile` write has *release* semantics and a `volatile` read has *acquire* semantics. The constructor's writes (step 3) are ordered **before** the volatile write that publishes the reference (step 2 becomes "after" 3 in program-visible order), and any thread that reads the volatile `instance` and sees non-null is guaranteed to also see all writes that happened before the publishing write. That establishes the happens-before edge the broken version lacked. This works only on Java 5+ (JSR-133 redefined `volatile` to provide these guarantees); on older JVMs DCL could not be fixed and the holder idiom (Exercise 2) was the recommended cure. Even today, **prefer the holder idiom** — it is simpler and needs no `volatile`. Correct DCL earns its place only when initialization must be lazy *and* parameterized by a runtime argument.

</details>

---

## Exercise 5 — Delete the DCL — replace with a safe idiom

**Anti-pattern:** Double-Checked Locking · **Language:** Go · **Difficulty:** ★★ medium

Someone ported the Java DCL pattern to Go literally. Go has **no `volatile`**, and a plain bool flag gives you none of the ordering guarantees DCL relies on — so this is broken in a language that does not even have the (fragile) tool to make it work. Don't fix the DCL. *Replace it.*

```go
type Service struct{ /* heavy */ }

var (
	svc      *Service
	svcReady bool          // plain bool — no memory ordering guarantees
	mu       sync.Mutex
)

func Get() *Service {
	if !svcReady {              // unsynchronized read — data race
		mu.Lock()
		if !svcReady {
			svc = newService()
			svcReady = true    // reader may see this true before seeing svc
		}
		mu.Unlock()
	}
	return svc
}
```

**Acceptance criteria**
- No unsynchronized reads of shared variables (`go test -race` clean).
- `newService()` runs exactly once.
- Use the idiomatic Go tool rather than reconstructing DCL with atomics.

**Hint:** Go's answer to "lazy init done once, safely, lock-free on the hot path" is not DCL — it is `sync.Once`. It encapsulates the double-check *and* the memory barriers so you cannot get them wrong.

<details>
<summary>Solution</summary>

```go
type Service struct{ /* heavy */ }

var (
	once sync.Once
	svc  *Service
)

func Get() *Service {
	once.Do(func() { svc = newService() })
	return svc
}
```

**Why it's correct (and why DCL was the wrong instinct).** The broken version has two independent races: the unsynchronized `if !svcReady` read, and — even if that read happened to be safe — the lack of ordering between `svc = newService()` and `svcReady = true`. Because `svcReady` is a plain `bool` with no acquire/release semantics, a reader can observe `svcReady == true` while still seeing `svc == nil` (the compiler or CPU may reorder the two stores, or the reader may see them out of order). Go deliberately provides no `volatile`, so you cannot patch this the Java way.

`sync.Once` is the right tool: internally it does the fast-path atomic check *and* a mutex, and the memory model guarantees that the return of any `Do` happens-after the single execution of `f`. So `svc` is always observed fully constructed. The lesson is general: **when a language gives you a one-shot lazy-init primitive (`sync.Once`, `OnceCell`, `LazyLock`, the holder idiom), reach for it instead of hand-rolling double-checked locking.** Hand-rolled DCL is a microbenchmark optimization that trades a guaranteed-correct primitive for a chance to introduce a memory-ordering bug.

</details>

---

## Exercise 6 — `volatile` is not a lock — fix the lost counter

**Anti-pattern:** Volatile Misuse · **Language:** Java · **Difficulty:** ★★ medium

A developer made the shared counter `volatile` to "make it thread-safe." It compiles, runs, and under load the final count is *less* than the number of increments. `volatile` guaranteed visibility but not atomicity, and `count++` is three operations.

```java
public class Counter {
    private volatile int count = 0;   // volatile ≠ atomic

    public void increment() {
        count++;                      // read, add 1, write — three steps, not one
    }

    public int get() { return count; }
}
```

With 8 threads each calling `increment()` a million times, you expect 8,000,000 and get something like 6,400,000.

**Acceptance criteria**
- After all threads finish, `get()` returns exactly the total number of increments.
- The increment is atomic *and* visible.
- Give two correct fixes and say when you'd pick each.

**Hint:** `count++` is a *compound* action (read-modify-write). `volatile` makes each read and each write individually visible but does nothing to stop two threads interleaving their read-modify-write. You need either real atomicity (`AtomicInteger`) or mutual exclusion (a lock).

<details>
<summary>Solution</summary>

**Fix A — `AtomicInteger` (preferred for a single counter):**

```java
import java.util.concurrent.atomic.AtomicInteger;

public class Counter {
    private final AtomicInteger count = new AtomicInteger();

    public void increment() {
        count.incrementAndGet();   // atomic read-modify-write, lock-free CAS
    }

    public int get() { return count.get(); }
}
```

**Fix B — a lock (preferred when the counter is part of a larger invariant):**

```java
public class Counter {
    private int count = 0;
    private final Object lock = new Object();

    public void increment() {
        synchronized (lock) { count++; }
    }

    public int get() {
        synchronized (lock) { return count; }
    }
}
```

**Why it's correct.** The bug is that `count++` reads `count`, computes `+1`, and writes back as three separate steps. Two threads can both read `41`, both compute `42`, and both write `42` — two increments collapse into one. `volatile` does not help: it guarantees each thread sees the *latest* value at the moment of each read, but two threads can still read the same latest value and clobber each other. `AtomicInteger.incrementAndGet()` performs the whole read-modify-write as one indivisible operation (a CPU compare-and-swap loop under the hood), so no increment is lost. The lock version achieves the same by ensuring only one thread is inside the critical section at a time.

**Which to pick.** Use `AtomicInteger` when the counter is an *independent* value — it is lock-free, scales better under contention, and is exactly the case where atomics shine (see Exercise 10). Use a lock when the counter must change *together with* other state to preserve an invariant (e.g. "decrement `available` and append to `history` atomically") — atomics can only make a *single* variable atomic, and trying to coordinate several with separate atomics recreates the original race (see Exercise 7).

</details>

---

## Exercise 7 — Atomic load + atomic store ≠ atomic check-then-act

**Anti-pattern:** Volatile Misuse / Wrong Memory Ordering · **Language:** Go · **Difficulty:** ★★ medium

Every individual access here uses `atomic.*`, so the author believed it was race-free. But the *logic* is a check-then-act spanning two separate atomic operations, and another goroutine can slip between them. This is the most common way atomics are misused: making each step atomic but the *composition* non-atomic.

```go
import "sync/atomic"

var seats int64 = 1   // one seat left

// Returns true if this caller successfully booked the last seat.
func bookSeat() bool {
	if atomic.LoadInt64(&seats) > 0 {     // check  (atomic)
		atomic.AddInt64(&seats, -1)        // act    (atomic)
		return true                        // ...but the gap between them is not atomic
	}
	return false
}
```

Two goroutines can both pass the `Load > 0` check, both `Add(-1)`, and `seats` ends at `-1` — you sold the same seat twice.

**Acceptance criteria**
- It is impossible to book more seats than exist; `seats` never goes negative.
- Exactly the right number of callers get `true`.
- Use a single atomic operation that does check-and-act together, *or* a lock. No two-step atomic sequence.

**Hint:** the check and the act must be **one** atomic operation. `atomic.CompareAndSwap` does exactly that: it conditionally writes only if the value is what you expect. Loop on it (a CAS loop) to handle the case where another goroutine changed the value first.

<details>
<summary>Solution</summary>

**Fix A — CAS loop (lock-free):**

```go
import "sync/atomic"

var seats int64 = 1

func bookSeat() bool {
	for {
		cur := atomic.LoadInt64(&seats)
		if cur <= 0 {
			return false                 // sold out
		}
		// Only decrement if seats is STILL cur. If another goroutine changed it,
		// CompareAndSwap fails and we retry with the fresh value.
		if atomic.CompareAndSwapInt64(&seats, cur, cur-1) {
			return true
		}
		// CAS failed: someone else booked. Loop, re-read, re-decide.
	}
}
```

**Fix B — a mutex (clearer when logic grows):**

```go
var (
	mu    sync.Mutex
	seats = 1
)

func bookSeat() bool {
	mu.Lock()
	defer mu.Unlock()
	if seats <= 0 {
		return false
	}
	seats--
	return true
}
```

**Why it's correct.** The original made each *access* atomic but left a window between the `Load` and the `Add` where another goroutine could act on the same observed value — the textbook *time-of-check-to-time-of-use* (TOCTOU) race. The CAS version fuses check-and-act: `CompareAndSwapInt64(&seats, cur, cur-1)` atomically verifies that `seats` is *still* `cur` and only then decrements. If a competing goroutine slipped in and changed `seats`, the CAS fails, and the loop re-reads the now-current value and re-decides — so the decrement is conditional on the value not having moved. `seats` can never go below zero because we only decrement when we have just confirmed `cur > 0` *and* that no one else changed it. The mutex version is simpler to reason about and is the better choice the moment "book a seat" also has to, say, append to a passenger list — because then you need *several* variables to change together, which a single CAS cannot express.

</details>

---

## Exercise 8 — Write a correct thread-safe lazy cache

**Anti-pattern:** Race-Prone Lazy Init + Double-Checked Locking · **Language:** Go · **Difficulty:** ★★★ hard

Build, from scratch, a memoizing loader: the first goroutine to ask for a key computes the value (an expensive call); concurrent and later askers for the *same* key wait for and reuse that one result — they must **not** each launch their own computation. This is lazy init generalized to many keys, and it is riddled with race opportunities.

A naive attempt:

```go
type Cache struct {
	mu sync.Mutex
	m  map[string]int
}

func (c *Cache) Get(key string, compute func() int) int {
	c.mu.Lock()
	v, ok := c.m[key]
	c.mu.Unlock()
	if !ok {
		v = compute()          // EXPENSIVE — and N goroutines can all be here at once
		c.mu.Lock()
		c.m[key] = v           // last writer wins; compute ran N times
		c.mu.Unlock()
	}
	return v
}
```

**Acceptance criteria**
- For a given key, `compute` runs **exactly once** even under a concurrent stampede for that key.
- Slow `compute` for key A must **not** block `Get` for key B (no global lock held across `compute`).
- `go test -race` clean.

**Hint:** store a per-key *promise* (a struct with a `sync.Once` or a `done` channel) in the map under the global lock, then run `compute` *outside* the lock, with each waiter blocking on that per-key primitive. This is the safe generalization of `sync.Once`. (`golang.org/x/sync/singleflight` packages exactly this; here you build it.)

<details>
<summary>Solution</summary>

```go
type entry struct {
	once  sync.Once
	value int
}

type Cache struct {
	mu sync.Mutex
	m  map[string]*entry
}

func NewCache() *Cache { return &Cache{m: make(map[string]*entry)} }

func (c *Cache) Get(key string, compute func() int) int {
	// Short critical section: just fetch-or-create the per-key entry.
	c.mu.Lock()
	e, ok := c.m[key]
	if !ok {
		e = &entry{}
		c.m[key] = e
	}
	c.mu.Unlock()

	// compute runs OUTSIDE the global lock, exactly once per entry.
	// Every goroutine sharing this entry blocks inside Do until it completes.
	e.once.Do(func() {
		e.value = compute()
	})
	return e.value
}
```

**Why it's correct.** The design separates two concerns the naive version tangled. The **global mutex** protects only the map's structure and is held for a tiny, constant-time fetch-or-create — so a slow `compute` for key A never blocks `Get` for key B. The **per-key `sync.Once`** provides the lazy-init guarantee for that key: the first goroutine to reach `e.once.Do` runs `compute`; every other goroutine sharing the same `*entry` blocks inside `Do` until it finishes, then returns. `sync.Once` also supplies the happens-before edge, so `e.value` is observed fully written by every waiter — no torn read, no second computation.

The naive version failed on both counts: it released the lock *before* computing, so N goroutines could all find the key missing and all call `compute`; and "last writer wins" meant the work was duplicated and the result nondeterministic. Note one subtlety: if `compute` can fail, `sync.Once` will *not* retry — a failed value is cached forever. Production caches (and `singleflight`) handle that by storing an error and evicting failed entries; that is the next refinement, but the once-per-key skeleton is the load-bearing part.

</details>

---

## Exercise 9 — Catch the race with the detector

**Anti-pattern:** detection (all three) · **Language:** Go · **Difficulty:** ★★ medium

You inherited the lazy initializer below. It passes its unit test every time you run it, and a reviewer insists "it works, ship it." Your job is to **prove** there is a race using tooling, not argument — then state the fix.

```go
// config.go
var cfg *Config

func Load() *Config {
	if cfg == nil {
		cfg = readConfig()   // suspected race
	}
	return cfg
}
```

```go
// config_test.go — passes every run; absence of failure is NOT absence of a race.
func TestLoad(t *testing.T) {
	if Load() == nil {
		t.Fatal("nil config")
	}
}
```

**Acceptance criteria**
- Write a test that *exercises concurrency* (the original never spawns a second goroutine, so the detector has nothing to flag).
- Run it under the race detector and show the kind of report it produces.
- State the minimal fix and confirm the detector then goes silent.

**Hint:** the race detector only reports races it actually *observes* at runtime — it cannot find a race a sequential test never triggers. You must launch concurrent goroutines that hit `Load` simultaneously, then run `go test -race`.

<details>
<summary>Solution</summary>

**Step 1 — a test that actually races:**

```go
func TestLoadConcurrent(t *testing.T) {
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = Load()           // many goroutines hit the unsynchronized cfg
		}()
	}
	wg.Wait()
}
```

**Step 2 — run it under the detector:**

```bash
go test -race -run TestLoadConcurrent ./...
```

**Step 3 — read the report.** The detector prints something like:

```
==================
WARNING: DATA RACE
Write at 0x00c0000b4010 by goroutine 8:
  myapp.Load()
      config.go:6 +0x...

Previous read at 0x00c0000b4010 by goroutine 7:
  myapp.Load()
      config.go:5 +0x...
==================
--- FAIL: TestLoadConcurrent
    testing.go: race detected during execution of test
```

It names the conflicting accesses (the unsynchronized read at line 5 and write at line 6 of `cfg`), the goroutines, and the stacks — exact coordinates, not a guess.

**Step 4 — the fix and re-run.** Replace the bare check-then-set with `sync.Once`:

```go
var (
	once sync.Once
	cfg  *Config
)

func Load() *Config {
	once.Do(func() { cfg = readConfig() })
	return cfg
}
```

Re-run `go test -race` — the warning is gone.

**Why this matters.** The reviewer's "it works" is the central fallacy of concurrency: the original sequential test could *never* fail, because it never created a second goroutine to conflict with. A race is a property of *concurrent* executions, so you must write a test that creates concurrency before any detector can see the bug. The race detector (Go's `-race`, built on ThreadSanitizer; Java's `jcstress`; C/C++ TSan) instruments memory accesses and reports a race the moment it *observes* two unsynchronized conflicting accesses with no happens-before edge between them — turning a once-in-a-million heisenbug into a deterministic, located failure. Make `-race` part of CI; a green normal run is not evidence of correctness.

</details>

---

## Exercise 10 — Judgment call — when atomics ARE enough

**Anti-pattern:** Volatile Misuse (the *inverse* — over-locking) · **Language:** Go · **Difficulty:** ★★ medium

The previous exercises beat the drum that "atomics aren't a lock." This one is the counterweight: a reviewer flagged the code below and demanded a `sync.Mutex` around the flag "to be safe." That would be **overkill** — and it would teach the wrong lesson. Decide whether the atomic is sufficient, and justify it.

```go
import "sync/atomic"

type Worker struct {
	stop atomic.Bool   // set once to signal shutdown; read in the loop
}

func (w *Worker) Shutdown() { w.stop.Store(true) }

func (w *Worker) Run() {
	for !w.stop.Load() {      // single independent flag, no compound logic
		doOneUnitOfWork()
	}
}
```

**Acceptance criteria**
- Decide: is the `atomic.Bool` correct here, or is a lock required?
- Justify with the memory-ordering reasoning — what guarantee does the loop reader need, and does the atomic provide it?
- Note the specific condition under which you'd *upgrade* to a lock.

<details>
<summary>Solution</summary>

**Verdict: the `atomic.Bool` is correct and a mutex would be pure overhead. Keep the atomic.**

```go
// Unchanged — this is already right.
type Worker struct {
	stop atomic.Bool
}

func (w *Worker) Shutdown() { w.stop.Store(true) }

func (w *Worker) Run() {
	for !w.stop.Load() {
		doOneUnitOfWork()
	}
}
```

**Why the atomic is sufficient.** This is the case atomics were built for: a **single, independent variable** with **no check-then-act** and **no invariant tying it to other state**. The reader needs exactly one guarantee — that when `Shutdown` calls `Store(true)`, the loop's `Load()` will *eventually* observe `true` and stop. `atomic.Bool` provides precisely that: `Store`/`Load` are atomic and carry the memory ordering (Go's atomics are sequentially consistent) that guarantees the write becomes visible to the reading goroutine. There is no compound operation to make non-atomic, no second variable that must change in lockstep, so there is no TOCTOU window for a lock to close.

A `sync.Mutex` here would add lock/unlock overhead on *every loop iteration* (potentially millions of times) to protect a single boolean that has no companion invariant — solving a problem that does not exist, while making the hot loop slower and the code noisier.

**The contrast that makes the rule clear.** Compare with Exercise 7: there, the atomic was *insufficient* because the logic was check-then-act across a value, so two atomic ops still raced. The discriminating question is: **"Is this one independent variable, or part of a compound action / multi-variable invariant?"** One independent flag or counter → atomic is the right, efficient tool (this exercise, and `AtomicInteger` in Exercise 6 Fix A). A compound action or several variables that must move together → you need a lock (Exercise 7 Fix B). Reaching for a mutex reflexively is the *inverse* of volatile-misuse: instead of using a weak primitive where you needed a strong one, you use a heavy primitive where a light one was provably enough.

**When you'd upgrade.** The moment shutdown must change *more than this one flag* atomically — e.g. set `stop = true` **and** record a shutdown timestamp **and** drain a queue as one consistent step — a single `atomic.Bool` can no longer express the invariant, and a mutex (or a higher-level construct like a `context.Context` for cancellation) becomes the correct tool.

</details>

---

## Exercise 11 — The double-checked map cache, done right

**Anti-pattern:** Double-Checked Locking + Race-Prone Lazy Init · **Language:** Java · **Difficulty:** ★★★ hard

This per-key lazy cache uses a plain `HashMap` with a hand-rolled double-check. It has two distinct bugs: `HashMap` is not safe for concurrent structural modification (a resize during a concurrent put can corrupt the table or even spin forever), and the lock-free `get` races with the locked `put`.

```java
public class TokenCache {
    private final Map<String, Token> cache = new HashMap<>();   // not thread-safe

    public Token get(String key) {
        Token t = cache.get(key);          // unsynchronized read of a HashMap being mutated
        if (t == null) {
            synchronized (this) {
                t = cache.get(key);        // re-check under lock
                if (t == null) {
                    t = mint(key);         // expensive
                    cache.put(key, t);     // structural modification
                }
            }
        }
        return t;
    }
}
```

**Acceptance criteria**
- Concurrent `get` calls for different keys do not serialize on a single lock.
- `mint(key)` runs at most once per key under a stampede for that key.
- No unsynchronized access to a map that another thread may be structurally modifying.

**Hint:** `ConcurrentHashMap.computeIfAbsent` is the holder-idiom-for-maps — it does the atomic check-and-insert *and* runs the mapping function at most once per key, all without a global lock.

<details>
<summary>Solution</summary>

```java
import java.util.concurrent.ConcurrentHashMap;

public class TokenCache {
    private final ConcurrentHashMap<String, Token> cache = new ConcurrentHashMap<>();

    public Token get(String key) {
        return cache.computeIfAbsent(key, this::mint);
    }

    private Token mint(String key) { /* expensive */ }
}
```

**Why it's correct.** `ConcurrentHashMap` is built for concurrent access: reads are lock-free and never see a corrupted table, and writes lock only the relevant bin, so `get("a")` and `get("b")` proceed in parallel instead of serializing on one monitor. `computeIfAbsent` is the key move — it atomically checks for the key and, if absent, runs the mapping function and inserts the result as **one** operation, with the contract that for a given key the function is invoked **at most once** even under a concurrent stampede; other threads asking for the same key block on that bin until the value is ready, then read it. That is exactly the per-key lazy-init guarantee the hand-rolled DCL was trying (and failing) to provide.

The original had two independent defects. First, the **unsynchronized `cache.get(key)`** read a `HashMap` that another thread might be resizing — undefined behavior ranging from a stale read to a corrupted bucket chain (the infamous infinite loop on concurrent resize in older JDKs). Second, even ignoring the map type, the lock-free first read raced with the locked `put`, the same publication hole as Exercise 4. `computeIfAbsent` on a `ConcurrentHashMap` dissolves both: the right *data structure* removes the need to hand-roll the synchronization at all. One caveat: the mapping function must not try to update the *same* map (it can deadlock/loop); compute the value purely, as `mint` does.

</details>

---

## Exercise 12 — Compound CAS — atomic without a lock

**Anti-pattern:** Volatile Misuse → correct CAS · **Language:** Go · **Difficulty:** ★★★ hard

You must maintain running statistics — a count *and* a max — that update together on every event. The first attempt uses two separate atomics, but "atomic count" plus "atomic max" is not an atomic *pair*, and the max update is itself a check-then-act. Make the update correct and lock-free, then say when you'd just use a lock.

```go
import "sync/atomic"

var (
	count atomic.Int64
	max   atomic.Int64
)

func record(v int64) {
	count.Add(1)                 // fine on its own
	if v > max.Load() {          // check...
		max.Store(v)             // ...act — racy: two goroutines both see v > max,
	}                            // a smaller v can clobber a larger one stored between
}
```

Two goroutines with values 10 and 7 can both read `max == 5`, both decide to store, and the `7` can land *after* the `10` — leaving `max == 7`, losing the true maximum.

**Acceptance criteria**
- `max` always ends as the true maximum of all recorded values.
- The max update is lock-free (a CAS loop), not a Load-then-Store.
- State explicitly when a single lock around both fields would be the better engineering choice.

<details>
<summary>Solution</summary>

```go
import "sync/atomic"

var (
	count atomic.Int64
	max   atomic.Int64
)

func record(v int64) {
	count.Add(1)   // an independent counter — atomic Add is correct (cf. Exercise 6/10)

	// Lock-free max via a CAS retry loop.
	for {
		cur := max.Load()
		if v <= cur {
			return            // already covered; nothing to do
		}
		if max.CompareAndSwap(cur, v) {
			return            // we raised the max; done
		}
		// CAS failed: another goroutine moved max between our Load and CAS.
		// Loop, re-read cur, and re-check whether v is still the larger value.
	}
}
```

**Why it's correct.** The original `if v > max.Load() { max.Store(v) }` is a check-then-act with a gap: between the `Load` and the `Store`, another goroutine can install a *larger* value that the `Store` then overwrites with a smaller one. The CAS loop closes the gap. `CompareAndSwap(cur, v)` writes `v` **only if** `max` is *still* the `cur` we just read; if a competitor changed `max` in between, the CAS fails and we loop, re-reading the now-current value. On retry we re-evaluate `v <= cur` — so if the competitor already raised `max` above `v`, we correctly bail out. The loop therefore converges on the true maximum: every value that is genuinely the largest-so-far is installed, and no smaller value can clobber a larger one, because every write is conditional on the value not having moved. `count` stays a plain `atomic.Add` — it is an independent counter with no compound logic, exactly the Exercise 10 case.

**When to use a lock instead.** This CAS loop is correct but it only makes *one* variable's update atomic at a time. If your invariant ever requires `count` and `max` (and perhaps a sum, a min, a histogram) to be read or updated as **one consistent snapshot** — e.g. a `Stats()` method that must return a count and max that belong to the same instant — then no number of independent CAS loops can give you that; you need a single `sync.Mutex` (or `sync.RWMutex`) guarding all the fields together. The CAS approach wins only while each field is genuinely independent; the moment they form a joint invariant, the lock is both correct *and* simpler.

</details>

---

## Exercise 13 — Reordering bug you cannot reproduce on x86

**Anti-pattern:** Wrong Memory Ordering · **Language:** Java · **Difficulty:** ★★★★ deep

This is the deep end: a bug that passes every test on your x86 laptop and CI, then corrupts data in production on ARM (or under a JIT that reorders aggressively). Two threads communicate a payload through a "ready" flag, but neither field is `volatile`, so there is *no happens-before edge* — and weakly-ordered hardware is free to make the reader see `ready == true` while `data` is still `0`.

```java
public class Handoff {
    private int data = 0;        // not volatile
    private boolean ready = false; // not volatile

    // Producer thread:
    public void produce() {
        data = 42;       // (1)
        ready = true;    // (2)  — may be reordered before (1), or made visible out of order
    }

    // Consumer thread:
    public int consume() {
        while (!ready) { /* spin */ }   // sees ready == true...
        return data;                    // ...but may STILL read data == 0
    }
}
```

On x86 (strong memory model) this almost always "works," hiding the bug. On ARM/POWER, or after JIT reordering, `consume()` can return `0`.

**Acceptance criteria**
- `consume()` must return `42` whenever it observes `ready == true`, on *every* architecture.
- Establish a happens-before edge between the producer's write of `data` and the consumer's read of `data`.
- Explain why x86 hides the bug and why that makes it dangerous.

**Hint:** you need a *release/acquire* pairing. Making the **flag** `volatile` is enough — a `volatile` write of `ready` releases all prior writes (including `data`), and a `volatile` read that sees `true` acquires them. The flag is the synchronization point; `data` rides along.

<details>
<summary>Solution</summary>

```java
public class Handoff {
    private int data = 0;
    private volatile boolean ready = false;   // volatile flag = release/acquire fence

    public void produce() {
        data = 42;        // (1) ordinary write
        ready = true;     // (2) volatile write — RELEASES (1)
    }

    public int consume() {
        while (!ready) { /* spin — volatile read each time */ }
        return data;      // guaranteed to see 42
    }
}
```

`data` does **not** need to be `volatile` — only the flag does. (Spinning is itself an anti-pattern — busy-waiting — but it is orthogonal here; the memory-ordering fix is the same whether you spin or block on a condition.)

**Why it's correct.** Under the Java Memory Model, a `volatile` write has **release** semantics: every write that precedes it in program order (here, `data = 42`) is guaranteed to be visible to any thread that performs a **volatile read** of the same field and sees the written value. The consumer's `while (!ready)` does a volatile read each iteration; the moment it observes `ready == true`, an *acquire* fence guarantees that all writes the producer made *before* its release write — including `data = 42` — are now visible. So `return data` cannot read the stale `0`. The single `volatile` flag establishes the happens-before edge; `data` is published "for free" by riding behind the release write.

**Why x86 hides it — and why that is dangerous.** x86 has a *strong* memory model (TSO): it does not reorder stores past other stores, nor loads past loads, in the ways that would expose this bug, so the non-volatile version appears to work on every Intel/AMD machine you test on. The instant the same byte-for-byte code runs on a *weakly-ordered* CPU — ARM, POWER, RISC-V — the hardware *is* permitted to make `ready`'s store visible before `data`'s, and the consumer reads `0`. Worse, even on x86 the **JIT compiler** is allowed to reorder the two ordinary writes, because without `volatile` the JMM imposes no ordering between them. The danger is precisely that the bug is *invisible to testing on your dev hardware* and only manifests in a production fleet you may not control — the canonical reason to reason from the **memory model**, not from "it passed on my machine." Correct concurrency is proven by a happens-before argument, never by a green run on one architecture.

</details>

---

## Summary

- **Reach for the one-shot primitive, never hand-rolled DCL.** `sync.Once` (Go), the initialization-on-demand **holder idiom** (Java), `OnceCell`/`LazyLock` (Rust), `ConcurrentHashMap.computeIfAbsent` for per-key caches — each encapsulates the double-check *and* the memory barriers so you cannot get the ordering wrong. Correct DCL with `volatile` exists (Exercise 4) but is justified only for lazy, parameterized init; otherwise it is a microbenchmark optimization that buys a memory-ordering bug.
- **`volatile`/atomic gives visibility, not atomicity.** `count++` and `if v > max { max = v }` are *compound* actions; making each access atomic leaves a check-then-act gap (Exercises 6, 7, 12). Fix with a single read-modify-write primitive (`incrementAndGet`, a **CAS loop**) or a lock.
- **Atomics ARE the right tool for a single independent variable.** A lone shutdown flag or an independent counter needs no mutex (Exercise 10); reaching for a lock there is the *inverse* misuse — heavy machinery where a light, provably-sufficient primitive sufficed. The discriminating question: *one independent variable, or a multi-variable invariant?* The latter needs a lock.
- **The GIL does not make Python lazy-init safe** (Exercise 3): check-then-set is many bytecodes and the interpreter switches between them. Hold a lock.
- **Prove correctness with the race detector and a memory-model argument, not a green run.** A sequential test can never expose a race (Exercise 9); x86's strong ordering hides reordering bugs that surface on ARM (Exercise 13). Make `go test -race` / ThreadSanitizer / `jcstress` part of CI, and verify with a *happens-before* argument — concurrent code that passes every test you wrote can still be wrong.

---

## Related Topics

- [`junior.md`](junior.md) — what each bug looks like and why it is hard to reproduce.
- [`middle.md`](middle.md) — detection and the safe idioms used here.
- [`find-bug.md`](find-bug.md) — spot-the-race snippets (critical reading practice).
- [`optimize.md`](optimize.md) — more implementations to make safe *and* fast.
- [`interview.md`](interview.md) — Q&A across all levels for job prep.
- [Concurrency Anti-Patterns](../README.md) — the chapter overview and how the three categories relate.
- [Async Anti-Patterns](../../04-async/README.md) — the single-threaded event-loop sibling chapter.
- [Clean Code → Immutability](../../../clean-code/14-immutability/README.md) — the deeper cure: state that cannot be shared mutably cannot be synchronized wrongly.
