# When to Refactor to Patterns — Decision Tasks

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)

These are *judgment* exercises, not coding drills. For each: given a snippet and its context, decide **if** you'd refactor to a pattern, **which** pattern, **or argue NOT to**. Justify with the smell, the rule of three, and cost/benefit. A full discussion follows each task after the divider. Cover the answer before reading.

---

## Task 1 — The duplicated dispatch

**Context:** This `switch (type())` appears in *three* methods of `Account` (`interestRate()`, `withdrawalLimit()`, `monthlyFee()`). The bank adds a new account type roughly twice a year.

```java
double interestRate() {
    switch (type()) {
        case CHECKING: return 0.001;
        case SAVINGS:  return 0.02;
        case CD:       return 0.04;
        default: throw new IllegalStateException();
    }
}
// ...same switch in withdrawalLimit() and monthlyFee()
```

**Decide:** Pattern or not? Which? Justify.

---

<details>
<summary>Discussion</summary>

**Refactor — yes.** Three call sites branch on the same `type()`: that's **duplicated conditional dispatch**, and it clears the rule of three on the spot. Adding an account type currently means editing three methods in lockstep, and forgetting one is a latent bug.

**Destination:** polymorphism — refactor *toward* [Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md) (or subclasses of `Account` if the type is intrinsic and fixed at creation). Each type becomes a class owning its rate, limit, and fee. A new type is one new class, not three edits.

**State vs Strategy check:** an account's type doesn't change over its lifetime and `CHECKING` never *becomes* `SAVINGS`, so this is Strategy/subclassing, **not** State.

**How far:** stop at "subclass/strategy per type." Don't build a runtime-pluggable registry unless types are added at runtime — they aren't (twice a year, by code change). Going further is over-engineering.
</details>

---

## Task 2 — The lonely conditional

**Context:** This is the *only* place in the codebase that branches on `level`. It hasn't changed in 18 months. Three branches.

```java
String badge(int level) {
    if (level < 10)  return "bronze";
    if (level < 50)  return "silver";
    return "gold";
}
```

**Decide:** Pattern or not?

---

<details>
<summary>Discussion</summary>

**No pattern.** This is a single, small, stable conditional with no duplication. Introducing a Strategy or a "BadgePolicy" hierarchy here is textbook over-engineering — more files, more indirection, zero payoff. It fails the rule of three (one site) and has no churn.

The method is already clear. If anything, it's *more* readable as this three-line `if` than as any pattern. The correct "refactoring" is **nothing** — or at most a [Replace Magic Number with Symbolic Constant](../../02-refactoring-techniques/04-simplifying-conditionals/junior.md) for `10` and `50` if those thresholds appear elsewhere. Leave it.
</details>

---

## Task 3 — The optional embellishments

**Context:** Coffee pricing. Customers can add milk, soy, an extra shot, whipped cream — in any combination. New add-ons appear a few times a year.

```java
BigDecimal price(Order o) {
    BigDecimal p = base(o.size());
    if (o.hasMilk())   p = p.add(new BigDecimal("0.50"));
    if (o.hasSoy())    p = p.add(new BigDecimal("0.60"));
    if (o.extraShot()) p = p.add(new BigDecimal("0.80"));
    if (o.whipped())   p = p.add(new BigDecimal("0.40"));
    return p;
}
```

**Decide:** Pattern or not? Which? And what's the trap?

---

<details>
<summary>Discussion</summary>

**Maybe — and the trap is choosing the wrong pattern.** The smell is *conditional embellishment*: optional behaviors that stack in any combination. The naive instinct is "a subclass per combination," which is `2^n` classes — the combinatorial explosion is the tell pointing to [Decorator](../../../design-patterns/02-structural/04-decorator/junior.md): each add-on is an independent wrapper.

**But weigh it.** If add-ons are pure additive price (as shown), a Decorator might be *more* machinery than a clean `List<AddOn>` you sum over — a lightweight, data-driven approach beats a full Decorator here:

```java
BigDecimal price(Order o) {
    return o.addOns().stream()
            .map(AddOn::price)
            .reduce(base(o.size()), BigDecimal::add);
}
```

Decorator earns its keep only when each embellishment *wraps and modifies behavior* (e.g., changes brewing, alters tax, conditionally affects others), not when it just adds a number. **Refactor toward a data-driven list first**; reach for full Decorator only if the embellishments grow real behavior. Choosing Decorator reflexively because you see "optional behavior" is over-engineering.
</details>

---

## Task 4 — The state machine in disguise

**Context:** An order's behavior depends on its status, and each status determines which transitions are legal and what happens next.

```java
void ship(Order o) {
    if (o.status() == PAID) {
        o.setStatus(SHIPPED);
        notifyCarrier(o);
    } else if (o.status() == PLACED) {
        throw new IllegalStateException("not paid");
    } else if (o.status() == SHIPPED) {
        throw new IllegalStateException("already shipped");
    }
    // similar status-branching in pay(), cancel(), deliver()...
}
```

**Decide:** Pattern or not? Strategy or State? Justify.

---

<details>
<summary>Discussion</summary>

**Refactor — yes, toward [State](../../../design-patterns/03-behavioral/07-state/junior.md), not Strategy.** The discriminator from middle.md: the branch variable (`status`) *changes over the order's lifetime*, and each status decides the *next* one (`PAID → SHIPPED`). Branches transition between each other — that's State, not Strategy.

The smell is the same `status`-branching duplicated across `ship()`, `pay()`, `cancel()`, `deliver()` — duplicated conditional dispatch *plus* transition logic. Each state becomes a class that knows which operations are legal and what state comes next. Illegal transitions become a default in the base state rather than scattered `if/throw`.

**Caveat:** if there are only two states and one transition, State is overkill — a small guard is clearer. Here there are four states and multiple operations, so the pattern pays. Confirm the transition graph is genuinely non-trivial before committing.
</details>

---

## Task 5 — The telescoping constructor

**Context:** A `Report` with many optional fields. Callers pass `null` for fields they don't want, and the team keeps getting the argument order wrong.

```java
new Report(title, null, footer, null, true, null, "A4", false);
```

**Decide:** Pattern or not? Which?

---

<details>
<summary>Discussion</summary>

**Refactor — yes, to [Builder](../../../design-patterns/01-creational/03-builder/junior.md).** The smell is a *long parameter list / telescoping constructor* with many optionals and positional ambiguity (`null, true, null` — what do they mean?). This is a genuine, recurring source of bugs (wrong argument order), which is the justification, not "Builder is nice."

```java
Report r = Report.builder()
    .title(title).footer(footer)
    .pageSize("A4").landscape(true)
    .build();
```

Named, optional, order-independent. **When NOT to:** if the constructor has 2–3 *required* args and no real optionality, Builder is ceremony — a plain constructor or a small factory is clearer. Builder pays specifically when there are *many optional* fields, which is the case here.
</details>

---

## Task 6 — The premature plugin system

**Context:** A junior submits this for a notification feature. Today the product sends email. *Only* email. There is no ticket, no roadmap item, for any other channel.

```java
interface NotificationStrategy { void send(User u, String msg); }
class EmailStrategy implements NotificationStrategy { /* ... */ }
class NotificationContext {
    private NotificationStrategy strategy;
    void setStrategy(NotificationStrategy s) { this.strategy = s; }
    void notify(User u, String msg) { strategy.send(u, msg); }
}
```

**Decide:** Approve, or push back?

---

<details>
<summary>Discussion</summary>

**Push back — this is speculative generality.** A [Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md) with exactly *one* strategy and no second channel on the roadmap is a pattern imposed as a starting point — precisely the anti-pattern this whole section warns against. It's a destination reached with no smell driving it.

There's no duplication, no churning conditional, no rule-of-three evidence. The interface, the context class, and the setter are all overhead today, justified only by an imagined future ([YAGNI](../../../design-principles/01-generic/02-yagni/junior.md) violation).

**Recommendation:** collapse to the simplest thing — a `NotificationService.email(user, msg)` method. *When* a second channel becomes real (a ticket, not a guess), the refactor *to* Strategy is a tiny, well-understood move you can do then, cheaply. Per Metz: prefer the simple thing and wait; the wrong abstraction is more expensive than the duplication you don't even have yet.
</details>

---

## Task 7 — The hard-coded tree

**Context:** A filesystem-like menu rendered with nested checks everywhere.

```java
long size(Object node) {
    if (node instanceof File) return ((File) node).bytes();
    if (node instanceof Folder) {
        long total = 0;
        for (Object child : ((Folder) node).children())
            total += size(child);   // recursion already here, plus instanceof
        return total;
    }
    throw new IllegalArgumentException();
}
// the same File/Folder instanceof appears in render(), count(), search()...
```

**Decide:** Pattern or not? Which?

---

<details>
<summary>Discussion</summary>

**Refactor — yes, to [Composite](../../../design-patterns/02-structural/03-composite/junior.md).** The smell: a tree faked with `instanceof File / instanceof Folder` ladders, *duplicated* across `size()`, `render()`, `count()`, `search()`. Adding a new node kind (e.g., `Symlink`) means hunting down every `instanceof` site — shotgun surgery.

Composite gives `File` and `Folder` a common `Node` interface with `size()`, so each type implements its own and recursion replaces the type checks. A leaf returns its bytes; a branch sums its children polymorphically.

**Confirm before committing:** the `instanceof` ladder must be *duplicated* (it is — four methods). A single `instanceof` in one place wouldn't justify the pattern. With four sites and a real "add a node type" pressure, Composite clearly pays. If many *operations* later traverse the tree, that's a future signal for [Visitor](../../../design-patterns/03-behavioral/10-visitor/junior.md) — but not yet.
</details>

---

## Task 8 — The almost-identical algorithms

**Context:** Two report exporters share the same skeleton — open, write header, write rows, write footer, close — differing only in *how* a row is formatted.

```java
class CsvExporter {
    String export(List<Row> rows) {
        StringBuilder sb = new StringBuilder();
        sb.append(header());
        for (Row r : rows) sb.append(r.a()).append(",").append(r.b()).append("\n");
        sb.append(footer());
        return sb.toString();
    }
}
class TsvExporter { /* identical except "," → "\t" */ }
```

**Decide:** Pattern or not? Which? And is two enough?

---

<details>
<summary>Discussion</summary>

**Borderline — and the honest answer is "probably not yet, but watch it."** The smell is *duplicated algorithm with one varying step* (the delimiter), which points to [Template Method](../../../design-patterns/03-behavioral/09-template-method/junior.md): hoist the skeleton, leave `formatRow` abstract.

**But there are only two variants, and the difference is a single character.** The rule of three says: don't extract the abstraction at two — especially when the variation is this small. The cheaper, *lower-risk* move is to parameterize:

```java
String export(List<Row> rows, String delimiter) { /* one method, delimiter passed in */ }
```

A parameter beats a Template Method hierarchy when the variation is a *value*, not *behavior*. Reserve Template Method for when the varying step is *real logic* (different escaping rules, different encodings) **and** a third format appears. Extracting a class hierarchy now, for a one-character difference at two sites, risks the wrong abstraction (Metz). **Parameterize now; refactor to Template Method if/when the variation grows into behavior at a third call site.**
</details>

---

## Task 9 — The smell that's actually a model problem

**Context:** A `taxRate(Customer c)` method has a 40-line conditional on `c.country()`, and the *same* country-branching also appears in `currency()`, `dateFormat()`, `addressFormat()`, and `phoneValidator()` — spread across five unrelated classes.

**Decide:** Refactor each site to a pattern? Or something else?

---

<details>
<summary>Discussion</summary>

**Don't local-patch with five separate Strategies — this is a deeper design problem.** The same `country` conditional duplicated across *unrelated* modules is the senior.md signal: a **missing domain concept**. The country isn't just a tax input; it's a `Locale`/`Region` that *owns* tax rate, currency, date format, address format, and phone rules.

Applying a separate Strategy at each of the five sites would multiply indirection (five hierarchies) without curing the root — and the *next* locale-dependent feature would be a sixth site needing a sixth Strategy.

**Right move:** introduce a `Region` value object (or polymorphic type) that encapsulates all locale-dependent behavior. Each site asks `region.taxRate()`, `region.currency()`, etc. One concept replaces five parallel conditionals. The "pattern" here is closer to Replace Conditional with Polymorphism applied to a *new first-class type*, not five behavioral patterns bolted onto symptoms. Ask the senior test: "will the next locale feature be easy?" Only the `Region` approach answers yes.
</details>

---

## Task 10 — Refactor *away*: the one-strategy strategy

**Context:** You inherit this. Git history shows `DiscountStrategy` has had exactly one implementation, `NoDiscount`, for two years. No others were ever added.

```java
interface DiscountStrategy { BigDecimal apply(BigDecimal total); }
class NoDiscount implements DiscountStrategy {
    public BigDecimal apply(BigDecimal total) { return total; }
}
class Checkout {
    private DiscountStrategy discount = new NoDiscount();
    BigDecimal total(Cart c) { return discount.apply(c.subtotal()); }
}
```

**Decide:** Leave it, or refactor *away*?

---

<details>
<summary>Discussion</summary>

**Refactor *away* — carefully.** This is a Strategy with one strategy that *does nothing* (`return total`), unchanged for two years. It carries no variation; the indirection is pure dead weight. This is the third direction — refactor *away from* a pattern — and the right call.

```java
class Checkout {
    BigDecimal total(Cart c) { return c.subtotal(); }
}
```

Inline `NoDiscount`, delete the interface, remove the field. The code gets simpler and a reader no longer chases a virtual call that's a no-op.

**The required caution (from junior.md):** before deleting, *confirm* there's no real plan to add discounts. Check the backlog, ask the team. "I don't understand why this exists" is not sufficient grounds to remove a pattern; "it has exactly one no-op implementation, two years of history with no others, and no discount feature on the roadmap" is. If a discount feature *is* imminent, leaving the seam may be cheaper than re-adding it. See [Refactoring Away From Patterns](../05-refactoring-away-from-patterns/junior.md).
</details>
