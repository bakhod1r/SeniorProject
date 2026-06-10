# Anthropomorphism — Middle

> **What?** The junior page taught the heuristic: *speak about objects as agents, and the verbs they can say about themselves become their methods.* This page turns that heuristic into a working technique — a small toolkit of design moves you run on real domains, plus the refactoring grammar for migrating procedural code into agent-shaped code without breaking the system around it.
> **How?** Pick a domain, list the verbs, assign each verb to its rightful owner, draft CRC-card-lite sketches, then refactor utility classes and "service" facades into method calls on those owners. The point is not to write longer essays about objects — it is to do the move that turns `ClaimUtils.calculate(claim)` into `claim.assessLiability()` while everything still compiles.

---

## 1. The agent-verb workshop

Before any class diagram, run a five-minute workshop on the domain. Take an insurance claim flow and brainstorm every verb that appears in the business conversation, then ask: *who is the rightful subject of this verb?*

| Verb (heard in the domain)             | Tempting subject (wrong) | Rightful owner (right) |
| -------------------------------------- | ------------------------ | ---------------------- |
| "Submit a claim"                       | `ClaimService`           | `Policyholder` creates; `Claim` is the result |
| "Acknowledge the claim"                | `ClaimService`           | `Claim` (transitions itself to `ACKNOWLEDGED`) |
| "Assign an adjuster"                   | `AssignmentManager`      | `Claim` (knows its own assignment rules) |
| "Assess liability"                     | `LiabilityCalculator`    | `Claim` consults a `Policy`; `Claim.assessLiabilityUnder(policy)` |
| "Approve the payout"                   | `ApprovalService`        | `Claim` (approves itself when criteria are met) |
| "Pay the claimant"                     | `Claim`                  | `Treasury` / `PaymentGateway` — the claim *emits* a payout request |
| "Close the claim"                      | `ClaimController`        | `Claim` |

The interesting rows are the bottom two. "Pay" sounds like a claim verb in English, but the claim doesn't have a chequebook — the claim *requests* payment. The role-play test from the junior page picks this up: if you say "I am a claim, I pay the claimant", the audience asks "with whose money?" and you stall. Good signal. Move the verb.

A workshop output looks like a verb list with arrows:

```
submit          -> Policyholder.fileClaim(...) returning a Claim
acknowledge     -> Claim.acknowledge()
assign adjuster -> Claim.assignTo(adjuster)
assess          -> Claim.assessLiabilityUnder(policy)
approve         -> Claim.approve()
pay             -> Treasury.pay(PayoutRequest), triggered by Claim event
close           -> Claim.close()
```

This is the design. Everything else is typing.

---

## 2. CRC-card-lite for the claim domain

Class-Responsibility-Collaborator cards are the cheapest way to validate the agent assignment before code. The "lite" version is three lines: who I am, what I know how to do, who I talk to.

**Card 1 — `Claim`**

- *Knows:* the policy, the incident, my own status, my adjuster, my history of decisions.
- *Does:* `acknowledge`, `assignTo`, `assessLiabilityUnder(policy)`, `approve`, `reject(reason)`, `close`.
- *Talks to:* `Policy` (asks for coverage limits), `Adjuster` (reports findings), `DomainEvents` (announces decisions).

**Card 2 — `Policy`**

- *Knows:* coverage limits, deductibles, exclusions, the policyholder.
- *Does:* `coversIncident(incident)`, `deductibleFor(perilType)`, `limitFor(perilType)`.
- *Talks to:* nobody downstream — it answers questions; it does not call out.

**Card 3 — `Adjuster`**

- *Knows:* my assigned claims, my certifications, my workload.
- *Does:* `accept(claim)`, `inspect(claim)`, `recommend(amount)`.
- *Talks to:* `Claim` (reports back).

Three cards. Note what is *missing*: there is no `ClaimManager`, no `ClaimWorkflowEngine`, no `LiabilityAssessor`. Every verb landed on a domain noun. When a verb has no home — say, "send the policyholder an SMS" — that is the cue to create an *application* role (`NotificationService`) outside the domain, not a god agent inside it.

If two cards end up with the same verb, you have not allocated responsibility; you have duplicated it. Pick one. The other one *consults*.

---

## 3. Refactoring `Utils.calculateX(thing)` into agent methods

Static utility methods are the most common shape of inverted responsibility. They take the noun as the first parameter precisely because the noun should have owned the verb.

**Before — utility-first design:**

```java
public final class ClaimUtils {
    private ClaimUtils() {}

    public static Money calculatePayout(Claim claim, Policy policy) {
        Money raw = claim.incident().estimatedLoss();
        Money afterDeductible = raw.minus(policy.deductibleFor(claim.peril()));
        Money capped = afterDeductible.cappedAt(policy.limitFor(claim.peril()));
        if (claim.hasFraudFlags()) {
            capped = Money.ZERO;
        }
        return capped.nonNegative();
    }
}

// Caller:
Money payout = ClaimUtils.calculatePayout(claim, policy);
```

The function signature `(Claim claim, Policy policy) -> Money` is the smell. The claim is being passed in. That is the universal sign that the verb belongs *on* the claim.

**After — agent-first design:**

```java
public final class Claim {
    // ...fields...

    public Money payoutUnder(Policy policy) {
        if (hasFraudFlags()) {
            return Money.ZERO;
        }
        Money raw = incident.estimatedLoss();
        Money afterDeductible = raw.minus(policy.deductibleFor(peril));
        return afterDeductible.cappedAt(policy.limitFor(peril)).nonNegative();
    }
}

// Caller:
Money payout = claim.payoutUnder(policy);
```

Three changes worth pointing out:

1. The verb moved *onto* the claim. The caller now reads like a sentence.
2. `Policy` stays as a collaborator, not as a co-owner. The claim *consults* the policy; the policy answers questions like `deductibleFor` and `limitFor`. Neither side calculates on behalf of the other.
3. The fraud check is right where the claim's own knowledge lives — `hasFraudFlags()` is internal state. Previously it was a public predicate that leaked out, used only by the utility class.

Migration recipe when you do this on a live codebase:

| Step | Action                                                                 |
| ---- | ---------------------------------------------------------------------- |
| 1    | Add the new agent method (`Claim.payoutUnder`) alongside the utility.   |
| 2    | Delegate the utility to it: `return claim.payoutUnder(policy);`         |
| 3    | Change one caller, run tests, commit.                                   |
| 4    | Repeat call-site by call-site.                                          |
| 5    | When the utility has no callers, delete it.                             |

The pattern generalizes far beyond utilities. Any `Foo.doSomething(bar, baz)` where `bar` is the most "subject-like" argument is a candidate for `bar.doSomething(baz)`.

---

## 4. Agents vs. collaborators

The junior page introduced the agent. In the middle, you also need a sharp word for the *other* objects that participate without owning the verb. Call them **collaborators**.

- An **agent** owns the verb. It enforces invariants. It decides outcomes. The call site does not know how it works inside.
- A **collaborator** is consulted. It answers questions. It does not drive the workflow.

In the claim example, `Policy` is a collaborator. It exposes `deductibleFor(peril)`, `limitFor(peril)`, `coversIncident(incident)`. It never says "I pay the claim" or "I close the claim". It is asked things; it is not told things.

A useful diagnostic table:

| Question                                            | Agent                          | Collaborator                  |
| --------------------------------------------------- | ------------------------------ | ----------------------------- |
| Who initiates the verb?                             | This object                    | Someone else                  |
| Who enforces the invariants for the verb?           | This object                    | Not its concern               |
| What kind of methods does it expose?                | Commands (`approve`, `close`)  | Queries (`coversIncident`, `limitFor`) |
| Does it have state that changes during the verb?    | Yes                            | Usually no                    |

The same class can be an agent in one interaction and a collaborator in another. In a hotel system, the `Reservation` is the agent for `cancel()`, but it is a collaborator when the `Room` is computing its `occupancyAt(date)` — the room asks the reservation "are you active on this date?", and the reservation answers without driving anything.

Stable test: read the call out loud. "The reservation cancels itself" — agent. "The room asks each reservation whether it covers this date" — collaborator on the reservation side; agent on the room side. The grammar tells you who is doing what.

---

## 5. The Tell-Don't-Ask corollary

If an object is an agent, it should be *told* what to do, not asked for its state so that someone else can decide on its behalf. Anthropomorphism produces Tell-Don't-Ask almost automatically: once you have a `Reservation` that knows how to cancel itself, you stop writing `if (reservation.getStatus() == ACTIVE) reservation.setStatus(CANCELLED);` — you just write `reservation.cancel();`.

The reverse is also true. Code that constantly asks objects for their fields and then mutates them through setters is code that has not yet committed to anthropomorphism. The two ideas — agents and Tell-Don't-Ask — are the same idea seen from two angles. See `../03-tell-dont-ask/` for the deep dive.

---

## 6. A full before/after refactor — ride dispatch

A procedural service has accumulated the entire workflow:

```java
public final class RideDispatchService {

    public Ride dispatch(RideRequest request) {
        Driver driver = findNearestAvailable(request.pickup());
        if (driver == null) {
            throw new NoDriverException();
        }
        if (driver.getRating() < 4.0 && request.isPremium()) {
            driver = findNearestPremium(request.pickup());
        }
        Ride ride = new Ride();
        ride.setRider(request.rider());
        ride.setDriver(driver);
        ride.setPickup(request.pickup());
        ride.setDropoff(request.dropoff());
        ride.setStatus(RideStatus.DISPATCHED);
        driver.setStatus(DriverStatus.EN_ROUTE);
        Money fare = FareUtils.estimate(request.pickup(), request.dropoff(), request.surge());
        ride.setEstimatedFare(fare);
        rideRepository.save(ride);
        driverRepository.save(driver);
        notifications.send(driver, "New ride: " + ride.getId());
        return ride;
    }
}
```

Everything is a verb on the service. The `Ride` and `Driver` are passive records — they expose setters and are mutated from the outside. The fare lives in a utility. The repositories are called from inside the workflow because nobody else has identity.

After anthropomorphism, the workshop identifies four agents: `DriverPool`, `Driver`, `Ride`, `Fare`. The service shrinks to an orchestrator.

```java
public final class Ride {
    private RideStatus status = RideStatus.REQUESTED;
    // ...

    public static Ride request(Rider rider, Location pickup, Location dropoff) {
        return new Ride(rider, pickup, dropoff);
    }

    public void dispatchTo(Driver driver, Fare estimate) {
        if (status != RideStatus.REQUESTED) {
            throw new IllegalStateException("Cannot dispatch a " + status + " ride");
        }
        this.driver = driver;
        this.estimatedFare = estimate;
        this.status = RideStatus.DISPATCHED;
    }
}

public final class Driver {
    public boolean canTake(RideRequest request) {
        return status == DriverStatus.AVAILABLE
            && (!request.isPremium() || rating >= 4.0);
    }

    public void accept(Ride ride) {
        if (status != DriverStatus.AVAILABLE) {
            throw new IllegalStateException("Driver is " + status);
        }
        status = DriverStatus.EN_ROUTE;
    }
}

public final class DriverPool {
    public Optional<Driver> nearestFor(RideRequest request) {
        return drivers.stream()
            .filter(d -> d.canTake(request))
            .min(Comparator.comparingDouble(d -> d.distanceTo(request.pickup())));
    }
}
```

The orchestrator now reads like a flight plan, not an implementation:

```java
public final class RideDispatcher {
    public Ride dispatch(RideRequest request) {
        Driver driver = pool.nearestFor(request)
            .orElseThrow(NoDriverException::new);
        Ride ride = Ride.request(request.rider(), request.pickup(), request.dropoff());
        Fare estimate = Fare.estimate(request, surgeBoard.current());
        ride.dispatchTo(driver, estimate);
        driver.accept(ride);
        rides.save(ride);
        drivers.save(driver);
        events.publish(new RideDispatched(ride.id(), driver.id()));
        return ride;
    }
}
```

Every domain rule moved out of the service. The service is reduced to "ask the pool, build a ride, tell the participants what happened". The setters are gone. The status transitions are guarded by the objects that own the state. New rules ("don't dispatch to a driver whose insurance expires today") have an obvious home — `Driver.canTake`.

---

## 7. Common mistakes at the middle level

**Mistake 1 — renaming setters and calling it agent design.**

```java
public void markCancelled() { this.status = Status.CANCELLED; }
```

This looks anthropomorphic but it is a setter in a wig. It accepts any caller, enforces no invariants, and exposes no decision. A real `cancel()` checks whether cancellation is allowed, records *when* it happened, and emits an event. If you rename `setStatus(CANCELLED)` to `markCancelled()` without changing the body, you have moved the smell, not the design.

**Mistake 2 — generic verbs (`process`, `handle`, `manage`, `execute`).**

A method called `process` says nothing about the domain. The role-play test fails: "I am a `Reservation`. I process myself" is meaningless. Replace `process` with the actual transition — `confirm`, `checkIn`, `noShow`, `extend`. If you cannot find one, the verb does not exist in the domain and the method probably should not either.

**Mistake 3 — god agents.**

```java
public final class Reservation {
    public void confirm() { ... }
    public void chargeCard() { ... }
    public void sendConfirmationEmail() { ... }
    public void allocateRoom() { ... }
    public void updateHousekeepingSchedule() { ... }
}
```

A reservation does not own a card terminal, an SMTP server, a room map, or a housekeeping crew. Anthropomorphism asks "what is this object's identity?" — and the answer for a reservation is "I am a promise that someone will stay in a room on these dates". Anything else is a different agent's job. The reservation announces what happened; other agents react.

**Mistake 4 — collaborators that quietly become agents.**

A `Policy` that calculates payouts; a `Warehouse` that ships orders; a `Library` that pays fines. The naming sounds harmless because these are real domain nouns, but the verbs you have attached belong to other agents (`Claim`, `Shipment`, `Loan`). Watch for the same verb appearing in two places — it is duplicated ownership.

A worked counter-example from a library system: a `Loan` (not the `Library`) is the agent for `renew()` and `returnOn(date)`. The `Library` is a collaborator — it answers `isOpenOn(date)` and `feeRateFor(memberType)`. When the loan renews itself, it consults the library for the calendar, but it owns the decision. Move the verb to `Library` and the same logic ends up duplicated for every loan type.

---

## 8. Quick rules at the middle level

- [ ] Before designing, run a five-minute verb workshop. List every verb in the domain. Assign each one to exactly one owner.
- [ ] If a verb's signature is `Verb(Subject s, ...)`, the verb belongs on `Subject`.
- [ ] CRC-card-lite (knows / does / talks to) on the back of an envelope before any code.
- [ ] Agents own commands; collaborators answer queries.
- [ ] Setters renamed as verbs are still setters. Add invariants or remove the method.
- [ ] Generic verbs (`process`, `handle`, `manage`, `execute`) almost always hide a missing domain concept.
- [ ] When a verb has no domain owner, create an *application* role outside the domain — not a god agent inside it.
- [ ] After refactor, read the orchestrator out loud. If it still has business rules in it, the agents have not absorbed them yet.

---

## 9. What's next

| Topic                                                                  | File              |
| ---------------------------------------------------------------------- | ----------------- |
| When the metaphor fights frameworks, ORMs, mocks, and serializers      | `senior.md`        |
| Spreading the vocabulary across a team; review checklists; PR language | `professional.md`  |
| Hands-on workshop exercises across multiple domains                    | `tasks.md`         |
| Interview Q&A — defending the heuristic                                | `interview.md`     |
| The natural follow-on — Tell-Don't-Ask                                 | `../03-tell-dont-ask/` |

---

**Memorize this:** the verb belongs to the noun that owns the invariant. Find the verbs, find the owners, and everything procedural in your codebase has a forwarding address.
