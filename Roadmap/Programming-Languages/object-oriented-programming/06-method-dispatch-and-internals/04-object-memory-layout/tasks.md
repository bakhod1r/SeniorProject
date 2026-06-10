# Object Memory Layout — Practice Tasks

Eight exercises that force you to *print* layouts and reason about them. Each gives a setup, an objective, constraints, and acceptance criteria. The goal is to build the muscle "I will look at JOL output before I claim a footprint number." Add the `jol-core` dependency before starting:

```xml
<dependency>
    <groupId>org.openjdk.jol</groupId>
    <artifactId>jol-core</artifactId>
    <version>0.17</version>
</dependency>
```

---

## Task 1 — JOL on the JDK basics

Run `ClassLayout.parseInstance(...)` on each of the following and write down the instance size:

```java
new Object();
Integer.valueOf(42);
Long.valueOf(42L);
Boolean.TRUE;
"hello";
new String("hello");
new int[0];
new int[10];
new Object[0];
new Object[10];
```

**Objective.** Build calibration. The first column you should be able to recite without printing: header size on 64-bit HotSpot with compressed oops is 12 bytes; arrays add 4 more for the length.

**Constraints.**

- Run with default JVM flags first; record the numbers.
- Re-run with `-XX:-UseCompressedOops` and `-XX:-UseCompressedClassPointers`; record the differences.

**Acceptance criteria.**

- You can predict `new Object()` instance size to the byte.
- You can explain why `Integer.valueOf(42)` is 16 bytes (12 header + 4 value, no padding).
- You can explain why `String` size depends on JDK version (`char[]` pre-9, `byte[]` from JDK 9 onwards via JEP 254 Compact Strings).
- You produced one Markdown table comparing compressed-oops on vs off across all 10 cases.

---

## Task 2 — Reorder a record to eliminate a padding hole

Given:

```java
public record SensorReading(
    byte sensorId,
    int  reading,
    byte unit,
    long timestamp,
    byte flags
) { }
```

**Objective.** Reduce the instance size of `SensorReading` without losing any fields, by *understanding what HotSpot did to it*.

**Constraints.**

- You may not change field types.
- You may bit-pack the three `byte` fields into one `int` if needed; treat that as a fair refactor.
- The canonical constructor should still accept all five logical values.

**Acceptance criteria.**

- Print the original `ClassLayout.parseInstance(new SensorReading(...))` output and identify the padding gaps.
- Explain why declaration order does *not* matter — HotSpot reordered already.
- Propose a refactor that brings the instance size down (typically from 32 to 24 bytes) by packing the three `byte`s into the `int reading`'s top bits.
- The new record's accessors return the same values as the original for all valid inputs.

---

## Task 3 — Measure compressed-oops on vs off

Take a representative service class:

```java
public class Customer {
    long id;
    String name;
    String email;
    Address shipping;
    Address billing;
    PaymentMethod preferred;
    PromoCode promo;
    LocalDate joinDate;
    int loyaltyTier;
    boolean active;
}
```

**Objective.** Quantify how much the heap inflates when the JVM crosses the 32 GB threshold.

**Constraints.**

- Use JOL twice: once with `-XX:+UseCompressedOops -XX:+UseCompressedClassPointers` (default), once with both disabled.
- Calculate the per-object delta in bytes.
- Multiply by 1 million instances and 10 million instances; produce a markdown table.

**Acceptance criteria.**

- The table shows per-object footprint, per-million-objects footprint, and the percentage inflation.
- You can articulate "at 10 million Customers, dropping compressed oops costs ~N MB."
- You can name three system signals that would tell you a JVM has crossed the threshold (`GC.heap_info`, `jmap -heap`, `-Xlog:gc+heap`).

---

## Task 4 — Design a cache-line-aligned counter

Build a high-throughput sharded counter that scales linearly with thread count up to 16 threads.

```java
public final class StripedCounter {
    // ... your design here
    public void increment();
    public long total();
}
```

**Objective.** Beat `AtomicLong` in a JMH multi-thread increment benchmark by 5x or more.

**Constraints.**

- The counter must hold N cells, each on its own cache line.
- Cell selection by thread (use `Thread.currentThread().getId()` or `ThreadLocalRandom.current().probe()`).
- Total must sum all cells.

**Acceptance criteria.**

- A JOL print of one cell shows it is on a 64-byte-aligned slot with ~128 bytes of padding around the counter.
- JMH at 8 threads shows throughput at least 5x `AtomicLong`.
- The implementation falls back to a single cell when uncontended (read `LongAdder`'s source for the pattern).
- You can articulate why `@Contended` is the supported mechanism and how to enable it.

---

## Task 5 — Benchmark false sharing with and without `@Contended`

Two long fields, two writer threads, JMH throughput measurement.

```java
public class Pair { public volatile long a; public volatile long b; }
```

vs

```java
public class PaddedPair { @Contended public volatile long a; @Contended public volatile long b; }
```

**Objective.** Produce numeric evidence that false sharing costs throughput.

**Constraints.**

- Run on a machine with at least 4 physical cores.
- One thread loops `pair.a++`; another loops `pair.b++`.
- Use JMH `@Benchmark`, `@Threads(2)`, `@OperationsPerInvocation(N)`.
- Confirm JOL shows the padded version has 128-byte gaps around each field; the unpadded version does not.

**Acceptance criteria.**

- A markdown table with two rows (unpadded, padded) and one column (ops/s).
- The padded version is 3–10x faster on a typical x86 machine.
- The JOL output for both versions is committed to the task notes.
- You can answer "what flags did you start the JVM with to make `@Contended` work?" (`-XX:-RestrictContended`, `--add-exports java.base/jdk.internal.vm.annotation=ALL-UNNAMED`).

---

## Task 6 — Predict the size of `record Point(int x, int y)`

Without running JOL, predict the instance size, the layout offsets, and the padding gaps. Then run JOL and reconcile any disagreement.

**Objective.** Calibrate intuition.

**Constraints.**

- Write the prediction on paper (or in a markdown file) before running anything.
- Predict for: default JVM, `-XX:-UseCompressedOops`, `-XX:ObjectAlignmentInBytes=16`.

**Acceptance criteria.**

- Three predictions; three JOL prints; reconciliation paragraph for each.
- Correct answer for default: header 12, x at 12, y at 16, padding 20..23, total 24 bytes.
- Correct answer for compressed-oops off: header 16, x at 16, y at 20, padding 24..31, total 32 bytes.
- Correct answer for `ObjectAlignmentInBytes=16`: total 32 bytes (header 12, fields 12..19, padding 20..31).

---

## Task 7 — SoA refactor of a hot collection

Given:

```java
public class GameWorld {
    public List<Entity> entities = new ArrayList<>();
    public static class Entity {
        double x, y, z;
        double vx, vy, vz;
        double mass;
        String name;
        boolean alive;
    }

    public void integrate(double dt) {
        for (Entity e : entities) {
            if (e.alive) {
                e.x += e.vx * dt;
                e.y += e.vy * dt;
                e.z += e.vz * dt;
            }
        }
    }
}
```

**Objective.** Refactor the inner loop to use a Struct-of-Arrays representation that improves cache locality.

**Constraints.**

- Keep the `Entity` class for non-hot paths (debug UI, network serialization).
- Add an `EntityTable` class with parallel `double[]` arrays for `x, y, z, vx, vy, vz` and a `boolean[]` for `alive`.
- The integrate loop walks `EntityTable` directly, not `List<Entity>`.

**Acceptance criteria.**

- JMH benchmark at 1M entities shows the SoA loop at least 3x faster than the AoS loop.
- JOL print of one `Entity` documents the per-instance overhead saved.
- A view method `Entity get(int idx)` reconstructs an `Entity` from the SoA arrays on demand.
- You can articulate why the JIT can auto-vectorize the SoA `double[]` loop but not the AoS one.

---

## Task 8 — Use `-XX:+PrintFieldLayout` and reconcile with JOL

Run the JVM with diagnostic flags:

```
-XX:+UnlockDiagnosticVMOptions -Xlog:class+fieldlayout=trace
```

(or, on older builds, `-XX:+PrintFieldLayout`)

**Objective.** Capture HotSpot's *decisions* about field layout and confirm they match JOL's *results*.

**Constraints.**

- Choose a class with at least 6 fields of mixed types (long, int, byte, boolean, String, double).
- Capture the field-layout log for that class.
- Capture the JOL print for the same class.

**Acceptance criteria.**

- Both outputs show the same field-to-offset mapping.
- You can explain why the log mentions a "header" of 12 bytes but JOL prints two lines (mark @0, class @8).
- You can describe one case where the log shows a decision JOL cannot show (e.g., field allocation style choice, alignment computation).
- The captured log file and the JOL print are saved side-by-side as a reference for future audits.

---

## Validation

| Task | How to verify |
|------|---------------|
| 1 | A table with 10 rows × 2 columns (size with/without compressed oops). |
| 2 | Original record is 32 bytes; refactored is 24; same accessors round-trip. |
| 3 | Per-object footprint and per-million-instance footprint shown for both flag sets. |
| 4 | JMH shows the striped counter beating `AtomicLong` 5x at 8 threads; JOL shows padding. |
| 5 | Padded vs unpadded throughput differs at least 3x; JOL outputs confirm padding. |
| 6 | Three correct predictions; one JOL print per scenario. |
| 7 | SoA integrate is 3x AoS in JMH; the view API still returns logically equivalent entities. |
| 8 | Diagnostic log and JOL print agree on every field offset. |

---

## Worked solution sketch — Task 4 (Striped counter)

```java
import jdk.internal.vm.annotation.Contended;

public final class StripedCounter {

    @Contended
    private static final class Cell {
        volatile long value;
    }

    private final Cell[] cells;

    public StripedCounter(int stripes) {
        if ((stripes & (stripes - 1)) != 0) throw new IllegalArgumentException("power of two");
        this.cells = new Cell[stripes];
        for (int i = 0; i < stripes; i++) cells[i] = new Cell();
    }

    public void increment() {
        int idx = (int) (Thread.currentThread().getId() & (cells.length - 1));
        Cell c = cells[idx];
        // VarHandle would be cleaner; using Unsafe-via-VarHandle for brevity:
        long current = c.value;
        c.value = current + 1;   // not strictly atomic; LongAdder uses CAS
    }

    public long total() {
        long sum = 0;
        for (Cell c : cells) sum += c.value;
        return sum;
    }
}
```

JOL of a single `Cell`:

```
me.acme.StripedCounter$Cell object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x00012360
 12 116        (contended padding)
128   8   long Cell.value                 0
136 120        (contended padding)
Instance size: 256 bytes
```

Each cell is 256 bytes; 16 cells = 4 KB. That is a lot of memory for a counter, but throughput at 16 contending threads is roughly 12 million ops/s vs 200 thousand for a plain `AtomicLong`. Trade-off accepted.

Three things to notice in the sketch:

1. `@Contended` is applied to the `Cell` *class*, not individual fields. That pads the whole instance.
2. The number of cells is a power of two so the index mask is a single AND.
3. `total()` is intentionally non-atomic — accept the racy read; the JDK's `LongAdder.sum()` does the same.

---

**Memorize this:** every task above ends with a JOL print or a JMH number. Do not estimate, *print*. Run, save the output, commit it to the repo, then compare against your prediction. After eight tasks the muscle is built — you will look at a class declaration and your hand will already be reaching for `ClassLayout.parseInstance(...).toPrintable()`.
