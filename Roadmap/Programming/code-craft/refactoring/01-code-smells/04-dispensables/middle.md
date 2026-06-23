# Dispensables — Middle Level

> Real-world cases, trade-offs, and when *not* to remove.

---

## Table of Contents

1. [Why Dispensables accumulate](#why-dispensables-accumulate)
2. [Real-world cases for Comments](#real-world-cases-for-comments)
3. [Real-world cases for Duplicate Code](#real-world-cases-for-duplicate-code)
4. [Real-world cases for Lazy Class](#real-world-cases-for-lazy-class)
5. [Real-world cases for Data Class](#real-world-cases-for-data-class)
6. [Real-world cases for Dead Code](#real-world-cases-for-dead-code)
7. [Real-world cases for Speculative Generality](#real-world-cases-for-speculative-generality)
8. [The "kill the abstraction" decision](#the-kill-the-abstraction-decision)
9. [Comparison with related smells](#comparison-with-related-smells)
10. [Review questions](#review-questions)

---

## Why Dispensables accumulate

Three patterns:

### 1. Optimism

A team adds an interface "in case we need a second implementation." The second implementation never appears. The interface remains.

### 2. Caution

Code that "might still be needed" gets commented out, not deleted. Six months later, no one remembers why it was commented; it stays.

### 3. Habit

Some teams have ritual practices — every class needs an interface, every getter needs a setter, every operation needs a `Strategy` — regardless of whether they help.

---

## Real-world cases for Comments

### Case 1 — The 50-line comment block

A method `processOrder` opens with a 50-line `/* */` comment explaining what it does. The comment was written when the method was 30 lines long. The method is now 600 lines and the comment is partially wrong.

**Cure:** delete the comment, extract the method into smaller named methods. The method names become the documentation.

### Case 2 — The "TODO from 2019"

```java
// TODO: handle null carrier (added 2019-03-15)
```

Five years later. Either the bug exists (cure: fix), or it was fixed without removing the comment (cure: delete). TODOs older than ~3 months are usually dead — clean them up periodically.

### Case 3 — Genuinely good comments

```java
// Workaround: AWS SDK throws NullPointerException when X-Amz-Date 
// header is missing on signed requests. Adding it explicitly fixes it.
// See: https://github.com/aws/aws-sdk-java/issues/12345
request.addHeader("X-Amz-Date", iso8601Date());
```

This is the *right* comment — explains a non-obvious workaround with reference. Keep these.

---

## Real-world cases for Duplicate Code

### Case 1 — Copy-paste-modify

The most common form: developer needs `processB`, copies `processA`, changes one or two lines. Six months later, a bug fix in `processA` doesn't get applied to `processB`.

**Cure:** Extract Method. The two methods become callers of a shared helper plus their unique logic.

### Case 2 — Library boilerplate

Every method that calls a 3rd-party API does:

```java
try {
    Response r = client.call(...);
    if (!r.isSuccess()) throw new ApiException(r.getError());
    return r.getBody();
} catch (TimeoutException e) {
    throw new ApiException("timeout", e);
}
```

Repeated across 30 methods.

**Cure:** wrap the client in an internal facade that handles error mapping once.

```java
class ApiClient {
    public <T> T call(Request req, Class<T> type) {
        try {
            Response r = raw.call(req);
            if (!r.isSuccess()) throw new ApiException(r.getError());
            return r.getBody(type);
        } catch (TimeoutException e) {
            throw new ApiException("timeout", e);
        }
    }
}
```

### Case 3 — Different code, same intent

Two methods do the same thing different ways:

```java
double max1(List<Double> xs) {
    double m = Double.NEGATIVE_INFINITY;
    for (double x : xs) if (x > m) m = x;
    return m;
}

double max2(List<Double> xs) {
    return xs.stream().mapToDouble(Double::doubleValue).max().orElse(Double.NEGATIVE_INFINITY);
}
```

**Cure:** **Substitute Algorithm** — pick one (likely the stream version), delete the other.

---

## Real-world cases for Lazy Class

### Case 1 — One-method "manager" classes

```java
class CustomerEmailValidator {
    public boolean validate(String email) { ... }
}

class CustomerPhoneValidator {
    public boolean validate(String phone) { ... }
}
```

If neither is reused or has a meaningful identity, fold both into a `CustomerValidation` static utility class.

### Case 2 — One-line wrappers

```java
class TaxCalculator {
    private final BigDecimal rate;
    public TaxCalculator(BigDecimal rate) { this.rate = rate; }
    public BigDecimal calculate(BigDecimal amount) { return amount.multiply(rate); }
}
```

Used in one place. Cure: inline.

### Case 3 — Tag classes

```java
class WeekendOrder extends Order {}
class WeekdayOrder extends Order {}
// No methods overridden in either — the type itself was the only difference
```

If the only difference is *type*, that's a smell. Use a flag or enum on `Order` instead.

---

## Real-world cases for Data Class

### Case 1 — Anemic domain model

The classic Fowler "anemic domain model" anti-pattern: domain classes are pure DTOs (getters/setters); all logic lives in service classes.

```java
class Order {
    private List<LineItem> items;
    private OrderStatus status;
    public List<LineItem> getItems() { return items; }
    public OrderStatus getStatus() { return status; }
    // ... only setters and getters
}

class OrderService {
    public BigDecimal computeTotal(Order o) { ... }
    public boolean canCancel(Order o) { return o.getStatus() == OrderStatus.PENDING; }
}
```

**Cure:** Move Method — push behavior onto Order.

```java
class Order {
    public BigDecimal total() { ... }
    public boolean canCancel() { return status == OrderStatus.PENDING; }
}
```

### Case 2 — DTOs (not the smell)

```java
record CustomerDto(String name, String email, String country) {}
```

This is a Data Class, but it's the *correct* shape — a DTO has no behavior by design. Not the smell.

### Case 3 — Dataclasses with behavior added later

Python `@dataclass` and Java records started as data holders but support methods. When you find yourself writing helper functions for them, move those helpers onto the class.

---

## Real-world cases for Dead Code

### Case 1 — Commented "in case"

```java
// chargeViaPaypalLegacy(order);  // disabled 2023-Q3
chargeViaModernGateway(order);
```

The commented call has been here for a year. Delete.

### Case 2 — Unreachable

```java
public void doIt(Status s) {
    switch (s) {
        case ACTIVE: return active();
        case INACTIVE: return inactive();
        case BANNED: return banned();
    }
    return null;  // unreachable — switch covers all enum values
}
```

The `return null` after exhaustive switch is dead. (In Java 17+, `return null` may even be a warning.) Delete.

### Case 3 — Reflection callers (NOT dead)

```java
public class OrdersController {
    @PostMapping("/orders")
    public OrderResponse create(@RequestBody OrderRequest req) { ... }
}
```

Spring calls `create` via reflection from URL routing. Static analysis tools may flag it as unused — it isn't. Mark `@SuppressWarnings("unused")` if needed.

---

## Real-world cases for Speculative Generality

### Case 1 — Plugin system serving zero plugins

```java
interface PaymentPlugin { ... }
List<PaymentPlugin> plugins = ServiceLoader.load(PaymentPlugin.class);
```

The team designed for plugins. Two years later, only the built-in implementation exists. Delete the plugin scaffolding.

### Case 2 — Hooks called by no one

```java
abstract class Workflow {
    protected void preProcess() {}     // empty default
    protected void postProcess() {}    // empty default
    protected void onError(Exception e) {}  // empty default
    
    public void run() {
        preProcess();
        execute();
        postProcess();
    }
}
```

Five subclasses, none override `preProcess` or `postProcess`. Delete the hooks.

### Case 3 — Legitimate generality

A library author *should* anticipate multiple consumers. An internal app codebase *should not* anticipate multiple implementations of internal services. The boundary makes the call.

---

## The "kill the abstraction" decision

When deciding whether a Speculative Generality / Lazy Class / Dead Code is removable:

1. **Is it part of a public API?** Yes → keep (consumers depend on it).
2. **Is it called via reflection / DI / framework?** Yes → keep (mark to suppress lint warnings).
3. **Has it been used in the last N months?** No → strong removal candidate.
4. **Is the cost of leaving it small?** Yes → leave; come back later.
5. **Does removing it simplify the system?** Yes → delete.

---

## Comparison with related smells

| Dispensable | Often co-occurs with | Disambiguation |
|---|---|---|
| Comments | Long Method, Bad Names | Comments compensating for Long Method or unclear names. |
| Duplicate Code | Long Method, Shotgun Surgery | Long Method often has internal repetition; Shotgun Surgery is duplication across files. |
| Lazy Class | Speculative Generality | Lazy Class often *is* Speculative Generality — the head of an unfulfilled abstraction. |
| Data Class | Feature Envy (Couplers) | When data has no behavior, callers do the work — Feature Envy. |
| Dead Code | Speculative Generality | Speculative Generality often becomes Dead Code over time — abstraction never used. |

---

## Review questions

1. **An interface has 5 implementations, all internal. Speculative Generality?**
   No — 5 real implementations is real polymorphism, not speculation.

2. **A method has been "TODO'd" for 4 years. Is it Dispensable?**
   The TODO comment is. Either fix the underlying issue or delete the comment. 4-year-old TODOs are noise.

3. **My `User` class has only fields — Data Class smell?**
   Depends. If it's a domain class with operations living elsewhere, yes (move methods on). If it's a DTO for serialization, no.

4. **Is YAGNI applicable to library design?**
   Less so. Libraries serve external consumers; some flexibility is for those unknown future users. But even libraries can over-abstract — apply YAGNI to internal complexity.

5. **A team has thousands of `// TODO` comments. Strategy?**
   Bulk-process. Categorize: bugs to file, features to backlog, dead notes to delete. A 4-year-old TODO that nobody looks at is a deletion target regardless of content.

6. **Inline Class — when does it harm?**
   When the class is a future expansion point you genuinely intend to use *soon*. Or when the class encapsulates a non-trivial concept (even if used once now).

7. **Why is "Comments" listed as a smell when comments are normal?**
   Because *what*-comments are a smell. The book chapter is "Comments" but the practical advice is "comments compensating for unclear code." Why-comments are good and not the smell.

8. **A subclass has only one override. Lazy Class?**
   Possibly. If the override is real specialization (different formula), keep. If it's just `super.method()` with a different parameter, the subclass is overhead — collapse.

9. **Should you delete dead code on a feature branch?**
   Generally yes. Don't merge dead code into main. The exception: code paths reached only via flags or feature toggles that are still in flight.

10. **A team has a code-review rule "remove all `// TODO`s." Reasonable?**
    Too strict. TODOs *with a deadline or owner* are legitimate. The smell is anonymous TODOs that accumulate — those should be filed as issues or deleted.

---

> **Next:** [senior.md](senior.md) — architecture-level Dispensables and tooling.
