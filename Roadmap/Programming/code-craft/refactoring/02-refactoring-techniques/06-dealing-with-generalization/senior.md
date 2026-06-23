# Dealing with Generalization — Senior Level

> Inheritance hierarchies as architecture, type-driven design, the expression problem, and refactoring closed vs. open systems.

---

## Table of Contents

1. [Hierarchies as architecture](#hierarchies-as-architecture)
2. [Type-driven design and ADTs](#type-driven-design-and-adts)
3. [Open vs. closed hierarchies](#open-vs-closed-hierarchies)
4. [The Diamond Problem and resolution](#the-diamond-problem-and-resolution)
5. [Capability-based design](#capability-based-design)
6. [Refactoring across version boundaries](#refactoring-across-version-boundaries)
7. [Migrating Java legacy hierarchies](#migrating-java-legacy-hierarchies)
8. [Tooling for hierarchy refactoring](#tooling-for-hierarchy-refactoring)
9. [Anti-patterns at scale](#anti-patterns-at-scale)
10. [Review questions](#review-questions)

---

## Hierarchies as architecture

A type hierarchy is a claim about how concepts in your domain relate:

- `Manager extends Employee` — every manager is an employee.
- `interface PaymentMethod` with implementations — multiple ways to pay.
- `sealed Order permits Draft, Submitted, Shipped` — closed set of states.

Senior engineers read hierarchies as architectural statements:

> What I model with classes today determines how features grow tomorrow. Wrong hierarchies make features hard to add. Right hierarchies make them obvious.

### Examples of hierarchy as architecture

- A 5-level deep `EventHandler` hierarchy probably encodes how events were *historically* added — not how they should be processed now.
- A flat hierarchy with 30 sealed subtypes is a sum type — easier to pattern-match than to extend.
- Mixin-heavy code in Python is often architecture by accumulation rather than design.

---

## Type-driven design and ADTs

Modern functional/typed languages encourage **algebraic data types** (ADTs):

```rust
enum Shape {
    Circle { radius: f64 },
    Square { side: f64 },
    Triangle { base: f64, height: f64 },
}
```

```scala
sealed trait Shape
case class Circle(radius: Double) extends Shape
case class Square(side: Double) extends Shape
```

```typescript
type Shape =
  | { kind: 'circle', radius: number }
  | { kind: 'square', side: number };
```

Java 21+:
```java
sealed interface Shape permits Circle, Square {}
record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}
```

### How ADTs change refactoring

- Pull Up / Push Down become less common — each variant is a record with its own data.
- Form Template Method becomes Pattern Matching.
- Extract Interface becomes Trait/Type Class (in Rust/Haskell/Scala).
- Extract Subclass becomes "add a variant."

### When to switch

If your domain has a closed set of variants with **data-driven distinctions**, ADTs are usually cleaner than inheritance. If variants distinguish by *behavior* + extension, classic OO inheritance still wins.

---

## Open vs. closed hierarchies

### Closed (sealed) hierarchies

- Set of subtypes is fixed.
- Compiler enforces exhaustiveness.
- Adding a variant is a breaking change.

Use for: domain primitives (Order states, payment methods), parser AST nodes, error types.

### Open hierarchies

- Anyone can extend.
- Adding a subtype is non-breaking.
- Operations on the type must handle unknown subtypes.

Use for: extension points, plugin architectures, polymorphic dispatch.

### Refactoring direction

- An open hierarchy whose set of subtypes is actually stable → seal it. Get exhaustiveness.
- A sealed hierarchy where third parties want to extend → unseal. Accept the extension risk.

Java's pattern: most domain types are sealed; framework extension points are open.

---

## The Diamond Problem and resolution

```
        A
       / \
      B   C
       \ /
        D
```

If both B and C override A's `method`, what does D inherit?

### Java's solution

No multiple class inheritance. Interfaces with default methods, but conflicts must be explicitly resolved:

```java
interface B { default void foo() { ... } }
interface C { default void foo() { ... } }

class D implements B, C {
    @Override public void foo() { B.super.foo(); }   // explicit
}
```

### Python's solution: MRO

Method Resolution Order via C3 linearization. `D.__mro__` shows the order. Predictable, but understanding it requires careful thought.

### C++'s solution: virtual inheritance

Or "diamond inheritance" — D specifies `virtual` to share A. Many sharp edges.

### Go and Rust's solution: don't have it

No multi-inheritance. Compose / use traits.

### Senior advice

Avoid the diamond when you can. If forced, make the resolution explicit.

---

## Capability-based design

Instead of "Employee inherits from Person," ask: **what capabilities does this code need?**

- Need to call `serialize`? Implement `Serializable`.
- Need to call `bill`? Implement `Billable`.
- Need to call `notify`? Implement `Notifiable`.

This is interface-first design. The class merely declares what it can do.

### In practice

```java
class Employee implements Identifiable, Serializable, Billable {
    // ...
}
```

This is mostly Extract Interface taken to its logical conclusion. Each interface is a capability. Code requires capabilities, not concrete types.

### Trade-offs

- Pro: Easier to test (mock the interface, not the class).
- Pro: Open-Closed Principle — adding a capability is one new interface.
- Con: Many interfaces; the class declaration becomes long.
- Con: Easy to over-extract — every method becomes its own interface.

### Heuristic

Extract an interface when **two or more callers** need only a subset of a class's API. Don't pre-extract.

---

## Refactoring across version boundaries

Hierarchies are often part of public APIs. Changes carry semver weight:

| Change | Impact |
|---|---|
| Pull Up Method (private internals) | None |
| Pull Up Method (public, on a public hierarchy) | MINOR if subclasses still inherit; MAJOR if subclasses defined a different version |
| Push Down Method | MAJOR (callers expecting the parent method now must downcast) |
| Extract Superclass | MINOR (existing classes gain a parent) |
| Collapse Hierarchy | MAJOR (subclass-typed references break) |
| Replace Inheritance with Delegation | MAJOR (consumers using polymorphism break) |

### Strangler Fig at the hierarchy level

```java
@Deprecated
abstract class OldShape { ... }
class OldCircle extends OldShape { ... }

// New API:
sealed interface Shape permits Circle, Square {}
record Circle(double r) implements Shape {}
```

Old API delegates internally to new. Migrate consumers. Eventually delete the old.

---

## Migrating Java legacy hierarchies

Common Java legacy patterns and their modernization:

### Abstract class with one or two subclasses

```java
abstract class Service {
    public final void run() { ... }
    protected abstract void step1();
    protected abstract void step2();
}
```

Often best as: a strategy interface or sealed type.

### `getClass()` checks

```java
if (employee.getClass() == Manager.class) { ... }
```

Type-code smell. Replace with polymorphism (`employee.handle()`) or pattern matching.

### Java Bean inheritance

```java
class A {
    private String x;
    public String getX() { return x; }
    public void setX(String x) { this.x = x; }
}
class B extends A {
    private String y;
    // setX/getX inherited
}
```

Often these classes don't have meaningful overrides — they're just data. Consider records:

```java
record A(String x) {}
record B(String x, String y) {}
```

Records can't extend other classes (intentionally — Java rejects "data inheritance"). Often that's fine for new code.

---

## Tooling for hierarchy refactoring

### IntelliJ IDEA

- **Hierarchy view** (Ctrl+H): see all sub/superclasses.
- **Pull Members Up / Push Members Down** wizards.
- **Convert anonymous to inner / lambda / method reference**.
- **Extract Interface** (Refactor > Extract > Interface).

### Eclipse JDT

Same set, sometimes more thorough on cross-package.

### OpenRewrite

Recipes for hierarchy changes:

```yaml
- org.openrewrite.java.PullUpMethod:
    methodPattern: "..."
    targetClass: "com.example.AbstractBase"
```

### ArchUnit

Encode rules:

```java
@ArchTest
static final ArchRule no_legacy_extends_concrete =
    classes()
      .that().resideInAPackage("..service..")
      .should().notBeAnnotatedWith(Deprecated.class)
      .andShould(have_no_concrete_parent_in("..legacy..");
```

---

## Anti-patterns at scale

### 1. The 7-deep inheritance chain

`A extends B extends C extends D extends E extends F extends G`. Each layer added a "concern." Now changing F's behavior requires understanding all 7 levels.

Cure: **Replace Inheritance with Delegation** in stages, working from the bottom up.

### 2. Diamond imitation

Single-inheritance languages tempt you to "fake" diamond via abstract classes that wrap multiple capabilities. The result is god classes.

Cure: separate capabilities into interfaces.

### 3. Refused Bequest in production

Every time someone added `if (this instanceof X) skip;` to a base class method, they were dealing with a refused bequest. The cure is Push Down.

### 4. Sibling-coupled classes

Class A's method calls into Class B, where both are subclasses of P. Sibling coupling means the hierarchy isn't *really* hierarchical — it's a graph.

Cure: extract a third class to mediate, or refactor toward composition.

### 5. Inheritance-driven test setup

```java
abstract class BaseTest { ... lots of helpers ...}
class FeatureXTest extends BaseTest { ... }
```

Tests inheriting from a common base class is convenient but fragile — when the base test changes, all tests break.

Cure: composition (test fixtures as objects), Spring's `@TestConfiguration`, or test extension model.

---

## Review questions

1. How does a type hierarchy reflect architecture?
2. What are ADTs, and how do they change generalization refactorings?
3. Compare open and closed hierarchies — when each is right.
4. How do different languages handle the diamond problem?
5. What's capability-based design?
6. What's the semver impact of common hierarchy changes?
7. Why is "the 7-deep inheritance chain" an anti-pattern?
8. How do Java records reframe inheritance refactorings?
9. What does `@ArchTest` give you for hierarchy refactoring?
10. Why do test-base-class hierarchies become brittle?
