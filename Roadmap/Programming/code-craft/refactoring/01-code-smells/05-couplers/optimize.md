# Couplers — Optimize

> 12 inefficient cures and architectural decisions related to Couplers.

---

## Optimize 1 — Hide Delegate that doesn't inline (Java)

**Original:**

```java
class Customer {
    private Order currentOrder;
    
    public String shippingCity() {
        if (currentOrder == null) return null;
        return currentOrder.shippingCity();
    }
}

class Order {
    private Address shippingAddress;
    public String shippingCity() {
        return shippingAddress.city();
    }
}
```

In a hot path, `customer.shippingCity()` is called 1M times.

**Issue:** if `Customer.shippingCity` is too large to inline (unlikely, but possible with logging or other code), each call adds a method dispatch.

**Fix:** keep the hidden chain compact. JIT inlines small methods; the chain disappears at runtime.

If profiling shows it doesn't inline:
- Remove unnecessary code from the delegate methods.
- Use `final` on classes / methods to allow devirtualization.
- For hot paths only, accept inlining the chain at the call site.

---

## Optimize 2 — Move Method causing cross-package access (Java)

**Original (after Move Method):**

```java
package com.example.invoicing;

class Order {
    public BigDecimal total() {
        return TaxRules.applyTax(...);  // moved here from Invoice
    }
}

package com.example.tax;

public class TaxRules {
    public static BigDecimal applyTax(...) { ... }
}
```

**Issue:** Order now depends on the tax package — directional coupling that didn't exist before.

**Fix:** consider the dependency direction. If domain → tax is OK (tax is a low-level utility), keep. If tax → domain is preferred (domain shouldn't know tax details), consider:

(a) Inject tax computation as a `TaxStrategy` interface; Order doesn't import the tax package.

(b) Compute outside Order:

```java
class Invoice {
    public BigDecimal totalForOrder(Order order, TaxRules taxRules) {
        return order.subtotal().add(taxRules.taxOn(order.subtotal()));
    }
}
```

Move Method must respect dependency direction. If moving creates a *cycle*, abort.

---

## Optimize 3 — Eliminating Middle Man removes performance buffer (Java)

**Original:**

```java
class CachedUserRepo {
    private final UserRepo real;
    private final Cache<Long, User> cache = ...;
    
    public User findById(Long id) {
        return cache.get(id, () -> real.findById(id));
    }
}
```

A "Remove Middle Man" zealot suggests deleting `CachedUserRepo` and using `UserRepo` directly.

**Issue:** the wrapper *was* doing real work (caching). Removing it removes the cache. Now every read hits the database.

**Fix:** don't apply Remove Middle Man blindly. Verify the wrapper has *no value-add* before deleting. A wrapper that adds caching, validation, security, retries, or observability is a legitimate Decorator.

---

## Optimize 4 — Excessive Tell-Don't-Ask method explosion (Java)

**Original:**

```java
class Account {
    public void withdraw(BigDecimal amount, AuditLog audit) { ... }
    public void deposit(BigDecimal amount, AuditLog audit) { ... }
    public void transfer(Account to, BigDecimal amount, AuditLog audit) { ... }
    public void transferAll(Account to, AuditLog audit) { ... }
    public void freeze(String reason, AuditLog audit) { ... }
    public void unfreeze(String reason, AuditLog audit) { ... }
    public void close(AuditLog audit) { ... }
    public void reopen(AuditLog audit) { ... }
    // ...
}
```

**Issue:** every operation takes `AuditLog`. The `Account` class is bloated with audit-passing.

**Fix:** Inject the audit log via constructor.

```java
class Account {
    private final AuditLog audit;
    
    public Account(AuditLog audit) { this.audit = audit; }
    
    public void withdraw(BigDecimal amount) { ... audit.log(...); }
}
```

Tell-Don't-Ask doesn't mean every relevant collaborator is a parameter. Use DI / constructor injection for stable collaborators.

---

## Optimize 5 — Distributed chain with synchronous fan-out (Multi-service)

**Original:**

```
ClientApp → API → ServiceA → ServiceB → ServiceC → ServiceD → response
```

4 hops, 4ms minimum latency.

**Fix 1:** parallelize where possible.

```
ClientApp → API → ServiceA fans out:
                     ↓
                  ServiceB ─┐
                  ServiceC ─┼ → API aggregates
                  ServiceD ─┘
```

Latency now max of B, C, D — not sum.

**Fix 2:** cache at API.

If 80% of requests want the same data, cache the aggregated response at API. Cache hits skip the chain entirely.

**Fix 3:** GraphQL federation.

Modern API gateways (Apollo Federation, Hasura) parallelize subqueries across services automatically.

---

## Optimize 6 — Aggressive Hide Delegate creates Middle Man (Java)

**Original (after Hide Delegate everywhere):**

```java
class Customer {
    private Order currentOrder;
    
    public BigDecimal getOrderTotal() { return currentOrder.getTotal(); }
    public BigDecimal getOrderSubtotal() { return currentOrder.getSubtotal(); }
    public BigDecimal getOrderTax() { return currentOrder.getTax(); }
    public BigDecimal getOrderShipping() { return currentOrder.getShipping(); }
    public LocalDate getOrderPlacedAt() { return currentOrder.getPlacedAt(); }
    public OrderStatus getOrderStatus() { return currentOrder.getStatus(); }
    public List<LineItem> getOrderItems() { return currentOrder.getItems(); }
    // ... 20 more delegates
}
```

**Issue:** Customer became a Middle Man for Order. Pure forwarding.

**Fix:** strike a balance. Delegate the *operations callers actually use as a single conceptual call*:

```java
class Customer {
    private Order currentOrder;
    
    public Order getCurrentOrder() { return currentOrder; }  // expose
    
    // Only methods that aggregate or have customer-specific logic:
    public boolean hasActiveOrder() {
        return currentOrder != null && currentOrder.isActive();
    }
}
```

Callers that want order details ask `customer.getCurrentOrder().getTotal()` — short chain, accepted.

---

## Optimize 7 — Java records and Demeter (Java)

**Original:**

```java
record Address(String street, String city, String state) {}
record Customer(String name, Address address) {}

// Usage:
String city = customer.address().city();  // chain
```

A strict Demeter linter flags `customer.address().city()` as a violation.

**Fix:** records are *intentionally* data carriers. Their components are the API. Chain `customer.address().city()` is fine — they're not navigating someone else's structure; they're using the records' designed API.

If you want to encapsulate further, add a method:

```java
record Customer(String name, Address address) {
    public String city() { return address.city(); }
}
```

But over-applying this leads to Middle Man. Records + modest delegation is the right balance.

---

## Optimize 8 — Inappropriate Intimacy via shared cache (Multi-thread Java)

**Original:**

```java
class Service {
    static final Map<String, Long> CACHE = new ConcurrentHashMap<>();
    
    public Long get(String key) {
        return CACHE.computeIfAbsent(key, k -> compute(k));
    }
}

// 100 threads call get(key) concurrently for the same key
```

**Issue:** all 100 threads contend on the same cache line for the cache reference. Worse: `compute(k)` may run twice if two threads see no entry simultaneously.

**Fix 1:** use Caffeine (mature cache library) — handles concurrency correctly.

**Fix 2:** if rolling your own, use proper synchronization:

```java
public Long get(String key) {
    Long v = cache.get(key);
    if (v == null) {
        synchronized (cache) {
            v = cache.get(key);
            if (v == null) {
                v = compute(key);
                cache.put(key, v);
            }
        }
    }
    return v;
}
```

Or `AtomicReference<Map>` with copy-on-write for read-heavy workloads.

---

## Optimize 9 — Removing Middle Man blocks future evolution (Java)

**Original:**

```java
class StripeAdapter {
    private final Stripe stripe;
    
    public ChargeResult charge(Money amount, Card card) {
        // Straight forward to stripe.charge — minimal logic now
        return stripe.charge(amount.cents(), card.token());
    }
}
```

Refactorer suggests removing the adapter (Middle Man).

**Issue:** the adapter is *currently* thin but exists for *future* evolution. If we add Adyen, PayPal, the adapter pattern shines (interface + multiple implementations). Removing now removes the seam.

**Fix:** **decide based on actual roadmap.** If a second provider is committed within 6 months, keep. If not, delete and re-introduce when needed (YAGNI).

This is a YAGNI-vs-future-proofing trade-off. Most teams over-future-proof; remove when in doubt.

---

## Optimize 10 — Distributed transactions reducing chain (Multi-service)

**Original:**

```
PlaceOrder → Inventory.reserve → Payment.charge → Shipment.create → Notification.send
```

5 sync hops, all-or-nothing transaction. If one fails, prior ones must roll back.

**Fix: Saga pattern with compensating actions.**

```
PlaceOrder publishes OrderPlaced event.
  Inventory subscribes → reserves → publishes InventoryReserved (or InventoryFailed)
  Payment subscribes to InventoryReserved → charges → publishes PaymentCompleted
  Shipment subscribes to PaymentCompleted → creates → publishes ShipmentCreated
  Notification subscribes to ShipmentCreated → sends
  
Failures: each service publishes Failure events; compensating handlers run
  (e.g., InventoryFailed → Payment is never invoked)
  (PaymentFailed → Inventory.releaseReservation handler runs)
```

Latency: PlaceOrder responds immediately (after publishing). Background processing handles the rest. Eventual consistency.

**Trade-off:** strict ACID is gone. Some operations are visible mid-saga (inventory reserved but payment pending). UX must accommodate.

---

## Optimize 11 — Profile-driven decoupling (Multi-service)

**Original:** distributed tracing shows ServiceA → ServiceB called 10M times/day at p50=20ms, p99=200ms.

**Fix options ranked by cost:**

1. **Cache at A**: if results are cacheable, single-line config win.
2. **Co-locate**: if A and B always call together, same datacenter / same pod reduces RTT from 5ms to 1ms.
3. **Merge services**: if B serves only A, the boundary is artificial; merge.
4. **Move data**: if B's data fits in A's database, replicate (with cache invalidation).
5. **Async**: if A doesn't need the result immediately, fire-and-forget.

Apply in order of cost. Caching first is a 1-day fix; merging services is a 6-month rewrite.

---

## Optimize 12 — Removing Demeter violations harms locality (Java)

**Original:**

```java
class Geometry {
    public static double area(Polygon p) {
        double total = 0;
        for (int i = 0; i < p.points.length - 1; i++) {
            total += (p.points[i].x * p.points[i+1].y) - (p.points[i+1].x * p.points[i].y);
        }
        return Math.abs(total) / 2;
    }
}
```

A "fix Demeter" refactor moves area onto Polygon, hides points, exposes `Polygon.iterateEdges(...)`:

```java
class Polygon {
    private final Point[] points;
    
    public double area() {
        double total = 0;
        forEachEdge((p1, p2) -> total += p1.cross(p2));
        return Math.abs(total) / 2;
    }
    
    public void forEachEdge(BiConsumer<Point, Point> action) {
        for (int i = 0; i < points.length - 1; i++) action.accept(points[i], points[i+1]);
    }
}
```

**Issue:** for a hot loop computing area on millions of polygons, the lambda + interface method add overhead. The original direct array access was faster.

**Fix:** **Demeter is a guideline, not law**. For inner loops, direct field access (within the same class) is fine. The cure should serve readability and decoupling; if it costs measured performance and the access is *internal*, accept the violation.

Modern compilers (and Java records with compact deconstruction) often make this less of a trade-off than it used to be.

---

> **Next:** [interview.md](interview.md) — Q&A.
