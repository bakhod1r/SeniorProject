# Primitive Obsession — Middle

> **What?** The named refactorings from Fowler's catalog that target Primitive Obsession — *Replace Data Value with Object*, *Introduce Type Code*, *Replace Type Code with Class*, *Replace Type Code with Subclasses / State / Strategy*, *Introduce Parameter Object* — worked end to end on realistic Java code. Plus the modern Java idioms (`record`, sealed types, compact constructors) that turn each refactor into a one-screen change instead of a one-day chore.
> **How?** Each section names a starting smell, names the refactor, and shows the diff. Read the catalog name once, then memorise the *shape of the move*. After three repetitions on real code, the move becomes automatic.

---

## 1. Why a refactoring catalog beats ad-hoc fixes

Junior-level Primitive Obsession is about *seeing* the smell. Middle-level is about *executing* the refactor mechanically, with a known target shape. Fowler's *Refactoring* (2nd ed.) lists the relevant moves under five names; learning them gives you a shared vocabulary with code reviewers and a recipe you can apply without re-deciding the design every time.

Every refactor here follows the same rhythm: name the move, identify the unit being wrapped, write the wrapper with validation, push the new type through one boundary at a time, retest. None of these touch the framework or the architecture — they're local moves with global payoff.

---

## 2. Replace Data Value with Object — `String` to `Email`

A bare primitive that has identity, format, or behaviour graduates to a class.

```java
// Before
public class Customer {
    private final long id;
    private final String email;

    public Customer(long id, String email) {
        if (email == null || !email.contains("@")) {
            throw new IllegalArgumentException();
        }
        this.email = email;
    }

    public boolean sameDomainAs(Customer other) {
        return this.email.substring(this.email.indexOf('@'))
                  .equalsIgnoreCase(other.email.substring(other.email.indexOf('@')));
    }
}
```

The email *has behaviour* (`sameDomainAs`) that's reaching into the `String` and slicing it. That behaviour belongs on the email itself.

```java
// After
public record Email(String value) {
    public Email {
        if (value == null || !value.contains("@")) {
            throw new IllegalArgumentException("invalid email: " + value);
        }
        value = value.toLowerCase(Locale.ROOT);   // normalise
    }
    public String domain() {
        return value.substring(value.indexOf('@') + 1);
    }
}

public final class Customer {
    private final long id;
    private final Email email;

    public Customer(long id, Email email) {
        this.id = id;
        this.email = Objects.requireNonNull(email);
    }

    public boolean sameDomainAs(Customer other) {
        return this.email.domain().equalsIgnoreCase(other.email.domain());
    }
}
```

Three improvements:

- **Validation moved to the wrapper.** Every `Email` in the system is now guaranteed to contain `@`. `Customer` no longer carries the check.
- **Behaviour moved to the value.** `domain()` lives with the email, not on every class that holds one. DRY at the level of the value.
- **Normalisation centralised.** Lowercasing in the compact constructor means `equals` works correctly and every comparison is case-insensitive without explicit calls.

---

## 3. Validation in the compact constructor

JEP 395 (records, finalized in Java 16) provides a *compact constructor* that runs after the implicit field assignments. It is the right place for invariants:

```java
public record IsoCurrency(String code) {
    public IsoCurrency {
        Objects.requireNonNull(code, "code");
        if (code.length() != 3 || !code.equals(code.toUpperCase(Locale.ROOT))) {
            throw new IllegalArgumentException("currency must be 3-letter ISO 4217: " + code);
        }
    }
}

public record Percentage(double value) {
    public Percentage {
        if (Double.isNaN(value) || value < 0.0 || value > 100.0) {
            throw new IllegalArgumentException("percentage out of [0,100]: " + value);
        }
    }
}
```

Note: you can *reassign* the parameter inside the compact constructor (`value = value.toLowerCase(...)` above). The assignment to the field happens implicitly *after* the compact body runs. This is the standard idiom for normalisation.

---

## 4. Introduce Type Code — `String` channel to an `enum`

A string field that holds a small fixed set of values is begging to become an enum.

```java
// Before
public class Payment {
    private final String channel;   // "CARD" | "BANK" | "WALLET"
    public boolean isRefundable() {
        return channel.equals("CARD") || channel.equals("WALLET");
    }
}
```

Bugs hiding here:

- `channel = "card"` — case bug, silently never matches.
- `channel = "BANL"` — typo, silently never matches.
- Adding a new channel does not force the compiler to revisit `isRefundable`.

```java
// After
public enum PaymentChannel {
    CARD, BANK, WALLET;

    public boolean refundable() {
        return switch (this) {
            case CARD, WALLET -> true;
            case BANK -> false;
        };
    }
}

public class Payment {
    private final PaymentChannel channel;
    public boolean isRefundable() { return channel.refundable(); }
}
```

- Typos and case bugs become compile errors.
- The exhaustive `switch` (Java 21+, JEP 441) forces the maintainer to revisit `refundable()` when a new channel is added — the compiler refuses to compile until the new case is handled.

This is the smallest application of Fowler's *Introduce Type Code* in modern Java.

---

## 5. Replace Type Code with Class — when an enum is not enough

Enums work when each variant has the *same behaviour shape* (one method, returns a `boolean`, etc.). When variants need different fields or significantly different methods, promote the type code to a *class* hierarchy — usually a sealed one.

```java
// Before — type code with branching attribute logic
public class Notification {
    private final String type;   // "EMAIL" | "SMS" | "PUSH"
    private final String address;
    private final String phoneNumber;
    private final String deviceToken;
    // most fields are null most of the time
}
```

The "most fields are null most of the time" smell is a flag: the variants have *different shapes*.

```java
// After — sealed hierarchy with one type per shape
public sealed interface Notification permits EmailNotification, SmsNotification, PushNotification {}

public record EmailNotification(Email recipient, String subject, String body) implements Notification {}
public record SmsNotification(PhoneNumber recipient, String message) implements Notification {}
public record PushNotification(DeviceToken recipient, String title, String body) implements Notification {}

public final class NotificationSender {
    public void send(Notification n) {
        switch (n) {
            case EmailNotification e -> smtp.send(e.recipient().value(), e.subject(), e.body());
            case SmsNotification s   -> sms.send(s.recipient().value(),  s.message());
            case PushNotification p  -> push.send(p.recipient().value(), p.title(), p.body());
        }
    }
}
```

Each variant carries *only* the fields it needs. Pattern matching on the sealed type gives you exhaustive dispatch with no `default` case.

This is Fowler's *Replace Type Code with Subclasses* rendered through Java's sealed-type machinery (JEP 409, finalised in Java 17).

---

## 6. Introduce Parameter Object — collapse the data clump

A method that takes four primitives that always travel together is hiding a missing type.

```java
// Before
public void schedule(long appointmentId,
                     int year, int month, int day,
                     int hour, int minute,
                     String timezone) { ... }
```

Seven primitives, three of them date pieces, two of them time pieces, and a timezone `String`. Every caller assembles them independently; some get the order wrong.

```java
// After
public record Appointment(AppointmentId id, ZonedDateTime when) {
    public Appointment {
        Objects.requireNonNull(id);
        Objects.requireNonNull(when);
    }
}

public void schedule(Appointment appointment) { ... }
```

The seven primitives collapse into one parameter, the date+time+zone semantics are carried by `ZonedDateTime` (a JDK type that already validates), and the AppointmentId is its own typed wrapper.

This is *Introduce Parameter Object*. It is also the canonical bridge from Primitive Obsession to the related *Data Clumps* smell ([../08-data-clumps/](../08-data-clumps/)).

---

## 7. Replace boolean flag with enum

A method that takes a `boolean` mode parameter is hiding a type code.

```java
// Before
public List<Order> findOrders(Customer c, boolean includeRefunded, boolean includeCancelled) { ... }

findOrders(c, true, false);
findOrders(c, false, true);
findOrders(c, true, true);   // four combinations, none documented
```

The booleans turn the call site into a guessing game. The reader at the call site sees `(c, true, false)` and has no idea which flag is which.

```java
// After
public enum OrderFilter {
    ACTIVE_ONLY,
    INCLUDE_REFUNDED,
    INCLUDE_CANCELLED,
    INCLUDE_ALL;
}

public List<Order> findOrders(Customer c, OrderFilter filter) { ... }

findOrders(c, OrderFilter.INCLUDE_REFUNDED);
```

One parameter, four meaningful values, every call site self-documenting. If the rules grow into "show refunded but not yet ones over 30 days", you promote `OrderFilter` to a sealed interface with cases; the signature does not change.

---

## 8. Money — when one primitive is not enough

`int cents` for money has been a footgun for forty years.

```java
// Before
public class Account {
    private int balanceCents;
    public void deposit(int amountCents) { this.balanceCents += amountCents; }
    public void withdraw(int amountCents) { this.balanceCents -= amountCents; }
}
```

What's wrong:

- **Unit confusion.** "100" — is it cents, hundredths, dollars?
- **Overflow.** A corporate account in cents tops `Integer.MAX_VALUE` at $21 million.
- **Currency.** A USD account that receives a JPY-denominated transfer silently mixes units.
- **Rounding.** Multiplication for tax or interest can't be done correctly on raw cents.

```java
// After
public record Money(long amount, Currency currency) {
    public Money {
        Objects.requireNonNull(currency);
        // amount can legitimately be negative (debit), so no positivity check here
    }

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(Math.addExact(amount, other.amount), currency);
    }

    public Money minus(Money other) {
        requireSameCurrency(other);
        return new Money(Math.subtractExact(amount, other.amount), currency);
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException(
                "currency mismatch: %s vs %s".formatted(currency, other.currency));
        }
    }
}
```

`Math.addExact` raises on overflow rather than wrapping silently. Currency travels with the amount, so a JPY + USD operation fails loudly. The unit is `long`, which gives 9.2 quintillion in the smallest currency unit — enough for any realistic ledger.

We'll harden this further in `senior.md` (BigDecimal, rounding modes). For now, the `record` is already an order of magnitude safer than the bare `int`.

---

## 9. Wrapping at the boundary — the conversion layer

A common middle-level mistake is wrapping *inside* the domain while the entry points still deal in primitives. The wrappers then leak in and out repeatedly. The discipline is: **convert at the boundary**, then use wrappers throughout.

```java
public record CreateUserRequest(String email, String fullName, int ageInYears) {}

@PostMapping("/users")
public ResponseEntity<?> create(@RequestBody CreateUserRequest req) {
    var email = new Email(req.email());
    var name  = new FullName(req.fullName());
    var age   = new Age(req.ageInYears());
    userService.register(email, name, age);
    return ResponseEntity.ok().build();
}
```

The DTO is the boundary: it speaks JSON, which speaks `String` and `int`. The controller's job is to convert. From `userService.register(...)` inwards, only wrappers exist.

Similarly on the way out:

```java
public record UserResponse(String email, String fullName, int ageInYears) {
    public static UserResponse from(User u) {
        return new UserResponse(u.email().value(), u.name().value(), u.age().value());
    }
}
```

Unwrapping at the *output* boundary is fine. Unwrapping in the middle of a service method is a smell.

---

## 10. Combined cleanup — a small invoicing module

Bringing several refactors together. Before:

```java
public class InvoiceService {
    public void issue(String customerEmail,
                      long customerId,
                      int subtotalCents,
                      int taxRateBasisPoints,
                      String currency,
                      boolean sendEmail) {
        if (!customerEmail.contains("@")) throw new IllegalArgumentException();
        long taxCents = subtotalCents * taxRateBasisPoints / 10_000L;
        long totalCents = subtotalCents + taxCents;
        // ...
    }
}
```

Seven parameters, four primitives stand for domain concepts, two of them (`subtotalCents`, `taxRateBasisPoints`) silently coupled in units, one (`sendEmail`) is a hidden mode.

After:

```java
public record Email(String value)         { public Email { if (!value.contains("@")) throw new IllegalArgumentException(); } }
public record CustomerId(long value)      { public CustomerId { if (value <= 0) throw new IllegalArgumentException(); } }
public record Money(long minorUnits, IsoCurrency currency) {}
public record TaxRate(int basisPoints) {
    public TaxRate { if (basisPoints < 0 || basisPoints > 10_000) throw new IllegalArgumentException(); }
    public Money apply(Money base) { return new Money(base.minorUnits() * basisPoints / 10_000L, base.currency()); }
}
public enum NotificationMode { EMAIL_THE_CUSTOMER, SILENT }

public class InvoiceService {
    public void issue(Email customerEmail,
                      CustomerId customerId,
                      Money subtotal,
                      TaxRate taxRate,
                      NotificationMode mode) {
        Money tax   = taxRate.apply(subtotal);
        Money total = subtotal.plus(tax);
        // ...
    }
}
```

The seven primitives collapsed into five well-typed parameters. Validation lives in each wrapper. The `boolean` became a self-documenting enum. The tax calculation moved to the type that owns it. A caller cannot accidentally swap subtotal and tax rate — they're different types.

---

## 11. Quick rules

- [ ] Wrap a primitive the moment it gains *behaviour* (a method that operates on it).
- [ ] Wrap a primitive the moment two primitives of the same type can be confused at a call site.
- [ ] Always put invariants in the compact constructor — wrapper without check is decoration.
- [ ] Promote to a sealed hierarchy when variants have *different shapes*; stay with an enum when shapes are identical.
- [ ] Convert at the boundary; never let raw primitives flow into a service method.

---

## 12. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| DDD value objects, tiny types, Money rounding traps              | `senior.md`        |
| Project Valhalla, JEP 401, ArchUnit enforcement                  | `professional.md`  |
| Metrics and thresholds                                           | `specification.md` |
| Ten bugs caused by primitive obsession                           | `find-bug.md`      |
| Allocation, escape analysis, autoboxing                          | `optimize.md`      |
| Exercises                                                        | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

---

**Memorize this:** Five named moves cover ninety percent of the refactor work: *Replace Data Value with Object*, *Introduce Type Code (enum)*, *Replace Type Code with Class (sealed)*, *Introduce Parameter Object*, *Replace Boolean Flag with Enum*. The compact constructor in `record` is where the invariant goes. Wrap at the boundary, not in the middle.
