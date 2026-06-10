# Lazy Initialization — Interview Questions

> **Category:** [Object & State Patterns](../README.md) — defer creating an expensive value until first use, then cache it.

---

## Junior Questions (10)

### J1. What is lazy initialization?

**Answer:** Deferring the creation/computation of a value until the first time it's actually accessed, then caching it so later accesses are free.

### J2. How is it different from eager initialization?

**Answer:** Eager computes the value at construction time; lazy computes it on first access. Eager pays up front and always; lazy pays once, later, and only if used.

### J3. What does the cached value's backing field look like before first access?

**Answer:** Empty — `null`/`None`/zero, or guarded by an `initialized` boolean meaning "not computed yet."

### J4. Why not always use `null` as the "not computed" marker?

**Answer:** If the computed value can legitimately be `null`, the guard `if (x == null)` recomputes forever. Use a separate boolean flag.

### J5. Give a real-world example of lazy initialization.

**Answer:** ORM lazy loading (`order.getItems()` queries on first access), lazy singletons, a regex compiled on first use, a thumbnail rendered on first view.

### J6. What's the Python idiom for a lazy attribute?

**Answer:** `functools.cached_property` — computes on first access, stores in the instance dict, returns the cached value thereafter.

### J7. What's the Go idiom?

**Answer:** `sync.Once` (or `sync.OnceValue`) backing an accessor — runs the init exactly once, safely, even under concurrency.

### J8. What does lazy init trade away?

**Answer:** A first-access latency spike and held memory, in exchange for cheaper construction/startup.

### J9. What's the difference between lazy init and memoization?

**Answer:** Lazy init caches one fixed value; memoization caches many results keyed by input. Lazy init is the single-key case.

### J10. A getter recomputes the value every call. Is that lazy init?

**Answer:** No — without caching it's just a slow getter. Lazy init *stores* the result on first computation.

---

## Middle Questions (10)

### M1. When should you choose lazy over eager?

**Answer:** When the value is expensive, often unused, and construction is on a hot/startup path — and a one-time first-access spike is acceptable.

### M2. When should you NOT use lazy init?

**Answer:** When the value is cheap, always used, or on a latency-critical path where an unpredictable spike is unacceptable. Default to eager.

### M3. What is the N+1 query problem?

**Answer:** Iterating N parent rows and lazily loading each one's relation fires 1 + N queries instead of 2. Caused by lazy loading on a known iteration path; fixed by eager-fetching (`JOIN FETCH`, `prefetch_related`, `selectinload`).

### M4. What is `LazyInitializationException`?

**Answer:** Hibernate throws it when you access a lazy association after the persistence session has closed — the proxy has no live session to load through. It signals a data-access boundary leak.

### M5. Why might you cache the *failure* of a lazy init?

**Answer:** To fail fast forever instead of retrying a permanently-broken init on every call. The alternative (leave field empty) retries — choose based on whether the failure is transient.

### M6. What is a Value Holder?

**Answer:** A small wrapper object whose sole job is to hold a value and produce it lazily on first `get()`. The reusable building block ORMs and proxies use.

### M7. How does `functools.cached_property` store its result?

**Answer:** In `instance.__dict__` under the attribute's name; that dict entry then shadows the descriptor, so later reads are plain dict lookups.

### M8. Is `cached_property` thread-safe?

**Answer:** No — since Python 3.12 it has no internal lock. Two threads may compute concurrently; one wins. Add a `threading.Lock` if you need safety and construction isn't idempotent.

### M9. What's a Virtual Proxy?

**Answer:** The GoF object form of lazy init: a stand-in implementing the real object's interface that loads the real object on first method call. ORMs generate these.

### M10. How do you refactor an eager field to lazy without touching callers?

**Answer:** First route reads through an accessor (self-encapsulation), then move the construction into the accessor behind a "not computed" guard. No call site changes.

---

## Senior Questions (10)

### S1. What exactly races in naive lazy init?

**Answer:** Two things: (1) duplicate construction — two threads both see "not computed" and both build; (2) unsafe publication — `new Heavy()` isn't atomic, so another thread can observe the reference before the constructor finishes and read a half-constructed object.

### S2. What is double-checked locking?

**Answer:** Check the field unsynchronized; if empty, lock and re-check before constructing. Goal: pay the lock only on first init, then read lock-free.

### S3. Why was DCL broken before Java 5?

**Answer:** The unsynchronized read had no happens-before edge with the write. The old memory model allowed reordering so the reference published before the constructor finished — readers saw a half-built object.

### S4. What fixes DCL?

**Answer:** Declaring the field `volatile`. Under JSR-133 (Java 5+), a volatile write happens-before every subsequent volatile read, forbidding the reordering. DCL is correct **iff** the field is volatile.

### S5. Explain the initialization-on-demand holder idiom.

**Answer:** Put the instance in a static field of a nested holder class. The JVM initializes that class lazily, on first use, under its own lock with happens-before guarantees — exactly once. Lazy, thread-safe, and after init it's a plain static read with no barrier.

### S6. Why is the holder idiom faster than volatile DCL?

**Answer:** After class init, the JIT proves the class is initialized and elides the guard — `Holder.INSTANCE` becomes a plain static load with no barrier. Volatile DCL keeps a volatile (acquire) load on every access, which is a real cost on ARM.

### S7. How does `sync.Once` guarantee correctness?

**Answer:** It's DCL with an atomic `done` flag set *after* `f()` returns; concurrent callers block on a mutex until init completes. `Do` returning establishes a happens-before edge to all observers.

### S8. Does the GIL make Python lazy init thread-safe?

**Answer:** No. `if x is None: x = compute()` spans many bytecodes; a thread switch between check and assign lets two threads both compute. You need a lock (DCL works because CPython reference assignment is atomic).

### S9. When is eager initialization the better engineering choice?

**Answer:** When the value is always used, when you need flat/predictable latency, when you want a `final`/immutable field, or when fail-fast-at-startup on bad config is desirable.

### S10. How does lazy loading leak architecture?

**Answer:** It hides I/O behind a field access. When a view-layer template touches a lazy field it triggers a DB query — persistence concern bleeding into the view — and across a closed session it throws `LazyInitializationException`. The fix is deciding the loading boundary explicitly (eager fetch, DTO/projection).

---

## Professional Questions (10)

### P1. Why does the holder idiom have zero steady-state read cost?

**Answer:** The JVM holds the init lock only during first class initialization. Afterward the class is marked initialized and the JIT compiles the holder read to a plain static load — no lock, no barrier, no flag check.

### P2. What does a `volatile` read actually emit on x86 vs ARM?

**Answer:** On x86 (TSO), a volatile read is an ordinary `MOV` plus a compiler reordering barrier — nearly free. On ARM (weak memory), it's a real load-acquire (`LDAR`) with measurable cost. The volatile *write* is the expensive side on both.

### P3. Walk through `sync.Once`'s fast path.

**Answer:** `Do` first does `done.Load()`; if nonzero it returns immediately (one atomic load). Only the zero case enters `doSlow`, which locks, re-checks `done`, runs `f()`, and stores `done=1` after `f` returns.

### P4. How does `cached_property` achieve a lock-free steady state?

**Answer:** It's a non-data descriptor. On first access it writes the result into the instance `__dict__`; that entry then takes priority over the descriptor, so later reads never invoke `__get__` — they're plain dict lookups.

### P5. Model the startup-vs-first-access trade-off.

**Answer:** With construction cost `C`, access probability `p`, and `N` objects: eager total = `N·C` on the critical path; lazy total = `p·N·C` spread out. Lazy wins total work when `p<1`, but adds spiky tail latency — mitigate by warming critical lazies at startup.

### P6. How do soft references change lazy init?

**Answer:** Holding the value via a `SoftReference` turns lazy init into a recomputable cache: the GC may reclaim it under pressure and the next access rebuilds. Caveat: soft refs survive until near-OOM, which can worsen GC pressure.

### P7. Does lazy init reduce memory?

**Answer:** Only if the value is never built. Once built it's reachable from its owner and retained just as long as eager — lazy delays the allocation, it doesn't shrink retention.

### P8. Why can naive `synchronized` getters be a performance bug?

**Answer:** They lock on *every* access, not just first init — ~15–18 ns per call vs ~0.4 ns for a plain field read. That can cost more than the construction you deferred. Use DCL/holder/`Once` to make the steady-state path lock-free.

### P9. How do you warm a lazy value without losing laziness's benefit?

**Answer:** After startup, touch the critical lazy values from a background thread/goroutine. You skip building genuinely-unused ones (laziness) while ensuring the first real request doesn't eat the construction spike (eager-like latency).

### P10. What's the risk of caching exceptions in lazy init?

**Answer:** If init throws and the cache records that (e.g., `sync.Once` won't re-run), the object is permanently broken even if the failure was transient. If it doesn't cache, a real failure retries forever. Pick a policy and test it.

---

## Trick Questions (5)

### T1. Is a lazy getter a pure function?

**No.** It mutates internal cache state on first call. It's a command-that-returns, not a pure query — which is why the field can't be `final`.

### T2. Does Python's GIL make `if x is None: x = f()` atomic?

**No.** It spans multiple bytecodes; a thread switch in between allows a race. The GIL serializes single bytecodes, not multi-step logic.

### T3. Is DCL without `volatile` ever correct in Java?

**No** (for object references). Without `volatile` there's no happens-before edge, so readers can see a partially constructed object. It may *appear* to work and fail under load.

### T4. Is lazy init the same as the Singleton pattern?

**No, but they overlap.** Singletons are *often implemented* with lazy init (instance built on first `getInstance()`), but lazy init applies to any field/value, and a singleton can also be eager.

### T5. Does `lru_cache(maxsize=None)` on a no-arg method give lazy init?

**Effectively yes**, but it hashes and dict-looks-up a (self) key on every call (~120 ns) — `cached_property` is the right, faster tool for the single-value case.

---

## Behavioral Questions (5)

### B1. Tell me about a time lazy loading caused a production issue.

**Sample:** "A dashboard looped over orders and touched `getLineItems()` per row — classic N+1, ~400 queries per page load. We added `JOIN FETCH` on that path and cut it to two queries; p95 dropped from 1.8 s to 90 ms."

### B2. When did you choose eager over lazy deliberately?

**Sample:** "Our connection pool was lazy and the first request after a deploy ate a 600 ms dial spike, blowing the SLO. We warmed the pool at startup — eager — so the spike happened during boot, invisible to users."

### B3. Describe a thread-safety bug from lazy init.

**Sample:** "A shared service used `if (conn == null) conn = dial()` with no synchronization. Under load we got two connection pools and intermittent half-initialized reads. Fixed with the holder idiom for the singleton and `volatile` DCL for the per-instance field."

### B4. How do you decide lazy vs eager in code review?

**Sample:** "I ask: is it expensive, is it often unused, and is construction hot? Three yeses → lazy, plus a thread-safety check if shared. Otherwise eager, because it's simpler and predictable."

### B5. How do you make lazy init's cost visible to teammates?

**Sample:** "Name the accessor for the cost (`loadX()` not `getX()` if it blocks), document the first-access latency, and add a metric/trace span around the init so the spike shows up in observability rather than surprising someone at 3 a.m."

---

## Tips for Answering

1. **Lead with the bet:** "expensive value that's often unused."
2. **Always raise thread safety** for shared state — it's the senior differentiator.
3. **Name the idiom per language:** holder (JVM), `sync.Once` (Go), `cached_property`/lock (Python).
4. **Connect lazy loading to N+1 and `LazyInitializationException`** — that's the architectural depth signal.
5. **Acknowledge eager as the default;** lazy is an optimization with evidence.

---

[← Professional](professional.md) · [Object & State](../README.md) · **Next:** [Tasks](tasks.md)
