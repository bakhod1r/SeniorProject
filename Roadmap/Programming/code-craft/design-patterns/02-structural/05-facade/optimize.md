# Facade — Optimize

> **Source:** [refactoring.guru/design-patterns/facade](https://refactoring.guru/design-patterns/facade)

Each section presents a Facade that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Parallelize independent subsystem calls](#optimization-1-parallelize-independent-subsystem-calls)
2. [Optimization 2: Cache expensive computations at the Facade](#optimization-2-cache-expensive-computations-at-the-facade)
3. [Optimization 3: Reuse connection pools](#optimization-3-reuse-connection-pools)
4. [Optimization 4: Reduce DTO allocations](#optimization-4-reduce-dto-allocations)
5. [Optimization 5: Pre-compile patterns and configs](#optimization-5-pre-compile-patterns-and-configs)
6. [Optimization 6: Batch subsystem calls](#optimization-6-batch-subsystem-calls)
7. [Optimization 7: Lazy initialization for rare paths](#optimization-7-lazy-initialization-for-rare-paths)
8. [Optimization 8: Short-circuit on first failure](#optimization-8-short-circuit-on-first-failure)
9. [Optimization 9: Centralize observability](#optimization-9-centralize-observability)
10. [Optimization 10: Drop redundant Facade layers](#optimization-10-drop-redundant-facade-layers)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Parallelize independent subsystem calls

### Before

```java
public OrderQuote quote(QuoteCommand cmd) {
    var inv = inventory.check(cmd.items());      // 50 ms
    var price = pricing.quote(cmd.items());      // 80 ms
    var risk = fraud.score(cmd.user(), cmd.ip()); // 100 ms
    return new OrderQuote(inv, price, risk);
}
// Latency: ~230 ms
```

### After

```java
var inv = supplyAsync(() -> inventory.check(cmd.items()), executor);
var price = supplyAsync(() -> pricing.quote(cmd.items()), executor);
var risk = supplyAsync(() -> fraud.score(cmd.user(), cmd.ip()), executor);

return allOf(inv, price, risk)
    .thenApply(_ -> new OrderQuote(inv.join(), price.join(), risk.join()))
    .orTimeout(2, SECONDS)
    .join();
// Latency: ~100 ms (max of three)
```

**Measurement.** P99 quote latency drops from 280 ms to ~120 ms.

**Lesson:** Facades fronting independent subsystem calls are the perfect place to parallelize. The pattern itself doesn't say "sequential."

---

## Optimization 2: Cache expensive computations at the Facade

### Before

```python
class PricingFacade:
    def quote(self, item_ids, user_id):
        items = self._catalog.get_many(item_ids)
        rates = self._tax.get_rates(self._user.country_of(user_id))   # ← expensive
        return sum(item.price for item in items) * (1 + rates.total)
```

`get_rates` parses tax tables every call. CPU dominates.

### After

```python
from functools import lru_cache


class PricingFacade:
    @lru_cache(maxsize=200)
    def _rates_for(self, country: str):
        return self._tax.get_rates(country)

    def quote(self, item_ids, user_id):
        items = self._catalog.get_many(item_ids)
        country = self._user.country_of(user_id)
        rates = self._rates_for(country)
        return sum(item.price for item in items) * (1 + rates.total)
```

**Measurement.** ~30% CPU drop on the pricing service. Memory bounded.

**Lesson:** Caching deterministic, expensive, low-cardinality values at the Facade is often a big win. Bound the cache.

---

## Optimization 3: Reuse connection pools

### Before

```python
class HttpFacade:
    def get(self, url):
        pool = urllib3.PoolManager()    # new per call
        return pool.request("GET", url)
```

Each call does TLS handshake + TCP setup.

### After

```python
class HttpFacade:
    def __init__(self):
        self._pool = urllib3.PoolManager()   # shared

    def get(self, url):
        return self._pool.request("GET", url)
```

**Measurement.** 5-10× faster on repeated requests (handshake reuse). Lower CPU.

**Lesson:** Long-lived resources (pools, clients, connections) belong as Facade fields, constructed once.

---

## Optimization 4: Reduce DTO allocations

### Before

```java
public OrderResponseDto placeOrder(PlaceOrderRequest req) {
    var cmd = new PlaceOrderCommand(req.userId(), mapItems(req.items()), req.payment());
    var order = inner.placeOrder(cmd);
    return new OrderResponseDto(order.id(), order.userId(), mapItemsBack(order.items()),
                                 order.total(), order.placedAt());
}
```

Two intermediate objects per call. At 100k QPS, GC pressure measurable.

### After

If the request shape and command shape are the same, use a single record:

```java
public record OrderRequest(String userId, List<OrderItem> items, PaymentMethod payment) {}
```

Or use lazy mapping (don't materialize fields the response doesn't need).

For very hot paths, object pools or thread-local builders.

**Measurement.** Allocation rate drops 30-50%. GC pause time falls.

**Lesson:** Profile allocations; use records, structs, or pools when GC pressure is high. The Facade boundary often allocates more than necessary.

---

## Optimization 5: Pre-compile patterns and configs

### Before

```python
class FormValidator:
    def validate(self, form: dict) -> bool:
        if not re.match(r"^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", form["email"]):
            return False
        if not re.match(r"^\+?[0-9\s-]{7,}$", form["phone"]):
            return False
        return True
```

`re.compile` happens on every call.

### After

```python
class FormValidator:
    _EMAIL_RE = re.compile(r"^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
    _PHONE_RE = re.compile(r"^\+?[0-9\s-]{7,}$")

    def validate(self, form: dict) -> bool:
        if not self._EMAIL_RE.match(form["email"]): return False
        if not self._PHONE_RE.match(form["phone"]): return False
        return True
```

**Measurement.** ~10× faster.

**Lesson:** Compile static patterns and configs once. Common Facade footgun.

---

## Optimization 6: Batch subsystem calls

### Before

```java
public List<EnrichedOrder> enrichOrders(List<Order> orders) {
    return orders.stream()
        .map(o -> new EnrichedOrder(o, userService.getUser(o.userId())))   // N calls
        .toList();
}
```

Fetching user info one at a time. N orders → N DB roundtrips.

### After

```java
public List<EnrichedOrder> enrichOrders(List<Order> orders) {
    Set<String> userIds = orders.stream().map(Order::userId).collect(toSet());
    Map<String, User> users = userService.getMany(userIds);   // 1 call
    return orders.stream()
        .map(o -> new EnrichedOrder(o, users.get(o.userId())))
        .toList();
}
```

**Measurement.** Latency drops from O(N) round trips to 1. For 100 orders × 5 ms, that's 500 ms → 5 ms.

**Lesson:** Facade methods that loop over subsystem calls should batch. N+1 query patterns hide here.

---

## Optimization 7: Lazy initialization for rare paths

### Before

```java
public class OrderService {
    private final InventoryService inv;
    private final PaymentProcessor pay;
    private final TaxEngine tax;
    private final FraudService fraud;       // expensive to construct
    private final ShippingCalculator ship;  // expensive to construct

    public OrderService(...) {
        // construct all
    }

    public Order placeOrder(...) {
        // 99% of calls don't need fraud or shipping
    }
}
```

Boot is slow because all subsystems initialize.

### After

```java
public class OrderService {
    private final InventoryService inv;
    private final PaymentProcessor pay;
    private final TaxEngine tax;
    private final Supplier<FraudService> fraudSupplier;
    private final Supplier<ShippingCalculator> shipSupplier;
    private FraudService fraud;
    private ShippingCalculator ship;

    private FraudService fraud() {
        if (fraud == null) fraud = fraudSupplier.get();
        return fraud;
    }
    // ...
}
```

**Measurement.** Boot time drops; memory footprint smaller.

**Lesson:** Lazy-construct expensive subsystem dependencies the Facade rarely uses.

---

## Optimization 8: Short-circuit on first failure

### Before

```java
public OrderQuote quote(QuoteCommand cmd) {
    var inv = supplyAsync(() -> inventory.check(cmd.items()), exec);
    var price = supplyAsync(() -> pricing.quote(cmd.items()), exec);
    var risk = supplyAsync(() -> fraud.score(cmd.user()), exec);

    return allOf(inv, price, risk)   // waits for all even if inv failed
        .thenApply(...)
        .join();
}
```

If `inventory.check` rejects (out of stock), `pricing` and `fraud` waste compute.

### After

```java
public OrderQuote quote(QuoteCommand cmd) {
    var inv = supplyAsync(() -> inventory.check(cmd.items()), exec);
    var price = supplyAsync(() -> pricing.quote(cmd.items()), exec);
    var risk = supplyAsync(() -> fraud.score(cmd.user()), exec);

    var any = anyOf(failed(inv), failed(price), failed(risk));   // short-circuit on first failure
    return allOf(inv, price, risk)
        .applyToEither(any, _ -> new OrderQuote(inv.join(), price.join(), risk.join()))
        .join();
}
```

**Measurement.** Failure path latency drops; under heavy fail mode, downstream load drops.

**Lesson:** Don't wait for slow subsystem calls if you can short-circuit on a likely-fail signal.

---

## Optimization 9: Centralize observability

### Before

Each subsystem service logs / records metrics independently. Same request appears under 4 unrelated trace IDs; correlating is painful.

### After

Add observability *at the Facade*. One span for the use case, child spans for each subsystem call. Metrics by use-case name. Logs include `request_id` propagated through context.

```go
func (c *CheckoutFacade) PlaceOrder(ctx context.Context, cmd PlaceOrderCommand) (*Order, error) {
    span, ctx := tracer.StartSpan(ctx, "checkout.place_order")
    defer span.End()
    span.SetAttribute("user_id", cmd.UserID)

    start := time.Now()
    defer func() { metrics.RecordLatency("checkout.place_order", time.Since(start)) }()

    // ... call subsystems with ctx ...
}
```

**Measurement.** Mean time to triage drops dramatically. Dashboards become useful.

**Lesson:** Facade is the right place for observability — it knows the use case. Don't bury it in subsystems.

---

## Optimization 10: Drop redundant Facade layers

### Before

```
HTTP route → BFF Facade → Application Facade → Module Facade → Service → Domain
```

Six layers. Each adds 1-2 ms; total latency tax: ~10 ms per request.

### After

Audit each layer:
- BFF: needed (client-shaping).
- Application Facade: needed (orchestration).
- Module Facade: ❓ — often pass-through.
- Service: needed (business logic).

Drop the Module Facade; route Application directly to Service.

**Measurement.** Latency drops; mental model simplifies; fewer files to maintain.

**Lesson:** Facade layers are easy to add and easy to forget. Periodic audits keep architecture sane.

---

## Optimization Tips

1. **Profile first.** Most Facades aren't the bottleneck — subsystem work dominates.
2. **Parallelize independent calls.** Sum → max latency.
3. **Cache deterministic, expensive, low-cardinality values** at the Facade.
4. **Reuse pools / clients.** Constructed once; held as fields.
5. **Reduce DTO allocations.** Records, lazy mapping, pools where hot.
6. **Pre-compile patterns and configs.** Static state belongs at class level.
7. **Batch subsystem calls.** N+1 patterns hide in Facades.
8. **Lazy-construct rarely-used subsystems.** Boot time matters.
9. **Short-circuit failure paths.** Don't wait for slow calls when you've already failed.
10. **Centralize observability** at the Facade — single point for the use case.
11. **Drop redundant Facade layers.** Pass-through Facades are tax with no benefit.
12. **Optimize for change too.** A clean focused Facade beats a tweaked god class.

---

← Back to Facade folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**You've completed the Facade pattern suite.** Continue to: [Flyweight](../06-flyweight/junior.md) · [Proxy](../07-proxy/junior.md)
