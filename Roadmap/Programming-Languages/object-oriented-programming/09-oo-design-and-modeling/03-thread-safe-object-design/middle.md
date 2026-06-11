# Thread-Safe Object Design — Middle

> You can state the three strategies (confine, immutable, guard). Now you design real classes with them: choosing the right lock granularity, building *conditionally* thread-safe classes deliberately, using `volatile` where a lock is overkill, and recognizing the four ways a class can publish state safely. This file is the working vocabulary of a developer who ships shared classes.

---

## 1. Pick the smallest synchronization policy that holds the invariant

Every shared class has a **synchronization policy** — the explicit rule for how its state is accessed. Good design picks the *weakest* policy that still preserves the invariant, because weaker policies are cheaper and harder to misuse. The ladder, weakest first:

1. **Immutable** — no policy needed; the class is stateless-after-construction.
2. **Effectively immutable** — mutable type, never mutated after safe publication.
3. **Confined** — state never escapes one thread or one owner.
4. **`volatile` field** — a single field, written and read independently, no compound invariant.
5. **Atomic variable** — a single field that needs read-modify-write atomicity.
6. **A single lock** — a compound invariant over several fields.
7. **Multiple locks / lock striping** — a compound invariant, but contention forces splitting (see `optimize.md`).

The skill is matching the policy to the invariant. A `volatile boolean shutdown` flag needs (4), not a lock — there's no compound invariant. A balance-and-history pair needs (6) — one lock around both. Reaching for `synchronized` when `volatile` suffices is over-locking; reaching for `volatile` when there's a compound invariant is a *bug*.

---

## 2. `volatile`: visibility without atomicity

`volatile` guarantees two things and nothing more:

- **Visibility.** A write to a `volatile` field is immediately visible to every subsequent read of that field by any thread (it establishes a happens-before edge — see `senior.md`).
- **No reordering across it.** Reads/writes before a volatile write can't be moved after it, and vice versa.

It does **not** make compound operations atomic. The canonical correct use is a one-way status flag:

```java
public class Worker implements Runnable {
    private volatile boolean running = true;     // visibility flag

    public void stop() { running = false; }      // visible to run() immediately

    public void run() {
        while (running) { doWork(); }            // a plain (non-volatile) field could loop forever
    }
}
```

Without `volatile`, the JIT may hoist `running` into a register and `run()` may *never* see `stop()`'s write — an infinite loop that only appears in production. `volatile` fixes that. But the moment the operation is read-modify-write — `count++`, "if not set, set" — `volatile` is wrong and you need an atomic or a lock:

```java
private volatile int count;
count++;     // BUG: still a race — read, increment, write is not atomic
```

The litmus test: **use `volatile` only when the new value does not depend on the old value, and the field participates in no multi-field invariant.**

---

## 3. Atomic variables: lock-free read-modify-write

`java.util.concurrent.atomic` gives you single-variable atomicity without a lock, via the CPU's compare-and-swap (CAS) instruction. The workhorses:

```java
AtomicInteger seq = new AtomicInteger();
int id = seq.incrementAndGet();                  // atomic ++ , returns new value

AtomicReference<Config> cfg = new AtomicReference<>(initial);
cfg.compareAndSet(old, replacement);             // swap only if unchanged

AtomicLong total = new AtomicLong();
total.addAndGet(amount);
```

The general pattern for "update based on current value without a lock" is a **CAS retry loop**, which `updateAndGet` packages for you:

```java
AtomicReference<BigDecimal> price = new AtomicReference<>(BigDecimal.ZERO);
price.updateAndGet(p -> p.multiply(BigDecimal.valueOf(1.1)));   // atomic, retries on contention
```

Under the hood, `updateAndGet` reads the current value, computes the new one, and `compareAndSet`s; if another thread changed it meanwhile, it retries. **The lambda must be pure and side-effect-free** — it may run multiple times. Under heavy write contention on a single counter, `LongAdder` outperforms `AtomicLong` by spreading writes across cells and summing on read (see `optimize.md`).

---

## 4. Intrinsic locks vs explicit locks

Java gives you two locking mechanisms. Know when each fits.

**Intrinsic lock (`synchronized`)** — every object has one monitor; `synchronized` acquires it.

```java
public synchronized void m() { ... }    // locks on 'this'
synchronized (lock) { ... }             // locks on an explicit object
```

Strengths: concise, automatically released on exception (the lock is scoped to the block), JIT-optimized (biased/lightweight locking historically, lock elision). Limitations: not interruptible, no timeout, no `tryLock`, strictly block-scoped (can't acquire in one method and release in another), only one implicit condition queue.

**Explicit lock (`ReentrantLock`)** — a `Lock` object you manage by hand.

```java
private final ReentrantLock lock = new ReentrantLock();
public void m() {
    lock.lock();
    try { ... } finally { lock.unlock(); }      // YOU must release in finally
}
```

Strengths: `tryLock()` (with timeout), `lockInterruptibly()`, multiple `Condition`s, optional fairness, can span method boundaries. Cost: you *must* `unlock()` in a `finally`, or a thrown exception leaks the lock forever. **Default to `synchronized`; reach for `ReentrantLock` only when you need a feature it lacks** (timeouts, interruptibility, multiple conditions, hand-over-hand locking).

`ReentrantReadWriteLock` and `StampedLock` are specializations for read-heavy state — covered in `optimize.md`.

---

## 5. Use a private lock object, not `this`

`synchronized` methods lock on `this`, which is a *public* lock — any external code holding a reference to your object can `synchronized (yourObject)` and interfere with your locking, cause a deadlock, or starve your threads. The robust idiom is a **private final lock object** nobody else can see:

```java
public class Ledger {
    private final Object lock = new Object();      // private — no external interference
    @GuardedBy("lock") private long balance;

    public void credit(long n) { synchronized (lock) { balance += n; } }
    public long balance()      { synchronized (lock) { return balance; } }
}
```

Now the locking policy is fully encapsulated: the only code that can acquire `lock` is code inside `Ledger`. This also lets you reason locally — you can *prove* the invariant by reading one class, because no outsider can participate in the lock. Locking on `this` (or worse, on a shared/interned object like a `String` or `Boolean`) breaks that encapsulation.

---

## 6. Designing a *conditionally* thread-safe class on purpose

Sometimes a class is individually thread-safe per call but a *sequence* of calls needs the caller to lock — and that's a legitimate, documented design. The canonical case is iteration over a synchronized collection:

```java
Map<String, Integer> m = Collections.synchronizedMap(new HashMap<>());
m.put("a", 1);                 // individually safe

// Iteration is a compound operation — the caller MUST lock the map
synchronized (m) {             // lock the same monitor synchronizedMap uses
    for (var e : m.entrySet()) { ... }
}
```

When you ship a conditionally-thread-safe class, you must **publish which lock the caller acquires** and **for which operations**. Document it precisely:

```java
/**
 * Conditionally thread-safe. Individual method calls are atomic.
 * To perform a compound operation (e.g. iterate, or check-then-act),
 * the caller must hold the intrinsic lock of this instance:
 *
 *   synchronized (registry) { if (!registry.contains(k)) registry.add(k); }
 */
public class Registry { ... }
```

A conditionally-thread-safe class that *doesn't* document the lock is a landmine — callers can't possibly use it correctly. This is the difference between `Collections.synchronizedMap` (documented, usable) and a class that "just uses `synchronized` internally somewhere."

---

## 7. The four ways to publish state safely

A class is only as safe as the way its instance — and its internal references — reach other threads. *Java Concurrency in Practice* §3.5 lists the safe-publication idioms; memorize them, because unsafe publication is the bug that survives perfect internal locking:

| Idiom | Why it's safe |
| --- | --- |
| Initialize the reference from a **static initializer** | Class init holds a lock; visible to all |
| Store into a **`volatile` field** or `AtomicReference` | Volatile write happens-before the read |
| Store into a **`final` field** of a properly-constructed object | Final-field freeze (JLS §17.5) |
| Store into a field **guarded by a lock** | Monitor release happens-before acquire |
| Hand off via a **`java.util.concurrent` collection** (`BlockingQueue`, `ConcurrentMap`) | These publish elements safely internally |

```java
// Safe handoff: the queue publishes the task to the consumer thread safely.
BlockingQueue<Task> queue = new LinkedBlockingQueue<>();
queue.put(new Task(payload));     // producer
Task t = queue.take();            // consumer sees a fully-constructed Task
```

The opposite — storing into a plain non-final, non-volatile field and letting another thread read it without synchronization — is **unsafe publication**: the reader may see `null`, a stale value, or an object whose fields aren't all set yet.

---

## 8. Don't let `this` escape during construction

A subtle publication bug: if a constructor publishes `this` *before it finishes*, another thread can see a partially-constructed object — even one with `final` fields, because the final-field guarantee only applies to *completely* constructed objects.

```java
public class EventSource {
    private final List<Listener> listeners;
    public EventSource(EventBus bus) {
        this.listeners = new ArrayList<>();
        bus.register(this);          // BUG: 'this' escapes before the constructor returns
    }                                // another thread may call back into a half-built EventSource
}
```

Three ways `this` escapes a constructor: registering a listener/callback with `this`, starting a thread that captures `this` (`new Thread(this).start()`), or storing `this` in a static or shared field. The fix is to **finish construction first, then publish** — a static factory method is the standard idiom:

```java
public class EventSource {
    private final List<Listener> listeners = new ArrayList<>();
    private EventSource() { }

    public static EventSource create(EventBus bus) {
        EventSource src = new EventSource();    // fully constructed
        bus.register(src);                      // then published
        return src;
    }
}
```

---

## 9. Delegating thread safety: the cheapest correct design

If your class's entire state lives in *already-thread-safe* components, and there's no invariant *across* them, you can **delegate** thread safety to those components and write no synchronization yourself:

```java
public class VisitCounters {
    // Each counter is independent; no cross-field invariant.
    private final ConcurrentHashMap<String, AtomicLong> counts = new ConcurrentHashMap<>();

    public void record(String page) {
        counts.computeIfAbsent(page, p -> new AtomicLong()).incrementAndGet();
    }
    public long count(String page) {
        AtomicLong c = counts.get(page);
        return c == null ? 0 : c.get();
    }
}
```

`VisitCounters` is thread-safe with zero `synchronized` blocks — it inherits safety from `ConcurrentHashMap` and `AtomicLong`. **Delegation works precisely when the state variables are independent.** The moment two delegated components share an invariant (e.g. "the size field must equal the map's size"), delegation fails and you must add a lock spanning both — this is the trap from `junior.md` §10.

---

## 10. Adding state to a thread-safe class

When you extend a thread-safe class or wrap it, you must use *the same lock* it uses internally, or your added operation isn't atomic with respect to the base. Three approaches, in order of safety:

1. **Extension** — subclass and add `synchronized` methods. Fragile: works only if the base locks on `this`, and you're coupled to the base's locking policy, which it may change.
2. **Client-side locking** — lock on the base object's lock from outside. Brittle: you must know and match the base's lock; breaks if the base uses a private lock.
3. **Composition (the *monitor pattern*)** — wrap the base in your own class with your own lock, delegating each call inside your lock. Most robust:

```java
public class BoundedList<E> {
    private final List<E> list = new ArrayList<>();   // confined — never escapes
    private final int max;
    public BoundedList(int max) { this.max = max; }

    public synchronized boolean addIfRoom(E e) {      // compound action, our lock
        if (list.size() >= max) return false;
        list.add(e);
        return true;
    }
    public synchronized int size() { return list.size(); }
}
```

Here the underlying `ArrayList` need not be thread-safe at all — it's *confined* inside `BoundedList`, which serializes every access through its own lock. This is the **monitor pattern**: a plain mutable object made safe by wrapping all access in one lock you own. It is the most reliable way to add a compound invariant on top of existing state.

---

## 11. Summary table — choosing the mechanism

| Situation | Right tool |
| --- | --- |
| State never changes after construction | Immutable class / record |
| Mutable but never shared | Confinement (stack / `ThreadLocal` / ownership) |
| Single field, value independent of old value | `volatile` |
| Single field, read-modify-write | `AtomicInteger`/`AtomicReference` |
| Compound invariant over several fields | One private lock + `synchronized` |
| Need timeout / interruptible / multiple conditions | `ReentrantLock` |
| State is independent thread-safe components | Delegate, no extra lock |
| Add compound action atop existing state | Monitor pattern (composition) |

---

## 12. What's next

- `senior.md` — the JMM, happens-before, why `final` fields are special, reordering, and the failure modes of each mechanism.
- `professional.md` — finding these issues in review and with tooling.
- [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/middle.md](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/middle.md) — building the immutable classes that make most of this moot.
- [../01-grasp-responsibility-assignment/](../01-grasp-responsibility-assignment/) — *Information Expert* tells you which object should own (and therefore lock) the state.

**Remember:** pick the *weakest* synchronization policy that holds the invariant — immutable < confined < volatile < atomic < single lock < striped. Use a private lock, not `this`. Publish via final/volatile/lock/concurrent-collection, never a plain field. Delegate to thread-safe components when their state is independent; wrap in the monitor pattern when an invariant spans them.
