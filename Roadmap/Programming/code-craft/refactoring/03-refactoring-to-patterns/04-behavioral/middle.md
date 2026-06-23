# Refactoring Toward Behavioral Patterns — Middle Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/behavioral-patterns](https://refactoring.guru/design-patterns/behavioral-patterns)

The junior file covered the "vary one method's behavior" trio: Strategy, State, Template Method. This file moves up a layer to refactorings that restructure **dispatch, absence, and notification** — three of the most common and most quietly damaging behavioral smells in real codebases:

1. **Replace Conditional Dispatcher with Command** — a god-`switch` that routes work.
2. **Introduce Null Object** — null checks metastasizing through a codebase.
3. **Replace Hard-Coded Notifications with Observer** — a class that names everyone it must tell.

We close by sharpening the **Strategy vs State vs raw polymorphism** distinctions, because choosing the wrong one of these is the single most common behavioral-refactoring mistake.

---

## Replace Conditional Dispatcher with Command

### Starting smell

A central method receives an "action code" (a string, enum, opcode, HTTP route, message type) and a giant `switch` routes each code to a block of work. The dispatcher knows about every action, every action's dependencies leak into the dispatcher's class, and the method grows without bound. This is the **conditional dispatcher** smell.

```java
// BEFORE — a request handler that dispatches on a command string.
public class RequestHandler {

    public Response handle(String action, Request req, Session session) {
        switch (action) {
            case "LOGIN": {
                User u = userService.authenticate(req.get("user"), req.get("pass"));
                session.setUser(u);
                return Response.ok("welcome " + u.name());
            }
            case "LOGOUT": {
                session.clear();
                return Response.ok("bye");
            }
            case "PLACE_ORDER": {
                Order o = orderService.create(session.user(), req.cart());
                paymentService.charge(o);
                return Response.ok("order " + o.id());
            }
            case "CANCEL_ORDER": {
                orderService.cancel(req.get("orderId"));
                return Response.ok("cancelled");
            }
            // ... 40 more cases, each pulling in another service
            default:
                return Response.error("unknown action: " + action);
        }
    }
}
```

This class depends on *every* service in the system, is impossible to unit-test in isolation, and merges conflict every time two people add an action.

### Motivation

Turn each branch into a **Command object** — a small class with an `execute` method — and store them in a **map** keyed by action code. Dispatch becomes a lookup, not a branch. Each command owns its own dependencies; the dispatcher owns none. Adding an action means registering a command, with no edit to the dispatcher. Commands also become independently testable, queueable, loggable, and (with the Memento angle from [senior.md](senior.md)) undoable.

> Command as a pattern, including invoker/receiver vocabulary: [`../../../design-patterns/03-behavioral/02-command/junior.md`](../../../design-patterns/03-behavioral/02-command/junior.md).

### Mechanical steps

1. **Define a `Command` interface** capturing the common call: `Response execute(Request req, Session session)`.
2. **Extract one `case` body into one command class.** Move the dependencies that branch used into that command (constructor-injected). Keep behavior identical.
3. **Register the command** in a `Map<String, Command>` under its action code.
4. **Replace the `case` with delegation**: `return registry.get(action).execute(req, session);` — but only after *all* cases are migrated, or run a hybrid where unmigrated cases stay in the switch and migrated ones delegate.
5. **Delete the switch** once every case is a command; the `default` becomes a null-check on the map lookup.
6. **Optionally make registration data-driven** (annotations, config, DI container scan) so new commands self-register.

### After

```java
public interface Command {
    Response execute(Request req, Session session);
}

public final class LoginCommand implements Command {
    private final UserService userService;
    public LoginCommand(UserService userService) { this.userService = userService; }

    public Response execute(Request req, Session session) {
        User u = userService.authenticate(req.get("user"), req.get("pass"));
        session.setUser(u);
        return Response.ok("welcome " + u.name());
    }
}

public final class PlaceOrderCommand implements Command {
    private final OrderService orderService;
    private final PaymentService paymentService;
    public PlaceOrderCommand(OrderService o, PaymentService p) {
        this.orderService = o; this.paymentService = p;
    }
    public Response execute(Request req, Session session) {
        Order o = orderService.create(session.user(), req.cart());
        paymentService.charge(o);
        return Response.ok("order " + o.id());
    }
}
// ... one class per former case, each depending only on what it needs.
```

```java
public class RequestHandler {
    private final Map<String, Command> registry;
    public RequestHandler(Map<String, Command> registry) { this.registry = registry; }

    public Response handle(String action, Request req, Session session) {
        Command cmd = registry.get(action);
        if (cmd == null) return Response.error("unknown action: " + action);
        return cmd.execute(req, session);
    }
}
```

The dispatcher now depends on `Map` and `Command` — nothing else. Forty merge-conflict magnets became forty independent classes.

### When NOT to

- **The dispatcher has only a handful of trivial, dependency-free branches.** A `switch` over an enum returning a value is clearer than a map of one-line commands. The pattern pays off when branches carry *behavior and dependencies*, not just return constants.
- **You need exhaustiveness checks.** A `switch` over a sealed enum lets the compiler prove every case is handled; a `Map` lookup can silently miss a key at runtime. If compile-time exhaustiveness matters more than open extensibility, keep the switch (modern Java `switch` expressions over sealed types are excellent here).
- **The "actions" are genuinely just data transformations** with no side effects or dependencies — a lookup table of functions/lambdas may be lighter than full command classes.

---

## Introduce Null Object

### Starting smell

The same `null` check repeats before nearly every use of some reference, and forgetting one causes an `NullPointerException`. The absence of a value is encoded as `null`, so every caller must remember to handle it — and callers keep forgetting.

```java
// BEFORE — every site that touches the customer's plan must null-check.
public class Customer {
    private SubscriptionPlan plan;   // may be null for free/anonymous users
    public SubscriptionPlan plan() { return plan; }
}

double price = basePrice;
if (customer.plan() != null) {
    price *= (1 - customer.plan().discountRate());
}

String tier = customer.plan() != null ? customer.plan().tierName() : "Free";

int limit = customer.plan() != null ? customer.plan().apiQuota() : 100;
```

The "no plan" concept is real and recurring, but it's expressed as the *absence* of an object, forcing every reader to reconstruct the default behavior inline.

### Motivation

Replace `null` with a **Null Object**: a class implementing the same interface whose methods return neutral, do-nothing defaults. Callers stop branching — they just call methods. The default behavior is defined *once*, in the Null Object, instead of being re-derived at every call site. This is a behavioral pattern because it removes conditional control flow by polymorphism.

> Also treated as a conditional-simplification technique here: [`../../02-refactoring-techniques/04-simplifying-conditionals/junior.md`](../../02-refactoring-techniques/04-simplifying-conditionals/junior.md). The pattern view: see the State doc's relatives and Strategy.

### Mechanical steps

1. **Find the interface (or extract one)** that the real object satisfies — here, `SubscriptionPlan`.
2. **Create a `NullSubscriptionPlan`** implementing it, with each method returning the sensible default that callers were inlining (`discountRate()` → 0, `tierName()` → "Free", `apiQuota()` → 100).
3. **Make the producer return the Null Object instead of `null`.** `Customer.plan()` returns `NullSubscriptionPlan.INSTANCE` when there's no plan. The field is *never* null.
4. **Delete the null checks** at call sites, replacing them with direct calls. Run tests.
5. **Guard the boundary**: ensure no path can still inject a real `null` (e.g. deserialization). The whole benefit collapses if `null` can slip back in.

### After

```java
public final class NullSubscriptionPlan implements SubscriptionPlan {
    public static final SubscriptionPlan INSTANCE = new NullSubscriptionPlan();
    private NullSubscriptionPlan() {}

    public double discountRate() { return 0.0; }      // no discount
    public String tierName()     { return "Free"; }
    public int    apiQuota()     { return 100; }      // free-tier quota
}

public class Customer {
    private SubscriptionPlan plan = NullSubscriptionPlan.INSTANCE; // never null
    public SubscriptionPlan plan() { return plan; }
    public void subscribe(SubscriptionPlan p) {
        this.plan = (p != null) ? p : NullSubscriptionPlan.INSTANCE;
    }
}
```

```java
// Call sites are now branch-free:
double price = basePrice * (1 - customer.plan().discountRate());
String tier  = customer.plan().tierName();
int    limit = customer.plan().apiQuota();
```

### When NOT to

- **Absence is genuinely exceptional** and *must* be handled differently — e.g. "user not found" should not silently become a do-nothing user that lets the caller proceed as if everything's fine. A Null Object can *hide* bugs by swallowing the "missing" case. Reserve it for cases where neutral behavior is genuinely correct.
- **The neutral behavior differs by caller.** If one site wants quota 100 and another wants to reject the request, no single Null Object satisfies both; keep the explicit handling (or use `Optional` to force a decision).
- **You'd rather make absence *visible* in the type.** `Optional<SubscriptionPlan>` forces callers to acknowledge absence at compile time; Null Object makes absence *invisible*. Choose based on whether silent default is the desired UX.

---

## Replace Hard-Coded Notifications with Observer

### Starting smell

When something happens, a class **directly calls a fixed list of named dependents**. Every new thing that needs to react forces an edit to the source class, which now depends on all its listeners — exactly backwards.

```java
// BEFORE — the order service hard-codes who to notify.
public class OrderService {
    private final EmailSender emailSender;
    private final InventoryService inventory;
    private final AnalyticsClient analytics;
    private final LoyaltyService loyalty;

    public void placeOrder(Order order) {
        repository.save(order);

        // hard-coded fan-out: OrderService must know every consumer.
        emailSender.sendConfirmation(order);
        inventory.reserve(order.items());
        analytics.track("order_placed", order);
        loyalty.awardPoints(order.customer(), order.total());
    }
}
```

`OrderService` depends on four unrelated subsystems. Adding "send to fraud-check" means editing and re-testing `OrderService`. The dependency arrows point from a core domain service *out* to peripheral concerns.

### Motivation

Invert the dependency with **Observer** (publish/subscribe): `OrderService` *publishes* an `OrderPlaced` event; interested parties *subscribe*. The publisher no longer knows or names its consumers — it depends only on a listener interface. New reactions are new subscribers, registered elsewhere, with no edit to the publisher.

> Observer as a pattern, plus the push/pull and Mediator comparisons: [`../../../design-patterns/03-behavioral/06-observer/junior.md`](../../../design-patterns/03-behavioral/06-observer/junior.md). For many-to-many coordination consider [Mediator](../../../design-patterns/03-behavioral/04-mediator/junior.md) instead.

### Mechanical steps

1. **Define the event and listener interface.** `interface OrderListener { void onOrderPlaced(Order o); }` (or a typed event bus).
2. **Give the publisher a subscriber list** and `addListener` / `removeListener` methods.
3. **Wrap each hard-coded call in a listener.** `EmailSender`'s confirmation becomes an `OrderListener` that calls it. Do one at a time.
4. **Replace direct calls with a single notify loop**: iterate listeners, call `onOrderPlaced`. Behavior is preserved if you register the same four listeners.
5. **Move registration to the composition root** (wiring/DI config), so the publisher's dependencies disappear.
6. **Decide push vs pull** (pass the `Order` in, or pass a thin event and let listeners query) and the **failure policy** (one listener throwing must not abort the rest — see caveats).

### After

```java
public interface OrderListener {
    void onOrderPlaced(Order order);
}

public class OrderService {
    private final List<OrderListener> listeners = new CopyOnWriteArrayList<>();

    public void addListener(OrderListener l)    { listeners.add(l); }
    public void removeListener(OrderListener l) { listeners.remove(l); }

    public void placeOrder(Order order) {
        repository.save(order);
        for (OrderListener l : listeners) {
            try {
                l.onOrderPlaced(order);          // isolate failures: one bad
            } catch (RuntimeException ex) {       // listener must not abort the rest
                log.error("listener {} failed", l, ex);
            }
        }
    }
}
```

```java
// Listeners are thin adapters around the former hard-coded calls:
class EmailListener implements OrderListener {
    private final EmailSender sender;
    EmailListener(EmailSender s) { this.sender = s; }
    public void onOrderPlaced(Order o) { sender.sendConfirmation(o); }
}
// Wiring (composition root) registers them — OrderService names nobody:
orderService.addListener(new EmailListener(emailSender));
orderService.addListener(new InventoryListener(inventory));
orderService.addListener(new AnalyticsListener(analytics));
orderService.addListener(new LoyaltyListener(loyalty));
```

### When NOT to

- **Order and atomicity matter.** Observer notification order is usually unspecified, and partial failure leaves the world half-updated. If "reserve inventory" *must* succeed-or-rollback with the order, that's a transaction, not a fire-and-forget event. Don't hide a required step behind a listener.
- **There's exactly one consumer, forever.** A direct call is clearer than the indirection. Observer earns its keep with *multiple, varying* reactors.
- **You'll leak listeners.** The lapsed-listener problem (a subscriber that's never removed and is held alive by the publisher) is the #1 Observer bug — a real memory leak. If lifecycles are murky, prefer weak references or an explicit deregistration discipline. (Deep dive in [professional.md](professional.md) and [find-bug.md](find-bug.md).)

---

## Strategy vs State vs raw polymorphism — when each pays off

These three (plus Command, which is "an action as an object") all replace conditionals with objects. Picking wrong produces code that *technically* uses a pattern but fights its grain.

**Raw polymorphism (subtype overriding a method).** Use when the variation is intrinsic to a *type* of thing and chosen once: `Circle.area()` vs `Square.area()`. There's no separate "context" holding a pluggable part; the object *is* the behavior. If you find yourself wanting to swap the behavior on an existing object at runtime, you've outgrown raw polymorphism.

**Strategy.** Use when the variation is a *pluggable algorithm* the client selects and can swap independently of the object's identity. A `TextEditor` with a `SpellChecker` strategy: same editor, swap British/American dictionaries at runtime. Strategy = composition + client-driven selection. The strategy is stateless or holds only its *own* config, never the context's lifecycle.

**State.** Use when behavior depends on the object's *mode*, **and the modes transition among themselves**. A TCP connection's `Closed/Listen/Established`: the state both defines what `send()` does *and* decides the next state on each event. State = composition + self-driven transitions. The tell that separates it from Strategy: *in State, the chosen object changes which object comes next; in Strategy, the client does the choosing and nobody transitions.*

| Question | Yes → |
|---|---|
| Is the behavior fixed by the object's *type* and chosen once? | Raw polymorphism |
| Does the *client* pick a swappable algorithm, with no transitions? | Strategy |
| Does the object's *mode* drive behavior **and** decide the next mode? | State |
| Is the thing being chosen an *action to perform/queue/undo*? | Command |

A useful litmus: write down whether the variant object ever assigns the context's next variant. If yes → State. If never → Strategy. If it's "do this action later/again/undo" → Command.

---

## Next

- **[junior.md](junior.md)** — Strategy, State, Template Method with full before/after and steps.
- **[senior.md](senior.md)** — Visitor, Collecting Parameter, Interpreter, Chain of Responsibility, double dispatch, Command+Memento undo, event-driven design.
- **[professional.md](professional.md)** — virtual dispatch cost, allocation, the Observer listener-leak in depth, when conditionals beat patterns.
- **[interview.md](interview.md)** · **[tasks.md](tasks.md)** · **[find-bug.md](find-bug.md)** · **[optimize.md](optimize.md)**.
- Siblings: **[../01-when-to-refactor-to-patterns/junior.md](../01-when-to-refactor-to-patterns/junior.md)** · **[../05-refactoring-away-from-patterns/junior.md](../05-refactoring-away-from-patterns/junior.md)**.
