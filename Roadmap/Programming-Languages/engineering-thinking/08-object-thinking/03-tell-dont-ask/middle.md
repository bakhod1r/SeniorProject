# Tell, Don't Ask — Middle

> **What?** At the middle level, Tell-Don't-Ask is a refactoring discipline: you spot accessor chains and ask-decide-write sequences, then collapse them into named verbs on the object that owns the data. The principle stops being a slogan and starts being a daily lever for reducing coupling.
> **How?** You learn the Law of Demeter as a measurable rule, practice mediator methods on real domains (loans, refunds, inventory, dispatch), apply Move Method mechanics, and reconcile telling with immutability and ports. Then you internalize the failure modes — pseudo-telling, command-query mixing, train-wrecks dressed up as facades.

---

## 1. Train-wreck refactor: mediator method on the outermost object

A train-wreck is a chain like `a.getB().getC().getD().doSomething()`. Each `.get` hands the caller a deeper internal object; by the end, the caller is steering plumbing that should be invisible. Here is a mortgage-disbursement train-wreck:

```java
// Before — caller walks the object graph
public void disburse(LoanApplication app, Wallet bankWallet) {
    if (app.getApplicant().getCreditFile().getScore() >= 680
            && app.getProperty().getAppraisal().getValue()
                .compareTo(app.getRequestedAmount()) >= 0) {
        bankWallet.getLedger().getAccountFor(app.getApplicant().getId())
            .credit(app.getRequestedAmount());
        app.getStatus().setState("DISBURSED");
    }
}
```

Five problems sit on top of each other: the caller knows about `CreditFile`, `Appraisal`, `Ledger`, the applicant's account identity, and the state machine of `Status`. Any of those types changing breaks `disburse`. Fix it by adding a verb on the outermost object — the one the caller already has — and let it talk to its direct neighbors only.

```java
// After — one tell on LoanApplication, one tell on Wallet
public void disburse(LoanApplication app, Wallet bankWallet) {
    DisbursementOrder order = app.approveForDisbursement();   // app decides
    bankWallet.execute(order);                                // wallet acts
}
```

Inside `LoanApplication.approveForDisbursement()`, the application talks to *its own* applicant and *its own* property — one hop deep — and returns a typed instruction. Inside `Wallet.execute(order)`, the wallet finds the right account through its own ledger. The graph stays hidden; each method follows the "talk to friends, not strangers" rule.

---

## 2. Law of Demeter — the formal rule behind the smell

The Law of Demeter (LoD) for methods, stated by Lieberherr and Holland in 1987, says: a method `m` of object `O` may invoke methods on only four kinds of targets.

| #   | Allowed target                          | Example                              |
| --- | --------------------------------------- | ------------------------------------ |
| 1   | `this` itself                           | `this.validate()`                    |
| 2   | parameters of `m`                       | `payment.amount()`                   |
| 3   | objects `O` creates inside `m`          | `new Receipt(...).print()`           |
| 4   | direct fields/components of `O`         | `this.ledger.post(entry)`            |

Notably absent: objects you get *back* from another method. If `payment.account()` returns an `Account`, calling `payment.account().ledger().post(entry)` is a violation — `ledger` is a stranger to your method. The fix is either a forwarding method (`payment.postTo(ledger)`) or moving the logic onto whichever object naturally owns it.

LoD is not a syntactic ban on dots; `stream().filter().map().toList()` is a fluent builder on one type and is fine. The rule targets *navigating between domain objects*. For the full treatment, the design-principle counterpart lives at [../../03-design-principles/03-law-of-demeter/](../../03-design-principles/03-law-of-demeter/) — that's where you'll find the lint tooling, the exceptions for value objects, and the "single dot per statement" heuristic.

---

## 3. Three worked refactors of accessor cascades into named verbs

**Loan disbursement (cont'd from §1).** The verb is `approveForDisbursement`, returning a value-object instruction rather than mutating shared state. Notice the asymmetry: the *application* decides whether to issue the order; the *wallet* decides how to execute it. Each owns its slice.

```java
public final class LoanApplication {
    private final Applicant applicant;
    private final Property property;
    private final Money requested;
    private Status status;

    public DisbursementOrder approveForDisbursement() {
        if (!applicant.meetsCreditFloor(680))   throw new NotCreditworthy();
        if (!property.appraisesAtLeast(requested)) throw new UnderCollateralized();
        this.status = status.advanceTo(StatusKind.APPROVED);
        return new DisbursementOrder(applicant.payoutAccountId(), requested);
    }
}
```

**Inventory reservation.** Before, the caller pulled `warehouse.getBin(sku).getOnHand()`, subtracted, and wrote back. After, the warehouse exposes one verb that returns a reservation token:

```java
Reservation r = warehouse.reserve(sku, qty);   // throws OutOfStock if it can't
// later
warehouse.release(r);                          // or warehouse.fulfill(r)
```

The caller never sees `Bin`. The `Reservation` is opaque — it carries an ID, not a `Bin` reference — so it can't be used to reach back into internals.

**Refund flow.** Before, the caller asked `order.getPayment().getMethod().getProvider()` to dispatch a gateway call. After, the order knows how to refund itself by delegating to its payment, which knows its method, which knows its provider — each hop is one step:

```java
RefundReceipt receipt = order.refund(reason);
// internally: this.payment.reverse(reason) → method.creditBack(...) → ...
```

The customer-facing service has one line. Every layer beneath it is composed of one-hop calls. That is what LoD compliance looks like in practice.

---

## 4. Command-Query Separation in concrete Java

Bertrand Meyer's CQS rule: a method is either a **command** (changes state, returns `void` or a thin acknowledgment) or a **query** (returns a value, no observable side effects). Tell-Don't-Ask presupposes CQS — if `getBalance()` also locks the row, callers can't reason about which "asks" are safe.

```java
public final class Account {

    // Query — pure, repeatable, side-effect-free
    public Money balance() { return balance; }

    // Command — mutates, returns void or a domain event
    public WithdrawalPosted withdraw(Money amount) {
        if (amount.isGreaterThan(balance)) throw new InsufficientFunds();
        this.balance = balance.minus(amount);
        return new WithdrawalPosted(id, amount, Instant.now());
    }
}
```

The returned `WithdrawalPosted` is *not* the new balance — it is an **event** describing what happened. That is the CQS-compatible way for a command to communicate: queries return *state*, commands return *facts about what just changed*. In event-sourced systems this distinction is structural; even outside ES, it keeps tests honest (you assert on the emitted event, not on internal fields).

| Concern             | Query              | Command                          |
| ------------------- | ------------------ | -------------------------------- |
| Return type         | domain value       | `void` or event/receipt          |
| Side effects        | none               | mutates owner, may emit events   |
| Idempotent          | yes (free)         | only if you design for it        |
| Safe to call twice  | always             | depends                          |
| Cache-able          | yes                | no                               |

---

## 5. Move Method mechanics — when to extract, when to inline

Move Method is the Fowler refactoring that powers most Tell-Don't-Ask conversions: a method that uses another class's data more than its own should live on that other class. The mechanics, applied to a claims-handling example:

```java
// Smelly home — ClaimsService reaches deep into Claim
public final class ClaimsService {
    public Money payout(Claim claim) {
        BigDecimal base = claim.getCoverage().getLimit();
        BigDecimal ded  = claim.getPolicy().getDeductible();
        BigDecimal loss = claim.getLossAmount();
        return Money.of(loss.subtract(ded).min(base).max(BigDecimal.ZERO));
    }
}
```

The method touches `Claim.getCoverage`, `Claim.getPolicy`, `Claim.getLossAmount` — three pieces of `Claim`'s state, zero of `ClaimsService`'s. Move it.

```java
public final class Claim {
    public Money payout() {
        BigDecimal capped = lossAmount.subtract(policy.deductible())
                                       .min(coverage.limit())
                                       .max(BigDecimal.ZERO);
        return Money.of(capped);
    }
}
```

The four mechanical steps:

1. **Check feature envy.** Does the method reference `that.x` and `that.y` more than `this.anything`? If yes, it lives on the wrong class.
2. **Copy** the method body onto the target class, renaming parameters to fields.
3. **Replace** the original with a forwarding call (`return claim.payout();`), run tests.
4. **Inline** the forwarding call at each caller if the indirection adds no value — then delete the original.

**When to inline instead of extract.** If a one-line "tell" method exists only to wrap a single setter (`setStatusToShipped`), inline it back and rethink the design. A verb that doesn't bundle a decision is just a renamed setter.

---

## 6. Immutable telling — return a new object instead of mutating

Telling works equally well with immutable objects. Instead of the verb mutating `this`, it returns a new instance representing the post-action state.

```java
public final class Order {
    private final OrderId id;
    private final List<Line> lines;
    private final Status status;
    private final Optional<Payment> payment;

    public Order markPaid(Payment payment) {
        if (status != Status.AWAITING_PAYMENT)
            throw new IllegalStateTransition(status, Status.PAID);
        if (!payment.covers(totalDue()))
            throw new UnderpaidException();
        return new Order(id, lines, Status.PAID, Optional.of(payment));
    }
}
```

The call site becomes assignment-driven:

```java
order = order.markPaid(payment);
```

This is still telling — the decision (is this transition valid? does the payment cover the bill?) sits inside `Order`. What changes is that `Order` doesn't carry a mutable status field; the new instance carries the new state. Combine this with persistent collections and you get value-semantics objects whose verbs are pure functions from `(self, args)` to `self'`. The Tell-Don't-Ask shape is identical; only the storage discipline differs.

A useful rule for choosing: mutate when the object has identity that must persist across the change (`account.withdraw` — same account, new balance); return-new when the object is a value or a snapshot (`money.plus(other)`, `policy.renewedFor(period)`).

---

## 7. Tell-Don't-Ask in interfaces and ports

When designing a port (in the hexagonal-architecture sense — an interface the domain depends on, implemented by infrastructure), Tell-Don't-Ask shapes the *signature* of the port.

```java
// Leaky port — exposes state the domain must reassemble
public interface RideDispatch {
    List<Driver> nearbyDrivers(Location l);
    void notify(Driver d, RideRequest r);
    void markBusy(Driver d);
}

// Tell-style port — one verb, returns an outcome
public interface RideDispatch {
    DispatchOutcome dispatch(RideRequest request);
}
```

The leaky version forces the caller to know the dispatch algorithm: filter drivers, pick one, notify, mark busy. The tell-style version hides all of that behind a single verb whose return type (`DispatchOutcome` — `Assigned(driver, eta)` or `NoDriversAvailable`) is the only thing the domain needs to react to.

Two tests for whether a port respects Tell-Don't-Ask:

1. **Can you swap implementations without changing callers?** If the caller has to reorganize logic when you switch from `LocalDispatch` to `KafkaDispatch`, the port is leaking state.
2. **Do return types describe outcomes or expose internals?** `List<Driver>` is internals. `DispatchOutcome` is an outcome.

Ports that follow Tell-Don't-Ask are also easier to mock: each test stubs one verb returning one outcome, instead of orchestrating a list-of-drivers fixture.

---

## 8. Pitfalls at the middle level

**Telling that mutates globals.** A verb like `order.confirm()` that internally does `EmailService.send(...)` via a static call has pushed the decision *into* `Order` but smuggled a side effect *out* through a back channel. Pass the collaborator in, or have `confirm()` return an `OrderConfirmed` event that an outer handler dispatches. Static globals re-introduce all the coupling Tell-Don't-Ask was supposed to remove.

**Coupling explosion via parameter lists.** When you fold an ask-decide-write sequence into a verb, you sometimes need to pass several collaborators in: `order.confirm(emailer, ledger, warehouse, clock)`. If the parameter list grows past four, you've identified that `confirm` is doing too many jobs — split into `order.markConfirmed(clock)` returning an event, and let an outer policy fan it out.

**Pseudo-telling that hides procedural code.** `loan.processAll()` with 300 lines is procedural code wearing an OO costume. The cohesion test: would each branch of the method make sense on its own as a verb? If not, the class is a god object in disguise.

**Asking-through-events.** Sometimes the "ask" is wearing an event-bus jacket: a handler calls `bus.publish(GetBalanceQuery)` and waits for a reply, then publishes `UpdateBalanceCommand`. That is a synchronous ask-decide-write spread across infrastructure. Recognize it: events should carry decisions or facts, not be a transport for getters.

**Mediators that swell into god-objects.** When you collapse train-wrecks via mediator methods, the outermost object accumulates verbs. Watch for `LoanApplication` growing 40 methods. At that point, extract collaborators (a `Disbursement` aggregate, an `UnderwritingDecision` value) and let `LoanApplication` delegate.

---

## 9. Quick rules

- [ ] One dot per statement between domain objects. Fluent builders on one type are fine.
- [ ] If a method on `A` uses two or more pieces of `B`'s state, move it to `B`.
- [ ] Commands return `void` or events; queries return values and have no side effects.
- [ ] Ports expose verbs and outcomes, not lists of internals.
- [ ] Immutable verbs return new instances; mutable verbs mutate and return nothing or an event.
- [ ] Mediator methods that accept four-plus collaborators are doing too many jobs — split them.
- [ ] Static side effects inside a verb cancel the benefits of telling. Inject or return events.
- [ ] If you can't name the verb without using "and", it's two verbs.

---

## 10. What's next

| Topic                                                                          | File              |
| ------------------------------------------------------------------------------ | ----------------- |
| Tell vs frameworks (Spring proxies, JPA dirty-tracking, anemic DTOs)           | `senior.md`        |
| Driving the rule on code review, lint policies, team conventions               | `professional.md`  |
| Hands-on refactoring of train-wrecks and feature-envy methods                  | `tasks.md`         |
| Interview prompts: LoD vs Tell-Don't-Ask, CQS, hexagonal ports                 | `interview.md`     |
| Foundational design principle: full Law of Demeter coverage                    | [../../03-design-principles/03-law-of-demeter/](../../03-design-principles/03-law-of-demeter/) |

---

**Memorize this:** every accessor chain is a missing verb. Find the outermost object that already knows enough to decide, give it a method named after the intent, and let the dots disappear. The Law of Demeter is the metric; Move Method is the move; the verb is the design.
