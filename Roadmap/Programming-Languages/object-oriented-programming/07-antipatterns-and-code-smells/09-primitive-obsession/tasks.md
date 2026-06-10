# Primitive Obsession — Practice Tasks

> Eight exercises in increasing difficulty. Each task gives the starting code, an objective, constraints, and acceptance criteria. The final task ends with a worked solution sketch so you can compare your refactor to a canonical one.

Work each task in three passes: (1) read the snippet and name every primitive that should become a wrapper, (2) sketch the new signature on paper before touching the keyboard, (3) write the wrappers with validation, push them through the API, and add a small test that would have caught the original problem.

---

## Validation reference

| Check | What to verify after each refactor |
|---|---|
| Compile-time | Swapping any two parameters of the new signature causes a compile error. |
| Validation | Constructing a wrapper from an invalid primitive throws at construction, not at use. |
| Boundary | Adapter layer (controller, mapper) is the only place that constructs wrappers from raw primitives. |
| Equality | Two wrappers with the same content are `equals`-equal and have the same `hashCode`. |
| Immutability | No setter, no mutating method. Operations return new instances. |
| Stable behaviour | Existing tests still pass after the refactor (you didn't change semantics, only types). |

---

## Task 1 — Wrap an email address

```java
public class UserService {
    public void register(String email, String fullName) {
        if (email == null || !email.contains("@")) throw new IllegalArgumentException();
        users.save(new User(email, fullName));
    }
}
```

**Objective.** Replace the two `String` parameters with typed wrappers.

**Constraints.**
- `Email` must validate format (must contain `@`, must not be blank) and normalise to lowercase.
- `FullName` must reject blank values, trim surrounding whitespace.
- Both must be `record`s.

**Acceptance criteria.**
- `register(fullName, email)` (swapped order) fails to compile.
- `new Email("not-an-email")` throws `IllegalArgumentException`.
- `new Email("Alice@Example.com").value().equals("alice@example.com")` is true.
- `User` stores the wrappers, not raw strings.

---

## Task 2 — Replace `int amountCents` with `Money`

```java
public class WalletService {
    public void deposit(long walletId, int amountCents) { ... }
    public void withdraw(long walletId, int amountCents) { ... }
    public int balanceCents(long walletId) { ... }
}
```

**Objective.** Replace `int amountCents` with a `Money` value object that carries amount and currency, and replace `long walletId` with a `WalletId`.

**Constraints.**
- `Money` uses `long minorUnits` and `Currency` from `java.util.Currency`.
- Addition and subtraction must use `Math.addExact` / `Math.subtractExact` to detect overflow.
- Operations on `Money` of different currencies must throw.
- `WalletId` rejects non-positive values.

**Acceptance criteria.**
- `wallet.deposit(walletId, new Money(50_00, USD))` compiles; `wallet.deposit(USD, walletId)` does not.
- `Money(100, USD).plus(Money(50, EUR))` throws `IllegalArgumentException`.
- Overflowing addition throws `ArithmeticException`.

---

## Task 3 — Replace boolean flags with an enum

```java
public class NotificationService {
    public void send(User u, String message,
                     boolean urgent,
                     boolean includeSms,
                     boolean includeEmail,
                     boolean dryRun) { ... }
}
```

**Objective.** Remove all `boolean` parameters and replace them with a small set of typed options.

**Constraints.**
- One `Priority` enum (`URGENT`, `NORMAL`).
- One `Channels` type that holds a `Set<Channel>` where `Channel = SMS | EMAIL | PUSH`.
- One `ExecutionMode` enum (`LIVE`, `DRY_RUN`).
- Final signature must have at most 4 parameters.

**Acceptance criteria.**
- The call `service.send(u, "Hello", Priority.URGENT, Channels.of(EMAIL), ExecutionMode.DRY_RUN)` reads as prose.
- No `boolean` appears in the public method signature.
- A new channel (e.g., `WEBHOOK`) can be added by extending the enum, without changing the signature.

---

## Task 4 — Wrap timestamps with `Instant` and `Duration`

```java
public class SessionService {
    public Session create(long userId, long createdAtMillis, long expiresAfterSeconds) { ... }
    public boolean isExpired(long sessionId, long currentTimeMillis) { ... }
}
```

**Objective.** Replace all `long`-encoded times and durations with `Instant` and `Duration`, and wrap IDs.

**Constraints.**
- `UserId` and `SessionId` are opaque wrappers around `long` (or `UUID`).
- `createdAtMillis` becomes `Instant`.
- `expiresAfterSeconds` becomes `Duration`.
- `isExpired` should not take `currentTimeMillis` — inject a `Clock` instead.

**Acceptance criteria.**
- Swapping `userId` and `sessionId` arguments fails to compile.
- A unit test can advance time deterministically by constructing a fixed `Clock`.
- The signature no longer contains any `long` that means "a moment" or "a duration".

---

## Task 5 — Convert a CSV row parser

```java
public class TransactionImporter {
    public Transaction parse(String[] row) {
        long id = Long.parseLong(row[0]);
        long ts = Long.parseLong(row[1]);
        String currency = row[2];
        long amountCents = Long.parseLong(row[3]);
        String accountIdFrom = row[4];
        String accountIdTo = row[5];
        return new Transaction(id, ts, currency, amountCents, accountIdFrom, accountIdTo);
    }
}
```

**Objective.** Replace the six raw values with typed wrappers, with all validation at construction.

**Constraints.**
- The parser is the *boundary* — it is the only legitimate place to construct wrappers from `String`.
- Each wrapper validates at construction.
- The resulting `Transaction` exposes only typed values.

**Acceptance criteria.**
- A malformed CSV row (e.g., 2-letter currency, blank account ID) throws at parse time, not at use time.
- `Transaction` has no `String` or `long` accessors.
- The signature `new Transaction(TransactionId, Instant, IsoCurrency, Money, AccountId, AccountId)` reads as prose.

---

## Task 6 — A sealed `Notification` hierarchy

```java
public class Notification {
    private final String type;     // "EMAIL" | "SMS" | "PUSH"
    private final String recipient;
    private final String subject;        // only for EMAIL
    private final String message;
    private final String phoneNumber;    // only for SMS
    private final String deviceToken;    // only for PUSH
}
```

**Objective.** Convert the type-coded "fat" class into a `sealed interface` with one `record` per variant, each carrying only the fields that variant needs.

**Constraints.**
- `Notification` is a `sealed interface` with three permitted subtypes.
- `EmailNotification`, `SmsNotification`, `PushNotification` are records.
- Recipient is typed differently in each variant (`Email`, `PhoneNumber`, `DeviceToken`).
- A consumer uses exhaustive pattern matching (JEP 441).

**Acceptance criteria.**
- It is impossible to construct an `EmailNotification` without a subject (compile-time).
- Adding a new variant (`WebhookNotification`) forces the compiler to error out on every existing exhaustive switch.
- No field is "valid only for some variants".

---

## Task 7 — Build a `Percentage` value object

```java
public class PricingService {
    public BigDecimal applyDiscount(BigDecimal price, int discountPct) { ... }
    public BigDecimal applyTax(BigDecimal price, int taxBps) { ... }
    public BigDecimal applyFee(BigDecimal price, double feeRate) { ... }
}
```

**Objective.** Unify three different percentage encodings into a single `Percentage` value object.

**Constraints.**
- `Percentage` holds a `BigDecimal` fraction in `[0, 1]`.
- Three named factories: `ofPercent(int)`, `ofBasisPoints(int)`, `ofFraction(BigDecimal)`.
- `applyTo(BigDecimal)` returns the discounted/taxed/fee-applied amount.
- The service signature becomes `applyDiscount(BigDecimal, Percentage)` etc.

**Acceptance criteria.**
- `Percentage.ofPercent(20)` and `Percentage.ofBasisPoints(2000)` are `equals`-equal.
- `Percentage.ofPercent(150)` throws (out of range).
- The caller chooses the unit at the call site; the service implementation doesn't care.

---

## Task 8 — End-to-end: refactor an entire `OrderService`

```java
public class OrderService {
    public long placeOrder(long userId, long productId, int quantity, int unitPriceCents,
                           String currency, boolean express, String promoCode) {
        if (userId <= 0 || productId <= 0) throw new IllegalArgumentException();
        if (quantity <= 0 || quantity > 1000) throw new IllegalArgumentException();
        if (unitPriceCents <= 0) throw new IllegalArgumentException();
        if (currency.length() != 3) throw new IllegalArgumentException();
        long total = (long) quantity * unitPriceCents;
        if (promoCode != null && promoCode.startsWith("SAVE")) {
            total = total * 90 / 100;
        }
        long orderId = nextId.incrementAndGet();
        repo.save(new OrderRow(orderId, userId, productId, quantity, total, currency, express));
        return orderId;
    }
}
```

**Objective.** Apply every refactor from this section in one go.

**Constraints.**
- Every primitive that represents a domain concept becomes a typed wrapper.
- Validation moves to the wrapper compact constructors.
- The `boolean express` becomes a `ShippingMode` enum.
- The promo code logic becomes a small `PromoCode` value object with `applyTo(Money)`.
- The method signature has at most 4 parameters; consider a `PlaceOrderCommand` parameter object.

**Acceptance criteria.**
- The new `placeOrder` signature reads as prose at the call site.
- Each validation rule lives in exactly one place (the wrapper).
- The compile-time guard against argument swapping holds.

---

## Worked solution sketch — Task 8

A canonical solution (one of several valid shapes):

```java
public record UserId(long value)     { public UserId    { if (value <= 0) throw new IllegalArgumentException(); } }
public record ProductId(long value)  { public ProductId { if (value <= 0) throw new IllegalArgumentException(); } }
public record OrderId(long value)    { public OrderId   { if (value <= 0) throw new IllegalArgumentException(); } }

public record Quantity(int value) {
    public Quantity { if (value <= 0 || value > 1000) throw new IllegalArgumentException(); }
}

public record Money(long minorUnits, Currency currency) {
    public Money {
        Objects.requireNonNull(currency);
        if (minorUnits < 0) throw new IllegalArgumentException();
    }
    public Money times(int n)            { return new Money(Math.multiplyExact(minorUnits, n), currency); }
    public Money applyPercentage(int pct) { return new Money(minorUnits * pct / 100, currency); }
}

public enum ShippingMode { STANDARD, EXPRESS }

public record PromoCode(String value) {
    public PromoCode {
        Objects.requireNonNull(value);
        if (!value.matches("[A-Z0-9]{4,16}")) throw new IllegalArgumentException();
    }
    public Money applyTo(Money m) {
        return value.startsWith("SAVE") ? m.applyPercentage(90) : m;
    }
}

public record PlaceOrderCommand(UserId user, ProductId product, Quantity quantity,
                                 Money unitPrice, ShippingMode shipping,
                                 Optional<PromoCode> promo) {
    public PlaceOrderCommand {
        Objects.requireNonNull(user);
        Objects.requireNonNull(product);
        Objects.requireNonNull(quantity);
        Objects.requireNonNull(unitPrice);
        Objects.requireNonNull(shipping);
        Objects.requireNonNull(promo);
    }
}

public class OrderService {
    public OrderId placeOrder(PlaceOrderCommand cmd) {
        Money base  = cmd.unitPrice().times(cmd.quantity().value());
        Money total = cmd.promo().map(p -> p.applyTo(base)).orElse(base);
        OrderId id  = new OrderId(nextId.incrementAndGet());
        repo.save(new OrderRow(id, cmd.user(), cmd.product(), cmd.quantity(), total, cmd.shipping()));
        return id;
    }
}
```

Key wins:

- The original method's 13 lines of validation are spread across the wrappers, each runnable in isolation.
- The `boolean express` became `ShippingMode`, self-documenting at the call site.
- The promo logic moved to the type that owns it (`PromoCode.applyTo`).
- Swapping `user` and `product` at the construction site is a compile error.
- The service method shrank to four lines of orchestration.

---

## Self-grading rubric

For each task, score yourself on:

| Criterion                                                  | Points |
|------------------------------------------------------------|--------|
| Wrappers added for every confusable primitive              | 2      |
| Compact constructor with validation in each wrapper        | 2      |
| `record` (not handwritten class) where possible            | 1      |
| Booleans replaced with enums                               | 1      |
| Time/duration uses `Instant`/`Duration`                    | 1      |
| Test that would have caught the original bug               | 2      |
| Adapter layer is the only construction site for primitives | 1      |
| **Total**                                                  | **10** |

A score of 8+ means you've internalised the discipline. Below 6, revisit `middle.md`.

---

**Memorize this:** Eight exercises map onto eight wrapping moves — `Email`, `Money`, `WalletId`, time/duration, CSV-row parsing, sealed notification, `Percentage`, full-service refactor. Each move follows the same rhythm: wrapper → compact-constructor validation → push through the API → test. After three repetitions the move becomes muscle memory.
