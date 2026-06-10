# Method Chaining — Practice Tasks

Twelve exercises spanning builder design, fluent APIs, stream pipelines, and chain refactoring.

---

## Task 1 — Build a fluent `StringBuilder`-like

Implement `class FluentText { ... }` with chainable mutating methods: `append(String)`, `appendLine(String)`, `repeat(String, int)`, `clear()`, `toString()`. Each setter returns `this`.

Test:
```java
String result = new FluentText()
    .append("Hello").appendLine(",")
    .append("World").repeat("!", 3)
    .toString();
// "Hello,\nWorld!!!"
```

---

## Task 2 — Pizza builder

Design a `Pizza` record (immutable) with fields: `size`, `toppings (List<String>)`, `extraCheese (boolean)`. Provide a Builder with chainable setters. Validate in `build()`: size required; toppings copied immutably.

---

## Task 3 — Staged builder

Convert your Pizza builder into a staged builder. Required: size. Optional: toppings, extraCheese. The staged version should make `Pizza.builder().build()` (skipping size) a compile error.

Hint: `interface SizeStage { ToppingsStage size(String); }` etc.

---

## Task 4 — Comparator chain

Without using lambdas, build a `Comparator<User>` that compares by age (asc), then by name (alpha), then by email length (desc). Use `Comparator.comparing(...).thenComparing(...)`.

Then rewrite as a single lambda. Compare readability.

---

## Task 5 — Optional chain

Given `User` with `Optional<ContactInfo>`, `ContactInfo` with `Optional<Email>`, `Email` with `Optional<String>` for the address — write a method `String safeEmail(User u)` that returns the email or `"none"`. No `if` statements; only `Optional.map`/`flatMap`/`orElse`.

---

## Task 6 — Demeter violation

Given:
```java
order.getCustomer().getAddress().getCity().getCountry().getCurrency();
```

Refactor to remove the train wreck. The order should expose a single method that returns the relevant field, hiding intermediate structure.

---

## Task 7 — Stream pipeline

Given a `List<Product>` with fields `category`, `price`, `inStock`, write a stream chain that returns the top 3 most expensive in-stock products in each category. (You'll need `groupingBy` + `Collectors.collectingAndThen`.)

---

## Task 8 — `withX` for records

Given:
```java
record Address(String street, String city, String zip) { }
```

Add chainable `withStreet`, `withCity`, `withZip` methods. Test:
```java
var a2 = address.withCity("Boston").withZip("02110");
```

---

## Task 9 — Fluent assertion

Build a tiny assertion library. Start with:
```java
class Assertion<T> {
    static <T> Assertion<T> assertThat(T value) { ... }
    Assertion<T> isNotNull() { ... }
    Assertion<T> isEqualTo(T other) { ... }
    Assertion<T> satisfies(Predicate<T>) { ... }
}
```

Each method throws `AssertionError` with a descriptive message on failure, otherwise returns `this`. Verify chaining works.

---

## Task 10 — Rewrite a callback chain

Given:
```java
loadUser(id, user -> {
    if (user != null) {
        loadProfile(user, profile -> {
            if (profile != null) {
                save(profile, ok -> {
                    log("done");
                });
            }
        });
    }
});
```

Rewrite with `CompletableFuture` chains: `.thenApply(...).thenCompose(...).thenAccept(...)`. Show how callback hell becomes a chain.

---

## Task 11 — Detect a Demeter violation

Look at this code:
```java
class TaxCalculator {
    double tax(Order o) {
        return o.getCustomer().getAddress().getState().getTaxRate() * o.total();
    }
}
```

Identify the issue. Refactor so `TaxCalculator` doesn't navigate through `Customer` and `Address`.

---

## Task 12 — Self-typed inheritance builder

Implement:
```java
class Animal<T extends Animal<T>> {
    protected T self() { return (T) this; }
    public T name(String n) { ... return self(); }
}

class Dog extends Animal<Dog> {
    public Dog bark() { ... return this; }
}
```

Test:
```java
new Dog().name("Rex").bark();    // both return Dog
```

Then write a `Cat extends Animal<Cat>` with its own `meow()`. Verify the chain order can mix `name` and class-specific methods.

---

## Validation

| Task | How |
|------|-----|
| 1 | `assertEquals("Hello,\nWorld!!!", new FluentText().append(...).toString())` |
| 2 | `Pizza.builder().build()` should throw IllegalStateException |
| 3 | Skipping size should fail to compile |
| 4 | Compare results: same ordering for both versions |
| 5 | `safeEmail(userWithNoContact)` returns "none" |
| 6 | After refactor, `TaxCalculator` calls just one method on order |
| 7 | Verify with sample data; sort and category checks |
| 8 | `address.withCity("X")` returns new Address; original unchanged |
| 9 | Chain a true assertion + a false one; observe the failure message |
| 10 | Both versions produce same result; chain version is more readable |
| 11 | After refactor, `Order` exposes `taxRate()`; calculator just uses it |
| 12 | `name(...)` after `bark()` returns `Dog`, allowing further `Dog`-specific chained calls |

---

## Solutions sketch

**Task 1:** standard StringBuilder pattern with `return this` on each setter.

**Task 3 staged builder:**
```java
public interface SizeStage { ToppingsStage size(String s); }
public interface ToppingsStage extends BuildStage {
    ToppingsStage addTopping(String t);
    BuildStage extraCheese(boolean b);
}
public interface BuildStage { Pizza build(); }
```

**Task 5:**
```java
String safeEmail(User u) {
    return u.contactInfo()
        .flatMap(ContactInfo::email)
        .flatMap(Email::address)
        .orElse("none");
}
```

**Task 6:** add `currency()` method on `Order`:
```java
class Order {
    public String currency() { return customer.address().city().country().currency(); }
}
```
But the chain still violates Demeter internally. Better: each owner exposes what it needs:
```java
class Country { String currency(); }
class Customer { Country country() { return address.city().country(); } String currency() { return country().currency(); } }
```

**Task 9:**
```java
class Assertion<T> {
    private final T value;
    Assertion(T v) { this.value = v; }
    static <T> Assertion<T> assertThat(T v) { return new Assertion<>(v); }
    Assertion<T> isNotNull() {
        if (value == null) throw new AssertionError("expected non-null");
        return this;
    }
    Assertion<T> isEqualTo(T other) {
        if (!Objects.equals(value, other)) throw new AssertionError("expected " + other + ", got " + value);
        return this;
    }
}
```

---

**Memorize this**: chains are easy to write, easy to misuse. Use them for transformations, builders, and validations. Refactor away train wrecks. Use staged builders for required-field enforcement. Stream and Optional chains follow `flatMap`/`map`/terminal patterns.
