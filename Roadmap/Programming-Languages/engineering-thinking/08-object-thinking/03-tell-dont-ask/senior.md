# Tell, Don't Ask — Senior

> **What?** At senior level, Tell-Don't-Ask is no longer a refactoring trick — it's a *design constraint* that shapes aggregates, ports, events, and even your test style. It also has known failure modes (read models, projections, reporting) where insisting on it produces worse code.
> **How?** Decide *per boundary*: write models tell; read models ask. Within write models, design conversations between rich objects, push coordination into domain services only when telling makes aggregates fat, and let asynchronous events become the "tell" of a distributed system.

---

## 1. Where Tell-Don't-Ask legitimately breaks down

The rule was forged for the **write side** of a system. On the read side, forcing it produces grotesque code. Four places where "asking" is correct:

**Read models / CQRS projections.** A `LoanSummaryView` exists to be inspected. It has no behavior — its single job is to expose denormalized fields for a screen. Trying to add `view.renderItself()` couples display logic to data shape.

```java
public record LoanSummaryView(
    UUID loanId,
    String borrowerName,
    Money principal,
    Money outstanding,
    LocalDate nextPaymentDate,
    int daysPastDue
) {}
```

This is *meant* to be asked. The write side (`Loan` aggregate) tells; the read side projects flat data for queries.

**GraphQL resolvers.** A resolver answers `claim.adjuster.name` by walking a graph. Hiding that behind verbs ("claim, tell me your adjuster's name") destroys the resolver model.

**Reporting / analytics.** A monthly refund-volume report aggregates across thousands of refunds. The aggregates can't "tell" themselves into a report — the report queries them. Reporting is a separate bounded context with its own (askable) model.

**External API serialization.** When you serialize a `PaymentResponse` for a partner, you're literally exposing fields. Hide them and you have nothing to serialize.

The senior move is to *split the model*: a thin read side that exposes data, a fat write side that exposes verbs. CQRS makes this explicit.

---

## 2. Tell-Don't-Ask across the persistence boundary

The classic friction: your JPA entity *must* have getters and setters because the ORM uses them for hydration and dirty checking, and your repository must be able to read fields for queries. Yet your domain rules say nobody outside the aggregate should reach into balances or statuses.

The port-and-adapter pattern resolves this. The aggregate is rich; the persistence shape is dumb; a mapper bridges them.

```java
// Domain aggregate — telling only
public final class Loan {
    private final LoanId id;
    private final Borrower borrower;
    private Money outstanding;
    private LoanStatus status;
    private final List<Payment> payments = new ArrayList<>();

    public void applyPayment(Money amount, Clock clock) {
        if (status != LoanStatus.ACTIVE) {
            throw new IllegalStateException("Loan not active");
        }
        if (amount.isGreaterThan(outstanding)) {
            throw new OverpaymentException(id, amount, outstanding);
        }
        payments.add(new Payment(amount, clock.instant()));
        outstanding = outstanding.minus(amount);
        if (outstanding.isZero()) {
            status = LoanStatus.PAID_OFF;
        }
    }
    // no public getters for outstanding or status used in decisions
}
```

```java
// Persistence adapter — askable, but never used by domain
@Entity
class LoanRecord {
    @Id UUID id;
    UUID borrowerId;
    BigDecimal outstandingAmount;
    String currencyCode;
    String status;
    // getters/setters for JPA only
}

interface LoanRepository {
    Optional<Loan> findById(LoanId id);
    void save(Loan loan);
}

class JpaLoanRepository implements LoanRepository {
    public Optional<Loan> findById(LoanId id) { /* hydrate Loan from LoanRecord */ }
    public void save(Loan loan) { /* extract state via package-private snapshot */ }
}
```

Two rules of thumb:

- The **domain package** depends on no framework. Getters on the entity record are an artifact of JPA, not of the domain.
- Repositories return *aggregates*, not entities. The askable shape never leaks above the persistence layer.

When a junior says "but JPA needs setters" — yes, on `LoanRecord`. Not on `Loan`.

---

## 3. The conversation pattern — rich object dialogues

Real workflows aren't one verb. They're a sequence of verbs across collaborators. Each step *tells* the next. The trick is designing the **return types** so the next tell is type-safe.

Authorizing and confirming an order:

```java
public sealed interface AuthorizationResult
    permits AuthorizationResult.Approved,
            AuthorizationResult.Declined,
            AuthorizationResult.RequiresReview {

    record Approved(AuthCode code, Money authorizedAmount) implements AuthorizationResult {}
    record Declined(DeclineReason reason)                   implements AuthorizationResult {}
    record RequiresReview(ReviewTicketId ticket)            implements AuthorizationResult {}
}
```

```java
public final class Order {
    public ConfirmationOutcome confirm(AuthorizationResult.Approved auth, Clock clock) {
        if (status != OrderStatus.PENDING) {
            throw new IllegalStateException("Cannot confirm in status " + status);
        }
        this.authCode = auth.code();
        this.confirmedAt = clock.instant();
        this.status = OrderStatus.CONFIRMED;
        return new ConfirmationOutcome.Confirmed(id, auth.code());
    }
}
```

The coordinator becomes a thin script of tells:

```java
AuthorizationResult result = payment.authorize(card, order.amountDue());
if (result instanceof AuthorizationResult.Approved approved) {
    order.confirm(approved, clock);
    inventory.reserve(order.lineItems());
}
```

Notice: the coordinator never *asks* the payment if it succeeded by reading a boolean. It pattern-matches on a sealed result and tells the next object using a type that proves authorization. This is Tell-Don't-Ask with type-driven plumbing.

---

## 4. Asynchronous telling — events instead of method calls

In event-driven systems, telling becomes publishing. The aggregate emits a fact; handlers tell the next aggregate.

```java
public final class Refund {
    public List<DomainEvent> approve(Approver approver, Clock clock) {
        if (status != RefundStatus.REQUESTED) {
            throw new IllegalStateException("Refund not in REQUESTED state");
        }
        status = RefundStatus.APPROVED;
        approvedBy = approver.id();
        approvedAt = clock.instant();
        return List.of(new RefundApproved(id, amount, originalPaymentId, approvedAt));
    }
}
```

```java
class IssueRefundOnApproval {
    @EventListener
    void on(RefundApproved event) {
        Payment payment = payments.findById(event.originalPaymentId()).orElseThrow();
        payment.issueRefundOf(event.amount(), event.refundId());
        payments.save(payment);
    }
}
```

The handler reads from the event (which is *meant* to be read — it's a frozen fact) and *tells* the next aggregate. The system stays loosely coupled because nobody asks across aggregates synchronously.

The key insight: **events are first-class tells**. `RefundApproved` is the past tense of `approve()`. Subscribers receive a verb they can act on, not a state they have to interpret.

---

## 5. Pattern matching and sealed types — the coordinator's switch

Java's sealed types + pattern matching let a coordinator route on a result without "asking" the source what happened. The result *is* the message.

```java
public sealed interface InventoryReservation
    permits InventoryReservation.Reserved,
            InventoryReservation.Backordered,
            InventoryReservation.OutOfStock {

    record Reserved(ReservationId id, Instant expiresAt) implements InventoryReservation {}
    record Backordered(LocalDate expectedDate)           implements InventoryReservation {}
    record OutOfStock(List<Sku> missing)                 implements InventoryReservation {}
}
```

```java
InventoryReservation reservation = inventory.reserve(order.lineItems());

switch (reservation) {
    case InventoryReservation.Reserved r       -> order.fulfillFrom(r);
    case InventoryReservation.Backordered b    -> order.markBackordered(b.expectedDate());
    case InventoryReservation.OutOfStock oos   -> order.cancelMissing(oos.missing());
}
```

The coordinator never asks "did it succeed? what fields are set?" The sealed hierarchy is exhaustive; the compiler enforces all cases are handled; each branch is a single tell to the order. This is what mature Tell-Don't-Ask looks like in modern Java.

---

## 6. Trade-offs — when "telling" produces fat aggregates

If you push every verb into the aggregate, you eventually get a 2000-line `Loan` class with `applyPayment`, `restructure`, `defer`, `forgive`, `transferToCollections`, `accrueInterest`, `generateStatement`, `sendReminder`, `escalate`, and forty more. That's not telling — that's a god aggregate.

The senior split is:

- **Verbs that mutate the aggregate's own invariants** stay on the aggregate. `applyPayment`, `restructure`, `forgive` — these change `Loan` state and must respect its rules.
- **Verbs that coordinate multiple aggregates** move to a *domain service*. `transferToCollections` involves `Loan`, `CollectionsCase`, and `CommunicationsLog`. A `CollectionsTransferService` orchestrates the tells.
- **Verbs that are technical / cross-cutting** go to application services. `generateStatement` produces a PDF — that's a port adapter, not domain logic.

```java
public class CollectionsTransferService {
    public void transfer(LoanId loanId, Reason reason, Clock clock) {
        Loan loan = loans.findById(loanId).orElseThrow();
        loan.markForCollections(reason, clock);                          // tell #1
        CollectionsCase aCase = CollectionsCase.open(loan, reason, clock); // tell #2
        cases.save(aCase);
        loans.save(loan);
        comms.notifyBorrower(loan.borrowerId(), reason);                 // tell #3
    }
}
```

The service is a *thin* sequence of tells. It owns no state. It coordinates. The aggregates remain rich but bounded to their own invariants.

The smell to watch for: a domain service that starts pulling getters and doing decisions itself. That's the asking pattern leaking back in — refactor the verb back onto the aggregate that owns the rule.

---

## 7. Mockist vs. classicist testing

Tell-Don't-Ask aligns naturally with **mockist** (London-school) testing. If your design is "tell collaborators what to do", your tests verify "did we tell the right collaborators with the right messages". That's interaction testing.

```java
@Test
void confirmedOrderReservesInventoryAndChargesCard() {
    PaymentGateway payments = mock(PaymentGateway.class);
    InventoryService inventory = mock(InventoryService.class);
    when(payments.authorize(any(), any()))
        .thenReturn(new AuthorizationResult.Approved(new AuthCode("A1"), Money.usd(50)));

    OrderConfirmation service = new OrderConfirmation(payments, inventory, clock);
    service.confirm(orderId, card);

    verify(payments).authorize(card, Money.usd(50));
    verify(inventory).reserve(anyList());
}
```

Classicist (Detroit-school) testing prefers asserting on final state. If most of your behavior is encapsulated and side-effecting, state-based assertions become awkward — you'd need getters back to assert.

The trade-off: mockist tests verify *how* the code works, which makes them brittle to refactoring. Use them where the *interaction itself is the contract* — the coordinator's job is to tell the right collaborators in the right order. For the aggregate's own invariants, classicist tests on a real `Loan` are still fine: call `applyPayment`, then call `outstanding()` (a query, not a decision lever).

A useful split: aggregates → classicist tests; coordinators / domain services → mockist tests.

---

## 8. The performance trap — N+1 in disguise

Tell-Don't-Ask insists on per-object verbs. If you have 10,000 invoices to mark as overdue, this looks correct:

```java
for (Invoice inv : overdueInvoices) {
    inv.markOverdue(clock);
    invoices.save(inv);
}
```

It's also 10,000 round trips to the database. The "telling" version is shaped like an N+1: one method call per row.

When you spot this, you have two options:

**Option A — batch tell.** Introduce a verb on a collection-shaped aggregate:

```java
class InvoiceLedger {
    public OverdueBatch markOverdueAsOf(LocalDate cutoff, Clock clock) {
        // single UPDATE; returns event describing affected IDs
    }
}
```

The ledger *is* the collection; telling it once is honest.

**Option B — explicitly cross the read/write boundary.** Acknowledge this is a bulk operation, do it as a SQL UPDATE in a repository method, and emit a single domain event. You've left pure Tell-Don't-Ask for performance reasons — that's fine, document it.

```java
class InvoiceRepository {
    public List<InvoiceId> markOverdueAsOf(LocalDate cutoff) {
        // UPDATE invoice SET status = 'OVERDUE' WHERE due_date < ? RETURNING id;
        // emit one InvoicesMarkedOverdue event
    }
}
```

What you don't do: pretend a per-row loop is "the OO way" and ship a system that times out at 50,000 invoices. The senior judgment is recognizing when Tell-Don't-Ask's purity costs more than it gives, and choosing the boundary deliberately.

---

## 9. Designing the telling chain

A use case is a *chain of tells*. Designing it well means:

1. **Each step accepts the previous step's result type.** No re-deriving state from getters.
2. **The chain is short.** Three to five tells per use case; if it's twenty, the use case is wrong or needs to be split.
3. **Failure points are sealed results, not exceptions** — exceptions for invariant violations only.
4. **The chain is replayable** in tests by stubbing each port.

Process-a-claim, end to end:

```java
public ClaimDecision processClaim(ClaimSubmission submission) {
    Claim claim = Claim.fileNew(submission, clock);                    // 1. tell
    Coverage coverage = policies.coverageFor(submission.policyId());
    EligibilityResult eligibility = claim.checkEligibility(coverage);  // 2. tell
    if (eligibility instanceof EligibilityResult.Ineligible i) {
        return claim.deny(i.reason(), clock);                          // 3a. tell
    }
    AssessmentResult assessment = assessors.assess(claim);             // 3b. tell
    return switch (assessment) {
        case AssessmentResult.Approved a ->
            claim.approveFor(a.amount(), clock);
        case AssessmentResult.RequiresInvestigation r ->
            claim.referToInvestigation(r.investigatorId(), clock);
        case AssessmentResult.Denied d ->
            claim.deny(d.reason(), clock);
    };
}
```

Five tells, one switch. Each return type is sealed. Every branch ends with the claim telling itself what happened. The use case reads like a sentence.

---

## 10. Quick rules

- [ ] Split write models (tell) from read models (ask) — don't apply the rule uniformly.
- [ ] Keep ORM entities askable; keep domain aggregates tellable; bridge with a mapper.
- [ ] Return sealed result types so the *next* tell is type-checked, not condition-checked.
- [ ] Treat domain events as asynchronous tells.
- [ ] Move multi-aggregate coordination into domain services; keep aggregates focused.
- [ ] Use mockist tests for coordinators, classicist tests for aggregates.
- [ ] Recognize Tell-Don't-Ask N+1 patterns and refactor to batch verbs or explicit SQL.
- [ ] Limit a use-case chain to a handful of tells; if it grows, the use case is doing too much.

---

## 11. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| Driving the rule across a team and code review                 | `professional.md` |
| Hands-on refactoring exercises                                 | `tasks.md`        |
| Interview Q&A                                                  | `interview.md`    |
| Law of Demeter — the structural cousin                         | `../../03-design-principles/03-law-of-demeter/` |
| CQRS, write vs. read models, projections                       | further reading   |

---

**Memorize this:** Tell on the write side, ask on the read side; design the *return type* of each tell so the next tell is type-checked rather than condition-checked.
