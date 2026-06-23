# OO Abusers — Middle Level

> Focus: real-world appearance, trade-offs, and when *not* to refactor these smells.

---

## Table of Contents

1. [Why OO Abusers happen](#why-oo-abusers-happen)
2. [Real-world cases for Switch Statements](#real-world-cases-for-switch-statements)
3. [Real-world cases for Temporary Field](#real-world-cases-for-temporary-field)
4. [Real-world cases for Refused Bequest](#real-world-cases-for-refused-bequest)
5. [Real-world cases for Alternative Classes](#real-world-cases-for-alternative-classes)
6. [When NOT to refactor](#when-not-to-refactor)
7. [Modern alternatives — pattern matching and sealed types](#modern-alternatives-pattern-matching-and-sealed-types)
8. [Composition over inheritance — when does the rule apply?](#composition-over-inheritance-when-does-the-rule-apply)
9. [Comparison with related smells](#comparison-with-related-smells)
10. [Review questions](#review-questions)

---

## Why OO Abusers happen

OO Abusers appear in three predictable circumstances:

### 1. Polymorphism is "too much ceremony"

A small switch on type — 3 cases, 5 lines each — feels lighter than introducing 3 classes + an interface. So the switch goes in. Then a second method needs the same branching. Then a third. By the fifth duplicate, refactoring is overdue, but each individual addition felt small.

### 2. Inheritance was reached for too early

A team identifies "X and Y are kind of similar" and reaches for `class Y extends X`. Two months later, X needs a method Y can't implement, or Y needs a method X doesn't have. Refused Bequest grows.

### 3. Two teams build similar things in isolation

Service A's authentication library and Service B's authentication library do the same job with different APIs. Each team didn't know the other existed (or didn't want the other team's solution). Alternative Classes with Different Interfaces is the result.

---

## Real-world cases for Switch Statements

### Case 1 — Payment provider dispatcher

**Setting:** E-commerce backend with 6 payment providers (Stripe, PayPal, Adyen, Braintree, Square, internal corp account). The dispatcher:

```java
public void charge(String provider, BigDecimal amount, ...) {
    switch (provider) {
        case "stripe": ... 30 lines ...
        case "paypal": ... 40 lines ...
        case "adyen": ...
        // 6 cases, total ~200 lines
    }
}
```

This switch repeats in `charge`, `refund`, `void`, `dispute`, `webhook` — 5 methods.

**Adding provider #7:** 5 places to edit, 5 places to test, 5 places where `default:` might silently miss the new case.

**Fix:** `PaymentProvider` interface with 5 methods (`charge`, `refund`, etc.); one implementation per provider; a registry that returns the right one.

```java
interface PaymentProvider {
    PaymentResult charge(Money amount, ...);
    PaymentResult refund(...);
    // ...
}

class PaymentRegistry {
    private final Map<String, PaymentProvider> providers;
    
    public PaymentProvider get(String name) {
        PaymentProvider p = providers.get(name);
        if (p == null) throw new UnknownProviderException(name);
        return p;
    }
}
```

Adding provider #7: one new class implementing the interface, one entry in the registry. No edits elsewhere.

### Case 2 — Order state machine

**Setting:** Order lifecycle: `CREATED → PAID → SHIPPED → DELIVERED → COMPLETED`. Plus `CANCELLED`, `REFUNDED`, `DISPUTED`. Methods like `canTransitionTo`, `nextActions`, `displayLabel`, `progressPercent` all branched on `order.status`.

**Cure:** State pattern. Each status is a class with the relevant methods.

```java
sealed interface OrderState permits Created, Paid, Shipped, Delivered, Completed, Cancelled, Refunded, Disputed {
    boolean canTransitionTo(OrderState target);
    List<Action> nextActions();
    String displayLabel();
    int progressPercent();
}
```

Adding `BACKORDERED` is a new class implementing the interface. The state machine logic is per-class (each class knows what transitions out of itself are valid).

### Case 3 — Compiler/parser dispatch

**Setting:** AST evaluator with 30+ node types (binary op, literal, variable, function call, ...). Originally one giant switch in the evaluator.

**Was the smell:** *yes* — duplicated across `evaluate()`, `typeCheck()`, `optimize()`, `prettyPrint()`.

**Modern cure:** Visitor pattern (covered in [design-patterns/03-behavioral/10-visitor/](../../../design-patterns/03-behavioral/10-visitor/junior.md)) OR sealed types + pattern matching.

```java
String prettyPrint(Expr e) {
    return switch (e) {
        case Literal(var v) -> v.toString();
        case Variable(var name) -> name;
        case BinaryOp(var op, var left, var right) -> 
            "(" + prettyPrint(left) + " " + op + " " + prettyPrint(right) + ")";
        case FunctionCall(var name, var args) -> 
            name + "(" + args.stream().map(this::prettyPrint).collect(joining(", ")) + ")";
    };
}
```

In Java 21+ with sealed `Expr`, the compiler verifies exhaustiveness. The "switch" *is* polymorphism — pattern-matched, not type-coded.

---

## Real-world cases for Temporary Field

### Case 1 — Authentication session in a god class

**Setting:** A `User` class with fields `lastChallenge`, `challengeExpiresAt`, `mfaCode` — populated only during MFA login. Outside the login flow, all three are `null`. Bug: a stale `mfaCode` from a previous login was still in memory; an attacker who could observe object dumps saw it.

**Cure:** Extract `MfaChallenge` class. Created at the start of MFA flow, garbage-collected when flow completes. Never lives on the long-lived `User`.

### Case 2 — Render context in a Long Method

**Setting:** A 600-line `renderPage()` set fields like `currentSection`, `nestedDepth`, `linkResolver` for use by sub-render methods. Outside `renderPage`, those fields were stale.

**Cure:** Replace Method with Method Object — `RenderOperation` holds the render-time fields; `renderPage()` constructs one and delegates.

### Case 3 — Caching as Temporary Field gone wrong

**Setting:** `Order.calculatedTotal` field — set after `calculateTotal()` ran, used as cache. But changes to line items invalidated the cache without clearing it. Bug: stale total displayed.

**Cure:** Remove the field. Compute on demand. If profiling shows a cost, use a real cache with explicit invalidation (e.g., a method that clears `calculatedTotal` on any line-item mutation).

> **Distinction:** Temporary Field as a *cache* is a particularly common variant. Caches need invalidation rules. A field that's "set sometimes, stale sometimes" is the smell; a field with documented invalidation is engineering.

---

## Real-world cases for Refused Bequest

### Case 1 — `Set extends Collection`

The classic example. `Set` is a Collection, but `add()` returns a boolean indicating whether the set actually changed (false if duplicate). `List.add()` always returns true. Subtle Liskov violation: code that takes `Collection<T>` and ignores the return value behaves differently for sets vs lists in some flows (e.g., progress counters).

**This is in the JDK** — and it works because the divergence is documented and contained. But it shows that even mature designers compromise on Liskov when convenient.

### Case 2 — `Stack extends Vector` (Java)

`java.util.Stack` extends `Vector` (a list). It exposes `push`, `pop`, `peek` — but also inherits all 50 `Vector` methods (`get`, `set`, `add`, `remove`, `insertElementAt`). You can `stack.add(0, item)` and break the LIFO invariant.

This is a textbook Refused Bequest in the standard library. Modern code uses `Deque<T>` (interface) and `ArrayDeque<T>` (implementation) — no inheritance, no leak.

### Case 3 — UI framework hierarchies

GUI libraries famously have deep hierarchies: `JComponent → JContainer → JPanel → ...` (Swing). Some methods make sense at every level; some are stubbed at intermediate levels and only meaningful at leaves. Composition-over-inheritance arrived in modern UI frameworks (React, Flutter, SwiftUI) partly to escape this.

---

## Real-world cases for Alternative Classes

### Case 1 — Two HTTP client libraries, one company

Service A uses Apache HttpClient (`response.getStatusLine().getStatusCode()`). Service B uses OkHttp (`response.code()`). Both wrap retries and timeouts. New engineers can't switch between services without context switch.

**Cure:** introduce a project-internal `HttpClient` interface; both services adopt it. Lower-level libraries (Apache, OkHttp) become implementation details, swappable.

### Case 2 — Email and SMS notifiers

Already shown in junior.md. Real-world variant: 4 channels (email, SMS, push, in-app). Each was built by a different team with different conventions. Cure was a `MessageChannel` interface, multi-month migration via Strangler Fig.

### Case 3 — Two logging libraries

Java apps with `java.util.logging` *and* `slf4j` *and* `log4j` simultaneously. Each captured by different code paths. Cure: standardize on one (typically slf4j as a facade); the others adapt.

---

## When NOT to refactor

### Switch Statements: keep it

- The switch values are inherently disjoint (HTTP status, opcode, byte tag) and the language has good pattern matching.
- The switch lives in one place — no duplication. Adding a case isn't expensive.
- Performance-critical hot paths where a measured benchmark shows polymorphism's vtable lookup costs more than the switch.

### Temporary Field: keep it

- The "temporary" is genuinely a cache with documented invalidation rules.
- Working with frameworks that inject fields by reflection (some DI containers, ORMs) — the field has a defined lifecycle managed by the framework.

### Refused Bequest: keep it

- The "refusal" is documented in the type system — e.g., the inherited method is annotated `@Deprecated` and the subclass throws as a documented escape.
- Refactoring would require breaking many callers and the savings are small.
- Standard library types you can't change (you write `class MySet extends AbstractSet`; some inherited methods may be irrelevant — that's OK).

### Alternative Classes: keep it

- The two classes are intentionally separate — different teams, different deployment cadences, different SLAs. Forcing a shared interface would couple them.
- The "alternative" is one party's public API and the other party's internal API; you don't own one of them.

---

## Modern alternatives — pattern matching and sealed types

Languages have evolved to make Switch Statements **less smelly** when used right. Modern features:

| Language | Feature |
|---|---|
| **Java 21** | `sealed` types + pattern matching in `switch` (exhaustive) |
| **Kotlin** | `sealed class` + `when` (exhaustive) |
| **Scala** | `sealed trait` + pattern matching |
| **Rust** | `enum` + `match` (exhaustive by language design) |
| **Swift** | `enum` + `switch` (exhaustive) |
| **TypeScript** | discriminated unions + `switch` with `never` exhaustiveness |

**Rule:** if your language has these features and the variants are stable (closed set), pattern matching is **not** the Switch Statements smell. Use it freely. The smell appears when the matching is duplicated across many call sites or when adding a variant requires touching many places — exhaustiveness checks reveal the change scope, but if the change scope is large, the design has a different problem.

---

## Composition over inheritance — when does the rule apply?

"Favor composition over inheritance" is the canonical advice. But:

- **Inheritance is the right tool** when the relationship is genuinely "is-a" *and* the parent's interface fits exactly. Most language standard libraries use inheritance correctly (`String extends Object`, `ArrayList extends AbstractList`).
- **Composition is right** when the relationship is "has-a," when behavior is configurable, when capabilities are mixed-and-matched.
- **Refused Bequest** signals that inheritance was wrong from the start; switch to composition.

The rule isn't "never use inheritance." It's "use it only when subclasses can honor the parent's contract without exception."

---

## Comparison with related smells

| OO Abuser | Often co-occurs with | Disambiguation |
|---|---|---|
| Switch Statements | Primitive Obsession (type codes), Long Method | Type-code switches *are* both. Cure them together. |
| Temporary Field | Long Method, Large Class | Temporary fields often live on a Large Class; the cure (Extract Class) cures both. |
| Refused Bequest | Speculative Generality (Dispensables) | When the parent class itself was built speculatively, refused-bequest is built-in. |
| Alternative Classes | Duplicate Code, Divergent Change | Two implementations of the same idea is duplication; changes to one rarely sync to the other. |

---

## Review questions

1. **A switch on `HttpStatus` enum — Switch Statements smell?**
   No. The values are inherently disjoint, the enum is closed, and (in modern Java/Kotlin/Rust) the compiler verifies exhaustiveness. The smell is about *type-code switches duplicated across many call sites*. A single switch on a stable enum is fine.

2. **My `User` class has `passwordResetToken: String?` (nullable). Smell?**
   Probably Temporary Field. It's null most of the time, set briefly during password reset. Better: a `PasswordResetSession` value object, created when the flow starts, deleted when consumed.

3. **`Stack extends Vector` is in the JDK. Should I use it?**
   No — use `Deque` interface with `ArrayDeque` implementation. The JDK kept `Stack` for backward compatibility but documents `Deque` as the modern replacement.

4. **Two services have identical authentication APIs but different package names. Refactor?**
   If the same code lives in two places, it's Duplicate Code, not Alternative Classes — they have the *same* interface. Cure: extract a shared library, both services depend on it. Alternative Classes is when the interfaces *differ*.

5. **A linter complains about my switch on a sealed enum. Suppress it?**
   Yes — check your linter config; modern versions exempt sealed types because they're verified exhaustive. Older versions may need a suppression annotation.

6. **My subclass throws `UnsupportedOperationException` for one parent method. Refused Bequest?**
   Yes. Cures: Push Down Method (move the method down to subclasses that *do* support it); Replace Inheritance with Delegation (compose instead of inherit); Extract Superclass (split the parent into a smaller "common operations" parent + a "supports method X" parent).

7. **Pattern matching on type — same as Switch Statements?**
   Often the *cure* in modern languages, when sealed types are exhaustive. The original smell is "switch on type code duplicated across methods" — pattern matching with sealed types eliminates the duplication and adds compile-time exhaustiveness. Use freely.

8. **A field is null only in one specific code path. Temporary Field?**
   Yes. Even a single conditional null is a smell — the class has an implicit state machine ("path A: field null; path B: field set"). Make it explicit (Extract Class for the "field set" state, or Introduce Null Object).

9. **Replacing inheritance with delegation costs more code. Worth it?**
   Usually yes when you've identified Refused Bequest. Composition is more verbose but clearer: "this object *has* this capability" instead of "this object *is* a kind of that thing." The verbosity is the cost of honesty about the relationship.

10. **An interface has 30 methods; my class implements 5 and throws on the rest. Smell?**
    Yes — Interface Segregation Principle (ISP) violation, manifesting as Refused Bequest. Cure: split the 30-method interface into smaller cohesive interfaces; your class implements only the relevant ones.

---

> **Next:** [senior.md](senior.md) — architecture-level OO Abusers, code-review heuristics, and migration patterns.
