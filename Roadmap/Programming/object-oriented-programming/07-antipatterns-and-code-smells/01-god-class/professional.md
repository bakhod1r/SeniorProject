# God Class — Professional Level

## 1. Architectural Prevention

A God Class is rarely a single coding mistake. It is the visible end-state of architectural drift. To prevent it, you must address structure at the level the team designs in, not at the level of one class.

Three architectural lenses are most effective:

1. **Domain-Driven Design aggregates** — bound mutation by aggregate roots.
2. **Hexagonal architecture (Ports & Adapters)** — keep the domain free of infrastructure.
3. **Bounded contexts** — enforce module boundaries that match the language of the business.

When these three are honored, classes rarely grow past 200 lines because every responsibility has an obvious home.

## 2. DDD Aggregates — One Root, One Invariant Boundary

An aggregate is a cluster of objects treated as a single unit for the purpose of consistency. The root owns all writes; outside callers may not bypass it.

```java
public final class Order {                          // aggregate root
    private final OrderId id;
    private final CustomerId customerId;
    private OrderStatus status;
    private final List<OrderLine> lines = new ArrayList<>();

    public void addLine(ProductId pid, int qty, Money price) {
        if (status != OrderStatus.DRAFT)
            throw new IllegalStateException("only draft orders can change");
        lines.add(new OrderLine(pid, qty, price));
    }

    public Money total() {
        return lines.stream().map(OrderLine::subtotal).reduce(Money.ZERO, Money::add);
    }

    public void place() {
        if (lines.isEmpty()) throw new IllegalStateException("empty order");
        status = OrderStatus.PLACED;
    }
}
```

Notice what is *not* in `Order`: PDF rendering, email sending, persistence, tax tables, fraud checks. Each of those lives in its own service or domain object. The aggregate stays under 200 lines because invariants — not features — define its scope.

## 3. Hexagonal Architecture — Push Infrastructure Out

A God Class often forms when domain objects start importing JDBC, HTTP clients, or template engines. Hexagonal architecture forbids this by inverting dependencies through ports.

```java
// domain — pure
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
}

// application — orchestrates use cases
public final class PlaceOrderUseCase {
    private final OrderRepository repo;
    private final PaymentGateway payments;

    public void handle(PlaceOrderCommand cmd) {
        Order o = repo.findById(cmd.orderId()).orElseThrow();
        o.place();
        payments.charge(o.total(), cmd.card());
        repo.save(o);
    }
}

// infrastructure — implements ports
public final class JpaOrderRepository implements OrderRepository { /* ... */ }
```

The domain never grows infrastructure code. The application layer stays thin. The infrastructure layer holds the messy bits, but each adapter is narrow and single-purpose.

## 4. Bounded Contexts — Module Boundaries with Teeth

A bounded context is a slice of the system where a single ubiquitous language applies. Inside `billing`, an `Invoice` is one thing; inside `shipping`, it might mean something else. Code in one context should not import from another except through a published contract.

In a multi-module Maven build:

```
billing/         — Invoice, Charge, Refund
shipping/        — Shipment, Carrier, Tracking
catalog/         — Product, Category, Sku
shared-kernel/   — Money, IDs, Result<T>
```

When the build forbids `shipping` from importing `billing` internals, no class can sprawl across both. The compiler enforces the boundary.

## 5. ArchUnit — Mechanical Guardrails

Discipline does not scale. Tests do. ArchUnit lets you fail the build when a class crosses a threshold.

```java
@AnalyzeClasses(packages = "com.acme")
class ArchitectureTest {

    @ArchTest
    static final ArchRule classes_should_not_exceed_200_lines =
        classes().should(new ArchCondition<JavaClass>("have at most 200 lines") {
            public void check(JavaClass clazz, ConditionEvents events) {
                int loc = clazz.getSourceCodeLocation().toString().lines().count() < 0 ? 0
                        : clazz.getMethods().stream().mapToInt(m -> 10).sum();
                if (loc > 200)
                    events.add(SimpleConditionEvent.violated(clazz,
                        clazz.getName() + " has " + loc + " LOC"));
            }
        });

    @ArchTest
    static final ArchRule classes_should_have_at_most_7_public_methods =
        classes().that().resideInAPackage("..domain..")
            .should(new ArchCondition<JavaClass>("have at most 7 public methods") {
                public void check(JavaClass c, ConditionEvents e) {
                    long n = c.getMethods().stream()
                        .filter(m -> m.getModifiers().contains(JavaModifier.PUBLIC))
                        .count();
                    if (n > 7) e.add(SimpleConditionEvent.violated(c,
                        c.getName() + " exposes " + n + " public methods"));
                }
            });

    @ArchTest
    static final ArchRule domain_should_not_depend_on_infrastructure =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAPackage("..infrastructure..");

    @ArchTest
    static final ArchRule no_class_should_depend_on_more_than_15_others =
        classes().should(new ArchCondition<JavaClass>("CBO <= 15") {
            public void check(JavaClass c, ConditionEvents e) {
                int cbo = c.getDirectDependenciesFromSelf().size();
                if (cbo > 15) e.add(SimpleConditionEvent.violated(c,
                    c.getName() + " CBO=" + cbo));
            }
        });
}
```

These rules are part of the CI pipeline. A pull request that crosses the threshold cannot merge.

## 6. Dependency Budgets

Every package and every class has a *budget*. Common budgets:

| Scope          | Metric             | Budget |
|----------------|--------------------|--------|
| Domain class   | LOC                | 200    |
| Domain class   | Public methods     | 7      |
| Domain class   | CBO (fan-out)      | 15     |
| Domain package | Number of classes  | 30     |
| Aggregate      | Number of entities | 5      |
| Service        | Public methods     | 5      |

When a budget is exceeded the team must either split the class or get an explicit architectural waiver — recorded in an ADR (Architecture Decision Record).

## 7. Code Review Checklist

Before approving a PR, ask:

- [ ] Is any class growing past 200 LOC?
- [ ] Are new methods being added to a class that already has 7+ public methods?
- [ ] Does this class hold more than one reason to change?
- [ ] Are unrelated fields being grouped under one type?
- [ ] Is infrastructure code (SQL, HTTP, JSON) leaking into domain types?
- [ ] Are private helpers piling up — a sign the class is doing too much?
- [ ] Could this work be a new collaborator instead of a new method?
- [ ] Does the class name end in `Manager`, `Helper`, `Util`, `Processor`, or `Handler` without a noun?
- [ ] Is the constructor parameter list growing past 5?
- [ ] Do two methods of the same class operate on disjoint subsets of fields (LCOM violation)?

If three or more boxes are checked, request a refactor before merge.

## 8. Conway's Law and Organizational Signals

> Any organization that designs a system will produce a design whose structure is a copy of the organization's communication structure. — Melvin Conway, 1968.

God Classes often map to organizational dysfunction. Watch for:

- One person owns a class no one else touches — risk of unbounded growth.
- A single ticket queue ("misc backend") collects every cross-cutting change.
- A class is touched in 80% of pull requests across teams.
- The class lives in a "shared" module no team feels responsible for.
- The lead engineer says "we'll split it next quarter" three quarters in a row.

The fix is rarely technical first. Establish ownership, split teams along bounded contexts, then split the code along the same seams. The Inverse Conway Maneuver — restructuring teams to get the desired architecture — is more effective than another refactor sprint.

## 9. Refactoring Strategy at Scale

When you inherit a God Class:

1. **Map the fields** — group fields by which methods read or write them.
2. **Identify clusters** — each cluster is a candidate class.
3. **Introduce the new class behind a `@Deprecated` facade** — keep the old API alive.
4. **Move methods one cluster at a time**, with tests green after each move.
5. **Switch callers gradually** using feature flags or branch-by-abstraction.
6. **Delete the facade** once all callers have migrated.

This is the Strangler Fig pattern at class scope. It avoids the "big bang rewrite" that breaks production.

## 10. Quick Rules Checklist

- Domain classes never exceed 200 LOC and 7 public methods.
- No domain class imports infrastructure packages.
- Every bounded context is a separate Maven/Gradle module.
- ArchUnit rules fail the build on threshold violation.
- Aggregates own invariants; nothing else writes their state.
- Every class has one reason to change — document it in the Javadoc.
- Refactor God Classes by Strangler Fig, never by rewrite.
- Ownership is explicit; "shared" code has a named team.

## What's Next

| Topic                              | Where to go                                |
|------------------------------------|--------------------------------------------|
| Numeric thresholds and tool config | `specification.md`                         |
| Hands-on detection drills          | `find-bug.md`                              |
| JVM cost of God Classes            | `optimize.md`                              |
| Practice exercises                 | `tasks.md`                                 |
| Interview preparation              | `interview.md`                             |
| Related antipattern: Feature Envy  | `../02-feature-envy/`                      |
| Bounded contexts in depth          | `../../15-design-patterns-in-java/`        |
| ArchUnit setup                     | `../../14-testing-in-java/06-archunit.md`  |

**Memorize this:** A God Class is an architecture failure made visible — fix the boundaries, the budgets, and the ownership, and the class will shrink on its own.
