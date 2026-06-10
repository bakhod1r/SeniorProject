# Value Objects — Senior

> **What?** At the Senior level a Value Object is not "an immutable record" — it is a precisely specified domain concept that satisfies four formal properties: **totality of operations**, **side-effect-free functions**, **conceptual whole**, and **attribute-based equality**. You design VOs deliberately: you pick a representation that survives arithmetic and storage round-trips, you bundle attributes that have no meaning apart, and you write methods that return new values rather than mutating state. You also know the traps — `BigDecimal` scale, currency assumptions, time-zone leakage, `Float`/`Double` in money, hash collisions on dense fields — that look like VOs but corrupt your domain.
> **How?** When designing a new VO, walk through the four properties as a checklist. Then stress-test the representation: round-trip it through JSON, through JPA, through a `HashMap` key, and through arithmetic. If two semantically equal values diverge anywhere — different scale, different precision, different equality — your representation is broken and you must fix it *before* the VO ships.

---

## 1. The four formal properties of a Value Object

Vaughn Vernon, drawing on Evans's chapter 5, lists these in *Implementing Domain-Driven Design* (2013, ch. 6) as the design checklist for any candidate VO:

### Totality of operations

Every operation on a VO must produce a *valid* VO, for *every* input the type allows. There are no "half-states" you can produce by misusing the API. If `Money.minus` could theoretically produce a negative `Money` but your `Money` forbids negatives, then `minus` is *partial* — it works for some inputs and throws for others. That's a smell. Either widen the type (allow signed amounts) or rename (`subtractCapped`) so the partiality is honest.

### Side-effect-free functions

A method on a VO must depend only on its parameters and `this`, must mutate nothing, and must produce only a return value. No logging, no clock reads, no I/O, no field assignments. This makes VOs trivially testable, trivially cacheable, and safe under concurrency.

### Conceptual whole

The components of a VO must travel together in the domain. `Money(amount, currency)` is a whole — neither makes sense alone. `Address(street, city, postalCode, country)` is a whole. A `record` with components that callers routinely pick apart (e.g., `Person(firstName, lastName, age)` where age is treated as separate metadata) is not a conceptual whole and should be split.

### Attribute-based equality

Two VOs with the same attribute values must compare equal, hash equal, and be substitutable in any context. This is the property that distinguishes a VO from an Entity. The Java `record` gives you this by default; in a hand-rolled `final class` you must override `equals` and `hashCode` together, using *all* components.

---

## 2. The Money trap — three ways it breaks

Money looks like the textbook VO, and it is — but only when you respect three subtleties.

### Trap A — `BigDecimal` scale leaks into equality

`BigDecimal.equals` distinguishes `1.00` from `1.0` because they have different *scales*. So this happens:

```java
var a = new BigDecimal("1.0");
var b = new BigDecimal("1.00");
a.equals(b);   // false
a.compareTo(b); // 0
```

If your `Money` stores a `BigDecimal` amount and you inherit `record`-generated `equals`, two semantically identical sums will hash to different buckets. The fix is one of:

- Store cents as `long` (preferred for currencies with 2 decimals).
- Normalize the `BigDecimal` to a canonical scale in the compact constructor.
- Override `equals` to use `compareTo`.

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        java.util.Objects.requireNonNull(amount);
        java.util.Objects.requireNonNull(currency);
        amount = amount.setScale(currency.getDefaultFractionDigits(),
                                 java.math.RoundingMode.UNNECESSARY);
    }
}
```

The compact constructor *normalizes* every input to the currency's natural scale. Now `new Money(new BigDecimal("1"), USD)` and `new Money(new BigDecimal("1.00"), USD)` produce equal instances.

### Trap B — currency comparison without conversion

`USD.plus(EUR)` is nonsense, not an arithmetic problem. Reject it at the method:

```java
public Money plus(Money other) {
    if (!currency.equals(other.currency))
        throw new IllegalArgumentException(
            "Cannot add " + currency + " to " + other.currency);
    return new Money(amount.add(other.amount), currency);
}
```

Never silently convert. Conversion is a *separate operation* that requires a rate, a date, and (often) a rounding policy. It belongs in a `CurrencyConverter` service that consumes two Money VOs and an exchange rate.

### Trap C — `double` or `float` anywhere near money

`0.1 + 0.2 != 0.3` in IEEE-754. There is no acceptable workaround. Money never lives in a `double`. Use `long` cents or `BigDecimal`.

---

## 3. DateRange — overlapping intervals as a VO

```java
public record DateRange(java.time.LocalDate startInclusive, java.time.LocalDate endExclusive) {
    public DateRange {
        java.util.Objects.requireNonNull(startInclusive);
        java.util.Objects.requireNonNull(endExclusive);
        if (!endExclusive.isAfter(startInclusive))
            throw new IllegalArgumentException("end must be after start: " + startInclusive + ".." + endExclusive);
    }

    public boolean contains(java.time.LocalDate d) {
        return !d.isBefore(startInclusive) && d.isBefore(endExclusive);
    }

    public boolean overlaps(DateRange other) {
        return startInclusive.isBefore(other.endExclusive)
            && other.startInclusive.isBefore(endExclusive);
    }

    public long days() {
        return java.time.temporal.ChronoUnit.DAYS.between(startInclusive, endExclusive);
    }
}
```

Design notes:

- **Half-open `[start, end)`**: avoids "is the end day included?" ambiguity, makes `days()` arithmetic clean, makes `overlaps` symmetric.
- **`LocalDate` not `Instant`**: a date range is a calendar concept; do not drag time zones in.
- **`overlaps` is total**: it produces a boolean for any two `DateRange` inputs, never throws.
- **No `contains(DateRange)` shortcut** unless your domain needs it — keep the API the size of the real use case.

### Trap — `Instant` ranges leak time zones

If you genuinely need a moment-in-time range, use `Instant` (UTC) and accept that *displaying* it requires a zone. Don't store `LocalDateTime` in a VO — it's a half-formed concept that hides whether it's UTC, server-local, or user-local.

---

## 4. Quantity — units in the type system

```java
public record Quantity(int count, Unit unit) {
    public Quantity {
        if (count < 0) throw new IllegalArgumentException("count<0");
        java.util.Objects.requireNonNull(unit);
    }

    public Quantity plus(Quantity other) {
        if (unit != other.unit) throw new IllegalArgumentException("unit mismatch");
        return new Quantity(count + other.count, unit);
    }

    public Quantity scale(int factor) {
        if (factor < 0) throw new IllegalArgumentException("factor<0");
        return new Quantity(count * factor, unit);
    }
}
```

Same shape as Money. Same trap (unit mismatch). Same fix (reject, don't convert silently).

---

## 5. Conversion methods return new VOs — always

The first instinct of a Java programmer coming from Java Beans is to write `setAmount(...)`. **A VO has no setters.** Every operation that "modifies" the value returns a new instance:

```java
Money discounted = price.minus(discount);
DateRange shifted = range.shiftBy(java.time.Period.ofDays(7));
Email anonymized  = email.maskedForLog();
```

This is the *withers* style — the operation reads as "give me a value derived from this one". Records pair beautifully with helper methods of this shape, and JEP 468 (record patterns and deconstruction) makes "modify one component" ergonomic in modern Java.

A pattern that captures the wither shape:

```java
public record Address(String street, String city, String postalCode, String country) {
    public Address withStreet(String s)     { return new Address(s, city, postalCode, country); }
    public Address withCity(String c)       { return new Address(street, c, postalCode, country); }
    public Address withPostalCode(String p) { return new Address(street, city, p, country); }
    public Address withCountry(String co)   { return new Address(street, city, postalCode, co); }
}
```

Withers preserve immutability while letting callers express "this address but with a new street" without rebuilding the whole record by hand.

---

## 6. Quick rules

- Make every VO `record` first; fall back to `final class` only when records can't model your invariants.
- Validate and normalize in the compact constructor; nowhere else.
- Forbid `null` components explicitly with `Objects.requireNonNull`.
- Reject cross-unit / cross-currency operations; never silently convert.
- Never use `double`/`float` for money; use `long` cents or `BigDecimal` with a fixed scale.
- All operations return a new VO; nothing mutates `this`.
- Methods are total or honestly named (`subtractCapped`, `parseOrNull`) when partial.
- Two VOs with equal attributes must `equals` *and* hash equal. Verify both in tests.
- VOs are interchangeable across threads with no synchronization. If you ever consider locking one, you've designed it wrong.
- Treat `toString` as developer-facing only; never parse it back.

---

## 7. What's next

| Topic | Where | Why it follows |
|---|---|---|
| Entities | `02-entities/` in this tactical-ddd chapter | The other half of the identity/value dichotomy. |
| Aggregates | `03-aggregates/` | VOs are the building blocks aggregates compose. |
| Primitive Obsession smell | `Refactoring/code-smells/primitive-obsession/` | The smell VOs cure. |
| Immutability patterns | `02-object-oriented-programming/.../immutability/` | The mechanical foundation under VOs. |
| Records & sealed types | `Programming-Languages/languages/java/.../records/` | The Java carrier of choice for VOs. |

---

## Memorize this

- A VO satisfies four properties: **totality**, **side-effect-free functions**, **conceptual whole**, **attribute-based equality**.
- Money trap: `BigDecimal` scale leaks into `equals`. Normalize to a canonical scale, or store `long` cents.
- Reject cross-currency, cross-unit, cross-zone operations explicitly; never silently convert.
- Use `LocalDate` for calendar dates, `Instant` (UTC) for moments — never `LocalDateTime` in a VO.
- DateRange = `[start, end)`. Half-open intervals make `overlaps` and `days()` clean.
- Conversion methods (`plus`, `minus`, `withStreet`) return new VOs; never mutate.
- A VO with a setter is not a VO. A VO with `double` for money is not a VO. A VO whose two equal instances hash differently is broken.
- `record` first; `final class` only when records cannot express your invariants.
- Reference: Evans ch. 5; Vernon ch. 6; JEP 395 (records); JEP 409 (sealed); JEP 468 (record patterns).
