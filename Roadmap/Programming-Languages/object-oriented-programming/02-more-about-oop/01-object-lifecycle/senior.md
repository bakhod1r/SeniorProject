# Object Lifecycle — Senior

> **What?** Lifecycle from the GC's point of view: how generational and region-based collectors actually run, what reachability analysis costs, what escape analysis does for short-lived objects, why finalizers are dead, and how `Cleaner` and `PhantomReference` give you safe, predictable cleanup.
> **How?** By understanding HotSpot's TLABs and bump-pointer allocation, the marking phases of G1 and ZGC, the JVM flags that surface this behavior, and the patterns the JDK itself uses (e.g., `Cleaner` in `DirectByteBuffer`, weak references in WeakHashMap).

---

## 1. The full lifecycle from the JVM's perspective

```
[allocation site]   [TLAB bump]   [eden]   [survivor]   [old]   [unreachable]   [reclaim]
                                    │          │          │
                                  young GC   young GC   old GC
                                  (minor)    (minor)    (major / mixed)
```

Most objects live and die entirely in eden — never seen by an old-gen collection. This is the "weak generational hypothesis," empirically verified in production for decades.

| GC algorithm | Strategy                                | Pause goal               |
|--------------|-----------------------------------------|--------------------------|
| Serial       | Stop-the-world copying young + mark/compact old | Single-threaded; small heaps |
| Parallel     | Multi-threaded copying young            | Throughput               |
| **G1**       | Region-based, mostly-concurrent marking, copying evacuation | < 200ms typical |
| **ZGC**      | Region-based, fully concurrent, colored pointers / load barriers | < 1 ms |
| Shenandoah   | Region-based, fully concurrent, Brooks pointers | < 10 ms |
| Epsilon      | No collection (testing only)            | n/a                      |

G1 has been default since Java 9. ZGC is generational and production-ready since Java 21 — for low-latency services, prefer ZGC.

---

## 2. TLAB: where allocation actually happens

Each thread has a **Thread-Local Allocation Buffer** — a chunk (~512 KB by default) carved out of eden. Allocation is a pointer bump:

```c
ptr = tlab.top;
tlab.top += object_size;
return ptr;
```

This is ~5–10 ns. No locks, no atomics. TLABs are why Java allocation often outperforms C `malloc` in throughput.

When the TLAB fills, the thread requests a new one (occasionally hitting a slow path that may trigger a young GC).

Useful flags:
- `-XX:+PrintTLAB` (debug only)
- `-XX:TLABSize=...` to override default sizing
- `-XX:-ResizeTLAB` to lock the size (rarely useful)

---

## 3. Reachability analysis

A GC cycle starts by walking from **GC roots**:

- All static fields of loaded classes
- Local variables on every thread's stack (parsed via OopMaps)
- JNI globals/locals
- Live monitors and synchronizers
- The JVM's own internal references (class loaders, etc.)

Then it traces the object graph following reference fields. Anything not reached is garbage.

The key insight: **the cost of GC is proportional to the live set, not the dead set.** Allocating and discarding billions of short-lived objects is cheap; keeping a few thousand long-lived objects with deep reference graphs is expensive.

---

## 4. Escape analysis: when `new` is free

HotSpot's C2 (and JIT) performs **escape analysis** on hot methods:

- **No-escape**: the object is created, used, and discarded entirely within the method
- **Arg-escape**: it's passed to another method but never stored externally
- **Global-escape**: it leaks into a field, return value, or another thread

For no-escape objects, C2 may apply **scalar replacement**: instead of allocating, it splits the object's fields into local variables / registers. The `new` is **eliminated**.

```java
double distance(double x, double y) {
    Point p = new Point(x, y);   // C2 may not allocate this at all
    return p.magnitude();
}
```

If `Point.magnitude()` is inlined and `p` doesn't escape, after EA the method becomes equivalent to:

```java
double distance(double x, double y) {
    return Math.sqrt(x*x + y*y);
}
```

To verify: `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEscapeAnalysis -XX:+PrintEliminateAllocations`.

EA is fragile — adding logging, throwing exceptions, or storing into a field defeats it. Don't rely on it; just don't fight it.

---

## 5. Finalizers: deprecated, deeply broken

`Object.finalize()` is deprecated for removal since Java 9. Reasons:

1. **No timing guarantee.** Finalizers run on a low-priority background thread, possibly never.
2. **Resurrection.** `finalize()` can re-link `this` into a reachable object, undoing GC's work.
3. **GC pause hit.** Finalizable objects need two GC cycles to collect.
4. **Security holes.** A subclass's `finalize()` can resurrect partially constructed objects, bypassing constructor invariants.
5. **Threading.** Finalizers run concurrently with other code on a special thread; locking is required.

**Don't write `finalize()`. Ever. In new code, don't even override it.**

---

## 6. The modern replacement: `Cleaner`

Java 9 introduced `java.lang.ref.Cleaner` — a safer, leaner mechanism for cleanup.

```java
public final class Resource implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();
    private final Cleaner.Cleanable cleanable;
    private final State state;

    private static class State implements Runnable {
        long handle;          // native resource
        State(long handle) { this.handle = handle; }
        @Override public void run() {
            if (handle != 0) {
                native_close(handle);
                handle = 0;
            }
        }
    }

    public Resource() {
        this.state = new State(native_open());
        this.cleanable = CLEANER.register(this, state);
    }

    @Override public void close() {
        cleanable.clean();    // explicit, prompt cleanup
    }
}
```

Critical rules:

- **`State` must not hold a reference to the outer `Resource`** — that would prevent collection. Always use a static nested class.
- The cleanup `Runnable` should be idempotent and fast.
- Use `Cleaner` as a **safety net**, not the primary cleanup. Always provide `close()` and use try-with-resources.

`DirectByteBuffer` is the canonical example — its native memory is freed by a `Cleaner`.

---

## 7. Reference types: `Soft`, `Weak`, `Phantom`

| Type      | Strength | Cleared by GC when…                      | Use case                     |
|-----------|----------|------------------------------------------|------------------------------|
| Strong    | normal   | never (until unreachable)                | default                      |
| `Soft`    | weak-ish | heap is under memory pressure            | memory-sensitive caches      |
| `Weak`    | weak     | no strong references exist               | canonicalizing maps          |
| `Phantom` | weakest  | object has been finalized & unreachable; never returns the referent | post-mortem cleanup |

**WeakHashMap**: keys held by `WeakReference`. When a key is no longer strongly referenced anywhere else, the entry can be removed. Beware: if the *value* references the *key*, the entry never dies.

**SoftReference**: avoid as a "free cache." Modern JVMs are aggressive about clearing them under load, leading to thrashing. Use Caffeine with explicit size/time bounds instead.

**PhantomReference**: powers `Cleaner` internally. You can't access the referent; you only get notified when it's unreachable.

---

## 8. Reachability vs liveness — practical leaks

Common Java memory leaks, all of which are about *reachability outliving usefulness*:

1. **Static collections** that grow unboundedly.
2. **Listeners/observers** registered but never unregistered.
3. **ThreadLocals** in pooled threads (e.g., Tomcat) — survive request lifetimes.
4. **Inner classes** holding implicit `this` references (use static nested instead).
5. **ClassLoader leaks** — a single `Class` in a static field of a parent loader pins the entire child loader and all its classes.
6. **Caches** without bounds or eviction.

Detection: heap dump + analyzer (Eclipse MAT, VisualVM, JFR + JOverflow). Look at "dominator tree" — objects that root a large amount of memory.

---

## 9. Allocation profiling

```bash
# Java Flight Recorder, low overhead in production
java -XX:StartFlightRecording=duration=60s,filename=app.jfr -jar app.jar
jfr print --events jdk.ObjectAllocationInNewTLAB,jdk.ObjectAllocationOutsideTLAB app.jfr
```

What to look for:
- Allocation hotspots in tight loops
- Large objects (`OutsideTLAB`) — these are slow-path allocations
- Allocation rate > 1 GB/s sustained → GC will struggle

`async-profiler` for flame-graph allocation tracking:

```bash
asprof -e alloc -d 30 -f alloc.html <pid>
```

---

## 10. Constructor performance: surprising costs

Things that look free but aren't:

- **Defensive copying inside ctor**: `this.list = new ArrayList<>(list)` allocates and copies.
- **String formatting**: `new RuntimeException("at index " + i)` builds a `StringBuilder` even if exception is caught and ignored.
- **Anonymous classes capturing `this`**: every `new Runnable() { ... }` allocates and pins outer instance.
- **Logging the constructor**: `logger.debug("creating " + this)` calls `toString()`, which may allocate.

Things that are nearly free:
- Simple field assignment
- Calling a final/private method
- Reading a constant
- Inheriting from `Object`

---

## 11. Object headers and memory layout

A typical 64-bit HotSpot object header:

```
+---------------------+----+
| mark word           |  8 |  identity hash, lock state, GC age
+---------------------+----+
| klass pointer       |  4 |  (with -XX:+UseCompressedClassPointers)
+---------------------+----+
| fields...           |    |  packed by JVM, padded to 8-byte alignment
+---------------------+----+
```

Total per object: at least **16 bytes** even for `class Empty {}`. Add fields, then pad to multiple of 8. 

**Project Lilliput** (Java 24+) is shrinking the header to 4-8 bytes, which can save ~10% heap on data-heavy workloads.

**Project Valhalla** introduces **value classes** — no header, no identity. `new Point(1, 2)` would compile to two `int` registers. Aimed at Java 25-ish.

---

## 12. Lifecycle of immutable objects

```java
public final class Money {
    private final long cents;
    private final String currency;
    public Money(long c, String cur) { this.cents = c; this.currency = cur; }
}
```

- **Final fields** get a **freeze action** at the end of `<init>` — guarantees that other threads see fully constructed values once they observe the reference (JLS §17.5).
- Immutable objects can be safely shared without locks.
- They're naturally amenable to scalar replacement (since they have no mutating methods).

---

## 13. Practical checklist for production

- [ ] Use try-with-resources for any `AutoCloseable` resource.
- [ ] Don't override `finalize()`. Use `Cleaner` if you need a safety net.
- [ ] Avoid leaking `this` from constructors (especially via listener registration).
- [ ] Static collections are leak suspects — bound them.
- [ ] Use `WeakHashMap` for caches whose keys are tracked elsewhere.
- [ ] Profile allocation with JFR or async-profiler before optimizing.
- [ ] Keep object graphs shallow — deep graphs make GC slower.
- [ ] Prefer immutable types for shared data.

---

## 14. Where to dig deeper

| Topic                          | File / source                       |
|--------------------------------|-------------------------------------|
| `<init>`/`<clinit>` bytecode   | `professional.md`                    |
| GC algorithms in detail        | OpenJDK `gc/g1`, `gc/z` source      |
| JLS rules on initialization    | `specification.md`                   |
| Common leak patterns + tasks   | `find-bug.md`, `tasks.md`            |
| Allocation tuning              | `optimize.md`                        |

---

**Memorize this**: Lifecycle ≠ "is the variable in scope." Lifecycle = "is it reachable from a GC root." The GC owns reclamation; you own reachability. Modern GCs make allocation cheap and old-gen survival expensive — design for short-lived, immutable objects, and the JVM rewards you.
