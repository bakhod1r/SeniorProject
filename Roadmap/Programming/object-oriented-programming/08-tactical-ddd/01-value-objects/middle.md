# Value Objects — Middle

> **What?** At the Middle level you stop treating Value Objects (VOs) as "small immutable classes" and start treating them as the **default modelling tool** for any domain concept that lacks identity. You learn the precise contrast with Entities, you learn to lean on Java `record` (JEP 395) as the canonical VO carrier, and you learn to migrate primitive-obsessed code into a VO-rich design — one type at a time, without breaking callers.
> **How?** For every primitive field in your domain model, run a two-question test: "Does this concept have an id that survives attribute changes?" and "Would two instances with the same attributes be interchangeable?" If the answers are *no* and *yes*, it's a Value Object. Encode it as a `record` with a compact constructor that validates and normalizes inputs, and let the rest of the code stop second-guessing primitives.

---

## 1. The crisp line between VO and Entity

Eric Evans's *Domain-Driven Design* (2003) draws the line on **identity**:

| Question | Value Object | Entity |
|---|---|---|
| Has an id distinct from its attributes? | No | Yes |
| Survives attribute changes as "the same thing"? | No — change a field, it's a new value | Yes — change the email, still the same customer |
| Equality based on? | All attributes | The id only |
| Lifecycle? | Created, used, discarded | Created, persisted, evolved, retired |
| Mutation? | None — replace wholesale | Allowed (carefully) on the entity's state |
| Storage? | Embedded inside its owner | A row of its own with PK |

A useful informal test: **"Could I substitute one for another with the same fields and nobody would notice?"** If yes → VO. If somebody would notice (because that *specific* thing has history, references, money attached, ...) → Entity.

`Money(100, "USD")` — anyone with a hundred-dollar bill is interchangeable. VO.
`BankAccount(id=42, balance=Money(100, "USD"))` — the bank cares *which* account this is. Entity.

A single field of an Entity is often a VO: `BankAccount.balance` is a `Money` VO; `Customer.email` is an `Email` VO; `Order.shippingAddress` is an `Address` VO. **Entities are containers of VOs.**

---

## 2. Java records are the canonical VO carrier

Before records (JEP 395, Java 16), writing a correct VO took ~40 lines of boilerplate: private final fields, an all-args constructor, accessor methods, `equals`, `hashCode`, `toString`, and code review to verify you got each right. Records collapse all of that:

```java
public record Money(long cents, String currency) { }
```

Six tokens, and you get:

- Private final fields `cents` and `currency`.
- An automatically generated canonical constructor.
- Accessors `cents()` and `currency()`.
- `equals` based on both components.
- `hashCode` based on both components.
- `toString` showing both components.
- The class is implicitly `final`.

That covers four of the five VO rules (final fields, equals-by-value, hashCode contract, no inheritance vector). The fifth — **validation** — you add via the *compact constructor*.

### The compact constructor — your validation gate

```java
public record Money(long cents, String currency) {
    public Money {                                  // compact constructor
        if (cents < 0)
            throw new IllegalArgumentException("Money cannot be negative");
        if (currency == null || currency.length() != 3)
            throw new IllegalArgumentException("Currency must be ISO-4217: " + currency);
        currency = currency.toUpperCase();          // normalize before assignment
    }
}
```

Notes a junior often misses:

- The compact constructor has **no parameter list** and **no explicit assignment**. The compiler inserts the field assignments *after* your validation block runs.
- Reassigning a parameter (`currency = currency.toUpperCase()`) inside the compact constructor changes what gets stored. This is the canonical place to normalize inputs (trim, lowercase, intern, round).
- Throw early. The constructor's job is "either build a valid instance or refuse to build at all".

---

## 3. Replacing a primitive with a VO — the migration recipe

This is the operation you'll perform most often. Say your codebase is littered with:

```java
public void register(String email, String name) { ... }
public Customer findByEmail(String email) { ... }
public boolean isEmailTaken(String email) { ... }
```

Three callsites, three independent validations, three lowercase-or-not policies. Replace `String email` with an `Email` VO in three reviewable steps.

### Step 1 — introduce the VO

```java
public record Email(String value) {
    private static final java.util.regex.Pattern RX =
        java.util.regex.Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    public Email {
        java.util.Objects.requireNonNull(value, "email");
        var v = value.trim().toLowerCase(java.util.Locale.ROOT);
        if (!RX.matcher(v).matches())
            throw new IllegalArgumentException("invalid email: " + value);
        value = v;
    }
}
```

### Step 2 — change the signatures one at a time

```java
public void register(Email email, String name) { ... }
public Customer findByEmail(Email email) { ... }
public boolean isEmailTaken(Email email) { ... }
```

Each callsite now has to wrap its `String` in `new Email(...)`. That looks like extra friction — but every wrap is *the validation that used to be missing*.

### Step 3 — push the wrap to the boundary

The wrap belongs at the *system boundary* — the controller or message consumer — not deep inside services. Once the boundary creates an `Email`, every interior method receives the VO and trusts it.

```java
@PostMapping("/users")
public ResponseEntity<?> create(@RequestBody UserRequest req) {
    var email = new Email(req.email());          // validation happens here
    userService.register(email, req.name());
    return ResponseEntity.ok().build();
}
```

After migration, the `String email` parameter has *disappeared* from the application layer. The compiler now enforces "you can only call `register` with something that passed Email validation".

---

## 4. Why "replace the primitive" is worth the friction

A `String` parameter is a *promise of nothing*. It might be null, empty, lowercase, uppercase, validated, unvalidated, trimmed, padded, or come from a hostile source. Every method that touches it has to defend itself, or trust upstream blindly.

An `Email` parameter is a *promise of validity*. The only way to construct it is through a constructor that has already validated. Every method that touches it can trust its contract.

This is the same kind of leverage you get from making a field `final`: you trade a tiny amount of construction-site friction for a massive reduction in downstream uncertainty.

A simple before/after to feel the difference:

```java
// Before — primitive obsession
public void send(String email, String subject, String body, String from) {
    if (email == null || !email.contains("@")) throw new ...;
    if (from == null || !from.contains("@"))   throw new ...;
    // ... 30 more lines, some of which forget to validate
}

// After — VO-rich
public void send(Email to, String subject, String body, Email from) {
    // no validation needed; the types guarantee it
}
```

Two parameters dropped, two validations dropped, two whole categories of bug eliminated, and a swapped-arguments mistake (`send(from, subject, body, to)`) no longer compiles if `to` and `from` are typed.

---

## 5. Mini-catalog — what reaches for record vs class

Most of the time, `record` is the right tool. But four situations push you back to a plain `final class`:

| Situation | Use record? | Why |
|---|---|---|
| Two scalar components, both visible | Yes | Records were designed for this. |
| Need a no-arg/lazy "null object" instance | record | `public static final Money ZERO = new Money(0, "USD");` |
| Need to hide one component from the accessor | No | Records expose all components via accessors. |
| Need to extend an abstract base class | No | Records cannot extend (they're implicitly `final` and extend `Record`). |
| Need invariants involving *derived* state that should be cached | Maybe | Possible with records, but a `final class` is cleaner. |
| Implements a sealed interface | Yes | Records compose beautifully with sealed types (JEP 409). |

Default to `record`. Step back to `final class` only when one of those four situations bites.

---

## 6. Behaviour belongs *on* the VO

A common Middle-stage mistake is treating VOs as "anaemic data carriers" and putting all their behaviour in service classes:

```java
// Anaemic
public class MoneyService {
    public Money add(Money a, Money b) { ... }
    public boolean isZero(Money m)     { ... }
    public Money percentOf(Money m, int pct) { ... }
}
```

The VO is the natural home for these. The service exists for orchestration (DB, messaging, transactions), not for arithmetic on a value type. Vaughn Vernon (*Implementing Domain-Driven Design*, ch. 6) calls these methods *side-effect-free functions on the value type*.

```java
public record Money(long cents, String currency) {
    public Money plus(Money other)   { check(other); return new Money(cents + other.cents, currency); }
    public Money minus(Money other)  { check(other); return new Money(cents - other.cents, currency); }
    public Money percent(int pct)    { return new Money(cents * pct / 100, currency); }
    public boolean isZero()          { return cents == 0; }
    private void check(Money o) {
        if (!currency.equals(o.currency))
            throw new IllegalArgumentException("currency mismatch: " + currency + " vs " + o.currency);
    }
}
```

`Money` now reads like a vocabulary: `price.plus(tax).percent(95).isZero()`. Every method returns a fresh value. None mutate. None do I/O. This is the texture of a healthy domain model.

---

## Memorize this

- **Identity is the dividing line**: no id → VO; has id → Entity.
- Java `record` (JEP 395) is the canonical VO carrier — final, equality-by-value, hashCode-correct, all for free.
- Validate and normalize inputs in the **compact constructor**; throw on invalid, never accept silently.
- Push the construction (and thus validation) of VOs to the **system boundary**; interior code receives VOs and trusts them.
- Replacing a primitive (`String email`, `BigDecimal price`) with a VO trades a little wrap-site friction for the disappearance of a whole class of bugs.
- Put **behaviour on the VO**, not in a service. `money.plus(other)` is healthy; `MoneyService.add(a, b)` is anaemic.
- A VO returns *new* VOs from its methods; it never mutates `this`.
- An Entity is a *container of VOs* — `Customer.email`, `Account.balance`, `Order.shippingAddress` are all VOs inside an Entity.
- Reference: Evans ch. 5; Vernon ch. 6; JEP 395.
