# Strategy — Find the Bug

> **Source:** [refactoring.guru/design-patterns/strategy](https://refactoring.guru/design-patterns/strategy)

Each section presents a Strategy that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Loop closure captures by reference](#bug-1-loop-closure-captures-by-reference)
2. [Bug 2: Context picks strategy with `instanceof`](#bug-2-context-picks-strategy-with-instanceof)
3. [Bug 3: Mutable shared strategy state](#bug-3-mutable-shared-strategy-state)
4. [Bug 4: Strategy reaches into Context internals](#bug-4-strategy-reaches-into-context-internals)
5. [Bug 5: Hot-swap without volatile](#bug-5-hot-swap-without-volatile)
6. [Bug 6: Strategy throws checked exception not in interface](#bug-6-strategy-throws-checked-exception-not-in-interface)
7. [Bug 7: Default strategy is null](#bug-7-default-strategy-is-null)
8. [Bug 8: Hot-swap mid-call inconsistency](#bug-8-hot-swap-mid-call-inconsistency)
9. [Bug 9: Comparator violates transitivity](#bug-9-comparator-violates-transitivity)
10. [Bug 10: Strategy mutates the input it receives](#bug-10-strategy-mutates-the-input-it-receives)
11. [Bug 11: Registry leaks classloaders](#bug-11-registry-leaks-classloaders)
12. [Bug 12: Strategy holds resources without close](#bug-12-strategy-holds-resources-without-close)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Loop closure captures by reference

```python
discounts = []
for rate in [0.1, 0.2, 0.3]:
    discounts.append(lambda x: x * (1 - rate))   # built three "strategies"

print(discounts[0](100), discounts[1](100), discounts[2](100))
# Expected: 90, 80, 70
# Actual:   70, 70, 70
```

<details><summary>Reveal</summary>

**Bug:** Late-binding closure. All three lambdas capture the *same* `rate` variable. By the time any of them runs, `rate == 0.3`.

**Fix:** bind via default argument.

```python
discounts.append(lambda x, r=rate: x * (1 - r))
```

Or use `functools.partial`:

```python
from functools import partial
discounts.append(partial(lambda r, x: x * (1 - r), rate))
```

**Lesson:** Closures capture variables, not values. In strategy factories built in loops, this trap is common in Python and (with `var`) JavaScript. Languages with `let` / `final` (JS, Java) sidestep it.

</details>

---

## Bug 2: Context picks strategy with `instanceof`

```java
public final class Checkout {
    public void pay(Object payment) {
        if (payment instanceof CreditCard) {
            new CardStrategy().pay((CreditCard) payment);
        } else if (payment instanceof PayPalAccount) {
            new PayPalStrategy().pay((PayPalAccount) payment);
        } else {
            throw new IllegalArgumentException();
        }
    }
}
```

It works. Adding `Crypto` requires editing `Checkout`.

<details><summary>Reveal</summary>

**Bug:** OCP violation. `Checkout` knows about every strategy. Adding a new payment type modifies `Checkout` — exactly what Strategy is supposed to prevent.

**Fix:** make payment / strategy polymorphic.

```java
public interface PaymentStrategy {
    void pay(PaymentRequest req);
}

public final class Checkout {
    public void pay(PaymentStrategy s, PaymentRequest req) {
        s.pay(req);
    }
}
```

Or wire by registry / DI so the call site doesn't branch.

**Lesson:** `instanceof` chains are Strategy waiting to be born. Replace with polymorphic dispatch.

</details>

---

## Bug 3: Mutable shared strategy state

```java
public final class CountingStrategy implements Strategy {
    private int callCount = 0;
    public Result run(Input i) {
        callCount++;
        return Result.of(callCount);
    }
    public int count() { return callCount; }
}

// In two threads:
strategy.run(input);    // both threads share the same instance
```

<details><summary>Reveal</summary>

**Bug:** Race on `callCount`. Without synchronization, increments are lost; the count is wrong.

**Fix:** make the field atomic, or scope per thread.

```java
private final AtomicInteger callCount = new AtomicInteger();
public Result run(Input i) {
    return Result.of(callCount.incrementAndGet());
}
```

Or — better — make the strategy stateless and move counting outside.

**Lesson:** Strategies shared across threads must be either stateless or properly synchronized. Default to stateless.

</details>

---

## Bug 4: Strategy reaches into Context internals

```java
public final class Cart {
    List<Item> items;
    PricingStrategy strategy;
    public Money total() { return strategy.compute(this); }
}

public final class StudentPricing implements PricingStrategy {
    public Money compute(Cart cart) {
        int subtotal = cart.items.stream().mapToInt(Item::cents).sum();   // direct access
        return new Money(subtotal).discount(0.15);
    }
}
```

<details><summary>Reveal</summary>

**Bug:** Strategy accesses `cart.items` directly. Now the strategy is coupled to `Cart`'s field layout. `Cart` can't refactor without breaking strategies.

**Fix:** pass *what the strategy needs*, not the Context.

```java
public interface PricingStrategy {
    Money compute(int subtotalCents);
}

public final class StudentPricing implements PricingStrategy {
    public Money compute(int subtotalCents) {
        return new Money(subtotalCents).discount(0.15);
    }
}

public final class Cart {
    public Money total() { return strategy.compute(subtotalCents()); }
    private int subtotalCents() { return items.stream().mapToInt(Item::cents).sum(); }
}
```

**Lesson:** Strategy should depend on a contract, not on the Context's class. Keep coupling minimal.

</details>

---

## Bug 5: Hot-swap without volatile

```java
public final class Context {
    private Strategy strategy;
    public void setStrategy(Strategy s) { this.strategy = s; }
    public Result run(Input i) { return strategy.run(i); }
}
```

Tests pass. In production, sometimes a swap takes minutes to be observed by a worker thread.

<details><summary>Reveal</summary>

**Bug:** Without `volatile` (or some other memory barrier), a thread can cache the old reference indefinitely. Updates from another thread aren't guaranteed to be visible.

**Fix:** mark the field `volatile`.

```java
private volatile Strategy strategy;
```

Or use `AtomicReference<Strategy>`. Either gives you visibility guarantees.

**Lesson:** In Java's memory model, plain field reads/writes don't synchronize across threads. For mutable shared references, declare `volatile`.

</details>

---

## Bug 6: Strategy throws checked exception not in interface

```java
public interface Strategy {
    Result run(Input i);            // doesn't declare exceptions
}

public final class FlakyStrategy implements Strategy {
    public Result run(Input i) {
        try {
            return Result.of(http.get(i.url()));
        } catch (IOException e) {
            throw new RuntimeException(e);   // wrapped to comply with interface
        }
    }
}
```

Callers see opaque `RuntimeException`. They can't catch `IOException` cleanly.

<details><summary>Reveal</summary>

**Bug:** The exception type is hidden behind `RuntimeException`. Callers can't react to the *kind* of failure.

**Fix:** define a typed exception in the contract.

```java
public class StrategyException extends RuntimeException {
    public StrategyException(String msg, Throwable cause) { super(msg, cause); }
}

public interface Strategy {
    Result run(Input i) throws StrategyException;
}
```

Or use a `Result<T, E>` type (Either / Result) and avoid exceptions for control flow.

**Lesson:** Strategy interfaces should declare their failure modes. Hidden exceptions are a leak in the contract.

</details>

---

## Bug 7: Default strategy is null

```java
public final class Cart {
    private DiscountStrategy discount;     // not initialized
    public Money total() {
        int subtotal = subtotalCents();
        return discount.apply(new Money(subtotal));   // NPE
    }
}
```

<details><summary>Reveal</summary>

**Bug:** No default. Calling `total()` before `setDiscount()` throws NPE.

**Fix:** provide a default identity strategy.

```java
public static final DiscountStrategy NO_DISCOUNT = m -> m;
private DiscountStrategy discount = NO_DISCOUNT;
```

Or fail fast in the constructor:

```java
public Cart(DiscountStrategy discount) {
    this.discount = Objects.requireNonNull(discount);
}
```

**Lesson:** A Strategy field that can be null is a hidden state machine. Pick: enforce non-null at construction, or always provide a working default.

</details>

---

## Bug 8: Hot-swap mid-call inconsistency

```java
public final class Context {
    private volatile Strategy strategy;

    public void process(Input a, Input b) {
        Result r1 = strategy.run(a);   // strategy = X
        // ... another thread swaps strategy to Y here ...
        Result r2 = strategy.run(b);   // strategy = Y
        merge(r1, r2);                  // mismatched results
    }
}
```

<details><summary>Reveal</summary>

**Bug:** The strategy can change between calls within one operation. Even with `volatile`, the second call sees a different strategy.

**Fix:** snapshot once.

```java
public void process(Input a, Input b) {
    Strategy local = strategy;
    Result r1 = local.run(a);
    Result r2 = local.run(b);
    merge(r1, r2);
}
```

Now both calls go through the same strategy.

**Lesson:** `volatile` gives per-read visibility. For multi-step operations, snapshot the strategy reference once.

</details>

---

## Bug 9: Comparator violates transitivity

```java
Comparator<Order> byPriorityThenPrice = (a, b) -> {
    if (a.isUrgent()) return -1;
    if (b.isUrgent()) return 1;
    return Integer.compare(a.price(), b.price());
};
```

A list of urgent orders compares unstably; sometimes throws `IllegalArgumentException: Comparison method violates its general contract`.

<details><summary>Reveal</summary>

**Bug:** Two urgent orders both return `-1` against each other (`compare(a, b) = -1` AND `compare(b, a) = -1`). Violates antisymmetry, breaks the contract, JDK's TimSort detects this.

**Fix:** handle the case where *both* are urgent.

```java
Comparator<Order> byPriorityThenPrice = (a, b) -> {
    if (a.isUrgent() && !b.isUrgent()) return -1;
    if (!a.isUrgent() && b.isUrgent()) return 1;
    return Integer.compare(a.price(), b.price());
};
```

Or use the chaining helpers:

```java
Comparator.comparing((Order o) -> !o.isUrgent())
          .thenComparingInt(Order::price);
```

**Lesson:** Strategy interfaces have contracts. A `Comparator` must be transitive, antisymmetric, and consistent with equals (where applicable). Violating these explodes at runtime.

</details>

---

## Bug 10: Strategy mutates the input it receives

```python
def sort_strategy(items: list[int]) -> list[int]:
    items.sort()
    return items
```

Caller passes a list; later inspects the original — it's been sorted. Surprise.

<details><summary>Reveal</summary>

**Bug:** Strategy mutates the caller's input. Even though `sort()` is idiomatic, returning the sorted list while ALSO mutating the input violates least-surprise.

**Fix:** decide once.

Pure (recommended):

```python
def sort_strategy(items: list[int]) -> list[int]:
    return sorted(items)   # new list, original unchanged
```

Or document explicitly:

```python
def sort_in_place(items: list[int]) -> None:
    """Sort list in place. Returns None."""
    items.sort()
```

**Lesson:** Mutability is fine — but be explicit. Strategies that quietly mutate inputs are the source of the worst kind of bugs.

</details>

---

## Bug 11: Registry leaks classloaders

```java
public final class StrategyRegistry {
    private static final Map<String, Strategy> map = new HashMap<>();

    public static void register(String name, Strategy s) {
        map.put(name, s);
    }
}
```

In a containerized app server, redeploying the WAR leaves old `Strategy` classes in `map`. Their classloader can't be GC'd. Memory grows.

<details><summary>Reveal</summary>

**Bug:** Static map holds references to objects from the (now-undeployed) classloader. The classloader can't be unloaded. Each redeploy adds another set.

**Fix:** instance-scoped registry, not static.

```java
@Component
public class StrategyRegistry {
    private final Map<String, Strategy> map = new HashMap<>();
    // ...
}
```

The bean is GC'd when the context is destroyed; classloader is unloaded.

**Lesson:** Static singletons in container environments leak. Prefer instance-scoped registries managed by the DI container.

</details>

---

## Bug 12: Strategy holds resources without close

```java
public final class HttpStrategy implements Strategy {
    private final HttpClient client = HttpClient.newHttpClient();

    public Result run(Input i) {
        return Result.of(client.send(i.request()));
    }
}
```

Strategies are created per request: a new `HttpClient` each time. After hours, the app exhausts file descriptors.

<details><summary>Reveal</summary>

**Bug:** `HttpClient` owns a connection pool, internal threads, sockets. It's not a one-shot value. Creating many of them leaks resources.

**Fix:** share a single client across calls; close explicitly when the strategy is replaced.

```java
public final class HttpStrategy implements Strategy, AutoCloseable {
    private final HttpClient client;

    public HttpStrategy(HttpClient client) {
        this.client = client;
    }

    public Result run(Input i) { /* ... */ }
    public void close() { /* HttpClient is auto-closed via JVM shutdown */ }
}
```

Or make `HttpStrategy` itself a singleton: one client per app, swap a wrapping config but keep the inner client alive.

**Lesson:** Strategy is conceptually lightweight, but if it owns resources, lifecycle management is required. Plan for swap, plan for shutdown.

</details>

---

## Practice Tips

- **Look for `instanceof` chains.** They're Strategy waiting to happen — and often hide the same bug as Bug 2.
- **Audit shared mutable state.** Stateless Strategy is the safe default; stateful must be deliberate.
- **Check Comparator implementations.** Bug 9 (transitivity) is one of the most common production bugs — JDK throws at runtime.
- **Trace exception types across the boundary.** Bug 6 hides failure modes. Document and type them.
- **Inspect lifecycle.** A strategy that owns resources but lacks close → memory / fd leak.
- **Test concurrent swaps.** Even with `volatile`, mid-call swaps surprise you. Snapshot once.

[← Tasks](tasks.md) · [Optimize →](optimize.md)
