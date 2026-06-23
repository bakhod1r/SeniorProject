# Simplifying Conditionals — Optimize

> 12 cases where refactors are correct but introduce a perf cost.

---

## Optimize 1 — Decompose Conditional adds method-call overhead in CPython hot loop (Python)

```python
def process(items):
    for x in items:
        if is_eligible(x):    # extra call per iteration
            handle(x)
```

For 10M items, that's 10M extra Python method calls.

<details><summary>Cost & Fix</summary>

CPython method calls cost ~100ns each. 10M × 100ns = 1 second of overhead.

**Fix options:**
1. Inline for hot inner loops:
   ```python
   for x in items:
       if x.country in {"US", "CA"} and x.age >= 18:
           handle(x)
   ```
2. Use a list comprehension or generator (CPython optimizes these):
   ```python
   eligible = (x for x in items if is_eligible(x))
   for x in eligible: handle(x)
   ```
3. Vectorize with NumPy / pandas / polars.

For PyPy / JIT'd code: irrelevant.
</details>

---

## Optimize 2 — Replace Conditional with Polymorphism creates megamorphic site (Java)

```java
abstract class Discount { abstract double rate(); }
class FlatTen extends Discount { double rate() { return 0.10; } }
// ... and 30 other Discount subclasses
```

In a hot loop:
```java
for (Order o : orders) total = total.minus(total.times(o.discount().rate()));
```

<details><summary>Cost & Fix</summary>

If `o.discount().rate()` sees 30+ types, the call site is megamorphic. JIT falls back to vtable lookup. ~5-15× slower than monomorphic.

**Fix options:**
1. **Reduce variety:** can rates be parameters? `class Discount { final double rate; }` — one type, parameterized.
2. **Specialize hot paths:** if 90% of discounts are FlatTen, special-case it:
   ```java
   double r = (o.discount() instanceof FlatTen) ? 0.10 : o.discount().rate();
   ```
3. **Use enum + abstract method:** for closed sets, enum dispatch is often faster.
</details>

---

## Optimize 3 — Guard clauses + Decompose adds inlining pressure (Java)

```java
double process(Order o) {
    if (isInvalid(o)) return Money.ZERO;
    if (isCancelled(o)) return Money.ZERO;
    if (isOnHold(o)) return Money.ZERO;
    if (isFraud(o)) return Money.ZERO;
    return computePrice(o);
}
```

Each `is*` is a separate method.

<details><summary>Cost & Fix</summary>

Each is small enough to inline (probably < 35 bytes). HotSpot inlines them all into `process`. After inlining, `process` may exceed `FreqInlineSize` (325 bytes), preventing it from being inlined into its callers.

**Fix:** Re-inline to keep `process` small if needed:

```java
double process(Order o) {
    if (o.isInvalid() || o.isCancelled() || o.isOnHold() || o.isFraud()) return Money.ZERO;
    return computePrice(o);
}
```

Or accept the inlining cliff if the perf cost is minor. Profile.
</details>

---

## Optimize 4 — Pattern matching `instanceof` chain (Java 21)

```java
return switch (s) {
    case Circle c -> ...;
    case Square sq -> ...;
    case Triangle t -> ...;
    case Pentagon p -> ...;
    case Hexagon h -> ...;
    // ... 20 cases
};
```

<details><summary>Cost & Fix</summary>

For sealed types with N cases, the JIT generates an `instanceof` chain. Linear in N for the unmatched path.

For 5 cases: fast. For 50: starts costing.

**Fix:**
1. Sort cases by frequency. Most-common first.
2. For very many cases, use a `Map<Class<?>, Function<Shape, Double>>` lookup — O(1) average.
3. For closed enums: `EnumMap` is fast.
</details>

---

## Optimize 5 — Null Object instance allocation in Go (Go)

```go
type NullCustomer struct{}
func (NullCustomer) Name() string { return "guest" }

func GetCustomer(id int) Customer {
    if /* not found */ { return NullCustomer{} }
    return realCustomer
}
```

<details><summary>Cost & Fix</summary>

Each call to `GetCustomer` returning NullCustomer **may** allocate a new value. Escape analysis usually catches it (NullCustomer{} is empty, no fields), but variations may not.

**Fix:** Singleton.
```go
var NullCustomerInstance = NullCustomer{}

func GetCustomer(id int) Customer {
    if /* not found */ { return NullCustomerInstance }
    return realCustomer
}
```

Or use a pointer if the interface dispatch matters:
```go
var NullCustomerPtr Customer = &NullCustomer{}
```
</details>

---

## Optimize 6 — Consolidate Conditional with side effects (Java)

```java
if (auditLog.isEnabled()) auditLog.write(msg);   // ❌ extra call
if (cacheStats.shouldUpdate()) cacheStats.bump();
```

becomes

```java
if (auditEnabled() || cacheUpdateNeeded()) emit(...);
private boolean auditEnabled() { return auditLog.isEnabled(); }   // duplicate work
```

<details><summary>Cost & Fix</summary>

The "consolidation" loses short-circuit semantics. Both methods may be called even when one alone would have sufficed.

**Fix:** Don't consolidate ifs with side effects. Keep them separate.
</details>

---

## Optimize 7 — Replace Conditional with Polymorphism: extra allocation per call (Java)

```java
abstract class PaymentMethod { abstract void charge(Money m); }
new CreditCard("4111...").charge(m);   // ❌ allocates per call if not memoized
```

<details><summary>Cost & Fix</summary>

If you're constructing a fresh `CreditCard` per request just to dispatch, you've added an allocation.

**Fix:** Reuse instances (typically held in a registry / DI container).

For a one-off:
```java
PaymentMethod method = paymentMethodFor(user);   // cached
method.charge(m);
```

Or, if the method object holds parameters per-request: that allocation is necessary; ensure escape analysis can elide it.
</details>

---

## Optimize 8 — Decompose Conditional with virtual call (Java)

```java
abstract class OrderRule { abstract boolean isEligible(Order o); }
List<OrderRule> rules = ...;
for (OrderRule rule : rules) {
    if (rule.isEligible(o)) ...;   // ❌ virtual call per iteration
}
```

<details><summary>Cost & Fix</summary>

Each `rule.isEligible` is a virtual call. For 10K orders × 20 rules, that's 200K virtual calls. If polymorphic across types, JIT can't inline.

**Fix options:**
1. **Compile rules to a single predicate:**
   ```java
   Predicate<Order> combined = rules.stream()
       .map(r -> (Predicate<Order>) r::isEligible)
       .reduce(o -> true, Predicate::and);
   ```
   The combined predicate is *one* method call per order.
2. **For hot paths:** specialize (code-gen the rule check).
3. **Profile:** the cost may be invisible.
</details>

---

## Optimize 9 — Remove Control Flag changes loop optimizations (Java)

```java
boolean done = false;
for (int i = 0; i < array.length && !done; i++) { ... }
```

vs.

```java
for (int i = 0; i < array.length; i++) {
    if (...) break;
}
```

<details><summary>Cost & Fix</summary>

In tight numeric loops, JIT optimizers (vectorization, loop unrolling) sometimes prefer simpler termination conditions. The `&& !done` form may inhibit some optimizations.

**Fix:** Prefer `break` form or extract a method that returns. Modern JIT handles both equally for small loops; for hot numerical loops, profile.
</details>

---

## Optimize 10 — Introduce Assertion on hot path (Java)

```java
double charge(double amount, double rate) {
    assert amount >= 0;
    assert rate >= 0 && rate < 1;
    return amount * rate;
}
```

<details><summary>Cost & Fix</summary>

With `-ea`, both assertions run per call. For 1M calls, that's 4M comparisons of overhead.

In production, `-ea` is typically off. Cost is zero.

**Fix:** No fix needed if production runs without `-ea`. If you want production checks, use `Objects.requireNonNull` (always on) — but only at boundaries.
</details>

---

## Optimize 11 — Decision table allocates per call (Java)

```java
String tier(double spend, int years) {
    record Rule(BiPredicate<Double, Integer> p, String tier) {}
    return Stream.of(
        new Rule((s, y) -> y > 10 && s > 5000, "GOLD"),
        new Rule((s, y) -> s > 2000, "GOLD"),
        // ... 30 rules
    ).filter(r -> r.p.test(spend, years))
     .findFirst()
     .map(Rule::tier)
     .orElse("NONE");
}
```

<details><summary>Cost & Fix</summary>

Each call:
- Allocates the array of Rules.
- Creates a Stream.
- Allocates lambda captures.

For 10K calls/sec: ~MB/sec of garbage.

**Fix:** Hoist the rules to a static field:

```java
private static final List<Rule> RULES = List.of(
    new Rule((s, y) -> y > 10 && s > 5000, "GOLD"),
    ...
);

String tier(double spend, int years) {
    for (Rule r : RULES) {
        if (r.p.test(spend, years)) return r.tier;
    }
    return "NONE";
}
```

Static rules + explicit loop. No per-call allocation.
</details>

---

## Optimize 12 — Switch to polymorphism breaks JIT-specialized switch (Java)

```java
// Before:
switch (status) {
    case ACTIVE -> 1.0;
    case INACTIVE -> 0.0;
    case PENDING -> 0.5;
}
```

```java
// After polymorphism:
return status.factor();
```

For a tableswitch case, the JIT generates ~1 cycle dispatch. For polymorphism on an enum, also fast (enum constants are singletons; call is monomorphic if all instances are the same type).

<details><summary>Cost & Fix</summary>

Both are fast. The polymorphism version may be slightly slower if the enum's `factor()` is non-trivial (small JIT inlining limit).

**Fix:** Keep the simple switch when:
- The set of cases is closed.
- Each case is a one-liner.
- Adding a new case is rare.

Don't introduce polymorphism for clarity if the simple switch is clearer. Refactoring isn't always toward more abstraction.
</details>

---

## Patterns

| Refactor | Cost |
|---|---|
| Decompose Conditional in CPython hot loop | Per-iteration call overhead |
| Polymorphism on megamorphic site | Vtable lookup per call |
| Stream-based decision table | Per-call allocation |
| Inlined helpers exceeding inline budget | Caller no longer inlined |
| Assertion in hot path with `-ea` | Comparison per call |

---

## Next

- [tasks.md](tasks.md), [find-bug.md](find-bug.md), [interview.md](interview.md)
