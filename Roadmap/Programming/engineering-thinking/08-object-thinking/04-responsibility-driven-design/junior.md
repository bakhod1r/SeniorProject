# Responsibility-Driven Design — Junior

> **What?** *Responsibility-Driven Design* (RDD) is Rebecca Wirfs-Brock's approach to OO design: you start by asking "**who is responsible for what?**" and assign each responsibility to the object best suited to own it. Objects are not records of data — they are **role-players with jobs**.
> **How?** For every behavior in your system, identify the *responsibility* it represents. Find the object that already knows the information that responsibility needs. Give the responsibility to that object. The result is a set of classes that collaborate by *delegation*, not by external scripts.

---

## 1. The core question: who owns this?

A useful design exercise: for every method you're about to write, finish the sentence *"This is the responsibility of ____."*

```java
// You're about to write code that calculates an invoice total.
// Who is responsible for knowing what an invoice totals to?
//
//   InvoiceService.calculateTotal(Invoice inv)?    ← no, separates rule from data
//   Invoice.total()?                               ← yes, the invoice owns its sum
```

```java
// You're about to write code that decides whether a reservation has expired.
// Who is responsible for knowing if a reservation is expired?
//
//   ExpiryChecker.isExpired(Reservation r)?        ← no
//   Reservation.isExpired(Clock now)?              ← yes
```

The class that *already holds* the information needed for a decision is almost always the right owner of that decision.

---

## 2. Why responsibilities, not data?

Most beginners design like this:

1. Identify nouns in the requirements.
2. Make each noun a class.
3. Give it fields matching its data attributes.
4. Sprinkle methods that operate on those fields.
5. Write *Services* to glue them together.

The result: many classes, much data, few real responsibilities. Business rules end up in services because no domain class felt like the natural home. The model is **structurally** OO and **behaviorally** procedural.

RDD inverts the order:

1. Identify *responsibilities* — things the system has to do.
2. Decide what object should own each responsibility.
3. Let the data structure emerge from what each object needs to perform its job.

The first version gives you records with services. The second gives you a domain.

---

## 3. The six classic stereotypes

Wirfs-Brock observed that domain objects play a small number of *roles* — patterns of behavior she called **stereotypes**. Naming the stereotype helps you know what an object *should* and *shouldn't* be doing.

| Stereotype             | Job                                                          | Java example                                                         |
| ---------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Information Holder** | Knows facts; provides answers about itself.                  | `Money`, `Address`, `Customer`                                       |
| **Service Provider**   | Performs a focused service on request.                       | `EncryptionService`, `PasswordHasher`, `TaxCalculator`              |
| **Structurer**         | Maintains relationships between other objects.               | `Graph`, `Index`, `Catalog`, `Hierarchy`                             |
| **Coordinator**        | Reacts to events and routes work between others.             | `OrderSaga`, `PaymentOrchestrator`                                   |
| **Controller**         | Makes decisions to govern other objects.                     | `Order.place()`, `ReservationManager`, traffic-light state machine  |
| **Interfacer**         | Translates between the system and the outside world.         | `HttpController`, `JpaRepository`, `KafkaConsumer`                  |

A class that tries to play *every* role is a God Object. A class that plays *no* coherent role is anemic. RDD asks you to pick a stereotype per class and stay disciplined about it.

---

## 4. A worked example — a tournament chess clock

Requirements: a digital chess clock has two timers (one per player), a button that switches whose timer runs, and a rule that the player whose timer reaches zero loses.

Data-first approach:

```java
public class ChessClock {
    public long whiteRemainingMs;
    public long blackRemainingMs;
    public Color running;
    public boolean gameOver;
    public Color loser;
}

class ChessClockService {
    void press(ChessClock c) { ... }
    void tick(ChessClock c, long elapsedMs) { ... }
    boolean isGameOver(ChessClock c) { ... }
}
```

RDD: list responsibilities, then ask who owns each.

| Responsibility                            | Owner                                                |
| ---------------------------------------- | ---------------------------------------------------- |
| Knowing how much time each side has left | `PlayerTimer` (Information Holder)                   |
| Counting down when active                 | `PlayerTimer` (it ticks itself)                      |
| Switching whose timer runs                | `ChessClock` (Controller)                            |
| Declaring the loser                       | `ChessClock` (Controller, when a `PlayerTimer` flags out) |
| Telling the UI what to render            | `PlayerTimer.format()` + `ChessClock.status()` (Information Holders) |

Result:

```java
public final class PlayerTimer {
    private long remaining;
    public void tick(long elapsed) {
        remaining = Math.max(0, remaining - elapsed);
    }
    public boolean flagged() { return remaining == 0; }
    public Duration remaining() { return Duration.ofMillis(remaining); }
}

public final class ChessClock {
    private final PlayerTimer white;
    private final PlayerTimer black;
    private Color running;
    private Color loser;

    public void press() {
        running = running == WHITE ? BLACK : WHITE;
    }

    public void tick(long elapsedMs) {
        if (loser != null) return;
        timerOf(running).tick(elapsedMs);
        if (timerOf(running).flagged()) loser = running;
    }
}
```

No `ChessClockService`. The timer owns ticking; the clock owns turn-switching and loss declaration. Each class knows *exactly* what it is responsible for.

---

## 5. The "who knows" test

When you're stuck on where to put a method, ask: **which object already has all the information this method needs to do its work?**

- Calculating shipping cost: needs item weights and dimensions → the *order* (which holds items) knows them. So `order.shippingCost()`, not `ShippingCalculator.calculate(order)`.
- Determining seat availability: needs current bookings → the *flight* knows them. So `flight.availableSeats()`, not `SeatChecker.check(flight)`.
- Deciding whether a user can post: needs the user's role and post history → the *user* knows them. So `user.canPost()`, not `PostingPolicy.allows(user)`.

If two objects share the information equally, the responsibility might belong to a third (a *Coordinator*) — or it might be a sign that one of them should hold a reference to the other.

---

## 6. Distributing intelligence, not centralizing it

A common anti-pattern: one mega-class becomes "the brain" while everything else is dumb data. RDD pushes you the other way — intelligence spreads thinly across many small role-players.

```java
// Centralized "brain":
class OrderService {
    void process(Order o, Customer c, Payment p) {
        if (c.isBlocked()) ...
        if (o.getItems().stream().anyMatch(i -> !inventory.has(i))) ...
        if (p.getAmount().compareTo(o.getTotal()) < 0) ...
        if (o.getShippingAddress().getCountry().isEmbargoed()) ...
        ...
    }
}

// Distributed responsibilities:
o.placeBy(c, p);
//   ↓ delegates ↓
c.assertNotBlocked();
o.assertItemsAvailable(inventory);
p.assertCovers(o.total());
o.shippingAddress().assertNotEmbargoed();
```

Each check moves to whoever holds the relevant data. The order *coordinates*; it doesn't *do* everything. This is RDD's payoff: complexity is spread, not concentrated.

---

## 7. Collaboration, not invocation

RDD encourages thinking about objects as **collaborators**: they call on each other for help instead of being orchestrated by an external script.

```java
public final class LibraryMember {
    public Loan borrow(Book book, Calendar today) {
        if (loansOverdue()) throw new BorrowingBlockedException();
        return book.lendTo(this, today);   // collaborate with Book
    }
}

public final class Book {
    public Loan lendTo(LibraryMember member, Calendar today) {
        if (!available()) throw new BookUnavailableException();
        availableCopies--;
        return new Loan(this, member, today.plus(LOAN_DURATION));
    }
}
```

`LibraryMember` enforces "you must not be blocked"; `Book` enforces "you must be available"; `Loan` is what they *both* produce. No `BorrowingService` orchestrates them. They talk to each other.

---

## 8. Common newcomer mistakes

**Mistake 1: re-creating the database schema.**

```java
public class Order {
    private Long id;
    private Long customerId;
    private String status;
    private BigDecimal total;
    // 25 more fields
}
```

You've modeled the *table*, not the *responsibilities*. Start over from "what does an order do?" and let the schema follow, not lead.

**Mistake 2: a class with every stereotype.**

```java
public class Order {
    public BigDecimal total() { ... }            // Information Holder
    public void place() { ... }                  // Controller
    public void notifyCustomer() { ... }         // Coordinator
    public Order toDto() { ... }                 // Interfacer
    public void saveToDb() { ... }               // Interfacer
}
```

`notifyCustomer` and `saveToDb` are different roles. Split them out (event publisher; repository). Keep the order focused on being itself.

**Mistake 3: misplacing the decision because the data is "easy to fetch".**

```java
class CheckoutService {
    boolean canCheckout(Customer c) {
        return !c.isBlocked() && c.getCart().total().compareTo(MIN_ORDER) >= 0;
    }
}
```

The customer already knows whether it's blocked and what its cart total is. The decision belongs to the customer (`customer.canCheckout()`), not a service. The convenience of "I'll just grab the data and decide here" is the trap RDD asks you to resist.

**Mistake 4: forcing one stereotype where two are needed.**

A `Reservation` that *both* holds reservation data *and* coordinates a multi-step cancellation workflow with refunds, notifications, and audit trails is doing two jobs. Extract the workflow into a `CancellationProcess` (Coordinator) and let `Reservation` stay an Information Holder + Controller of its own state.

---

## 9. Quick rules

- [ ] For every behavior, finish the sentence "*This is the responsibility of ____*."
- [ ] Prefer the object that already holds the data — *who knows* wins.
- [ ] Name each class's primary stereotype; reject methods that don't fit it.
- [ ] Spread intelligence across collaborators; don't centralize it in a service.
- [ ] If a class plays too many roles, split it.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Designing collaborations, walk-throughs, stereotype tables  | `middle.md`        |
| RDD with frameworks, ORMs, and real architecture            | `senior.md`        |
| Driving RDD across a team and codebase                      | `professional.md`  |
| Hands-on RDD exercises                                      | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** ask *who is responsible for what*. Give the work to the object that already knows the data. Name each class's role. The shape of the model comes from the responsibilities, not from the schema.
