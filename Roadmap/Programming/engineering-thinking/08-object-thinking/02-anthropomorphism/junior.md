# Anthropomorphism — Junior

> **What?** *Anthropomorphism* in OO design is the practice of speaking and reasoning about objects as if they were *agents with intent*. Instead of "the system computes the invoice total", you say "the invoice totals itself". The shift sounds cosmetic but reshapes how methods are named, where logic lives, and which class ends up owning a rule.
> **How?** When designing a class, narrate its work as a person would narrate their own job: "I am an Invoice. People ask me for my total. They ask me to mark myself paid. I tell my customer when I'm overdue." Whatever you can naturally say, becomes a method. Whatever sounds strange, probably belongs elsewhere.

---

## 1. The everyday analogy

Picture a bank teller. You don't reach over the counter, grab the cash drawer, count out money, hand yourself a receipt, and write the transaction in their ledger. You *ask* the teller to make a withdrawal. They do the work — and they decide whether they can.

Now picture a `BankAccount` object. The same logic applies: you don't reach into the account's private fields, compute new balances, write back. You ask the account to `withdraw(amount)`, and it decides whether it can.

```java
// Reaching over the counter (bad):
if (account.balance() >= 100) {
    account.setBalance(account.balance() - 100);
}

// Asking the teller (good):
account.withdraw(Money.of(100));
```

The first version treats `account` as a filing cabinet. The second treats it as an *agent* — something with a job, an ability to refuse, and ownership of its own rules.

---

## 2. Why this trick works

If you can phrase what your code does as a sentence with the *object* as the subject ("the order ships itself"), then there's a natural place for that behavior: a method on that object. If the sentence is awkward ("the OrderProcessor ships the order"), the behavior has been pulled out into a separate service, and the object has been reduced to a record.

The grammar is doing design work for you. Subject = receiver of the method call. Verb = method name. Object = arguments.

| Sentence                                         | Resulting Java method                                |
| ------------------------------------------------ | ---------------------------------------------------- |
| "The invoice marks itself paid."                 | `invoice.markPaid()`                                 |
| "The reservation cancels itself."                | `reservation.cancel()`                               |
| "The dictionary translates a word."              | `dictionary.translate(word)`                         |
| "The shopping cart adds a product."              | `cart.add(product)`                                  |
| "The cipher encrypts a message."                 | `cipher.encrypt(message)`                            |
| "The OrderProcessor processes the order." (bad)  | `processor.process(order)` — vague, no real verb     |

The last row is the tell. "Process" is a generic placeholder — it has no behavioral content. When the subject of your sentence is a `*Service`, `*Manager`, `*Processor`, or `*Handler`, you've usually slipped back into data-first thinking.

---

## 3. A worked example — a chess piece

Imagine modeling a chess game. Data-first thinking suggests:

```java
public class Piece {
    public PieceType type;            // KING, QUEEN, ROOK, etc.
    public Color color;
    public Square position;
}

class MoveValidator {
    boolean canMove(Piece p, Square from, Square to, Board b) {
        switch (p.type) {
            case ROOK:   return from.sameRowOrColumn(to) && b.clearPath(from, to);
            case BISHOP: return from.sameDiagonal(to)    && b.clearPath(from, to);
            // ... a 60-line switch
        }
    }
}
```

The piece is a labeled struct. A separate validator does all the thinking.

Anthropomorphize: a chess piece *knows* how it moves. A rook says "I move along rows and columns." A knight says "I jump in an L." The validator vanishes.

```java
public abstract class Piece {
    public abstract boolean canMoveTo(Square target, Board board);
}

public final class Rook extends Piece {
    @Override
    public boolean canMoveTo(Square target, Board board) {
        return position.sameRowOrColumn(target) && board.clearPath(position, target);
    }
}

public final class Knight extends Piece {
    @Override
    public boolean canMoveTo(Square target, Board board) {
        return position.isLShapeFrom(target);
    }
}
```

The board no longer asks "what type is this?" and switches. It asks the piece. Each piece *speaks for itself*. The switch statement evaporates into polymorphism, and adding a new piece type means adding a new class, not patching a validator.

---

## 4. The role-play test

Pretend you *are* the object. Stand up and explain your job out loud (you don't have to actually stand up, but the technique works better if it's a bit uncomfortable).

> "Hi, I am an `Invoice`. I know who owes me, how much, and when I'm due. If someone asks, I tell them my total. I let myself be marked paid, but only if the amount matches. If I'm older than my due date and no one has paid me, I can tell you I'm overdue. I refuse to be mutated arbitrarily."

Every sentence that starts with "I…" is a candidate method. Every "I refuse…" is an invariant. Every "Only if…" is a precondition. The class almost writes itself.

If during role-play you say something like "I am an `OrderProcessor` and I take orders, look up their customers from the customer repository, and call the payment gateway to charge them", you're describing a procedure, not an object. The role doesn't *feel* like a person — it feels like a script. That's a signal that this isn't a domain object but a coordinator (and even then, it probably has too many responsibilities).

---

## 5. Naming reveals thinking

Method names betray whether you're anthropomorphizing or not.

| Anemic / data-first              | Anthropomorphic / behavior-first    |
| -------------------------------- | ----------------------------------- |
| `account.setBalance(b)`          | `account.deposit(amount)`           |
| `order.setStatus(SHIPPED)`       | `order.ship()`                      |
| `invoice.setPaid(true)`          | `invoice.markPaid(payment)`         |
| `user.getCart().getItems().add(p)` | `user.cart().add(p)` *or* `user.addToCart(p)` |
| `reservation.setCancelled(true)` | `reservation.cancel()`              |
| `gameState.setWinner(player)`    | `game.declareWinner(player)`        |

Notice the right column reads like instructions to a person. The left column reads like writes to a database row.

A simple rule: if your method name is `set<FieldName>`, ask yourself whether you can replace it with a verb that says *why* the field is changing. Often you can.

---

## 6. The common objection: "but objects aren't really alive!"

True. Code does not have feelings. Anthropomorphism is a *design heuristic*, not a metaphysical claim. The point isn't that the `Invoice` actually thinks — it's that *modeling* it as if it does forces a clean allocation of responsibilities, encapsulates state, and produces a public API that reads like a story instead of a table.

Programmers who reject anthropomorphism on the grounds of "but it's just code" often end up writing systems where every domain class is a struct and every behavior lives in a service. That style works, but it leaves the domain inert and the rules scattered.

You don't have to *believe* the invoice is alive. You just have to *talk* as if it were, while you design.

---

## 7. Where the trick fails — and that's fine

Some classes are not agents. They have no domain identity, no rules, no self.

- **Data Transfer Objects (`OrderDTO`, `InvoiceJson`)** — these exist to cross a wire. They are deliberately passive.
- **Primitive value carriers (`Point`, `Range`, `Pair<A,B>`)** — these are immutable data plus a few computed properties. Don't try to anthropomorphize a `Point`.
- **Adapters and bridges (`HttpOrderController`, `JpaOrderEntity`)** — these are infrastructure plumbing. The agent-shaped class is the `Order` *behind* them.

Anthropomorphism is for *domain objects* — the ones that hold business logic and invariants. For everything else, the technique is irrelevant.

---

## 8. Common newcomer mistakes

**Mistake 1: anthropomorphizing the wrong thing.**

```java
public class OrderProcessor {
    public void processOrder(Order o) { ... }
}
```

You can describe `OrderProcessor` as an agent, but it's a fake agent — its job is to do everything for an inert `Order`. The real agent that needs anthropomorphizing is `Order`, not the processor.

**Mistake 2: god-like agents.**

```java
public class Order {
    public void place() { ... }
    public void pay() { ... }
    public void ship() { ... }
    public void refund() { ... }
    public void notifyCustomer() { ... }
    public void chargePaymentMethod() { ... }
    public void deductInventory() { ... }
}
```

An order knows about itself. It doesn't actually charge credit cards or send emails. Anthropomorphism doesn't mean "give one object every responsibility" — it means "give *each* object the responsibilities that match its identity." `notifyCustomer` belongs somewhere else; the order just emits an event.

**Mistake 3: pretending an anemic class is anthropomorphic.**

```java
public class Order {
    private List<Item> items;
    public List<Item> getItems() { return items; }
    public void setItems(List<Item> items) { this.items = items; }
}
```

You can give this class human-like prose in a comment — "I am an Order" — but the methods still scream "I'm a record." Anthropomorphism is in the *methods*, not the Javadoc.

**Mistake 4: forcing the metaphor.**

```java
public class Mortgage {
    public void breathe()  { ... }
    public void dream()    { ... }
    public void remember() { ... }
}
```

The point is to name methods after what the domain *actually* does, not to invent biological-sounding verbs. If the domain has no equivalent of "breathing", neither should your code.

---

## 9. Quick rules

- [ ] Read your class signatures aloud as sentences with the object as subject.
- [ ] If the sentence sounds natural, the method belongs there.
- [ ] If the sentence sounds forced or you have to invent a generic verb (`process`, `handle`, `manage`), the method probably belongs somewhere else.
- [ ] Watch for `*Service`, `*Processor`, `*Manager` — fake agents disguising procedural code.
- [ ] Don't anthropomorphize DTOs, value carriers, or infrastructure adapters.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Stronger linguistic tests; the "agent vocabulary" workshop  | `middle.md`        |
| When the metaphor fights frameworks, mocks, and reality     | `senior.md`        |
| Driving the vocabulary across a team and code review        | `professional.md`  |
| Hands-on role-play exercises                                | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** speak of your objects as if they were people doing a job. The verbs they can say about themselves are their methods. The rules they enforce are their invariants. When the metaphor strains, the design is wrong.
