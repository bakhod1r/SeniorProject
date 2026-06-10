# Domain Modeling from Requirements — Junior

> **What?** *Domain modeling* is the act of turning a written or spoken description of a problem into a set of objects that capture its essential structure and behavior. Done well, it produces a model that reads back as the domain itself — change the model and you change the system. Done badly, it produces a CRUD application thinly disguised as software.
> **How?** Read the requirements carefully. Identify the *events* and *decisions* the domain experts care about, not just the nouns. Build a small object model that can play those events out. Talk it back to the experts. Iterate.

---

## 1. The traditional recipe — and why it leads astray

For decades, OO design tutorials taught a simple rule: **underline the nouns, those are your classes; underline the verbs, those are your methods.**

Apply it to: *"A customer places an order containing line items. Each line item refers to a product and has a quantity. The order has a total cost. When the customer pays, the order is shipped."*

You get:

| Nouns                                  | Verbs                |
| -------------------------------------- | -------------------- |
| `Customer`, `Order`, `LineItem`,       | `place`, `contain`,  |
| `Product`, `Total`, `Cost`             | `refer`, `pay`, `ship` |

So you build five classes, mostly data, glue them with services, and call it done. The system *technically* works. But what's missing?

- Why does the order matter? What can it *do* besides exist?
- What happens between "placed" and "shipped"? Are there states? Failures?
- Does "pay" succeed every time? What if the card is declined?
- Who decides when shipping happens?

The noun-and-verb trick gives you a *schema* that mirrors the sentence structure, but it doesn't surface the *behavior* hidden in the white space between sentences. The customer "places an order" is one English verb but ten lines of decisions in the real domain.

---

## 2. A better starting point: events and decisions

Instead of nouns, look for the **events** that the domain cares about — moments where something changes — and the **decisions** that govern those events.

For the same requirements, the events might be:

- *OrderPlaced*
- *PaymentAttempted* (which may succeed or fail)
- *OrderConfirmed* (only after successful payment)
- *OrderShipped*
- *OrderCancelled* (if payment fails or customer cancels)

And the decisions:

- "Are all items in stock?" (between *placed* and *confirmed*)
- "Is the customer credit-worthy?"
- "Did the payment succeed?"
- "Has the order been fulfilled yet?"

Now the model has spine: a lifecycle from placement to shipment, with branches for failure. The classes that emerge aren't just `Order` and `Customer` — they're `Order` (with explicit states), `Payment`, `InventoryReservation`, `ShipmentInstruction`. The system *narrates*, not just *stores*.

---

## 3. A worked walk-through — meeting room reservations

Requirements: *"Employees can book a meeting room for a date and a time slot. Each room has a capacity. If an employee tries to book a room that is already taken or whose capacity is too small, the booking fails. Bookings can be cancelled up to 30 minutes before the start time."*

**Step 1: list the events.**

- `BookingRequested(employee, room, slot, partySize)`
- `BookingConfirmed`
- `BookingRejected(reason)`
- `BookingCancelled`

**Step 2: list the decisions.**

- Is the room available for that slot?
- Does the room's capacity accommodate the party?
- Is the cancellation within the 30-minute cutoff?

**Step 3: identify the objects that *own* each decision.**

| Decision                  | Owner                                |
| ------------------------- | ------------------------------------ |
| "Is the room available?"  | `Room` (it knows its bookings).      |
| "Does capacity fit?"      | `Room` (it knows its capacity).      |
| "Is cancellation in time?"| `Booking` (it knows its start time). |

**Step 4: sketch the model.**

```java
public final class Room {
    private final RoomId id;
    private final int capacity;
    private final Set<Booking> bookings;

    public Booking book(Employee who, TimeSlot slot, int partySize, Clock clock) {
        if (partySize > capacity) throw new RoomTooSmallException();
        if (overlapsExistingBooking(slot)) throw new RoomUnavailableException();
        Booking b = new Booking(this, who, slot, clock.now());
        bookings.add(b);
        return b;
    }
}

public final class Booking {
    private final Room room;
    private final Employee booker;
    private final TimeSlot slot;
    private final Instant createdAt;
    private boolean cancelled;

    public void cancel(Clock clock) {
        if (Duration.between(clock.now(), slot.start()).compareTo(CUTOFF) < 0) {
            throw new TooLateToCancelException();
        }
        cancelled = true;
    }
}
```

Notice what the model **does not** have:

- No `BookingService`. The room and the booking own their rules.
- No setters. State changes happen via verbs.
- No "manager" or "validator" classes — validation lives where the data lives.

Notice what it **does** have:

- Explicit time (`Clock`) injected, so tests can fix time.
- Domain-specific exceptions (`RoomTooSmallException`) instead of `IllegalStateException`.
- A `TimeSlot` value object that probably knows how to compute overlaps.

The requirements have been turned into *running rules*, not *fillable forms*.

---

## 4. Listening for what the requirements don't say

Requirements are almost always incomplete. The skill is to notice what's *missing* and ask:

- *"…can be cancelled up to 30 minutes before the start time."* → What about partial cancellation? What if someone cancels at the cutoff exactly? What if the system clock is wrong? Ask the domain expert.
- *"…the order is shipped."* → By whom? When? What about partial shipments? What if shipping fails?
- *"…employees can book a meeting room."* → Can multiple employees co-book? Can someone book on behalf of someone else? Are external visitors allowed?

A good domain model surfaces these questions early — by trying to encode the rules, you find the gaps. A bad model (the noun-and-verb kind) papers over them with `Optional<String>` fields and "we'll handle it later" comments.

---

## 5. The "ubiquitous language" — talk like the expert

When designing the model, use the *exact words* the domain experts use. Don't translate "booking" to "reservation" because Reservation sounds more technical. Don't say "transaction" if everyone in the business calls it a "payment".

```java
// Bad:
public class Transaction { ... }   // what the database calls it

// Good:
public class Payment { ... }       // what the business calls it
```

This is **ubiquitous language** (Eric Evans, *Domain-Driven Design*). When developers and domain experts speak the same vocabulary, conversations become design conversations. Mismatched vocabulary causes systems to drift from the domain over time.

Keep a glossary. Update it when the experts use a new word. Refactor class names when the language changes.

---

## 6. Behavior surfaces from scenarios, not from data

When you're stuck and don't know what classes you need, *walk through scenarios out loud*. (This is the CRC technique — see [../05-crc-cards-technique/](../05-crc-cards-technique/).)

"A customer books a meeting room. They specify Wednesday at 2pm in Room 203, party of 6. Room 203 has capacity 10. There's already a booking from 1pm to 1:30pm. Therefore the booking succeeds…"

Each sentence reveals an object or a decision. As you narrate:

- *"They specify Wednesday at 2pm"* — there's a `TimeSlot`.
- *"Room 203 has capacity 10"* — `Room.capacity()` exists.
- *"There's already a booking from 1pm to 1:30pm"* — `Room` holds a collection of bookings.
- *"Therefore the booking succeeds"* — `Room.book(...)` returns a `Booking` (or throws).

Behavior-first design works because *most decisions in a domain only make sense in context*. Reading a list of nouns won't tell you that "capacity" is a check, not just a number. Walking through a scenario will.

---

## 7. Bounded contexts — when one model can't do everything

A single domain often contains *multiple* views of "the same" concept that aren't actually the same. Example:

- For the *sales* team, a `Customer` has lifetime value, sales rep, contract terms.
- For the *fulfillment* team, the same person is a `ShippingAddress` and a `DeliveryWindow`.
- For the *support* team, they are a `Ticket` history.

Trying to make one mega-`Customer` class satisfy all three creates a god class with 80 fields and contradictory invariants. Instead, give each team its own model, in its own bounded context. The same person can be `Customer` in sales code and `Recipient` in shipping code — different objects, related by an ID.

(More on this in [../../08-tactical-ddd/](../../08-tactical-ddd/).)

---

## 8. Common newcomer mistakes

**Mistake 1: modeling the database, not the domain.**

```java
public class Order {
    @Id Long id;
    Long customerId;
    String status;
    BigDecimal total;
}
```

You've encoded the schema. The model has no rules, no states, no decisions. Restart from "what does an order *do*?"

**Mistake 2: too many primitive types.**

```java
public class Booking {
    String employeeName;
    String roomName;
    LocalDateTime start;
    LocalDateTime end;
    int partySize;
}
```

`String`, `int`, and `LocalDateTime` are not domain types. Wrap them: `EmployeeId`, `RoomId`, `TimeSlot`, `PartySize`. Each wrapper can validate and carry meaning. This is called **primitive obsession** (see the antipatterns section).

**Mistake 3: the "everything in one Order class" trap.**

```java
public class Order {
    // 40 methods covering: cart, checkout, payment, shipping, refund, returns,
    // analytics events, customer notifications, audit log, SAP export
}
```

You've fused six different responsibilities. Split: `Cart` (pre-checkout), `Order` (placed, paid, shipped lifecycle), `Shipment`, `Refund`, etc. Each owns a slice.

**Mistake 4: rushing to code.**

The temptation to "just start coding" before the model is clear is huge. Resist it for the first hour. Sketch the events, the decisions, the ownership table on paper. The code you write afterwards will be ten times cleaner — and you'll throw away less.

---

## 9. Quick rules

- [ ] Read the requirements for *events* and *decisions*, not just nouns.
- [ ] For each decision, find the object that owns the data → it owns the decision.
- [ ] Use the domain expert's vocabulary; keep a glossary.
- [ ] Walk through scenarios out loud before opening the editor.
- [ ] Wrap primitive types into value objects with meaning.
- [ ] One model per bounded context; don't merge incompatible views.

---

## 10. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| Event Storming, deeper bounded-context decomposition           | `middle.md`        |
| When modeling fights legacy schemas, microservices boundaries  | `senior.md`        |
| Running modeling workshops with domain experts                 | `professional.md`  |
| Hands-on modeling exercises                                    | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

---

**Memorize this:** model the *behavior* of the domain, not its data. Identify events and decisions, find the object that owns each, speak the expert's language, and walk through scenarios before you write a single field declaration.
