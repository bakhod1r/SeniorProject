# Object Memory Layout — Interview Q&A

20 questions covering header bytes, mark word states, klass pointers, compressed oops, padding, alignment, false sharing, JOL, Valhalla, and the bugs that come from getting any of these wrong.

---

## Q1. What is the size of a Java object header on 64-bit HotSpot?

12 bytes with `-XX:+UseCompressedClassPointers` (default): 8 bytes for the mark word plus 4 bytes for the compressed klass pointer. 16 bytes if klass pointer compression is disabled. Arrays add a 4-byte length field, so 16 bytes total with compressed pointers, 20 bytes (which pads to 24) without. Memorize 12 + 4 = 16 for an empty `Object` (12 header + 4 padding to multiple of 8).

**Follow-up:** "What about 32-bit JVMs?" Header is 8 bytes there (4 mark + 4 klass). Increasingly rare; mention only if asked.

---

## Q2. What does the mark word actually contain?

The mark word is 8 bytes of tagged union. At any moment it stores **one** of:

- Lock state: unlocked, light-locked (pointer to a stack-allocated lock record), or heavy-locked (pointer to an `ObjectMonitor`).
- Identity hash code: 31 bits, written on the first `System.identityHashCode(obj)` call and stable for the object's lifetime.
- GC marking bits: used during stop-the-world phases.

The low 2 bits tag which interpretation applies. **Biased locking was removed in JDK 15 (JEP 374)**, so a sixth "biased" state from older textbooks is no longer present.

**Trap:** Saying "the mark word holds the hash code." It holds *one of several things*; reading it raw without context is meaningless.

---

## Q3. What does the klass pointer point to?

It points into the JVM's internal `Klass` metadata in metaspace — the JVM's representation of the class. This is *not* the same as `Class<?>` (which is the mirror, a separate heap object reachable via `getClass()`). The klass pointer is what powers `instanceof`, virtual dispatch through the vtable, interface dispatch through the itable, and reflection. With `-XX:+UseCompressedClassPointers` (default) it is 4 bytes.

**Follow-up:** "Why is it not just a pointer to `Class<?>`?" Because the `Class<?>` mirror is a heap object subject to GC and reflection; the `Klass` is JVM-internal, immutable, and tied to class loading.

---

## Q4. What is the minimum size of a Java object?

16 bytes on 64-bit HotSpot with compressed oops: 12 bytes of header + 4 bytes of padding to round up to a multiple of 8. `new Object()` already costs 16 bytes — there is no smaller heap allocation.

A class with one `boolean` field is also 16 bytes (12 + 1 + 3 padding). A class with one `int` field is also 16 bytes (12 + 4 + 0 padding). The minimum is structural, not field-driven.

**Trap:** Estimating "tiny objects" as smaller. They are not.

---

## Q5. How does HotSpot decide field order?

The field allocation strategy `-XX:FieldsAllocationStyle=1` (the default) sorts fields by size, largest first, after the header. Each field is placed at the next aligned offset (longs and doubles on 8-byte boundaries, ints and floats on 4-byte boundaries, etc.). The result minimizes internal padding.

This means declaration order is *not* layout order on modern HotSpot. A class with `boolean, long, int` ends up with `long, int, boolean` laid out in memory.

```java
public class X { boolean a; long b; int c; }
// Layout: long b @16, int c @24, boolean a @28
```

**Trap:** Believing the folklore "declare largest field first to save space." It is a no-op on the default allocator.

---

## Q6. What are compressed oops and when do they apply?

Compressed ordinary object pointers (`-XX:+UseCompressedOops`) store reference fields as 32-bit values, decoded by shifting left 3 (multiplying by 8) to reach a 35-bit address space. They are on by default for heaps below ~32 GB. Above that threshold, the JVM disables them automatically and every reference grows from 4 to 8 bytes.

The trade-off: smaller objects, lower GC pressure, better cache behavior — but a hard ceiling on heap size. Many production deployments deliberately stay under 32 GB to keep compressed oops on, scaling out (more pods) rather than up.

`-XX:ObjectAlignmentInBytes=16` doubles the addressable range to ~64 GB at the cost of more per-object padding.

**Follow-up:** "What is the difference between `UseCompressedOops` and `UseCompressedClassPointers`?" The first compresses *reference fields*; the second compresses the *klass pointer in the header*. Both default to on; they are independent flags.

---

## Q7. Why is padding always to 8 bytes?

To satisfy compressed-oop addressing. A 32-bit compressed oop is interpreted as `value << 3` to produce a 64-bit address. That arithmetic only works if every object starts on an 8-byte boundary — which requires every object's size to be a multiple of 8, hence the tail padding.

If you set `-XX:ObjectAlignmentInBytes=16`, objects pad to multiples of 16, and compressed oops can address `value << 4` (a 36-bit space) — at the cost of more wasted bytes per object.

**Trap:** Saying "for CPU alignment." That is a side effect; the *reason* is the compressed-oop encoding.

---

## Q8. What is false sharing?

When two fields written by different threads happen to share the same 64-byte cache line, the cache coherency protocol forces each write to invalidate the other thread's cache, even though the program logic is independent. Throughput collapses — often by 5–10x.

```java
public class Pair {
    public volatile long a;  // thread A writes
    public volatile long b;  // thread B writes
}
```

`a` at offset 16 and `b` at offset 24 are in the same 64-byte line. Two threads hammering them serialize through the cache. Padding each onto its own cache line (with `@Contended` or manual padding) eliminates the problem.

**Follow-up:** "How would you detect it?" `perf c2c` on Linux, JMH micro-benchmarks, or async-profiler with `-e cache-misses`. JOL shows whether padding is in place.

---

## Q9. What does `@Contended` do?

It instructs HotSpot to insert padding (default 128 bytes, controlled by `-XX:ContendedPaddingWidth`) around the annotated field or class, so it sits alone on its cache line and adjacent objects do not contend with it. Used by the JDK internals (`LongAdder`'s `Cell`, `Thread`'s random seed, `ConcurrentHashMap`'s `CounterCell`).

Application code needs `-XX:-RestrictContended` and an `--add-exports java.base/jdk.internal.vm.annotation=ALL-UNNAMED` to use it. Without those flags, the annotation is silently ignored.

**Trap:** Sprinkling `@Contended` everywhere. The annotation costs ~256 bytes per object. Apply only to genuinely contended fields.

---

## Q10. What is JOL and how do you use it?

JOL (Java Object Layout) is an OpenJDK tool that prints the runtime layout of any object. The canonical usage:

```java
import org.openjdk.jol.info.ClassLayout;
System.out.println(ClassLayout.parseInstance(myObj).toPrintable());
```

It walks the object via `Unsafe.objectFieldOffset` and prints each field's offset, size, type, and value, plus any padding. For deep footprints (the object and everything it references), use `GraphLayout.parseInstance(obj).toFootprint()`.

JOL is the canonical source-of-truth for layout on the JVM you actually run. It is more authoritative than any blog post or textbook because it reflects *your* JVM's choices.

**Follow-up:** "Can you use it without changing application code?" Yes — JOL ships a CLI: `java -jar jol-cli.jar internals -cp app.jar com.acme.MyClass`.

---

## Q11. How big is `record Point(int x, int y)`?

24 bytes on 64-bit HotSpot with compressed oops. Header is 12, `x` at offset 12 (4 bytes), `y` at offset 16 (4 bytes), and 4 bytes of tail padding to round 20 up to 24.

Without compressed oops, the header is 16 and the record is 32 bytes (16 + 8 + 8 padding).

**Trap:** Saying "8 bytes for two ints." Forgetting the header is the most common interview mistake.

---

## Q12. Why is `Integer[10]` so much bigger than `int[10]`?

`int[10]` is 16 bytes of header + 40 bytes of `int` data = 56 bytes, padded to 56 (already a multiple of 8). One object.

`Integer[10]` is 16 bytes of header + 40 bytes of references = 56 bytes for the array *plus* 10 separate `Integer` boxes at 16 bytes each = 160 bytes of boxes. Total ~216 bytes — almost 4x — plus pointer-chasing cost on every access.

For a million-element collection, the difference is hundreds of MB. Use `int[]` whenever the API does not strictly require `Integer`.

**Follow-up:** "Why does it matter beyond footprint?" Cache locality. `int[]` is contiguous; `Integer[]` is references-to-elsewhere. The CPU prefetcher streams `int[]` linearly and stalls on `Integer[]`.

---

## Q13. What changes in layout between JDK 8 and JDK 17+?

Major changes:

- **JDK 8 → 9 (JEP 254)**: `String` switched from `char[]` to `byte[]` ("Compact Strings"), halving the size of ASCII strings.
- **JDK 15 (JEP 374)**: biased locking deprecated; mark word state machine simplified.
- **JDK 18**: biased locking removed entirely.
- **JDK 17+**: improvements to `@Contended` enforcement and Valhalla preview features.

Layout numbers from a JDK 8 blog post may not match JDK 17 reality. Always re-print with JOL on the JDK version you actually run.

**Follow-up:** "What about Lilliput?" Project Lilliput aims to shrink the mark word to 4 bytes (header to 8 bytes). Still in development; track JEPs for status.

---

## Q14. How does inheritance affect layout?

Parent fields are placed first, then the child's fields. Each layer of inheritance restarts the field-allocation algorithm with a new alignment, which can leave a hole at the boundary between parent and child fields.

```java
class P { boolean flag; }      // P.flag at offset 12, ends at 13
class C extends P { long x; }  // C.x must start at offset 16 (long alignment)
                                // offsets 13..15 are an inheritance padding hole
```

Flattening (moving the parent's fields into the child) sometimes eliminates the hole, sometimes makes things worse (as HotSpot's reorder can introduce a different gap). Verify with JOL — do not assume.

**Trap:** Believing "flat is always smaller." It usually is, but not always; check the print.

---

## Q15. What is Project Valhalla and how does it affect layout?

Valhalla introduces **value classes** (JEP 401, preview): classes whose instances have *no identity* and *no header*. Value classes can be flattened inline inside arrays and other objects, eliminating the per-instance header and reference indirection.

`record Point(int x, int y)` today: 24 bytes per instance, an array of N points is N × (24 reference + 24 instance) = 56 bytes per element via reference indirection.

`value class Point` under Valhalla: 8 bytes per instance (just two ints), flat array is N × 8 bytes — no headers, no references.

The trade-offs: value classes lose identity. No `synchronized` on them, no identity hash code, no `==` for distinguishing instances with equal fields. For value carriers, that is exactly what you want.

**Follow-up:** "When will it ship?" Preview as of JDK 22+; final delivery TBD. Build code today using `record` and `Objects.equals` so it migrates cleanly when value classes go final.

---

## Q16. What does HotSpot do at the 32 GB heap boundary?

Below 32 GB, compressed oops are on: every reference is 4 bytes. At or above ~32 GB, the JVM auto-disables compressed oops, and every reference becomes 8 bytes. The same live object graph now uses roughly double the memory.

The practical consequence: a 32 GB pod and a 48 GB pod can hold *the same number of objects* because the 48 GB pod's per-object footprint inflated. Many teams deliberately cap heap at 30 GB and scale out.

Mitigation: `-XX:ObjectAlignmentInBytes=16` extends the range to ~64 GB at the cost of more per-object padding. Measure both with JOL before deciding.

**Trap:** Scaling up to 64 GB hoping for more capacity. Sometimes capacity *drops* because compressed oops are gone.

---

## Q17. Where does `Object.hashCode()` store its value?

Inside the mark word, the first time the hash is computed. Before that call the mark word holds lock or unlock state with no hash. The first call writes a 31-bit identity hash into the mark word and a tag bit indicating "this object has a hash." Subsequent calls read the same word.

Implications:

- The hash is stable for the lifetime of the object (per the `Object.hashCode` contract).
- `synchronized` on an object that has been hashed forces HotSpot to preserve the hash across lock state transitions — the JVM internals handle this transparently.
- `identityHashCode` mutates the mark word; calling it on every object in a graph can be observed in JOL output before/after.

**Follow-up:** "What does `record`'s `hashCode` do?" Different — it is field-based (`Objects.hash(x, y, ...)`), not identity. Records do not use the mark-word slot for their hash.

---

## Q18. Why is `boolean` 1 byte instead of 1 bit on the heap?

The JLS allows JVMs to implement `boolean` however they like; HotSpot chose 1 byte. Per-bit storage would require shared-byte coordination across fields and would prevent atomic writes. Inside a `boolean[]`, the JLS *does* require one element per byte (an implementation cannot share bits across array elements).

If you need bit-packed booleans, use `BitSet`, an `int` with bitmask methods, or a `long` field with named bit constants.

**Trap:** Believing `boolean` is "free" and using it liberally. Eight `boolean` fields cost the same as a single `long` and require more padding.

---

## Q19. What is the difference between HotSpot and OpenJ9 layout?

OpenJ9 (the IBM-derived JVM) uses a **smaller header**: a single word (8 bytes on 64-bit with compressed references) versus HotSpot's 12 bytes. The field allocation strategy is also different (the tie-break for equal-size fields differs). Hash code storage may be in a side table rather than the header.

If you write footprint-critical code that runs on both VMs, run JOL on both — do not assume HotSpot numbers transfer.

**Follow-up:** "Why does OpenJ9 have a smaller header?" Different design choices around lock state, hash, and GC. The JVMS allows it.

---

## Q20. What is the most common layout-related bug in production?

Three contenders, all real:

1. **Underestimating footprint.** Team budgets for `N × field_bytes` and gets `N × (field_bytes + header + padding)`. The fix is JOL plus `jcmd GC.class_histogram`.
2. **Crossing 32 GB and losing compressed oops.** A scale-up hoping to fit more data instead loses live capacity because every reference doubled. The fix is to stay below 32 GB or accept the inflation explicitly.
3. **False sharing in supposedly independent counters.** Two threads' work serializes through a single cache line. The fix is `@Contended` (verified with JOL) or `LongAdder`.

All three are invisible from source code. The interviewer who asks this question wants to hear "I would print the layout with JOL and compare to the budget" or "I would benchmark with JMH and look at cache misses" — not a textbook answer.

**Follow-up:** "Have you encountered any of these personally?" Strong candidates have a concrete story; weak candidates recite the textbook.

---

**Use this list:** rotate one question per topic (header, mark word, klass, compressed oops, padding, false sharing, Valhalla, JOL, bugs). Strong candidates show they have *printed* layouts, not just read about them; the interviewer should ask follow-ups that force a "what does JOL output for this look like?" answer. The depth question is always Q20 — do they have a story?
