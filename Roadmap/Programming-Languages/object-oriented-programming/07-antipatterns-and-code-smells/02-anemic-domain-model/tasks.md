# Anemic Domain Model — Tasks

> Reference: Martin Fowler, *AnemicDomainModel* (https://martinfowler.com/bliki/AnemicDomainModel.html), 2003.

Eight progressive exercises. Each one starts from anemic code and asks you to produce a rich-model refactor with tests. Estimated time: 6–8 hours total.

## Exercise 1 — Money Value Object

**Objective.** Replace `BigDecimal amount` + `String currency` field pairs across the codebase with a single immutable `Money` Value Object.

**Constraints.**
- `Money` must be a `record`.
- Validation in the canonical constructor: scale must match `currency.getDefaultFractionDigits()`, amount cannot be null, currency cannot be null.
- Provide `add`, `subtract`, `multiply(BigDecimal)`, all returning new `Money`.
- All arithmetic methods must reject currency mismatches with `CurrencyMismatchException`.
- No public setters anywhere.

**Acceptance criteria.**
- 100% line coverage on `Money`.
- `Money.of("USD", 10).add(Money.of("EUR", 5))` throws.
- `new Money(new BigDecimal("10.123"), Currency.getInstance("USD"))` throws.
- Used as `@Embeddable` in at least one entity.

## Exercise 2 — Account aggregate

**Objective.** Convert an anemic `Account { id, balance, frozen }` into a rich aggregate with `open`, `deposit`, `withdraw`, `freeze`, `unfreeze`.

**Constraints.**
- Static factory `open(AccountId, Money initialDeposit)`; no public constructor.
- `withdraw` must throw `InsufficientFundsException` rather than allow negative balance.
- All operations on a frozen account must throw `AccountFrozenException`.
- `balance` is exposed via accessor `balance()`, not `getBalance()`.

**Acceptance criteria.**
- A property-based test (jqwik) verifies that for any sequence of valid deposit/withdraw, the balance equals the algebraic sum.
- A test verifies that `withdraw` on a frozen account fails *before* the balance check (i.e., frozen takes precedence).

## Exercise 3 — ArchUnit guard

**Objective.** Add ArchUnit rules to the project that detect new anemic classes in the `domain` package.

**Constraints.**
- Rule 1: no public method in `..domain..` may start with `set`.
- Rule 2: every class annotated with `@Entity` in `..domain..` must have at least one public method that is not a getter/setter/equals/hashCode/toString.
- Rule 3: classes in `..domain.vo..` must have only `final` fields.
- Rules must run in CI; failing rules fail the build.

**Acceptance criteria.**
- Adding `public void setX(int x) {}` to an existing domain entity causes ArchUnit to fail with a clear message.
- The existing rich model passes all rules.

## Exercise 4 — MapStruct mapper

**Objective.** Replace hand-written DTO conversion code with MapStruct.

**Constraints.**
- `OrderResponse` is a record with no setters.
- `OrderMapper` is a `@Mapper(componentModel = "spring")` interface.
- The mapper must extract `Money.amount` and `Money.currency.currencyCode` into separate response fields.
- No setters added to `Order` entity to make the mapper work.

**Acceptance criteria.**
- `mvn compile` generates `OrderMapperImpl`.
- Manual conversion methods are deleted.
- An integration test confirms `OrderMapper.toResponse(order)` round-trips correctly.

## Exercise 5 — CQRS split

**Objective.** Split a single anemic `OrderSearchResult` (used by both write and read paths) into a rich `Order` aggregate and a flat `OrderListItem` projection.

**Constraints.**
- `Order` is annotated with `@Entity`, lives in `domain`, has behavior methods.
- `OrderListItem` is a `record`, lives in `query`, has no behavior.
- The query side uses `JdbcTemplate`, not the JPA repository.
- The two types never appear in the same class.

**Acceptance criteria.**
- Write tests instantiate `Order` via `Order.place(...)`.
- Read tests assert that `OrderListItem` is returned from `OrderQueryRepository.findRecent(10)`.
- No field overlap is required between the two — `OrderListItem` may include `customerName` (denormalized) that `Order` does not have.

## Exercise 6 — Domain event on cancel

**Objective.** Add a `cancel(Reason)` method to `Order` that emits an `OrderCancelledEvent` on success.

**Constraints.**
- Use Spring's `ApplicationEventPublisher` *outside* the aggregate; the aggregate only registers events on itself.
- The repository publishes registered events on save.
- `cancel` throws if the order is already shipped.

**Acceptance criteria.**
- A test verifies that calling `order.cancel(reason)` followed by `repo.save(order)` triggers an event listener.
- The aggregate has zero references to Spring classes.

## Exercise 7 — Email Value Object replaces three layers

**Objective.** Find every place that validates email format (DTO `@Email`, service-level regex, JPA `@Column(length = 255)`) and consolidate behind a single `Email` VO.

**Constraints.**
- `Email` is a `record` with validation in the canonical constructor.
- Jackson deserializes JSON strings into `Email` via `@JsonCreator`.
- JPA persists `Email` as a `VARCHAR(255)` via an `AttributeConverter`.
- No regex appears outside the `Email` class.

**Acceptance criteria.**
- A `grep -r "email.*regex"` finds zero matches outside `Email.java`.
- POST `/users` with `"email": "not-an-email"` returns 400 with a clear error.
- The persisted column is still `VARCHAR(255)` (Liquibase changelog unchanged).

## Exercise 8 — Refactor a real service-driven flow

**Objective.** Given a legacy `InvoiceService` of 600 lines that manipulates an anemic `Invoice` entity, extract three behavior methods to `Invoice`: `applyDiscount(Percentage)`, `finalize()`, `voidInvoice(Reason)`.

**Constraints.**
- Move all invariant checks into `Invoice`.
- `InvoiceService` shrinks by at least 40% lines.
- No new public setters are added to `Invoice`.
- Existing tests still pass; add new tests for the moved behavior on `Invoice` directly.

**Acceptance criteria.**
- `InvoiceService` becomes an orchestration layer (load → call domain method → save → publish event).
- ArchUnit rule (from Exercise 3) still passes.
- Coverage on `Invoice` jumps to ≥ 90%.

## Validation table

| Exercise | Primary skill | Verifies | Common failure |
| --- | --- | --- | --- |
| 1 | VO design | Immutability, validation | Mutable field smuggled in via collection |
| 2 | Aggregate design | Invariant enforcement | `withdraw` checks balance before frozen state |
| 3 | Architectural enforcement | ArchUnit rule writing | Rule too broad — fails legitimate code |
| 4 | DTO mapping | MapStruct without setters | Adding a setter "just for the mapper" |
| 5 | CQRS split | Write/read separation | Sharing one DTO across both sides |
| 6 | Domain events | Event-on-mutation | Publishing inside the aggregate |
| 7 | Consolidation | One source of validation truth | Leaving the DTO `@Email` annotation in place |
| 8 | Legacy refactor | Service-to-aggregate migration | Moving logic but leaving the setters |

## Worked solution sketch — Exercise 2

```java
public final class Account {
    private final AccountId id;
    private Money balance;
    private boolean frozen;

    private Account(AccountId id, Money initial) {
        this.id = id;
        this.balance = initial;
        this.frozen = false;
    }

    public static Account open(AccountId id, Money initialDeposit) {
        Objects.requireNonNull(id);
        Objects.requireNonNull(initialDeposit);
        if (initialDeposit.amount().signum() < 0)
            throw new IllegalArgumentException("Negative initial deposit");
        return new Account(id, initialDeposit);
    }

    public void deposit(Money amount) {
        requireActive();
        balance = balance.add(amount);
    }

    public void withdraw(Money amount) {
        requireActive();              // frozen check FIRST
        if (balance.amount().compareTo(amount.amount()) < 0)
            throw new InsufficientFundsException(id, balance, amount);
        balance = balance.subtract(amount);
    }

    public void freeze() {
        if (frozen) throw new IllegalStateException("Already frozen");
        frozen = true;
    }

    public void unfreeze() {
        if (!frozen) throw new IllegalStateException("Already active");
        frozen = false;
    }

    private void requireActive() {
        if (frozen) throw new AccountFrozenException(id);
    }

    public AccountId id() { return id; }
    public Money balance() { return balance; }
    public boolean isFrozen() { return frozen; }
}
```

Property-based test (jqwik):

```java
@Property
void balance_equals_algebraic_sum(@ForAll List<@From("validAmount") Money> ops) {
    Account a = Account.open(AccountId.newId(), Money.zero(Currency.getInstance("USD")));
    BigDecimal expected = BigDecimal.ZERO;
    for (Money m : ops) {
        if (m.amount().signum() >= 0) {
            a.deposit(m);
            expected = expected.add(m.amount());
        } else {
            Money toWithdraw = m.negate();
            if (a.balance().amount().compareTo(toWithdraw.amount()) >= 0) {
                a.withdraw(toWithdraw);
                expected = expected.subtract(toWithdraw.amount());
            }
        }
    }
    assertThat(a.balance().amount()).isEqualByComparingTo(expected);
}
```

Pass criteria: 1000 random sequences, all produce a consistent balance and never violate the invariants.
