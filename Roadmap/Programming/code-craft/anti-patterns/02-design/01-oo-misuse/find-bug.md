# OO Misuse Anti-Patterns — Find the Bug

> **Category:** [Design Anti-Patterns](../README.md) → **OO Misuse** — *object-orientation applied as procedure-with-classes, with the encapsulation turned inside-out.*
> **Covers (collectively):** Anemic Domain Model · BaseBean · Constant Interface · Poltergeist · Object Orgy · Functional Decomposition · Call Super · Magic Container · Flag Arguments · Telescoping Constructor · Fragile Base Class

---

This file is **critical-reading practice**. Each snippet below is a plausible chunk of real-world code in Go, Java, or Python. Your job is to read it the way a good reviewer does and answer three questions:

> **What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?**

OO-misuse anti-patterns are *class-shaped* mistakes: the responsibilities are allocated wrongly, the encapsulation leaks, or the inheritance contract is unwritten. The "bug" is rarely a crash on line one — but bad object design **hides and causes real functional bugs**, and several snippets here contain one: a forgotten `super` call that breaks an invariant, a base-class change that silently corrupts a subclass, a stringly-typed map key that NPEs in production, a flag argument flipped the wrong way. A few snippets are deliberate traps — code that *looks* like an anti-pattern but is the right call in context. Read slowly, decide, then open the answer.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you're training is noticing the shape — and proving the bug to yourself — not recalling the name.

---

## Table of Contents

1. [The order that priced itself elsewhere](#snippet-1--the-order-that-priced-itself-elsewhere)
2. [The base class everything extends](#snippet-2--the-base-class-everything-extends)
3. [The constants everyone implements](#snippet-3--the-constants-everyone-implements)
4. [The manager that just delegates](#snippet-4--the-manager-that-just-delegates)
5. [The event everyone can edit](#snippet-5--the-event-everyone-can-edit)
6. [The class full of statics](#snippet-6--the-class-full-of-statics)
7. [The lifecycle hook that must call super](#snippet-7--the-lifecycle-hook-that-must-call-super)
8. [The context bag](#snippet-8--the-context-bag)
9. [The transfer with a boolean](#snippet-9--the-transfer-with-a-boolean)
10. [The notification constructors](#snippet-10--the-notification-constructors)
11. [The base class that added a field](#snippet-11--the-base-class-that-added-a-field)
12. [The wallet that trusts its caller](#snippet-12--the-wallet-that-trusts-its-caller)
13. [The audited repository](#snippet-13--the-audited-repository)
14. [The DTO with no behavior](#snippet-14--the-dto-with-no-behavior)
15. [The private helper with a flag](#snippet-15--the-private-helper-with-a-flag)

---

## Snippet 1 — The order that priced itself elsewhere

```java
// Java — an "Order" domain object and the service that operates on it
public class Order {
    private List<LineItem> items = new ArrayList<>();
    private OrderStatus status = OrderStatus.DRAFT;
    private BigDecimal total = BigDecimal.ZERO;

    public List<LineItem> getItems()        { return items; }
    public void setItems(List<LineItem> i)  { this.items = i; }
    public OrderStatus getStatus()          { return status; }
    public void setStatus(OrderStatus s)    { this.status = s; }
    public BigDecimal getTotal()            { return total; }
    public void setTotal(BigDecimal t)      { this.total = t; }
}

public class OrderService {
    public void submit(Order order) {
        BigDecimal total = order.getItems().stream()
            .map(LineItem::subtotal).reduce(BigDecimal.ZERO, BigDecimal::add);
        order.setTotal(total);
        order.setStatus(OrderStatus.SUBMITTED);
        repo.save(order);
    }
}

// elsewhere — a second entry point added a year later by another team
public class BulkImporter {
    public void importOrder(Order order) {
        order.setStatus(OrderStatus.SUBMITTED);   // mark it submitted
        repo.save(order);                          // ...and persist
    }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Anemic Domain Model** — *and it causes a real data-integrity bug.*

`Order` is a bag of getters and setters with zero behavior. The rule "an order's `total` is the sum of its line-item subtotals, and you may only submit a priced order" lives in `OrderService.submit`, not in `Order`. Because the invariant is enforced *outside* the object, any second caller can violate it.

**The actual bug:** `BulkImporter.importOrder` sets the status to `SUBMITTED` and saves — but **never computes `total`**. The imported order is persisted as submitted with `total == 0`. There was no compiler or object to stop it, because `Order` doesn't own its own invariant; the logic that should have run lived in a different class and was simply skipped. This is the defining failure mode of an anemic model: the rules are reachable by some code paths and bypassed by others.

**Fix — move the behavior (and the invariant) into the object:**

```java
public class Order {
    private final List<LineItem> items = new ArrayList<>();
    private OrderStatus status = OrderStatus.DRAFT;
    private BigDecimal total = BigDecimal.ZERO;

    public void submit() {
        this.total = items.stream()
            .map(LineItem::subtotal).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (total.signum() <= 0)
            throw new IllegalStateException("cannot submit an order with no value");
        this.status = OrderStatus.SUBMITTED;
    }
    // no public setStatus/setTotal — the only way to become SUBMITTED is submit()
}
```

Now *both* callers go through `order.submit()`; there is no path that submits without pricing, because the rule lives where the data lives ([Tell, Don't Ask](../../../clean-code/05-objects-and-data-structures/README.md)).

</details>

---

## Snippet 2 — The base class everything extends

```java
// Java — every service in the app extends this
public abstract class BaseService {
    protected Logger log = LoggerFactory.getLogger(getClass());
    protected ObjectMapper json = new ObjectMapper();

    protected String toJson(Object o) {
        try { return json.writeValueAsString(o); }
        catch (Exception e) { throw new RuntimeException(e); }
    }
    protected boolean isBlank(String s) { return s == null || s.trim().isEmpty(); }
    protected Instant now() { return Instant.now(); }
}

public class UserService extends BaseService {
    public void register(String email) {
        if (isBlank(email)) throw new IllegalArgumentException("email required");
        log.info("registering {}", toJson(email));
        // ...
    }
}

public class PaymentService extends BaseService {
    public void charge(Money m) {
        log.info("charging at {}", now());
        // ...
    }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**BaseBean** (a.k.a. inheritance-for-utilities).

`UserService` and `PaymentService` extend `BaseService` not because they *are* a kind of service with shared behavior, but to reach grab-bag helpers — `toJson`, `isBlank`, `now`. Inheritance is being used as a namespace for utilities. The "is-a" relationship is a lie: a `PaymentService` is not a specialized `BaseService` in any behavioral sense.

**Concrete problems:**
- **Single-inheritance is spent on nothing.** In Java you get one superclass; you've burned it on a utility bucket, so a service that genuinely needs to specialize some other base can't.
- **The base becomes a magnet.** Every new helper anyone wants goes into `BaseService`, which grows toward a God Object that every service in the app transitively depends on and must recompile when it changes.
- **Hidden coupling and fragility.** `BaseService` is now on the inheritance path of dozens of classes; changing `now()` to return `OffsetDateTime` ripples everywhere ([Fragile Base Class](#snippet-11--the-base-class-that-added-a-field) territory).

**Fix — composition / free functions instead of inheritance:**

```java
// utilities are just functions (or a small injected helper), not a superclass
public final class Json {
    public static String of(Object o) { /* ... */ }
}
public final class Strings {
    public static boolean isBlank(String s) { return s == null || s.isBlank(); }
}

public class UserService {                       // extends nothing
    private static final Logger log = LoggerFactory.getLogger(UserService.class);
    private final Clock clock;                   // injected — testable
    public UserService(Clock clock) { this.clock = clock; }
}
```

`isBlank` is a stateless function; the logger is a static field per class; the clock is *injected* (which also makes time testable, something the inherited `now()` quietly prevented).

</details>

---

## Snippet 3 — The constants everyone implements

```java
// Java — shared constants for the protocol layer
public interface ProtocolConstants {
    int    DEFAULT_PORT     = 8080;
    int    MAX_PACKET_SIZE  = 65_535;
    String MAGIC_HEADER     = "X-PROTO-V2";
    byte   FRAME_START      = 0x02;
}

// dozens of classes do this to "get" the constants:
public class FrameDecoder implements ProtocolConstants {
    public Frame decode(byte[] buf) {
        if (buf.length > MAX_PACKET_SIZE) throw new FrameTooBigException();
        if (buf[0] != FRAME_START)        throw new BadFrameException();
        // ...
    }
}

public class TlsFrameDecoder extends FrameDecoder implements Serializable {
    // inherits ProtocolConstants through FrameDecoder — and now they're
    // part of TlsFrameDecoder's public API surface too
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Constant Interface.** `ProtocolConstants` declares no behavior — it exists only so implementers can write `MAX_PACKET_SIZE` unqualified instead of `ProtocolConstants.MAX_PACKET_SIZE`. `implements` is being abused as an import mechanism.

**Concrete problems:**
- **It leaks into the public type contract.** `FrameDecoder implements ProtocolConstants` means *every subclass* (`TlsFrameDecoder`) and every caller that does `instanceof ProtocolConstants` now treats an implementation detail (which constants you happen to use) as part of your published API. You can't remove the interface later without a breaking change.
- **Namespace pollution.** All those constant names are now in scope inside the class, colliding with locals and obscuring where a name comes from.
- **It says nothing meaningful.** `implements ProtocolConstants` reads like a capability ("this is a protocol thing") but is pure plumbing — misleading to readers.

**Fix — constants belong on a type that holds them, imported explicitly where needed:**

```java
public final class Protocol {                    // a holder, not an interface
    private Protocol() {}
    public static final int    DEFAULT_PORT    = 8080;
    public static final int    MAX_PACKET_SIZE = 65_535;
    public static final byte   FRAME_START     = 0x02;
}

import static com.example.Protocol.MAX_PACKET_SIZE;   // static import where wanted

public class FrameDecoder {                      // implements nothing for constants
    public Frame decode(byte[] buf) {
        if (buf.length > MAX_PACKET_SIZE) throw new FrameTooBigException();
    }
}
```

Constants now have one home, don't pollute every subclass's API, and `enum` is the even better choice when the constants form a closed set (e.g. frame types).

</details>

---

## Snippet 4 — The manager that just delegates

```python
# Python — order cancellation flow
class CancellationManager:
    def __init__(self, order_repo, refund_service):
        self.order_repo = order_repo
        self.refund_service = refund_service

    def cancel(self, order_id):
        helper = CancellationHelper(self.order_repo, self.refund_service)
        return helper.do_cancel(order_id)

class CancellationHelper:
    def __init__(self, order_repo, refund_service):
        self.order_repo = order_repo
        self.refund_service = refund_service

    def do_cancel(self, order_id):
        order = self.order_repo.get(order_id)
        order.status = "CANCELLED"
        self.order_repo.save(order)
        self.refund_service.refund(order)
        return order
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Poltergeist.** `CancellationManager` has no state and no logic of its own. It is constructed, it constructs a `CancellationHelper`, forwards the same dependencies, calls one method, and vanishes. It appears, acts as a pass-through, and contributes nothing — the textbook poltergeist (a "short-lived object whose only job is to invoke a method on another object").

**Concrete problems:**
- **Pure indirection tax.** To follow `cancel`, a reader has to jump through two classes that both hold the same two fields and do the same wiring. The `Manager`/`Helper` split adds cognitive cost and zero capability.
- **Allocation churn / leak surface.** A new `CancellationHelper` is built on every call for no reason; in hotter paths this is needless garbage.
- **It hides where the real logic is.** Reviewers waste time deciding which class "owns" cancellation. The answer is "neither, really."

**Fix — inline the poltergeist; let the object that has the logic own it:**

```python
class CancellationService:
    def __init__(self, order_repo, refund_service):
        self.order_repo = order_repo
        self.refund_service = refund_service

    def cancel(self, order_id):
        order = self.order_repo.get(order_id)
        order.status = "CANCELLED"
        self.order_repo.save(order)
        self.refund_service.refund(order)
        return order
```

One class, one responsibility, no ghost in the middle. (Bonus: the cancellation rule itself arguably belongs on `Order.cancel()` — see [Snippet 1](#snippet-1--the-order-that-priced-itself-elsewhere).)

</details>

---

## Snippet 5 — The event everyone can edit

```go
// Go — a calendar event shared across a scheduling pipeline
type Event struct {
    Title     string
    Start     time.Time
    End       time.Time
    Attendees []string
}

func (s *Scheduler) Book(e *Event) error {
    if !e.End.After(e.Start) {
        return errors.New("end must be after start")
    }
    s.calendar[e.Start] = e          // store the pointer
    s.notify(e.Attendees)
    return nil
}

// far away, in a reminder worker that received the same *Event
func (w *ReminderWorker) prepare(e *Event) {
    // "normalize" the window for the reminder UI
    e.Start = e.Start.Add(-15 * time.Minute)   // mutates the shared event!
    e.End = e.End.Add(-15 * time.Minute)
    w.enqueue(e)
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Object Orgy** — fully-exposed mutable fields shared by reference, causing a real **state-corruption bug** (a flavor of [Action at a Distance](../02-coupling-and-state/find-bug.md)).

`Event` has all-public fields and is passed around as a `*Event`. `Scheduler.Book` stores that very pointer in `s.calendar`. Later, `ReminderWorker.prepare` receives the same pointer and freely mutates `Start`/`End` to shift the reminder window. Encapsulation is fiction — anyone holding the pointer can rewrite the object's guts.

**The actual bug:** `prepare` shifts `Start`/`End` back 15 minutes *on the shared object that `Scheduler` already stored in `s.calendar`*. The booked event's real time is now silently corrupted: the calendar entry, and every other holder of that pointer, now reads a start time 15 minutes early. The change happens "at a distance" — nothing at the `Book` call site hints that a worker elsewhere will rewrite the booking. A reviewer reading `Book` alone sees nothing wrong.

**Fix — don't share mutable internals; copy at the boundary (or make the type immutable):**

```go
func (w *ReminderWorker) prepare(e Event) {       // take by value: a copy
    e.Start = e.Start.Add(-15 * time.Minute)      // mutates only the local copy
    e.End = e.End.Add(-15 * time.Minute)
    w.enqueue(&e)
}

// and have Book defend itself by storing a copy, not the caller's pointer:
func (s *Scheduler) Book(e Event) error {
    if !e.End.After(e.Start) { return errors.New("end must be after start") }
    stored := e                                   // own copy
    s.calendar[e.Start] = &stored
    s.notify(e.Attendees)
    return nil
}
```

The reminder window is now a private adjustment on a copy; the stored booking is immune. Where the type must stay a pointer, give it accessor methods and return defensive copies of slices like `Attendees`.

</details>

---

## Snippet 6 — The class full of statics

```python
# Python — the "geometry engine" of a CAD-ish app
class GeometryEngine:
    @staticmethod
    def distance(a, b):
        return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5

    @staticmethod
    def midpoint(a, b):
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)

    @staticmethod
    def translate(point, dx, dy):
        return (point[0] + dx, point[1] + dy)

    @staticmethod
    def area_of_triangle(a, b, c):
        return abs((a[0]*(b[1]-c[1]) + b[0]*(c[1]-a[1]) + c[0]*(a[1]-b[1])) / 2)

# usage everywhere:
d = GeometryEngine.distance(p1, p2)
m = GeometryEngine.midpoint(p1, p2)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Functional Decomposition.** `GeometryEngine` is a class in name only — it holds no state, is never instantiated, and is purely a container for a pile of `@staticmethod` free functions. This is procedural code wearing a class costume because the author reflexively reached for `class`.

**Concrete problems:**
- **The class earns nothing.** No state, no polymorphism, no instances — `GeometryEngine.distance(a, b)` is strictly more typing than `distance(a, b)` with no benefit.
- **It misrepresents the design.** Readers expect a class to model *something*; this one models nothing, so it sends a false signal and invites people to start hanging unrelated statics on it (toward a God Object).
- **It also reveals a missing real object.** Points are bare tuples (`a[0]`, `a[1]`) — the actual domain object (`Point`) that *should* carry this behavior is absent.

**Fix — depends on the language and whether there's real state:**

In Python (or Go), just use module-level functions:

```python
# geometry.py
def distance(a, b): ...
def midpoint(a, b): ...

from geometry import distance, midpoint
d = distance(p1, p2)
```

Or, better, give the data a real object so the behavior has a natural home:

```python
@dataclass(frozen=True)
class Point:
    x: float
    y: float
    def distance_to(self, other): return math.hypot(self.x - other.x, self.y - other.y)
    def midpoint(self, other):    return Point((self.x+other.x)/2, (self.y+other.y)/2)
```

> **Distinction:** Functional Decomposition is "functions pretending to be a class." The cure is *either* embrace functions (no class) *or* find the real object the functions are operating on and give it methods — not to keep the empty class.

</details>

---

## Snippet 7 — The lifecycle hook that must call super

```java
// Java — a framework base class for request handlers
public abstract class RequestHandler {
    private final List<AutoCloseable> opened = new ArrayList<>();

    // subclasses override this to open per-request resources
    public void onRequest(Request req) {
        // base sets up tracing + a span we MUST close in onComplete
        Tracer.startSpan(req.id());
        opened.add(Tracer.currentSpan());
    }

    public void onComplete(Request req) {
        // base closes everything opened during the request
        for (AutoCloseable c : opened) { try { c.close(); } catch (Exception ignored) {} }
        opened.clear();
    }
}

public class CheckoutHandler extends RequestHandler {
    private Connection conn;

    @Override
    public void onRequest(Request req) {
        // (forgot to call super.onRequest(req))
        this.conn = pool.acquire();
        // ... handle checkout ...
    }

    @Override
    public void onComplete(Request req) {
        super.onComplete(req);
        if (conn != null) pool.release(conn);
    }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Call Super** — *with the exact bug Call Super is named for.*

The base class's design *requires* every override of `onRequest` to call `super.onRequest(req)` so that the tracing span is started and registered in `opened` (so `onComplete` can close it). This contract is invisible — it's not in the type system, only in the base author's head.

**The actual bug:** `CheckoutHandler.onRequest` **forgot `super.onRequest(req)`**. Consequences:
1. No span is started for checkout requests → tracing/observability silently has a hole exactly where it matters most.
2. Because the span was never added to `opened`, `onComplete` has nothing to close — but more importantly, the *base's setup never ran*, so any invariant the base established (here, the span lifecycle) is broken. Forgetting the call compiles cleanly and fails only at runtime, intermittently, in a way no one notices until a trace is missing during an incident.

This is why Call Super is an anti-pattern: "override this, but you *must* remember to call me" is an unenforceable contract.

**Fix — invert control with the Template Method pattern.** The base owns the non-overridable lifecycle (`final`) and calls a separate abstract hook the subclass fills in. There is now *nothing for the subclass to forget*:

```java
public abstract class RequestHandler {
    private final List<AutoCloseable> opened = new ArrayList<>();

    public final void handle(Request req) {        // final: subclasses can't break the flow
        Tracer.startSpan(req.id());
        opened.add(Tracer.currentSpan());
        try {
            doHandle(req);                          // the only thing subclasses write
        } finally {
            for (AutoCloseable c : opened) { try { c.close(); } catch (Exception ignored) {} }
            opened.clear();
        }
    }

    protected abstract void doHandle(Request req);  // the hook, no super to call
}

public class CheckoutHandler extends RequestHandler {
    @Override protected void doHandle(Request req) {
        try (Connection conn = pool.acquire()) { /* ... handle checkout ... */ }
    }
}
```

The span lifecycle can no longer be skipped; the subclass physically cannot forget a call it never makes.

</details>

---

## Snippet 8 — The context bag

```python
# Python — request context threaded through a pipeline
def handle(request):
    ctx = {
        "user_id": request.user_id,
        "tenant": request.tenant,
        "locale": request.headers.get("Accept-Language", "en"),
    }
    enrich(ctx)
    return render(ctx)

def enrich(ctx):
    user = db.get_user(ctx["user_id"])
    ctx["user_name"] = user.name
    ctx["is_admin"] = user.role == "admin"
    # note: stored under "tier", read elsewhere as "user_tier"
    ctx["tier"] = user.tier

def render(ctx):
    greeting = f"Hello {ctx['user_name']}"
    if ctx["is_admin"]:
        greeting += " (admin)"
    # pricing depends on tier
    discount = TIER_DISCOUNTS[ctx["user_tier"]]      # KeyError waiting to happen
    return template.render(greeting=greeting, discount=discount, locale=ctx["locale"])
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Magic Container** — a `dict[str, Any]` passed everywhere as the de facto request type, with **a real runtime bug** the stringly-typed keys cause.

`ctx` is an untyped bag. Nothing documents which keys exist, which stage populates which key, or what their types are. The "schema" is scattered across `handle`, `enrich`, and `render` and exists only in the programmers' memory.

**The actual bug:** `enrich` writes the tier under the key `"tier"`, but `render` reads it as `ctx["user_tier"]`. The names don't match. There is no compiler, no field, no type to catch it — so `render` raises `KeyError: 'user_tier'` at runtime, in production, on the pricing path. A typo'd/mismatched key in a magic container is exactly the class of bug a real type would have made impossible. (In Java/Go the same pattern with `Map<String,Object>` / `map[string]any` produces an NPE or a zero-value-masquerading-as-data bug instead.)

**Fix — define a real type with named fields; let the tooling enforce the schema:**

```python
@dataclass
class RequestContext:
    user_id: int
    tenant: str
    locale: str
    user_name: str | None = None
    is_admin: bool = False
    tier: str | None = None

def enrich(ctx: RequestContext) -> None:
    user = db.get_user(ctx.user_id)
    ctx.user_name = user.name
    ctx.is_admin = user.role == "admin"
    ctx.tier = user.tier

def render(ctx: RequestContext):
    discount = TIER_DISCOUNTS[ctx.tier]   # ctx.user_tier wouldn't even type-check
```

`ctx.user_tier` is now a static error (caught by mypy/IDE before running); fields are discoverable, typed, and self-documenting.

</details>

---

## Snippet 9 — The transfer with a boolean

```go
// Go — money movement between accounts
func Transfer(from, to *Account, amount Money, notify bool) error {
    if from.Balance < amount {
        return errors.New("insufficient funds")
    }
    from.Balance -= amount
    to.Balance += amount
    ledger.Record(from, to, amount)
    if notify {
        mailer.Send(from.Owner, "debit", amount)
        mailer.Send(to.Owner, "credit", amount)
    }
    return nil
}

// two call sites:
func handleUserTransfer(req Req) error {
    return Transfer(req.From, req.To, req.Amount, false)   // user-initiated
}

func reconcileNightly(a, b *Account, m Money) error {
    return Transfer(a, b, m, true)                          // internal sweep
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Flag Argument** — *and the two call sites have the boolean backwards, which is the bug.*

`notify bool` flips `Transfer` between two behaviors: "move money silently" and "move money and email both parties." A boolean parameter that switches behavior means the function is really two functions welded together, and the call site reads as `Transfer(a, b, m, true)` — `true` *what*? You can't tell without opening the signature.

**The actual bug, hiding in plain sight:** the *user-initiated* transfer passes `false` (no email — so the customer gets no debit/credit notification for a transfer they made), while the *internal nightly reconciliation sweep* passes `true` (spamming account owners with emails about internal bookkeeping moves they didn't initiate). That's almost certainly inverted. Because the argument is a bare positional `bool`, nothing at the call site makes the mistake visible — `..., false)` and `..., true)` both look fine. Flag arguments are notorious for exactly this: the boolean gets transposed and no reviewer notices.

**Fix — split into two intention-revealing methods (or, if you must keep one path, pass a named enum, never a bare bool):**

```go
// two methods, each named for what it does:
func Transfer(from, to *Account, amount Money) error { /* moves money, no email */ }

func TransferAndNotify(from, to *Account, amount Money) error {
    if err := Transfer(from, to, amount); err != nil { return err }
    mailer.Send(from.Owner, "debit", amount)
    mailer.Send(to.Owner, "credit", amount)
    return nil
}

func handleUserTransfer(req Req) error { return TransferAndNotify(req.From, req.To, req.Amount) }
func reconcileNightly(a, b *Account, m Money) error { return Transfer(a, b, m) }
```

Now the call site *states the behavior* — `TransferAndNotify` vs `Transfer` — and you cannot silently pick the wrong one with a transposed boolean.

</details>

---

## Snippet 10 — The notification constructors

```java
// Java — a Notification value object, grown over many features
public class Notification {
    private final String recipient;
    private final String subject;
    private final String body;
    private final boolean html;
    private final int priority;
    private final String replyTo;
    private final List<String> cc;
    private final Instant scheduledAt;

    public Notification(String recipient, String subject, String body) {
        this(recipient, subject, body, false);
    }
    public Notification(String recipient, String subject, String body, boolean html) {
        this(recipient, subject, body, html, 0);
    }
    public Notification(String recipient, String subject, String body,
                        boolean html, int priority) {
        this(recipient, subject, body, html, priority, null);
    }
    public Notification(String recipient, String subject, String body,
                        boolean html, int priority, String replyTo) {
        this(recipient, subject, body, html, priority, replyTo, List.of(), null);
    }
    public Notification(String recipient, String subject, String body, boolean html,
                        int priority, String replyTo, List<String> cc, Instant scheduledAt) {
        this.recipient = recipient; this.subject = subject; this.body = body;
        this.html = html; this.priority = priority; this.replyTo = replyTo;
        this.cc = cc; this.scheduledAt = scheduledAt;
    }
}

// a call site:
new Notification("a@x.com", "Hi", "<b>hello</b>", true, 5, null, List.of(), someTime);
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Telescoping Constructor** (with a **Flag Argument**, `boolean html`, baked into the chain).

The constructor overload set grows with each new optional field: 3-arg, 4-arg, 5-arg, 6-arg, 8-arg. Callers must remember positional order and pad with `null`/`List.of()` for fields they don't care about.

**Concrete problems:**
- **Unreadable, error-prone call sites.** `new Notification("a@x.com", "Hi", "<b>hello</b>", true, 5, null, List.of(), someTime)` — which argument is `priority`? Is `true` the `html` flag or something else? Two same-typed adjacent params (the `boolean html` and the ints/strings around it) are trivially transposable, and the compiler won't catch swapping two `String`s.
- **Combinatorial overloads.** Want `cc` without `replyTo`? There's no overload for that; you pass `null` for `replyTo`. The set can't cover every subset, so callers pad.
- **The embedded flag argument** (`html`) compounds it — see [Snippet 9](#snippet-9--the-transfer-with-a-boolean).

**Fix — Builder pattern (or named arguments in languages that have them):**

```java
Notification n = Notification.builder()
    .recipient("a@x.com")
    .subject("Hi")
    .htmlBody("<b>hello</b>")     // method name encodes the "html" choice — no bare bool
    .priority(5)
    .scheduledAt(someTime)
    .build();                     // build() can validate invariants in one place
```

Each field is set by name; unset fields take defaults; the order is irrelevant; and `build()` is the single place to enforce cross-field invariants (e.g. "scheduledAt must be in the future").

> In Python this anti-pattern barely arises — keyword arguments with defaults *are* the named-argument fix: `Notification(recipient=..., html=True, priority=5)`.

</details>

---

## Snippet 11 — The base class that added a field

```python
# Python — a framework base collection, used by many subclasses
class CountingList:
    def __init__(self):
        self._items = []
        self._add_count = 0          # how many times add() was called

    def add(self, item):
        self._items.append(item)
        self._add_count += 1

    def add_all(self, items):
        for it in items:
            self.add(item=it)        # delegates to add() so the count stays correct

    def add_count(self):
        return self._add_count

# a subclass written by another team, against the ORIGINAL base
class DedupeList(CountingList):
    def add(self, item):
        if item not in self._items:
            super().add(item)

    def add_all(self, items):
        # optimization: bulk-insert unique items directly, skip per-item add()
        unique = [i for i in items if i not in self._items]
        self._items.extend(unique)   # bypasses add(), so _add_count is now wrong
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Fragile Base Class** — *a self-use change in the base silently breaks the subclass's invariant* (this is the canonical fragile-base-class scenario, the same one that bit Java's `HashSet`/`HashMap` history).

The base `CountingList` maintains an invariant: `_add_count` equals the number of items added. It upholds this by routing `add_all` through `self.add()`. `DedupeList` overrode `add` (fine) **but also overrode `add_all` to bypass `add()`** for a bulk optimization, appending directly to `self._items`. Now `_add_count` is never incremented for bulk inserts.

**The actual bug, and why it's "fragile base class" and not just a subclass mistake:** the breakage hinges on an *undocumented* fact — whether the base implements `add_all` in terms of `add` (self-use). The `DedupeList` author couldn't know that contract. Worse, the failure can flip the *other* direction too: suppose the base author later "optimizes" `CountingList.add_all` to extend `_items` directly and bump `_add_count` once — that silently breaks `DedupeList`, whose dedup logic *depended on* `add_all` calling the overridden `add`. Either side changing its private self-use pattern corrupts the other, because the inheritance contract (who calls whom) was never written down or enforced.

**Fix — prefer composition; if you must inherit, document the self-use contract and provide non-overridable template methods:**

```python
# Composition removes the fragility entirely:
class DedupeList:
    def __init__(self):
        self._inner = CountingList()      # has-a, not is-a
        self._seen = set()

    def add(self, item):
        if item not in self._seen:
            self._seen.add(item)
            self._inner.add(item)         # always goes through the public API

    def add_all(self, items):
        for it in items:
            self.add(it)                  # we control our own dispatch; no hidden self-use

    def add_count(self):
        return self._inner.add_count()
```

By wrapping rather than extending, `DedupeList` depends only on `CountingList`'s *public* behavior, not its internal call graph. The base can change how `add_all` is implemented without breaking us, and vice versa.

</details>

---

## Snippet 12 — The wallet that trusts its caller

```python
# Python — an in-game wallet
class Wallet:
    def __init__(self):
        self.balance = 0
        self.transactions = []

class WalletService:
    def spend(self, wallet, amount):
        if wallet.balance >= amount:
            wallet.balance -= amount
            wallet.transactions.append(("spend", amount))
            return True
        return False

# a feature added later — "gift" coins between players
def gift(sender_wallet, receiver_wallet, amount):
    sender_wallet.balance -= amount             # no check!
    receiver_wallet.balance += amount

# and a leaderboard module that just reads... or does it
def recompute_rank(wallet):
    wallet.transactions.sort(key=lambda t: t[1])   # sorts the LIVE list in place
    return derive_rank(wallet.transactions)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Multi-pattern:** **Anemic Domain Model** + **Object Orgy**, combining into **two real bugs**.

- `Wallet` is anemic: it has public `balance` and `transactions` and *no behavior*. The rule "you cannot spend more than you have" lives in `WalletService.spend`, not in `Wallet`.
- The fields are fully exposed (Object Orgy), so any module can reach in and mutate them directly, bypassing whatever rules `WalletService` pretends to enforce.

**Bug 1 — invariant bypass (anemic model):** `gift` debits `sender_wallet.balance` with **no balance check**. Because the "can't go negative" rule isn't owned by `Wallet` (it's stranded in `spend`), the new `gift` path simply skips it. A player can gift coins they don't have, driving their balance negative — exactly the failure mode of an anemic model: a second code path forgets the rule that should have been intrinsic.

**Bug 2 — encapsulation breach (object orgy):** `recompute_rank` calls `wallet.transactions.sort(...)`, mutating the wallet's **live transaction list in place** just to compute a rank. A read operation silently reorders persistent state shared by reference. Any code that assumed `transactions` is in insertion order (e.g. statements, audit) is now corrupted at a distance.

**Fix — give `Wallet` behavior and stop exposing its internals:**

```python
class Wallet:
    def __init__(self):
        self._balance = 0
        self._transactions = []

    @property
    def balance(self): return self._balance

    def spend(self, amount):
        if amount <= 0 or amount > self._balance:
            raise ValueError("invalid spend")          # the rule lives here, always
        self._balance -= amount
        self._transactions.append(("spend", amount))

    def gift_to(self, other, amount):
        self.spend(amount)                              # reuses the SAME guarded path
        other.receive(amount)

    def receive(self, amount):
        self._balance += amount
        self._transactions.append(("receive", amount))

    def transactions(self):
        return list(self._transactions)                # defensive copy: callers can't sort the live list
```

Now there is exactly one place the balance can decrease (`spend`), `gift_to` reuses it, and `recompute_rank` gets a copy it can sort harmlessly.

</details>

---

## Snippet 13 — The audited repository

```python
# Python — a base repository giving every entity an audit trail
class AuditedRepository:
    def save(self, entity):
        self._write_audit("save", entity)    # MUST run before persistence
        self._persist(entity)

    def delete(self, entity):
        self._write_audit("delete", entity)
        self._remove(entity)

    def _write_audit(self, action, entity):
        audit_log.append(action, entity.id, now())

class OrderRepository(AuditedRepository):
    def save(self, order):
        # adds order-specific validation, then persists
        if not order.line_items:
            raise ValueError("empty order")
        self._persist(order)                  # overrode save(); calls _persist directly

    def _persist(self, order):
        db.upsert("orders", order)
    def _remove(self, order):
        db.delete("orders", order.id)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Multi-pattern:** **Call Super** + **Fragile Base Class**, combining into a **compliance bug** (missing audit records).

The base `AuditedRepository.save` enforces an invariant: *every* save writes an audit record before persisting. It does this by sequencing `_write_audit` then `_persist` inside `save`. The unwritten contract is "if you override `save`, you must still go through the base's audit step" — a Call Super expectation that the type system does not enforce.

**The actual bug:** `OrderRepository` **overrode `save` entirely** to add validation, and called `self._persist(order)` directly — it never invokes the base's audit logic (no `super().save(...)`, no `_write_audit`). Result: **order saves are silently not audited.** Deletes still are (that method wasn't overridden), so the gap is inconsistent and easy to miss — the audit log looks populated. This is simultaneously Call Super (forgot to chain to the base behavior) and Fragile Base Class (the base's "audit happens inside `save`" design is broken the moment a subclass overrides `save` without knowing the rule). In a regulated system, a missing audit trail is a serious, hard-to-detect defect.

**Fix — Template Method: make the audited flow non-overridable, expose a separate hook for the part that varies:**

```python
class AuditedRepository:
    def save(self, entity):                # NOT meant to be overridden
        self._validate(entity)             # hook
        self._write_audit("save", entity)  # invariant: always audited
        self._persist(entity)              # hook

    def delete(self, entity):
        self._write_audit("delete", entity)
        self._remove(entity)

    # hooks subclasses fill in — no super() to remember
    def _validate(self, entity): pass
    def _persist(self, entity):  raise NotImplementedError
    def _remove(self, entity):   raise NotImplementedError

class OrderRepository(AuditedRepository):
    def _validate(self, order):
        if not order.line_items:
            raise ValueError("empty order")
    def _persist(self, order): db.upsert("orders", order)
    def _remove(self, order):  db.delete("orders", order.id)
```

`OrderRepository` now customizes *only* validation and persistence; it cannot bypass the audit step because it no longer overrides `save` at all. The invariant is structurally guaranteed, not trusted to memory.

</details>

---

## Snippet 14 — The DTO with no behavior

```go
// Go — the wire type for a public REST API
type UserResponse struct {
    ID        string    `json:"id"`
    Email     string    `json:"email"`
    CreatedAt time.Time `json:"created_at"`
    Plan      string    `json:"plan"`
}

func toResponse(u domain.User) UserResponse {
    return UserResponse{
        ID:        u.ID().String(),
        Email:     u.Email(),
        CreatedAt: u.CreatedAt(),
        Plan:      string(u.Plan()),
    }
}

func GetUser(w http.ResponseWriter, r *http.Request) {
    u, err := svc.Find(mux.Vars(r)["id"])
    if err != nil { http.Error(w, err.Error(), 404); return }
    json.NewEncoder(w).Encode(toResponse(u))
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet: this is NOT an Anemic Domain Model — it's a justified anemic *DTO*, and you should leave it alone.**

At a glance `UserResponse` looks anemic: all public fields, no behavior. But it isn't a *domain* object — it's a **Data Transfer Object at a serialization boundary**. Its entire job is to be a flat, dumb, public-API-shaped struct that the JSON encoder marshals. The real domain object (`domain.User`) is the one with behavior and invariants (note `u.Email()`, `u.Plan()` are *methods* — `User` encapsulates its state), and `toResponse` is the deliberate translation from the rich internal model to the dumb external contract.

**Why the "anemic" verdict is wrong here:**
- A DTO *should* have no behavior — putting business logic on the wire type would couple your public API shape to your domain rules and leak internals.
- The anemic-domain-model anti-pattern is specifically about *domain entities* that have lost their behavior to service classes. This struct is not a domain entity; it's a boundary adapter.
- Keeping the API type separate from `domain.User` is exactly the right call: it lets the domain evolve without breaking the published JSON contract, and vice versa.

**The lesson for critical reading:** "no methods, all fields" is anemic only when the type is supposed to *be* the domain model. At an I/O boundary (HTTP/JSON, DB rows, protobuf messages, queue payloads), a behavior-free data holder is correct design, not a smell. Diagnose by **role**, not by shape: ask "is this meant to enforce business rules?" Here, no — `domain.User` does that.

> The one thing worth watching: if logic *about* users (e.g. "is this plan eligible for X?") starts creeping into handlers that read `UserResponse.Plan`, *that* would be the anemic anti-pattern reasserting itself — the rule belongs on `domain.User`, not re-derived from the DTO.

</details>

---

## Snippet 15 — The private helper with a flag

```python
# Python — inside a single module; _format is private (leading underscore)
class InvoiceFormatter:
    def render(self, invoice):
        head = self._format(invoice.title, upper=True)
        lines = [self._format(item.name) for item in invoice.items]
        return head + "\n" + "\n".join(lines)

    def _format(self, text, upper=False):
        text = text.strip()
        return text.upper() if upper else text
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet: this looks like a Flag Argument, but it's a justified one — don't "fix" it.**

`_format(text, upper=False)` is a boolean parameter that switches behavior, which is the Flag Argument shape. But weigh it against why Flag Arguments are bad and you'll see none of the costs apply here:

- **It's a tiny private helper** (`_`-prefixed, single module), not a public API. The "split into two named methods" cure exists to make *call sites readable and intention-revealing across a codebase* — there's no external caller to confuse, and only two trivially-readable internal call sites.
- **The flag is passed by keyword** (`upper=True`), so the call site already *states intent* — the exact readability win that splitting would buy you. `self._format(invoice.title, upper=True)` is self-documenting; you can't transpose it with another positional arg.
- **The two behaviors share almost all their logic** (`strip()` then conditionally `upper()`). Splitting into `_format` and `_format_upper` would duplicate the `strip()` and add a private method for a one-line difference — more surface, not less.

**When the same code *would* be a real Flag Argument:** if `_format` were a **public** method, if the flag selected between genuinely *different* behaviors (not a one-line tweak), if there were many call sites, or if it were a bare *positional* bool (`self._format(title, True)` — unreadable). Then split it.

**The lesson for critical reading:** Flag Arguments are diagnosed by *cost*, not by the mere presence of a boolean parameter. A keyword-only flag on a tiny private helper with shared logic is fine; a positional bool on a public method that forks into two distinct behaviors (like [Snippet 9](#snippet-9--the-transfer-with-a-boolean)) is the anti-pattern. Don't reflexively split every boolean parameter.

</details>

---

## Summary — patterns of spotting

You don't spot OO-misuse anti-patterns by recognizing a single bad line — you spot them by **where the behavior lives, where the encapsulation leaks, and what the inheritance contract silently assumes**. The repeatable moves from these fifteen snippets:

- **Ask "where does the invariant live?"** If the rule that protects an object's state sits in a *service* or *helper* rather than on the object, it's an **Anemic Domain Model**, and the bug arrives the day a second code path forgets the rule (Snippets 1, 12). The cure is [Tell, Don't Ask](../../../clean-code/05-objects-and-data-structures/README.md): move behavior to the data.
- **Follow shared pointers/references across modules.** Public mutable fields handed out by reference are an **Object Orgy**; the corruption happens "at a distance" where no single function looks wrong (Snippets 5, 12). Copy at boundaries, return defensive copies, or make the type immutable.
- **Distrust "you must call super" contracts.** Any base class that *requires* subclasses to call `super.method()` or route through a specific method is **Call Super** / **Fragile Base Class**, and the bug is the forgotten call or the bypassed base step (Snippets 7, 11, 13). The cure is **Template Method**: make the flow `final`, expose a separate hook subclasses can't forget.
- **Treat `Map<String,Object>` / `dict[str,Any]` / `Bundle` as a red flag.** A **Magic Container** moves the schema out of the type system and into programmers' memory; a typo'd or mismatched key becomes a runtime `KeyError`/NPE on a path the compiler can't check (Snippet 8). Define a real typed struct.
- **Count boolean parameters — then check the call sites.** A behavior-flipping **Flag Argument** reliably gets transposed, and the call site won't show it (Snippet 9). Split into intention-revealing methods. But weigh by *cost*: a keyword flag on a tiny private helper is fine (Snippet 15).
- **Watch constructor overload chains and empty utility classes.** A growing N-arg overload set is a **Telescoping Constructor** → use a Builder or named args (Snippet 10). A class that's never instantiated and holds only statics is **Functional Decomposition** → use free functions or find the real object (Snippet 6). Inheriting from a grab-bag of helpers is **BaseBean** (Snippet 2); `implements` used only to import constants is a **Constant Interface** (Snippet 3); a stateless pass-through class is a **Poltergeist** (Snippet 4) — inline it.
- **Resist false positives.** A behavior-free struct at a *serialization boundary* is a justified DTO, not an anemic domain model (Snippet 14). Diagnose by **role and cost**, not by shape — the same code is an anti-pattern in one context and correct design in another.

The meta-lesson: **OO misuse isn't only aesthetic.** An anemic order shipped with `total == 0`; an object orgy corrupted a booking 15 minutes early; a forgotten `super` call blew a hole in tracing; a fragile base class lost the add-count; a mismatched magic-container key `KeyError`-ed on the pricing path; a transposed flag emailed the wrong people. When the responsibilities are allocated wrongly or the encapsulation leaks, look hard — the latent functional bug is usually hiding in exactly the path the misuse made impossible to see.

---

## Related Topics

- [`junior.md`](junior.md) — what each of the eleven OO-misuse shapes looks like and why it's bad.
- [`middle.md`](middle.md) — when these creep in and the small countermove that reverses them.
- [`senior.md`](senior.md) — detecting them in review and migrating inheritance hierarchies at scale.
- [`professional.md`](professional.md) — testability, performance, and observability implications.
- [`tasks.md`](tasks.md) — design exercises that build the same muscles from the writing side.
- [`optimize.md`](optimize.md) — flawed OO designs to redesign end-to-end.
- [`interview.md`](interview.md) — Q&A across all levels.
- [Coupling & State](../02-coupling-and-state/find-bug.md) and [Abstraction Failures](../03-abstraction-failures/find-bug.md) — the sibling find-bug files.
- [Clean Code → Objects and Data Structures](../../../clean-code/05-objects-and-data-structures/README.md) — Tell-Don't-Ask, the cure for anemic models.
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — SRP and ISP behind several of these.
- [Design Patterns → Behavioral](../../../design-patterns/03-behavioral/README.md) — Template Method, the structural cure for Call Super.
- [Design Patterns → Builder](../../../design-patterns/01-creational/03-builder/junior.md) — the cure for Telescoping Constructor.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — the smell-level view of the same problems.
