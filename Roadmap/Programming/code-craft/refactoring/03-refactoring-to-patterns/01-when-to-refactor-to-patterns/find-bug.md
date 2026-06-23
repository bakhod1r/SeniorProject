# When to Refactor to Patterns — Spot the Over-Engineering

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)

These are code-review snippets where a pattern was **mis-applied or applied too early** — speculative generality, the wrong pattern, or a relocated smell. Your job: spot the over-engineering, name *why* it's wrong, and give the fix. The "bug" here is a *design* bug, not a runtime one. Diagnosis and fix follow each snippet.

---

## Snippet 1 — Strategy with one strategy

```java
interface ValidationStrategy { boolean isValid(String email); }

class StandardEmailValidation implements ValidationStrategy {
    public boolean isValid(String email) {
        return email != null && email.contains("@");
    }
}

class EmailValidator {
    private ValidationStrategy strategy = new StandardEmailValidation();
    public void setStrategy(ValidationStrategy s) { this.strategy = s; }
    public boolean validate(String email) { return strategy.isValid(email); }
}
```

<details>
<summary>Diagnosis & fix</summary>

**Bug: speculative generality — a Strategy abstraction with exactly one strategy and no second one in sight.** Three lines of validation logic are wrapped in an interface, an implementation class, a context class, and a setter, all justified by an imagined "what if we need other validation rules." That's a pattern as a *starting point*, with no smell driving it.

**Fix — inline to the simplest thing:**

```java
class EmailValidator {
    public boolean validate(String email) {
        return email != null && email.contains("@");
    }
}
```

When a *second* validation rule actually arrives, refactoring *to* Strategy is a small, well-understood move you do *then*. Until then, the abstraction is dead weight ([YAGNI](../../../design-principles/01-generic/02-yagni/junior.md)).
</details>

---

## Snippet 2 — The AbstractFactory of one product

```java
abstract class WidgetFactory {
    abstract Button createButton();
    abstract Checkbox createCheckbox();
}
class DefaultWidgetFactory extends WidgetFactory {
    Button createButton() { return new Button(); }
    Checkbox createCheckbox() { return new Checkbox(); }
}
// Only DefaultWidgetFactory exists. There is one theme. There has only ever been one theme.
```

<details>
<summary>Diagnosis & fix</summary>

**Bug: Abstract Factory with a single concrete family.** Abstract Factory's entire reason to exist is producing *multiple* families of related products (light theme vs dark theme, Windows vs Mac widgets). With one family, the abstract base, the subclass, and the indirection buy nothing.

**Fix — construct directly:**

```java
class Widgets {
    Button button() { return new Button(); }
    Checkbox checkbox() { return new Checkbox(); }
}
```

The pattern is correct *when a second product family materializes* (a real dark theme, not a hypothetical). Reaching for [Abstract Factory](../../../design-patterns/01-creational/02-abstract-factory/junior.md) before the second family is over-engineering.
</details>

---

## Snippet 3 — The relocated conditional

```java
// "Refactored away the switch" into a Strategy... and then:
class ShippingFactory {
    static ShippingMethod create(MethodCode code) {
        switch (code) {
            case GROUND:   return new Ground();
            case AIR:      return new Air();
            case OVERNIGHT:return new Overnight();
            default: throw new IllegalArgumentException();
        }
    }
}
// Meanwhile the SAME switch on code still exists in PricingDisplay and DeliveryEstimate.
```

<details>
<summary>Diagnosis & fix</summary>

**Bug: the smell was *relocated*, not removed.** The duplicated `switch (code)` still lives in `PricingDisplay` and `DeliveryEstimate`; the factory just *added a third* copy. Introducing Strategy without consolidating *all* the dispatch sites doesn't cure duplicated conditional dispatch — it adds machinery on top of it.

**Fix — make creation the single dispatch point and route everyone through the polymorphic object:**

```java
class ShippingFactory {
    private static final Map<MethodCode, Supplier<ShippingMethod>> REGISTRY = Map.of(
        MethodCode.GROUND, Ground::new,
        MethodCode.AIR, Air::new,
        MethodCode.OVERNIGHT, Overnight::new
    );
    static ShippingMethod create(MethodCode code) {
        var f = REGISTRY.get(code);
        if (f == null) throw new IllegalArgumentException();
        return f.get();
    }
}
```

Then `PricingDisplay` and `DeliveryEstimate` must ask the `ShippingMethod` object (`method.cost()`, `method.estimatedDays()`) instead of re-switching on `code`. A *single* creation lookup in the factory is acceptable; *three* copies of the dispatch across modules is the smell. The refactoring isn't done until the other two are gone.
</details>

---

## Snippet 4 — Decorator that doesn't decorate

```java
interface Coffee { BigDecimal cost(); }
class SimpleCoffee implements Coffee { public BigDecimal cost() { return new BigDecimal("2.00"); } }

class MilkDecorator implements Coffee {
    private final Coffee inner;
    MilkDecorator(Coffee c) { this.inner = c; }
    public BigDecimal cost() { return new BigDecimal("2.50"); }  // ignores inner!
}
```

<details>
<summary>Diagnosis & fix</summary>

**Bug: a Decorator that *replaces* instead of *augmenting*.** The whole point of [Decorator](../../../design-patterns/02-structural/04-decorator/junior.md) is to wrap and *add to* the inner object's behavior. `MilkDecorator.cost()` ignores `inner` entirely and returns a hard-coded total, so stacking (`new MilkDecorator(new SugarDecorator(coffee))`) breaks — sugar's cost vanishes. It has Decorator's *shape* but not its *behavior*; it's a wrong-pattern bug.

**Fix — augment the inner result:**

```java
class MilkDecorator implements Coffee {
    private final Coffee inner;
    MilkDecorator(Coffee c) { this.inner = c; }
    public BigDecimal cost() { return inner.cost().add(new BigDecimal("0.50")); }
}
```

Now decorators compose correctly. (And per Task 3 in tasks.md — if the embellishments are *only* additive prices, ask whether you even need Decorator versus a summed list of add-ons.)
</details>

---

## Snippet 5 — Template Method for a one-line difference

```java
abstract class Greeter {
    final String greet(String name) {
        return prefix() + name + suffix();
    }
    abstract String prefix();
    abstract String suffix();
}
class FormalGreeter extends Greeter {
    String prefix() { return "Dear "; }
    String suffix() { return ","; }
}
class CasualGreeter extends Greeter {
    String prefix() { return "Hey "; }
    String suffix() { return "!"; }
}
```

<details>
<summary>Diagnosis & fix</summary>

**Bug: Template Method (an inheritance hierarchy) to vary two string *values*.** [Template Method](../../../design-patterns/03-behavioral/09-template-method/junior.md) earns its keep when the varying step is real *behavior*; here the variation is two constants. Three classes and an abstract base replace what is fundamentally data.

**Fix — pass the data:**

```java
record GreetStyle(String prefix, String suffix) {}
String greet(String name, GreetStyle s) { return s.prefix() + name + s.suffix(); }

GreetStyle FORMAL = new GreetStyle("Dear ", ",");
GreetStyle CASUAL = new GreetStyle("Hey ", "!");
```

A value/parameter beats a class hierarchy when the variation is a *value*. Reserve Template Method for when the steps carry genuine logic (different parsing, validation, I/O), not constants.
</details>

---

## Snippet 6 — Observer with one hard-wired observer

```java
class Order {
    private final List<OrderObserver> observers = new ArrayList<>();
    void addObserver(OrderObserver o) { observers.add(o); }
    void complete() {
        // ... mark complete ...
        for (OrderObserver o : observers) o.onComplete(this);
    }
}
// Wired once at startup, forever:
order.addObserver(emailSender);
// No other observer is ever added. No dynamic subscription. One listener, fixed.
```

<details>
<summary>Diagnosis & fix</summary>

**Bug: [Observer](../../../design-patterns/03-behavioral/06-observer/junior.md) with a single, statically-wired listener.** Observer pays when there are *multiple* and/or *dynamic* subscribers that come and go at runtime. Here it's one listener wired once and never changed — the observer list, the registration API, and the loop are overhead simulating a direct call.

**Fix — call directly:**

```java
class Order {
    private final EmailSender emailSender;
    Order(EmailSender e) { this.emailSender = e; }
    void complete() {
        // ... mark complete ...
        emailSender.onComplete(this);
    }
}
```

**When NOT to inline:** if you genuinely expect multiple, runtime-varying subscribers soon (a real requirement, not a guess), keeping Observer is justified. The bug is specifically *one fixed listener with no growth* — that's the speculative-generality version. Confirm there's no real fan-out coming before removing it.
</details>

---

## Snippet 7 — Premature Bridge

```java
// "To decouple abstraction from implementation":
abstract class Report {
    protected Renderer renderer;
    Report(Renderer r) { this.renderer = r; }
    abstract void generate();
}
interface Renderer { void render(String content); }
class PdfRenderer implements Renderer { public void render(String c) { /* ... */ } }

class SalesReport extends Report {
    SalesReport(Renderer r) { super(r); }
    void generate() { renderer.render(buildSales()); }
}
// There is one Report subtype and one Renderer. Just PDF sales reports. Today.
```

<details>
<summary>Diagnosis & fix</summary>

**Bug: a [Bridge](../../../design-patterns/02-structural/02-bridge/junior.md) built with one abstraction and one implementation.** Bridge decouples *two independently-varying dimensions* (report types × output formats) so they don't multiply into a class explosion. With one of each, there's no explosion to prevent — it's two interfaces and an injection ceremony around what is one concrete behavior.

**Fix — collapse to the concrete case:**

```java
class SalesReport {
    String generate() { return buildSales(); }   // caller renders to PDF
}
```

Bridge becomes correct the moment you have *both* multiple report types *and* multiple formats varying independently (sales/inventory × PDF/HTML/CSV). Building the Bridge before *either* dimension has a second member is speculative generality. See [abstraction-failures](../../../anti-patterns/02-design/03-abstraction-failures/junior.md) for the family of these mistakes.
</details>
