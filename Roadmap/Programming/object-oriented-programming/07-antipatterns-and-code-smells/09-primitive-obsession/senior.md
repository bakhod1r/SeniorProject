# Primitive Obsession — Senior

> **What?** The deeper end of typed-domain modelling: Value Objects in the DDD sense, the *tiny types* / *micro-types* movement, the Money trap (BigDecimal, rounding modes, currency arithmetic), UUID vs typed UserId, opaque IDs and brand types (the TypeScript analogy), the cost of overdoing it, and when *not* to wrap. By this level you know *what* the wrappers look like — the senior question is *which boundary to wrap, which to leave bare, and how to keep the codebase honest as it grows*.
> **How?** Treat typed wrappers as a budget. Each new type pays a small cognitive tax (read, import, understand). Spend the budget on types that *prevent bugs you've actually had* or *encode invariants you can't otherwise enforce*. Don't spend it on decoration.

---

## 1. Value Objects in DDD — what the term actually means

In Domain-Driven Design (Eric Evans, 2003), a **Value Object** is an immutable concept identified by *its attributes*, not by an identity:

- **No conceptual identity.** Two `Money(100, USD)` instances are interchangeable. Compare a `Customer` (entity, identified by `CustomerId`) — two customers with the same name are still different customers.
- **Immutable.** Once constructed, the value cannot change. Operations return new instances.
- **Self-validating.** Invariants live in the constructor (or compact constructor); no `Money` instance violates currency or sign rules.
- **Side-effect free.** Methods that return new values do not mutate state anywhere.

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException(
                "scale %d exceeds %s precision %d".formatted(
                    amount.scale(), currency, currency.getDefaultFractionDigits()));
        }
    }

    public Money plus(Money other) {
        requireSame(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money scale(BigDecimal factor, RoundingMode rm) {
        return new Money(
            amount.multiply(factor).setScale(currency.getDefaultFractionDigits(), rm),
            currency);
    }

    private void requireSame(Money o) {
        if (!currency.equals(o.currency)) throw new IllegalArgumentException();
    }
}
```

This is a textbook DDD value object: identity by value, immutable, self-validating, behaviour lives with the data.

---

## 2. Tiny types — the micro-types movement

Darren Hobbs coined "tiny types" in 2007; Jim Bain popularised the idea (also known as "micro-types"): wrap *every* domain primitive, no matter how small.

```java
public record FirstName(String value) {}
public record LastName(String value)  {}
public record Age(int value) {
    public Age { if (value < 0 || value > 150) throw new IllegalArgumentException(); }
}
public record EmailDomain(String value) {}
public record IpAddress(String value) {}
public record IsoCountryCode(String value) {}
```

The argument for tiny types: the compiler catches every confusable-primitive swap; the IDE auto-imports tell a complete story of the domain.

The argument against tiny types in production Java: the wrapper *allocation cost* and the *cognitive load* of 200 micro-types in a 50-class service. Java doesn't yet have zero-cost value types (see Project Valhalla in `professional.md`), so each wrapper is a heap object on every operation.

The pragmatic middle:

| When                                              | Wrap?               |
|---------------------------------------------------|---------------------|
| Two primitives of the same type at one call site  | Yes                 |
| A primitive with non-trivial validation           | Yes                 |
| A primitive with associated behaviour             | Yes                 |
| A primitive that crosses module/team boundaries   | Yes                 |
| A primitive used inside a single method, no risk  | No                  |
| A primitive in a hot loop where allocation hurts  | Measure first       |

Tiny types are a *style*, not a rule. Apply them where the bug surface is real.

---

## 3. The Money trap — `double`, `long cents`, and `BigDecimal`

Money is the canonical example of Primitive Obsession because each common primitive choice is wrong in a different way.

**`double` for money — wrong.**

```java
double price = 0.1 + 0.2;
System.out.println(price);   // 0.30000000000000004
```

IEEE-754 binary floating point cannot represent `0.1` exactly. After enough operations, your books are off by pennies. Most finance regulators consider this a bug.

**`long cents` for money — better, but still primitive-obsessed.**

```java
long balanceCents = 0;
balanceCents += 100;   // okay for additions
balanceCents *= 1.075; // not a `long` operation — compiler error or precision loss
```

Currency-aware multiplication (tax, interest, FX) needs rational arithmetic. Pure `long` cents can't express it without conversion.

**`BigDecimal` — the right primitive, the wrong type to expose.**

```java
public void debit(BigDecimal amount, String currency) { ... }   // still primitive-obsessed
```

`BigDecimal` is *the* correct number for money inside a Money object — but exposing `BigDecimal` and `String currency` separately is still two primitives masquerading as a concept. The Money record from §1 is the destination.

**Rounding mode matters.**

```java
new BigDecimal("0.125").setScale(2, RoundingMode.HALF_UP);    // 0.13
new BigDecimal("0.125").setScale(2, RoundingMode.HALF_EVEN);  // 0.12 (banker's rounding)
```

Banks typically require `HALF_EVEN` (avoids systematic upward bias over many transactions). Make the rounding mode part of the Money API, not a per-call argument.

```java
public Money applyTaxRate(BigDecimal rate) {
    return new Money(
        amount.multiply(rate).setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_EVEN),
        currency);
}
```

---

## 4. UUID vs typed UserId — opaque identifiers

A common debate: should `UserId` wrap a `UUID`, a `long`, or a `String`?

```java
public record UserId(UUID value) {}
public record OrderId(UUID value) {}
public record ProductSku(String value) {}
```

The *content* of an ID is a detail of the persistence layer. The *type* matters to every layer above persistence. Wrapping the ID in a domain type lets you switch the underlying representation later (long to UUID for sharding, UUID to ULID for time-sortable IDs) without touching anything above the repository.

A `UUID` field is also a guard against ID confusion across entities:

```java
// Without wrappers — three UUIDs the type system can't distinguish:
public void transfer(UUID fromUserId, UUID toUserId, UUID accountId) { ... }

// With wrappers — swaps become compile errors:
public void transfer(UserId fromUser, UserId toUser, AccountId accountId) { ... }
```

**Use UUID or ULID, not auto-increment `long`, when the ID is *exposed externally*.** Sequential IDs leak business volume (a competitor counting your order IDs).

---

## 5. Brand types — the TypeScript analogy

TypeScript has *brand types* (also called *nominal* or *opaque* types), which encode a fake "tag" into a structural type to prevent assignment:

```typescript
type Email  = string & { readonly __brand: 'Email' };
type UserId = string & { readonly __brand: 'UserId' };

function send(email: Email) { /* ... */ }

const e: Email = 'a@b.c' as Email;   // explicit brand cast
const u: UserId = 'u-7f9' as UserId;
send(u);   // TS2345: UserId not assignable to Email
```

Java has *nominal* typing by default — `record Email(String value)` and `record UserId(String value)` are nominally distinct even though they wrap the same underlying type. Java's nominal typing achieves the same goal as TypeScript brand types, but at the cost of a heap allocation per wrap.

This is a clue: in a language where wrapping is free (TypeScript, Haskell `newtype`, Scala's value classes, Project Valhalla), tiny types are universally adopted. In Java today they are a budgeted choice — until Valhalla, when the allocation cost disappears.

---

## 6. The `String` you should not wrap

Not every `String` deserves a wrapper. Three cases where wrapping is overkill:

- **Free-form user content.** A blog post body, a chat message, a search query. They have no invariants worth checking and no risk of confusion with another `String`.
- **Single-use locals.** A `String greeting = "Hello " + name;` inside one method does not benefit from `Greeting`.
- **External protocol payloads** at the lowest layer. The body of an HTTP response is a `String` (or `byte[]`) at the transport level. Wrap when it enters your domain, not before.

The rule of thumb: **wrap when the value crosses a method or class boundary and the type carries meaning the next reader needs**. A local does not cross a boundary.

---

## 7. When wrappers hurt — performance and ergonomics

Java records are heap-allocated. A `record Money` is two object headers per instance, plus the payload, plus a reference. In a *hot loop* this matters:

```java
Money total = new Money(0L, USD);
for (LineItem item : huge_list) {
    total = total.plus(item.unitPrice().times(item.quantity()));
    // each iteration allocates two new Money instances
}
```

Three escape hatches:

- **Trust the JIT.** Modern HotSpot's escape analysis often proves the intermediate `Money` instances never escape the method and *scalar-replaces* them into registers. Benchmark before pessimising.
- **Inline the hot path.** For one critical loop, drop to `long cents` *inside* the loop and re-wrap at the end. The Money type stays at the public API.
- **Wait for Valhalla.** JEP 401 (Value Classes and Objects, preview) lets a record-like type live without a heap allocation. We cover this in `professional.md` and `optimize.md`.

Ergonomic costs are equally real:

- Stack traces grow — every wrap/unwrap is a method call.
- `equals` comparisons go through the wrapper, which means the JIT must inline the accessor. Usually does, but verify on critical paths.
- IDE auto-complete and Javadoc lookups get one indirection deeper.

These are not arguments against wrappers — they're arguments against *blanket* wrapping. Wrap where it pays.

---

## 8. The opaque identifier pattern

For IDs in particular, expose them as *opaque* outside their owning module: no arithmetic, no comparison except equality, no construction from raw primitives.

```java
public final class UserId {
    private final UUID value;
    private UserId(UUID value) { this.value = Objects.requireNonNull(value); }

    public static UserId of(UUID value) { return new UserId(value); }
    public static UserId fresh() { return new UserId(UUID.randomUUID()); }

    UUID rawValue() { return value; }   // package-private — only the user module unwraps

    @Override public boolean equals(Object o) {
        return o instanceof UserId other && value.equals(other.value);
    }
    @Override public int hashCode() { return value.hashCode(); }
    @Override public String toString() { return "UserId(" + value + ")"; }
}
```

Code outside the `user` package cannot pull the `UUID` out. They can compare `UserId`s, store them in maps, and pass them around — that's all. Inside the user module, the repository can unwrap to bind a JDBC parameter.

This is the *opaque ID* pattern. It is the strongest form of typed-wrapping for identifiers, and it stops most ID-confusion bugs at compile time.

---

## 9. Anti-patterns at this level

**Anti-pattern 1: tiny types for transport DTOs.**

```java
public record UserResponseDto(Email email, FullName name) {}   // returned to JSON
```

The DTO will be serialised to JSON, which doesn't know about your wrappers. Either you write a custom Jackson serialiser per wrapper (a chore), or the wrapper serialises as `{"value": "alice@example.com"}` which leaks the type into the public API. Keep DTOs primitive; wrap on the way *in*.

**Anti-pattern 2: wrapping primitives that never get confused.**

```java
public record HttpStatusCode(int value) {}
public record HttpHeader(String value)  {}
```

Inside an HTTP framework, both of these have meaning, but they never get confused with anything else. Wrapping them adds friction without removing bugs.

**Anti-pattern 3: wrappers without equals semantics.**

```java
public final class UserId {
    private final UUID value;
    public UserId(UUID value) { this.value = value; }
    // missing equals/hashCode
}

Set<UserId> seen = new HashSet<>();
seen.add(new UserId(uuid));
seen.contains(new UserId(uuid));   // false — different instance, default equals
```

Always implement `equals`/`hashCode` for value objects. `record` does this for you; classes don't.

**Anti-pattern 4: silent normalisation losing information.**

```java
public record Email(String value) {
    public Email {
        value = value.toLowerCase();   // normalised
    }
}

// User entered "Alice@Example.com" — you store and display "alice@example.com"
// without telling them. They wonder why their email looks different.
```

If you normalise, document it. Some projects distinguish *canonical form* from *display form* — `Email` carries both.

---

## 10. Quick rules

- [ ] **Value objects** carry data *and* behaviour, are immutable, validate themselves, and have value-based equality.
- [ ] **Money** uses `BigDecimal` internally, carries `Currency`, fails loudly on cross-currency operations.
- [ ] **IDs** are opaque — no construction from raw primitives outside the owning module, no arithmetic, equality only.
- [ ] **Tiny types** are a *budget* — spend on bug-prevention, not decoration.
- [ ] **Boundary discipline** — convert at the edge (controller, mapper), use wrappers everywhere inside.
- [ ] **Don't wrap** free-form content, single-use locals, or transport payloads at the lowest layer.

---

## 11. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Project Valhalla, JEP 401, ArchUnit enforcement                    | `professional.md`  |
| Metrics, thresholds, sample rules                                  | `specification.md` |
| Production bugs caused by primitive obsession                      | `find-bug.md`      |
| Allocation cost, scalar replacement, autoboxing                    | `optimize.md`      |
| Exercises                                                          | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |

Related smells:

- [Data Clumps](../08-data-clumps/) — when wrappers naturally cluster into a parameter object.
- [Anemic Domain Model](../02-anemic-domain-model/) — value objects are how you give the model behaviour back.
- [Immutability](../../05-immutability/) — value objects must be immutable; the patterns transfer.

---

**Memorize this:** Wrappers are a *budget* you spend on bug-prevention. Money uses `BigDecimal` + `Currency`, IDs are opaque, value objects validate in the compact constructor. Don't wrap free-form text. Don't wrap inside a method that nobody else calls. Wrap where the next reader needs the type to tell them what they're holding.
