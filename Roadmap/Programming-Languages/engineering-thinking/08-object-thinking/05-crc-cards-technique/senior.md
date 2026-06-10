# CRC Cards — Senior

> **What?** At the senior level the question stops being "how do I run a CRC session?" and becomes "**when is CRC the wrong tool, and what do I reach for instead?**" CRC is brilliant at clarifying *who owns what behavior* inside a single bounded context, but it stays silent on data flow, asynchrony, time, and cross-aggregate consistency. Senior engineers combine CRC with Event Storming, C4 diagrams, ADRs, and even microservice boundary mapping — and they know how to capture the output so it survives the meeting.
> **How?** Treat CRC as one lens in a kit. Use it where its strengths shine (behavior allocation in an OO model), and switch to other techniques where it's blind. Always capture the result in a durable artifact, never as a pile of photos that decays.

---

## 1. Where CRC stops being enough

CRC is a *static* role-allocation technique. It answers "what does each object know and do?" but says almost nothing about:

- **Data flow.** A card lists collaborators but not the *direction*, *shape*, or *volume* of information moving between them. Two classes may "collaborate" through a 10 MB payload or a single boolean — the card is identical.
- **Asynchrony and timing.** When an `Order` collaborates with a `PaymentGateway`, is that a blocking call, a queued message, or a webhook callback an hour later? The card cannot tell.
- **Cross-aggregate scenarios.** CRC walk-throughs assume a *single* in-memory object graph. The moment a scenario spans aggregates — say, an `Order` aggregate publishes an event that the `Inventory` aggregate consumes — CRC has no notation for the boundary.
- **Failure modes.** What happens if `Slot.ejectOne()` jams? CRC narration tends to walk the happy path. Error paths require a different discipline.
- **State machines.** "Order is PLACED → PAID → SHIPPED" is a real design concern. CRC can hint at it ("transition on payment receipt") but a state diagram captures it far better.

When you find yourself adding fake "EventBus" cards or drawing arrows between cards with timing annotations, you've outgrown CRC for that conversation.

A concrete tell: in a payment flow, the card for `Order` lists `PaymentGateway` as a collaborator. Fine. But the *real* design question — "do we charge synchronously and roll back the order if charge fails, or do we record the order in a PENDING state and reconcile via webhook?" — is invisible on the card. Two completely different architectures share the same CRC card. That's the boundary at which CRC stops earning its keep, and you need a sequence diagram, a saga choreography, or both.

---

## 2. CRC vs Event Storming — when to use which

Event Storming, invented by Alberto Brandolini, uses orange sticky notes for **domain events** ("OrderPlaced", "PaymentReceived") arranged on a long wall in time order. It's the opposite emphasis from CRC: events first, then commands, then aggregates.

| Dimension              | CRC Cards                        | Event Storming                        |
| ---------------------- | -------------------------------- | ------------------------------------- |
| Primary artifact       | Class + responsibilities         | Domain event in past tense            |
| Time axis              | Implicit (per scenario)          | Explicit left-to-right timeline       |
| Granularity            | One bounded context              | Whole business process, many contexts |
| Best for               | Allocating behavior to objects   | Discovering boundaries and flows      |
| Output                 | Cards → class skeletons          | Sticky wall → bounded contexts        |
| Participants           | 3–6 developers                   | 8–20, including domain experts        |

A pragmatic combination: **Event Storm first** to find the bounded contexts and aggregates, **then CRC** inside each context to allocate behavior. Going CRC-first on a system you don't understand yet often gives you a god-class because nobody has agreed on where the seams are.

---

## 3. CRC vs UML class and sequence diagrams

UML is formal; CRC is deliberately informal. The trade-off is real.

```java
// What a CRC card hides — and a sequence diagram reveals
public final class CheckoutService {
    public OrderConfirmation checkout(CartId id) {
        Cart cart = carts.load(id);                      // 1: load cart
        Reservation r = inventory.reserve(cart.items()); // 2: sync RPC
        try {
            ChargeResult c = payments.charge(            // 3: sync, slow
                cart.total(), cart.paymentMethod());
            Order order = orders.place(cart, r, c);      // 4: persist
            events.publish(new OrderPlaced(order.id())); // 5: async fan-out
            return OrderConfirmation.of(order);
        } catch (PaymentDeclined e) {
            inventory.release(r);                        // compensation
            throw e;
        }
    }
}
```

A CRC card for `CheckoutService` lists `Cart`, `InventoryService`, `PaymentGateway`, `OrderRepository`, `EventBus` as collaborators — true but underwhelming. The sequence diagram shows ordering, the synchronous boundary, the async publish, and the compensating release on failure. **Use CRC to decide the actors; use a sequence or activity diagram to nail down the protocol.**

Rules of thumb:

- For *teaching* a junior engineer the domain — CRC wins (it's narrative).
- For *reviewing* a complex transaction in code review — UML sequence wins.
- For *long-lived documentation* — neither: use a C4 component diagram with prose.

---

## 4. CRC at the microservice boundary

Cards don't have to represent classes. At the architecture scale, **each card represents a service**, and responsibilities are the bounded capabilities that service owns.

```
Class: PaymentService                Class: OrderService
  Responsibilities                     Responsibilities
  - authorize a charge                 - place an order
  - capture a previously authorized    - know an order's status
    charge                             - cancel an order
  - refund a charge                    Collaborators
  - emit ChargeAuthorized event        - PaymentService
  Collaborators                        - InventoryService
  - external gateway (Stripe)          - NotificationService
```

This works because the *same* CRC question — "who owns this responsibility?" — applies whether the owner is a class or a service. The session output isn't a class diagram; it's a service catalog.

Two warnings:

1. The grain matters. A card per Kubernetes pod is too fine; a card per "platform" is too coarse. One card per autonomous deployable owning one bounded context is the sweet spot.
2. Collaborators at service grain almost always cross a network boundary — record *how* (REST, gRPC, queue, event) on the card or in a companion ADR.

A useful refinement at the service level is to mark each responsibility with its **consistency expectation**: *strong* (synchronous, must succeed atomically), *eventual* (consumed via event, may lag), or *idempotent retry* (caller may invoke multiple times). That single annotation prevents a category of bug where Team A thinks "refund a charge" is synchronous while Team B builds the consumer expecting an event.

---

## 5. Hybrid workflow: CRC → C4 → code skeletons

A workflow that reliably produces both shared understanding and durable artifacts:

1. **CRC session (60–90 minutes).** Whiteboard or table. Output: a pile of cards.
2. **Promote cards to a C4 component diagram.** Each surviving CRC class becomes a component box; collaborators become arrows. This is your *level 3* diagram.
3. **Capture rationale in an ADR.** "We split `Cart` and `Order` because pre-checkout and post-checkout invariants differ — see ADR-0007." One paragraph, one decision.
4. **Generate code skeletons.** One Java file per card, one stub method per responsibility:

   ```java
   /** Placed orders. Knows nothing about carts. */
   public final class Order {
       /** Responsibility: know which customer placed me. */
       public CustomerId customer() { throw new UnsupportedOperationException(); }
       /** Responsibility: know what items were ordered. */
       public List<LineItem> items() { throw new UnsupportedOperationException(); }
       /** Responsibility: transition PLACED -> PAID. */
       public Order markPaid(ChargeId charge) { throw new UnsupportedOperationException(); }
   }
   ```

5. **Write tests against the skeletons** (junior `tasks.md` style) before filling them in.

The CRC artifact dies when you finish step 2. The C4 diagram, the ADR, and the skeletons live in source control. That's the trade — informal exploration, formal capture.

---

## 6. The scenario coverage problem

CRC's biggest *quiet* failure mode: you walked through three scenarios, the cards stabilized, you shipped. Three months later a fourth scenario surfaces — refund after partial shipment, say — and the model can't express it without a major refactor.

How seniors mitigate this:

- **Inventory the scenarios up front.** Before any walk-through, list every use case from the requirements *and* every cross-cutting concern (failure, timeout, retry, audit, GDPR delete). Tick them off as you cover them.
- **Adversarial walk-throughs.** After the happy paths, force at least one *negative* walk-through per card: "what if `PaymentGateway` returns a partial decline?" If a card has no role in any negative scenario, that's suspicious.
- **Cover non-functional scenarios too.** "Audit log replay", "tenant offboarding", "GDPR forget-me" are real use cases that often surface a missing card (`AuditTrail`, `TenantPurger`).
- **Track coverage explicitly.** A simple matrix — cards across the top, scenarios down the side, a tick where a card participated. Empty rows or columns are red flags.

The discipline isn't to cover *every* scenario before coding; it's to **know which scenarios you deferred** and write that down.

```java
// A coverage-matrix annotation a senior team might keep in the repo
// next to the domain package, so the deferred scenarios stay visible:
/**
 * Scenario coverage for the Checkout aggregate:
 *   [x] happy path: cart -> order
 *   [x] payment declined (compensating release)
 *   [x] inventory race (two carts, last unit)
 *   [ ] partial refund after partial shipment   -- DEFERRED, see ADR-0014
 *   [ ] tenant GDPR delete with placed orders   -- DEFERRED, see issue #482
 */
```

Putting deferred scenarios next to the code keeps them honest. When the fourth scenario eventually arrives, nobody is surprised — the gap was logged.

---

## 7. Capturing CRC output that doesn't decay

A pile of cards on a desk is dead within a week. Photos in a chat channel die within a month. Capture options, in order of durability:

| Capture format             | Survives  | Notes                                                              |
| -------------------------- | --------- | ------------------------------------------------------------------ |
| Photos in Slack            | Days      | Useless six months later. The cards lose context.                  |
| Photos in a wiki page      | Months    | Better than Slack, but no one updates them.                        |
| Transcript in the wiki     | A year+   | Re-typed cards + scenario narration. Searchable.                   |
| GitHub issue per card      | Years     | Each responsibility becomes a checkbox; collaborators become links.|
| ADR with embedded summary  | Lifetime  | The *decision* and *alternatives* survive even after code changes. |
| C4 + code skeleton in repo | Lifetime  | The model becomes the code; cards are an interim artifact.         |

The seniors I respect do two of these in combination: an ADR for *why* + skeleton code for *what*. The cards themselves are scaffolding.

---

## 8. Remote and distributed CRC sessions

Most teams are now hybrid or fully remote. CRC translates well, with some adaptation:

- **Tool choice.** Miro, FigJam, Mural — any infinite canvas with a "card" or "sticky" primitive. Avoid Google Docs (no movement, no shuffling).
- **Card template.** Pre-build a template with three regions (name / responsibilities / collaborators). Lock the template so people don't accidentally redesign it.
- **Breakouts for parallel exploration.** With 8+ people, split into pairs per aggregate or per service. Each pair drafts cards; the whole group reconvenes for walk-throughs. This mirrors Event Storming's "design-level" phase.
- **One narrator at a time.** In person, picking up a card enforces this. Remote, designate the narrator explicitly ("Lena drives the next walk-through") and have them share screen + cursor.
- **Recording.** A 60-minute Zoom recording with the canvas visible is a far better artifact than photos. Pair it with the transcript.
- **Async pre-work.** Send the scenario list and a draft set of candidate cards 24 hours ahead. The synchronous session is then for walk-throughs, not nouns-on-a-whiteboard.

A common failure: trying to do CRC in a 15-minute standup. CRC needs *thinking time* — 30 minutes is the floor.

One more remote pitfall worth naming: **the canvas becomes a graveyard.** Six months later the Miro board has 80 cards, three half-finished walk-throughs, and nobody can remember which version was the agreed model. Counter this by stamping each session's output ("v3, 2026-04-12, agreed by team") and *archiving* prior canvases. Treat the canvas like source code: tagged, versioned, and pruned.

---

## 9. CRC for legacy refactoring

CRC isn't only for greenfield design. It's a powerful tool for *understanding* a legacy system and *planning* a refactor.

The technique: produce **two stacks of cards** — *as-is* and *to-be*.

```
AS-IS                              TO-BE
Class: OrderManager (god class)    Class: Order
  Responsibilities                   - know placement
  - validate cart                  Class: Cart
  - reserve inventory                - hold pre-checkout items
  - call payment                   Class: CheckoutCoordinator
  - persist order                    - orchestrate placement
  - send email                     Class: Notifier
  - log audit event                  - email + SMS post-event
  - export to ERP                  Class: ErpExporter
  - generate invoice PDF             - async ERP sync
  - calculate tax                  Class: TaxCalculator
  Collaborators                      - per-jurisdiction rules
  - everything                     Class: InvoiceRenderer
                                     - PDF generation
```

The as-is card is honest — it documents the disaster. The to-be cards are the target. The diff between the two stacks *is* the refactoring plan. Order the diff by risk-adjusted value, file a ticket per move, and you have a roadmap.

This technique is also how you communicate technical debt to non-engineers: "we have one card with twelve responsibilities; the industry standard is three to five." That sentence lands.

---

## 10. Anti-patterns to avoid

**Anti-pattern 1: CRC as Big Design Up Front (BDUF).**

Spending three weeks producing a 200-card model before writing any code is a process disease, not CRC. Cunningham and Beck were XP pioneers — CRC was meant to be *short and iterative*. If your session has run past 90 minutes without anyone writing code afterwards, you're doing waterfall in costume.

**Anti-pattern 2: CRC as a one-off.**

Teams that do CRC once at project kickoff and never again miss the point. The cards drift from the code within weeks. CRC should be a recurring activity — every new feature with non-trivial behavior, every major refactor, every onboarding session.

**Anti-pattern 3: cards as JIRA tickets.**

A card is *exploratory*. The moment you assign it a story point and a sprint, it becomes a contract — and contracts resist the tearing-up that makes CRC work. Keep cards in the design phase; let JIRA own delivery.

**Anti-pattern 4: design committee bloat.**

CRC works with 3–6 people. Past 8, the walk-through devolves into theatre — one person narrates while the rest scroll Slack. Use Event Storming for bigger groups; CRC for small ones.

**Anti-pattern 5: ignoring values and DTOs.**

People sometimes refuse to write cards for "trivial" classes like `Money` or `EmailAddress`. That's fine for the simplest ones — but if `Money` ends up with rounding rules, currency conversion, and audit hooks, it deserved a card all along.

---

## 11. Trade-offs vs functional decomposition

The historical alternative to OO + CRC is **functional decomposition**: break the problem into procedures, then into sub-procedures, top down. It works well for batch processing, ETL, and stateless compute. It works poorly when behavior has to *live with* state — which is most line-of-business software.

Where they meet:

- **Functional decomposition** asks *what steps happen?*
- **CRC** asks *who owns each step?*

A pragmatic Java team uses both. The pipeline of a checkout (`validate → reserve → charge → place → notify`) is a sequence of functional steps. *Each step* is owned by a class identified through CRC. The pipeline structure plus the role allocation gives you both readable orchestration and cohesive objects.

If you ever feel forced to choose, ask: does the system have *significant state and behavior together*? If yes, OO + CRC. If it's mostly pure transformation, lean functional and skip CRC.

```java
// A pipeline of functional steps, each owned by a CRC-identified class.
// The two techniques compose — they are not rivals.
public OrderConfirmation place(CartId id) {
    return validator.validate(id)        // owned by CartValidator
        .flatMap(inventory::reserve)     // owned by InventoryService
        .flatMap(payments::charge)       // owned by PaymentGateway
        .flatMap(orders::persist)        // owned by OrderRepository
        .peek(events::publish)           // owned by EventPublisher
        .map(OrderConfirmation::of)
        .orElseThrow();
}
```

The pipeline reads top-to-bottom like a recipe; the cards explain *why* each step lives in a separate class. Together they answer the two questions every reader of new code asks: "what happens?" and "who is in charge?"

---

## 12. Quick rules

- [ ] Know what CRC *cannot* see: time, data shape, async, cross-aggregate. Reach for sequence diagrams, Event Storming, or state machines when those matter.
- [ ] Use Event Storming to find bounded contexts; use CRC inside them.
- [ ] Promote cards to C4 components + ADRs before they decay. Photos are not durable.
- [ ] Walk through negative and non-functional scenarios, not just the happy path.
- [ ] In legacy work, draw the as-is honestly — the to-be diff is your refactor plan.
- [ ] Keep sessions short (≤ 90 min) and small (3–6 people). Past that, switch tools.
- [ ] Never treat cards as JIRA tickets — exploration dies on contact with contracts.

---

## 13. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Multi-scenario walk-throughs and how the cards become code       | `middle.md`        |
| Running CRC sessions across teams; templates; facilitation       | `professional.md`  |
| Hands-on CRC card exercises                                      | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |
| Event Storming as a complement                                   | (DDD section)      |

---

**Memorize this:** CRC excels at allocating behavior inside one bounded context — and is blind to time, data flow, and cross-aggregate boundaries. Mix it with Event Storming for discovery, sequence diagrams for protocol, and C4 + ADRs for capture. Cards are scaffolding; the durable artifact lives in the repo.
