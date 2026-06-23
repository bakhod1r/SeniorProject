# Thread-Safe Object Design — Interview Q&A

> ~20 questions on designing objects for concurrent use. Grouped by difficulty. Answers are concise, correct, and framed as *object design* — "how do I build this class to be safe to share" — not as a concurrency-algorithms quiz.

---

## Conceptual (warm-up)

**Q1. Define "thread-safe class" precisely.**
A class is thread-safe if it behaves correctly — preserving every invariant — when accessed from multiple threads concurrently, *regardless of interleaving and with no external synchronization required of the caller*. The last clause is essential: if correct use requires the caller to hold a lock, the class is only *conditionally* thread-safe. Thread safety is a property of the class's contract, not of any single method.

**Q2. What are the three strategies for thread-safe object design, and in what order do you prefer them?**
Confinement (never share the mutable state), immutability (no state to race over), and guarded state (protect shared mutable state with a lock). Prefer **immutability first** (zero runtime cost, impossible to get the locking wrong because there's none), **confinement second** (also free, but limits sharing), and **locking last** (necessary when you must share mutable state, but the most error-prone).

**Q3. Why is an immutable object thread-safe with no locks?**
It has no mutable state, so there's nothing to race over — no read-modify-write, no torn reads, no stale reads of a value that changed. The JMM's final-field guarantee (JLS §17.5) ensures a fully-constructed immutable object's `final` fields are visible to any thread that sees the reference, with no synchronization. The only requirement is that it's *safely published* and that `this` didn't escape the constructor.

**Q4. What's the difference between thread-safe and *conditionally* thread-safe?**
A thread-safe class is safe for every operation it exposes with no external locking. A conditionally-thread-safe class makes *individual* calls safe but requires the caller to lock for certain *compound sequences* (e.g. iterating a `Collections.synchronizedMap`, or check-then-act). The crucial point: a conditionally-thread-safe class must *document which lock* the caller holds and *for which operations* — otherwise it's unusable.

**Q5. Is a `Counter` with `private int count; void inc(){count++;}` thread-safe? Why not?**
No. `count++` is read-modify-write — three operations. Two threads can both read 5, both compute 6, both write 6: one increment is lost. Nothing crashes; the value is just silently wrong, intermittently. Fix with `AtomicInteger.incrementAndGet()` or a lock around the increment. (Also, the unsynchronized read of `count` has a visibility bug independent of the lost-update one.)

---

## Mechanics

**Q6. When is `volatile` sufficient and when is it not?**
`volatile` gives visibility and prevents reordering, but *not* atomicity. It's sufficient when the field is written/read independently and the new value doesn't depend on the old — e.g. a `volatile boolean shutdown` flag, or a reference swapped to a new immutable snapshot. It's insufficient (a bug) for read-modify-write (`v++`, check-then-set) and for any field participating in a multi-field invariant.

**Q7. Why must a getter be synchronized if the setters are?**
Two reasons. *Atomicity*: an unsynchronized read can observe state mid-update (e.g. two fields that should be consistent). *Visibility*: without acquiring the lock, the reader has no happens-before edge to the writer's release, so it can read arbitrarily stale values indefinitely — the JMM gives no guarantee. A lock taken only on writes is half a lock and a real bug.

**Q8. Intrinsic lock (`synchronized`) vs `ReentrantLock` — when do you choose the explicit lock?**
Default to `synchronized`: it's concise and auto-releases on exception. Choose `ReentrantLock` only for a feature `synchronized` lacks — `tryLock`/timeouts, `lockInterruptibly`, multiple `Condition`s, fairness, or acquiring/releasing across method boundaries (hand-over-hand locking). The cost of the explicit lock is you *must* `unlock()` in a `finally`, or an exception leaks the lock forever.

**Q9. Why lock on a private final object instead of `this`?**
`this` is a public lock — any external code holding a reference to your object can `synchronized(yourObject)` and interfere, deadlock, or starve your threads. A private `final Object lock` encapsulates the locking policy: only your class can acquire it, so you can *prove* the invariant by reading one class. Locking on `this` (or on an interned `String`/boxed value) breaks that encapsulation.

**Q10. What is safe publication, and what are the four ways to achieve it?**
Safe publication is making a constructed object — and its internal state — visible to other threads *fully and correctly*. The idioms: (1) store in a `final` field of a properly-constructed object, (2) store in a `volatile` field or `AtomicReference`, (3) store while holding a lock and read while holding the same lock, (4) hand off via a thread-safe collection (`BlockingQueue`, `ConcurrentHashMap`). A plain non-final/non-volatile field shared without synchronization is *unsafe* publication — the reader may see null, stale, or half-built state.

**Q11. How can `this` escape a constructor, and why is it dangerous?**
By registering `this` as a listener/callback, starting a thread that captures `this` (`new Thread(this).start()`), or storing `this` in a static/shared field — all *before the constructor returns*. It's dangerous because another thread can then call into a partially-constructed object; even `final` fields aren't guaranteed visible yet (the freeze happens at constructor *end*). Fix: finish construction, then publish — typically via a static factory method.

**Q12. Two thread-safe objects combined — is the result thread-safe?**
Not necessarily. Each individual call is safe, but a *sequence* across them isn't. `Integer x = map.get(k); map.put(k, x+1);` on a `ConcurrentHashMap` is a check-then-act race — both calls are atomic, the pair isn't. Fix with an atomic compound operation (`map.merge(k, 1, Integer::sum)`) or your own lock spanning the operation. "Made of thread-safe parts" is necessary but not sufficient.

---

## "What does this print / is this safe?"

**Q13. Is this DCL singleton correct?**
```java
private Resource instance;                       // not volatile
Resource get() {
    if (instance == null) synchronized(this) {
        if (instance == null) instance = new Resource();
    }
    return instance;
}
```
**No.** `instance = new Resource()` can be reordered so the reference is assigned before the constructor finishes; the unlocked first check can return a half-built `Resource`. Fix: make `instance` `volatile`. Better: use the initialization-on-demand holder idiom (a static nested class), which needs no `volatile`.

**Q14. Can this assert fail?**
```java
// Thread 1: a = 1; b = 1;
// Thread 2: if (b == 1) assert a == 1;
```
**Yes.** There's no happens-before edge ordering Thread 1's two writes across to Thread 2. The JIT/CPU may make `b=1` visible before `a=1`. To forbid it, make `b` (the flag) `volatile` — then `a=1` happens-before the volatile write of `b`, which happens-before Thread 2's read of `b`, so `a==1` is guaranteed.

**Q15. Is a shared non-volatile `long` field safe to read?**
No — two issues. *Tearing* (JLS §17.7): a non-volatile `long`/`double` write is treated as two 32-bit writes; a reader can see a half-updated value that was never written. *Visibility*: no happens-before edge means stale reads. Declaring the field `volatile` fixes both (per-access atomicity and visibility). References and `int`-sized primitives are atomic per access but still lack visibility without an edge.

**Q16. What's wrong with this "immutable" class?**
```java
public final class Config {
    private final List<String> hosts;
    public Config(List<String> hosts) { this.hosts = hosts; }   // stored directly
    public List<String> hosts() { return hosts; }               // returned directly
}
```
It's not actually immutable: the caller still holds the passed list and can mutate it; the getter leaks the internal list for mutation. Under concurrency that's an unguarded mutable share. Fix: `this.hosts = List.copyOf(hosts)` (defensive copy in) — now it's structurally immutable, and the `final` field gives safe publication.

---

## Trade-offs & design

**Q17. When should a class *not* be thread-safe?**
When it's never shared — request-scoped objects, stack-confined builders, DTOs used by one thread, or state already serialized by a higher layer (single-threaded executor, actor mailbox, transaction). Needless thread safety costs lock overhead, hurts JIT inlining, and breeds false confidence. The right move is to document the assumption with `@NotThreadSafe` and the confinement note — a *documented* not-thread-safe class is a design decision; a silent one is a bug.

**Q18. What is the monitor pattern and when do you use it?**
Wrap a plain (non-thread-safe) mutable object in a class that owns a private lock and routes every access through it, so the wrapped object is *confined* and all operations serialize. Use it to add a compound invariant on top of existing state — it's the most robust way (vs. fragile subclassing or client-side locking) and doesn't require the wrapped object to be thread-safe itself.

**Q19. What is an open call, and why avoid it under a lock?**
An open call is invoking *alien* code — an overridable method, a listener callback, a passed-in lambda — while holding a lock. It's dangerous because that code may block, run slowly (extending the critical section), or acquire another lock in a different order, causing deadlock. Defense: copy the state you need, *release the lock*, then make the call. This is where thread safety meets extensible design — an extension point under a lock is a hazard.

**Q20. What is lock splitting/striping and what's the risk?**
Splitting gives *independent* invariants separate locks so unrelated operations don't contend; striping partitions one structure across N hash-keyed locks for N-fold concurrency (old `ConcurrentHashMap`). The risk: if any invariant *spans* the split pieces, multiple locks is a correctness bug — you can no longer make the cross-piece operation atomic without acquiring all locks. Split locks only along genuine invariant boundaries.

**Q21. How do you document a class's thread-safety contract?**
With the classification in Javadoc (`@Immutable` / `@ThreadSafe` / "conditionally thread-safe, lock on the instance for compound ops" / `@NotThreadSafe`), and `@GuardedBy("lock")` on each guarded field naming its lock. error-prone can then enforce `@GuardedBy` at compile time. The contract is invisible in the type signature, so it *must* be written down — a shared class with no thread-safety doc is unusable correctly.

**Q22. Why prefer `LongAdder` over `AtomicLong` for a hot counter?**
Under high write contention, `AtomicLong`'s single CAS target becomes a hotspot — threads repeatedly fail and retry the CAS, wasting CPU. `LongAdder` stripes the count across multiple cells (one per contending thread, roughly), so writes rarely collide; `sum()` adds the cells on read. Trade-off: `LongAdder` gives up an always-exact instantaneous read and uses more memory — ideal for write-heavy counters read occasionally (metrics), not for a value you must read-and-act-on atomically.
