# Thread-Safe Object Design — Find the Bug

> Twelve snippets, each a real concurrency defect in an object's design: a data race, a broken invariant under concurrency, or an unsafe publication. For each — read the code, decide what's wrong (will it crash? produce a wrong value? hang? when?), then check the diagnosis. These are the exact smells `professional.md`'s review checklist scans for.

---

## Bug 1 — The unsynchronized getter

```java
public class Account {
    private long balance;
    public synchronized void deposit(long n) { balance += n; }
    public long balance() { return balance; }       // not synchronized
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`balance()` has no lock, so it has no happens-before edge to `deposit()`. A reader can see an arbitrarily **stale** balance — indefinitely, not just briefly — because the JMM never promises a plain read sees another thread's write without an edge. (On a 32-bit-portable model it could also see a **torn** `long`.) The lock-on-writes-only is half a lock.

**Fix:** make the read acquire the same lock — `public synchronized long balance() { return balance; }` — or make `balance` `volatile` if there's no compound invariant. Reads need the lock as much as writes, for *visibility*, not just atomicity.
</details>

---

## Bug 2 — `volatile` mistaken for atomic

```java
public class Sequence {
    private volatile int next = 0;
    public int next() { return next++; }            // volatile ++
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`volatile` gives visibility but **not atomicity**. `next++` is read-modify-write; two threads can read the same value and return duplicate IDs. `volatile` does nothing to prevent the interleaving.

**Fix:** use an atomic — `private final AtomicInteger next = new AtomicInteger(); public int next(){ return next.getAndIncrement(); }`. Rule: `volatile` is only correct when the new value doesn't depend on the old.
</details>

---

## Bug 3 — Broken invariant across two fields

```java
public class CachedFactorizer {
    private BigInteger lastNumber;
    private BigInteger[] lastFactors;
    public synchronized boolean matches(BigInteger n) { return n.equals(lastNumber); }
    public void cache(BigInteger n, BigInteger[] f) {   // not synchronized!
        lastNumber = n;
        lastFactors = f;
    }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

The invariant is "`lastFactors` are the factors of `lastNumber`." `cache` writes the two fields un-synchronized and out from under the lock `matches` uses. A thread can read `lastNumber` updated but `lastFactors` stale (or vice versa), or `matches` can race with `cache`. The compound state is unprotected even though each assignment is individually atomic.

**Fix:** make `cache` `synchronized` on the same lock, so the pair updates atomically and `matches` never observes a mismatched (number, factors). Protect the *invariant*, not the field.
</details>

---

## Bug 4 — `this` escapes the constructor

```java
public class EventListener {
    private final EventBus bus;
    public EventListener(EventBus bus) {
        this.bus = bus;
        bus.register(this);                          // escape
    }
    public void onEvent(Event e) { /* uses fields */ }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`register(this)` publishes `this` *before the constructor finishes*. Another thread can deliver `onEvent` to a partially-constructed listener — fields not yet set, the `final`-field freeze (JLS §17.5) not yet applied. Intermittent NPEs / default-value reads.

**Fix:** finish construction, then publish — a static factory: `private EventListener(EventBus bus){ this.bus = bus; } static EventListener create(EventBus bus){ var l = new EventListener(bus); bus.register(l); return l; }`. Never let `this` escape a constructor.
</details>

---

## Bug 5 — Leaked internal mutable state

```java
public final class Team {
    private final List<Player> players = new ArrayList<>();
    public void add(Player p) { synchronized (this) { players.add(p); } }
    public List<Player> players() { return players; }   // leaks the list
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`players()` returns the *live* internal list. Callers iterate/mutate it with **no lock**, racing with `add`. The class's careful `synchronized(this)` is defeated because the state escaped. (Even a single-threaded iteration can throw `ConcurrentModificationException` if `add` runs concurrently.)

**Fix:** return a snapshot under the lock — `synchronized(this){ return List.copyOf(players); }` — or expose the list as an immutable copy. The lock only protects what stays inside the class.
</details>

---

## Bug 6 — Check-then-act on a concurrent map

```java
public class UserCache {
    private final ConcurrentHashMap<Long, User> users = new ConcurrentHashMap<>();
    public User getOrLoad(long id) {
        User u = users.get(id);                      // check
        if (u == null) {
            u = loadFromDb(id);
            users.put(id, u);                        // act
        }
        return u;
    }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`get` and `put` are each atomic, but the *sequence* isn't. Two threads can both miss, both load from the DB (wasteful, possibly two different `User` objects), and both `put` — callers may get different instances for the same id. A compound action over thread-safe parts is not automatically atomic.

**Fix:** use the atomic compound operation — `users.computeIfAbsent(id, this::loadFromDb)`. It guarantees the loader runs at most once per key and every caller sees the same instance.
</details>

---

## Bug 7 — Double-checked locking without `volatile`

```java
public class Registry {
    private static Registry instance;
    private Registry() { /* heavy init */ }
    public static Registry get() {
        if (instance == null)
            synchronized (Registry.class) {
                if (instance == null) instance = new Registry();
            }
        return instance;
    }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`instance = new Registry()` can be reordered so the reference is published *before* the constructor's writes are visible. The unlocked first check can return a `Registry` whose fields aren't set — a half-built object. The classic broken DCL.

**Fix:** `private static volatile Registry instance;` — the volatile write/read forbids the harmful reordering and establishes happens-before. Better still: the initialization-on-demand holder idiom (`private static class H { static final Registry I = new Registry(); }`), which uses class-init locking and needs no `volatile`.
</details>

---

## Bug 8 — Locking on a mutable field

```java
public class Buffer {
    private List<String> data = new ArrayList<>();
    public void swap(List<String> fresh) { data = fresh; }
    public void add(String s) { synchronized (data) { data.add(s); } }   // lock on 'data'
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

The lock object is the field `data`, whose reference `swap` can replace. Two threads in `add` can lock *different* `data` instances (one before, one after a `swap`) — no mutual exclusion. Synchronizing on a field whose reference changes is locking on a moving target.

**Fix:** lock on a stable `private final Object lock = new Object();` and guard both `add` and `swap` with it. The lock must never change identity.
</details>

---

## Bug 9 — Non-atomic 64-bit field

```java
public class Position {
    private long coords;                             // packs x<<32 | y
    public void set(long c) { coords = c; }
    public long get() { return coords; }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

A non-volatile `long` write is, per JLS §17.7, treated as two 32-bit writes. A concurrent reader can observe the high half of a new value and the low half of an old one — a **torn** `coords` that was never written, corrupting both packed coordinates. Plus the usual visibility staleness.

**Fix:** `private volatile long coords;` restores per-access atomicity and visibility. (Or guard with a lock if `coords` participates in a larger invariant.)
</details>

---

## Bug 10 — Open call inside a lock

```java
public class Dispatcher {
    private final List<Listener> listeners = new ArrayList<>();
    public synchronized void register(Listener l) { listeners.add(l); }
    public synchronized void fire(Event e) {
        for (Listener l : listeners) l.onEvent(e);   // alien code under the lock
    }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`fire` invokes alien `onEvent` code *while holding the lock*. If a listener calls back into `register` (re-entrant — fine) but a *different* listener acquires *another* lock, you have a lock-ordering deadlock; a slow/blocking listener also serializes all dispatch. This is the open-call hazard.

**Fix:** copy the listeners under the lock, release, then call out — `List<Listener> snapshot; synchronized(this){ snapshot = List.copyOf(listeners); } for (var l : snapshot) l.onEvent(e);`. Never make alien/overridable calls while holding a lock.
</details>

---

## Bug 11 — Effectively-immutable object mutated after publication

```java
public class Snapshot {
    private final Map<String, Integer> data;
    public Snapshot(Map<String, Integer> src) { this.data = new HashMap<>(src); }
    public Map<String, Integer> data() { return data; }
    public void bump(String k) { data.merge(k, 1, Integer::sum); }   // mutates after publish!
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

The class *looks* immutable (`final` field), but `bump` mutates the internal `HashMap` after the `Snapshot` is published — and `HashMap` isn't thread-safe, and there's no lock. Concurrent `bump`/`data()` calls race, corrupting the map. "Effectively immutable" requires *never* mutating after publication; this violates it.

**Fix:** either make it truly immutable (drop `bump`; return a new `Snapshot` with `Map.copyOf`) or make it a properly guarded mutable class (`ConcurrentHashMap` + no leaked reference). Don't half-immutable.
</details>

---

## Bug 12 — Delegated safety with a hidden cross-field invariant

```java
public class BoundedCounter {
    private final AtomicInteger count = new AtomicInteger();
    private final int max;
    public BoundedCounter(int max) { this.max = max; }
    public boolean increment() {
        if (count.get() < max) {                     // check
            count.incrementAndGet();                 // act
            return true;
        }
        return false;
    }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

Each `AtomicInteger` call is atomic, but the **invariant `count <= max`** spans the check and the act. Two threads at `count == max-1` both pass the check and both increment — `count` reaches `max+1`, breaking the bound. Delegating to a thread-safe component doesn't make a *cross-operation* invariant atomic.

**Fix:** make the check-and-act one atomic step — a CAS loop (`updateAndGet` returning the old value isn't enough; use an explicit `compareAndSet` loop that only increments below `max`) or a single lock around both. When an invariant spans the operations, delegation alone is insufficient.

```java
public boolean increment() {
    int c;
    do { c = count.get(); if (c >= max) return false; }
    while (!count.compareAndSet(c, c + 1));
    return true;
}
```
</details>

---

## Pattern summary

| Bug | Category | Tell |
| --- | --- | --- |
| 1 | Visibility (read not locked) | getter without the writers' lock |
| 2 | Atomicity (`volatile`≠atomic) | `volatile v++` |
| 3 | Broken invariant | one writer un-synchronized |
| 4 | Unsafe publication | `register(this)` in ctor |
| 5 | Escaped state | getter returns internal collection |
| 6 | Compound action | get-then-put on concurrent map |
| 7 | Reordering (DCL) | lazy init, non-`volatile` field |
| 8 | Locking on moving target | `synchronized(mutableField)` |
| 9 | Word tearing | shared non-`volatile` `long`/`double` |
| 10 | Open call / deadlock | alien call inside `synchronized` |
| 11 | False immutability | mutate after publication |
| 12 | Delegation gap | cross-field invariant over atomics |

The recurring lesson: **races are almost never crashes — they're broken invariants and stale/torn reads, intermittent and invisible to single-threaded tests.** Find them by tracing every access path to every shared field and confirming one consistent policy, plus checking the *seam* where the object is published.
