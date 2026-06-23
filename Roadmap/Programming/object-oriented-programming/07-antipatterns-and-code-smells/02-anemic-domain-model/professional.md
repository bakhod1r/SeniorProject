# Anemic Domain Model — Professional

> Reference: Martin Fowler, *AnemicDomainModel* (https://martinfowler.com/bliki/AnemicDomainModel.html), 2003.
> Eric Evans, *Domain-Driven Design* (2003), ch. 5–6.

At the professional level you stop arguing about whether anemic models are bad and start *enforcing* rich domain design through architectural rules, type design, and persistence boundaries. This file shows how to design Domain-Driven Design (DDD) aggregates, enforce invariants at construction time, forbid public setters via ArchUnit, map between DTOs and entities with MapStruct, and recognize the one legitimate place where anemic models are fine: CQRS read models.

## 1. The DDD building blocks against anemia

A **rich** domain model is built from three primitives:

- **Value Object (VO)** — immutable, equality by value, no identity, validates in constructor.
- **Entity** — has identity, mutable through behavior methods only, never through setters.
- **Aggregate root** — entity that guards a consistency boundary; the *only* entry point for modifications to entities inside it.

```java
// Value Object — immutable, validating, behavioral.
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("scale exceeds currency precision");
        }
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money multiply(BigDecimal factor) {
        return new Money(amount.multiply(factor), currency);
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new CurrencyMismatchException(currency, other.currency);
        }
    }
}
```

The VO refuses to exist in an invalid state. There is no `setAmount`. Adding two `Money` values returns a *new* `Money` — old references stay valid.

## 2. Aggregate root with enforced invariants

```java
@Entity
@Table(name = "orders")
public class Order {

    @Id
    private OrderId id;

    @Enumerated(EnumType.STRING)
    private OrderStatus status;

    @ElementCollection
    @CollectionTable(name = "order_lines", joinColumns = @JoinColumn(name = "order_id"))
    private final List<OrderLine> lines = new ArrayList<>();

    @Embedded
    private Money total;

    // JPA needs a no-arg constructor; keep it protected, never public.
    protected Order() {}

    // Factory method — the only way to create a valid Order.
    public static Order place(OrderId id, CustomerId customer, List<OrderLine> initialLines) {
        if (initialLines.isEmpty()) {
            throw new IllegalArgumentException("Order requires at least one line");
        }
        Order order = new Order();
        order.id = id;
        order.status = OrderStatus.PLACED;
        order.lines.addAll(initialLines);
        order.total = computeTotal(initialLines);
        return order;
    }

    public void addLine(OrderLine line) {
        if (status != OrderStatus.PLACED) {
            throw new IllegalStateException("Cannot modify a " + status + " order");
        }
        lines.add(line);
        total = total.add(line.subtotal());
    }

    public void ship() {
        if (status != OrderStatus.PAID) {
            throw new IllegalStateException("Cannot ship unpaid order");
        }
        status = OrderStatus.SHIPPED;
    }

    public void cancel(Reason reason) {
        if (status == OrderStatus.SHIPPED) {
            throw new IllegalStateException("Cannot cancel shipped order");
        }
        status = OrderStatus.CANCELLED;
    }

    // Read-only accessors — no setters.
    public OrderId id() { return id; }
    public OrderStatus status() { return status; }
    public Money total() { return total; }
    public List<OrderLine> lines() { return Collections.unmodifiableList(lines); }

    private static Money computeTotal(List<OrderLine> lines) {
        return lines.stream()
            .map(OrderLine::subtotal)
            .reduce(Money::add)
            .orElseThrow();
    }
}
```

Notice: no `setStatus`, no `setTotal`. State transitions go through `ship()`, `cancel()`, `addLine()`. Each method checks the precondition before mutating.

## 3. Enforcing the rules with ArchUnit

You cannot rely on reviewers to catch every accidental `setStatus`. Encode the rule as a test that runs in CI.

```java
@AnalyzeClasses(packages = "com.example.shop.domain",
                importOptions = ImportOption.DoNotIncludeTests.class)
class DomainArchitectureTest {

    @ArchTest
    static final ArchRule no_public_setters_in_domain =
        methods()
            .that().arePublic()
            .and().haveNameMatching("set[A-Z].*")
            .should().notBeDeclaredInClassesThat()
            .resideInAPackage("..domain..")
            .because("Domain entities must mutate through behavior, not setters");

    @ArchTest
    static final ArchRule entities_have_no_public_constructors =
        constructors()
            .that().areDeclaredInClassesThat().areAnnotatedWith(Entity.class)
            .and().areDeclaredInClassesThat().resideInAPackage("..domain..")
            .should().notBePublic()
            .because("Use static factory methods to enforce invariants at creation");

    @ArchTest
    static final ArchRule value_objects_are_immutable =
        fields()
            .that().areDeclaredInClassesThat().resideInAPackage("..domain.vo..")
            .should().beFinal()
            .because("Value Objects must be immutable");

    @ArchTest
    static final ArchRule domain_does_not_depend_on_spring =
        noClasses()
            .that().resideInAPackage("..domain..")
            .should().dependOnClassesThat()
            .resideInAnyPackage("org.springframework..", "jakarta.persistence..")
            .orShould().dependOnClassesThat().resideInAPackage("..infrastructure..");
    // Note: relaxed for JPA when domain entities are persisted directly.
}
```

Add these to your test suite. A pull request that introduces `setTotal()` on `Order` will fail CI before review.

## 4. MapStruct: DTO ↔ Entity without leaking setters

The argument *"we need setters for serialization"* is wrong. MapStruct generates constructor-based mappers at compile time.

```java
public record CreateOrderRequest(
    UUID customerId,
    List<CreateOrderLineRequest> lines) {}

public record OrderResponse(
    UUID id,
    String status,
    BigDecimal total,
    String currency,
    List<OrderLineResponse> lines) {}

@Mapper(componentModel = "spring")
public interface OrderMapper {

    @Mapping(target = "id", source = "id.value")
    @Mapping(target = "total", source = "total.amount")
    @Mapping(target = "currency", source = "total.currency.currencyCode")
    @Mapping(target = "status", expression = "java(order.status().name())")
    OrderResponse toResponse(Order order);

    OrderLineResponse toLineResponse(OrderLine line);
}
```

Jackson handles records natively (Jackson 2.12+). No setters needed for either direction:

```java
@RestController
@RequestMapping("/orders")
class OrderController {

    private final PlaceOrderUseCase useCase;
    private final OrderMapper mapper;

    @PostMapping
    public ResponseEntity<OrderResponse> place(@Valid @RequestBody CreateOrderRequest req) {
        Order order = useCase.execute(req);
        return ResponseEntity.status(201).body(mapper.toResponse(order));
    }
}
```

## 5. The legitimate exception: CQRS read models

Anemic objects are *correct* on the query side. A read model is a flat projection optimized for display — it has no invariants to protect.

```java
// Query-side: anemic is fine here.
public record OrderListItem(
    UUID orderId,
    String customerName,
    String status,
    BigDecimal totalAmount,
    String currency,
    LocalDateTime placedAt) {}

@Repository
class OrderQueryRepository {
    private final JdbcTemplate jdbc;

    public List<OrderListItem> findRecent(int limit) {
        return jdbc.query(
            """
            SELECT o.id, c.name, o.status, o.total_amount, o.currency, o.placed_at
            FROM orders o JOIN customers c ON c.id = o.customer_id
            ORDER BY o.placed_at DESC LIMIT ?
            """,
            (rs, i) -> new OrderListItem(
                rs.getObject("id", UUID.class),
                rs.getString("name"),
                rs.getString("status"),
                rs.getBigDecimal("total_amount"),
                rs.getString("currency"),
                rs.getTimestamp("placed_at").toLocalDateTime()),
            limit);
    }
}
```

Rule: *write-side* is rich (aggregates, VOs, invariants). *Read-side* is anemic (DTOs, denormalized projections). Mixing the two is what Fowler attacks.

## 6. Persistence patterns that preserve richness

JPA pressures you toward setters. Push back:

- Use `@Embeddable` for VOs (`Money`, `Address`, `Email`).
- Use field access (`@Access(AccessType.FIELD)`), not property access.
- Keep collections mutable internally but expose `Collections.unmodifiableList`.
- Use Hibernate's `@Immutable` for VOs and reference data.
- Avoid `CascadeType.ALL` from non-roots; only aggregate roots own lifecycles.

```java
@Embeddable
@Immutable
public record Address(String street, String city, String zip, String country) {
    public Address {
        Objects.requireNonNull(street);
        Objects.requireNonNull(city);
        if (zip == null || !zip.matches("\\d{5}(-\\d{4})?")) {
            throw new IllegalArgumentException("Invalid US ZIP");
        }
    }
}
```

## Quick rules

- One factory method per legitimate creation path; constructor stays package-private or protected.
- Every mutation method names a *business operation* (`ship`, `cancel`, `applyDiscount`) — never `setX`.
- VOs are records with validation in the compact constructor.
- ArchUnit tests guard the domain package in CI.
- DTO mapping uses MapStruct or records — never expose entity setters to controllers.
- Read models are flat and anemic by design; write models are rich.
- Aggregate boundaries match transactional boundaries — one aggregate per transaction.
- Reference other aggregates by ID, never by direct object reference inside the domain.

## What's next

| Concept | Why it matters | Where to go |
| --- | --- | --- |
| Aggregate design rules | Decide what belongs in which aggregate | Vaughn Vernon, *Implementing DDD*, ch. 10 |
| Domain events | Decouple side-effects from aggregate mutations | `03-god-class/` cross-reference |
| Hexagonal architecture | Keep domain free of frameworks | `../../../08-architecture/` (when written) |
| Specification pattern | Encode complex business rules as objects | `15-design-patterns-in-java/` (when written) |
| Event sourcing | Aggregate state derived from events | Greg Young, *Event Sourcing* talks |
| Read-model projections | Anemic done right, fast queries | Martin Kleppmann, *DDIA*, ch. 11 |

## Memorize this

- **Rich write-side, anemic read-side.** CQRS makes the split explicit and correct.
- **No public setters in the domain package.** Enforce with ArchUnit, not goodwill.
- **Factory methods own creation; behavior methods own mutation.** Constructors stay invisible.
- **VOs validate in their constructor.** An invalid `Money` cannot exist, ever.
- **DTOs and entities are different types.** MapStruct or records bridge them without leaking setters.
- **One aggregate, one transaction, one consistency boundary.** Cross-aggregate references go through IDs.
