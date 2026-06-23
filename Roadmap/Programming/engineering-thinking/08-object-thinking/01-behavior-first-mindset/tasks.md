# Behavior-First Mindset — Practice Tasks

Seven exercises that force you to design from verbs first and let the data fall out. Every starting point below is a struct in disguise — your job is to grow real objects out of them.

---

## Task 1 — From `OrderService` to a real `Order`

```java
public class Order {
    public List<Line> lines;
    public String status;     // "NEW" | "PAID" | "SHIPPED" | "CANCELLED"
    public BigDecimal total;
    public Long customerId;
}

public class OrderService {
    public void pay(Order o, PaymentMethod pm) {
        if (!"NEW".equals(o.status)) throw new IllegalStateException();
        // charge pm for o.total ...
        o.status = "PAID";
    }
    public void ship(Order o, Carrier c) {
        if (!"PAID".equals(o.status)) throw new IllegalStateException();
        // hand off to c ...
        o.status = "SHIPPED";
    }
    public void cancel(Order o) {
        if ("SHIPPED".equals(o.status)) throw new IllegalStateException();
        o.status = "CANCELLED";
    }
}
```

**Objective.** Move all rules into `Order`. `OrderService` should disappear entirely — callers send messages to the order directly.

**Constraints.**
- No public fields. No setters.
- No getter for `status`. Callers must not branch on status strings from the outside.
- The state machine (NEW → PAID → SHIPPED, NEW → CANCELLED, PAID → CANCELLED) lives inside the order.

**Acceptance.**
- [ ] `OrderService` is deleted from the codebase.
- [ ] Calling `order.ship(carrier)` on an unpaid order throws a meaningful exception.
- [ ] Calling `order.cancel()` after `ship(...)` throws.
- [ ] Reading the public method list of `Order` reads like a story: place, pay, ship, cancel.

**Bonus.** Add `refund()` that only works on a PAID-but-not-yet-SHIPPED order. Don't add a getter to do it — the order itself decides whether refund is legal.

---

## Task 2 — A subscription that knows its own lifecycle

```java
public class Subscription {
    public LocalDate startedOn;
    public LocalDate endsOn;
    public String plan;            // "FREE" | "PRO" | "TEAM"
    public boolean cancelled;
    public int graceDays;
}
```

Callers everywhere do things like:

```java
if (!sub.cancelled && sub.endsOn.isAfter(LocalDate.now())) { /* allow feature */ }
```

**Objective.** Refactor so a `Subscription` answers behavioral questions, not state questions. The rule "is this subscription currently entitling the user to PRO features?" must live in the subscription.

**Constraints.**
- The class exposes operations like `renew(Period)`, `cancel()`, `upgradeTo(Plan)`, and a single behavioral query `entitles(Feature)`.
- No `getEndsOn()`, no `isCancelled()`, no `getPlan()`. If a UI needs to *display* the end date, expose a narrow `summary()` method that returns a small immutable view object.
- `Plan` is an enum, not a string.

**Acceptance.**
- [ ] No `if (sub.something)` branches survive at call sites.
- [ ] Cancelled subscriptions still entitle the user during the grace window — and the test for that lives by exercising `entitles(...)`, not by reading dates.
- [ ] Adding a new plan (e.g. `ENTERPRISE`) requires editing only the subscription/plan files.

**Bonus.** Add `pauseFor(Period)`. Decide whether `entitles(...)` returns false during a pause without leaking that a "paused" state exists.

---

## Task 3 — Inventory that doesn't bleed its quantities

```java
public class StockItem {
    public String sku;
    public int onHand;
    public int reserved;
    public int reorderThreshold;
}

// somewhere else:
if (item.onHand - item.reserved >= qty) {
    item.reserved += qty;
} else {
    throw new OutOfStockException();
}
```

**Objective.** Turn `StockItem` into an object that handles reservations, releases, and fulfillment itself. The arithmetic above must vanish from every caller.

**Constraints.**
- Method set: `reserve(int qty)`, `release(int qty)`, `fulfill(int qty)`, `restock(int qty)`, plus one behavioral query: `canReserve(int qty)`.
- No getters for `onHand` or `reserved`. The only externally visible quantity is via a `report()` that returns an immutable snapshot — and `report()` is for a dashboard, not for branching logic.
- `reorderThreshold` is an internal concern: the item itself raises a `ReorderNeeded` event (or returns one from a method) when crossing the threshold.

**Acceptance.**
- [ ] No call site computes `onHand - reserved`.
- [ ] Double-reserving the same physical unit is impossible by construction.
- [ ] `fulfill(qty)` requires a prior matching reserve; otherwise it throws.
- [ ] Calling `restock(...)` while items are reserved doesn't corrupt the reservation count.

**Bonus.** Support partial fulfillment: a reservation of 10 can be fulfilled as 6 + 4. The item — not the caller — keeps track of how much of a reservation remains.

---

## Task 4 — A loan that decides whether it can disburse

```java
public class Loan {
    public BigDecimal principal;
    public BigDecimal interestRate;
    public int termMonths;
    public String status;            // "APPLIED" | "APPROVED" | "DISBURSED" | "CLOSED"
    public List<Payment> payments;
    public BigDecimal outstanding;
}

public class LoanCalculator {
    public BigDecimal outstanding(Loan l) {
        BigDecimal paid = l.payments.stream()
            .map(p -> p.amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        return l.principal.add(/* interest */).subtract(paid);
    }
    public boolean canDisburse(Loan l) {
        return "APPROVED".equals(l.status);
    }
}
```

**Objective.** Eliminate `LoanCalculator`. The loan knows how to be approved, disbursed, paid, and closed. The "outstanding" amount is *behavior*, not a field.

**Constraints.**
- `outstanding` must not be stored — it is computed by the loan whenever needed.
- The state transitions APPLIED → APPROVED → DISBURSED → CLOSED are enforced inside the loan.
- The loan exposes `apply(...)`, `approve(Approver a)`, `disburse(Account into)`, `recordPayment(Money m)`. The only query is `isSettled()`.

**Acceptance.**
- [ ] `LoanCalculator` is gone.
- [ ] You cannot record a payment on an APPLIED loan.
- [ ] You cannot disburse twice.
- [ ] Closing happens automatically when the final payment is recorded — callers don't call `close()` themselves.

**Bonus.** Add late fees: when `recordPayment` is called past a scheduled date, the loan internally adjusts the schedule. No fee calculator class allowed.

---

## Task 5 — A meeting-room reservation that polices itself

```java
public class Reservation {
    public Room room;
    public Employee organiser;
    public LocalDateTime start;
    public LocalDateTime end;
    public Set<Employee> attendees;
    public boolean cancelled;
}

public class ReservationValidator {
    public void validate(Reservation r) {
        if (r.end.isBefore(r.start)) throw new IllegalArgumentException();
        if (r.attendees.size() > r.room.capacity) throw new IllegalArgumentException();
        if (Duration.between(r.start, r.end).toMinutes() < 15) throw new IllegalArgumentException();
    }
}
```

**Objective.** Replace the validator-shaped procedure with a `Reservation` that cannot exist in an invalid state. Add behavior — extending, shortening, transferring ownership, inviting attendees — that respects those rules.

**Constraints.**
- All invariants live in the constructor or in operations that change state. No external validator.
- `invite(Employee e)` refuses if the room is at capacity.
- `extendBy(Duration d)` refuses if the room is double-booked during the new window (the reservation is aware of its calendar context — pass a `Calendar` collaborator in if needed, but don't expose `start`/`end` to it).
- No `getStart()`, no `getEnd()`. Display logic goes through a single `displayLine()` that returns a formatted string.

**Acceptance.**
- [ ] Trying to construct a 5-minute reservation throws.
- [ ] Inviting a 9th person to an 8-seat room throws.
- [ ] After `cancel()`, `extendBy(...)` throws.
- [ ] No code outside `Reservation` calculates `Duration.between(start, end)`.

**Bonus.** Add `transferTo(Employee newOrganiser)` with the rule: only the current organiser may transfer, and not within 10 minutes of the start. The reservation knows the rule; the caller passes "who is asking".

---

## Task 6 — A chess piece that knows its own moves

```java
public class Piece {
    public String type;        // "KING" | "QUEEN" | "ROOK" | "BISHOP" | "KNIGHT" | "PAWN"
    public String color;       // "WHITE" | "BLACK"
    public int file;           // 0..7
    public int rank;           // 0..7
    public boolean hasMoved;
}

public class MoveValidator {
    public boolean isLegal(Piece p, int toFile, int toRank, Board b) {
        switch (p.type) {
            case "ROOK":
                return p.file == toFile || p.rank == toRank;
            case "BISHOP":
                return Math.abs(p.file - toFile) == Math.abs(p.rank - toRank);
            // ... and so on for every piece, all reading p.type and p.file/p.rank
        }
        return false;
    }
}
```

This is the classic switch-on-type smell — a sign that behavior has been *lifted out* of the objects it belongs to.

**Objective.** Replace the giant switch with polymorphic pieces. Each piece type owns its move rules.

**Constraints.**
- `Piece` is an interface (or sealed interface) with `legalMoves(Position from, Board b)` and `moveTo(Position to, Board b)`.
- Concrete classes: `King`, `Queen`, `Rook`, `Bishop`, `Knight`, `Pawn`. No `type` field, no `instanceof` at call sites.
- No getter for `hasMoved` — that fact only matters to castling (King/Rook) and to pawn double-pushes (Pawn). It stays inside those classes.
- The `Board` asks pieces to move; pieces don't reach into the board's array.

**Acceptance.**
- [ ] No `switch` on piece type anywhere outside `Piece`'s subtype hierarchy.
- [ ] No `instanceof` outside a sealed-type exhaustive switch (if you use one).
- [ ] Adding a fairy piece (e.g. archbishop) requires adding one class — nothing else.
- [ ] Castling lives in `King` (and cooperates with `Rook`), not in a `Rules` class.

**Bonus.** Add en passant. Where does the "pawn just moved two squares" memory live — on the pawn, on the board, or somewhere else? Defend your answer in a one-paragraph comment in the code.

---

## Task 7 — A smart locker terminal

```java
public class Locker {
    public String id;
    public boolean occupied;
    public String parcelTrackingNumber;
    public String pinCode;
    public Instant depositedAt;
    public Instant expiresAt;
}

public class LockerService {
    public void deposit(Locker l, Parcel p, String pin) {
        if (l.occupied) throw new IllegalStateException();
        l.occupied = true;
        l.parcelTrackingNumber = p.trackingNumber();
        l.pinCode = pin;
        l.depositedAt = Instant.now();
        l.expiresAt = l.depositedAt.plus(Duration.ofHours(72));
    }
    public Parcel collect(Locker l, String pin) {
        if (!l.occupied || !l.pinCode.equals(pin)) throw new IllegalStateException();
        l.occupied = false;
        return /* parcel from tracking number */;
    }
}
```

**Objective.** Turn `Locker` into an object with agency. It accepts deposits, dispenses parcels to whoever proves identity, expires items, and reports its own status to a fleet supervisor — without exposing internals.

**Constraints.**
- Operations: `accept(Parcel, Pin)`, `dispenseTo(Pin)`, `markExpired(Clock)`, `audit()`.
- `audit()` returns an immutable snapshot for monitoring (timestamps, occupancy) — but the snapshot is read-only and not used by any control-flow.
- No getter for `pinCode`. Authentication happens via `dispenseTo(Pin)`, which compares internally and throws on mismatch.
- The 72-hour expiry policy lives inside the locker. Inject a `Clock` for testability.

**Acceptance.**
- [ ] Two deposits in a row throw.
- [ ] A wrong PIN never reveals whether the locker is empty (no information leak via different exception types).
- [ ] After expiry, `dispenseTo(...)` refuses even with the correct PIN — the parcel is reclaimed by `markExpired(...)`.
- [ ] The locker is unit-testable without freezing wall-clock time globally.

**Bonus.** Replace `accept` and `dispenseTo` with a more behavior-rich vocabulary: `parcel.depositInto(locker, pin)` and `locker.handHandOut(pin)`. Decide which class should *initiate* each interaction. Justify in two sentences in your README.

---

## Validation

| Task | How to check |
|------|--------------|
| 1 | Grep for `OrderService` — it's gone. Status strings appear nowhere in callers. |
| 2 | No call site reads `endsOn`, `cancelled`, or `plan`. All gating goes through `entitles(...)`. |
| 3 | Grep for `onHand` — only inside `StockItem`. No caller does arithmetic on stock. |
| 4 | `LoanCalculator` is deleted. `outstanding` is computed, not stored. |
| 5 | A 5-minute reservation throws at construction. An external validator class does not exist. |
| 6 | `grep -r 'switch.*type' src/` returns nothing relevant. Adding a new piece needs one new class. |
| 7 | Tests inject a fake `Clock`. Wrong-PIN and expired exceptions are indistinguishable to the caller. |

---

## A meta-check before you submit

Open each refactored class. Cover the field declarations with your hand. Read only the methods. Ask yourself:

- Does the class read like a list of actions a real-world thing performs?
- Could a caller use it without ever asking "what's inside"?
- Are the rules in *one* place, or scattered across helpers?

If you can answer yes, yes, one place — you've internalised the mindset.

---

## Solution sketch — Task 1

A reference shape, not the only valid answer:

```java
public final class Order {

    private enum Status { NEW, PAID, SHIPPED, CANCELLED }

    private final List<Line> lines;
    private final CustomerId customer;
    private Status status;

    public Order(CustomerId customer, List<Line> lines) {
        if (lines.isEmpty()) throw new IllegalArgumentException("empty order");
        this.customer = customer;
        this.lines = List.copyOf(lines);
        this.status = Status.NEW;
    }

    public Receipt pay(PaymentMethod pm) {
        require(Status.NEW, "only new orders can be paid");
        Money charge = totalAmount();
        Receipt r = pm.charge(charge);
        status = Status.PAID;
        return r;
    }

    public Shipment ship(Carrier carrier) {
        require(Status.PAID, "only paid orders can be shipped");
        Shipment s = carrier.dispatch(lines, customer);
        status = Status.SHIPPED;
        return s;
    }

    public void cancel() {
        if (status == Status.SHIPPED) {
            throw new IllegalStateException("cannot cancel a shipped order");
        }
        status = Status.CANCELLED;
    }

    private Money totalAmount() {
        return lines.stream()
            .map(Line::subtotal)
            .reduce(Money.ZERO, Money::add);
    }

    private void require(Status expected, String msg) {
        if (status != expected) throw new IllegalStateException(msg);
    }
}
```

Notice what is *not* in the class:

- No `getStatus()`. The state is internal.
- No `getLines()`. If a caller needs to display lines, give them a `summary()` returning a read-only view.
- No `OrderService`. Every rule lives next to the data it constrains.
- No `set*`. The only way state changes is through behavioral operations.

That's behavior-first — the object owns its verbs, and the verbs own the rules.

---

**Memorize this:** when you finish each task, the noun has a thin public surface (a handful of verbs) and a fat private one. If your refactor ended up with twenty getters and one method, you went the wrong way. Start the methods, end with the methods, fields are a private implementation detail.
