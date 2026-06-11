# Thread-Safe Object Design — Optimize

> Correctness first, then throughput. A thread-safe class that serializes every operation through one lock is *correct* but may cap throughput at one core. This file is about reducing **lock contention while preserving safety** — measuring it first, then applying immutability/COW, lock splitting/striping, read-write and optimistic locking, and contention-aware atomics. Every optimization here is also a *re-design*: you change which happens-before edge protects the invariant, never whether one does.

---

## 1. Measure contention before you touch a lock

Never optimize locking on intuition. Contention is invisible until measured, and the hot lock is rarely where you'd guess. The tools, cheapest first:

- **JFR** — record `jdk.JavaMonitorEnter` (intrinsic-lock blocking) and `jdk.ThreadPark` (`j.u.c.Lock`/park) events: `java -XX:StartFlightRecording=duration=60s,filename=app.jfr ...`, then open in JDK Mission Control. The "Lock Instances" / "Java Monitor Blocked" views rank locks by blocked time.
- **`async-profiler` lock mode** — `-e lock` produces a flame graph of contended monitors and `java.util.concurrent` locks by total blocked nanos. The single best "which lock is killing us" tool.
- **`jstack` / thread dumps** — repeated dumps showing many threads `BLOCKED (on object monitor)` on the same lock = a contention hotspot.

The metric that matters: **time threads spend *blocked* acquiring the lock**, not how often the lock is taken. A lock taken a million times with no contention is free; a lock taken a hundred times with 50 threads queued behind it is the bottleneck.

> Rule: profile under *realistic concurrency*. A single-threaded microbenchmark shows zero contention by construction and will mislead you every time.

---

## 2. The cheapest win: remove the lock by making state immutable

The fastest lock is the one that isn't there. If the contended state can be made immutable, *all* read synchronization disappears — readers become lock-free and the JIT can inline and cache freely. This is why immutability is both the safest *and* often the fastest design.

```java
// BEFORE: every read locks
public class Config {
    private final Map<String, String> map = new HashMap<>();
    public synchronized String get(String k) { return map.get(k); }   // contended read
    public synchronized void put(String k, String v) { map.put(k, v); }
}

// AFTER: immutable snapshot, lock-free reads, copy-on-write writes
public class Config {
    private volatile Map<String, String> snapshot = Map.of();
    public String get(String k) { return snapshot.get(k); }           // NO lock
    public synchronized void put(String k, String v) {                // writers serialize
        var next = new HashMap<>(snapshot); next.put(k, v);
        snapshot = Map.copyOf(next);                                   // publish via volatile
    }
}
```

For a read-heavy config (99.9% reads), the "after" version is dramatically faster: reads pay one volatile load and no lock; only the rare writer pays the copy. The trade-off is explicit (§3).

---

## 3. Copy-on-write: trade write cost for lock-free reads

The pattern above generalizes. **Copy-on-write (COW)** makes every read lock-free and every write allocate a fresh immutable copy and atomically swap it in. `CopyOnWriteArrayList`/`CopyOnWriteArraySet` package it for you:

```java
// Listener list: registrations rare, iterations frequent — COW is ideal.
private final List<Listener> listeners = new CopyOnWriteArrayList<>();
public void register(Listener l) { listeners.add(l); }      // copies the array
public void fire(Event e) { for (Listener l : listeners) l.onEvent(e); }  // lock-free, snapshot iterator
```

The cost model — know it before you reach for COW:

| Property | COW |
| --- | --- |
| Read cost | Lock-free, no contention, ever |
| Iteration | Over a stable snapshot — no `ConcurrentModificationException`, no lock |
| Write cost | **O(n)** — copies the entire backing array |
| Memory | A full copy per mutation (GC churn under frequent writes) |

**COW wins when reads vastly outnumber writes** (event listeners, config, routing tables). It is *catastrophic* for write-heavy data — an O(n) copy per write turns a list into quadratic garbage. Match the structure to the read/write ratio.

---

## 4. Lock splitting: separate independent invariants

If one lock guards several pieces of state that share *no* invariant, split it so unrelated operations stop contending.

```java
// BEFORE: one lock serializes reads-metric and writes-metric needlessly
public class Stats {
    @GuardedBy("this") private long reads, writes;
    public synchronized void onRead()  { reads++; }
    public synchronized void onWrite() { writes++; }   // a reader blocks a writer for no reason
}

// AFTER: two locks — readers and writers never contend
public class Stats {
    private final Object rLock = new Object(), wLock = new Object();
    @GuardedBy("rLock") private long reads;
    @GuardedBy("wLock") private long writes;
    public void onRead()  { synchronized (rLock) { reads++; } }
    public void onWrite() { synchronized (wLock) { writes++; } }
}
```

**Validity condition (non-negotiable):** the split is correct *only* if no invariant relates the split pieces. The moment you add "reads and writes must always sum to total", two locks is a bug — you'd need both to update atomically. Split along invariant boundaries, never arbitrarily.

---

## 5. Lock striping: partition one structure across N locks

When a *single* logical structure is the hotspot, stripe it: partition by hash across N locks so N operations on different keys proceed in parallel. This is how pre-Java-8 `ConcurrentHashMap` worked (16 segments). You rarely hand-roll it — use `ConcurrentHashMap`, which since Java 8 locks per-bin and uses CAS for uncontended inserts:

```java
// Don't hand-roll striping — ConcurrentHashMap already does it, better.
private final ConcurrentHashMap<String, AtomicLong> counters = new ConcurrentHashMap<>();
public void bump(String k) { counters.computeIfAbsent(k, x -> new AtomicLong()).incrementAndGet(); }
```

Striping's cost: **whole-structure operations get expensive.** A `size()` over a striped map must reconcile all stripes (CHM tracks an approximate size via per-cell counters to avoid this). The trade is "N-way concurrent point operations" for "expensive global operations" — fine when point ops dominate.

---

## 6. Read-write locks: many readers, occasional writer

When reads dominate but the state is too large/mutable to snapshot (COW too costly), a `ReentrantReadWriteLock` lets readers share the lock while writers get exclusive access:

```java
private final ReadWriteLock rw = new ReentrantReadWriteLock();
private final Map<String, V> map = new HashMap<>();   // plain map, guarded by rw
public V get(String k) {
    rw.readLock().lock();
    try { return map.get(k); } finally { rw.readLock().unlock(); }   // concurrent with other reads
}
public void put(String k, V v) {
    rw.writeLock().lock();
    try { map.put(k, v); } finally { rw.writeLock().unlock(); }      // exclusive
}
```

Caveats: the read/write lock bookkeeping has overhead, so it only pays off when reads are *frequent and long enough* to amortize it and writes are rare; under write-heavy load it's slower than a plain lock. Measure — for short critical sections, a plain `synchronized` often beats `ReadWriteLock`.

---

## 7. `StampedLock`: optimistic reads, no reader bookkeeping

`StampedLock` (Java 8) adds an **optimistic read** mode: read without acquiring anything, then validate the stamp; only fall back to a real read lock if a writer intervened. For read-dominated, short critical sections this beats `ReadWriteLock` by avoiding reader-lock contention entirely:

```java
private final StampedLock sl = new StampedLock();
private double x, y;
public double distanceFromOrigin() {
    long stamp = sl.tryOptimisticRead();        // no lock acquired
    double cx = x, cy = y;                      // read fields
    if (!sl.validate(stamp)) {                  // a writer ran? fall back
        stamp = sl.readLock();
        try { cx = x; cy = y; } finally { sl.unlockRead(stamp); }
    }
    return Math.sqrt(cx * cx + cy * cy);
}
```

Trade-offs to respect: `StampedLock` is **not reentrant**, has no `Condition`s, and the optimistic block must read into locals and tolerate a retry (the read can run while a write is in progress, so you validate *after*). It's a precision tool for hot, tiny, read-mostly critical sections — not a general-purpose lock.

---

## 8. Contention-aware atomics: `LongAdder` over `AtomicLong`

A single `AtomicLong` under heavy write contention becomes a CAS hotspot — threads spin retrying the failed compare-and-swap, burning CPU. `LongAdder` stripes the counter across cells (roughly one per contending thread), so writes rarely collide; `sum()` adds the cells on read:

```java
private final LongAdder requests = new LongAdder();
public void onRequest() { requests.increment(); }   // near-zero contention under load
public long total() { return requests.sum(); }       // reconciles cells
```

| | `AtomicLong` | `LongAdder` |
| --- | --- | --- |
| Hot write throughput | Degrades under contention (CAS spin) | Scales — distributed across cells |
| Read | Exact, single load | Sums cells (slightly costlier, momentarily approximate) |
| Memory | One field | One cell per contending thread |
| Best for | Low contention, or read-and-act-atomically | High write rate, read occasionally (metrics) |

Use `LongAdder` for high-write counters you read rarely; keep `AtomicLong` when you need an exact value you also act on atomically (`getAndIncrement` to mint an id).

---

## 9. Shrink the critical section (often the biggest win)

Before any fancy lock, do the cheap thing: **hold the lock for as little code as possible.** Pull I/O, allocation, formatting, and alien calls *out* of the `synchronized` block; keep only the state mutation inside.

```java
// BEFORE: lock held across an expensive computation and an alien call
public synchronized void process(Item i) {
    Result r = expensiveCompute(i);     // CPU-heavy, under the lock
    store.put(i.id(), r);
    notifyListeners(r);                 // open call — under the lock!
}

// AFTER: compute outside, lock only the mutation, call out after release
public void process(Item i) {
    Result r = expensiveCompute(i);                 // no lock
    synchronized (lock) { store.put(i.id(), r); }   // minimal critical section
    notifyListeners(r);                             // open call after release
}
```

This simultaneously reduces contention (lock held briefly) and removes the open-call deadlock hazard. Often it eliminates the contention entirely, making the §4–§8 techniques unnecessary.

---

## 10. The optimization decision tree

```
Is the state read-mostly?
├─ Can it be immutable?            → make it immutable; reads lock-free          (best)
├─ Reads ≫ writes, small state?    → copy-on-write / volatile-snapshot swap
├─ Reads ≫ writes, large state?    → ReadWriteLock or StampedLock (optimistic)
└─ Mixed / write-heavy?
   ├─ Independent invariants?      → lock splitting
   ├─ One structure, point ops?    → ConcurrentHashMap (per-bin) / striping
   ├─ A hot counter?               → LongAdder
   └─ Otherwise                    → one lock, but SHRINK the critical section
```

And always, first: **measure contention**, then **shrink the critical section** — the two highest-ROI moves before any structural change.

---

## 11. The invariant you must never optimize away

Every technique here changes *which happens-before edge* protects the data — immutability uses the final-field freeze, COW/volatile-swap uses the volatile write→read edge, split/striped locks use unlock→lock per partition. What never changes: **there must still be exactly one consistent policy per piece of state, and every invariant must still be protected under a single atomic step.** A "faster" design that lets two threads break an invariant isn't an optimization — it's a regression with better benchmarks. Verify the optimized design the same way you verified the original: trace every access path, and for lock-free cores, run jcstress (`tasks.md` Task 10).

---

## What's next

- `tasks.md` Task 9 (profile-then-split) and Task 10 (jcstress) put these into practice.
- `senior.md` §7–§9 — the memory-model reasoning behind splitting, striping, and CAS.
- [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/optimize.md](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/optimize.md) — escape analysis and allocation cost of the immutable snapshots COW relies on.
- [../02-oo-metrics-ck-suite/](../02-oo-metrics-ck-suite/) — contention often tracks high coupling; the most-contended classes are frequently the highest-CBO ones.

**The throughput rule:** measure contention, shrink the critical section, then — only if still needed — change the *protection mechanism* (immutable/COW/split/stripe/RW/optimistic/adder) to match the read/write profile. Never change *whether* an invariant is protected. Correctness is not negotiable; throughput is what's left to win once it's guaranteed.
