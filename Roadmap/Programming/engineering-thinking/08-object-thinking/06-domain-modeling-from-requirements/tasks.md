# Domain Modeling from Requirements — Tasks

> Each task gives you a paragraph of requirements written the way a product manager or a domain expert might phrase them. Your job is to read carefully, list the events and decisions, identify the aggregates that own those decisions, and produce a small Java sketch. Use Tell-Don't-Ask everywhere — no setters, no anaemic data bags, no service classes that do all the thinking. Value objects beat raw `String` and `int`. Domain-specific exceptions beat `IllegalStateException`. Time enters via `Clock`.
>
> Spend at least ten minutes per task with paper or a whiteboard before touching the editor. The first draft of the model is almost always wrong; you only see what you missed once you try to encode a rule. Talk back to the requirements — write down every ambiguous sentence as a question you would ask the expert.

---

## Task 1 — Bike-share rental flow

**Requirements.** *"A city bike-share lets registered riders unlock a bike from any docking station using a phone app. To unlock a bike a rider must have a positive account balance and no active rental. The first 30 minutes of every ride are free; after that, each additional 15-minute block costs 1.50 EUR, capped at 24 EUR per day. A ride ends when the rider docks the bike at any station with a free slot. If the rider tries to dock at a full station the app suggests the nearest station with capacity and grants a 5-minute grace window so the meter does not keep ticking while they reach it. Bikes left undocked for more than 24 hours are flagged as lost and the rider is charged a replacement fee of 600 EUR."*

**Objective.** Identify the events, the decisions, and the aggregates. Produce a Java sketch with `Rider`, `Bike`, `Station`, and `Rental` (you may discover more). Show how the unlock and the dock operations enforce their rules.

**Constraints.**
- No setters anywhere. State changes happen through verbs.
- Tell-Don't-Ask: the rider does not query the bike's lock status to decide; the bike refuses if it cannot be unlocked.
- Money is a value object, not a `double`. Time is injected via `Clock`.
- Failure cases raise named exceptions (`InsufficientBalanceException`, `StationFullException`, etc.).

**Acceptance checklist.**
- [ ] At least six distinct domain events listed before any code.
- [ ] A decision-to-owner table mapping each rule to one aggregate.
- [ ] `Bike.unlock(Rider, Clock)` returns or attaches a `Rental`; it does not return `void` while leaving state scattered.
- [ ] Pricing logic lives on `Rental` (it knows its own start time), not on a `PricingService`.
- [ ] Lost-bike rule expressed as a method that takes the current `Clock` and decides, rather than as a cron query against fields.
- [ ] No `String status` field on `Rental`; the lifecycle is encoded with explicit types or an enum the rest of the code cannot bypass.

---

## Task 2 — Restaurant table reservation with no-shows

**Requirements.** *"A restaurant accepts reservations for fixed two-hour seatings at 18:00, 20:00, and 22:00 from Tuesday through Sunday. Each reservation is for a specific party size and must fit a table — tables cannot be combined. Guests may cancel up to four hours before the seating without penalty; cancelling later or not showing up at all counts as a no-show. Three no-shows in a rolling twelve-month window block the guest from making further reservations until a manager clears the record. The restaurant overbooks by 10% on Friday and Saturday nights to compensate for the average no-show rate. If every overbooked party shows up, the host offers the late-comers a 30 EUR voucher and seats them at the next available slot."*

**Objective.** Identify the events, the decisions, and the aggregates around `Guest`, `Reservation`, `Table`, and `Seating`. Decide where the no-show counter lives and how overbooking is represented.

**Constraints.**
- The "three no-shows" rule is policy, not data — encode it as a method on `Guest`, not as `if (guest.getNoShows() >= 3)` scattered around.
- A `Seating` aggregate knows its own capacity and overbooking allowance.
- Use `Clock` for the four-hour cutoff; never compare `LocalDateTime.now()` inline.
- A blocked guest cannot reserve, full stop. The reservation factory refuses; it does not return `Optional`.

**Acceptance checklist.**
- [ ] At least five events identified (`ReservationRequested`, `ReservationConfirmed`, `ReservationCancelled`, `GuestNoShowed`, `GuestBlocked`, ...).
- [ ] A `NoShowPolicy` or equivalent collaborator with a single intention-revealing method.
- [ ] No method on `Reservation` named `setStatus`. Cancel and confirm are verbs.
- [ ] `Seating.book(party)` enforces both fit and overbooking; `Table` is a child of `Seating` not a peer.
- [ ] Voucher issuing is modelled as a domain event, not as a side-effect buried in a host service.
- [ ] At least one ambiguity in the requirements (e.g. "is a same-day cancellation a no-show?") flagged as a question for the expert.

---

## Task 3 — Subscription-box delivery with skip/resume

**Requirements.** *"A snack subscription service ships a curated box on the first Monday of every month. Subscribers can skip any upcoming month up to seven days before the cut-off, after which the order is locked and the warehouse pulls stock. Skipping shifts the next billing by one month but does not refund anything that has already been charged. Subscribers can also pause indefinitely; while paused, no charges occur and no boxes ship. Resuming returns the subscriber to the regular monthly rhythm starting from the next available cut-off. After three consecutive skips the system sends a 'we miss you' email but does not cancel the subscription. Cancellation requires the subscriber to explicitly opt out and refunds any unshipped month."*

**Objective.** Identify the events, the decisions, and the aggregates. Produce a sketch where `Subscription`, `MonthlyBox`, and `Subscriber` carry the lifecycle.

**Constraints.**
- A `Subscription` decides whether a skip is still allowed; the warehouse does not.
- `Subscription` exposes verbs: `skipNext(Clock)`, `pause(Clock)`, `resume(Clock)`, `cancel(Clock)`. No `setState`.
- The seven-day cut-off must be expressible as a value, not magic numbers in three different methods.
- Consecutive-skip counter is encapsulated; outside code cannot read and reset it independently.

**Acceptance checklist.**
- [ ] Events listed include `SubscriptionSkipped`, `SubscriptionPaused`, `SubscriptionResumed`, `SubscriptionCancelled`, `BoxLocked`, `BoxShipped`.
- [ ] A method `Subscription.canSkip(Clock)` exists and is called internally, never asked by the caller before calling skip.
- [ ] Refund logic on cancel lives on `Subscription`, not a `BillingService` that probes its fields.
- [ ] Pause and skip are distinct states with different rules — the model does not collapse them into a flag.
- [ ] A `BillingCycle` or `CutOff` value object replaces stray `LocalDate` arithmetic.
- [ ] At least two requirement gaps surfaced (e.g. "what if a paused subscriber wants to skip?").

---

## Task 4 — Tournament bracket management

**Requirements.** *"An online chess platform runs single-elimination tournaments of 8, 16, 32, or 64 players. Players register up to one hour before start time; if fewer than eight register the tournament is cancelled and entry fees are refunded. Once the tournament starts the bracket is fixed: seeds 1 and 16 meet, 2 and 15 meet, and so on. Each match has a 30-minute clock; if a player disconnects for more than five minutes their opponent is awarded the win. Winners advance immediately. If both players in a match disconnect, the match is replayed once; a second double-disconnect eliminates both. The tournament ends when one player has won every round. Prize money is split 50/25/15/10 among the top four."*

**Objective.** Identify the events, the decisions, and the aggregates. Model `Tournament`, `Bracket`, `Match`, `Player`. Decide what is a value object and what is an entity.

**Constraints.**
- The bracket is generated by the `Tournament`, not by an external `BracketBuilder` service. Seeding is an internal rule.
- A `Match` decides its own winner; the `Tournament` only listens for the result.
- Disconnect handling lives on `Match` with a `Clock` collaborator.
- Prize distribution is computed by `Tournament` from its own final standings, not by a `PayoutService` that scans matches.

**Acceptance checklist.**
- [ ] Events: `TournamentRegistered`, `TournamentStarted`, `TournamentCancelled`, `MatchStarted`, `MatchFinished`, `PlayerDisconnected`, `PlayerEliminated`, `TournamentFinished`.
- [ ] The 8/16/32/64 sizes encoded as a closed set (e.g. enum or factory), not "any positive int".
- [ ] Prize split expressed as a typed distribution, not four `BigDecimal` constants in a method.
- [ ] No method like `Tournament.setWinner(Player)`. Winners emerge from the bracket itself.
- [ ] A scenario walk-through in comments showing how a double-disconnect-then-eliminate would flow through the model.
- [ ] Glossary entry distinguishing *seed* (initial rank) from *position* (current bracket slot).

---

## Task 5 — Healthcare appointment with provider availability

**Requirements.** *"A clinic lets patients book appointments with specific providers. Each provider publishes their availability as 20-minute slots within working hours, with a 10-minute buffer after every appointment for notes. Patients can book up to 90 days in advance; double-booking is impossible. Some appointment types require longer slots (a physical exam takes two consecutive slots; a follow-up takes one). If a patient books a longer type, both slots must be free and the buffer applies after the last slot. Patients can reschedule up to 24 hours before; later than that, rescheduling counts as a late cancellation, which is logged. Three late cancellations in a year require the patient to pre-pay for future appointments. Walk-ins are accepted only if a same-day slot is free, and they bypass the 90-day rule."*

**Objective.** Identify the events, the decisions, and the aggregates. Model `Provider`, `Patient`, `Appointment`, `Slot`. Decide whether the buffer is part of the `Slot` or an emergent rule on `Provider`.

**Constraints.**
- Slot conflict detection lives on `Provider`. A patient asks the provider to book; the provider says yes or refuses.
- Appointment types are first-class objects (`PhysicalExam`, `FollowUp`), each knowing how many slots and what buffer they require — not strings compared in `if` chains.
- The pre-pay rule is encoded as a `PatientStanding` or similar concept, not a boolean smeared across the codebase.
- Walk-ins must use the same `book` verb, with the 90-day rule lifted by an explicit parameter or alternative method — not by silently skipping a check.

**Acceptance checklist.**
- [ ] At least seven events including reschedule and late-cancellation transitions.
- [ ] A `SlotRange` value object handling consecutive-slot logic for longer appointments.
- [ ] The buffer is implemented once, not duplicated per appointment type.
- [ ] `Provider.book(...)` returns an `Appointment`; the appointment knows its own type, its own slot range, and its own reschedule rules.
- [ ] Pre-pay enforcement triggered automatically on the third late cancellation in a rolling year — encapsulated, not exposed as a `getLateCancellations()` count for callers to compare.
- [ ] Two open questions for the domain expert noted in the file.

---

## Task 6 — Auction with sniping protection

**Requirements.** *"An online auction site runs timed auctions for collectibles. Each auction has a start time, an end time, a minimum bid increment (often 1 EUR but configurable), and a reserve price (a hidden floor; if no bid meets it, the item does not sell). Bidders place bids that must beat the current highest bid by at least the increment. To prevent last-second sniping, any bid placed in the final two minutes extends the auction by two more minutes; this can repeat indefinitely until two full minutes pass without a new bid. The winning bidder is notified and must pay within 48 hours; failure to pay forfeits a 10% deposit and the item is offered to the second-highest bidder at their bid. Sellers cannot bid on their own auctions. Bids cannot be retracted once placed."*

**Objective.** Identify the events, the decisions, and the aggregates. Model `Auction`, `Bid`, `Bidder`, `Seller`. Decide where the sniping-protection logic lives.

**Constraints.**
- The auction itself decides whether a bid extends the end time; nothing outside it touches the end-time field.
- Reserve price is a private invariant of the auction; bidders never see it but the auction uses it to decide whether to award.
- `Money` is a value object that knows currency and increment-aware comparison.
- "Cannot bid on your own auction" is enforced inside `Auction.placeBid(...)`, not by a UI check.

**Acceptance checklist.**
- [ ] Events: `AuctionStarted`, `BidPlaced`, `AuctionExtended`, `AuctionEnded`, `AuctionAwarded`, `AuctionUnsold`, `PaymentDefaulted`, `OfferedToRunnerUp`.
- [ ] A `BidIncrement` value object and a `BidAmount` that refuses construction below increment.
- [ ] `Auction.placeBid` is the only public mutation; bids cannot be inserted via a collection setter.
- [ ] Sniping-protection rule expressed once, with a named `ANTI_SNIPE_WINDOW` constant or value object.
- [ ] Second-chance offer to runner-up modelled as a domain event, not a service mutation.
- [ ] No `getCurrentHighBid()` followed by external comparison; bidders submit, auction judges.

### Worked solution sketch — Task 6

Walk through it. A seller lists a 1950s typewriter with reserve 200 EUR, increment 5 EUR, end at 21:00. At 20:58 a bidder offers 195 EUR — accepted as a bid, but below the reserve so it will not win on its own. At 20:59:30 someone bids 250 EUR, which is in the final two minutes, so the auction extends to 21:01:30. At 21:01:25 another bidder offers 260 EUR, extending again to 21:03:25. No further bids arrive; the auction ends, 260 EUR wins, and payment must arrive by 23:03:25 two days later.

Events surfaced: `BidPlaced(typewriterAuction, alice, 195)`, `BidPlaced(... bob, 250)`, `AuctionExtended(newEnd=21:01:30)`, `BidPlaced(... carol, 260)`, `AuctionExtended(newEnd=21:03:25)`, `AuctionEnded`, `AuctionAwarded(carol, 260)`.

Decisions and owners:

| Decision                                       | Owner             |
| ---------------------------------------------- | ----------------- |
| "Does this bid beat current high plus increment?" | `Auction`         |
| "Is the bidder the seller?"                    | `Auction`         |
| "Are we in the anti-snipe window?"             | `Auction`         |
| "Is the reserve met?"                          | `Auction` (private) |
| "Has the payment deadline passed?"             | `Awarded` (a sub-aggregate or state object) |

Sketch:

```java
public final class Auction {
    private static final Duration ANTI_SNIPE_WINDOW = Duration.ofMinutes(2);

    private final AuctionId id;
    private final SellerId seller;
    private final Money reservePrice;
    private final BidIncrement increment;
    private Instant endsAt;
    private Bid currentHigh;          // nullable until first bid
    private Bid runnerUp;             // tracked for fallback
    private AuctionState state = AuctionState.RUNNING;

    public void placeBid(BidderId bidder, Money amount, Clock clock) {
        if (state != AuctionState.RUNNING)  throw new AuctionClosedException();
        if (bidder.equals(seller))          throw new SellerCannotBidException();
        if (clock.now().isAfter(endsAt))    throw new AuctionClosedException();
        if (!increment.beats(amount, currentHighAmount())) {
            throw new BidTooLowException();
        }
        runnerUp = currentHigh;
        currentHigh = new Bid(bidder, amount, clock.now());
        if (Duration.between(clock.now(), endsAt).compareTo(ANTI_SNIPE_WINDOW) < 0) {
            endsAt = clock.now().plus(ANTI_SNIPE_WINDOW);
        }
    }

    public void close(Clock clock) {
        if (clock.now().isBefore(endsAt)) throw new AuctionNotOverException();
        state = (currentHigh != null && reservePrice.lessThanOrEqual(currentHigh.amount()))
              ? AuctionState.AWARDED
              : AuctionState.UNSOLD;
    }

    private Money currentHighAmount() {
        return currentHigh == null ? Money.zero() : currentHigh.amount();
    }
}
```

Notice: every rule lives on `Auction`. `Bid` is an immutable record. `BidIncrement.beats(...)` reads as English. No setters, no `BidService`, no `if (auction.getEndsAt().isAfter(now))` outside the aggregate.

---

## Task 7 — Mortgage origination credit decision

**Requirements.** *"A lender processes mortgage applications in four stages: intake, underwriting, decision, and disbursement. At intake the applicant submits income, employment history, the target property, and the requested loan amount. Underwriting checks the credit bureau score, the debt-to-income ratio (must be 43% or lower), the loan-to-value ratio (must be 80% or lower for a conventional loan, 95% with mortgage insurance), and that employment has been stable for at least two years. The decision step issues approval, conditional approval (with a list of conditions the applicant must satisfy), or denial. Approval expires in 60 days if disbursement has not occurred. Disbursement requires final clear-to-close: title insurance, appraisal within 5% of the requested amount, and homeowner's insurance binder. If the appraisal comes in below 95% of the requested amount the loan is re-underwritten with a lower amount or denied."*

**Objective.** Identify the events, the decisions, and the aggregates. Model `Application`, `Underwriting`, `Decision`, `Disbursement`. Decide what state machine governs the flow.

**Constraints.**
- Each stage is a distinct aggregate or state; an `Application.status = "underwriting"` string is forbidden.
- Ratio calculations live on `Underwriting`, not on a stateless calculator.
- Conditions on a conditional approval are a typed collection, not free-text strings.
- Expiry is handled by asking the aggregate, never by external timestamp comparison.

**Acceptance checklist.**
- [ ] Events: `ApplicationSubmitted`, `UnderwritingStarted`, `RatioComputed`, `DecisionIssued`, `ConditionsSatisfied`, `AppraisalCompleted`, `ReUnderwritingRequired`, `Disbursed`, `ApprovalExpired`.
- [ ] `DebtToIncomeRatio` and `LoanToValueRatio` are value objects with thresholds expressed once.
- [ ] `Decision` is a sealed type with `Approved`, `ConditionalApproval(conditions)`, `Denied(reason)` subtypes.
- [ ] No `Application.getStatus()` for outside code to switch on. Outside code asks `application.canDisburse(clock)`.
- [ ] The re-underwriting path on a low appraisal is explicit, not handled by mutating the original underwriting record.
- [ ] At least three ambiguities flagged (e.g. "what counts as stable employment if the applicant just changed jobs to a higher salary?").

---

## Task 8 — Telco prepaid plan with rollover minutes

**Requirements.** *"A prepaid mobile plan gives subscribers 500 minutes, 5 GB of data, and 100 SMS per month for a fixed 15 EUR. Minutes unused at the end of a month roll over for up to three months; data and SMS do not. Subscribers can top up at any time; a top-up extends the plan by one month from the top-up date and adds another full allowance. Calls deduct from the current month's allowance first, then from oldest rollover, then trigger pay-per-minute charging at 0.10 EUR per minute once everything is exhausted. International calls always use pay-per-minute regardless of remaining minutes. Suspending the line freezes rollover expiry; resuming continues it. Porting the number out cancels the plan and refunds 50% of any unused allowance at the next prorated boundary."*

**Objective.** Identify the events, the decisions, and the aggregates. Model `Subscriber`, `Plan`, `Allowance`, `Bucket` (for rollover slices). Decide where the deduction algorithm lives.

**Constraints.**
- Each `Bucket` knows its expiry; the plan asks the buckets in age order, oldest first, to absorb minutes.
- International routing decision lives on `Call`, not on the plan.
- Suspension freezes time, not bucket fields — model the freeze as a clock offset or a paused interval, not by mutating each bucket's expiry.
- Refund computation on port-out is a domain method, not an accounting service.

**Acceptance checklist.**
- [ ] Events: `PlanActivated`, `ToppedUp`, `CallPlaced`, `MinutesDeducted`, `BucketExpired`, `LineSuspended`, `LineResumed`, `NumberPortedOut`, `RefundIssued`.
- [ ] Deduction is a single method `Plan.consume(Duration, CallType, Clock)` that walks the buckets in order.
- [ ] No `bucket.setRemaining(...)` calls from outside. Buckets absorb minutes via a verb and refuse if empty.
- [ ] Pay-per-minute overflow is itself an event that records how many minutes were charged out-of-bundle.
- [ ] Suspension is modelled with a typed state, not a `boolean isSuspended` plus scattered checks.
- [ ] Glossary clearly separates *allowance* (the monthly grant), *bucket* (a rollover slice), and *balance* (sum of remaining buckets).

---

## How to grade yourself

A modelling task is not graded on whether the code compiles. Re-read what you produced and ask:

1. Can a colleague read the class names and method names out loud and have them sound like a domain expert describing the system? If not, the language is off.
2. Is every rule from the requirements paragraph traceable to exactly one method on exactly one aggregate? If a rule lives in two places, you have duplicated truth.
3. Are there any `get`-then-`if` chains in calling code? Each one is a missed Tell-Don't-Ask opportunity — fold the check into the aggregate.
4. Did you raise at least one question per task that the requirements did not answer? Real requirements are always incomplete; surfacing the gaps is half the work.

If you can answer those four questions confidently, the model is doing its job — turning prose into running rules instead of into fillable forms.

---

## Recommended workflow per task

The same four-step routine works for every task above. Repeat it deliberately until it becomes muscle memory:

1. **Read the paragraph three times.** First pass: get the gist. Second pass: underline anything that looks like a decision ("must", "can", "if", "until", "unless"). Third pass: underline anything that looks like a time-based rule ("within", "after", "before", "per month").
2. **Write an event log on paper.** For each decision, ask: when this decision goes one way, what changed in the world? That change is your event. Aim for between five and nine events; fewer means you are missing transitions, more means you are inventing them.
3. **Build the decision-to-owner table.** For each decision, ask: which object holds the data needed to make this call? That object owns the decision. If no existing object has the data, you have just discovered a new aggregate or value object.
4. **Sketch the verbs, not the fields.** Open the editor and write method signatures first — `Bike.unlock(Rider, Clock)`, `Auction.placeBid(BidderId, Money, Clock)`. Only once the verbs read well do you fill in the private fields they need.

Resist the urge to write all eight tasks in one sitting. Pick one, finish it end-to-end including the open questions for the domain expert, then move to the next. The deepening of skill comes from finishing, not from breadth.

---

## A note on what good output looks like

When you are done with a task, your deliverable for each one is roughly three artifacts:

- A short bullet list of **events** (five to nine items).
- A **decision-to-owner table** (three to six rows).
- A **Java sketch** with no more than four classes, each having two or three methods and the minimum fields required to enforce the rules. Setters are forbidden, services are discouraged, and `Clock` appears wherever time matters.

If your sketch grows past four classes for a single task, you are probably modelling too much of the world. Stop and ask which classes belong to this bounded context and which belong elsewhere. A small, sharp model that covers the listed requirements completely is worth far more than a sprawling one that gestures at everything.

---

## Stretch variations

If a task feels easy, change one rule and re-model from scratch. Examples:

- **Bike-share.** Add a "battery-swap" requirement for e-bikes: bikes below 20% charge cannot be unlocked except by maintenance staff. Where does that decision live?
- **Restaurant.** Allow joining two adjacent tables for parties of 9 to 12 with manager approval. The previous "tables cannot be combined" rule changes — what new aggregate appears?
- **Subscription-box.** Introduce gift subscriptions: the payer and the recipient are different people. Where does the recipient's address belong, and how does pause/skip interact when the gift period ends?
- **Tournament.** Switch to double-elimination. The bracket structure changes, but should the `Tournament` aggregate change, or does a new `LosersBracket` collaborator appear?
- **Healthcare.** Add telehealth appointments that consume one slot but have no buffer (no in-person notes). Does `AppointmentType` need a new dimension, or is telehealth orthogonal?
- **Auction.** Add buy-it-now pricing that ends the auction immediately. Is buy-it-now a kind of bid, or a separate concept?
- **Mortgage.** Add a fast-track path for repeat borrowers that skips full underwriting if the previous loan closed within 18 months. Where does the eligibility decision live?
- **Telco.** Add family-plan sharing: minutes can be borrowed across lines in the same household. What new aggregate now owns the shared pool, and how does it interact with per-line buckets?

Re-modelling under a changed rule is the fastest way to feel whether your original abstractions were strong or accidental.
