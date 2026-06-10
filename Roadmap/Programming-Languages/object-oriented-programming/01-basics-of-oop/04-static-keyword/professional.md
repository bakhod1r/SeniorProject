# Static Keyword — Professional (Under the Hood)

> **What's actually happening?** Static fields live in a per-class data area allocated by the JVM in metaspace; static methods are dispatched via `invokestatic` (a direct call); class initialization runs `<clinit>` exactly once under a class-init lock; compile-time constants are inlined by `javac`; static initialization order, JMM guarantees, and class loading interact in subtle ways that explain most "why is this static field acting weird?" mysteries.

---

## 1. Where static fields actually live

In HotSpot, every loaded class has an `InstanceKlass` structure in **metaspace** (a native-memory area, not the heap). Attached to the `InstanceKlass` is a *static field area* — a contiguous block of memory holding all the class's static fields.

```
InstanceKlass for com.example.MyClass
├── metadata (constant pool, method tables, etc.)
└── static field area
    ├── offset 0: static field A
    ├── offset 8: static field B
    └── ...
```

Reading a static field with `getstatic` resolves (once) to the offset, then performs a load from `static_field_area + offset`. Writing with `putstatic` is the same with a store.

Two consequences:

1. **Static fields are not on the GC-managed heap.** They're in metaspace. Their *contents* (object references) point to the heap; the GC roots include all references in the static field area.
2. **Class unloading frees static state.** When a class loader becomes unreachable and its classes are unloaded, the metaspace memory (including the static field area) is reclaimed.

You can monitor metaspace with:
```
-XX:+PrintGCDetails -Xlog:gc+metaspace=info
jcmd <pid> VM.metaspace
```

---

## 2. Static fields and the GC roots

The garbage collector treats every reference field in a class's static area as a *root*. So a static `Map<...>` keeps its entries alive forever (or until someone clears the map), even if nobody else references those entries.

This is the classic "static cache memory leak":

```java
public class Cache {
    private static final Map<String, Object> cache = new HashMap<>();
    public static void put(String k, Object v) { cache.put(k, v); }
}
```

Every entry put into this cache is reachable from the GC roots (via `Cache.class` → static field → map → entry). The objects never become eligible for collection unless explicitly removed.

Solutions:

- `WeakHashMap` — entries become eligible when the *key* has no other references.
- Manual eviction (LRU, time-based).
- Bounded caches like Caffeine.
- Don't use a static cache at all — use a DI-managed instance.

`-Xlog:gc=trace` and heap dumps (`jmap -dump`) reveal these leaks. Look for any class whose static fields hold large collections.

---

## 3. The `<clinit>` method

When the compiler sees:

```java
public class Constants {
    public static int A = compute();
    public static int B = 10;
    static {
        System.out.println("init");
        A = A + B;
    }
}
```

It synthesizes a method named `<clinit>` (read "class init") containing all static initializer code, in source order:

```
static <clinit>()V
    invokestatic compute()I
    putstatic    A
    bipush       10
    putstatic    B
    ldc          "init"
    invokestatic println(...)
    getstatic    A
    getstatic    B
    iadd
    putstatic    A
    return
```

The JVM ensures `<clinit>` runs **exactly once** per class loader, under a per-class init lock (JLS §12.4.2).

You don't write `<clinit>` directly. The compiler emits it from your `static` field initializers and `static {}` blocks.

---

## 4. Class initialization triggers (precisely)

Per JLS §12.4.1, initialization is triggered by:

1. `new Foo()` — instantiation.
2. Static method invocation on `Foo`.
3. Static field assignment or read of a non-`final` static field.
4. `Class.forName("Foo")` (default `initialize=true`).
5. Initialization of a subclass of `Foo` (parent must initialize first).
6. Designation as the `main` class at JVM startup.

**Not triggered** by:

- Reading a `static final` *constant expression* (the value is inlined; the class is not initialized).
- `Foo.class` (just gets the `Class<?>` mirror).
- `Class.forName("Foo", false, loader)`.
- An array creation: `new Foo[10]` does not initialize `Foo`.

This explains most "why didn't my static block run?" mysteries.

---

## 5. The class init lock and deadlocks

Per JVMS §5.5, the JVM holds a per-class init lock during `<clinit>` execution:

```
acquire init lock for C
if C is fully initialized, release and return
if C is being initialized by current thread, release (recursive entry)
mark C as in-progress
release init lock

run <clinit>

acquire init lock
mark C as fully initialized
notifyAll waiters
release lock
```

If two classes A and B have static initializers that depend on each other, and two threads simultaneously trigger initialization of A and B, you get a deadlock — each thread holds one init lock and waits for the other.

Diagnose with `jstack` — look for two threads in `Class init` state, each waiting for a different class.

The fix is to break the dependency: compute everything from one class, or use lazy holder idioms, or defer the cross-class read to a method call.

---

## 6. Compile-time constant inlining

A `static final` field whose initializer is a compile-time constant expression (JLS §15.28) is treated specially by `javac`:

```java
public class Limits {
    public static final int MAX = 100;
}

// Consumer:
if (count > Limits.MAX) ...
```

The consumer's bytecode does **not** contain a `getstatic Limits.MAX`. Instead, `javac` inlines the value:

```
bipush 100
if_icmple ...
```

Properties of compile-time constants:

- Type must be primitive or `String`.
- Initializer must be a constant expression (literals, other compile-time constants, narrowed/widened arithmetic).
- The `static final` field is still emitted in `Limits`'s class file, with a `ConstantValue` attribute.

Implications:

- The consuming class file holds the literal `100`. If `Limits` is recompiled with `MAX = 200`, consumers still see `100` until rebuilt.
- `static final` arrays/Lists are *not* compile-time constants (their initializers aren't constant expressions). So `static final int[] PRIMES = {2, 3, 5}` is a regular static field and is *not* inlined.
- Reading an inlined constant does *not* trigger class initialization. (See §4.)

For library APIs, decide: do you want recompile-on-change semantics? If yes, leave constants `static final`. If no, expose values via a method (`public static int max()` { return 100; }`).

---

## 7. `invokestatic` — the cheapest call

Static methods are dispatched via `invokestatic`. The bytecode resolves once to a direct method address; subsequent calls jump straight to it.

Compared to instance dispatch:

| Bytecode         | Resolution                                  | Inlining ease            |
|------------------|---------------------------------------------|--------------------------|
| `invokestatic`   | Direct                                       | Easiest — no receiver     |
| `invokespecial`  | Direct (private/super/init)                 | Easy                      |
| `invokevirtual`  | Vtable lookup                                | Easy if monomorphic       |
| `invokeinterface`| Itable lookup                                | Easy if monomorphic       |
| `invokedynamic`  | Bootstrap + CallSite                         | Easy after bootstrap      |

For hot paths, `invokestatic` is the most JIT-friendly. The body is inlined unless it exceeds size limits (`MaxInlineSize` = 35, `FreqInlineSize` = 325).

Practical: a `static` helper called inside a tight loop almost always inlines completely. The JIT result is the same as if you wrote the body directly at the call site.

---

## 8. JMM and static fields

Static fields obey the same JMM rules as instance fields:

- `volatile static`: each read/write establishes happens-before with the same field.
- `static final`: the JLS §17.5 freeze rule applies — *if* the class's `<clinit>` finishes without leaking the class reference, then any thread that observes the class as initialized sees fully-initialized `static final` fields.
- Plain `static` fields: no cross-thread visibility guarantee without synchronization.

The "without leaking" qualification is rarely an issue for statics because the class reference is implicit in every access — you can't easily "publish" a class. But you can publish *the values* the static fields hold; if those values are mutable and shared, normal JMM rules apply.

A subtle case: another thread observing a class *during* `<clinit>` execution. If thread T1 is initializing class A, and thread T2 then triggers initialization of A, T2 blocks on the init lock until T1 finishes. The blocking provides happens-before: T2 sees everything T1 wrote during `<clinit>`.

---

## 9. Lazy holder idiom — JMM perspective

```java
public class Config {
    private Config() { /* expensive */ }

    private static class Holder {
        static final Config INSTANCE = new Config();
    }

    public static Config getInstance() { return Holder.INSTANCE; }
}
```

This pattern works because:

- `Holder` is not initialized until first use of `Holder.INSTANCE`.
- The first `getInstance()` call triggers initialization of `Holder`, which runs the `static final INSTANCE = new Config()` initializer.
- The class init lock + the JLS §17.5 freeze rule guarantee that subsequent threads see the fully-initialized `Config`.

No synchronization, no double-checked locking complexity. The JVM does the lazy + thread-safe work via class loading.

The holder class adds essentially zero cost — it's metadata in metaspace; it only initializes when first touched.

---

## 10. Static methods and reflection

`Method.invoke` works the same for static and instance methods. For static, pass `null` as the receiver:

```java
Method m = Math.class.getDeclaredMethod("max", int.class, int.class);
int result = (int) m.invoke(null, 3, 5);   // null because static
```

Performance: as with instance methods, reflection has a per-call overhead (~µs first call, ~ns after warmup). For frameworks, prefer `MethodHandle`:

```java
MethodHandle max = MethodHandles.lookup()
    .findStatic(Math.class, "max", MethodType.methodType(int.class, int.class, int.class));
int result = (int) max.invoke(3, 5);
```

After warmup, the `MethodHandle` is essentially as fast as a direct `invokestatic`. The JIT compiles the call site as if you'd written the call directly.

`VarHandle` provides the same modernization for static field access, with memory-ordered operations:

```java
VarHandle COUNT = MethodHandles.lookup().findStaticVarHandle(MyClass.class, "count", int.class);
COUNT.getAndAdd(1);                     // atomic increment
COUNT.compareAndSet(0, 1);              // atomic CAS
```

---

## 11. Static fields and class file attributes

In the class file (JVMS §4.5), a static field's `field_info` has:

- `ACC_STATIC` bit set in `access_flags` (`0x0008`).
- A `ConstantValue` attribute if the field is `static final` and a compile-time constant. The JVM uses this attribute to initialize the field during class linking, *before* `<clinit>` runs.
- `ACC_FINAL` (`0x0010`) if final.

The order matters: `static final int MAX = 100;` causes:

1. JVM sees `ConstantValue` attribute → writes `100` to the field at link time.
2. `<clinit>` runs; for this field, it has nothing to do (the value is already set).

For a non-final static or a static final without a `ConstantValue` attribute (e.g., a method-call initializer):

1. Field is set to default during preparation.
2. `<clinit>` runs the initializer.

Inspect with `javap -v MyClass.class`. Look for `ConstantValue: int 100` next to a field.

---

## 12. The `assertion` mechanism uses static + class init

Java's `assert` statement is implemented via static fields:

```java
public class Foo {
    public void method() {
        assert x > 0 : "x must be positive";
    }
}
```

Compiles to roughly:

```java
public class Foo {
    static final boolean $assertionsDisabled = !Foo.class.desiredAssertionStatus();

    public void method() {
        if (!$assertionsDisabled && !(x > 0))
            throw new AssertionError("x must be positive");
    }
}
```

The `$assertionsDisabled` field is computed once, in `<clinit>`, by calling `desiredAssertionStatus()` (which returns whether assertions are enabled for that class via the `-ea` JVM flag).

If assertions are disabled (the default), the field is `true`; the JIT then constant-folds the `if (!$assertionsDisabled && ...)` check to `if (false && ...)` and eliminates the entire assertion code path. Cost in production: zero.

This is a beautiful example of static fields enabling zero-cost feature flags.

---

## 13. Static method handles, lambda metafactory, and `invokedynamic`

When you write a method reference to a static method:

```java
Function<Integer, Integer> doubler = Math::abs;       // method reference
```

The compiler emits an `invokedynamic` referring to `LambdaMetafactory.metafactory`. The first invocation runs the bootstrap, which produces a synthetic class implementing `Function` whose `apply` method calls `Math.abs(int)`. The synthetic class is then cached in a `ConstantCallSite`, so subsequent uses are direct.

For static method references, the synthetic class is essentially a thin shell calling `invokestatic`. The JIT fuses this with the call site and the static method body, producing inlined code with no allocation cost.

Same for static factory methods used as `Supplier`s, `IntSupplier`s, etc. — modern Java's functional layer is built on top of `invokedynamic` + static methods.

---

## 14. Hidden classes and static fields

Java 15's hidden classes (JEP 371) are dynamically generated classes that the JVM does not link to a name in any class loader. Lambda implementations and bytecode-rewriting tools (byte-buddy, ASM) use them.

Hidden classes can have static fields like any class. The lifecycle is bound to the `MethodHandles.Lookup` that defined them — once the lookup is unreachable, the hidden class can be unloaded, freeing its metaspace (including its static fields).

This is how lambdas avoid the metaspace leak that plagued earlier dynamic-class systems (cglib, javassist) — modern lambdas use hidden classes that the JVM can clean up.

---

## 15. Tools you should know

| Tool                                       | What it shows                                      |
|--------------------------------------------|----------------------------------------------------|
| `javap -v MyClass.class`                   | Static field flags, ConstantValue attributes, `<clinit>` bytecode |
| `-Xlog:class+init`                         | Class initialization events                        |
| `-Xlog:class+load`                         | Class loading                                      |
| `jcmd <pid> VM.metaspace`                  | Metaspace usage by class loader                    |
| `jcmd <pid> Class.histogram`                | Live object counts (helps spot static-cache leaks) |
| Heap dump + Eclipse MAT                    | "Static path to GC root" analysis                  |
| `-XX:+PrintInlining`                       | Confirm `static` methods are inlined               |
| `MethodHandles.lookup().findStaticVarHandle(...)` | Atomic / memory-ordered access to static fields |
| JFR `jdk.ClassInitialization` events       | Per-class init duration                            |

---

## 16. Professional checklist

For each `static` member on a hot path or in a long-lived service:

1. Does it have a `ConstantValue` attribute (compile-time inlining)? Confirm with `javap`.
2. If it's a static cache, what's the eviction policy? Heap dumps clean?
3. Is `<clinit>` for this class quick? `-Xlog:class+init` to time it.
4. Are there cross-class init dependencies? Check for cycles.
5. If invoked frequently: does the JIT inline it? `-XX:+PrintInlining`.
6. If concurrent: is the field `volatile`, `final`, or accessed via `VarHandle`?
7. If a singleton: is it the lazy holder idiom or hand-rolled?
8. If a constants class: are consumers required to recompile on change? Documented?
9. For framework code: `MethodHandle.findStatic` over `Method.invoke`?
10. For multi-classloader environments: does the static state correctly isolate per-loader?

Professional `static` use is rare and deliberate. The code that's still using it after senior review is genuinely class-scoped, runtime-cheap, JIT-friendly, and concurrency-safe — exactly the four properties `static` is supposed to deliver.
