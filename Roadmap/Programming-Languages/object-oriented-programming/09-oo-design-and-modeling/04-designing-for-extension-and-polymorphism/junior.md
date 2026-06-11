# Designing for Extension & Polymorphism — Junior

> **What?** *Designing for extension* means deciding — on purpose, up front — *where* and *how* your code is allowed to grow new behaviour, and where it is *not*. The tool that makes growth cheap is **polymorphism**: calling a method through an abstraction so a new implementation can plug in without you editing the caller. The discipline behind it is the **Open/Closed Principle**: a unit should be *open for extension, closed for modification*.
> **How?** Find the part of the code that varies (the *variation point*), name it as an interface or abstract method (the *extension seam*), and let callers depend on the abstraction. Adding a new variant then means writing a new class — not editing a `switch`. The hard part is judgement: which seams to add (too many is over-engineering), and whether to leave a hierarchy *open* (anyone can extend) or *sealed* (a fixed, known set).

---

## 1. The problem extension solves

You wrote this last month:

```java
class ShippingCalculator {
    Money cost(Order order) {
        return switch (order.method()) {
            case STANDARD -> Money.of(5);
            case EXPRESS  -> Money.of(15);
        };
    }
}
```

This week the business adds **overnight** shipping. You edit the `switch`. Next week, **free shipping over $50**. You edit it again. Each change re-opens a *tested, working* method — and risks breaking the cases that were already right. The method is **closed to extension** (you can't add a rule without touching it) and **open to modification** (you're forced to touch it).

The Open/Closed Principle inverts that: make the method *closed to modification* (you never reopen it) but *open to extension* (new behaviour arrives as new code).

---

## 2. The fix: a polymorphic seam

Name the thing that varies — the cost rule — as an interface:

```java
interface ShippingRule {
    Money cost(Order order);
}

final class StandardShipping implements ShippingRule {
    public Money cost(Order o) { return Money.of(5); }
}
final class ExpressShipping implements ShippingRule {
    public Money cost(Order o) { return Money.of(15); }
}
```

Now the calculator depends on the *abstraction*, not the cases:

```java
class ShippingCalculator {
    private final ShippingRule rule;
    ShippingCalculator(ShippingRule rule) { this.rule = rule; }
    Money cost(Order order) { return rule.cost(order); }   // never reopened
}
```

Adding **overnight** shipping is now a *new file*: `class OvernightShipping implements ShippingRule`. `ShippingCalculator` is never touched again. That interface is the **extension seam** — the deliberate gap where new behaviour plugs in.

---

## 3. "Replace conditional with polymorphism"

The refactoring you just did has a name. When a `switch`/`if`-chain branches **on a type or a kind**, and the same shape of branching appears in *more than one place*, replace it with polymorphism:

| Conditional code | Polymorphic code |
| --- | --- |
| `switch(shape.kind())` in `area()`, `perimeter()`, `draw()` | `shape.area()`, `shape.perimeter()`, `shape.draw()` — each `Shape` knows its own |
| Adding a kind = edit every `switch` | Adding a kind = one new class |
| The branches drift out of sync | The compiler forces every method to exist |

```java
// Before — the kind is data; behaviour is scattered across switches
double area(Shape s) {
    return switch (s.kind()) {
        case CIRCLE -> Math.PI * s.r() * s.r();
        case SQUARE -> s.side() * s.side();
    };
}

// After — the kind is a type; behaviour lives with the data
sealed interface Shape permits Circle, Square {
    double area();
}
record Circle(double r)    implements Shape { public double area() { return Math.PI*r*r; } }
record Square(double side) implements Shape { public double area() { return side*side; } }
```

The win: behaviour that belongs together *lives* together, and adding `Triangle` can't leave a `switch` half-updated.

---

## 4. When the conditional should stay (the honest caveat)

Polymorphism is not always better. Keep the conditional when:

- **The variation is over a value, not a type.** `if (age >= 18)` should not become an `Adult`/`Minor` class hierarchy. That's astronaut architecture.
- **There's exactly one branch point, and it's local.** A single `switch` in one method, unlikely to grow, is *clearer* than five tiny classes scattered across files.
- **The set is closed and you want exhaustiveness.** A `switch` over a **sealed** type (§3 above) is *better* than scattered polymorphism for things like a one-off pretty-printer that lives outside the type — see `middle.md`.

The rule of thumb: reach for polymorphism when the *same kind of branching repeats* and the set of cases *grows over time*. A lone, stable `if` is fine.

---

## 5. The two classic seams: Strategy and Template Method

There are two canonical ways to design an extension point. You will use both constantly.

**Strategy** — the whole algorithm is swappable. The varying behaviour is an *object you hold* (composition).

```java
interface Compressor { byte[] compress(byte[] data); }   // the seam

class Archiver {
    private final Compressor compressor;                  // hold a strategy
    Archiver(Compressor c) { this.compressor = c; }
    byte[] archive(byte[] data) { return compressor.compress(data); }
}
// new Archiver(new GzipCompressor()); new Archiver(new ZstdCompressor());
```

**Template Method** — the *skeleton* is fixed; only specific *steps* vary. The varying behaviour is an *abstract method a subclass fills in* (inheritance).

```java
abstract class ReportGenerator {
    public final String generate() {          // fixed skeleton — note `final`
        return header() + body() + footer();
    }
    protected String header() { return "=== Report ===\n"; }   // default hook
    protected abstract String body();                          // required seam
    protected String footer() { return "\n=== End ===";   }   // default hook
}

class SalesReport extends ReportGenerator {
    protected String body() { return "Sales: $42,000"; }       // fill the one gap
}
```

The skeleton (`generate`) is `final` so subclasses can't reorder the steps; the *gaps* (`body`, and optionally `header`/`footer`) are the seams. Default for new code: prefer **Strategy** (composition) unless the fixed-skeleton-with-gaps shape is exactly what you have.

---

## 6. Open extension vs sealed: closing the door on purpose

Sometimes you *want* extension to be impossible. A `PaymentMethod` family of `Card | Bank | Crypto` is *complete* — a fourth kind would be a real business decision, not a casual subclass. Use a **sealed** type to say so:

```java
sealed interface PaymentMethod permits Card, Bank, Crypto { }
record Card(String pan)  implements PaymentMethod { }
record Bank(String iban) implements PaymentMethod { }
record Crypto(String addr) implements PaymentMethod { }
```

| | Open extension (plain interface) | Sealed (closed set) |
| --- | --- | --- |
| Who can add a variant? | Anyone, anywhere, even other teams | Only you, in this module |
| Adding a variant | Zero changes to existing code | Forces every `switch` to handle it (compile error otherwise) |
| Best for | Plugins, SPIs, things others extend | Domain models with a *complete, known* set of cases |

Open and sealed are *opposite design intents*. "Design for extension" includes the discipline to say **"this is closed"** — see [../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/](../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/).

---

## 7. Bloch's rule: "design and document for inheritance, or else prohibit it"

If you *do* allow subclassing (Template Method, frameworks), you owe the subclasser a contract. Joshua Bloch's *Effective Java* Item 19:

- **Document self-use.** State which overridable methods the class calls internally, and in what order. A subclasser can't override safely without knowing.
- **Provide explicit hooks.** Carefully chosen `protected` methods are the *only* sanctioned extension points.
- **Never call an overridable method from a constructor.** The subclass's override runs before the subclass's fields are initialized — a classic crash. (See the Fragile Base Class topic.)
- **Otherwise: prohibit it.** Mark the class `final`. If you didn't design for inheritance, don't allow it.

```java
public final class Money { /* you cannot subclass me — and that's intentional */ }
```

The default for an ordinary class is **`final`**. Openness to inheritance is a *feature you design in*, not a thing you leave on by accident. Leaving an undesigned class open invites the **fragile base class** trap — see [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/).

---

## 8. Stable abstractions: the seam must not wobble

An extension seam only pays off if the *abstraction itself* is stable. If you keep changing the `ShippingRule` interface — adding a method, changing a signature — every implementer breaks, and you've gained nothing.

A good seam is:

- **Narrow.** As few methods as the job needs. `Comparator<T>` has essentially one. Easy to implement, hard to break.
- **About one thing.** It models a single axis of variation (cost rule, compression algorithm), not a grab-bag.
- **Phrased in the domain's stable vocabulary.** `cost(Order)` is stable; `costUsingV2TaxEngine(Order, boolean legacyMode)` is not.

The principle behind this is **Protected Variations** (a GRASP principle): wrap the points *predicted to change* behind a stable interface, so the instability can't leak. The interface is a *firewall* — variation happens behind it, callers in front of it never feel it. See [../01-grasp-responsibility-assignment/](../01-grasp-responsibility-assignment/).

---

## 9. SPIs and plugins: extension by total strangers

The most ambitious extension point is one that lets *code you've never seen* plug in. That's a **Service Provider Interface (SPI)**. The JDK does this everywhere — `java.sql.Driver`, `java.nio.file.spi.FileSystemProvider`, logging backends.

```java
public interface PaymentGateway {           // the SPI: you publish it
    PaymentResult charge(Money amount, Card card);
}
```

A third party ships a class implementing it; your app discovers it at runtime with `ServiceLoader`:

```java
ServiceLoader<PaymentGateway> gateways = ServiceLoader.load(PaymentGateway.class);
for (PaymentGateway g : gateways) { /* each provider, loaded without you naming it */ }
```

This is the Open/Closed Principle taken to its limit: your application is *closed* (you ship and forget it) yet *open* to gateways that didn't exist when you compiled. The price is a much stricter contract — an SPI is a published API and breaking it breaks strangers' code.

---

## 10. Putting it together — a checklist for a new seam

Before you add an extension point, ask:

1. **Is there real variation?** Two implementations *today*, or a concrete one *coming*? (One implementation = no seam yet. YAGNI.)
2. **What's the stable abstraction?** Name the one method/few methods that capture the axis of change.
3. **Strategy or Template Method?** Swappable whole → Strategy (compose). Fixed skeleton, varying steps → Template Method (and make the skeleton `final`).
4. **Open or sealed?** Will strangers extend it (open/SPI), or is it a complete domain set (sealed)?
5. **If open to subclassing, did I document self-use and avoid constructor callbacks?** If not, mark it `final`.

---

## 11. Common newcomer mistakes

**Mistake 1: a seam for a single implementation.** One `interface Foo` with one `class FooImpl` and no second implementer in sight is ceremony, not design. Add the seam when the *second* variant appears (or is concretely planned).

**Mistake 2: turning every `if` into a class.** Value checks (`if (x > 0)`) are not type variation. Polymorphism replaces *type/kind* switches, not arithmetic.

**Mistake 3: a wide, wobbly seam.** A 10-method interface that changes every sprint protects nobody. Keep seams narrow and stable.

**Mistake 4: leaving everything open.** Not marking classes `final`, allowing inheritance you never designed for — that's how the fragile base class problem starts.

**Mistake 5: sealing what should be open (and vice versa).** A plugin point that you `sealed` can't be extended by others; a domain model left open loses exhaustive `switch`. Match the closure to the intent.

---

## 12. Quick rules

- [ ] Find the variation point; name it as a narrow, stable interface or abstract method.
- [ ] Make callers depend on the abstraction — closed to modification, open to extension.
- [ ] Replace *repeated type-switches* with polymorphism; leave lone value-`if`s alone.
- [ ] Strategy for swappable algorithms (compose); Template Method for fixed-skeleton-varying-steps (make the skeleton `final`).
- [ ] Sealed for complete domain sets; open/SPI for things strangers extend.
- [ ] Default classes to `final`. Allow inheritance only when you *design and document* for it.
- [ ] Never call an overridable method from a constructor.

---

## 13. What's next

| Topic | File |
| --- | --- |
| Worked seams, Abstract Factory, ServiceLoader, hook design | `middle.md` |
| Stable abstractions, variance, SPI evolution, when polymorphism loses | `senior.md` |
| Reviewing for extensibility; ArchUnit, change-cost; refactoring playbook | `professional.md` |
| OCP/Protected Variations sources; Bloch 19–22; GoF; JLS sealed | `specification.md` |
| Spotting rigid switches and unsafe-for-subclassing code | `find-bug.md` |
| Replacing conditional explosion with polymorphism, measured | `optimize.md` |
| Design-an-extensible-API exercises | `tasks.md` |
| Interview Q&A | `interview.md` |

---

**Memorize this:** find what *varies*, hide it behind a *narrow, stable abstraction*, and let callers depend on that abstraction — now new behaviour is a new class, not an edit to working code. Use polymorphism to kill repeated type-switches, Strategy and Template Method as your two seams, `sealed` to *close* a complete set, and `final` + documented self-use to make any allowed inheritance safe. Extension you didn't design for is the fragile base class trap waiting to happen.
