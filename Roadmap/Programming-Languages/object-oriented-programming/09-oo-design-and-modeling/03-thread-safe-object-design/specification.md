# Thread-Safe Object Design — Specification Reading Guide

> Thread-safe object design is an *idiom*, but the guarantees that make it work are *binding spec text*: the Java Memory Model of JLS §17, the happens-before relation of §17.4.5, the final-field publication rule of §17.5, and the non-atomicity of `long`/`double` in §17.7. The canonical *design* literature is Brian Goetz et al., *Java Concurrency in Practice* — which is where the classifications (immutable / thread-safe / conditionally / not) and the safe-publication idioms come from. This file maps every claim in the topic to its source.

---

## 1. Where to find the canonical text

| Concept | Authoritative source |
| --- | --- |
| The Java Memory Model | **JLS §17.4** — *Memory Model* |
| Happens-before relation | **JLS §17.4.5** — *Happens-before Order* |
| Final-field publication guarantee | **JLS §17.5** — *`final` Field Semantics* |
| Reading final fields during construction; `this` escape | JLS §17.5.1, §17.5.2 |
| Non-atomicity of `long` / `double` | **JLS §17.7** — *Non-atomic Treatment of `double` and `long`* |
| `synchronized` statement semantics | JLS §14.19; monitor enter/exit JVMS §6.5 (`monitorenter`/`monitorexit`) |
| `volatile` field semantics | JLS §8.3.1.4; ordering in §17.4 |
| Word tearing | JLS §17.6 |
| The JMM redesign (the model in force) | **JSR-133** / **JEP 188** — *Java Memory Model and Thread Specification Update* |
| Thread-safety classifications & idioms | **Goetz et al., *Java Concurrency in Practice*** (the design canon) |
| `java.util.concurrent` contracts | Package Javadoc of `java.util.concurrent` and `...atomic`, `...locks` |
| `@GuardedBy`, `@ThreadSafe`, `@Immutable` | JSR-305 / `jcip-annotations` Javadoc |

The **JLS** is what `javac` and the JMM enforce; the **JCIP** book is what the *design vocabulary* comes from. The JMM tells you *whether* a publication is safe; JCIP tells you *which idiom* to reach for.

---

## 2. JLS §17.4.5 — happens-before, the foundational relation

The single most important paragraph for concurrent design. Verbatim (trimmed):

> *"If one action happens-before another, then the first is visible to and ordered before the second."* … *"It should be noted that the presence of a happens-before relationship between two actions does not necessarily imply that they have to take place in that order in an implementation. If the reordering produces results consistent with a legal execution, it is not illegal."*

The HB edges the spec enumerates (the ones a design relies on):

1. **Program order** — each action in a thread HB every later action *in that thread*.
2. **Monitor lock** — an unlock on monitor *m* HB every subsequent lock on *m*.
3. **Volatile** — a write to a volatile field HB every subsequent read of that field.
4. **Thread start** — a call to `Thread.start()` HB any action in the started thread.
5. **Thread termination** — the final action of a thread HB a `Thread.join()` that returns successfully.
6. **Transitivity** — if A HB B and B HB C, then A HB C.

A **data race** (§17.4.5) is two accesses to the same variable, at least one a write, *not ordered by happens-before*. Programs free of data races exhibit sequentially-consistent behavior (the *DRF guarantee*, §17.4.5). **Every thread-safe class is a construction of HB edges between writer and reader; a race is the absence of one.**

---

## 3. JLS §17.5 — the final-field publication guarantee

The rule that makes immutability thread-safe for free:

> *"An object is considered to be completely initialized when its constructor finishes. A thread that can only see a reference to an object after that object has been completely initialized is guaranteed to see the correctly initialized values for that object's final fields."*

Three load-bearing clauses:

1. **Final fields set in the constructor are visible after publication — with no synchronization.** The mechanism is a *freeze* (store-store barrier) at constructor exit.
2. **The guarantee is only for `final` fields.** Non-final fields require an explicit HB edge (§17.4.5).
3. **It is forfeited if `this` escapes the constructor** (§17.5.2): if the reference is published before the constructor returns, a reader can observe the field before the freeze and see its default value.

```java
public final class Range {
    private final int lo, hi;                 // §17.5 freeze applies
    public Range(int lo, int hi) { this.lo = lo; this.hi = hi; }
}
// Safe to share with no volatile/lock — provided 'this' did not escape the ctor.
```

§17.5.3 also notes: a `final` field modified after construction by *reflection* loses the guarantee. Don't mutate `final` fields reflectively in shared objects.

---

## 4. JLS §17.7 and §17.6 — atomicity and word tearing

**§17.7 — non-atomic `long`/`double`:**

> *"For the purposes of the Java programming language memory model, a single write to a non-volatile `long` or `double` value is treated as two separate writes: one to each 32-bit half."*

Consequence: a shared non-volatile `long`/`double` can be *torn* — a reader observes the high 32 bits of one write and the low 32 bits of another. Declaring the field `volatile` restores per-access atomicity (and visibility). All other primitive single reads/writes (and reference reads/writes) are atomic (§17.7), but atomicity of a single access never makes a compound operation atomic.

**§17.6 — word tearing:** the JVM must *not* let a write to one field/array element disturb an adjacent one. This is a guarantee you rely on implicitly (independent fields are independently writable) — but note it does *not* extend to `long`/`double` value atomicity, which §17.7 explicitly withholds.

---

## 5. JSR-133 / JEP 188 — the model actually in force

The original (Java 1.4 and earlier) memory model was broken — it failed to make double-checked locking work even with `volatile`, and under-specified final fields. **JSR-133** (folded into Java 5, and re-articulated as **JEP 188** for the OpenJDK era) replaced it with the happens-before model in §17.4. The key things JSR-133 fixed:

- **`volatile` now establishes happens-before** (so DCL works with a `volatile` field — see `senior.md` §5).
- **Final fields gained the §17.5 publication guarantee** (so immutable objects are safe without synchronization).
- **The model was defined in terms of happens-before and a precise "well-formed execution" theory**, replacing hand-wavy visibility rules.

When you cite "the Java Memory Model," you mean the JSR-133 model. Everything in `senior.md` — happens-before, the final-field freeze, fixed DCL — is JSR-133.

---

## 6. *Java Concurrency in Practice* — the design canon

The classifications and idioms in this topic are not in the JLS; they're the framework Goetz et al. built on top of it. Map the topic to its chapters:

| Topic concept | JCIP source |
| --- | --- |
| "Thread safety is a property of a class" | Ch. 2, *Thread Safety* |
| Confinement (stack, `ThreadLocal`, instance) | Ch. 3.3, *Thread Confinement* |
| The four classifications (immutable / thread-safe / conditionally / not) | Ch. 2 & Ch. 4 (the contract vocabulary) |
| Immutability as the simplest safety; effectively immutable | Ch. 3.4, *Immutability* |
| Safe publication idioms (the four ways) | Ch. 3.5, *Safe Publication* |
| `this` escaping during construction | Ch. 3.2, *Publication and Escape* |
| Composing objects; delegating thread safety; monitor pattern | Ch. 4, *Composing Objects* |
| `@GuardedBy`, documenting the synchronization policy | Ch. 4.5 & Appendix A, *Annotations for Concurrency* |
| Client-side locking; conditionally-thread-safe | Ch. 4.4, *Adding Functionality to Existing Thread-safe Classes* |
| Lock splitting / striping; reducing contention | Ch. 11, *Performance and Scalability* |
| Open calls, lock ordering, deadlock | Ch. 10, *Avoiding Liveness Hazards* |

Goetz is also the JLS §17 spec lead and a co-author of JSR-166 (`java.util.concurrent`), which is why JCIP is the bridge between the memory-model spec and the design idioms.

---

## 7. `java.util.concurrent` (JSR-166) — the building-block contracts

The classes you compose thread-safe objects from, and the spec-level guarantees each makes (read the package Javadoc — it states the HB edges explicitly):

- **Memory consistency properties** (package-info of `java.util.concurrent`): *"actions in a thread prior to placing an object into any concurrent collection happen-before actions subsequent to the access or removal of that element from the collection in another thread."* This is the formal license for the "concurrent collections publish safely" rule.
- **`java.util.concurrent.atomic`** — CAS-based atomics; `compareAndSet` has volatile read/write memory semantics. `AtomicStampedReference` for ABA. `LongAdder`/`LongAccumulator` for contended counters.
- **`java.util.concurrent.locks`** — `Lock`, `ReentrantLock`, `ReentrantReadWriteLock`, `StampedLock`, `Condition`. `Lock.lock()`/`unlock()` have the same HB semantics as monitor enter/exit.
- **`ConcurrentHashMap`** — atomic compound operations (`putIfAbsent`, `merge`, `compute`, `computeIfAbsent`) that remove the need for client-side locking.
- **`CopyOnWriteArrayList`/`CopyOnWriteArraySet`** — immutable-snapshot reads; mutation replaces the array.

The whole point of JSR-166 is that these encapsulate the §17.4.5 edges correctly so you don't have to.

---

## 8. The annotations — JSR-305 / `jcip-annotations`

The concurrency annotations are *documentation that tools can check*. Their definitions:

- **`@GuardedBy("lockExpr")`** — the field/method may only be accessed while holding the named lock. error-prone enforces this at compile time (`professional.md` §4).
- **`@ThreadSafe`** / **`@NotThreadSafe`** / **`@Immutable`** — declare the class's classification. `@Immutable` implies all the §17.5 conditions (final fields, no escaping mutable state).

These originate in the JCIP appendix and live today in `com.google.code.findbugs:jsr305`, `net.jcip:jcip-annotations`, and `com.github.spotbugs:spotbugs-annotations`. They are not enforced by the JLS — they are a *contract layer* the team and its tools agree on.

---

## 9. Verification: jcstress and the JMM cookbook

For proving memory-model correctness (not just reading the spec):

- **jcstress** (OpenJDK Java Concurrency Stress) — the reference harness for empirically testing whether a given access pattern admits a forbidden interleaving on real hardware. The authoritative *test suite* for the JMM itself is written in jcstress.
- **Doug Lea, "The JSR-133 Cookbook for Compiler Writers"** — the bridge between the abstract HB model and concrete memory barriers (LoadLoad, StoreStore, LoadStore, StoreLoad). Read it to understand *how* `volatile` and final-field freezes are implemented.
- **Aleksey Shipilëv, "Java Memory Model Pragmatics"** — the clearest non-spec exposition of §17, with jcstress demonstrations of every guarantee and every legal "surprising" reordering.

---

## 10. Reading list

1. **JLS §17.4** — *Memory Model*. Read §17.4.5 (happens-before) until it's second nature; it is the foundation of every claim in this topic.
2. **JLS §17.5** — *`final` Field Semantics*. Why immutable objects are thread-safe without synchronization.
3. **JLS §17.7, §17.6** — non-atomic `long`/`double` and word tearing.
4. **JSR-133 / JEP 188** — *Java Memory Model Update*. The model actually in force; what it fixed over the broken 1.4 model.
5. **Brian Goetz et al., *Java Concurrency in Practice* (2006).** The design canon. Chapters 2–4 (thread safety, sharing, composing) are the spine of this topic; Ch. 10–11 cover liveness and scalability.
6. **Doug Lea, "The JSR-133 Cookbook for Compiler Writers."** Maps happens-before to memory barriers.
7. **Doug Lea, *Concurrent Programming in Java* (2nd ed., 1999).** The predecessor text; the design patterns (monitor object, immutable, guarded suspension) originate here.
8. **Aleksey Shipilëv, "Java Memory Model Pragmatics."** The best practical guide to §17, with runnable jcstress evidence.
9. **`java.util.concurrent` package Javadoc** — read the "Memory Consistency Properties" section; it states the HB edges the JDK collections provide.
10. **OpenJDK jcstress** — the harness and its bundled samples; the empirical reference for what the JMM permits.

The spec sections do not *teach* thread-safe design — they define the guarantees you build on. When a reviewer asks "why is this immutable record safe without `volatile`?", cite **JLS §17.5**. When asked "why does this need `volatile` and a plain field doesn't suffice?", cite **§17.4.5** (no happens-before without it). When asked "why is the `long` torn?", cite **§17.7**. When asked "where do the classifications come from?", cite **JCIP Ch. 2–4**. The model gives you the levers; the design is judgment above it.
