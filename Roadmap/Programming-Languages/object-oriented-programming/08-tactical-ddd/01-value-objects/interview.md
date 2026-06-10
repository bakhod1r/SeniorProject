# Value Objects — Interview Q&A

Twenty questions, ordered roughly junior → senior. Each answer is what you'd say in 30–60 seconds.

---

### 1. What is a Value Object?

A small, immutable type whose identity is the combination of its attribute values. Two instances with equal attributes are equal and interchangeable. Money, Email, Address, DateRange. Defined in Eric Evans's *Domain-Driven Design* (ch. 5) as the opposite of an Entity.

### 2. What's the difference between a Value Object and an Entity?

An Entity has an identity that persists across attribute changes — a Customer is the same customer after they update their email. A Value Object has no identity beyond its attributes — change the cents and you have a different Money. Entities are equal by id; VOs are equal by attribute. Entities are containers of VOs.

### 3. Why do VOs have to be immutable?

Two reasons. First, equality-by-value: if a VO could be mutated after sharing it across collaborators, a `HashMap` key could change its hash and the map invariants would break. Second, thread safety: an immutable VO is safe to share across threads with no synchronization. Mutability defeats both.

### 4. How do you implement a VO in modern Java?

Use a `record` (JEP 395). It gives you final fields, an all-args canonical constructor, accessors, `equals`, `hashCode`, and `toString` based on the components. Add a compact constructor for validation and normalization.

### 5. What's a compact constructor and where do you use it?

It's the record-specific constructor syntax with no parameter list:

```java
public record Email(String value) {
    public Email {
        if (value == null || !value.contains("@")) throw new IllegalArgumentException();
        value = value.toLowerCase();
    }
}
```

The compiler inserts field assignments after your code runs. It's the canonical place to validate and normalize.

### 6. Can a VO have behavior, or is it just data?

Yes — and it should. Methods like `plus`, `minus`, `overlaps`, `contains`, `isExpired` belong on the VO, next to the data they operate on. Vaughn Vernon calls these *side-effect-free functions* in *Implementing Domain-Driven Design*. The alternative — putting them in a `MoneyService` — produces anaemic models.

### 7. What is "primitive obsession" and how do VOs cure it?

Primitive obsession (Martin Fowler, *Refactoring*) is using `String`, `int`, `BigDecimal` for domain concepts that deserve their own type. Symptoms: scattered validation, methods with many same-typed parameters that get swapped at callsites, missing arithmetic constraints. The cure is to introduce a VO and replace the primitive everywhere.

### 8. Why is `BigDecimal` tricky in a Money VO?

`BigDecimal.equals` is scale-sensitive: `new BigDecimal("1.0")` and `new BigDecimal("1.00")` are not `.equals`. If your `Money` uses inherited record `equals`, semantically identical sums hash to different buckets. Fix: normalize the scale in the compact constructor, or store `long` cents instead.

### 9. How do you compare two `Money` instances in different currencies?

You don't — you reject the operation. `usd.plus(eur)` should throw, not silently convert. Conversion is a separate operation that requires an exchange rate and a date, and belongs in a `CurrencyConverter` service, not in `Money` itself.

### 10. Should a VO be persisted with its own row in the database?

Usually no. Use JPA `@Embeddable` / `@Embedded` to inline the VO's columns into the owning entity's table. Use `@AttributeOverride` to name the columns explicitly. A VO with its own table and id is no longer a VO — it's becoming an Entity.

### 11. What's a `UserType` and when do you need one?

A Hibernate `UserType<T>` is a custom JDBC mapping for a type that doesn't match the default `@Embeddable` shape — e.g., a `Money` stored as one `NUMERIC` column plus a sibling `VARCHAR`, or a JSON-serialized complex VO. Implement `nullSafeGet`, `nullSafeSet`, and mark `isMutable() == false`.

### 12. How do you serialize a single-component VO like `Email` to JSON as a string?

Annotate the component with `@JsonValue` and the canonical constructor with `@JsonCreator`:

```java
public record Email(@JsonValue String value) {
    @JsonCreator public Email { /* validation */ }
}
```

That makes `Email` serialize as `"user@example.com"` instead of `{"value":"user@example.com"}`.

### 13. How do you enforce VO invariants at build time?

ArchUnit. Rules in CI: "no `set*` methods in `..domain.value..`", "all fields final", "all classes final", "no `@Id` annotation". A deliberate violation breaks the build, not just code review. Spec-level invariants become structural guarantees.

### 14. What is JEP 401 and how does it relate to VOs?

JEP 401 (*Value Classes and Objects*, preview) lets you declare a class `value`. Its instances have no identity, no `==`-by-reference, can be flattened inline into arrays, and pass in registers across method calls. A well-designed VO becomes a value class with one keyword: `public value record Money(...)`. Design VOs today as if JEP 401 already shipped: no `==`, no `synchronized(vo)`, no reliance on reference identity.

### 15. What's the difference between a VO and a DTO?

A DTO is a transport shape — it crosses an API or message boundary and usually has weak invariants. It can be mutable, partially populated, or carry serialization annotations. A VO is a domain concept with strict invariants enforced in the constructor. You convert DTO → VO at the boundary; the interior code never sees the DTO.

### 16. How should a VO handle `null` components?

Reject them in the compact constructor with `Objects.requireNonNull(field, "name")`. A VO is fully valid or it doesn't exist. There is no "partially constructed" state, no `null` placeholder, no "set later" component.

### 17. Can a VO contain another VO?

Yes — composition is the norm. `Address` may contain `PostalCode`, `Country`. `Money` is contained in `LineItem` is contained in `Order`. Equality and immutability compose: an outer VO is equal-by-value over its inner VOs, and is immutable as long as its inner VOs are immutable. Records compose naturally.

### 18. When would you use a `final class` instead of a `record` for a VO?

When the record's constraints don't fit: you need to hide a component from the accessor, extend an abstract base, cache a derived value with a non-component field, or use field-based access for an older JPA stack. In every other case, prefer the record.

### 19. How do you write a `hashCode` for a VO with a mutable component (e.g., an array)?

You don't keep the mutable component. Either replace it with an immutable type (`List.copyOf` for collections, `java.time.*` for dates, `String` for byte sequences) or defensive-copy on construction and return an unmodifiable view from the accessor. A VO with a referenced mutable object whose state can change is not really a VO — `equals` and `hashCode` become unstable.

### 20. Walk me through replacing a primitive with a VO across an existing codebase.

Three reviewable steps. First, **introduce the VO** with full validation and tests, but don't change any signatures yet. Second, **change one signature at a time** to take the VO, wrapping the primitive at callsites — every wrap is the validation the codebase was missing. Third, **push the wrap to the boundary** — the controller, message consumer, or CLI entry point — so interior services receive the VO and trust it. After all three, the primitive is gone from interior signatures, validation lives in one place, and the compiler enforces "valid value only".

---

## Memorize this

- A Value Object is **immutable**, has **equality by value**, has **no identity**, is **side-effect-free**, and forms a **conceptual whole**. Five invariants, no negotiation.
- Default to `record` (JEP 395) for VOs; reach for `final class` only when records can't model your invariants.
- Validate and normalize in the **compact constructor**; nowhere else.
- Replace primitives at the **boundary**; interior code receives VOs and trusts them.
- A VO with an id is an Entity; a VO with a setter is a JavaBean; a VO with a side effect is a service.
- Reject cross-currency, cross-unit, cross-zone operations explicitly — never silently convert.
- ArchUnit + a compact constructor + records together encode the entire VO contract at build time.
- JEP 401 will make VOs flat and free; design every VO today as if the keyword `value` is already there.
- Reference: Evans, *Domain-Driven Design*, ch. 5; Vernon, *Implementing Domain-Driven Design*, ch. 6; JEP 395; JEP 401.
