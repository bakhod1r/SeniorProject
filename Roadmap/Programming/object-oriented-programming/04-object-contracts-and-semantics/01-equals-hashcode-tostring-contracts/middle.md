# equals / hashCode / toString Contracts — Middle

> **What?** The mechanical recipe for writing `equals` and `hashCode` by hand, the field-by-field discipline that keeps the five clauses true, the hash quality argument (why prime numbers, why `Objects.hash`), and the refactor moves that turn legacy `equals` written in the early 2000s into modern, contract-respecting code. Records as the shortcut, and when records are the wrong shortcut.
> **How?** For every new value class, default to a record. When you can't (frameworks, legacy hierarchies, mutable middle layers), follow a six-step recipe, run it field by field, then write a small contract test. Refactor legacy `equals` by replacing nested null checks with `Objects.equals`, replacing manual hash arithmetic with `Objects.hash`, and replacing string-typed messages in `toString` with `String.format` or `StringBuilder`.

---

## 1. Why a recipe at all

Hand-written `equals` and `hashCode` are *recipe-following* code. They look short, they look obvious, and they trip every Java developer who tries to invent them from scratch. The five clauses of the `equals` contract (reflexive, symmetric, transitive, consistent, non-null) are easy to violate in ways that compile and pass most tests but fail under a `HashSet`, a JPA proxy, or a cross-classloader call.

Modern Java offers two shortcuts: records (JEP 395) for new value classes, and IDE generation (IntelliJ, Eclipse) for legacy classes. Both produce *correct* code by following the same six-step recipe. Knowing the recipe by hand still matters — every PR that touches `equals` deserves a reviewer who can see at a glance which step the author skipped.

This file walks the recipe, applies it to four realistic domain types (`Money`, `OrderLine`, `Customer`, `BookingId`), shows when records are the right move and when they aren't, and ends with a refactoring pass that takes a 2003-era `equals` and modernises it without changing semantics.

---

## 2. The recipe in six steps

For any class where two instances should be equal when their *important fields* are equal, write `equals` like this:

1. **Reflexive shortcut.** `if (this == o) return true;` — fastest path; also defends against weird `equals` implementations on the right-hand side.
2. **Null + type guard.** `if (!(o instanceof MyType other)) return false;` — handles `null` and wrong-type cases in one line (JEP 394, pattern variables).
3. **Field-by-field comparison.** Use `==` for primitives, `Objects.equals(...)` for reference types (handles null), `Float.compare` / `Double.compare` for floating-point fields, `Arrays.equals(...)` for arrays.
4. **Return the conjunction.** Combine with `&&`.

Then write `hashCode`:

5. **Single field:** `return Objects.hashCode(field);`
6. **Multiple fields:** `return Objects.hash(field1, field2, field3);`

Then write `toString` (no contract, only convention):

```java
@Override public String toString() {
    return getClass().getSimpleName()
        + "[field1=" + field1 + ", field2=" + field2 + "]";
}
```

That is the whole recipe. Every byline in this file is a variation on those eight lines.

---

## 3. Worked example — `Money`

`Money` is the textbook value class — a `BigDecimal` amount plus a currency. Two `Money` instances are equal when both fields match.

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency   currency;

    public Money(BigDecimal amount, Currency currency) {
        this.amount   = Objects.requireNonNull(amount);
        this.currency = Objects.requireNonNull(currency);
    }

    public BigDecimal amount()    { return amount; }
    public Currency   currency()  { return currency; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Money m)) return false;
        return amount.equals(m.amount) && currency.equals(m.currency);
    }

    @Override
    public int hashCode() {
        return Objects.hash(amount, currency);
    }

    @Override
    public String toString() {
        return amount.toPlainString() + " " + currency.getCurrencyCode();
    }
}
```

Three subtleties to call out:

- **`BigDecimal.equals` is *scale-sensitive*.** `new BigDecimal("1.0").equals(new BigDecimal("1.00"))` is `false`, because the two values have different scales. If you want amounts with different scales to compare equal, normalise in the constructor (`amount.stripTrailingZeros()`) or compare with `compareTo == 0` instead of `equals`. The find-bug file shows what happens when a team gets this wrong in production.
- **Currency is reference-comparable.** `java.util.Currency` is interned by code (one instance per ISO 4217 code), so `==` would also work. `Objects.equals` (or `.equals`) is the safer habit — when you later swap `Currency` for a custom type, the call site still works.
- **`toString` does not use the class name.** `Money` is a domain primitive; `12.50 EUR` reads better in a log line than `Money[amount=12.50, currency=EUR]`. `toString` has no JDK-mandated format — pick the one that helps the on-call engineer.

The class is `final`. The fields are `final`. The constructor null-checks both inputs. The three methods are six lines combined. There is no path through this code where the contract can break.

---

## 4. Worked example — `OrderLine` (record)

`OrderLine` is another pure value: a product SKU, a quantity, a unit price. Records make this a one-liner.

```java
public record OrderLine(String sku, int quantity, Money unitPrice) {
    public OrderLine {
        Objects.requireNonNull(sku);
        Objects.requireNonNull(unitPrice);
        if (quantity <= 0) throw new IllegalArgumentException("quantity must be > 0");
    }

    public Money lineTotal() {
        return new Money(
            unitPrice.amount().multiply(BigDecimal.valueOf(quantity)),
            unitPrice.currency());
    }
}
```

The compiler generates:

- `OrderLine(String, int, Money)` — canonical constructor (your compact constructor runs after argument binding).
- `sku()`, `quantity()`, `unitPrice()` — accessor methods (no `get` prefix; that is the record convention).
- `equals(Object)` — compares all three components using `Objects.equals` for the reference fields and `==` for the primitive.
- `hashCode()` — `Objects.hash(sku, quantity, unitPrice)` essentially.
- `toString()` — `OrderLine[sku=A-100, quantity=2, unitPrice=12.50 EUR]`.

For any new value class where you want the default semantics, *use a record*. You cannot get the `equals` contract wrong — the compiler writes it. You cannot forget to override `hashCode` — the compiler writes it. You cannot leak a debug-grade `toString` — the compiler writes that too.

The cases where records are *not* the right move:

- **Inheritance hierarchies.** Records cannot extend a class. If you need to extend a framework base class (rare; usually a smell), records are out.
- **Mutable equality.** If equality must reflect a field that changes — you almost never want this; see [../05-immutability-and-defensive-copying/](../05-immutability-and-defensive-copying/) — records cannot help, but neither should you.
- **JPA entities.** JPA wants no-arg constructors, lazy-loaded fields, and proxy subclasses; records fit none of those. JPA entities are identity-equal by their primary key, never by their record-style components. The senior file expands on this.
- **Frameworks that reflect over fields.** Some older frameworks call `setX` / `getX` reflectively. Records expose component accessors as `x()` (no prefix), which can confuse such frameworks. Modern frameworks (Jackson 2.12+, Spring 6, Hibernate 6.2+) handle records; older versions may not.

---

## 5. Worked example — `Customer` (entity, identity-equal)

Entities are equal by *identifier*, not by content. Two `Customer` objects with the same ID are the same customer, even if their other fields are stale or unloaded:

```java
public final class Customer {
    private final CustomerId id;          // value object wrapping a UUID/long
    private String name;                  // mutable — name changes on rebrand
    private String email;                 // mutable

    public Customer(CustomerId id, String name, String email) {
        this.id    = Objects.requireNonNull(id);
        this.name  = Objects.requireNonNull(name);
        this.email = Objects.requireNonNull(email);
    }

    public CustomerId id()      { return id; }
    public String     name()    { return name; }
    public String     email()   { return email; }
    public void       rename(String newName)  { this.name  = Objects.requireNonNull(newName); }
    public void       changeEmail(String e)   { this.email = Objects.requireNonNull(e); }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Customer c)) return false;
        return id.equals(c.id);             // identity-equal, by id only
    }

    @Override
    public int hashCode() {
        return id.hashCode();               // hashing on the immutable identifier
    }

    @Override
    public String toString() {
        return "Customer[id=" + id + ", name=" + name + ", email=" + email + "]";
    }
}
```

Three things to notice:

- **`equals` and `hashCode` use only `id`, never the mutable fields.** This is the only way to honour the consistency clause when `name` or `email` can change after the object is in a `HashSet`. The set still hashes the customer to the same bucket because `id` never changes.
- **`toString` includes everything.** Logging a customer should show the human-friendly fields; the contract only constrains `equals`/`hashCode`.
- **`CustomerId` is its own value class** (probably a record). Wrapping primitive IDs in a type prevents the most common bug — passing the wrong ID to the wrong service.

The general rule: **entities compare by ID, values compare by content.** If you cannot say in one sentence which one your class is, the design is unclear.

---

## 6. The hash-quality argument

Why does `Objects.hash` work? Why use prime numbers (the Bloch-era recipe used `result = 31 * result + field.hashCode()`)? Why does it matter?

A hash table buckets keys by `hashCode() % numBuckets`. If your `hashCode` returns the same value for many distinct keys, those keys all land in one bucket, and `HashMap` collapses to a *linked list* — `get` becomes O(n) instead of O(1). The whole point of a hash-based collection vanishes.

A *good* `hashCode` spreads the values uniformly across the `int` range so that `% numBuckets` distributes evenly. The Bloch recipe used 31 because:

1. It is prime, so multiplications don't introduce common factors with the bucket count.
2. `31 * x` can be computed as `(x << 5) - x` — a shift and a subtract, cheaper than a general multiply on older CPUs.

```java
// Bloch-era hashCode by hand (still seen in legacy code):
@Override public int hashCode() {
    int result = 17;
    result = 31 * result + (sku == null ? 0 : sku.hashCode());
    result = 31 * result + quantity;
    result = 31 * result + (unitPrice == null ? 0 : unitPrice.hashCode());
    return result;
}
```

`Objects.hash(...)` does the exact same arithmetic internally (it delegates to `Arrays.hashCode(Object[])`, which uses the 31-multiplier). The only difference is the cost of *boxing* the primitives and *allocating the varargs array* — irrelevant for 99% of code, measurable in tight loops where you might write the hash by hand. See [./optimize.md](./optimize.md) for the JMH numbers.

The collision-resistance question rarely matters in practice; the JDK's `HashMap` re-hashes every key with a *spread function* that XORs the high 16 bits into the low 16 bits, so even a mediocre `hashCode` distributes acceptably. What you absolutely must avoid is:

- **A constant `hashCode`** (e.g. `return 1`). Legal under the contract (equal objects share the hash), but every key collides — every `HashMap.put` walks the bucket linearly.
- **Identity hash on a value class.** Forgetting to override `hashCode` falls back to `Object.hashCode`, which is identity-based — equal objects get *different* hashes. Worse than a constant hash; breaks the contract.

Always use `Objects.hash` (or let a record do it for you). The day someone notices a 10% throughput gap because of varargs overhead, [./optimize.md](./optimize.md) walks the cache.

---

## 7. The `Objects` utility class

`java.util.Objects` (introduced in Java 7) is the contract-friendly toolkit. Three methods do most of the work:

```java
Objects.equals(a, b);              // null-safe a.equals(b)
Objects.hashCode(field);           // null-safe field.hashCode(), returns 0 for null
Objects.hash(f1, f2, f3, ...);     // hash combination for multiple fields
```

`Objects.equals` is what you reach for in field-by-field `equals` when a reference field might be null. Without it:

```java
return name.equals(other.name);    // NPE if name is null
```

With it:

```java
return Objects.equals(name, other.name);   // null-safe both sides
```

`Objects.requireNonNull(x, "x")` is the constructor-time null guard. Combined with `final` fields, it gives you the *non-null* clause of the contract (since you never store null, you never have to compare null) plus a clean stack trace at the offending constructor.

`Objects.toString(o, "<null>")` is a null-safe `toString` you can use inside your own `toString` when a field is nullable:

```java
return "Customer[id=" + id + ", lastLogin=" + Objects.toString(lastLogin, "<never>") + "]";
```

Three methods, three contracts respected. Most legacy `equals` written before Java 7 is a candidate for an `Objects.*` migration; section 11 walks one such refactor.

---

## 8. Floating-point, arrays, and other tricky fields

Some field types break the naive recipe:

**Floating-point.** `0.0 == -0.0` is `true`, but `Double.compare(0.0, -0.0)` is `-1`. `Float.NaN == Float.NaN` is *always false*, but `Float.compare(Float.NaN, Float.NaN)` is `0`. The contract demands reflexivity (a `NaN` field must equal itself), so use `Float.compare` / `Double.compare`:

```java
return Double.compare(latitude, other.latitude) == 0
    && Double.compare(longitude, other.longitude) == 0;
```

Records do this for you. Hand-written `equals` on floating-point fields must too.

**Arrays.** `array.equals(otherArray)` is reference equality — same allocation. Use `Arrays.equals(array, otherArray)` for shallow comparison, `Arrays.deepEquals` for nested arrays:

```java
return Arrays.equals(payload, other.payload);
```

For `hashCode`, use `Arrays.hashCode(array)` — `array.hashCode()` is the identity hash.

**Collections.** `List.equals`, `Set.equals`, `Map.equals` are well-defined and content-based, so `Objects.equals(list, otherList)` works as expected. Don't use `Arrays.equals` on a `List`.

**`BigDecimal`.** Scale-sensitive `equals`; section 3 covers it. If you want value-equal regardless of scale, use `compareTo`.

**Enums.** Enum constants are singletons — `==` and `.equals` are equivalent. Either is fine; `==` is the common idiom and matches `switch` semantics.

**Cyclic references.** A `Person` with a `partner` field that points back to another `Person` will recurse forever if `equals` traverses it. Either compare by identifier on cycle-prone fields, or detect cycles with a visited set. Most domain models avoid this by making one side of the relationship the "owner" and the other side comparing by ID only.

---

## 9. `toString` — conventions, not contracts

`Object.toString` has *no* contract beyond "return a string representation". The Javadoc *recommends* `getClass().getName() + '@' + Integer.toHexString(hashCode())` as a fallback, which is what you see in logs when someone forgot to override.

Useful conventions:

- **Format like a record.** `Money[amount=12.50, currency=EUR]` is readable in logs, greppable, and matches what records produce automatically. Reach for this default unless you have a reason not to.
- **Skip the class name when context is clear.** `12.50 EUR` reads better than `Money[amount=12.50, currency=EUR]` in a price log. For domain primitives the class name is noise.
- **Hide sensitive fields.** Passwords, tokens, social security numbers, full credit-card numbers, email addresses in some regulatory regimes — replace with `***` or omit. Find-bug bug 8 walks the consequences of leaking these.
- **Don't iterate huge collections.** `toString` should be cheap; if your object holds a million-entry list, print the size, not the contents.
- **Don't throw.** `toString` is called from exception stack traces, debugger watches, and assertion failures — at exactly the moment you most want diagnostics. A `toString` that throws masks the original error.

```java
@Override
public String toString() {
    return "User[id=" + id
         + ", name=" + name
         + ", email=" + maskEmail(email)
         + ", roles(" + roles.size() + ")=" + summary(roles) + "]";
}
private static String maskEmail(String e) {
    int at = e.indexOf('@');
    return at < 2 ? "***" : e.charAt(0) + "***" + e.substring(at);
}
```

Modern alternatives:

- **`StringJoiner`** (Java 8) — composes comma-separated lists cleanly.
- **`String.format`** — readable for templated output, slower than concatenation in hot paths.
- **Text blocks** (JEP 378, Java 15) — multi-line `toString` becomes pleasant for deep structures.

For records, the auto-generated `toString` is rarely worth overriding. When it is — usually to hide a sensitive component or to render a flat domain primitive — the override is one method, no contract impact.

---

## 10. Refactoring legacy `equals` — a worked move

This `equals` is from a real 2005-era codebase, simplified:

```java
public boolean equals(Object obj) {
    if (obj == null) return false;
    if (!(obj instanceof Reservation)) return false;
    Reservation other = (Reservation) obj;
    if (this.id == null) {
        if (other.id != null) return false;
    } else {
        if (!this.id.equals(other.id)) return false;
    }
    if (this.guest == null) {
        if (other.guest != null) return false;
    } else {
        if (!this.guest.equals(other.guest)) return false;
    }
    if (this.start == null) {
        if (other.start != null) return false;
    } else {
        if (!this.start.equals(other.start)) return false;
    }
    return true;
}

public int hashCode() {
    int hash = 17;
    hash = 31 * hash + ((id == null) ? 0 : id.hashCode());
    hash = 31 * hash + ((guest == null) ? 0 : guest.hashCode());
    hash = 31 * hash + ((start == null) ? 0 : start.hashCode());
    return hash;
}
```

It is correct. It compiles. It is 23 lines of `equals` that can be cut to four by using `Objects.equals`, and 8 lines of `hashCode` that can be cut to one by using `Objects.hash`. The reflexive shortcut is missing (a small perf miss but correct). The `instanceof` pre-dates pattern variables, so it casts manually.

The modernised version:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Reservation r)) return false;
    return Objects.equals(id, r.id)
        && Objects.equals(guest, r.guest)
        && Objects.equals(start, r.start);
}

@Override
public int hashCode() {
    return Objects.hash(id, guest, start);
}

@Override
public String toString() {
    return "Reservation[id=" + id + ", guest=" + guest + ", start=" + start + "]";
}
```

Same semantics, one third the lines, harder to break in review. The refactor is mechanical — IntelliJ's "regenerate equals/hashCode" gets you most of the way; the `instanceof` pattern variable is a manual touch.

If the class qualifies (no inheritance, all-final fields), the *next* refactor is to a record:

```java
public record Reservation(ReservationId id, GuestId guest, LocalDateTime start) { }
```

Three lines. The compiler writes everything. The class signs a stronger contract with its callers (it is `final`, the components are `final`, the canonical accessors exist) and removes the surface area where a future change could break the contract.

---

## 11. Contract tests — verifying the recipe held

Even with the recipe followed, write a small test that exercises each clause. The pattern is the same for every value class:

```java
@Test
void equalsContract() {
    Money a  = new Money(new BigDecimal("12.50"), EUR);
    Money b  = new Money(new BigDecimal("12.50"), EUR);
    Money c  = new Money(new BigDecimal("12.50"), EUR);
    Money d  = new Money(new BigDecimal("99.99"), EUR);

    // reflexive
    assertEquals(a, a);
    // symmetric
    assertEquals(a, b);
    assertEquals(b, a);
    // transitive
    assertEquals(a, b);
    assertEquals(b, c);
    assertEquals(a, c);
    // non-null
    assertNotEquals(a, null);
    // wrong type
    assertNotEquals(a, "not a Money");
    // unequal
    assertNotEquals(a, d);
    // hashCode agreement
    assertEquals(a.hashCode(), b.hashCode());
}
```

For a more rigorous check, the **EqualsVerifier** library (Jan Ouwens) automates all five clauses plus several edge cases (transient fields, mutable state, inheritance) in one line:

```java
@Test
void equalsHashCodeContract() {
    EqualsVerifier.forClass(Money.class).verify();
}
```

Use EqualsVerifier on every value class. It is the single highest-yield testing investment for a domain layer.

---

## 12. Quick rules

- [ ] Default to **records** for new value classes — the contracts are correct by construction.
- [ ] When you can't use a record, follow the **six-step recipe**: identity check, instanceof pattern, field comparisons, conjunction; `Objects.hash` for `hashCode`.
- [ ] Use `Objects.equals` for nullable reference fields; use `==` for primitives; use `Double.compare`/`Float.compare` for floating-point.
- [ ] `Arrays.equals` (or `Arrays.hashCode`) for array fields — never the inherited identity ones.
- [ ] `BigDecimal.equals` is scale-sensitive; normalise in the constructor or compare with `compareTo`.
- [ ] Entities compare by **identifier**, never by mutable content fields.
- [ ] `toString` is a convention — readable, no secrets, no exceptions, no million-entry traversal.
- [ ] Run **EqualsVerifier** on every value class. One line, all five clauses.
- [ ] Refactoring legacy `equals`? Replace nested null guards with `Objects.equals`; replace manual hash arithmetic with `Objects.hash`; consider converting to a record.

---

## 13. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| Inheritance, `instanceof` vs `getClass()`, proxies, classloaders | `senior.md`        |
| Code-review vocabulary, ArchUnit rules, mentoring             | `professional.md`  |
| JLS sections, JEP 395, the `Objects` utility class            | `specification.md` |
| Ten buggy snippets and their runtime symptoms                  | `find-bug.md`      |
| Allocation cost of `Objects.hash`, hashCode caching, JIT       | `optimize.md`      |
| Hands-on refactors                                             | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

Related:

- [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/) — inheritance breaks `equals`.
- [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) — composing values instead of inheriting them.
- [../05-immutability-and-defensive-copying/](../05-immutability-and-defensive-copying/) — the structural cure for mutable-equals bugs.

---

**Memorize this:** the recipe is six lines for `equals`, one line for `hashCode`, one line for `toString`. Default to records — they ship the recipe correct by construction. When you can't, use `Objects.equals` for fields, `Objects.hash` for the combined hash, `instanceof` with a pattern variable for the type guard. Entities equal by ID; values equal by content; `toString` carries no contract, only a convention to be readable, redacted, and fast.
