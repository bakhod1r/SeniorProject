# Responsibility-Driven Design — Middle

> **What?** At the middle level, RDD stops being a slogan ("ask who is responsible") and becomes a *workflow*: list the responsibilities of a feature, draw a responsibility-to-owner table, sketch the message flow between collaborators, then write the Java that mirrors that table.
> **How?** You will practice four moves repeatedly: (1) name the responsibilities, (2) assign each to an owner with a clear stereotype, (3) refactor god-classes into collaborating stereotypes, (4) check that dependencies flow in the right direction.

---

## 1. The "who knows what" exercise

Pick a feature. List every distinct *thing the system has to do* for it — one sentence each, verbs, no implementation. Then for each responsibility write the owner and its stereotype. This is the table you write *before* any class.

Worked example — **hotel booking confirmation**:

| # | Responsibility                                       | Owner                  | Stereotype          |
| - | ---------------------------------------------------- | ---------------------- | ------------------- |
| 1 | Know the dates, room and guest of a booking          | `Booking`              | Information Holder  |
| 2 | Know whether a room is free for a date range         | `Room`                 | Information Holder  |
| 3 | Calculate the price for a stay                       | `RateCard`             | Service Provider    |
| 4 | Reserve the room and emit a confirmation             | `Booking.confirm(...)` | Controller          |
| 5 | Charge the guest's card                              | `PaymentGateway`       | Interfacer          |
| 6 | Drive the end-to-end confirm-and-charge workflow     | `BookingProcess`       | Coordinator         |
| 7 | Receive the HTTP request                             | `BookingController`    | Interfacer          |

Two checks on the table before you write a single line of Java:

- **No responsibility is shared.** If two owners look right, one is wrong; pick the one that already holds the data.
- **No owner plays two stereotypes.** `Booking` should not also be the Interfacer that talks to the payment gateway.

If the table looks healthy, the code almost writes itself.

---

## 2. Designing collaborations

A responsibility table tells you *who*; a collaboration sketch tells you *who calls whom*. Use simple ASCII message-flow diagrams — they are cheap to draw and easy to revise.

```
BookingController        BookingProcess        Booking         Room          RateCard       PaymentGateway
       |                       |                  |              |               |                  |
       | confirm(req)          |                  |              |               |                  |
       |---------------------->|                  |              |               |                  |
       |                       | reserve(dates)   |              |               |                  |
       |                       |----------------->| free?        |               |                  |
       |                       |                  |------------->|               |                  |
       |                       |                  |<-------------|               |                  |
       |                       |                  | priceFor()   |               |                  |
       |                       |                  |--------------------->|       |                  |
       |                       |                  |<---------------------|       |                  |
       |                       | charge(amount)   |              |               |                  |
       |                       |--------------------------------------------------->|              |
       |                       |<---------------------------------------------------|              |
       |<----------------------|                  |              |               |                  |
       | 200 OK                |                  |              |               |                  |
```

Read the diagram top-to-bottom. Each arrow is a method call; each label names a responsibility from the table. If an arrow goes "backwards" (an Information Holder calling a Coordinator, say) you have a dependency-direction bug — fix it before writing code.

---

## 3. Refactoring a god-class — a worked example

A real god-class from a ride-hailing codebase. Everything happens in one place; nothing knows anything.

```java
// BEFORE — RideService is the brain, everything else is data.
public class RideService {

    public Ride request(Rider rider, Location pickup, Location dropoff) {
        if (rider.getBalance().compareTo(BigDecimal.valueOf(5)) < 0)
            throw new InsufficientFundsException();

        Driver chosen = null;
        double bestDistance = Double.MAX_VALUE;
        for (Driver d : driverRepo.findAllOnline()) {
            double dist = Math.hypot(
                d.getLat() - pickup.lat(), d.getLng() - pickup.lng());
            if (dist < bestDistance && d.getStatus().equals("AVAILABLE")) {
                bestDistance = dist;
                chosen = d;
            }
        }
        if (chosen == null) throw new NoDriverException();

        BigDecimal fare = BigDecimal.valueOf(2)
            .add(BigDecimal.valueOf(0.5).multiply(BigDecimal.valueOf(
                Math.hypot(dropoff.lat() - pickup.lat(),
                           dropoff.lng() - pickup.lng()) * 111)));

        chosen.setStatus("ON_TRIP");
        driverRepo.save(chosen);

        Ride ride = new Ride();
        ride.setRiderId(rider.getId());
        ride.setDriverId(chosen.getId());
        ride.setFare(fare);
        rideRepo.save(ride);

        notifier.sms(rider.getPhone(), "Driver arriving");
        return ride;
    }
}
```

Responsibility table for the same feature:

| Responsibility                  | Owner             | Stereotype          |
| ------------------------------- | ----------------- | ------------------- |
| Know if a rider can afford a ride | `Rider`         | Information Holder  |
| Find the nearest available driver | `DriverPool`    | Structurer          |
| Compute the fare for a trip      | `FareCalculator` | Service Provider    |
| Accept a trip and change status  | `Driver`         | Controller (of self)|
| Persist a ride                   | `RideRepository` | Interfacer          |
| Send the rider a notification    | `RiderNotifier`  | Interfacer          |
| Drive request → match → notify   | `RideRequest`    | Coordinator         |

After the refactor:

```java
// AFTER — each line of the coordinator names one responsibility.
public final class RideRequest {
    private final DriverPool pool;
    private final FareCalculator fares;
    private final RideRepository rides;
    private final RiderNotifier notifier;

    public Ride place(Rider rider, Trip trip) {
        rider.assertCanAfford(MIN_BALANCE);
        Driver driver  = pool.nearestAvailable(trip.pickup());
        Money  fare    = fares.priceOf(trip);
        driver.accept(trip);
        Ride   ride    = rides.save(Ride.of(rider, driver, trip, fare));
        notifier.driverEnRoute(rider, driver);
        return ride;
    }
}
```

The coordinator no longer *does* anything. It *asks*. Every `if`, every loop, every `setStatus` moved to whoever owns the relevant data.

---

## 4. Stereotype-by-stereotype exercises

Use one domain — **warehouse picking** — and write the same three stereotypes in order. Doing them in order makes the dependency direction obvious.

**4a. Information Holder first** — knows facts about itself, no outside knowledge:

```java
public final class Bin {
    private final String code;
    private final Map<Sku, Integer> stock;

    public int quantityOf(Sku sku) { return stock.getOrDefault(sku, 0); }
    public boolean has(Sku sku, int qty) { return quantityOf(sku) >= qty; }

    void remove(Sku sku, int qty) {                       // package-private
        if (!has(sku, qty)) throw new OutOfStockException(code, sku);
        stock.merge(sku, -qty, Integer::sum);
    }
}
```

`Bin` only knows its own contents. It does not search; it does not log; it does not call repositories.

**4b. Service Provider next** — stateless behavior on inputs:

```java
public final class PickRouter {
    public List<Bin> routeFor(PickList list, Warehouse wh) {
        return list.lines().stream()
                .map(line -> wh.binWith(line.sku(), line.quantity()))
                .sorted(Comparator.comparing(Bin::aisle))
                .toList();
    }
}
```

A `PickRouter` holds no state. Given a pick list and a warehouse, it answers a routing question and goes away. It depends on Information Holders, never the other direction.

**4c. Coordinator last** — drives a workflow built from the other two:

```java
public final class PickingSession {
    private final PickRouter router;
    private final Warehouse  warehouse;
    private final Picker     picker;

    public PickReceipt complete(PickList list) {
        List<Bin> route = router.routeFor(list, warehouse);
        for (Bin bin : route) {
            for (PickLine line : list.linesFor(bin)) {
                bin.remove(line.sku(), line.quantity());  // delegates
                picker.scan(line);
            }
        }
        return PickReceipt.of(list, picker);
    }
}
```

`PickingSession` does not know how stock is stored, does not know how routing is computed, does not know how picks are scanned. It composes.

---

## 5. Dependency direction

Stereotypes form a *layering* in the way they may depend on each other. Drawing them top-down makes violations obvious.

```
            Interfacers (HTTP, Kafka, DB, SMS)
                       ↓ called by
                  Controllers
                       ↓ called by
                  Coordinators
                       ↓ called by
              Service Providers / Structurers
                       ↓ called by
                Information Holders
```

Two rules cover almost every concrete violation you will see in code review:

- **Information Holders never import Coordinators.** A `Booking` must not call `BookingProcess`. If it does, business orchestration leaks into a value-like object and tests need wiring instead of a constructor.
- **Controllers never reach into Interfacers.** An HTTP controller calling a JPA repository directly skips the Coordinator and the domain — the domain becomes a passive shape filled in by the framework.

A practical test in Java: a package-graph tool (ArchUnit) can enforce these. Even without it, `import` lines reveal the layering at a glance — Information Holders import only `java.*` and other Information Holders; Coordinators import Service Providers and Information Holders; Controllers import Coordinators.

---

## 6. When to introduce a new collaborator

You enlarge an existing class until it starts to fail one of these tests; then you split.

| Smell on the existing class                          | New collaborator to extract        | Stereotype          |
| ---------------------------------------------------- | ---------------------------------- | ------------------- |
| Two unrelated reasons it changes (price *and* tax)  | `TaxRules`                         | Service Provider    |
| It is starting to talk to the network                | `PaymentGateway`                   | Interfacer          |
| It is starting to schedule things                    | `RetryPolicy`                      | Coordinator (small) |
| Two different stakeholders speak about it differently| Split into two classes (CQRS-ish)  | Information Holder × 2 |
| It holds a collection that has its own rules         | `ClaimsRegistry` (not `List<Claim>`)| Structurer         |

A short heuristic: *a new collaborator earns its place when at least one existing class becomes easier to describe after the split.* "Easier to describe" means a one-sentence purpose with one stereotype.

---

## 7. Refactoring decisions — is this responsibility in the right place?

Four practical tests, in order. If any fails, move the method.

1. **Data test.** Does the owner already have the fields the method reads? If the method reaches into another object via getters and then computes, that other object owns the responsibility.
2. **Change test.** When the business rule changes, does only this class change? If the rule says "drivers under 25 pay 20% more" and changing it touches `Insurance`, `Quote`, `Policy`, and `PremiumService`, the responsibility is scattered.
3. **Stereotype test.** Does the method match the class's stereotype? An Information Holder with a method named `process*` is suspicious; a Coordinator with `getX/setX` is suspicious.
4. **Name test.** Can you name the method as a verb the owner naturally performs? `claim.approve()` reads fine. `claim.runApprovalLogicFor(reviewer, today)` does not — the verb belongs elsewhere.

Worked example — **insurance claim approval**:

```java
// Before — decision lives in a service, claim is data.
class ApprovalService {
    boolean canApprove(Claim c, Reviewer r) {
        return c.getAmount().compareTo(r.getLimit()) <= 0
            && !c.getStatus().equals("REJECTED")
            && c.getDocs().size() >= 2;
    }
}

// After — Claim owns its own approvability; Reviewer owns its own limit.
public final class Claim {
    public boolean isApprovableBy(Reviewer reviewer) {
        return !rejected() && documented() && reviewer.canAuthorize(amount);
    }
}
```

The four tests now pass: the claim has the data, only the claim changes when the rule changes, the method fits an Information Holder/Controller, and `claim.isApprovableBy(reviewer)` reads as natural English.

---

## 8. Common mistakes

**God Coordinator.** A coordinator that drifts back into doing the work itself:

```java
class PayrollRun {
    void run(Month m) {
        for (Employee e : employeeRepo.findAll()) {
            BigDecimal gross = e.getHours().multiply(e.getRate());
            BigDecimal tax   = gross.multiply(new BigDecimal("0.18"));
            BigDecimal net   = gross.subtract(tax);
            bank.transfer(e.getIban(), net);
        }
    }
}
```

The tax rule and the gross rule belong to `Employee` (or to a `TaxRules` Service Provider). The coordinator should read `employee.payslipFor(month)` and pass the result to the bank.

**Anemic Information Holder.** A class with thirty fields, thirty getters, thirty setters, and no behavior:

```java
public class Employee {
    private Money rate; private Hours hours; private Iban iban;
    public Money getRate() { return rate; }
    public Hours getHours() { return hours; }
    // ... and so on
}
```

If nothing in `Employee` answers a question other code wants to ask, you have a data class. Add the methods that produce the answers — `grossFor(month)`, `payslipFor(month)` — and the surrounding services shrink.

**Service called from an entity.** An entity (Information Holder) that imports a Spring service:

```java
class Booking {
    @Autowired EmailService email;            // wrong direction
    public void confirm() { email.send(...); }
}
```

The entity is now untestable without a container and unmovable to another framework. The email send belongs to a Coordinator above the entity.

**Stereotype mixing by name only.** A class called `ClaimManager` whose methods are half "knows facts about claims" and half "drives the approval workflow". Rename one of them out — `ClaimsRegistry` *and* `ClaimApproval` — and the responsibilities line up.

---

## 9. Quick rules

- [ ] Before coding a feature, write the responsibility-to-owner table.
- [ ] Sketch the message flow; reject arrows that go against the stereotype layering.
- [ ] Write Information Holders first, then Service Providers, then Coordinators.
- [ ] If a Coordinator has business arithmetic in it, push the arithmetic down.
- [ ] If an Information Holder imports a framework, push the framework call up.
- [ ] A new collaborator earns its place by *shrinking* an existing one.

---

## 10. What's next

| Topic                                                                       | File              |
| --------------------------------------------------------------------------- | ----------------- |
| RDD with frameworks, ORMs, hexagonal layering, and real architecture        | `senior.md`       |
| Driving RDD across a team and a codebase; reviews, ArchUnit, conventions    | `professional.md` |
| Hands-on RDD refactoring katas                                              | `tasks.md`        |
| Interview Q&A on RDD vs anemic/service-oriented designs                     | `interview.md`    |

---

**Memorize this:** the workflow is *table → diagram → code*. List the responsibilities, give each a stereotyped owner, draw the message flow, then write the Java — and the dependencies will already point the right way.
