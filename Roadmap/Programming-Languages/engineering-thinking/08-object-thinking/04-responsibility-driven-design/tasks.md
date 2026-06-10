# Responsibility-Driven Design — Tasks

> Practice naming responsibilities, choosing owners, and labeling stereotypes. Every task asks you to do two things: (1) decide *who is responsible* for each behavior, and (2) make that ownership visible in the type system — one stereotype per class, named in a Javadoc tag.

Use this Javadoc convention on every class you create or rename:

```java
/**
 * @stereotype InformationHolder | ServiceProvider | Structurer | Coordinator | Controller | Interfacer
 */
```

---

## Task 1 — Responsibility table from requirements (hotel booking)

**Starting point.** Requirements only; no code yet.

```
A hotel booking system must:
- accept a guest's reservation request for a date range and room type;
- check that a matching room is available across the entire range;
- hold the room for 10 minutes while payment is collected;
- charge the guest's card and confirm the booking;
- release the hold if payment fails or times out;
- send a confirmation email and an invoice PDF;
- let the guest cancel; refund per the cancellation policy.
```

**Objective.** Produce a responsibility table *before* writing any class. For each behavior, name (a) the responsibility, (b) the owning class, (c) its stereotype, (d) the data that object must hold to discharge it.

**Constraints.**

- At least one Information Holder, one Controller, and one Coordinator must appear.
- No class may carry more than one stereotype.
- "Send email" and "generate PDF" must end up behind an Interfacer, not on a domain class.
- Refund rules must live with whoever knows the cancellation policy — name it.

**Acceptance criteria.**

- [ ] Table has 8-12 rows, one per behavior.
- [ ] Every row names the owner *and* its stereotype.
- [ ] No row uses the word "Service" as the owner.
- [ ] You can read the table aloud as "X is responsible for Y" without it sounding awkward.
- [ ] For each owner you can answer "what data does it already hold?" in one sentence.

---

## Task 2 — Split a god-class into stereotyped collaborators (insurance claim approval)

**Starting point.**

```java
public class ClaimProcessor {

    public ApprovalResult process(Claim claim, Policyholder holder, Policy policy) {
        if (claim.getAmount().signum() <= 0) throw new IllegalArgumentException();
        if (claim.getIncidentDate().isAfter(LocalDate.now())) throw new IllegalArgumentException();
        if (claim.getIncidentDate().isBefore(policy.getStartDate())) throw new IllegalArgumentException();

        if (holder.getOutstandingPremiums().signum() > 0) return ApprovalResult.denied("premiums owed");
        if (policy.getStatus() != PolicyStatus.ACTIVE) return ApprovalResult.denied("policy inactive");

        BigDecimal deductible = policy.getDeductible();
        BigDecimal covered = claim.getAmount().subtract(deductible).max(BigDecimal.ZERO);
        if (covered.compareTo(policy.getCoverageLimit()) > 0) covered = policy.getCoverageLimit();

        long recent = claimRepository.countByHolderSince(holder.getId(), LocalDate.now().minusMonths(6));
        if (recent >= 3) return ApprovalResult.flaggedForReview("frequency");

        Payout payout = new Payout(claim.getId(), covered, LocalDate.now().plusDays(5));
        payoutRepository.save(payout);
        emailGateway.send(holder.getEmail(), "Claim approved", payout.toString());
        return ApprovalResult.approved(payout);
    }
}
```

**Objective.** Split `ClaimProcessor` into stereotyped collaborators. Each rule moves to the object that already owns the data; persistence and email hide behind Interfacers.

**Constraints.**

- Exactly one stereotype per new class; annotated with `@stereotype`.
- `Claim.isValid()` and `Claim.coveredAmount(Policy)` must exist as domain behavior.
- `Policyholder.isInGoodStanding()` must exist.
- A `FraudScreen` (Service Provider) decides flagging; it must not write to the database.
- A `ClaimApproval` Coordinator orchestrates the sequence — no business rule of its own, only delegation.

**Acceptance criteria.**

- [ ] No class has both business rules and I/O.
- [ ] Coordinator has zero `if` statements except null-check guards.
- [ ] You can describe each new class in one sentence starting with a verb.
- [ ] Removing `payoutRepository` or `emailGateway` only breaks Interfacer wiring, not the domain.
- [ ] Tests for `Claim` and `Policyholder` need no mocks.

---

## Task 3 — A Coordinator that doesn't grow into a god (multi-step refund)

**Starting point.** A bare interface and a temptation.

```java
public interface RefundCoordinator {
    RefundOutcome refund(RefundRequest request);
}

// Multi-step refund flow:
//   1. verify the original payment exists and is refundable;
//   2. apply the cancellation policy to compute the refundable amount;
//   3. reverse the payment with the payment gateway;
//   4. credit any non-cash items (loyalty points, vouchers) back;
//   5. write an audit trail;
//   6. notify the customer.
```

**Objective.** Implement `RefundCoordinator` so every step delegates to a collaborator. The Coordinator must read like a table of contents — not a textbook.

**Constraints.**

- The body of `refund(...)` is at most 15 statements.
- Each step is a method call on exactly one collaborator; the collaborator decides what to do.
- The Coordinator must not query a database directly — it asks a collaborator.
- A failed reversal in step 3 must trigger compensation for any state changed in earlier steps. Name the mechanism (Saga, two-phase, etc.) in a code comment.

**Acceptance criteria.**

- [ ] `RefundCoordinator` has no business rule. None.
- [ ] Each collaborator could be unit-tested without the Coordinator.
- [ ] You can list the six steps by reading the Coordinator top-to-bottom.
- [ ] A test that simulates step-3 failure observes compensation.
- [ ] A future step is added as exactly one new line in the Coordinator.

---

## Task 4 — Identify the right Information Holder (payroll calculation)

**Starting point.**

```java
public class PayrollService {

    public Money grossPay(Employee employee, List<TimeEntry> entries, PayPeriod period) {
        Money sum = Money.zero();
        for (TimeEntry e : entries) {
            if (!period.contains(e.getDate())) continue;
            BigDecimal hours = BigDecimal.valueOf(
                Duration.between(e.getStart(), e.getEnd()).toMinutes())
                .divide(BigDecimal.valueOf(60), 4, RoundingMode.HALF_UP);
            BigDecimal rate = employee.getHourlyRate();
            DayOfWeek d = e.getDate().getDayOfWeek();
            if (d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY) {
                rate = rate.multiply(BigDecimal.valueOf(1.5));
            }
            sum = sum.plus(new Money(hours.multiply(rate), "USD"));
        }
        return sum;
    }
}
```

**Objective.** Move each fact to the object that already holds the inputs. The service should know nothing inherently.

**Constraints.**

- `TimeEntry.duration()` returns a `Duration`; the service stops doing arithmetic on `getStart()` / `getEnd()`.
- `TimeEntry.payableHours(WeekendMultiplier)` exists; weekend logic moves into a `WeekendMultiplier` (Service Provider).
- `Employee.payFor(List<TimeEntry>, PayPeriod, WeekendMultiplier)` is the public surface.
- `PayPeriod.filter(List<TimeEntry>)` returns only entries inside the period.
- The original `PayrollService` disappears or becomes a thin Interfacer over a REST endpoint.

**Acceptance criteria.**

- [ ] No domain class reaches across two objects to compute something the first one already knows.
- [ ] `Employee.payFor(...)` is one expression with no branches.
- [ ] Method names read naturally with their receiver: *time entry, payable hours.*
- [ ] Removing weekend logic is a single-file change.
- [ ] A unit test for gross pay needs no service object.

---

## Task 5 — Interfacer that doesn't leak (REST controller + ride dispatch)

**Starting point.**

```java
@RestController
@RequestMapping("/rides")
public class RideController {

    @PostMapping
    public ResponseEntity<?> request(@RequestBody RideRequestDto dto) {
        Rider rider = riderRepo.findById(dto.riderId).orElseThrow();
        if (rider.getRating().compareTo(BigDecimal.valueOf(3.0)) < 0) {
            return ResponseEntity.status(403).body(Map.of("error", "rider rating too low"));
        }
        List<Driver> nearby = driverRepo.findWithinRadius(dto.pickup, 5);
        nearby.sort(Comparator.comparing(Driver::getRating).reversed());
        if (nearby.isEmpty()) return ResponseEntity.status(409).body(Map.of("error", "no drivers"));
        Driver chosen = nearby.get(0);
        chosen.setStatus(DriverStatus.EN_ROUTE);
        driverRepo.save(chosen);
        Ride ride = new Ride(rider, chosen, dto.pickup, dto.dropoff, Instant.now());
        rideRepo.save(ride);
        return ResponseEntity.ok(Map.of("rideId", ride.getId()));
    }
}
```

**Objective.** Make the controller an Interfacer that translates HTTP <-> domain and nothing else. The dispatch decision lives in the domain.

**Constraints.**

- The controller's method body is at most 6 lines and contains *no* business rule.
- A `RideDispatch` (Controller stereotype) decides who gets the ride; it takes a `DriverPool` (Structurer) and a `Rider` and returns either a `Ride` or a typed failure.
- `Rider.isEligible()` lives on `Rider`. `DriverPool.bestNear(GeoPoint pickup)` lives on the pool.
- HTTP status codes are chosen in *one* place — an error mapper. The domain throws typed exceptions, never `ResponseStatusException`.

**Acceptance criteria.**

- [ ] You can swap REST for gRPC and only the Interfacer changes.
- [ ] Searching the controller file for `if` or `compareTo` returns nothing.
- [ ] `RideDispatch` has unit tests that never touch Spring or JSON.
- [ ] The DTO is converted at the controller's edge; no DTO type appears in the domain.
- [ ] A new business rule ("no surge zones") is a one-class change inside the domain.

---

## Task 6 — Misplaced responsibility (ATM withdrawal)

**Starting point.**

```java
public final class Atm {

    public Receipt withdraw(Card card, String pin, Money amount) {
        if (!card.getPin().equals(pin)) throw new AuthFailedException();
        if (amount.greaterThan(new Money(BigDecimal.valueOf(500), "USD"))) {
            throw new LimitExceededException();
        }
        Account acc = card.getAccount();
        if (acc.getBalance().lessThan(amount)) throw new InsufficientFundsException();
        acc.setBalance(acc.getBalance().minus(amount));
        cashTray.dispense(amount);
        ledger.record(new Tx(acc.getId(), amount, Instant.now()));
        return new Receipt(acc.getId(), amount, acc.getBalance());
    }
}
```

**Objective.** Find every responsibility that is in the *wrong* owner and move it. The `Atm` is an Interfacer to the physical world (keypad, cash tray, printer); it must not own balance, PIN, or limit rules.

**Constraints.**

- `Card.authenticate(pin)` lives on the card; the ATM never compares strings.
- `Account.debit(Money)` does its own funds check and throws `InsufficientFundsException` — the ATM does not look at `getBalance()`.
- A `WithdrawalPolicy` (Service Provider) owns per-transaction limits; the ATM consults it.
- `Atm.withdraw(...)` body contains *no* arithmetic and *no* comparisons except `==` on enums/states.
- Mutating `account.setBalance(...)` is forbidden outside `Account`; replace it with `Account.debit(...)`.

**Acceptance criteria.**

- [ ] For every line removed from `Atm` you can name its new home and matching stereotype.
- [ ] Tell-Don't-Ask is visibly enforced: no `getBalance()` call survives outside `Account`.
- [ ] Replacing the keypad with a mobile-NFC reader needs no domain change.
- [ ] All exceptions originate from the class that owns the rule, not from `Atm`.
- [ ] Reading `Atm.withdraw(...)` aloud sounds like dictation: "card authenticate; policy permit; account debit; tray dispense; ledger record."

---

## Task 7 — Refactor toward Tell-Don't-Ask + stereotypes (warehouse picking)

**Starting point.**

```java
public class PickingService {

    public PickList buildPickList(Order order, Warehouse wh) {
        PickList list = new PickList(order.getId());
        for (OrderLine line : order.getLines()) {
            List<Bin> bins = wh.getBins();
            bins.sort(Comparator.comparingInt(Bin::getAisle).thenComparingInt(Bin::getRack));
            int remaining = line.getQuantity();
            for (Bin bin : bins) {
                if (!bin.getSku().equals(line.getSku())) continue;
                int take = Math.min(bin.getOnHand(), remaining);
                bin.setOnHand(bin.getOnHand() - take);
                list.addStep(new PickStep(bin.getLocation(), line.getSku(), take));
                remaining -= take;
                if (remaining == 0) break;
            }
            if (remaining > 0) throw new InsufficientStockException(line.getSku());
        }
        return list;
    }
}
```

**Objective.** Convert ask-style data crawling into tell-style collaboration. The warehouse, the bin, and the order line each do their own job; the service disappears or becomes a thin coordinator.

**Constraints.**

- `Warehouse.binsFor(Sku)` returns bins already sorted by aisle/rack; sorting lives *inside* the warehouse.
- `Bin.reserve(int qty)` decrements its own stock and returns a `PickStep`; throws if it cannot fulfill.
- `OrderLine.fulfilFrom(BinSequence)` walks bins itself and produces a `LinePicks` aggregate.
- A `PickList.assemble(Order, Warehouse)` factory iterates lines and lets each line do its own fulfilment.
- No object outside `Bin` may read or write `onHand`.

**Acceptance criteria.**

- [ ] The original `PickingService` is gone or becomes an Interfacer over the new domain.
- [ ] No getter on `Bin` is called from outside the warehouse package.
- [ ] Sorting strategy can be swapped (snake-walk vs serpentine) by changing one class.
- [ ] `OrderLine.fulfilFrom(...)` has a single loop and *no* getters on bins.
- [ ] Tests for `OrderLine` need only `OrderLine` plus a fake `BinSequence`.

---

## Task 8 (optional) — Design from scratch (smart-home thermostat)

**Starting point.** Requirements only.

```
A smart thermostat must:
- read the current temperature from a wall sensor every minute;
- accept a schedule of target temperatures by time-of-day and day-of-week;
- accept temporary overrides ("hold 72 until 9pm");
- decide each minute whether to heat, cool, or idle;
- enforce a minimum cycle time (no toggling faster than every 5 minutes);
- learn the home's response curve and pre-start;
- publish telemetry to a cloud endpoint and respond to remote setpoint changes.
```

**Objective.** Produce a stereotyped class list, a one-line responsibility per class, and a sketch of the message flow for one minute of operation.

**Constraints.**

- Maximum 8 classes; each with exactly one `@stereotype`.
- A `Schedule` is a Structurer (it relates time slots to setpoints; it is not an Information Holder).
- The pre-start learning lives in a `ResponseCurve` (Information Holder) consulted by a `HeatingDecision` (Controller).
- Telemetry publish and remote-command receive live in two distinct Interfacers, not one "CloudGateway."

**Deliverable.** (a) The class list with stereotypes; (b) a sequence of 5-8 message sends describing one tick; (c) one paragraph explaining why no class is a god and no class is anemic.

**Acceptance criteria.**

- [ ] No class is named `*Manager`, `*Helper`, `*Util`, or `*Service`.
- [ ] Every class can answer "what data do you already hold?" without hand-waving.
- [ ] The minimum-cycle rule lives with whoever knows the last toggle time.
- [ ] The schedule does not know about heating; it knows about *targets at times*.
- [ ] Adding "humidity" is additive — one new Information Holder, one new check in the Controller.

---

## Worked solution sketch — Task 4 (payroll)

Treat this as a target, not a copy-paste.

```java
/** @stereotype InformationHolder */
public final class TimeEntry {
    private final LocalDate date;
    private final LocalTime start;
    private final LocalTime end;

    public Duration duration() { return Duration.between(start, end); }

    public BigDecimal payableHours(WeekendMultiplier mult) {
        BigDecimal raw = BigDecimal.valueOf(duration().toMinutes())
                                   .divide(BigDecimal.valueOf(60), 4, RoundingMode.HALF_UP);
        return mult.applyTo(date, raw);
    }

    boolean inside(PayPeriod p) { return p.contains(date); }
}

/** @stereotype ServiceProvider */
public final class WeekendMultiplier {
    private final BigDecimal factor;
    public WeekendMultiplier(BigDecimal factor) { this.factor = factor; }

    public BigDecimal applyTo(LocalDate date, BigDecimal hours) {
        DayOfWeek d = date.getDayOfWeek();
        boolean weekend = d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY;
        return weekend ? hours.multiply(factor) : hours;
    }
}

/** @stereotype InformationHolder */
public final class PayPeriod {
    private final LocalDate from, to;
    public PayPeriod(LocalDate from, LocalDate to) { this.from = from; this.to = to; }

    public boolean contains(LocalDate d) { return !d.isBefore(from) && !d.isAfter(to); }
    public List<TimeEntry> filter(List<TimeEntry> all) {
        return all.stream().filter(e -> e.inside(this)).toList();
    }
}

/** @stereotype InformationHolder */
public final class Employee {
    private final BigDecimal hourlyRate;
    private final String currency;

    public Money payFor(List<TimeEntry> all, PayPeriod period, WeekendMultiplier mult) {
        return period.filter(all).stream()
                     .map(e -> new Money(e.payableHours(mult).multiply(hourlyRate), currency))
                     .reduce(Money.zero(currency), Money::plus);
    }
}
```

Every class has one stereotype; every method is a sentence whose subject is the receiver; no `PayrollService` is needed anywhere in the domain. A REST endpoint becomes a thin Interfacer whose body is one call to `employee.payFor(...)`.

---

## Checklist for every task

- [ ] Each new class has a `@stereotype` Javadoc tag.
- [ ] Each method's name reads correctly with its receiver as the subject.
- [ ] No business rule lives in a class whose name ends in `Service`, `Manager`, `Helper`, or `Util`.
- [ ] I/O (database, HTTP, email, file) is hidden behind an Interfacer.
- [ ] The decision lives where the data already lives.
- [ ] If a class plays two stereotypes, it has been split.
