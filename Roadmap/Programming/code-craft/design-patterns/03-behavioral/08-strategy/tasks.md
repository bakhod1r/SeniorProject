# Strategy — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/strategy](https://refactoring.guru/design-patterns/strategy)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Comparator strategies for sorting](#task-1-comparator-strategies-for-sorting)
2. [Task 2: Pricing engine](#task-2-pricing-engine)
3. [Task 3: Payment registry](#task-3-payment-registry)
4. [Task 4: Compression context](#task-4-compression-context)
5. [Task 5: Function-as-strategy discount](#task-5-function-as-strategy-discount)
6. [Task 6: Hot-swap with `volatile`](#task-6-hot-swap-with-volatile)
7. [Task 7: Strategy + factory by enum](#task-7-strategy-factory-by-enum)
8. [Task 8: Refactor `if/else` chain to Strategy](#task-8-refactor-ifelse-chain-to-strategy)
9. [Task 9: Per-tenant Strategy](#task-9-per-tenant-strategy)
10. [Task 10: Stack of fallback strategies](#task-10-stack-of-fallback-strategies)
11. [How to Practice](#how-to-practice)

---

## Task 1: Comparator strategies for sorting

**Brief.** Sort a list of `Order(price, createdAt)` four ways: by price asc, by price desc, by createdAt desc, by price asc *then* createdAt desc.

### Solution (Java)

```java
record Order(int price, Instant createdAt) {}

List<Order> orders = ...;

orders.sort(Comparator.comparingInt(Order::price));
orders.sort(Comparator.comparingInt(Order::price).reversed());
orders.sort(Comparator.comparing(Order::createdAt).reversed());
orders.sort(
    Comparator.comparingInt(Order::price)
              .thenComparing(Order::createdAt, Comparator.reverseOrder())
);
```

`Comparator` is the Strategy. `sort` is the Context.

---

## Task 2: Pricing engine

**Brief.** A `Cart` of items (each with cents). Three pricing strategies: standard (sum), student (15% off), holiday (parameterized rate). Test each.

### Solution (Java)

```java
interface PricingStrategy { Money price(Cart cart); }

record Money(int cents) {
    Money discount(double rate) { return new Money((int)(cents * (1 - rate))); }
}

class Cart {
    List<Item> items = new ArrayList<>();
    int subtotalCents() { return items.stream().mapToInt(Item::cents).sum(); }
}

class StandardPricing implements PricingStrategy {
    public Money price(Cart c) { return new Money(c.subtotalCents()); }
}

class StudentPricing implements PricingStrategy {
    public Money price(Cart c) { return new Money(c.subtotalCents()).discount(0.15); }
}

class HolidayPricing implements PricingStrategy {
    private final double rate;
    HolidayPricing(double rate) { this.rate = rate; }
    public Money price(Cart c) { return new Money(c.subtotalCents()).discount(rate); }
}
```

Tests:

```java
@Test void standardSumsItems() {
    Cart c = new Cart(); c.items.add(new Item(100)); c.items.add(new Item(50));
    assertEquals(150, new StandardPricing().price(c).cents());
}

@Test void studentTakes15Off() {
    Cart c = new Cart(); c.items.add(new Item(100));
    assertEquals(85, new StudentPricing().price(c).cents());
}

@Test void holidayRateConfigurable() {
    Cart c = new Cart(); c.items.add(new Item(100));
    assertEquals(50, new HolidayPricing(0.5).price(c).cents());
}
```

---

## Task 3: Payment registry

**Brief.** A registry that maps a string key to a `PaymentStrategy`. Add `card`, `paypal`, `crypto`. Throw `UnknownStrategyException` for unknown keys.

### Solution (Python)

```python
from typing import Callable, Dict

PaymentStrategy = Callable[[float], None]


class UnknownStrategyError(KeyError):
    pass


class Registry:
    def __init__(self) -> None:
        self._m: Dict[str, PaymentStrategy] = {}

    def register(self, name: str, fn: PaymentStrategy) -> None:
        self._m[name] = fn

    def get(self, name: str) -> PaymentStrategy:
        try:
            return self._m[name]
        except KeyError:
            raise UnknownStrategyError(f"unknown strategy: {name}")


def pay_card(amount: float)   -> None: print(f"card: {amount}")
def pay_paypal(amount: float) -> None: print(f"paypal: {amount}")
def pay_crypto(amount: float) -> None: print(f"crypto: {amount}")


reg = Registry()
reg.register("card",   pay_card)
reg.register("paypal", pay_paypal)
reg.register("crypto", pay_crypto)


def checkout(amount: float, method: str) -> None:
    reg.get(method)(amount)


checkout(99.99, "card")
checkout(150.0, "paypal")
```

---

## Task 4: Compression context

**Brief.** A `Compressor` that delegates to one of `gzip` / `zstd` / `brotli`. Each is a Strategy.

### Solution (Go)

```go
package main

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
)

type CompressionStrategy interface {
	Name() string
	Compress(in []byte) ([]byte, error)
}

type Gzip struct{}

func (Gzip) Name() string { return "gzip" }
func (Gzip) Compress(in []byte) ([]byte, error) {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := io.Copy(w, bytes.NewReader(in)); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// (Stub Zstd / Brotli for brevity; same interface.)

type Compressor struct{ strategy CompressionStrategy }

func NewCompressor(s CompressionStrategy) *Compressor { return &Compressor{strategy: s} }
func (c *Compressor) Set(s CompressionStrategy)       { c.strategy = s }
func (c *Compressor) Compress(b []byte) ([]byte, error) {
	return c.strategy.Compress(b)
}

func main() {
	c := NewCompressor(Gzip{})
	out, err := c.Compress([]byte("hello hello hello"))
	if err != nil { panic(err) }
	fmt.Printf("%s: %d bytes -> %d bytes\n", c.strategy.Name(), 17, len(out))
}
```

---

## Task 5: Function-as-strategy discount

**Brief.** A `Cart.total()` that takes a discount **function** instead of a class.

### Solution (TypeScript)

```typescript
type DiscountStrategy = (subtotal: number) => number;

const noDiscount: DiscountStrategy = s => s;
const studentDiscount: DiscountStrategy = s => s * 0.85;
const holiday = (rate: number): DiscountStrategy => s => s * (1 - rate);

class Cart {
    private items: number[] = [];

    add(price: number): void { this.items.push(price); }
    total(discount: DiscountStrategy = noDiscount): number {
        const subtotal = this.items.reduce((a, b) => a + b, 0);
        return discount(subtotal);
    }
}

const c = new Cart();
c.add(100); c.add(50); c.add(20);

console.log(c.total());                  // 170
console.log(c.total(studentDiscount));   // 144.5
console.log(c.total(holiday(0.5)));      // 85
```

A function — just as Strategy as a class. Choose by complexity.

---

## Task 6: Hot-swap with `volatile`

**Brief.** A Context that allows the Strategy to be replaced from another thread while `execute()` is running.

### Solution (Java)

```java
public final class HotSwapContext {
    private volatile Strategy strategy;

    public HotSwapContext(Strategy initial) { this.strategy = initial; }

    public void setStrategy(Strategy s) { this.strategy = s; }

    public Result execute(Input i) {
        Strategy local = strategy;          // snapshot once
        return local.run(i);
    }
}
```

Snapshot once per call. Without it, two consecutive calls to `strategy.x()` and `strategy.y()` could land on different strategies.

---

## Task 7: Strategy + factory by enum

**Brief.** A factory that returns a `RouteStrategy` based on an enum.

### Solution (Java)

```java
public enum RouteMode {
    FASTEST, SHORTEST, SCENIC;
}

public final class RouteStrategyFactory {
    public static RouteStrategy of(RouteMode mode) {
        return switch (mode) {
            case FASTEST  -> new FastestRoute();
            case SHORTEST -> new ShortestRoute();
            case SCENIC   -> new ScenicRoute();
        };
    }
}
```

Compile-time exhaustiveness. Adding `FUEL_EFFICIENT` requires adding the enum constant and the case — the compiler catches missing cases.

---

## Task 8: Refactor `if/else` chain to Strategy

**Brief.** Convert this messy method to Strategy.

```java
public Money price(Cart cart, String mode) {
    if (mode.equals("standard")) {
        return new Money(cart.subtotalCents());
    } else if (mode.equals("student")) {
        return new Money(cart.subtotalCents()).discount(0.15);
    } else if (mode.equals("holiday")) {
        return new Money(cart.subtotalCents()).discount(0.30);
    } else if (mode.equals("vip")) {
        return new Money(cart.subtotalCents()).discount(0.40);
    }
    throw new IllegalArgumentException("unknown mode: " + mode);
}
```

### Solution

```java
interface PricingStrategy { Money price(Cart cart); }

class StandardPricing implements PricingStrategy { public Money price(Cart c) { /* ... */ } }
class StudentPricing  implements PricingStrategy { public Money price(Cart c) { /* ... */ } }
class HolidayPricing  implements PricingStrategy { public Money price(Cart c) { /* ... */ } }
class VipPricing      implements PricingStrategy { public Money price(Cart c) { /* ... */ } }

class PricingFactory {
    private final Map<String, PricingStrategy> map = Map.of(
        "standard", new StandardPricing(),
        "student",  new StudentPricing(),
        "holiday",  new HolidayPricing(),
        "vip",      new VipPricing()
    );
    PricingStrategy of(String mode) {
        PricingStrategy s = map.get(mode);
        if (s == null) throw new IllegalArgumentException("unknown mode: " + mode);
        return s;
    }
}

class PriceCalculator {
    private final PricingFactory factory;
    PriceCalculator(PricingFactory f) { this.factory = f; }
    public Money price(Cart cart, String mode) {
        return factory.of(mode).price(cart);
    }
}
```

The `if/else` moved to the factory. `PriceCalculator` now has one line of business code.

---

## Task 9: Per-tenant Strategy

**Brief.** A SaaS app where each tenant has its own pricing rules. Strategies are loaded lazily and cached per tenant.

### Solution (Java)

```java
public final class TenantPricing {
    private final Map<String, PricingStrategy> cache = new ConcurrentHashMap<>();
    private final Function<String, PricingStrategy> loader;

    public TenantPricing(Function<String, PricingStrategy> loader) {
        this.loader = loader;
    }

    public Money price(String tenantId, Cart cart) {
        return cache.computeIfAbsent(tenantId, loader).price(cart);
    }

    public void invalidate(String tenantId) { cache.remove(tenantId); }
}
```

Lazily load on first request; invalidate on plan change.

---

## Task 10: Stack of fallback strategies

**Brief.** Try multiple strategies in order; first successful wins. (Note: this leans toward Chain of Responsibility — but Strategy variants drive the chain.)

### Solution (Python)

```python
from typing import List, Optional, Protocol


class FetchStrategy(Protocol):
    def fetch(self, key: str) -> Optional[str]: ...


class CacheStrategy:
    def __init__(self, cache: dict) -> None:
        self._cache = cache
    def fetch(self, key: str) -> Optional[str]:
        return self._cache.get(key)


class DatabaseStrategy:
    def fetch(self, key: str) -> Optional[str]:
        return f"db:{key}"   # always succeeds for demo


class StackedFetcher:
    def __init__(self, strategies: List[FetchStrategy]) -> None:
        self._strategies = strategies

    def fetch(self, key: str) -> str:
        for s in self._strategies:
            v = s.fetch(key)
            if v is not None: return v
        raise LookupError(f"no strategy returned a value for {key!r}")


fetcher = StackedFetcher([
    CacheStrategy({"x": "from-cache"}),
    DatabaseStrategy(),
])

print(fetcher.fetch("x"))   # from-cache
print(fetcher.fetch("y"))   # db:y
```

Each Strategy *might* return; the stack short-circuits on first success.

---

## How to Practice

- **Start with the obvious one — Comparator.** It's where Strategy clicks for most people.
- **Refactor a real codebase.** Find an `if/else` chain over an algorithm choice and Strategy-ify it.
- **Compare function vs class.** Implement the same Strategy both ways. Notice when each feels right.
- **Run tests with stub strategies.** Verify Context delegation in isolation.
- **Read libraries.** `java.util.Comparator`, Spring's `PasswordEncoder`, Kafka's `Partitioner`. See how Strategy is used in production code.
- **Avoid premature Strategy.** Wait for the second algorithm. The pattern emerges naturally when you need it.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
