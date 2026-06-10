# Attributes and Methods — Tasks

> Hands-on exercises that build muscle memory for declaring, validating, and using fields and methods. Every task lists acceptance criteria — write JUnit tests that prove each one before declaring it done.

---

## Task 1 — Encapsulate a `Person`

You're given a class:

```java
public class Person {
    public String firstName;
    public String lastName;
    public int    age;
}
```

**Requirements:**

- Convert all public fields to `private`.
- Add validating setters: `setFirstName`/`setLastName` reject `null` and empty strings; `setAge` rejects negatives and `> 150`.
- Add getters.
- Add `String fullName()` that returns `"firstName lastName"`.
- Boolean accessor `isAdult()` returns `age >= 18`.

**Acceptance:**
- `setFirstName(null)` throws `IllegalArgumentException`.
- `setAge(-1)` throws.
- `fullName()` works for a constructed `Person`.
- Tests cover all branches.

---

## Task 2 — Replace public fields with a record

Refactor Task 1 to a record where appropriate:

```java
public record Person(String firstName, String lastName, int age) {
    public Person {
        if (firstName == null || firstName.isBlank())
            throw new IllegalArgumentException("firstName");
        if (lastName == null || lastName.isBlank())
            throw new IllegalArgumentException("lastName");
        if (age < 0 || age > 150) throw new IllegalArgumentException("age");
    }
    public String fullName() { return firstName + " " + lastName; }
    public boolean isAdult()  { return age >= 18; }
}
```

**Acceptance:**
- All Task 1 tests still pass.
- The record's auto-generated `equals`, `hashCode`, `toString` work correctly.
- Compact constructor handles all validation.

---

## Task 3 — Static factory methods

Build a `Color` value class with no public constructor.

**Requirements:**
- Hidden constructor.
- Static factories: `Color.rgb(int r, int g, int b)`, `Color.rgba(int r, int g, int b, int a)`, `Color.fromHex(String hex)` (accepts `"#RRGGBB"` or `"#RRGGBBAA"`).
- Validate r/g/b/a are in `0..255`.
- Static constants `Color.BLACK`, `Color.WHITE`, `Color.RED`, etc. (cache common values).
- `toHex()` returns `"#RRGGBBAA"`.

**Acceptance:**
- `Color.rgb(256, 0, 0)` throws.
- `Color.fromHex("#FF0000")` equals `Color.RED`.
- `Color.BLACK` is the same instance regardless of how many times you reference it.

---

## Task 4 — Avoid the boolean trap

Refactor:

```java
public class FileWriter {
    public void write(String path, String content, boolean append) { ... }
}
```

**Requirements:**

- Replace the boolean parameter with a meaningful enum (`WriteMode.OVERWRITE`, `WriteMode.APPEND`).
- Or split into two methods: `write(String, String)` and `appendTo(String, String)`.
- Document why this is better than a boolean parameter.

**Acceptance:**
- The original boolean overload is gone.
- Call sites read clearly: `writer.write("f", "txt")` vs `writer.appendTo("f", "txt")`.

---

## Task 5 — Replace getter/setter with capability methods

You're given:

```java
public class Counter {
    private int count;
    public int  getCount()       { return count; }
    public void setCount(int c)  { this.count = c; }
}
```

Callers do:

```java
counter.setCount(counter.getCount() + 1);
counter.setCount(counter.getCount() - 1);
```

**Requirements:**

- Replace `getCount`/`setCount` with `increment()`, `decrement()`, `current()`.
- Make `current()` thread-safe via either `synchronized` or `AtomicInteger`.
- Add `incrementBy(int delta)` for batch operations.
- Validate: `decrement()` throws if `current() == 0`.

**Acceptance:**
- 100 threads each calling `increment()` 1000 times, then `current()` returns exactly 100,000.
- Cannot directly set the counter from outside.

---

## Task 6 — Defensive copies on collections

Given:

```java
public class Order {
    private List<String> tags = new ArrayList<>();

    public Order(List<String> tags) { this.tags = tags; }     // ❌ leak
    public List<String> tags()      { return tags; }           // ❌ leak
}
```

**Requirements:**

- Constructor: defensive-copy via `List.copyOf(tags)`.
- Getter: return an unmodifiable view, or just return `List.copyOf(tags)` again.
- Add `addTag(String)` that performs a copy-on-write update if the order is meant to be immutable, or mutates the internal list if it's mutable. Pick one; document.

**Acceptance:**
- Mutating the input list after constructing the order doesn't change the order's tags.
- Mutating the returned list doesn't change the order's tags.

---

## Task 7 — Method overloading without ambiguity

Implement an `EventBus`:

```java
public class EventBus {
    public void publish(Event event)        { ... }
    public void publish(List<Event> events) { ... }
}
```

Now consider:

```java
bus.publish(new ArrayList<>());   // calls List overload
bus.publish((Event) null);        // calls Event overload
bus.publish(null);                 // ❌ ambiguous
```

**Requirements:**

- Add a third overload `publish(Event... events)` for varargs.
- Document: `publish(null)` is ambiguous and not allowed.
- Add `publishAll(Iterable<Event>)` instead, eliminating the overload conflict for collections.

**Acceptance:**
- All three overloads compile and work.
- `publishAll(...)` is the recommended way to send a collection.

---

## Task 8 — Fluent builder

Build an `EmailMessage` with a fluent builder.

**Requirements:**
- `EmailMessage` is immutable: `from`, `to` (list), `cc` (list), `subject`, `body` (text), `attachments` (list).
- Builder: `EmailMessage.builder().from(...).to(...).cc(...).subject(...).body(...).attach(...).build()`.
- `to(...)` and `cc(...)` are repeatable (additive).
- `build()` validates: `from` and `to` are required; `subject` defaults to `"(no subject)"` if missing.
- Builder is *not* thread-safe; document so.

**Acceptance:**
- Calling `build()` without `from` throws.
- Each `attach(file)` adds to the list.
- Mutating the returned `EmailMessage`'s lists is rejected.

---

## Task 9 — Pure vs side-effecting methods

Given a service:

```java
public class UserService {
    public boolean createUser(String email) {
        if (!email.contains("@")) return false;
        users.add(new User(email));
        emailClient.sendWelcome(email);
        return true;
    }
}
```

**Requirements:**

- Split into a pure validator (`validateEmail(String) -> boolean`) and a side-effecting `createUser(String)` that calls the validator first.
- Make `createUser` throw on invalid input rather than returning a boolean.
- Make the email-sending optional: extract a `notifyWelcome(User)` method that the user of `createUser` can call separately.

**Acceptance:**
- `validateEmail` has no side effects and is testable in isolation.
- `createUser` either succeeds atomically or throws — no partial state.

---

## Task 10 — Static method, instance method, when

Given:

```java
public class StringUtils {
    public static String reverse(String s) {
        return new StringBuilder(s).reverse().toString();
    }
    public static int countVowels(String s) { ... }
}

public class TextProcessor {
    private final String text;
    public TextProcessor(String text) { this.text = text; }
    public String reverse()    { return StringUtils.reverse(text); }
    public int    vowelCount() { return StringUtils.countVowels(text); }
}
```

**Requirements:**

- Decide which methods belong as static utilities and which on `TextProcessor`.
- Justify: pure transformations on `String` belong on `StringUtils` (no instance state needed).
- `TextProcessor` becomes a thin wrapper holding the text plus convenient calls.
- Make `StringUtils` non-instantiable: private constructor that throws.

**Acceptance:**
- `new StringUtils()` throws (or compile error if you make the class final + private constructor).
- Both call paths work (`StringUtils.reverse(s)` and `new TextProcessor(s).reverse()`).

---

## Task 11 — Avoiding null returns

Refactor:

```java
public class UserRepository {
    public User findById(long id) {
        // returns null if not found
    }
}
```

**Requirements:**

- Provide three explicit variants:
  - `findById(long id) -> Optional<User>` for "may be missing."
  - `getById(long id) -> User` throws `UserNotFoundException` if absent.
  - `findActiveUsers() -> List<User>` returns empty list when none.
- Document each and pick the right one for each caller in the codebase.
- No `null` returns anywhere.

**Acceptance:**
- Callers never check for null; they use `Optional`'s API or catch the exception.
- `findActiveUsers()` always returns a non-null list (empty if no users).

---

## Task 12 — Idempotent method

Build a `PaymentService.charge(...)` that's safe to retry.

**Requirements:**
- Method signature: `PaymentResult charge(PaymentRequest req)`.
- `PaymentRequest` includes an `idempotencyKey` (UUID supplied by the caller).
- The service stores `idempotencyKey -> PaymentResult` in a thread-safe map.
- A second call with the same key returns the cached result (without re-charging).
- A first call with a new key processes the payment and stores the result.
- Race condition: two simultaneous calls with the same key — exactly one performs the charge, both observe the same result.

**Acceptance:**
- Calling `charge(...)` twice with the same key produces one underlying side effect.
- 50 threads racing the same key → one underlying charge, all 50 see the same result.
- Different keys are processed independently.

---

## Task 13 — Method that uses VarHandle for atomic update

Build a `LongCounter` that uses `VarHandle` instead of `synchronized`.

**Requirements:**
- Internal `long count`.
- Methods: `increment()`, `incrementBy(long delta)`, `get()`.
- Use `MethodHandles.lookup().findVarHandle(...)` to obtain a `VarHandle` for the field.
- All updates use `VarHandle.getAndAdd(this, delta)`.
- Read uses `VarHandle.getOpaque(this)` for cheap reads (or `getAcquire` if cross-thread visibility needed).

**Acceptance:**
- 100 threads each calling `increment()` 10,000 times → final `get()` is exactly 1,000,000.
- No `synchronized` blocks anywhere.
- Confirm via JMH that this is at least as fast as `AtomicLong.incrementAndGet()`.

---

## Task 14 — Method-level documentation

Pick any 5 methods you've written in earlier tasks. For each, write Javadoc that includes:

**Requirements:**

- One-sentence summary.
- `@param` for every parameter, documenting nullability and any other constraints.
- `@return` documenting the return value (especially nullability).
- `@throws` for every checked or commonly thrown unchecked exception.
- A brief example for non-obvious methods.

**Acceptance:**
- Run `javadoc` and the output is clean (no warnings).
- A reader can understand the method's contract without reading the body.

---

## Task 15 — Method extraction practice

Given the Long Method:

```java
public BigDecimal computeInvoice(Order order, Customer customer) {
    BigDecimal subtotal = BigDecimal.ZERO;
    for (OrderLine line : order.lines()) {
        BigDecimal price = line.unitPrice().multiply(BigDecimal.valueOf(line.quantity()));
        if (line.discountPercent() > 0) {
            price = price.multiply(BigDecimal.valueOf(100 - line.discountPercent())
                                              .divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP));
        }
        subtotal = subtotal.add(price);
    }
    BigDecimal tax;
    if (customer.country().equals("US")) {
        tax = subtotal.multiply(new BigDecimal("0.07"));
    } else if (customer.country().equals("DE")) {
        tax = subtotal.multiply(new BigDecimal("0.19"));
    } else {
        tax = BigDecimal.ZERO;
    }
    BigDecimal total = subtotal.add(tax);
    if (customer.isPremium()) {
        total = total.multiply(new BigDecimal("0.95"));
    }
    return total.setScale(2, RoundingMode.HALF_UP);
}
```

**Requirements:**

- Extract `lineSubtotal(OrderLine)`, `subtotalOf(Order)`, `taxFor(BigDecimal subtotal, Customer)`, `applyPremiumDiscount(BigDecimal, Customer)`.
- The orchestrating `computeInvoice` becomes a few lines.
- Add tests that exercise each extracted method independently.
- Behavior unchanged.

**Acceptance:**
- `computeInvoice` is under 10 lines.
- Each extracted method has a single responsibility and is tested.
- Original behavior preserved (run tests against the original implementation as a regression check).

---

## Stretch goals

- For Task 12, profile the cached vs uncached path with JMH and show the cache improves hot-path latency.
- For Task 13, run with `-XX:+PrintAssembly` (with hsdis) and confirm `getAndAdd` becomes a single `LOCK XADD` on x86.
- For Task 8, generate the builder via Lombok's `@Builder` and compare ergonomics with the hand-written version.

---

## How to verify

For every task, write JUnit tests that *codify* the acceptance criteria. The point isn't merely "does it work?" — it's **"does the test document the contract clearly enough that a future maintainer cannot accidentally regress it?"** A passing test is the most durable comment your future self will read.
