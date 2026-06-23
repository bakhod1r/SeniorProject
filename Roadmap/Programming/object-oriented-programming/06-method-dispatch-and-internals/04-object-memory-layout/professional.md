# Object Memory Layout — Professional

> **What?** Driving layout awareness across a team — review vocabulary, audit playbooks, ArchUnit rules that codify your conventions, mentoring scripts, and the small set of refactors that move the footprint needle without rewriting the system.
> **How?** A staff-level engineer does not run JOL on every class. They build the *muscle* for the team to run it on the right ones: hot allocation sites, large collections of small things, contended counters, and inheritance hierarchies that are about to grow. This file is the playbook for that muscle.

---

## 1. The two questions worth asking in review

Most code does not need a layout audit. Two situations do, and a senior reviewer should recognize them on sight:

1. **A class is allocated in large quantity.** Node objects in a graph, tokens from a parser, message frames from a network layer, immutable value carriers in a stream pipeline. If you allocate millions of them, every wasted byte multiplies.
2. **A class is contended across threads.** Fields written under contention need cache-line discipline; otherwise the cost is visible in throughput, not footprint.

If neither holds, do *not* spend review cycles on layout. Code clarity wins. If either holds, the next sections give you the vocabulary.

---

## 2. The review vocabulary

When you find a layout problem, name it precisely. Vague feedback ("this class is too big") does not change behavior. Use this list:

- **"Header overhead."** Per-instance cost of the 12-byte HotSpot header. Relevant when a class is mostly small fields and used in bulk: "100 million `Cell` objects pay 1.2 GB of header alone."
- **"Padding hole."** Internal gap caused by alignment after a smaller field bin. Visible as an `(alignment/padding gap)` row in JOL.
- **"Tail padding."** Gap at the end of an object that rounds it up to a multiple of 8. Often unavoidable; sometimes removable by adding a small field that fills it.
- **"Inheritance hole."** Padding gap introduced because parent fields end mid-word and child fields cannot start until the next 8-byte boundary.
- **"False sharing."** Two fields, written by different threads, sharing a 64-byte cache line.
- **"Reference inflation."** What happens when compressed oops cannot apply (heap > ~32 GB, or `-XX:-UseCompressedOops`): every reference doubles in size.
- **"AoS vs SoA."** Array-of-Structs vs Struct-of-Arrays — for cache-friendly hot loops on large collections, SoA wins.
- **"Mark word state churn."** When a class is heavily `synchronized` and also `hashCode`-keyed; transitions between hashed and locked states cost cycles.

A review comment in this language is actionable: "This is a padding hole; the `long` field would absorb the 4-byte tail if you remove the `boolean`." A review comment in vague language is debate fuel.

---

## 3. The layout audit playbook

When a team asks "is our heap layout actually OK," run a four-step audit:

**Step 1 — Find the heavy hitters.**

```
jcmd <pid> GC.class_histogram | head -40
```

This prints `#instances`, `#bytes`, and class name, sorted by bytes. The top 10 or 20 classes are where layout work pays back.

**Step 2 — Run JOL on the heavy hitters.**

A short program that loads each class and calls `ClassLayout.parseInstance(...).toPrintable()`. Save the output as a file in `/docs/footprint/<class>.layout.txt`. Commit it to the repo — it becomes a regression baseline.

**Step 3 — Identify the cheap wins.**

Padding holes are the cheapest: rearrange fields, no behavior change, save bytes. False sharing in the top 5 contended classes is the next: `@Contended` or LongAdder substitution. Reference inflation needs config-level decisions (heap size, `-XX:ObjectAlignmentInBytes`).

**Step 4 — Lock it in with a test.**

Either ArchUnit (Section 5), a unit test that asserts `ClassLayout.parseInstance(new X()).instanceSize() == 32`, or a JOL-based smoke test in CI. Layout invariants must be regression-tested; otherwise the next refactor undoes the savings silently.

---

## 4. Refactor patterns that reduce footprint

A small set of moves accounts for most of the wins.

**Pattern: collapse two booleans into a bit-packed `int`.** Two `boolean` fields cost 2 bytes (or 16 with padding), but two flag *bits* cost zero new bytes if you have an existing `int` to ride along on.

```java
// Before:
public class Job {
    boolean retryable;
    boolean idempotent;
    int priority;
}

// After:
public class Job {
    int priority;            // bit 31..2 = priority, bit 1 = retryable, bit 0 = idempotent
    public boolean retryable()  { return (priority & 0b10) != 0; }
    public boolean idempotent() { return (priority & 0b01) != 0; }
}
```

Footprint goes from 24 to 16 bytes per object. Trade-off: harder to read. Apply only when the class is in the GC.class_histogram top 10.

**Pattern: extract rarely-used fields into a lazy side-table.** A field that is `null` 99% of the time still costs the reference slot in every instance. Move it into a `Map<X, Side>` populated only when needed.

```java
// Before — every Order pays for the rarely-used promo:
public class Order { Customer c; Money total; PromoCode promo; }

// After — promo lives in a side-table:
public class Order { Customer c; Money total; }
public class Orders { static final Map<Order, PromoCode> promos = new WeakHashMap<>(); }
```

Trade-off: API gets more complex, GC has a weak map to scan. Apply when the field is huge or the class count is huge.

**Pattern: prefer `record` over class for value carriers.** Records are `final`, immutable, and their fields are already final. Easier for JIT escape analysis, hashCode is computed, and your team gets a strong signal that "this is data, not behavior."

**Pattern: prefer `int[]` over `Integer[]`.** A 1000-element `Integer[]` is *at minimum* 4 KB (references) plus 1000 × 16 = 16 KB of boxed objects. The `int[]` is 4 KB plus header. The boxing cost is 80% of the footprint — and worse cache locality.

**Pattern: `LongAdder` over `AtomicLong` for write-heavy counters.** `LongAdder` does the cache-line striping and `@Contended` for you. Throughput under contention is several times higher.

---

## 5. ArchUnit rules to codify layout discipline

ArchUnit lets you express "no class in package X may have more than 8 fields" or "every class with `@Counter` must carry the `@Contended` annotation" as a JUnit test. A starter set:

```java
@ArchTest
public static final ArchRule hot_path_classes_must_be_records =
    classes().that().resideInAPackage("..hotpath..")
             .should().beRecords()
             .because("hot-path value carriers benefit from records (final, EA-friendly)");

@ArchTest
public static final ArchRule no_boolean_arrays_for_flags =
    fields().that().areDeclaredInClassesThat().resideInAPackage("..tokens..")
            .and().haveRawType(boolean[].class)
            .should().notExist()
            .because("boolean[] wastes 7 bytes per element; use BitSet or long bit-fields");

@ArchTest
public static final ArchRule contended_counters_must_extend_LongAdder =
    classes().that().areAnnotatedWith(HighContentionCounter.class)
            .should().beAssignableTo(LongAdder.class)
            .because("write-heavy counters need cache-line striping");
```

These rules do not replace JOL. They enforce *team conventions* without manual review. The conversation in PRs becomes "this class violates the hot-path-records rule because…" rather than "I think this should be a record."

---

## 6. False-sharing detection

False sharing is invisible from source. Three detection paths:

**Path 1 — `perf c2c` on Linux.** The `c2c` (cache-to-cache) report identifies cache lines being modified by multiple cores:

```
$ perf c2c record -- java -jar app.jar
$ perf c2c report
```

The output shows hot lines, their offsets in the heap, and the threads contending on them. Map offsets back to fields with JOL.

**Path 2 — JMH micro-benchmarks.** Suspect that two fields false-share? Write a benchmark that hammers each from a separate thread, with and without `@Contended`. A 3–10x throughput difference confirms.

**Path 3 — async-profiler with `-e cache-misses`.** Profile under load; high cache-miss rates on counter increments are a red flag.

For application code, JMH is the most accessible. `perf c2c` is the strongest evidence but requires Linux and root.

---

## 7. Mentoring around field ordering — what to teach, what to skip

Junior engineers reach for "declare longest field first" after reading one article on memory layout. Stop them politely:

- On modern HotSpot, declaration order **does not** decide layout — `-XX:FieldsAllocationStyle=1` (the default) sorts by size automatically.
- The exception is records, where parameter order *is* canonical for `equals`/`hashCode`. Even then, *layout* is reordered.
- Manual ordering only matters with `-XX:FieldsAllocationStyle=0` or very specific microbenchmarks where you want a specific offset for `Unsafe`-style access.

Teach instead:

- Read JOL output before optimizing. The truth is one print call away.
- Estimate footprint with `GC.class_histogram` before refactoring.
- Use records for value carriers; `@Contended` for write-heavy counters; `int[]` instead of `Integer[]`.
- Do not micro-optimize ordering; micro-optimize *class count* and *header overhead*.

---

## 8. Reading the team's allocation profile

A standing practice: once per quarter, run an allocation profile (async-profiler `-e alloc` or JFR) in a representative environment for 10 minutes. Save the top 20 allocation sites. Compare against the previous quarter. Three signals:

- A new entry in the top 20: investigate. Did a feature introduce a hot allocator?
- A 2x growth in an existing entry: regression candidate.
- An entry whose class is in the GC.class_histogram top 5 *and* in the allocation top 5: that class deserves layout review, JOL print, and possibly a record refactor.

This is the strongest early-warning signal for footprint regressions in long-lived services.

---

## 9. Communicating with infra and SRE

When a service exceeds its memory budget, the conversation often goes:

> SRE: "We need to upgrade pods from 8 GB to 16 GB."

A staff engineer asks the prior question: "Is the heap actually full, or is it the headers?" If `GC.class_histogram` shows 60% of live bytes are in classes with three fields of `boolean`, the right answer is *not* a bigger pod — it is layout work. Concretely:

- Reducing `Cell` from 32 bytes to 16 bytes saves 16 bytes × instance count.
- Replacing `Integer[]` with `int[]` in three hot collections halves a 12 GB heap to 6.
- Switching to compressed oops (by *staying under 32 GB* heap) cuts every reference in half.

Frame conversations with infra around "this many bytes per object × this many objects = this many GB." That gets a different answer than "we are running out of memory."

---

## 10. Quick rules

- [ ] Only audit layout for classes in the `jcmd GC.class_histogram` top 20 or under contention.
- [ ] Commit JOL output to the repo as a regression baseline.
- [ ] Use ArchUnit to lock in "no `boolean[]` in tokens" and "contended counters extend `LongAdder`."
- [ ] Detect false sharing with `perf c2c` or JMH, not by guessing.
- [ ] Teach JOL first; teach manual field ordering only after seeing JOL.
- [ ] Frame footprint conversations with infra in bytes × count, not GB.
- [ ] When the heap approaches 32 GB, count the cost of losing compressed oops — sometimes a smaller heap is faster.

---

## 11. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| Spec references, JEPs, `Unsafe.objectFieldOffset`              | `specification.md` |
| Ten layout bugs from production                                | `find-bug.md`      |
| Field reordering, primitive arrays, EA, `@Contended`           | `optimize.md`      |
| Hands-on JOL exercises                                         | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

Related sibling chapters: [../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/) and [../../03-design-principles/](../../03-design-principles/) for the design choices that produce the object counts in the first place.

---

**Memorize this:** layout is not an everyday concern, it is a *budget* concern. Apply effort to the GC.class_histogram top 20 and the contended counters; everywhere else, code clarity wins. Use ArchUnit to lock in your conventions, JOL to prove your numbers, and the bytes × count framing to keep infra conversations honest.
