# Refactoring Away From Patterns — Find the Bug

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); Sandi Metz, "The Wrong Abstraction" (2016).

In each snippet a needless pattern doesn't just add cost — it *actively causes harm*: hidden global state, broken tests, a real performance loss, swallowed errors, or obscured logic. Find **why the abstraction hurts**, then read the diagnosis and fix. The pattern is the bug.

---

## Bug 1 — Singleton leaks state between tests

```java
public class RequestContext {
    private static final RequestContext INSTANCE = new RequestContext();
    private String userId;
    public static RequestContext getInstance(){ return INSTANCE; }
    public void setUserId(String id){ this.userId = id; }
    public String getUserId(){ return userId; }
}
// In handlers:
RequestContext.getInstance().setUserId(token.sub());
```

What's the bug?

<details><summary>Diagnosis & fix</summary>

**Hidden global *mutable* state.** The Singleton is one process-wide object whose `userId` is set per request. Under concurrency, request B overwrites request A's `userId` mid-flight — a cross-request data leak that can return one user's data to another (a real security incident, not just a smell). In tests, `userId` set by one test persists into the next because the static instance never resets, causing order-dependent flakiness.

**Fix — Inline Singleton; pass context explicitly per request.**

```java
public class RequestContext {
    private final String userId;
    public RequestContext(String userId){ this.userId = userId; }
    public String getUserId(){ return userId; }
}
// per-request, immutable, no sharing:
var ctx = new RequestContext(token.sub());
handler.handle(request, ctx);
```

The danger was the *combination* of Singleton (one shared instance) and mutability. Per-request, immutable context removes both the concurrency leak and the test bleed.
</details>

---

## Bug 2 — Observer swallows the exception

```java
class PaymentProcessor {
    private final List<PaymentListener> listeners = new ArrayList<>();
    void process(Payment p){
        charge(p);
        for (var l : listeners){
            try { l.onCharged(p); } catch (Exception e){ /* don't let a listener break us */ }
        }
    }
}
// The one and only listener does the critical work:
class LedgerListener implements PaymentListener {
    public void onCharged(Payment p){ ledger.record(p); }   // MUST happen
}
processor.addListener(new LedgerListener());
```

What's the bug?

<details><summary>Diagnosis & fix</summary>

**The Observer turns a required step into a silently-droppable one.** The notification loop swallows listener exceptions — a sensible default when listeners are *optional* side effects. But here the single listener performs *essential* work (recording to the ledger). If `ledger.record` throws, the charge succeeds, the ledger entry is lost, and *nobody is told* — money moved with no record. The pattern reframed a critical operation as an ignorable notification.

**Fix — inline the needless Observer; the ledger write is part of `process`, in the transaction, with errors propagating.**

```java
class PaymentProcessor {
    private final Ledger ledger;
    void process(Payment p){
        charge(p);
        ledger.record(p);   // essential, in-line, exceptions propagate (and roll back)
    }
}
```

One synchronous always-present listener doing essential work should never have been an observer. Inlining makes the step mandatory and its failure loud.
</details>

---

## Bug 3 — Decorator chain hides a double-execution

```java
interface Mailer { void send(Email e); }
class SmtpMailer implements Mailer { public void send(Email e){ smtp.transmit(e); } }
class RetryMailer implements Mailer {
    private final Mailer inner;
    RetryMailer(Mailer inner){ this.inner = inner; }
    public void send(Email e){
        for (int i=0;i<3;i++){ try { inner.send(e); return; } catch(Exception ex){} }
    }
}
class AuditMailer implements Mailer {
    private final Mailer inner;
    AuditMailer(Mailer inner){ this.inner = inner; }
    public void send(Email e){ audit.log(e); inner.send(e); }
}
// Wiring, copy-pasted in two modules with the layers in different orders:
Mailer a = new RetryMailer(new AuditMailer(new SmtpMailer()));   // module A
Mailer b = new AuditMailer(new RetryMailer(new SmtpMailer()));   // module B
```

What's the bug?

<details><summary>Diagnosis & fix</summary>

**Decorator *order* silently changes behavior, and nothing enforces a single correct order.** In module A, `Retry` wraps `Audit` wraps `Smtp`: each retry re-runs `Audit`, so a flaky send produces **up to 3 audit log entries** for one email. In module B, `Audit` wraps `Retry`: audit logs **once**, then retries happen inside. Both compile, both "work," and they disagree on audit semantics. The combinatorial freedom of Decorator became a correctness hazard because the order is meaningful but unconstrained, and there are exactly two real configurations chosen by copy-paste.

**Fix.** If both decorators are *always* applied (the common reality), the freedom is unused and harmful — collapse the chain into one class with the correct, single order baked in:

```java
class SmtpMailer implements Mailer {
    public void send(Email e){
        for (int i=0;i<3;i++){
            try { smtp.transmit(e); audit.log(e); return; }   // audit once, after success
            catch(Exception ex){ if (i==2) throw ex; }
        }
    }
}
```

If composition is genuinely needed, keep Decorator but encapsulate the *one* correct ordering in a single factory so call sites can't reorder it. The bug was unconstrained ordering freedom over behaviors that interact.
</details>

---

## Bug 4 — Factory hands out a shared mutable instance

```java
public class FormatterFactory {
    private static final SimpleDateFormat FMT = new SimpleDateFormat("yyyy-MM-dd");
    public static SimpleDateFormat create(){ return FMT; }   // "factory" returns a singleton
}
// Used from many threads:
String s = FormatterFactory.create().format(new Date());
```

What's the bug?

<details><summary>Diagnosis & fix</summary>

**The "factory" is a disguised Singleton handing one *non-thread-safe mutable* object to every caller.** `SimpleDateFormat` is not thread-safe; concurrent `format()` calls on the shared instance corrupt its internal calendar, producing wrong dates or exceptions intermittently. The factory's name *implies* it creates a fresh object per call (which would be safe), but it returns a shared static — the abstraction lies about its lifecycle, hiding the hazard.

**Fix — drop the fake factory; use a thread-safe type directly (and inline the call).**

```java
private static final DateTimeFormatter FMT = DateTimeFormatter.ISO_LOCAL_DATE; // immutable, thread-safe
String s = LocalDate.now().format(FMT);
```

The pattern actively misled: "factory" promised fresh instances while delivering a shared mutable one. Removing the indirection forces an honest, thread-safe choice.
</details>

---

## Bug 5 — One-impl interface mocked into a meaningless test

```java
interface PriceCalculator { Money total(Cart c); }
class StandardPriceCalculator implements PriceCalculator {
    public Money total(Cart c){ /* the real, only logic */ }
}
// The "unit test":
@Test void computesTotal(){
    PriceCalculator calc = mock(PriceCalculator.class);
    when(calc.total(any())).thenReturn(Money.of(100));
    assertEquals(Money.of(100), calc.total(cart));   // tests the mock, not the code
}
```

What's the bug?

<details><summary>Diagnosis & fix</summary>

**The speculative interface enabled a test that verifies nothing.** Because `PriceCalculator` is an interface, someone mocked it — and the test now asserts that a mock returns what it was told to return. The *real* `StandardPriceCalculator.total` logic is never exercised. This is a direct harm of the one-implementor interface: it invites mocking the very thing under test, producing green tests with zero coverage. (See [mocking strategies / over-mocking](../../../design-principles/).)

**Fix — collapse the speculative interface and test the real class.**

```java
class PriceCalculator { public Money total(Cart c){ /* the only logic */ } }

@Test void computesTotal(){
    var total = new PriceCalculator().total(cartWith(item(60), item(40)));
    assertEquals(Money.of(100), total);   // exercises the actual logic
}
```

With no interface, there's nothing to mock and the test must run real code. The smell (one-impl interface) *caused* the bug (a tautological test).
</details>

---

## Bug 6 — Strategy resolved by reflection obscures a missing case

```java
interface ShippingStrategy { Money cost(Order o); }
class StrategyResolver {
    Money cost(Order o){
        var clazz = "ship." + o.method() + "Strategy";   // "ship.ExpressStrategy"
        var s = (ShippingStrategy) Class.forName(clazz).getDeclaredConstructor().newInstance();
        return s.cost(o);
    }
}
```

There is, in fact, only one shipping method in production today. What's the bug?

<details><summary>Diagnosis & fix</summary>

**An inner-platform Strategy: runtime reflection replaces a compile-time choice, so a missing case fails at runtime instead of being caught by the compiler.** For one real method, this builds a tiny class-loading framework — string-built class names, reflection, no compile-time check that the strategy exists. A typo in `o.method()`, an obfuscated/renamed class, or a new method without a matching class throws `ClassNotFoundException` *in production*, on the request path, for a choice the compiler could have verified. It also defeats IDE "find usages," static analysis, and dead-code detection.

**Fix — with one method, inline it; even with a few, use an explicit `switch` the compiler checks.**

```java
// one method today:
class Shipping { Money cost(Order o){ return standardCost(o); } }

// or, when methods multiply, explicit and compiler-checked:
Money cost(Order o){
    return switch (o.method()){
        case STANDARD -> standardCost(o);
        case EXPRESS  -> expressCost(o);
    };   // non-exhaustive enum switch => compile error
}
```

The reflection-driven Strategy is the [inner-platform / over-engineering anti-pattern](../../../anti-patterns/): it reinvents method dispatch, worse, and moves errors from compile time to production. Removing it restores the compiler as your safety net.
</details>

---

## Back to the topic

- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) · [interview.md](interview.md)
- [tasks.md](tasks.md) · [optimize.md](optimize.md)
