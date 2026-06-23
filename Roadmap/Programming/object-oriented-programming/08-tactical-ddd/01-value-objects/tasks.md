# Value Objects — Tasks

Eight exercises arranged from concrete and small to refactor-heavy and integration-level. Complete them in order; each builds on the previous. Every task lists an **Objective**, **Constraints**, and **Acceptance criteria**, then a validation table summarises what to check.

---

## Task 1 — `Money` record with currency

**Objective.** Implement `Money` as a record carrying a `long cents` amount and an ISO-4217 `String currency`. Provide `plus`, `minus`, `times(int factor)`, and `isZero`.

**Constraints.**
- Reject negative `cents` in the constructor.
- Reject non-3-letter currency; normalize to uppercase.
- `plus` and `minus` reject cross-currency operations.
- All operations return new `Money` instances.

**Acceptance.**
- `new Money(100, "usd").currency().equals("USD")`.
- `new Money(100, "USD").plus(new Money(50, "USD")).equals(new Money(150, "USD"))`.
- `new Money(100, "USD").plus(new Money(1, "EUR"))` throws `IllegalArgumentException`.
- `new Money(-1, "USD")` throws.

---

## Task 2 — `Email` with validation and normalization

**Objective.** Build an `Email` record that validates against a regex and lowercases the input.

**Constraints.**
- Use a `Pattern` constant.
- Reject `null`, empty, missing `@`, or whitespace-containing strings.
- Lowercase the stored value.
- Provide a `domain()` accessor that returns the substring after `@`.

**Acceptance.**
- `new Email("Foo@Bar.COM").value().equals("foo@bar.com")`.
- `new Email("Foo@Bar.COM").domain().equals("bar.com")`.
- `new Email("not-an-email")` throws.
- `new Email(null)` throws.

---

## Task 3 — `DateRange` with overlap detection

**Objective.** Implement `DateRange(LocalDate startInclusive, LocalDate endExclusive)` with `contains(LocalDate)`, `overlaps(DateRange)`, and `days()`.

**Constraints.**
- Reject ranges where `end <= start`.
- Half-open semantics — `end` is exclusive.
- `overlaps` is symmetric and total.

**Acceptance.**
- `new DateRange(d1, d2).overlaps(new DateRange(d2, d3)) == false` when ranges are back-to-back.
- `new DateRange(d1, d3).overlaps(new DateRange(d2, d4)) == true` when partial overlap.
- `new DateRange(d1, d1)` throws.
- `days()` returns the integer day count.

---

## Task 4 — `PhoneNumber` normalization to E.164

**Objective.** Implement `PhoneNumber(String value)` that normalizes any well-formed input to E.164 (`+<country><subscriber>`, digits only).

**Constraints.**
- Strip spaces, dashes, parentheses.
- Reject inputs without a leading `+` and a country code.
- Validate length (8..15 digits after the `+`).
- Expose the normalized string via the canonical accessor.

**Acceptance.**
- `new PhoneNumber("+1 (415) 555-1234").value().equals("+14155551234")`.
- `new PhoneNumber("415-555-1234")` throws (no country code).
- `new PhoneNumber("++abc")` throws.

---

## Task 5 — Refactor primitive obsession

**Objective.** Take this method and refactor it to use VOs.

```java
public Receipt charge(String customerEmail, long amountCents, String currency,
                       String cardNumber, String cardExpiry) { ... }
```

**Constraints.**
- Introduce `Email`, `Money`, and a `Card(CardNumber number, YearMonth expiry)` value type.
- The method signature must become `charge(Email customer, Money amount, Card card)`.
- Move all validation into the VO constructors.
- Strip duplicate validation that was inside `charge`.

**Acceptance.**
- The new `charge` method has zero validation code in its body.
- A `Card` cannot be constructed with an expired `YearMonth`.
- All callers updated to construct VOs at the boundary.

---

## Task 6 — JPA `@Embeddable` migration

**Objective.** Add a `Money price` field to an existing JPA `Product` entity using `@Embeddable` / `@Embedded`, mapping to columns `price_cents` and `price_currency`.

**Constraints.**
- `Money` must remain a record.
- Use `@AttributeOverrides` for the column names.
- Provide a Flyway/Liquibase migration adding the two columns.
- Existing rows must be backfilled to a default currency.

**Acceptance.**
- Saving a `Product` with `Money(1000, "USD")` writes `price_cents=1000`, `price_currency='USD'`.
- Loading the row back returns an equal `Money`.
- Validation in `Money`'s compact constructor runs on load (i.e., a row with `price_cents=-1` triggers an exception).

---

## Task 7 — ArchUnit lockdown of the VO package

**Objective.** Write ArchUnit rules that fail the build if anyone violates the VO invariants in `com.acme.domain.value`.

**Constraints.**
- Rule 1: All classes in the package are `final`.
- Rule 2: All fields are `final`.
- Rule 3: No methods named `set*`.
- Rule 4: No JPA `@Id` annotation on any field.
- Rule 5: No `@lombok.Setter` or `@lombok.Data` annotation.

**Acceptance.**
- A deliberate violation (add a setter to one VO) breaks the build.
- The test class is included in the standard `./gradlew test` / `mvn test` run.
- Rules are documented in the test class with comments referencing the spec.

---

## Task 8 — Jackson round-trip with custom JSON shape

**Objective.** Configure Jackson so `Money` serializes as `{"amount":"10.00","currency":"USD"}` (string amount, not number) and deserializes through the canonical constructor.

**Constraints.**
- Use `@JsonCreator` on the canonical constructor.
- Use `@JsonProperty` to map the JSON key `amount` to a `String` and convert to `long cents` in the compact constructor.
- A deserialization that produces invalid `Money` (negative amount, missing currency) must surface as a `JsonMappingException` whose cause is `IllegalArgumentException`.

**Acceptance.**
- `objectMapper.writeValueAsString(new Money(1000, "USD"))` returns `{"amount":"10.00","currency":"USD"}`.
- `objectMapper.readValue("{\"amount\":\"10.00\",\"currency\":\"USD\"}", Money.class)` round-trips.
- Invalid JSON throws with a clear root cause.

---

## Validation table

| Task | Key check | How to verify |
|---|---|---|
| 1 Money | cross-currency rejection | unit test `assertThrows` |
| 2 Email | lowercase + regex | parameterized unit test |
| 3 DateRange | half-open overlap | unit tests on edge cases |
| 4 PhoneNumber | E.164 normalization | regex assert on accessor |
| 5 Refactor | zero validation in service method | code review + line count diff |
| 6 JPA | round-trip equality | integration test with H2/Testcontainers |
| 7 ArchUnit | break-on-violation | deliberate regression test |
| 8 Jackson | round-trip + error path | unit tests on `ObjectMapper` |

---

## Worked solution — Task 1

```java
package com.acme.domain.value;

import java.util.Locale;
import java.util.Objects;

public record Money(long cents, String currency) {

    public Money {
        if (cents < 0)
            throw new IllegalArgumentException("Money.cents must be >= 0, was " + cents);
        Objects.requireNonNull(currency, "currency");
        currency = currency.toUpperCase(Locale.ROOT);
        if (currency.length() != 3)
            throw new IllegalArgumentException("Currency must be ISO-4217: " + currency);
    }

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(cents + other.cents, currency);
    }

    public Money minus(Money other) {
        requireSameCurrency(other);
        if (other.cents > cents)
            throw new IllegalArgumentException("subtract would go negative");
        return new Money(cents - other.cents, currency);
    }

    public Money times(int factor) {
        if (factor < 0) throw new IllegalArgumentException("factor < 0");
        return new Money(Math.multiplyExact(cents, (long) factor), currency);
    }

    public boolean isZero() { return cents == 0; }

    private void requireSameCurrency(Money other) {
        Objects.requireNonNull(other, "other");
        if (!currency.equals(other.currency))
            throw new IllegalArgumentException(
                "currency mismatch: " + currency + " vs " + other.currency);
    }
}
```

Companion test (JUnit 5 + AssertJ):

```java
class MoneyTest {

    @Test void normalises_currency_case() {
        assertThat(new Money(100, "usd").currency()).isEqualTo("USD");
    }

    @Test void rejects_negative_cents() {
        assertThatThrownBy(() -> new Money(-1, "USD"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void plus_same_currency() {
        assertThat(new Money(100, "USD").plus(new Money(50, "USD")))
            .isEqualTo(new Money(150, "USD"));
    }

    @Test void plus_rejects_currency_mismatch() {
        assertThatThrownBy(() -> new Money(100, "USD").plus(new Money(50, "EUR")))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void times_uses_overflow_check() {
        assertThatThrownBy(() -> new Money(Long.MAX_VALUE, "USD").times(2))
            .isInstanceOf(ArithmeticException.class);
    }
}
```

The remaining tasks follow the same template: a record with a compact constructor, a tight test class proving the invariants, and integration where the task demands it.
