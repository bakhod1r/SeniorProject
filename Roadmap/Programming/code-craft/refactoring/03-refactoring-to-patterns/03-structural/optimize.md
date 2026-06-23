# Refactoring Toward Structural Patterns — Optimize

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/structural-patterns](https://refactoring.guru/design-patterns/structural-patterns)

Seven "before" snippets carrying a structural smell. For each, decide the **right move** — which structural refactoring (if any) earns its cost — and argue it. Several are traps: the correct answer is "leave it, the pattern would cost more than the smell." A senior engineer is judged as much on the refactorings they *decline* as on the ones they perform.

For each: propose, then open the solution.

---

## Snippet 1 — Combinatorial subclass explosion

```java
class Coffee { double cost() { return 2.0; } }
class CoffeeWithMilk extends Coffee { @Override double cost() { return 2.5; } }
class CoffeeWithSugar extends Coffee { @Override double cost() { return 2.2; } }
class CoffeeWithMilkAndSugar extends Coffee { @Override double cost() { return 2.7; } }
class CoffeeWithMilkAndSugarAndCaramel extends Coffee { /* ... and it keeps growing */ }
```

<details><summary>Solution</summary>

**Refactor: Move Embellishment to Decorator.** Each add-on (milk, sugar, caramel) is an embellishment; subclassing makes combinations multiply (`2^N`). Decorators turn it additive: `N` add-on classes, stacked freely.

```java
interface Beverage { double cost(); }
class Coffee implements Beverage { public double cost() { return 2.0; } }
abstract class AddOn implements Beverage {
    protected final Beverage base; protected AddOn(Beverage b) { base = b; }
}
class Milk extends AddOn { Milk(Beverage b){super(b);} public double cost(){return base.cost()+0.5;} }
class Sugar extends AddOn { Sugar(Beverage b){super(b);} public double cost(){return base.cost()+0.2;} }
// new Caramel(new Milk(new Coffee())).cost();
```
Clear win — the explosion is real and the combinations are open-ended.
</details>

---

## Snippet 2 — A "tree" that is always two levels deep

```java
class Catalog {
    Map<String, List<String>> categoryToProducts = new HashMap<>();
    int productCount() {
        return categoryToProducts.values().stream().mapToInt(List::size).sum();
    }
}
```

<details><summary>Solution</summary>

**Decline the Composite.** The structure is fixed at exactly two levels (category → product) and never nests categories within categories. A Composite advertises arbitrary-depth recursion you don't have, adding interfaces and node classes for zero flexibility gained. The `Map<String, List<String>>` is clearer and faster here.

**Refactor toward Composite only if** the requirement changes to nested sub-categories. Until then, this is the correct shape. (This is the inverse lesson of the junior file: not every tree-ish thing wants Composite.)
</details>

---

## Snippet 3 — Version conditionals smeared across methods

```java
class SmsClient {
    String provider;   // "twilio" or "nexmo"
    String send(String to, String body) {
        if (provider.equals("twilio")) return twilio.messages().create(to, body).sid();
        else return nexmo.sms().submit(to, body).getMessageId();
    }
    boolean delivered(String id) {
        if (provider.equals("twilio")) return twilio.messages().get(id).status().equals("delivered");
        else return nexmo.sms().status(id).isDelivered();
    }
}
```

<details><summary>Solution</summary>

**Refactor: Extract Adapter** — one adapter per provider behind an `SmsGateway` interface; move each `if`-branch into the matching adapter; `SmsClient` holds one `SmsGateway`. The `provider` flag disappears and a third provider is a new adapter, not edits across every method.

```java
interface SmsGateway { String send(String to, String body); boolean delivered(String id); }
class TwilioAdapter implements SmsGateway { /* twilio quirks here */ }
class NexmoAdapter  implements SmsGateway { /* nexmo quirks here  */ }
```
Strong win: the flag appears in *every* method and providers will keep being added.
</details>

---

## Snippet 4 — One decorator, forever, in a hot loop

```java
interface Pricer { long price(Item it); }
class BasePricer implements Pricer { public long price(Item it) { return it.base(); } }
class TaxPricer implements Pricer {        // the ONLY decorator that exists, ever
    private final Pricer base;
    TaxPricer(Pricer b) { base = b; }
    public long price(Item it) { return Math.round(base.price(it) * 1.2); }
}
// called 50M times per pricing run:
Pricer p = new TaxPricer(new BasePricer());
for (Item it : fiftyMillionItems) total += p.price(it);
```

<details><summary>Solution</summary>

**Refactor AWAY: inline the decorator.** There is exactly one decorator, no other will ever wrap, and the call runs 50M times — you're paying two virtual hops per element (100M calls) for flexibility you don't use. Fold tax into the pricer and delete the decorator machinery.

```java
class TaxedPricer implements Pricer {
    public long price(Item it) { return Math.round(it.base() * 1.2); }
}
```
**Conditions met** (from [professional.md](professional.md)): flexibility unused + hot path + reversible. If a second pricing modifier ever appears, re-extract decorators. This is the mirror image of Snippet 1 — same pattern, opposite verdict, because the *number of variations* differs. See [Refactoring Away From Patterns](../05-refactoring-away-from-patterns/junior.md).
</details>

---

## Snippet 5 — Eager construction of a rarely-used heavyweight

```java
class Dashboard {
    private final HeatmapRenderer heatmap;   // decodes a 40MB dataset in its constructor
    Dashboard() {
        this.heatmap = new HeatmapRenderer();   // built for EVERY dashboard load
    }
    // but the heatmap tab is opened by ~5% of users
}
```

<details><summary>Solution</summary>

**Refactor: Virtual Proxy (lazy load).** 95% of loads pay a 40MB decode they never use. A proxy defers construction to first `render()`.

```java
interface Renderer { void render(); }
class LazyHeatmap implements Renderer {
    private volatile HeatmapRenderer real;
    public void render() {
        HeatmapRenderer r = real;
        if (r == null) synchronized (this) { if ((r = real) == null) real = r = new HeatmapRenderer(); }
        r.render();
    }
}
```
**Caveat to state:** the first user to open the tab eats the full decode latency (the spike). If that path is latency-sensitive, warm it off the hot path instead. And note the lazy init must be thread-safe (shown). Good trade here because the object is *expensive* and *usually unused*.
</details>

---

## Snippet 6 — Millions of identical config objects

```java
class Pixel {
    final int r, g, b;     // a 4K image = ~8.3M Pixel objects, but only ~30k distinct colors
    Pixel(int r, int g, int b) { this.r = r; this.g = g; this.b = b; }
}
// new Pixel(...) per pixel -> ~8M allocations, heavy heap
```

<details><summary>Solution</summary>

**Refactor: Flyweight** — pool distinct colors; the canvas stores references to shared `Pixel`s plus per-position coordinates (extrinsic) in the layout it needs anyway.

```java
final class ColorPool {
    private final Map<Integer, Pixel> pool = new ConcurrentHashMap<>();
    Pixel get(int r, int g, int b) {
        return pool.computeIfAbsent((r<<16)|(g<<8)|b, k -> new Pixel(r, g, b));
    }
}
```
**Justify with the number:** 8.3M × ~24 B ≈ 200 MB → ~30k × 24 B ≈ 720 KB. Verify with a heap dump and confirm the distinct-color count (`K ≪ N`) is real. **Decline if** the image is photographic with near-unique colors (`K ≈ N`) — then you only pay the pool-lookup tax for no sharing. The intrinsic state here is already `final` (immutable), so the pattern is safe.
</details>

---

## Snippet 7 — Two-axis hierarchy multiplying

```java
class WindowsButton {}     class MacButton {}
class WindowsCheckbox {}   class MacCheckbox {}
class WindowsSlider {}     class MacSlider {}
// each new OS adds N widget classes; each new widget adds M OS classes
```

<details><summary>Solution</summary>

**Refactor: Bridge** — separate the *widget* axis from the *platform-rendering* axis. A `Widget` holds a `Platform` implementor by composition instead of widget×platform inheritance.

```java
interface Platform { void drawButton(); void drawCheckbox(); }   // implementor axis
class WindowsPlatform implements Platform { /* ... */ }
class MacPlatform implements Platform { /* ... */ }
abstract class Widget {                                           // abstraction axis
    protected final Platform platform;
    protected Widget(Platform p) { platform = p; }
    abstract void render();
}
class Button extends Widget { Button(Platform p){super(p);} void render(){ platform.drawButton(); } }
```
`M × N` collapses to `M + N`; each axis grows independently. **Decline if** one axis will realistically only ever have one member (only Windows, forever) — then Bridge adds an interface for nothing; keep the flat classes. **Don't confuse with Strategy:** here *both* sides are hierarchies that grow, which is what makes it Bridge, not a single swappable algorithm.
</details>

---

## The meta-lesson

Notice that Snippets 1 and 4 are the *same pattern* (Decorator) with **opposite verdicts**, and Snippets 2 and 6 both involve "many things" with opposite verdicts. The deciding variable is never "is the pattern nice?" — it's:

- **How much variation actually exists?** (One forever → inline. Many, open-ended → extract.)
- **Is the cost on a hot path, measured?**
- **Is the flexibility used, or speculative?**

Refactor *to* a structural pattern when a smell plus real variation demands it; refactor *away* when you're paying indirection for flexibility that never materialized. Both directions are first-class refactorings.

---

## Next

- [find-bug.md](find-bug.md) — Diagnose broken structural patterns.
- [tasks.md](tasks.md) — Apply the refactorings step by step.
- Back to [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) · [interview.md](interview.md)
