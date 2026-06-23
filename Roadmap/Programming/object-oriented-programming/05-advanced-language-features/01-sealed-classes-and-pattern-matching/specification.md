# Sealed Classes and Pattern Matching — Specification Reading Guide

> Sealed types and pattern matching are *language features* — every word of behaviour is fixed by the JLS, recorded in the class file by the JVMS, and traceable through a chain of JEPs from Java 15 (first preview) to Java 21 (record patterns, final pattern-match switch). This file maps each language-level guarantee — `permits`, `non-sealed`, `final`/`sealed`/`non-sealed` triad, type patterns, record patterns, exhaustiveness — to the section of the JLS or JVMS that binds it, and to the JEP that proposed it.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                              |
|-----------------------------------------------|---------------------------------------------------|
| `sealed`/`non-sealed`/`final` triad on classes | **JLS §8.1.1.2** — *sealed Classes*               |
| `sealed`/`non-sealed`/`final` triad on interfaces | **JLS §9.1.1.4** — *sealed Interfaces*         |
| `permits` clause                              | JLS §8.1.6, §9.1.4                                |
| Permitted-subclass placement rules            | JLS §8.1.6, §9.1.4 (same module, same package or unnamed module) |
| Switch statements and expressions             | **JLS §14.11** — *The switch Statement*; §15.28 — *Switch Expressions* |
| Switch labels (`case`, `default`, patterns)   | JLS §14.11.1                                      |
| Exhaustiveness for switch                     | **JLS §14.11.1.2**                                |
| Patterns (general)                            | **JLS §14.30** — *Patterns*                       |
| Type patterns                                 | JLS §14.30.2                                      |
| Record patterns                               | JLS §14.30.5                                      |
| Pattern matching in `instanceof`              | JLS §15.20.2                                      |
| `PermittedSubclasses` class-file attribute    | **JVMS §4.7.31**                                  |
| `ACC_SEALED`, `ACC_FINAL`, `ACC_NON_SEALED`   | JVMS §4.1 (access flags on `ClassFile`)           |
| `invokedynamic`                               | JVMS §6.5.invokedynamic                           |
| `SwitchBootstraps.typeSwitch`                 | `java.lang.runtime.SwitchBootstraps` (JDK API)    |
| `MatchException`                              | `java.lang.MatchException` (Java 19+)             |

The JLS binds `javac`; the JVMS binds the JVM; the JEPs trace how the feature arrived at its current shape.

---

## 2. JEP timeline

| JEP | Feature                                       | Java release      | Status         |
|-----|-----------------------------------------------|-------------------|----------------|
| 360 | Sealed classes (preview)                       | Java 15 (Sept 2020) | Preview 1     |
| 397 | Sealed classes (second preview)                | Java 16 (Mar 2021)  | Preview 2     |
| **409** | **Sealed classes (final)**                 | **Java 17 (Sept 2021)** | **Final** |
| 305 | Pattern matching for `instanceof` (preview)    | Java 14 (Mar 2020)  | Preview 1     |
| 375 | Pattern matching for `instanceof` (second preview) | Java 15            | Preview 2     |
| **394** | **Pattern matching for `instanceof` (final)** | **Java 16 (Mar 2021)** | **Final** |
| 406 | Pattern matching for `switch` (preview)        | Java 17             | Preview 1     |
| 420 | Pattern matching for `switch` (second preview) | Java 18             | Preview 2     |
| 427 | Pattern matching for `switch` (third preview)  | Java 19             | Preview 3     |
| 433 | Pattern matching for `switch` (fourth preview) | Java 20             | Preview 4     |
| **441** | **Pattern matching for `switch` (final)** | **Java 21 (Sept 2023)** | **Final** |
| 405 | Record patterns (preview)                       | Java 19             | Preview 1     |
| 432 | Record patterns (second preview)                | Java 20             | Preview 2     |
| **440** | **Record patterns (final)**                | **Java 21 (Sept 2023)** | **Final** |

The reading order: 360 → 397 → 409 for sealing; 394 for `instanceof` patterns; 406 → 441 for switch patterns; 432 → 440 for record patterns. Each JEP is a focused 5–15 page document. Reading the *final* JEP and the previous *preview* gives you the rationale plus the design evolution.

---

## 3. JLS §8.1.1.2 — sealed classes

> **§8.1.1.2 (paraphrased):** A class declaration with the `sealed` modifier introduces a sealed class. A sealed class has an associated set of permitted direct subclasses. Every direct subclass of a sealed class must be declared `final`, `sealed`, or `non-sealed`.

Three rules bind any sealed class:

1. **Closure** — only the classes listed in `permits` (or, if omitted, those declared in the same compilation unit) may directly extend the sealed class.
2. **Modifier requirement** — every direct subclass must be `final`, `sealed`, or `non-sealed`. No subclass may omit all three; the compiler rejects the declaration.
3. **Module/package proximity** — every named permitted subclass must be accessible to the sealed class *and* live in the same module (named module) or in the same package within the unnamed module.

```java
public sealed class Vehicle permits Car, Truck, Motorcycle {}

public final class Car        extends Vehicle {}
public final class Truck      extends Vehicle {}
public non-sealed class Motorcycle extends Vehicle {}   // re-opens
```

If you omit `permits`, the compiler infers it from the same compilation unit:

```java
public sealed class Op { ... }   // permits inferred
final class Add extends Op { ... }
final class Sub extends Op { ... }
```

The inferred list is still recorded in `PermittedSubclasses` (JVMS §4.7.31), so reflection still sees the closure.

---

## 4. JLS §9.1.1.4 — sealed interfaces

> **§9.1.1.4 (paraphrased):** An interface declaration with the `sealed` modifier introduces a sealed interface. Each permitted direct subclass or subinterface must be `final`, `sealed`, or `non-sealed`. Records implementing the interface are implicitly `final`.

The rules mirror sealed classes, with two interface-specific points:

1. **Records as implementers.** Records are *implicitly* `final` (JLS §8.10), so a record may implement a sealed interface without declaring any sealed/final/non-sealed modifier on itself. This is the dominant idiom for ADTs.
2. **`extends` for sub-interfaces.** A `sealed` interface may be extended by another `sealed` or `non-sealed` interface; the same triad applies.

```java
public sealed interface Shape permits Circle, Square, Triangle {}

public record Circle(double r)             implements Shape {}
public record Square(double s)             implements Shape {}
public record Triangle(double b, double h) implements Shape {}
```

`Circle`, `Square`, `Triangle` are implicitly `final` because they're records. No explicit modifier is needed on them.

---

## 5. JLS §8.1.6 / §9.1.4 — permitted-subclass placement

The `permits` clause may name a type T as a permitted direct subclass of S only if:

- T is **accessible** to S (visibility rules of §6.6 apply), and
- T and S are members of the **same module**, if either is in a named module, or
- T and S are members of the **same package** in the unnamed module.

That is: cross-module sealing is forbidden. The rationale is concrete — if a `sealed` type's permits could span modules, the compiler could not verify the closure without loading the entire module graph at every compilation, and downstream modules could *force themselves* into a closed set.

```java
// File: app/Shape.java
package app;
public sealed interface Shape permits app.geom.Circle, app.geom.Square {}

// File: app/geom/Circle.java
package app.geom;
public record Circle(double r) implements app.Shape {}    // OK — same module
```

If `app` is module `M1` and `app.geom` is module `M2`, the declaration fails to compile with:

```
error: class is not allowed to extend sealed class:
       app.Shape (in different module)
```

---

## 6. JVMS §4.7.31 — `PermittedSubclasses` class-file attribute

The closure is recorded at the bytecode level by a class-file attribute named `PermittedSubclasses`. JVMS §4.7.31 defines its layout:

```
PermittedSubclasses_attribute {
    u2 attribute_name_index;        // → "PermittedSubclasses"
    u4 attribute_length;            // = 2 + 2 * number_of_classes
    u2 number_of_classes;
    u2 classes[number_of_classes];  // CONSTANT_Class_info indexes
}
```

The attribute appears in the parent's class file. Each entry is a constant-pool index of a permitted direct subclass.

You can inspect it with `javap -v`:

```
$ javap -v Shape
...
PermittedSubclasses:
    Circle, Square, Triangle
```

Two consequences worth knowing:

- **Runtime closure.** When the JVM loads a permitted subclass, it verifies the parent's `PermittedSubclasses` actually contains it. A handcrafted `.class` file that pretends to extend a sealed class fails verification — sealing is not just a compile-time check.
- **Reflection.** `Class.getPermittedSubclasses()` reads this attribute and returns the array of permitted `Class<?>` objects. The presence of the attribute is what makes `Class.isSealed()` return `true`.

The class file also carries access flags (`ACC_FINAL`, `ACC_SEALED`, `ACC_NON_SEALED`) on every class to indicate which of the three modifiers it carries. `ACC_SEALED` is `0x0001` in the JEP 409 set; final and non-sealed reuse pre-existing flags.

---

## 7. JLS §14.30 — patterns

§14.30 introduces *patterns* as a general construct. A pattern is a "match against a value": it succeeds or fails, and on success it may bind values to variables.

Three pattern kinds (Java 21):

- **Type pattern** (§14.30.2): `T name` — matches if the scrutinee is an instance of `T`, binds `name` to the scrutinee cast to `T`.
- **Record pattern** (§14.30.5): `R(P1, P2, ...)` where R is a record type and each `Pi` is itself a pattern — matches if the scrutinee is an `R` and each component matches the nested pattern.
- **Type pattern with `var`** (§14.30.2): `var name` — matches anything; the type of `name` is inferred from context.

```java
// Type patterns
case Integer i      -> ...
case String s       -> ...

// Record patterns (single level)
case Point(int x, int y) -> ...

// Record patterns (nested)
case Line(Point(int x1, int y1), Point(int x2, int y2)) -> ...

// var in a record pattern
case Point(var x, var y) -> ...
```

The grammar allows arbitrary nesting. The compiler verifies the pattern shape matches the record's *declared* components (in declaration order). You cannot reorder or skip components in a record pattern; if you want to ignore one, use `var _` (unnamed pattern, JEP 443/456, preview in Java 21/22, finalised in Java 22+).

---

## 8. JLS §14.11.1.2 — exhaustiveness

§14.11.1.2 defines when a `switch` is *exhaustive*. The compiler must prove that for every possible value of the scrutinee, at least one case label matches. For a sealed scrutinee `T permits A, B, C`, the static covering of `{A, B, C}` is required.

The exact rule, in plain English:

A set of case labels *exhaustively covers* a sealed type T if for every direct permitted subtype S of T, there is a case label that *covers* S — either explicitly (`case S`) or transitively (`case U` where U is a supertype of S that itself covers S).

Examples:

```java
// T permits A, B, C — exhaustive
case A a -> ...
case B b -> ...
case C c -> ...
```

```java
// T permits Mammal, Bird; Mammal permits Dog, Cat — both forms are exhaustive
case Dog d  -> ...
case Cat c  -> ...
case Bird b -> ...
// or:
case Mammal m -> ...
case Bird b   -> ...
```

```java
// Non-exhaustive — Triangle is missing
case Circle c -> ...
case Square s -> ...
// → compile error: not exhaustive
```

`default` always satisfies exhaustiveness. The compiler accepts it; you usually don't want it on a sealed scrutinee for the reasons in [junior.md](junior.md) and [senior.md](senior.md).

For non-sealed scrutinee types (e.g., `Object`), exhaustiveness can only be reached via `default`. The compiler enforces *total* coverage either way — a switch expression that is not exhaustive fails to compile.

---

## 9. JLS §15.20.2 — `instanceof` patterns

§15.20.2 defines the `instanceof` pattern expression: `e instanceof T t`. The expression evaluates to `true` if `e` is an instance of `T` and not `null`; on `true`, `t` is bound to `e` cast to `T`.

The binding is *flow-sensitive*. JLS §6.3 defines the scope of pattern variables: they are in scope where the test is known to have succeeded. This includes the `if` body, the `||` short-circuit fall-through, and so on.

```java
if (obj instanceof String s && !s.isEmpty()) { ... }   // s in scope here
if (!(obj instanceof String s)) { return; }
useString(s);                                          // s in scope here too
```

A common subtlety: if the scope leaks outside the test, the binding is *not* in scope at every reachable line. The compiler computes scope precisely per §6.3. See [find-bug.md](find-bug.md) for a leak that compiles but surprises.

---

## 10. `java.lang.runtime.SwitchBootstraps` and `MatchException`

Pattern-match `switch` lowers to `invokedynamic` at the bytecode level (JVMS §6.5.invokedynamic). The bootstrap method is `java.lang.runtime.SwitchBootstraps.typeSwitch`:

```java
public static CallSite typeSwitch(
        MethodHandles.Lookup lookup,
        String invocationName,
        MethodType invocationType,
        Object... labels);
```

The labels argument is the array of `case` shapes: `Class<?>` objects for type patterns, integer/string constants for value cases, and synthesized handles for record patterns. The returned `CallSite` exposes a method `(Object scrutinee, int startIndex) -> int` that returns the index of the first matching case.

For sealed scrutinee types, the compiler computes the case order so the bootstrap can answer in `O(N)` for N cases, and the JIT can specialize the lookup further. Subsequent invocations of the call site reuse the cached `MethodHandle`.

`MatchException` (Java 19+, `java.lang.MatchException`) is the runtime safety net. It is thrown when:

- A switch was compiled as exhaustive but at runtime no case matches (binary compatibility break — a new permit appeared).
- A guarded case (`when` clause) was the only candidate but its guard returned `false` at runtime, *and* there is no other matching case.

`MatchException` is a `RuntimeException`. You don't catch it in production code; its appearance indicates either a binary-version mismatch or a guard-coverage bug.

---

## 11. Reading list

1. **JLS §8.1.1.2** — sealed classes; the modifier triad and `permits`.
2. **JLS §9.1.1.4** — sealed interfaces; identical machinery for interfaces.
3. **JLS §8.1.6, §9.1.4** — placement rules for permitted subclasses (module/package proximity).
4. **JLS §14.11** and **§15.28** — switch statements and expressions; `case` label syntax.
5. **JLS §14.11.1.2** — exhaustiveness for sealed scrutinees.
6. **JLS §14.30** — patterns; sub-sections for type patterns (§14.30.2) and record patterns (§14.30.5).
7. **JLS §15.20.2** — `instanceof` pattern expressions and binding scope (§6.3).
8. **JVMS §4.7.31** — `PermittedSubclasses` class-file attribute.
9. **JVMS §6.5.invokedynamic** — the bytecode that lowers pattern-match switch.
10. **JEP 360, 397, 409** — sealed classes from preview to final.
11. **JEP 394** — pattern matching for `instanceof` (final).
12. **JEP 406, 441** — pattern matching for `switch` (preview → final).
13. **JEP 432, 440** — record patterns (preview → final).
14. **`java.lang.runtime.SwitchBootstraps`** — javadoc; the runtime bootstrap method.
15. **Brian Goetz et al.** — *State of the Specialisation* and *State of the Pattern* design documents on openjdk.org. Background reading for why the design is what it is.
16. **Barbara Liskov, John Guttag** — *Abstraction and Specification in Program Development* (MIT Press, 1986) — origin of ADTs as a software-engineering concept.

The spec text is concise — sealed classes occupy under two pages of JLS §8, and the `PermittedSubclasses` attribute is half a page of JVMS §4.7.31. Read them once with `javap -v` in another terminal; they map onto each other one-to-one.

---

**The summary:** the JLS gives you `sealed`, `non-sealed`, `permits`, type patterns, record patterns, and exhaustiveness checking; the JVMS records closure in `PermittedSubclasses` (§4.7.31) and lowers pattern switches through `invokedynamic`; the JDK runtime provides `SwitchBootstraps.typeSwitch` and `MatchException`. JEPs 360/397/409 brought sealing in; JEP 394 brought pattern `instanceof`; JEPs 406/441 brought pattern `switch`; JEPs 432/440 brought record patterns. Every word of behaviour above traces to one of those documents — no implementation accidents, no hidden semantics.
