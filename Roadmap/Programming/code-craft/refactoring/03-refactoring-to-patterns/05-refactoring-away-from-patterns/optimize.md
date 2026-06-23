# Refactoring Away From Patterns — Optimize

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); Sandi Metz, "The Wrong Abstraction" (2016).

Each "before" carries needless-pattern complexity. Propose the de-abstraction — or *defend keeping it* if the structure earns its keep. Unlike [find-bug.md](find-bug.md), nothing here is strictly broken; the goal is the *simplest design that fits the real need*. Decide, then check the worked solution. "Optimize" includes both clarity and, where measured, runtime.

---

## Optimize 1 — Abstract Factory for one product family

```java
interface WidgetFactory { Button button(); Checkbox checkbox(); }
class DefaultWidgetFactory implements WidgetFactory {
    public Button button(){ return new Button(); }
    public Checkbox checkbox(){ return new Checkbox(); }
}
WidgetFactory f = new DefaultWidgetFactory();
Button b = f.button();
```

<details><summary>Worked solution</summary>

**De-abstract.** Abstract Factory exists to swap *whole product families* (e.g., a light-theme vs dark-theme widget set). With one family there is nothing to swap — pure speculative generality.

1. Confirm `DefaultWidgetFactory` is the only implementor and no second family exists or is imminent.
2. Replace `f.button()` with `new Button()`, `f.checkbox()` with `new Checkbox()` at call sites.
3. Delete `WidgetFactory` and `DefaultWidgetFactory`.

```java
Button b = new Button();
Checkbox c = new Checkbox();
```

**Keep-it caveat:** the moment a second coherent family appears (a `DarkWidgetFactory` whose products must be used together), Abstract Factory earns its keep — it enforces family consistency. With one family, that guarantee protects nothing.
</details>

---

## Optimize 2 — Builder for a 2-field object

```java
class Point {
    final int x, y;
    private Point(int x,int y){ this.x=x; this.y=y; }
    static class Builder {
        private int x, y;
        Builder x(int x){ this.x=x; return this; }
        Builder y(int y){ this.y=y; return this; }
        Point build(){ return new Point(x,y); }
    }
}
Point p = new Point.Builder().x(3).y(4).build();
```

<details><summary>Worked solution</summary>

**De-abstract.** Builder earns its keep for objects with *many* fields, optional fields, or step-wise/validated construction. A two-required-field value object needs none of that; the Builder is more code than the object and the call site is noisier than a constructor.

```java
record Point(int x, int y) {}
Point p = new Point(3, 4);
```

**Keep-it caveat:** keep Builder when there are many optional parameters (avoiding telescoping constructors), when construction is multi-step, or when you want an immutable object assembled incrementally. The threshold is roughly 4+ fields with optionality — not two required ints.
</details>

---

## Optimize 3 — Decorator chain in a hot loop (measure!)

```java
interface PriceSource { BigDecimal price(Item i); }
class BasePriceSource implements PriceSource { public BigDecimal price(Item i){ return i.base(); } }
class TaxDecorator implements PriceSource {
    final PriceSource in; TaxDecorator(PriceSource in){ this.in=in; }
    public BigDecimal price(Item i){ return in.price(i).multiply(TAX); }
}
class RoundDecorator implements PriceSource {
    final PriceSource in; RoundDecorator(PriceSource in){ this.in=in; }
    public BigDecimal price(Item i){ return in.price(i).setScale(2, HALF_UP); }
}
PriceSource src = new RoundDecorator(new TaxDecorator(new BasePriceSource()));
// called once per item over a 5,000,000-item nightly batch:
for (Item i : items) total = total.add(src.price(i));
```

Both decorators are always applied, never composed differently. Optimize?

<details><summary>Worked solution</summary>

**De-abstract — and here the runtime win is real and measurable.** Per item, the chain does two extra interface dispatches plus walks two wrapper objects; across 5M items that's 10M extra megamorphic-ish calls the JIT struggles to inline. Since tax+round are *always* applied, fold them into the base:

```java
class PriceSource {
    BigDecimal price(Item i){ return i.base().multiply(TAX).setScale(2, HALF_UP); }
}
for (Item i : items) total = total.add(src.price(i));
```

**Discipline:** *measure* before and after with [JMH](../../../design-principles/) — don't assume. In a tight numeric batch this typically shaves meaningful time and removes the wrapper allocations from the GC's path; if the benchmark *doesn't* move, keep the change only for the clarity win, not the speed claim.

**Keep-it caveat:** if some batches need tax-without-rounding or add a `CurrencyDecorator`, the composability is real — keep Decorator and optimize elsewhere. The collapse is justified by *always-on, never-recomposed* layers.
</details>

---

## Optimize 4 — Defend or de-abstract: the repository port

```java
interface OrderRepository { Optional<Order> byId(OrderId id); void save(Order o); }
class JpaOrderRepository implements OrderRepository { /* JPA */ }
// Tests use:
class InMemoryOrderRepository implements OrderRepository { /* HashMap */ }
```

One production implementor. Optimize by deleting the interface?

<details><summary>Worked solution</summary>

**Keep it — do not de-abstract.** There are *two* real implementors: `JpaOrderRepository` in production and `InMemoryOrderRepository` in tests. The interface is the seam that makes domain/service tests fast and database-free, and it keeps JPA types out of the domain (a port). Deleting it would force tests onto a real database (slow, flaky) or leak persistence concerns into the domain.

This is the counter-example to the "one-impl interface is a smell" rule: the rule is "one impl **and** no test seam **and** no boundary **and** no imminent second case." Here a test seam *and* an architectural boundary both apply. Leave it.
</details>

---

## Optimize 5 — Visitor over a closed two-case hierarchy

```java
interface Shape { <R> R accept(ShapeVisitor<R> v); }
class Circle implements Shape { double r; public <R> R accept(ShapeVisitor<R> v){ return v.visit(this); } }
class Square implements Shape { double s; public <R> R accept(ShapeVisitor<R> v){ return v.visit(this); } }
interface ShapeVisitor<R> { R visit(Circle c); R visit(Square s); }
class AreaVisitor implements ShapeVisitor<Double> {
    public Double visit(Circle c){ return Math.PI*c.r*c.r; }
    public Double visit(Square s){ return s.s*s.s; }
}
double a = shape.accept(new AreaVisitor());
```

Only one operation (`area`) exists, and the shape set is fixed. Optimize?

<details><summary>Worked solution</summary>

**De-abstract.** Visitor earns its keep when you have *many operations* over a *stable* type hierarchy and want to add operations without touching the types (it trades easy-new-operations for hard-new-types). Here there's one operation, so the entire double-dispatch apparatus (`accept`, the visitor interface, per-shape `visit`) buys nothing. Replace with a polymorphic method, or a switch over a sealed type:

```java
sealed interface Shape permits Circle, Square {}
record Circle(double r) implements Shape {}
record Square(double s) implements Shape {}

double area(Shape shape){
    return switch (shape){
        case Circle c -> Math.PI*c.r()*c.r();
        case Square s -> s.s()*s.s();
    };   // exhaustive over the sealed type, compiler-checked
}
```

**Keep-it caveat:** when operations multiply (area, perimeter, render, serialize, hit-test…) over a fixed hierarchy and you want each operation self-contained and addable without editing the shapes, Visitor earns its keep. With one operation, a method or sealed `switch` is simpler and equally type-safe.
</details>

---

## Optimize 6 — Generic "pipeline framework" for a fixed 3-step flow

```java
interface Stage<I,O> { O run(I in); }
class Pipeline {
    private final List<Stage> stages = new ArrayList<>();
    Pipeline add(Stage<?,?> s){ stages.add(s); return this; }
    Object execute(Object in){ Object x=in; for (Stage s: stages) x=s.run(x); return x; }
}
var p = new Pipeline()
    .add((Stage<Raw,Parsed>) this::parse)
    .add((Stage<Parsed,Valid>) this::validate)
    .add((Stage<Valid,Stored>) this::store);
Stored out = (Stored) p.execute(raw);
```

The pipeline is fixed: always parse → validate → store. Optimize?

<details><summary>Worked solution</summary>

**De-abstract — this is an inner-platform pipeline.** A generic stage-list "framework" reinvents *function composition*, and pays for it: erased `Stage` raw types, `Object` plumbing, and unchecked casts that defeat the type system. For a fixed three-step flow there's nothing to configure.

```java
Stored process(Raw raw){
    Parsed parsed = parse(raw);
    Valid  valid  = validate(parsed);
    return store(valid);
}
```

Three lines, fully type-checked, no casts, trivially readable and debuggable (a real stack trace, not a loop over erased stages).

**Keep-it caveat:** a configurable pipeline earns its keep when stages are genuinely *composed at runtime* from data/config, reordered, or reused across many flows (an ETL engine, a middleware chain with dozens of combinations). A *fixed* sequence of three known steps is just sequential code wearing a framework costume. (See [inner-platform / over-engineering anti-pattern](../../../anti-patterns/).)
</details>

---

## Optimize 7 — Strategy map for a static dispatch

```java
class Discounter {
    private static final Map<String, Function<Money,Money>> RULES = Map.of(
        "none",  m -> m,
        "ten",   m -> m.multiply(0.9),
        "twenty",m -> m.multiply(0.8)
    );
    Money apply(String code, Money m){ return RULES.getOrDefault(code, x->x).apply(m); }
}
```

The three codes are fixed and known at compile time. Optimize?

<details><summary>Worked solution</summary>

**Borderline — judge by trajectory.** A `Map<String, Function>` is a lightweight Strategy table. It's *not* egregious: it's compact and adds rules without touching a switch. The costs: the string key isn't compiler-checked (a typo silently falls to the default — a quiet bug), and `getOrDefault(..., x->x)` *hides* an unknown code instead of surfacing it.

**If the set is truly fixed and small,** an enum + `switch` is clearer and compiler-checked:

```java
enum Discount {
    NONE(m -> m), TEN(m -> m.multiply(0.9)), TWENTY(m -> m.multiply(0.8));
    private final Function<Money,Money> fn;
    Discount(Function<Money,Money> fn){ this.fn = fn; }
    Money apply(Money m){ return fn.apply(m); }
}
```

Now an unknown code is a parse/`valueOf` error at the boundary, not a silent no-op deep in pricing.

**Keep-it caveat / when the map wins:** if discount codes are *data* — added by admins at runtime, loaded from a database, not known at compile time — then a map (or a real Strategy registry) is correct and an enum is wrong; you genuinely need open-ended, data-driven dispatch. The deciding question is whether the set of codes is *closed and compile-time* (prefer enum/switch) or *open and runtime* (prefer the map). De-abstraction here means picking the form that matches reality, not blindly collapsing.
</details>

---

## Back to the topic

- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) · [interview.md](interview.md)
- [tasks.md](tasks.md) · [find-bug.md](find-bug.md)
