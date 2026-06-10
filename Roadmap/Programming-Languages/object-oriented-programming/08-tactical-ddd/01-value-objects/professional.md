# Value Objects — Professional

> **What?** At the Professional level a Value Object stops being a pure design concept and becomes a *cross-cutting concern* that must coexist with JPA, Jackson, MapStruct, validation frameworks, ArchUnit, and (soon) JEP 401 value classes. You make decisions about how a VO is **embedded** in a JPA entity, how it **serializes** at the wire, how it **maps** across DTO boundaries, how it is **enforced** structurally with ArchUnit, and how it will **flatten** under JEP 401's value classes when they ship. Each integration has its own gotchas, and the cost of getting them wrong is data corruption, not just code ugliness.
> **How?** Treat each VO as having three lives: in-memory, on-the-wire, in-storage. Design the canonical Java type first, then choose the JPA mapping, then the JSON shape, then the mapping rules between DTOs and domain. Lock in the contract with ArchUnit so future contributors can't quietly add a setter or extend the class.

---

## 1. JPA — `@Embeddable` and `@Embedded`

The default storage strategy for a VO is to embed it inside the owning entity's table — no join, no separate primary key. JPA's `@Embeddable` / `@Embedded` annotations do this directly.

```java
@Embeddable
public record Money(long cents, String currency) {
    public Money {
        if (cents < 0) throw new IllegalArgumentException("negative");
        if (currency == null || currency.length() != 3) throw new IllegalArgumentException("ISO-4217");
    }
}

@Entity
public class Product {
    @Id Long id;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "cents",    column = @Column(name = "price_cents")),
        @AttributeOverride(name = "currency", column = @Column(name = "price_currency"))
    })
    private Money price;
}
```

Notes:

- **Records as `@Embeddable`** require a recent JPA/Hibernate (Hibernate 6.x+). On older versions you must use a `final class` with field-based access.
- **No no-arg constructor** is needed if you tell Hibernate to use the canonical constructor — but many older configurations still expect one. Plain final classes work universally.
- **`@AttributeOverride`** lets one entity own *two* `Money` fields (`price`, `cost`) without column-name collision.
- The embedded VO has **no table of its own**, no FK, no orphan-removal semantics. It lives and dies with the owning row.

### When embedding is the wrong choice

- If two entities point at the *same* value and the value can change, you have an Entity, not a VO.
- If the VO is large and most queries don't need it, consider a separate table with lazy loading.
- If the VO is a collection (`Set<Tag>`), use `@ElementCollection` with `@CollectionTable`.

---

## 2. Hibernate `UserType` — when `@Embeddable` isn't enough

When the on-disk shape doesn't match the in-memory shape — e.g., you want to store `Money` in a single `NUMERIC(19,4)` column with the currency in a sibling column, or you want a custom JSON column for a complex VO — implement Hibernate's `UserType<T>` (Hibernate 6 renamed the old `org.hibernate.usertype.UserType` to a generic interface).

```java
public class MoneyUserType implements org.hibernate.usertype.UserType<Money> {
    public int getSqlType() { return java.sql.Types.NUMERIC; }
    public Class<Money> returnedClass() { return Money.class; }

    public boolean equals(Money a, Money b)        { return java.util.Objects.equals(a, b); }
    public int hashCode(Money m)                   { return m.hashCode(); }

    public Money nullSafeGet(java.sql.ResultSet rs, int pos,
                             org.hibernate.engine.spi.SharedSessionContractImplementor s,
                             Object owner) throws java.sql.SQLException {
        var cents = rs.getLong(pos);
        if (rs.wasNull()) return null;
        var ccy = rs.getString(pos + 1);
        return new Money(cents, ccy);
    }

    public void nullSafeSet(java.sql.PreparedStatement st, Money v, int pos,
                            org.hibernate.engine.spi.SharedSessionContractImplementor s) throws java.sql.SQLException {
        if (v == null) { st.setNull(pos, java.sql.Types.NUMERIC); st.setNull(pos+1, java.sql.Types.VARCHAR); return; }
        st.setLong(pos,   v.cents());
        st.setString(pos+1, v.currency());
    }

    public boolean isMutable() { return false; }
    public Money deepCopy(Money v)         { return v; }   // immutable — share
    public java.io.Serializable disassemble(Money v) { return v; }
    public Money assemble(java.io.Serializable s, Object o) { return (Money) s; }
}
```

`isMutable() == false` is essential — it tells Hibernate it can cache and share the instance, skipping defensive copies.

---

## 3. Jackson — JSON shape of a VO

The default Jackson serialization of a `record` produces a JSON object with the component names as keys:

```json
{ "cents": 1000, "currency": "USD" }
```

That's often fine. Three deviations are common:

### Single-value JSON projection

A VO with one component (`record Email(String value)`) usually wants to serialize as `"user@example.com"` rather than `{"value":"user@example.com"}`. Use `@JsonValue` on the accessor:

```java
public record Email(@com.fasterxml.jackson.annotation.JsonValue String value) {
    @com.fasterxml.jackson.annotation.JsonCreator
    public Email { /* validation */ }
}
```

`@JsonValue` tells Jackson "the JSON form *is* this component"; `@JsonCreator` on the compact constructor tells Jackson "to deserialize, call this constructor".

### Money as a structured JSON object

Most APIs settle on `{"amount":"10.00", "currency":"USD"}`. Make the accessor return a `String` rather than a `BigDecimal` so the wire form is stable across locales and JSON parsers.

### Reject unknown fields

When you receive a VO from JSON, configure your Jackson `ObjectMapper` with `FAIL_ON_UNKNOWN_PROPERTIES = true`. Otherwise a `Money` payload with an extra `"discount":20` field silently passes — and a junior developer wonders why their feature doesn't take effect.

---

## 4. MapStruct — mapping VOs across layers

A VO often lives in the *domain* and crosses the boundary into a *DTO* (with a flatter or more verbose shape). MapStruct generates the mapping code at compile time.

```java
@org.mapstruct.Mapper
public interface ProductMapper {

    @org.mapstruct.Mapping(target = "priceCents",    source = "price.cents")
    @org.mapstruct.Mapping(target = "priceCurrency", source = "price.currency")
    ProductDto toDto(Product p);

    default Money toMoney(long cents, String currency) {
        return cents == 0 && currency == null ? null : new Money(cents, currency);
    }
}
```

Two rules of MapStruct + VOs:

- **The factory must validate.** If your DTO can carry an invalid `Email`, the mapper must either throw at conversion time or skip the field — never produce a half-valid VO.
- **Don't bypass the constructor.** MapStruct will reflectively set fields if you give it permission. For VOs, force constructor-based instantiation so the compact constructor runs.

---

## 5. ArchUnit — locking the VO contract structurally

A VO's invariants live in the language, but they erode under maintenance: a junior adds a setter, a senior adds a mutable field, a tool generates an all-args plus all-setters class. ArchUnit catches this at the build.

```java
@com.tngtech.archunit.junit.AnalyzeClasses(packages = "com.acme.domain")
class ValueObjectRulesTest {

    @com.tngtech.archunit.junit.ArchTest
    static final com.tngtech.archunit.lang.ArchRule vos_have_no_setters =
        com.tngtech.archunit.lang.syntax.ArchRuleDefinition
            .noClasses().that().resideInAPackage("..domain.value..")
            .should().haveSimpleNameEndingWith("Setter")
            .orShould().beAnnotatedWith(lombok.Setter.class);

    @com.tngtech.archunit.junit.ArchTest
    static final com.tngtech.archunit.lang.ArchRule vo_fields_are_final =
        com.tngtech.archunit.lang.syntax.ArchRuleDefinition
            .fields().that().areDeclaredInClassesThat().resideInAPackage("..domain.value..")
            .should().beFinal();

    @com.tngtech.archunit.junit.ArchTest
    static final com.tngtech.archunit.lang.ArchRule vos_are_final_classes =
        com.tngtech.archunit.lang.syntax.ArchRuleDefinition
            .classes().that().resideInAPackage("..domain.value..")
            .should().haveModifier(com.tngtech.archunit.core.domain.JavaModifier.FINAL);
}
```

These three rules cover ~90% of structural drift: no setters, all fields final, classes themselves final. A CI failure on these is faster and cheaper than a code review catching the same drift.

### Module-info enforcement

If you're on a Java 9+ module system, expose your VOs through the API package and keep mutable internals out of `exports`:

```java
module com.acme.domain {
    exports com.acme.domain.value;        // VOs go here
    // internal mutable types stay un-exported
}
```

---

## 6. JEP 401 — the future of VOs in Java

JEP 401 (*Value Classes and Objects*, Preview, JDK 23+) introduces **value classes**: types declared with the `value` modifier whose instances have no identity, no `==`-by-reference, no `synchronized` lock, and are eligible to be *flattened* by the JVM into their containing layout (no header, no indirection).

```java
// JEP 401 preview syntax
public value record Money(long cents, String currency) {
    public Money {
        if (cents < 0) throw new IllegalArgumentException();
    }
}
```

The transformation is *binary* and *behavioural*:

- `==` is forbidden between value-class instances; only `equals` is meaningful.
- `synchronized(money)` throws `IdentityException` at runtime.
- A `Money[]` array can be laid out as `long[] cents; String[] currency;` internally — no per-element header.
- `HashMap<Money, ...>` and `record` patterns continue to work unchanged.

The migration path for an existing VO is essentially "add the `value` modifier and run your tests". If your VO already obeys all four senior-level properties, it's a one-line change. If your code relies on `==` to compare VOs, on lock-on-VO, or on a no-arg constructor for reflection, JEP 401 will expose the violations.

Even before JEP 401 ships, designing VOs *as if* they were value classes — no identity-sensitive operations, no locking, no `==` checks — future-proofs the code for the day flattening becomes free.

---

## 7. Quick rules

- VOs in JPA: `@Embeddable` + `@Embedded` first; `UserType` only when the schema shape diverges from the Java shape.
- Always use `@AttributeOverride` when an entity owns two VO fields of the same type.
- Records as `@Embeddable` need Hibernate 6+; on older stacks use `final class` with field access.
- Jackson: `@JsonValue` for single-component VOs; `@JsonCreator` on the compact constructor; reject unknown fields globally.
- MapStruct: never bypass the canonical constructor; let the compact constructor validate.
- ArchUnit: enforce *no setters*, *all fields final*, *class final* on the VO package — at build time, not review time.
- Design every VO as if JEP 401 already shipped: no `==` comparisons, no `synchronized(vo)`, no reliance on reference identity.
- `isMutable() = false` everywhere — UserType, MapStruct, ORM second-level cache — to suppress defensive copies.
- A VO with a JPA `@GeneratedValue` id is not a VO. Move it to the Entity package.
- A VO is null or fully valid. Never half-populated, never partially deserialized.

---

## 8. What's next

| Topic | Where | Why it follows |
|---|---|---|
| Entities | `02-entities/` | The identity-bearing counterpart to VOs in tactical DDD. |
| Aggregates | `03-aggregates/` | VOs as the immutable building blocks of an aggregate root. |
| Immutability patterns | `02-object-oriented-programming/.../immutability/` | The mechanical underpinnings — `final`, defensive copies, copy-on-write. |
| Primitive Obsession | `Refactoring/code-smells/primitive-obsession/` | The smell that motivates introducing VOs. |
| Specifications | `09-specifications/` (if present) | Composable predicates over VOs and entities. |

---

## Memorize this

- A VO has three lives — in-memory, on-the-wire, in-storage — and each life has its own gotchas.
- JPA `@Embeddable` + `@Embedded` is the default storage; `UserType` is the escape hatch.
- Jackson `@JsonValue` + `@JsonCreator` make single-component VOs serialize as scalars.
- MapStruct must call the canonical constructor — never bypass validation by reflection.
- ArchUnit locks the contract: no setters, all-final fields, final classes, in the VO package.
- JEP 401 value classes will make VOs *flattenable* at the JVM level; design them as if it already shipped.
- A VO's `isMutable()` is always `false` — this unlocks ORM second-level caching, defensive-copy elimination, and JEP 401 flattening.
- The single biggest professional-level mistake is letting a half-deserialized VO ship: every boundary deserializer must run the constructor, never set fields reflectively.
- Reference: Evans ch. 5; Vernon ch. 6; JEP 395 (records); JEP 401 (value classes); Hibernate 6 user guide.
