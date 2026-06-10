# Final Keyword — Specification Deep-Dive

> `final` rules live in **JLS §4.12.4** (final variables), **§8.1.1.2** (final classes), **§8.4.3.3** (final methods), **§8.3.1.2** (final fields), **§14.4** (local variable declarations), and most importantly **§17.5** (final field semantics in the JMM). Bytecode rules in **JVMS §4.5/§4.6** (`ACC_FINAL` flag) and **§4.10/§6.5** (verification rules around final fields).

---

## 1. Where the rules live

| Concept                                  | Source                                |
|------------------------------------------|---------------------------------------|
| Final variables (locals, parameters, fields) | **JLS §4.12.4**                   |
| Final classes                            | **JLS §8.1.1.2**                      |
| Final methods                            | **JLS §8.4.3.3**                      |
| Final fields                             | **JLS §8.3.1.2**                      |
| Definite assignment (final fields/vars)  | **JLS §16**                           |
| Final field semantics in the JMM         | **JLS §17.5**                         |
| Compile-time constants                   | JLS §4.12.4, §13.4.9, §15.28          |
| Sealed and final interaction             | JLS §8.1.1.1, §8.1.1.2, §8.1.1.4      |
| Class file `ACC_FINAL` flag              | JVMS §4.1, §4.5, §4.6                  |
| `ConstantValue` attribute                | JVMS §4.7.2                            |
| Verifier: final field write rules        | JVMS §4.10.1.9, §6.5 (`putfield`/`putstatic`) |

---

## 2. JLS §4.12.4 — Final variables

A *final* variable is one whose value cannot be changed after it has been initialized:

> *Once a final variable has been assigned, it always contains the same value. If a final variable holds a reference to an object, then the state of the object may be changed by operations on the object, but the variable will always refer to the same object.*

Three categories:

- **Final fields** (instance or static): assigned exactly once during construction or `<clinit>`.
- **Final local variables**: assigned exactly once before any read.
- **Final parameters**: cannot be reassigned within the method body.

The "exactly once" requirement is enforced by the *definite assignment* rules (JLS §16). Any read of a final variable that the compiler cannot prove is preceded by a write produces a compile error.

---

## 3. JLS §8.1.1.2 — Final classes

> *The class can have no subclasses. Records (§8.10) are implicitly final.*

A final class:
- Cannot be extended via `extends`.
- Has the `ACC_FINAL` flag in its class file.
- Plays well with the JIT (no CHA dependency).

Mutually exclusive with `abstract` (an abstract class must be extended) and with `sealed` (sealed allows specific subtypes, while final allows none).

`record` types are implicitly final per JLS §8.10:

> *A record class is implicitly final.*

You cannot extend a record. You can implement interfaces.

---

## 4. JLS §8.4.3.3 — Final methods

> *A final method cannot be overridden or hidden.*

A final method:
- Cannot be overridden by a subclass.
- Cannot be hidden by a subclass's static method (for static methods; though static methods can never be "overridden" anyway).
- Has the `ACC_FINAL` flag in its class file.

Mutually exclusive with `abstract` (abstract requires override; final forbids it).

A `private` method is implicitly non-overridable (it's not visible to subclasses), so marking it `final` is redundant — though some style guides allow it.

---

## 5. JLS §8.3.1.2 — Final fields

> *A field can be declared final. Both class and instance variables (static and non-static fields) may be declared final.*

Constraints:

- Must be definitely assigned (JLS §16) by the end of construction (instance fields) or static initialization (static fields).
- Cannot be reassigned after initial assignment.
- Cannot also be `volatile` (mutually exclusive).
- Cannot be a parameter or local that's reassigned.

A final instance field:
- Default-initialized to its type's default value during object allocation.
- Assigned by `<init>` (the constructor and instance initializer code).
- Read freely by any method.
- Verifier rejects `putfield` to a final instance field outside `<init>` of the same class.

A final static field:
- Default-initialized during class preparation.
- If a *compile-time constant* (primitive or `String` with constant initializer), the JVM uses the `ConstantValue` attribute to set it at link time, before `<clinit>`.
- Otherwise assigned by `<clinit>`.
- Verifier rejects `putstatic` to a final static field outside `<clinit>` of the same class.

---

## 6. JLS §17.5 — Final field semantics

The single most important section for concurrent Java:

> *Let `o` be an object, and `c` be a constructor for `o`'s class in which a write `w` occurs to a `final` field of `o`. A "freeze" action `f` on `w` occurs at the end of `c`. Note that if a constructor finishes by throwing an exception, the freeze still occurs. (...)*
>
> *If a thread reads a `final` field after the freeze, it sees the value that was written.*

Concretely:

- If thread T1 constructs an object `o` and the constructor doesn't let `o` escape, then any thread T2 that observes `o` after T1's constructor finishes is guaranteed to see all `final` field values set during construction — without explicit synchronization.
- Non-final fields don't get this guarantee. Without synchronization, T2 may see them at default values indefinitely.

The catch: *escape*. If T1 publishes `o` (e.g., assigns to a static field, registers with a callback, starts a thread that uses `o`) *before* the constructor finishes, T2 may see partially-constructed state. The freeze rule only protects post-construction observers.

---

## 7. JLS §15.28 / §4.12.4 — Compile-time constants

A *constant variable* is a `static final` variable of primitive or `String` type, initialized with a constant expression. The compiler:

1. Inlines its value at every read site (no `getstatic`).
2. Records the value in the class file's `ConstantValue` attribute.
3. Allows constant folding in expressions involving it.

Example:

```java
public class Limits {
    public static final int MAX = 100;
    public static final int DOUBLED = MAX * 2;       // also a constant: 200
}
```

Both `MAX` and `DOUBLED` are constant variables. References to them in other classes are inlined.

Implications:

- Reading a constant does *not* trigger class initialization (JLS §12.4.1 explicitly excludes constant variable access from the trigger list).
- Updating a constant value requires recompiling all consumers.
- For values that may change between releases, prefer non-final or method-based exposure.

---

## 8. JVMS §4.1, §4.5, §4.6 — `ACC_FINAL` flag

The `ACC_FINAL = 0x0010` flag bit appears in:

- `ClassFile.access_flags` for final classes.
- `field_info.access_flags` for final fields.
- `method_info.access_flags` for final methods.

Constraints:

- Class: `ACC_FINAL` is mutually exclusive with `ACC_INTERFACE` and `ACC_ABSTRACT`.
- Field: `ACC_FINAL` is mutually exclusive with `ACC_VOLATILE`.
- Method: `ACC_FINAL` is mutually exclusive with `ACC_ABSTRACT`.

Inspect with `javap -v MyClass.class`. The flags appear as a hex value plus a comment listing the names.

---

## 9. JVMS §6.5 — Verifier rules for `putfield`/`putstatic`

For instance final fields (`putfield`, JVMS §6.5):

> *If the field is `final`, it must be declared in the current class, and the instruction must occur in an instance initializer method (`<init>`) of the current class.*

For static final fields (`putstatic`, JVMS §6.5):

> *If the field is `final`, it must be declared in the current class, and the instruction must occur in the class initializer (`<clinit>`) of the current class.*

The verifier rejects classes that violate these rules at class-load time, throwing `VerifyError`.

This is what makes "final fields are written exactly once" a hard JVM-level guarantee, not just a compiler suggestion.

---

## 10. Records' final fields (JVMS §4.7.30)

Records (since Java 16) introduce special treatment:

- The class is implicitly `final`.
- Component fields are `private final`.
- The canonical constructor's `<init>` writes the components.
- The `Record` attribute (JVMS §4.7.30) lists the components.

The verifier accepts the canonical constructor's writes because they happen in `<init>` of the same class.

Reflection's `Class.getRecordComponents()` returns metadata derived from the `Record` attribute. Frameworks like Jackson use this for JSON deserialization.

---

## 11. Sealed classes and final (JLS §8.1.1.4)

A sealed class declaration constrains its subclasses:

```
SealedClassDeclaration:
    {ClassModifier} sealed class TypeIdentifier ... [PermitsClause]
```

Each permitted subclass must declare exactly one of:

- `final` — closes the line of inheritance.
- `sealed` (with its own `permits`) — restricts further extension.
- `non-sealed` — re-opens for extension.

The compiler enforces this at compile time. The verifier enforces it via the `PermittedSubclasses` attribute (JVMS §4.7.31) at class-load time — a class declaring a `permits` clause that doesn't match its actual subclasses is rejected.

---

## 12. JLS §16 — Definite assignment

The compiler proves at compile time that every read of a final variable is preceded by exactly one write. Example failure:

```java
public class Foo {
    private final int x;
    public Foo(boolean cond) {
        if (cond) x = 1;
        // x might not be assigned if cond is false
    }
}
```

Compile error: "variable x might not have been initialized."

Definite assignment rules:

- Direct assignments (`x = ...`) count as definite.
- Both branches of `if`/`else` must assign.
- Loop bodies that may not execute don't count.
- Method calls don't help — the compiler doesn't analyze them.

Use `final` to *force* yourself to think about every initialization path. The compiler is on your side.

---

## 13. The mutually exclusive table

| Modifier | Excludes                                       |
|----------|------------------------------------------------|
| `final` (class) | `abstract`, `sealed`, `non-sealed`        |
| `final` (method) | `abstract`                                |
| `final` (field) | `volatile`                                  |
| `sealed` (class) | `final`, `non-sealed`                       |
| `non-sealed` (class) | `final`, `sealed`                       |
| `abstract` (class) | `final`                                   |
| `abstract` (method) | `final`, `static`, `private`, `synchronized`, `native` |

The compiler enforces these. Most are obvious; `final` + `volatile` is a common attempted misuse.

---

## 14. `private` is implicitly final-like

A `private` method:
- Cannot be overridden (it's not visible to subclasses).
- Is dispatched via `invokespecial` (direct, not virtual).

So `private` and `final` have similar runtime behavior for methods — both produce direct calls. Marking a private method `final` is technically allowed but stylistically redundant.

---

## 15. Reading order

1. **JLS §4.12.4** — final variables (foundational).
2. **JLS §8.3.1.2** — final fields.
3. **JLS §8.4.3.3** — final methods.
4. **JLS §8.1.1.2** — final classes.
5. **JLS §17.5** — final field memory model. (Critical for concurrent code.)
6. **JLS §16** — definite assignment.
7. **JVMS §4.5, §4.6** — class file flags.
8. **JVMS §6.5** — verifier rules.

These sections are short and dense. Reading them once is enough to handle 95% of `final`-related questions.

---

## 16. The takeaway

`final` has four distinct semantic faces:

1. **Compiler enforcement** (definite assignment, no reassignment): JLS §4.12.4, §16.
2. **Verifier enforcement** (no `putfield`/`putstatic` on final fields outside `<init>`/`<clinit>`): JVMS §6.5.
3. **JMM guarantee** (freeze rule for safe publication): JLS §17.5.
4. **Compile-time constant inlining** (for `static final` primitives/strings): JLS §13.4.9, §15.28.

Each face is enforced independently — at compile time, link time, run time, and across compilation units. Together they make `final` one of Java's most rigorously enforced semantic commitments. Understand the four faces, and you understand `final` completely.
