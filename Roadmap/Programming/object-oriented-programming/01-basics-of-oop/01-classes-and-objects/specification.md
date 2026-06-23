# Classes and Objects — Specification Deep-Dive

> Where the rules actually live: **JLS Chapter 8** (Classes), **JLS Chapter 12** (Execution: loading, linking, initialization), **JVMS Chapters 4 & 5** (class file format and loading), and **JEP 401** (value classes — preview). This file is a reading guide that points to the binding text and explains how each rule manifests in compiler output and runtime behavior.

---

## 1. Where to find the canonical text

| Concept                                  | Authoritative source                                  |
|------------------------------------------|-------------------------------------------------------|
| Class declarations, fields, methods      | **JLS §8** — *Classes*                                |
| Constructors, instance initialization    | JLS §8.8, §12.5                                       |
| Class loading, linking, initialization   | **JLS §12.4**, **JVMS §5**                            |
| Class file binary format                 | **JVMS §4**                                           |
| Bytecode instructions (`new`, `invoke*`) | **JVMS §6.5**                                         |
| Object representation in HotSpot         | OpenJDK source, `oop.hpp`, `instanceOop.hpp`, `markWord.hpp` |
| Records                                  | **JLS §8.10** (added in Java 16)                      |
| Sealed classes                           | **JLS §8.1.1.2** (added in Java 17)                   |
| Value classes (preview)                  | **JEP 401**                                           |
| Memory model and `final` semantics       | **JLS §17**, especially §17.5                         |

The **JLS** ([docs.oracle.com/javase/specs/jls](https://docs.oracle.com/javase/specs/)) is the language spec — what `javac` enforces. The **JVMS** is the runtime spec — what the JVM enforces. Many subtleties (null safety, reflection, class loading) only make sense once you've read both.

---

## 2. JLS §8 — Class declarations, the formal grammar

A class declaration in JLS terms (simplified):

```
ClassDeclaration:
    NormalClassDeclaration | EnumDeclaration | RecordDeclaration

NormalClassDeclaration:
    {ClassModifier} class TypeIdentifier [TypeParameters] [Superclass] [Superinterfaces] [PermitsClause] ClassBody
```

Modifiers (JLS §8.1.1):

- `public`, `protected`, `private` — only one may apply (and `protected`/`private` only on nested classes).
- `abstract` — class cannot be instantiated; may declare `abstract` methods.
- `final` — class cannot be extended.
- `sealed` / `non-sealed` — restricts or opens extension; introduced in JLS §8.1.1.2.
- `static` — only on nested classes.
- `strictfp` — historical, deprecated; everything is now strict by default since JEP 306.

The grammar enforces structural rules. Semantic rules (e.g., "`final` and `sealed` are mutually exclusive") are checked separately.

---

## 3. Fields — JLS §8.3

A field declaration:

```
FieldDeclaration:
    {FieldModifier} UnannType VariableDeclaratorList ;
```

Modifiers (§8.3.1):

- `public`/`protected`/`private` — at most one.
- `static` — class-level (one per class) vs instance-level (one per object).
- `final` — must be definitely assigned exactly once before the constructor (or `<clinit>` for `static`) returns.
- `transient` — excluded from default Java serialization.
- `volatile` — JMM happens-before guarantee on every read/write.

Initialization order (§8.3.3):

1. Default values are written (zero/null/false) when the object is allocated.
2. *Instance initializers* and field initializers run in textual order, **after** the superclass constructor completes.
3. The constructor body runs.

Compile error: a `final` field must be assigned by the time the constructor returns; otherwise the *definite assignment* rules (§16) reject the code.

---

## 4. Methods — JLS §8.4

```
MethodDeclaration:
    {MethodModifier} MethodHeader MethodBody
```

Resolution rules (§15.12) — how the compiler picks which overload to call:

1. **Identify candidate methods**: same name, accessible, applicable to the argument count.
2. **Resolve to the most specific** applicable method using subtyping. Three phases:
   - Phase 1: strict invocation (no boxing/unboxing, no varargs).
   - Phase 2: loose invocation (boxing/unboxing allowed).
   - Phase 3: variable-arity (varargs).
3. If no most-specific method exists → ambiguous, compile error.

This is the rule behind List.remove(int) vs List.remove(Object) — phase 1 wins for `remove(0)` because `int` matches without boxing.

Override rules (§8.4.8):

- Subclass method's signature equal-or-stronger than the superclass.
- Return type covariant.
- Thrown checked exceptions a subset.
- Visibility equal or wider.
- `@Override` is a hint to the compiler — strongly recommended.

---

## 5. Constructors — JLS §8.8

A constructor:

- Has the same simple name as the class.
- Has no return type. (Writing `void` makes it a regular method, not a constructor — common bug.)
- Cannot be `abstract`, `static`, `final`, `synchronized`, or `native`.
- Begins with an explicit or implicit constructor invocation: `this(...)` (delegating) or `super(...)` (chaining).

If the first statement is **not** an explicit invocation, the compiler inserts `super();`. If the superclass has no accessible no-arg constructor, this is a compile error.

The implicit *default constructor* (§8.8.9):

- Generated only if **no** constructor is declared.
- Has the same access modifier as the class.
- Body is empty (i.e., `super();`).

Constructor signatures contribute to *type erasure* in generics. Unlike methods, constructors cannot be overridden, only overloaded.

---

## 6. JLS §12.4–12.5 — Initialization sequence

### Class initialization (`<clinit>`)

A class is initialized exactly once. Triggered by (§12.4.1):

1. `new` of an instance.
2. Calling a static method.
3. Reading or writing a non-final, non-constant static field.
4. `Class.forName(name)` (with `initialize=true`, the default).
5. Initialization of a subclass (parent must be initialized first).

`Class.forName(name, false, loader)` and `MyClass.class` literals do **not** initialize.

The JVM holds a per-class `LC` (initialization lock) during `<clinit>`. Recursive entry from the same thread is allowed (recognized "in progress"); cross-thread waits block. **Circular static initializers between two classes deadlock.**

### Instance initialization (`<init>`)

Per JLS §12.5, `new` triggers:

1. Memory allocation (via JVM, JNI, or class file path; not specified by JLS — see JVMS §6.5 for `new`).
2. Default field values written.
3. Constructor body executes.

The exact order during constructor execution:

1. Implicit/explicit `super(...)` or `this(...)` invocation.
2. Instance initializers and instance field initializers, in textual order.
3. Remaining body of the constructor.

If any step throws, the partially constructed object becomes unreachable and is GC'd — **but** any side effects (registrations, file writes) are not rolled back. Use try/catch in constructors only for cleanup, not as a substitute for validation.

---

## 7. JVMS §4 — The `.class` file format

The class file is a binary stream beginning with magic `0xCAFEBABE`. Structure:

```
ClassFile {
    u4               magic;
    u2               minor_version, major_version;       // e.g., 65 = Java 21
    u2               constant_pool_count;
    cp_info          constant_pool[constant_pool_count - 1];
    u2               access_flags;
    u2               this_class, super_class;
    u2               interfaces_count;  u2 interfaces[];
    u2               fields_count;       field_info fields[];
    u2               methods_count;      method_info methods[];
    u2               attributes_count;   attribute_info attributes[];
}
```

Notable attributes:

- **Code** (per method) — the bytecode plus exception table and attributes (`StackMapTable`, `LineNumberTable`, `LocalVariableTable`).
- **Signature** — preserves generic type info erased from the bytecode.
- **InnerClasses**, **NestHost**, **NestMembers** — describe nesting structure.
- **PermittedSubclasses** — sealed hierarchy.
- **Record** — record component descriptors (since Java 16).
- **BootstrapMethods** — for `invokedynamic` (lambdas, string concat).
- **RuntimeVisibleAnnotations**, **RuntimeInvisibleAnnotations** — annotations preserved at runtime vs only at compile time.

Inspect with `javap -v -p MyClass.class`. The output is essentially a textual dump of every byte interpreted by the spec. If you've never read a real class file, do it once — most JVM mysteries become much less mysterious.

---

## 8. JVMS §5 — Loading, linking, initialization

The runtime sequence:

1. **Loading** (§5.3) — a class loader produces a `Class<?>` from a binary representation. The class loader determines the *defining* loader; class identity is `(name, defining loader)` — two classes with the same name from different loaders are *different* runtime types.

2. **Linking** (§5.4) — three sub-steps:
   - **Verification** (§4.10) — proves that the bytecode is type-safe and structurally valid. Modern JVMs use *type-checking* verification with `StackMapTable` (since Java 6, mandatory since Java 7). Failure → `VerifyError`.
   - **Preparation** — static fields get default values (not yet initializer-assigned).
   - **Resolution** — symbolic references in the constant pool are resolved into direct references on first use (lazy; can also be done eagerly).

3. **Initialization** (§5.5) — `<clinit>` runs.

A few subtleties:

- Class loader delegation (parent-first by default) is enforced by the platform/system loaders but customizable.
- The **bootstrap class loader** (written in C++ inside the JVM) loads the JDK's core classes from `lib/modules`.
- Loaders form a runtime tree; if you have two `com.example.Foo` from two loaders, JVM treats them as distinct types — common cause of `ClassCastException` in app servers.

---

## 9. Bytecode for objects — `new`, `dup`, `invokespecial`

JVMS §6.5 defines these instructions. Their cooperation in object construction:

```
0: new           #2  // class Foo            ; allocates uninitialized
3: dup                                        ; copy reference for store
4: invokespecial #3  // Foo."<init>"()V     ; runs constructor
7: astore_1                                   ; store the reference
```

Verifier rules (JVMS §4.10.1.9):

- After `new`, the reference on the stack is "uninitialized." It cannot be stored to a local, returned, or passed to most instructions.
- It becomes "initialized" only after `invokespecial` of `<init>` returns successfully.
- `<init>` itself begins with the verifier marking the receiver as "uninitializedThis" — the constructor body must invoke `super(...)` or `this(...)` before any other use of `this`.

This is the foundation of the rule that you can't "use" `this` before `super(...)` returns.

---

## 10. JLS §17.5 — Final field semantics (the JMM corner)

The single most important JMM rule for class design:

> If a constructor does not let `this` escape, then **any thread that observes the constructed reference after the constructor finishes is guaranteed to see the correct values of every `final` field** without any synchronization.

This is the formal basis for *safe immutable publication*. `final String name` set in the constructor will be visible to every reader of the published reference — even via a non-volatile field, even via a data race.

For non-`final` fields, no such guarantee exists. A reader without proper synchronization may see them at default values forever.

Practical consequence: when designing immutable classes, **mark every field `final`**. Don't rely on "I never set this twice" — the JMM doesn't care; only the keyword affects the publication guarantee.

---

## 11. Records — JLS §8.10

A record declaration:

```java
public record Point(int x, int y) {}
```

Compiles approximately to:

```java
public final class Point extends java.lang.Record {
    private final int x;
    private final int y;
    public Point(int x, int y) { this.x = x; this.y = y; }
    public int x() { return x; }
    public int y() { return y; }
    @Override public boolean equals(Object o) { /* field-by-field */ }
    @Override public int hashCode()           { /* field-derived */ }
    @Override public String toString()        { /* "Point[x=..., y=...]" */ }
}
```

Constraints (§8.10):

- `final` class.
- Extends `java.lang.Record`. May not extend any other class.
- Components become `private final` fields; accessor methods get the component's name (no `get` prefix).
- A canonical constructor is generated; you can write a *compact* form (no parameter list) or a custom canonical constructor.
- May implement interfaces.
- May have static fields, static methods, instance methods, and additional constructors that must delegate to the canonical one.

Records are the spec's blessing of the value-class pattern that experienced developers had been hand-coding for years.

---

## 12. Sealed classes — JLS §8.1.1.2

```java
public sealed class Shape permits Circle, Square, Triangle {}
public final class Circle extends Shape {}
public non-sealed class Square extends Shape {}
public sealed class Triangle extends Shape permits Right, Equilateral {}
```

Rules:

- Permitted subclasses must be in the same module (or, for unnamed-module code, the same package).
- Each permitted subclass must declare exactly one of: `final`, `sealed` (with its own `permits`), or `non-sealed` (re-opens the hierarchy below it).
- The `permits` clause may be omitted if all permitted subclasses are in the same compilation unit.

Combined with JLS §15.28 (pattern `switch`), the compiler can prove a switch is exhaustive. This is the closest thing Java has to a sum/algebraic data type.

---

## 13. JEP 401 — Value classes (preview)

Marked as preview at the time of writing. The shape:

```java
value class Point {
    private final int x;
    private final int y;
    public Point(int x, int y) { this.x = x; this.y = y; }
    public int x() { return x; }
    public int y() { return y; }
}
```

Semantics:

- **No identity.** `==` compares fields. `synchronized(p)` is a compile error. `System.identityHashCode(p)` is allowed but is derived from fields, not memory address.
- **Nullability** is opt-in via `Point!` (non-null) vs `Point` (nullable, currently boxed).
- **Memory layout.** The runtime can store an instance "flat" in a containing object or array — no separate heap object, no header.
- Backward-compatible migration: existing classes (e.g., `LocalDate`) can be migrated to value classes if they meet the constraints.

When stable, value classes will reshape Java's performance story — `BigInteger`, `Optional`, `Pair`-shaped types can become as cheap as primitives, and generic specialization (`List<int>`) becomes feasible.

The shape rule for the future: *if a class is `final`, all-`final`-fields, never synchronized on, and never identity-compared, it is a candidate for a value class.* Designing classes today with that shape is forward-compatible work.

---

## 14. Reading order if you're doing this seriously

1. **JLS Chapter 8** — read top to bottom. Skip the formal grammar on first pass; focus on §8.1 (declarations), §8.3 (fields), §8.4 (methods), §8.8 (constructors), §8.10 (records).
2. **JLS Chapter 12** — initialization. Section 12.4 is the single most important section for understanding "why is `<clinit>` running now?"
3. **JVMS Chapter 4** — class file format. Read with a real class file open in `javap -v`.
4. **JVMS Chapter 5** — loading/linking/init. Connects what `javac` produced to what runs.
5. **JLS Chapter 17** (memory model) — particularly §17.5. Required if you'll ever write code that runs in more than one thread.

Skim the rest. Spec text is dense, but specific subsections are very readable when you have a concrete question. Read it the way you'd read a man page — to answer "is this defined behavior?", not as bedtime reading.

---

## 15. The takeaway

The spec is written so that the *compiler* and the *JVM* agree on a contract. Most of what we call "Java semantics" is rules in JLS Chapters 8 and 12, plus JVMS Chapters 4 and 5. The vast majority of runtime mysteries — "why isn't my static initializer running?", "why do I see default values from another thread?", "why does this `equals` lie?" — are explicitly defined in the spec. The cure for confusion is almost always **two minutes of finding the right paragraph**.

When you and a coworker disagree about how Java behaves, citing the JLS section number (with quote) ends the argument. That's the spec's job.
