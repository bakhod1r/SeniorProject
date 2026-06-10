# Attributes and Methods — Professional (Under the Hood)

> **What's actually happening?** Each field becomes an entry in the class file's `field_info` table with a JVM type descriptor; each method becomes a `method_info` with a Code attribute holding bytecode plus stack maps. At runtime, instance fields live at fixed offsets in the object, statics live in the `Class` mirror's metadata, and methods are invoked through one of five JVM dispatch instructions whose performance characteristics, inlining behavior, and JIT specialization are the foundation of "Java is fast."

---

## 1. How `javac` represents fields

A `field_info` in the class file (JVMS §4.5):

```
field_info {
    u2             access_flags;      // PUBLIC, PRIVATE, STATIC, FINAL, VOLATILE, TRANSIENT, ...
    u2             name_index;        // -> CONSTANT_Utf8 in constant pool
    u2             descriptor_index;  // -> CONSTANT_Utf8 ("I" for int, "Ljava/lang/String;" for String)
    u2             attributes_count;
    attribute_info attributes[...];   // ConstantValue, Signature, Synthetic, Deprecated, ...
}
```

The descriptor encodes the type:

| Java type            | Descriptor                  |
|----------------------|-----------------------------|
| `byte`               | `B`                         |
| `short`              | `S`                         |
| `int`                | `I`                         |
| `long`               | `J`                         |
| `float`              | `F`                         |
| `double`             | `D`                         |
| `char`               | `C`                         |
| `boolean`            | `Z`                         |
| reference (e.g. `String`) | `Ljava/lang/String;`   |
| `int[]`              | `[I`                        |
| `String[]`           | `[Ljava/lang/String;`       |

Generic information is *erased* from descriptors; you'll find `List` not `List<String>`. The compile-time generic info, if needed (reflection, javadoc), is stored in the `Signature` attribute.

You can see all this with:

```
$ javap -v -p MyClass.class
```

The output begins with the constant pool, then lists each field's flags, descriptor, and attributes verbatim.

---

## 2. Field offsets — where the data actually sits

HotSpot computes a *field layout* once per class at link time and stores offsets in the `InstanceKlass`. Layout strategy (default `FieldsAllocationStyle=2`):

1. Place double/long-aligned fields first.
2. Then int/float-sized.
3. Then short/char.
4. Then byte/boolean.
5. References last (4 bytes compressed, 8 otherwise).

So a class declared:

```java
class Mixed {
    boolean flag;
    int     id;
    long    timestamp;
    String  name;
}
```

…ends up laid out (with header):

```
offset  size  field
   0    12    object header (mark word + compressed klass pointer)
  16     8    timestamp
  24     4    id
  28     4    name (compressed reference)
  32     1    flag
  33     7    padding
                                                   total: 40 bytes
```

The compiler places `timestamp` at offset 16, not at the declared position — ordering in source has **no effect** on layout (HotSpot ignores it). Tools to confirm:

- **JOL** (`org.openjdk.jol:jol-cli`) — `ClassLayout.parseClass(Mixed.class).toPrintable()`.
- `Unsafe.objectFieldOffset(field)` — returns the runtime offset of a field for low-level access.
- `VarHandle` — modern, JIT-friendly equivalent of `Unsafe` for typed access.

Static fields don't live in instances. They live in the `Class<?>` mirror's data area in the JVM (specifically, attached to the `InstanceKlass` in metaspace). Their offsets are also computed at link time and accessible via `Unsafe.staticFieldOffset()`.

---

## 3. Reading and writing a field — the bytecode

```java
public int getCount() { return count; }
```

compiles to:

```
0: aload_0          ; push `this`
1: getfield #2      ; field BankAccount.count:I
4: ireturn
```

`getfield`/`putfield` (instance) and `getstatic`/`putstatic` (static) are the four field-access instructions (JVMS §6.5). They take a constant-pool index referencing a `CONSTANT_Fieldref` entry, which the JVM resolves to a *direct* offset on first use.

`volatile` fields use the same instructions but with a JMM-ordered access path. The JIT generates appropriate memory fences (LoadLoad/LoadStore on read, StoreStore/StoreLoad on write) on x86-TSO this is mostly free for reads but adds a `mfence`/`xchg` on writes.

`final` instance fields carry a special verifier rule: only `<init>` (and any constructor of the same class) may write them. After the constructor returns, no `putfield` to a `final` field is legal — the verifier rejects the class.

---

## 4. Method representation

`method_info` (JVMS §4.6):

```
method_info {
    u2             access_flags;       // PUBLIC, PRIVATE, STATIC, FINAL, ABSTRACT, NATIVE, SYNCHRONIZED, BRIDGE, VARARGS, ...
    u2             name_index;
    u2             descriptor_index;   // method descriptor, e.g. "(IJ)Ljava/lang/String;"
    u2             attributes_count;
    attribute_info attributes[...];    // Code, Exceptions, MethodParameters, Signature, ...
}
```

A method descriptor is `(arg_descriptors)return_descriptor`. Examples:

| Java method                                | Descriptor                      |
|--------------------------------------------|---------------------------------|
| `void foo()`                               | `()V`                           |
| `int add(int, int)`                        | `(II)I`                         |
| `String toUpperCase(Locale)`               | `(Ljava/util/Locale;)Ljava/lang/String;` |
| `long[] parse(String)`                     | `(Ljava/lang/String;)[J`        |

Inside a method's `Code` attribute:

- `max_stack`, `max_locals` — the verifier-checked sizes.
- `code[]` — the bytecode instructions.
- `exception_table` — try/catch ranges.
- attributes: `LineNumberTable`, `LocalVariableTable`, `StackMapTable`.

The `StackMapTable` is mandatory since Java 7. It records the verifier's expected types at every branch target. The verifier no longer simulates the entire method — it just checks each frame against the recorded map. This made class loading roughly 5× faster.

---

## 5. The five method invocation bytecodes

JVMS §6.5 defines five opcodes:

| Opcode             | Used for                                             |
|--------------------|------------------------------------------------------|
| `invokestatic`     | `static` methods                                     |
| `invokespecial`    | `<init>`, `private`, `super.foo()` invocations       |
| `invokevirtual`    | Non-`final` instance methods on classes              |
| `invokeinterface`  | Interface methods (also non-`private`)               |
| `invokedynamic`    | Lambdas, string concat, pattern dispatch (since 7+)  |

Performance characteristics:

- **`invokestatic` / `invokespecial`**: direct call. Cheapest. The JIT inlines them readily (bounded only by inlining heuristics).
- **`invokevirtual`**: vtable lookup. Each class has a virtual method table; the call site's `vtable[index]` resolves to the actual function. With CHA proving a single implementation, the JIT inlines as if direct. With 2–3 implementations, an inline cache is used (~2 indirect jumps). With more, it falls back to the vtable lookup (~3–4 ns per call before the actual method runs).
- **`invokeinterface`**: itable lookup. More complex than vtable because interfaces don't form a single inheritance line; HotSpot uses a per-class itable that maps interface methods to implementation methods. Inline caches make typical calls almost as fast as `invokevirtual`.
- **`invokedynamic`**: bootstrap method runs once and produces a `CallSite` (often a `ConstantCallSite` pointing at a `MethodHandle`). After that, the call is essentially direct.

---

## 6. Vtables, itables, and inline caches

When `Klass` is initialized, HotSpot builds:

- A **vtable**: contiguous array of method pointers, indexed by method index. Inherited methods occupy the same slot in subclasses; overridden methods replace the slot. Slot 0 is conventionally `Object#hashCode`, etc.
- One **itable per implemented interface**: maps interface method to actual implementation. Looked up at call time by linear scan over the small itable index.

At each polymorphic call site, the JIT installs an *inline cache* (IC):

- **Monomorphic IC**: assumes one receiver class. Caches `(klass, target)`. If the receiver matches, jump to target. ~1 ns. If it misses, recompile.
- **Polymorphic IC** (PIC): caches up to 2–3 entries.
- **Megamorphic**: gives up the IC and falls back to vtable/itable lookup at every call.

You can observe this with `-XX:+PrintCompilation -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`. Megamorphic call sites tend to dominate "why is my reflective code slow?" investigations.

---

## 7. JIT inlining decisions

HotSpot's C2 (and Graal) inlines methods up to certain size limits (in bytecode bytes):

| Flag                    | Default | Meaning                                           |
|-------------------------|---------|---------------------------------------------------|
| `MaxInlineSize`         | 35      | Max size for non-hot methods                      |
| `FreqInlineSize`        | 325     | Max size for hot methods (>1% of CPU)              |
| `MaxInlineLevel`        | 9       | Max recursion depth of inlining                    |
| `InlineSmallCode`       | 1000    | Don't inline if the JIT's compiled output exceeds this |
| `MinInliningThreshold`  | 250     | Method must be invoked this many times             |

You can dump per-call decisions with:

```
-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining
```

Output snippets like:

```
@ 4   java.util.Optional::isPresent (10 bytes)   inline (hot)
@ 13  java.util.Optional::get (16 bytes)         too big
```

Reading these is how you debug "the JIT isn't optimizing my code" claims. Methods that are too big, megamorphic, or `synchronized` are the usual culprits.

`@HotSpotIntrinsicCandidate` (JDK ≤ 15) / `@IntrinsicCandidate` (JDK 16+) marks methods that have hand-written native intrinsics: `Math.abs`, `String.indexOf`, `Atomic*` operations, `Object.hashCode` (for default identity hash), `System.arraycopy`. The JIT replaces calls with optimized native sequences.

---

## 8. Bridge methods, synthetic methods, and erasure

Generic methods and covariant return types produce *bridge methods* during compilation:

```java
class Box<T> {
    T value;
    public T get() { return value; }
}

class IntBox extends Box<Integer> {
    @Override public Integer get() { return value; }
}
```

Compiled `IntBox`:

```
public java.lang.Integer get();         // your method
public synthetic bridge java.lang.Object get();   // bridges to Box.get()
   0: aload_0
   1: invokevirtual #4   // get:()Ljava/lang/Integer;
   4: areturn
```

The bridge exists so that `Box<?> b = new IntBox(); b.get();` (which calls `Box.get` returning `Object`) resolves correctly. You see them in `javap` flagged as `ACC_BRIDGE | ACC_SYNTHETIC`.

Other synthetic methods:

- **Inner-class accessors** (pre-JDK 11): `access$000`, etc., for cross-class private access. Replaced by *nest mates* in Java 11+ (JEP 181) — same-nest classes can directly access each other's private members at the JVM level.
- **Lambda factories**: synthetic static methods named like `lambda$foo$0` containing the lambda body.
- **Switch statement helpers** for enum/string switches.

Any time you read bytecode and see a method you didn't write, it's compiler-generated to bridge a language abstraction to JVM reality.

---

## 9. Default methods and interface evolution

Java 8 introduced *default methods* on interfaces:

```java
public interface Sized {
    int size();
    default boolean isEmpty() { return size() == 0; }
}
```

At the JVM level:

- Interface methods used to be abstract only; now an interface's `method_info` may have a Code attribute.
- `invokeinterface` finds the method as before; if not implemented in the class, it walks supertypes including interfaces, picking the *most specific* default.
- Diamond conflict (two interfaces with the same default) → compile error, must override.

Performance: default methods dispatch the same as interface methods. The JIT inlines them given a monomorphic call site. They're a *language* feature for evolution, not a performance hint.

`private` interface methods (Java 9+) live in the interface and aren't dispatched virtually — they're like helpers for the interface's own defaults.

---

## 10. `MethodHandle` and `VarHandle`

The modern, JIT-friendly reflection alternatives.

**`MethodHandle`** (Java 7+, refined throughout):

```java
MethodHandle mh = MethodHandles.lookup()
    .findVirtual(String.class, "length", MethodType.methodType(int.class));
int n = (int) mh.invoke("hello");      // type-checked at handle creation
```

A `MethodHandle` is essentially a function pointer with type info. The JIT compiles the call site as if you'd written the call directly. This is what `LambdaMetafactory` uses behind every lambda.

**`VarHandle`** (Java 9+):

```java
VarHandle COUNT = MethodHandles.lookup()
    .findVarHandle(Counter.class, "count", int.class);

COUNT.compareAndSet(this, 0, 1);
COUNT.getAndAddRelease(this, 1);
```

VarHandle replaces `sun.misc.Unsafe` for memory-ordered field access. It supports the full JMM access modes: `getOpaque`, `getAcquire`, `getVolatile`, plus atomic CAS, fetch-and-add, etc. The implementation is intrinsic — `compareAndSet` becomes a single CMPXCHG on x86.

These two together cover ~99% of low-level reflection needs. Use them in framework/library code rather than `java.lang.reflect.Method.invoke`.

---

## 11. `synchronized` methods at the JVM level

```java
public synchronized void deposit(long cents) { balance += cents; }
```

`synchronized` methods set the `ACC_SYNCHRONIZED` flag in the method's access flags. The JVM treats this as an implicit `monitorenter` on `this` (or the `Class` for static methods) at method entry, and `monitorexit` on every exit path.

For instance methods, this is equivalent to `synchronized(this) { ... }` in the body. There's no measurable bytecode size difference, but the implicit form is sometimes slightly easier for the JIT to optimize (no extra `aload` + `monitorenter` instructions).

Modern HotSpot's locking path:

1. **Lightweight locking**: CAS the mark word of the receiver to point at a stack-allocated lock record. ~10 ns uncontested.
2. **Lock inflation** (under contention): the lock is upgraded to a heavyweight `ObjectMonitor` allocated in C++ heap. Subsequent acquires use OS-level park/unpark.
3. **Biased locking**: removed in JDK 15+ (JEP 374). Used to be even cheaper for single-thread case but added too much complexity.

Note: `synchronized` is *re-entrant* — the same thread can acquire the same monitor multiple times. The mark word stores a counter for nested acquires.

---

## 12. Native methods

```java
public native int read();
```

Native methods carry the `ACC_NATIVE` flag and have no Code attribute — the body is provided by linked native code (JNI). At the call site, the JVM invokes a native stub via `invokestatic`/`invokespecial`/`invokevirtual` like any other.

The cost of crossing the JNI boundary is ~10–100 ns per call (argument marshaling, GC root tracking). Avoid native for hot inner loops; use it for I/O, OS integration, or large batch operations where the per-call cost is amortized.

JNI's successor — the **Foreign Function & Memory API** (JEP 442, finalized) — provides a memory-safer, often faster alternative for calling native libraries via `MethodHandle`s.

---

## 13. The Reflection cost curve

Reflection's runtime cost over time:

1. **First call**: Field/Method object construction, security check, JNI call (~1–10 µs).
2. **Hot path (>15 invocations)**: `MethodAccessor` is generated as bytecode — a synthetic class containing direct method calls. Subsequent calls are within ~3× of direct (~10–30 ns).
3. **`MethodHandle.invoke`**: JIT-compiles the call site as if you'd written the call directly. ~5 ns, indistinguishable from `invokevirtual`.

Frameworks that move from `Method.invoke` to `MethodHandle` typically show 5–10% steady-state speedups on reflection-heavy paths.

`-Dsun.reflect.inflationThreshold=0` forces immediate bytecode-accessor generation (skipping the JNI phase) — useful for benchmarks but not generally needed.

---

## 14. Field and method access in record classes

```java
public record Point(int x, int y) {}
```

The record's `class` file:

- `final` class.
- Two `private final` fields: `x`, `y`.
- One canonical constructor: `<init>(II)V`.
- Two accessor methods: `x()I`, `y()I`.
- Synthesized `equals(Object)`, `hashCode()`, `toString()` that use `invokedynamic` referring to the runtime helper `java.lang.runtime.ObjectMethods.bootstrap`.

The `invokedynamic`-based `equals`/`hashCode`/`toString` lets the JVM emit a single shared bootstrap function that handles all records, with the JIT specializing per record class. This is why record `equals` is typically faster than hand-written equals — the JIT sees the entire shape and optimizes accordingly.

---

## 15. Tools you should know

| Tool                                       | What it shows                              |
|--------------------------------------------|--------------------------------------------|
| `javap -v -p`                              | Bytecode + descriptors                      |
| `javap -p -s -c`                           | Brief: signatures + bytecode                |
| JOL                                        | Field offsets, padding                      |
| `jcmd <pid> Compiler.codelist`             | All compiled methods                        |
| `-XX:+PrintInlining`                       | Inlining decisions per call                 |
| `-XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly` | Compiled assembly (needs hsdis plugin) |
| `async-profiler -e cpu`                    | CPU flame graph by method                   |
| `async-profiler -e alloc`                  | Allocation flame graph                      |
| JITWatch                                   | Visual inlining / IR analysis               |
| JFR `jdk.MethodSample` events              | Method-level sampling                       |
| `VarHandle` / `MethodHandle.lookup().findVarHandle` | Low-level field access without `Unsafe` |

You don't reach for these daily. But knowing they exist is the difference between *guessing* about field/method cost and *measuring* it.

---

## 16. Professional checklist

For each public method or field on a hot path:

1. What's the descriptor? Any unintended boxing?
2. Where does the field live? Is the offset known? Is the access volatile?
3. Which `invoke*` opcode does the call use? Will it inline?
4. Is the method `final` / monomorphic, polymorphic, or megamorphic?
5. Has the JIT compiled it? `-XX:+PrintCompilation` to confirm.
6. Is allocation needed for the call? `Object[]` for varargs, autoboxing, captures?
7. Is the field `volatile`? Does it need to be?
8. If `synchronized`, is the contention level acceptable?
9. Could a `MethodHandle` or `VarHandle` replace reflection here?
10. Does a record / value class shape this better?

Professional method design is informed by what the JVM actually does — not folklore. Every line in a hot method should map, in your head, to a small number of machine instructions.
