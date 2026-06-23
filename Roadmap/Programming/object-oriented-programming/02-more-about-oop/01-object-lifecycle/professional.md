# Object Lifecycle — Professional

> **What?** Bytecode-level mechanics of `<clinit>` and `<init>`, the JVMS rules on class loading/linking/initialization, OopMaps and safepoints during construction, the formal Java Memory Model guarantees on `final` fields, the design of `Cleaner` and `PhantomReference` queues, and the upcoming changes in Project Valhalla and Lilliput.
> **How?** By reading the spec, disassembling with `javap -c -v -p`, and matching observed VM behavior to the rules.

---

## 1. JVMS §5.5 — class initialization

A class `C` is initialized **at most once** under the following triggers (lazy initialization):

1. The JVM executes a `new` for `C` (and `C` isn't yet initialized).
2. `getstatic` or `putstatic` for a non-`final` field of `C`.
3. `invokestatic` of a method declared in `C`.
4. `Class.forName("C")` (with the `initialize=true` default).
5. Initialization of a subclass of `C`.

Exempt: reading a `final static` constant of a primitive or `String` type — these are constant-folded at compile time and don't trigger init.

```java
class Counter {
    static int n = compute();
    static int compute() { System.out.println("init"); return 0; }
}
class Sub extends Counter {
    static int s = 1;
}

Sub.s;             // triggers Counter.<clinit>? Yes — initializing subclass triggers parent.
```

The spec uses a state machine: `LC_VERIFIED → LC_INITIALIZING → LC_INITIALIZED` (or `LC_ERRONEOUS`). Recursion into the same class's `<clinit>` from itself is allowed (returns immediately on the same thread). Recursion from another thread blocks until the first thread completes.

---

## 2. `<clinit>` is implicit and synthesized

You never write `<clinit>` yourself. The compiler synthesizes it from:

- All `static` field initializers (`static int x = 5;`)
- All `static { }` blocks

…in source order, and emits it as a method named `<clinit>` with descriptor `()V` and access `0x0008` (static) | `0x1000` (synthetic, for the implicit ones).

```java
class T {
    static final int A = 1;     // constant, no <clinit> needed for primitive
    static int b = 2;
    static { b += 1; }
    static String s = compute();
}
```

```
static {};
  Code:
     0: iconst_2
     1: putstatic     #2  // b = 2
     4: getstatic     #2
     7: iconst_1
     8: iadd
     9: putstatic     #2  // b += 1
    12: invokestatic  #3  // compute()
    15: putstatic     #4  // s = result
    18: return
```

Note: `A` doesn't appear because `static final int A = 1` is a *compile-time constant* — `javac` inlines the `1` at every use site and omits storing/initializing it.

Edge case: `static final String S = computeNonConst();` is **not** a compile-time constant (it's only constant if RHS is itself a constant expression). It generates a `<clinit>` like any other.

---

## 3. `<init>` mechanics

Every constructor compiles to an `<init>` method. The first instruction must be either `invokespecial` of an `<init>` on the same class (for `this(...)`) or on a superclass (for `super(...)`).

**Verification rule** (JVMS §4.10.2.4): the bytecode verifier tracks an "uninitializedThis" type for the receiver until the superclass `<init>` returns. You cannot call any instance method on `this` until that point.

```
new C(int);
  Code:
     0: aload_0                 // this (uninitializedThis)
     1: invokespecial #1        // Object.<init>()V — now `this` is initialized
     4: aload_0                 // (now of type C)
     5: iload_1
     6: putfield     #2         // x = arg
     9: return
```

Before line 1 returns, you cannot:
- Pass `this` to a non-`<init>` method (verifier rejects)
- Read or write a field on `this`
- Use `this` as a return value

Java 22+ relaxes this slightly: certain prologue statements before `super(...)` are now allowed.

---

## 4. Field initializer placement

Field initializers (`int x = 5;`) and instance `{ }` blocks are inlined into **every** constructor by `javac`, immediately after the `super(...)` call.

```java
class C {
    int x = 1;
    int y = 2;
    { System.out.println("block"); }
    C() { x = 10; }
    C(int v) { x = v; }
}
```

Both constructors get prefixed with: super → x=1 → y=2 → println("block"). Then the constructor-specific body runs.

This means:
- Field initializers run **per `new`** (not once)
- Field initializers can run multiple times if you're not careful with `this(...)` chains (they don't — `this(...)` constructors skip the prefix because the target ctor has it)

---

## 5. Constructor chaining via `this(...)`

```java
class C {
    int x;
    String s;
    C() { this(0, "default"); }
    C(int x, String s) {
        this.x = x;
        this.s = s;
    }
}
```

The no-arg constructor's bytecode:
```
0: aload_0
1: iconst_0
2: ldc           "default"
4: invokespecial #1   // C.<init>(ILjava/lang/String;)V
7: return
```

It does **not** include the field-init prologue. Only the constructor at the *bottom* of the `this(...)` chain (the one that calls `super(...)`) carries the prologue.

---

## 6. The Java Memory Model and `final` fields

JLS §17.5 specifies a special **freeze** action at the end of `<init>` for any `final` field. This means:

> If a thread `T1` constructs an object with a final field `f`, and another thread `T2` reads a reference to that object via a properly published reference, `T2` is guaranteed to see the final value of `f` written during construction.

**Without** `final`, you get no such guarantee. `T2` could observe the field as default (`0` / `null`) even after the constructor has returned, in the absence of a happens-before edge.

Key consequence: immutable objects with `final` fields are safe for unsynchronized publication. Mutable objects are not.

`final` field publication is also why `String` is safely shared across threads despite no synchronization.

---

## 7. Safepoints during allocation

The JVM relies on **safepoints** — points where threads can be paused for GC. A thread is at a safepoint when:

- Executing JNI code
- Blocked on I/O / monitor
- Polling a safepoint check (typically at method entry, loop back-edges, returns)

During `<init>`, a thread can hit a safepoint between bytecodes. The **OopMap** tells the GC which stack slots and locals contain live references at that point. This is how the GC can move (compact) objects safely while threads are running.

The "uninitializedThis" verifier state is also tracked in the OopMap so a GC can correctly trace it.

---

## 8. Compressed Oops and class pointers

By default on heaps < 32 GB, the JVM uses **compressed oops** (32-bit object references that are zero-extended/shifted to form 64-bit addresses). This shrinks reference fields from 8 to 4 bytes, saving substantial heap on object-heavy workloads.

`-XX:+UseCompressedOops` (default below 32 GB)
`-XX:+UseCompressedClassPointers` (default; klass pointer in header is 4 bytes)

Once heap exceeds the threshold, references become 8 bytes and per-object overhead grows. Stay under 32 GB unless you really need more.

---

## 9. The `Cleaner` API internals

```java
public final class Cleaner {
    private final CleanerImpl impl;
    static Cleaner create() { return new Cleaner(); }
    public Cleanable register(Object obj, Runnable action) {
        return new PhantomCleanable<>(obj, this, action);
    }
}
```

Internally, `Cleaner` maintains a `ReferenceQueue<Object>`. When `register()` is called, it creates a `PhantomReference` wrapping the registered object, with the cleanup action attached.

A daemon thread polls the queue. When the GC determines the registered object is phantom-reachable (no strong/soft/weak refs left), it enqueues the `PhantomReference`. The daemon dequeues it and runs the cleanup action.

The runnable **must not** reference the registered object — that creates a strong reference that prevents collection. Hence the rule: use a `static` nested class for cleanup state.

---

## 10. Phantom-reachable, the strangest GC state

JLS / JMM define five reachability levels:

```
strongly reachable > softly > weakly > phantom > unreachable
```

A phantom-reachable object has been finalized (or had no finalizer), and the only references to it are phantom references. The GC has decided it's collectible but is waiting for the cleanup action to run.

You **cannot get the referent** from a `PhantomReference` (`get()` always returns `null`). This prevents resurrection.

---

## 11. Class unloading

Classes can be unloaded when their `ClassLoader` becomes unreachable. This requires:

- The class loader instance is unreachable
- All loaded classes from that loader are unused (no instances, no static field references being followed)
- All the loader's `Class<?>` objects are unreachable

Server frameworks redeploying webapps rely on this. ClassLoader leaks (a single reference to a class in a parent loader's static field) prevent unload and slowly leak PermGen / Metaspace.

`-XX:+TraceClassUnloading` for debugging.

---

## 12. Project Valhalla preview

Value classes (JEP 401, preview):

```java
public value class Point {
    private final int x;
    private final int y;
    public Point(int x, int y) { this.x = x; this.y = y; }
}
```

Properties:
- **No identity** (`==` compares fields, can't be used as monitor)
- **No header** (no klass pointer for instances)
- **Stack-allocatable** (or scalar-replaceable always)
- **Flat in arrays** (`Point[]` becomes contiguous `int x int y` pairs, not pointer-to-Point)

Lifecycle becomes much simpler: no GC, no construction order issues, just data.

---

## 13. Project Lilliput

Aims to shrink the object header from 96 bits → 64 bits → 32 bits eventually. Implemented in Java 24:

- Mark word + klass pointer compressed via lookup tables
- Saves ~10–20% heap on object-dense workloads
- Tradeoff: slightly higher cost on identity hash code, monitor inflation

---

## 14. Diagnosing lifecycle bugs in production

Tools and signals:

| Symptom                        | Tool                                |
|--------------------------------|-------------------------------------|
| Slow allocation                | JFR `jdk.ObjectAllocationOutsideTLAB` |
| Frequent old-gen GC            | JFR `jdk.GarbageCollection`, `gc.log` |
| Memory leak                    | Heap dump → MAT dominator tree      |
| ClassLoader leak               | `-Xlog:class+unload`, MAT class loader histogram |
| Direct buffer leak             | JMX `BufferPoolMXBean`              |
| Cleaner not running            | Check daemon thread, ensure no strong ref |

---

## 15. Concurrent considerations

A constructor runs on **one thread**, but the resulting object may be observed by many. Rules:

1. **Final field freeze** gives safe publication for immutable objects.
2. **Synchronized publication** (writing to a `volatile` field, putting in `ConcurrentHashMap`) gives safe publication for any object.
3. **Unsafe publication** (writing to a non-volatile field on initialization) can leak partially constructed objects to readers. Don't.

The classic broken double-checked locking:

```java
class Singleton {
    static Singleton instance;             // not volatile — broken
    static Singleton get() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) instance = new Singleton();
            }
        }
        return instance;
    }
}
```

Without `volatile`, a reader thread can see the reference assigned but the fields not yet initialized. Fix: make `instance` `volatile`, or use the lazy holder idiom.

---

## 16. Where the spec says it

| Rule                                | Spec section            |
|-------------------------------------|-------------------------|
| Order of class initialization       | JLS §12.4               |
| Object creation expressions         | JLS §12.5               |
| Final field semantics               | JLS §17.5               |
| `<init>` and `<clinit>` in bytecode | JVMS §2.9               |
| `new` instruction                   | JVMS §6.5.new           |
| Bytecode verification of `<init>`   | JVMS §4.10.2            |
| Garbage collection (informative)    | JVMS §3.5.5             |
| Reference types & queues            | `java.lang.ref` Javadoc |

---

**Memorize this**: At the bytecode level, instance creation is a four-step dance: `new` (allocate), `dup`, `invokespecial <init>` (construct), and only then is the reference usable. Field initializers are inlined into every constructor's prologue. `<clinit>` runs once, lazily, on first use of the class. Final fields get freeze semantics at the end of `<init>`. The JVM owns the rest.
