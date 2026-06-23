# Refactoring Toward Behavioral Patterns — Find the Bug

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/behavioral-patterns](https://refactoring.guru/design-patterns/behavioral-patterns)

Each snippet *applies* a behavioral pattern but applies it wrong — the kind of subtle defect that passes a happy-path test and detonates in production or under concurrency. Read, diagnose, then fix. These are the failure modes that separate "I used a pattern" from "I used it correctly."

---

## Bug 1 — A Strategy that shares mutable state

```java
public final class RunningTotalDiscount implements DiscountStrategy {
    private double accumulated = 0;            // (!) per-call state on a shared instance

    public double apply(Order order) {
        accumulated += order.subtotal() * 0.1;
        return accumulated;
    }
}

// wired once and shared across all requests:
static final DiscountStrategy DISCOUNT = new RunningTotalDiscount();
```

**Diagnose.** The strategy is registered as a shared singleton but holds **mutable instance state** (`accumulated`). Every call mutates the same field, so concurrent requests corrupt each other's totals, and even sequential calls leak state across unrelated orders. The pattern's contract — *stateless strategies are safe to share* — is violated. This is a data race and a logic bug at once.

**Fix.** Make the strategy stateless: never store per-call state in fields; pass it as parameters or compute fresh each call. If running state is genuinely required, it belongs to the *caller*, not the shared strategy.

```java
public final class PercentDiscount implements DiscountStrategy {
    private final double rate;                  // immutable config only
    public PercentDiscount(double rate) { this.rate = rate; }
    public double apply(Order order) {          // no fields mutated
        return order.subtotal() * rate;
    }
}
```

If you truly need accumulation, accumulate at the call site (`runningTotal += strategy.apply(o)`), keeping the strategy pure. Mark config fields `final` so the compiler rejects accidental mutation.

---

## Bug 2 — An Observer that leaks listeners

```java
public class PriceTicker {
    private final List<PriceListener> listeners = new ArrayList<>();
    public void subscribe(PriceListener l) { listeners.add(l); }
    public void tick(double price) { listeners.forEach(l -> l.onPrice(price)); }
}

public class ChartWidget {
    public ChartWidget(PriceTicker ticker) {
        ticker.subscribe(this::redraw);         // subscribes...
    }
    private void redraw(double p) { /* ... */ }
    // ...and there is no unsubscribe anywhere. Closing the chart doesn't detach it.
}
```

**Diagnose.** The **lapsed-listener leak**. `PriceTicker` holds a strong reference to every subscriber forever. Each opened-then-closed `ChartWidget` stays alive (and keeps its whole object graph alive) because the ticker still references its `redraw` method handle. Open/close charts in a loop and the heap climbs until OOM. The happy path works perfectly — it just never frees.

**Fix.** Give subscription a deterministic, paired lifecycle. Return a cancelable handle and cancel it on teardown.

```java
public interface Subscription { void cancel(); }

public class PriceTicker {
    private final List<PriceListener> listeners = new CopyOnWriteArrayList<>();
    public Subscription subscribe(PriceListener l) {
        listeners.add(l);
        return () -> listeners.remove(l);       // caller can deregister
    }
    public void tick(double price) {
        for (PriceListener l : listeners)       // CoW avoids CME if a listener detaches
            try { l.onPrice(price); } catch (RuntimeException e) { /* log */ }
    }
}

public class ChartWidget implements AutoCloseable {
    private final Subscription sub;
    public ChartWidget(PriceTicker ticker) { this.sub = ticker.subscribe(this::redraw); }
    public void close() { sub.cancel(); }       // detaches on dispose
    private void redraw(double p) { }
}
```

(Weak-reference listener lists are an alternative, but deterministic cancel is more reliable — a bare method-reference listener held only weakly would be GC'd immediately and silently stop firing. See [professional.md](professional.md).)

---

## Bug 3 — A State machine with an invalid / unreachable transition

```java
final class Draft implements OrderState {
    public void pay(Order o)    { o.setState(new Paid()); }
    public void cancel(Order o) { o.setState(new Cancelled()); }
}
final class Paid implements OrderState {
    public void ship(Order o)   { o.setState(new Shipped()); }
    public void cancel(Order o) { o.setState(new Cancelled()); }   // refund path
}
final class Shipped implements OrderState {
    public void deliver(Order o){ o.setState(new Delivered()); }
    public void cancel(Order o) { o.setState(new Cancelled()); }   // (!) ship already left
}
final class Delivered implements OrderState { /* terminal */ }
final class Cancelled implements OrderState { /* terminal */ }
```

**Diagnose.** Two defects. First, `Shipped.cancel()` is an **invalid transition** — once shipped, you can't simply cancel; that should be a return/refund flow, not a silent jump to `Cancelled`. The state graph permits an illegal edge. Second, the default behavior is missing: states that *shouldn't* allow an operation simply *don't define it*, but with an interface (not a base class), there's no enforced "illegal transition" — depending on how `Order` delegates, an unsupported op is a silent no-op or NPE rather than a loud error.

**Fix.** Use an abstract base that makes every undefined operation an explicit illegal-transition error, and remove the bogus edge.

```java
abstract class OrderState {
    public void pay(Order o)    { illegal("pay"); }
    public void ship(Order o)   { illegal("ship"); }
    public void deliver(Order o){ illegal("deliver"); }
    public void cancel(Order o) { illegal("cancel"); }
    private void illegal(String op) {
        throw new IllegalStateException(op + " illegal in " + getClass().getSimpleName());
    }
}
final class Shipped extends OrderState {
    @Override public void deliver(Order o) { o.setState(new Delivered()); }
    // cancel() intentionally NOT overridden -> base throws. Returns go through a
    // separate `returnAfterDelivery` flow, not the cancel transition.
}
```

Now an illegal transition is impossible to introduce silently: not overriding an operation *is* the rejection, in one place, loudly.

---

## Bug 4 — Template Method whose skeleton is overridable

```java
abstract class PaymentFlow {
    void process(Payment p) {                    // (!) not final
        validate(p);
        charge(p);
        receipt(p);
    }
    protected abstract void validate(Payment p);
    protected abstract void charge(Payment p);
    protected abstract void receipt(Payment p);
}

class CryptoPayment extends PaymentFlow {
    @Override void process(Payment p) {          // (!) subclass overrode the template
        charge(p);                               // skipped validate()! and receipt()
    }
    protected void validate(Payment p) { /*...*/ }
    protected void charge(Payment p)   { /*...*/ }
    protected void receipt(Payment p)  { /*...*/ }
}
```

**Diagnose.** The template method `process` is **not `final`**, so a subclass overrode it and skipped `validate` and `receipt`. The entire point of Template Method — guaranteeing the skeleton runs in order for every variant — is defeated. `CryptoPayment` charges without validating: a security/correctness hole. This is exactly the failure Template Method exists to prevent, reintroduced by a missing modifier.

**Fix.** Make the template method `final`; subclasses can only fill in primitives.

```java
abstract class PaymentFlow {
    final void process(Payment p) {              // locked skeleton
        validate(p);
        charge(p);
        receipt(p);
    }
    protected abstract void validate(Payment p);
    protected abstract void charge(Payment p);
    protected abstract void receipt(Payment p);
}
// CryptoPayment can now ONLY override validate/charge/receipt — the order is guaranteed.
```

---

## Bug 5 — A Command that can't be undone correctly

```java
class SetFieldCommand implements Command {
    private final Document doc;
    private final String field, newValue;
    public SetFieldCommand(Document doc, String field, String newValue) {
        this.doc = doc; this.field = field; this.newValue = newValue;
    }
    public void execute() { doc.set(field, newValue); }
    public void undo()    { doc.set(field, ""); }     // (!) restores "" not the old value
}
```

**Diagnose.** `undo()` doesn't restore the *previous* value — it blanks the field. The command never **captured the prior state** before overwriting it, so undo is wrong for any field that wasn't empty. Redo/undo cycles corrupt the document. The command lacks the memento it needs to invert itself.

**Fix.** Capture the old value at `execute` time (a tiny inline memento) and restore it on `undo`.

```java
class SetFieldCommand implements Command {
    private final Document doc;
    private final String field, newValue;
    private String previousValue;                 // captured memento

    public SetFieldCommand(Document doc, String field, String newValue) {
        this.doc = doc; this.field = field; this.newValue = newValue;
    }
    public void execute() {
        this.previousValue = doc.get(field);      // snapshot BEFORE mutating
        doc.set(field, newValue);
    }
    public void undo() {
        doc.set(field, previousValue);            // true inverse
    }
}
```

For complex state where an inverse is hard to express, snapshot the whole receiver into a real Memento instead (see [senior.md](senior.md)). Note: `execute` must be called before `undo`, and re-`execute` after `undo` re-snapshots correctly — assert that invariant in tests.

---

## Bug 6 — A Null Object that hides a real error

```java
class UserRepository {
    User findById(String id) {
        User u = db.query(id);
        return (u != null) ? u : NullUser.INSTANCE;    // (!) "not found" -> silent no-op user
    }
}
class NullUser implements User {
    static final User INSTANCE = new NullUser();
    public String name()      { return "Guest"; }
    public boolean isAdmin()  { return false; }
    public void debit(double amount) { /* nothing */ }   // (!) silently swallows debits
}

// caller:
repo.findById(unknownId).debit(100);   // money "charged" to nobody, no error
```

**Diagnose.** Null Object **misapplied to an exceptional case**. "User not found by id" is a genuine error — the caller asked for a specific user. Returning a do-nothing `NullUser` makes a missing user behave like a real one: a `debit` silently vanishes, masking a bug that should have surfaced loudly. Null Object is for *neutral-behavior-is-correct* cases (an absent optional logger), not for "the thing you looked up doesn't exist."

**Fix.** For a lookup that can legitimately miss, make absence explicit — `Optional` (or throw for a hard "must exist" contract).

```java
class UserRepository {
    Optional<User> findById(String id) {
        return Optional.ofNullable(db.query(id));
    }
}
// caller is forced to handle absence:
repo.findById(unknownId)
    .orElseThrow(() -> new UserNotFoundException(unknownId))
    .debit(100);
```

Reserve Null Object for the *anonymous/guest* concept where "no user, behave neutrally" is the intended product behavior — and even then, never let it silently swallow a state-changing operation like `debit`.

---

## Bug 7 — Chain of Responsibility that falls off the end

```java
abstract class Approver {
    protected Approver next;
    Approver linkTo(Approver n) { this.next = n; return n; }
    abstract void approve(Expense e);
}
class Manager extends Approver {
    void approve(Expense e) {
        if (e.amount() <= 1000) System.out.println("Manager approved");
        else next.approve(e);                       // (!) next may be null
    }
}
class Director extends Approver {
    void approve(Expense e) {
        if (e.amount() <= 10000) System.out.println("Director approved");
        else next.approve(e);                       // (!) end of chain -> NPE
    }
}

new Manager().linkTo(new Director());
chain.approve(new Expense(50000));   // NPE: nobody handles >10000, and next is null
```

**Diagnose.** The chain has **no terminal handler**. An expense above every threshold falls past the last link, where `next` is `null` → `NullPointerException`. Worse than a clean "unhandled" signal: it crashes. Chains must account for the request nobody handles.

**Fix.** Add an explicit terminal handler (or default policy) so "unhandled" is loud and intentional, and null-guard the link.

```java
class EscalationHandler extends Approver {           // terminal
    void approve(Expense e) {
        throw new ApprovalRequiredException("needs board approval: " + e.amount());
        // or: route to a human queue — but never silently drop or NPE.
    }
}
abstract class Approver {
    protected Approver next = new EscalationHandler() {{ /* default terminal */ }};
    // ...each handler calls next.approve(e) safely; the chain always ends somewhere.
}

new Manager().linkTo(new Director()).linkTo(new EscalationHandler());
```

Now an over-threshold expense reaches a deliberate terminal handler instead of crashing on a null link.

---

## Next

- Propose-or-reject refactorings: **[optimize.md](optimize.md)**
- Apply the refactorings: **[tasks.md](tasks.md)**
- Theory: **[junior.md](junior.md)** · **[middle.md](middle.md)** · **[senior.md](senior.md)** · **[professional.md](professional.md)** · **[interview.md](interview.md)**
