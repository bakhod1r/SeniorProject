# Object Memory Layout — Find the Bug

> 10 layout-related bugs that compile and pass functional tests but bite production. Each shows the snippet, the symptom (heap dump, JFR, JMH, OOM, latency), the JOL output that exposes it, and the fix. Read the layout, find the surprise, write down the move.

---

## Bug 1 — A "tiny" `Node` that costs 40 bytes per element

A linked list of `long` IDs:

```java
public class IdList {
    private static final class Node {
        long id;
        Node next;
        Node(long id, Node next) { this.id = id; this.next = next; }
    }
    private Node head;
    public void add(long id) { head = new Node(id, head); }
}
```

**Symptom.** A workload that holds 10 million IDs uses 400 MB of heap. The developer expected `10M × 8 bytes = 80 MB`.

**JOL output:**

```
me.acme.IdList$Node object internals:
OFF  SZ                       TYPE DESCRIPTION                VALUE
  0   8                            (object header: mark)      0x0000000000000001
  8   4                            (object header: class)     0x00012350
 12   4                            (alignment/padding gap)
 16   8                       long Node.id                    0
 24   4   me.acme.IdList$Node      Node.next                  null
 28   4                            (object alignment gap)
Instance size: 32 bytes
```

32 bytes per node, not 8 — a 4x overhead. And that is *without* counting the `IdList` itself (16 bytes) or the references between nodes (already inside the 32). At 10M nodes, 320 MB just for `Node` headers and pointers. Add the JVM's own bookkeeping and 400 MB is realistic.

**Violation.** Per-element header overhead dwarfs the payload when the payload is small.

**Fix.** Stop using linked lists for primitive collections.

```java
public class IdList {
    private long[] data = new long[16];
    private int size = 0;
    public void add(long id) {
        if (size == data.length) data = Arrays.copyOf(data, size * 2);
        data[size++] = id;
    }
}
```

10M longs in a `long[]` is 80 MB plus a 16-byte array header — exactly what you expected. The takeaway: linked structures pay the header tax *per element*; primitive arrays do not.

---

## Bug 2 — A custom record with a padding hole

```java
public record TickEvent(byte source, long timestampNanos, byte channel, int seq) { }
```

**Symptom.** A tick-data pipeline reads 200 million events per minute into a list of `TickEvent`. Heap usage is 50% higher than the team's spreadsheet predicted.

**JOL output:**

```
me.acme.TickEvent object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x00012351
 12   4    int TickEvent.seq              0
 16   8   long TickEvent.timestampNanos   0
 24   1   byte TickEvent.source           0
 25   1   byte TickEvent.channel          0
 26   6        (object alignment gap)
Instance size: 32 bytes
```

Header (12) + `int` (4) + `long` (8) + two `byte`s (2) = 26 bytes, padded to 32. Note the 6-byte tail padding — not avoidable here, the field set is what it is. But the team had been hoping for 24, which would require dropping or merging fields.

**Violation.** Misunderstanding what the layout *can* be. The record cannot be smaller than 32 bytes with these fields.

**Fix.** Pack `source` and `channel` into the spare space inside `seq`:

```java
public record TickEvent(int sourceChannelSeq, long timestampNanos) {
    public byte source()  { return (byte) ((sourceChannelSeq >>> 24) & 0xFF); }
    public byte channel() { return (byte) ((sourceChannelSeq >>> 16) & 0xFF); }
    public int  seq()     { return sourceChannelSeq & 0xFFFF; }
}
```

```
Instance size: 24 bytes
```

200 million events × 8 fewer bytes = 1.6 GB heap saved. Trade-off: readability. Apply only when count is large.

---

## Bug 3 — False sharing between two `@Contended` fields

A naive striped counter:

```java
public class Pair {
    @Contended public volatile long reads;
    @Contended public volatile long writes;
}
```

**Symptom.** A high-throughput service runs eight reader threads incrementing `reads` and eight writer threads incrementing `writes`. JMH shows 1.2 million ops/s. The team expected 10 million.

**JOL output (with `--add-exports java.base/jdk.internal.vm.annotation=ALL-UNNAMED -XX:-RestrictContended`):**

```
me.acme.Pair object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x00012352
 12   4        (alignment/padding gap)
 16   8   long Pair.reads                 0
 24   8   long Pair.writes                0
Instance size: 32 bytes
```

Wait — no padding at all! The annotation was *silently ignored*. The JVM was started without `-XX:-RestrictContended`, so `@Contended` is restricted to internal classes only. The two `volatile long`s sit at offsets 16 and 24 — the same 64-byte cache line.

**Violation.** Annotation that the JVM refused to honor.

**Fix.** Add `-XX:-RestrictContended` to JVM startup *and* the export. Re-run JOL:

```
me.acme.Pair object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0  16        (object header)
 16 128        (contended padding: 'reads' group)
144   8   long Pair.reads                 0
152 120        (contended padding)
272   8   long Pair.writes                0
280 120        (contended padding)
Instance size: 400 bytes
```

Throughput climbs to 9.5 million ops/s. The lesson: `@Contended` requires JVM permission *and* an export to work; check with JOL that the padding actually appears.

---

## Bug 4 — Inheritance double-padding around a `long`

```java
public class Marker {
    boolean done;
}

public class Stamp extends Marker {
    long timestamp;
}
```

**Symptom.** `Stamp` is 24 bytes; the team thought it would be 16.

**JOL output:**

```
me.acme.Stamp object internals:
OFF  SZ      TYPE DESCRIPTION                VALUE
  0   8           (object header: mark)      0x0000000000000001
  8   4           (object header: class)     0x00012353
 12   1   boolean Marker.done                false
 13   3           (alignment/padding gap)
 16   8      long Stamp.timestamp            0
Instance size: 24 bytes
```

3 bytes of internal padding at offset 13, because the parent's fields are placed first and end mid-word; the child's `long` cannot start until offset 16. Move both fields into one class:

```java
public class Stamp {
    boolean done;
    long timestamp;
}
```

```
me.acme.Stamp object internals:
OFF  SZ      TYPE DESCRIPTION                VALUE
  0   8           (object header: mark)      0x0000000000000001
  8   4           (object header: class)     0x00012354
 12   4           (alignment/padding gap)
 16   8      long Stamp.timestamp            0
 24   1   boolean Stamp.done                 false
 25   7           (object alignment gap)
Instance size: 32 bytes
```

Worse! HotSpot puts the `long` first this time and pads 7 bytes at the tail. The lesson: flattening parent/child does *not* always reduce footprint. The fix that works:

```java
public final class Stamp {
    long timestamp;
}
```

If `done` was rarely-used metadata, move it to a side-table. Now `Stamp` is exactly 24 bytes (header 12 + long 8 + tail pad 4). Sometimes the cheap saving is *deleting a field*, not reordering one.

---

## Bug 5 — Heap > 32 GB silently disables compressed oops

A production service runs with `-Xmx48g`. Its `Order` class has many reference fields:

```java
public class Order {
    Customer customer;
    Address shipping;
    Address billing;
    PaymentMethod payment;
    PromoCode promo;
    Carrier carrier;
}
```

**Symptom.** The team scales the pod from 32 GB to 48 GB hoping to fit more orders. Instead, the heap fills *faster* than at 32 GB, and the live object count is the same. GC frequency doubles.

**JOL output at `-Xmx32g`:**

```
me.acme.Order object internals:
OFF  SZ                  TYPE DESCRIPTION                VALUE
  0   8                       (object header: mark)      0x0000000000000001
  8   4                       (object header: class)     0x00012355
 12   4   me.acme.Customer    Order.customer             null
 16   4   me.acme.Address     Order.shipping             null
 20   4   me.acme.Address     Order.billing              null
 24   4   me.acme.PaymentMethod Order.payment            null
 28   4   me.acme.PromoCode   Order.promo                null
 32   4   me.acme.Carrier     Order.carrier              null
 36   4                       (object alignment gap)
Instance size: 40 bytes
```

JOL at `-Xmx48g`:

```
me.acme.Order object internals:
OFF  SZ                  TYPE DESCRIPTION                VALUE
  0   8                       (object header: mark)      0x0000000000000001
  8   8                       (object header: class)     0x00007f12a4b50098
 16   8   me.acme.Customer    Order.customer             null
 24   8   me.acme.Address     Order.shipping             null
 32   8   me.acme.Address     Order.billing              null
 40   8   me.acme.PaymentMethod Order.payment            null
 48   8   me.acme.PromoCode   Order.promo                null
 56   8   me.acme.Carrier     Order.carrier              null
Instance size: 64 bytes
```

40 → 64 bytes per order, a 60% inflation. Plus the *referenced* objects all grow the same way. Across the heap, total live bytes roughly doubles.

**Violation.** Crossing the ~32 GB threshold silently disables compressed oops. Every reference doubles in size.

**Fix.** Either stay below 32 GB (often the right answer — two 32 GB pods are cheaper than one 64 GB pod that has lost compressed oops), or use `-XX:ObjectAlignmentInBytes=16` to extend the addressable range at the cost of more per-object padding. Measure with JOL before committing to either.

---

## Bug 6 — Programmer's mental model vs actual layout

The team writes a `record` and assumes layout matches parameter order:

```java
public record Position(byte x, byte y, long timestamp, int score) { }
```

**Symptom.** A network protocol serializes `Position` by walking `Unsafe.getByte/Long/Int` at offsets the developer hand-coded (0, 1, 2, 10). The deserializer on the receiving side reads garbage.

**JOL output:**

```
me.acme.Position object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x00012356
 12   4    int Position.score             0
 16   8   long Position.timestamp         0
 24   1   byte Position.x                 0
 25   1   byte Position.y                 0
 26   6        (object alignment gap)
Instance size: 32 bytes
```

The fields are *not* in declared order. `score` is at offset 12, `timestamp` at 16, `x` at 24, `y` at 25. The developer's hand-coded offsets are wrong.

**Violation.** Confusing declaration order with layout order.

**Fix.** Never hand-code offsets. Use `Unsafe.objectFieldOffset(Field)` or — better — `VarHandle`:

```java
VarHandle SCORE = MethodHandles.lookup().findVarHandle(Position.class, "score", int.class);
int s = (int) SCORE.get(pos);
```

For serialization, use a library (Jackson, Kryo, protobuf) that handles layout for you. Hand-rolled offsets are a permanent maintenance burden — the next JVM upgrade can re-order them silently.

---

## Bug 7 — `Object[]` walk thrashes cache

A hot loop on a `User[]`:

```java
User[] users = ...; // 1 million users
long totalAge = 0;
for (User u : users) totalAge += u.age();
```

**Symptom.** The loop takes 80 ms; the team's intuition said "1M integer additions, that should be a millisecond."

**Why.** The `User[]` is an array of *references*. Each `users[i]` is a 4-byte pointer; following it loads a `User` object from somewhere else in the heap. The `User` instances are not adjacent in memory. Every iteration is a pointer chase.

JOL on `User`:

```
me.acme.User object internals:
OFF  SZ                  TYPE DESCRIPTION                VALUE
  0   8                       (object header: mark)      0x0000000000000001
  8   4                       (object header: class)     0x00012357
 12   4                  int  User.age                   0
 16   4   java.lang.String    User.name                  null
 20   4                       (object alignment gap)
Instance size: 24 bytes
```

For 1M users, that is 24 MB of `User` instances *plus* a 4 MB `User[]`. The CPU's L1 cache is 32 KB; almost every `users[i].age()` is a cache miss.

**Violation.** AoS (Array of Structs / array of references) is cache-hostile when only one field is read.

**Fix.** SoA (Struct of Arrays) — split the hot field into its own primitive array:

```java
public class UserTable {
    int[]    ages;
    String[] names;
}

long totalAge = 0;
for (int a : ages) totalAge += a;
```

Now the inner loop is `int[]` traversal — adjacent memory, prefetcher loves it, no pointer chase. Time drops from 80 ms to under 3 ms.

**Trade-off.** SoA breaks OO modeling. Apply on the *one* hot loop that dominates; keep the AoS `User` for everything else.

---

## Bug 8 — `Integer[]` instead of `int[]` quadruples footprint

A cache stores 10 million integer keys:

```java
Integer[] keys = new Integer[10_000_000];
```

**Symptom.** The cache takes 240 MB. Estimate said 40 MB.

**JOL output for the array shape:**

```
[Ljava.lang.Integer; object internals:
OFF  SZ                  TYPE DESCRIPTION                VALUE
  0   8                       (object header: mark)      0x0000000000000001
  8   4                       (object header: class)     0x00012358
 12   4                       (array length)             10000000
 16  10000000 * 4              Integer  Integer[].<elements>   ...
```

10M × 4 bytes of references = 40 MB *for the array alone*. Then each non-null `Integer` is 16 bytes. 10M × 16 = 160 MB more. Total ~200 MB plus overhead.

**Violation.** Boxing pays the per-element header tax.

**Fix.** Use `int[]`:

```java
int[] keys = new int[10_000_000];
```

10M × 4 = 40 MB plus a 16-byte header. Done. No box objects, no references, cache-friendly traversal. Whenever a collection of integers does not need `null` and does not need to fit a `Map<K,V>` API, `int[]` (or `IntStream`) wins.

---

## Bug 9 — Bridge method inflates a generic class

A custom comparator:

```java
public class IdComparator implements Comparator<Order> {
    public int compare(Order a, Order b) {
        return Long.compare(a.id(), b.id());
    }
}
```

**Symptom.** The team wonders why `IdComparator` instances appear in `jcmd GC.class_stats` with more bytes than the source suggests.

**JOL output on the `Class` (not an instance):**

```
$ jcmd <pid> GC.class_stats | grep IdComparator
... me.acme.IdComparator      Methods: compare(Order,Order)I, compare(Object,Object)I [bridge]
```

The compiler emits a **bridge method** `int compare(Object, Object)` that casts and forwards to the typed `compare(Order, Order)`. The bridge lives in the class file and the vtable. It does not affect instance size, but it does affect:

- Class metadata footprint (slightly more bytes in metaspace per implementation).
- Megamorphic dispatch behaviour ([../02-vtable-and-itable/](../02-vtable-and-itable/)).
- `Method[]` arrays returned by reflection.

A team grepping for `compare` in stack traces sometimes confuses the bridge frame with the real frame.

**Violation.** Forgetting that erasure produces bridge methods for generic interfaces.

**Fix.** Nothing to fix in code; understand the artifact. When auditing class metadata footprint, count bridge methods. They are visible with:

```
javap -c -p IdComparator.class
```

The output shows both `compare` methods, one tagged as a `bridge` flag.

---

## Bug 10 — Serialized form differs from heap layout

A team caches an object's heap layout via `Unsafe` and assumes the same byte sequence can be written to disk:

```java
long size = ClassLayout.parseInstance(obj).instanceSize();
byte[] raw = new byte[(int) size];
unsafe.copyMemory(obj, 0, raw, Unsafe.ARRAY_BYTE_BASE_OFFSET, size);
// write raw to disk
```

**Symptom.** Reading the file back on a different JVM (or a different JVM build) produces garbage. The team thinks the bytes are "corrupted"; they are not — they are reconstituted with a *different* layout.

**Violation.** Conflating in-memory layout with persistent serialization. The mark word holds lock state, GC marks, and hash bits that mean nothing on disk. The klass pointer points into *this JVM's* metaspace and is meaningless after a restart. References point to other heap objects that may not exist on read-back. Field offsets may differ across JVM versions.

**Fix.** Use a real serialization format — Java's `Serializable`, JSON, protobuf, Avro — anything that defines a *stable wire format*. Heap layout is not a wire format. The JVMS (§2.7) explicitly permits implementations to differ; any code that assumes otherwise breaks on upgrade.

```java
ObjectOutputStream oos = new ObjectOutputStream(out);
oos.writeObject(obj);
```

If footprint matters, use a binary format like protobuf or Cap'n Proto with explicit field tags. The serialized form is bytes you control; the heap layout is bytes HotSpot controls.

---

## Pattern summary

| Bug                                               | Root cause                                                          |
|---------------------------------------------------|---------------------------------------------------------------------|
| 1 — Linked list of `long` is 4x payload           | Per-element header overhead                                         |
| 2 — Record with padding hole                      | Misestimated layout; bit-packing recovers bytes                     |
| 3 — `@Contended` silently ignored                 | Annotation needs `-XX:-RestrictContended` + JVM export              |
| 4 — Inheritance padding hole                      | Subclass field bin starts after parent's mid-word end               |
| 5 — > 32 GB disables compressed oops              | Every reference doubles; budget heap below 32 GB                    |
| 6 — Hand-coded offsets wrong                      | Declared order != layout order; use `objectFieldOffset`/`VarHandle` |
| 7 — `Object[]` cache miss                         | AoS pointer chase; SoA for hot loops                                |
| 8 — `Integer[]` quadruples footprint              | Boxing pays per-element header; use `int[]`                         |
| 9 — Bridge method footprint                       | Generics erasure adds methods (and metadata bytes)                  |
| 10 — Heap bytes treated as wire format            | Heap layout is implementation-defined; serialize through a format   |

These bugs do not produce compile errors. They show up in GC pressure, latency spikes, mysterious memory usage, and silent data corruption after a JVM upgrade. Train your team to reach for JOL the moment a footprint number is surprising — every one of these bugs was discovered by *printing the layout*, not by reading more code.
