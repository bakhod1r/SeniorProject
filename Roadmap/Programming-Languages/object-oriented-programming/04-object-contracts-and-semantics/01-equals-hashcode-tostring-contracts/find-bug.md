# equals / hashCode / toString — Find the Bug

> Ten buggy snippets, each illustrating a silent equality-contract violation that compiles, looks fine in review, and only bites at runtime — usually in a `HashSet`, a `HashMap`, a JPA proxy, a serialised log, or a unit test that "passes locally". For each: read the code, decide which clause of the contract breaks, identify the *runtime symptom* (silent duplicates, lost entries, NPE in collection internals, leaked PII in logs, double-charged customers), and write the fix.

---

## Bug 1 — `equals` with `instanceof` but cast to a subclass

```java
public class Order {
    private final long id;

    public Order(long id) { this.id = id; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Order)) return false;
        SpecialOrder other = (SpecialOrder) o;       // wrong cast!
        return this.id == other.id;
    }

    @Override
    public int hashCode() { return Long.hashCode(id); }
}

public class SpecialOrder extends Order {
    public SpecialOrder(long id) { super(id); }
}
```

```java
Set<Order> orders = new HashSet<>();
orders.add(new Order(42));
orders.add(new Order(42));      // expected: dedup. actually: throws.
```

**Symptom.** A `ClassCastException` deep in the collection's `put` path:

```
Exception in thread "main" java.lang.ClassCastException:
    class Order cannot be cast to class SpecialOrder (Order and SpecialOrder are in unnamed module of loader 'app')
    at Order.equals(Order.java:11)
    at java.base/java.util.HashMap.putVal(HashMap.java:639)
    at java.util.HashSet.add(HashSet.java:221)
```

**Violation.** The `instanceof` check verifies the right-hand side is some `Order`, but the cast immediately narrows it to `SpecialOrder`. Two plain `Order` instances flunk the cast, even though they passed the type check. The bug is invisible until a non-`SpecialOrder` flows in, which is *the* common case.

**Fix.** Cast to the type you checked, or — better — use the pattern variable so the compiler refuses to lie:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Order other)) return false;     // pattern variable
    return this.id == other.id;
}
```

The pattern variable form (JEP 394, Java 16) makes this category of bug impossible — the type of `other` is exactly the type tested. Any code reviewer seeing a `(SomeSubclass) o` after `instanceof SomeOtherClass` should reject the PR.

---

## Bug 2 — Mutable field in `equals`/`hashCode`

```java
public class Customer {
    private long id;
    private String email;       // not final, mutable via setEmail

    public Customer(long id, String email) {
        this.id = id;
        this.email = email;
    }

    public void setEmail(String email) { this.email = email; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Customer c)) return false;
        return Objects.equals(email, c.email);          // mutable in equals
    }

    @Override
    public int hashCode() { return Objects.hashCode(email); }
}
```

```java
Set<Customer> active = new HashSet<>();
Customer alice = new Customer(1L, "alice@old.example");
active.add(alice);

alice.setEmail("alice@new.example");        // mutate after add

active.contains(alice);                     // false!
active.remove(alice);                       // false — can't find it
active.add(alice);                          // succeeds, now the set has TWO references to alice
active.size();                              // 2 — but they're the same object
```

**Symptom.** The customer is *invisible* to the set that contains them. A "find user by reference" call returns null. A "remove user" call silently no-ops. After enough mutation, the set holds many references to the same physical object and reports an inflated `size()`. Memory leaks compound; iteration prints duplicates.

**Violation.** The **consistency** clause. `hashCode()` returned `H_old` when alice was added; the set put her in bucket `H_old % numBuckets`. Mutating `email` changed `hashCode()` to `H_new`; the set's internal data structure still has her in the old bucket, but every lookup hashes `H_new` and walks the new bucket. They never meet.

**Fix.** Mutable fields do not belong in `equals`/`hashCode`. Two options:

1. **Hash on the immutable identifier.** `email` is human-friendly and changes; `id` is the surrogate key and doesn't.

```java
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Customer c)) return false;
    return id == c.id;
}
@Override public int hashCode() { return Long.hashCode(id); }
```

2. **Make the class genuinely immutable.** All fields `final`, no setters, mutations produce new instances. The contract holds without effort. A record fits this pattern perfectly.

The find-bug instinct: every time you see `equals` or `hashCode` reference a non-`final` field, ask the author whether *every* code path mutates that field strictly before any collection put. Almost always, the answer is "I don't know" — which is the answer that means "yes, this is a bug".

---

## Bug 3 — Symmetry break across an inheritance hierarchy

```java
public class Point {
    protected final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Point p)) return false;
        return x == p.x && y == p.y;
    }
    @Override public int hashCode() { return Objects.hash(x, y); }
}

public class ColoredPoint extends Point {
    private final Color color;
    public ColoredPoint(int x, int y, Color color) {
        super(x, y); this.color = color;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint cp)) return false;
        return super.equals(o) && color == cp.color;
    }
    @Override public int hashCode() { return Objects.hash(x, y, color); }
}
```

```java
Point        p   = new Point(1, 2);
ColoredPoint cp  = new ColoredPoint(1, 2, RED);

p.equals(cp);     // true  — `cp instanceof Point` matches
cp.equals(p);     // false — `p` is not a ColoredPoint
```

**Symptom.** A `HashSet<Point>` that received both `p` and `cp` may or may not consider them duplicates depending on insertion order:

```java
Set<Point> set = new HashSet<>();
set.add(p);
set.add(cp);   // hash differs (color contributes), so this adds — set now has both
set.size();    // 2

Set<Point> set2 = new HashSet<>();
set2.add(cp);
set2.add(p);   // same hashes — p's hash doesn't include color, cp's does. Different buckets.
set2.size();   // 2
```

Symmetry isn't the *only* break — the hashes also disagree, so `p` and `cp` cannot be considered equal even if `equals` agreed.

**Violation.** The **symmetric** clause. `p.equals(cp)` returns `true` while `cp.equals(p)` returns `false`. This is the canonical Bloch Item 10 break. Symmetry cannot survive an open inheritance where the subclass adds equality-relevant state.

**Fix.** Three options, in order of preference:

1. **Make `Point` `final`** (or use a record). Inheritance becomes impossible, the break vanishes. This is the modern default.

```java
public record Point(int x, int y) {}
public record ColoredPoint(int x, int y, Color color) {}
```

The two records are *unrelated types* — no equality relationship at all. The compiler will not let you compare them.

2. **Change `Point.equals` to use `getClass()`.** Now `p` and `cp` are *never* equal, symmetric but at the cost of substitutability (LSP).

3. **Eliminate inheritance.** `ColoredPoint` *has* a `Point` rather than *being* one. Composition over inheritance — see [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).

The senior file walks the entire `instanceof` vs `getClass()` argument. The find-bug takeaway: any inheritance hierarchy with overridden `equals` and new equality-relevant state is *structurally broken*. There is no implementation that satisfies all five clauses.

---

## Bug 4 — `hashCode` returns a constant

```java
public final class TenantKey {
    private final long tenantId;
    private final long resourceId;

    public TenantKey(long t, long r) { this.tenantId = t; this.resourceId = r; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof TenantKey k)) return false;
        return tenantId == k.tenantId && resourceId == k.resourceId;
    }

    @Override
    public int hashCode() { return 1; }      // "valid" — equal keys share this hash
}
```

```java
Map<TenantKey, Resource> cache = new HashMap<>();
for (long t = 0; t < 1_000_000; t++) {
    cache.put(new TenantKey(t, 0), new Resource());
}
cache.get(new TenantKey(42, 0));              // works, but slow
```

**Symptom.** Functionally correct. Performance catastrophic. Every key collides into a single bucket; every `get` walks the bucket's chain (or the JDK's red-black tree after 8 collisions, which improves the case but doesn't fix the root). At a million entries, `get` is ~20,000× slower than a well-distributed hash.

Profile shows 90% of time in `HashMap.getNode` and `Object.equals`. Bug looks like a "slow database" to the team until someone profiles.

**Violation.** Not technically a contract break — the Javadoc explicitly *permits* unequal objects to share a hash. But the same Javadoc adds: "producing distinct integer results for unequal objects may improve the performance of hash tables." A constant hash voluntarily collapses the entire map into one bucket.

**Fix.** Use `Objects.hash` or — for primitive fields — combine the field hashes by hand:

```java
@Override public int hashCode() {
    return Long.hashCode(tenantId) * 31 + Long.hashCode(resourceId);
}
```

Or just `Objects.hash(tenantId, resourceId)`. The varargs allocation cost is rarely measurable for ordinary code; if it is, see [./optimize.md](./optimize.md) for hand-tuned alternatives.

How does this bug enter a codebase? Usually: someone read that "any constant `hashCode` is contract-correct" and decided to "simplify". Or they were debugging a hash-related issue, set `hashCode` to `1` temporarily, and forgot to revert. Static analysis (SpotBugs `HE_HASHCODE_USE_OBJECT_EQUALS` is close; PMD `OverrideBothEqualsAndHashcode` is close) doesn't always catch this — review must.

---

## Bug 5 — `equals` comparing different units (cents vs dollars)

```java
public final class Money {
    private final long amount;       // ambiguous: cents? dollars?
    private final Currency currency;

    public Money(long amount, Currency currency) {
        this.amount = amount;
        this.currency = currency;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Money m)) return false;
        return amount == m.amount && currency.equals(m.currency);
    }
    @Override public int hashCode() { return Objects.hash(amount, currency); }
}
```

Now two production code paths emerge over time:

```java
// PaymentService — uses cents
Money chargeAmount = new Money(1299, USD);   // $12.99 in cents

// ReportingService — uses whole dollars
Money quotedAmount = new Money(13, USD);     // $13 (rounded)

chargeAmount.equals(quotedAmount);          // false, of course
```

So far so good. Then in a refactor someone introduces:

```java
// PromotionEngine — also uses cents but writes literal-dollar prices
Money tenDollars = new Money(10, USD);       // INTENDED $10, ACTUALLY 10 cents
chargeAmount.equals(tenDollars);             // false, both correct from their POV

if (cart.subtotal().equals(tenDollars)) {    // intended "is this cart $10?"
    applyDiscount();
}
```

Carts of *10 cents* match `tenDollars`; carts of $10 don't. Customers with a 10-cent cart get a free discount; customers with a real $10 cart don't.

**Symptom.** Finance reconciliation flags an unusual cluster of 10-cent purchases with free shipping. Engineering can't reproduce until someone notices the `Money` class accepts a bare `long` with no unit.

**Violation.** Not strictly an equality contract violation — `equals` does what it says. The bug is *upstream*: the type does not encode the unit. Two `Money` values that are equal as `long`s mean different things in different parts of the code.

**Fix.** Encode the unit in the type. Either use `BigDecimal` for natural representation:

```java
public final class Money {
    private final BigDecimal amount;     // always in major units (dollars, euros, etc.)
    private final Currency currency;
    /* ... */
}
```

Or, if you must use a primitive for performance, make it explicit:

```java
public final class Money {
    private final long cents;            // unambiguous
    private final Currency currency;

    public static Money fromCents(long cents, Currency c) { return new Money(cents, c); }
    public static Money fromDollars(BigDecimal dollars, Currency c) {
        return new Money(dollars.movePointRight(2).longValueExact(), c);
    }
    private Money(long cents, Currency c) { this.cents = cents; this.currency = c; }
    /* ... */
}
```

The constructor is private; the static factories make the unit explicit. `new Money(10, USD)` no longer compiles — the developer must choose `fromCents(10, USD)` or `fromDollars(BigDecimal.TEN, USD)`. The unit ambiguity that caused the bug becomes a compile error.

---

## Bug 6 — `equals` on a JPA proxy

```java
@Entity
public class Order {
    @Id @GeneratedValue private Long id;
    @ManyToOne private Customer customer;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;    // (*)
        Order order = (Order) o;
        return Objects.equals(id, order.id);
    }

    @Override public int hashCode() { return Objects.hashCode(id); }
}
```

```java
Order persisted = entityManager.find(Order.class, 42L);
Order proxy     = entityManager.getReference(Order.class, 42L);  // returns a Hibernate proxy

persisted.equals(proxy);   // false! getClass() differs.
```

**Symptom.** Two references to the same database row, both with `id == 42`, compare as different. Cache-invalidation logic that depends on `entry.equals(staleEntry)` skips the proxy version. The order shows up twice in collection-typed associations. Hibernate's `MergeEventListener` may silently re-attach a stale copy.

The error never throws — it just produces wrong results that look like cache-coherency bugs.

**Violation.** `getClass()` comparison breaks across JPA proxies. The proxy is a runtime-generated *subclass* (`Order$$EnhancerByHibernate_...`) of `Order`; their `Class` objects differ. The proxy *is* an `Order` by inheritance, but not by class identity.

**Fix.** Use `instanceof` instead of `getClass()`. The proxy passes the `instanceof Order` check because it extends `Order`:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Order order)) return false;
    return id != null && id.equals(order.id);       // also fix the null-id case
}
```

Note the second fix: `id != null && id.equals(order.id)` instead of `Objects.equals(id, order.id)`. With `Objects.equals`, two unsaved entities (both with `id == null`) compare *equal*, which is almost never what you want — every unsaved `Order` would look like the same `Order`. The `id != null && id.equals(...)` form returns `false` for unsaved entities (correct: they have no identity yet).

For `hashCode`, return a stable value that does not change when `id` is assigned post-persist:

```java
@Override public int hashCode() { return getClass().hashCode(); }
```

Trades hash diversity (every order in the same bucket) for stability (the hash never changes during the lifecycle). For collections holding many JPA entities at once, a more diverse hash is possible *only if* the entity is persisted before insertion. The senior file expands on this.

The find-bug takeaway: an IDE-generated `equals` (which defaults to `getClass()`) is *wrong* for JPA entities. Override every IDE generation for JPA entities, or factor out a `JpaEntity` base class with the correct semantics.

---

## Bug 7 — `equals` on a record with `BigDecimal` and a different scale

```java
public record Price(BigDecimal amount, Currency currency) {}
```

```java
Map<Price, Promotion> promos = new HashMap<>();
promos.put(new Price(new BigDecimal("9.99"), EUR), new Promotion("autumn"));

Price quoted = new Price(new BigDecimal("9.990"), EUR);   // same value, different scale
promos.get(quoted);                                       // null!
```

**Symptom.** A promotion engine reads prices from one source (a `9.99` literal) and queries the map with prices from another (database with scale `3` → `9.990`). The lookup fails. No exception, no log line — the promotion silently doesn't apply. Customers who *should* see the autumn discount don't.

**Violation.** Not strictly an `equals` contract violation — `BigDecimal.equals` correctly returns `false` for different scales, by *its* documented contract:

> Two `BigDecimal` objects that are equal in value but have a different scale (like 2.0 and 2.00) are considered equal by `compareTo` but not by `equals`.

The record auto-generated `equals` calls `BigDecimal.equals`, which is scale-sensitive. The bug is that the user expects value equality.

**Fix.** Normalise the scale at construction. A record's compact constructor is the perfect place:

```java
public record Price(BigDecimal amount, Currency currency) {
    public Price {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        amount = amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_EVEN);
    }
}
```

Every `Price` instance now stores `amount` at the currency's natural scale (`2` for EUR/USD, `0` for JPY). Two prices that represent the same monetary value have identical `amount` fields, equal under `BigDecimal.equals`.

Note: `setScale` may throw `ArithmeticException` if rounding is required and `RoundingMode.UNNECESSARY` is used. Pick a deliberate rounding mode (`HALF_EVEN` is the banker's choice and matches IEEE 754 for tie-breaking).

The same bug appears with `BigInteger` (no scale, no problem) and with `String` if your code is case-insensitive (`"USD".equals("usd")` is false; if you intend case-insensitive equality, normalise the string at construction).

---

## Bug 8 — `toString` leaks sensitive data

```java
public final class User {
    private final long id;
    private final String email;
    private final String passwordHash;        // bcrypt
    private final String mfaSecret;           // TOTP shared secret
    private final String ssn;                 // not your finest hour storing this

    @Override
    public String toString() {
        return "User[id=" + id + ", email=" + email
             + ", passwordHash=" + passwordHash
             + ", mfaSecret=" + mfaSecret
             + ", ssn=" + ssn + "]";
    }
}
```

```java
log.info("processing {}", user);                            // logs every field
try {
    /* ... */
} catch (Exception e) {
    throw new IllegalStateException("failed for " + user, e);  // exception message too
}
```

**Symptom.** Multiple downstream failures.

1. Log aggregation (ELK / Datadog / Splunk) ingests password hashes, MFA secrets, and SSNs. They sit in indexed, searchable storage forever.
2. CI fails a build; the build log on a public CI runner shows `User[ssn=123-45-6789]`.
3. The exception bubbles to a global error handler that sends the message to Sentry; Sentry's UI now shows MFA secrets in the issue title.
4. An auditor finds the secrets two months later. The incident is reportable under GDPR / CCPA / your local regime.

The user may never see an exception or a stack trace; the security failure is silent at runtime and loud only in the incident report.

**Violation.** Not a contract violation — `toString` has no JDK contract. A *policy* violation: secrets should never appear in `toString`, full stop.

**Fix.** Redact at the source. Either omit sensitive fields, mask them, or replace with a placeholder:

```java
@Override
public String toString() {
    return "User[id=" + id
         + ", email=" + maskEmail(email)
         + ", passwordHash=***"
         + ", mfaSecret=***"
         + ", ssn=" + maskSsn(ssn) + "]";
}

private static String maskEmail(String e) {
    if (e == null) return "<null>";
    int at = e.indexOf('@');
    return at < 2 ? "***" : e.charAt(0) + "***" + e.substring(at);
}
private static String maskSsn(String s) {
    if (s == null || s.length() < 4) return "***";
    return "***-**-" + s.substring(s.length() - 4);
}
```

Better: do not put secrets in domain types at all. The password hash lives in a `Credentials` aggregate owned by an auth context; the user's domain type knows the user's ID and email, nothing else. The MFA secret lives in an encrypted secrets store with a typed `MfaSecretReference` that has *its own* `toString` returning `"<mfa-secret>"`.

Better still: write a *test* that asserts `toString` does not contain secrets.

```java
@Test
void toStringDoesNotLeakSecrets() {
    User u = new User(1L, "alice@example.com", "bcrypt$...", "totp-base32...", "123-45-6789");
    String s = u.toString();
    assertThat(s).doesNotContain("bcrypt", "totp-base32", "123-45-6789");
}
```

The test runs in CI, catches every regression. Apply it to every domain type that holds secrets.

---

## Bug 9 — Subclass that adds state breaks a `HashSet`

```java
public class Person {
    protected final String name;
    public Person(String name) { this.name = name; }

    @Override public boolean equals(Object o) {
        if (!(o instanceof Person p)) return false;
        return Objects.equals(name, p.name);
    }
    @Override public int hashCode() { return Objects.hashCode(name); }
}

public class Employee extends Person {
    private final long employeeId;
    public Employee(String name, long employeeId) {
        super(name); this.employeeId = employeeId;
    }
    // No override of equals/hashCode!
}
```

```java
Set<Person> seen = new HashSet<>();
seen.add(new Employee("Alice", 1));
seen.add(new Employee("Alice", 2));        // different employee
seen.add(new Person("Alice"));

seen.size();                                // 1 — all three considered equal
```

**Symptom.** A "deduplicate by employee" routine collapses every employee with the same name into one. Two distinct employees disappear from a payroll run. Onboarding flags the duplicate; payroll already pushed the consolidated check.

**Violation.** `Employee` inherits `Person.equals`, which compares only by `name`. Two employees with the same name and different IDs are equal, contradicting the design intent of `Employee`.

**Fix.** This is the *other* side of the Bug 3 break — same structural fact, opposite manifestation. The subclass *should* add equality state but doesn't. SonarQube `S2160` ("subclasses that add fields should override `equals`") is exactly this rule. The fix path is the same as Bug 3:

1. **Make `Person` `final`** and disallow `Employee extends Person` entirely. Use composition (`Employee` *has* a `Person` profile, has its own `equals` on `employeeId`).
2. **Use `getClass()` in `Person`'s `equals`.** Now `Person` and `Employee` are never equal, but two `Employee`s with the same name are still equal (because `Employee` doesn't override). To fix that, `Employee` must also override `equals` — typically on `employeeId` alone, since employee identity is by ID.
3. **Just override `equals`/`hashCode` on `Employee`.** Use `employeeId` as the identifier:

```java
public class Employee extends Person {
    private final long employeeId;
    public Employee(String name, long employeeId) { super(name); this.employeeId = employeeId; }

    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Employee e)) return false;
        return employeeId == e.employeeId;
    }
    @Override public int hashCode() { return Long.hashCode(employeeId); }
}
```

Now `Employee` ignores `name` for equality. But this re-introduces Bug 3's symmetry break — `new Person("Alice").equals(new Employee("Alice", 1))` may be true while the reverse is false. The honest cure is option 1.

---

## Bug 10 — Double-counted equality in a collection of decorators

A team uses a decorator pattern for `Notification`:

```java
public interface Notification { String render(); }

public record EmailNotification(String to, String body) implements Notification {
    public String render() { return "EMAIL " + to + " " + body; }
}

public final class TimestampedNotification implements Notification {
    private final Notification delegate;
    private final Instant at;
    public TimestampedNotification(Notification delegate, Instant at) {
        this.delegate = delegate; this.at = at;
    }
    public String render() { return at + " " + delegate.render(); }

    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof TimestampedNotification t)) return false;
        return delegate.equals(t.delegate);     // ignores `at` — equality by underlying message
    }
    @Override public int hashCode() { return delegate.hashCode(); }
}
```

A dedup set:

```java
Set<Notification> seen = new HashSet<>();
seen.add(new EmailNotification("alice@example.com", "hi"));
seen.add(new TimestampedNotification(
    new EmailNotification("alice@example.com", "hi"), Instant.now()));

seen.size();        // 2 — should be 1?
seen.contains(new EmailNotification("alice@example.com", "hi"));    // true
seen.contains(new TimestampedNotification(
    new EmailNotification("alice@example.com", "hi"), Instant.now()));   // true

// But:
seen.remove(new EmailNotification("alice@example.com", "hi"));      // removes the plain one
seen.size();        // 1 — left with the timestamped one
seen.contains(new EmailNotification("alice@example.com", "hi"));    // false
```

**Symptom.** A dedup intended to prevent the same message from going out twice fails *half the time*. A `TimestampedNotification` and a plain `EmailNotification` are considered equal *one direction* and not the other:

- `email.equals(timestamped)` → false (`timestamped instanceof EmailNotification` is false; an `EmailNotification` record's `equals` rejects).
- `timestamped.equals(email)` → false (`email instanceof TimestampedNotification` is false).
- So both can sit in the set side-by-side.

But by hash code:

- `email.hashCode()` is the record's hash.
- `timestamped.hashCode()` is `delegate.hashCode()` = the record's hash.

Same hash, different `equals` answer. The set's internal logic puts them in the same bucket but doesn't merge them. Some operations behave one way, some another.

**Symptom in production.** Notifications go out *both* timestamped and plain. Recipients receive duplicates. Engineering blames the queue retry; the bug is the equality model.

**Violation.** **Symmetry** (in a non-inheritance form). Two distinct types claim a hash-equality relationship in one direction but not the other. The decorator's `equals` is *liberal* (any underlying-equal message is equal), but the underlying type's `equals` is *strict* (only same record class).

**Fix.** Decide explicitly: are decorators *transparent* (equal to undecorated by the underlying value), or *opaque* (their own equality)? Both are valid; the team must choose and apply consistently.

**Transparent (delegate equality):**

```java
public record EmailNotification(String to, String body) implements Notification {
    public String render() { return "EMAIL " + to + " " + body; }
    // Override the record-generated equals to accept decorators:
    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Notification n)) return false;
        // Compare by some canonical projection both sides agree on.
        return this.render().equals(n.render());
    }
    @Override public int hashCode() { return render().hashCode(); }
}
```

(Records *can* override equals; the compiler does not stop you. The price is that you take on the same responsibilities the manual recipe demands.)

**Opaque (identity-shaped):**

Don't override `equals` on the decorator. Each decorator is its own thing; two `TimestampedNotification`s with different `at` are *not* equal. The dedup set then must operate on the *underlying* notification, not on decorated ones.

The pragmatic answer: stop putting decorators into hash-based sets. The decorator pattern fights equality contracts because decorators are *behaviours*, not values. Dedup the underlying values; apply decorators after dedup.

---

## Pattern summary

| Violation type                                            | What to look for                                                             |
|-----------------------------------------------------------|------------------------------------------------------------------------------|
| Cast to wrong subclass after `instanceof` (Bug 1)         | `(SubClass) o` after `o instanceof SuperClass` — use pattern variables       |
| Mutable field in `equals`/`hashCode` (Bug 2)              | Non-`final` field referenced in `equals` body                                |
| Symmetry break across inheritance (Bug 3)                 | Subclass overrides `equals` and adds new state; parent uses `instanceof`     |
| Performance-pathological `hashCode` (Bug 4)               | `return 1`, `return 0`, or a hash that ignores most fields                   |
| Unit ambiguity in value class (Bug 5)                     | `Money(long amount, ...)` with no enforced unit                              |
| JPA proxy equality (Bug 6)                                | `getClass() == o.getClass()` in an entity class                              |
| `BigDecimal` scale mismatch (Bug 7)                       | Records or hand-written equals over `BigDecimal` without scale normalisation |
| Sensitive data in `toString` (Bug 8)                      | Password / token / SSN / email in the `toString` body                        |
| Subclass with new state, no equals override (Bug 9)       | Subclass adds equality-relevant field but inherits parent's `equals`         |
| Decorator equality mismatch (Bug 10)                      | Decorator's `equals` compares delegate, underlying type's doesn't agree      |

These violations rarely throw. They show up as *wrong answers*: silent duplicates, lost lookups, double-charges, leaked secrets in logs, payroll consolidating two employees into one. Train your eye to spot them in review — once the bug is in production, the symptom is a customer-support ticket, not a stack trace.

Tooling that catches these mechanically:

- **SonarQube** — `S1206` (equals without hashCode), `S2160` (subclass with new fields), `S2098` (overloaded equals).
- **SpotBugs** — `EQ_*` family, `HE_*` family.
- **EqualsVerifier** — every clause, every value class, one line per test.
- **PMD** — `OverrideBothEqualsAndHashcode`, `CompareObjectsWithEquals`.
- **ArchUnit** — domain-specific rules ("entities equal by id only", "value packages contain only records or final classes").

Wire all of them. The contract is one of the most mechanically verifiable parts of Java; there is no reason for a 2020s codebase to ship these bugs.
