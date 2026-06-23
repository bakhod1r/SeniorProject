# Data Clumps — Senior

> **What?** At the senior level, you stop treating "extract a record" as the entire answer and start thinking about what the *right* container actually is — a record? a class with identity? a sealed hierarchy of value variants? A clump can be cured trivially or it can hide a missing domain concept that takes a whole afternoon to model correctly. You also start using IntelliJ's *Extract Parameter Object* tooling as a force multiplier and recognising the limits of records (no inheritance, no extra state, JEP-395 constraints).
> **How?** When you see a clump, ask three questions before reaching for the IDE keystroke: (1) Is this a *value* (compared by contents) or an *entity* (with identity)? (2) Are there *invariants* that should be enforced on construction? (3) Are there *behaviours* (validation, formatting, arithmetic, comparison) that currently live in scattered utility classes and should live with the data?

---

## 1. Records as Data-Clump Cure — and Their Limits

Java 16 standardised records via [JEP 395](https://openjdk.org/jeps/395). For the *typical* clump — four primitives that always travel together and have no behaviour beyond construction and equality — a record is a one-line cure:

```java
public record Money(BigDecimal amount, Currency currency) {}
```

This gives you final fields, accessors, value-based `equals`/`hashCode`, a canonical `toString`, and a *compact constructor* slot to validate. JEP 395 makes records:

- **Implicitly final.** No subclassing — a deliberate decision to keep them value-like.
- **Restricted in state.** All instance fields must be declared in the header; you cannot sneak mutable state in via instance variables.
- **Free to add methods.** Static factories, helper methods, derived accessors are all fine.
- **Free to implement interfaces.** A record can implement `Comparable`, `Serializable`, custom marker interfaces, sealed hierarchies.

What records *cannot* do that occasionally matters:

- Extend another class (they implicitly extend `java.lang.Record`).
- Have non-header instance fields (only static fields are allowed outside the header).
- Be mutated after construction.

These limits are usually *welcome* — clumps almost always want immutability — but they mean some clumps still need a regular final class. Rule of thumb: reach for a record first; downgrade to a final class only when a real requirement demands it.

---

## 2. Records carry behaviour. Use that.

The common junior mistake is treating a record as a "DTO with extras". A senior treats it as a class that *happens* to have a concise syntax. Put the behaviour where the data lives:

```java
public record DateRange(LocalDate start, LocalDate end) implements Comparable<DateRange> {

    public DateRange {
        Objects.requireNonNull(start);
        Objects.requireNonNull(end);
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end before start");
        }
    }

    public boolean contains(LocalDate d) {
        return !d.isBefore(start) && !d.isAfter(end);
    }

    public boolean overlaps(DateRange other) {
        return !end.isBefore(other.start) && !start.isAfter(other.end);
    }

    public Duration length() { return Duration.between(start.atStartOfDay(), end.atStartOfDay()); }

    public DateRange extendBy(Period p) { return new DateRange(start, end.plus(p)); }

    @Override
    public int compareTo(DateRange other) { return start.compareTo(other.start); }
}
```

That's no longer a clump cure; it's a real domain type. Callers who used to pass `(start, end)` quartets *and* re-implement `overlaps` in three places now use one method on one type.

---

## 3. Compact constructor — your validation funnel

Every value-style clump benefits from a **single point of validation**:

```java
public record Email(String value) {
    private static final Pattern PATTERN = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    public Email {
        Objects.requireNonNull(value);
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid email: " + value);
        }
    }
}
```

Once `Email` exists, every method that *used to* accept `String email` accepts `Email`. There is now no way to construct an `Email` without it being valid — the validation cannot be skipped or duplicated. That's the senior-level payoff: *correctness by construction*.

Compare to the junior version that left primitives loose:

```java
public void register(String email, String password) {
    if (!email.contains("@")) throw new IllegalArgumentException();  // re-implemented per caller
    if (!password.matches("[A-Za-z0-9]{8,}")) throw new IllegalArgumentException();
    // ...
}
```

Three callers, three slightly different regexes, three subtly different bugs. The clump → value-object move *eliminates an entire class of defect*.

---

## 4. IntelliJ's "Extract Parameter Object" — automated grunt work

In IntelliJ:

1. Place the caret inside a method declaration whose parameters you want to extract.
2. **Refactor → Extract Parameter Object** (or `Cmd+Alt+P` on macOS / `Ctrl+Alt+P` on Linux/Windows, then choose "Method parameters…").
3. Choose name (e.g. `Address`), package, and whether to generate a class or record. Modern IntelliJ offers "Create Java Record".
4. Confirm. IntelliJ rewrites the method *and every caller*.

It also runs a usage search and offers to migrate identical clumps elsewhere. For a four-parameter clump used in forty places, this is the difference between a one-minute refactor and a one-day refactor.

Workflow tip: extract once, run tests, commit. Then look at the new type and decide what *behaviour* to move onto it. That's a separate commit. Mixing extraction and behaviour-moving in one PR makes review painful.

---

## 5. Value Objects — the DDD framing

A *Value Object* in Domain-Driven Design (Eric Evans, *Domain-Driven Design*, 2003) is:

- **Compared by value.** Two `Money(10, USD)` instances are equal even if they're different references.
- **Immutable.** Once constructed, never changes.
- **Side-effect-free.** Methods return new values rather than mutating.
- **Self-validating.** Invariants are enforced by the constructor.
- **A whole concept, not a fragment.** `Money` is one thing, not "an amount and a currency".

The cure for a data clump is, *almost always*, a Value Object. Records are Java's natural syntax for VOs. The vocabulary matters at the senior level: when reviewing code, calling a record a "Value Object" signals that you expect it to behave according to the DDD contract — including replacing every primitive that represents that concept across the entire codebase.

```java
// Anti-clump VOs in a typical domain:
public record Money(BigDecimal amount, Currency currency)         { ... }
public record Address(String street, String city, String state, String zip) { ... }
public record EmailAddress(String value)                          { ... }
public record PhoneNumber(String e164)                            { ... }
public record DateRange(LocalDate start, LocalDate end)           { ... }
public record Coordinates(double latitude, double longitude)      { ... }
public record Quantity(BigDecimal value, Unit unit)               { ... }
public record OrderId(UUID value)                                 { ... }
```

Each one is two-to-four fields, a compact constructor, a few behavioural methods. Each one would otherwise be a clump.

---

## 6. Sealed value hierarchies — when a clump has variants

Some clumps come in shapes. `Payment(amount, currency, kind, cardLast4, bankRouting, cryptoWallet)` is a clump that fakes polymorphism with nullable fields. The senior move is a sealed value hierarchy:

```java
public sealed interface PaymentInstrument permits Card, BankTransfer, Crypto {
    Money amount();
}

public record Card(Money amount, String last4)             implements PaymentInstrument {}
public record BankTransfer(Money amount, String routing)   implements PaymentInstrument {}
public record Crypto(Money amount, String wallet)          implements PaymentInstrument {}
```

A switch over `PaymentInstrument` is exhaustive at compile time. There are no more "card payment with a non-null bank routing number" bugs.

This pattern shows up whenever a clump has *conditionally present* fields. Sealed interface + records is the modern Java idiom.

---

## 7. When a clump should *not* become a record

Three honest exceptions:

**Exception 1: the clump represents an entity, not a value.**

```java
public record Customer(UUID id, String name, ...) {}
```

If two `Customer` records with the same field values should still be considered *different customers* (because identity is part of the meaning), then value-equality on the record is *wrong*. Use a regular class with identity-based equality.

**Exception 2: the fields are not truly immutable.**

```java
public record Cart(UUID id, List<LineItem> items) {}
```

The list is *referentially* final but its contents change. Either copy on construction and expose an unmodifiable view, or use a class. Half-immutable records lie.

**Exception 3: the clump needs inheritance.**

Records can't extend other classes. If you have `Shape` → `Circle`, `Rectangle` with shared behaviour, records can implement a sealed interface but not extend a base class. Use the sealed-interface pattern above, or a regular class hierarchy if interfaces aren't expressive enough.

---

## 8. Migrating a legacy codebase — strategy

For a multi-million-line legacy codebase:

1. **Inventory.** Run grep + IntelliJ inspections, list the top 20 clumps by repetition count.
2. **Triage.** Mark each: pure-value (record), value with variants (sealed + records), entity (class), or "doesn't deserve extraction".
3. **Prioritise by churn.** A clump that's edited every sprint pays back the refactor faster than a frozen one.
4. **Build bridging factories.** `Address.of(String, String, String, String)` plus `unpack()` lets new and old code coexist.
5. **Migrate inside-out.** Domain core → service → controller → DTOs. Each layer becomes a small PR.
6. **Delete old primitives.** When nothing uses them, the old overloads go in a cleanup PR.
7. **Lock it in.** Add an ArchUnit or custom checker rule that forbids `String email` parameters where `Email` exists.

Don't refactor every clump at once. Pick the painful ones, fix them, learn what made them painful, then move on.

---

## 9. Architectural lock-in: ArchUnit rules

A simple ArchUnit guard prevents the clump from coming back:

```java
@ArchTest
static final ArchRule no_loose_money_primitives =
    methods()
        .that().areDeclaredInClassesThat().resideInAPackage("..domain..")
        .should().notHaveRawParameterTypes(BigDecimal.class)
        .because("use Money instead of raw BigDecimal in domain");
```

A code-review rule says "use `Money`"; an ArchUnit rule *enforces* it. Once the value type exists, the guard pays for itself.

---

## 10. Quick rules

- [ ] Records first. Class only when you need identity, mutability, or inheritance.
- [ ] Put validation in the compact constructor. Make invalid construction impossible.
- [ ] Move behaviour (validation, comparison, formatting, arithmetic) onto the new type.
- [ ] Use sealed interface + records when a clump has variants with conditional fields.
- [ ] IntelliJ's *Extract Parameter Object* handles the mechanical part — use it.
- [ ] Migrate inside-out; lock in with ArchUnit so the clump doesn't return.

---

## 11. Pitfalls that bite seniors specifically

**Pitfall 1 — leaky records.** Exposing a mutable `List<T>` field from a record makes the "immutable value" claim a lie. Use `List.copyOf` in the compact constructor and an unmodifiable accessor.

**Pitfall 2 — equals semantics on entity-shaped records.** A `Customer` record's value-based `equals` will compare names — so two customers with the same name are "equal". This breaks `Set<Customer>` semantics. Don't use a record for an entity.

**Pitfall 3 — serialisation surprises.** Records serialise via canonical accessors. Older Jackson versions need `jackson-module-parameter-names` and a recent version (>=2.12) to deserialise records without `@JsonCreator`. Jackson 2.12+ handles them natively.

**Pitfall 4 — JPA before Hibernate 6.2.** Older JPA implementations don't support records as `@Entity` (entities need a no-arg constructor and mutable fields). `@Embeddable` records work from Hibernate 6.2. For older stacks, the value object is a regular final class.

**Pitfall 5 — clump replaced with an empty husk.** Extracting `Address(String, String, String, String)` and leaving validation, formatting, and comparison scattered across utility classes only solves half the problem. The new type must absorb the behaviour, or you've just moved the smell.

---

## 12. What's next

- `professional.md` — DDD VOs, custom AST detection, codebase-wide policy enforcement.
- `find-bug.md` — buggy clumps with diagnosis.
- `optimize.md` — record allocation cost, escape analysis, scalar replacement, JIT considerations.
- `interview.md` — Q&A.

Related: [primitive-obsession](../09-primitive-obsession/) is the *type-level* version of the same smell — Data Clumps say "these belong together"; Primitive Obsession says "this single primitive should be a real type". They co-occur in practice.

---

**Memorize this:** A Data Clump is a missing Value Object. Records are Java's syntax for VOs (JEP 395). Validate in the compact constructor, move behaviour onto the type, and use sealed records when the clump has variants. Records carry their data and their rules together — leaving rules behind in scattered utilities is half a refactor.
