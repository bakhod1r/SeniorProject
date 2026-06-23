# Refactoring Away From Patterns — Tasks

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); Sandi Metz, "The Wrong Abstraction" (2016).

Each task gives over-engineered code. Decide whether to **simplify** it (and do so with numbered steps) or **defend keeping it** (and justify). The right answer is sometimes "leave it" — judgment, not a reflex to delete. Try each before reading the solution.

---

## Task 1 — The one-product factory

```java
public class ConnectionFactory {
    public Connection create() { return new PostgresConnection(url, user, pass); }
}
Connection c = new ConnectionFactory().create();
```

There is one product, no parameters affecting the result, no subclasses of `ConnectionFactory`. Simplify or defend?

<details><summary>Solution</summary>

**Simplify.** No decision is made; the factory is `new` with extra ceremony.

1. Grep for other `return`s in `ConnectionFactory` and for subclasses — confirm none.
2. Replace each `new ConnectionFactory().create()` with `new PostgresConnection(url, user, pass)`.
3. Run tests.
4. Delete `ConnectionFactory`.

```java
Connection c = new PostgresConnection(url, user, pass);
```

**Keep-it caveat:** if construction were multi-step (pool config, retry wrapper, credential fetch) you'd keep the factory to name and DRY the construction — even with one product. The smell here is *one product **and** trivial construction*.
</details>

---

## Task 2 — Strategy with one implementor

```java
interface SortOrder { int compare(Item a, Item b); }
class ByName implements SortOrder { public int compare(Item a, Item b){ return a.name.compareTo(b.name); } }

class Catalog {
    private final SortOrder order;
    Catalog(SortOrder order){ this.order = order; }
    List<Item> sorted(){ return items.stream().sorted(order::compare).toList(); }
}
new Catalog(new ByName());   // the only construction in the codebase
```

Simplify or defend?

<details><summary>Solution</summary>

**Simplify** — single-impl Strategy, every caller passes `ByName`.

1. Confirm `ByName` is the only implementor and every `new Catalog(...)` passes it.
2. Inline the comparison into `Catalog`; drop the field and constructor param.
3. Update `new Catalog(new ByName())` → `new Catalog()`. Run tests.
4. Delete `ByName` and `SortOrder`.

```java
class Catalog {
    List<Item> sorted(){ return items.stream()
        .sorted(Comparator.comparing(i -> i.name)).toList(); }
}
```

**Keep-it caveat:** the *moment* a second order appears (by price, by date) chosen at runtime, re-introduce Strategy (or just pass a `Comparator<Item>`). Rule of Three — abstract at the real second/third case, not the imagined one.
</details>

---

## Task 3 — The always-on decorator

```java
interface Logger { void log(String msg); }
class ConsoleLogger implements Logger { public void log(String m){ System.out.println(m); } }
class TimestampLogger implements Logger {
    private final Logger inner;
    TimestampLogger(Logger inner){ this.inner = inner; }
    public void log(String m){ inner.log(Instant.now() + " " + m); }
}
Logger log = new TimestampLogger(new ConsoleLogger());  // every construction, identical
```

Simplify or defend?

<details><summary>Solution</summary>

**Simplify** — one decorator, always applied, never composed with others.

1. Confirm every `Logger` is built as `new TimestampLogger(new ConsoleLogger())` (timestamping is never optional) and there are no other decorators.
2. Fold the timestamp into `ConsoleLogger.log`.
3. Replace constructions with `new ConsoleLogger()`. Run tests.
4. Delete `TimestampLogger`. If `Logger` now has one impl and no test seam needs it, collapse the interface too.

```java
class ConsoleLogger implements Logger {
    public void log(String m){ System.out.println(Instant.now() + " " + m); }
}
```

**Keep-it caveat:** if some sinks want timestamps and others don't, or you also want a `LevelLogger`/`AsyncLogger` mixed per context, the Decorator's composability is real — keep it. (In practice, reach for a logging framework; this is illustrative.)
</details>

---

## Task 4 — Defend or delete: the payment port

```java
interface PaymentGateway { Receipt charge(Money amount, Card card); }
class StripeGateway implements PaymentGateway { /* Stripe SDK calls */ }

class CheckoutService {
    private final PaymentGateway gateway;
    CheckoutService(PaymentGateway gateway){ this.gateway = gateway; }
}
```

One implementor in production. A junior wants to delete the interface and depend on `StripeGateway`. Simplify or defend?

<details><summary>Solution</summary>

**Defend — keep it.** One *production* implementor, but the interface earns its keep three ways:

- **Test seam:** `CheckoutService` tests run against an `InMemoryGateway` fake — the real second implementor — so tests are fast and don't hit Stripe.
- **Architectural boundary (port):** the domain depends on `PaymentGateway`, not on the Stripe SDK, keeping infrastructure types out of the domain.
- **Imminent variation:** payment providers are exactly the kind of dependency that gets a second implementor (PayPal, Adyen).

Deleting it would leak Stripe types into the domain and break the fast tests. The smell is "one impl **and** no seam **and** no boundary **and** no imminent second case" — none of which holds here.
</details>

---

## Task 5 — The needless Observer

```java
interface InventoryListener { void onLowStock(Sku sku); }
class WarehouseService {
    private final List<InventoryListener> listeners = new ArrayList<>();
    void addListener(InventoryListener l){ listeners.add(l); }
    void recordSale(Sku sku, int qty){
        decrement(sku, qty);
        if (stock(sku) < threshold(sku))
            for (var l : listeners) l.onLowStock(sku);
    }
}
class ReorderListener implements InventoryListener {
    public void onLowStock(Sku sku){ purchasing.reorder(sku); }
}
warehouse.addListener(new ReorderListener());   // the only registration
```

Simplify or defend?

<details><summary>Solution</summary>

**Simplify** — one synchronous, always-registered listener; the fan-out hides that a reorder happens.

1. Confirm one listener type, always registered, synchronous, order/count irrelevant.
2. Inject `Purchasing` into `WarehouseService`.
3. Replace the loop with a direct `purchasing.reorder(sku)`.
4. Delete `addListener`, the list, `InventoryListener`, `ReorderListener`. Run tests.

```java
class WarehouseService {
    private final Purchasing purchasing;
    WarehouseService(Inventory inv, Purchasing purchasing){ /* ... */ this.purchasing = purchasing; }
    void recordSale(Sku sku, int qty){
        decrement(sku, qty);
        if (stock(sku) < threshold(sku)) purchasing.reorder(sku);  // now visible
    }
}
```

**Keep-it caveat:** if low-stock should *also* email a manager and update a dashboard (multiple listeners), or the reaction should be async/off-thread, or the warehouse domain must not know about purchasing (cross-boundary decoupling), keep Observer. The smell is the *single synchronous always-on* listener.
</details>

---

## Task 6 — The wrong abstraction (flag accretion)

```java
String renderNotice(User u, boolean isAdmin, boolean compact, boolean legacy) {
    StringBuilder sb = new StringBuilder();
    if (!compact) sb.append(legacy ? oldHeader() : header());
    sb.append(isAdmin ? adminBody(u) : userBody(u));
    if (!compact && !legacy) sb.append(footer());
    return sb.toString();
}
// Only two call sites exist:
renderNotice(u, true,  false, false);   // admin notice
renderNotice(u, false, true,  false);   // compact user notice
```

This abstraction has accreted flags. Simplify or defend?

<details><summary>Solution</summary>

**Simplify by re-inlining (Metz's recovery).** The "shared" function has diverged into per-caller behavior controlled by flags; the duplication it removed was cheaper than this.

1. Inline `renderNotice` into each of the two call sites, substituting that caller's flag values.
2. Constant-fold the conditionals away — each caller takes exactly one path.

```java
// admin notice (isAdmin=true, compact=false, legacy=false):
String adminNotice(User u) {
    return header() + adminBody(u) + footer();
}
// compact user notice (isAdmin=false, compact=true, legacy=false):
String compactUserNotice(User u) {
    return userBody(u);   // compact => no header, no footer
}
```

Two honest, readable functions replace one flag-driven tangle. Now look fresh: they share almost nothing, so *no* abstraction is warranted yet. If a third notice appears later and reveals a genuine common shape, abstract *then* — shaped by three real cases, not by salvaging the wrong one.

**Keep-it caveat:** had the flags represented a stable, genuinely-shared template with one real axis of variation (e.g., just `compact`), a single parameter would be fine. The smell is *flag accretion that encodes divergent behaviors*.
</details>

---

## Task 7 — Inline Singleton for testability

```java
public class FeatureFlags {
    private static final FeatureFlags INSTANCE = new FeatureFlags(loadFromEnv());
    private final Map<String,Boolean> flags;
    private FeatureFlags(Map<String,Boolean> f){ this.flags = f; }
    public static FeatureFlags getInstance(){ return INSTANCE; }
    public boolean isOn(String key){ return flags.getOrDefault(key, false); }
}
class Checkout {
    boolean useNewPricing(){ return FeatureFlags.getInstance().isOn("new-pricing"); }
}
```

Tests for `Checkout` can't toggle flags. Simplify or defend?

<details><summary>Solution</summary>

**Simplify — Inline Singleton** (remove global access; keep one instance via injection).

1. Add a `FeatureFlags` field + constructor param to `Checkout`.
2. Thread the instance from the composition root inward; convert callers one at a time, tests green after each.
3. When nothing calls `getInstance()`, delete it and the static field; make the constructor public.
4. Create one `FeatureFlags` at the root and inject it.

```java
public class FeatureFlags {
    private final Map<String,Boolean> flags;
    public FeatureFlags(Map<String,Boolean> f){ this.flags = f; }
    public boolean isOn(String key){ return flags.getOrDefault(key, false); }
}
class Checkout {
    private final FeatureFlags flags;
    Checkout(FeatureFlags flags){ this.flags = flags; }
    boolean useNewPricing(){ return flags.isOn("new-pricing"); }
}
// test:
new Checkout(new FeatureFlags(Map.of("new-pricing", true)))
```

**Keep-it caveat:** uniqueness is fine to preserve (one flags object per process) — just create it at the root and inject. What you remove is the *global static access* that broke testability, not the single-instance idea.
</details>

---

## Task 8 — Defend or delete: the abstract base with one subclass

```java
abstract class ReportJob {
    final void run(){ var d = fetch(); var r = transform(d); write(r); }
    abstract Data fetch();
    abstract Report transform(Data d);
    abstract void write(Report r);
}
class DailySalesJob extends ReportJob {
    Data fetch(){ /* ... */ }   Report transform(Data d){ /* ... */ }   void write(Report r){ /* ... */ }
}
```

A Template Method with one subclass. Simplify or defend?

<details><summary>Solution</summary>

**Simplify** — the Template Method's `run()` skeleton organizes variation across subclasses, but there's only one subclass, so there's no variation to organize.

1. Confirm `DailySalesJob` is the only subclass and none is imminent.
2. Pull the three method bodies and the `run()` skeleton into a single concrete class; the abstract hooks become private methods.
3. Delete `ReportJob`. Run tests.

```java
class DailySalesJob {
    void run(){ var d = fetch(); var r = transform(d); write(r); }
    private Data fetch(){ /* ... */ }
    private Report transform(Data d){ /* ... */ }
    private void write(Report r){ /* ... */ }
}
```

**Keep-it caveat:** when a *second* job appears sharing the fetch→transform→write skeleton but varying the steps, Template Method (or composition with injected steps) earns its keep — re-introduce it then. With one subclass, the hierarchy is speculative generality. (Modern preference: favor *composition* over a `Template Method` base even at two cases — but that's a separate design call.)
</details>

---

## Back to the topic

- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) · [interview.md](interview.md)
- [find-bug.md](find-bug.md) · [optimize.md](optimize.md)
