# Domain Modeling from Requirements — Middle

> **What?** Beyond walking through one scenario at a time, mature domain modeling means *facilitating* discovery with a group, drawing **boundaries** between sub-domains, and choosing the right granularity for aggregates. The techniques on this page — Event Storming, bounded-context maps, anti-corruption layers — are the everyday tools of teams that ship non-trivial business software.
> **How?** Run a workshop with sticky notes (or a virtual board). Surface every domain event in time order. Group events into aggregates. Draw lines where the language changes. Translate at the seams. Then write code that mirrors what's on the wall.

---

## 1. Event Storming basics — the four colors that matter

**Event Storming** (Alberto Brandolini, 2013) is a workshop format that puts domain experts and engineers in front of a long wall and asks: *"What happens in this business, in time order?"* The output is a colored sticky-note timeline that doubles as the seed of your object model.

The four sticky colors you'll use 90% of the time:

| Color  | Concept                  | Phrasing                  | Example                       |
| ------ | ------------------------ | ------------------------- | ----------------------------- |
| Orange | **Domain Event**         | past-tense verb           | `PaymentReceived`             |
| Blue   | **Command**              | imperative verb           | `ApprovePayment`              |
| Yellow | **Aggregate**            | noun owning a rule        | `Loan`, `Shipment`            |
| Pink   | **Read Model / Policy**  | "view" or "when X then Y" | `OverdueLoansReport`          |

A worked board for **mortgage origination** (applicants submit applications, underwriters approve or reject them, approved loans get funded, funded loans enter servicing):

```
[ApplicationSubmitted] -> (Application) -> [DocumentsRequested]
        |                                          |
        v                                          v
[CreditReportPulled] -> (CreditFile) -> [RiskScoreAssigned]
        |
        v
[UnderwritingApproved] -> (Loan) -> [LoanFunded] -> [ServicingStarted]
   command:   ApproveUnderwriting
   policy:    WhenAllDocsPresent -> AutoApproveIfScoreAbove720
   readmodel: ApprovalQueueView
```

Each yellow note (`Application`, `CreditFile`, `Loan`) is a candidate aggregate. Each orange note is something the business already names without prompting — *that* is the test of a good event.

---

## 2. Bounded contexts — drawing the lines

A **bounded context** is a region where one model and one vocabulary apply consistently. Cross the line and "Customer" might mean a different thing.

**How to spot a boundary on the storm wall:**

1. **Vocabulary shift.** Underwriters say "applicant", servicing says "borrower". Two words → likely two contexts.
2. **Rule shift.** Pre-funding, the loan can be cancelled freely. Post-funding, cancellation is a regulated process — context boundary.
3. **Owner / pace shift.** Different team owns the screens; one side iterates weekly, the other quarterly to a regulator.

**Naming.** Use the language of the team, not the technology: `Origination`, `Servicing`, `Collections` — not `loan-service-1`.

**Context maps** describe how two contexts relate:

| Pattern                | When                                       | Example                                         |
| ---------------------- | ------------------------------------------ | ----------------------------------------------- |
| Shared Kernel          | Two teams co-own a small model             | `Money`, `BorrowerId` shared across teams       |
| Customer / Supplier    | Upstream serves downstream's needs         | Origination publishes `LoanFunded` to Servicing |
| Conformist             | Downstream accepts upstream's model as-is  | Reporting consumes raw billing events           |
| Anti-Corruption Layer  | Downstream translates to protect its model | New CRM wraps the legacy mainframe              |
| Open Host / Published  | One upstream serves many downstreams       | Pricing publishes a versioned JSON event schema |
| Separate Ways          | No useful integration                      | HR system and shipping system                   |

Drawing the map is half the architecture work. The other half is enforcing it in code — each context its own module with its own types and no cross-imports of internals.

---

## 3. From events to aggregates — grouping the stickies

An **aggregate** is a cluster of objects treated as one unit for the purpose of state changes and consistency. On the storm wall, an aggregate is the set of events that *must agree* with each other.

Heuristics for grouping:

- **Atomic together?** `OrderLineAdded` and `OrderTotalRecomputed` belong to the same aggregate (`Order`). `OrderShipped` and `PackageHandedToCarrier` may not — the carrier is external.
- **Share an invariant?** A telco postpaid plan's `CallRecorded`, `SmsRecorded`, `DataUsageRecorded` all feed `MonthlyBillIssued` under "sum of usage equals bill" — one `BillingCycle` aggregate.
- **Share an actor?** Events emitted by the same user action against the same root usually share an aggregate.

Worked example — **telco billing**:

```java
public final class BillingCycle {
    private final SubscriberId subscriber;
    private final YearMonth period;
    private final List<UsageEvent> usage = new ArrayList<>();
    private boolean issued = false;

    public void record(UsageEvent e) {
        if (issued) throw new BillingCycleClosedException();
        if (!e.period().equals(period)) throw new WrongPeriodException();
        usage.add(e);
    }

    public Bill issue(TariffPlan plan, Clock clock) {
        if (issued) throw new BillAlreadyIssuedException();
        Money total = usage.stream().map(plan::price).reduce(Money.ZERO, Money::plus);
        issued = true;
        return new Bill(subscriber, period, total, clock.instant());
    }
}
```

`BillingCycle` is one aggregate. `Bill` is *another* aggregate that begins life when the cycle closes — different invariants (immutable once issued, pays down to zero, may travel to collections). Crossing the boundary is done by event, not direct method call.

---

## 4. Value Object vs Entity — surfacing the distinction

The model itself tells you which is which. The question to ask is: **"Does this thing have an identity that outlives its attributes?"**

| Question                                       | Entity                  | Value Object                          |
| ---------------------------------------------- | ----------------------- | ------------------------------------- |
| Can two of them with same fields be different? | Yes (same name, two patients) | No (two `Money(100, USD)` are equal) |
| Does it have a lifecycle (created, deleted)?   | Yes                     | No (replaced, never mutated)          |
| Do we track it by ID?                          | Yes                     | No                                    |
| Do we mutate it?                               | Sometimes               | Never                                 |

A **healthcare appointment** model:

```java
// Value object: identity comes from attributes.
public record AppointmentSlot(LocalDate date, LocalTime start, Duration length) {
    public AppointmentSlot {
        if (length.isNegative() || length.isZero())
            throw new IllegalArgumentException("length must be positive");
    }
    public LocalTime end() { return start.plus(length); }
    public boolean overlaps(AppointmentSlot other) {
        return date.equals(other.date)
            && start.isBefore(other.end())
            && other.start.isBefore(end());
    }
}

// Entity: same patient over time is still the same patient. equals/hashCode by id.
public final class Patient {
    private final PatientId id;
    private PersonName name;
    private InsurancePlan insurance;
}

// Entity: each appointment is unique; cancelling and rebooking creates a new one.
public final class Appointment {
    private final AppointmentId id;
    private final Patient patient;
    private final AppointmentSlot slot;
    private final ClinicianId clinician;
    private AppointmentStatus status;
}
```

If you find yourself giving an ID to something whose equality should depend on its fields (e.g. `Money`, `Address`, `DateRange`), it's a value object pretending to be an entity. Strip the ID. Make it a `record`. Make it immutable. Your invariants will get simpler immediately.

---

## 5. Anti-corruption layers — when one context's model differs from another's

When two contexts must talk and their models disagree, the wrong move is to copy the upstream model into the downstream. That couples downstream to every upstream change. The right move is an **anti-corruption layer (ACL)**: a translation boundary that imports the *meaning*, not the *shape*.

Example — **logistics shipping** integrating with a legacy WMS (warehouse management system):

```java
// The legacy WMS speaks in cryptic codes and shared mutable rows.
public final class LegacyWmsDto {
    public String pickTicketNo;        // "PT-2026-0451"
    public String stCd;                // "A" allocated, "P" picked, "S" shipped
    public BigDecimal wtKg;
    // 40 more fields
}

// Our shipping context has a clean model:
public sealed interface ShipmentState
        permits Allocated, Picked, Shipped, Cancelled {}

// The ACL is the only place that knows both languages:
public final class WmsAntiCorruptionLayer {
    public Shipment fromLegacy(LegacyWmsDto dto) {
        ShipmentState state = switch (dto.stCd) {
            case "A" -> new Allocated();
            case "P" -> new Picked();
            case "S" -> new Shipped();
            default  -> throw new UnknownLegacyStateException(dto.stCd);
        };
        return new Shipment(
            new ShipmentId(dto.pickTicketNo),
            state,
            Weight.ofKilograms(dto.wtKg)
        );
    }
}
```

Nothing inside the shipping domain knows what `stCd` is. If the legacy WMS adds a new state code, only the ACL changes. The domain model stays pristine.

ACLs are also valuable *within* one company — between two of your own bounded contexts whose teams move at different speeds.

---

## 6. Worked example — modeling a logistics shipping flow

**Requirement (one paragraph):** *"A merchant requests a shipment by providing pickup and destination addresses, weight, and required delivery date. The system finds an eligible carrier based on weight, route, and SLA. If a carrier accepts, a tracking number is issued. The shipment is then picked up, scanned through hubs, and delivered. If the recipient is absent on the first attempt, two more attempts are made before returning to sender."*

**Storm the events (orange):** `ShipmentRequested -> CarrierSelected -> CarrierAccepted -> TrackingNumberIssued -> PickedUp -> HubScanned* -> DeliveryAttempted -> [Delivered | DeliveryFailed -> Returned]`.

**Commands (blue):** `RequestShipment`, `OfferToCarrier`, `RecordHubScan`, `AttemptDelivery`.

**Aggregates (yellow):** `Shipment` (owns lifecycle from request to delivery/return); `CarrierOffer` (owns negotiation only); `Route` is a value object, not an aggregate.

**Read models (pink):** `TrackingView`, `FailedDeliveriesQueue`.

**The code:**

```java
public final class Shipment {
    private final ShipmentId id;
    private final Address pickup, destination;
    private final Weight weight;
    private final LocalDate requiredBy;
    private ShipmentState state = new Requested();
    private TrackingNumber tracking;
    private int deliveryAttempts = 0;
    private static final int MAX_ATTEMPTS = 3;

    public void assignCarrier(Carrier c, TrackingNumber t) {
        if (!(state instanceof Requested)) throw illegal("assignCarrier");
        this.tracking = t;
        this.state = new InTransit(c);
    }

    public DeliveryOutcome attemptDelivery(Clock clock) {
        if (!(state instanceof InTransit)) throw illegal("attemptDelivery");
        deliveryAttempts++;
        if (deliveryAttempts >= MAX_ATTEMPTS) {
            state = new ReturnedToSender(clock.instant());
            return DeliveryOutcome.RETURNED;
        }
        return DeliveryOutcome.PENDING;
    }

    public void markDelivered(Recipient who, Clock clock) {
        if (!(state instanceof InTransit)) throw illegal("markDelivered");
        state = new Delivered(who, clock.instant());
    }

    private IllegalShipmentTransitionException illegal(String op) {
        return new IllegalShipmentTransitionException(state, op);
    }
}
```

The lifecycle is encoded as a sealed `ShipmentState` hierarchy. The aggregate enforces "no more than three attempts". Carrier selection lives outside as a *domain service* — no single shipment owns matching across the carrier pool.

---

## 7. Iterating the model — signs you got it wrong

First models are always wrong. The skill is reading the signals that say *which* part is wrong.

| Signal                                                       | Likely cause                                 | Fix                                       |
| ------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------- |
| Aggregate has 30+ methods and grows every sprint             | Boundary too wide                            | Split into two aggregates by lifecycle    |
| Two aggregates always change together in one transaction     | Boundary too narrow                          | Merge, or introduce a coordinating event  |
| Domain expert keeps "correcting" your vocabulary             | Wrong ubiquitous language                    | Rename classes to match the expert        |
| You add fields to satisfy a query, not a rule                | Read-model concerns leaking into write model | Introduce a separate read model           |
| New requirement touches five aggregates                      | Missing event/policy that should orchestrate | Add a domain event + policy reaction      |
| Tests construct deep object graphs to test one rule          | Rule lives in the wrong place                | Move the rule next to the data it checks  |

Cadence: storm once, code for a week, re-storm with what you learned. The model that ships in month six rarely resembles day-one's sketch — that's healthy.

---

## 8. Common middle-level mistakes

**Skipping the event phase.** Going straight to nouns gives a passive data model. List events first; aggregates emerge from them.

**Anemic aggregates.** An aggregate with public getters/setters that lets a service apply rules has thrown away its job — it exists to *defend* invariants.

```java
// Anemic:
public class Loan { public BigDecimal balance; public Status status; }
public class LoanService { public void disburse(Loan l) { l.status = Status.FUNDED; } }

// Behavior-rich:
public final class Loan {
    public DisbursementReceipt disburse(DisbursementInstruction instr, Clock clock) {
        if (state != APPROVED) throw new LoanNotApprovedException();
        if (instr.amount().isGreaterThan(approvedAmount))
            throw new DisbursementExceedsApprovalException();
        this.state = FUNDED;
        this.fundedAt = clock.instant();
        return new DisbursementReceipt(id, instr.amount(), fundedAt);
    }
}
```

**Premature normalization.** Splitting `Address` into `Street`/`City`/`Zip` *because the database wants it* leaks DB shape into the model. Keep `Address` as one value object; let persistence split it if it must.

**Forcing one model on two contexts.** Sales-`Customer` and Shipping-`Customer` are two classes that share an ID. Merging them creates the god class that drove you to DDD in the first place.

**Modeling the UI flow.** "The user clicks Next" is not a domain event. `LoanApplicationSubmitted` is. Strip wizard mechanics before storming.

**Forgetting time.** Almost every domain has time-dependent rules (cutoffs, SLAs, retention). Inject a `Clock`; never call `Instant.now()` from inside an aggregate.

---

## 9. Quick rules

- [ ] Storm the events before you write any class.
- [ ] One model per bounded context; name the contexts in the team's language.
- [ ] Group events into aggregates by *shared invariant*, not by *shared table*.
- [ ] If two aggregates always commit together, they're one aggregate.
- [ ] Translate across contexts with an anti-corruption layer; never import a foreign model raw.
- [ ] Value objects are equal by value, immutable, and need no ID.
- [ ] Inject `Clock` for any rule that touches time.
- [ ] Re-storm when the requirements grow; the first model is always provisional.

---

## 10. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Legacy schemas, microservice boundaries, strategic DDD trade-offs  | `senior.md`       |
| Facilitating modeling workshops with non-technical stakeholders    | `professional.md` |
| Hands-on exercises: storm a domain, derive aggregates              | `tasks.md`        |
| Interview Q&A on bounded contexts and aggregates                   | `interview.md`    |

---

**Memorize this:** storm the events, draw the contexts, group by invariant, translate at the seams. Aggregates exist to defend rules — if yours only stores fields, the boundary is wrong.
