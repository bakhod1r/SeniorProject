# DDD Tactical: Domain Services — Tasks

> **What?** Eight exercises that walk you from spotting the need for a Domain Service to building one and separating the Application Service that drives it. Each exercise has a brief, the deliverable signatures, and a validation table you can use to check your work. The last exercise is a worked solution you can use to calibrate the others.
> **How?** Implement each exercise in a small sandbox project. Compile, write a unit test that exercises only the Domain Service with stub ports, then write a second test that drives it through an Application Service. If a test cannot be written without a Spring container, you have violated the contract and must refactor.

---

## Exercise 1 — Design `TransferService`

**Brief.** Two `Account` aggregates, possibly in the same currency. Implement `TransferService.transfer(Account from, Account to, Money amount)`. Throw `InsufficientFundsException` if `from` cannot cover the amount. Throw `CurrencyMismatchException` if the two accounts have different currencies (a separate `InternationalTransferService` will handle the FX case in Exercise 2).

**Required signatures.**

```java
public final class TransferService {
    public void transfer(Account from, Account to, Money amount);
}
```

**Validation.**

| Check                                                            | Pass criterion                              |
| ---------------------------------------------------------------- | ------------------------------------------- |
| Class has no instance fields                                     | All declared fields are `final` and ports   |
| `transfer` throws on insufficient funds                          | `InsufficientFundsException` raised         |
| `transfer` throws on currency mismatch                           | `CurrencyMismatchException` raised          |
| After success, `from.balance` reduced, `to.balance` increased    | Invariants hold                             |
| Unit test runs without Spring                                    | Pure JUnit + manual `new`                   |

---

## Exercise 2 — Design `InternationalTransferService` with FX

**Brief.** Now the two accounts may have different currencies. Inject an `ExchangeRatePolicy` domain port. The amount debited from `from` is in `from`'s currency; the amount credited to `to` is the converted amount in `to`'s currency. Round the converted amount to the smallest unit of the target currency using banker's rounding (`HALF_EVEN`).

**Required signatures.**

```java
public interface ExchangeRatePolicy {
    Money convert(Money amount, Currency target);
}

public final class InternationalTransferService {
    public InternationalTransferService(ExchangeRatePolicy rates);
    public void transfer(Account from, Account to, Money amount);
}
```

**Validation.**

| Check                                                            | Pass criterion                              |
| ---------------------------------------------------------------- | ------------------------------------------- |
| Constructor injects `ExchangeRatePolicy`                         | `private final ExchangeRatePolicy`          |
| Stub `ExchangeRatePolicy` returns fixed rates in tests           | Test uses `(amount, target) -> ...` lambda  |
| Rounding is HALF_EVEN                                            | Test asserts banker's rounding on `0.005`   |
| Service has no other state                                       | All fields `final` and constructor-injected |

---

## Exercise 3 — Design `FXRatesService` (the policy, not the adapter)

**Brief.** Implement an `FXRatesService` Domain Service that, given a set of currency pairs, returns a coherent table of rates such that converting via any intermediate currency yields the same result up to rounding. The service depends on a `RatesProvider` port; the implementation of `RatesProvider` is *infrastructure* (out of scope for this exercise).

**Required signatures.**

```java
public interface RatesProvider {
    BigDecimal directRate(Currency from, Currency to);
}

public final class FXRatesService {
    public FXRatesService(RatesProvider provider);
    public RateTable tableFor(Set<Currency> currencies, Currency base);
}
```

**Validation.**

| Check                                                            | Pass criterion                              |
| ---------------------------------------------------------------- | ------------------------------------------- |
| `RateTable` is an immutable VO                                   | All fields `final`; no setters              |
| Triangulation: `EUR→USD→GBP ≈ EUR→GBP`                          | Test with stub provider                     |
| Service is stateless                                             | No mutable fields                           |
| `tableFor(emptySet, base)` returns empty table, doesn't throw    | Edge-case test                              |

---

## Exercise 4 — `PricingPolicy` as a polymorphic Domain Service

**Brief.** Introduce a `PricingPolicy` interface with two implementations: `RetailPricingPolicy` and `WholesalePricingPolicy`. Each computes a `Money` total for a `Basket` and a `Customer`. The application service chooses the policy based on `customer.segment()`.

**Required signatures.**

```java
public interface PricingPolicy {
    Money price(Basket basket, Customer customer);
}

public final class RetailPricingPolicy    implements PricingPolicy { ... }
public final class WholesalePricingPolicy implements PricingPolicy { ... }
```

**Validation.**

| Check                                                            | Pass criterion                              |
| ---------------------------------------------------------------- | ------------------------------------------- |
| Both implementations are stateless                               | All fields `final`                          |
| Choice happens *outside* the policy                              | App service picks the policy implementation |
| Wholesale prices ≤ retail prices for the same basket             | Property-based test                         |
| New segment can be added by writing a third implementation       | No edits to existing two classes (OCP)      |

---

## Exercise 5 — Separate the Application Service for "Place Order"

**Brief.** You have `Order` (aggregate), `Customer` (aggregate), `PricingPolicy` (Domain Service from Exercise 4), `InventoryReservationService` (Domain Service that asks an `InventoryGateway` to reserve stock), and `OrderRepository`. Write `PlaceOrderUseCase` — the Application Service — that orchestrates the use case end-to-end with a single `@Transactional` boundary.

**Required behaviour, in order:**

1. Load the customer.
2. Build the order from the command.
3. Price the order using the appropriate `PricingPolicy`.
4. Reserve inventory via the Domain Service.
5. Persist the order.
6. Publish an `OrderPlaced` event.

**Required signatures.**

```java
public record PlaceOrderCommand(CustomerId customerId, List<LineRequest> lines) {}

public final class PlaceOrderUseCase {
    public PlaceOrderUseCase(CustomerRepository customers,
                             OrderRepository orders,
                             PricingPolicy pricingPolicy,
                             InventoryReservationService reservations,
                             ApplicationEventPublisher events);
    @Transactional
    public OrderId execute(PlaceOrderCommand cmd);
}
```

**Validation.**

| Check                                                            | Pass criterion                              |
| ---------------------------------------------------------------- | ------------------------------------------- |
| `@Transactional` only on `execute`                              | Not on Domain Services                      |
| Domain Services receive already-loaded aggregates                | No repository in Domain Service             |
| Event published only after `orders.save`                         | Order of statements verified by test        |
| Use case is unit-testable with stubs                             | No `@SpringBootTest` required               |

---

## Exercise 6 — Idempotent `FundsCaptureService`

**Brief.** A payment service called by external webhooks. The same `PaymentIntent` can arrive twice (broker redelivery). Implement `FundsCaptureService.capture(PaymentIntent intent)` such that calling it twice with the same `intent.idempotencyKey()` charges the PSP only once and returns the same `CaptureResult`.

**Required signatures.**

```java
public final class FundsCaptureService {
    public FundsCaptureService(PaymentRepository payments, PspGateway psp);
    public CaptureResult capture(PaymentIntent intent);
}
```

**Validation.**

| Check                                                            | Pass criterion                              |
| ---------------------------------------------------------------- | ------------------------------------------- |
| Calling `capture(intent)` twice charges PSP once                  | Test verifies stub PSP receives one call    |
| Second call returns same result object's data                    | Equality on `CaptureResult`                 |
| Service has no mutable state                                     | All fields `final`                          |

---

## Exercise 7 — Refactor a `TransferManager` god class

**Brief.** You are given the broken `TransferManager` from `middle.md` Section 6 (JDBC + SMTP + business rules in one class). Refactor it into:

- A Domain Service `TransferService`.
- An Application Service `TransferUseCase` with `@Transactional`.
- An Infrastructure adapter `SmtpNotificationAdapter` implementing a domain `NotificationPort`.
- A `JpaAccountRepository` implementing `AccountRepository`.

**Validation.**

| Check                                                            | Pass criterion                              |
| ---------------------------------------------------------------- | ------------------------------------------- |
| `TransferService` has zero framework imports                     | `grep "import org.springframework"` empty   |
| `TransferUseCase` has `@Transactional` and orchestrates the flow | Sequence: load → transfer → save → notify   |
| Each layer is independently unit-testable                        | Vanilla JUnit for domain & application      |

---

## Exercise 8 — Worked solution: `RoutingService`

A complete worked example for calibration.

**Brief.** Given a graph of `Node`s and `Edge`s, find the cheapest route from `from` to `to` using a `CostPolicy` that combines distance and toll.

```java
// Value objects
public record Node(NodeId id, String name) {}
public record Edge(Node from, Node to, Distance distance, Toll toll) {}
public record Route(List<Edge> edges, Money totalCost) {}

// Domain Service (the policy variant)
public interface CostPolicy {
    Money cost(Edge edge);
}
public final class DistancePlusTollPolicy implements CostPolicy {
    private final Money perKilometer;
    public DistancePlusTollPolicy(Money perKilometer) { this.perKilometer = perKilometer; }
    @Override
    public Money cost(Edge edge) {
        return perKilometer.times(edge.distance().kilometers()).plus(edge.toll().amount());
    }
}

// Domain Service (the capability)
public final class RoutingService {

    private final CostPolicy costs;

    public RoutingService(CostPolicy costs) {
        this.costs = Objects.requireNonNull(costs);
    }

    public Route shortestRoute(Graph g, Node from, Node to) {
        // Dijkstra over the graph using costs.cost(edge).
        Map<Node, Money>  best = new HashMap<>();
        Map<Node, Edge>   prev = new HashMap<>();
        PriorityQueue<Map.Entry<Node, Money>> queue = new PriorityQueue<>(
            Comparator.comparing(Map.Entry::getValue));
        best.put(from, Money.zero(to.id().currency()));
        queue.add(Map.entry(from, best.get(from)));

        while (!queue.isEmpty()) {
            Map.Entry<Node, Money> top = queue.poll();
            Node u = top.getKey();
            if (u.equals(to)) break;
            for (Edge e : g.outgoing(u)) {
                Money alt = best.get(u).plus(costs.cost(e));
                if (!best.containsKey(e.to()) || alt.lessThan(best.get(e.to()))) {
                    best.put(e.to(), alt);
                    prev.put(e.to(), e);
                    queue.add(Map.entry(e.to(), alt));
                }
            }
        }
        if (!best.containsKey(to)) throw new NoRouteException(from, to);

        // Reconstruct path
        List<Edge> path = new ArrayList<>();
        for (Node cur = to; !cur.equals(from); cur = prev.get(cur).from()) {
            path.add(prev.get(cur));
        }
        Collections.reverse(path);
        return new Route(path, best.get(to));
    }
}

// Application Service that drives it
public final class FindRouteUseCase {
    private final GraphRepository graphs;
    private final RoutingService router;

    public FindRouteUseCase(GraphRepository graphs, RoutingService router) {
        this.graphs = graphs;
        this.router = router;
    }

    public Route execute(GraphId graphId, NodeId fromId, NodeId toId) {
        Graph g = graphs.findById(graphId).orElseThrow();
        Node from = g.node(fromId);
        Node to   = g.node(toId);
        return router.shortestRoute(g, from, to);
    }
}
```

**Why this is a valid Domain Service:**

- All fields `final`; class is `final`; no mutable state.
- Name expresses the verb-shaped capability.
- Signatures contain only domain types (`Graph`, `Node`, `Route`).
- No persistence (the graph is passed in, not loaded).
- No transport (no HTTP, no annotations beyond constructor injection).

Unit test:

```java
@Test
void findsCheapestRoute() {
    CostPolicy fixed = e -> Money.of(e.distance().kilometers(), USD);
    RoutingService svc = new RoutingService(fixed);
    Graph g = ...;   // hand-built test graph
    Route r = svc.shortestRoute(g, nodeA, nodeC);
    assertEquals(Money.of(15, USD), r.totalCost());
}
```

No Spring, no DB, runs in single-digit milliseconds.

---

**Submission checklist (any exercise).**

- [ ] Domain Services have only `final` fields.
- [ ] Signatures contain only domain types.
- [ ] No `@Transactional`, no JDBC, no HTTP in Domain Services.
- [ ] Application Services orchestrate; Domain Services compute.
- [ ] Tests run without Spring containers.
- [ ] Names express verbs/capabilities, not data.

---

**Related:** [`../02-entities/tasks.md`](../02-entities/tasks.md), [`../03-aggregates/tasks.md`](../03-aggregates/tasks.md), [`../04-repository-concept/tasks.md`](../04-repository-concept/tasks.md).
