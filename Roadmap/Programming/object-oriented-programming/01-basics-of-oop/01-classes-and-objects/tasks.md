# Classes and Objects — Tasks

> Hands-on exercises that build the muscle memory for declaring classes, instantiating objects, and getting the invariants right. Every task has acceptance criteria — you should be able to demonstrate they pass before moving on.

---

## Task 1 — `Money` value object

Create a `Money` value class.

**Requirements:**
- Fields: `long cents`, `Currency currency` (use `java.util.Currency`).
- `final` class, all fields `final` and `private`.
- Static factories: `Money.of(long cents, Currency c)`, `Money.zero(Currency c)`.
- Operations: `plus(Money other)`, `minus(Money other)`, `times(int factor)`. Each returns a new `Money`.
- `plus`/`minus` throw `IllegalArgumentException` if currencies don't match.
- Use `Math.addExact` / `Math.subtractExact` / `Math.multiplyExact` — overflow must throw, not wrap.
- Override `equals`, `hashCode`, and `toString`.
- Constructor is private; the only way to create a `Money` is via the static factories.

**Acceptance:**
- `Money.of(500, USD).plus(Money.of(300, USD))` equals `Money.of(800, USD)`.
- `Money.of(500, USD).plus(Money.of(300, EUR))` throws.
- `Money.of(Long.MAX_VALUE, USD).plus(Money.of(1, USD))` throws `ArithmeticException`.
- Two `Money` instances with the same values are `.equals()` and have the same `hashCode()`.

---

## Task 2 — Convert Task 1 to a record

Reimplement `Money` as a `record`.

**Requirements:**
- Same public surface as Task 1.
- Use a compact constructor for validation.
- Static factories live alongside the canonical record constructor.
- Confirm by JOL that the record has the expected layout (12 B header + 8 B `cents` + 4 B compressed reference + 4 B padding ≈ 24 B).

**Acceptance:**
- All Task 1 tests still pass against the record version.
- Record auto-generates `equals`, `hashCode`, `toString`.
- Compact constructor rejects null currency.

---

## Task 3 — `Email` with parsing and validation

Build an `Email` value class.

**Requirements:**
- Single `String value` field, `final`.
- Constructor / factory accepts a raw string and:
  - Trims it.
  - Lowercases it.
  - Validates it contains exactly one `@`, both sides non-empty, and the domain has at least one `.`.
  - Throws `IllegalArgumentException` for invalid input with a clear message.
- Equality is value-based.
- Provide `localPart()` and `domain()` accessors.
- `toString()` returns the canonical email string.

**Acceptance:**
- `new Email("  Alice@Example.COM ")` constructs and `value()` returns `"alice@example.com"`.
- `new Email("not-an-email")` throws.
- `new Email("a@b.c").equals(new Email("A@B.C"))` is `true`.

---

## Task 4 — `Order` aggregate root

Model an `Order` entity with `OrderLine` value objects.

**Requirements:**
- `OrderId` is its own value class wrapping a `UUID`.
- `Order` has: `OrderId id` (final), `OrderStatus status` (mutable), `List<OrderLine> lines` (private, encapsulated).
- `OrderLine` is an immutable value: `String sku`, `int quantity`, `Money unitPrice`.
- `Order` exposes:
  - `addLine(OrderLine line)` — only allowed in `DRAFT` status; throws otherwise.
  - `removeLine(String sku)` — only allowed in `DRAFT`; no-op if not present.
  - `place()` — transitions `DRAFT → PLACED`. Throws if no lines.
  - `cancel()` — transitions any non-`SHIPPED` status to `CANCELLED`.
  - `total()` — computes the sum of `quantity * unitPrice` per line.
  - `lines()` — returns an unmodifiable view.
- Equality and `hashCode` are by `id` only.

**Acceptance:**
- Cannot add lines after `place()`.
- `total()` always agrees with the sum of the lines.
- Mutating the `List` returned by `lines()` throws `UnsupportedOperationException`.
- Two `Order` instances with the same `id` are `.equals()` even with different lines.

---

## Task 5 — Defensive copy of `Date` legacy

You're given a legacy class:

```java
public class Booking {
    public Date checkIn;             // public mutable field — bad
    public Date checkOut;
}
```

Refactor it.

**Requirements:**
- Migrate to `LocalDate` from `java.time` (immutable).
- Make fields `private final`.
- Validate that `checkOut` is strictly after `checkIn` in the constructor.
- If you *must* keep `Date` for backwards compatibility on accessors, return defensive copies.

**Acceptance:**
- `Booking` cannot be constructed with `checkOut == checkIn` or earlier.
- After construction, no caller can mutate the dates inside the booking.

---

## Task 6 — `BankAccount` with thread-safe deposits

Build a `BankAccount` mutable entity safe for concurrent calls.

**Requirements:**
- Fields: `final String accountNumber`, `long balanceCents`.
- Methods: `deposit(long cents)`, `withdraw(long cents)`, `getBalanceCents()`.
- `withdraw` must throw if the result would be negative.
- Pick *one* synchronization strategy: either `synchronized` on `this`, or a `ReentrantLock`, or `AtomicLong` (with a CAS retry). Document your choice with a comment.
- Identity-based equality on `accountNumber`.

**Acceptance:**
- 100 threads each deposit 1 cent and 100 threads each withdraw 1 cent — the final balance equals the initial balance, with no exceptions and no race conditions.
- Property test: from balance B, executing N random deposits and withdraws (each strictly within the balance) ends with the algebraic sum.

---

## Task 7 — `Logger` service singleton

Implement a `Logger` service.

**Requirements:**
- Singleton: only one instance via `Logger.getInstance()`.
- Configurable `LogLevel` (enum: DEBUG, INFO, WARN, ERROR).
- Method `log(LogLevel level, String message)` writes to stdout if `level >= configured level`.
- Use enum singleton pattern (`enum Logger { INSTANCE; ... }`) instead of a static field.

**Acceptance:**
- `Logger.INSTANCE` is reflection-resistant (cannot be cloned, cannot be reconstructed).
- Setting level to WARN suppresses DEBUG and INFO messages.

---

## Task 8 — Builder for `HttpRequest`

Implement a builder for an immutable `HttpRequest`.

**Requirements:**
- `HttpRequest` has: `URI uri`, `String method` (default `"GET"`), `Map<String,String> headers` (defensive copy), `Optional<byte[]> body`.
- Use a static nested `Builder` class.
- Builder method names: `uri(...)`, `method(...)`, `header(name, value)`, `body(byte[])`. All return `this`.
- `build()` validates that `uri` is set; throws `IllegalStateException` otherwise.
- The final `HttpRequest` is immutable; calling `body()` returns a defensive copy of the byte array.

**Acceptance:**
- `HttpRequest.newBuilder().uri(...).header("X","1").build()` produces a valid object.
- Mutating the builder after `build()` does not affect the built request.
- Mutating the array returned by `body()` does not affect subsequent calls.

---

## Task 9 — Sealed `PaymentResult`

Model a payment result hierarchy.

**Requirements:**
- `sealed interface PaymentResult permits Approved, Declined, Pending`.
- `Approved` is a record with `String transactionId`.
- `Declined` is a record with `String reason`.
- `Pending` is a record with `Duration estimatedDelay`.
- A `summarize(PaymentResult)` function uses a `switch` expression with pattern matching to produce a human-readable string. The compiler must enforce exhaustiveness.

**Acceptance:**
- Adding a fourth implementation requires updating the `permits` clause and every `switch`.
- `summarize` does not need a `default` branch.

---

## Task 10 — `Point` and `Rectangle` composition

Practice composition over primitive obsession.

**Requirements:**
- `Point` is a record `(int x, int y)`.
- `Rectangle` has `Point topLeft`, `Point bottomRight`. Validate that `bottomRight.x() > topLeft.x()` and similarly for `y`.
- Methods: `width()`, `height()`, `area()`, `contains(Point p)`, `intersects(Rectangle other)`.
- `Rectangle` and `Point` are both immutable.

**Acceptance:**
- `Rectangle` rejects degenerate input.
- `contains` is inclusive on the top-left edge, exclusive on the bottom-right (document and test both).
- `intersects` is symmetric.

---

## Task 11 — `Cache` with eviction

A bounded cache as a class.

**Requirements:**
- Generic `Cache<K, V>` with capacity passed to the constructor.
- Methods: `get(K)`, `put(K, V)`, `size()`, `containsKey(K)`.
- Eviction policy: LRU — discard the least recently used entry when capacity is exceeded. Use `LinkedHashMap` with `accessOrder = true` and override `removeEldestEntry`.
- Not thread-safe — document so. (Bonus: a thread-safe variant via `synchronized` wrappers.)

**Acceptance:**
- Putting `capacity + 1` entries evicts exactly the entry accessed least recently.
- Reads via `get` count as access.

---

## Task 12 — Custom `equals` and `hashCode` for an entity

Refactor a poorly designed entity:

```java
class Customer {
    public Long id;
    public String name;
    public String email;
    // no equals/hashCode
}
```

**Requirements:**
- Make fields `private`. `id` is `final`.
- `equals`/`hashCode` use only `id`.
- Reject `null` for `id` in the constructor.
- Add a copy/update method `withName(String newName)` that returns a new `Customer` with the same id.
- `toString` returns something like `Customer[id=42,name=Alice]` and never includes the email (PII).

**Acceptance:**
- Two `Customer` instances with the same `id` and different fields are `.equals()`.
- They produce the same `hashCode()`.
- `toString` does not include the email.

---

## Task 13 — Convert mutable to immutable

Given:

```java
public class Polygon {
    private List<Point> vertices = new ArrayList<>();
    public void addVertex(Point p) { vertices.add(p); }
    public List<Point> getVertices() { return vertices; }
}
```

**Requirements:**
- Refactor to immutable: `Polygon` accepts the full vertex list at construction.
- Defensive-copy the input list on the way in.
- `vertices()` returns an unmodifiable view.
- Add `Polygon translate(int dx, int dy)` that returns a new polygon.

**Acceptance:**
- After construction, the caller's list is not retained — modifying it doesn't change the polygon.
- The list returned from `vertices()` cannot be mutated.

---

## Task 14 — `Result<T,E>` (sealed)

Build a generic result type.

**Requirements:**
- `sealed interface Result<T,E> permits Ok, Err`.
- `record Ok<T,E>(T value) implements Result<T,E>`.
- `record Err<T,E>(E error) implements Result<T,E>`.
- Static factories: `Result.ok(T)`, `Result.err(E)`.
- Methods: `<U> Result<U,E> map(Function<T,U>)`, `<U> Result<U,E> flatMap(Function<T,Result<U,E>>)`, `T orElse(T fallback)`, `boolean isOk()`.
- Use pattern matching `switch` for `map`/`flatMap`/`orElse`.

**Acceptance:**
- `Result.ok(2).map(x -> x * 3)` is `Ok(6)`.
- `Result.<Integer,String>err("oops").map(x -> x * 3)` is `Err("oops")`.
- `flatMap` chains short-circuit on the first `Err`.

---

## Task 15 — Memory layout exploration

Use [JOL](https://github.com/openjdk/jol) to inspect three classes.

**Requirements:**
- Add `org.openjdk.jol:jol-cli` (or `jol-core`) to your build.
- Print the layout of:
  1. Your `Money` record from Task 2.
  2. A `record User(long id, String name, int age)`.
  3. A class with the same fields, but placed in a deliberately bad order (e.g., `byte`, `long`, `byte`, `long`).
- Compare the sizes; document where the padding falls.
- Add a comment explaining HotSpot's allocation strategy and how it changes if you `-XX:-UseCompressedOops`.

**Acceptance:**
- You can read the JOL output and identify header, fields, padding, and total size.
- You can predict the layout difference between compressed-oops on/off.

---

## Stretch goals

- Convert any of the above to use Project Valhalla `value class` (preview) and re-measure layout with JOL.
- Add property-based tests using jqwik for the `Money`, `Order`, and `Result` types.
- Profile `Money` operations under JFR allocation profiling. Confirm scalar replacement on a tight `plus`/`minus` loop with `-XX:+PrintEliminateAllocations`.

---

## How to verify

For each task, write JUnit 5 tests that codify the acceptance criteria. The point isn't only "does it work?" but **"does it document the contract clearly enough that someone refactoring later won't break it?"** A passing test is the most durable comment your future self will read.
