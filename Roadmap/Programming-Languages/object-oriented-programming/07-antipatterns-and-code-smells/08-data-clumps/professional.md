# Data Clumps — Professional

> Audience: senior+ engineers, tech leads, architects shaping a domain model.
> Goal: turn recurring parameter groups into first-class **Value Objects** (VOs) inside a Domain-Driven Design (DDD) tactical model, and enforce that decision through automated detection and architectural tests.

At the professional level, "data clumps" stops being a Fowler-style smell entry and becomes a **modeling failure**. Three primitives traveling together for the third time is the system telling you that a concept in the business domain is missing from the type system. Refactoring is no longer just "extract class" — it is upgrading anemic primitive trios into invariant-protecting, immutable, behavior-bearing VOs.

---

## 1. From Data Clumps to DDD Value Objects

Fowler, *Refactoring* (2nd ed., 2018), chapter 3, defines data clumps as groups of data items that "hang around together" and recommends *Extract Class*, *Introduce Parameter Object*, and *Preserve Whole Object*. DDD (Evans, 2003; Vernon, 2013) sharpens this guidance: a clump that has its own identity is an **Entity**; a clump defined entirely by its attributes is a **Value Object**.

### 1.1 When does a clump become a Value Object?

A parameter group `(amount, currency)` becomes a `Money` VO when **all** of the following hold:

1. The group represents one concept in the ubiquitous language.
2. Equality is structural — two `Money(100, USD)` instances are interchangeable.
3. Invariants exist (e.g., `amount >= 0`, `currency != null`).
4. Behavior naturally attaches (add, subtract, convert, format).
5. The group is immutable from the business perspective (you replace a `Money`, you do not "edit" it).

If even one of those is missing, you may still need a parameter object — but it is not yet a VO.

### 1.2 Canonical examples

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("scale exceeds currency precision");
        }
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("amount must be non-negative");
        }
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money subtract(Money other) {
        requireSameCurrency(other);
        return new Money(amount.subtract(other.amount), currency);
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("currency mismatch");
        }
    }
}
```

```java
public record Address(String street, String city, String postalCode, String country) {
    public Address {
        Objects.requireNonNull(street);
        Objects.requireNonNull(city);
        Objects.requireNonNull(postalCode);
        Objects.requireNonNull(country);
        if (!country.matches("[A-Z]{2}")) {
            throw new IllegalArgumentException("country must be ISO-3166 alpha-2");
        }
    }
}
```

```java
public record DateRange(LocalDate start, LocalDate end) {
    public DateRange {
        Objects.requireNonNull(start);
        Objects.requireNonNull(end);
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end before start");
        }
    }

    public boolean contains(LocalDate day) {
        return !day.isBefore(start) && !day.isAfter(end);
    }

    public boolean overlaps(DateRange other) {
        return !end.isBefore(other.start) && !start.isAfter(other.end);
    }

    public long days() {
        return ChronoUnit.DAYS.between(start, end) + 1;
    }
}
```

These three VOs — `Money`, `Address`, `DateRange` — are the "starter pack" you will introduce in 80% of business systems. Each one collapses 2–4 recurring primitive parameters into a single, validated, behavior-rich type.

---

## 2. Automated Detection

By the time clumps reach production code, manual review has already failed. Senior engineers ship detection.

### 2.1 IntelliJ Structural Search and Replace (SSR)

IntelliJ ships a powerful structural search engine. A template like the one below flags any method that takes `BigDecimal` + `String` together — a classic untyped Money clump:

```
Search template:
$Method$($BeforeParams$, BigDecimal $amount$, String $currency$, $AfterParams$)

Filter:
$Method$ — count 1+
```

Save the template under *Settings > Editor > Inspections > Structural Search*. Set severity to **Warning**. Every PR now lights up untyped money clumps in the IDE.

### 2.2 Custom AST rule (Spoon / JavaParser)

For CI enforcement, parse the source tree and walk method declarations:

```java
import spoon.Launcher;
import spoon.reflect.declaration.CtMethod;
import spoon.reflect.declaration.CtParameter;

public final class DataClumpScanner {

    private static final Set<String> CLUMP = Set.of("BigDecimal", "String", "Currency");

    public static void main(String[] args) {
        Launcher launcher = new Launcher();
        launcher.addInputResource("src/main/java");
        launcher.buildModel();

        launcher.getModel().getElements(CtMethod.class::isInstance).forEach(el -> {
            CtMethod<?> method = (CtMethod<?>) el;
            long matches = method.getParameters().stream()
                .map(CtParameter::getType)
                .map(t -> t.getSimpleName())
                .filter(CLUMP::contains)
                .count();
            if (matches >= 3) {
                System.out.printf("CLUMP at %s%n", method.getPosition());
            }
        });
    }
}
```

Wire this into a Gradle `check` task. A clump threshold of 3+ co-occurring primitive types across 3+ methods is the actionable signal.

### 2.3 ArchUnit rules

ArchUnit lets you fail the build when domain types accept clumpy signatures:

```java
@ArchTest
static final ArchRule money_must_be_value_object =
    methods()
        .that().areDeclaredInClassesThat().resideInAPackage("..domain..")
        .should(new ArchCondition<JavaMethod>("not accept (BigDecimal, Currency) as separate params") {
            @Override
            public void check(JavaMethod m, ConditionEvents events) {
                List<String> types = m.getRawParameterTypes().stream()
                    .map(JavaClass::getSimpleName).toList();
                if (types.contains("BigDecimal") && types.contains("Currency")) {
                    events.add(SimpleConditionEvent.violated(m,
                        m.getFullName() + " has Money clump — use Money VO"));
                }
            }
        });

@ArchTest
static final ArchRule date_range_clump_forbidden =
    noMethods()
        .that().areDeclaredInClassesThat().resideInAPackage("..domain..")
        .should().haveRawParameterTypes(LocalDate.class, LocalDate.class);
```

The second rule is intentionally strict: any `(LocalDate, LocalDate)` pair in the domain layer is suspect. False positives are rare and easily silenced with `@SuppressArchRule` on legitimate cases (audit trails with distinct timestamps).

---

## 3. Quick Rules

- **Three is the threshold.** Three primitives co-traveling through three call sites = extract a VO. Not two. Not four. Three.
- **Records first, classes second.** Use `record` (JEP 395) unless you need inheritance, mutable internals, or non-trivial equality. Records eliminate boilerplate and signal intent.
- **Validate in the compact constructor.** Every VO must reject invalid state at construction; never expose mutators.
- **No setters.** Ever. A VO with a setter is a degraded entity.
- **Equality by value, not identity.** Records give you this for free; for classes, override `equals` and `hashCode` together.
- **Bind one VO per ubiquitous-language term.** If you find yourself making `MoneyInternal` and `MoneyApi`, the language is fragmented — fix the model first.
- **Detect in CI, not in review.** Humans miss clumps; ArchUnit and Spoon do not.
- **Push VOs to module boundaries.** Public APIs, REST DTOs, and persistence mappers should accept VOs, not primitive trios.

---

## 4. Persistence Integration

VOs interact uneasily with ORMs. Three production-tested patterns:

1. **`@Embeddable` for JPA** — annotate the record-equivalent class as embeddable; the entity owns columns flattened from the VO. Works for `Money`, `Address`, `DateRange`.
2. **AttributeConverter** — for single-column VOs (e.g., `EmailAddress` stored as `varchar`). One line per converter, registered globally.
3. **JSON columns (Postgres jsonb)** — when the VO is a complex aggregate read mostly as a whole, store it as JSON via Hibernate Types or JdbcTypeCode. Trades query flexibility for schema simplicity.

Records as `@Embeddable` work in Hibernate 6.2+ with the right `@Embeddable` annotation on the record itself. Earlier versions require a thin embeddable class delegating to a record.

---

## 5. What's next

- `../07-primitive-obsession/` — primitive obsession is the sibling smell; a clump is "obsession with shape", obsession is "obsession with type".
- `../../06-anemic-domain-model/` — VOs are the bricks; anemic-domain-model is the wall they belong in.
- `../../08-immutability/` (when written) — VOs are the canonical immutable type; share patterns.

---

## Memorize this

> Three primitives traveling together for the third time is a missing concept in the type system. Extract a Value Object — immutable, validated, behavior-bearing — preferably as a `record`. Detect clumps in CI with ArchUnit or Spoon; do not rely on code review. A VO without invariants is just a tuple, and a tuple in a domain model is still a clump in disguise.
