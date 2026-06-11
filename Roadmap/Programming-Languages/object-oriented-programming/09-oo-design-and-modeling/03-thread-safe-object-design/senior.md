# Thread-Safe Object Design — Senior

> Beneath every locking idiom is the **Java Memory Model**: the set of rules that decides which writes one thread is *guaranteed* to see from another. Without it, "thread safety" is folklore. This file is the model — happens-before, the freedom the JIT and CPU have to reorder, why `final` fields get a special guarantee, and how each design mechanism (`volatile`, locks, atomics, immutability) maps to an edge in that model. It also covers the deep failure modes: word tearing, reordering-induced bugs, lock granularity trade-offs, and the subtle ways "safe" classes break under composition.

---

## 1. The JMM exists because there is no sequential consistency

The naive mental model — "threads execute statements in order, and every write is instantly visible to every thread" (*sequential consistency*) — is **false on every real JVM**. Three layers reorder your program:

1. **The compiler / JIT** reorders and eliminates operations (register allocation, loop hoisting, common-subexpression elimination, dead-store removal).
2. **The CPU** executes out of order and retires speculatively.
3. **The memory hierarchy** (store buffers, per-core caches) delays when one core's write becomes visible to another.

Each layer preserves *single-threaded* semantics (the *as-if-serial* rule) but is free to wreck inter-thread assumptions. Consider:

```java
// Thread 1            // Thread 2
a = 1;                 if (b == 1)
b = 1;                     assert a == 1;   // CAN FAIL
```

Thread 1's two writes can become visible to Thread 2 *in either order* — there is no happens-before edge ordering them across threads. The assert can fail on a perfectly correct JVM. **The JMM's entire job is to tell you which reorderings are forbidden, so you can build code that's correct despite the rest.** It does this with one relation: *happens-before*.

---

## 2. Happens-before is the only guarantee you have

The JMM (JLS §17.4.5) defines a partial order called **happens-before** (HB). The rule that matters:

> If action A happens-before action B, then A's memory effects are visible to B, and A is ordered before B.

If there is *no* HB edge between two accesses to shared data and at least one is a write, you have a **data race**, and the result is undefined (you may read stale values, torn values, or reordered values). The HB edges you get for free:

| Edge | Source |
| --- | --- |
| **Program order** within a single thread | Each action HB the next in that thread |
| **Monitor lock** | Unlock of a monitor HB every subsequent lock of the *same* monitor |
| **Volatile** | Write to a volatile field HB every subsequent read of that field |
| **Thread start** | `Thread.start()` HB the first action of the started thread |
| **Thread join** | The last action of a thread HB a successful `join()` returning |
| **Final fields** | The end of a constructor HB a read of a final field (via a properly-published reference) |
| **`java.util.concurrent`** | E.g. a `BlockingQueue.put` HB the corresponding `take`; `CountDownLatch.countDown` HB `await` returning |

**Every thread-safe design is, underneath, a way of arranging happens-before edges between the writer and the reader.** Immutability uses the final-field edge. A lock uses the unlock→lock edge. `volatile` uses the write→read edge. There is nothing else.

---

## 3. Why a lock gives you *both* atomicity and visibility

Beginners think `synchronized` is about mutual exclusion (atomicity). That's half of it. The lock also provides **visibility**: the unlock-happens-before-lock edge means every write made by a thread *before it released the lock* is visible to the next thread *after it acquires the lock*. This is why a read must be synchronized too:

```java
public class Stats {
    private long count, sum;
    public synchronized void add(long x) { count++; sum += x; }
    public long mean() { return sum / count; }   // BUG: unsynchronized read
}
```

`mean()` is not just non-atomic (it can read `sum` and `count` from different states) — it has *no HB edge* to `add()`, so it can read **arbitrarily stale** `sum` and `count`, indefinitely. Marking `mean()` `synchronized` fixes both problems at once: it acquires the lock, establishing the HB edge (visibility) and excluding concurrent `add` (atomicity). **A lock you take only for writes is half a lock and a real bug.**

---

## 4. Final fields: the publication guarantee that powers immutability

JLS §17.5 gives `final` fields a guarantee no other field has:

> A thread that reads a reference to a properly-constructed object is guaranteed to see the correctly-initialized values of that object's `final` fields — *without any synchronization*.

The mechanism is a **store-store barrier** (a "freeze") at the end of every constructor that writes a final field. The freeze ensures all final-field writes are committed *before* the constructor-completed reference can be published. This is precisely why an immutable record is thread-safe with zero locks: its `final` fields are visible to any thread that can see the reference, full stop.

Two boundary conditions a senior must know:

- **It only covers `final` fields.** A non-final field of an "immutable-looking" object has *no* such guarantee. `private int x;` set in the constructor can be seen as `0` by another thread under a data race.
- **It is forfeited if `this` escapes the constructor** (`senior.md`/`middle.md` §8). The freeze happens at constructor *end*; publishing `this` before that end lets a thread read the final field before the freeze — and see the default value.

```java
public final class Range {
    private final int lo, hi;
    public Range(int lo, int hi) {
        if (lo > hi) throw new IllegalArgumentException();
        this.lo = lo; this.hi = hi;     // freeze at end of ctor — lo/hi visible after publication
    }
    // No volatile, no lock needed. Safe to share across any number of threads.
}
```

For *effectively immutable* objects (mutable type, never mutated post-publication, e.g. a `Date` you promise not to touch), the final-field guarantee doesn't apply automatically — you must publish through one of the other HB edges (volatile, lock, concurrent collection).

---

## 5. The double-checked locking saga (and why `volatile` fixed it)

The classic case study for why the JMM matters. The "broken" lazy singleton:

```java
public class Lazy {
    private Resource instance;                 // NOT volatile
    public Resource get() {
        if (instance == null) {                // (1) first check, unlocked
            synchronized (this) {
                if (instance == null)          // (2) second check, locked
                    instance = new Resource(); // (3)
            }
        }
        return instance;                       // (4)
    }
}
```

Why it's broken: `instance = new Resource()` is three operations — allocate, run constructor, assign reference. The JMM permits reordering so the *reference is assigned before the constructor finishes*. Thread B can pass check (1) seeing a non-null `instance` and return a `Resource` whose fields aren't set yet. The unlocked read at (1)/(4) has no HB edge to the write at (3).

The fix is one keyword — `volatile`:

```java
private volatile Resource instance;
```

The volatile write at (3) now happens-before the volatile read at (1)/(4), and reordering of the construction past the assignment is forbidden across the volatile store. **This is the canonical demonstration that visibility, not just mutual exclusion, is what concurrency design is about.** (Modern code prefers the *initialization-on-demand holder* idiom — a static nested class — which uses class-init locking and needs no `volatile`.)

---

## 6. Word tearing and atomicity of primitive reads

JLS §17.7: reads and writes of `long` and `double` are **not guaranteed atomic** unless the field is `volatile`. On a 32-bit-ish memory model, a non-volatile `long` write can be split into two 32-bit writes; a concurrent reader can observe the high half of the new value and the low half of the old — a **torn read** of a value that was never written.

```java
public class Position {
    private long bits;                          // 64-bit, NON-atomic under race
    public void set(long v) { bits = v; }
    public long get() { return bits; }          // may return a torn value
}
```

References, and all 32-bit-or-smaller primitives (`int`, `boolean`, `char`, `short`, `byte`, `float`), *are* atomic for single reads/writes — but that atomicity buys you nothing for compound operations and *still* gives no visibility guarantee. Making the `long` `volatile` restores per-access atomicity *and* visibility. In practice, modern 64-bit HotSpot writes `long`/`double` atomically anyway, but a portable, spec-correct design declares shared 64-bit fields `volatile` (or guards them).

---

## 7. Lock granularity: the contention/correctness trade-off

A single lock per object (the *monitor pattern*) is the *correct* default but can become a *scalability* bottleneck: every operation serializes through one monitor. The senior trade-offs:

- **Coarse locking (one lock)** — trivially correct, easy to reason about, but throughput is capped at one operation at a time. Right for low-contention or small critical sections.
- **Lock splitting** — separate independent invariants onto separate locks. If a class guards a read-counter and a write-counter that share no invariant, give them two locks so a reader and a writer don't block each other.
- **Lock striping** — partition a *single* logical structure across N locks keyed by hash (how the pre-Java-8 `ConcurrentHashMap` worked: 16 segments, 16 locks). Increases concurrency N-fold but makes whole-structure operations (e.g. `size()`) expensive — they must acquire all stripes.

```java
// Lock splitting: two unrelated invariants, two locks — readers don't block writers.
public class Server {
    private final Object readLock = new Object();
    private final Object writeLock = new Object();
    @GuardedBy("readLock")  private long reads;
    @GuardedBy("writeLock") private long writes;
    public void recordRead()  { synchronized (readLock)  { reads++;  } }
    public void recordWrite() { synchronized (writeLock) { writes++; } }
}
```

The hazard splitting introduces: **if an invariant ever spans the two pieces, two locks is a bug.** Lock splitting is only valid when the protected state is genuinely independent. The discipline is to split locks *along invariant boundaries*, never arbitrarily. Contention measurement and the COW/`StampedLock` alternatives are in `optimize.md`.

---

## 8. Reentrancy, lock ordering, and deadlock as a design property

Intrinsic locks and `ReentrantLock` are **reentrant** — a thread already holding a lock can re-acquire it. This is what lets a `synchronized` method call another `synchronized` method on the same object without self-deadlock. But reentrancy has a sharp edge in *extensible* designs: a base class method that calls an **overridable method while holding the lock** invokes subclass code under the lock — an *open call* hazard:

```java
public class Base {
    public synchronized void process(Item i) {
        store(i);
        onProcessed(i);        // calls subclass code WHILE HOLDING the lock
    }
    protected void onProcessed(Item i) { }   // a subclass may block, or acquire another lock → deadlock
}
```

If `onProcessed` acquires a second lock, you have a lock-ordering inversion waiting to deadlock. **Deadlock is a design property of the *set* of objects, not of any one class.** The two defenses are: (1) establish a global **lock-ordering** discipline (always acquire locks in a fixed order) and (2) make **open calls** — never invoke alien/overridable code while holding a lock; copy the state you need, release, then call out. This is exactly where thread safety meets [../04-designing-for-extension-and-polymorphism/](../04-designing-for-extension-and-polymorphism/): an extension point under a lock is a concurrency hazard.

---

## 9. Atomics, CAS, and the ABA problem

Atomic variables avoid locks using CAS, but lock-free is not free of subtlety. The **ABA problem**: a CAS succeeds because the value is back to `A`, even though it went `A → B → A` in between, masking the fact that the world changed. For reference-CAS over recyclable nodes (lock-free stacks, pools), ABA can corrupt structure.

```java
// AtomicStampedReference attaches a version stamp so A→B→A is detected.
AtomicStampedReference<Node> top = new AtomicStampedReference<>(head, 0);
int[] stamp = new int[1];
Node t = top.get(stamp);
top.compareAndSet(t, t.next, stamp[0], stamp[0] + 1);   // fails if stamp changed
```

Also know: under high contention, the CAS retry loop *spins* — wasted CPU as threads repeatedly fail and retry. `LongAdder`/`LongAccumulator` sidestep this by striping the counter across cells (a *contention-aware* design); they trade exact-at-all-times reads for write throughput. The senior judgment: **CAS wins at low-to-moderate contention; under high contention, striping or a lock with a short critical section can beat a hot CAS loop.** Measure (`optimize.md`).

---

## 10. The classifications, precisely

The four-way classification from *Java Concurrency in Practice* is a *contract*, and the boundaries are where seniors get precise:

- **Immutable** — strongest. State frozen at construction; `final` fields; no reference to internal mutable state escapes. Thread-safe with no further reasoning.
- **Thread-safe** — correct under concurrent access with no external sync *for every operation the class exposes*. Note: this does not promise that *combinations* of operations are atomic (that's the compound-action trap).
- **Conditionally thread-safe** — individual operations safe; specified *sequences* require client-side locking on a *documented* lock. The documentation is part of the contract; without it the class is effectively unusable.
- **Not thread-safe** — caller synchronizes all access.

The subtle one is the line between *thread-safe* and *conditionally thread-safe*: `ConcurrentHashMap` is thread-safe *and* provides atomic compound operations (`merge`, `compute`, `putIfAbsent`) so you rarely need client-side locking; `Collections.synchronizedMap` is conditionally thread-safe because its compound operations (iteration, check-then-act) require you to lock the map. Same surface (a thread-safe `Map`), different contract. Designing a class, you choose which you're offering and you state it.

---

## 11. Effectively immutable and the "safely published once" pattern

Not all immutability is structural. An **effectively immutable** object is mutable-typed but never mutated after publication — common when you can't avoid a mutable type (a legacy `Date`, a populated-then-frozen `HashMap`). It's thread-safe *only if safely published*, because it lacks the final-field freeze for its internal state:

```java
public class ConfigCache {
    // The Map is mutable, but we never mutate it after publishing it via volatile.
    private volatile Map<String, String> snapshot = Map.of();

    public void reload(Map<String, String> fresh) {
        snapshot = Map.copyOf(fresh);     // build new, publish via volatile write (HB edge)
    }
    public String get(String k) { return snapshot.get(k); }   // sees a complete, never-mutated map
}
```

This is *copy-on-write at the object level*: readers are lock-free and always see a consistent immutable snapshot; writers swap the whole reference atomically. The pattern generalizes to `CopyOnWriteArrayList` and is the backbone of high-read low-write thread-safe design (see `optimize.md`). The invariant a senior verifies: **once published, the snapshot is never structurally modified** — every "change" allocates a fresh immutable object and swaps the reference.

---

## 12. What's next

- `professional.md` — review heuristics, `@GuardedBy` enforcement, error-prone/SpotBugs/ThreadSanitizer, jcstress.
- `optimize.md` — measuring contention; `LongAdder`, `StampedLock`, `ReadWriteLock`, COW trade-offs.
- [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/senior.md](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/senior.md) — the final-field publication story from the immutability angle.
- [../../06-method-dispatch-and-internals/](../../06-method-dispatch-and-internals/) — overridable methods under a lock (open calls) connect to dispatch internals.

**The one idea:** every thread-safe design is a happens-before edge between a writer and a reader. Immutability uses the final-field freeze; a lock uses unlock→lock; `volatile` uses write→read; concurrent collections package their own edges. A data race is just the *absence* of such an edge — and its consequences (stale reads, torn values, reordering) are exactly what the JMM declines to forbid when the edge is missing.
