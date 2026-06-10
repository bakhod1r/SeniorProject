# Domain Modeling from Requirements — Interview

> Questions you should expect when interviewers want to see whether you can turn a paragraph of business requirements into a working object model — and defend the choices afterwards. Answers favour realistic Java domains (orders, bookings, auctions, payments) and aim to surface trade-offs rather than recite definitions.

---

## Q1. What is domain modeling, and how is it different from schema design?

Domain modeling is the act of building software objects that capture the *behavior* and *rules* of a business problem — what can happen, what cannot, who decides. Schema design is the act of laying out *storage* — tables, columns, foreign keys — so that data can be persisted and queried. The two overlap (a model usually needs persistence) but the goals differ: a schema optimises for storage, normalization, and query performance, while a model optimises for expressing rules clearly in code. A schema can be perfectly normalized and yet describe a system that has no idea why an order is "confirmed" versus "shipped". You can build a working CRUD app from a schema alone; you cannot build a system that enforces business invariants without a model.

```java
// Schema-shaped — works as a row, fails as a model:
class Order { Long id; String status; BigDecimal total; /* getters/setters */ }

// Model-shaped — encodes the lifecycle:
final class Order {
    private OrderStatus status; private Money total;
    public void confirm() { require(status == PLACED); status = CONFIRMED; }
}
```

**Trap:** Candidates who answer "domain modeling is drawing UML diagrams" miss the point — UML is a *notation*, not the act of modeling.

---

## Q2. What is the "ubiquitous language" and why should I care?

Ubiquitous language, coined by Eric Evans, is the shared vocabulary used by developers and domain experts to discuss the system — and the rule that this same vocabulary appears verbatim in class names, method names, and conversations. If the warehouse team calls something a "pick list", your code must call it `PickList`, not `OrderDispatchDTO`. The payoff is that meetings, code reviews, and bug reports stop requiring translation; "the booking was rejected because the cutoff passed" maps one-to-one onto `Booking.cancel()` throwing `CutoffPassedException`. Without it, developers slowly invent their own dialect and the model drifts from the business until nobody can answer "what does this code actually do?". Keep a glossary; update it when experts use a new word, and refactor class names when the language changes — code that lies about names is worse than code with no comments.

```java
// Database-flavoured names:
class Transaction { ... }  class OrderDispatchDTO { ... }

// Business-flavoured names — what the expert actually says:
final class Payment { ... }  final class PickList { ... }
```

**Follow-up:** "What if two teams use different words for the same thing?" — That is a sign of two bounded contexts, not a naming dispute.

---

## Q3. What is a bounded context and when do you split one?

A bounded context is a region of the system where one model and one ubiquitous language apply consistently. You split a context when you notice the *same word* (e.g. `Customer`) meaning different things to different teams — to Sales it is lifetime value and contract terms; to Shipping it is an address and a delivery window; to Support it is a ticket history. Forcing one mega-`Customer` to serve all three creates a god object with contradictory invariants. The right split gives each team its own model — `SalesCustomer`, `Recipient`, `SupportContact` — linked only by a stable identifier, with a translation layer (anti-corruption layer) at the boundary. Other triggers for splitting: different change cadences, different stakeholders, different lifecycles, or a context that has grown beyond what one team can hold in its head.

```java
// In sales context:
final class SalesCustomer { CustomerId id; Money lifetimeValue; SalesRep owner; }

// In shipping context — same person, different model:
final class Recipient { CustomerId id; Address shipTo; DeliveryWindow window; }
```

**Trap:** "One microservice per bounded context" — convenient slogan, but a bounded context is a *modeling* concept; deployment topology is independent.

---

## Q4. Critique the "underline the nouns, those are your classes" method.

It is a beginner's heuristic that produces a *schema* shaped like the requirements sentence, not a *model* shaped like the domain's behavior. Nouns surface easily — `Order`, `Customer`, `Product` — so the technique feels productive, but the *decisions* (is the customer credit-worthy? did payment succeed? can shipping start?) live in the white space between sentences and never get classes of their own. The result is anaemic data holders glued together by service classes that hoard all the logic. It also fails when the same English noun maps to multiple concepts (the "Customer" problem above) or when an important concept has no noun at all in the requirements — "the system must reject duplicate submissions within five seconds" implies an `IdempotencyKey` that no requirement sentence will name.

**Follow-up:** "What should you look for instead?" — Events and decisions; let the objects fall out as owners of those decisions.

---

## Q5. Compare Event Storming, CRC cards, and UML — when do you use each?

Event Storming is for *discovery* with a room full of stakeholders: sticky notes on a wall, orange for domain events, blue for commands, yellow for actors. Use it at the start of a project or when entering an unfamiliar domain — it surfaces the lifecycle and the actors fast, with no code. CRC (Class–Responsibility–Collaborator) cards are for *behavior assignment* once you have a list of scenarios: walk through a use case out loud, and for each step ask "who is responsible?" — perfect for a small team designing a single bounded context. UML is for *communication* of an already-understood design — class or sequence diagrams in documentation, architecture decision records, or onboarding material. UML is the worst tool for discovery (it pushes you toward static structure too early); Event Storming is the worst tool for documentation (a photo of sticky notes ages badly). In practice, a healthy project uses all three in sequence: Event Storming kicks off the project, CRC refines a single context, and a UML class diagram in the README explains the result to new joiners.

**Trap:** Treating UML as the design itself — the design lives in code; UML is one view of it.

---

## Q6. What is a value object, and when does something become an entity?

A value object is an immutable type whose identity is its *contents* — two `Money(100, "USD")` instances are the same money. An entity has an identity that persists across changes — order #4711 is still order #4711 after its line items, address, and total change. Decide by asking "if I copy this and change a field, is it still the same thing in the business?". Money, time slots, addresses, currency codes, and percentages are usually values; orders, customers, bookings, and shipments are usually entities. The practical payoff of preferring values: immutability eliminates a whole class of bugs (no aliasing, no defensive copies, safe to share across threads), and equality based on content makes them safe to use as map keys.

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        if (amount.scale() > currency.getDefaultFractionDigits())
            throw new IllegalArgumentException("scale too large");
    }
    public Money plus(Money other) {
        if (!currency.equals(other.currency)) throw new CurrencyMismatchException();
        return new Money(amount.add(other.amount), currency);
    }
}
```

**Follow-up:** "Can an entity contain value objects?" — Yes, that's the most common composition; value objects are the *fields* of entities.

---

## Q7. What is an aggregate root, and how do you pick one?

An aggregate is a cluster of objects that change together and must be saved or rejected as a unit; the aggregate root is the *only* object outside code may hold a reference to or modify. Pick the root by asking "which object's invariants would be violated if outsiders bypassed it?" — for an order with line items, the `Order` owns "total = sum of lines × prices", so it must be the root; line items are reachable only through it. Keep aggregates small — one root, a handful of internal objects — because the whole aggregate is the unit of transactional consistency, and large aggregates produce contention. If two parts of your candidate aggregate can change independently and don't share an invariant, they probably belong to different aggregates linked by ID.

```java
public final class Order {
    private final OrderId id;
    private final List<LineItem> lines = new ArrayList<>();   // internal — no outside access
    public void addLine(ProductId p, int qty, Money unitPrice) { /* enforces invariants */ }
    public Money total() { return lines.stream().map(LineItem::subtotal).reduce(Money.ZERO, Money::plus); }
}
```

**Trap:** Making every entity its own aggregate root — you lose invariants; making one huge aggregate — you lose concurrency.

---

## Q8. Critique this anaemic model.

```java
public class Order {
    private Long id;
    private String status;
    private BigDecimal total;
    // getters and setters for every field
}
public class OrderService {
    public void confirm(Order o) {
        if (!"PLACED".equals(o.getStatus())) throw new IllegalStateException();
        o.setStatus("CONFIRMED");
        repo.save(o);
    }
}
```

`Order` is a typed map: every field public via setters, no rule it enforces by itself. The state machine — "you can only confirm a placed order" — lives in the service, so anyone with a reference to an order can mutate `status` directly and bypass the rule. `String` for status invites typos (`"CONFRIMED"` compiles). The fix is to move the verb onto the entity: `order.confirm()` checks its own state and transitions; expose `status()` read-only; replace the string with an `OrderStatus` enum or sealed type. The service shrinks to coordination (loading, persisting, dispatching events) — it stops holding business rules.

**Follow-up:** "Why is anaemic so common?" — Frameworks (JPA, getters/setters, DTO-mapping tools) reward exposing fields; teams default to it without thinking.

---

## Q9. How do you handle invariants that span multiple aggregates?

Inside one aggregate, invariants are enforced synchronously by the root — `Order.total` always equals the sum of its lines. Across aggregates, you accept *eventual* consistency: the rule is enforced by a domain event plus a handler, not by a single transaction. Example: when an order is placed, you need to reserve inventory; the order aggregate publishes `OrderPlaced`, and an inventory handler reduces stock in a separate transaction. If the reservation fails, you compensate — cancel the order, notify the customer. The temptation to wrap two aggregates in one big transaction usually means you've drawn the boundary wrong; either the two are really one aggregate, or they genuinely are independent and need a saga/compensation. Document which invariants are strong (within an aggregate) and which are eventual (across aggregates) so reviewers know the difference.

```java
// Order aggregate emits — does not call inventory directly:
order.place(); events.publish(new OrderPlaced(order.id(), order.lines()));

// Inventory handler runs in its own transaction; failure → compensating event:
@EventListener void on(OrderPlaced e) {
    try { inventory.reserve(e.lines()); }
    catch (OutOfStockException ex) { events.publish(new OrderRejected(e.orderId(), "stock")); }
}
```

**Trap:** Reaching for two-phase commit — almost always a sign the model needs rethinking, not stronger transactions.

---

## Q10. Critique: a "Service" doing what the aggregate should.

```java
public class BookingService {
    public Booking book(Room r, Employee e, TimeSlot slot, int partySize) {
        if (partySize > r.getCapacity()) throw new RoomTooSmallException();
        if (overlaps(r.getBookings(), slot)) throw new RoomUnavailableException();
        Booking b = new Booking();
        b.setRoom(r); b.setEmployee(e); b.setSlot(slot);
        r.getBookings().add(b);
        return b;
    }
}
```

The service holds two rules that belong to `Room`: capacity check and overlap check. Anyone who skips the service and calls `room.getBookings().add(...)` directly bypasses both. The model leaks its invariants because the data lives in `Room` but the decisions live elsewhere. Refactor: move the logic onto `Room` as `room.book(employee, slot, partySize)` returning a `Booking`; make `bookings` private and expose only what the API needs; remove setters from `Booking`. The service then has one job left — load the room, call `book`, save — and you can no longer create a broken booking by accident.

**Follow-up:** "Are services always bad?" — No; application services for orchestration and cross-aggregate coordination are fine. The smell is logic that depends on one aggregate's data living outside that aggregate.

---

## Q11. How does domain modeling interact with JPA / Hibernate?

JPA tempts you to model the database first — `@Entity`, `@Id`, public setters, `@OneToMany` with lazy loading — and then call that your domain model. The trade-off is that some JPA constraints push back against good modeling: it needs a no-arg constructor, it dislikes truly immutable types, and it makes value objects with multiple fields awkward (you need `@Embeddable`). Pragmatic approach: write the domain model how the *domain* wants it, then map it. Use `@Embeddable` for value objects, package-private setters Hibernate can call via reflection, factory methods or constructors for the real creation path, and `@Access(FIELD)` to keep getters/setters off the public API. If the friction becomes unbearable for an aggregate, separate the persistence model from the domain model and translate at the repository — pay the mapping cost to keep both clean.

```java
@Entity @Access(FIELD)
public class Order {
    @EmbeddedId private OrderId id;
    @Embedded private Money total;          // value object mapped inline
    @Enumerated(STRING) private OrderStatus status;
    protected Order() {}                    // JPA-only, package-private
    public Order(OrderId id) { this.id = id; this.status = PLACED; }
    public void confirm() { require(status == PLACED); status = CONFIRMED; }
}
```

**Trap:** Letting JPA annotations dictate visibility — `public` setters everywhere because "Hibernate needs them" is folklore; package-private or field access works fine.

---

## Q12. Walk me through modeling an auction.

Start with events: `AuctionListed`, `BidPlaced`, `BidRejected(reason)`, `AuctionExtended` (anti-sniping), `AuctionEnded`, `WinnerDeclared`, `AuctionCancelled`. Decisions: is the bid above the current high plus minimum increment? is the auction still open? does the bidder have a verified payment method? does a last-second bid extend the close time? The aggregate root is `Auction`; it owns the current high bid, the close time, and the rule engine for accepting bids. `Bid` is a value object — content-equal bids would be indistinguishable — referenced by ID for audit purposes if needed. `Money` is a value object enforcing currency consistency. Closing is triggered by a scheduler that calls `auction.close(clock.now())`, which validates the time, picks the winner, emits `AuctionEnded`, and freezes further bids. Cross-aggregate concerns (charging the winner, notifying losers) happen via events handled by `Payment` and `Notification` contexts respectively, not by reaching into other aggregates.

```java
public final class Auction {
    private Money highBid;
    private BidderId highBidder;
    private Instant closesAt;
    public void placeBid(BidderId b, Money offer, Clock clock) {
        if (!clock.now().isBefore(closesAt)) throw new AuctionClosedException();
        if (offer.compareTo(highBid.plus(increment)) < 0) throw new BidTooLowException();
        highBid = offer; highBidder = b;
        if (Duration.between(clock.now(), closesAt).compareTo(ANTI_SNIPE) < 0) closesAt = clock.now().plus(ANTI_SNIPE);
    }
}
```

An interviewer who pushes further will ask about clock handling (use an injected `Clock`, never `Instant.now()` inside the aggregate, so tests can advance time) and idempotency of bid submission (key each command with a unique id stored on the bidder side, reject replays at the application service before they reach the aggregate). The model stays small and rule-rich because everything not directly related to the auction's invariants — payments, notifications, analytics — lives in other contexts that subscribe to events.

**Follow-up:** "How would you support live updates to all watchers?" — `BidPlaced` event consumed by a notification context; the auction aggregate doesn't know about WebSockets.

---

## Q13. How do you know when the model is wrong? Give red flags.

Six recurring smells: (1) you keep adding fields to one class and most methods only touch a subset — it's two concepts fused; (2) the team argues about what a class "really represents" — naming pain means concept pain; (3) most logic lives in `*Service` classes and entities are bags of getters/setters — anaemic model; (4) you can produce an invalid object through the public API (e.g. an order with no lines or a negative total) — invariants leak; (5) a change in the business requires touching ten unrelated files — the boundaries don't match the change axis; (6) you find yourself writing comments to explain *what* a method does instead of *why* — the names lie. Any one of these is a hint; two together is a refactor signal; three or more is "stop and re-model". A seventh, subtler one: when a domain expert reads the code and asks "where is the rule about cancellation cutoff?", you have to scroll through four files to show them — the rule has no single home.

**Trap:** Treating these as a checklist for new code — they are most useful as a *review* lens on code already in production.

---

## Q14. Money in domain models: `double` vs `BigDecimal` vs a `Money` value object?

`double` is wrong for money in any production system — binary floating-point can't represent `0.1` exactly, so sums drift and equality checks lie. `BigDecimal` fixes the precision problem but is still just a number — it carries no currency, no scale rule, and exposes a sprawling API where `divide` requires a rounding mode and `equals` distinguishes `1.0` from `1.00`. A `Money` value object wrapping `BigDecimal` and `Currency` solves both: it rejects currency mismatches at construction, hides rounding choices behind named operations (`allocate`, `split`), and gives you content-based equality the business actually wants. Cost: a tiny bit more code and one more type to learn. Use `BigDecimal` directly only for one-off internal calculations where currency is obviously fixed and unambiguous; for anything that crosses an API boundary, `Money` pays for itself within a sprint.

```java
public record Money(BigDecimal amount, Currency currency) implements Comparable<Money> {
    public Money plus(Money o) { require(currency.equals(o.currency)); return new Money(amount.add(o.amount), currency); }
    public int compareTo(Money o) { require(currency.equals(o.currency)); return amount.compareTo(o.amount); }
}
```

A second discussion point an interviewer may probe: rounding policy. Real systems split bills (10.00 EUR split three ways must allocate to 3.34 + 3.33 + 3.33, not 3.33 + 3.33 + 3.33 with a rounding error), and that allocation rule belongs to `Money`, not to whoever happens to call it. Hiding it inside the type means every caller gets the same answer; spreading it across services means every caller gets a slightly different one.

**Follow-up:** "What about JPA?" — Map as `@Embeddable` with two columns (`amount`, `currency`); keep equality and ordering on the type.

---

## Q15. When is domain modeling overkill — should you just write CRUD?

When the business has *no* invariants worth enforcing — an admin tool that lets a human edit any field, a configuration screen, an internal reporting view — a CRUD pipeline (DTO to controller to JPA entity) is faster and honestly clearer. Investing in aggregates and value objects there is ceremony, not insurance. Domain modeling earns its cost when there are rules whose violation would harm the business: money, scheduling, fulfillment, regulated processes, anything with a state machine. A common pragmatic split: model the bounded contexts that have real rules, and keep CRUD for the maintenance corners. The risk is the wrong call — what looked like CRUD ("just a settings page") grows rules over time, and at some point you must either retrofit a model or accept permanent fragility. A useful test: if you can describe the screen as "the user edits these fields, we save them, we read them back later", it's CRUD; if any sentence contains "but only if" or "unless", you have rules and need a model.

**Trap:** "We'll add the model later if we need it" — almost never happens cleanly; rules accumulate as `if` statements and the rewrite never gets prioritised.

---

## Q16. How do you involve domain experts without overwhelming them with code?

You bring the conversation *to* their world: Event Storming workshops with sticky notes, scenario walk-throughs in plain English, glossaries written in their words, example tables that read like business rules ("If the booking is within 30 minutes of start, cancellation is rejected"). You bring snippets of code back to them only when a specific term is in dispute, and you read the code aloud as English ("the room books the slot for the employee") — if it doesn't read naturally, the names are wrong. The fastest feedback loop is *example-driven*: pick three concrete scenarios, encode them as failing tests or BDD-style specs, and walk the expert through them. They will spot missing rules within minutes — far faster than reviewing a class diagram.

```java
// Read aloud — does it sound like the business?
room.book(employee, slot, partySize);
booking.cancel(clock);
auction.placeBid(bidder, offer, clock);
```

**Follow-up:** "What if the expert is wrong or contradicts themselves?" — Capture the contradiction; it usually means two contexts the expert hasn't separated either.

---

## Q17. Defend the choice of a rich aggregate against a teammate who insists on "thin entities + fat services".

Two real points to make. First, *invariants must live with their data*; if the rule "total = sum of lines" is in `OrderService` while `lines` are in `Order`, every new caller risks bypassing the service and creating an inconsistent order — the type system stops helping you. Second, *services scale badly with rules*; once a service grows past a few methods, its dependencies multiply (it needs every entity it touches), tests get harder, and the original behavior disperses across helpers. The rich-aggregate version reads like the business: `order.confirm()`, `order.cancel(reason)`, `order.ship()` — each method enforces its own preconditions, and the service layer becomes a thin coordinator handling persistence, transactions, and events. The compromise position — services for cross-aggregate work, rich aggregates for within-aggregate rules — wins almost every real codebase.

**Trap:** Conceding "but Spring style guides show fat services" — those examples are tutorials, not architecture guidance; production teams that follow them religiously end up with the anaemic problem.

---

## Q18. How do domain events fit into the model, and where do you publish them from?

Domain events name the moments the business cares about — `OrderPlaced`, `PaymentReceived`, `BidAccepted`, `ShipmentDispatched` — and they are first-class citizens of the model, not an infrastructure concern. The aggregate that produced the change is the right place to *record* the event: `order.confirm()` mutates state and appends `new OrderConfirmed(id, clock.now())` to an internal list. The aggregate does *not* publish to a message bus directly — that couples the model to infrastructure and makes tests harder. Instead, the application service (or repository) drains the events after a successful commit and hands them to the dispatcher. The payoff is that events become a built-in audit log, drive cross-aggregate workflows without leaking references, and let you replay history to debug or rebuild read models.

```java
public final class Order {
    private final List<DomainEvent> events = new ArrayList<>();
    public void confirm(Clock clock) { require(status == PLACED); status = CONFIRMED;
        events.add(new OrderConfirmed(id, clock.now())); }
    public List<DomainEvent> drainEvents() { var copy = List.copyOf(events); events.clear(); return copy; }
}
```

**Follow-up:** "What if publishing fails after the commit succeeds?" — Use the transactional outbox pattern: write events to a table in the same transaction, publish them with an at-least-once worker.

---

## Closing thought — what interviewers are really checking

These questions look like definitions but they all probe the same skill: can you take a fuzzy paragraph and produce a model where the *rules* are visible and the *invariants* are unbreakable from outside? Strong candidates do three things almost reflexively. They name events and decisions before nouns. They ask "what owns this invariant?" before drawing arrows. They reach for value objects the moment a primitive starts carrying meaning. Weak candidates produce a class diagram that matches the schema and call it a day; you can tell within five minutes which kind someone is, because the strong candidate's first question back is usually "what happens when this fails?".

---

**Memorize this:** events and decisions first, objects second; invariants live with the data they constrain; value objects everywhere primitives leak meaning; aggregates draw the consistency boundary; the same business words from the meeting room must appear unchanged in the code.

---

> If you can answer Q1, Q4, Q7, Q8, Q10, and Q14 cleanly — with code on the table, not just definitions — you will pass any reasonable domain-modeling round. Everything else in this file is depth for the principal-level conversation.
