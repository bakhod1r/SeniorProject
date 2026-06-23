# Tell, Don't Ask — Junior

> **What?** *Tell, Don't Ask* is the rule: when you need an object to do something, **tell** it to act — don't **ask** for its data, decide externally, then write the answer back. Decisions belong inside the object whose state they read.
> **How?** Whenever you find yourself pulling fields out of an object with a getter, comparing them, and then calling a setter on the same object, fold the whole sequence into a single method on the object itself. The verb you write is the design.

---

## 1. The smell, in one snippet

```java
if (account.getBalance() >= amount) {
    account.setBalance(account.getBalance() - amount);
} else {
    throw new InsufficientFundsException();
}
```

Three things are wrong, and they're all the same thing:

1. The rule "you cannot overdraw" lives in the caller, not in the account.
2. The caller has to know that "withdrawal" means *read balance → subtract → write back*. If next month overdrafts become legal up to $100, every caller has to be updated.
3. If two threads run this code, the account ends with the wrong balance — the read-modify-write isn't atomic.

The fix removes all three at once:

```java
account.withdraw(amount);   // tell — the account decides, validates, and updates
```

Now the rule lives where the data lives. There is one place to change. Concurrency can be controlled. Callers stop carrying around domain knowledge that wasn't theirs.

---

## 2. Why "asking" feels natural — and is wrong

When you first learn OOP, getters and setters are presented as the way to use a class:

```java
Order o = new Order();
o.setCustomer(c);
o.setStatus("PLACED");
o.setTotal(o.getSubtotal().add(o.getTax()));
```

This looks like "using the object". It isn't. It's *operating on* the object — treating it like a record you fill in. The order doesn't decide anything. All the rules sit outside.

Tell, Don't Ask flips the default: methods should *do work the object is responsible for*, not expose levers for outside code to pull. `setStatus("PLACED")` becomes `o.place()`. `setTotal(...)` disappears — the order computes its own total when asked.

---

## 3. A worked example — an elevator

You're modeling an elevator. Asking-style:

```java
if (elevator.getCurrentFloor() < requestedFloor) {
    elevator.setDirection(UP);
} else if (elevator.getCurrentFloor() > requestedFloor) {
    elevator.setDirection(DOWN);
} else {
    elevator.openDoors();
}
elevator.setCurrentFloor(requestedFloor);
```

The caller is making the elevator's decisions for it. Notice it has to know how an elevator works: that direction matters, that you open doors at the destination, that "current floor" needs to be updated. If the elevator gains new rules (skip floors during fire alarms; rest between calls; queue requests), every caller breaks.

Telling-style:

```java
elevator.goTo(requestedFloor);
```

Inside, the elevator can do whatever it needs to: check faults, queue requests, open doors when arriving. The caller doesn't know and doesn't have to.

---

## 4. The mechanical recipe

When you see `if (x.getY()) x.setZ(...)`, do this:

1. Pick a verb that names the *intent* — not the mechanical change. ("withdraw" not "subtractFromBalance".)
2. Move the `if` and the `set` into a method on `x` with that verb.
3. Make `getY` private (or delete it if nobody else needs it).
4. The call site becomes `x.<verb>(args)`.

```java
// before
if (cart.getItems().isEmpty()) {
    throw new EmptyCartException();
}
cart.setTotal(BigDecimal.ZERO);
cart.setCheckedOut(true);

// after
cart.checkOut();   // cart validates, totals, marks itself checked out
```

The "after" version reads like a story. The "before" version reads like an assembly manual.

---

## 5. The three kinds of "ask" that you should refactor

**Ask-and-decide:**
```java
if (order.getStatus() == PLACED) order.setStatus(SHIPPED);   // → order.ship()
```

**Ask-and-compute:**
```java
BigDecimal total = items.stream()
    .map(i -> i.getPrice().multiply(BigDecimal.valueOf(i.getQty())))
    .reduce(BigDecimal.ZERO, BigDecimal::add);                // → cart.total()
```

**Ask-and-mutate-a-collaborator:**
```java
if (user.getAccount().getBalance().compareTo(price) >= 0) {
    user.getAccount().withdraw(price);
}                                                            // → user.payFor(price)
```

The third case is sometimes called *train-wreck* code — a long chain of `.getX().getY().getZ()`. It's a Law-of-Demeter violation (see [../../03-design-principles/03-law-of-demeter/](../../03-design-principles/03-law-of-demeter/)) and a tell-don't-ask smell in one.

---

## 6. What you keep as a getter

Tell, Don't Ask doesn't mean "no getters ever". It means **getters should expose information for display or coordination, not for decision-making inside the caller**.

Legitimate getter uses:

- **Rendering**: `order.totalAmount()` — the view layer prints it.
- **Logging / metrics**: `order.id()` — observers identify it.
- **Routing / dispatch**: `event.kind()` — a router maps to handlers.
- **Read APIs / projections**: read models, GraphQL resolvers.

Illegitimate uses:

- Anything where the caller takes the value, checks a condition, and writes back.
- Anything where the caller computes something the object should know how to compute.

A handy distinction: getters are for **showing**, not **deciding**.

---

## 7. Tell, Don't Ask vs. queries that return data

A method like `cart.total()` returns a value. Isn't that also "asking"?

It is — but it's asking for a *computed answer*, not raw state. The cart still owns the calculation. The caller doesn't see the items, doesn't loop, doesn't multiply prices. The information returned is at the right level of abstraction.

Bad:
```java
List<Item> items = cart.getItems();   // raw state — caller must compute
```

Good:
```java
Money total = cart.total();           // computed result — caller just uses
```

The line isn't "no return values"; it's "no leaking of internal structure".

---

## 8. The "command/query separation" cousin

Bertrand Meyer's CQS principle says: methods should *either* change state *or* return a value, not both. Tell, Don't Ask aligns with this:

- `withdraw(amount)` — command (changes balance; returns `void` or a confirmation).
- `balance()` — query (returns value; no side effects).

When a method does both ("read balance and also lock the account"), callers get confused: did calling `getBalance()` *do* something? Keep commands and queries separate, and the Tell vs. Ask split becomes natural.

---

## 9. Common newcomer mistakes

**Mistake 1: cosmetic-only "tell" methods.**

```java
public void setStatusToShipped() { this.status = SHIPPED; }
```

You renamed `setStatus(SHIPPED)` to `setStatusToShipped()`. The decision still lives outside — the caller chose to call this method based on some external check. Real "telling" pushes the *decision* into the object, not just the field assignment.

**Mistake 2: god-methods masquerading as telling.**

```java
order.processEverything(customer, payment, address, warehouse);
```

You've moved 200 lines of procedure into one giant method on `Order`. That's not telling — that's hiding procedural code inside an object. Each verb should be a *coherent piece of the order's responsibility*; "process everything" isn't one.

**Mistake 3: leaving the getter as a public escape hatch.**

```java
account.withdraw(amount);   // good, but…
account.setBalance(0);      // also still exposed
```

If the dangerous setter is still public, callers will use it. Remove or privatize the levers.

**Mistake 4: forcing Tell on read-only views.**

A dashboard that displays "total revenue this month" is reading aggregated values. Don't twist that into "the dashboard tells the report to render itself for me". Read models are allowed to ask for data.

---

## 10. Quick rules

- [ ] If you see `if (x.getY()) x.setZ(...)`, fold it into a method on `x`.
- [ ] Name the new method after the *intent*, not the mechanical change.
- [ ] Make the underlying getters/setters private if no one outside needs them.
- [ ] Don't return raw internal collections — return computed answers.
- [ ] Keep commands separate from queries.
- [ ] Getters are for showing, not for deciding.

---

## 11. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| Law of Demeter; train-wreck refactoring; mediator patterns     | `middle.md`        |
| When Tell fights frameworks, ORMs, and read models             | `senior.md`        |
| Driving the rule across a team and code review                 | `professional.md`  |
| Hands-on refactoring exercises                                 | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

---

**Memorize this:** don't reach inside an object, read its state, decide, and write back. Give it a verb instead. The verb is the design. The decision lives where the data lives.
