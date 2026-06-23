# Organizing Data — Middle Level

> Trade-offs, real-world triggers, the order to apply, and how to choose between similar techniques.

---

## Table of Contents

1. [The order: encapsulate first, reshape after](#the-order-encapsulate-first-reshape-after)
2. [Real-world triggers](#real-world-triggers)
3. [Picking among Replace Type Code variants](#picking-among-replace-type-code-variants)
4. [Value vs. Reference: how to decide](#value-vs-reference-how-to-decide)
5. [Bidirectional associations: when to live with them](#bidirectional-associations-when-to-live-with-them)
6. [Encapsulate Collection in modern languages](#encapsulate-collection-in-modern-languages)
7. [Replace Subclass with Fields: when not to](#replace-subclass-with-fields-when-not-to)
8. [Magic numbers vs. configuration](#magic-numbers-vs-configuration)
9. [Migration patterns](#migration-patterns)
10. [Review questions](#review-questions)

---

## The order: encapsulate first, reshape after

Most Organizing Data refactorings depend on **encapsulation already being in place**.

Recommended sequence:

1. **Self Encapsulate Field** + **Encapsulate Field** + **Encapsulate Collection** — get all reads/writes through accessors.
2. *Now* you can safely apply the more invasive moves:
   - Replace Data Value with Object — change the field type.
   - Replace Type Code with Class — change the type semantics.
   - Change Value to Reference (or vice versa) — change identity semantics.
3. After data shape settles, simplify the conditionals that branched on the old type code (Replace Conditional with Polymorphism — see [Simplifying Conditionals](../04-simplifying-conditionals/junior.md)).

> **Rule:** never reshape a publicly-readable field. Encapsulate first; reshape under the hood.

---

## Real-world triggers

### 1. "We added a country and it broke 14 places"

The country was a `String`. Hardcoded checks like `if (user.country.equals("US"))` were everywhere. **Replace Data Value with Object** + a small `Country` enum would have made the check exhaustive (or compile-error on missing handling).

### 2. "Currency comparisons fail across modules"

Two Currency objects with the same code aren't equal because `equals` was object identity. **Change Reference to Value** + override `equals`/`hashCode`.

### 3. "Loyalty points keep diverging"

Two Customer objects represented the same person but tracked points independently. **Change Value to Reference** — single instance per email.

### 4. "ORM saved the order but not the customer"

Bidirectional `Order ↔ Customer` link, but only Order was marked as `@Transactional`. **Change Bidir to Unidir** removed the symptom; deeper fix was the transaction boundary.

### 5. "1.785 appeared in 3 files"

The third occurrence was 1.795 — a typo nobody noticed. **Replace Magic Number with Symbolic Constant** would have surfaced the typo at code review.

### 6. "Customer DTO leaks internal IDs"

DTO exposed an `internalCustomerId` field as `public`. Front-end started building features around it. **Encapsulate Field** + DTO redesign decoupled the public API from internal state.

---

## Picking among Replace Type Code variants

You have a type code. Three options:

| Variant | When to use |
|---|---|
| Replace Type Code with **Class** | Behavior is the same across types; you just want type safety. (Java enum is the modern choice.) |
| Replace Type Code with **Subclasses** | Behavior differs per type and the type doesn't change at runtime. |
| Replace Type Code with **State/Strategy** | Behavior differs per type and the type can change at runtime. |

### Decision flowchart

```
Behavior differs by type code?
├─ No → Replace Type Code with Class (or enum)
└─ Yes
   ├─ Type changes during object's life?
   │  ├─ Yes → State/Strategy
   │  └─ No  → Subclasses
   │            ├─ Few types, simple behaviors → Enum with abstract methods
   │            └─ Rich behaviors, separate concepts → Subclasses
```

### Concrete examples

- `Country` (lots of values, no per-country behavior beyond data lookup): **enum** or value-object.
- `Employee` is `ENGINEER` or `MANAGER` (different `pay()` formulas, doesn't change per person): **Subclasses**.
- `Order` is `DRAFT` → `CONFIRMED` → `SHIPPED` (state transitions): **State pattern**.

### Hybrid

It's common to combine: an `Employee` enum holds simple data, but special types like `Manager` get their own subclass. Don't be doctrinaire — let the design follow the requirements.

---

## Value vs. Reference: how to decide

### Value semantics

- Equality by content (`equals`/`hashCode` based on fields).
- Immutable (or treated as such).
- Cheap to copy.

Examples: `Money(amount, currency)`, `Coordinate(x, y)`, `Color(r, g, b)`, `EmailAddress(value)`.

In Java, prefer **records** (Java 14+):
```java
public record Money(BigDecimal amount, String currency) {}
```
Auto-generated `equals`, `hashCode`, `toString`. Immutable.

### Reference semantics

- Equality by identity (default `==` / object reference).
- May be mutable.
- Identity carries meaning.

Examples: `Customer(id, ...)`, `Order(id, ...)`, `Account(id, ...)`.

Usually have an `id` field; `equals` based on `id`.

### Mistakes

- Treating an entity as a value (`new Customer("alice@x.com")` everywhere → diverging state). Use a registry or repository.
- Treating a value as an entity (`new Money(100, "USD")` cached in a map by reference) → equality bugs.

### Rule of thumb

**If the object has an `id`, it's an entity (reference). Otherwise, it's a value.**

---

## Bidirectional associations: when to live with them

Bidirectional links are *more expensive* to maintain than unidirectional:
- Setter on either side must update both.
- Serialization needs annotation to break cycles.
- ORM mapping requires owning-side declaration.

### Reasons to keep bidirectional

- Frequent traversal both directions, no DB query alternative.
- In-memory model (no database).
- Performance: avoiding repeated queries.

### Reasons to drop one direction

- One direction was added speculatively but never used in code.
- The reverse can be a query (`orderRepo.findByCustomer(c)`).
- The reverse causes serialization headaches.

### Pattern

If `Customer.orders` is rarely needed and you have a repository, drop it. Customer offers `ordersFor(repo)` instead of `orders` field. The data lives in one place — the database.

### ORM-specific advice

In Hibernate / JPA:

```java
@Entity
class Customer {
    @OneToMany(mappedBy = "customer")
    private Set<Order> orders;
}
@Entity
class Order {
    @ManyToOne
    private Customer customer;   // owning side
}
```

Owning side is the one with the FK column. Keep both sides consistent in setter logic, or you get mysterious "I saved the parent but not the child" bugs.

---

## Encapsulate Collection in modern languages

The classic Encapsulate Collection from Fowler is still relevant in Java, but languages have evolved:

### Java

```java
private final List<Order> orders = new ArrayList<>();
public List<Order> getOrders() { return List.copyOf(orders); }   // immutable copy
```

`List.copyOf` (Java 10+) is the cleanest path. For huge lists, `Collections.unmodifiableList(orders)` returns a view.

### Kotlin

```kotlin
private val _orders = mutableListOf<Order>()
val orders: List<Order> get() = _orders   // read-only view
fun addOrder(order: Order) { _orders.add(order) }
```

The `_` prefix and read-only public view is idiomatic.

### Rust

The borrow checker forces this. You can give out `&Vec<Order>` (immutable borrow) without fear; mutation requires `&mut self`.

### Python

```python
class Customer:
    def __init__(self):
        self._orders: list[Order] = []

    @property
    def orders(self) -> tuple[Order, ...]:
        return tuple(self._orders)
```

Pythonic: tuple is immutable. Consumers can iterate but not mutate.

### Anti-patterns

- Returning `null` instead of an empty list. Always return empty.
- Returning the live list, then "documenting" that callers shouldn't mutate.
- Defensive `clone()` in inner loops — measure if the cost matters; consider returning a stream.

---

## Replace Subclass with Fields: when not to

The trap: collapsing a small hierarchy into a single class with a flag.

### When the technique helps

```java
class Engineer extends Employee {}
class Manager extends Employee {}
```

If `Engineer` and `Manager` only differ by a flag and a salary, fields are simpler.

### When the technique hurts

If the subclasses encode **future behavioral differences** (planned features, polymorphism dispatch), collapsing them locks you into `if (kind == ENGINEER)` branches everywhere — exactly the smell you were trying to avoid.

### Heuristic

Replace Subclass with Fields when:
- The subclasses currently have **no behavioral overrides** that would change.
- The set of types is **stable** — new types aren't expected.

Otherwise, keep the hierarchy.

---

## Magic numbers vs. configuration

`Replace Magic Number with Symbolic Constant` makes a number readable. But sometimes the number isn't a constant — it's a **configuration value** that should be:

- Externalized (env var, config file).
- Overridable per environment (test, staging, prod).
- Owned by a configuration system (Consul, Vault, Spring Cloud Config).

### Example

```java
private static final int RETRY_LIMIT = 3;   // ❌ hardcoded
```

vs.

```java
@Value("${order.retry.limit:3}")
private int retryLimit;
```

Spring's `@Value` lets ops override without redeploying.

### Decision

| Quality | Constant | Configuration |
|---|---|---|
| Stable for the lifetime of the codebase | Constant |  |
| Per-environment | | Configuration |
| Tunable in production | | Configuration |
| Semantic (e.g., π) | Constant | |

---

## Migration patterns

When you have to reshape data while live:

### 1. Expand-Contract

- Phase 1: add new field/shape alongside old.
- Phase 2: write to both, read from old.
- Phase 3: backfill new from old.
- Phase 4: read from new, write to both.
- Phase 5: read & write only new.
- Phase 6: drop old.

This is how big production migrations are done — schema, in-memory model, or wire format.

### 2. Strangler

The new shape is exposed through new API; old shape stays. Migrate callers one at a time. Eventually delete old.

### 3. Translation layer

A class converts between old and new shapes. New code uses the new shape; the layer translates as needed for old callers.

> See Database Migration Patterns for full migration strategies.

---

## Review questions

1. Why must Encapsulate Field come before Replace Data Value with Object?
2. How do you decide between Replace Type Code with Class vs. Subclasses vs. State/Strategy?
3. What's the rule for Value vs. Reference semantics?
4. When would you keep a bidirectional association?
5. Why is `List.copyOf` the modern Encapsulate Collection?
6. When is Replace Subclass with Fields a trap?
7. When does a magic number want to become configuration instead of a constant?
8. What's Expand-Contract migration and why does it exist?
9. How do Java records change the Replace Data Value with Object refactoring?
10. Why does ORM make bidirectional associations especially tricky?
