# Anemic Domain Model — Senior

> The senior question is not *"is anemic bad?"* — it's *"where is anemic appropriate, where is it catastrophic, and how do I decide?"*. Every codebase contains both shapes legitimately; the failure mode is letting the anemic shape leak from the boundary into the core. This file develops the judgement: Tell-Don't-Ask in depth, the four contexts where anemic is justified, the four where it's a real problem, encapsulation failure modes you only see at runtime, and a worked rich-model example from a non-trivial domain (a loan disbursement).

---

## 1. Anemic-or-rich is a *context* decision, not a *taste* decision

Fowler's bliki entry is often misread as "always rich, never anemic". That isn't what it says. The argument is: **the data and behaviour about a domain concept should live together when the concept has nontrivial rules**. The threshold "nontrivial" is doing all the work.

Concretely:

| Concept                        | Rules?                                          | Right shape       |
|--------------------------------|-------------------------------------------------|-------------------|
| `LoanDisbursement`             | Many: regulatory, fraud, balance, lifecycle     | Rich              |
| `Money`                        | A few: same-currency arithmetic, non-negative   | Rich (value obj.) |
| `User`                         | A handful: email format, password, active state | Rich              |
| `UserCreateRequest` (DTO)      | None: it's transport                            | Anemic            |
| `CustomerSummary` (read model) | None: it's a projection for a dashboard         | Anemic            |
| `Address` for a shipping label | None or very few: country/zip pairs             | Mostly anemic     |
| `Tag` (an editable label row)  | None: it's a CRUD form                          | Anemic is fine    |

A senior engineer reads the system context (what does this class participate in?) before reaching for a shape. The same `class` keyword can be applied to both — the discipline is knowing which one this is.

---

## 2. Tell-Don't-Ask in depth

The original phrasing comes from Alec Sharp (*Smalltalk by Example*, 1997) and was popularised by the Pragmatic Programmers. The rule:

> "Tell objects what to do, don't ask them for their data and then act on it."

Concretely, the procedural pattern is:

```java
// ASK
if (account.getBalance().compareTo(amount) < 0) {
    throw new IllegalStateException("insufficient funds");
}
account.setBalance(account.getBalance().subtract(amount));
```

And the OO pattern is:

```java
// TELL
account.withdraw(amount);
```

The second form has the *same effect*, but the rule lives on the class that owns the data. Anywhere else that withdraws from an account uses the same method, so the rule is enforced consistently. The first form requires every caller to remember the precondition.

But Tell-Don't-Ask has limits. It is not "never expose getters". It is "don't *make decisions* outside the object based on its state". Reading data for display, serialization, logging, or assertions in tests is fine. The smell is the *combination* of `ask → decide → mutate-elsewhere`.

```java
// Fine — ask for display
return "Balance: " + account.balance();

// Smell — ask, decide, mutate
if (account.balance().compareTo(threshold) > 0) {
    account.setStatus(PREMIUM);
}

// Fine — tell
account.promoteIfBalanceExceeds(threshold);
```

The third form is the senior idiom — the decision about promotion belongs *to* the account, not to whatever caller happened to be looking at one.

---

## 3. The four contexts where anemic is justified

### 3.1 DTOs at the network boundary

A `UserCreateRequest` exists to be deserialised from JSON, validated for shape, and consumed by a domain operation. It has no domain identity, no invariants beyond syntactic validity, and no behaviour. Anemic shape is its job.

```java
public record UserCreateRequest(
    @NotBlank @Email   String email,
    @NotBlank @Size(min = 8) String password,
    @NotBlank          String displayName
) { }
```

A `record` with Bean Validation annotations is the modern Java sweet spot — the type system + validation framework do the work of *syntactic* validity; the domain entity downstream enforces *semantic* validity. The DTO is correctly anemic; the entity is rich.

### 3.2 JPA persistence shapes for genuinely flat data

If your "domain" is a labels table — a CRUD admin screen that creates and edits a name — a rich model is overkill. A `Tag(id, name)` entity with a public constructor and a setter for `name` is fine; the rules ("name not blank, length ≤ 64") fit on a JSR-380 annotation. The rich-model investment doesn't pay back because there are no rules to enforce.

The line moves when *behaviour* enters. The moment a `Tag` has a lifecycle (`approved`, `retired`) with constraints on transitions, the rich shape pays off.

### 3.3 Event payloads and message-bus DTOs

A Kafka event, an integration message, a webhook body — these are wire-format data structures. They are anemic by definition.

```java
public record OrderPlacedEvent(
    UUID orderId,
    UUID customerId,
    BigDecimal totalAmount,
    String currency,
    Instant placedAt
) { }
```

The producing service has a *rich* `Order` and converts it to this anemic event at the boundary; the consuming service converts the event to its own rich domain. The wire format mediates between them, deliberately data-only so it is small, evolvable, and stable.

### 3.4 CQRS read models / query projections

In CQRS (Command Query Responsibility Segregation, Bertrand Meyer's term, popularised in DDD by Greg Young), the *write side* uses rich aggregates with invariants. The *read side* uses denormalised projections optimised for query shapes. A `CustomerOrderSummaryView(customerId, orderCount, totalSpent, lastOrderAt)` is data, not domain — anemic by design.

The mistake is putting the same `Customer` class on both sides. That forces a compromise: either the read side has unused behaviour, or the write side has primitive getters its query consumers need. Splitting the two lets each be the right shape.

---

## 4. The four contexts where anemic is catastrophic

### 4.1 Core aggregates with multi-field invariants

If `Account` has a `balance` and a `status`, and "you cannot withdraw from a frozen account" is a rule, then both fields exposed via setters means any caller can:

```java
account.setStatus(Status.FROZEN);
account.setBalance(account.getBalance().subtract(amount));   // bypasses the rule
```

The invariant has no enforcer. Some service somewhere checks it; some service somewhere else forgets. You will find both in the same codebase.

### 4.2 State machines with transition rules

`Order` has states: `DRAFT → PLACED → PAID → SHIPPED → DELIVERED → CANCELLED`. Each transition is a domain event with rules ("you can't ship an unpaid order", "delivered orders can't be cancelled"). An anemic `Order` with `setStatus(...)` distributes those rules across every service that touches orders. A rich `Order` with `pay()`, `ship()`, `deliver()`, `cancel()` keeps them in one place.

### 4.3 Calculations whose components must stay synchronised

`Invoice` has line items, a subtotal, a tax amount, and a total. If line items change, the subtotal must change; if the subtotal changes, the total must change. Exposing `setSubtotal`, `setTax`, and `setTotal` separately means a buggy service can make them inconsistent. A rich `Invoice` recomputes derived values internally and exposes only the operations that maintain coherence (`addLineItem`, `removeLineItem`).

### 4.4 Lifecycle-bound resources

`Subscription` has a start date, an end date, a renewal policy, and a billing schedule. An anemic shape lets a caller put the end date before the start date, or renew an already-cancelled subscription. The rich shape rejects these moves at the method that performs them.

---

## 5. Encapsulation failures you only see in production

Anemic models *compile*. The runtime symptoms surface later:

- **Data corruption.** A new feature uses the entity's setters, doesn't replicate the rules that lived in the old service, and a year later you find rows with `balance < 0` or `status = SHIPPED, deliveredAt = null`.
- **Race conditions across services.** Two services both load, mutate, and save the same entity. Without invariants on the entity, neither service sees the other's writes' implications.
- **Test gaps.** Each `XxxService` has its own tests. The *combination* of rules across services is untested because nobody owns the combination. Production exercises the combination first.
- **"Why doesn't this entity validate itself?"** Junior developers ask. The honest answer is "because we designed it not to". The senior answer is "we shouldn't have".
- **Reflection abuse.** Frameworks (`@Setter` everywhere, ObjectMapper deep-copy, BeanWrapper) reach into entities and produce states the original design never anticipated.

The cost of these failures is paid by *operations* and *support*, not by the developer who shipped the anemic shape. That asymmetry is why anemic survives: the person making the design decision rarely sees the bill.

---

## 6. A worked rich-model example: `LoanDisbursement`

A loan disbursement is *not* a CRUD form. It has regulatory limits, lifecycle states, and money — the right shape is rich. Here's a senior-level example.

```java
// Value objects — small immutable types that own their validity.
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.signum() < 0)
            throw new IllegalArgumentException("amount must be >= 0");
    }
    public Money plus(Money other)  { requireSame(other); return new Money(amount.add(other.amount), currency); }
    public Money minus(Money other) {
        requireSame(other);
        BigDecimal r = amount.subtract(other.amount);
        if (r.signum() < 0) throw new IllegalStateException("negative result");
        return new Money(r, currency);
    }
    public boolean exceeds(Money other) { requireSame(other); return amount.compareTo(other.amount) > 0; }
    private void requireSame(Money o) {
        if (!currency.equals(o.currency)) throw new IllegalArgumentException("currency mismatch");
    }
}

public record BorrowerId(UUID value) {
    public BorrowerId { Objects.requireNonNull(value); }
}

public record LoanId(UUID value) {
    public LoanId { Objects.requireNonNull(value); }
    public static LoanId newId() { return new LoanId(UUID.randomUUID()); }
}

public enum LoanStatus {
    REQUESTED, APPROVED, DISBURSED, REPAID, DEFAULTED, CANCELLED
}
```

Now the entity:

```java
public final class LoanDisbursement {

    private final LoanId id;
    private final BorrowerId borrower;
    private final Money principal;
    private final Money regulatoryCap;
    private LoanStatus status;
    private final Instant requestedAt;
    private Instant approvedAt;
    private Instant disbursedAt;

    private LoanDisbursement(LoanId id, BorrowerId borrower, Money principal,
                             Money cap, Instant requestedAt) {
        if (principal.exceeds(cap))
            throw new IllegalArgumentException("principal exceeds regulatory cap");
        this.id = id;
        this.borrower = borrower;
        this.principal = principal;
        this.regulatoryCap = cap;
        this.status = LoanStatus.REQUESTED;
        this.requestedAt = requestedAt;
    }

    public static LoanDisbursement request(BorrowerId borrower, Money principal,
                                           Money cap, Clock clock) {
        return new LoanDisbursement(LoanId.newId(), borrower, principal, cap, clock.instant());
    }

    public void approve(Clock clock) {
        requireStatus(LoanStatus.REQUESTED);
        this.status = LoanStatus.APPROVED;
        this.approvedAt = clock.instant();
    }

    public void disburse(Clock clock) {
        requireStatus(LoanStatus.APPROVED);
        this.status = LoanStatus.DISBURSED;
        this.disbursedAt = clock.instant();
    }

    public void cancel() {
        if (status == LoanStatus.DISBURSED || status == LoanStatus.REPAID)
            throw new IllegalStateException("cannot cancel a disbursed or repaid loan");
        this.status = LoanStatus.CANCELLED;
    }

    public void markRepaid() {
        requireStatus(LoanStatus.DISBURSED);
        this.status = LoanStatus.REPAID;
    }

    public void markDefaulted() {
        requireStatus(LoanStatus.DISBURSED);
        this.status = LoanStatus.DEFAULTED;
    }

    private void requireStatus(LoanStatus expected) {
        if (this.status != expected)
            throw new IllegalStateException("expected " + expected + " but was " + status);
    }

    public LoanId id()               { return id; }
    public BorrowerId borrower()     { return borrower; }
    public Money principal()         { return principal; }
    public LoanStatus status()       { return status; }
    public Instant requestedAt()     { return requestedAt; }
    public Optional<Instant> approvedAt()  { return Optional.ofNullable(approvedAt); }
    public Optional<Instant> disbursedAt() { return Optional.ofNullable(disbursedAt); }
}
```

Six things to notice:

1. **No public constructor.** `request(...)` is the only way in. The construction-time invariant ("principal ≤ regulatory cap") cannot be bypassed.
2. **No setters.** Every state change is a domain verb with its own preconditions.
3. **Status is a state machine.** `requireStatus(...)` enforces transitions. You cannot disburse an unapproved loan.
4. **Getters return Optionals for absent timestamps.** A caller can't pretend `approvedAt` exists before approval.
5. **Money invariants are in `Money`, not duplicated here.** Currency mismatch and negative amounts are caught at the value-object boundary.
6. **The class is `final`.** Inheritance would let a subclass override `approve` and break invariants by widening preconditions.

The service that uses this becomes trivial:

```java
@Service
public class LoanService {
    private final LoanDisbursementRepository repo;
    private final Clock clock;
    public LoanService(LoanDisbursementRepository repo, Clock clock) {
        this.repo = repo;
        this.clock = clock;
    }

    @Transactional
    public LoanId requestLoan(BorrowerId borrower, Money principal, Money cap) {
        LoanDisbursement loan = LoanDisbursement.request(borrower, principal, cap, clock);
        repo.save(loan);
        return loan.id();
    }

    @Transactional
    public void approve(LoanId id) {
        LoanDisbursement loan = repo.findById(id).orElseThrow();
        loan.approve(clock);
    }

    @Transactional
    public void disburse(LoanId id) {
        LoanDisbursement loan = repo.findById(id).orElseThrow();
        loan.disburse(clock);
    }
}
```

The service has no rules. The rules live where they belong — on the entity. Every method here is `load → call domain method → let the transaction commit`. Adding a new business rule (say, "you cannot disburse on a weekend") is a one-line edit to `disburse(...)` and nowhere else.

---

## 7. Anti-anti-pattern: over-rich domain

You can swing too far. Symptoms of over-rich domain:

- **Domain methods that call out to infrastructure.** `account.sendStatementEmail()` puts SMTP knowledge on the entity. Wrong — that belongs in an application service.
- **Repositories injected into entities.** `order.persist()` makes the entity know about its storage. Wrong — the repository is infrastructure.
- **Methods that orchestrate multiple aggregates.** `account.transferTo(other, amount)` blurs the consistency boundary. Better: a domain service `Transfer.execute(from, to, amount)`.
- **Behaviour that *can* be on the entity but only one caller ever needs it.** YAGNI applies — if the only place that ever computes "loyalty bonus" is one report, that calculation lives in the report, not on `Customer`.

The senior calibration: **invariants on the entity, lifecycle transitions on the entity, derived values on the entity. Infrastructure off the entity. Cross-aggregate coordination off the entity. One-off calculations off the entity.**

---

## 8. Quick rules

- An entity is rich when it owns invariants and forbids the states that would violate them.
- An entity is anemic-by-design when it is a DTO, event payload, or read projection.
- Tell-Don't-Ask doesn't mean "no getters" — it means "no external decision-making".
- Constructors and static factories enforce construction-time invariants; setters disappear.
- Value objects (`Money`, `Address`, `DateRange`) own their own validity and remove duplication.
- Status fields become state machines via methods with `requireStatus(...)` guards.
- Cross-aggregate operations belong to domain services, not to any one entity.
- Infrastructure (SMTP, repositories, queues) never appears on an entity.
- Classes that hold no rules and never will should stay anemic — over-modelling is its own smell.

---

## 9. What's next

| Topic                                                                | File              |
| -------------------------------------------------------------------- | ----------------- |
| DDD aggregates, ArchUnit policy, MapStruct, CQRS read models in code | `professional.md`  |
| Metrics (methods:fields ratio, LCOM), formal definitions             | `specification.md` |
| 10 buggy snippets with diagnosis and fix                             | `find-bug.md`      |
| JIT, escape analysis, dirty checking, value-object grouping          | `optimize.md`      |
| 8 refactoring exercises                                              | `tasks.md`         |
| 20 interview questions                                               | `interview.md`     |

---

**Memorize this:** Anemic is a *context* call, not a *style* call. Rich for core aggregates that own invariants and lifecycles; anemic for DTOs, events, and read projections. The senior judgement is knowing which one you're writing — and never letting the boundary's shape leak into the centre.
