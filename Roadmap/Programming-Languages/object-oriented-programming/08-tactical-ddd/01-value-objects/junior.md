# Value Objects — Junior

> **What?** A *Value Object* (VO) is a small, immutable object that describes a characteristic of something in the domain — an amount of money, an email address, a postal code — and whose identity is **the combination of its attribute values**, not a database id or memory address. Two `Money(10, "USD")` instances are *the same value*, the same way two banknotes of equal denomination are interchangeable.
> **How?** When you see a `String`, `int`, or `BigDecimal` field whose name carries meaning (`email`, `priceCents`, `currencyCode`), ask: "Could this be wrong? Could it be invalid?" If yes, wrap it in a tiny class (or `record`) that validates its inputs once in the constructor, exposes no setters, and overrides `equals`/`hashCode` so equal values compare equal. That class is a Value Object.

---

## 1. The mental model — money in your pocket

If you have a $10 bill and I have a $10 bill, we don't care *which* note we hold — they buy the same coffee. Banknotes are *value-shaped*: identity doesn't matter, the denomination and currency do.

Contrast that with a *person*: even if two people share the same name and birthday, they are distinct human beings with distinct histories. People are *identity-shaped*. We track them by passport number, employee id, account id — never by their attributes.

Domain-Driven Design (Eric Evans, *Domain-Driven Design*, 2003) names these two shapes:

- **Entity** — has an identity that persists across attribute changes. A `Customer` is the same customer even after they change their email.
- **Value Object** — has no identity beyond its attributes. A `Money(10, "USD")` is fully described by *what it holds*. Change any field and you have a different value.

Most domain code is full of value-shaped things masquerading as primitives. Spotting them and giving them their own type is one of the highest-leverage habits in object design.

---

## 2. The three rules every Value Object obeys

### Rule 1 — Equality by value

Two VOs with the same attribute values **must** be `equals` and **must** have the same `hashCode`. This is the defining property.

```java
record Money(long cents, String currency) {}

var a = new Money(1000, "USD");
var b = new Money(1000, "USD");

a.equals(b);            // true
a.hashCode() == b.hashCode(); // true
```

Java `record` (JEP 395, Java 16) gives you correct `equals`, `hashCode`, and `toString` for free, based on the canonical components. That alone is reason enough to reach for records when modelling values.

### Rule 2 — Immutability

A VO never changes after construction. No setters. All fields `final`. If you want a "different" money amount, you build a *new* `Money` instance.

```java
Money price = new Money(1000, "USD");
Money discounted = price.minus(new Money(200, "USD"));
// 'price' is still 1000 USD; 'discounted' is a fresh 800 USD
```

Immutability removes a whole category of bugs: aliasing (two variables silently point at the same mutable object), thread-safety hazards (one thread mutates while another reads), and accidental tampering by collaborators.

### Rule 3 — Side-effect-free behaviour

Methods on a VO must not change the world. `money.add(other)` returns a new `Money`; it does not log to disk, hit a database, or mutate a field. The VO is a *pure data shape with pure operations*. (Vaughn Vernon calls these "side-effect-free functions" in *Implementing Domain-Driven Design*, 2013.)

This makes VOs trivially testable, trivially cacheable, and safe to share across threads.

---

## 3. Three example VOs you'll write this week

### Money

```java
public record Money(long cents, String currency) {
    public Money {
        if (cents < 0) throw new IllegalArgumentException("negative");
        if (currency == null || currency.length() != 3)
            throw new IllegalArgumentException("ISO-4217 expected");
    }

    public Money plus(Money other) {
        if (!currency.equals(other.currency))
            throw new IllegalArgumentException("currency mismatch");
        return new Money(cents + other.cents, currency);
    }
}
```

Notice: validation happens once, in the compact constructor. After that, every `Money` in your system is guaranteed valid. You no longer write `if (price > 0)` checks in fifteen places.

### Email

```java
public record Email(String value) {
    private static final java.util.regex.Pattern RX =
        java.util.regex.Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    public Email {
        if (value == null || !RX.matcher(value).matches())
            throw new IllegalArgumentException("invalid email: " + value);
        value = value.toLowerCase(); // normalize once
    }
}
```

Before this type existed, every method that took a `String email` had to wonder: was it validated upstream? Lowercased? Trimmed? After this type exists, the *compiler* enforces "you only get here with a valid, normalized email".

### Address

```java
public record Address(String street, String city, String postalCode, String country) {
    public Address {
        java.util.Objects.requireNonNull(street);
        java.util.Objects.requireNonNull(city);
        java.util.Objects.requireNonNull(postalCode);
        java.util.Objects.requireNonNull(country);
    }
}
```

Address is a *conceptual whole* — you almost never pass street alone, or city alone. Bundling them into one type makes the domain language explicit.

---

## 4. Why bother? — three benefits you feel within a week

**Validation lives in one place.** No more `if (email == null || !email.contains("@"))` scattered across controllers, services, and DAOs. The constructor is the single gate.

**Method signatures become self-documenting.** `transfer(Money amount, Account from, Account to)` is unambiguous. `transfer(BigDecimal amount, String currency, long fromId, long toId)` is a pile of primitives you have to read every parameter of to understand.

**Bugs migrate from runtime to compile time.** You can't accidentally pass a `PostalCode` where a `PhoneNumber` is expected. With raw `String`s, that mistake compiles fine and ships.

---

## 5. The "primitive obsession" smell

This is the smell VOs cure. Martin Fowler lists *Primitive Obsession* in *Refactoring* as one of the top code smells: using built-in primitives (`String`, `int`, `BigDecimal`) for domain concepts that deserve their own type. Symptoms:

- Methods with five `String` parameters whose order you can never remember.
- Validation logic copy-pasted across layers.
- Comments like `// in cents` next to every `long` field.
- Bugs caused by mixing two values of the same primitive type (a USD amount accidentally added to a EUR amount).

When you see those symptoms, the fix is almost always: introduce a Value Object.

---

## 6. What a Value Object is **not**

- **Not a DTO.** A DTO is a transport shape for serialization; it usually has no validation and may be mutable. A VO carries domain meaning and invariants.
- **Not a struct.** It's not just a bag of fields — it has behaviour (`plus`, `minus`, `isExpired`, `overlaps`) that lives next to the data.
- **Not an Entity.** An Entity has lifecycle and id; you "save" and "load" it by id. A VO is replaced wholesale.
- **Not always a record.** Records are a convenient default, but VOs predate records. A regular `final class` with overridden `equals`/`hashCode` is still a VO.

---

## 7. The Junior checklist

When you introduce a VO, verify:

1. All fields are `final` (records do this for you).
2. There are no setters and no methods that mutate `this`.
3. `equals` and `hashCode` are based on all attributes (records do this for you).
4. Invalid states are rejected in the constructor.
5. The name is a *domain noun* (`PhoneNumber`, `Quantity`, `SKU`) — not `PhoneNumberHelper` or `PhoneNumberUtil`.

If all five check out, you've built a Value Object. Use it everywhere the underlying primitive used to live, and watch the surrounding code shrink.

---

## Memorize this

- A **Value Object** has no identity; it is fully defined by its attribute values.
- Three rules: **equality by value**, **immutability**, **side-effect-free behaviour**.
- In Java, reach for `record` first (JEP 395) — it gives you correct `equals`/`hashCode`/`toString` and `final` fields automatically.
- Validate once, in the compact constructor; after that, every instance in the system is guaranteed valid.
- The smell VOs cure is *primitive obsession*: `String email`, `BigDecimal price`, `int days` cluttering signatures with no validation and no type safety.
- Money, Email, Address, PhoneNumber, DateRange, Quantity — these are VOs, not primitives.
- Method signatures that take VOs read like sentences in the ubiquitous language; signatures full of primitives don't.
- Reference: Eric Evans, *Domain-Driven Design*, ch. 5 ("Value Objects"); Vaughn Vernon, *Implementing Domain-Driven Design*, ch. 6.
