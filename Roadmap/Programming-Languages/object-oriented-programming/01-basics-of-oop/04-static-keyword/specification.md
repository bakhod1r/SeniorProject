# Static Keyword — Specification Deep-Dive

> Rules for `static` are scattered across **JLS §8.3.1.1** (static fields), **§8.4.3.2** (static methods), **§8.7** (static initializers), **§12.4** (class initialization), **JVMS §4.5/§4.6** (class file flags), **§5.5** (initialization), **§6.5** (`getstatic`/`putstatic`/`invokestatic`). This file maps each rule to its source.

---

## 1. Where the rules live

| Concept                               | Source                                    |
|---------------------------------------|-------------------------------------------|
| Static field declarations             | **JLS §8.3.1.1**                          |
| Static method declarations            | **JLS §8.4.3.2**                          |
| Static initializers (`static {}`)     | **JLS §8.7**                              |
| Static nested classes                 | JLS §8.5.1                                |
| Class initialization (`<clinit>`)     | **JLS §12.4**                             |
| Class loading and linking             | JVMS §5.3, §5.4                            |
| Class initialization at runtime       | **JVMS §5.5**                             |
| `static` in the class file            | JVMS §4.5 (fields), §4.6 (methods), §4.1 (classes — but not for top-level) |
| `getstatic`/`putstatic`/`invokestatic` | **JVMS §6.5**                            |
| `<clinit>` synthesis                  | JVMS §2.9.2                                |
| Compile-time constants and `ConstantValue` | JLS §15.28, JVMS §4.7.2              |
| `final` static fields and JMM         | JLS §17.5                                  |

---

## 2. JLS §8.3.1.1 — Static fields

A field declared with `static`:

> *Is called a class variable. It comes into existence when the class is prepared, has its default value, and is initialized when the class is initialized.*

Constraints:

- A static field cannot be declared inside an anonymous class or inner class (non-static nested) — except when it's a `static final` compile-time constant. (Java 16+ relaxed this for inner classes — they can have any static members.)
- A static field belongs to the class, accessed via the class name or any reference (deprecated style).

`static final` fields with compile-time constant initializers (JLS §15.28) get a `ConstantValue` attribute in the class file, which the JVM uses to initialize the field at link time (before `<clinit>`).

---

## 3. JLS §8.4.3.2 — Static methods

A method declared with `static`:

> *Belongs to the class and not to any object. A class method is invoked via the class name, or via a reference to any instance of the class.*

Constraints:

- Cannot use `this` or `super`.
- Cannot directly access non-`static` fields or methods of the enclosing class.
- Cannot be `abstract` (no instance to dispatch on).
- Cannot be overridden — only **hidden** by subclass static methods of the same signature.

A static method's signature is part of the class's structure but not its inheritance contract.

---

## 4. JLS §8.7 — Static initializers

A static initializer is a `static { ... }` block in the class body:

> *Runs when the class is initialized. May not throw checked exceptions unless explicitly declared (which class initializers cannot — they have no `throws` clause).*

Multiple static initializers are allowed; they run in source order, interleaved with static field initializers.

The compiler synthesizes a method named `<clinit>` (with an empty descriptor, returning `void`). This method's bytecode is the concatenation of all static field initializers and `static {}` blocks, in source order.

Constraints (per JLS):

- A static initializer cannot use `return`.
- Cannot throw a checked exception unless caught within the initializer.
- May not contain a forward reference to a static field declared later (with caveats — JLS §8.3.3 is the precise rule).

---

## 5. JLS §12.4 — Class initialization

Initialization is triggered by (§12.4.1):

1. Instantiation: `new C()`.
2. Invocation of a static method declared in `C`.
3. Assignment to a non-`final` static field of `C`.
4. Use of a non-`final` static field (read or write).
5. Reflection: `Class.forName("C")` (with `initialize=true`, the default).
6. Initialization of a subclass of `C`.
7. Designation of `C` as the initial class at JVM startup.

Initialization is **not** triggered by:

- A class literal: `C.class`.
- `Class.forName("C", false, loader)`.
- Reading a `static final` constant whose initializer is a compile-time constant expression.
- `instanceof C`.
- Array creation: `new C[10]`.

The procedure (§12.4.2) — which the JVM follows when it decides to initialize:

1. Acquire the class-init lock for `C`.
2. If `C` is already being initialized by the current thread, release lock and proceed (recursive entry).
3. If `C` is being initialized by another thread, wait on the lock.
4. If `C` has been fully initialized, release and return.
5. If `C` has previously failed initialization, release and throw `NoClassDefFoundError`.
6. Mark `C` as in-progress; release lock.
7. Initialize `C`'s superclass and superinterfaces (those with default methods).
8. Run `<clinit>`.
9. Acquire lock; mark `C` as initialized (or failed, on exception); notifyAll waiters; release.

This procedure is what makes class initialization thread-safe and deterministic.

---

## 6. JVMS §5.5 — Class initialization at runtime

The JVM mirrors JLS §12.4. The init lock is implemented per-class — each loaded class has its own monitor. The init state is one of:

- *erroneous* — a previous attempt failed; future attempts throw `NoClassDefFoundError`.
- *not-initialized* — never started.
- *being-initialized-by-other-thread* — another thread is in `<clinit>`.
- *being-initialized-by-this-thread* — current thread is in `<clinit>` (recursive entry).
- *fully-initialized*.

A class deadlock between two `<clinit>` calls is detectable in `jstack` as two threads in `Class init` state.

---

## 7. JVMS §4.5 — Static fields in the class file

```
ACC_STATIC = 0x0008
```

The flag bit identifying a static field. Combined with other flags:

- `static final`: `ACC_STATIC | ACC_FINAL = 0x0018`.
- `public static final`: `ACC_PUBLIC | ACC_STATIC | ACC_FINAL = 0x0019`.
- `private static`: `ACC_PRIVATE | ACC_STATIC = 0x000A`.

A `static final` primitive or `String` field with a constant initializer also has the `ConstantValue` attribute (§4.7.2):

```
ConstantValue_attribute {
    u2 attribute_name_index;
    u4 attribute_length;       // always 2
    u2 constantvalue_index;    // index in the constant pool
}
```

The JVM uses this attribute during preparation (before `<clinit>`) to set the field. So such fields are initialized *eagerly*, even if `<clinit>` is delayed.

---

## 8. JVMS §4.6 — Static methods in the class file

```
ACC_STATIC = 0x0008
```

Constraints:

- Cannot combine with `ACC_ABSTRACT`.
- A `static` method has no implicit `this` parameter — its parameters are exactly its declared formals.
- The JVM dispatches via `invokestatic`, never `invokevirtual` or `invokespecial`.

The `<clinit>` method itself has special flags: `ACC_STATIC` (always) and historically `ACC_STRICT` (which became a no-op in JEP 306).

---

## 9. JVMS §6.5 — Static-related bytecode

Three pairs:

- **`getstatic` / `putstatic`** — read/write static fields.
- **`invokestatic`** — call static methods.

Each takes a constant-pool index referring to a `Fieldref` or `Methodref` entry.

Resolution (§5.4.3) happens once on first execution; the result is cached in the constant pool. Access checking (§5.4.4) verifies that the calling class has access.

`invokestatic` also triggers initialization of the target class if not yet initialized — per JLS §12.4.1's "invocation of a static method" rule.

---

## 10. The `<clinit>` synthesis

Given source:

```java
public class C {
    static int x = 5;
    static {
        x += 10;
    }
    static int y = x * 2;
}
```

`javac` synthesizes:

```
static <clinit>()V
    iconst_5
    putstatic C.x:I        // static int x = 5
    getstatic C.x:I
    bipush 10
    iadd
    putstatic C.x:I        // static { x += 10; }
    getstatic C.x:I
    iconst_2
    imul
    putstatic C.y:I        // static int y = x * 2
    return
```

The bytecode is the textual concatenation of static initializers and field initializers, in source order. Inspect with `javap -v -p`.

`<clinit>` cannot be invoked directly (the compiler rejects calls to it). The JVM is the only invoker.

---

## 11. JLS §15.28 — Constant expressions

A constant expression is an expression denoting a value of primitive type or `String` that is computable at compile time. Examples:

- Literals: `42`, `"hello"`.
- Operators on constant operands: `1 + 2`, `"foo" + "bar"`.
- Names that refer to other constant variables (`static final` of constant-expression initializer).
- Casts to primitive type.

A `static final` field with a constant-expression initializer becomes a *constant variable* (JLS §4.12.4). Its value is inlined by `javac` at every read site.

This is why `Math.PI` (a `static final double`) reads in user code don't show `getstatic` in bytecode — the literal `3.14159...` is inlined.

---

## 12. JLS §17.5 — Final field semantics for static finals

The freeze rule applies to `static final` fields too. After `<clinit>` finishes (without leaking the class via reflection during init), every thread that observes the class as initialized sees fully-initialized `static final` fields.

Practically: the lazy holder idiom relies on this. When `Holder.INSTANCE` is read, the JVM has guaranteed that `Holder` is initialized; therefore `INSTANCE` (`static final`) is fully constructed and visible.

For non-`final` static fields, the cross-thread visibility is governed by `<clinit>`'s monitor enter/exit: a thread that observes the class as initialized has happens-after on `<clinit>`'s end; therefore it sees the field's value at `<clinit>`'s end. But subsequent updates to the field require `volatile` or synchronization.

---

## 13. Initialization triggering nuances

A subtlety from JLS §12.4.1:

> *A reference to a static field causes initialization of only the class or interface that actually declares it, even though it might be referred to through the name of a subclass, a subinterface, or a class that implements an interface.*

So:

```java
class A { static int x = init(); }
class B extends A { }

B.x;   // this triggers initialization of A, not B (x is declared in A)
```

This is "specific declaring class" semantics — slightly counterintuitive but consistent.

---

## 14. The `ExceptionInInitializerError` cycle

If `<clinit>` throws an unchecked exception or error (other than `Error`), the JVM:

1. Catches the throwable.
2. Wraps it in `ExceptionInInitializerError`.
3. Marks the class as **erroneous**.
4. Throws the `ExceptionInInitializerError` to the triggering caller.

Subsequent attempts to use the class (any of the triggers in §12.4.1) throw `NoClassDefFoundError` *without* the original cause — which makes diagnosis hard.

Best practice: log inside `<clinit>` so the original exception is preserved. Or: catch in `<clinit>`, log, and rethrow as your own runtime exception with detail.

---

## 15. `static` methods on interfaces

Java 8 (JLS §9.4) added static methods on interfaces. Constraints:

- Cannot be `abstract`.
- Cannot be overridden (interfaces have no per-instance dispatch for statics).
- Are *not inherited* by implementing classes — must be called via the interface name.

```java
public interface Comparator<T> {
    static <T> Comparator<T> naturalOrder() { return ...; }
}

Comparator.naturalOrder();   // ✓
```

Java 9 (JLS §9.4) added `private` interface methods (typically static, sometimes default). They serve as helpers for `default` methods.

---

## 16. `static` import (JLS §7.5.3, §7.5.4)

Two forms:

- `import static java.lang.Math.PI;` — single import.
- `import static java.lang.Math.*;` — on-demand import.

Imported static members can be referenced without their class name. Resolution rules favor explicit imports over on-demand.

Static imports are useful for constants and frequently-used static methods (e.g., `assertEquals` from JUnit). Use sparingly — heavy use makes call sites ambiguous.

---

## 17. Reading order

1. **JLS §8.3.1.1** — static fields.
2. **JLS §8.4.3.2** — static methods.
3. **JLS §8.7** — static initializers.
4. **JLS §12.4** — class initialization. (The most important section here.)
5. **JLS §17.5** — final field semantics, including statics.
6. **JVMS §5.5** — runtime initialization.
7. **JVMS §4.5/§4.6** — class file flags.

After this, most "why is `static` doing X?" questions have a concrete answer in a numbered paragraph.

---

## 18. The takeaway

The `static` keyword is precisely defined: a class-scoped declaration whose lifecycle, dispatch, and visibility are governed by a small set of JLS and JVMS rules. Most static-related bugs trace to one of:

- §12.4.1 trigger conditions (static block didn't run, or ran more than expected).
- §15.28 constant inlining (cross-jar surprises).
- §17.5 publication semantics (or lack thereof for non-`final` statics).
- §5.5 init lock + cyclic dependency (deadlocks).

Learn these four corners and `static` becomes predictable.
