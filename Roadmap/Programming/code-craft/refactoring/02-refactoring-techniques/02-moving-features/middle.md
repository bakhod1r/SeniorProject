# Moving Features Between Objects — Middle Level

> Real-world triggers, the order in which to apply, and the **architectural** considerations behind moving methods, fields, and classes around.

---

## Table of Contents

1. [The order matters: extract before move](#the-order-matters-extract-before-move)
2. [Real-world triggers](#real-world-triggers)
3. [Move Method vs. Move Field — pick the simpler first](#move-method-vs-move-field-pick-the-simpler-first)
4. [Extract Class — the responsibility test](#extract-class-the-responsibility-test)
5. [Inline Class — when "lazy" is wrong](#inline-class-when-lazy-is-wrong)
6. [Hide Delegate vs. Demeter's Train Wreck](#hide-delegate-vs-demeters-train-wreck)
7. [Bounded contexts and DDD aggregates](#bounded-contexts-and-ddd-aggregates)
8. [Foreign Method / Local Extension across languages](#foreign-method-local-extension-across-languages)
9. [Comparison with Composing Methods](#comparison-with-composing-methods)
10. [Review questions](#review-questions)

---

## The order matters: extract before move

A typical 600-line class has four problems tangled together:

1. Some methods belong elsewhere (Move Method).
2. Some fields belong elsewhere (Move Field).
3. There's a hidden second class trying to escape (Extract Class).
4. There's a method chain you keep using (Hide Delegate).

The recommended order:

1. **Extract Method** (from [Composing Methods](../01-composing-methods/junior.md)) — break long methods into named, isolated fragments. Each fragment becomes a candidate for Move.
2. **Move Field** for fields that obviously belong elsewhere — small, mechanical wins.
3. **Move Method** on each fragment that's now obviously envious.
4. **Extract Class** when a cohesive set of fields + methods has formed.
5. **Hide Delegate** to clean up the call chains that result.

This is the order of the **smallest reversible step** at every moment.

> **Anti-pattern:** trying to Extract Class on a 600-line class without first Extract Methods. You'll move giant methods that touch everything, and your "new class" will need 12 collaborators.

---

## Real-world triggers

### 1. PR review feedback

A teammate says "this method doesn't belong here." That's Move Method. The cheapest answer is usually right: rename the home, not the method.

### 2. The "feature touched 5 files" PR

You needed to add a small feature, and the diff sprawled across 5 unrelated files. That's [Shotgun Surgery](../../01-code-smells/03-change-preventers/junior.md) — which often signals features need to be **moved together** into one class. Use Inline Class on a thin wrapper, or Extract Class to consolidate.

### 3. "Why does this class have 30 methods?"

Onboarding question with no satisfying answer. Run a method-clustering analysis (or just read by hand): which methods touch fields A,B,C? Which touch fields D,E? You've found Extract Class candidates.

### 4. "Class X is in every stack trace"

A god class that's always on the call path is doing too much. Extract Class until it isn't.

### 5. Circular references that won't go away

A → B and B → A means the boundary is wrong. One direction must give. Move methods/fields until the circular reference dissolves into a single direction (or use [Change Bidirectional to Unidirectional](../03-organizing-data/junior.md)).

---

## Move Method vs. Move Field — pick the simpler first

If a method on `Account` reads `interestRate` from itself but conceptually belongs on `AccountType`, two routes exist:

**Route A:** Move Method first.
- Now `AccountType.method` reads `interestRate` from... the parameter? Or, if `interestRate` was on `Account`, the method needs an `Account` argument. Awkward.

**Route B:** Move Field first.
- `AccountType.interestRate` now exists. The original method (still on `Account`) reads `type.interestRate()`. It's now [Feature Envy](../../01-code-smells/05-couplers/junior.md).
- Then Move Method becomes obvious.

**Rule:** If the method follows the field, **move the field first**.

Likewise: when a method drags state with it, that state is often the next Move Field. Iterate.

---

## Extract Class — the responsibility test

You're staring at a 30-method class. Should you Extract?

### The "two reasons to change" test (SRP)

Read the methods. Group them by *which business rule they encode*. If two groups encode different business rules ("validation" + "pricing"), they belong in two classes.

### The "field cluster" test

List every field. For each method, mark which fields it reads/writes. If methods M1, M2, M3 only touch fields F1, F2 (and methods M4, M5, M6 only touch F3, F4), the cluster is screaming for Extract.

### The "name" test

If you can't name the class in 1–2 words, it has too many jobs. `OrderService` doing pricing, validation, and shipping wants to become `OrderValidator`, `Pricer`, and `ShippingCalculator`.

### The "test setup" test

Tests that need to set up 12 collaborators are testing too much. Extract until each test sets up 2–3.

### When NOT to Extract

- The "second responsibility" is too small to live alone. Wait — premature extraction makes you maintain two classes for one purpose.
- The "second responsibility" is one method. That's a function, not a class.
- The class is genuinely an aggregate root (DDD) — the methods orchestrate but don't implement; the implementation is on the leaves.

---

## Inline Class — when "lazy" is wrong

Inline Class is the cure for [Lazy Class](../../01-code-smells/04-dispensables/junior.md), but be careful — what looks lazy may be load-bearing:

### When Inline is right

- A wrapper around a single primitive that adds nothing (no validation, no formatting, no behavior).
- A class that's been left over after most of its responsibility was moved away.
- A speculative class that was created "in case we need it later" — and we didn't.

### When Inline is wrong

- The class is a **value object** (Email, Money, PhoneNumber) — it encapsulates an invariant. Don't inline.
- The class is a **port** in hexagonal architecture — even if it's currently a thin pass-through, the port is the abstraction boundary.
- The class is **mocked in tests** — inlining breaks test setups.
- The class is **part of a public API** — external callers depend on it.

### Heuristic

If the class has any non-trivial method (validation, formatting, defaulting), it's not lazy. The fields-only "data class" with `getX/setX` is the typical Inline candidate.

---

## Hide Delegate vs. Demeter's Train Wreck

The Law of Demeter (LoD): **a method should call methods on `this`, its own fields, its parameters, and locals it created** — not on objects returned from those.

### Train wreck

```java
john.getDepartment().getManager().getName().toUpperCase();
```

Each `.` is a step into another object. If any link in the chain changes (Department → Team), every caller breaks. **Hide Delegate** at each layer trims the chain.

### When chains are OK

- **Fluent APIs / Builders:** `Order.builder().withItem(x).withCustomer(c).build()` — every `.` returns the same builder. Not a train wreck.
- **Stream pipelines:** `items.stream().filter(...).map(...).toList()` — same object pattern.
- **Immutable transformations:** `string.toLowerCase().trim().replace("a", "b")` — each call returns a new String, but the type is consistent.

The train wreck is when each `.` returns a *different concept*: `john → Department → Manager → Name → String`. That's coupling across multiple boundaries.

### Pragmatic rule

> Hide a delegate when ignoring it would force every caller to know about an internal concept. Tolerate the chain when the intermediate types are obviously stable (Builders, Streams, value types).

---

## Bounded contexts and DDD aggregates

In Domain-Driven Design, an **aggregate** is a cluster of objects that change together and have one **root** that outsiders talk to. Move Method, Move Field, and Extract Class are the day-to-day mechanics of *aligning code with aggregates*.

### Example

A `Cart` aggregate might contain `Cart`, `LineItem`, `DiscountRule`. The root is `Cart`. Outside callers say `cart.applyDiscount(rule)`, not `cart.lineItems().get(0).applyDiscount(rule)`.

If you find code calling deep inside an aggregate, you have a Move Method opportunity (lift the operation to the root) and a Hide Delegate opportunity (stop exposing the leaf to outsiders).

### Bounded context

When two parts of a system have inconsistent meanings of "Customer" (the marketing context vs. the billing context), they live in different **bounded contexts**. Code that conflates them is a candidate for Extract Class — let each context have its own `Customer`, with translation between.

---

## Foreign Method / Local Extension across languages

| Language | Mechanism | Notes |
|---|---|---|
| Java | Static utility class (`DateUtils.nextDay(d)`) or wrapper class | No extension methods. Lombok's `@ExtensionMethod` is the closest. |
| Kotlin | `fun Date.nextDay()` | First-class extension functions; resolution is static. |
| C# | `public static class DateExtensions { public static Date NextDay(this Date d) ... }` | Extension methods, static dispatch. |
| Swift | `extension Date { func nextDay() -> Date { ... } }` | First-class extensions; can add protocol conformance. |
| Python | Subclass, monkey-patching, or free function | Monkey-patching is technically possible but discouraged. |
| Go | Method on a named local type (`type MfDate time.Time`) | No extensions; type aliases + methods cover most cases. |
| Rust | Trait + impl: `impl DateExt for Date { fn next_day(&self) -> ... }` | Trait extensions; static dispatch. |
| TypeScript | Module augmentation, but usually a free function | Augmentation works but is fragile. |

In modern languages with first-class extensions, [Introduce Foreign Method](junior.md#introduce-foreign-method) and [Introduce Local Extension](junior.md#introduce-local-extension) collapse into the same idiom — you simply add the method.

In Java and Go, the wrapper/utility-class approach is required. The **Result type pattern** (`io.vavr.Try`, Java's `Optional`) is itself a kind of Local Extension.

---

## Comparison with Composing Methods

| Aspect | Composing Methods | Moving Features |
|---|---|---|
| Scope | Inside one class | Across classes |
| Risk | Low (mechanical) | Medium (changes APIs) |
| IDE support | Excellent (refactor commands) | Good (but watch test setups) |
| Effect on architecture | Reveals shape | Realigns shape |
| Order | Apply first | Apply after Composing Methods |

**The natural progression:**

> Compose Methods → see the shape → Move Features → realign the shape → Compose Methods again on the new homes → repeat.

This loop is the day-to-day practice of refactoring legacy code into clean architecture.

---

## Review questions

1. Why should you Extract Method (Composing Methods) before Move Method?
2. What's the "two reasons to change" test for Extract Class?
3. When is a class genuinely lazy vs. when does it look lazy but isn't?
4. How does Hide Delegate relate to the Law of Demeter?
5. When are method chains OK and when are they train wrecks?
6. What's a DDD aggregate root, and how does it relate to Move Method?
7. Compare extension methods in Kotlin vs. wrapper classes in Java for Local Extension.
8. What's the typical pair of refactorings you alternate when restructuring legacy code?
9. When does Move Field come before Move Method?
10. When should you Remove Middle Man rather than Hide Delegate?
