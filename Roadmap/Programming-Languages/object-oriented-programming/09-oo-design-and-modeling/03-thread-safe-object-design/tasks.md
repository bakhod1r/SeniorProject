# Thread-Safe Object Design — Tasks

> Hands-on exercises, graded easy → hard. Each has explicit acceptance criteria. The capstone is a **jcstress** harness that empirically proves (or disproves) a publication/visibility property on real hardware — the unit test for memory-model correctness. Do them in order; later tasks assume the earlier mechanisms.

---

## Task 1 (easy) — Classify ten classes

For each, state the thread-safety classification (Immutable / Thread-safe / Conditionally thread-safe / Not thread-safe) and one sentence of justification: `String`, `StringBuilder`, `ArrayList`, `ConcurrentHashMap`, `Collections.synchronizedList(...)`, `AtomicLong`, `SimpleDateFormat`, a `record Point(int x, int y)`, `HashMap`, `CopyOnWriteArrayList`.

**Acceptance:** all ten correct. Key traps: `StringBuilder` (not thread-safe — `StringBuffer` is), `synchronizedList` (conditionally — iteration needs client locking), `SimpleDateFormat` (not thread-safe, famously). Confirm your answers against each type's Javadoc.

---

## Task 2 (easy) — Make a mutable class immutable

Given:
```java
public class Interval {
    private int start, end;
    public void setStart(int s) { start = s; }
    public void setEnd(int e) { end = e; }
    public int getStart() { return start; }
    public int getEnd() { return end; }
}
```
Convert it to an immutable class that's thread-safe with no locks. Add a `shift(int delta)` that returns a *new* `Interval`, and validate `start <= end` in the constructor.

**Acceptance:** a `record` or `final` class with `private final` fields, no setters, constructor validation, and `shift` returning a new instance. Justify in one sentence (cite JLS §17.5) why it needs no `synchronized`/`volatile` despite being shared across threads.

---

## Task 3 (easy) — Fix a visibility bug with `volatile`

This worker never stops:
```java
public class Job implements Runnable {
    private boolean cancelled = false;
    public void cancel() { cancelled = true; }
    public void run() { while (!cancelled) work(); }
}
```
Make `cancel()` reliably stop `run()`. Then write a 5-line `main` that starts the job on a thread, sleeps 100ms, calls `cancel()`, and `join()`s — and verify it terminates.

**Acceptance:** `cancelled` is `volatile`; the program terminates. Bonus: explain why a plain `boolean` *may* loop forever (the JIT can hoist the read out of the loop — no happens-before edge to the writer).

---

## Task 4 (medium) — Replace a lost-update race with an atomic

This rate-meter loses counts under load:
```java
public class Meter {
    private long hits = 0;
    public void hit() { hits++; }
    public long hits() { return hits; }
}
```
Produce two correct versions: (a) using `synchronized`, (b) using `AtomicLong` or `LongAdder`. Then write a test that launches 8 threads each calling `hit()` 100_000 times and asserts the final count is exactly 800_000.

**Acceptance:** both versions pass the 800_000 assertion across repeated runs; the original fails it at least once. Note which version you'd pick for a high-write metric and why (`LongAdder` — see `optimize.md`).

---

## Task 5 (medium) — Build a conditionally-thread-safe class, documented

Wrap a `HashMap` in a class `Registry<K,V>` that is *conditionally* thread-safe: individual `put`/`get`/`remove` are atomic, but a `putIfAbsent`-style compound must be done by the caller under a documented lock. Provide the lock and Javadoc the exact client-side locking protocol with an example.

**Acceptance:** individual ops `synchronized`; class Javadoc states "conditionally thread-safe; for compound operations hold the intrinsic lock of this instance" with a runnable example (`synchronized(registry){ if(!registry.has(k)) registry.put(k,v); }`). A reviewer could use it correctly from the doc alone.

---

## Task 6 (medium) — Apply the monitor pattern

Implement `BoundedBuffer<E>` (capacity N) with `boolean offer(E)` (false if full) and `E poll()` (null if empty), wrapping a plain `ArrayDeque` confined inside the class, all access serialized through one private lock. The `offer` capacity check and the add must be a single atomic step.

**Acceptance:** the `ArrayDeque` field never escapes; one private `final Object lock`; every method is one `synchronized(lock)` block; `offer`'s check-then-add is atomic. Annotate the deque field `@GuardedBy("lock")`. Verify with two threads (one offering, one polling) that size never exceeds N and no element is lost or duplicated.

---

## Task 7 (medium) — Catch a `this`-escape and fix it

Diagnose and fix:
```java
public class Sensor {
    private final List<Reading> readings = new ArrayList<>();
    public Sensor(Bus bus) { bus.subscribe(this); }   // ???
    public void onReading(Reading r) { readings.add(r); }
}
```
Explain the publication hazard, then refactor to a static factory so `this` is published only after construction completes. Separately, make `readings` itself safe for concurrent `onReading` calls.

**Acceptance:** a `private` constructor + `static Sensor create(Bus bus)` that constructs then subscribes; `readings` is a thread-safe collection (or all access is guarded). One sentence explaining why the original could deliver a callback to a half-built `Sensor`.

---

## Task 8 (hard) — Effectively-immutable snapshot with `volatile` swap

Build `ConfigStore`: holds a read-mostly `Map<String,String>`. Readers (`get(key)`) are lock-free and always see a consistent snapshot; `reload(Map)` atomically swaps in a fresh immutable copy. Implement it, then argue (a) why readers need no lock, (b) why the swapped-in map must never be mutated after publication, (c) which JMM edge makes the swap visible.

**Acceptance:** a `volatile Map<String,String> snapshot`; `reload` does `snapshot = Map.copyOf(fresh)`; `get` reads `snapshot`. Written answers: (a) reads see a complete immutable map; (b) effective immutability requires no post-publication mutation; (c) the volatile write→read happens-before edge (JLS §17.4.5). Bonus: contrast with `CopyOnWriteArrayList`'s strategy.

---

## Task 9 (hard) — Reduce contention without breaking safety

Start from a single-lock `Server` that guards both a `readCount` and a `writeCount` (independent — no shared invariant). Profile it under contention (use `async-profiler -e lock` or JFR's `jdk.JavaMonitorEnter`), then apply lock splitting so readers and writers don't block each other. Re-profile and report the change in contended-lock time.

**Acceptance:** two private locks, each guarding one counter, each field `@GuardedBy(...)`; a written justification that the two counters share *no* invariant (so splitting is safe); before/after contention numbers from the profiler. Trap to avoid: do *not* split if you later add an invariant relating the two counts.

---

## Task 10 (hard, capstone) — Prove publication safety with jcstress

Use the OpenJDK **jcstress** harness to empirically test whether plain-field publication is unsafe. Set up the project (Maven archetype `org.openjdk.jcstress:jcstress-java-test-archetype`), then write this test and run it:

```java
@JCStressTest
@Outcome(id = "42", expect = ACCEPTABLE, desc = "fully published")
@Outcome(id = "0",  expect = ACCEPTABLE_INTERESTING, desc = "saw default field — UNSAFE publication observed")
@Outcome(id = "-1", expect = ACCEPTABLE, desc = "saw null reference")
@State
public class UnsafePublication {
    static class Holder { int x; Holder() { x = 42; } }   // plain int field
    Holder h;                                             // plain reference field
    @Actor public void writer() { h = new Holder(); }
    @Actor public void reader(I_Result r) {
        Holder local = h;
        r.r1 = (local == null) ? -1 : local.x;            // can be 0 under a race!
    }
}
```
Run with `java -jar target/jcstress.jar -t UnsafePublication`. Then write a *second* test, `SafePublication`, that publishes through a `final` field (Holder built via a `final`-field path) or a `volatile` reference, and show the `0` outcome becomes `FORBIDDEN` and never occurs.

**Acceptance:** the unsafe test reports the `0` ("saw default 0") outcome with a nonzero count on at least one run (proving the race is real on your hardware); the safe test never produces `0`. Write two sentences mapping the difference to JLS §17.5 (final-field freeze) / §17.4.5 (volatile happens-before). This is the deliverable: *evidence*, not an argument, that publication matters.

---

## Stretch goals

- **S1 — Deadlock by lock ordering.** Write two methods that acquire locks A,B and B,A respectively; reproduce a deadlock with two threads; capture it with `jstack` (look for "Found one Java-level deadlock"); fix by imposing a global lock order.
- **S2 — Open-call hazard.** Build a class that calls a listener inside `synchronized`; have a listener re-enter the class and acquire a second lock; show the deadlock; refactor to copy-then-release-then-call.
- **S3 — `StampedLock` optimistic read.** Reimplement Task 8's reader with `StampedLock.tryOptimisticRead()` and benchmark read throughput vs the `volatile`-snapshot version with JMH.
- **S4 — error-prone `@GuardedBy`.** Wire error-prone into a Gradle/Maven build; add a `@GuardedBy` field; access it without the lock; confirm the build fails; fix it.
