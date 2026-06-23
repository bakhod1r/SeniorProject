# Couplers — Senior Level

> Architectural Couplers, hexagonal architecture, DDD, tooling.

---

## Table of Contents

1. [Couplers at architectural scale](#couplers-at-architectural-scale)
2. [Hexagonal architecture and ports/adapters](#hexagonal-architecture-and-portsadapters)
3. [DDD aggregates and Demeter](#ddd-aggregates-and-demeter)
4. [Detection tools](#detection-tools)
5. [Migration patterns](#migration-patterns)
6. [Code-review heuristics](#code-review-heuristics)
7. [Review questions](#review-questions)

---

## Couplers at architectural scale

| Code-level | Architectural |
|---|---|
| Feature Envy | Service A doing work that belongs in Service B's domain |
| Inappropriate Intimacy | Two services accessing each other's database tables directly |
| Message Chains | Service A → Service B → Service C → Service D for one logical operation |
| Middle Man | An "API gateway" that only forwards calls without auth, transformation, or routing logic |

### Service-level Feature Envy

When Service A's logic spends most of its time querying Service B and acting on the data, the logic belongs in Service B. The cure: move the endpoint to Service B (or consume B's domain events instead of querying B repeatedly).

### Service-level Message Chains (distributed traces show them)

A frontend request hits Service A; A calls B; B calls C; C calls D. Distributed tracing tools (Jaeger, Zipkin, Datadog APM) reveal these chains.

**Symptoms:**
- High end-to-end latency (each call adds ~5-50ms).
- Cascading failures — D is down → C times out → B times out → A times out.
- Complicated retries / idempotency requirements.

**Cures:**
- **Eventual consistency** via events: A publishes; downstream services react asynchronously. The chain becomes a fan-out tree of independent reactions.
- **Reverse proxy / API gateway** that aggregates: client makes one call; gateway parallelizes the underlying chain (when calls are independent).
- **Database denormalization**: cache the aggregated answer in A, refreshed on B/C/D events.

### Database-level Inappropriate Intimacy

The classic anti-pattern: Service A reads/writes Service B's tables directly, often "for performance." Now A and B can't deploy independently — schema changes must be coordinated.

**Cure:** strict service boundaries. A queries B via an API; B owns its schema. Internal performance shortcuts (like read replicas of B's database accessible to A) require explicit contracts.

---

## Hexagonal architecture and ports/adapters

**Hexagonal architecture** (Ports and Adapters, Alistair Cockburn) addresses Couplers at architectural scale:

- **Domain core** depends on nothing.
- **Ports** are interfaces the domain defines (e.g., `OrderRepository`).
- **Adapters** implement ports for specific tech (`JpaOrderRepository`, `RedisOrderRepository`).

**Result:** the domain is isolated from infrastructure. Tightly coupled "service + database + DTO" stacks become loosely coupled.

### Trade-off

Hexagonal architecture is heavyweight. Small projects don't need it. For large projects with multiple persistence/messaging technologies, it pays off. Apply selectively.

---

## DDD aggregates and Demeter

In **Domain-Driven Design**, an **aggregate** is a cluster of domain objects treated as a single unit. The aggregate has a **root** (the entry point); external code talks only to the root.

```java
class Order {
    // root
    private List<LineItem> items;  // internal — not exposed
    
    public void addItem(Product p, int quantity) {
        items.add(new LineItem(p, quantity));
    }
    
    public BigDecimal total() {
        return items.stream().map(LineItem::total).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

External callers can't reach `LineItem` directly. The root mediates. This is a Demeter-conformant design — callers talk only to their immediate friend (Order).

### When this fails

- A use case requires modifying a deep child (e.g., updating one line item's quantity). The root must expose enough operations: `order.updateItemQuantity(itemId, qty)`.
- Otherwise, callers reach in via Order and get child references — Message Chain or Inappropriate Intimacy.

---

## Detection tools

| Tool | Catches |
|---|---|
| **SonarQube** | Long Message Chains, Excessive Coupling Between Objects |
| **JDepend / NDepend** | Coupling metrics (afferent / efferent coupling per package) |
| **Structure101** | Cyclic dependencies (extreme Inappropriate Intimacy) |
| **ArchUnit** | Custom architectural rules (no chains > 3, package isolation) |
| **PMD `LawOfDemeter`** | Java-specific Demeter violations |

### Coupling metrics

- **Afferent coupling (Ca):** how many other modules depend on this one ("incoming arrows").
- **Efferent coupling (Ce):** how many other modules this one depends on ("outgoing arrows").
- **Instability (I = Ce / (Ca + Ce)):** ratio. 0 = stable (depended on by many, depends on few); 1 = unstable (depends on many, depended on by few).

A package with Ca=20, Ce=15 has many things depending on it AND depends on many. It's a coupling hotspot — refactoring is high-impact and high-risk.

---

## Migration patterns

### Refactoring service-level Message Chains via events

Before:

```
ClientApp → A.placeOrder(order)
   A → B.checkInventory()
   A → C.calculateTax()
   A → D.charge(card)
   A → E.createShipment()
```

After (event-driven):

```
ClientApp → A.placeOrder(order)
   A publishes OrderPlaced event
   (consumers react asynchronously)
   B reduces inventory on OrderPlaced
   C records tax on OrderPlaced
   D charges on OrderPlaced
   E creates shipment on OrderPaid (downstream of D)
```

Each consumer is independent. A's response time is dominated by writing the event, not waiting for downstream. Cascading failures are limited to the failing consumer.

**Cost:** eventual consistency complexity (clients may see "order placed" before charge confirms). Often acceptable; sometimes requires UX changes.

### Strangler fig for Inappropriate Intimacy at DB level

Two services share a database table. Steps:

1. Create a clear API contract for one service (the "owner").
2. Other service migrates to consume the API instead of direct table access.
3. Eventually, the table is fully owned; non-owners no longer touch it.

Slow but safe — each step is incremental.

---

## Code-review heuristics

Reviewers should flag:

- **A method that takes one parameter and uses 5 of its fields** → Move Method.
- **A new chain of `getX().getY().getZ()`** → Hide Delegate.
- **A new wrapper class with only forwarding methods** → ask whether it adds anything.
- **A test that requires constructing 6 collaborators to test a small operation** → Inappropriate Intimacy.
- **A bug fix in service A that requires updating service B's DB schema** → A and B are intimately coupled at infrastructure level.

---

## Review questions

1. **A microservice's API has a method `getOrderCustomerAddressCity(orderId)`. Smell?**
   Yes — Hide Delegate gone wrong. The API exposes a Message-Chain-like aggregator. Cure: caller asks for the city directly via a higher-level method (e.g., "where will this order ship?").

2. **Two microservices share a database. How to refactor?**
   Strangler fig: one service becomes the owner; the other migrates to consuming it via API. Time scale: months.

3. **Eventual consistency vs synchronous chains — when is sync better?**
   When the operation is *transactional* and consistency requirements are strict (e.g., financial). Even then, modern systems often use saga patterns to fake transactionality with compensating actions on failure.

4. **A test class has 50 mocks for a single class under test. Smell?**
   Either Large Class (too many collaborators) or Inappropriate Intimacy (the class touches everything). Refactor the design; many tests follow.

5. **Hexagonal architecture for a 3-month side project — overkill?**
   Yes. Hexagonal is for systems where the domain matters and adapters are likely to change. A side project rarely needs it.

6. **Demeter strictly forbids `customer.getOrder().total()`. Always wrong?**
   Strict: yes. Pragmatic: depends — if `Order` is part of `Customer`'s aggregate, `customer.getOrder()` is fine. Use case: `customer.totalSpent()` is better than navigating to `order` in callers.

7. **Distributed monolith vs microservices — same Couplers manifesting?**
   Yes. Microservices that always deploy together have *Distributed Inappropriate Intimacy*. The cure is the same as for code-level Inappropriate Intimacy: refactor boundaries.

8. **JDepend's "instability" metric — what to do with it?**
   I close to 0 (very stable) is fine for foundational packages. I close to 1 (unstable) is fine for top-level apps. The bad zone is the *middle* — packages with both significant Ca and Ce. Those are tangled; they need the most refactoring.

9. **"Tell, Don't Ask" — does it always reduce coupling?**
   It moves coupling. Tell-style methods often have richer signatures (more parameters, callback functions). The total coupling is the same; the *direction* changes. Tell-style is preferred because it pushes responsibility to where the data is — easier to test, more polymorphic.

10. **A refactor reduces coupling but adds 30% more code. Worth it?**
    Often yes — code is cheap; tangled state is expensive. But not always. Apply judgment: are the classes likely to evolve independently? Is the team committing to maintain two pieces? If yes, decouple. If the classes will always co-evolve, accepting some coupling is fine.

---

> **Next:** [professional.md](professional.md) — runtime cost of dispatch through chains, JIT inlining of forwards.
