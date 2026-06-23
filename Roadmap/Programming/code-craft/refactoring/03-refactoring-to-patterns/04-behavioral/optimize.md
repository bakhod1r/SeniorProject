# Refactoring Toward Behavioral Patterns — Optimize

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/behavioral-patterns](https://refactoring.guru/design-patterns/behavioral-patterns)

Each "before" has a behavioral smell. Your job: name the right behavioral refactoring **or argue it would be over-engineering** — a senior is judged as much by the patterns they *decline* to apply as the ones they apply. Sketch your verdict before reading the worked solution. Several of these are deliberately *traps* where the correct answer is "leave it alone."

---

## Snippet 1 — Pricing branches that keep growing

```java
double price(Product p, String customerType) {
    if (customerType.equals("RETAIL"))     return p.base();
    if (customerType.equals("WHOLESALE"))  return p.base() * 0.8;
    if (customerType.equals("VIP"))        return p.base() * 0.7;
    if (customerType.equals("EMPLOYEE"))   return p.base() * 0.5;
    if (customerType.equals("PARTNER"))    return p.base() * 0.85;
    throw new IllegalArgumentException(customerType);
}
```

**Your move?**

<details><summary>Worked solution</summary>

**Refactor: Replace Conditional Logic with Strategy** — but recognize the variants differ only by a multiplier, so the strategy is *one parameterized class*, not five.

```java
interface PricingStrategy { double price(Product p); }
final class MultiplierPricing implements PricingStrategy {
    private final double factor;
    MultiplierPricing(double f) { this.factor = f; }
    public double price(Product p) { return p.base() * factor; }
}
static final Map<String, PricingStrategy> PRICING = Map.of(
    "RETAIL",    new MultiplierPricing(1.0),
    "WHOLESALE", new MultiplierPricing(0.8),
    "VIP",       new MultiplierPricing(0.7),
    "EMPLOYEE",  new MultiplierPricing(0.5),
    "PARTNER",   new MultiplierPricing(0.85)
);
```

Worth it because the list of customer types is *open* (new tiers keep appearing) and the rates now live in data, not code — a new tier is a map entry, not an `if`. **But** if any tier later needs genuinely different *logic* (tiered/volume pricing), give it its own strategy class then.
</details>

---

## Snippet 2 — A two-branch flag (trap)

```java
String greeting(boolean formal) {
    if (formal) return "Good evening.";
    else        return "Hey!";
}
```

**Your move?**

<details><summary>Worked solution</summary>

**Decline — leave it.** Two stable, trivial branches over a boolean. A `GreetingStrategy` interface with two classes and a factory would be pure ceremony: more files, more indirection, zero benefit, since nothing here is open to extension or runtime-swappable. The conditional is the clearest, fastest expression. Applying Strategy here is the over-engineering [professional.md](professional.md) warns about. (If "greeting styles" later multiply into a configurable set — formal, casual, regional, branded — *then* revisit.)
</details>

---

## Snippet 3 — Order lifecycle smeared across methods

```java
class Subscription {
    String status = "TRIAL";          // TRIAL | ACTIVE | PAST_DUE | CANCELLED
    void charge() {
        if (status.equals("TRIAL"))        { status = paymentOk() ? "ACTIVE" : "CANCELLED"; }
        else if (status.equals("ACTIVE"))  { if (!paymentOk()) status = "PAST_DUE"; }
        else if (status.equals("PAST_DUE")){ status = paymentOk() ? "ACTIVE" : "CANCELLED"; }
        // CANCELLED: nothing
    }
    boolean canAccess() {
        return status.equals("ACTIVE") || status.equals("TRIAL") || status.equals("PAST_DUE");
    }
}
```

**Your move?**

<details><summary>Worked solution</summary>

**Refactor: Replace State-Altering Conditionals with State.** Multiple methods branch on `status` *and mutate it* — an implicit transition graph nobody can see. State makes it explicit: one class per status, each owning its `charge()` transition and its `canAccess()` answer.

```java
abstract class SubState {
    abstract void charge(Subscription s);
    abstract boolean canAccess();
}
final class Trial extends SubState {
    void charge(Subscription s) { s.setState(s.paymentOk() ? new Active() : new Cancelled()); }
    boolean canAccess() { return true; }
}
final class PastDue extends SubState {
    void charge(Subscription s) { s.setState(s.paymentOk() ? new Active() : new Cancelled()); }
    boolean canAccess() { return true; }
}
final class Cancelled extends SubState {
    void charge(Subscription s) { /* no-op, explicit */ }
    boolean canAccess() { return false; }
}
```

Worth it: four methods × four statuses is exactly the smell State cures; each transition now lives in one place and `canAccess` stops re-deriving the set of "allowed" statuses. The tell that confirms State over Strategy: the chosen object *assigns the next state*.
</details>

---

## Snippet 4 — Notification hard-coding

```java
class CommentService {
    void post(Comment c) {
        repo.save(c);
        emailService.notifyAuthor(c.parentAuthor(), c);
        searchIndex.add(c);
        spamCheck.scan(c);
    }
}
```

**Your move?**

<details><summary>Worked solution</summary>

**Refactor: Replace Hard-Coded Notifications with Observer** — *with a caveat about which reactions qualify.* `CommentService` depends on four unrelated subsystems; email, search indexing, and analytics are independent, optional, order-insensitive reactions — perfect Observer subscribers. Publish a `CommentPosted` event; subscribe those three.

**But scrutinize `spamCheck`:** if a failing spam check must *block* the comment (reject/hold it), it is **not** a fire-and-forget notification — it's a required, ordered gate that belongs in the synchronous flow (or a pre-save validation), not behind Observer where its result is ignored and ordering is unspecified. Splitting "mandatory gates" from "optional reactions" is the senior judgment here ([middle.md](middle.md) caveat). Email/search/analytics → Observer; blocking spam check → keep inline.
</details>

---

## Snippet 5 — instanceof cascade (which way does it churn?)

```java
String describe(Shape s) {
    if (s instanceof Circle c)    return "circle r=" + c.radius();
    if (s instanceof Square sq)   return "square side=" + sq.side();
    if (s instanceof Triangle t)  return "triangle base=" + t.base();
    throw new IllegalArgumentException();
}
```

**Your move?**

<details><summary>Worked solution</summary>

**It depends — and naming the axis is the answer.** This is the expression-problem question:

- If you'll keep adding *operations* over a *stable* shape set (describe, area, perimeter, render, serialize…), refactor to **Visitor**: double dispatch, and each new operation is a new visitor with no edits to the shapes.
- If you'll keep adding *shape types* and operations are few, **don't** use Visitor (every new shape would force a new `visit` in every visitor). Instead put a `describe()` method on each shape (polymorphism) **or** use a **sealed-type `switch`** with exhaustiveness checking:

```java
sealed interface Shape permits Circle, Square, Triangle {}
String describe(Shape s) {
    return switch (s) {                       // compiler enforces exhaustiveness
        case Circle c   -> "circle r=" + c.radius();
        case Square sq  -> "square side=" + sq.side();
        case Triangle t -> "triangle base=" + t.base();
    };
}
```

For a small, closed hierarchy in modern Java, the sealed `switch` is usually the best call — dispatch without `instanceof` *and* compile-time exhaustiveness, none of Visitor's boilerplate ([senior.md](senior.md)).
</details>

---

## Snippet 6 — A big action dispatcher

```java
void handle(Event e) {
    switch (e.type()) {
        case "USER_REGISTERED": emailSvc.welcome(e.user());
                                crmSvc.createLead(e.user());
                                metrics.inc("registrations"); break;
        case "ORDER_PLACED":    inventory.reserve(e.order());
                                paymentSvc.capture(e.order());
                                shippingSvc.schedule(e.order()); break;
        case "PASSWORD_RESET":  emailSvc.resetLink(e.user());
                                auditLog.record(e); break;
        // ...20 more types, each pulling in more services
    }
}
```

**Your move?**

<details><summary>Worked solution</summary>

**Refactor: Replace Conditional Dispatcher with Command.** Each case carries *behavior plus its own dependencies* and the list is open — the exact profile where the Command map pays off (unlike Task 4 in [tasks.md](tasks.md), where dependency-free lambdas sufficed). Extract one `EventHandler` (command) per type, each constructor-injecting only the services it needs; register in a `Map<String, EventHandler>`; dispatch by lookup.

```java
interface EventHandler { void handle(Event e); }
final class UserRegisteredHandler implements EventHandler {
    private final EmailService email; private final CrmService crm; private final Metrics m;
    UserRegisteredHandler(EmailService e, CrmService c, Metrics m){ this.email=e; this.crm=c; this.m=m; }
    public void handle(Event e) { email.welcome(e.user()); crm.createLead(e.user()); m.inc("registrations"); }
}
// dispatcher depends on Map + EventHandler only:
EventHandler h = handlers.get(e.type());
if (h == null) { log.warn("no handler for {}", e.type()); return; }
h.handle(e);
```

Payoff: the dispatcher sheds its dependency on every service in the system, each handler is unit-testable with fakes, and new event types are new classes — no merge-conflict magnet. **Caveat:** if you need compile-time proof that every event type is handled, a sealed-enum `switch` gives exhaustiveness the map can't.
</details>

---

## Snippet 7 — Ad-hoc filter mini-language (trap-ish)

```java
boolean matches(Product p, String filter) {
    // filter like "price<100", "category=books", "instock"
    if (filter.equals("instock")) return p.stock() > 0;
    String[] parts = filter.split("<");
    if (parts.length == 2 && parts[0].equals("price")) return p.price() < Double.parseDouble(parts[1]);
    parts = filter.split("=");
    if (parts.length == 2 && parts[0].equals("category")) return p.category().equals(parts[1]);
    return false;
}
```

**Your move?**

<details><summary>Worked solution</summary>

**Decline Interpreter for now — but watch the trajectory.** Today the "language" has three flat, non-composable forms. A full Interpreter (an AST of expression nodes, a parser, `interpret` per node) would be heavy machinery for three `if`s — over-engineering. The pragmatic improvement is to clean up the parsing (a small predicate factory or a `Map<String, Function<String, Predicate<Product>>>`), not to build a grammar.

**However**, the moment this grows *composition* — `price<100 AND category=books OR instock` with precedence and nesting — the string-juggling becomes unmaintainable and **Replace Implicit Language with Interpreter** (or a real parser library) becomes the right call ([senior.md](senior.md)). The senior signal is naming the threshold: flat forms → predicate map; composable grammar with `AND`/`OR`/nesting → Interpreter or an existing expression engine. Don't pre-build the AST for a language that may never get operators.
</details>

---

## Next

- Diagnose broken patterns: **[find-bug.md](find-bug.md)**
- Apply the refactorings step by step: **[tasks.md](tasks.md)**
- Theory: **[junior.md](junior.md)** · **[middle.md](middle.md)** · **[senior.md](senior.md)** · **[professional.md](professional.md)** · **[interview.md](interview.md)**
