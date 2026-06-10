# Primitive Obsession — Find the Bug

> Ten numbered scenarios, each a real-world bug born from passing primitives where a typed wrapper would have refused to compile. For every scenario: the code, the symptom you'd see in production, the diagnosis, and the fix. Treat them as flashcards — after the third one you'll start seeing the pattern at code review.

---

## Bug 1 — `sendWelcome(name, email)` instead of `sendWelcome(email, name)`

```java
public class WelcomeMailer {
    public void sendWelcome(String email, String name) {
        smtp.send(email, "Welcome, " + name + "!", "Thanks for joining.");
    }
}

// Three layers up:
mailer.sendWelcome(user.getName(), user.getEmail());
//                  ^^^^ swapped
```

**Symptom.** Welcome emails go out with `To: Alice Johnson` (invalid address — SMTP server rejects), and on the rare occasion the SMTP server accepts a malformed `To:`, the email *body* greets the user as `alice@example.com`. Customer support tickets, no exception, no test failure.

**Diagnosis.** Two `String` parameters of the same type in one signature — the type system cannot enforce position. The caller misremembered the order. Three layers of refactors hid the original parameter intent.

**Fix.** Replace the two `String`s with typed records:

```java
public record Email(String value) {
    public Email { if (!value.contains("@")) throw new IllegalArgumentException(value); }
}
public record FullName(String value) {}

public void sendWelcome(Email email, FullName name) { ... }

mailer.sendWelcome(user.getName(), user.getEmail());
//                  ^^^^ compile error: FullName is not Email
```

The swap that took a week to find in production becomes a compile failure in the IDE.

---

## Bug 2 — `int amountCents` overflow on a corporate invoice

```java
public class InvoiceService {
    public Invoice create(long customerId, int amountCents) {
        return new Invoice(customerId, amountCents);
    }
}

// Caller:
service.create(7, 250_000_000_00);   // intended: 25 billion cents = $250M
```

**Symptom.** A multi-million-dollar invoice is silently truncated to a negative number. The customer pays nothing or, worse, the system tries to *credit* them. Detected weeks later by reconciliation.

**Diagnosis.** `int` maxes out around 2.1 billion. The literal `250_000_000_00` is interpreted as `int` and silently overflows into a negative number. `int amountCents` was wrong on every count — width, units (cents is implicit only by name), currency (USD or another?), and sign rules.

**Fix.** Use `Money` with a `long` (or `BigDecimal`) carrier and overflow-checked arithmetic:

```java
public record Money(long minorUnits, Currency currency) {
    public Money plus(Money o) {
        return new Money(Math.addExact(minorUnits, o.minorUnits), currency);
    }
}

public Invoice create(CustomerId customerId, Money amount) { ... }
```

`Math.addExact` throws `ArithmeticException` on overflow rather than wrapping. The type signature also forces the caller to think about units and currency, which removes the second class of bug.

---

## Bug 3 — `long timestamp` without time zone

```java
public class EventStore {
    public void record(long eventTimeMillis, String eventType) {
        events.add(new Event(eventTimeMillis, eventType));
    }
}

// Caller A — Java service in Tokyo:
store.record(LocalDateTime.now().toEpochSecond(ZoneOffset.UTC) * 1000, "LOGIN");

// Caller B — Python service in New York:
store.record(int(time.time() * 1000), "LOGIN");

// Caller C — confused junior:
store.record(System.currentTimeMillis() + 3600_000, "LOGIN");   // "an hour from now in Tokyo"
```

**Symptom.** Events appear out of order in the audit log. Daily reports show login spikes at 5am because of a Tokyo→UTC mistake. Worst of all: it's intermittent — some services convert, some don't.

**Diagnosis.** `long` carries no information about *what kind* of long. Is it epoch millis, epoch seconds, monotonic nanos, or "minutes since application start"? Is it UTC, the JVM's default zone, the user's zone? Every caller invents its own answer.

**Fix.** Use `java.time.Instant` for points in time and `ZonedDateTime` for human-facing time:

```java
public record EventTime(Instant utc) {}

public void record(EventTime when, EventType type) { ... }

// Caller:
store.record(new EventTime(Instant.now()), EventType.LOGIN);
```

`Instant` is unambiguous — it is *always* UTC, it is *always* nanosecond-precision since 1970. Callers cannot pass milliseconds-since-boot by accident.

---

## Bug 4 — `boolean isUrgent, boolean isRefund, boolean dryRun`

```java
public class OrderProcessor {
    public void process(Order o, boolean isUrgent, boolean isRefund, boolean dryRun) { ... }
}

// Caller:
processor.process(o, true, false, false);
// Wait — was that urgent+regular or refund+dryRun? Who knows.
```

**Symptom.** During a refund migration, a developer swaps `process(o, true, true, false)` to `process(o, false, true, true)` thinking they're enabling dry-run. They're actually *disabling* urgency and enabling dry-run — but the refund flag stayed `true`. Real refunds go out at non-urgent priority. Customers wait 7 days for a refund that should have taken hours.

**Diagnosis.** Three booleans, eight combinations, zero compile-time hint about which slot is which. The call site reads as a puzzle. Boolean mode flags are Primitive Obsession's most insidious form.

**Fix.** Replace each boolean with a small enum, or collapse them into a single options object:

```java
public enum Priority { URGENT, NORMAL }
public enum Mode { REGULAR, REFUND }
public enum Execution { LIVE, DRY_RUN }

public void process(Order o, Priority p, Mode m, Execution e) { ... }

processor.process(o, Priority.URGENT, Mode.REFUND, Execution.DRY_RUN);
```

Now the call site reads like prose. A swap fails the compiler.

---

## Bug 5 — `String currency` vs `Currency currency`

```java
public class FxService {
    public BigDecimal convert(BigDecimal amount, String from, String to) {
        return amount.multiply(rateProvider.get(from, to));
    }
}

// Caller:
fx.convert(new BigDecimal("100"), "us", "Eur");
//                                ^^^   ^^^^   wrong case, wrong code
```

**Symptom.** `rateProvider.get("us", "Eur")` returns `null` because the rate table uses uppercase `USD`/`EUR`. The multiplication NullPointers. In production logs: `java.lang.NullPointerException` in line 14 — buried in an FX service that handles millions of requests an hour.

**Diagnosis.** `String` for a currency code does not enforce length (must be 3), case (must be uppercase), or membership (must be ISO 4217). Three failure modes share one parameter.

**Fix.** Wrap the currency:

```java
public record IsoCurrency(String code) {
    public IsoCurrency {
        if (code == null || code.length() != 3) throw new IllegalArgumentException();
        if (!code.equals(code.toUpperCase(Locale.ROOT))) throw new IllegalArgumentException();
    }
}

public Money convert(Money amount, IsoCurrency to) { ... }
```

Or use the JDK's own `java.util.Currency.getInstance("USD")` — which validates against the ISO 4217 table at construction.

---

## Bug 6 — `Map<String, String>` for request headers

```java
public class HttpClient {
    public Response get(String url, Map<String, String> headers) { ... }
}

// Caller:
client.get("https://api.example.com", Map.of(
    "content-type", "application/json",
    "Content-Type", "text/xml"
));
```

**Symptom.** The API returns 415 *Unsupported Media Type*. The developer swears they set `application/json`. They didn't read the documentation that HTTP header names are case-insensitive but Java's `Map<String, String>` is *not*. Both entries coexist; which one wins depends on iteration order.

**Diagnosis.** A `Map<String, String>` is too loose for HTTP headers. The structure does not encode the case-insensitivity rule that HTTP requires. Both keys are "valid" Java map keys.

**Fix.** Wrap headers in a type that enforces canonical case:

```java
public final class Headers {
    private final Map<String, String> data = new LinkedHashMap<>();
    public Headers set(String name, String value) {
        data.put(name.toLowerCase(Locale.ROOT), value);
        return this;
    }
    public Optional<String> get(String name) {
        return Optional.ofNullable(data.get(name.toLowerCase(Locale.ROOT)));
    }
}

public Response get(URI url, Headers headers) { ... }
```

The class enforces the case-insensitivity rule. The bug becomes impossible.

---

## Bug 7 — `String userId` accepting an empty string

```java
public class UserRepository {
    public Optional<User> findById(String userId) {
        return jdbc.queryForOptional("SELECT * FROM users WHERE id = ?", userId);
    }
}

// Caller, after a controller bug:
repo.findById("");
```

**Symptom.** A controller that should have rejected an empty path parameter (`/users/`) instead matched `/users/` to a wildcard route. The empty string flows to the repository. The SQL runs with `id = ''`. No row matches; `findById` returns `Optional.empty()`. The caller — expecting a 404 *or* an exception — returns 200 with a missing user. Downstream code crashes with NPE.

**Diagnosis.** `String userId` accepts *any* string: empty, whitespace, `null`, "DROP TABLE users". The repository trusts that the caller validated. The caller trusts that the framework validated. Neither did.

**Fix.** Make `UserId` self-validating:

```java
public record UserId(String value) {
    public UserId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("userId must not be blank");
        }
        if (!value.matches("[a-zA-Z0-9-]{6,40}")) {
            throw new IllegalArgumentException("userId format invalid: " + value);
        }
    }
}

public Optional<User> findById(UserId id) { ... }
```

The empty string is rejected at the controller boundary, the moment it tries to construct a `UserId`. The repository never sees it.

---

## Bug 8 — `int percentage` ambiguous between 50 and 0.5

```java
public class DiscountService {
    public BigDecimal apply(BigDecimal price, int percentage) {
        return price.multiply(BigDecimal.valueOf(1.0 - percentage / 100.0));
    }
}

// Caller A:
discount.apply(price, 20);    // 20% off — correct

// Caller B:
discount.apply(price, 200);   // intent: 200 basis points = 2% off — price becomes negative
```

**Symptom.** Caller B applies a "200 basis points" promo. The discount service interprets it as `200%`, making the discount 200% — the new price is `price * (1 - 2) = -price`. Customers see negative totals on checkout.

**Diagnosis.** "Percentage" can mean a fraction (`0.20`), a centi-fraction (`20`), or a basis point (`2000`). `int` chooses none of them. Each caller picks its own convention.

**Fix.** Make the unit explicit in the type:

```java
public record Percentage(BigDecimal fraction) {
    public Percentage { if (fraction.signum() < 0 || fraction.compareTo(BigDecimal.ONE) > 0) throw new IllegalArgumentException(); }
    public static Percentage ofPercent(int pct) { return new Percentage(new BigDecimal(pct).movePointLeft(2)); }
    public static Percentage ofBasisPoints(int bps) { return new Percentage(new BigDecimal(bps).movePointLeft(4)); }
    public BigDecimal applyTo(BigDecimal v) { return v.multiply(fraction); }
}

discount.apply(price, Percentage.ofPercent(20));
discount.apply(price, Percentage.ofBasisPoints(200));
```

The factory method *names* the unit. The constructor *enforces* the range. The bug becomes impossible to express.

---

## Bug 9 — `long durationMillis` for a timeout, `long durationSeconds` for a TTL

```java
public class CacheClient {
    public void put(String key, byte[] value, long ttlSeconds) { ... }
}

public class HttpClient {
    public Response get(String url, long timeoutMillis) { ... }
}

// Caller copy-pastes from one to the other:
cache.put(key, value, 5000);     // intended: 5 seconds → got 5000 seconds (~83 min)
http.get(url, 5);                // intended: 5 seconds → got 5 millis (instant timeout)
```

**Symptom.** Cache entries linger for an hour past their intended lifetime, displacing live data and causing memory pressure. HTTP calls time out instantly with no useful error. Both come from the same junior who didn't read the parameter names.

**Diagnosis.** `long` for time durations is unit-blind. Two APIs in the same codebase use different units. The compiler accepts both.

**Fix.** Use `java.time.Duration` everywhere:

```java
public void put(String key, byte[] value, Duration ttl) { ... }
public Response get(URI url, Duration timeout) { ... }

cache.put(key, value, Duration.ofSeconds(5));
http.get(uri, Duration.ofSeconds(5));
```

`Duration` is unambiguous, supports nanosecond precision, has arithmetic that works correctly across day/leap boundaries, and tells the reader the unit at the call site.

---

## Bug 10 — `(long fromAccountId, long toAccountId)` swapped during a refactor

```java
public class TransferService {
    public void transfer(long fromAccountId, long toAccountId, BigDecimal amount) { ... }
}

// Original caller:
transfers.transfer(account.getId(), recipient.getId(), amount);

// After a refactor that renamed `recipient` to `from`:
transfers.transfer(from.getId(), account.getId(), amount);
//                  ^^^^^^^^^^ direction reversed
```

**Symptom.** A scheduled transfer that should debit a corporate account and credit an employee debits the employee instead. Discovered three days later when payroll complains. Money is moved, then moved back manually with audit trails apologising.

**Diagnosis.** Two `long`s of the same type cannot tell each other apart. A rename during refactoring swapped which variable plays which role. The compiler had no way to catch this.

**Fix.** Wrap each role distinctly. The cleanest version uses a `Transfer` parameter object that names the roles explicitly:

```java
public record AccountId(long value) {}

public record Transfer(AccountId from, AccountId to, Money amount) {
    public Transfer {
        Objects.requireNonNull(from);
        Objects.requireNonNull(to);
        if (from.equals(to)) throw new IllegalArgumentException("self-transfer");
    }
}

public void transfer(Transfer t) { ... }

transfers.transfer(new Transfer(corporate.id(), employee.id(), amount));
```

The construction site is the only place the order matters, and the field names (`from`, `to`) make the role obvious. Any subsequent passing of the `Transfer` object cannot scramble the roles.

---

## Pattern across the bugs

Every bug above shares the same shape:

1. A method accepts two or more values of the same primitive type *with different meanings*.
2. The compiler cannot tell them apart.
3. A refactor, copy-paste, or distracted developer swaps them.
4. The failure is *silent* — wrong data flows, no exception, no immediate crash.
5. Discovery comes via reconciliation, customer complaint, or production analytics.

The fix is mechanical: introduce a typed wrapper per concept, validate in the compact constructor, push the wrapper through the API. Three minutes per concept, permanent bug class elimination.

**The diagnostic question.** When you see a method signature, ask: *"Could I swap any two of these arguments and still get clean compile?"* If yes, you've spotted the smell.

---

**Memorize this:** Every primitive-obsession bug looks the same — two same-typed parameters get swapped, no exception is thrown, the data is silently wrong, and discovery happens days later. The diagnostic question at code review: *can I swap any two arguments and still compile?* If yes, wrap them.
