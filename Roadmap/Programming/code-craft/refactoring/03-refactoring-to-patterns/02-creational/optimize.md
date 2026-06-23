# Refactoring Toward Creational Patterns — Optimize / Propose the Refactoring

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/creational-patterns](https://refactoring.guru/design-patterns/creational-patterns)

Each "before" snippet has a creation smell. Decide *which* creational refactoring applies — or argue that none should, because applying a pattern here would be over-engineering. The judgment of when **not** to refactor is as important as the refactoring itself.

---

## Snippet 1

```java
class UserAccount {
    UserAccount(String email) { this(email, "USER", true); }
    UserAccount(String email, String role) { this(email, role, true); }
    UserAccount(String email, String role, boolean active) { /* assign */ }
}
new UserAccount("a@x.com", "ADMIN", false);   // which flag is 'active'?
```

<details><summary>Proposed refactoring</summary>

Only **three** fields, of which two are optional with clear defaults. This is *borderline* — not yet Builder territory. The cheapest win is **Replace Constructors with Creation Methods** for the common named variants, plus keeping a full constructor:

```java
class UserAccount {
    private UserAccount(String email, String role, boolean active) { /* assign */ }
    static UserAccount standard(String email) { return new UserAccount(email, "USER", true); }
    static UserAccount admin(String email)    { return new UserAccount(email, "ADMIN", true); }
    static UserAccount inactive(String email, String role) { return new UserAccount(email, role, false); }
}
```

**Argue against a Builder here:** with three fields and obvious defaults, a Builder is ceremony. Reach for Builder only once optional fields multiply (5+) or validation gets real. Naming the variants solves the readability problem at a fraction of the cost.
</details>

---

## Snippet 2

```java
class NotificationRouter {
    void route(Event e) {
        Channel c;
        if (e.type() == EMAIL) c = new EmailChannel(smtpHost);
        else if (e.type() == SMS) c = new SmsChannel(twilioSid);
        else if (e.type() == PUSH) c = new PushChannel(fcmKey);
        else throw new IllegalStateException();
        c.send(e);
    }
}
// The SAME if-ladder appears in AuditRouter and DigestRouter.
```

<details><summary>Proposed refactoring</summary>

The selection `if`-ladder is **duplicated across three routers** and couples each to concrete channels — textbook **Encapsulate Classes with Factory**. Extract a `ChannelFactory`, move the branching in once, make the channels package-private:

```java
class ChannelFactory {
    private final String smtpHost, twilioSid, fcmKey;
    ChannelFactory(String smtpHost, String twilioSid, String fcmKey){ /* assign */ }
    Channel create(EventType type) {
        return switch (type) {
            case EMAIL -> new EmailChannel(smtpHost);
            case SMS   -> new SmsChannel(twilioSid);
            case PUSH  -> new PushChannel(fcmKey);
        };
    }
}
class NotificationRouter {
    private final ChannelFactory channels;
    NotificationRouter(ChannelFactory channels){ this.channels = channels; }
    void route(Event e){ channels.create(e.type()).send(e); }
}
```
All three routers now share one creation authority; adding a channel is a one-place change.
</details>

---

## Snippet 3

```java
class PdfReport  extends Report { void render(){ /* 30 shared lines */ Layout l = new A4Layout(); /* 20 shared lines */ } }
class WideReport extends Report { void render(){ /* 30 shared lines */ Layout l = new LandscapeLayout(); /* 20 shared lines */ } }
```

<details><summary>Proposed refactoring</summary>

Two subclasses, **identical bodies except one `new`** — exactly **Introduce Polymorphic Creation with Factory Method**. Pull the duplicated `render()` up and override only the creation:

```java
abstract class Report {
    final void render(){ /* 30 lines */ Layout l = createLayout(); /* 20 lines */ }
    protected abstract Layout createLayout();
}
class PdfReport  extends Report { protected Layout createLayout(){ return new A4Layout(); } }
class WideReport extends Report { protected Layout createLayout(){ return new LandscapeLayout(); } }
```
50 duplicated lines → one shared method + a one-liner each. **Counter-consideration:** if the variation is *only* the layout and there's no other inheritance reason, prefer **composition** — pass the `Layout` (or a `Supplier<Layout>`) into a single `Report` class, no subclasses at all. Choose Factory Method only if the hierarchy already exists for other reasons.
</details>

---

## Snippet 4

```java
class Point {
    final int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
}
new Point(3, 4);
```

<details><summary>Proposed refactoring</summary>

**None.** One unambiguous constructor, two required fields, no optionality, no duplication, no alternate implementations. Wrapping this in `Point.of(3, 4)` or a `PointFactory` adds indirection and buys nothing — speculative generality. The honest answer is "leave it alone." (If anything, make it a `record Point(int x, int y) {}` for the value-type boilerplate — but that's not a creational *pattern* refactoring.) Knowing when *not* to apply a pattern is the senior signal.
</details>

---

## Snippet 5

```java
class ConfigService {
    private static ConfigService instance;
    private Properties props;
    private ConfigService(){ props = loadFromDisk(); }
    static ConfigService getInstance(){ if(instance==null) instance=new ConfigService(); return instance; }
    String get(String k){ return props.getProperty(k); }
}
// Used via ConfigService.getInstance().get(...) in 40 classes; tests can't override config.
```

<details><summary>Proposed refactoring</summary>

A Singleton holding config, accessed globally — **hidden dependencies** and **untestable** (no way to inject test config). The right move is **Inline Singleton**: keep one instance, owned by the composition root, injected into the 40 consumers.

```java
class ConfigService {
    private final Properties props;
    ConfigService(Properties props){ this.props = props; }   // injectable
    String get(String k){ return props.getProperty(k); }
}
// Root: ConfigService cfg = new ConfigService(loadFromDisk()); inject everywhere.
```
Tests now pass `new ConfigService(testProps)`. **If** you're in a Spring/Guice app, the even simpler answer is "make it a single bean" — the container gives you one-instance-injected for free. **Argue against** leaving it a Singleton just to dodge the 40-call-site churn: that churn is exactly what's buying you testability and explicit dependencies; do it incrementally, one consumer per commit.
</details>

---

## Snippet 6

```java
List<Order> orders = new ArrayList<>();
for (Row r : rows) {
    Order o = new Order();
    o.setId(r.col(0)); o.setCustomer(r.col(1)); o.setTotal(parse(r.col(2)));
    o.setStatus("NEW"); o.setCreatedAt(now());
    orders.add(o);                      // mutable, half-built between setters
}
```

<details><summary>Proposed refactoring</summary>

`Order` is built by a sequence of setters, leaving it **mutable and temporarily invalid** between calls — and the assembly logic is inline at the call site. Two reasonable directions:

- If `Order` should be **immutable** with required + optional fields → introduce a **Builder** with validation in `build()`, replacing the setter dance: `Order.builder().id(...).customer(...).total(...).build()`. No half-built object ever escapes.
- If the *same multi-step assembly* recurs in several places → also consider **Move Creation Knowledge to Factory** (`OrderFactory.fromRow(r)`) so the row-to-Order mapping lives in one authority instead of being copy-pasted.

```java
class OrderFactory {
    Order fromRow(Row r) {
        return Order.builder()
            .id(r.col(0)).customer(r.col(1)).total(parse(r.col(2)))
            .status("NEW").createdAt(now())
            .build();        // validates; returns immutable Order
    }
}
```
**When not to:** if this loop is the *only* place orders are built and `Order` is legitimately a mutable entity, leaving the setters may be fine — don't add a Builder purely for aesthetics.
</details>

---

## Snippet 7

```java
class TemplateEngine {
    Document compile(String name, Map<String,Object> vars) {
        Ast ast = parse(loadTemplate(name));   // ~250ms parse, identical for a given name
        return ast.evaluate(vars);
    }
}
// compile("invoice", ...) is called thousands of times with different vars, same template.
```

<details><summary>Proposed refactoring</summary>

The expensive part — `parse(loadTemplate(name))` — is **identical for a given `name`** and re-run on every call; only `vars` differ. This is a creation/initialization-cost smell. Two complementary moves:

- **Prototype / cache the parsed AST**: build the expensive `Ast` once per template name and reuse it, evaluating with fresh `vars` each call.

```java
class TemplateEngine {
    private final Map<String,Ast> compiled = new ConcurrentHashMap<>();
    Document compile(String name, Map<String,Object> vars) {
        Ast ast = compiled.computeIfAbsent(name, n -> parse(loadTemplate(n)));  // once per name
        return ast.evaluate(vars);     // cheap, per-call
    }
}
```

The `Ast` acts as a reusable prototype/flyweight for that template. **Argue for measuring first** (per [professional.md](./professional.md)): confirm the 250ms parse actually dominates before caching — and ensure the cached `Ast` is **immutable** so concurrent `evaluate(vars)` calls don't corrupt shared state (the Bug-7 trap from [find-bug.md](./find-bug.md)).
</details>

---

## Next

- [find-bug.md](./find-bug.md) — diagnose broken creation code.
- [tasks.md](./tasks.md) — guided refactoring exercises.
- Theory: [junior.md](./junior.md) · [middle.md](./middle.md) · [senior.md](./senior.md) · [professional.md](./professional.md)
