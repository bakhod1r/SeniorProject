# Entities — Specification

> **What?** The formal contract an Entity must satisfy — the contract isn't in the Java language spec, but is described precisely in Eric Evans's *Domain-Driven Design* (2003) chapter 5, Vaughn Vernon's *Implementing DDD* (2013) chapter 5, and the JPA 3.1 specification (`jakarta.persistence`, §2.1 "Entity Class").
> **How?** By stating each obligation as a property the implementation must hold (identity stability, equality-by-id, invariant guards, lifecycle compatibility), and pinning each to a normative source you can cite.

---

## 1. Definition

> **Entity** (Evans, 2003, p. 91): *"An object defined primarily by its identity is called an Entity. Entities have special modeling and design considerations. They have life cycles that can radically change their form and content, while a thread of continuity must be maintained. Their identities must be defined so that they can be effectively tracked. Their class definitions, responsibilities, attributes, and associations should revolve around who they are, rather than the particular attributes they happen to carry."*

The four pillars from Evans:

1. **Identity.** A distinguishing handle (`id`) that is unique within its scope and stable across the entity's lifetime.
2. **Continuity.** The entity persists through state changes; mutation does not destroy and recreate it.
3. **Lifecycle.** The entity is created, lives through state transitions, and is eventually retired/archived.
4. **Behaviour.** The entity guards invariants relevant to its concept; it is not a data carrier.

---

## 2. Identity contract

The identity attribute (`id`) must satisfy:

**S1 — Uniqueness.** No two distinct entity instances (within the entity's scope, typically the database table or aggregate type) share the same id.

**S2 — Stability.** Once assigned, the id never changes for the lifetime of the entity. Java enforcement is `final` field; SQL enforcement is `@Column(updatable = false)` plus, ideally, a trigger or constraint.

**S3 — Non-nullability after persistence.** A persisted entity has an id; a transient entity may have a null id, depending on the strategy.

**S4 — Typed.** The id is its own type when possible (`OrderId` over raw `UUID`), to prevent mix-ups in method signatures (`transfer(fromAccount, toCustomer)` becomes type-checked).

```java
public final class CustomerId {
    private final UUID value;
    public CustomerId(UUID value) { this.value = Objects.requireNonNull(value); }
    public UUID value() { return value; }
    @Override public boolean equals(Object o) {
        return o instanceof CustomerId that && value.equals(that.value);
    }
    @Override public int hashCode() { return value.hashCode(); }
}
```

`CustomerId` is itself a Value Object — it has no identity beyond its value.

---

## 3. Equality and hash contract

For an Entity class `E`:

**E1.** `e1.equals(e2) ⇔ e1.id.equals(e2.id)` whenever both ids are non-null.

**E2.** `e1.equals(e2) ⇒ e1.hashCode() == e2.hashCode()` (the Object contract).

**E3.** `e.hashCode()` must be **stable** across the entity's lifetime *for an entity already inserted into a hash-based collection*. Practical implementations:

- If id is assigned at construction (UUID), use `id.hashCode()` from the start.
- If id is assigned later (IDENTITY), return a constant (`getClass().hashCode()` or `31`) while id is null, then never change it — accept some hash collisions in exchange for stability. Vlad Mihalcea's canonical guidance (Hibernate 6 user guide §2.7) recommends this.

**E4.** Two entities with `null` ids are equal only if `==` — not by any other comparison.

**E5.** `equals` accepts a proxy. Use `instanceof` (which an enhanced subclass passes) over `getClass() ==` (which it fails). Unwrap with `Hibernate.unproxy()` if you must.

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Customer)) return false;
    Customer that = (Customer) Hibernate.unproxy(o);
    return id != null && id.equals(that.id);
}
@Override public int hashCode() { return getClass().hashCode(); }
```

---

## 4. Lifecycle contract

The JPA specification (§3.2) defines four entity states; the contract is on transitions, not on the states themselves:

| State        | JPA terminology    | Persistent context | Database row |
| ------------ | ------------------ | ------------------ | ------------ |
| New          | `new`              | no                 | no           |
| Managed      | `managed`          | yes                | yes          |
| Detached     | `detached`         | no                 | yes          |
| Removed      | `removed`          | yes (until flush)  | yes (until flush) |

**L1 — Identity preservation across transitions.** An entity's id may not be changed by any transition. `merge` returns a possibly-different reference but the id is unchanged.

**L2 — Identity-map guarantee (within one persistence context).** `em.find(E.class, id)` returns the same Java reference for the same id within one session. Cross-session, no such guarantee — use `equals`.

**L3 — Mutability is contained.** A managed entity's field changes are tracked by dirty checking; a flush issues UPDATE. The domain class is unaware of this.

**L4 — Detach is transparent.** `equals`/`hashCode` must continue to function on detached entities. Behaviour methods that touch lazy associations must not be called on detached instances unless those associations have already been initialized.

---

## 5. Invariant contract

**I1 — Always-true state.** The entity's documented invariants hold immediately after the constructor returns and after every public method returns. If a method cannot satisfy them, it throws and leaves state unchanged (transactional semantics at method scope).

**I2 — Encapsulation.** Outside code cannot put the entity into an invalid state. There are no public setters for fields whose values are constrained.

**I3 — Self-validation.** Validation happens *inside* the entity, not in a separate `Validator` class. (Bean Validation `@NotNull`/`@Size` at the field level is allowed as a *defence in depth* layer, not a substitute.)

```java
public void debit(Money amount) {
    if (amount.isNegativeOrZero())     throw new IllegalArgumentException("Positive only");
    if (status != Status.ACTIVE)        throw new IllegalStateException("Inactive");
    if (amount.isGreaterThan(balance)) throw new InsufficientFundsException(id);
    this.balance = this.balance.subtract(amount);   // only mutate after all checks
}
```

I1's "leaves state unchanged on failure" requires that all checks run *before* any mutation — otherwise partial state corruption is possible.

---

## 6. JPA spec references

| Concept                  | Source (JPA 3.1)                          |
| ------------------------ | ----------------------------------------- |
| Entity class requirements | §2.1 "The Entity Class"                  |
| Identity (`@Id`)         | §2.4 "Primary Keys and Entity Identity"   |
| Generated id strategies  | §11.1.20 "@GeneratedValue"                |
| Versioning (`@Version`)  | §3.4 "Optimistic Locking and Concurrency" |
| Entity lifecycle states  | §3.2 "EntityManager API"                  |
| Equality requirement     | §2.4 "Primary key fields must be ..."     |
| Locking modes            | §3.4.4 "LockModeType"                     |

The JPA spec (§2.1) lists hard requirements on entity classes:

- Must be annotated with `@Entity` or declared in `orm.xml`.
- Must have a public or protected no-arg constructor.
- Must not be `final`. No method or persistent instance variable may be `final`.
- Must implement `Serializable` *if* instances will be passed by value as detached objects (e.g., RMI).
- Must declare exactly one primary key (`@Id` or `@EmbeddedId`).

The JPA equality requirement (§2.4):

> *"The primary key fields must support equality semantics consistent with the database equality of the primary key column values."*

Translated: `equals` and `hashCode` on the id must be value-based. UUID, `Long`, and a value-object id class all satisfy this; a class that uses reference equality on the id would not.

---

## 7. Bean Validation interaction (Jakarta Validation 3.0)

Bean Validation lives at the field level (`@NotNull`, `@Size`, `@Min`, `@Pattern`, custom `@AssertTrue` methods). It is *complementary* to invariants, not a substitute:

- Bean Validation is **declarative**, runs at controller boundaries (`@Valid`), and is good for *input shape* checks.
- Invariants are **imperative**, run inside methods, and are good for *state transition* rules.

A senior codebase typically has both: Bean Validation at the DTO/request boundary, invariants inside the entity. They protect different layers.

---

## 8. Identifier types — formal characterisation

An identifier type `K` must satisfy:

- **Equality is reflexive, symmetric, transitive.** (Object contract.)
- **Equal keys produce equal hash codes.** (Object contract.)
- **Two keys generated independently for the same conceptual entity collide.** (Uniqueness scope.)
- **No "absent value" pretending to be a key.** (`0L`, empty string, default UUID `00000000-...` are not valid keys.)

For UUID, RFC 4122 / RFC 9562 (UUID v7) define the structure formally. For application-allocated `Long`, the *database sequence* is the source of truth — clients must not invent ids.

---

## 9. References

- Eric Evans, *Domain-Driven Design* (Addison-Wesley, 2003), chapter 5 ("A Model Expressed in Software"), pp. 89–112.
- Vaughn Vernon, *Implementing Domain-Driven Design* (Addison-Wesley, 2013), chapter 5 ("Entities"), pp. 167–198.
- Jakarta Persistence Specification 3.1 (2022), §§2.1, 2.4, 3.2, 3.4, 11.1.20.
- Jakarta Validation 3.0 Specification (2022).
- Hibernate ORM 6 User Guide, §2.7 ("Equality and hashing").
- Vlad Mihalcea, *High-Performance Java Persistence* (2nd ed., 2020), chapters 3, 11.
- RFC 9562 — *Universally Unique IDentifiers (UUIDs)*, IETF, 2024 (defines UUID v7).

---

**Memorize this:** the Entity contract has four mandatory clauses. **Identity** — a stable, unique `id`. **Equality** — `equals`/`hashCode` derive from the id alone, survive lifecycle transitions, and handle proxies via `instanceof`. **Lifecycle** — transient → managed → detached → removed transitions preserve identity, and the in-session identity map guarantees reference equality. **Invariants** — the entity rejects invalid operations by throwing, never by silently producing inconsistent state, and all checks precede all mutations. Cite Evans (2003 §5) for the concept, Vernon (2013 §5) for the working pattern, JPA 3.1 (§2.1, §2.4, §3.2, §3.4) for the persistence-layer obligations. An entity that fails any clause is a row-with-getters-and-setters, not a domain entity.
