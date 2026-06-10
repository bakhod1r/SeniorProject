# Interfaces — Practice Tasks

Twelve exercises across interface design, default methods, functional interfaces, sealed types.

---

## Task 1 — Comparable

Implement `class Money` with `cents` and `currency`. Make it `Comparable<Money>`. Throw `IllegalArgumentException` when comparing different currencies. Test with `Collections.sort`.

---

## Task 2 — Functional interface composition

Define `@FunctionalInterface Validator<T> { boolean validate(T t); }` with default methods `and`, `or`, `negate`. Use them to build composite validators. Verify `nonEmpty.and(notTooLong).validate("")` returns false.

---

## Task 3 — Strategy pattern

Define interface `PricingStrategy` with `double price(Item)`. Implement `RegularPricing`, `DiscountPricing`, `BulkPricing`. Inject into `Cart` via constructor. Demonstrate swapping strategies without modifying `Cart`.

---

## Task 4 — Sealed Result + pattern matching

```java
sealed interface Result<T> permits Success<T>, Failure<T> { }
```

Use records for the two implementations. Write `<T, U> Result<U> map(Result<T> r, Function<T, U> f)` using pattern-matching switch.

---

## Task 5 — Default-method diamond

Define `interface X { default String hi() { return "X"; } }` and `interface Y { default String hi() { return "Y"; } }`. Make a class `Z implements X, Y`. Resolve the conflict by overriding `hi()` and returning both.

---

## Task 6 — Interface segregation

Refactor:
```java
interface Worker {
    void work();
    void eat();
    void sleep();
}
class Robot implements Worker { ... eat() and sleep() are no-ops }
```

Split into `Workable`, `Eatable`, `Sleepable`. Robot only implements `Workable`.

---

## Task 7 — ServiceLoader plugin

Define `interface PaymentGateway { String charge(double amount); }`. Implement two mock gateways (`StripeMock`, `PayPalMock`). Register via `META-INF/services/...` (or via JPMS `provides`). Use `ServiceLoader` to load them at runtime.

---

## Task 8 — Static factory on an interface

Add static factory methods to your `Result<T>`:
- `static <T> Result<T> success(T value)`
- `static <T> Result<T> failure(String error)`

Make the constructors of Success and Failure package-private; force callers to use the factories.

---

## Task 9 — Functional interface from scratch

Without using `Function<T, R>`, define your own `interface Transform<T, R> { R apply(T); }`. Use it with a lambda. Then chain via a default `Transform<T, V> andThen(Transform<R, V> after)`.

---

## Task 10 — Pattern-matching exhaustiveness

```java
sealed interface Shape permits Circle, Square, Triangle { }
```

Write `double area(Shape s)` using pattern-matching switch. Then add `Pentagon` to permits — observe what the compiler does to your switch.

---

## Task 11 — Marker vs annotation

You have an interface `interface Auditable { }` (no methods). Refactor to use an annotation `@Auditable` instead. List the trade-offs (runtime detection, parameter, retention policy).

---

## Task 12 — Fluent default methods

Define `interface QueryBuilder<T>` with abstract methods `where(...)`, `orderBy(...)`, `limit(...)` and default methods `andEquals(field, value)` etc. The defaults compose the abstract methods. Test by chaining.

---

## Validation

| Task | How |
|------|-----|
| 1 | `compareTo(differentCurrency)` throws |
| 2 | `nonEmpty.and(notTooLong).validate("xx")` is true |
| 3 | Same `Cart` produces different totals with different strategies |
| 4 | `map(Failure, f)` propagates Failure unchanged |
| 5 | `new Z().hi()` returns "X / Y" or similar |
| 6 | Robot only has `work()` |
| 7 | `ServiceLoader.load(PaymentGateway.class).iterator()` yields both |
| 8 | `new Success<>(...)` is illegal access from outside the package |
| 9 | `t1.andThen(t2).apply(x)` returns `t2.apply(t1.apply(x))` |
| 10 | Compile error on every `switch` over `Shape` until Pentagon is handled |
| 11 | Annotation supports retention policy and parameters; interface only types |
| 12 | Chained query builds correctly; defaults forward to abstract methods |

---

## Solutions sketch

**Task 4:**
```java
static <T, U> Result<U> map(Result<T> r, Function<T, U> f) {
    return switch (r) {
        case Success<T>(T v) -> new Success<>(f.apply(v));
        case Failure<T>(String e) -> new Failure<>(e);
    };
}
```

**Task 9:**
```java
@FunctionalInterface
interface Transform<T, R> {
    R apply(T t);
    default <V> Transform<T, V> andThen(Transform<R, V> after) {
        return t -> after.apply(apply(t));
    }
}
```

---

**Memorize this**: interfaces describe what; sealed interfaces close the hierarchy; functional interfaces enable lambdas; default methods enable evolution. Combine them as the modern Java toolkit for type-driven design.
