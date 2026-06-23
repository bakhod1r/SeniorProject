# CRC Cards — Professional

> **What?** At staff/tech-lead level, CRC stops being a learning toy and becomes a *facilitation tool*. You run sessions, set tempo, capture the output in a way the team will reference six months later, and use the cards to make code review and onboarding cheaper. The cards themselves are unchanged from `junior.md`; what changes is *how you wield them in a room of seven engineers who already disagree*.
> **How?** Pick the right trigger (new feature, legacy refactor, hiring), facilitate a 90-minute session with a tight script, capture cards in version control next to the code, and pin them to architectural fitness functions so the design doesn't silently rot.

---

## 1. Running a 90-minute CRC workshop — the facilitation script

Ninety minutes is the sweet spot. Less than 60 and you don't get past arguing about class names; more than 120 and people glaze over. Time-box ruthlessly.

| Time   | Phase                                                            | Output                              |
| ------ | ---------------------------------------------------------------- | ----------------------------------- |
| 0:00   | Frame the problem in one sentence; read 1–2 scenarios aloud      | Shared "what are we modeling"       |
| 0:05   | Silent noun-storm — everyone writes candidate classes on stickies | Pile of 20–40 candidates            |
| 0:15   | Affinity-group the stickies; collapse synonyms; vote keep/cut    | 8–15 surviving candidate cards      |
| 0:25   | Fill in responsibilities for each card (still silent, 5 min)     | Draft cards                         |
| 0:30   | First scenario walk-through — pick up cards, speak in first person | Holes in the cards become visible   |
| 0:55   | Revise cards: split fat ones, merge duplicates, add new ones     | Second-pass cards                   |
| 1:05   | Second scenario walk-through (deliberately edge-case)            | More revisions                      |
| 1:25   | Capture: photograph the table, then someone transcribes to Markdown | Card set checked into the repo      |

As facilitator your job is not to invent the model — your job is to keep the team **walking through scenarios in first person**. The moment someone says "and then the system…" stop them: *which card is speaking right now?* Hand them the card.

Three rules I enforce as facilitator:

1. No laptops open. Cards and a marker only.
2. No method signatures. Anyone who says `List<Item>` puts a dollar in the jar.
3. The walk-through is the test. We don't move to the next scenario until the current one runs cleanly across the cards on the table.

---

## 2. When to call a CRC session

CRC is cheap but not free — it costs you 90 minutes of 5–7 people's time. Triggers I use:

- **Greenfield feature with 3+ collaborating classes.** Especially when the domain language is fuzzy ("what *is* a 'reservation' vs a 'booking'?"). CRC produces both the model *and* the glossary.
- **Legacy refactor where the same class has been "improved" three times.** The team can't agree on what the class is *for*. A CRC session forces the conversation onto responsibilities, not lines of code.
- **Two engineers blocked on a PR disagreement.** When the review comments hit 40+ and centre on "who should own this logic", a 30-min mini-CRC at a whiteboard is faster than another async round.
- **Onboarding** — see section 6.
- **Pre-mortem for a risky design** — walking through the failure scenario ("payment service is down") with cards exposes responsibility gaps before they become 3am pages.

I do **not** call CRC for: CRUD endpoints, framework plumbing, single-class refactors, or anything where the team already shares a clear mental model. Use the tool when there's *genuine disagreement or genuine ignorance*.

A negative example: a team I joined wanted to "do CRC" before adding a `/health` endpoint to a service. That's a 4-line method on a Spring `@RestController`. Calling a session there is performative — it teaches juniors that CRC is a ritual rather than a tool. Reserve the workshop format for problems where the *responsibility assignment is genuinely unclear*.

---

## 3. Templates

### 3.1 Printable Markdown template

Keep this as `docs/design/crc-template.md` in the repo. Print on cardstock when you have a physical session.

```markdown
| Class:           |                |
| ---------------- | -------------- |
| Responsibilities | Collaborators  |
| -                | -              |
| -                | -              |
| -                | -              |
| -                | -              |
| -                | -              |

Stereotype (circle one):
  Information Holder · Service Provider · Structurer ·
  Coordinator · Controller · Interfacer
Scenario this card was discovered in: _________________
```

Five rows of responsibilities is the constraint that does the work. If you need a sixth, that's the signal to split the card.

### 3.2 Miro/FigJam variant

For remote sessions, use a frame per card. The frame size matters — set it to roughly 4×6 inches so people don't sneak in extra responsibilities. A useful Miro layout per card:

- **Top stripe:** class name + stereotype tag (coloured by stereotype, so the wall is readable at a glance).
- **Left column:** responsibilities as separate stickies (so you can drag one to another card during a split).
- **Right column:** collaborator names as link-stickies (clicking jumps to that card's frame).
- **Bottom strip:** the scenario name in which this card was first walked through.

I keep a "Parking Lot" frame to the side for nouns that came up but didn't earn a card yet, and a "Crossed Out" frame for cards we tore up (with a one-line reason). Both are useful in the write-up.

---

## 4. Pairing CRC with code reviews

The most powerful single habit I have introduced on teams is asking, in code review:

> "What card does this class come from?"

If the answer is "we don't have a card for it", that's a signal — either we skipped CRC for this slice (sometimes legitimate) or we're inventing a class outside the model.

If the answer is "the `Pricing.Quote` card" and the PR adds a method that doesn't trace to any of its responsibilities — that's a discussion. Either the responsibility was missing from the card (update the card in the same PR), or the method belongs on a different class.

Example PR exchange:

> **Reviewer:** This new `OrderService.applyPromoCode` — what card is this from? The `Order` card's responsibilities are "know what was ordered" and "place itself"; I don't see "apply promo codes" there.
>
> **Author:** Fair. It's actually on the `Pricing.Quote` card under "compute discount" — but I put it on `OrderService` because that's where the existing pricing call is.
>
> **Reviewer:** Then `OrderService` is the wrong home; either move it onto `Quote` (preferred — the card already owns it), or document on the card why `OrderService` is now a Coordinator for pricing.

This conversation takes 90 seconds and prevents a six-month accretion of misplaced methods. The cards become a *contract* between the design session and the codebase.

A Java sketch of the fix the reviewer is pushing for:

```java
// Before: responsibility leaked to a service.
public final class OrderService {
    public Money applyPromoCode(Order order, PromoCode code) { /* ... */ }
}

// After: responsibility lives where the card put it.
public final class Quote {
    private final List<LineItem> items;
    private final Customer customer;

    public Quote withPromoCode(PromoCode code) {
        // "compute discount" — listed on the Quote card.
        return new Quote(items, customer, code.applyTo(subtotal()));
    }
}
```

---

## 5. Building a domain glossary alongside CRC

Every CRC session is also a glossary session — you can't argue about responsibilities without first naming the things. I keep a `docs/glossary.md` next to the card set and update it in the same PR.

A real entry from a logistics codebase I worked on:

```markdown
### Shipment
A physical movement of one or more parcels from one address to one address,
under a single carrier contract. Distinct from:
  - **Order** — the customer-facing purchase. One Order can produce multiple
    Shipments (split shipping).
  - **Consignment** — the carrier's term for a Shipment after handover.
    Our Shipment becomes a Consignment when the carrier API returns a tracking
    number; before that it is still our Shipment.
Aggregate root. CRC card: `cards/shipment.md`.
```

Notice the cross-reference to the card and the explicit boundary with neighbouring terms. The pairing works in both directions: the glossary disambiguates names that show up on cards; the cards prevent the glossary from becoming a dead document because the cards drive code review.

In Java terms, each glossary entry usually corresponds to a top-level type whose `package-info.java` documents it:

```java
/**
 * The shipment aggregate. See docs/glossary.md#shipment
 * and docs/design/cards/shipment.md.
 */
package com.example.logistics.shipment;
```

ArchUnit can then enforce that only `Shipment` itself uses the name `Shipment` as a class — see section 8.

---

## 6. Onboarding new hires with CRC walk-throughs

When a new engineer joins, the worst thing you can do is hand them a ticket and say "read the code". The best thing I have found is a 60-minute CRC walk-through of an existing aggregate.

The format:

1. Pull out the existing card set for one aggregate (say, `Pricing.Quote` and its 5 collaborators).
2. Read one canonical scenario aloud: *"A repeat customer with a 10% loyalty discount adds a bundle to their cart and views the price."*
3. Ask the new hire to walk through the scenario by picking up cards. They will get it wrong in instructive ways — they'll send messages to classes that shouldn't receive them. That's the point.
4. After each missed message, point to the card that *should* have received it and explain why.
5. End by asking them to add a new scenario (an edge case they invented) and walk through it themselves.

By the end of 60 minutes they have a mental model that would take them 3 weeks to build from reading code alone. They also know *where the cards live*, so when they hit a tricky question later they look at the card before they grep.

I now treat "first CRC walk-through" as a checklist item in the first-week onboarding doc. It pays back the time within the first PR.

The walk-through also tests the cards themselves. If the new hire keeps getting stuck at the same point — "I don't know who handles this" — that's a hole in the card set, not a hole in the hire. The fix lives in `docs/design/cards/`, not in onboarding slides.

---

## 7. Anti-patterns juniors will introduce

After running ~50 CRC sessions, these are the failure modes I look out for:

**Over-cards.** The team writes 40 cards for an 8-class feature. Every database column has become a class. Symptom: cards titled `OrderStatus`, `OrderTimestamp`, `OrderId`. Fix: ask "what behavior does this card have?" If the only answer is "it holds a value", it's a value object, not a card. Roll it back into its owner.

**Under-cards.** The team writes 3 cards (`Service`, `Repository`, `Controller`) and stops. Symptom: every responsibility on the `Service` card. Fix: ask "if `Service` does 18 things, what would I split it into?" Re-run the noun-storm, this time on the responsibilities themselves.

**No scenarios.** The team fills cards and feels productive — but never picks one up. Symptom: cards look great on paper, but two weeks later the code looks nothing like them. Fix: as facilitator, do not let the session end without two scenarios run end-to-end. The walk-through is the *test*, not a nice-to-have.

**Layer cards.** Cards named `OrderService`, `OrderController`, `OrderRepository`. These are framework layers, not domain concepts. Fix: ban any card whose name ends in `-Service`, `-Manager`, `-Helper`, `-Util`. Force a domain noun.

**UML drift.** Halfway through, someone starts drawing arrows with cardinalities. Symptom: the cards become a class diagram and the room starts arguing about `@OneToMany` vs `@ManyToOne`. Fix: rip up the arrows. CRC is behavioral, not structural — if you need a class diagram, do it *after* the cards stabilize, on a separate board.

**Card hoarding.** Someone won't tear up a card they wrote. Symptom: dead cards linger on the table. Fix: as facilitator, you tear them up. Cards are cheap. Attachment is the enemy.

**Premature stereotype tagging.** Junior facilitators sometimes ask the room to assign a stereotype (`Information Holder`, `Coordinator`, etc.) before the responsibilities are stable. Symptom: the room argues for ten minutes about whether `Quote` is a Holder or a Service Provider, while the responsibility list is still half-empty. Fix: stereotypes are a *late* exercise — tag them after the second walk-through, not before the first.

---

## 8. Tooling for capturing card sets

The single biggest mistake teams make is treating the cards as *workshop ephemera*. Photograph the table, then it goes to the slack channel, then nobody looks again. To make CRC pay back you need the cards in version control next to the code.

**Markdown in the repo.** My default. One file per card under `docs/design/cards/`. Each file is a 20–40 line Markdown table. The Markdown lives in the same PR as the code that implements those responsibilities, so the cards age with the code.

```
docs/design/
  cards/
    quote.md
    shipment.md
    consignment.md
    pricing-rule.md
  scenarios/
    repeat-customer-discount.md
    split-shipment.md
  glossary.md
```

**Notion (or similar wiki) for cross-team visibility.** I mirror the Markdown to Notion via a CI job so PMs can read it. The Markdown is the source of truth; Notion is a view. Never the other way around.

**ArchUnit to pin classes to cards.** This is where CRC stops being documentation and starts being enforced. ArchUnit lets you write JUnit tests that fail if a class violates an architectural rule. Pin classes to their card:

```java
@AnalyzeClasses(packages = "com.example.pricing")
class PricingCardRulesTest {

    @ArchTest
    static final ArchRule quote_only_collaborates_with_carded_classes =
        classes().that().haveSimpleName("Quote")
            .should().onlyDependOnClassesThat(
                JavaClass.Predicates.simpleNameStartingWith("Money")
                    .or(JavaClass.Predicates.simpleName("PricingRule"))
                    .or(JavaClass.Predicates.simpleName("Customer"))
                    .or(JavaClass.Predicates.simpleName("Quote"))
            )
            .because("Quote's CRC card lists: Money, PricingRule, Customer. "
                  + "If a new collaborator is needed, update cards/quote.md "
                  + "in the same PR.");
}
```

The `because` clause is doing the work: when a future engineer adds a stray dependency, the test fails with a message pointing them straight at the card. The card becomes executable architecture.

I don't try to pin *every* class — pin the aggregate roots and the high-traffic services. That's enough to prevent the design from rotting silently.

A second ArchUnit pattern worth knowing is the *naming pin*: forbid any class whose name matches a banned suffix unless it appears on a card. This catches the layer-card anti-pattern at CI time:

```java
@ArchTest
static final ArchRule no_service_classes_outside_cards =
    noClasses().that().haveSimpleNameEndingWith("Manager")
        .should().resideInAnyPackage("com.example..")
        .because("'Manager' is a layer-card smell. Use a domain noun "
              + "from docs/design/cards/ or justify in the PR description.");
```

---

## 9. Quick rules

- [ ] 90-minute time-box. Two scenarios minimum, run end to end, before you stop.
- [ ] No laptops, no method signatures, no arrows. Cards and a marker.
- [ ] Capture to Markdown in the repo within 24 hours, or it didn't happen.
- [ ] Every card has a stereotype tag and a scenario it was discovered in.
- [ ] Pair the cards with a glossary file in the same directory.
- [ ] Ask "what card is this from?" in every code review of a new class.
- [ ] Pin aggregate roots to their cards with ArchUnit; let the `because` clause point future engineers home.
- [ ] Use CRC for onboarding — first week, 60 minutes, one aggregate.
- [ ] Watch for over-cards, under-cards, layer-cards, and silent skipping of walk-throughs.
- [ ] Cards are not precious. Tear them up.

---

## 10. What's next

| Topic                                                       | File                                          |
| ----------------------------------------------------------- | --------------------------------------------- |
| Responsibility-Driven Design — the stereotypes CRC tags use | `../04-responsibility-driven-design/`         |
| The class-finding heuristics CRC kicks off from             | `../02-finding-classes-noun-extraction/`      |
| Event Storming — CRC's bigger-room cousin                   | (covered in `senior.md`)                      |
| ArchUnit deep-dive for pinning architecture                 | `../../../../testing/architecture-tests/`     |
| Domain glossary practice                                    | `../../../../../system-design/ddd/glossary/`  |

---

**Memorize this:** CRC at staff level is *facilitation, capture, and enforcement*. Run a 90-minute session with two scenarios; check the cards into the repo next to the code; ask "what card is this from?" in every review; pin the aggregates with ArchUnit. The cards stop being paper and become the contract the codebase has to keep.
