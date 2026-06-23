# DRY, KISS, YAGNI — Middle

> **What?** At the middle level you stop reciting the slogans and start *recognising* which rule applies in each situation. You learn to distinguish *meaning duplication* from *syntactic duplication*, *complexity that serves the problem* from *complexity that serves your ego*, and *features you'll need tomorrow* from *features you'll never need*. You apply each rule with a specific recipe.
> **How?** Three mechanical recipes: (1) for DRY, identify the source of truth; (2) for KISS, ask "what's the smallest change that makes today's test pass?"; (3) for YAGNI, ask "would removing this break a current requirement?". Each recipe is small and rote; the judgement is in knowing which rule applies.

---

## 1. The Rule of Three

The middle-level discipline: **don't extract until the third occurrence**.

- One occurrence: it's just code.
- Two occurrences: it might be coincidence.
- Three occurrences: it's a pattern; extract.

```java
// First file
boolean valid = email != null && email.contains("@");

// Second file
boolean valid = email != null && email.contains("@");

// Third file
boolean valid = email != null && email.contains("@");
// ← NOW extract EmailValidator.isValid(email)
```

Why wait? Because the *shape* of the abstraction depends on how the three callers actually differ. With two examples, you'd guess. With three, the variance points at the right parameters and the right granularity.

```java
// After 3 occurrences, the extraction is informed
public final class EmailValidator {
    public boolean isValid(String email) {
        return email != null && email.matches("^[^@]+@[^@]+\\..+$");
    }
}
```

Now the rule lives in one place; future changes propagate.

---

## 2. KISS recipe — "the simplest change that makes today's test pass"

KISS is hardest to apply because "simplest" is subjective. The middle-level recipe makes it mechanical:

1. Write the test for today's requirement.
2. Write the *simplest* code that makes the test pass.
3. Refactor for clarity if needed; do not refactor for future flexibility.

Worked example: "implement a tax calculator for our two markets, US and DE".

```java
// Test
@Test void calculatesUsTax() {
    assertThat(calculator.taxFor(Money.usd(100), Country.US))
        .isEqualTo(Money.usd(8));
}
@Test void calculatesDeTax() {
    assertThat(calculator.taxFor(Money.eur(100), Country.DE))
        .isEqualTo(Money.eur(19));
}
```

```java
// Simplest implementation
public final class TaxCalculator {
    public Money taxFor(Money base, Country country) {
        return switch (country) {
            case US -> base.multiply(new BigDecimal("0.08"));
            case DE -> base.multiply(new BigDecimal("0.19"));
        };
    }
}
```

A junior might reach for a `TaxRateRegistry`, a `TaxStrategyFactory`, and a `TaxConfigLoader`. KISS says: a `switch` on two cases is the right shape for two cases.

When the third country arrives, you'll refactor — informed by what that country needs. Maybe it's another `switch` case (KISS still wins), maybe it's a map (KISS adapts), maybe it's a per-region strategy (now the abstraction is justified). Today's test passes with the simplest shape.

---

## 3. YAGNI recipe — "would removing this break a current requirement?"

The YAGNI test: pick a piece of the code, *imagine removing it*, and ask if any current test or requirement breaks.

```java
public final class OrderProcessor {
    private final Map<String, OrderHandler> handlers = Map.of("default", new DefaultHandler());
    // ↑ remove the map?

    public void process(Order o) {
        handlers.get("default").handle(o);
    }
}
```

If you remove the map and call `defaultHandler.handle(o)` directly, no test fails — the map was speculation. YAGNI says: rip it out.

```java
public final class OrderProcessor {
    private final OrderHandler handler;
    public OrderProcessor(OrderHandler h) { this.handler = h; }
    public void process(Order o) { handler.handle(o); }
}
```

Apply this test to every "configurable" piece of the codebase: registries with one key, factories with one product, plugins with no plugins, strategies with one strategy. If removal doesn't break a current test, it was YAGNI.

---

## 4. DRY recipe — "one piece of knowledge, one source of truth"

The DRY recipe asks: *what knowledge does this code embody?* — and *where is that knowledge canonically expressed?*

Look at this:

```java
// File A
String emailRegex = "^[^@]+@[^@]+\\..+$";
// File B
if (input.matches("^[^@]+@[^@]+\\..+$")) { ... }
// File C
boolean isEmail = email.matches("^[^@]+@[^@]+\\..+$");
```

The knowledge — *"this is what a valid email looks like in our system"* — lives in three places. Three sources of truth for one fact; eventually one will drift.

DRY fix: name the fact, put it in one place.

```java
public final class EmailValidator {
    private static final Pattern PATTERN = Pattern.compile("^[^@]+@[^@]+\\..+$");
    public boolean isValid(String email) { return email != null && PATTERN.matcher(email).matches(); }
}
```

The regex is named, configured once, and depended on by every consumer. The knowledge has *one* representation.

---

## 5. The "shape" duplication trap

Two methods can have similar shapes without sharing knowledge:

```java
public Money calculateOrderTax(Order order) {
    BigDecimal rate = countryRates.get(order.country());
    return order.subtotal().multiply(rate);
}
public Money calculateInvoiceTax(Invoice invoice) {
    BigDecimal rate = countryRates.get(invoice.country());
    return invoice.amount().multiply(rate);
}
```

The DRY temptation: extract `calculateTax(Money base, Country country)`. The trap: what if order tax and invoice tax diverge in the domain? (Sales tax has different rules from invoice tax in many jurisdictions.) The extraction merges *coincidence*.

The middle-level discipline: ask *why* the two share a shape.

- *Same domain rule applied to two carriers?* → real duplication. Extract.
- *Two domain rules that happen to compute the same way today?* → coincidence. Leave separate.

The first case is rare; the second is common. Sandi Metz's *Practical Object-Oriented Design in Ruby* names this trade-off explicitly: "duplication is far cheaper than the wrong abstraction".

---

## 6. Refactoring a YAGNI'd plugin system

Legacy code:

```java
public class OrderHandler {
    private final List<OrderHook> preHooks = new ArrayList<>();
    private final List<OrderHook> postHooks = new ArrayList<>();
    private final Map<String, Object> extensionPoints = new HashMap<>();

    public void registerPreHook(OrderHook hook) { preHooks.add(hook); }
    public void registerPostHook(OrderHook hook) { postHooks.add(hook); }
    public void setExtensionPoint(String key, Object value) { extensionPoints.put(key, value); }

    public void handle(Order o) {
        preHooks.forEach(h -> h.fire(o));
        save(o);
        postHooks.forEach(h -> h.fire(o));
    }
}
```

`grep -r 'registerPreHook' src/` returns: one hit, the test for `OrderHandler`. No real consumer registers a hook. The system was built "for extensibility" that no one needed.

The YAGNI refactor:

```java
public final class OrderHandler {
    private final OrderRepository repo;
    public OrderHandler(OrderRepository repo) { this.repo = repo; }
    public void handle(Order o) {
        repo.save(o);
    }
}
```

Three fields, three registration methods, and a hook abstraction — all removed. Tests for the hook mechanism are removed too. The handler shrinks; the test count drops; complexity drops. When a real second hook arrives, you'll add it — informed by what it actually needs.

---

## 7. Spotting fake DRY through inheritance

A common mid-level trap: using inheritance as a DRY mechanism.

```java
abstract class BaseValidator {
    protected void validateNotNull(Object o, String name) {
        if (o == null) throw new IllegalArgumentException(name + " cannot be null");
    }
}

class OrderValidator extends BaseValidator { /* validates order */ }
class CustomerValidator extends BaseValidator { /* validates customer */ }
```

The shared null check is one line. Inheritance has couplied the two validators forever — see [../02-composition-over-inheritance/](../02-composition-over-inheritance/) and [../06-fragile-base-class-problem/](../06-fragile-base-class-problem/). Any change to `validateNotNull` ripples to both.

DRY-through-inheritance fix: compose, or just write the line twice.

```java
public final class OrderValidator {
    public void validate(Order o) {
        Objects.requireNonNull(o.customer(), "customer");
        Objects.requireNonNull(o.subtotal(), "subtotal");
        // ...
    }
}
```

`Objects.requireNonNull` is the *real* DRY: it's the JDK's canonical null check, depended on by everyone, owned by Oracle. You don't need your own `validateNotNull` wrapper.

---

## 8. The "premature interface" YAGNI smell

```java
public interface IClock           { Instant now(); }
public interface IUuidGenerator   { UUID newId(); }
public interface IDateFormatter   { String format(LocalDate d); }
public interface IStringEscaper   { String escape(String s); }
```

Every utility is an interface "for testability". Each has one implementation. Tests rarely mock them. The interface adds a file, an indirection, and a JIT hop.

The YAGNI fix: keep interfaces only at *infrastructure boundaries* (DB, network, time, randomness) where a fake is genuinely useful. For pure-Java utilities, use the concrete class directly:

```java
public final class DateFormatter {
    public String format(LocalDate d) { /* ... */ }
}
```

Tests call `DateFormatter` directly. The class is `final`; CHA inlines aggressively; no interface tax.

When a real second implementation appears — say, a localized formatter for Japanese — *then* introduce the interface, informed by the second case.

---

## 9. The "code generation" speculation

Mid-level codebases often grow code generators that produce duplicated code "to keep things DRY":

```java
@AutoGenerate(template = "CrudHandler")
public class OrderCrudHandler { /* generated */ }

@AutoGenerate(template = "CrudHandler")
public class CustomerCrudHandler { /* generated */ }
```

The template centralizes the *shape* of CRUD handlers. But each entity diverges over time (orders need transactions, customers need GDPR redaction). The template grows conditionals (`if (entity == 'order') ...`), or the divergence forces the team to "stop using the generator" — leaving stale generated code.

The middle-level fix: write each handler explicitly. If 80% of the code is identical today, *that's fine*. Each one will diverge in its own way; explicit code lets each diverge cleanly. The remaining shared bits — say, JDBC boilerplate — extract into a *real* helper (`JdbcTemplate`), not a code generator.

---

## 10. Quick rules

- Rule of Three: don't extract until the third occurrence.
- KISS recipe: write the test, write the simplest passing code.
- YAGNI recipe: imagine removing the feature; if no current test breaks, remove it.
- DRY recipe: name the piece of knowledge; put it in one place.
- Apparent (shape) duplication ≠ meaning duplication.
- Inheritance for code reuse is fake DRY — compose instead.
- Interfaces at infrastructure boundaries; concrete classes for pure-Java utilities.
- Code generators that produce duplicated source files usually fail; explicit code wins.
- `Objects.requireNonNull` is real DRY; your own `notNull(...)` wrapper isn't.
- Wait for evidence (third case, real requirement) before generalizing.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Sandi Metz's "wrong abstraction", Rule of Three in depth    | `senior.md`        |
| Driving the trio in code review                             | `professional.md`  |
| JLS/JEP support that makes the rules cheap                  | `specification.md` |
| Spotting hidden over-engineering                            | `find-bug.md`      |
| Performance trade-offs                                      | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** the mid-level skills are *recipes*. Rule of Three for DRY. "Simplest test-passing code" for KISS. "Remove and see what breaks" for YAGNI. Apparent duplication doesn't justify extraction — wait for meaning duplication, confirmed by three real cases.
