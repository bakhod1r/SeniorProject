# Object Memory Layout — Optimize

> Layout optimizations land in three buckets: **shrink** (reduce per-object footprint), **reorder** (avoid padding holes), and **arrange** (use cache lines well). Each section names a concrete move, the JOL output that confirms it landed, and a sketch of when *not* to apply it. Numbers are illustrative — always confirm with JMH and JOL in your environment.

---

## 1. Field reordering is mostly automatic — but check

On modern HotSpot with default `-XX:FieldsAllocationStyle=1`, fields are reordered largest-first inside the class. You almost never gain bytes by hand-ordering. The exception is **inheritance holes**, where the parent's mid-word end forces the child's `long`-bin to wait for the next 8-byte boundary.

```java
public class Base {
    boolean flag;     // ends at offset 13
}
public class Derived extends Base {
    long timestamp;   // forced to offset 16; offset 13..15 is hole
}
```

`Derived` is 24 bytes; merging into one class can sometimes cut the hole (and sometimes — as Bug 4 in find-bug shows — make it worse). The optimization rule:

- Default to *one class* for value-carrier shapes; flatten inheritance unless you need polymorphism.
- When inheritance is required, group small fields *together* in the parent so the parent's tail aligns at 16, eliminating the child-side hole.
- Verify with JOL before claiming the saving. The compiler is wiser than your spreadsheet.

---

## 2. Primitive arrays beat reference arrays for hot loops

For 1 million `int` values, the difference is roughly 200x — not in footprint (which is "only" 4–5x), but in *traversal time*:

| Storage              | Footprint              | Sequential sum time (1M elements, JMH) |
|----------------------|------------------------|----------------------------------------|
| `int[]`              | ~4 MB                  | ~0.6 ms                                |
| `Integer[]`          | ~20 MB (4M refs + 16M of boxes) | ~6 ms                          |
| `ArrayList<Integer>` | ~20 MB (same boxes)    | ~7 ms                                  |

The reasons:

- `int[]` is contiguous memory; the CPU prefetcher streams the next cache line before you ask.
- `Integer[]` is references; each load chases a pointer to wherever the box lives.
- Boxing also kills auto-vectorization — the JIT cannot apply SIMD to a chain of dependent loads.

Rule: **for primitive numeric data on hot paths, never go through boxed collections.** Use `int[]`, `long[]`, `double[]`, or `IntStream`/`LongStream`. Boxing belongs in slow paths only.

---

## 3. Records cooperate with escape analysis

A record is `final`, has only `final` fields, and exposes no mutating method. These are the exact preconditions HotSpot needs to *scalar-replace* the record inside a method:

```java
public record Vec3(double x, double y, double z) {
    public double dot(Vec3 o) { return x*o.x + y*o.y + z*o.z; }
}

double sumOfDots(double[] xs, double[] ys, double[] zs, Vec3 v) {
    double sum = 0;
    for (int i = 0; i < xs.length; i++) {
        Vec3 p = new Vec3(xs[i], ys[i], zs[i]);  // allocation in source
        sum += p.dot(v);                          // hot path
    }
    return sum;
}
```

In the loop, the JIT proves `p` never escapes (`dot` reads only its arguments; `p` is never stored anywhere). The allocation is **eliminated**: the three `double`s of `p` live in CPU registers, and the heap allocation drops out entirely.

Confirm with:

```
-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations
```

You should see a line naming the allocation site as eliminated. JMH allocation profilers (`-prof gc`) show 0 bytes per op on the loop. See [../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/) for the deep treatment.

The take-away: **use records for value carriers** that flow through tight loops. They are an EA-friendly shape, not just a syntax convenience.

---

## 4. `@Contended` for genuinely contended fields

For two fields *written by different threads in a tight loop*, putting them on separate cache lines is the most dramatic optimization in this file. A JMH micro-benchmark on a `Pair { long a; long b; }`:

| Setup                       | Throughput (ops/s/thread) |
|-----------------------------|---------------------------|
| Plain `volatile long a, b`  | ~1 M (false sharing)      |
| `@Contended long a, @Contended long b` (padding kicks in) | ~9–12 M |

The cost is bytes: each `@Contended` field consumes ~128 bytes of padding around it (default `-XX:ContendedPaddingWidth=128`). Apply only to:

- High-throughput counters (`LongAdder`'s `Cell[]`).
- Per-thread state held in a shared object (`ThreadLocalRandom`'s seed).
- Hot fields in lock-free data structures.

**Do not** apply to ordinary fields. A 256-byte object that is never written by two threads is a pure cost.

To use `@Contended` from application code on HotSpot:

```
--add-exports java.base/jdk.internal.vm.annotation=ALL-UNNAMED
-XX:-RestrictContended
```

Without both flags, the annotation is silently ignored (Bug 3 in find-bug).

---

## 5. Compressed oops sizing decisions

The compressed-oops cliff sits around **32 GB** heap (4 GB × 8-byte alignment). Below it, every reference is 4 bytes; at or above, every reference becomes 8 bytes. The implications for sizing a service:

- **31 GB heap** is the safe maximum for compressed oops.
- **32 GB heap** is the boundary. Some JVM versions auto-disable compressed oops, others widen the encoding shift. Test before committing.
- **48 GB heap** disables compressed oops. Every object grows; you often have *less* live capacity than 32 GB.

Mitigation: `-XX:ObjectAlignmentInBytes=16` extends the addressable range to ~64 GB at the cost of more per-object padding. Sometimes a *smaller* heap (24 GB) outperforms a larger one (48 GB) because the smaller one keeps compressed oops on.

The decision tree:

1. Run with `-Xmx32g` and observe footprint with `jcmd GC.heap_info`.
2. If you need more, try `-Xmx30g` (definitely compressed) before scaling up.
3. If pressure remains, scale *out* (more pods) rather than *up* (one larger pod losing compressed oops).
4. If you must go past 32 GB, accept the inflation and budget for it.

---

## 6. Valhalla flat layouts — future-proofing today

Project Valhalla introduces `value class` (JEP 401). When delivered, value instances will:

- Have no header (no mark word, no klass pointer).
- Be eliminated in arrays (`Point[]` is flat: 8 bytes per element for two `int`s).
- Be eliminated as fields (a `Vec3` field inside a `Particle` stores the 24 bytes inline, no reference).

Today, the closest approximation is records + escape analysis (which already eliminates many allocations) and primitive `int[]` for hot collections. The structures you build today that will *benefit most* from Valhalla:

- Records used as hot-loop value carriers (already EA-friendly).
- `record[]` arrays of small value carriers (today they pay reference + header per element; under Valhalla they will be flat).
- Methods returning small records (the JIT often inlines today; Valhalla will guarantee it).

Avoid building structures that *cannot* migrate to value classes:

- Classes using identity equality on small carriers (`==` on `Money` instances).
- Synchronization on small carriers.
- Storage of identity hash codes computed from object identity.

These prevent Valhalla migration. Migrate them to `.equals()` and `Objects.hash(fields)` now.

---

## 7. Struct-of-Arrays (SoA) for the dominant hot path

When one field of a small object dominates traversal cost, split it out:

```java
// AoS — array of references to Particle objects
public class Particle { double x, y, z, vx, vy, vz; }
Particle[] particles = ...;

void integrate(double dt) {
    for (Particle p : particles) p.x += p.vx * dt;
}
```

This loop touches only `x` and `vx`. Every loaded `Particle` brings four wasted doubles (`y, z, vy, vz`) into cache. SoA version:

```java
public class ParticleSystem {
    double[] x, y, z, vx, vy, vz;

    public void integrate(double dt) {
        for (int i = 0; i < x.length; i++) x[i] += vx[i] * dt;
    }
}
```

The inner loop now touches two contiguous arrays. Throughput on 1M particles improves 3–5x in typical benchmarks. The JIT also auto-vectorizes the `double[]` math when alignment cooperates.

Trade-off: SoA is hostile to OO modeling. Apply only on the *one* hot loop that matters; keep AoS `Particle` for general operations. The hybrid pattern: `ParticleSystem` owns SoA arrays for the integrator; `Particle` instances are a *view* generated on demand for non-hot paths.

---

## 8. Memory-aligned access and `Unsafe.putLong`

For `Unsafe`-level optimization in low-level libraries (network protocols, custom allocators), aligned access is faster than unaligned:

- A `long` read at an offset that is a multiple of 8 is one CPU instruction.
- A `long` read at an unaligned offset is sometimes two reads + a merge on older CPUs, or a single slower instruction on newer ones.

JOL output guarantees field alignment: HotSpot places `long` fields at 8-byte-aligned offsets. If you build a custom binary protocol with `Unsafe.putLong`, ensure your offsets are aligned the same way.

```java
unsafe.putLong(buffer, ARRAY_BYTE_BASE_OFFSET + 0,  word0);  // aligned
unsafe.putLong(buffer, ARRAY_BYTE_BASE_OFFSET + 1,  word1);  // UNALIGNED — penalty
unsafe.putLong(buffer, ARRAY_BYTE_BASE_OFFSET + 8,  word1);  // aligned
```

Modern Intel/AMD x86 tolerate unaligned access with small penalty; ARM is more sensitive. If you build for ARM (Apple Silicon, AWS Graviton), align everything.

`ByteBuffer.allocateDirect(...)` gives 8-byte-aligned native memory; `Unsafe.allocateMemory(...)` does not — you must align yourself.

---

## 9. Reducing object count, not just size

The biggest layout win is usually *not allocating the object at all*. Strategies:

- **Object pooling** for high-allocation-rate types (rare in modern JVMs; mostly the JIT's job through EA). Apply only if you have evidence from `jcmd JFR.dump` that allocation is the dominant cost.
- **Caching small immutable values.** `Integer.valueOf(127)` returns a cached box; `new Integer(127)` always allocates. The same trick works in user code: cache the 16 commonly seen values of your enum or record.
- **Replace many small objects with one composite.** Three `Optional<X>` fields in a class are three potential allocations and three references; one `EnumSet<Flags>` is a single `long`.
- **Lazy initialization** for rarely-used data. A `Map<X, RareData> sideTable` paid only by the few `X` instances that need rare data; the main class stays lean.

For *count* reduction, the rule of thumb: aim for the GC.class_histogram top entry to drop *by half*. Reorganize until it does.

---

## 10. When not to optimize layout

Layout optimization is wasted unless one of these holds:

- The class appears in the `jcmd GC.class_histogram` top 20.
- The class is on a hot allocation site in async-profiler `-e alloc`.
- The class is hit by multiple threads writing under contention.
- The class participates in a hot SoA-vs-AoS loop.

Outside these, code clarity wins. A 32-byte record that should be 24 saves nothing if the JVM allocates 100 of them per second — the GC absorbs the difference. Optimize where the count is huge or the rate is high; everywhere else, write the obvious code.

---

## 11. Quick rules

- [ ] Default to JOL output; do not estimate footprint by adding fields.
- [ ] Prefer primitive arrays (`int[]`, `long[]`, `double[]`) over boxed collections on hot paths.
- [ ] Use records for value carriers; they cooperate with escape analysis.
- [ ] `@Contended` only for fields written under cross-thread contention — confirm with JOL that padding actually landed.
- [ ] Stay under 32 GB heap to keep compressed oops; sometimes a smaller heap is faster.
- [ ] SoA for the dominant hot loop, AoS for everything else.
- [ ] Reduce object *count* before optimizing object *size* — the bigger lever.
- [ ] Optimize only the GC.class_histogram top 20 and the contended counters; everywhere else, prefer clarity.

---

## 12. What's next

| Topic                                              | File              |
|----------------------------------------------------|-------------------|
| Hands-on JOL exercises                             | `tasks.md`         |
| Interview Q&A                                      | `interview.md`     |

Related sibling chapters: [../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/) for the allocation-elimination layer, [../02-vtable-and-itable/](../02-vtable-and-itable/) for the dispatch-layer cost that interacts with layout, [../../03-design-principles/](../../03-design-principles/) for the design choices that drive the object count.

---

**Memorize this:** the levers are *shrink, reorder, arrange*. Shrink by pruning fields and using primitives over boxes. Reorder by trusting HotSpot — and watching out for inheritance holes. Arrange by understanding cache lines and `@Contended`. Optimize only the heavy hitters (`GC.class_histogram` top 20, contended counters). Everywhere else, code clarity wins — JOL is a tool, not a habit.
