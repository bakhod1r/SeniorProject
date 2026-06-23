# Sealed Classes and Pattern Matching — Junior

> **What?** *Sealed* types are classes or interfaces that declare an explicit, *closed* list of permitted direct subtypes via a `permits` clause. *Pattern matching* — for `instanceof` and `switch` — destructures and tests those subtypes in a way the compiler can check for completeness. Together, they give you the slogan **closed inheritance, exhaustive dispatch**: you decide upfront which variants exist, and the compiler refuses to let you forget one.
> **How?** Mark a parent type `sealed` and list its children in `permits`. Mark each child `final`, `sealed` (with its own `permits`), or `non-sealed`. Switch over the parent with patterns: `case Circle c -> ...; case Square s -> ...;`. If you cover every permitted child, no `default` is needed — and adding a new child breaks every switch until you update it.

---

## 1. The point of sealed types in one sentence

Open inheritance — `class Foo extends Bar` from anywhere on the classpath — is a powerful but expensive default. It means a library author who ships `Bar` can never know all of its subclasses, the compiler can never check that a switch covers every case, and the JIT cannot devirtualize call sites without aggressive profiling. Sealed types invert that default: you *opt in* to extension, by name, in the parent's source file.

In return, the compiler can prove your `switch` is exhaustive, the JIT can specialize dispatch over a finite set, and your future self can read one file and know *every* shape this type can take. Sealed + records + pattern switch is Java's spelling of *algebraic data types* — sum types (`sealed`) of product types (`record`).

The feature was previewed in Java 15 (JEP 360), refined in Java 16 (JEP 397), and finalized in Java 17 (JEP 409). Pattern matching for `instanceof` shipped in Java 16 (JEP 394); pattern matching for `switch` previewed in Java 17 (JEP 406) and finalized in Java 21 (JEP 441).

---

## 2. The first example — `Shape`

```java
public sealed interface Shape permits Circle, Square, Triangle {}

public record Circle(double radius)            implements Shape {}
public record Square(double side)              implements Shape {}
public record Triangle(double base, double height) implements Shape {}
```

Three things are happening:

- `Shape` is `sealed`. Only the types named in `permits` may implement it. A fourth `class Hexagon implements Shape {}` would not compile.
- Each permitted child is `final` (records are implicitly final). That ends the hierarchy — no `permits` clause is needed on a leaf.
- The list is *visible* in the parent's source. Open a single file and you see the full sum.

You can also seal classes, not just interfaces:

```java
public sealed abstract class Vehicle permits Car, Truck, Motorcycle {}
public final class Car        extends Vehicle {}
public final class Truck      extends Vehicle {}
public final class Motorcycle extends Vehicle {}
```

The mechanics are identical: a closed list of children, the compiler enforces it.

---

## 3. Pattern matching for `instanceof`

Before Java 16 you wrote a redundant cast after every `instanceof`:

```java
// Pre-16 — write the same type twice
if (s instanceof Circle) {
    Circle c = (Circle) s;          // cast, even though instanceof just confirmed it
    System.out.println(c.radius());
}
```

Java 16 introduced the *type pattern* (JEP 394). Bind the test result to a variable in one step:

```java
if (s instanceof Circle c) {        // c is in scope only if the test passed
    System.out.println(c.radius());
}
```

The variable `c` is *definitely assigned* and typed as `Circle` inside the `if` branch. Outside the branch, `c` is out of scope. The cast is gone and the typo opportunity is gone with it.

---

## 4. Pattern matching for `switch`

The bigger payoff is pattern matching in `switch` expressions (JEP 441, final in Java 21):

```java
public static double area(Shape s) {
    return switch (s) {
        case Circle c   -> Math.PI * c.radius() * c.radius();
        case Square sq  -> sq.side() * sq.side();
        case Triangle t -> 0.5 * t.base() * t.height();
    };
}
```

Read each `case` as "if `s` is of this shape, bind it to this name, evaluate this expression". The compiler verifies that *every* permitted subtype of `Shape` appears at least once. Forget `Triangle` and you get:

```
error: the switch expression does not cover all possible input values
```

No `default` is needed. The compiler proved you covered everything.

---

## 5. The newcomer surprise — no `default` for exhaustive sealed switches

Pre-21 Java taught you that every `switch` needs a `default`. With sealed types and pattern matching, this is no longer true — *and* you usually don't want one. Compare:

```java
// Wrong instinct — adds a default "just in case"
return switch (s) {
    case Circle c   -> Math.PI * c.radius() * c.radius();
    case Square sq  -> sq.side() * sq.side();
    case Triangle t -> 0.5 * t.base() * t.height();
    default         -> 0.0;          // silently swallows new shapes
};
```

```java
// Right instinct — let the compiler check completeness
return switch (s) {
    case Circle c   -> Math.PI * c.radius() * c.radius();
    case Square sq  -> sq.side() * sq.side();
    case Triangle t -> 0.5 * t.base() * t.height();
};
```

The second form is *better* than the first. If someone later adds `Pentagon` to `permits`, the *with-default* version silently returns 0.0 for pentagons; the *no-default* version refuses to compile until you handle the new case. Letting the compiler track completeness is the entire point.

---

## 6. The three modifiers permitted children must pick

Every named permit must declare one of three modifiers:

| Modifier     | Means                                                                  |
|--------------|------------------------------------------------------------------------|
| `final`      | This child has no further subclasses. The hierarchy stops here.        |
| `sealed`     | This child has its own `permits` list. Extension is deeper but still closed. |
| `non-sealed` | This child opens up again — anyone may extend it. Use sparingly.       |

```java
public sealed interface Animal permits Mammal, Bird {}

public sealed interface Mammal extends Animal permits Dog, Cat {}
public record Dog() implements Mammal {}
public record Cat() implements Mammal {}

public non-sealed interface Bird extends Animal {}   // anyone can be a Bird now
```

A child without one of the three modifiers does not compile. That forces you to declare your closure intent explicitly at every level.

---

## 7. Why no `default` is a feature, not a missing safety net

The compiler tracks `permits` as part of `Shape`'s type information. When it sees `switch (s)` over `Shape`, it asks: "have you handled every permitted subtype?" If yes, the switch is *exhaustive* and complete; if no, compilation fails.

This is more than convenience. It means the *act of adding a new variant* surfaces every place in your codebase that needs updating. Add `Pentagon` to `permits`, recompile, and you get a list of every switch that needs a new case. With a string-keyed switch or a `default`-swallowing version, you would never find them all.

This compiler-enforced completeness is what people mean when they say sealed types give you *algebraic data types*: like Haskell's `data`, OCaml's variants, or Rust's `enum`, the language refuses to let you forget a case.

---

## 8. A tiny realistic example — a `Result` type

A common idiom: return either a success or a failure without exceptions.

```java
public sealed interface Result<T> permits Result.Success, Result.Failure {

    record Success<T>(T value)        implements Result<T> {}
    record Failure<T>(String message) implements Result<T> {}
}

public static <T> void handle(Result<T> r) {
    switch (r) {
        case Result.Success<T> s -> System.out.println("ok: " + s.value());
        case Result.Failure<T> f -> System.err.println("fail: " + f.message());
    }
}
```

Two children, both records, declared right inside the interface. Callers cannot invent a third variant; the compiler enforces both cases on every switch. We expand `Result<T, E>` and explore richer error modelling in [middle.md](middle.md).

---

## 9. Common newcomer mistakes

**Mistake 1: forgetting to seal the children.**

```java
sealed interface Op permits Add, Sub {}
class Add implements Op {}     // compile error — no final/sealed/non-sealed
```

Every permitted child must pick exactly one of `final`, `sealed`, or `non-sealed`. Records satisfy this automatically (records are implicitly final).

**Mistake 2: adding `default` "for safety".**

```java
return switch (shape) {
    case Circle c -> area(c);
    case Square s -> area(s);
    default       -> 0.0;     // hides the next variant from the compiler
};
```

Delete the `default` if your switch covers a sealed type. The compiler is your safety net; the `default` removes it.

**Mistake 3: permitting from a different package without a module.**

If `Shape` and `Circle` are in different packages of the same unnamed module, the compiler complains. Same-package or same-module is required. See [specification.md](specification.md) for the exact rule.

**Mistake 4: confusing `final` and `sealed`.**

`final` and `sealed` are different statements. `final` says "no children". `sealed` says "only the children I name". A `sealed` parent and a `final` child both contribute to closure but at different levels.

---

## 10. Quick rules

- [ ] Use `sealed` whenever you have a *closed* set of subtypes you control — payment methods, AST nodes, command types, result variants.
- [ ] Pair `sealed` with `record` whenever children are data carriers — you get product+sum types in two keywords.
- [ ] Every permitted child must pick `final`, `sealed`, or `non-sealed`. Records are implicitly `final`.
- [ ] In a `switch` over a sealed type, omit `default`. Let the compiler enforce exhaustiveness.
- [ ] Use `if (x instanceof Foo f)` to shrink instanceof-then-cast chains.
- [ ] `permits` is part of the parent's *contract* — adding to it can be a breaking change for downstream consumers (see [senior.md](senior.md)).

---

## 11. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| `Result<T, E>`, ADTs, record patterns, refactoring `instanceof` chains | `middle.md`        |
| Closed-world dispatch internals, `non-sealed`, binary compat        | `senior.md`        |
| Code-review vocabulary, ArchUnit rules, migration                   | `professional.md`  |
| JLS §8.1.1.2, §9.1.1.4, JVMS §4.7.31, JEPs 360/397/409/394/406/440/441 | `specification.md` |
| Sealed hierarchies that bite at runtime                              | `find-bug.md`      |
| `SwitchBootstraps.typeSwitch`, devirtualization, JMH benchmarks     | `optimize.md`      |
| Hands-on exercises                                                  | `tasks.md`         |
| Interview Q&A                                                       | `interview.md`     |

Cross-references:

- Sealed types are the modern *composition over inheritance* answer for closed taxonomies — see [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).
- Pattern-match `switch` lowers to `invokedynamic` with `SwitchBootstraps.typeSwitch` — see [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/).
- Module-system rules constrain where permitted subclasses may live — see [../02-jpms-modules/](../02-jpms-modules/).

---

**Memorize this:** sealed types are *closed inheritance by design* — you list the children in `permits`, each child picks `final`/`sealed`/`non-sealed`, and the compiler enforces it. Pattern matching turns that closure into *exhaustive dispatch* — every `switch` is checked for completeness, no `default` needed. Together they give Java algebraic data types: sum-of-products you can read in one file and update with the compiler's help.
