# Thread-Safe Object Design — Professional

> Concurrency bugs don't fail your tests — they fail your customers, intermittently, six weeks later, on the busiest day. The professional's leverage is *prevention*: a review vocabulary that catches the bug at the diff, a documentation discipline that makes the policy auditable, and a tool chain (`@GuardedBy` + error-prone, SpotBugs, ThreadSanitizer-style detectors, jcstress) that finds what review misses. This file is the team-level practice of shipping shared classes safely.

---

## 1. The first review question: "what's the synchronization policy?"

Before reading the locking, ask the design question. For any class with mutable state that might be shared, the diff should answer — in code or a comment — exactly one sentence:

> *"This class's state is protected by X (immutable / confined / `volatile` / lock `L`), and the invariant it preserves is Y."*

If the PR can't answer that, the review isn't about whether the `synchronized` is in the right place — it's that **the author hasn't decided on a policy**, which is the actual defect. A class with three `synchronized` methods and one un-synchronized getter is not "almost right"; it has no coherent policy. Push back at the design level: "What's the policy, and is it written down?"

---

## 2. Review checklist — what to scan for in a concurrent class

| Smell in the diff | What it usually means |
| --- | --- |
| A getter without the lock the setters use | Visibility bug — reads see stale/torn state |
| `volatile` on a field that's read-modify-written (`v++`, `if(v==null) v=...`) | `volatile` mistaken for atomicity |
| `synchronized (this)` on a class exposed to callers | Public lock — external interference / deadlock risk |
| `synchronized (new Object())` or on a local | Locking on a lock nobody else holds — no mutual exclusion |
| `synchronized` on a `String`, `Boolean`, `Integer` | Locking on an interned/cached shared object — accidental cross-class contention |
| A `new ArrayList`/`HashMap` field accessed from `@Async`/executor code | Not-thread-safe collection shared across threads |
| `this` passed out in a constructor (`register(this)`, `new Thread(this)`) | Unsafe publication — `this` escapes |
| Getter returns the internal mutable collection/array directly | Escaped mutable state — caller can mutate under no lock |
| An overridable/listener call inside a `synchronized` block | Open-call hazard — alien code under the lock → deadlock |
| `check ... then act` across two calls on a concurrent collection | Compound-action race — needs an atomic compound op |
| `double`/`long` field shared without `volatile` or lock | Word-tearing risk |
| No class-level thread-safety Javadoc on a shared class | Undocumented contract — callers can't use it correctly |

The single highest-value scan: **find every field, then confirm every access path obeys one consistent policy.** Most concurrency bugs are one access path that forgot the rule.

---

## 3. `@GuardedBy` is documentation a tool can check

Annotate every guarded field with the lock that protects it. This turns an invisible convention into a checkable, greppable contract:

```java
import javax.annotation.concurrent.GuardedBy;       // JSR-305 / jsr305
import javax.annotation.concurrent.ThreadSafe;

@ThreadSafe
public class ConnectionPool {
    private final Object lock = new Object();
    @GuardedBy("lock") private final Deque<Conn> idle = new ArrayDeque<>();
    @GuardedBy("lock") private int leased;

    public Conn acquire() {
        synchronized (lock) {
            Conn c = idle.poll();
            if (c != null) { leased++; return c; }
            return null;
        }
    }
}
```

`@GuardedBy("lock")` says: *every read and write of `idle` and `leased` must happen while holding `lock`.* Now a tool can verify it. The companion `@ThreadSafe` / `@Immutable` / `@NotThreadSafe` annotations (from JCIP / `jcip-annotations` / `com.github.spotbugs:spotbugs-annotations`) document the *classification* on the class so reviewers and users see the contract at a glance.

---

## 4. error-prone: compile-time `@GuardedBy` enforcement

Google's **error-prone** ships a `GuardedBy` checker that *fails the build* when a `@GuardedBy` field is accessed without the named lock held. This is the most cost-effective concurrency tool you can adopt — it catches the #1 bug (an access path that forgot the lock) at compile time:

```java
@GuardedBy("lock") private int count;

void bad() { count++; }                 // error-prone ERROR: access without holding 'lock'
void good() { synchronized (lock) { count++; } }   // OK
```

Wire it into the build (Maven/Gradle) so every PR is checked. error-prone also flags `@Immutable` violations (a field of mutable type in an `@Immutable` class), `DoubleCheckedLocking` done without `volatile`, and `synchronized` on a value/boxed type. Treat its concurrency warnings as build-breaking, not advisory.

---

## 5. SpotBugs / FindBugs concurrency detectors

SpotBugs (the FindBugs successor) ships a strong set of static concurrency detectors. The ones worth knowing by their bug codes:

| Pattern | What it catches |
| --- | --- |
| `IS2_INCONSISTENT_SYNC` | A field synchronized on *some* accesses but not others — the inconsistent-lock smell |
| `DC_DOUBLECHECK` | Double-checked locking without `volatile` |
| `LI_LAZY_INIT_STATIC` | Unsynchronized lazy init of a static field |
| `JLM_JSR166_UTILCONCURRENT_MONITORENTER` | `synchronized` on a `java.util.concurrent.locks.Lock` (you meant `.lock()`) |
| `ML_SYNC_ON_UPDATED_FIELD` | Synchronizing on a field whose reference can change |
| `STCAL` | `SimpleDateFormat`/`Calendar` stored in a static/instance field (not thread-safe) |
| `SC_START_IN_CTOR` | Starting a thread in a constructor — `this` escape |
| `NP_*` under concurrency | Null-related races |

`IS2_INCONSISTENT_SYNC` alone justifies running SpotBugs — it's the automated version of the review scan in §2. Run it in CI and gate the merge on the concurrency category.

---

## 6. Dynamic race detection (ThreadSanitizer-style)

Static tools find *potential* races; dynamic detectors find *actual* HB violations at runtime by instrumenting memory accesses and tracking the happens-before graph. On the JVM the options are:

- **Java Flight Recorder + JDK Mission Control** — surfaces lock contention, monitor-blocked events, and `jdk.JavaMonitorEnter`/`jdk.ThreadPark` samples. Not a race detector, but the standard way to *find which lock is hot* in production (feeds `optimize.md`).
- **`async-profiler` lock mode** (`-e lock`) — flame graphs of contended monitors and `java.util.concurrent` locks; pinpoints the lock that's serializing your throughput.
- **Java PathFinder (JPF)** — a model checker that explores thread interleavings exhaustively for small programs; finds the one-in-a-billion interleaving deterministically.
- **ThreadSanitizer (TSan)** — native; relevant when your shared object crosses JNI/native boundaries.

The professional habit: **static checks gate the merge; JFR/`async-profiler` watch production for contention; JPF or jcstress prove the tricky cores.**

---

## 7. jcstress — proving the cores that review can't

For the genuinely hard, lock-free or publication-sensitive cores (a custom CAS structure, a double-checked-locking holder, a `volatile`-published snapshot), human review is *not enough* — the bug lives in an interleaving you can't enumerate by hand. **jcstress** (the Java Concurrency Stress harness, from the OpenJDK team) runs your code under millions of interleavings on real hardware and reports which outcomes actually occur:

```java
@JCStressTest
@Outcome(id = "1", expect = ACCEPTABLE,    desc = "saw fully constructed")
@Outcome(id = "0", expect = FORBIDDEN,     desc = "saw default / torn — RACE")
@State
public class PublicationTest {
    Holder h;                                   // is plain-field publication safe?
    @Actor public void writer() { h = new Holder(1); }
    @Actor public void reader(I_Result r) { Holder local = h; r.r1 = (local == null) ? -1 : local.x; }
}
```

If the `FORBIDDEN` outcome ever appears across the run, the publication is unsafe — jcstress will show you the count. **Adopt the rule: any lock-free or custom-publication code merges only with a passing jcstress test.** It's the unit test for memory-model correctness. (`tasks.md` has a build-and-run exercise.)

---

## 8. Refactoring playbook — making an unsafe class safe

When review finds an unsafe shared class, the fix order mirrors the strategy ladder — prefer the change that *removes* the need for locking:

1. **Can it be immutable?** Convert to a record / `final`-field class; return new instances instead of mutating. Removes the problem entirely. *First choice.*
2. **Can the state be confined?** If only one thread/owner needs it, stop sharing it (move it into a `ThreadLocal`, or into the one object that owns it). Removes the problem.
3. **Can it delegate?** Replace hand-rolled state with thread-safe components (`ConcurrentHashMap`, `AtomicLong`) when the fields are independent. Deletes your `synchronized`.
4. **Else, apply the monitor pattern.** Wrap all state behind a private lock; guard every access; make compound actions one lock hold; annotate `@GuardedBy`.
5. **Document the classification** and, if you chose *conditionally* thread-safe, the exact client-side locking protocol.

Each step up the list deletes a category of future bug. Adding a lock is the *last* resort, not the reflex.

---

## 9. Reviewing publication, not just locking

The bug review most often misses is **unsafe publication** — the locking inside the class is perfect, but the instance reaches other threads through a plain field, a non-volatile static, or an escaped `this`. Specific things to demand in review:

- A lazily-initialized field read by multiple threads is `volatile`, or uses the holder idiom, or is lock-guarded on both write and read.
- A field assigned once and read concurrently (config, cache) is published via `final`, `volatile`, or a concurrent collection.
- No constructor registers a listener, starts a thread, or stores `this` anywhere — factory-method-then-publish instead.
- An "effectively immutable" object (mutable type, frozen after build) is published through an HB edge, and there is a *comment asserting it's never mutated after publication*.

> Locking correctness is local — you can verify it in one class. Publication correctness is *global* — it depends on how every caller hands the object around. Review the *seams between threads*, not just the synchronized blocks.

---

## 10. When thread safety does *not* matter (and over-engineering costs)

Not every class should be thread-safe. Making a class thread-safe when it's never shared is a real cost: lock acquisition, reduced JIT inlining, contention, and — worst — *false confidence* that leads callers to skip the synchronization they actually need at a higher level. Skip thread safety, deliberately and with documentation, when:

- The object is **confined** — request-scoped, stack-local, or owned by one actor/thread (most domain entities in a request-per-thread web app).
- The object is a **DTO / builder** used by one thread then discarded.
- A **higher layer already serializes** access (a single-threaded executor, an actor mailbox, a `@Transactional` boundary with row locks).

The professional move is to *say so*: annotate `@NotThreadSafe` and state the confinement assumption. An undocumented not-thread-safe class is a bug; a documented one is a design decision. The mistake in both directions — needless locking and silent non-safety — comes from skipping the one-sentence policy statement from §1.

---

## 11. Team-level conventions worth standardizing

- **Every shared class carries a `@ThreadSafe` / `@Immutable` / `@NotThreadSafe` / "conditionally thread-safe" Javadoc tag.** No exceptions for "obvious" cases.
- **Every guarded field has `@GuardedBy`,** and error-prone enforces it in CI.
- **Private lock objects, never `this`,** for any new locking code.
- **Lock-free and custom-publication code requires a jcstress test** to merge.
- **A documented lock-ordering** for any code that holds two locks; ArchUnit or a code-owner check guards the order.
- **No alien/overridable calls inside `synchronized`** (open-call rule) — flagged in review.
- **Prefer `java.util.concurrent` over hand-rolled `synchronized`** as the default; deviations are justified in the PR.

---

## 12. What's next

- `optimize.md` — measuring contention with JFR/`async-profiler`, then reducing it (`LongAdder`, `StampedLock`, lock splitting, COW) without breaking safety.
- `find-bug.md` — a gallery of the exact smells this checklist scans for.
- [../02-oo-metrics-ck-suite/](../02-oo-metrics-ck-suite/) — high coupling/complexity correlates with un-reviewable locking; metrics flag the classes most likely to hide a race.
- [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/professional.md](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/professional.md) — driving immutability (the cheapest safety) across a codebase.

**The professional stance:** prevent, don't debug. The cheapest concurrency bug is the one error-prone breaks the build on. Demand a one-sentence policy per shared class, annotate every guarded field, gate the merge on static analysis, prove the lock-free cores with jcstress, and review the *seams between threads* (publication) as hard as the locks themselves.
