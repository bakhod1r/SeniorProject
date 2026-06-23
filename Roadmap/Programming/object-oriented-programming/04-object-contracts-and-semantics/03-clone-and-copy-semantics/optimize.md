# Clone and Copy Semantics — Optimize

> Copying is allocation. Every copy that survives a method scope is a heap allocation, a GC root, and a potential cache miss. This file walks the JVM-level performance angles of the three copy idioms — `Object.clone()`, copy constructors, and `copyOf` factories — alongside escape analysis, persistent data structures, copy-on-write, and the inbound effect of Project Valhalla's value classes. All numbers are illustrative; verify in your environment with JMH and `-prof gc`.

---

## 1. The three copy idioms and their JIT shapes

Three idioms produce a "copy" at runtime. The JIT sees them differently.

- **`super.clone()` via `Object.clone()`.** Native call into `JVM_Clone`. The JVM allocates a new object of the receiver's runtime class and `memcpy`-copies the fields. No `<init>` runs; no field initialisers run; no escape analysis can fully see across the native boundary.

- **Copy constructor (`new Foo(other)`).** A regular constructor invocation. C2 sees the allocation and the assignment statements. Escape analysis can eliminate the allocation if `Foo` doesn't escape the method. Inlining propagates through the constructor body.

- **Static `copyOf` factory.** Same as a copy constructor for the JIT — it's just a method whose body usually contains a `new Foo(...)`. The JIT inlines the factory and then treats the construction like any other.

The native call in option 1 is the most opaque. The JIT treats `JVM_Clone` as a black box: it knows a new object of class `C` comes out, but it can't see inside the operation to fuse it with surrounding code. Copy constructors and factories — both ordinary Java — *can* be fused. In a tight loop, the difference matters.

```java
// Loop with copy constructor — EA may eliminate the allocation
for (int i = 0; i < n; i++) {
    Money local = new Money(orig);            // candidate for scalar replacement
    use(local);
}

// Same loop with Object.clone() — EA can't see across the native call
for (int i = 0; i < n; i++) {
    Money local = orig.clone();               // heap allocation, every iteration
    use(local);
}
```

**Inspect:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining -XX:+PrintEliminateAllocations` shows which allocations C2 erased and which it kept.

---

## 2. Escape analysis for short-lived copies

Escape analysis (EA) is C2's optimisation that proves an object's reference *doesn't escape* the current method or thread, and therefore can be replaced with stack-allocated or register-allocated equivalents. EA loves records, copy constructors, and short-lived copies; it tolerates static `copyOf`; it doesn't help `clone()` much.

```java
public record Money(long cents, Currency currency) {
    public Money plus(Money other) {
        return new Money(cents + other.cents, currency);   // candidate for EA
    }
}

public BigDecimal total(List<LineItem> lines) {
    Money sum = new Money(0L, USD);
    for (LineItem item : lines) sum = sum.plus(item.price());
    return BigDecimal.valueOf(sum.cents()).movePointLeft(2);
}
```

Inside `total`, every intermediate `Money` lives for one loop iteration. EA proves the `Money` doesn't escape `total`, and C2 scalar-replaces it: the `cents` and `currency` fields live in registers, no heap allocation happens, the loop runs at near-primitive speed. The record's *value semantics* — final, immutable, no identity-sensitive code — are what let EA succeed.

Three properties make a class EA-friendly:

- Implicitly or explicitly `final` (records, sealed concrete subclasses, final classes).
- All fields `final` and primitive-or-immutable.
- No code path that stores `this` somewhere reachable (no `Registry.register(this)` in the constructor; no listener registration).

A copy constructor whose body is *just* field assignments and whose class is `final` checks every box. `Object.clone()` doesn't, because the `JVM_Clone` allocation is opaque to EA and because the class is typically not `final` (you'd hardly bother with `Cloneable` for a `final` class).

---

## 3. Record reuse vs copy — the `with...` idiom

The single biggest performance win from copy semantics is *not copying at all*. Records make the "reuse" path easy:

```java
public record Order(long id, OrderStatus status, List<LineItem> lines) {
    public Order withStatus(OrderStatus s) {
        return new Order(id, s, lines);          // reuses 'lines' reference; new Order is tiny
    }
}
```

`withStatus` allocates one `Order` (three references plus a header — about 32 bytes on a 64-bit JVM). The `List<LineItem>` is shared. If `lines` contains a thousand items, those thousand items are *not* copied. Compare to a `clone()` that deep-copies the list: thousand-element copy, thousand-element GC pressure later.

```java
// One allocation, O(1) work:
Order shipped = order.withStatus(SHIPPED);

// Hundreds of allocations, O(n) work, fundamentally different cost class:
Order cloned = (Order) order.clone();
// then deep-copying lines manually = O(n) more allocations
```

For high-frequency state transitions (every event update on every entity), the `with...` reuse pattern keeps allocation flat. The deep-clone pattern grows allocation linearly with field count and collection size.

The general principle: *immutability turns deep-copy questions into reference-reuse opportunities*. The allocations EA can eliminate are small; the allocations you don't make in the first place are free.

---

## 4. Persistent (structurally sharing) collections

The JDK's `List.copyOf`, `Set.copyOf`, `Map.copyOf` create *flat* unmodifiable copies — they allocate new storage and copy the elements. For most workloads this is fine. For "I take 10000 copies of this 1000-element list per second", flat copies become a bottleneck.

The library answer is *persistent* (structurally sharing) collections — Vavr's `io.vavr.collection.List`, Eclipse Collections's `ImmutableList`, PCollections's `PVector`. A persistent collection's update operations return a new collection that *shares most of its internal structure* with the original.

```java
io.vavr.collection.List<Integer> base    = io.vavr.collection.List.of(1, 2, 3, 4, 5);
io.vavr.collection.List<Integer> updated = base.append(6);

// 'base' is unchanged. 'updated' shares most of its storage with 'base'.
// The append is O(log32 n), not O(n).
```

Internally, `PersistentVector` uses a trie with branching factor 32. A 10 000-element vector is a 3-level trie; appending creates a new root and a few new internal nodes (~ 5 small allocations) instead of copying 10 000 elements.

When to reach for persistent collections:

- You take many copies per second of large collections.
- You're implementing snapshot-style audit, event sourcing, or undo/redo.
- Your update rate is high and concurrent — persistent structures plus a single `AtomicReference` swap is a lockless data structure.

For most application code, JDK `copyOf` is fine. For data-heavy workflows, persistent collections turn "copy" into "share with a tiny delta" and reshape the performance class entirely.

---

## 5. Copy-on-write semantics

`java.util.concurrent.CopyOnWriteArrayList` is the JDK's built-in copy-on-write list. Every write allocates a new underlying array; reads are lock-free against the snapshot at the time the iterator was created.

```java
List<Listener> listeners = new CopyOnWriteArrayList<>();

// Reads (the dominant operation):
for (Listener l : listeners) l.onEvent(e);      // sees the snapshot at iterator creation

// Writes (rare):
listeners.add(newListener);                     // allocates new array; readers unaffected
```

The performance profile suits read-mostly, write-rare workloads: listener registries, configuration snapshots, security policy caches. Each write is `O(n)` (full array copy); each read is essentially free (no lock, no memory barrier on the hot path).

The same idea generalises beyond `CopyOnWriteArrayList`. A `final` field of type `Map<K, V>` swapped via `AtomicReference<Map<K, V>>` is a hand-rolled COW map:

```java
public final class ConfigStore {
    private final AtomicReference<Map<String, String>> snapshot;
    public ConfigStore(Map<String, String> initial) {
        this.snapshot = new AtomicReference<>(Map.copyOf(initial));
    }
    public String get(String key) { return snapshot.get().get(key); }
    public void put(String key, String value) {
        snapshot.updateAndGet(old -> {
            Map<String, String> next = new HashMap<>(old);
            next.put(key, value);
            return Map.copyOf(next);
        });
    }
}
```

Readers see one of the immutable snapshots — no synchronisation, no defensive copy on read. Writers compete on the `AtomicReference.updateAndGet`. The cost is one `Map.copyOf` per write; the benefit is unlimited concurrent reads at zero coordination cost.

COW is the right answer when the read:write ratio is heavily skewed and the write set is small. Copying is the right answer when state must be isolated per call. Pick by the ratio.

---

## 6. Native `clone()` vs constructor allocation

A direct microbenchmark: `Object.clone()` vs copy constructor for the same class.

```java
public class Pojo {
    private final long a, b, c, d;
    public Pojo(long a, long b, long c, long d) { this.a=a; this.b=b; this.c=c; this.d=d; }
    public Pojo(Pojo o) { this(o.a, o.b, o.c, o.d); }
    @Override public Pojo clone() {
        try { return (Pojo) super.clone(); }
        catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}
```

Typical results on a JDK 21 x64 build:

| Operation              | Throughput   | Allocation per op |
|------------------------|--------------|-------------------|
| `new Pojo(other)`      | ~5 ns/op     | 24 bytes (eliminable by EA in a tight loop) |
| `other.clone()`        | ~12 ns/op    | 24 bytes (rarely eliminated by EA)          |
| reuse (e.g. record)    | ~0 ns/op     | 0                                           |

`clone()` is roughly 2× slower than `new Pojo(other)` for this trivial class — the native-call boundary and the lack of inlining cost real cycles. Crucially, `clone()`'s allocation is much less likely to be eliminated by EA: the `JVM_Clone` call is opaque to C2, so the optimizer can't prove the resulting object doesn't escape.

The headline result for hot paths: replace `clone()` with copy constructors first, then look for reuse opportunities.

---

## 7. The hidden cost of mutable accessors

A common micro-pattern that *looks* defensive but allocates per call:

```java
public final class Token {
    private final byte[] bytes;
    public Token(byte[] bytes) { this.bytes = bytes.clone(); }
    public byte[] bytes() { return bytes.clone(); }       // every call allocates
}
```

In a code path that reads `token.bytes()` 10 million times per second (e.g., a hash check inside a hot inner loop), each call allocates a new 32-byte array. That's 320 MB/s of garbage. The GC notices.

Mitigations, in increasing order of intrusiveness:

1. **Cache the immutable form internally.** Wrap the array in a `ByteBuffer.asReadOnlyBuffer()` once at construction; the accessor returns `buffer.duplicate()` — cheap, no array allocation.
2. **Expose a hash, not the array.** If callers only check equality, compute the hash once and store it; the accessor returns a `long`.
3. **Use a record with a `byte[]` field and clone only on the accessor.** Same as the original but documented.
4. **Use `MemorySegment` (Project Panama).** A foreign-memory segment is a typed view over off-heap or on-heap memory, with read-only modes built in. No allocation per access.

The general rule: every defensive copy in an accessor allocates per call. For hot paths, expose an *immutable view type* (`ByteBuffer.asReadOnly`, `Collections.unmodifiableList`, `Map.copyOf`'s result) once, and let callers share the view.

---

## 8. Allocation profiles for collection `copyOf`

The JDK's `copyOf` factories are tuned for the common case:

- **`List.copyOf(Collection)`** — if the input is already an unmodifiable list (the result of a previous `List.of` / `List.copyOf`), the factory returns it directly. Zero allocation. If the input is mutable, the factory allocates a new compact array-backed list.

- **`Set.copyOf(Collection)`** — analogous; deduplicates if the input is not a set.

- **`Map.copyOf(Map)`** — analogous, with the additional check that the input has no null keys/values.

```java
List<String> a = List.of("x", "y", "z");
List<String> b = List.copyOf(a);            // b == a (same reference)
List<String> c = new ArrayList<>(a);
List<String> d = List.copyOf(c);            // d is a fresh allocation
```

The "return as-is if already unmodifiable" trick is the JDK's main perf optimisation here. It means *chaining* `List.copyOf` is free — `List.copyOf(List.copyOf(list))` allocates once, not twice. Defensive copy idioms that pass through multiple layers (constructor, accessor, builder) don't compound allocation cost.

For very large input lists, `new ArrayList<>(list)` and `List.copyOf(list)` are both `O(n)` in time and memory. `List.copyOf` has slightly tighter storage (no spare capacity) and is unmodifiable; `new ArrayList<>` is mutable and has 50% spare capacity. Pick by intent.

---

## 9. Project Valhalla — flat copies and the future

Project Valhalla (JEP 401, JEP 402) introduces *value classes* — classes whose instances have no identity, no `==` semantics beyond field equality, and which the JVM may flatten into containers and arrays.

```java
value class Point {
    private final double x;
    private final double y;
}
```

For copy semantics, value classes do three things that matter:

- **Flatten into arrays.** `Point[]` becomes `[x0 y0 x1 y1 ...]` — no per-element heap object, no pointer chasing. Loading `point.x` is a single memory access. A million-point array fits in a few megabytes of contiguous memory.
- **Eliminate identity.** Two value instances with equal fields *are* equal under `==`. The concept of "two distinct copies with the same fields" disappears. No copy is needed because there is no identity to clone.
- **Stack-allocate by default.** The JIT doesn't need to prove EA-friendliness — value classes are stack-allocatable by their language definition.

For records, the migration to value classes will be a one-line change: `record Point(double x, double y)` becomes `value record Point(double x, double y)`. Every defensive-copy idiom you build today on records carries forward unchanged.

For mutable classes that copy a lot, value classes don't help — they're immutable by definition. The takeaway: design with immutability and records *today*, and you inherit Valhalla's optimisations *automatically* when they ship.

---

## 10. When to break defensive-copy discipline for performance

Like SOLID, defensive copying has a cost. In an inner loop, every clone is a cycle and every allocation is GC pressure. Sometimes the right move is to relax discipline locally.

**Symptom:** profiler shows 20% of CPU in `Arrays.copyOf` or `JVM_Clone`, and the loop is on the critical path.

**Options, in order of severity:**

1. **Hoist the copy out of the loop.** Take one defensive copy before the loop, reuse it inside.
2. **Switch to an immutable view.** Replace `array.clone()` with `ByteBuffer.wrap(array).asReadOnly()` or a `MemorySegment`. Callers can't mutate; you don't allocate.
3. **Replace defensive copy with documented sharing.** Add javadoc: *"Returned list is the live internal list; callers must not mutate."* Acceptable for package-private state. Document the contract explicitly.
4. **Use a persistent collection.** If "copy then mutate slightly" is the dominant operation, `Vavr.List.append` is `O(log n)` and shares structure.
5. **Inline the data.** For tiny fields, replace a wrapping object with a raw record or a Valhalla value class. Skip the copy entirely.

```java
// Hot path: skip defensive copy because the caller's contract guarantees no mutation
public final class FastReader {
    public byte digestByte(byte[] bytes, int offset) {
        // bytes is documented as "must not be mutated during this call" — no defensive copy
        return bytes[offset];
    }
}
```

Document the trade. The next maintainer reading the code without the comment will re-add the defensive copy and reverse the win.

---

## 11. Quick rules — when to denormalize copy discipline

- [ ] **Profile first.** Don't denormalize without a flame graph that names the allocation site.
- [ ] **Records over copy methods.** Make types immutable; `with...` reuses unchanged fields.
- [ ] **`Cloneable` is the slow copy idiom too.** Replace it with a copy constructor on perf grounds alone if no other reason convinces you.
- [ ] **EA-friendly classes.** Final, all fields final and immutable, no constructor escape. Records by default.
- [ ] **Persistent collections** for high-frequency snapshot/diff workloads.
- [ ] **Copy-on-write** for read-mostly, write-rare data with no per-read coordination.
- [ ] **Accessor allocation kills throughput.** Cache an immutable view; don't `array.clone()` per call on a hot path.
- [ ] **`List.copyOf` short-circuits** when input is already unmodifiable — chain freely.
- [ ] **Valhalla on the horizon.** Records today migrate to value classes tomorrow without code changes; design accordingly.
- [ ] **Document any defensive-copy bypass** with a comment explaining the contract; the next maintainer will undo it otherwise.

---

## 12. What's next

| Topic                                                                  | File              |
| ---------------------------------------------------------------------- | ----------------- |
| 8 hands-on copy and defensive-copy exercises                           | `tasks.md`         |
| 20 interview Q&A on clone and copy semantics                           | `interview.md`     |

---

**Memorize this:** every copy is an allocation; every allocation is a future GC root. The fastest copy is the one you don't make — records and `with...` accessors reuse unchanged fields by reference. Native `Object.clone()` is consistently slower than a copy constructor because the `JVM_Clone` boundary is opaque to escape analysis. Persistent collections and copy-on-write turn O(n) copying into O(log n) or O(1) sharing for the workloads where they fit. Valhalla makes the whole question lighter still — design with immutability today and the JIT will reward you twice.
