# CRC Cards — Middle

> Junior level showed you the card layout and one full walk-through. This level is about what happens on the *second*, *third*, and *fifth* pass through the cards — when scenarios collide, responsibilities migrate, and the pile of paper finally turns into Java packages.

---

## 1. Multi-scenario walk-throughs — how a card set evolves

A single scenario is a sanity check. Real design pressure comes from running several scenarios over the *same* cards and watching what breaks. Take a hotel reservation system. Initial cards:

```
Class: Reservation
  Responsibilities                         Collaborators
  - know guest, dates, room type           Guest, RoomType
  - know its status                        (self)
  - compute its price                      RateTable

Class: Room
  Responsibilities                         Collaborators
  - know its number and type
  - know if occupied on a date             Reservation

Class: FrontDesk
  Responsibilities                         Collaborators
  - take a booking request                 Reservation, Room
  - check in a guest                       Reservation, Room
  - check out a guest                      Reservation, Invoice
```

**Walk-through A (happy path: guest books, arrives, leaves):** `FrontDesk` builds a `Reservation`, asks `Room` if it's free for those dates, marks it taken. No surprises.

**Walk-through B (no rooms of requested type):** `FrontDesk` asks `Room`... but `Room` only knows about itself. Who searches across all rooms? A new card surfaces: `RoomInventory`, responsibility "find a free room of type T between dates D1–D2".

**Walk-through C (guest changes dates after booking):** Nobody on the cards owns "modify a reservation". `Reservation` says "I know my dates" but not "I can move them — and I have to re-check room availability". Add responsibility, and notice it pulls in `RoomInventory` as a new collaborator on `Reservation`'s card.

**Walk-through D (guest no-shows; room is held then released at midnight):** No card owns a *time-based* event. This is the hint that a `ReservationPolicy` or a scheduled job belongs in the design — and that `Reservation` should expose a `release()` responsibility.

After four scenarios, the original three cards have become six, two responsibilities migrated, and one new collaboration is visible everywhere. That is the *point* of CRC: a scenario is a test case for the model.

---

## 2. From cards to Java — responsibilities to signatures

The translation rule: **one responsibility ≈ one public method**, and **one collaborator ≈ one constructor parameter or method argument**. Take the stabilized `Reservation` card:

```
Class: Reservation
  - know guest, dates, room type           Guest, RoomType
  - know its status                        (self)
  - compute its price                      RateTable
  - change dates                           RoomInventory
  - release itself                         (self)
```

Translated literally:

```java
package com.example.hotel.reservation;

public final class Reservation {
    private final ReservationId id;
    private final Guest guest;
    private DateRange stay;
    private final RoomType type;
    private Status status;

    public Money priceUsing(RateTable rates) { ... }
    public void changeDates(DateRange newStay, RoomInventory inventory) { ... }
    public void release() { ... }
    public Status status() { return status; }
}
```

Two things to notice. First, `RateTable` and `RoomInventory` are passed *in* as arguments — they're collaborators, not fields. That keeps `Reservation` free of long-lived dependencies on services. Second, the package boundary mirrors a *cluster* of cards: everything that collaborates intensely on the reservation lifecycle lives in `com.example.hotel.reservation`, while `Room` and `RoomInventory` live in `com.example.hotel.room`. Cards that frequently touch each other should land in the same package; cards that only meet at scenario boundaries should not.

---

## 3. Identifying god cards and splitting them mid-session

A card is going god-shaped when any of these happen during a walk-through:

| Smell                            | What you observe at the table              | Fix                                  |
| -------------------------------- | ------------------------------------------ | ------------------------------------ |
| Card overflows the index card    | You're squeezing 9+ responsibilities       | Split by stereotype                  |
| You keep grabbing the same card  | It's involved in every scenario step       | It's a Controller doing Information Holder work too |
| Responsibilities use "and"       | "validate **and** persist **and** notify"  | One responsibility per line, then split |
| Collaborator column is huge      | 7+ collaborators                           | Card is a hub — extract a Coordinator|

Example from a ride dispatch domain. Mid-session, `Dispatcher` has accumulated:

```
Class: Dispatcher
  - find nearby drivers
  - rank drivers by ETA
  - offer trip to top driver
  - handle driver decline
  - track driver location updates
  - bill the trip on completion
  - retry on dropped network
  - log every state change
```

That's three jobs. Split *during* the session:

```
Class: DriverFinder        Class: TripOffer          Class: TripBilling
  - find nearby drivers      - offer trip              - bill on completion
  - rank by ETA              - handle decline          - issue receipt
                             - timeout & retry
```

The original `Dispatcher` keeps only the *flow* responsibility: "coordinate offer → assignment → billing". Three small cards, one thin coordinator — and the team can argue about each cluster independently from now on.

---

## 4. Card vocabulary — know, decide, compute, delegate

Not all responsibilities are equal. Tagging each one mentally with a verb category sharpens the design:

| Verb tag     | Meaning                                  | Example                                       |
| ------------ | ---------------------------------------- | --------------------------------------------- |
| **know**     | The class holds or can retrieve a fact   | "know its check-in date"                      |
| **decide**   | The class makes a policy choice          | "decide whether to upgrade the room"          |
| **compute**  | The class derives a value from its state | "compute the total stay cost"                 |
| **delegate** | The class hands work off to a collaborator | "delegate payment capture to PaymentGateway" |

If a card has all **know** responsibilities, it is an *Information Holder* — usually a domain entity or value. If it has many **decide** responsibilities, it is a *Decider/Policy* and probably wants to be a small dedicated class. If it has many **delegate** responsibilities, it is a *Coordinator* and should stay thin. Mixing all four on one card is the most common reason for god classes — separate the deciders from the holders early.

---

## 5. When two collaborators are too tightly coupled

Sometimes a walk-through reveals that two cards always travel together: card A's responsibilities all involve calling B, and B's responsibilities all involve being called by A. The cards are telling you the boundary is wrong.

Symptoms on paper:

- Every responsibility on `Loan` references `LoanLedger`, and vice versa.
- The collaborator columns mirror each other 1:1.
- In every scenario you pick up both cards at the same time.

Three possible fixes:

1. **Merge** — if the responsibilities are genuinely one concept, fuse the cards.
2. **Promote one to a part of the other** — `LineItem` is conceptually *inside* `Order`; it doesn't need to be a peer card.
3. **Introduce a third card** — sometimes the duplication signals a missing concept (e.g., `Assignment` between `Driver` and `Trip`). Adding the third card breaks the symmetry.

The CRC table beats class diagrams here: coupling is *visible as physical proximity* of the two cards every time you replay a scenario.

---

## 6. Sequence walk-through patterns (ASCII)

Three recurring patterns surface during walk-throughs. Recognizing them helps you sketch the cards correctly the first time.

**Pattern A — caller → mediator → owner.** A request enters through a controller-style object, gets routed by a coordinator, and ends at the entity that owns the state.

```
  Customer        FrontDesk         RoomInventory       Room
     |   book(req)   |                   |               |
     |-------------->|                   |               |
     |               |   find(type,dates)|               |
     |               |------------------>|               |
     |               |                   |  free?(dates) |
     |               |                   |-------------->|
     |               |                   |<--------------|
     |               |<------------------|               |
     |   confirmation|                   |               |
     |<--------------|                   |               |
```

**Pattern B — owner answers, coordinator decides.** The entity exposes facts; the policy makes the decision. Keeps the entity free of business rules that change often.

```
  ClaimsAgent     ClaimPolicy        Claim
     |  approve?     |                  |
     |-------------->|   amount()       |
     |               |----------------->|
     |               |<-----------------|
     |               |   coverage()     |
     |               |----------------->|
     |               |<-----------------|
     |   yes/no      |                  |
     |<--------------|                  |
```

**Pattern C — fan-out from a coordinator.** The coordinator pulls from many owners, but they don't talk to each other.

```
  Dispatcher  --> DriverFinder
              --> TripOffer
              --> TripBilling
```

Drawing the ASCII diagram while walking through is enough to flag where a card is doing too much (Pattern A's mediator getting fat) or where a missing card would help (Pattern B's policy emerging).

---

## 7. Worked example — insurance claim filing

Requirements: a policyholder files a claim with photos and a description. The system validates the policy is active, opens a `Claim`, assigns an adjuster, and notifies the policyholder.

**First-pass cards:**

```
Class: ClaimIntake
  - take a filing request                  Policy, Claim, Adjuster
  - validate policy is active              Policy
  - open a claim                           Claim
  - assign an adjuster                     AdjusterRoster
  - notify the policyholder                Notifier

Class: Policy
  - know its holder, coverage, status      (self)
  - know if active on a date               (self)

Class: Claim
  - know its number, policy, incident      Policy
  - hold attached evidence                 Evidence
  - know its current status                (self)

Class: AdjusterRoster
  - pick the next available adjuster       Adjuster

Class: Adjuster
  - know own name and workload             (self)
  - accept an assignment                   Claim
```

**Walk-through (happy path):** `ClaimIntake` asks `Policy` "are you active?". Yes. It creates a `Claim`, attaches evidence, asks `AdjusterRoster` for an adjuster, the chosen `Adjuster` accepts. `Notifier` sends a message. Clean.

**Walk-through (lapsed policy):** `Policy` says "no, lapsed". `ClaimIntake` should *not* create a `Claim`. A new responsibility surfaces: "reject the filing with a reason". Add to `ClaimIntake`.

Now translate:

```java
package com.example.claims.intake;

public final class ClaimIntake {
    private final Policies policies;
    private final Claims claims;
    private final AdjusterRoster roster;
    private final Notifier notifier;

    public ClaimIntake(Policies policies, Claims claims,
                       AdjusterRoster roster, Notifier notifier) {
        this.policies = policies;
        this.claims = claims;
        this.roster = roster;
        this.notifier = notifier;
    }

    public FilingResult file(FilingRequest req) {
        Policy policy = policies.byId(req.policyId());
        if (!policy.isActiveOn(req.incidentDate())) {
            return FilingResult.rejected("policy not active on incident date");
        }
        Claim claim = Claim.open(policy, req.incident(), req.evidence());
        Adjuster adjuster = roster.assignNext(claim);
        claims.save(claim);
        notifier.notifyFiled(claim, policy.holder());
        return FilingResult.accepted(claim.number());
    }
}
```

Each call inside `file` traces back to a card responsibility: `policies.byId` and `isActiveOn` to `Policy`'s "know if active", `Claim.open` to `Claim`'s "open a claim", `roster.assignNext` to `AdjusterRoster`'s "pick the next available adjuster", `notifier.notifyFiled` to `ClaimIntake`'s "notify the policyholder". No code without a card behind it.

---

## 8. Pitfalls

**Cards that mirror the database.** If your cards look like `ClaimRow`, `PolicyRow`, `AdjusterRow` with responsibilities like "know id", "know foreign key", you've written a schema, not a model. Tear them up and restart from *behavior*: what does a Claim *do*, not what columns it has.

**Vague verbs.** "Handle the claim", "manage the policy", "process the request" are placeholders. Replace with the actual behavior — "decide if the policy covers this incident type", "raise the deductible on a second claim within 12 months". If you can't be specific, you don't yet understand the domain.

**Missing scenarios.** Cards that look great after the happy path collapse on the third edge case. Always run at least: happy path, validation failure, external system unavailable, concurrent modification, and an end-of-lifecycle (cancel / close / archive) scenario.

**Translating too early.** Picking up the IDE before the cards stop changing locks the model in prematurely. The temptation is strongest after the first successful walk-through — resist for one more scenario.

**One card per database table.** Same pitfall as the first, but worth saying twice because the urge is strong when the team already knows the schema. Cards are about responsibility, not storage. A single table may produce two cards (`Cart` vs `Order`); two tables may produce one card (an aggregate spanning them).

**Skipping the role-play.** Reading the card silently isn't a walk-through. Saying "I'm the ClaimIntake — I'm going to ask Policy..." out loud is what surfaces the missing collaborator.

---

## 9. Quick rules

- [ ] Run at least three scenarios per card set: happy, validation failure, edge case.
- [ ] Tag each responsibility mentally as **know / decide / compute / delegate**.
- [ ] If two cards always travel together, merge them, nest them, or introduce a third.
- [ ] One responsibility ≈ one public method. One collaborator ≈ one argument or parameter.
- [ ] Split god cards the moment they overflow — do not "fix it later".
- [ ] Cards in the same package collaborate intensely; cards in different packages meet at scenario boundaries.
- [ ] Never translate to Java until the cards stop changing across two consecutive walk-throughs.

---

## 10. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Limits of CRC; comparison with Event Storming, Domain Storytelling | `senior.md`       |
| Facilitating CRC sessions across teams; remote tooling; templates  | `professional.md` |
| Hands-on CRC card exercises                                        | `tasks.md`        |
| Interview Q&A                                                      | `interview.md`    |

---

**Memorize this:** Run multiple scenarios before writing Java; the cards aren't done until they stop changing. One responsibility per method, one collaborator per parameter, and split god cards the second they overflow.
