# Dispensables — Find the Bug

> 12 buggy snippets where Dispensables hide bugs.

---

## Bug 1 — Stale comment lies (Java)

```java
/**
 * Returns the user's full name in "First Last" format.
 * @return formatted name
 */
public String fullName() {
    return lastName + ", " + firstName;
}
```

<details><summary>Diagnosis</summary>

Comment says "First Last"; code returns "Last, First". Someone changed the implementation without updating the comment. Callers expecting "First Last" get "Last, First" — but the comment misleads them into thinking it's right.

**Fix:** delete the comment (or update). The smell is: comment didn't compile-check. Self-documenting names would catch the discrepancy:

```java
public String formattedAsLastFirst() {
    return lastName + ", " + firstName;
}
```

Now the *name* tells callers what they get. No comment needed; no drift possible.
</details>

---

## Bug 2 — Duplicated logic, one branch fixed (Python)

```python
def normalize_email(email):
    if email is None: return None
    return email.lower().strip()

def normalize_user_email(user):
    if user is None or user.email is None: return None
    return user.email.strip().lower()  # Note: order of strip/lower differs

# Usage 1 — uses normalize_email:
emails_db = [normalize_email(e) for e in input_emails]

# Usage 2 — uses normalize_user_email:
emails_user = [normalize_user_email(u) for u in users]
```

A user enters `"  ALICE@example.COM  "`.
- `normalize_email("  ALICE@example.COM  ")` → `"alice@example.com"`
- `normalize_user_email(user)` where `user.email = "  ALICE@example.COM  "` → `"alice@example.com"` ... wait, same result.

But what about `"  ALICE@example.COM\n  "`?
- `normalize_email` → `"alice@example.com"`
- `normalize_user_email` → `"alice@example.com"`

Hmm, same. Test with `"  ÉLOÏSE@example.COM  "`:
- `normalize_email("  ÉLOÏSE@example.COM  ".lower().strip())` → `"éloïse@example.com"`
- `normalize_user_email(user)` → `"  ÉLOÏSE@example.COM  ".strip().lower()` → `"éloïse@example.com"`

In Python, `.lower().strip()` and `.strip().lower()` are equivalent for most strings. But: a security report fix to `normalize_email` (handle Unicode case-folding correctly: `casefold()` instead of `lower()`) won't apply to `normalize_user_email` because they're separate functions.

<details><summary>Diagnosis</summary>

Duplicated logic with subtle differences. A bug fix to one is unlikely to be applied to the other. Evolution diverges over time.

**Fix:** consolidate.

```python
def normalize_email(email):
    if email is None: return None
    return email.strip().casefold()  # use casefold for Unicode

def normalize_user_email(user):
    return normalize_email(user.email if user else None)
```
</details>

---

## Bug 3 — Dead code re-enabled by mistake (Java)

```java
public class PaymentProcessor {
    public void charge(Order o) {
        chargeViaModernGateway(o);
        // chargeViaLegacyGateway(o);  // dead since 2023
    }
    
    private void chargeViaLegacyGateway(Order o) { ... }  // 200 lines
    private void chargeViaModernGateway(Order o) { ... }
}

// Months later, someone "cleans up" the comment:
public void charge(Order o) {
    chargeViaModernGateway(o);
    chargeViaLegacyGateway(o);  // <-- accidentally activated
}
```

<details><summary>Diagnosis</summary>

The commented-out call was a "dormant tombstone." Someone uncommented it thinking it was needed. Now every order is charged twice — once modern, once legacy.

**Fix:** had the dead code been deleted (not commented), this couldn't happen. Don't comment dead code; delete it. Git remembers.
</details>

---

## Bug 4 — Anemic Domain Model invariant violated (Java)

```java
class Account {
    public BigDecimal balance;
    public List<Transaction> transactions;
}

class AccountService {
    public void deposit(Account a, BigDecimal amount) {
        a.balance = a.balance.add(amount);
        a.transactions.add(new Transaction("DEPOSIT", amount));
    }
    public void withdraw(Account a, BigDecimal amount) {
        a.balance = a.balance.subtract(amount);
        a.transactions.add(new Transaction("WITHDRAW", amount));
    }
}

// Caller bypasses the service:
account.balance = BigDecimal.ZERO;  // doesn't add transaction!
```

<details><summary>Diagnosis</summary>

The anemic Account allows direct field mutation. Caller resets balance without recording a transaction. Audit log is now inconsistent with balance.

**Fix:** Encapsulate Field + Move Method.

```java
class Account {
    private BigDecimal balance;
    private final List<Transaction> transactions = new ArrayList<>();
    
    public void deposit(BigDecimal amount) {
        balance = balance.add(amount);
        transactions.add(new Transaction("DEPOSIT", amount));
    }
    public void withdraw(BigDecimal amount) {
        if (balance.compareTo(amount) < 0) throw new InsufficientFundsException();
        balance = balance.subtract(amount);
        transactions.add(new Transaction("WITHDRAW", amount));
    }
}
```

Direct mutation is no longer possible. Invariant holds.
</details>

---

## Bug 5 — Speculative hook called inconsistently (Java)

```java
abstract class JobRunner {
    protected void beforeRun() {}  // empty default
    protected void afterRun() {}   // empty default
    
    public void run() {
        beforeRun();
        execute();
        afterRun();
    }
    
    protected abstract void execute();
}

class ExpensiveJob extends JobRunner {
    @Override protected void beforeRun() { acquireLock(); }
    @Override protected void afterRun() { releaseLock(); }
    
    public void execute() {
        try {
            doWork();
        } catch (Exception e) {
            // crashes — afterRun not called
            throw e;
        }
    }
}
```

<details><summary>Diagnosis</summary>

`afterRun()` is called only if `execute()` returns normally. On exception, the lock is leaked.

**Fix:** template method should use try/finally:

```java
public void run() {
    beforeRun();
    try {
        execute();
    } finally {
        afterRun();
    }
}
```

Better still: don't have empty hooks. Move the lock-management entirely outside the template (e.g., wrap with a `WithLock<>` or use a `try-with-resources` pattern).
</details>

---

## Bug 6 — Lazy class hides null bug (Java)

```java
class TaxCalculator {
    private BigDecimal rate;  // not final, not initialized
    
    public TaxCalculator() {}
    
    public void setRate(BigDecimal rate) { this.rate = rate; }
    
    public BigDecimal apply(BigDecimal amount) {
        return amount.multiply(rate);  // NPE if setRate not called
    }
}

// Used:
TaxCalculator c = new TaxCalculator();
// Forgot c.setRate(...)
BigDecimal result = c.apply(new BigDecimal("100"));  // NPE
```

<details><summary>Diagnosis</summary>

Lazy class with delayed initialization. Required field can be unset. Inlining the logic eliminates the bug entirely.

**Fix 1 — make required fields constructor args:**

```java
class TaxCalculator {
    private final BigDecimal rate;
    public TaxCalculator(BigDecimal rate) {
        if (rate == null) throw new NullPointerException();
        this.rate = rate;
    }
    public BigDecimal apply(BigDecimal amount) { return amount.multiply(rate); }
}
```

**Fix 2 — inline the class:**

```java
BigDecimal result = amount.multiply(taxRate);
```

If the class is so trivial, eliminate it; the indirection introduced the bug.
</details>

---

## Bug 7 — Speculative interface mocked badly (Java)

```java
interface PaymentProcessor {
    PaymentResult charge(Order o);
}

class StripeProcessor implements PaymentProcessor {
    public PaymentResult charge(Order o) {
        return stripeApi.charge(o.getTotal());
    }
}

// In tests:
class TestProcessor implements PaymentProcessor {
    public PaymentResult charge(Order o) {
        return PaymentResult.success();  // never fails
    }
}

// Production:
@Bean
PaymentProcessor processor(@Value("${env}") String env) {
    if ("test".equals(env)) return new TestProcessor();
    return new StripeProcessor();
}
```

<details><summary>Diagnosis</summary>

The speculative interface was created "for testability" — but the test implementation leaks into production via a config switch. If `env` is misconfigured (or set to "test" in production by accident), real payments are skipped — orders ship without being charged.

**Fix:** don't conditionally swap implementations in production. Tests should mock the interface in the test code only:

```java
// In tests:
@Mock PaymentProcessor processor;
when(processor.charge(any())).thenReturn(PaymentResult.success());
```

Production wiring always uses the real implementation. The test mock never reaches production code.
</details>

---

## Bug 8 — Comment hides a workaround removal (Python)

```python
def fetch_user(user_id):
    # Workaround: API returns 503 sometimes; retry once.
    # See incident IR-1234.
    try:
        return api.fetch(user_id)
    except ApiError:
        return api.fetch(user_id)
```

A new engineer cleans up: "old comment, the API is fine now":

```python
def fetch_user(user_id):
    return api.fetch(user_id)
```

Production: 503s spike again three months later (the API still flaps). Customer complaints.

<details><summary>Diagnosis</summary>

The comment was a *good* comment (why-comment with reference). Removing it removed the institutional knowledge. The cleanup wasn't smell-fixing; it was deleting useful context.

**Lesson:** when in doubt about whether a comment is the smell, check the *content*. Why-comments are not the smell. Don't aggressively delete them.

**Fix:** restore the workaround AND the comment.
</details>

---

## Bug 9 — Duplicate validation drifts (Java)

```java
class UserRegistration {
    public void register(String email, String password) {
        if (email == null || !email.contains("@")) throw new ValidationException();
        if (password == null || password.length() < 8) throw new ValidationException();
        // ... persist
    }
}

class UserUpdate {
    public void update(String email, String password) {
        if (email == null || !email.contains("@")) throw new ValidationException();
        if (password == null || password.length() < 6) throw new ValidationException();
        // Note: 6, not 8! Drift.
    }
}
```

<details><summary>Diagnosis</summary>

Same validation logic, drifted apart. Updating a user with a 6-character password is allowed; registering one isn't. Inconsistent rule.

**Fix:** extract.

```java
class UserValidator {
    public static void validateEmail(String email) {
        if (email == null || !email.contains("@")) throw new ValidationException();
    }
    public static void validatePassword(String password) {
        if (password == null || password.length() < 8) throw new ValidationException();
    }
}

class UserRegistration {
    public void register(String email, String password) {
        UserValidator.validateEmail(email);
        UserValidator.validatePassword(password);
        // persist
    }
}
```
</details>

---

## Bug 10 — Dead branch protects against fixed bug (Java)

```java
public Date parseDate(String input) {
    // Bug 5678: legacy code sometimes sends "0000-00-00"
    if ("0000-00-00".equals(input)) return null;
    
    return DateFormat.getInstance().parse(input);
}
```

The bug 5678 was fixed in the source system 3 years ago. The defensive branch persists. A new engineer thinks the field can be `0000-00-00` and writes code expecting it; gets confused when the source system never sends that value.

<details><summary>Diagnosis</summary>

Defensive code outliving its bug. Now misleading future readers who think the case is real.

**Fix:** delete the branch. Add a test that asserts the source system can't send `"0000-00-00"`. If the assumption breaks, the test fails fast (better than silently accepting bad data forever).
</details>

---

## Bug 11 — Empty Lazy package (Go)

```go
package money

// Empty file — placeholder
```

A `package money` was created with no contents, "to claim the namespace." Months later, an engineer adds a `Dollar` type:

```go
package main

import "money"

type Dollar struct { ... }  // wait, this is in main, not money
```

The `Dollar` type was added to the wrong package; the `money` package remains empty.

<details><summary>Diagnosis</summary>

The empty package created confusion. Either build it out or remove it.

**Fix:** delete the empty package. When a type genuinely needs to live in `money`, create it then.
</details>

---

## Bug 12 — Speculative pluggable backend (Java)

```java
interface StorageBackend {
    void save(String key, byte[] data);
    byte[] load(String key);
}

class FileStorageBackend implements StorageBackend { ... }
class S3StorageBackend implements StorageBackend { ... }
class InMemoryStorageBackend implements StorageBackend {
    private final Map<String, byte[]> data = new HashMap<>();
    public void save(String key, byte[] d) { data.put(key, d); }
    public byte[] load(String key) { return data.get(key); }
}

// Service:
@Bean StorageBackend storage(@Value("${storage}") String type) {
    return switch (type) {
        case "file" -> new FileStorageBackend();
        case "s3" -> new S3StorageBackend();
        case "memory" -> new InMemoryStorageBackend();
        default -> throw new IllegalArgumentException();
    };
}
```

A misconfigured production deploy sets `storage=memory`. The service runs fine in production for 6 months, accumulating uploads in memory. Then the JVM restarts. All uploads are gone.

<details><summary>Diagnosis</summary>

Speculative backend selection — `InMemoryStorageBackend` was for tests but is selectable in production via config. Misconfiguration silently degrades to lossy storage.

**Fix:** don't allow test backends in production. Use distinct beans (only one is registered based on Spring profile):

```java
@Bean @Profile("production")
StorageBackend prodStorage() { return new S3StorageBackend(); }

@Bean @Profile("test")
StorageBackend testStorage() { return new InMemoryStorageBackend(); }
```

Profile is set at startup; misconfiguration fails fast (no bean of expected type).
</details>

---

> **Next:** [optimize.md](optimize.md) — inefficient cures.
