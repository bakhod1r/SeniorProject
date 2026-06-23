# Domain Modeling from Requirements — Senior

> **What?** At senior level, domain modeling stops being a clean-sheet exercise and becomes a *negotiation* — with legacy schemas, with microservice boundaries, with money and time and identity, and with the limits of the modeling style itself. Junior-level "events and decisions" still apply, but the questions get harder: *Where does this aggregate end? Whose clock are we using? Is `BigDecimal` really enough? Can we afford eventual consistency here?*
> **How?** Treat the model as one ingredient in a larger system. Choose your bounded contexts so they survive the next reorg. Wrap legacy with anti-corruption layers. Pick CRUD where it fits and a richer model where decisions live. And always — *always* — model time, money, and identity explicitly.

---

## 1. When the model must fight a legacy schema

Most real domain modeling does not happen on a blank slate. There is already a 600-table Oracle schema, a `CUSTOMER_MASTER` view with 142 columns, half of which are NULL for any given row, and a stored procedure named `PKG_ORD_FINALIZE_V7` that nobody dares touch. You cannot replace this in one quarter. But you also cannot pour the legacy structure into your new code, or it will corrupt every model you try to build on top.

The two patterns that matter here are the **strangler fig** (Martin Fowler) and the **anti-corruption layer** (Eric Evans).

The *strangler fig* says: do not rewrite. Build the new model alongside the old system, route one slice of traffic at a time to the new path, and slowly let the new system grow around the old one until the legacy can be removed. Each slice is small, reversible, and shippable.

The *anti-corruption layer* (ACL) is the translation membrane between your clean model and the legacy schema. It is *boring on purpose*: its only job is to map ugly legacy shapes into clean domain objects and back.

```java
// Clean domain model — knows nothing about Oracle, COBOL, or VSAM.
public final class CustomerProfile {
    private final CustomerId id;
    private final FullName name;
    private final LoyaltyTier tier;
    private final List<Address> addresses;
}

// ACL — the only place that knows the legacy fields.
public final class LegacyCustomerAcl {
    private final LegacyOracleClient legacy;

    public CustomerProfile load(CustomerId id) {
        LegacyCustomerRow row = legacy.fetchByExternalId(id.value());
        return new CustomerProfile(
            id,
            FullName.of(row.firstName().trim(), row.lastName().trim()),
            mapTier(row.loyCdAlpha()),     // "G" -> GOLD
            mapAddresses(row.addrCsv())    // "123 Elm|Sf|CA|94110;..." -> List<Address>
        );
    }

    private LoyaltyTier mapTier(String legacyCode) {
        return switch (legacyCode) {
            case "G" -> LoyaltyTier.GOLD;
            case "S" -> LoyaltyTier.SILVER;
            case "B" -> LoyaltyTier.BRONZE;
            case null, "" -> LoyaltyTier.NONE;
            default -> throw new UnknownLegacyTierException(legacyCode);
        };
    }
}
```

Without the ACL, `LoyCdAlpha` leaks into the domain. With it, the domain stays clean and the ugliness is quarantined in one file you can delete on the day the legacy dies.

---

## 2. CRUD vs domain models — when each is appropriate

A common senior mistake is treating "rich domain model" as the only respectable answer. It is not. CRUD is perfectly valid when the system is, in fact, a thin layer over storage.

Use a **CRUD model** when:

- The team's job is to display and edit records, not enforce business decisions.
- The "rules" are field-level validation (`@NotNull`, `@Email`, `length <= 50`), nothing more.
- The shape of the data matches what the user sees on the screen.
- Examples: admin back-offices, internal directories, simple content management.

Use a **rich domain model** when:

- The same data has multiple legal states and transitions between them carry rules.
- A user action triggers cascading decisions (`reserve -> charge -> ship -> confirm`).
- The cost of a wrong update is high (money, regulation, safety).
- Examples: ordering, billing, scheduling, trading, claims.

A real system usually has both. The customer profile screen is CRUD; the order lifecycle is a domain model. Drawing this line consciously saves you from over-engineering the boring parts and under-engineering the dangerous ones.

```java
// CRUD-style: a configuration record. No rules. No methods. Pure data.
public record AdminUserView(
    String email, String displayName, boolean enabled, Instant lastLoginAt
) {}

// Rich domain model: an order with explicit lifecycle.
public final class Order {
    private OrderState state;
    public void confirm(PaymentReceipt r) { /* state transitions, invariants */ }
    public void ship(Carrier c)           { /* must be CONFIRMED */ }
    public void cancel(Reason r)          { /* may not be SHIPPED */ }
}
```

---

## 3. Microservice boundaries based on bounded contexts

Splitting a monolith on technology lines (`user-service`, `database-service`, `notification-service`) produces a distributed monolith — one big shared model accessed over HTTP. Splitting on bounded contexts produces a real system.

A *bounded context* is a region of the model where the language is consistent and the rules apply uniformly. A `Customer` in *Sales* is not the same object as a `Customer` in *Shipping*; conflating them was the original sin of the monolith. The microservice boundary is the bounded-context boundary, externalised over the network.

Practical rules:

- **One bounded context per service.** Not one entity per service, not one screen per service.
- **No shared database.** Two services touching the same table share an implicit model and lose independence.
- **Translate at the wire.** Services exchange context-specific DTOs, not internal aggregates. Each service has its own ACL on inbound events.

```java
// Sales context — what Sales calls a customer.
public record SalesCustomer(
    CustomerId id, FullName name, LoyaltyTier tier, AccountManager rep
) {}

// Shipping context — same person, different model.
public record Recipient(
    RecipientId id, FullName name, Address deliverTo, DeliveryWindow window
) {}

// When Sales emits CustomerEnrolled, Shipping translates at its boundary.
public final class ShippingCustomerProjection {
    public void on(CustomerEnrolled event) {
        Recipient r = new Recipient(
            RecipientId.from(event.customerId()),
            event.name(),
            event.defaultShippingAddress(),
            DeliveryWindow.standard()
        );
        recipients.save(r);
    }
}
```

If you find yourself adding fields to `SalesCustomer` only because *Shipping* needed them, your boundary is wrong. Either the contexts merge, or the leak goes through a proper integration event.

---

## 4. Event sourcing as a modeling tool — pros, cons, when it's wrong

Event sourcing stores the *history of facts* rather than the current state. The aggregate's state is computed by folding over its event stream.

```java
public final class Account {
    private AccountId id;
    private Money balance = Money.ZERO_USD;
    private boolean closed;

    // Decision: returns new events, does not mutate.
    public List<Event> withdraw(Money amount, Clock clock) {
        if (closed) throw new AccountClosedException();
        if (balance.isLessThan(amount)) throw new InsufficientFundsException();
        return List.of(new MoneyWithdrawn(id, amount, clock.instant()));
    }

    // Apply: rebuilds state from a recorded event.
    public void apply(Event e) {
        switch (e) {
            case MoneyDeposited d  -> balance = balance.plus(d.amount());
            case MoneyWithdrawn w  -> balance = balance.minus(w.amount());
            case AccountClosed c   -> closed = true;
            default                -> { /* ignore unknown */ }
        }
    }
}
```

**Pros:**

- Perfect audit trail; "why is the balance 42.17?" becomes literal replay.
- Decouples write model from read models; you can build new projections from old events.
- Natural fit for domains with regulatory or financial history.

**Cons:**

- Schema evolution is real work. An old event written in v1 must still be replayable after v17.
- Querying current state requires projections; ad-hoc SQL is gone.
- Snapshots, idempotency, deduplication, and replay tooling become permanent infrastructure.

**When it is wrong:** when the domain has no meaningful history (config tables, dictionaries, lookup data), when the team has no operational appetite for stream infrastructure, or when "we might want audit someday" is the only reason. Audit columns and a CDC stream are usually cheaper.

---

## 5. Snapshots and projections — read models built from events

Replaying ten years of events on every request does not scale. Two patterns address this.

**Snapshots** are periodically saved copies of the aggregate state, so replay starts from the snapshot rather than from event zero.

```java
public Account load(AccountId id) {
    Snapshot<Account> snap = snapshots.latestFor(id).orElse(Snapshot.empty());
    Account a = snap.state();
    long fromVersion = snap.version();
    eventStore.streamFor(id, fromVersion).forEach(a::apply);
    return a;
}
```

**Projections** are read-side models, denormalised for queries. Each projection subscribes to the event stream and maintains its own table.

```java
public final class AccountBalanceProjection {
    public void on(MoneyDeposited e) {
        balances.upsert(e.accountId(), b -> b.plus(e.amount()));
    }
    public void on(MoneyWithdrawn e) {
        balances.upsert(e.accountId(), b -> b.minus(e.amount()));
    }
}
```

The write model owns invariants. The read model serves queries. CQRS (Command-Query Responsibility Segregation) names this split formally. Projections may be inconsistent for milliseconds — design the UI to tolerate it (optimistic updates, "your transfer is being processed").

---

## 6. Modeling time correctly — Clock injection and time travel in tests

`Instant.now()` and `LocalDate.now()` scattered through the model make it impossible to write deterministic tests, and they hide a hard truth: *the model has a clock dependency*. Treat `Clock` as a service, inject it, control it.

```java
public final class Subscription {
    private final Clock clock;
    private final Plan plan;
    private Instant lastChargedAt;

    public boolean isDueForRenewal() {
        return Duration.between(lastChargedAt, clock.instant())
                       .compareTo(plan.billingCycle()) >= 0;
    }
}

// Test: time travel without sleeping.
@Test
void renews_after_one_billing_cycle() {
    Clock clock = Clock.fixed(Instant.parse("2026-05-19T00:00:00Z"), ZoneOffset.UTC);
    Subscription sub = new Subscription(clock, Plan.MONTHLY);
    sub.chargeNow();

    Clock later = Clock.offset(clock, Duration.ofDays(31));
    Subscription sameSub = sub.withClock(later);
    assertThat(sameSub.isDueForRenewal()).isTrue();
}
```

Other time rules at this level:

- Persist `Instant` (UTC) or `OffsetDateTime`; never `LocalDateTime` without a zone, unless it really is a local concept (a calendar reminder at 9am wherever the user is).
- Distinguish *event time* (when the thing happened in the domain) from *processing time* (when the system saw it). They differ across timezones, retries, and replays.
- Beware DST: a 2:30am wall-clock time does not exist on the spring-forward day. Library defaults usually pick one side silently.

---

## 7. Modeling money and units — never `double`

`double` cannot represent `0.1` exactly. Using it for money creates rounding errors that pass tests on a developer laptop and bankrupt customers in production. Senior engineers do not use `double` for money. Ever.

Choose one of:

- `BigDecimal` with explicit `MathContext` and `RoundingMode`. Verbose, but correct.
- Joda-Money (`org.joda.money.Money`) — typed, currency-aware, well-tested.
- JSR 354 (`javax.money.MonetaryAmount`) — Java's standard, supported by Moneta.

```java
import org.joda.money.CurrencyUnit;
import org.joda.money.Money;

public final class Invoice {
    private final List<LineItem> items;

    public Money total() {
        return items.stream()
            .map(LineItem::subtotal)
            .reduce(Money.zero(CurrencyUnit.USD), Money::plus);
    }
}

public record LineItem(Quantity qty, Money unitPrice) {
    public Money subtotal() { return unitPrice.multipliedBy(qty.value()); }
}
```

Other units deserve the same respect: distances, weights, temperatures, durations. Mixing kilograms and pounds is what caused the Gimli Glider. Wrap them.

```java
public record Mass(BigDecimal kilograms) {
    public Mass plus(Mass other) { return new Mass(kilograms.add(other.kilograms)); }
    public static Mass ofPounds(BigDecimal lb) {
        return new Mass(lb.multiply(new BigDecimal("0.45359237")));
    }
}
```

Currency conversion deserves a separate explicit service, with an explicit exchange-rate timestamp. Never multiply a `Money` by a raw `double`.

---

## 8. Modeling identity — UUID, ULID, natural keys, surrogate keys

Identity is more interesting than "use a Long primary key". Senior decisions here include:

- **Surrogate vs natural.** A surrogate (UUID, ULID, sequence) is system-generated and stable. A natural key (ISBN, email, social security number) carries meaning, and changes when the meaning changes. Marriages rename people. Use surrogates for identity, natural keys for lookup.
- **UUIDv4** — purely random, globally unique, no information leak. Default choice. Downside: random insert pattern is bad for clustered B-tree indexes.
- **UUIDv7 / ULID** — time-ordered, monotonically increasing prefix, sortable by creation time, index-friendly. Prefer these for high-write tables.
- **Sequences / `BIGINT IDENTITY`** — small, fast, but they leak count information and are awkward across services.

```java
public record OrderId(UUID value) {
    public OrderId { Objects.requireNonNull(value); }
    public static OrderId newId()  { return new OrderId(UuidCreator.getTimeOrderedEpoch()); }
    public static OrderId of(String s) { return new OrderId(UUID.fromString(s)); }
    @Override public String toString() { return value.toString(); }
}
```

Wrap IDs in value-object types. `OrderId` and `CustomerId` are both `UUID` internally but the compiler must not let you pass one where the other is expected. This single discipline catches more bugs than most static analysers.

Lastly: identity is *forever*. Once a system has emitted `OrderId(...)` to the outside world, it can never be reused. Soft-delete, do not reissue.

---

## 9. Cross-aggregate consistency — eventual vs immediate

Inside one aggregate, invariants are enforced atomically: the transaction either commits or rolls back. Across aggregates, you have a choice: *immediate* consistency (one transaction spanning both) or *eventual* consistency (one commits, the other catches up later).

**Immediate** is simpler and what teams reach for first. It scales until two aggregates start contending for the same lock, or until they live in different databases, or different services. Then you must move to *eventual*.

**Eventual consistency** uses domain events plus the transactional outbox pattern: the aggregate writes its state and an outbound event in the same transaction, and a separate publisher picks the event up and delivers it to consumers.

```java
@Transactional
public void placeOrder(PlaceOrderCommand cmd) {
    Order order = Order.place(cmd);
    orders.save(order);
    outbox.append(new OrderPlaced(order.id(), order.total(), clock.instant()));
    // Inventory, billing, notifications react asynchronously via the outbox publisher.
}
```

Senior judgement here:

- One aggregate per transaction is a strong rule. Break it only with evidence.
- Eventual consistency requires the UI and the user model to tolerate "still processing" states.
- Sagas (or process managers) coordinate multi-step business workflows that cannot be atomic — reservation, payment, fulfilment, with compensations for each step.

A failed `chargeCard()` after a successful `reserveInventory()` does not roll back time; it emits `OrderPaymentFailed`, and a compensating handler releases the inventory.

---

## 10. Trade-offs vs functional and relational thinking

Object-oriented domain modeling is not the only style, and at senior level you should know when another style fits better.

- **Relational / SQL-first.** When the system is fundamentally about set-based queries over uniform data (analytics, reporting, BI), modeling in objects adds friction. A clean schema plus views and stored functions can be the right answer.
- **Functional core, imperative shell.** Model the domain as immutable values and pure decision functions; do I/O at the edges. This style scales well for high-concurrency, event-driven systems and aligns naturally with event sourcing.
- **Data-oriented design.** When throughput dominates correctness (game engines, low-latency trading), modeling for cache locality matters more than modeling for domain expressiveness.

```java
// Functional-leaning style: decisions are pure functions of state + command -> events.
public static List<Event> decide(AccountState state, Command cmd, Clock clock) {
    return switch (cmd) {
        case Withdraw w -> state.canWithdraw(w.amount())
            ? List.of(new MoneyWithdrawn(state.id(), w.amount(), clock.instant()))
            : List.of(new WithdrawalRejected(state.id(), w.amount(), Reason.INSUFFICIENT_FUNDS));
        case Deposit d -> List.of(new MoneyDeposited(state.id(), d.amount(), clock.instant()));
        case Close c   -> state.canClose() ? List.of(new AccountClosed(state.id())) : List.of();
    };
}
```

Choosing a style is a senior call. Mixing them inside one bounded context, on the other hand, almost always backfires.

---

## 11. Quick rules

- [ ] Wrap legacy schemas in an ACL; never let `LOY_CD_ALPHA` leak into the domain.
- [ ] Pick CRUD for screens, rich models for lifecycles; do not over-engineer either.
- [ ] Service boundaries follow bounded contexts, never tables.
- [ ] Reach for event sourcing only when audit, replay, or projection diversity is real.
- [ ] Inject `Clock`; never call `Instant.now()` inside the model.
- [ ] Use `Money` (`BigDecimal` / Joda-Money / JSR 354); `double` is malpractice.
- [ ] Surrogate IDs (UUIDv7 / ULID) for identity; wrap them in typed value objects.
- [ ] One aggregate per transaction; use outbox + events for cross-aggregate consistency.
- [ ] Know when functional or relational thinking fits the slice better than OO.

---

## 12. What's next

| Topic                                                              | File                  |
| ------------------------------------------------------------------ | --------------------- |
| Running modeling workshops, Event Storming with experts            | `professional.md`     |
| Hands-on modeling exercises across legacy and greenfield domains   | `tasks.md`            |
| Interview Q&A on bounded contexts, event sourcing, consistency     | `interview.md`        |
| Tactical DDD — aggregates, repositories, domain services in depth  | `../../08-tactical-ddd/` |
| CQRS and event sourcing patterns at production scale               | `../../09-cqrs-event-sourcing/` |

---

**Memorize this:** at senior level, the domain model is one moving part inside a system that also has legacy schemas, network boundaries, money, time, and identity to respect. Wrap the old, draw context lines on purpose, keep one aggregate per transaction, inject your clock, never trust `double`, and pick the modeling style that fits the slice — OO is a tool, not a creed.
