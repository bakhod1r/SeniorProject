# Thread-Safe Object Design — Junior

> **What?** *Thread safety* is a property of a **class**, not of a program: a class is thread-safe when instances behave correctly — preserving every invariant — no matter how many threads call its methods, in any interleaving, with no external synchronization required of the caller. This topic is about *designing the class*, not about writing concurrent algorithms. The question is always: "how do I build THIS object so it is safe to share?"
> **How?** There are exactly three strategies and you reach for them in order: (1) **don't share mutable state at all** (confinement — keep it on one thread or one owner), (2) **make the state immutable** (no state to race over), or (3) if you must share mutable state, **guard every access to it with the same lock** and document the rule. Most "thread-safety bugs" are really *broken invariants under concurrency* or *unsafe publication* — an object that escapes to another thread before it is fully built.

---

## 1. Thread safety is a property of a class, not a feeling

A class is thread-safe if it keeps its promises under concurrent access *without the caller doing anything special*. That last clause is the whole game. `ArrayList` is not thread-safe — not because it is "buggy", but because its contract requires the *caller* to synchronize. `ConcurrentHashMap` is thread-safe because it requires nothing of the caller.

So the design question for any class you write is one sentence: **"What does a caller have to do to use this safely from two threads?"** There are only three good answers:

| Answer | Strategy | Cost |
| --- | --- | --- |
| "Nothing — there is no shared mutable state" | Confinement | Free, but limits sharing |
| "Nothing — the object cannot change" | Immutability | Free at read time; copy cost on change |
| "Nothing — the object locks internally" | Guarded state | A lock, contention, care |

A *bad* answer is "the caller must hold a lock while using it" — that is not thread-safe, that is *conditionally* thread-safe, and it must be documented loudly (section 9). The worst answer is "it works on my machine" — that means the class has a race nobody has hit yet.

---

## 2. A race condition is a broken invariant, not a crash

Beginners imagine a data race as a corrupted value or a crash. The real bug is subtler: an **invariant that two threads can step through and break**. Classic example — a counter:

```java
public class Counter {
    private int count = 0;
    public void increment() { count++; }       // NOT atomic
    public int get() { return count; }
}
```

`count++` is three operations: read `count`, add one, write `count`. Two threads can both read `5`, both compute `6`, both write `6`. Two increments, one lost. Nothing crashed. The value is just *wrong* — and only sometimes, only under load, never in your unit test. This is the signature of a concurrency bug: silent, intermittent, invisible to single-threaded testing.

The invariant `Counter` failed to keep is "every `increment()` raises `count` by exactly one." The fix is to make the read-modify-write *atomic*:

```java
public class Counter {
    private final AtomicInteger count = new AtomicInteger();
    public void increment() { count.incrementAndGet(); }   // atomic
    public int get() { return count.get(); }
}
```

`AtomicInteger.incrementAndGet()` is a single indivisible operation. No interleaving can split it.

---

## 3. Strategy 1 — confinement: the state nobody shares can't race

The cheapest thread-safe design is to **never share the mutable state**. If an object lives on exactly one thread, no other thread can interfere with it. Three flavors:

- **Stack confinement.** A local variable is confined to the executing thread by construction. A `StringBuilder` created and used inside one method, never returned or stored, is thread-safe trivially — no other thread can ever reach it.

```java
public String join(List<String> parts) {
    StringBuilder sb = new StringBuilder();   // confined to this call
    for (String p : parts) sb.append(p);
    return sb.toString();                     // only the immutable String escapes
}
```

- **Thread confinement via `ThreadLocal`.** Each thread gets its own copy. `SimpleDateFormat` is famously not thread-safe; the classic fix is a `ThreadLocal<SimpleDateFormat>` so each thread has its own instance.

- **Instance confinement (ownership).** A class owns a mutable field privately and never lets a reference to it escape. The field is mutable, but only one object — guarded by that object's lock — ever touches it.

The rule: **a mutable object is safe as long as you can prove no two threads can reach it.** Confinement is that proof. The moment a reference escapes — returned from a getter, stored in a static, passed to another thread — confinement is broken and you fall back to strategy 2 or 3.

---

## 4. Strategy 2 — immutability is the simplest thread safety there is

> An immutable object is thread-safe by definition: there is no state to race over, so there is no race. No locks, no `volatile`, no `synchronized`.

This is why the sibling topic [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/) is the *foundation* of concurrent object design. An immutable class is the answer "nothing — the object cannot change" from the table in section 1.

```java
public record Money(long cents, Currency currency) {
    public Money {
        if (currency == null) throw new NullPointerException("currency");
    }
    public Money plus(Money other) {                  // returns a NEW Money
        if (!currency.equals(other.currency))
            throw new IllegalArgumentException("currency mismatch");
        return new Money(cents + other.cents, currency);
    }
}
```

A `Money` can be shared across a thousand threads with zero coordination. `plus` doesn't mutate — it returns a fresh value. Every thread that holds a `Money` holds a value that is true forever. Reach for immutability *first*. It is the only thread-safety strategy with no runtime cost and no way to get the locking wrong, because there is no locking.

The one catch — covered in section 8 — is **safe publication**: even an immutable object can be seen half-built by another thread if you publish it carelessly. The `final` fields of a record close that hole for you (section 8).

---

## 5. Strategy 3 — guard shared mutable state with a lock

When you genuinely must share mutable state — a cache, a connection pool, an accumulator — you protect it with a **lock**, and you follow one rule with no exceptions:

> **Every access (read AND write) to a mutable shared field is performed while holding the same lock.**

The lock is what makes a multi-step operation atomic and makes one thread's writes visible to the next thread to acquire the lock. The simplest lock in Java is the *intrinsic lock* every object carries, used via `synchronized`:

```java
public class BankAccount {
    private long balance;                       // guarded by 'this'

    public synchronized void deposit(long amount) {
        balance += amount;
    }
    public synchronized void withdraw(long amount) {
        if (amount > balance) throw new IllegalStateException("insufficient funds");
        balance -= amount;
    }
    public synchronized long balance() {
        return balance;                         // read is synchronized TOO
    }
}
```

Three things every beginner gets wrong here:

1. **The read is synchronized too.** If `balance()` is not `synchronized`, a reader can see a stale value or a torn `long`. Reads need the lock as much as writes.
2. **The same lock guards every method.** `synchronized` methods all lock on `this`. If one method locks on a different object, the invariant is unprotected.
3. **The check and the act are inside one lock hold.** In `withdraw`, the `amount > balance` test and the `balance -= amount` must be one atomic step. Split them across two lock acquisitions and another thread can withdraw in between — the classic *check-then-act* race.

---

## 6. Compound actions: the invariant spans more than one field

Locking gets harder when an invariant relates *two* fields. Suppose a cache must keep "the cached value always matches the cached key":

```java
public class OneEntryCache {
    private Object key;
    private Object value;

    // BROKEN even though each field write is "atomic"
    public void put(Object k, Object v) {
        this.key = k;          // a reader between these two lines
        this.value = v;        // sees key=k but value=old
    }
}
```

Each individual assignment is atomic, yet the *pair* is not. A reader that runs between the two lines sees a key and value that don't belong together — the invariant is broken. The fix is to make the *whole compound action* atomic under one lock:

```java
public class OneEntryCache {
    private Object key, value;

    public synchronized void put(Object k, Object v) { key = k; value = v; }
    public synchronized Object get(Object k) {
        return k.equals(key) ? value : null;
    }
}
```

**The lesson: identify the invariant first, then make sure every code path that could observe or break it runs under the same lock.** Thread safety is about protecting *invariants that span state*, not about protecting individual fields.

---

## 7. Don't reinvent locking — use `java.util.concurrent`

Hand-rolled locking is where bugs live. For most needs, the JDK already ships a correct, fast, thread-safe building block. Prefer them:

| Need | Use | Not |
| --- | --- | --- |
| A counter | `AtomicInteger` / `AtomicLong` / `LongAdder` | `synchronized int++` |
| A shared map | `ConcurrentHashMap` | `synchronized HashMap` |
| A work queue between threads | `LinkedBlockingQueue` / `ArrayBlockingQueue` | `synchronized LinkedList` |
| A lazily-set reference | `AtomicReference` | `volatile` + manual CAS |
| A read-mostly list | `CopyOnWriteArrayList` | `synchronized ArrayList` |

These classes have been reviewed, stress-tested, and proven for two decades. Composing your class out of them (section 10) is usually safer than writing `synchronized` blocks yourself.

```java
// A thread-safe registry built by delegation — no synchronized needed.
public class ServiceRegistry {
    private final ConcurrentHashMap<String, Service> services = new ConcurrentHashMap<>();
    public void register(String name, Service s) { services.put(name, s); }
    public Service lookup(String name) { return services.get(name); }
}
```

---

## 8. Safe publication: even a perfect object can leak half-built

You can design a flawless immutable class and *still* have a bug — if you let another thread see the object **before it is fully constructed**. This is *unsafe publication*, and it is the most counterintuitive concurrency bug there is.

```java
// Holder is published via a plain field with no synchronization.
public class Holder {
    private Config config;                    // not final, not volatile
    public void init() { config = new Config(...); }
    public Config get() { return config; }    // another thread may see null OR a half-built Config
}
```

Without a *happens-before* relationship between the write in `init()` and the read in `get()`, the Java Memory Model gives the reading thread no guarantee it sees the new `Config` at all — or it may see the reference but not the fields the constructor set. To **publish safely**, use one of:

- **Initialize in a `final` field** — the JMM guarantees a fully-built object is visible (this is why immutable records are safe to share). See `specification.md`.
- **Store through a `volatile` field** or an `AtomicReference`.
- **Store while holding a lock**, and read while holding the same lock.
- **Store into a `ConcurrentHashMap` / `BlockingQueue`** (they publish safely internally).

```java
public class Holder {
    private volatile Config config;           // volatile establishes happens-before
    public void init() { config = new Config(...); }
    public Config get() { return config; }    // sees a fully-built Config, or null — never half-built
}
```

**Safe publication is half of thread-safe design.** A class can have perfect internal locking and still be broken if the *instance itself* is published unsafely.

---

## 9. Document the thread-safety of every shared class

Thread safety is part of the **contract** — invisible in the type signature, so it must be in the Javadoc. The standard four classifications (from *Java Concurrency in Practice*):

| Classification | Meaning | Example |
| --- | --- | --- |
| **Immutable** | No state changes after construction; always safe | `String`, `Money` record |
| **Thread-safe** | Safe to call concurrently with no external sync | `ConcurrentHashMap`, `AtomicInteger` |
| **Conditionally thread-safe** | Individual calls safe; *sequences* need external locking | `Collections.synchronizedMap` (iteration) |
| **Not thread-safe** | Caller must synchronize all access | `ArrayList`, `HashMap`, `SimpleDateFormat` |

Write it down. The `@GuardedBy` annotation documents *which lock protects which field* so the next maintainer (and static-analysis tools) know the rule:

```java
public class TaskQueue {
    private final Object lock = new Object();

    @GuardedBy("lock") private int pending;        // the lock that guards this field
    @GuardedBy("lock") private boolean draining;

    public void submit() {
        synchronized (lock) { if (!draining) pending++; }
    }
}
```

`@GuardedBy("lock")` says "you may only touch `pending` while holding `lock`." A reviewer or tool can then check every access obeys it.

---

## 10. Composing thread-safe classes (and why it isn't automatic)

A trap: **combining two thread-safe objects does not give you a thread-safe operation.** Each call is safe; the *sequence* is not.

```java
ConcurrentHashMap<String, Integer> counts = new ConcurrentHashMap<>();

// BROKEN: get-then-put is two atomic operations, not one
Integer current = counts.get(key);            // thread A reads 5
counts.put(key, (current == null ? 0 : current) + 1);  // both A and B write 6 — lost update
```

Both `get` and `put` are individually thread-safe, but the read-modify-write across them is a check-then-act race. The fix is to use the *compound* atomic operation the class provides:

```java
counts.merge(key, 1, Integer::sum);           // one atomic operation
```

When you build a bigger class out of thread-safe parts, you must either (a) compose using the parts' built-in atomic operations, or (b) add your own lock around the multi-step operation. "Made of thread-safe pieces" is necessary but not sufficient — the *invariant across the pieces* is yours to protect.

---

## 11. Quick rules

- [ ] State the thread-safety policy of every shared class in one sentence before you write it.
- [ ] Reach for **immutability first**, **confinement second**, **locking last**.
- [ ] If state is mutable and shared, guard *every* access — reads included — with the *same* lock.
- [ ] Make the **invariant**, not the field, the unit you protect. Compound actions need one lock hold.
- [ ] Prefer `java.util.concurrent` building blocks to hand-rolled `synchronized`.
- [ ] Publish shared objects safely: `final` field, `volatile`, lock, or a concurrent collection.
- [ ] Document the classification (immutable / thread-safe / conditionally / not) in Javadoc.
- [ ] Annotate guarded fields with `@GuardedBy("theLock")`.
- [ ] Composing thread-safe parts does not make compound operations atomic — use atomic compound methods or your own lock.

---

## 12. What's next

| Topic | File |
| --- | --- |
| Locking patterns, `volatile`, atomics, building conditionally-thread-safe classes | `middle.md` |
| The Java Memory Model, happens-before, final-field semantics, lock striping internals | `senior.md` |
| Reviewing for thread safety; `@GuardedBy`, error-prone, SpotBugs, ThreadSanitizer | `professional.md` |
| JLS §17 (JMM), §17.5 (final fields), JEP 188, *Java Concurrency in Practice* | `specification.md` |
| Spot the race / broken-invariant / unsafe-publication bug | `find-bug.md` |
| Reduce lock contention while preserving safety; lock splitting, COW trade-offs | `optimize.md` |
| Hands-on exercises, including a jcstress verification harness | `tasks.md` |
| Interview Q&A on thread-safe object design | `interview.md` |

Related topics:

- [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/) — immutability is the simplest thread-safety strategy.
- [../01-grasp-responsibility-assignment/](../01-grasp-responsibility-assignment/) — *Information Expert* and *Creator* decide who owns (and therefore who locks) state.
- [../04-designing-for-extension-and-polymorphism/](../04-designing-for-extension-and-polymorphism/) — extension points and thread safety interact: an overridable method called while holding a lock is a hazard.

---

**Memorize this:** thread safety is a property of a *class* — "what must the caller do to use this from two threads?" The three good answers, in order of preference, are *nothing because there's no shared state* (confinement), *nothing because it can't change* (immutability), and *nothing because it locks internally* (guarded state). Protect **invariants**, not individual fields; guard every access — reads included — with the *same* lock; publish shared objects safely; and write the classification down. Most concurrency bugs are broken invariants or unsafe publication, not crashes.
