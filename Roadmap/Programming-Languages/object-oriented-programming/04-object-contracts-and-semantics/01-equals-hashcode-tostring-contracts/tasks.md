# equals / hashCode / toString — Practice Tasks

Eight exercises that force the equality contract to bite. Most are refactors of code that *compiles fine* but breaks the moment two instances live in a `HashSet`, a JPA proxy meets a real entity, or a log line goes to production with PII visible. Domains drawn from systems you will plausibly meet: e-commerce, banking, healthcare, fleet management.

Work each task in three passes: (1) read the snippet and name the clause that breaks (reflexive, symmetric, transitive, consistent, non-null, hashCode-agreement), (2) sketch the new shape on paper before touching the keyboard, (3) write code plus an EqualsVerifier test (and, where relevant, a small workload that would have caught the original problem).

---

## Task 1 — Fix broken equals on a Point hierarchy

```java
public class Point {
    protected final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override public boolean equals(Object o) {
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
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint cp)) return false;
        return super.equals(o) && color.equals(cp.color);
    }
    @Override public int hashCode() { return Objects.hash(x, y, color); }
}
```

A `Set<Point>` that mixes the two types misbehaves:

```java
Point        p   = new Point(1, 2);
ColoredPoint cp  = new ColoredPoint(1, 2, RED);
Set<Point>   set = new HashSet<>();
set.add(p); set.add(cp);
set.size();   // 2 — but p.equals(cp) is true. Set should not allow duplicates.
```

**Objective.** Identify which clause breaks and choose a fix that satisfies all five.

**Constraints.**
- Two acceptable shapes: (a) make both `Point` and `ColoredPoint` *final records* with no parent/child relationship (composition over inheritance); (b) keep the inheritance but switch to `getClass()` type guards and accept the LSP cost.
- Document the choice and the consequences in the code (Javadoc) and in one paragraph of code review.

**Acceptance criteria.**
- `EqualsVerifier.forClass(Point.class).verify()` passes.
- `EqualsVerifier.forClass(ColoredPoint.class).verify()` passes (with the appropriate `withRedefinedSubclass`/`withRedefinedSuperclass` flag in option (b)).
- A test that puts a `Point(1,2)`, a `ColoredPoint(1,2,RED)`, and a `ColoredPoint(1,2,BLUE)` into a `HashSet<Point>` produces a `size()` that matches the design intent — either 3 (option a, none are equal) or 3 (option b, `getClass()` differs across the three).
- The symmetry break (`p.equals(cp)` ≠ `cp.equals(p)`) is gone.

---

## Task 2 — Replace `getClass()` with type-safe equals using sealed types

```java
public abstract class Shape {
    public abstract double area();

    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;   // (*)
        return areaApprox(((Shape) o));
    }

    private boolean areaApprox(Shape s) { return Math.abs(this.area() - s.area()) < 1e-9; }

    @Override public int hashCode() {
        return Double.hashCode(Math.round(area() * 1e9));
    }
}

public class Circle   extends Shape { public double area() { /* ... */ return 0; } }
public class Square   extends Shape { public double area() { /* ... */ return 0; } }
public class Triangle extends Shape { public double area() { /* ... */ return 0; } }
```

The `getClass()` guard works (and is the safer default the IDE picks), but the design intent — *shapes are equal iff they have the same area* — is half-implemented: two `Circle`s with the same area are equal; a `Circle` and a `Square` with the same area are not.

**Objective.** Re-design the hierarchy so equality is *expressive* (same class with matching fields) and the compiler can verify exhaustive handling.

**Constraints.**
- Convert `Shape` to a `sealed interface`.
- Convert each leaf to a record (`Circle(double radius)`, `Square(double side)`, `Triangle(double base, double height)`).
- Remove the area-based equality. Equality is now by record components — each shape is equal only to another of *the same shape* with matching components.
- Add an exhaustive `switch` over `Shape` for the `area()` computation; the compiler must check exhaustiveness.

**Acceptance criteria.**
- `Circle(2.0).equals(Square(Math.sqrt(2 * Math.PI * 2)))` is `false` even when both shapes have nearly the same area. This is the *new design intent*.
- `Circle(2.0).equals(Circle(2.0))` is `true`.
- A `switch` over `Shape` omitting any of the three leaves fails to compile.
- `EqualsVerifier.forClass(Circle.class).verify()` (and Square, Triangle) all pass.
- The `Shape` interface has no `equals`/`hashCode` body; the records inherit the generated forms from JLS §8.10.

---

## Task 3 — Rewrite a legacy equals using `Objects.equals`

```java
public class Reservation {
    private Long id;
    private String guestEmail;
    private LocalDate start;
    private LocalDate end;
    private String roomCode;

    /* getters and setters */

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null) return false;
        if (getClass() != obj.getClass()) return false;
        Reservation other = (Reservation) obj;
        if (id == null) {
            if (other.id != null) return false;
        } else if (!id.equals(other.id)) {
            return false;
        }
        if (guestEmail == null) {
            if (other.guestEmail != null) return false;
        } else if (!guestEmail.equals(other.guestEmail)) {
            return false;
        }
        if (start == null) {
            if (other.start != null) return false;
        } else if (!start.equals(other.start)) {
            return false;
        }
        if (end == null) {
            if (other.end != null) return false;
        } else if (!end.equals(other.end)) {
            return false;
        }
        if (roomCode == null) {
            if (other.roomCode != null) return false;
        } else if (!roomCode.equals(other.roomCode)) {
            return false;
        }
        return true;
    }

    @Override
    public int hashCode() {
        final int prime = 31;
        int result = 1;
        result = prime * result + ((id == null) ? 0 : id.hashCode());
        result = prime * result + ((guestEmail == null) ? 0 : guestEmail.hashCode());
        result = prime * result + ((start == null) ? 0 : start.hashCode());
        result = prime * result + ((end == null) ? 0 : end.hashCode());
        result = prime * result + ((roomCode == null) ? 0 : roomCode.hashCode());
        return result;
    }

    @Override
    public String toString() {
        return "Reservation [id=" + id + ", guestEmail=" + guestEmail
             + ", start=" + start + ", end=" + end + ", roomCode=" + roomCode + "]";
    }
}
```

**Objective.** Modernise without changing semantics. Then evaluate whether the class qualifies for promotion to a record.

**Constraints.**
- Replace nested `null` checks with `Objects.equals`.
- Replace manual hash arithmetic with `Objects.hash`.
- Use pattern-variable `instanceof`.
- Decide whether `getClass()` or `instanceof` is the right type guard (this class allows subclasses today; consider whether it *should*).
- The `toString` body may stay similar but should be consistent with the modern record style.

**Acceptance criteria.**
- `equals` shrinks from ~30 lines to ~6.
- `hashCode` shrinks from ~10 lines to 1.
- The class still satisfies `EqualsVerifier.forClass(Reservation.class).verify()` (with appropriate suppressions if the class has setters).
- A second-pass refactor explores converting the class to `public record Reservation(...)` and identifies what changes: no setters (mutations produce new instances), `final` (no inheritance), accessors named `id()` not `getId()`.

---

## Task 4 — Convert a mutable class to a record

```java
public class Address {
    private String line1;
    private String line2;
    private String city;
    private String postcode;
    private String country;

    public Address() {}
    public Address(String line1, String line2, String city, String postcode, String country) {
        this.line1    = line1;
        this.line2    = line2;
        this.city     = city;
        this.postcode = postcode;
        this.country  = country;
    }

    public String getLine1()        { return line1; }
    public void setLine1(String s)  { this.line1 = s; }
    public String getLine2()        { return line2; }
    public void setLine2(String s)  { this.line2 = s; }
    public String getCity()         { return city; }
    public void setCity(String s)   { this.city = s; }
    public String getPostcode()     { return postcode; }
    public void setPostcode(String s) { this.postcode = s; }
    public String getCountry()      { return country; }
    public void setCountry(String s) { this.country = s; }

    // no equals, hashCode, toString — Object defaults
}

Set<Address> uniqueAddresses = new HashSet<>();
uniqueAddresses.add(new Address("12 King St", null, "London", "SW1A 1AA", "UK"));
uniqueAddresses.add(new Address("12 King St", null, "London", "SW1A 1AA", "UK"));
uniqueAddresses.size();    // 2 — identity equality
```

**Objective.** Convert `Address` to a record and migrate every caller.

**Constraints.**
- The record has five components.
- Add a compact constructor that null-checks `line1`, `city`, `postcode`, `country`; `line2` remains nullable.
- Country may be normalised to uppercase in the compact constructor; postcode to a canonical format (e.g., uppercase, single spaces).
- Find every caller of `setX(...)` and rewrite either as a new `Address` instance or as a `withX` helper:

```java
public Address withCity(String newCity) {
    return new Address(line1, line2, newCity, postcode, country);
}
```

**Acceptance criteria.**
- The set above now has `size() == 1` — value-equal addresses dedup.
- `EqualsVerifier.forClass(Address.class).verify()` passes.
- The `toString` is the record default `Address[line1=..., ..., country=...]`, or a custom one-liner like `"12 King St, London SW1A 1AA, UK"`.
- The auto-generated record `equals` correctly handles the nullable `line2`.
- A test asserts that mutating no longer compiles — the record has no `setLine1`.

---

## Task 5 — Fix a `hashCode` mismatch with a mutable field

```java
public class CartItem {
    private long productId;
    private int quantity;        // mutable: addOne / removeOne / setQuantity

    public CartItem(long productId, int quantity) {
        this.productId = productId;
        this.quantity = quantity;
    }
    public void addOne() { quantity++; }

    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CartItem c)) return false;
        return productId == c.productId && quantity == c.quantity;
    }
    @Override public int hashCode() {
        return Objects.hash(productId, quantity);
    }
}
```

```java
Cart cart = new Cart();
CartItem coffee = new CartItem(1001, 1);
cart.lines().add(coffee);
Set<CartItem> seen = new HashSet<>(cart.lines());

coffee.addOne();                       // quantity becomes 2
seen.contains(coffee);                 // false! quantity changed
seen.size();                           // 1, but seen has nothing the cart can find
```

**Objective.** Cure the mutation-in-equals bug. Two design choices to consider, document, and pick from.

**Option A — Identity by `productId` only.** A cart line is identified by *what* it sells, not how many; quantity is a separate dimension. Two `CartItem`s with the same product ID are the same line; their quantities are additive.

**Option B — Immutable `CartItem`.** Quantity changes produce new instances. The cart is responsible for replacing lines.

**Constraints.**
- Pick one option. Justify in code or in a paragraph.
- Option A: rewrite `equals`/`hashCode` to use `productId` only. The `Cart` class then has a `merge` operation that *adds* a new line's quantity to an existing line's.
- Option B: convert `CartItem` to a record. `Cart.addOne(productId)` produces a new `CartItem` with `quantity + 1` and replaces the old one in the cart's internal map.

**Acceptance criteria.**
- After the fix, the assertion `seen.contains(coffee)` returns `true` (option A — quantity doesn't affect equality) or the code path is restructured so the assertion is no longer relevant (option B — `coffee` is a different instance than the one in `seen`).
- A workload mutates 1,000 cart items 1,000 times each, then asserts the cart's contents are coherent.
- `EqualsVerifier.forClass(CartItem.class).verify()` passes in both options. (For option A, `EqualsVerifier` needs `.withOnlyTheseFields("productId")` plus `.suppress(Warning.SURROGATE_KEY)`.)

---

## Task 6 — Design `equals` for a `Money` value object

```java
public class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        this.amount = Objects.requireNonNull(amount);
        this.currency = Objects.requireNonNull(currency);
    }
    public BigDecimal amount()   { return amount; }
    public Currency   currency() { return currency; }
    /* no equals, hashCode, toString yet */
}
```

`Money` is used as a `HashMap` key in a pricing engine. Three issues to resolve:

1. **Scale sensitivity.** `new Money(new BigDecimal("9.99"), USD)` and `new Money(new BigDecimal("9.990"), USD)` represent the same value but are not equal under `BigDecimal.equals`.
2. **Currency mismatch.** `new Money(new BigDecimal("10.00"), USD).equals(new Money(new BigDecimal("10.00"), EUR))` should be `false`. Don't compare across currencies.
3. **`toString` readability.** Logs want `9.99 USD`, not `Money[amount=9.99, currency=USD]`.

**Objective.** Implement `equals`, `hashCode`, `toString` per the constraints below.

**Constraints.**
- Convert to a record or keep as a `final` class — your choice.
- Normalise scale in the constructor: `amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_EVEN)`.
- Use `instanceof` pattern variable in `equals`.
- `toString` returns the human format (`9.99 USD`).
- Provide a `plus(Money other)` method that throws on currency mismatch.

**Acceptance criteria.**
- `new Money(new BigDecimal("9.99"), USD).equals(new Money(new BigDecimal("9.990"), USD))` is `true`.
- `new Money(new BigDecimal("10"), USD).hashCode() == new Money(new BigDecimal("10.00"), USD).hashCode()`.
- `new Money(new BigDecimal("10"), USD).equals(new Money(new BigDecimal("10"), EUR))` is `false`.
- `EqualsVerifier.forClass(Money.class).verify()` passes (with `.withIgnoredFields("amount")` *not* applied — amount must participate in equality, but after normalisation).
- `new Money(new BigDecimal("9.99"), USD).toString()` returns `"9.99 USD"`.
- `new Money(new BigDecimal("10"), USD).plus(new Money(new BigDecimal("1"), EUR))` throws `IllegalArgumentException`.

---

## Task 7 — Design `toString` that hides PII

```java
public final class User {
    private final long id;
    private final String email;          // PII
    private final String fullName;       // PII
    private final String phoneNumber;    // PII
    private final String passwordHash;   // secret
    private final String mfaSecret;      // secret
    private final String role;
    private final Instant createdAt;

    /* constructor + accessors */
}
```

Logs from a payments service contain millions of `log.info("processing user {}", user)` lines per day. The compliance team has a redaction policy:

- **Passwords / hashes / MFA secrets** — never appear in any form.
- **Email** — masked to `a***@example.com` (first letter + domain).
- **Phone number** — masked to last 4 digits (`***-***-1234`).
- **Full name** — masked to initials (`A. B.`).
- **ID / role / createdAt** — not PII, included in plain form.

**Objective.** Write a `toString` that satisfies the redaction policy, plus a unit test that asserts no sensitive substrings appear.

**Constraints.**
- Provide helper methods `Mask.email(String)`, `Mask.phone(String)`, `Mask.initials(String)`, `Mask.secret()`.
- The class still serialises to JSON correctly via Jackson — the `toString` change must not affect serialisation. (Hint: `toString` and `@JsonProperty` are independent.)
- A test asserts that `user.toString()` does not contain `passwordHash`, `mfaSecret`, the full email, or the phone number.

**Acceptance criteria.**
- `new User(1L, "alice@example.com", "Alice Bloggs", "555-123-4567", "bcrypt$xxx", "totp:yyy", "ADMIN", Instant.now()).toString()` returns roughly:
  `User[id=1, email=a***@example.com, fullName=A. B., phoneNumber=***-***-4567, passwordHash=***, mfaSecret=***, role=ADMIN, createdAt=...]`
- The test `assertThat(user.toString()).doesNotContain("Alice Bloggs", "bcrypt$xxx", "totp:yyy", "555-123-4567", "alice@example.com")` passes.
- `Mask.email(null)` returns `"<null>"` rather than throwing.
- The masking is reversible only by replaying the original constructor — no information is leaked through clever string-builder use.

---

## Task 8 — Fix `equals` on a JPA entity (entity vs DTO)

```java
@Entity
public class Order {
    @Id @GeneratedValue private Long id;
    @ManyToOne private Customer customer;
    @Column private BigDecimal total;
    @OneToMany @JoinColumn(name = "order_id") private List<OrderLine> lines;

    public Order() {}
    public Order(Customer customer, BigDecimal total) {
        this.customer = customer; this.total = total;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;       // (1)
        Order order = (Order) o;
        return Objects.equals(id, order.id)                              // (2)
            && Objects.equals(customer, order.customer)
            && Objects.equals(total, order.total)
            && Objects.equals(lines, order.lines);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, customer, total, lines);                 // (3)
    }
}
```

Three latent bugs:

- Line `(1)` — `getClass()` differs from the Hibernate proxy's class.
- Line `(2)` — comparing `customer` and `lines` may trigger lazy loading or recurse infinitely.
- Line `(3)` — `hashCode` includes `id`, which is null before persist and assigned after; entities stored in a `HashSet` before save become invisible after save.

A separate DTO is used for HTTP responses:

```java
public record OrderResponse(Long id, String customerName, BigDecimal total, int lineCount) {}
```

The DTO is a value: equal by content, no JPA concerns.

**Objective.** Fix the entity's `equals`/`hashCode`/`toString` to handle proxies, lazy loading, and the persistence lifecycle. Keep the DTO untouched (it is already correct as a record).

**Constraints.**
- Use `instanceof Order` (no `getClass`) for proxy compatibility.
- `equals` compares only `id`. The fix returns `false` when either side has `null` `id` — unsaved entities are never equal to anything except themselves.
- `hashCode` returns a stable value that does not change across the lifecycle. The simplest choice: `getClass().hashCode()` (constant per class, hash diversity ignored).
- `toString` includes `id`, `customer.id()` (or `null`-safe customer summary), `total`, and `lines.size()` — never iterate `lines`.

**Acceptance criteria.**
- A test in the test profile creates a transient `Order` (no id), inserts into a `HashSet`, persists (id assigned), and confirms the set still contains it.
- A test compares a `find(id)`-loaded `Order` to a `getReference(id)`-proxy `Order` and confirms `equals` returns `true`.
- A test compares two transient `Order`s and confirms they are *not* equal (both have null id).
- `EqualsVerifier.forClass(Order.class).suppress(Warning.SURROGATE_KEY, Warning.NONFINAL_FIELDS).withOnlyTheseFields("id").verify()` passes.
- `order.toString()` runs without triggering lazy loading on `lines` — verifiable by setting `lines` to a lazy proxy and confirming no SQL fires.

---

## Validation

| Task | How to verify the fix |
|------|-----------------------|
| 1 | EqualsVerifier passes on both classes; a `Set<Point>` mixing types behaves per the chosen design (composition or `getClass`). |
| 2 | The sealed `Shape` interface compiles; an exhaustive `switch` over shapes refuses to compile if a case is missing. |
| 3 | The modernised class is ~30 lines shorter; EqualsVerifier passes; promotion to record is sketched. |
| 4 | `HashSet<Address>` deduplicates value-equal addresses; no caller of `setX` remains in the codebase. |
| 5 | A mutating workload no longer corrupts the cart; EqualsVerifier passes with the chosen design's appropriate flags. |
| 6 | Two `Money` instances of different scales but same value are equal and share a hash; cross-currency `plus` throws. |
| 7 | `assertThat(user.toString()).doesNotContain("alice@example.com", "555-123-4567", "bcrypt$xxx", "totp:yyy", "Alice Bloggs")` passes. |
| 8 | Save-after-add in a `HashSet` works; proxy and real entity compare equal; `EqualsVerifier` with `SURROGATE_KEY` suppression passes. |

---

## Worked solution — Task 6 (Money)

```java
public record Money(BigDecimal amount, Currency currency) {

    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        amount = amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_EVEN);
        if (amount.signum() < 0) {
            // optional: forbid negative money; depends on the domain
            // throw new IllegalArgumentException("amount must be non-negative");
        }
    }

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money minus(Money other) {
        requireSameCurrency(other);
        return new Money(amount.subtract(other.amount), currency);
    }

    public Money times(int factor) {
        return new Money(amount.multiply(BigDecimal.valueOf(factor)), currency);
    }

    @Override
    public String toString() {
        return amount.toPlainString() + " " + currency.getCurrencyCode();
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency))
            throw new IllegalArgumentException(
                "currency mismatch: " + currency + " vs " + other.currency);
    }
}
```

Tests:

```java
class MoneyTest {

    @Test
    void equalsContract() {
        EqualsVerifier.forClass(Money.class).verify();
    }

    @Test
    void scalesNormalise() {
        Money a = new Money(new BigDecimal("9.99"), Currency.getInstance("USD"));
        Money b = new Money(new BigDecimal("9.990"), Currency.getInstance("USD"));
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
    }

    @Test
    void differentCurrenciesAreNotEqual() {
        Money usd = new Money(new BigDecimal("10"), Currency.getInstance("USD"));
        Money eur = new Money(new BigDecimal("10"), Currency.getInstance("EUR"));
        assertNotEquals(usd, eur);
    }

    @Test
    void toStringIsHumanReadable() {
        Money m = new Money(new BigDecimal("9.99"), Currency.getInstance("USD"));
        assertEquals("9.99 USD", m.toString());
    }

    @Test
    void crossCurrencyAddThrows() {
        Money usd = new Money(new BigDecimal("10"), Currency.getInstance("USD"));
        Money eur = new Money(new BigDecimal("1"), Currency.getInstance("EUR"));
        assertThrows(IllegalArgumentException.class, () -> usd.plus(eur));
    }
}
```

Notice three design decisions made by the solution:

1. **The record overrides `toString`.** The auto-generated `Money[amount=9.99, currency=USD]` is also valid, but logs read better with `"9.99 USD"`. The override is one line and changes only the `toString`, not the contracts.
2. **The compact constructor reassigns `amount`.** Records allow this — the compact constructor sees the parameters bound, and you can mutate them before they reach the implicit field assignments. This is the canonical normalisation site.
3. **Cross-currency arithmetic throws.** A `Money` with USD and a `Money` with EUR are different *kinds* — they cannot be combined without a conversion rate, which belongs in a separate service. Letting arithmetic throw forces the call site to think about it.

---

**Memorize this:** the equality contracts do not show up as compiler errors — they show up the second time you put an object in a `HashSet`, the first time JPA hands you a proxy, or the day your log shipper indexes a password. Each task above gives you that moment up front. If, after the refactor, the next plausible misuse fails at compile time (record's `final`, missing `switch` case) or fails fast (`requireSameCurrency` throws) instead of producing silent wrong answers, you have applied the right contracts.
