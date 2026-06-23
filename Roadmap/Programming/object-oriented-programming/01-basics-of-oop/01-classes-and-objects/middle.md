# Classes and Objects — Middle

> **Why?** Classes exist to bundle data with the operations that protect its invariants, so callers can think in terms of *what* they want done instead of *how* the data is laid out.
> **When?** Use a class whenever a group of fields only makes sense together, when there are rules about valid states, or when behavior naturally lives next to the data it touches.

---

## 1. The job a class actually does

A class is not a "data container with methods stuck on it." It exists to enforce **invariants** — facts that must always be true about an object — by being the single owner of the data behind those facts.

```java
public final class Email {
    private final String value;

    public Email(String raw) {
        if (raw == null || !raw.contains("@")) {
            throw new IllegalArgumentException("Invalid email: " + raw);
        }
        this.value = raw.toLowerCase();
    }

    public String value() { return value; }
}
```

Invariant: *"every Email instance contains a non-null, lowercased string with an `@`."* That guarantee is impossible to break from the outside — there is no setter, no public field, and the constructor refuses bad input. Every method that takes an `Email` parameter can rely on the invariant without re-checking.

If you delete the class and pass `String email` everywhere, every caller becomes responsible for validation. That responsibility *will* be skipped somewhere, and you have a bug.

---

## 2. Identity vs equality — and why you choose

Two questions you must answer for every class:

1. **Identity**: are two references the same physical object? (`==`)
2. **Equality**: do two objects represent the same value? (`.equals(...)`)

The default `Object.equals` is identity. You override it when the class represents a *value*.

```java
public final class Money {
    private final long cents;
    private final String currency;

    public Money(long cents, String currency) {
        this.cents = cents;
        this.currency = Objects.requireNonNull(currency);
    }

    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Money m)) return false;
        return cents == m.cents && currency.equals(m.currency);
    }

    @Override public int hashCode() { return Objects.hash(cents, currency); }
}
```

Rule of thumb:

| Kind                   | Equality strategy           | Examples                                  |
|------------------------|-----------------------------|-------------------------------------------|
| **Value object**       | Override `equals`/`hashCode` based on fields | `Money`, `Email`, `Point`, `LocalDate`     |
| **Entity**             | Identity by ID, not all fields | `User#id`, `Order#orderNumber`            |
| **Service / stateless**| Don't override — identity is fine | `EmailSender`, `PriceCalculator`          |

Mixing these up is one of the top sources of subtle bugs (see `find-bug.md`).

---

## 3. The `equals`/`hashCode` contract — the part that bites

Whenever you override `equals`, you **must** also override `hashCode`. The contract:

1. Reflexive: `x.equals(x)` is `true`.
2. Symmetric: `a.equals(b)` ⇔ `b.equals(a)`.
3. Transitive: `a.equals(b)` and `b.equals(c)` ⇒ `a.equals(c)`.
4. Consistent: repeated calls give the same answer if nothing relevant changed.
5. `x.equals(null)` is `false`.
6. **Equal objects must have equal hash codes.**

Break rule 6 and your object misbehaves silently in `HashMap`, `HashSet`, caches, deduplication — anywhere hashing is used.

```java
Map<Money, String> notes = new HashMap<>();
notes.put(new Money(100, "USD"), "lunch");
notes.get(new Money(100, "USD"));   // null if hashCode is broken
```

The pragmatic version: derive both from the same set of "identity fields" and never include mutable fields in either method.

---

## 4. Mutable vs immutable classes — pick on purpose

A class is **immutable** if no method ever changes its state after construction.

```java
public final class Point {                 // final → no subclass can break immutability
    private final int x;                   // final fields → cannot be reassigned
    private final int y;

    public Point(int x, int y) { this.x = x; this.y = y; }
    public int x() { return x; }
    public int y() { return y; }
    public Point shift(int dx, int dy) { return new Point(x + dx, y + dy); }
}
```

Use immutable when:

- The object represents a **value** (money, dates, coordinates, IDs).
- It will be **shared** across threads, caches, sets, or map keys.
- You want **safe APIs** — callers can't mutate your internals behind your back.

Use mutable when:

- The object models a long-lived **entity** with evolving state (`Order`, `Game`, `Connection`).
- You need to update parts incrementally without churn.

Two thirds of new value-shaped classes should be immutable. Don't reach for setters by reflex.

---

## 5. Mutable state — the rules that keep you sane

If a class *must* be mutable, follow these:

**(a)** Validate in setters with the same strictness as the constructor.

```java
public void setRetries(int retries) {
    if (retries < 0) throw new IllegalArgumentException("negative retries");
    this.retries = retries;
}
```

**(b)** Defensive-copy on the way in **and** out for collection or array fields.

```java
public Order(List<OrderLine> lines) {
    this.lines = List.copyOf(lines);          // attacker can't keep their reference
}
public List<OrderLine> lines() {
    return Collections.unmodifiableList(lines); // caller can't mutate
}
```

**(c)** Don't expose `Date`, `Calendar`, or arrays without copying — they are mutable and old APIs forgot to defend.

**(d)** Document threading expectations. "Not thread-safe" is a valid contract; "thread-safe through internal synchronization" is another. Silence is not.

---

## 6. Constructors are the front door — keep them strict

Inside a constructor:

- Validate **every** parameter (null, range, format).
- Establish **all** invariants before the constructor returns.
- Don't call **overridable methods** — subclasses can observe a half-built object (see `find-bug.md`).
- Don't leak `this` to other threads or registries before construction finishes.
- Don't do I/O or heavy work — that belongs in factory methods or builders.

```java
// 🚫 problem: leaks `this` while still constructing
public Listener(EventBus bus) {
    bus.register(this);                  // bus may now invoke handlers on a half-built Listener
    this.cache = new HashMap<>();
}

// ✅ register after construction completes
public Listener() { this.cache = new HashMap<>(); }
public void start(EventBus bus) { bus.register(this); }
```

---

## 7. Static factory methods — when constructors aren't enough

A constructor:

- Has the same name as the class (no clarity in name).
- Always allocates a fresh instance.
- Cannot return a subtype.

A static factory method has none of those constraints:

```java
public final class Money {
    private final long cents;
    private final String currency;

    private Money(long cents, String currency) { ... }

    public static Money usd(long cents)  { return new Money(cents, "USD"); }
    public static Money eur(long cents)  { return new Money(cents, "EUR"); }
    public static Money zero(String ccy) { return new Money(0, ccy); }
}

Money lunch = Money.usd(1500);
```

Reach for static factories when you need:

- **Names** that explain intent (`Money.usd`, `List.of`, `Optional.empty`).
- **Caching** of common instances (`Boolean.valueOf`, `Integer.valueOf` for small ints).
- A return type that varies (`Collections.unmodifiableList` returns a hidden subtype).
- Step-by-step construction beyond what a single ctor can express → consider a Builder.

---

## 8. The Builder pattern (when ctors get out of hand)

Once a constructor has more than ~4 parameters or several optional ones, callers stop reading and start guessing.

```java
HttpRequest req = HttpRequest.newBuilder()
    .uri(URI.create("https://example.com"))
    .header("Accept", "application/json")
    .timeout(Duration.ofSeconds(2))
    .GET()
    .build();
```

Builder pros: readable named arguments, optional fields, validation in `build()`.
Builder cons: more code to write/maintain. Use it when the win is real, not for every 3-field class.

---

## 9. Nullability is a contract, write it down

Every reference field, parameter, and return value either *can* be `null` or *cannot*. Decide for each one and **declare it**.

Three common styles, in increasing strictness:

```java
// 1. Documented in javadoc + Objects.requireNonNull
public Order(Customer customer) {
    this.customer = Objects.requireNonNull(customer, "customer");
}

// 2. JSR-305 / JetBrains annotations
public @NonNull Order place(@NonNull Cart cart, @Nullable Coupon coupon) { ... }

// 3. Optional in the return type
public Optional<Discount> findDiscount(Cart cart) { ... }
```

Don't return `null` from collection methods — return an empty collection. Don't take `Optional` as a *parameter* — it adds noise without help.

---

## 10. `final` on classes, fields, and parameters

```java
public final class Money { ... }              // can't be subclassed
private final String currency;                 // can't be reassigned
public void log(final String message) { ... }  // can't be reassigned in this method
```

Practical defaults:

- **Field `final`**: yes by default. Declare mutability deliberately.
- **Class `final`**: when the class is a value type, when you don't want subclassing to be part of your contract, or when the class would be unsafe to subclass.
- **Parameter `final`**: optional sugar. It does not affect the caller, only the method body.

`final` is one of the cheapest invariants you can add. Use it.

---

## 11. `toString` — for humans first, code second

`toString` is for **logs and diagnostics**, not parsing.

```java
@Override
public String toString() {
    return "Money[%d.%02d %s]".formatted(cents / 100, Math.abs(cents % 100), currency);
}
```

Rules:

- Include identifying fields. Skip secrets (passwords, tokens, PII).
- Don't depend on it for business logic — change-resistant code does not parse `toString`.
- Records get a free, sane `toString`. Take advantage.

---

## 12. When **not** to make a class

Not everything deserves a class:

- A pure function with no state → make it a `static` method on a utility class or a method on the type it acts on.
- A bag of two unrelated values → consider a record. Don't ship `Pair<Integer, String>` from your domain layer.
- A class with one method named `execute()` → that's a lambda or a `Function`. Use one.

Adding a class always adds a name, a type, and a level of indirection. The win must justify the cost.

---

## 13. State diagram of a typical entity

```
   construct (validated)
        │
        ▼
  ┌──────────┐  business operation  ┌──────────┐
  │ valid    │ ───────────────────▶ │ valid    │
  │ state A  │ ◀─────────────────── │ state B  │
  └──────────┘   business operation └──────────┘
        │
        ▼
   reachable by GC → reclaimed
```

The class's job is to make **every transition between valid states atomic and validated**. There is no "almost valid" middle. Either every method preserves the invariants or your invariants are not invariants — they're hopes.

---

## 14. Common middle-level mistakes

| Mistake                                       | Why it bites                          | Fix                                |
|-----------------------------------------------|---------------------------------------|------------------------------------|
| Public mutable fields                         | Anyone can break invariants           | `private` + accessor methods       |
| Overrode `equals` but not `hashCode`          | `HashMap` lookups silently fail       | Override both; use IDE/Lombok      |
| Mutable fields in `equals`/`hashCode`         | Object's hash changes after insertion | Hash only stable identity fields   |
| Returning internal `List` directly            | Callers mutate your state             | `List.copyOf` or unmodifiable view |
| Calling overridable methods in constructor    | Subclasses see half-built objects     | Use `private` or `final` for ctor helpers |
| Setters that skip validation                  | Object enters illegal state silently  | Repeat ctor checks in setters      |
| `null` returned from a collection getter      | Caller gets NPE on `forEach`          | Return empty collection            |
| Storing a `Date` directly                     | Caller mutates and you don't notice   | Use `java.time` (immutable)         |

---

## 15. The middle-level checklist for any new class

1. What invariant does this class own?
2. Is it a **value** or an **entity**? Pick equality strategy.
3. Mutable or immutable? Default to immutable; justify mutable.
4. Are constructor parameters validated and non-null where required?
5. Are collection / array fields defensively copied in and out?
6. `equals` and `hashCode` consistent with the equality strategy?
7. `toString` useful for logs, free of secrets?
8. No overridable calls from the constructor?
9. Is there a clearer alternative — `record`, `enum`, lambda, `static` method?

If you can answer all nine without flinching, you're already past most production OOP bugs.
