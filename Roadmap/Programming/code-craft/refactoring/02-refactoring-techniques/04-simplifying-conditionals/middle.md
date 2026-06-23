# Simplifying Conditional Expressions — Middle Level

> Real-world triggers, when to use guard clauses vs. nested ifs, and the deeper trade-offs of polymorphism, null object, and assertions.

---

## Table of Contents

1. [The order of application](#the-order-of-application)
2. [Real-world triggers](#real-world-triggers)
3. [Guard clauses vs. single-return discipline](#guard-clauses-vs-single-return-discipline)
4. [When polymorphism is wrong](#when-polymorphism-is-wrong)
5. [Null Object vs. Optional vs. throwing](#null-object-vs-optional-vs-throwing)
6. [Assertions, contracts, and Design by Contract](#assertions-contracts-and-design-by-contract)
7. [Pattern matching as a modern alternative](#pattern-matching-as-a-modern-alternative)
8. [Combinators and functional alternatives](#combinators-and-functional-alternatives)
9. [Language-specific notes](#language-specific-notes)
10. [Review questions](#review-questions)

---

## The order of application

A typical 80-line method full of nested ifs:

1. **Replace Nested Conditional with Guard Clauses** — flatten as many layers as possible.
2. **Consolidate Conditional Expression** — merge sibling ifs with the same body.
3. **Decompose Conditional** — name the surviving conditions.
4. **Consolidate Duplicate Conditional Fragments** — pull common code out.
5. **Replace Conditional with Polymorphism** — if the dispatch is on a type code.
6. **Introduce Null Object** — eliminate null-check forks if appropriate.
7. **Introduce Assertion** — codify any invariants you discovered while reading.

After this sweep, the method should be 5–15 lines, with the structure obvious.

---

## Real-world triggers

### 1. "I can't tell what the failure modes are"

A method has 8 branches and 4 of them throw exceptions for different reasons. Decompose Conditional + Consolidate makes the failure modes a numbered list.

### 2. "Adding a new type required changes in 11 places"

That's [Shotgun Surgery](../../01-code-smells/03-change-preventers/junior.md). The cure is Replace Conditional with Polymorphism — each type owns its behavior.

### 3. "We had a NullPointerException in production again"

The 6th time this quarter. The cure varies:
- For optional values: use `Optional` and `.map()`.
- For "default behavior" callers: Introduce Null Object.
- For explicit absence checks: `if (x == null)` is fine *if* it's at one boundary.

### 4. "Reading this method, I lost track at line 30"

The cure: nesting depth too high. Apply Replace Nested Conditional with Guard Clauses. Aim for at most 2 indent levels.

### 5. "Two devs interpreted the same comment differently"

Comments rot, especially in conditionals. Convert them to named methods (Decompose Conditional) so the IDE refuses to let them get out of sync.

---

## Guard clauses vs. single-return discipline

Some teams (especially in safety-critical domains: aerospace, medical) follow **single-entry-single-exit (SESE)** — one return per function. In those teams:

- Guard clauses are forbidden.
- Decompose Conditional is preferred.
- The "main path" is an explicit `result = ...` accumulating.

For most modern code, SESE is more obstacle than benefit:
- Guard clauses make preconditions visible.
- Reader's eye scans top-to-bottom; "if X, return early" is naturally readable.
- Forced single-return often produces a dummy `return result;` after a switch.

### When SESE is right

- The function has a single calculation that branches in the middle but always produces a result.
- Resource management (file close, mutex release) is easier with single-exit (though `try-finally` and RAII handle it now).

### When guard clauses win

- Multiple early-out cases (validation, edge cases).
- The "main work" is genuinely the bulk; edges are special.

### Heuristic

> **Use guard clauses for special cases (preconditions). Use single-return for symmetric branches in a calculation.**

---

## When polymorphism is wrong

Replace Conditional with Polymorphism is the iconic refactoring, but it's not always right.

### When it shines

- Adding a new variant should be one new file (open-closed principle).
- Per-type behavior is non-trivial (formulas, validation, side effects).
- The set of types is open (likely to grow).

### When it's overkill

- Two cases, both simple. A `switch` is clearer.
- The "type" is an enum value, not a class. An enum with abstract methods is enough.
- The dispatch is on multiple axes (type AND state) — Polymorphism gives you a 2D matrix, which is awkward.

### When it's wrong

- The "types" don't form a hierarchy. Forcing them into one is a Liskov violation waiting to happen.
- The case will move to a workflow / state machine (Order: DRAFT → SUBMITTED → SHIPPED). Use State pattern.
- The dispatch is on data, not type. (Discount calculation by amount tier — use a table or strategy lookup, not subclasses.)

### Modern alternative: sealed types + pattern matching

Java 17+, Kotlin, Scala, Rust, and TypeScript all have variations:

```java
sealed interface Shape permits Circle, Square, Triangle {}

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.side() * sq.side();
        case Triangle t -> 0.5 * t.base() * t.height();
    };
}
```

Compile-time exhaustiveness, no need for an inheritance hierarchy with virtual methods. Often the better choice for *closed* sets.

---

## Null Object vs. Optional vs. throwing

Three ways to handle absence:

### `Optional<T>`

```java
Optional<Customer> c = repo.findById(id);
String name = c.map(Customer::name).orElse("guest");
```

- Most explicit about absence.
- Forces caller to think about the missing case.
- Standard since Java 8.

### Null Object

```java
Customer c = repo.findById(id);   // never null; returns NullCustomer if missing
```

- Caller doesn't think about missing case.
- Behavior is a no-op or default.

### Throwing

```java
Customer c = repo.findById(id).orElseThrow(() -> new NotFound());
```

- Communicates "this should always exist; missing is a bug or 404."
- Exception-based control flow.

### When to pick

| Strategy | When |
|---|---|
| `Optional<T>` | Caller decides; absence is normal but worth thinking about |
| Null Object | Hot path; default behavior is sensible; no special handling needed |
| Throwing | Absence is exceptional; failing fast is correct |

Avoid:
- Returning null directly (then everyone has to remember to check).
- Returning empty list for "not found" when "empty" is also a valid result.

---

## Assertions, contracts, and Design by Contract

`Introduce Assertion` codifies invariants. Eiffel's "Design by Contract" formalized this:

- **Preconditions** — what callers must guarantee.
- **Postconditions** — what the method guarantees.
- **Invariants** — what's always true of the object.

In modern languages:

| Language | Mechanism |
|---|---|
| Java | `assert`, `Objects.requireNonNull`, Guava `Preconditions`, JSR 305 / Bean Validation |
| Python | `assert`, type hints + `mypy --strict`, `pydantic` validators |
| Rust | `assert!`, `debug_assert!`, type system (`Option<T>`, `Result<T,E>`) |
| Go | `if x == nil { panic("...") }`, `errors.Is/As` |
| Kotlin | `require()`, `check()`, `requireNotNull()`, `checkNotNull()` |

### When to use which

- **`require()` / `checkArgument`** — public input validation. Always on.
- **`assert`** — internal invariants. May be disabled in production (Java).
- **`check()` / `checkState`** — internal state invariants. Always on.

---

## Pattern matching as a modern alternative

In languages with rich pattern matching (Scala, Rust, Haskell, Kotlin, modern Java), many "Replace Conditional with Polymorphism" cases are better as:

```scala
def area(s: Shape): Double = s match {
  case Circle(r) => math.Pi * r * r
  case Square(side) => side * side
  case Triangle(base, height) => 0.5 * base * height
}
```

```rust
fn area(s: &Shape) -> f64 {
    match s {
        Shape::Circle(r) => PI * r * r,
        Shape::Square(s) => s * s,
        Shape::Triangle(b, h) => 0.5 * b * h,
    }
}
```

Advantages:
- No subclass hierarchy.
- Exhaustiveness checked.
- Each case is colocated.
- Easier to add operations (you write a new function, not a new method on each subclass).

This is the **expression problem** trade-off: subclasses make adding *types* easy, pattern matching makes adding *operations* easy. Pick based on which axis grows.

---

## Combinators and functional alternatives

Long if-else chains can sometimes become functional pipelines:

```java
// Imperative:
String tier;
if (spend > 1000) tier = "GOLD";
else if (spend > 500) tier = "SILVER";
else if (spend > 100) tier = "BRONZE";
else tier = "NONE";
```

```java
// Table-driven:
record Tier(double minSpend, String name) {}
private static final List<Tier> TIERS = List.of(
    new Tier(1000, "GOLD"),
    new Tier(500, "SILVER"),
    new Tier(100, "BRONZE")
);
String tier = TIERS.stream()
    .filter(t -> spend > t.minSpend())
    .map(Tier::name)
    .findFirst()
    .orElse("NONE");
```

The table version is more **data, less code**. Adding a tier is editing one line.

But: streams allocate, and for hot loops, the imperative form is faster. Pick based on profile.

---

## Language-specific notes

### Java

- `switch` expressions (Java 14+) and pattern matching (Java 21+) collapse most of these refactorings.
- `Optional` is preferred over Null Object for explicit absence.
- Guava's `Preconditions` for input validation.

### Python

- `match` statement (Python 3.10+) supports structural pattern matching.
- `Optional[T]` (typing) for explicit None-able values.
- `assert` is removed with `-O` flag — don't rely on it for production checks.

### Go

- No exceptions; conditionals are usually paired with `err != nil` returns.
- Guard clauses are extremely common: `if err != nil { return err }`.
- No polymorphism via inheritance; interfaces fill the role.

### Kotlin

- `when` expression replaces switch.
- Sealed classes + `when` give exhaustive pattern matching.
- `?.`, `?:`, `let`, `also` collapse many null-check patterns.

### Rust

- `match` is mandatory for `Option<T>` and `Result<T, E>` — null and error handling are language-enforced.
- `?` operator collapses error-handling guard clauses.

### TypeScript

- Discriminated unions + exhaustiveness checking via `never`.
- Optional chaining (`obj?.field`) and nullish coalescing (`?? default`).

---

## Review questions

1. What's the recommended order of applying Simplifying Conditionals refactorings?
2. When are guard clauses NOT preferred?
3. When is Replace Conditional with Polymorphism overkill?
4. Compare Null Object, Optional, and throwing for absence handling.
5. What's Design by Contract, and how does it relate to Introduce Assertion?
6. How does sealed types + pattern matching change the polymorphism calculus?
7. What's the expression problem?
8. When is a table-driven approach better than a chain of ifs?
9. Why is `assert` in Python sometimes a footgun?
10. How does Kotlin's `when` differ from Java's `switch`?
