# Refactoring Away From Patterns — Junior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004), Chapter 1 & the "Refactoring Away" entries; Sandi Metz, "The Wrong Abstraction" (2016).

Most pattern teaching only moves in one direction: spot a smell, add a pattern, feel sophisticated. Kerievsky's book is unusual because it treats refactoring as a *dial*, not a *ratchet*. You can turn it up toward more structure, and you can turn it back down. The catalog literally contains entries like **"Inline Singleton"** sitting right next to "Form Template Method" — removal is a first-class move, not an admission of failure.

This level teaches the most common removals a junior engineer will actually perform: taking out a Singleton, collapsing a one-product Factory, and inlining a Strategy that only ever had one implementation. The goal is not "patterns are bad." The goal is **fit**: a pattern earns its keep when it absorbs a change that actually happens. When it doesn't, it's pure cost — extra files, extra indirection, extra things a new teammate has to hold in their head — and you take it out.

## Table of Contents

- [Why would you ever REMOVE a pattern?](#why-would-you-ever-remove-a-pattern)
- [The two smells that signal over-engineering](#the-two-smells-that-signal-over-engineering)
- [A real-world analogy](#a-real-world-analogy)
- [Removal 1 — Inline Singleton](#removal-1--inline-singleton)
- [Removal 2 — Collapse a needless Factory](#removal-2--collapse-a-needless-factory)
- [Removal 3 — Remove a single-implementation Strategy](#removal-3--remove-a-single-implementation-strategy)
- [The "is this pattern earning its keep?" checklist](#the-is-this-pattern-earning-its-keep-checklist)
- [How to remove a pattern safely](#how-to-remove-a-pattern-safely)
- [Glossary](#glossary)
- [Review questions](#review-questions)
- [Next](#next)

## Why would you ever REMOVE a pattern?

A pattern is a *trade*. You accept added structure — an interface, an extra class, a layer of indirection — in exchange for a benefit: a place to vary behavior, a way to decouple two modules, a single point of control. The trade is good when you spend the structure on a real, recurring need. The trade is bad when you pay the structure and never collect the benefit.

Juniors are taught the patterns and, naturally, want to use them. The result is **pattern fever** (Kerievsky's "pattern-happy" code): a codebase where every dependency hides behind an interface, every object is built through a factory, every class is a Singleton, and a five-line method has become four collaborating classes. None of it varies. None of it is reused. It is structure with no payoff.

Removing a pattern is just refactoring in reverse: you simplify the design to the simplest thing that supports what the code *actually does today* — the [YAGNI](../../../design-principles/) principle ("You Aren't Gonna Need It") made concrete. You are not predicting the future will never come; you are refusing to pay for it before it arrives, because the cost of carrying the wrong structure is usually higher than the cost of adding the right structure later.

## The two smells that signal over-engineering

**Speculative Generality** (from the [Dispensables smell family](../../01-code-smells/04-dispensables/junior.md)). Code built for a flexibility that never materialized: an abstract class with one concrete subclass, an interface with one implementor, a parameter no caller ever varies, a hook method nobody overrides. Fowler's tell: *"if a class, method, or parameter isn't earning its keep, get rid of it."*

**Inner-platform / over-engineering** (from the [anti-patterns](../../../anti-patterns/) catalog). The system grows so configurable that it reinvents the language or framework it's written in — a "rules engine" that is just `if` statements in XML, a plugin architecture with exactly one plugin. Gold-plating is the sibling smell: building polish and flexibility the user never asked for.

The two are connected. Speculative generality is the *micro* version (one needless interface); over-engineering is the *macro* version (a whole needless architecture). Both are removed the same way: prove the variation isn't there, then collapse the structure back down.

## A real-world analogy

Think of a kitchen. A professional kitchen has a station for every task — a dedicated fish station, a sauce station, a pastry station. That structure earns its keep because the restaurant cooks hundreds of covers a night across a wide menu; the specialization absorbs real, repeated volume.

Now imagine a *home* kitchen built the same way: a dedicated fish counter, a separate sauce counter, a pastry room — for a household that cooks pasta four nights a week. Every counter is something to clean, walk around, and pay rent on, and none of it speeds up the pasta. The right move isn't "counters are bad." It's "match the structure to the cooking you actually do." When your code has a Factory, a Strategy interface, and an Abstract Factory for a feature that has exactly one behavior and never changes, you've built the pastry room for the pasta.

## Removal 1 — Inline Singleton

> Cross-reference: [Singleton pattern](../../../design-patterns/01-creational/05-singleton/junior.md) — read this first if you don't know the pattern.

### Starting situation (the needless pattern)

A [Singleton](../../../design-patterns/01-creational/05-singleton/junior.md) gives global access to a single instance. That global access is exactly what makes it a smell: any code anywhere can reach `TaxTable.getInstance()`, so dependencies become invisible, and tests can't substitute a different instance.

```java
public class TaxTable {
    private static final TaxTable INSTANCE = new TaxTable();
    private final Map<String, BigDecimal> rates = loadRates();

    private TaxTable() {}                       // no one else can construct it
    public static TaxTable getInstance() { return INSTANCE; }

    public BigDecimal rateFor(String region) { return rates.get(region); }
}

// Used like this, from deep inside business logic:
public class Order {
    public BigDecimal tax() {
        return subtotal().multiply(TaxTable.getInstance().rateFor(region));
    }
}
```

### Motivation (why simpler is better here)

`Order.tax()` has a *hidden* dependency on `TaxTable`. You can't tell from its signature that it needs a tax table, you can't give it a test table for a unit test, and you can't run two orders against two different tax tables (think: tax law changing, or testing both the old and new rates). The "there can only be one" guarantee buys you nothing here — nothing breaks if two `TaxTable` objects exist — but it costs you testability and clarity. **Inline Singleton** removes the global access by passing the dependency in explicitly (this is the same move as [Dependency Injection](../../../design-principles/)).

### Mechanical steps

1. **Add a constructor (or factory) that takes the formerly-global object as a parameter.** Give `Order` a `TaxTable` field set in its constructor.
2. **Find every call to `getInstance()`.** For each caller, thread the instance in from the outside instead of reaching for the global. Work outward from the leaves toward the composition root (`main`, your DI container, or the request handler).
3. **Run the tests after each caller is converted.** Keep green.
4. **When no caller references `getInstance()` anymore, delete `getInstance()` and the `static` field.** Make the constructor public.
5. **Decide who creates the single instance now.** Usually the composition root creates one `TaxTable` and hands it to whoever needs it. "Single instance" becomes a *fact of how you wire the app*, not a *law enforced by the class*.

### After

```java
public class TaxTable {
    private final Map<String, BigDecimal> rates;
    public TaxTable(Map<String, BigDecimal> rates) { this.rates = rates; }
    public BigDecimal rateFor(String region) { return rates.get(region); }
}

public class Order {
    private final TaxTable taxTable;             // dependency is now visible
    public Order(TaxTable taxTable) { this.taxTable = taxTable; }

    public BigDecimal tax() {
        return subtotal().multiply(taxTable.rateFor(region));
    }
}

// Composition root wires the single instance once:
TaxTable taxTable = new TaxTable(loadRates());
Order order = new Order(taxTable);
```

A unit test can now do `new Order(new TaxTable(Map.of("CA", new BigDecimal("0.0725"))))` — no global, no statics to reset between tests, no hidden coupling.

### When the Singleton WAS justified — keep it

If the object genuinely models a unique resource where *two instances would be a bug* — a process-wide lock manager, a single connection pool sized to a hard limit, a metrics registry the whole process reports through — uniqueness is a real requirement and a Singleton (or, better, a single instance created at the composition root and injected) is appropriate. The thing to remove is the *global static access*, which is what hurts testing. Uniqueness and global access are two separate decisions; you can keep the first and drop the second.

## Removal 2 — Collapse a needless Factory

> Cross-reference: [Factory Method](../../../design-patterns/01-creational/01-factory-method/junior.md).

### Starting situation

```java
public class ReportFactory {
    public Report create() {
        return new PdfReport();
    }
}

// Caller:
Report r = new ReportFactory().create();
```

There is exactly one product (`PdfReport`), no subtypes, no configuration, no decision being made. The factory is a method that calls `new` and nothing else.

### Motivation

A [factory](../../../design-patterns/01-creational/01-factory-method/junior.md) earns its keep when *which* object to create is a decision — it varies by config, by subtype, by runtime input — or when construction is complicated enough to deserve a name and a home. Here none of that is true. The factory adds a class, a level of indirection, and a small lie: it *suggests* a choice is being made when there isn't one. Readers go looking for the variation and find nothing.

### Mechanical steps

1. **Confirm the factory has exactly one return path and no parameters that change the result.** Grep for other `return` statements and any subclasses of `ReportFactory`. If you find variation, stop — the factory is justified.
2. **At each call site, replace `new ReportFactory().create()` with the direct constructor `new PdfReport()`.** This is the *Inline Method* refactoring applied to the factory call.
3. **Run tests after each call site.**
4. **When the factory has no callers, delete the `ReportFactory` class.**

### After

```java
Report r = new PdfReport();
```

### When the Factory WAS justified — keep it

Keep the factory the moment a real choice appears: `create(format)` returning `PdfReport` *or* `HtmlReport`, a factory reading the product type from configuration, or construction that involves several steps you don't want duplicated at every call site. A factory also earns its keep when it's the *seam your tests need* — if every caller must be handed a test double, a single factory is one place to swap it. The smell is specifically the **one-product, no-decision, no-reuse** factory.

## Removal 3 — Remove a single-implementation Strategy

> Cross-reference: [Strategy pattern](../../../design-patterns/03-behavioral/08-strategy/junior.md).

### Starting situation

```java
public interface DiscountStrategy {
    BigDecimal apply(BigDecimal subtotal);
}

public class StandardDiscount implements DiscountStrategy {
    public BigDecimal apply(BigDecimal subtotal) {
        return subtotal.multiply(new BigDecimal("0.90"));   // flat 10% off
    }
}

public class Cart {
    private final DiscountStrategy discount;
    public Cart(DiscountStrategy discount) { this.discount = discount; }
    public BigDecimal total() { return discount.apply(subtotal()); }
}

// Everywhere in the codebase:
new Cart(new StandardDiscount());
```

The [Strategy pattern](../../../design-patterns/03-behavioral/08-strategy/junior.md) exists to let behavior vary at runtime by swapping interchangeable algorithms. Here there is exactly one algorithm. `StandardDiscount` is the only implementor, and every call site passes it. The interface is pure speculation.

### Motivation

To read `Cart.total()`, you have to jump through the `DiscountStrategy` interface, find the one implementor, and confirm there's only one — every single time. The indirection buys flexibility nobody is using. Inlining the one strategy back into `Cart` puts the actual behavior where you can see it.

### Mechanical steps

1. **Confirm there is exactly one implementor of `DiscountStrategy` and that no caller varies it** (every `new Cart(...)` passes `StandardDiscount`). If a second implementor exists or is genuinely coming, stop.
2. **Move the body of `StandardDiscount.apply` into `Cart`** as a private method (*Inline Method* / *Move Method*).
3. **Delete the `discount` field and the constructor parameter.** Update every `new Cart(new StandardDiscount())` to `new Cart()`.
4. **Run tests after each step.**
5. **Delete `StandardDiscount` and the `DiscountStrategy` interface.**

### After

```java
public class Cart {
    public BigDecimal total() { return applyDiscount(subtotal()); }

    private BigDecimal applyDiscount(BigDecimal subtotal) {
        return subtotal.multiply(new BigDecimal("0.90"));    // flat 10% off
    }
}

new Cart();
```

### When the Strategy WAS justified — keep it

The moment a *second* discount appears — seasonal, member-tier, coupon-based — and the choice is made at runtime, Strategy earns its keep and you should refactor *toward* it (see [Refactoring to Behavioral patterns](../04-behavioral/junior.md)). The decision rule is the **Rule of Three**: one implementation is a method; two might be a coincidence; three interchangeable variants is a pattern. Don't introduce the interface on the first algorithm "in case" a second appears, and don't keep it after the second one is removed.

## The "is this pattern earning its keep?" checklist

Run these questions against any pattern you suspect is over-engineering. Several "yes" answers means it's a candidate for removal.

- **One implementation.** Is there exactly one implementor behind this interface / one subclass under this abstract class / one product from this factory, with no second on the near horizon? (The "one implementation" rule of thumb.)
- **No variation at the seam.** Does every caller pass the *same* concrete thing into the seam the pattern created?
- **No reuse.** Is the abstraction used in exactly one place?
- **Indirection without payoff.** To understand the behavior, must you jump through a layer that never actually changes what happens?
- **Tests fight it.** Do you have to set up scaffolding (reset statics, mock a one-method interface) that exists *only* because the pattern is there?
- **Speculative comments.** Does the code (or commit message) justify the structure with "so we can later…" — and "later" hasn't come?
- **It models a guess, not a requirement.** Was the flexibility added because someone *imagined* a future need, not because a real, repeated change demanded it?

If instead the pattern absorbs a change you keep making, isolates a volatile dependency, or is the seam your tests rely on — it's earning its keep. Leave it.

## How to remove a pattern safely

Removal changes structure, and structure has callers. Do it like any behavior-preserving refactoring:

1. **Get a green test around the behavior first.** If the code isn't tested, write **characterization tests** — tests that pin down what the code *currently does* (not what it should do) so you'll notice if your removal changes anything. (See [middle.md](middle.md) for how.)
2. **Take tiny steps and keep the suite green after each.** Inline one caller, run tests, repeat. Never delete the abstraction and fix all callers in one big move.
3. **Watch for callers that depend on the seam.** Sometimes an interface has one implementor *in production* but a second *in tests* (a mock). That seam is earning its keep — the test needs it. Removing it forces a different testing approach; weigh that before you collapse it.
4. **Commit each removal separately** with a message that says what you removed and why ("inline single-impl `DiscountStrategy`; no runtime variation since launch"). Small reversible commits make a teammate's review — and your own rollback — easy.

## Glossary

- **Speculative generality:** structure built for flexibility that never materialized; a [Dispensables](../../01-code-smells/04-dispensables/junior.md) smell.
- **Pattern fever / pattern-happy code:** applying design patterns everywhere by reflex, regardless of whether they fit.
- **YAGNI:** "You Aren't Gonna Need It" — don't build for needs you only imagine. A [design principle](../../../design-principles/).
- **Inline (a refactoring):** replace a call with the thing it calls, then delete the now-unused definition. The core mechanic of pattern removal.
- **Characterization test:** a test that records the *current* behavior of code so you can refactor without changing it.
- **Seam:** a place where you can alter behavior without editing the code around it (e.g., an injected interface). Patterns create seams; some seams earn their keep, some don't.
- **Rule of Three:** introduce an abstraction when you have three real cases, not one imagined one.
- **The wrong abstraction tax:** the ongoing cost of a premature or ill-fitting abstraction — see [senior.md](senior.md).

## Review questions

1. A class has a private constructor, a static `INSTANCE`, and a `getInstance()`. Which part is the actual smell, and which might be legitimately worth keeping?
2. You find `new WidgetFactory().create()` and `WidgetFactory.create()` only ever returns `new Widget()`. What's the removal, and what one check do you run *before* doing it?
3. An interface has exactly one implementor. Name two situations where that is *still* the right design (i.e., don't remove it).
4. Why does the Rule of Three argue *against* introducing a Strategy interface for your first algorithm?
5. What's the difference between *uniqueness* and *global access* in a Singleton, and why does that distinction matter for testing?
6. Before you inline a single-implementation Strategy, what kind of test should you put in place, and what is it protecting you from?

## Next

- [middle.md](middle.md) — collapsing Decorator chains, removing one-impl interfaces, inlining needless Observer, the Rule of Three, characterization tests, the cost model of indirection.
- [senior.md](senior.md) — essential vs accidental complexity, the wrong-abstraction tax, de-abstraction as an architectural move, getting a team to agree to delete.
- [professional.md](professional.md) — the economics: carrying cost, tech-debt framing, measured performance wins from removing indirection.
- [interview.md](interview.md) — interview questions on over-engineering, YAGNI vs future-proofing, safely removing a Singleton.
- [tasks.md](tasks.md) · [find-bug.md](find-bug.md) · [optimize.md](optimize.md) — practice.
- Related: [When to Refactor *to* Patterns](../01-when-to-refactor-to-patterns/junior.md) · [Speculative Generality / Dispensables](../../01-code-smells/04-dispensables/junior.md) · [Anti-patterns: over-engineering](../../../anti-patterns/) · [Design principles: YAGNI/KISS](../../../design-principles/)
