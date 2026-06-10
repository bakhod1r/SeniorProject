# Object Memory Layout — Junior

> **What?** Every Java object on the heap is more than its fields. HotSpot prepends a *header* (mark word + klass pointer), lays the declared fields out in an order *the JVM* chooses, and pads the tail until the total size is a multiple of 8 bytes. The total footprint is almost always larger than the sum of the field sizes you wrote.
> **How?** Stop estimating by adding up `int` + `long` + reference. Use **JOL** (Java Object Layout) — `org.openjdk.jol.info.ClassLayout.parseInstance(obj).toPrintable()` — to print the actual bytes. Read the output once and the surprise (a one-field class costs 16 bytes minimum) becomes intuition.

---

## 1. Why this matters before you've allocated a billion objects

You will see the same shock twice in your career. First time: you assume `class Tiny { boolean flag; }` is 1 byte and discover it is 16. Second time: a hash map of 100 million tiny objects uses *3 GB* instead of the 800 MB you budgeted. Both are the same problem, expressed in different units.

Object memory layout is *not* a JLS question — it is a HotSpot implementation choice. But every Java program runs on top of those choices, and once you internalize them, footprint estimates stop being magic. This file gives you the shape of every Java object plus the smallest JOL output you need to read.

---

## 2. The shape of every heap object

A non-array Java object on the heap has three parts:

```
+-------------------+   <-- object reference points here
|     mark word     |   8 bytes  (lock state, hash, GC bits)
+-------------------+
|   klass pointer   |   4 bytes on 64-bit with -XX:+UseCompressedOops (default)
+-------------------+   8 bytes without compressed oops
|  instance fields  |   sum of declared field sizes, ordered by HotSpot
+-------------------+
|     padding       |   0..7 bytes so total is multiple of 8
+-------------------+
```

On a typical 64-bit HotSpot with compressed oops on (the default for heaps < 32 GB), the header is **12 bytes**: 8 for the mark word, 4 for the compressed klass pointer. Without compressed oops the header is **16 bytes**. Every object on the heap pays this overhead — there is no way to opt out (until Project Valhalla; see senior).

For arrays the header is one word longer (a 4-byte `length` field), so 16 bytes on 64-bit with compressed oops.

---

## 3. First JOL print — an `Integer`

The canonical first run. Add the JOL dependency:

```xml
<dependency>
    <groupId>org.openjdk.jol</groupId>
    <artifactId>jol-core</artifactId>
    <version>0.17</version>
</dependency>
```

Then run:

```java
import org.openjdk.jol.info.ClassLayout;

public class FirstLayout {
    public static void main(String[] args) {
        System.out.println(ClassLayout.parseInstance(Integer.valueOf(42)).toPrintable());
    }
}
```

Realistic output on 64-bit HotSpot with compressed oops:

```
java.lang.Integer object internals:
OFF  SZ   TYPE DESCRIPTION               VALUE
  0   8        (object header: mark)     0x0000000000000001 (non-biasable; age: 0)
  8   4        (object header: class)    0x00012345 (java.lang.Integer)
 12   4    int Integer.value             42
Instance size: 16 bytes
Space losses: 0 bytes internal + 0 bytes external = 0 bytes total
```

Read this column by column:

- **OFF** — offset from the start of the object in bytes.
- **SZ** — size of this field/slot.
- **TYPE** — Java type or header role.
- **VALUE** — the actual bits at runtime.
- **Instance size** — total bytes on the heap, including padding.

A boxed integer is 16 bytes. Not 4. *Sixteen.* Twelve bytes of header, four bytes of `int value`, no padding because 12 + 4 == 16 which is already aligned.

---

## 4. The "small class is actually 16 bytes" surprise

Now the smaller version:

```java
public class TinyFlag {
    boolean flag;
}
```

```
me.acme.TinyFlag object internals:
OFF  SZ      TYPE DESCRIPTION               VALUE
  0   8           (object header: mark)     0x0000000000000001
  8   4           (object header: class)    0x00012345
 12   1   boolean TinyFlag.flag             false
 13   3           (object alignment gap)
Instance size: 16 bytes
Space losses: 0 bytes internal + 3 bytes external = 3 bytes total
```

The boolean takes 1 byte but the JVM pads the object to 16. The "alignment gap" line at offset 13 is three wasted bytes whose only job is to round the object up to the next 8-byte boundary. You cannot save those three bytes by removing the boolean — you would still pay 12 + 4 padding = 16. The minimum object footprint on 64-bit HotSpot is 16 bytes; you pay it whether you store anything or not.

This is why `new Object()` is also 16 bytes:

```
java.lang.Object object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x00012345 (java.lang.Object)
 12   4        (object alignment gap)
Instance size: 16 bytes
```

Twelve bytes of header, no fields, four bytes of padding. The "empty" object costs 16.

---

## 5. What is inside the mark word

You will see the same `0x0000000000000001` value over and over. The mark word is *not* random — it is a tagged union. At any moment it stores **one** of:

- The lock state (unlocked / light-locked / heavy-locked / GC-marked).
- The identity hash code, once `Object.hashCode()` has been called for the first time.
- A pointer to a heavyweight monitor when a `synchronized` block contends.
- GC marking bits during a collection.

Senior covers all five states. For now, the takeaway: the mark word is the JVM's scratch space on every single object, and that is why it cannot shrink below 8 bytes.

---

## 6. What is inside the klass pointer

The klass pointer says "this object is a `java.lang.Integer`" (or whatever its class is). It is *not* a reference to `Integer.class` (that is the *mirror*, a separate heap object you reach via `getClass()`). The klass pointer points into the JVM's internal metadata space and is what enables `instanceof`, virtual dispatch (see [../02-vtable-and-itable/](../02-vtable-and-itable/)), and reflection.

With `-XX:+UseCompressedClassPointers` (default on 64-bit HotSpot, alongside compressed oops) it is 4 bytes. Without it, 8. That is why the header is 12 vs 16 bytes depending on flags.

---

## 7. Reading the OFF column

Once you can read offsets, you can read any JOL output:

- The header always starts at offset 0.
- Instance fields start at offset 12 (compressed-oops) or 16 (no compressed-oops).
- Each field occupies `SZ` bytes; the next field's offset is `current_offset + SZ`, *but only if alignment allows* — HotSpot may insert "alignment gap" rows to satisfy field alignment (a `long` must start on an 8-byte boundary, for example).
- The last row is either a field or an "object alignment gap" that rounds the whole object up to a multiple of 8.

A worked exercise:

```java
public class Mixed {
    int   a;
    long  b;
    byte  c;
}
```

You might predict the order is `a, b, c` and that the layout is 12 (header) + 4 (a) + 8 (b) + 1 (c) + 7 (padding) = 32 bytes. Let JOL tell you what actually happens:

```
me.acme.Mixed object internals:
OFF  SZ   TYPE DESCRIPTION               VALUE
  0   8        (object header: mark)     0x0000000000000001
  8   4        (object header: class)    0x00012345
 12   4    int Mixed.a                   0
 16   8   long Mixed.b                   0
 24   1   byte Mixed.c                   0
 25   7        (object alignment gap)
Instance size: 32 bytes
Space losses: 0 bytes internal + 7 bytes external = 7 bytes total
```

The `long b` is naturally aligned at offset 16 (a multiple of 8) — HotSpot reordered fields to make this work without internal gaps. The 7-byte tail padding rounds 25 → 32.

A different declared order (`long b, int a, byte c`) gives the *same* layout, because HotSpot chooses field order itself. Middle goes into the details.

---

## 8. Arrays carry an extra word

Arrays have an additional `length` field in the header. On 64-bit HotSpot with compressed oops:

```java
int[] arr = new int[4];
System.out.println(ClassLayout.parseInstance(arr).toPrintable());
```

```
[I object internals:
OFF  SZ   TYPE DESCRIPTION                VALUE
  0   8        (object header: mark)      0x0000000000000001
  8   4        (object header: class)     0x00012346 ([I)
 12   4        (array length)             4
 16  16    int [I.<elements>              N/A
Instance size: 32 bytes
```

Header is 16 bytes (12 + 4 for length). Then four `int`s at 4 bytes each = 16. Total 32, no padding needed.

The empty array `new int[0]` is still 16 bytes (header alone) — non-zero even though it stores no elements.

---

## 9. Why padding to 8 bytes

The JVM aligns objects so that pointers to them have predictable low bits. Compressed oops in particular *require* 8-byte alignment: a 32-bit compressed oop is interpreted as `value << 3` to reach a 35-bit address, which only works if every object starts on an 8-byte boundary. Padding to 8 is the price of compressed oops.

You can change alignment to 16 with `-XX:ObjectAlignmentInBytes=16` — useful for AVX-aligned access — at the cost of *more* padding per object. The default 8 is the sweet spot for almost every workload.

---

## 10. Common newcomer mistakes

**Mistake 1: estimating size by adding field bytes.** A `class Pair { int a; int b; }` is *not* 8 bytes. It is 16: 12 header + 8 fields + 0 padding (already a multiple of 8). Always add the header.

**Mistake 2: thinking `boolean` is 1 bit.** It is 1 byte on the heap. The JLS allows JVMs to use a byte, an int, or a bit, but HotSpot chose 1 byte. (Inside `boolean[]`, the JLS still says one element per byte.)

**Mistake 3: assuming declaration order is layout order.** It is not. HotSpot reorders fields largest-first to minimize padding. Senior covers the exact algorithm.

**Mistake 4: ignoring inherited fields.** A subclass's fields come *after* the parent's fields, with their own alignment. A parent ending at offset 13 forces the child's `long` field to start at offset 16, leaving a 3-byte hole. Find-bug covers a real case of this.

**Mistake 5: confusing JOL output with the JLS.** JOL prints what *this* JVM did. A different JDK version, a different VM (OpenJ9), or different flags can give different layouts. Use JOL as evidence, not as specification.

---

## 11. Quick rules

- [ ] Every heap object pays a header: 12 bytes on 64-bit HotSpot with compressed oops, 16 bytes without.
- [ ] Object size is always rounded up to a multiple of 8 (`-XX:ObjectAlignmentInBytes`).
- [ ] Minimum object size on the heap is 16 bytes — `new Object()` already costs that.
- [ ] Arrays add a 4-byte length to the header (16 bytes total with compressed oops).
- [ ] Use `ClassLayout.parseInstance(obj).toPrintable()` whenever you guess; JOL never lies.
- [ ] Field declaration order is *not* layout order — HotSpot reorders.

---

## 12. What's next

| Topic                                                                            | File              |
| -------------------------------------------------------------------------------- | ----------------- |
| Field reordering, compressed oops on/off, real-world JOL prints                  | `middle.md`        |
| Mark word states, klass compression, `@Contended`, Valhalla preview              | `senior.md`        |
| Memory audits, ArchUnit, false-sharing review checklists                         | `professional.md`  |
| Spec references, JEPs, `Unsafe.objectFieldOffset`                                | `specification.md` |
| Ten layout bugs from production                                                  | `find-bug.md`      |
| Field reordering, primitive arrays, EA-friendly records, `@Contended`            | `optimize.md`      |
| Hands-on JOL exercises                                                           | `tasks.md`         |
| Interview Q&A                                                                    | `interview.md`     |

Related sibling chapters: [../02-vtable-and-itable/](../02-vtable-and-itable/) explains where the klass pointer leads; [../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/) covers when objects skip the heap entirely.

---

**Memorize this:** every Java object is *header + fields + padding*. 12 bytes of header on 64-bit HotSpot with compressed oops, fields reordered by the JVM, padded up to a multiple of 8. The smallest object on the heap is 16 bytes — `new Object()` already pays it. When you need to know what an object really costs, do not estimate. Run `ClassLayout.parseInstance(obj).toPrintable()` and read the truth.
