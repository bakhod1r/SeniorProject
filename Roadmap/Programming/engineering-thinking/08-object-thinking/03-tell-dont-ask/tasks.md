# Tell, Don't Ask — Practice Tasks

> Each task starts from anemic, getter-heavy Java and asks you to push the decision into the object that owns the data. The goal isn't to make code compile — it is to make the verbs at the call site read like the business rule.
>
> Global constraints for every task: no public setters on domain objects (verbs only); no train-wreck chains (`a.getB().getC().setD(...)`); domain methods return `void`, a result object, or a computed value — never raw internal collections; existing tests must still pass.

---

## Task 1 — Loan disbursement with credit check chain

**Domain.** A small-business loan platform. Before money moves, the applicant's credit score, debt-to-income ratio, and collateral must all clear thresholds. Today the controller does the asking.

**Starting point:**

```java
public class LoanController {
    public void disburse(LoanApplication app, BankAccount account) {
        if (app.getApplicant().getCreditReport().getScore() < 680) {
            app.setStatus("REJECTED");
            return;
        }
        if (app.getApplicant().getFinancials().getDebtToIncome() > 0.43) {
            app.setStatus("REJECTED");
            return;
        }
        if (app.getCollateral().getAppraisedValue()
                .compareTo(app.getRequestedAmount()) < 0) {
            app.setStatus("REJECTED");
            return;
        }
        app.setStatus("APPROVED");
        account.setBalance(account.getBalance().add(app.getRequestedAmount()));
        app.setDisbursedAt(Instant.now());
    }
}
```

**Objective.** Refactor so the controller calls `app.disburseTo(account)` and every rule lives inside the relevant object. The applicant answers credit questions; the collateral answers value questions; the loan application orchestrates.

**Constraints.** No `getCreditReport()`, `getFinancials()`, or `getCollateral()` on `LoanApplication`'s public API. `Applicant` exposes verbs like `isCreditworthy(threshold)` and `canService(debtToIncomeCap)` — not raw scores. `setStatus` and `setBalance` are deleted. Disbursement is atomic in intent: either the loan moves to `DISBURSED` *and* the account is credited, or neither happens.

**Acceptance criteria:**

- [ ] Controller body is one or two lines with no `if` on loan internals; zero `app.getX().getY()` chains.
- [ ] A `DisbursementResult` (or domain exception) communicates rejection reasons without leaking internal fields.
- [ ] Tests cover low credit, high DTI, undervalued collateral, and happy path — each asserting on the verb's outcome.
- [ ] Renaming a private field in `Applicant` does not require touching `LoanController`.

---

## Task 2 — Refund flow gated by order status

**Domain.** An e-commerce backend issues refunds. The current code reads the order's status, the payment's capture state, and the customer's flags before deciding.

**Starting point:**

```java
public class RefundService {
    public void refund(Order order, Money amount) {
        if (!order.getStatus().equals("DELIVERED")
                && !order.getStatus().equals("RETURNED")) {
            throw new IllegalStateException("not refundable");
        }
        if (order.getPayment().getCapturedAmount().compareTo(amount) < 0) {
            throw new IllegalStateException("over-refund");
        }
        if (order.getCustomer().isFraudFlagged()) {
            throw new IllegalStateException("manual review required");
        }
        order.getPayment().setRefundedAmount(
            order.getPayment().getRefundedAmount().add(amount));
        order.setStatus("REFUNDED");
    }
}
```

**Objective.** Move the decision *and* the bookkeeping into `Order`. The service becomes a thin transport layer: `order.refund(amount)`.

**Constraints.** `Payment` is part of `Order`'s internals; the service must not touch it directly. Fraud handling stays on `Customer`, but only `Order` asks — via a verb like `customer.mayReceiveRefund()`. `Order.refund` rejects over-refunds without exposing the captured amount. No public setter for `status` or `refundedAmount` after the refactor.

**Acceptance criteria:**

- [ ] `RefundService.refund` reduces to a single call plus logging; `Order` exposes only `refund(Money)` and `refundable()`.
- [ ] Over-refund and wrong-status cases throw *distinct* domain exceptions, not generic `IllegalStateException`.
- [ ] Tests pass for partial refund, full refund, double refund rejection, and fraud-flag rejection.
- [ ] Renaming `Payment.capturedAmount` to `Payment.captured` requires no changes outside `Order`/`Payment`.

---

## Task 3 — Inventory reservation across warehouses

**Domain.** A fulfillment service reserves stock for an order. Today it loops through warehouses, asks each one how much it has, picks the closest sufficient one, and updates the count.

**Starting point:**

```java
public class FulfillmentPlanner {
    public Warehouse reserve(Sku sku, int qty, List<Warehouse> warehouses, Address ship) {
        Warehouse best = null;
        double bestDistance = Double.MAX_VALUE;
        for (Warehouse w : warehouses) {
            int available = w.getStockLevels().get(sku).getOnHand()
                          - w.getStockLevels().get(sku).getReserved();
            if (available < qty) continue;
            double d = ship.distanceTo(w.getAddress());
            if (d < bestDistance) { bestDistance = d; best = w; }
        }
        if (best == null) throw new OutOfStockException();
        best.getStockLevels().get(sku).setReserved(
            best.getStockLevels().get(sku).getReserved() + qty);
        return best;
    }
}
```

**Objective.** Replace the loop with a `WarehouseNetwork` you tell: `network.reserve(sku, qty, shipTo)`. Each `Warehouse` answers `canFulfill(sku, qty)` and performs `reserve(sku, qty)` on itself. The planner stops reading stock counts.

**Constraints.** `Warehouse.getStockLevels()` is removed; stock levels are an internal map. `WarehouseNetwork` owns the choice of warehouse; warehouses don't know about each other. Reservation is idempotent per `(orderId, sku)` — calling twice with the same order reserves once. No `null` returns; out-of-stock is a domain exception or a `Reservation.failed(...)` result.

**Acceptance criteria:**

- [ ] `FulfillmentPlanner` shrinks to a thin wrapper around `WarehouseNetwork`; no call site reads `onHand` or `reserved`.
- [ ] A `Reservation` value type carries warehouse identity, sku, quantity, and idempotency key.
- [ ] Tests cover nearest-chosen, fallback when nearest is short, total out-of-stock, and idempotent retry.
- [ ] Swapping closest-warehouse for cheapest-shipping is a one-strategy-class change.

---

## Task 4 — Claims processing through stages (worked solution sketch)

**Domain.** Insurance claims move through Intake → Adjustment → Approval → Payout. Today, a `ClaimWorkflow` class drives transitions by reading fields and flipping the status string.

**Starting point:**

```java
public class ClaimWorkflow {
    public void advance(Claim c) {
        if (c.getStage().equals("INTAKE") && c.getDocuments().size() >= 3) {
            c.setStage("ADJUSTMENT");
            c.setAdjustedAmount(null);
        } else if (c.getStage().equals("ADJUSTMENT") && c.getAdjustedAmount() != null) {
            if (c.getAdjustedAmount().compareTo(c.getPolicy().getMaxPayout()) > 0) {
                c.setStage("REJECTED");
            } else {
                c.setStage("APPROVED");
            }
        } else if (c.getStage().equals("APPROVED")) {
            c.getCustomer().getAccount().setBalance(
                c.getCustomer().getAccount().getBalance().add(c.getAdjustedAmount()));
            c.setStage("PAID");
        }
    }
}
```

**Objective.** Replace the string-based stage machine with a polymorphic `ClaimStage` (sealed type) so each stage knows how to advance itself. The caller becomes `claim.advance()`.

**Constraints.** `Claim.getStage()` returning a string is gone; stages are objects. No `instanceof` chains in the workflow class. The payout step uses a verb like `customer.credit(amount)` — no `getAccount().setBalance(...)`. A claim cannot regress or skip stages.

**Acceptance criteria:**

- [ ] Each stage class implements `advance(Claim)` and returns the next stage; `ClaimWorkflow` is deleted or reduced to a logging shell.
- [ ] Adding `FRAUD_REVIEW` between Adjustment and Approval requires one new class plus one transition edit.
- [ ] Tests cover each transition plus one end-to-end happy path.
- [ ] Advancing a `REJECTED` claim throws a domain exception.

**Worked solution sketch.**

```java
public final class Claim {
    private ClaimStage stage = new IntakeStage();
    private final List<Document> documents = new ArrayList<>();
    private final Policy policy;
    private final Customer customer;
    private Money adjustedAmount;

    public Claim(Policy p, Customer c) { this.policy = p; this.customer = c; }
    public void attach(Document d) { documents.add(d); }
    public void adjustTo(Money amount) { this.adjustedAmount = amount; }
    public void advance() { this.stage = stage.advance(this); }

    // package-private — visible to stage classes, hidden from the world
    int documentCount() { return documents.size(); }
    Money adjustedAmount() { return adjustedAmount; }
    Money policyMax() { return policy.maxPayout(); }
    void payOut() { customer.credit(adjustedAmount); }
}

sealed interface ClaimStage permits IntakeStage, AdjustmentStage, ApprovedStage, TerminalStage {
    ClaimStage advance(Claim c);
}
final class IntakeStage implements ClaimStage {
    public ClaimStage advance(Claim c) {
        if (c.documentCount() < 3) throw new NotReadyException("need 3 documents");
        return new AdjustmentStage();
    }
}
final class AdjustmentStage implements ClaimStage {
    public ClaimStage advance(Claim c) {
        if (c.adjustedAmount() == null) throw new NotReadyException("adjust first");
        return c.adjustedAmount().compareTo(c.policyMax()) > 0
             ? TerminalStage.REJECTED : new ApprovedStage();
    }
}
final class ApprovedStage implements ClaimStage {
    public ClaimStage advance(Claim c) { c.payOut(); return TerminalStage.PAID; }
}
enum TerminalStage implements ClaimStage {
    PAID, REJECTED;
    public ClaimStage advance(Claim c) { throw new TerminalStageException(); }
}
```

No public getters for `stage`, `documents`, or `adjustedAmount`; the workflow class is gone; stage objects coordinate by *telling* the claim to `payOut()` rather than reaching into the customer's account.

---

## Task 5 — Traffic signal as a state machine

**Domain.** A traffic signal cycles Red → Green → Yellow → Red, with pedestrian-button overrides and emergency-vehicle preemption. A `SignalController` reads the current color and calls setters.

**Starting point:**

```java
public class SignalController {
    public void tick(TrafficSignal s) {
        if (s.getColor().equals("RED") && s.getSecondsInColor() > 30) {
            s.setColor("GREEN"); s.setSecondsInColor(0);
        } else if (s.getColor().equals("GREEN") && s.getSecondsInColor() > 25) {
            s.setColor("YELLOW"); s.setSecondsInColor(0);
        } else if (s.getColor().equals("YELLOW") && s.getSecondsInColor() > 4) {
            s.setColor("RED"); s.setSecondsInColor(0);
        } else {
            s.setSecondsInColor(s.getSecondsInColor() + 1);
        }
        if (s.isPedestrianRequested() && s.getColor().equals("GREEN")) {
            s.setColor("YELLOW"); s.setSecondsInColor(0);
            s.setPedestrianRequested(false);
        }
        if (s.isEmergencyPreempted()) {
            s.setColor("GREEN"); s.setSecondsInColor(0);
        }
    }
}
```

**Objective.** Push the rules into `TrafficSignal`. The controller becomes a clock: `signal.tick()`. Pedestrian and emergency events become verbs: `signal.requestPedestrianCrossing()` and `signal.preemptForEmergency()`.

**Constraints.** No string color; use an internal `enum Aspect { RED, GREEN, YELLOW }`. No public getter for `secondsInColor`. The display layer may read the aspect to render — a legitimate getter use. Emergency preemption returns the signal to its prior state when cleared, not always to RED.

**Acceptance criteria:**

- [ ] `signal.tick()` is the only state-changing call in the controller's loop.
- [ ] A test can fast-forward 60 ticks and assert the exact aspect sequence.
- [ ] Pedestrian requests queue, not get lost, while the light is RED.
- [ ] Adding a flashing-yellow off-hours aspect is localized inside `TrafficSignal`; no call site checks the aspect to decide what to do next — only to render.

---

## Task 6 — Parking lot ticket validation

**Domain.** A parking lot validates exit tickets. Current code asks the ticket for entry time, fare table, validations, and grace period, then computes the amount due.

**Starting point:**

```java
public class ExitGate {
    public Money charge(Ticket t, Instant now, FareTable fares) {
        Duration stayed = Duration.between(t.getEntryTime(), now);
        if (t.getValidations().contains("MERCHANT_2H")) {
            stayed = stayed.minusHours(2);
        }
        if (stayed.isNegative() || stayed.compareTo(Duration.ofMinutes(15)) <= 0) {
            return Money.ZERO;
        }
        Money owed = fares.lookup(stayed);
        t.setPaidAmount(owed);
        t.setExitedAt(now);
        return owed;
    }
}
```

**Objective.** Refactor so `ticket.priceAt(now)` returns the amount due and `ticket.exit(now, payment)` records the exit. The fare table is injected into the ticket (or the `ParkingLot` that owns the table). The gate becomes `gate.process(ticket, now)`.

**Constraints.** `getEntryTime`, `getValidations`, and `getPaidAmount` lose their `public` modifier. Merchant validations are added via `ticket.applyValidation(Validation)`, not by mutating a list. A ticket cannot exit twice; the second call throws. The grace period and fare table belong to `ParkingLot`, not the gate.

**Acceptance criteria:**

- [ ] `ExitGate.process` has no arithmetic and no conditionals on ticket state.
- [ ] Tests assert that a 14-minute stay returns zero, a 2-hour stay with `MERCHANT_2H` returns zero, and a 4-hour stay charges the 4-hour rate minus the validation.
- [ ] Changing the fare table at runtime affects only future `priceAt` calls; double-exit throws a domain exception.
- [ ] No field on `Ticket` is exposed via a public setter.

---

## Task 7 — Mortgage prepayment with penalty calculation

**Domain.** A mortgage allows prepayments. Some are penalty-free (within an annual allowance); the rest incur a penalty based on remaining principal and rate differential. Today the code asks the mortgage for everything and computes outside.

**Starting point:**

```java
public class PrepaymentService {
    public Money apply(Mortgage m, Money extra, LocalDate on) {
        Money allowanceLeft = m.getAnnualAllowance().subtract(m.getPrepaidThisYear());
        Money penaltyFree = extra.min(allowanceLeft);
        Money penaltyBearing = extra.subtract(penaltyFree);
        Money penalty = Money.ZERO;
        if (penaltyBearing.isPositive()) {
            BigDecimal diff = m.getRate().subtract(m.getMarketRate(on)).max(BigDecimal.ZERO);
            penalty = penaltyBearing.multiply(diff).multiply(
                BigDecimal.valueOf(m.monthsRemaining(on))).divide(BigDecimal.valueOf(12));
        }
        m.setPrincipal(m.getPrincipal().subtract(extra));
        m.setPrepaidThisYear(m.getPrepaidThisYear().add(extra));
        return penalty;
    }
}
```

**Objective.** Replace the service with `mortgage.prepay(extra, on)` returning a `PrepaymentReceipt` (penalty-free portion, penalty-bearing portion, penalty charged, new principal). The market-rate lookup is injected into the mortgage at construction.

**Constraints.** The market-rate provider is a collaborator the mortgage owns, not an argument every caller passes. `Money.min`, allowance subtraction, and penalty arithmetic must not appear outside `Mortgage`. A prepayment greater than remaining principal is rejected outright — no partial application. The annual allowance resets on the anniversary of origination, not the calendar year.

**Acceptance criteria:**

- [ ] `PrepaymentReceipt` carries every number the caller needs; the caller never reads `mortgage.principal` to find the new balance.
- [ ] Prepaying twice within one year correctly applies the remaining allowance the second time; anniversary resets are tested one day before and one day after.
- [ ] A zero rate-differential produces zero penalty even for the penalty-bearing portion.
- [ ] `PrepaymentService` is deleted or reduced to a logging wrapper.

---

## Submission checklist

- [ ] No public setters on any domain object you touched.
- [ ] No `x.getY().getZ()` chains in code you wrote or kept.
- [ ] Every conditional that read an object's field has moved inside that object or become polymorphic dispatch.
- [ ] Test names describe behaviors (`refundsFullAmountForDeliveredOrder`), not setter calls (`setsStatusToRefunded`).
- [ ] The diff at the call site reads like the business rule out loud — if you can't say it as one sentence, the verb is wrong.
