# Law of Demeter — Optimize

> The Law of Demeter is a *design heuristic*. It interacts with performance in three places: the bytecode shape of a chain vs a forwarded call, the cost of intermediate object creation when you return values instead of collaborators, and the database/cache cost of walking lazy object graphs in persistence layers. This file walks ten performance angles where LoD's structure helps or hurts, and where to bend it for hot paths. All numbers illustrative; verify with JMH.

---

## 1. Dispatch cost: chain vs forwarded call

A train-wreck chain and the LoD-compliant equivalent produce nearly identical bytecode counts:

```java
// Chain — 4 method calls
Money tax = order.getCustomer().getAddress().getCountry().taxFor(order);

// Forwarded — 4 method calls (same depth, just hidden)
Money tax = order.taxAmount();
// where Order.taxAmount calls customer.address().country().taxFor(this)
```

The dispatch cost is the same: four `invokevirtual` / `invokeinterface` calls. The JIT inlines monomorphic calls in both shapes. The "LoD makes things slow" myth comes from people who imagine forwarders cost cycles — they don't, beyond what the chain would have cost anyway.

The performance win of LoD is indirect: *forwarders are easier to specialize*. The compiler can inline `order.taxAmount()` and decide whether to inline its body. The original chain spans method calls across four classes — each is a separate call site with its own type profile.

---

## 2. Object identity and returned values

Returning a *value* (a primitive, a record, a frozen tuple) is cheaper than returning a *collaborator* (a live entity):

- A returned record is value-equal to any other record with the same components; the JIT can fold equality checks.
- A returned entity carries identity — `equals` falls back to reference identity by default, and any caller that compares is doing a pointer compare.

When LoD pushes you toward "return a value record" instead of "return a live collaborator", the JIT can sometimes scalar-replace the record entirely:

```java
public record AddressView(String city, String country) { }

public AddressView addressView() {                       // returns a value
    return new AddressView(customer.address().city(), customer.address().country());
}
```

If `addressView()` is called in a context where the record never escapes, the JIT's escape analysis (EA) eliminates the allocation. The two strings live in registers, no heap pressure.

```java
String city = order.addressView().city();              // EA-friendly: record never escapes
```

LoD-compliant returns are EA-friendly when they're shaped as records.

---

## 3. The N+1 trap — lazy chains hit the database

The most expensive LoD violation in practice is *walking a lazy persistence graph*:

```java
for (Order o : repo.findAll()) {
    log.info("{}: {}", o.customer().name(), o.lineItems().size());
}
```

Each `customer()` call is a `SELECT customer WHERE id = ?`. Each `lineItems()` call is a `SELECT line_item WHERE order_id = ?`. With 10,000 orders, the loop issues 30,001 SQL queries.

LoD compliance — pushing the projection to the repository — eliminates the N+1:

```java
public interface OrderReportRepository {
    @Query("select new com.acme.ReportRow(c.name, count(li)) " +
           "from Order o join o.customer c join o.lineItems li group by o.id, c.name")
    List<ReportRow> report();
}
```

One SQL query, one network round-trip, zero N+1. LoD's "ask for the answer, don't navigate" is a database-performance pattern as much as a design pattern.

---

## 4. Cache locality — flat data wins

LoD pushes you to return *values* and *records* instead of live collaborators. Records hold their components inline (or, with Project Valhalla, *truly* inline). Sequential access to a `List<OrderSummary>` (a record) is cache-friendly; sequential access to a `List<Order>` (entities holding references to customer, address, etc.) is a cache miss per dereference.

```java
public record OrderSummary(String id, String customerName, BigDecimal total) { }

// Reporting loop — sequential reads, hot cache
for (OrderSummary s : repo.summaries()) {
    write(s.customerName(), s.total());
}
```

vs

```java
// Reporting loop — pointer chase per iteration
for (Order o : repo.findAll()) {
    write(o.customer().name(), o.total());
}
```

The summary loop reads contiguous memory; the entity loop dereferences three pointers per iteration. For 100k rows, the difference is measurable.

---

## 5. Monomorphism through aggregate facades

When LoD funnels every operation through an aggregate root, every external call site lands on the same method. The JIT sees monomorphic dispatch and inlines aggressively.

```java
public final class Order {
    public Money taxAmount() { /* ... */ }
}

// 50 call sites — all calling order.taxAmount(); JIT learns this is monomorphic
```

The original train-wreck chain spreads the dispatch over four different call sites, each with its own type profile. Megamorphic profiles at one of those sites (e.g., `Customer.getAddress()` returning different `Address` subclasses) pessimize the whole chain.

LoD-compliant code has *fewer, hotter* call sites — which is exactly what the JIT optimizes best.

---

## 6. When LoD adds layers — the cost of indirection

LoD pushes operations into the owning object, which sometimes means *N levels* of forwarders before reaching the work:

```java
order.applyDiscount(d) -> customer.applyDiscount(d) -> tier.applyDiscount(d) -> ...
```

Each forwarder is one method call. For a tight loop over millions of items, this stacks:

```java
for (Order o : orders) o.applyDiscount(d);     // each call: 4-level forward
```

The JIT inlines monomorphic forwarders for free. The cost only appears when the chain is megamorphic — e.g., `Customer` has many subtypes and each forwards differently. Then the JIT bails out.

Mitigations:

- **Mark forwarders `final`.** A `final` method on a `final` class is fully inlinable.
- **Hold the chain monomorphic.** Don't reconfigure aggregates with different inner types per call.
- **For hot paths, accept a controlled LoD violation.** Read the value once, work in a loop, write back. Document why.

---

## 7. The wrapper/view allocation cost

LoD often says "return a view record". Records are cheap — but cheap is not free. A method that's called millions of times and allocates a fresh record each call adds pressure to the young generation, triggers GC, and dirties caches.

```java
public OrderView view() {
    return new OrderView(id, total, customer.name(), customer.city());
}
```

For 10M calls/second, that's 10M `OrderView` allocations/second. Even with G1's small-object allocator, that's measurable.

EA usually catches these — if the view never escapes the calling method, no allocation occurs. But escape analysis fails when:

- The view is returned from a non-`final` method (subclass might intercept).
- The view is stored in a field or collection.
- The view crosses a method boundary the JIT can't inline through.

Mitigations:

- **Records are `final` already** — EA-friendly.
- **Make returning methods `final`** to help CHA + EA.
- **Profile.** EA either works or it doesn't; in profile-confirmed hot paths, replace view-returning with a primitive-returning method.

---

## 8. Stream pipelines vs explicit loops

LoD-compliant code often uses stream pipelines. Streams have a known per-pipeline overhead (Spliterator setup, lambda capture, terminal-op state) that is invisible in 99% of code and noticeable in tight loops over small collections.

```java
return order.lineItems().stream()
            .map(LineItem::weight)
            .reduce(Weight.ZERO, Weight::plus);
```

vs

```java
Weight total = Weight.ZERO;
for (LineItem li : order.lineItems()) total = total.plus(li.weight());
return total;
```

For 10k iterations of a 5-element list, the stream version costs ~3× the explicit loop. For a 1M-element list called once, the difference is dwarfed by the work.

The pragmatic rule: streams for readability; explicit loops for inner loops on small collections that are hot. Both respect LoD.

---

## 9. Database projection vs in-app aggregation

LoD says: ask for the answer, not the components. Applied to persistence, this is the *projection rule*: let the database do the aggregation.

```java
// LoD-violating walk
public Money totalRevenueLastQuarter() {
    return repo.allOrders().stream()
       .filter(o -> o.placedAt().isAfter(quarterStart))
       .map(Order::total)
       .reduce(Money.ZERO, Money::plus);
}

// LoD-compliant projection
public Money totalRevenueLastQuarter() {
    return repo.sumTotalsSince(quarterStart);
}
```

The first version loads every order. The second issues one `SELECT SUM(total) FROM orders WHERE placed_at > ?`. The database is optimized for this; the application is not.

Benchmark on a 1M-row table: walk takes 4–8 seconds; projection takes 30 ms. The LoD-compliant version is 100–200× faster, plus it stays correct as the table grows.

---

## 10. Quick rules — LoD and performance

- [ ] LoD doesn't slow code down by itself. Forwarded calls and chain calls compile to the same bytecode shape.
- [ ] N+1 queries hide inside lazy graph walks. Push the projection to the persistence layer.
- [ ] Returning value records is EA-friendly when methods are `final`.
- [ ] Aggregate facades produce monomorphic call sites — JIT-favourable.
- [ ] Streams have a fixed overhead; for hot inner loops on small collections, switch to explicit loops.
- [ ] Mark domain methods and forwarders `final` to help CHA and EA.
- [ ] Profile before bending LoD for performance. The cost rarely lives where intuition says.
- [ ] For projection-heavy code, denormalize at the boundary (CQRS read models) — LoD applies on the write side, the read side ships flat tables.
- [ ] When LoD requires N-level forwarders in a hot path, accept a controlled violation. Document it.
- [ ] Cache locality wins with flat data: prefer `List<RecordView>` over `List<Entity>` for sequential reads.

The general law: design LoD-compliant code first, measure, then break the rule at the exact site the profiler names. Most production code never reaches the threshold where LoD's cost matters. For the 1% that does, the techniques in sections 3 (projection), 6 (forwarder folding), and 9 (database aggregation) recover most of the loss without abandoning the heuristic wholesale.
