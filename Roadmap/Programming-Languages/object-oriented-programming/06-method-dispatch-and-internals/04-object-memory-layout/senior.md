# Object Memory Layout — Senior

> **What?** The mark word in detail (five states across JVM versions, including biased-lock removal in JDK 15), klass-pointer compression, cache lines and false sharing, `@Contended`, and the layout changes Project Valhalla introduces.
> **How?** Senior-level layout questions are not "how big is `Integer`" — they are "why does this counter scale poorly under contention" and "why does adding a field shrink my object." This file pairs the bit-level state machine of the mark word with the cache-coherency reality those bits sit inside.

---

## 1. The mark word state machine

The mark word is **8 bytes of tagged union**. On 64-bit HotSpot, the low 2–3 bits act as a state tag; the rest of the word holds whatever that state needs. The set of states changed across JDKs — biased locking was removed in JDK 15 (JEP 374). This is the state map you should carry in your head for modern HotSpot (JDK 17+):

| State                     | Low bits   | What the rest of the word holds                            |
|---------------------------|------------|------------------------------------------------------------|
| **Unlocked (no hash)**    | `001`      | Age bits + unused                                          |
| **Hashed (no lock)**      | `001`      | 31-bit identity hash + age                                 |
| **Light-locked (stack)**  | `000`      | Pointer to the lock record on the locking thread's stack   |
| **Heavy-locked (monitor)**| `010`      | Pointer to an `ObjectMonitor` heap object                  |
| **GC-marked**             | `011`      | GC marking bits (sets during STW phases)                   |

The pre-JDK 15 layout had a sixth state, **biased**, where the mark word stored the thread ID of the assumed owner; on uncontended fast paths a CAS was avoided. Biased locking was retired because contention was rare on modern CPUs but the bookkeeping cost was paid by *every* object on every lock. The modern HotSpot path is: light → heavy on contention, no biased state.

What this means for you:

- The first call to `Object.hashCode()` writes 31 bits into the mark word; the hash is then *stable* for the lifetime of that object. If you also `synchronized` on the object, the JVM must save and restore the hash through lock state transitions — implementation detail handled in `markWord.hpp`.
- Once heavyweight, the mark word becomes a pointer to an `ObjectMonitor` (a separate heap object holding the wait set, the entry list, and the owner thread). Heavyweight locks are visible to `jcmd ... Thread.print` and to allocation profiling.

---

## 2. Compressed klass pointer

After the mark word comes the **klass pointer** — the pointer into JVM-internal `Klass` metadata that drives `getClass()`, `instanceof`, vtable lookup, and reflection.

- `-XX:+UseCompressedOops` controls *reference-field* compression (heap pointers).
- `-XX:+UseCompressedClassPointers` controls *klass-pointer* compression in the header.

They are independent flags but coupled in practice. Both are on by default on 64-bit HotSpot for heaps that fit. With both on, the header is **12 bytes** (8 mark + 4 klass). Disable klass-pointer compression only and the header grows to **16 bytes**.

Klass compression uses a separate metaspace base. Modern HotSpot stores `Klass*` pointers inside a region reachable through a 32-bit offset shifted by `LogKlassAlignmentInBytes` (3 by default). That gives a 35-bit klass address space — plenty for the metadata of every loaded class, even in huge apps.

```
$ java -XX:+PrintFlagsFinal -version | grep -E '(Compress|Klass)'
...
     bool UseCompressedClassPointers    = true
     bool UseCompressedOops             = true
     intx KlassAlignmentInBytes         = 8
```

On ZGC or Shenandoah, klass-pointer compression is still on; what changes is the *barrier* model for references. The mark word is also used by ZGC/Shenandoah for forwarding pointers during evacuation — they steal bits in the mark word for color tags. This is invisible to JOL output (which only reads the *stable* shape) but explains why the mark word cannot become smaller than 8 bytes.

---

## 3. Cache lines and the 64-byte rule

CPUs do not load memory one byte at a time. They load **cache lines** — 64 bytes on every relevant modern CPU (Intel, AMD, ARM). Two fields on the same cache line are *coherent units*: a write to one invalidates the other across cores.

This is innocent for two fields in the same object that are only read — they share a cache line, both stay hot in L1, life is good.

It becomes catastrophic when two *different threads* repeatedly write to two fields that *happen to share a cache line*. This is **false sharing**: from the program's view the threads are independent, but the cache-coherency protocol forces them to serialize.

```java
public class Counters {
    public volatile long a;   // thread A writes
    public volatile long b;   // thread B writes
}
```

Without intervention, JOL prints:

```
me.acme.Counters object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x0001234e
 12   4        (alignment/padding gap)
 16   8   long Counters.a                 0
 24   8   long Counters.b                 0
Instance size: 32 bytes
```

Both `a` (offset 16) and `b` (offset 24) sit inside the same 64-byte cache line (offsets 0..63 of the cache line). Two threads writing them simultaneously will see ~5–10x worse throughput than the same two threads writing fields in two *different* objects on *different* lines. JMH consistently shows the slowdown.

---

## 4. `@Contended` — JVM-managed padding

The fix is to insert padding between contended fields so each sits on its own cache line. Manual padding works but is fragile. HotSpot provides `@jdk.internal.vm.annotation.Contended` for the JDK and `sun.misc.Contended` for older usage.

```java
import jdk.internal.vm.annotation.Contended;

public class PaddedCounters {
    @Contended public volatile long a;
    @Contended public volatile long b;
}
```

To use it from application code you need `--add-exports java.base/jdk.internal.vm.annotation=ALL-UNNAMED` *and* `-XX:-RestrictContended` (or run on a system that ships the openable form). Once it works:

```
me.acme.PaddedCounters object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x0001234f
 12  52        (contended padding)
 64   8   long PaddedCounters.a           0
 72  56        (contended padding)
128   8   long PaddedCounters.b           0
136 120        (contended padding)
Instance size: 256 bytes
```

The object is now 256 bytes — *expensive* — but `a` and `b` are 64 bytes apart on aligned cache lines, with padding on either side to protect them from neighboring objects sharing a line too. This is the right trade in a contended counter; it would be wasteful for a regular field.

The JDK uses `@Contended` internally for hot data: `Thread.threadLocalRandomSeed`, `ConcurrentHashMap`'s `CounterCell`, `LongAdder`'s `Cell[]`. Look at the source to see how the JDK applies it.

`-XX:ContendedPaddingWidth` controls the padding amount (default 128 bytes, intentionally *more* than a 64-byte line to also defend against adjacent-line prefetch).

---

## 5. False sharing inside arrays

False sharing is not limited to two fields in one object. It happens whenever two threads write to memory locations that fall on the same cache line — which is easy with `long[]`:

```java
long[] counters = new long[8];
// thread 0 hammers counters[0], thread 1 hammers counters[1], ...
```

Eight 8-byte longs fit in one 64-byte cache line. Eight threads writing distinct indices look independent but contend on the same cache line. The cure: space them apart by a cache line each.

```java
public class StripedCounter {
    private final long[] cells = new long[8 * 8];   // 8 cells, each 64 bytes apart
    public void increment(int slot) { cells[slot * 8]++; }
}
```

Or use `LongAdder` from `java.util.concurrent.atomic`, which does this for you with `@Contended` internally. Optimize covers the JMH evidence.

---

## 6. Project Valhalla and flat layouts

Today, every object reference is a pointer, and every object pays a header. A `record Point(int x, int y)` array is an array of *references* to 24-byte objects — 8 bytes per slot plus 24 bytes per object = 32 bytes per element, with poor cache locality.

Project Valhalla introduces **value classes** (JEP 401, preview as of JDK 22+). A value class has no identity, no header, and can be laid out *flat* inline inside other objects and arrays:

```java
value class Point {
    int x;
    int y;
}

Point[] points = new Point[1000];  // 8000 bytes of x,y pairs, no headers, no references
```

The array becomes 1000 × 8 = 8 KB plus the array header — versus 1000 × 32 = 32 KB plus 1000 × 8 = 8 KB of references in the array = 40 KB total today. A 5x reduction in footprint and a massive improvement in cache locality for sequential traversal.

The mark word disappears for value instances because:

- They cannot be `synchronized` on (no identity).
- They have no identity hash; `hashCode()` is value-based.
- There is no GC marking — they are not separate heap objects.

Until Valhalla is final, treat it as a research-grade preview but know it is coming; it changes the right answer to several optimization questions in [optimize.md](optimize.md) and [../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/).

---

## 7. HotSpot vs OpenJ9 — the layout is implementation-defined

The JVMS does not specify layout. OpenJ9 differs from HotSpot in measurable ways:

- **Object header size**: OpenJ9 historically used a *single-word* compact header (4 bytes on 32-bit, 8 bytes on 64-bit with compressed references) — *smaller* than HotSpot's 12 bytes. JOL prints from OpenJ9 show the difference clearly.
- **Field allocation strategy**: OpenJ9 also reorders, but with a different tie-break.
- **Hash code**: OpenJ9 may compute hash codes lazily and store them in a side table, not in the header.
- **Compressed references**: enabled by default on OpenJ9 for heaps under 64 GB (vs HotSpot's 32 GB), thanks to a different addressing scheme.

If you write footprint-sensitive code that has to run on both VMs, JOL on both — do not assume HotSpot numbers transfer.

HotSpot itself also has **Lilliput** (JEP TBA), an effort to shrink the mark word to 4 bytes, dropping the standard header to 8 bytes. Worth tracking; you may be reading this paragraph in a year that no longer matches Lilliput's status.

---

## 8. Multi-threaded layout traps

A few patterns that bite at senior level:

**Trap 1: a `volatile` array reference is not enough.** The reference is volatile; the *elements* are not. Two threads writing different indices of the same array still need either `VarHandle.setVolatile` or external synchronization. Layout matters here because the elements share a cache line.

**Trap 2: `padding` fields the optimizer deletes.** Naive padding via unused fields can be eliminated by the C2 optimizer if it proves they are never read. `@Contended` is the supported mechanism; do not roll your own with `private long p1, p2, p3;` — write tests with JOL to confirm the padding is still there.

**Trap 3: `ConcurrentHashMap` and `LongAdder` already do this.** Before you sprinkle `@Contended` across your codebase, check whether the data structure you reach for already applies it. `LongAdder`'s `Cell[]` is padded; a plain `AtomicLong` is not.

**Trap 4: forgetting that `synchronized` mutates the mark word.** Code that reads the mark word raw (via `Unsafe.getLong(obj, 0L)`) sees lock state, GC state, and biased state changes — not a stable identifier. Use `System.identityHashCode(obj)` if you need a stable proxy.

---

## 9. Klass pointer in the JIT — why layout informs dispatch

The klass pointer is what `invokevirtual` uses for vtable lookup ([../02-vtable-and-itable/](../02-vtable-and-itable/) covers the mechanism). For monomorphic call sites, the JIT inlines through the klass; for megamorphic ones it falls back to the runtime stub.

The klass pointer's 4-byte width (with compression) is small enough that even loading it in a tight loop is cheap — it usually shares an L1 cache line with the mark word, so the same line that already arrived for the lock check serves dispatch. This is why compressed class pointers are essentially free for performance.

The flip side: **profile-guided** layout (PGO) — putting hot fields close to the header so they share its cache line — is *not* something HotSpot does by default. The largest-first ordering is footprint-driven, not access-frequency-driven. For the highest-throughput hot fields, manual flat structures (Valhalla, or struct-of-arrays today) can outperform what HotSpot gives you.

---

## 10. Quick rules

- [ ] Mark word holds one of: unlocked, hashed, light-lock, heavy-lock (monitor), GC mark. Biased lock is removed in JDK 15+.
- [ ] Klass pointer is 4 bytes with `-XX:+UseCompressedClassPointers` (default), 8 bytes otherwise.
- [ ] Cache line is 64 bytes; two `long` fields in the same object share one line — bad for contention, good for read-only.
- [ ] `@Contended` adds ~128 bytes of padding (default `ContendedPaddingWidth=128`); each contended slot ends up on its own line.
- [ ] OpenJ9 has a smaller header than HotSpot; JOL across both, don't assume.
- [ ] Project Valhalla value classes eliminate the header for value instances; layout is flat in arrays.
- [ ] `System.identityHashCode(obj)` writes the hash into the mark word the first time it is called — visible in JOL afterwards.

---

## 11. What's next

| Topic                                                              | File              |
|--------------------------------------------------------------------|-------------------|
| Code review vocabulary, ArchUnit, layout audits                    | `professional.md`  |
| Spec references, JEPs, `Unsafe.objectFieldOffset`                  | `specification.md` |
| Ten layout bugs from production                                    | `find-bug.md`      |
| Field reordering, primitive arrays, EA, `@Contended`               | `optimize.md`      |
| Hands-on JOL exercises                                             | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |

Related sibling chapters: [../02-vtable-and-itable/](../02-vtable-and-itable/) for what the klass pointer leads to; [../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/) for objects that bypass the header altogether; [../../03-design-principles/](../../03-design-principles/) for the design choices that drive object count.

---

**Memorize this:** the mark word is a five-state tagged union (no biased state in JDK 15+); the klass pointer is 4 bytes with compressed klass pointers; the cache line is 64 bytes and is the unit of false sharing; `@Contended` is how you ask the JVM for a private line; Valhalla will let value classes eliminate the header entirely. Layout in HotSpot is implementation-defined — every senior-level question is "what does my JVM actually do here?" and the answer is *print it with JOL*.
