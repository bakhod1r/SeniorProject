# Classes and Objects — Professional (Under the Hood)

> **What's actually happening?** When you write `class Foo { ... }` and `new Foo()`, the compiler emits a binary `.class` file with structured tables; the JVM loads, links, verifies, prepares, resolves, and initializes it; then `new` allocates an object whose layout is dictated by HotSpot's `InstanceKlass`, fills its header, runs `<init>`, and hands you a tagged reference whose representation depends on whether compressed oops are on. Every step has costs you can measure and levers you can pull.

---

## 1. From `.java` to `.class` — what `javac` actually emits

A class file is a structured binary defined in JVMS §4. After running:

```
$ javac BankAccount.java
$ javap -v -p BankAccount.class
```

You'll see the structure (simplified):

```
ClassFile {
    u4              magic = 0xCAFEBABE;
    u2              minor_version, major_version;
    cp_info         constant_pool[];
    u2              access_flags;          // ACC_PUBLIC, ACC_FINAL, ACC_SUPER, ACC_INTERFACE, ...
    u2              this_class, super_class;
    u2              interfaces[];
    field_info      fields[];              // each field: access flags, name idx, descriptor idx, attributes
    method_info     methods[];             // each method: includes Code attribute with bytecode
    attribute_info  attributes[];          // SourceFile, BootstrapMethods, InnerClasses, NestHost, ...
}
```

Key things hidden from the `.java`:

- **The constant pool** holds every string literal, every method/field/class reference, and every numeric constant the class needs. The bytecode itself is mostly indices into this table (e.g., `getfield #7`).
- **`ACC_SUPER`** is set on every modern class; it changes how `invokespecial` resolves.
- **`<init>`** and **`<clinit>`** are the synthesized method names for instance and static initialization; you never write them yourself but they appear in `javap` output.
- **`NestHost` / `NestMembers`** attributes (Java 11+) describe nest-mates that share private access — that's how nested classes share private fields without bridge methods.

---

## 2. `new` decomposed at bytecode level

```java
BankAccount a = new BankAccount("Alice", 100);
```

Compiles to:

```
0:  new           #2  // class BankAccount       ← allocate, push reference
3:  dup                                           ← duplicate, ctor will consume one
4:  ldc           #3  // String "Alice"
6:  ldc2_w        #4  // long 100L
9:  invokespecial #5  // BankAccount."<init>"(Ljava/lang/String;J)V   ← run constructor
12: astore_1                                      ← store reference into local 1
```

What each step *actually does* in HotSpot:

1. **`new`** — calls `InterpreterRuntime::_new` (or its inlined fast path in the JIT). Allocation goes to:
   - **TLAB bump pointer**, if the object fits in the thread's Thread-Local Allocation Buffer. This is the common case: ~5 cycles per allocation.
   - **TLAB slow path / shared eden**, if the TLAB is full or the object is too large.
   - **Old gen direct**, for "humongous" objects in G1 (≥ half a region).

2. **Object header initialization**. The first 8 or 16 bytes of the new memory are written with the *mark word* (default lock state, hashcode 0) and the *klass pointer* (compressed if `-XX:+UseCompressedClassPointers`).

3. **Field zeroing** — every field is set to its zero value (`0`/`null`/`false`). HotSpot may skip this if the allocator already zeroed memory at TLAB refill time.

4. **`<init>` execution** — your constructor body. The JVM verifies that `<init>` has been invoked exactly once on this reference before any other method can be called.

The `dup` after `new` is the JVM's way of saying "hold a copy for the constructor to consume; leave the original on the stack so it can be stored." A constructor returns `void`; the language semantics of "the result of `new` is a reference" are produced by this `dup`.

---

## 3. HotSpot object layout (64-bit)

For a 64-bit HotSpot with default flags (`-XX:+UseCompressedOops`, `-XX:+UseCompressedClassPointers`):

```
offset  size  field
   0     8    mark word          ← lock, hash, GC age, biased lock holder (until JEP 374)
   8     4    klass pointer      ← compressed class pointer
  12     4    ↳ first field starts here (with alignment)
```

So the header is **12 bytes**, and the object is then padded to an 8-byte alignment.

Without compressed oops (`-XX:-UseCompressedOops`, used at heaps > ~32 GB):

```
offset  size  field
   0     8    mark word
   8     8    klass pointer
  16          fields...
```

Header is 16 bytes.

Field placement strategy (HotSpot's default):

1. Longs and doubles (8 bytes).
2. Ints and floats (4 bytes).
3. Shorts and chars (2 bytes).
4. Bytes and booleans (1 byte).
5. References (4 bytes compressed, 8 bytes otherwise).

This minimizes padding by placing larger fields first, then shrinking. The trailing pad makes the object size a multiple of 8.

Inspect with [JOL](https://github.com/openjdk/jol):

```java
System.out.println(ClassLayout.parseClass(Money.class).toPrintable());

// Money object internals:
//  OFFSET  SIZE      TYPE DESCRIPTION                VALUE
//       0   12           (object header)             N/A
//      12    4       int Money.cents                 N/A
//      16    4    String Money.currency              N/A
//      20    4           (loss due to alignment)      N/A
// Instance size: 24 bytes
```

You can re-order fields manually if you suspect false sharing, but HotSpot's default layout is usually optimal — and Java has no `@PackedStruct` equivalent. (Project Valhalla's value classes change this story dramatically — see §11.)

---

## 4. The mark word — small word, big footprint

The mark word is 64 bits and carries different content depending on the lock state:

| Lock state                  | Bits 0–1 | Content                                         |
|-----------------------------|----------|-------------------------------------------------|
| Unlocked (normal)           | `01`     | identity hash (31 bits) + GC age + flags         |
| Lightweight locked          | `00`     | pointer to lock record on stack of owning thread |
| Heavyweight locked / inflated | `10`   | pointer to ObjectMonitor on the C++ heap         |
| Marked (during GC)          | `11`     | pointer to forwarded copy                        |
| Biased locked (JDK 8–17)    | `101`    | thread id + epoch (deprecated since JEP 374)     |

Practical consequences:

- **The identity hash is computed lazily**, on the first call to `Object.hashCode()`. It is then stored in the mark word (or moved off-object once locked → see "displaced mark"). This is why `System.identityHashCode(obj)` is *not* free the first time, and why some GC implementations need extra bits when objects are large or have been hashed.
- **Locking is cheap when uncontended.** Lightweight locking simply CASes the mark word. The expensive path (inflation to a monitor) only kicks in under contention.
- **JEP 374 disabled biased locking by default in JDK 15** because the speedup it gave to old `Hashtable`/`Vector` workloads is no longer worth the implementation complexity in HotSpot.

---

## 5. `invokespecial`, `invokevirtual`, and the dispatch tables

When you call `account.deposit(100)`:

```
0: aload_1                ; push account
1: ldc       100L
4: invokevirtual #6       ; BankAccount.deposit(J)V
```

`invokevirtual` consults the receiver's **vtable** — a table on the `Klass` metaspace structure that has one slot per virtual method, in inheritance order. `vtable[index]` is the resolved method pointer, and the index is fixed at link time.

For interface calls (`invokeinterface`), the JVM uses an **itable** instead — an interface method table that maps interface-method to actual-method. Itable lookup is more complex than vtable lookup, but HotSpot caches the result via inline caches at the call site so a typical call is one indirect jump.

For `<init>` calls, only `invokespecial` is allowed — it bypasses dynamic dispatch and always calls the exact constructor declared, which is necessary because constructor chains (`super()`, `this()`) must be deterministic.

`invokestatic` and `invokedynamic` round out the family. `invokedynamic` underpins lambdas, string concatenation (Java 9+), and pattern-matching dispatch — its bootstrap method runs once and produces a `CallSite`, which is then a fixed direct call.

---

## 6. Class loading: what really happens before your first `new`

JVMS §5 defines the loading lifecycle:

```
Loading → Linking (Verification → Preparation → Resolution) → Initialization
```

- **Loading**: a `ClassLoader` finds the bytes (filesystem, JAR, JMOD, classpath, modulepath) and produces an internal `Class<?>` object plus the underlying `InstanceKlass` in metaspace.
- **Verification** (JVMS §4.10): structural and type checks. The bytecode verifier proves the operand stack is consistent at every program point, that types flow correctly, and that no instruction can violate the JVM safety invariants. Failures throw `VerifyError`.
- **Preparation**: static fields get default values (note: not your literal initializers yet — that's `<clinit>`).
- **Resolution**: symbolic references in the constant pool turn into direct references — only when first used (lazy).
- **Initialization**: `<clinit>` runs. This is the synthesized class initializer that sets static field initializers and runs `static { ... }` blocks. Triggered on first use of the class (first `new`, first static method call, first static field access for a non-constant, etc.).

`<clinit>` runs **once**, holding a class-init monitor. It's why a circular dependency between two classes' static initializers can deadlock.

`Class.forName("X")` triggers initialization by default; `Class.forName("X", false, loader)` does not. `MyClass.class` does *not* initialize.

You can observe the boundary with `-Xlog:class+load` (formerly `-verbose:class`) and `-Xlog:class+init`.

---

## 7. Allocation paths: TLAB, eden, and the slow case

HotSpot's allocation path:

1. The thread's TLAB has space → bump-pointer write the size into `top`. ~5 ns.
2. TLAB is full → request a new TLAB from eden. If eden has space, this is a few hundred ns.
3. Eden is full → minor GC, then retry. At this point you've seen a "young GC pause" event.
4. Object too large for TLAB (`-XX:TLABSize` and adaptive sizing decide) → allocate directly in eden.
5. Object too large for any region (G1 humongous threshold = half a region) → allocated directly in old generation.

Knobs and observables:

- `-XX:+UseTLAB` (default on), `-XX:TLABSize`, `-XX:ResizeTLAB`.
- `jcmd <pid> GC.heap_info` shows TLAB stats and eden/survivor sizes.
- JFR records `jdk.ObjectAllocationInNewTLAB` and `jdk.ObjectAllocationOutsideTLAB`. The latter is rare and usually points at oversized objects (huge arrays, large strings) you should investigate.

The mantra: **young GC is cheap, dying young is the goal**. An object that survives one collection gets copied. Surviving more collections costs more. `-XX:MaxTenuringThreshold` and survivor-space tuning rarely beat fixing the allocation pattern.

---

## 8. Escape analysis and scalar replacement

C2 (and now Graal) can prove an object never escapes its method:

```java
public int distance(int x, int y) {
    Point p = new Point(x, y);             // never escapes
    return Math.abs(p.x()) + Math.abs(p.y());
}
```

When this proof succeeds, **the allocation is elided**. Instead of constructing a `Point` on the heap, the JIT puts `x` and `y` directly into registers/stack slots — *scalar replacement*. The object effectively never existed.

Conditions for scalar replacement:

- The object reference doesn't leak (no return, no field store, no method call that could leak).
- The object's class is statically known.
- All field reads/writes can be replaced by local-variable access.
- The object isn't synchronized on (lock-elision is a related but separate optimization).

Inspect with `-XX:+PrintEscapeAnalysis -XX:+PrintEliminateAllocations` (debug JVM) or via JITWatch / async-profiler's allocation profiling. In production, the simplest signal is "GC pressure dropped after I refactored to keep these tuples local."

Practical guidance:

- Small temporary value objects (`Pair`, `Range`, `Optional`) are usually scalar-replaced when used inline.
- Objects passed to `System.out.println`, virtual method calls of unknown impl, or stored anywhere typically fail the escape analysis and *do* allocate.
- Aggressive use of `record` for short-lived parameter objects gets you the readability win without paying GC.

---

## 9. JIT inlining and class hierarchy analysis

Hot methods (typically invoked >10 000 times) get JIT-compiled. The compiler tries to inline:

1. Final / static / private methods → direct invoke, easily inlined.
2. Virtual methods → if **CHA (Class Hierarchy Analysis)** can prove only one implementation is loaded, the JIT inlines speculatively and installs a *dependency* — if a new subclass appears later, the compiled code is invalidated and recompiled.
3. Megamorphic call sites (3+ different receiver types) → inline cache promoted to a vtable lookup; usually not inlined.

Limits and knobs:

- `-XX:MaxInlineLevel` (default 9), `-XX:MaxInlineSize` (default 35 bytes), `-XX:FreqInlineSize` (325 bytes for hot methods).
- `-XX:+PrintInlining` (with `-XX:+UnlockDiagnosticVMOptions`) shows what was and wasn't inlined and *why*.

This is why `final` methods can occasionally be marginally faster: not because of dispatch cost, but because the JIT decides faster, without depending on CHA invalidation.

`@HotSpotIntrinsicCandidate` (now `@IntrinsicCandidate` in JDK 16+) marks methods like `Math.abs`, `String.indexOf`, `Object.hashCode` for hand-tuned native intrinsics — these don't go through normal inlining at all.

---

## 10. Garbage collection's view of an object

Each modern GC (G1, ZGC, Shenandoah, Parallel, Serial) sees objects through:

- **The header**: GC age (number of minor GCs survived), forwarding pointer slot during copying GCs, mark bit during marking.
- **The reference fields**: the object's *outgoing references* (oops). The GC traces these to mark reachable objects.

Phases (roughly):

1. **Mark**: walk from roots (thread stacks, statics, JNI handles) through reference fields, marking reachable objects.
2. **Copy / compact / sweep**: move live objects (G1 / ZGC / Shenandoah / Parallel young) or sweep dead ones (CMS — removed in 14 — and old phases of others).
3. **Update references**: rewrite pointers in surviving objects so they point at the new locations.

ZGC and Shenandoah use **load barriers** (a small extra instruction before each reference load) to do this concurrently with running threads, achieving sub-ms pauses regardless of heap size. The cost is a few percent throughput overhead — usually a great trade.

For class design, three takeaways:

- **Fewer fields = fewer references to trace = cheaper GC**. Records with two fields are cheaper to mark than records with eight.
- **Long reference chains** (linked lists, deeply nested structures) are GC-unfriendly. Flat arrays of primitive-shaped data are GC-friendly.
- **Soft, weak, and phantom references** add metadata to the GC's job. Use them sparingly and only when you know the lifecycle.

---

## 11. Project Valhalla: value classes and the future of objects

Java's "every object has identity" rule is the source of significant overhead:

- 12-byte header per object.
- Every field that holds a `Long` is a pointer (4–8 bytes) to another 16-byte heap object containing 8 bytes of payload.
- `==` and locking work because identity exists; if you don't need them, you're paying for nothing.

**Project Valhalla** (JEP 401, in preview as of recent JDKs) introduces *value classes*:

```java
value class ComplexNumber {
    private final double real;
    private final double imag;
    public ComplexNumber(double r, double i) { real = r; imag = i; }
    public ComplexNumber plus(ComplexNumber o) {
        return new ComplexNumber(real + o.real, imag + o.imag);
    }
}
```

Properties:

- **No identity.** `==` compares fields. No `synchronized(c)`. No `System.identityHashCode` distinct from the field-derived one.
- **Flat layout.** A `ComplexNumber[]` is a contiguous array of `(double, double)` pairs — no header per element, no pointer indirection.
- **Boxed only when needed.** `List<ComplexNumber>` still boxes (until generics specialization lands), but a primitive view of value classes (`int!`, `Long!`, etc.) is on the roadmap.

Once Valhalla ships in stable form, much of today's Object-pooling / off-heap acrobatics will become unnecessary. Today's design rule — "values should be `final` classes with all-`final` fields" — is exactly the shape that will translate to value classes with one annotation change.

---

## 12. Reflection and the metadata model

Every loaded class has a `Class<?>` instance. From it you can reach the entire metadata graph:

```java
Class<Money> c = Money.class;
c.getDeclaredFields();              // Field[]
c.getDeclaredConstructors();        // Constructor<?>[]
c.getDeclaredMethods();             // Method[]
c.getNestHost();                    // class declaring the nest
c.getRecordComponents();            // RecordComponent[] (records only)
c.getPermittedSubclasses();         // sealed hierarchy
```

Behind the scenes:

- These objects are lazily built from the class file's tables. Reflection has a per-call cost the first time, then caches.
- `Method.invoke` historically used a JNI call; modern HotSpot generates a bytecode adapter (`MethodAccessor`) after the first 15 invocations, making reflection only ~2–3× slower than a direct call.
- `MethodHandle` (java.lang.invoke) is the JIT-friendly alternative — it can be JIT-compiled into the call site like a normal method and is the implementation underpinning lambdas.
- `VarHandle` (Java 9+) extends this to memory access, replacing most uses of `sun.misc.Unsafe`.

For frameworks (Jackson, Hibernate, Spring), the move from `Reflection.invoke` to `MethodHandle` was a measurable startup and steady-state win.

---

## 13. Hidden classes and class-data sharing

Two modern features that affect class lifecycle:

- **Hidden classes** (JEP 371, Java 15+) are classes the JVM defines without a name in any class loader. Lambdas, MethodHandle proxies, and tools like `byte-buddy` use them. They can be unloaded with a `MethodHandles.Lookup`-defined cleaner, fixing the metaspace leak that plagued earlier dynamic-class systems.
- **Class Data Sharing** (CDS, AppCDS — JEP 310) lets the JVM mmap pre-loaded class metadata at startup, skipping verification and partial linking. This is why `--enable-cds-archive` and `-XX:ArchiveClassesAtExit` can shave 50–80% off cold-start time on JVMs with thousands of classes (Spring Boot, Quarkus).

Both are operationally invisible most of the time — but if you're debugging "where did this class come from" or "why is metaspace growing forever," they belong on your radar.

---

## 14. Memory model touchpoints from class design

The Java Memory Model's interaction with object construction:

- **`final` field semantics** (JLS §17.5): if a constructor does not let `this` escape, any thread that observes the constructed reference is guaranteed to see all `final` fields *fully initialized*. This is the cornerstone of safe immutable publication.
- **Non-`final` fields, no synchronization**: another thread might see your fields at default values (zero, null) even after the constructor has completed. This is why **safe publication** matters — store the new reference into a `volatile` field, an `Atomic*`, a `synchronized` block, or a thread-safe collection.
- **Constructor leaking `this`** (e.g., registering with an event bus inside the ctor) is a memory-model trap: another thread could see fields at default values mid-construction.

Practical: keep constructors short, set every field, don't leak `this`, and either keep the class immutable or use safe publication.

---

## 15. Tools you should know

| Tool                          | What it shows                                     |
|-------------------------------|---------------------------------------------------|
| `javap -v -p`                 | Bytecode + constant pool                          |
| JOL (`org.openjdk.jol:jol-cli`) | Object layout, header, padding                  |
| `jcmd <pid> GC.heap_info`     | TLAB / eden / old gen sizes                       |
| `jcmd <pid> Class.histogram`  | Live object counts per class                       |
| Java Flight Recorder (JFR)     | Allocation, GC, lock contention, class load events |
| `async-profiler`              | CPU/alloc/lock flame graphs with low overhead     |
| JITWatch                      | Inlining decisions, IR dumps                       |
| `-Xlog:class+load,class+init,gc*` | Class loading and GC events                  |
| `-XX:+PrintInlining`          | Per-call inlining outcome (with diagnostic flag)  |
| `-XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly` | Compiled assembly (needs hsdis plugin) |

You don't need to use these daily, but knowing they exist is the difference between guessing about object cost and measuring it.

---

## 16. The professional checklist

For any class on a hot path:

1. What's its instance size with JOL?
2. Does the JIT scalar-replace it where used? (Run with `-XX:+PrintEliminateAllocations` to confirm.)
3. Does it inflate to a monitor under contention? (JFR `jdk.JavaMonitorEnter` events.)
4. Is its class init expensive or circular? (`-Xlog:class+init`.)
5. Does it survive young GC unnecessarily? (JFR allocation profiling + survivor counts.)
6. Are its `equals`/`hashCode` hot? Are they inlined? (`-XX:+PrintInlining`.)
7. Could a record / value class (Valhalla) replace it once the platform allows?
8. Are reflection-based frameworks routing through `MethodHandle` for it?

Professional class design is not premature optimization — it's *informed* design. You measure, then choose.
