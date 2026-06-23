# Object Memory Layout — Middle

> **What?** Real JOL prints of non-trivial classes; how HotSpot reorders fields automatically; how compressed oops change the size of every reference; how arrays cost a `length` word; how inheritance affects layout; and where the gaps actually come from.
> **How?** Each section starts with a hand-written class, runs `ClassLayout.parseInstance(...)` against it, and reads the output line by line. The byte counts you will see are the ones HotSpot actually emits on 64-bit JDK 17+ with default flags.

---

## 1. The layout algorithm in one paragraph

HotSpot sorts instance fields into bins by size: **long/double (8 bytes)**, **int/float (4)**, **short/char (2)**, **byte/boolean (1)**, **references (4 with compressed oops, 8 without)**. It then emits each bin largest-first after the header, packing each into available space. The result is the layout that produces the fewest internal padding bytes for a given set of declared fields. Subclass fields are placed *after* the parent's fields with their own re-alignment. The whole object is then padded at the tail to a multiple of `ObjectAlignmentInBytes` (8 by default).

This is the **field allocation strategy**, controlled by `-XX:FieldsAllocationStyle` (0 = HotSpot legacy, 1 = sort-larger-first, 2 = inheritance-aware, default 1). For most code you will never set it; you just need to know that *declaration order does not matter*.

---

## 2. A class with mixed types — `Customer`

```java
public class Customer {
    boolean active;
    byte    grade;
    long    id;
    String  name;
    int     ageYears;
    short   region;
}
```

Six fields in declared order: 1 + 1 + 8 + 4 + 4 + 2 = 20 bytes of "field data", plus 12 bytes header, naive total 32 with padding. Run JOL:

```
me.acme.Customer object internals:
OFF  SZ                 TYPE DESCRIPTION               VALUE
  0   8                      (object header: mark)     0x0000000000000001
  8   4                      (object header: class)    0x00012345
 12   4                  int Customer.ageYears         0
 16   8                 long Customer.id               0
 24   2                short Customer.region           0
 26   1                 byte Customer.grade            0
 27   1              boolean Customer.active           false
 28   4   java.lang.String   Customer.name             null
Instance size: 32 bytes
Space losses: 0 bytes internal + 0 bytes external = 0 bytes total
```

Read what HotSpot did:

- Header at 0..11 (12 bytes).
- `int ageYears` at offset 12 (4 bytes — fills the gap to the next 8-byte boundary).
- `long id` at offset 16 (8 bytes, naturally aligned).
- `short region` at offset 24, `byte grade` at 26, `boolean active` at 27 (small fields packed).
- `String name` (4-byte compressed oop) at offset 28.

Total 32 bytes. **No internal padding**, no tail padding. HotSpot reordered the declared fields to fit the largest types into aligned slots first, then packed smaller fields into the leftover bytes. You wrote them in any order; HotSpot computed the optimal one.

---

## 3. Why "manually order largest-first" rarely helps

A common piece of folklore: "declare your fields largest-first to save bytes." On modern HotSpot this is a no-op — the JVM is going to reorder anyway. You will see this if you change Customer's declaration:

```java
public class Customer {
    long    id;
    String  name;
    int     ageYears;
    short   region;
    byte    grade;
    boolean active;
}
```

JOL output is **identical** to the previous one — same offsets, same 32-byte total. HotSpot does not honor your order; it honors its own.

There are two cases where the heuristic still matters:

1. **`-XX:FieldsAllocationStyle=0`** — the legacy "preserve declaration order" mode. Rarely used in production; some test harnesses or older JVMs default to it.
2. **`@Contended` fields** (senior topic) and **records**, where the *parameter order* fixes the layout because the compiler-generated `equals`/`hashCode` walks fields in declared order. For correctness it does not matter; for predictable hashing/equality benchmarks it does.

---

## 4. Padding holes from inheritance

When a subclass adds fields, HotSpot lays out the *parent* first, then re-aligns and starts the *child*. If the parent ends mid-word, the child's first field-bin start has to wait for alignment, leaving a hole.

```java
public class Parent {
    boolean flag;
}

public class Child extends Parent {
    long timestamp;
}
```

JOL on a `Child`:

```
me.acme.Child object internals:
OFF  SZ      TYPE DESCRIPTION                VALUE
  0   8           (object header: mark)      0x0000000000000001
  8   4           (object header: class)     0x00012347
 12   1   boolean Parent.flag                false
 13   3           (alignment/padding gap)
 16   8      long Child.timestamp            0
Instance size: 24 bytes
Space losses: 3 bytes internal + 0 bytes external = 3 bytes total
```

The 3-byte gap at offset 13 is the cost of two separate field-bin starts (parent's fields first, then child's fields). Folding `flag` into `Child` directly removes the hole:

```java
public class Folded {
    boolean flag;
    long    timestamp;
}
```

```
me.acme.Folded object internals:
OFF  SZ      TYPE DESCRIPTION                VALUE
  0   8           (object header: mark)      0x0000000000000001
  8   4           (object header: class)     0x00012348
 12   4           (alignment/padding gap)
 16   8      long Folded.timestamp           0
 24   1   boolean Folded.flag                false
 25   7           (object alignment gap)
Instance size: 32 bytes
```

Wait — that is *worse*, not better. Why? Because HotSpot put the `long` first (aligned at 16) and the `boolean` at 24, then padded 7 bytes at the tail. The lesson is not "always fold parent and child" but "inheritance can introduce holes that flat layouts can sometimes avoid, but not always — measure with JOL." Find-bug Bug 4 covers a concrete case where flattening saves real bytes.

---

## 5. Records: predictable, but still reordered

A record's *canonical constructor* preserves your parameter order, but its *memory layout* is still chosen by HotSpot's allocation strategy.

```java
public record Point(int x, int y) { }
```

```
me.acme.Point object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x00012349
 12   4    int Point.x                    0
 16   4    int Point.y                    0
 20   4        (object alignment gap)
Instance size: 24 bytes
```

Header (12) + two ints (8) = 20, rounded to 24. Notice the 4-byte tail padding — two `int`s do not naturally sum to an 8-byte multiple.

A `record Box(long lo, long hi, int extra)` is more revealing:

```
me.acme.Box object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x0001234a
 12   4    int Box.extra                  0
 16   8   long Box.lo                     0
 24   8   long Box.hi                     0
Instance size: 32 bytes
```

`int extra` is placed at offset 12 — into the 4-byte slot between the header and the first `long`-aligned position. Without that, the `long`s would have left a 4-byte hole. HotSpot's reordering is exactly what saves you those bytes.

---

## 6. Compressed oops: on vs off

The 4 vs 8 byte distinction for reference fields is the single biggest layout switch on a 64-bit JVM. By default it is on for heaps below 32 GB. Compare:

```java
public class Pair {
    Object a;
    Object b;
}
```

With `-XX:+UseCompressedOops` (default):

```
me.acme.Pair object internals:
OFF  SZ                TYPE DESCRIPTION                VALUE
  0   8                     (object header: mark)      0x0000000000000001
  8   4                     (object header: class)     0x0001234b
 12   4   java.lang.Object  Pair.a                     null
 16   4   java.lang.Object  Pair.b                     null
 20   4                     (object alignment gap)
Instance size: 24 bytes
```

With `-XX:-UseCompressedOops`:

```
me.acme.Pair object internals:
OFF  SZ                TYPE DESCRIPTION                VALUE
  0   8                     (object header: mark)      0x0000000000000001
  8   8                     (object header: class)     0x00007f12a4b50098
 16   8   java.lang.Object  Pair.a                     null
 24   8   java.lang.Object  Pair.b                     null
Instance size: 32 bytes
```

24 bytes vs 32 — a 33% inflation for a class with two references. Multiply across millions of objects in a hash map and the difference is enormous. The reverse trade-off: compressed oops require an addressing trick (the 32-bit value is shifted left 3 to address an 8-byte-aligned 35-bit space, capping the heap at ~32 GB). Past that the JVM disables compressed oops automatically — and every object on your heap grows. Find-bug Bug 5 covers a production case of this exact phenomenon.

---

## 7. References, not values

Every non-primitive field is a reference (a pointer), not the object itself. A `String` field is 4 or 8 bytes — *plus* the bytes of whatever `String` instance it points to, somewhere else on the heap. JOL has a *deep* mode for that:

```java
import org.openjdk.jol.info.GraphLayout;

System.out.println(GraphLayout.parseInstance(new Customer()).toFootprint());
```

```
me.acme.Customer@52cc8049d footprint:
     COUNT       AVG       SUM   DESCRIPTION
         1        32        32   me.acme.Customer
         1        16        16   java.lang.Object (null name placeholder removed in this listing)
         2                  48   (total)
```

`GraphLayout` walks the graph; `ClassLayout` only prints the one object. Use `ClassLayout` to understand *layout*; use `GraphLayout` when budgeting *real footprint* including referents.

---

## 8. Arrays — the length word and element packing

Arrays carry a separate `length` field in the header — the JVM needs it for bounds checks. With compressed oops:

```java
byte[] bytes = new byte[5];
```

```
[B object internals:
OFF  SZ    TYPE DESCRIPTION                VALUE
  0   8         (object header: mark)      0x0000000000000001
  8   4         (object header: class)     0x0001234c ([B)
 12   4         (array length)             5
 16   5    byte [B.<elements>              N/A
 21   3         (object alignment gap)
Instance size: 24 bytes
```

Header is 16 bytes (12 + 4 length). Elements at 16..20. Tail padding 21..23.

A reference array:

```java
String[] words = new String[3];
```

```
[Ljava.lang.String; object internals:
OFF  SZ                 TYPE DESCRIPTION                VALUE
  0   8                      (object header: mark)      0x0000000000000001
  8   4                      (object header: class)     0x0001234d
 12   4                      (array length)             3
 16  12   java.lang.String   [Ljava.lang.String;.<elements>   N/A
 28   4                      (object alignment gap)
Instance size: 32 bytes
```

Three references at 4 bytes each = 12 bytes of elements. Without compressed oops, those would be 8 bytes each (24 total) and the array would be 48 bytes overall. Reference-array footprint is the cheapest place for compressed oops to pay off.

---

## 9. The class-layout output is *not* the field-allocation log

JOL parses the *runtime* shape: offsets and sizes after the JVM placed everything. If you want to see HotSpot's *decisions* — what algorithm picked what slot — use `-XX:+PrintFieldLayout` (HotSpot debug flag, available in fastdebug builds, and through `-XX:+UnlockDiagnosticVMOptions -Xlog:class+fieldlayout=trace` on JDK 17+).

Sample log line (illustrative):

```
[fieldlayout] me/acme/Customer: instance 32 bytes
[fieldlayout]   header: 12
[fieldlayout]   long  id          @16
[fieldlayout]   int   ageYears    @12
[fieldlayout]   short region      @24
[fieldlayout]   byte  grade       @26
[fieldlayout]   boolean active    @27
[fieldlayout]   ref   name        @28
```

JOL prints the *result*; `PrintFieldLayout` prints the *trace*. Both agree.

---

## 10. Quick rules

- [ ] HotSpot reorders fields largest-first. Your declaration order is rarely the layout order.
- [ ] Compressed oops are on by default; a typical 64-bit object header is 12 bytes, references are 4 bytes.
- [ ] Heaps above ~32 GB silently disable compressed oops — every object grows. Budget for it.
- [ ] Records, inheritance, and `byte`/`short` packing all visible in JOL; do not estimate, print.
- [ ] Arrays have a 4-byte `length` in addition to mark + klass — 16-byte header on 64-bit.
- [ ] Use `ClassLayout` for one object's layout, `GraphLayout` for the whole referenced graph.

---

## 11. What's next

| Topic                                                                | File              |
|----------------------------------------------------------------------|-------------------|
| Mark word states, klass compression, `@Contended`, Valhalla         | `senior.md`        |
| Code-review vocabulary and ArchUnit-style layout audits             | `professional.md`  |
| JVMS hooks, JEPs, `Unsafe.objectFieldOffset`                        | `specification.md` |
| Ten layout bugs from production                                     | `find-bug.md`      |
| Field reordering for footprint, EA, false sharing                   | `optimize.md`      |
| Hands-on JOL exercises                                              | `tasks.md`         |
| Interview Q&A                                                       | `interview.md`     |

---

**Memorize this:** layout is a function HotSpot computes from your field set, not your field order. The header is 12 bytes with compressed oops, references are 4 bytes, and everything is padded up to 8. The single biggest swing in real-world footprint is whether the heap is small enough for compressed oops. When numbers do not match your model, run JOL — the truth is one print call away.
