# Value Objects — Specification

This document defines a Value Object **formally**. If a candidate class fails any invariant below, it is not a Value Object and code reviews must reject it.

---

## 1. The five formal invariants

A class `V` is a Value Object if and only if it satisfies all of the following invariants. The wording follows Eric Evans, *Domain-Driven Design* (2003, ch. 5) and Vaughn Vernon, *Implementing Domain-Driven Design* (2013, ch. 6).

### Invariant 1 — Immutability

For every instance `v` of `V` and every accessible field `f`:

- `f` is declared `final` (or `V` is a record, which makes its components `final` by the JLS).
- No method of `V` assigns to any field after construction.
- No referenced object held by `v` is mutated by any method of `V`.

If `V` holds a reference to a mutable type (`Date`, `List<T>`, `byte[]`), `V` must defensively copy on construction *and* on read, or wrap it in an unmodifiable view. The reference is final; the referent must be unobservably stable.

### Invariant 2 — Equality by value

For every two instances `a`, `b` of `V` whose corresponding attribute values are equal under the natural equality of each attribute's type:

- `a.equals(b) == true`
- `a.hashCode() == b.hashCode()`
- `a` and `b` are mutually substitutable in any method that accepts a `V`.

`equals` must be reflexive, symmetric, transitive, consistent, and `a.equals(null) == false`. `hashCode` must be consistent with `equals` for the lifetime of the JVM (the JLS `Object.hashCode` contract). Records satisfy both clauses automatically based on all canonical components.

### Invariant 3 — No identity

`V` defines no field that exists solely to disambiguate two otherwise-equal instances. Specifically:

- No `id`, `uuid`, `key`, `surrogateKey` field.
- No JPA `@Id` or `@GeneratedValue` annotation.
- No reliance on `System.identityHashCode` or reference equality (`==`).
- `V`'s `equals` does not consult any field that is not part of its attribute set.

A "transient" or "derived" field is permissible only if it is a deterministic function of the attribute set *and* is excluded from `equals`/`hashCode`.

### Invariant 4 — Side-effect-free behaviour

For every public method `m` of `V`:

- `m` does not modify the state of `this` or of any reachable object.
- `m` does not perform I/O (no disk, network, console, clock read, random read).
- `m` does not throw on inputs that the type system claims to accept (totality of operations).
- `m`'s return value depends only on `this` and the explicit parameters.

A method that *appears* to modify `this` (`v.plus(other)`) returns a new instance of `V` with the derived attribute values.

### Invariant 5 — Conceptual whole

The attribute set of `V` forms a single domain concept that travels together:

- Removing any attribute would change the meaning of `V`.
- Splitting `V` into smaller VOs would lose a domain invariant that ties the attributes.
- Callers do not routinely consume one attribute in isolation.

`Money(amount, currency)` is a whole: `amount` without `currency` is meaningless. `PersonName(first, last)` is a whole: `last` without `first` is half a name. `Person(name, age)` is *not* a whole: callers consume age and name independently — it should be `Entity` with `Name` (VO) and an `age` derived from a birth-date VO.

---

## 2. Validation strategy

Two enforcement points, used together:

### A — Compact constructor

For records (JEP 395), validation lives in the compact constructor:

```java
public record Money(long cents, String currency) {
    public Money {
        if (cents < 0)
            throw new IllegalArgumentException("Money.cents must be >= 0");
        if (currency == null || currency.length() != 3)
            throw new IllegalArgumentException("Money.currency must be ISO-4217: " + currency);
        currency = currency.toUpperCase(java.util.Locale.ROOT);
    }
}
```

Contract:

- Throws `IllegalArgumentException` (unchecked) on any invalid input.
- Normalizes inputs (trim, lowercase, intern, scale-set) *before* assignment.
- Runs unconditionally for every construction path, including reflection-based deserialization frameworks that respect canonical constructors.

### B — Factory method

When construction has multiple valid input shapes (parse a string vs. supply components) or when a Result/Optional API is preferred over exceptions, expose static factories:

```java
public record Email(String value) {
    public Email { /* throws on invalid */ }

    public static Email of(String raw)               { return new Email(raw); }
    public static java.util.Optional<Email> tryOf(String raw) {
        try { return java.util.Optional.of(new Email(raw)); }
        catch (IllegalArgumentException e) { return java.util.Optional.empty(); }
    }
}
```

The constructor remains the single point of validation; factories are thin wrappers that select an error-handling style.

### Forbidden patterns

- **No `init()` method** that callers must remember to invoke. A VO is valid the instant the constructor returns or it ceases to exist.
- **No `valid` boolean field** on a partially-constructed VO. There is no half-valid VO.
- **No setter that calls validate** at the end. Setters are forbidden outright.
- **No reflective field assignment** by mappers, deserializers, or ORMs that bypasses the constructor. Configure each tool to use constructor-based instantiation.

---

## 3. Sample ArchUnit rules

These rules, run in CI, enforce invariants 1, 3, and (structurally) 4 at the package level. Place them in a dedicated `ArchitectureTest` class.

```java
import com.tngtech.archunit.core.domain.JavaModifier;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.*;

@AnalyzeClasses(packages = "com.acme")
class ValueObjectSpecification {

    @ArchTest
    static final ArchRule classes_are_final =
        classes().that().resideInAPackage("..domain.value..")
                 .should().haveModifier(JavaModifier.FINAL);

    @ArchTest
    static final ArchRule fields_are_final =
        fields().that().areDeclaredInClassesThat().resideInAPackage("..domain.value..")
                .should().beFinal();

    @ArchTest
    static final ArchRule no_setters =
        noMethods().that().areDeclaredInClassesThat().resideInAPackage("..domain.value..")
                   .should().haveNameMatching("set[A-Z].*");

    @ArchTest
    static final ArchRule no_id_field =
        noFields().that().areDeclaredInClassesThat().resideInAPackage("..domain.value..")
                  .should().haveName("id");

    @ArchTest
    static final ArchRule no_jpa_id_annotation =
        noFields().that().areDeclaredInClassesThat().resideInAPackage("..domain.value..")
                  .should().beAnnotatedWith(jakarta.persistence.Id.class);

    @ArchTest
    static final ArchRule no_logger_in_vo =
        noFields().that().areDeclaredInClassesThat().resideInAPackage("..domain.value..")
                  .should().haveRawType("org.slf4j.Logger");

    @ArchTest
    static final ArchRule no_inheritance_from_VO =
        classes().that().resideInAPackage("..domain.value..")
                 .and().areNotInterfaces()
                 .should().haveModifier(JavaModifier.FINAL);
}
```

Rules to add as your codebase grows:

- Forbid `@Setter` (Lombok) anywhere in the VO package.
- Forbid `@Data` (Lombok) — it includes setters.
- Forbid implementation of `java.io.Externalizable` or custom `writeObject`/`readObject` that bypass the constructor.
- Forbid public mutable static fields in VOs.
- Require every VO class name to be a noun (regex `^[A-Z][a-zA-Z]+$`, not ending in `Service`, `Manager`, `Helper`, `Util`).

---

## 4. Conformance test template

For every VO `V`, the project must include a conformance test that exercises invariants 1, 2, 3, and 4:

```java
class MoneyConformanceTest {

    @Test void equality_is_attribute_based() {
        assertThat(new Money(100, "USD")).isEqualTo(new Money(100, "USD"));
        assertThat(new Money(100, "USD")).isNotEqualTo(new Money(100, "EUR"));
        assertThat(new Money(100, "USD")).isNotEqualTo(new Money(101, "USD"));
    }

    @Test void hashCode_matches_equals() {
        assertThat(new Money(100, "USD").hashCode())
            .isEqualTo(new Money(100, "USD").hashCode());
    }

    @Test void rejects_invalid_input() {
        assertThatThrownBy(() -> new Money(-1, "USD")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Money(1, "US")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Money(1, null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void operations_return_new_instances() {
        var a = new Money(100, "USD");
        var b = a.plus(new Money(50, "USD"));
        assertThat(a.cents()).isEqualTo(100);  // unchanged
        assertThat(b.cents()).isEqualTo(150);
        assertThat(a).isNotSameAs(b);
    }

    @Test void cross_currency_is_rejected() {
        assertThatThrownBy(() -> new Money(1, "USD").plus(new Money(1, "EUR")))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
```

This template, replicated for each VO, gives a structural guarantee that the invariants survive refactors.

---

## Memorize this

- A VO satisfies five invariants: **immutable**, **equality-by-value**, **no identity**, **side-effect-free**, **conceptual whole**. Drop one and you've built something else.
- Validation lives in the **compact constructor**. Nowhere else. No `init`, no `validate()`, no half-valid state.
- ArchUnit rules — *no setters*, *all fields final*, *no `id` field*, *no `@Id`*, *classes final* — convert the spec from a code-review opinion into a build failure.
- Every VO ships with a **conformance test** that asserts equality, hash-equality, rejection of invalid input, and immutability under operations.
- A VO with an id is an Entity. A VO with a setter is a JavaBean. A VO with a side effect is a service. None of those belong in the VO package.
- Reference: Evans ch. 5; Vernon ch. 6; JLS §11 (`Object.equals` / `hashCode` contracts); JEP 395 (records).
