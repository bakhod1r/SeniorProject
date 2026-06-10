# Final Keyword — Professional (Under the Hood)

> **What's actually happening?** `final` is enforced at four levels: `javac` (definite assignment, no reassignment), the JVM verifier (rejects bytecode that assigns final fields outside `<init>`), the JIT (treats `final` fields as effectively constant for optimization), and the JMM (final-field freeze guarantees safe publication). Each layer enforces a piece of the contract; together they make `final` one of the most *load-bearing* keywords in Java.

---

## 1. Class file representation

The `final` flag is `ACC_FINAL = 0x0010` in the class file (JVMS §4.1, §4.5, §4.6):

| Location           | Meaning                                      |
|--------------------|----------------------------------------------|
| `ClassFile.access_flags`  | Class is `final` — no subclasses allowed |
| `field_info.access_flags` | Field is `final` — written exactly once |
| `method_info.access_flags`| Method is `final` — cannot be overridden |

For compile-time constants (`static final` primitive/`String` with constant initializer), the field also has a `ConstantValue` attribute (§4.7.2):

```
ConstantValue_attribute {
    u2 attribute_name_index;
    u4 attribute_length;       // 2
    u2 constantvalue_index;    // pool index of the literal
}
```

The JVM uses this attribute to initialize the field at link time, before `<clinit>` runs.

Inspect with `javap -v`:

```
public final class com.example.Money
  ACC_PUBLIC, ACC_FINAL, ACC_SUPER

  private final long cents;
    descriptor: J
    flags: (0x0012) ACC_PRIVATE, ACC_FINAL
```

---

## 2. JVM verifier rules for `final` fields

The verifier (JVMS §4.10, §6.5) enforces:

- **Instance `final` fields** can only be written by `<init>` of the *same class*. A `putfield` to a final field outside `<init>` causes `VerifyError`.
- **Static `final` fields** can only be written by `<clinit>` of the *same class*. A `putstatic` to a final field outside `<clinit>` causes `VerifyError`.
- **Records' final fields** are written by the canonical constructor; the verifier accepts this because records' canonical constructors are `<init>` methods.

The "same class" rule means a subclass's `<init>` cannot write parent's `final` fields directly — they must come through the parent's constructor (which the subclass's `<init>` chains via `invokespecial`).

Reflection (`Field.set`) can bypass these checks if the field is made accessible — but the verifier still requires that the bytecode itself be well-formed. Reflection writes happen at runtime, separate from the bytecode-level check.

---

## 3. JLS §17.5 — Final field semantics in the JMM

The most important guarantee `final` provides in concurrent code:

> *Let `o` be an object, and `c` be a constructor for `o`'s class in which a write `w` is performed (to a `final` field of `o`). A "freeze" action on `w` occurs at the end of `c`. If `r` is a read of a `final` field of `o` such that the freeze on `w` happens-before `r`, then `r` will see the value written by `w`.*

Practical translation: any thread that observes a published reference to `o` after `c` finishes is guaranteed to see all `final` field values set during `c` — without synchronization.

The `freeze` action is a synthetic JMM event that the JIT/JVM must respect. On hardware, it's typically a memory barrier inserted at the end of the constructor (or `<init>` method) for any class with `final` fields.

The catch: if the constructor lets `this` *escape* (passes it to another thread, registers it with a callback), readers may see the object before the freeze — and then there's no guarantee.

---

## 4. Final fields and JIT inlining

The JIT can use `final` for aggressive optimization:

- **Final static primitives/strings**: inlined at compile time by `javac` (constant expression rule). The JIT never sees a `getstatic` for them.
- **Final instance fields**: the JIT may treat them as *effectively constant* — once the JIT has seen a value, it can speculatively use that value, with deoptimization if the field is ever reassigned (which can only happen via reflection or `Unsafe` — both of which the JIT detects).
- **Final classes/methods**: inlined directly without CHA dependency.

`-XX:+TrustFinalNonStaticFields` (off by default in some JVMs) makes the JIT treat all `final` instance fields as immutable, enabling more aggressive constant-folding. The default is conservative because reflection can violate `final`.

---

## 5. Compile-time constant inlining

```java
public class Limits {
    public static final int MAX = 100;        // compile-time constant
}

// Consumer:
if (count > Limits.MAX) ...
```

The consumer's bytecode contains `bipush 100`, not `getstatic Limits.MAX`. The compiler inlines the value at every read site.

Properties:

- The constant is "baked into" every class file that reads it.
- Changing `MAX` requires recompiling all consumers.
- The compiler is allowed (and encouraged) to inline; the JLS specifies it (§13.4.9, "Final Fields").
- The runtime can theoretically *not* inline (e.g., interpreter mode), but in practice every modern Java compiler does.

For values that may change between releases of a library, do not use `static final` constants — use `static final` *methods* (which can be inlined by the JIT but not by `javac`).

---

## 6. Records and `final`

A record's class file:

- Class: `ACC_PUBLIC | ACC_FINAL | ACC_SUPER`.
- Components: `ACC_PRIVATE | ACC_FINAL`.
- Canonical constructor: standard `<init>`.
- Accessors (one per component): `ACC_PUBLIC`. Implementation is `aload_0; getfield this.x; ireturn` (or appropriate return for the type).
- `equals`, `hashCode`, `toString`: implemented via `invokedynamic` referring to `java.lang.runtime.ObjectMethods.bootstrap`.

The `Record` attribute on the class file lists the components (JVMS §4.7.30, since Java 16):

```
Record_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 components_count;
    record_component_info components[components_count];
}
```

Each `record_component_info` has the component's name, descriptor, and any attributes. This is what reflection's `Class.getRecordComponents()` reads.

---

## 7. Final fields and the constructor escape rule

The freeze rule fails if `this` escapes the constructor:

```java
public final class Listener {
    private final int counter;

    public Listener(EventBus bus) {
        bus.register(this);                 // this escapes!
        this.counter = 42;                   // happens after escape
    }
}
```

If thread A constructs the Listener (registering with the bus), and thread B (the bus's dispatcher) calls a method on the Listener immediately, B may see `counter = 0` because the freeze hadn't happened yet.

Even though `counter` is `final`, the freeze guarantee requires the constructor to *fully complete* before publication. Escape during construction breaks this.

Fix: don't escape `this`. Defer registration to a separate `init()` method called after construction.

---

## 8. Sealed classes and `final`

Sealed classes (Java 17+) interact with `final`:

```java
public sealed class Shape permits Circle, Square {}
public final class Circle extends Shape { ... }
public final class Square extends Shape { ... }
```

Each permitted subclass must declare exactly one of:

- `final` — closes the line.
- `sealed` (with its own `permits`) — restricts further extension.
- `non-sealed` — re-opens for extension.

Class file flags:

- A `sealed` class has the `PermittedSubclasses` attribute (JVMS §4.7.31, since Java 17). It does *not* have `ACC_FINAL`.
- A `final` permitted subclass has `ACC_FINAL`.
- A `non-sealed` permitted subclass has neither.

So `final`, `sealed`, `non-sealed` are mutually exclusive in class declarations. The verifier rejects illegal combinations.

---

## 9. Final and `Unsafe` / `VarHandle`

Modern JVMs allow `VarHandle` to access `final` fields, but only through specific access modes:

- `getOpaque`, `getAcquire`, `get`, `getVolatile` — all legal on final fields.
- `set`, `setVolatile`, `setRelease`, `compareAndSet` — *not* allowed on final fields. The `VarHandle` lookup throws `IllegalAccessException` for these.

So `VarHandle` respects `final` for writes. `Unsafe.putInt(...)` and similar are unrestricted but are no longer a supported API and may break in future Java versions.

`Field.setAccessible(true)` + `Field.set(...)` historically bypassed `final` for instance fields. Java 17+ makes this unreliable: the JIT may have inlined the value, so reads continue to see the old value.

---

## 10. Class file size impact

Marking fields, methods, and classes `final` does not affect class file size — `final` is a single bit in the flags. The cost is zero.

For `static final` constants, the `ConstantValue` attribute adds 8 bytes per field. Negligible.

The JIT may produce slightly different compiled code for `final` vs non-`final` (no CHA tracking), but the difference at the bytecode level is just the flag bit.

---

## 11. Final fields and serialization

Java's standard serialization (`Serializable`) writes object state including `final` fields. On deserialization:

- The default `<init>` method runs, but only the *no-arg* one of the topmost non-Serializable superclass — typically `Object`. This means `final` fields don't get their values from constructors.
- Instead, `ObjectInputStream` uses reflection (`Field.set`) to assign final fields directly. This is one of the few legitimate uses of "writing to final fields outside `<init>`".

Records have specific serialization semantics (JLS §13.5): the canonical constructor is invoked with the deserialized component values. This is much cleaner — final fields are set normally.

For modern code, prefer:

- Records for serializable values.
- Jackson/Gson for JSON (configurable, no field-level reflection needed for records).
- Avoid `Serializable` entirely for new types.

---

## 12. The `BlankFinal` rule

A `final` field that's not assigned at declaration is a *blank final* (JLS §4.12.4). It must be assigned exactly once:

- For instance fields: in every constructor path (or in an instance initializer).
- For static fields: in the static initializer (`<clinit>`) or in a static initializer block.

The compiler enforces *definite assignment*: every code path leading to the end of the constructor (or `<clinit>`) must assign the field. Otherwise compile error.

```java
public class Foo {
    private final int x;
    public Foo(boolean cond) {
        if (cond) x = 1;
        // ❌ if cond is false, x is unassigned — compile error
    }
}
```

The fix:

```java
public Foo(boolean cond) {
    x = cond ? 1 : 2;            // both branches assign
}
```

Or:

```java
public Foo(boolean cond) {
    if (cond) x = 1;
    else      x = 2;
}
```

Java's definite-assignment analysis (JLS §16) is one of the more sophisticated rules in the language.

---

## 13. Final method handles

`MethodHandle.findVarHandle(class, name, type)` returns a VarHandle that respects final-field semantics:

```java
VarHandle FINAL_FIELD = MethodHandles.lookup()
    .findVarHandle(Money.class, "cents", long.class);

long v = (long) FINAL_FIELD.get(money);          // ✓ legal
FINAL_FIELD.set(money, 999);                      // throws IllegalAccessError at runtime
```

For final fields, the VarHandle has only read access modes. Write modes are explicitly unsupported.

This is the modern way to do reflective access. It's JIT-compiled like a direct field access; no per-call reflection cost.

---

## 14. Performance measurement: `final` impact

Use JMH benchmarks to measure:

- Final vs non-final method dispatch on a stable monomorphic class — typically equal performance.
- Final vs non-final method dispatch on a class with many subclasses — final wins (no inline cache).
- Final vs non-final fields in tight access loops — final wins slightly because the JIT can constant-fold or hoist reads.

The wins are typically 1–10% on micro-benchmarks. Not transformative, but always free.

The bigger wins from `final` are *macro*: cleaner code, easier refactoring, fewer concurrency bugs, faster developers.

---

## 15. Tools you should know

| Tool                                       | What it shows                                    |
|--------------------------------------------|--------------------------------------------------|
| `javap -v MyClass.class`                   | All `ACC_FINAL` flags, `ConstantValue` attributes |
| `Modifier.isFinal(class.getModifiers())`   | Runtime check                                     |
| `Field.getModifiers()` / `Modifier.isFinal(m)` | Per-field check                              |
| `-XX:+PrintInlining`                       | Confirm `final` methods inline                    |
| `-XX:+TrustFinalNonStaticFields`           | Aggressive constant-folding for instance finals   |
| JOL                                        | Object layout including final fields              |
| Static analyzers (Error Prone, SpotBugs)   | Flag mutable-where-it-could-be-final              |

---

## 16. Professional checklist

For each `final` declaration:

1. **Field**: is the freeze guarantee important? (For shared immutable objects: yes.)
2. **Field**: is the value a compile-time constant? Will consumer recompiles cause grief?
3. **Method**: does CHA-free inlining matter on the hot path?
4. **Class**: does sealed make sense as a finer-grained alternative?
5. **Constructor**: does `this` escape? If yes, the freeze rule fails — refactor.
6. **Record**: would a record be cleaner than hand-rolled `final class`?
7. **Reflection**: any code mutating final fields? Migrate to `MethodHandle` or fix the design.
8. **JMM**: is publication safe via `final`'s freeze, or is `volatile`/synchronization needed?
9. **Sealed**: are subclasses tightly controlled? Use `sealed` instead of unrestricted extension.
10. **API stability**: is `final` blocking a legitimate test-time mock? Use interfaces.

Professional `final` use is consistent: every fix-once piece of state is `final`; every value type is a final class or record; every service has final dependencies. The codebase telegraphs immutability through the keyword.
