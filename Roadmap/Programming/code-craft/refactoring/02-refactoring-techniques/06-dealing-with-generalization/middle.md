# Dealing with Generalization — Middle Level

> When inheritance is wrong, when delegation is wrong, the Liskov Substitution Principle in practice, and the trade-offs of each technique.

---

## Table of Contents

1. [The "is-a" test](#the-is-a-test)
2. [Liskov Substitution Principle](#liskov-substitution-principle)
3. [Composition over inheritance — but not always](#composition-over-inheritance-but-not-always)
4. [The fragile base class problem](#the-fragile-base-class-problem)
5. [Form Template Method vs. Strategy](#form-template-method-vs-strategy)
6. [Extract Interface vs. Extract Superclass](#extract-interface-vs-extract-superclass)
7. [Multiple inheritance and mixins](#multiple-inheritance-and-mixins)
8. [Sealed types as constrained inheritance](#sealed-types-as-constrained-inheritance)
9. [When to Collapse vs. when to keep](#when-to-collapse-vs-when-to-keep)
10. [Review questions](#review-questions)

---

## The "is-a" test

Before applying any inheritance refactoring, ask: **"Is this subclass *really* an X?"**

- Penguin "is-a" Bird? Yes — but a Penguin doesn't fly. If `Bird.fly()` is in the parent, you've broken LSP.
- Square "is-a" Rectangle? Mathematically yes, behaviorally no — `setWidth(5)` on a Rectangle changes one dimension; on a Square it must change both.
- Stack "is-a" Vector? No — Vector lets you reach into the middle; Stack shouldn't.

When the "is-a" test fails, use **delegation** instead.

### Practical heuristic

> If you'd be embarrassed to substitute the subclass for the parent in any context, it's not really a subclass.

---

## Liskov Substitution Principle

LSP (Barbara Liskov, 1987): **objects of subclasses should be replaceable for objects of superclasses without altering correctness**.

### Subtle violations

```java
class Bird { public void fly() { ... } }
class Penguin extends Bird { 
    public void fly() { throw new UnsupportedOperationException(); }
}
```

A function `flyAround(Bird b) { b.fly(); }` works for Sparrow, fails for Penguin. **LSP violation.**

Fix: extract `Flyer` interface that only flying birds implement.

```java
interface Bird {}
interface Flyer { void fly(); }
class Sparrow implements Bird, Flyer { ... }
class Penguin implements Bird { ... }   // not a Flyer
```

### Pre/post-conditions

LSP also requires:
- Subclass preconditions can't be **stricter** than parent's.
- Subclass postconditions can't be **looser** than parent's.

If `Parent.deposit(double amount)` accepts any positive amount, `Subclass.deposit` can't suddenly require `amount > 100`.

### Tools

ArchUnit (Java), `golangci-lint` (Go), pylint (Python with strict mode) can encode LSP rules as fitness tests.

---

## Composition over inheritance — but not always

The mantra "favor composition over inheritance" (GoF) is right *most* of the time. Inheritance is a strong claim that:
1. The subclass IS-A the parent (LSP).
2. The subclass benefits from the parent's full API.
3. The subclass changes when the parent changes.

When any of these fails, use composition.

### When inheritance wins

- **Polymorphic dispatch.** A `List<Shape>` calling `.area()` per shape is cleaner than tagged unions in many languages.
- **Template Method.** Reusing skeleton + customizing steps is awkward without inheritance.
- **Frameworks.** Many frameworks (Spring, JUnit) use inheritance for hooks.

### When composition wins

- **Multi-axis variation.** A `Logger` may vary by Format AND Destination AND Level — composition lets you mix freely.
- **Runtime-changeable behavior.** Strategy/State patterns are about composition.
- **Selective API.** Stack-as-vector example.

### Replace Inheritance with Delegation as default

If you're unsure, start with composition. Adding inheritance later is easy; removing it after a hierarchy has solidified is painful.

---

## The fragile base class problem

A change to a base class can break subclasses *invisibly*. Common scenarios:

### Method addition

```java
abstract class Bird {
    public void chirp() { ... }
    public void chirpTwice() { chirp(); chirp(); }
    // newly added:
    public void chirpThrice() { chirp(); chirp(); chirp(); }
}

class Penguin extends Bird {
    public void chirp() { ... }
    public void chirpTwice() { /* override */ }
}
```

Adding `chirpThrice` to Bird means Penguin now has a method it never asked for, possibly with wrong behavior. The base class's evolution forces subclass evolution.

### Implementation reuse

```java
abstract class Counter {
    protected int count = 0;
    public int total() { return count; }
    public void incr() { count++; }
}

class TwoCounter extends Counter {
    public void incrTwo() { incr(); incr(); }   // assumes incr is the way to add
}
```

Now Counter's author refactors `incr` to call a new internal method:
```java
public void incr() { addBy(1); }
public void addBy(int n) { count += n; }
```

`TwoCounter.incrTwo()` still works. But if Counter's author then optimizes `incrBy(2)` to skip `incr()`:
```java
public void incrBy(int n) { count += n; }
```

`TwoCounter` now uses two `incr()` calls when one `incrBy(2)` would do. The "subclass leaks" the internal implementation choice of the parent.

### Cure

- **`final` methods** — base class declares which methods can't be overridden.
- **Sealed hierarchies** — explicit allowed subclasses.
- **Composition** — sidesteps the fragile base class entirely.

---

## Form Template Method vs. Strategy

Both let subclasses customize behavior; they differ in *direction*.

### Form Template Method

Subclass *implements steps* of a parent-defined skeleton.

```java
abstract class Statement {
    public final String emit(Customer c) {
        return header(c) + lines(c) + footer(c);
    }
    protected abstract String header(Customer c);
    protected abstract String lines(Customer c);
    protected abstract String footer(Customer c);
}
```

Use when:
- The skeleton (algorithm shape) is invariant.
- Variations are at well-defined points.
- The variations naturally cluster (each subclass = one variant).

### Strategy

Caller *injects* the variant.

```java
interface Statement {
    String emit(Customer c);
}
class TextStatement implements Statement { ... }
class HtmlStatement implements Statement { ... }

// Caller:
Statement s = new TextStatement();
s.emit(c);
```

Use when:
- Variants are independent.
- Choice happens at runtime.
- Composition over inheritance.

### Difference

Template Method = "subclass fills holes in parent's algorithm."
Strategy = "caller picks an algorithm; algorithm doesn't care about caller."

Template Method has a fragile base class problem (changing the skeleton may break subclasses). Strategy doesn't.

> Most modern code prefers Strategy. Template Method is still useful for frameworks (e.g., Spring's `JdbcTemplate`).

---

## Extract Interface vs. Extract Superclass

### Extract Superclass

When two classes share **state and behavior**, and an "is-a" makes sense.

```java
class Department extends Party { ... }
class Employee extends Party { ... }
abstract class Party { protected String name; ... }
```

### Extract Interface

When two classes share **only behavior**, no shared state, or the classes are unrelated.

```java
interface Billable { Money rate(); int days(); }
class Employee implements Billable { ... }
class Contract implements Billable { ... }
```

### When in doubt

Extract Interface first. It's the lighter commitment. If a shared *implementation* emerges, you can later Extract Superclass that implements the interface.

### Multiple interfaces

A class can implement many interfaces (Java, C#, Go). You pay no "is-a" tax — interfaces are pure protocols.

---

## Multiple inheritance and mixins

### Java / C# / Go

- Java: no multi-inheritance of state. Multiple interfaces (with default methods, Java 8+).
- C#: same.
- Go: no inheritance; embedding + interfaces.

### Python / C++

Multiple inheritance of full classes. Powerful and dangerous.

### Mixins

A mixin is a class designed to be inherited *with* another class for shared behavior.

```python
class JsonSerializable:
    def to_json(self): return json.dumps(self.__dict__)

class Saveable:
    def save(self, db): db.save(self)

class User(JsonSerializable, Saveable):
    def __init__(self, name): self.name = name
```

User is now JSON-serializable and Saveable.

### When mixins help

- Cross-cutting capabilities (serialization, logging, comparison).
- Languages with multi-inheritance + MRO (method resolution order).

### When they hurt

- The mixin's expectations conflict with each other (diamond problem).
- Code becomes hard to trace (which class implements `save`?).

In Java/Go, the equivalent is interfaces with default methods or embedding, with explicit method calls.

---

## Sealed types as constrained inheritance

Java 17+, Kotlin, Scala have **sealed types** — explicit list of subclasses.

```java
sealed interface Shape permits Circle, Square, Triangle {}
```

Benefits:
- Exhaustive `switch`/`match` (compile-time guarantee).
- Inheritance hierarchy is closed; you can't surprise a base class with a new subclass.
- Pattern matching is cleaner than visitor.

When to use sealed:
- The set of variants is genuinely closed.
- You want pattern matching to be exhaustive.
- You're modeling sum types in domain code.

When not:
- The hierarchy is open (third parties extend).
- The variants vary in implementation, not just type.

---

## When to Collapse vs. when to keep

### Collapse Hierarchy is right when

- Subclass adds nothing meaningful.
- Hierarchy was created speculatively.
- Tests pass with the merged version.

### Keep the hierarchy when

- Distinct subclasses serve as compile-time tags (e.g., `OrderId` vs. `CustomerId` are both Strings but should be type-distinct).
- Polymorphism dispatch is still useful.
- The hierarchy is part of a public contract.

### Heuristic

If subclasses don't override anything *and* don't add anything, Collapse. Otherwise, keep.

---

## Review questions

1. What's the "is-a" test? Give an example where it fails.
2. Explain Liskov Substitution Principle with a concrete violation.
3. When is "favor composition over inheritance" wrong?
4. What's the fragile base class problem?
5. Compare Template Method and Strategy.
6. When is Extract Interface better than Extract Superclass?
7. What are mixins, and what's the diamond problem?
8. How does sealed inheritance change the design space?
9. When should you Collapse Hierarchy?
10. What's the "default": composition or inheritance?
