# Encapsulation — Practice Tasks

Twelve exercises in hiding state, protecting invariants, and choosing the right mutation primitives.

---

## Task 1 — Convert public fields to encapsulated form

```java
public class User {
    public String name;
    public int age;
    public String email;
}
```

Refactor to a record. Verify: external code can't write `user.name = "X"`.

---

## Task 2 — Defensive copying

```java
public class Polygon {
    private List<Point> points;
    public Polygon(List<Point> points) { this.points = points; }
    public List<Point> points() { return points; }
}
```

Two leaks: caller can mutate `points` after construction; caller can mutate via `points()`. Fix both.

---

## Task 3 — Tell, don't ask

```java
class Account {
    private long balance;
    public long balance() { return balance; }
    public void setBalance(long b) { this.balance = b; }
}

void withdraw(Account a, long amount) {
    if (a.balance() >= amount) a.setBalance(a.balance() - amount);
}
```

Refactor so `Account` encapsulates the rule. The free function should disappear.

---

## Task 4 — Invariant enforcement

Design `Range(int min, int max)` such that:
- `min <= max` is always true
- The class is immutable
- Construction is the only place this is checked

Use a record with a compact constructor.

---

## Task 5 — Read-only collection view

`Library` has a `List<Book>` of books. Expose:
- A method to add books (validating: no duplicates by ISBN)
- A method to get all books read-only

Use either `List.copyOf` (snapshot) or `Collections.unmodifiableList` (view) and explain which is appropriate.

---

## Task 6 — Static factory

Replace this constructor with a static factory:
```java
public Currency(String code) {
    if (code.length() != 3) throw new IllegalArgumentException();
    this.code = code;
}
```

The factory should:
- Cache instances (use a `ConcurrentHashMap`)
- Make the constructor private
- Be named `of(String code)`

Two calls with the same code must return the same instance.

---

## Task 7 — Sealed Result type

Define `sealed interface Result<T> permits Success<T>, Failure<T> { }` with two records. Add:
- `boolean isSuccess()`
- `T value()` — throws if Failure
- `String error()` — throws if Success
- `<U> Result<U> map(Function<T, U> f)`

All the encapsulation lives in the sealed interface + records. Test exhaustively.

---

## Task 8 — Anemic refactor

```java
public class Order { public List<Item> items; public boolean shipped; }
public class OrderService {
    public void ship(Order o) {
        if (o.shipped) throw new IllegalStateException();
        // shipping logic
        o.shipped = true;
    }
}
```

Move the logic into `Order`. The service should call `order.ship()`. Fields become private.

---

## Task 9 — Module-based encapsulation

Design a simple `payment` module with `module-info.java`:
- `com.example.payment.api` — public types (`Payment`, `Gateway` interface)
- `com.example.payment.internal.stripe` — `StripeGateway` impl, NOT exported

Verify that external code using your module can't `new StripeGateway()` — only the API types.

---

## Task 10 — Detect missing encapsulation

Audit this class. List every encapsulation violation:

```java
public class Cart {
    public List<Item> items = new ArrayList<>();
    public double tax;
    public boolean isDirty;
    public Map<String, Object> metadata;

    public void addItem(Item i) {
        items.add(i);
        isDirty = true;
    }
    public double total() {
        return items.stream().mapToDouble(Item::price).sum() * (1 + tax);
    }
}
```

Refactor to a properly encapsulated form.

---

## Task 11 — Volatile encapsulation

Implement `class HitCounter { ... }` that:
- Counts calls to `hit()`
- Returns the count via `count()`
- Is thread-safe
- Doesn't expose internal state

The user should not see `volatile` or `AtomicLong` — those are internal.

---

## Task 12 — Builder + immutable target

Build a `Pizza` record with a Builder:
- All fields private final in `Pizza`
- `Pizza.builder()` returns a new Builder
- `Builder.size(...)`, `Builder.addTopping(...)`, etc.
- `Builder.build()` returns Pizza
- `Pizza` constructor is private; only the builder can call it

Verify external code can't call `new Pizza(...)`.

---

## Validation

| Task | How |
|------|-----|
| 1 | `user.name = "X"` should not compile |
| 2 | After refactor, `polygon.points().add(p)` throws UnsupportedOperationException |
| 3 | The free function disappears; account owns the rule |
| 4 | `new Range(10, 5)` throws |
| 5 | Justify which (snapshot vs view) is appropriate for your use case |
| 6 | `Currency.of("USD") == Currency.of("USD")` is true |
| 7 | `result.map(...)` propagates Failure correctly |
| 8 | `order.ship(); order.ship();` second call throws |
| 9 | External `new StripeGateway()` is illegal access at compile time |
| 10 | List ≥ 4 violations; provide refactored form |
| 11 | Concurrent test with 1000 threads × 1000 hits should yield 1,000,000 |
| 12 | `new Pizza(...)` should not compile from outside the class |

---

## Solutions sketch

**Task 4:**
```java
public record Range(int min, int max) {
    public Range {
        if (min > max) throw new IllegalArgumentException();
    }
}
```

**Task 7 map:**
```java
default <U> Result<U> map(Function<T, U> f) {
    return switch (this) {
        case Success<T>(T v) -> new Success<>(f.apply(v));
        case Failure<T> err -> (Result<U>) err;
    };
}
```

**Task 6:**
```java
public final class Currency {
    private static final ConcurrentHashMap<String, Currency> CACHE = new ConcurrentHashMap<>();
    private final String code;
    private Currency(String c) { this.code = c; }
    public static Currency of(String code) {
        if (code.length() != 3) throw new IllegalArgumentException();
        return CACHE.computeIfAbsent(code, Currency::new);
    }
}
```

---

**Memorize this**: encapsulation = small public surface, validated mutation, hidden state. Use private constructors + factories for instance control. Use records for data. Use sealed types for closed hierarchies. Use modules for the largest scale. Test from outside the class to verify nothing leaks.
