# Value Objects — Find the Bug

Ten code snippets that *look* like correct Value Objects but each has a defect that violates one of the five invariants (immutability, equality-by-value, no identity, side-effect-free, conceptual whole). For each: diagnose first, then patch.

---

## Bug 1 — Mutable field inside a "VO"

```java
public final class Address {
    private final String street;
    private final List<String> tags;       // <-- problem

    public Address(String street, List<String> tags) {
        this.street = street;
        this.tags = tags;
    }
    public List<String> tags() { return tags; }
}
```

**Diagnosis.** `tags` is `final` but the *referenced* list is mutable. A caller holding the original `List<String>` can `tags.add("...")` after construction and the "VO" silently changes. Invariant 1 (immutability) broken.

**Fix.** Defensive copy on construction *and* on read, plus an unmodifiable wrapper:

```java
public Address(String street, List<String> tags) {
    this.street = street;
    this.tags   = List.copyOf(tags);   // immutable copy
}
public List<String> tags() { return tags; }   // List.copyOf already unmodifiable
```

`List.copyOf` (Java 10+) returns an unmodifiable list and copies the elements, so external mutation of the original is invisible to the VO.

---

## Bug 2 — Equality includes a transient field

```java
public final class Email {
    private final String value;
    private final long createdAt;          // <-- snuck into equals

    public Email(String value) {
        this.value = value.toLowerCase();
        this.createdAt = System.currentTimeMillis();
    }
    @Override public boolean equals(Object o) {
        if (!(o instanceof Email e)) return false;
        return value.equals(e.value) && createdAt == e.createdAt;
    }
    @Override public int hashCode() { return Objects.hash(value, createdAt); }
}
```

**Diagnosis.** Two `Email("a@b.com")` instances created milliseconds apart are *not equal*. Invariant 2 (equality-by-value) broken. `createdAt` is not part of the email's identity — an email *is* its address.

**Fix.** Remove `createdAt` from `equals`/`hashCode`, or remove the field entirely:

```java
@Override public boolean equals(Object o) {
    return o instanceof Email e && value.equals(e.value);
}
@Override public int hashCode() { return value.hashCode(); }
```

Better: convert to `record Email(String value)` and let the compiler write equals/hashCode correctly.

---

## Bug 3 — `equals` overridden, `hashCode` not

```java
public final class PostalCode {
    private final String code;
    public PostalCode(String code) { this.code = code; }
    @Override public boolean equals(Object o) {
        return o instanceof PostalCode p && code.equals(p.code);
    }
    // hashCode NOT overridden
}
```

**Diagnosis.** The `Object.hashCode` contract: equal objects must have equal hashes. `Object.hashCode` returns a per-instance value, so `equals` says "equal" but `hashCode` disagrees. Symptom: `Set<PostalCode>` stores duplicates; `Map<PostalCode, X>.get` returns `null` for present keys. Invariant 2 broken.

**Fix.** Always override both, or use a `record`:

```java
public record PostalCode(String code) { }
```

---

## Bug 4 — BigDecimal scale leaks into equality

```java
public record Money(BigDecimal amount, String currency) { }

// somewhere
var a = new Money(new BigDecimal("1.0"),  "USD");
var b = new Money(new BigDecimal("1.00"), "USD");
a.equals(b);  // false
```

**Diagnosis.** `BigDecimal.equals` is scale-sensitive; `1.0` and `1.00` are not `.equals`. Two semantically identical sums end up in different buckets of a `HashMap`. Invariant 2 broken in a subtle, data-dependent way.

**Fix.** Normalize the scale in the compact constructor:

```java
public record Money(BigDecimal amount, String currency) {
    public Money {
        amount = amount.setScale(2, java.math.RoundingMode.UNNECESSARY);
    }
}
```

Or store cents as `long` and avoid `BigDecimal` entirely.

---

## Bug 5 — Cross-currency `plus` silently corrupts

```java
public record Money(long cents, String currency) {
    public Money plus(Money other) {
        return new Money(this.cents + other.cents, this.currency);   // <-- silently drops other.currency
    }
}
```

**Diagnosis.** `usd.plus(eur)` produces a `Money` in USD with the numerical sum of two different currencies. Catastrophic in any finance domain. Invariant 4 (operations must be total *and meaningful*) broken — the operation succeeds where it should refuse.

**Fix.** Reject the cross-currency call explicitly:

```java
public Money plus(Money other) {
    if (!currency.equals(other.currency))
        throw new IllegalArgumentException("currency mismatch: " + currency + " vs " + other.currency);
    return new Money(cents + other.cents, currency);
}
```

---

## Bug 6 — Missing validation in compact constructor

```java
public record Email(String value) { }     // no validation
```

**Diagnosis.** `new Email(null)`, `new Email("")`, `new Email("not-an-email")` all succeed. The type promises validity but delivers none. Downstream code re-validates "just in case", and validation drifts across the codebase.

**Fix.** Compact constructor with explicit validation:

```java
public record Email(String value) {
    private static final java.util.regex.Pattern RX =
        java.util.regex.Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    public Email {
        java.util.Objects.requireNonNull(value);
        var v = value.trim().toLowerCase(java.util.Locale.ROOT);
        if (!RX.matcher(v).matches()) throw new IllegalArgumentException(value);
        value = v;
    }
}
```

---

## Bug 7 — Setter exposed via Lombok

```java
@lombok.Getter
@lombok.Setter
@lombok.AllArgsConstructor
@lombok.EqualsAndHashCode
public class Money {
    private long cents;
    private String currency;
}
```

**Diagnosis.** `@Setter` adds `setCents` and `setCurrency`. The "VO" is now mutable. Invariant 1 broken; the class is a JavaBean wearing a VO costume.

**Fix.** Either replace with a `record`, or use `@Value` (Lombok's all-immutable annotation) instead of `@Getter`/`@Setter`:

```java
public record Money(long cents, String currency) { /* validation */ }
```

Add an ArchUnit rule rejecting `@lombok.Setter` and `@lombok.Data` in the VO package so this doesn't regress.

---

## Bug 8 — Storing a mutable `Date`

```java
public final class DateRange {
    private final java.util.Date start;
    private final java.util.Date end;

    public DateRange(java.util.Date start, java.util.Date end) {
        this.start = start;
        this.end = end;
    }
    public java.util.Date start() { return start; }
}
```

**Diagnosis.** `java.util.Date` is mutable: a caller can `range.start().setTime(0)` and modify the VO's state. Invariant 1 broken because the referent is mutable, even though the reference is `final`.

**Fix.** Switch to `java.time.LocalDate` / `Instant` (immutable since Java 8), or defensive-copy on construction and read:

```java
public record DateRange(java.time.LocalDate startInclusive, java.time.LocalDate endExclusive) {
    public DateRange {
        if (!endExclusive.isAfter(startInclusive)) throw new IllegalArgumentException();
    }
}
```

The `java.time` types are immutable by design — no defensive copy needed.

---

## Bug 9 — Two values that hash differently because of currency case

```java
public record Money(long cents, String currency) {
    public Money {
        java.util.Objects.requireNonNull(currency);
    }
}

new Money(100, "USD").equals(new Money(100, "usd"));  // false
```

**Diagnosis.** No normalization. `"USD"` and `"usd"` are domain-equal but `String`-unequal. A downstream `HashMap` will treat them as distinct keys. Invariant 2 broken via missing canonicalisation.

**Fix.** Normalize in the compact constructor:

```java
public Money {
    java.util.Objects.requireNonNull(currency);
    currency = currency.toUpperCase(java.util.Locale.ROOT);
    if (currency.length() != 3) throw new IllegalArgumentException();
}
```

Same lesson for emails (lowercase), phone numbers (E.164 form), URLs (lowercase host), and UUIDs (canonical hex form).

---

## Bug 10 — Method has a side effect

```java
public record Audit(String userId, java.time.Instant when) {
    public Audit recordAccess() {
        org.slf4j.LoggerFactory.getLogger(Audit.class).info("access by {}", userId);  // I/O
        return this;
    }
}
```

**Diagnosis.** `recordAccess` performs I/O (logging). It is no longer a pure function on the VO. Invariant 4 (side-effect-free behaviour) broken. Worse, the VO now has a dependency on a logging framework, defeating the "tiny, no-deps" virtue.

**Fix.** Move the side effect out of the VO. The VO returns data; an *application service* logs it.

```java
public record Audit(String userId, java.time.Instant when) { }

public class AuditService {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(AuditService.class);
    public void recordAccess(Audit a) { LOG.info("access by {}", a.userId()); }
}
```

---

## Cross-cutting checklist

When reviewing a candidate VO, run this sweep:

1. Are all fields `final`?
2. Are referenced collections / dates immutable or defensively copied?
3. Does `equals` use exactly the attribute set and no transient field?
4. Does `hashCode` agree with `equals` and use the same fields?
5. Are inputs normalized (case, scale, trim, intern) in the constructor?
6. Are invalid inputs rejected in the constructor?
7. Do operations return a new VO, never mutate `this`?
8. Are operations total — no `RuntimeException` on inputs the type allows?
9. Is there *no* logging, clock read, network, or DB call?
10. Does the VO depend only on JDK + (optionally) the domain module?

A "no" on any of these is a bug, regardless of how the code reads.
