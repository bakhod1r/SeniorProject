# Object Memory Layout — Specification Reading Guide

> **What?** What the JVMS *does* and *does not* say about memory layout, and which JEPs, HotSpot sources, and JDK APIs you read when you need authoritative answers. Memory layout is famously **implementation-defined** — the JVMS deliberately leaves the runtime free to lay objects out however it likes — so this file is a map of the *load-bearing* references you can cite when the conversation gets formal.
> **How?** Each section names the source, paraphrases what it commits to, and contrasts that with what HotSpot actually does. When you need a citation, this is the file to grep.

---

## 1. Where to find the canonical text

| Topic                                                  | Authoritative source                                          |
|--------------------------------------------------------|---------------------------------------------------------------|
| Runtime data areas, heap                               | **JVMS §2.5** (Run-Time Data Areas), **§2.5.3** (The Heap)    |
| Object representation                                  | **JVMS §2.7** (Representation of Objects)                     |
| `Class` file structure                                 | JVMS §4                                                       |
| Array semantics                                        | **JVMS §2.5.3**, JVMS §6.5 `newarray`/`anewarray`             |
| String deduplication (G1)                              | **JEP 192**                                                   |
| Constant dynamic (`CONSTANT_Dynamic`)                  | **JEP 309**                                                   |
| Value classes preview (Valhalla)                       | **JEP 401** (preview), JEP 402, JEP 447                       |
| Compressed oops                                        | HotSpot source: `src/hotspot/share/oops/oop.hpp`              |
| Compressed klass pointers                              | HotSpot source: `src/hotspot/share/oops/compressedKlass.hpp`  |
| Mark word                                              | HotSpot source: `src/hotspot/share/oops/markWord.hpp`         |
| Field allocation                                       | HotSpot source: `src/hotspot/share/classfile/fieldLayoutBuilder.hpp` |
| `sun.misc.Unsafe.objectFieldOffset`                    | OpenJDK source: `jdk.internal.misc.Unsafe`                    |
| Removed: biased locking                                | **JEP 374** (deprecate), **JEP 374 implementation removed in JDK 18** |

The **JVMS** is the contract Oracle and OpenJDK commit to. The **HotSpot source** is what *this implementation* does. JEPs are the planning documents that get accepted into the JDK; they are the closest thing to a paper trail for evolving features like Valhalla.

---

## 2. JVMS §2.7 — the empty spec hook

JVMS §2.7 is short. Paraphrasing the relevant clauses:

> The Java Virtual Machine does not mandate any particular internal structure for objects. In some Java Virtual Machine implementations, a reference to a class instance may be a pointer to a handle that is itself a pair of pointers: one to a table containing the methods of the object and a pointer to the Class object that represents the type of the object, and the other to the memory allocated from the heap for the object data.

That is the whole "spec" of object layout. The JVMS commits to:

- An object reference behaves like a pointer (or a handle).
- The object has data and a way to reach its class.

It does *not* commit to:

- Header size.
- Field order.
- Padding.
- Hash code storage.
- Lock state representation.

This is why layout is *implementation-defined*. When you see "HotSpot does X" in this section, it is HotSpot, not Java.

---

## 3. Why the spec stays vague

The deliberate vagueness lets implementations differ:

- **HotSpot** uses a 12-byte (compressed) or 16-byte header with mark word + klass pointer.
- **OpenJ9** uses a single-word (8-byte on 64-bit) header.
- **GraalVM Native Image** uses a 16-byte header in default builds, smaller with Lilliput-like options.
- **Project Lilliput** (HotSpot) aims to compress the mark word into 4 bytes for an 8-byte header.

If the JVMS pinned down layout, none of those experiments could ship. The price you pay: every numeric claim about size is "on this JVM, with these flags, today."

---

## 4. JEP 192 — string deduplication

JEP 192 (delivered in JDK 8u20 for G1) is a layout-adjacent story. The motivation: in many heaps, **identical `String` content** appears in many distinct `String` objects, each pointing to its own `char[]` / `byte[]`. Deduplication runs during a G1 young collection: when two strings have equal content, one's array reference is rewritten to point to the other's array, and the orphan array is collected.

This affects layout indirectly: the *backing array* is shared across many `String` objects. JOL on a single `String` shows the layout of one instance; `GraphLayout` shows the deduplicated backing.

```
$ java -XX:+UseG1GC -XX:+UseStringDeduplication ...
```

You will not see "this string is dedup'd" in JOL output directly, but `jcmd <pid> GC.heap_info` and the GC log will tell you how many bytes were saved.

---

## 5. JEP 309 — `CONSTANT_Dynamic`

JEP 309 (delivered in JDK 11) added `CONSTANT_Dynamic` to the class file format — a constant pool entry whose value is computed lazily by an `invokedynamic`-style bootstrap. It is related to layout obliquely because:

- It enables `condy`-based optimizations in `String.format`, `MethodHandle.invokeWithArguments`, and `switch` pattern matching.
- It works through the *klass pointer* — the constant pool the klass owns is now richer.

You will not see CONSTANT_Dynamic in JOL output, but knowing it exists explains why the metaspace footprint of a class can be larger than the count of fields and methods suggests.

---

## 6. JEP 401 — Value classes (Valhalla preview)

JEP 401 (preview at the time of writing) introduces **value classes** in Java. The spec changes are extensive; the layout consequence is dramatic:

> A value class has no identity. Two instances with equal field values are indistinguishable. Implementations may represent value instances by their fields alone, with no per-instance header.

Concrete effects:

- A value `Point` array is laid out flat: 8 bytes per element (two ints), not 8 bytes of reference plus 24 bytes of `Point`.
- Field access on a value instance does not go through a reference indirection.
- `synchronized (point)` is a compile error — there is no identity to lock on.
- `identityHashCode(point)` is a compile error — there is no identity to hash.

Read JEP 401's "Specification" section for the exact textual changes to JLS §4, §5, §8, §15, and JVMS §4. Layout is now in the spec for value classes specifically.

---

## 7. JEP 402 and JEP 447 — flattening

JEP 402 ("Classes for the Basic Primitives") and the broader Valhalla family commit to flattening rules: when and how the JVM may eliminate a header and lay a value class inline inside another object's field, an array element, or a local variable. The bullet points:

- A `final` field of a value class type *may* be flattened into the enclosing class.
- An array of a value class type *may* be a flat array.
- A local variable of a value class type *will* often be scalar-replaced by escape analysis ([../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/)).

Implementations are not required to flatten; they are *permitted* to. This is the same flavor of spec language as JVMS §2.7 — permission, not obligation.

---

## 8. `Unsafe.objectFieldOffset` and `VarHandle`

The closest thing to a layout API in the JDK:

```java
import sun.misc.Unsafe;       // or jdk.internal.misc.Unsafe
// reflectively get Unsafe.theUnsafe ...
long offset = unsafe.objectFieldOffset(Customer.class.getDeclaredField("ageYears"));
System.out.println(offset);
```

The returned `long` is the *byte offset of the field within the object*. For our earlier `Customer` example, JOL printed `ageYears` at offset 12, so `objectFieldOffset` returns 12.

`Unsafe.objectFieldOffset` is what JOL uses internally. It is the load-bearing JDK call for layout-aware code: low-level concurrent data structures (`ConcurrentHashMap`, `AtomicReferenceFieldUpdater`), serialization libraries (Kryo), and JIT instrumentation all use it.

Modern code should prefer `VarHandle`:

```java
VarHandle AGE = MethodHandles.lookup().findVarHandle(Customer.class, "ageYears", int.class);
AGE.set(customer, 41);
```

`VarHandle` builds on `Unsafe` semantics but is type-safe, module-safe, and supports all the JMM modes (plain, opaque, acquire/release, volatile). For atomic field updates, `VarHandle` replaces `Unsafe` in new code.

---

## 9. `-XX:+PrintFieldLayout` and JIT introspection

HotSpot ships flags that expose what the field-layout builder did:

```
-XX:+UnlockDiagnosticVMOptions -XX:+PrintFieldLayout
```

On JDK 17+ the unified logging form is:

```
-Xlog:class+fieldlayout=trace
```

Sample line:

```
[class,fieldlayout] me/acme/Customer: instance size 32, hash 0
[class,fieldlayout]   header @0 size 12
[class,fieldlayout]   long Customer.id   @16 size 8
[class,fieldlayout]   int  Customer.age  @12 size 4
...
```

This is the implementation telling you exactly what it did. Pair with JOL for the verified output. The difference is intent: `PrintFieldLayout` traces *decisions*; JOL prints *results*.

Other diagnostic flags:

- `-XX:+PrintClassLayout` (older builds) — prints layout at class-init time.
- `jcmd <pid> GC.class_stats` — prints per-class instance size and total memory; useful in production triage.

---

## 10. JOL itself

JOL (Java Object Layout) is an OpenJDK project that ships as a `jol-core` jar. Its design:

- Parses class files for declared fields.
- Calls `Unsafe.objectFieldOffset` to discover where each field actually sits.
- Walks padding gaps and prints them in `ClassLayout.toPrintable()`.
- For graphs, uses reflection plus `objectFieldOffset` to recurse through references.

Available command-line:

```
$ java -jar jol-cli.jar internals -cp app.jar com.acme.Customer
```

This avoids having to add JOL to your application classpath when you only want to inspect.

JOL is *the* tool referenced in OpenJDK mailing list posts, blog content from the HotSpot team, and most JEP discussion threads about layout. Treat its output as authoritative for the JVM it runs on.

---

## 11. Removed feature: biased locking

JEP 374 (delivered in JDK 15) **disabled biased locking by default** and deprecated it for removal. JDK 18 removed the implementation entirely. If you see textbooks or blog posts that include "biased" as a mark word state, mentally tag them as pre-JDK 15.

What changed in the mark word:

- Pre-JDK 15: six states including biased (`thread_id | epoch | age | 101`).
- JDK 15+: five states; no biased state.

The JVMS does not specify mark word contents at all, so this was a pure HotSpot change — no JVMS revision was needed.

---

## 12. Reading the HotSpot source

For genuinely authoritative answers, the source is in `openjdk/jdk` on GitHub:

- `src/hotspot/share/oops/markWord.hpp` — mark word states and bit layout.
- `src/hotspot/share/oops/compressedOops.hpp` — compressed oop encoding/decoding.
- `src/hotspot/share/oops/compressedKlass.hpp` — compressed klass pointer.
- `src/hotspot/share/classfile/fieldLayoutBuilder.cpp` — the actual field allocation algorithm.
- `src/hotspot/share/oops/instanceOop.hpp` — the runtime representation of instance objects.

Reading these is a senior-level exercise; you do not need to. But when an interviewer asks "where is the mark word documented," the correct answer is "JVMS leaves it implementation-defined; HotSpot's choice is in `markWord.hpp`."

---

## 13. What the JLS says about field declaration order

The JLS does say *one* thing about field order: **constructor initialization**. JLS §12.5 specifies that fields are initialized in textual order during construction. This is observable:

```java
class Box {
    int a = compute("a");
    int b = compute("b");   // runs after a
}
```

But initialization order is not layout order. The fields are initialized in declared order; their *bytes* are laid out wherever HotSpot picks. The JLS commits to one and is silent on the other.

---

## 14. Quick rules

- [ ] JVMS §2.7 leaves object layout implementation-defined. Cite this when someone says "the spec requires header X."
- [ ] HotSpot's choice is in `markWord.hpp` and `fieldLayoutBuilder.cpp`. Cite these for HotSpot specifics.
- [ ] Use `Unsafe.objectFieldOffset` or `VarHandle` for layout-aware code; JOL prints them.
- [ ] JEP 192 (G1 string deduplication) saves bytes invisibly; JEP 309 (`CONSTANT_Dynamic`) enables lazy class data.
- [ ] JEP 401 (Valhalla value classes) is the first JEP to commit to flat layouts in the spec.
- [ ] Biased locking is gone in JDK 15+ (JEP 374). Pre-JDK 15 texts are stale.

---

## 15. What's next

| Topic                                                       | File              |
|-------------------------------------------------------------|-------------------|
| Ten layout bugs from production                             | `find-bug.md`      |
| Field reordering, primitive arrays, EA, `@Contended`        | `optimize.md`      |
| Hands-on JOL exercises                                      | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

Related sibling chapters: [../02-vtable-and-itable/](../02-vtable-and-itable/), [../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/), [../../03-design-principles/](../../03-design-principles/).

---

**Memorize this:** the JVMS is *deliberately silent* on object layout; JVMS §2.7 grants the JVM permission, not obligation. HotSpot's choices live in `markWord.hpp` and `fieldLayoutBuilder.cpp`. When precision matters, cite the source — not "the spec" — and verify your numbers with JOL. JEP 401 (Valhalla) is the first time the spec itself commits to a flat layout; until then, every layout claim is "on this implementation, today."
