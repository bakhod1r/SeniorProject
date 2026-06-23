# CRC Cards — Interview Q&A

> Behavior-first design, paper-first execution. Fourteen-plus questions covering history, mechanics, comparisons with UML and Event Storming, common failure modes, and the path from cards to Java packages.

---

## Q1. What does CRC stand for, and who invented the technique?

CRC stands for **Class, Responsibility, Collaboration**. It was introduced by **Ward Cunningham and Kent Beck** in their 1989 OOPSLA paper *"A Laboratory for Teaching Object Oriented Thinking"*. They were trying to teach Smalltalk programmers to think in objects instead of in procedures, and discovered that small physical cards forced people to design behavior before they argued about syntax. The cards were originally 4×6 inches — the constraint was deliberate: a class whose responsibilities don't fit on a card is probably doing too much. The technique predates UML by several years and was meant to be lighter, more conversational, and friendlier to non-coders sitting in the room. Rebecca Wirfs-Brock later extended the underlying idea into full Responsibility-Driven Design, but the original technique remains intact: low ceremony, paper-first, behavior before structure.

**Trap:** Candidates sometimes confuse CRC with *Cyclic Redundancy Check*. If your interviewer is from a systems background, clarify the acronym up front.

---

## Q2. What belongs on a CRC card, and what is deliberately left off?

A card has three regions: the **class name** at the top, a **responsibilities** list on the left half (2–6 short verb phrases), and a **collaborators** list on the right half (names of other cards this class needs). What's left off is everything implementation-related: fields, method signatures, return types, access modifiers, package paths, frameworks, persistence concerns. Even cardinalities ("1..*") are out of scope — those belong on a class diagram once the model has stabilized. The point is to keep the discussion at the level of *who is responsible for what behavior*, so that you can move responsibilities between cards without rewriting code that doesn't yet exist. Some teams add an optional stereotype tag in a corner (Information Holder, Coordinator, etc.), but everything else stays off the card on purpose.

```
+----------------------------------------+
| Class: Order                           |
+--------------------+-------------------+
| Responsibilities   | Collaborators     |
+--------------------+-------------------+
| - know my items    | LineItem          |
| - compute total    | Money             |
| - place myself     | InventoryService  |
| - mark shipped     | (self)            |
+--------------------+-------------------+
```

**Follow-up:** *"Why no fields?"* — Fields are the answer to *how* a responsibility is fulfilled; CRC fixes *what* the responsibility is first.

---

## Q3. How do you pick the initial set of candidate classes?

The standard heuristic is to **underline the nouns** in your requirements document or user story and write one card per noun that survives a quick sanity pass. You then ruthlessly prune nouns that turn out to be values ("the price"), attributes of another class ("the customer's address"), or English filler ("the system"). Be generous in the first pass — it is cheaper to write a card you later tear up than to miss a class you needed. Domain experts and Event-Storming output (if you have one) are also rich sources of candidates, and so are the **verbs** in the spec: each verb usually points at a responsibility, and the class that owns that verb is sometimes hiding in plain sight. A good rule of thumb is to start with 6–12 candidate classes for a typical feature and expect to end with roughly half that count after the first walk-through, with one or two newly-discovered cards added that no one wrote down at the start.

**Trap:** Treating every grammatical noun as a class produces a model full of passive nouns like `Display`, `Manager`, `Handler`, none of which actually own behavior.

---

## Q4. What does the role-play walk-through actually accomplish?

The walk-through is the *test* that the cards are correct. By picking up a card and **speaking for the object in first person** — "I am the Order. I'm being told to add a line item. I ask the Product if it is in stock…" — you immediately notice when a card has nowhere to send a message, or when two cards both think they own the same responsibility. It also surfaces missing classes: if no card can answer "who validates that there is enough credit?", a new card needs to be created. The walk-through is conversational, so non-engineers can participate and catch domain mistakes that a UML diagram would hide behind notation. The act of physically holding the card forces you to commit to whose voice you are speaking in, which is exactly the encapsulation discipline you want every method to follow later.

**Follow-up:** *"What if no one is comfortable role-playing out loud?"* — The session leader takes the first card and models the behavior; this usually breaks the ice within one scenario.

---

## Q5. CRC versus UML class diagrams — when does each win?

UML class diagrams are **stronger for structure**: cardinalities, inheritance hierarchies, packages, and generated code stubs are all native concepts in UML and absent in CRC. CRC is **stronger for behavior**: it forces the conversation about *who does what*, which UML notation can quietly elide. UML scales better as a long-lived artifact (it can be checked into a repo and regenerated); CRC scales better as a 90-minute design conversation because everyone can participate without learning the notation. Many teams use them together — CRC during the design session, then convert the stabilized cards to a UML class diagram for the wiki — but UML alone tends to skip the "who owns this responsibility" debate that CRC forces. A useful test in interviews: if you can't answer "who tells the order to ship?" from looking at the UML diagram, the diagram is a *data model*, not a *design*, and CRC would have caught it.

**Trap:** Treating CRC and UML as competitors. They operate at different stages of the design pipeline.

---

## Q6. CRC versus Event Storming — when does each fit?

Event Storming starts from **domain events** ("OrderPlaced", "PaymentReceived") and works outward to commands, aggregates, and policies; it is excellent for understanding a domain you don't yet know and for spanning multiple bounded contexts. CRC starts from **candidate classes** and works inward to their responsibilities; it is excellent once you already have a vocabulary and need to decide who owns each behavior. In practice, Event Storming is a *discovery* tool used early in a project, and CRC is a *design* tool used after the events and aggregates are roughly known. For a brand-new domain with many stakeholders, run Event Storming first; for a familiar domain or a single bounded context, jump straight to CRC.

A useful comparison table:

| Aspect           | Event Storming                  | CRC Cards                          |
| ---------------- | ------------------------------- | ---------------------------------- |
| Starting point   | Domain events (past-tense verb) | Candidate classes (nouns)          |
| Output           | Timeline of events and policies | Pile of class responsibility cards |
| Best for         | Cross-team discovery            | In-team design of one feature      |
| Typical duration | Half-day to two days            | 30–90 minutes                      |
| Tooling          | Long wall, sticky notes         | Index cards or a small whiteboard  |

**Follow-up:** *"Can you do both in one session?"* — Yes, but allow at least a half-day; the cognitive shift between event-thinking and class-thinking is large.

---

## Q7. How does CRC connect to RDD stereotypes?

Responsibility-Driven Design (Rebecca Wirfs-Brock, 2003) extends CRC by assigning each class a **stereotype**: Information Holder, Structurer, Service Provider, Coordinator, Controller, or Interfacer. When you write a CRC card, the stereotype goes in a small box near the class name and constrains what kinds of responsibilities are acceptable. An Information Holder card whose responsibility list reads "decide whether to ship" is mis-classified — that is a Coordinator responsibility. Adding the stereotype makes CRC cards self-checking and helps you catch god classes early, because a god class is usually a card that wears two or three stereotype hats simultaneously.

```
+--------------------------------------------------+
| Class: PaymentGateway      <<Interfacer>>        |
+----------------------+---------------------------+
| Responsibilities     | Collaborators             |
+----------------------+---------------------------+
| - charge a card      | StripeClient              |
| - refund a charge    | StripeClient              |
| - translate errors   | PaymentError              |
+----------------------+---------------------------+
```

**Trap:** Adding stereotypes without re-examining the responsibilities — the stereotype is supposed to make you delete or move entries, not just decorate the card.

---

## Q8. Critique this card. Is the responsibility list actually a field list?

```
Class: Customer
  Responsibilities                  Collaborators
  - id                              (none)
  - email                           (none)
  - addressLine1                    (none)
  - createdAt                       (none)
  - orders: List<Order>             Order
```

Every entry is a noun. None of them describe behavior. This is a database schema written in CRC notation, and it tells us nothing about who owns which decision. A correct rewrite uses **verbs**: "know how to contact me" (replaces email/address), "know my purchase history" (replaces orders), "decide whether I qualify for a loyalty discount" (a new responsibility that didn't appear at all when we were listing fields). Note also that the collaborators column collapses: most fields collaborate with nothing, but the behavior "qualify for loyalty discount" might collaborate with an `OrderHistory` card, which is a new candidate class the data view hid.

The corrected card:

```
Class: Customer
  Responsibilities                  Collaborators
  - know how to contact me          (none)
  - know my purchase history        OrderHistory
  - qualify for loyalty discount    OrderHistory, LoyaltyPolicy
  - confirm a shipping address      Address
```

**Follow-up:** *"What is the cheapest fix?"* — Cross out every entry that doesn't start with an active verb, then ask "what does this class **do**?" for each remaining gap.

---

## Q9. When do you stop drawing cards?

You stop when the cards become **stable across two consecutive walk-throughs** of different scenarios. Concretely: if you can walk through the happy path *and* an exceptional path (out-of-stock, payment declined, partial cancellation) without adding, splitting, merging, or deleting a card, the model is good enough to code. Another stopping signal is when every responsibility on every card maps cleanly to one or two methods in your head — you are now thinking in code rather than in cards. A useful negative signal is when discussion shifts from "who owns this?" to "what should we name this method?"; that means the model is settled and you should leave the room and open the IDE. The opposite mistake — running the session until every objection is satisfied — wastes time, because some objections only get resolved by actually writing code and seeing what breaks.

**Trap:** Stopping after the happy-path walk-through alone. Edge cases almost always reveal one missing responsibility.

---

## Q10. Should CRC sessions be done remotely, and if so, how?

Yes, with adjustments. Use a virtual whiteboard (Miro, FigJam, Excalidraw) and template each card as a sticky note sized so only a few lines fit — preserve the "if it doesn't fit, it's too big" constraint. Pin one person as the **card-mover**: when role-playing, they drag the active card to the centre of the canvas so everyone can see which object is currently "speaking". Keep cameras on and require people to **speak in first person** during walk-throughs — the role-play is what makes CRC work, and it tends to atrophy when participants are silent. Record the session for absent stakeholders, but treat the final pinned board (not the recording) as the canonical artifact.

A remote-CRC checklist worth keeping:

- Limit the call to 6 people; anyone else joins as a silent observer.
- Pre-fill the candidate-class column before the call so synchronous time is spent on responsibilities and walk-throughs, not naming.
- Use color-coded stickies (one color per stereotype) so the board reads at a glance.
- Snapshot the board after every walk-through; this becomes your design history.

**Follow-up:** *"Can you do CRC entirely asynchronously?"* — Partially. You can collect candidate classes and initial responsibilities async, but the walk-throughs must be synchronous.

---

## Q11. Walk through a CRC design for a hotel booking system.

Initial candidate classes from the brief: `Hotel`, `Room`, `Guest`, `Reservation`, `Payment`, `Calendar`. First-pass cards:

```
Class: Reservation
  Responsibilities                  Collaborators
  - know who booked me              Guest
  - know which room and dates       Room
  - know my payment status          Payment
  - confirm / cancel                Room, Payment

Class: Room
  Responsibilities                  Collaborators
  - know my type and rate           (none)
  - know which dates I'm occupied   Reservation
  - reserve a date range            Reservation
```

Walking through "guest books a king room for next weekend" surfaces two problems. First, *availability checking* has no home — neither `Room` nor `Reservation` owns "is this date range free across all reservations?" We add a new card, `Availability`, with the responsibility "decide whether a room is free for a date range". Second, *rate calculation* (weekend surcharges, length-of-stay discounts) was buried inside `Reservation.confirm`; we extract it to a `RateQuote` card. After a second walk-through for "guest cancels with 24-hour penalty", `Payment` splits into `Charge` and `Refund`, because they have different lifecycles and different collaborators.

After the splits, the stabilized cards include:

```
Class: Availability
  Responsibilities                  Collaborators
  - decide if a room is free        Reservation
    for a date range
  - list free rooms for a stay      Room, Reservation

Class: RateQuote
  Responsibilities                  Collaborators
  - compute nightly rate            Room
  - apply weekend surcharge         (none)
  - apply length-of-stay discount   (none)
```

**Trap:** Letting `Reservation` accumulate every responsibility because it sits at the center of the use case — that produces a 200-line god class six months later.

---

## Q12. How do CRC sessions go wrong in practice?

The five most common failure modes are: **(1)** Skipping the walk-through and treating the card list as the deliverable; without role-play, missing responsibilities never surface. **(2)** Letting the most senior person dictate every card, which kills the conversational benefit. **(3)** Drifting into method signatures and parameter types mid-session, which collapses the abstraction back into code. **(4)** Treating every English noun as a class, producing passive cards like `Manager`, `Handler`, `Processor` that own no real behavior. **(5)** Refusing to throw cards away — once an idea is on cardboard, people get attached to it, but the technique only works if revision is cheap. A sixth, more subtle failure is **inviting too many people**: above about six participants the role-play collapses into committee-design and nobody speaks for any card.

**Follow-up:** *"How do you prevent (2)?"* — Rotate the role of card-mover every scenario, and require that the most junior person walks through the first scenario.

---

## Q13. What are the best practices when translating cards into Java packages?

A useful default is **one card → one top-level class**, **one responsibility → one or two public methods**, and **collaborators → constructor-injected dependencies**. Cards that share a bounded context become a package; cards from different bounded contexts must not import each other directly (introduce an interface in a shared package instead). Information-Holder cards typically become immutable records; Coordinator cards become services with no state; Interfacer cards become ports with adapter implementations. Keep the card name and the class name identical for traceability — months later, anyone holding the card pile can grep for the file. If a responsibility doesn't fit cleanly into one or two methods, the card was too coarse and should be split *before* you write the class.

```java
// One card -> one class. Responsibilities map directly to methods.
public final class Reservation {
    private final Guest guest;
    private final Room room;
    private final DateRange dates;
    private PaymentStatus paymentStatus;

    public boolean confirm(Charge charge)   { /* "confirm" responsibility */ }
    public boolean cancel(RefundPolicy p)   { /* "cancel"  responsibility */ }
    public boolean isPaid()                 { return paymentStatus == PAID; }
}
```

A simple translation map worth memorizing:

| CRC element                | Java equivalent                                 |
| -------------------------- | ----------------------------------------------- |
| Class name                 | Top-level `class` or `record` of the same name  |
| Responsibility (verb)      | One or two public methods                       |
| Collaborator               | Constructor-injected field, interface preferred |
| Stereotype (Info Holder)   | Immutable `record` or final class               |
| Stereotype (Coordinator)   | Stateless service class                         |
| Stereotype (Interfacer)    | Port interface plus adapter implementation      |
| Cluster of related cards   | One package                                     |

**Trap:** Creating a package per *card* rather than per *cluster of cards*. That fragments the codebase and makes circular dependencies more likely.

---

## Q14. When should you *not* use CRC?

Skip CRC when the design is essentially fixed by the framework: a Spring REST controller that delegates to one service method has no design choice to make, and a card adds nothing. Skip it for **immutable value objects** (`Money`, `EmailAddress`, `Coordinate`) — their only responsibility is "be a value", which is the same on every card and not worth a 30-minute discussion. Skip it for **performance-critical hot paths** where the design is driven by data layout and cache locality rather than responsibility assignment; CRC has no vocabulary for "this must fit in an L1 cache line". And skip it for **trivial CRUD** with two or three entities, where any reasonable mapping will work and the ceremony costs more than it saves.

A quick decision rubric:

- Fewer than 4 candidate classes? Skip CRC, open the editor.
- One candidate class doing many things? Skip CRC, do a `Single Responsibility` refactor instead.
- Many candidate classes, unclear ownership? CRC is exactly the right tool.
- Many candidate classes across team boundaries? Event Storming first, then CRC inside one bounded context.

**Follow-up:** *"Is CRC useful for legacy code?"* — Yes, but inverted: write cards for the *existing* classes as a documentation exercise, then look for cards whose responsibility lists are unhappy.

---

## Q15. How do you choose between splitting a fat card and adding a new collaborator?

If the new responsibility uses **the same collaborators and the same data** as the existing ones, it probably belongs on the same card. If it introduces a new collaborator that none of the existing responsibilities need, that's a strong hint that you have a hidden class — extract it. A second test: try writing a one-sentence purpose for the card ("an Order represents a customer's intent to buy"). If a responsibility doesn't serve that purpose, it belongs on a different card. Wirfs-Brock's stereotype check is the third tool: if the card is half Information Holder and half Coordinator, the two halves want to be separate classes. A fourth, almost mechanical, test is the *lifecycle test*: responsibilities that live across different stages of an entity's life (pre-checkout vs. post-checkout, draft vs. published) almost always indicate two classes hiding in one card.

**Trap:** Splitting a card just because it has six responsibilities. The number of entries matters less than whether they cohere around a single purpose.

---

## Q16. What does a CRC pile look like when the design is finished?

A typical mid-size feature ends with **8–15 cards**, each with **3–5 responsibilities** and **1–3 collaborators**. No card has more than seven responsibilities (Miller's number is a useful upper bound). No card has zero collaborators *and* zero state — if it has neither behavior partners nor data, it shouldn't exist. The collaboration graph is mostly a tree or a DAG; widespread cycles are a smell. Every responsibility starts with an active verb, and every card maps to a Java class name a developer could write today without further conversation. The cards are dog-eared and rewritten — clean cards usually mean the session was performative rather than productive.

**Follow-up:** *"What do you do with the cards after the session?"* — Photograph them, transcribe the responsibilities into the class Javadoc, and keep the physical pile in a desk drawer for the next refactor.

---

## Q17. What is the "anthropomorphic" critique of CRC, and how do you respond?

Some practitioners argue that role-playing objects as people ("I am the Order, I do...") is misleading because real objects are passive memory holding methods, not little agents with intent. The counter-argument, and the one Cunningham and Beck originally made, is that **anthropomorphism is a learning shortcut**, not a literal claim about runtime. Speaking in first person forces you to commit to one object's perspective at a time, which is exactly the encapsulation boundary you will encode in the class. The danger is only real if a team confuses the metaphor with the implementation — e.g., believes objects literally "decide" things and grows them into agent-style god classes. Used as a design rehearsal, the anthropomorphism is precisely what gives CRC its power; in production code, the only thing that "speaks" is a method on a class.

**Trap:** Defending CRC as if the role-play *is* the design. The role-play is the *test of* the design; the cards are the design.

---

## Q18. How does CRC interact with TDD when you start writing code?

CRC and TDD compose naturally: each **responsibility on a card becomes a test name** in the form *"a Reservation can confirm itself when a Charge succeeds"*. Because responsibilities are already verb phrases, they translate to test method names with almost no rewording, which keeps your test suite a faithful description of the design conversation. Collaborators on the card show up as **test doubles** — if `Reservation` collaborates with `Charge`, the first test for `Reservation.confirm` stubs out `Charge` and asserts the interaction. The cards give you a roadmap of which classes to grow first: start with cards that have the fewest collaborators (leaves of the dependency graph) and work inward, so each new class can be tested against already-built collaborators rather than mocks.

**Follow-up:** *"Should the card or the test come first?"* — The card. The card decides *what* the class does; the test decides *how to prove it*.

---

## Q19. How do you defend CRC to a sceptical team lead who calls it "playing with paper"?

Lead with **measurable outcomes**: a 60-minute CRC session typically prevents one round of refactoring later, because responsibility ownership is decided before any class is written. Show a before/after example — a god class that became three cohesive classes after a single walk-through — rather than arguing the technique in the abstract. Frame CRC as a **risk-reduction practice** like code review: it costs an hour up front and saves multiple hours of arguing over PR comments about "which class should own this". Mention that it scales down well; you don't need a workshop, you can do CRC with two engineers and a stack of sticky notes during a coffee break. Finally, if the lead is metrics-driven, point to the correlation between teams that design behavior first (CRC, RDD) and lower cyclomatic complexity in the shipped code.

**Trap:** Promising that CRC will replace code reviews or architecture documents. It replaces *neither*; it shortens both.

---

## Q20. What does a senior engineer take *away* from a CRC session into the codebase?

Three artifacts: the **photographed card pile**, a **transcribed responsibility list** in each new class's Javadoc, and a **list of walked-through scenarios** committed as integration-test names. The cards themselves are throwaway, but the *decisions encoded on them* — who owns what, which collaborators are allowed — should be re-checkable from the code months later. A useful discipline is to add a comment block at the top of each class that mirrors its card:

```java
/**
 * Card: Reservation
 *
 * Responsibilities:
 *   - know who booked me and which room/dates
 *   - confirm myself when a Charge succeeds
 *   - cancel under a RefundPolicy
 *
 * Collaborators: Guest, Room, Charge, RefundPolicy
 */
public final class Reservation { ... }
```

When someone later proposes to add a new method to `Reservation`, the comment block forces them to ask: *is this a new responsibility, or does it really belong to a different card?* That single habit catches most god-class drift.

**Follow-up:** *"What do you do when the codebase disagrees with the card?"* — Update whichever is wrong; usually it's the code, but sometimes a walk-through revealed something the team forgot to update on the card.

---

**Memorize:** Class, Responsibility, Collaboration on one small card; verbs only; role-play in first person; stop when the cards stop changing; one card becomes one class.
