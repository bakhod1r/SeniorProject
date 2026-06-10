# Nested Classes — Tasks

> Hands-on exercises for static nested, inner, local, and anonymous classes plus their modern alternatives. Acceptance criteria included.

---

## Task 1 — Convert inner to static nested

You're given:

```java
public class Outer {
    private int counter = 0;
    public class Counter {
        public int next() { return ++counter; }
    }
}
```

**Requirements:**
- Refactor `Counter` to a `static` nested class.
- Pass the `Outer` instance (or just the counter state) explicitly.
- Confirm no implicit retention of `Outer`.

**Acceptance:**
- `Counter` is `static`.
- `new Outer().new Counter()` no longer needed; explicit construction works.
- A heap dump confirms no `this$0` reference.

---

## Task 2 — Builder via static nested

Build a `User.Builder`.

**Requirements:**
- `public final class User` with private constructor.
- `public static User.Builder newBuilder()`.
- `Builder` is `public static final class`.
- Fluent setters: `name(String)`, `age(int)`, `email(String)`. Each returns `this`.
- `build()` validates and constructs the `User`.
- Test that calling `build()` with missing required fields throws.

**Acceptance:**
- `User.newBuilder().name("Alice").age(30).build()` works.
- Construction is exclusively via the builder.
- Missing required fields throw at `build()`.

---

## Task 3 — Sealed nested ADT

Model a `Result<T, E>` using sealed + nested records.

**Requirements:**
- `public sealed interface Result<T, E> permits Result.Ok, Result.Err`.
- `record Ok<T, E>(T value) implements Result<T, E>`.
- `record Err<T, E>(E error) implements Result<T, E>`.
- Static factories: `Result.ok(T)`, `Result.err(E)`.
- `map`, `flatMap`, `orElse` methods using `switch` pattern matching.
- Test that adding a hypothetical `Pending` permit forces every switch to update.

**Acceptance:**
- All operations work.
- Switches don't need a `default` branch (exhaustive).
- A pseudo-test demonstrates the compile-error nature of adding a permit.

---

## Task 4 — Replace anonymous classes with lambdas

In your codebase (or a sample), find 5+ anonymous classes implementing single-method interfaces.

**Requirements:**
- Convert each to a lambda using IDE refactoring.
- Run tests; verify behavior unchanged.
- Compare LOC before/after.
- For one example, profile with `async-profiler -e alloc` and compare allocation rate.

**Acceptance:**
- 5 anonymous classes converted.
- Tests pass.
- Brief writeup with before/after numbers.

---

## Task 5 — Demonstrate inner-class memory leak

Build a deliberately leaky example.

**Requirements:**
- A `Window` class with a 10 MB `byte[]` field.
- A method that returns an `ActionListener` as an *anonymous inner class* (no static).
- Register the listener with a long-lived collection (a `List<ActionListener>`).
- Drop all explicit references to the `Window`. Take a heap dump.
- Verify the `Window` is still reachable via `this$0`.

**Acceptance:**
- Heap dump (Eclipse MAT) shows the `Window` retained by the listener.
- Refactor: convert to a `static` listener that takes only the data it needs.
- Re-test: `Window` is now GC-eligible.

---

## Task 6 — Iterator as inner class

Implement `Iterable<E>` for a custom collection.

**Requirements:**
- `public final class CustomList<E> implements Iterable<E>`.
- An inner (non-static) class `Iter` that implements `Iterator<E>`.
- `Iter` accesses `CustomList`'s `items` and `size` via `this$0`.
- Justify why this is *not* a static nested class.

**Acceptance:**
- `for (E e : list) ...` works.
- Documented justification for inner over static.

---

## Task 7 — Lazy holder singleton

Implement a `Config` singleton using the holder idiom.

**Requirements:**
- `private` constructor that simulates expensive work.
- A `private static class Holder { static final Config INSTANCE = new Config(); }`.
- `public static Config getInstance() { return Holder.INSTANCE; }`.
- Verify thread safety: 100 threads call `getInstance()` simultaneously; one construction; all see the same instance.

**Acceptance:**
- Single construction confirmed.
- All callers receive the same instance.
- No explicit synchronization in the implementation.

---

## Task 8 — Anonymous class for `TypeReference`

Use the anonymous-class type-capture pattern.

**Requirements:**
- Define `public abstract class TypeReference<T> { ... }` with an internal `getType()` method using `getGenericSuperclass()`.
- Use it: `TypeReference<List<String>> ref = new TypeReference<>() { };`.
- Demonstrate that `ref.getType()` returns a `ParameterizedType` representing `List<String>`.

**Acceptance:**
- The `getType()` method returns the correct parameterized type.
- This pattern is a legitimate use of anonymous classes (lambdas can't do it).

---

## Task 9 — Local class capturing parameter

Write a method that returns a stateful predicate via a local class.

**Requirements:**
- `public Predicate<Integer> belowThreshold(int threshold)` returns a `Predicate<Integer>`.
- Use a local class that captures `threshold` and tracks how many `test()` calls returned `true`.
- The class has a method to retrieve the count.

**Acceptance:**
- The local class works.
- Note: this could also be done with a top-level class or a stateful lambda (rare); document the choice.

---

## Task 10 — Refactor "fat outer" with extracted helpers

You're given a 500-line outer class with several large nested classes inside.

**Requirements:**
- Identify nested classes that have grown independent (used elsewhere, no longer tightly coupled).
- Extract them to top-level classes.
- Update callers.
- Run tests.

**Acceptance:**
- The outer class is significantly smaller.
- Extracted classes are now top-level.
- All tests pass.

---

## Task 11 — Demonstrate lambda scalar replacement

Profile a hot path with lambdas.

**Requirements:**
- A method that takes a `List<Integer>` and a `Predicate<Integer>`, filters, and returns the count.
- Call it in a tight loop with millions of inputs.
- Profile with `async-profiler -e alloc` and `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`.
- Confirm the lambda's capture object is scalar-replaced (or at least not allocated per call).

**Acceptance:**
- Allocation rate is near-zero from the lambda.
- The PrintEliminateAllocations log mentions the lambda's class.

---

## Task 12 — Inner vs static nested with serialization

Demonstrate the serialization issue with inner classes.

**Requirements:**
- A `Container` class with a non-static inner class `Item`.
- Serialize an `Item` to JSON via Jackson.
- Observe that Jackson tries to serialize the outer `Container` too (or fails with a circular-reference issue).
- Refactor `Item` to `static`.
- Re-serialize; confirm it works cleanly.

**Acceptance:**
- The original code reproduces the issue.
- The static refactor fixes it.
- A short writeup explains why.

---

## Task 13 — Complete sealed type with custom logic

Build a `Shape` sealed hierarchy.

**Requirements:**
- `public sealed interface Shape permits Shape.Circle, Shape.Rectangle, Shape.Triangle`.
- Each is a record with appropriate fields.
- `area()` is a default method that uses `switch` pattern matching.
- `perimeter()` similarly.
- Tests verify exhaustiveness (the switch needs no default).

**Acceptance:**
- All three types implemented.
- `area()` and `perimeter()` work for each.
- Adding a fourth permit forces switch updates.

---

## Task 14 — Replace nested if/else with sealed switch

Take a method with nested instanceof checks:

```java
public String describe(Event e) {
    if (e instanceof Login)  return "login";
    if (e instanceof Logout) return "logout";
    if (e instanceof Error)  return "error";
    throw new IllegalStateException();
}
```

**Requirements:**
- Make `Event` a sealed interface with permits.
- Each variant a record (or class) implementing `Event`.
- Refactor `describe` to use pattern matching `switch`.
- Compiler must enforce exhaustiveness.

**Acceptance:**
- Original tests still pass.
- The switch has no default branch.
- Compiler catches missing variants if a new permit is added.

---

## Task 15 — Nested class organization

Take a feature module and organize its types.

**Requirements:**
- Pick a feature (e.g., a Payment module).
- Identify the public API (1-3 types).
- Identify supporting types (DTOs, value objects, internal helpers).
- Decide which should be:
  - Top-level public types in the API package.
  - Top-level package-private types in the API package.
  - Top-level types in an `internal` sub-package.
  - Nested static types within their owners.
- Document your reasoning.

**Acceptance:**
- A short writeup of the decisions.
- Code restructured accordingly.
- All tests pass.

---

## How to verify

Tests should:

1. Demonstrate the structural relationship (inner can access outer; static cannot without explicit reference).
2. Verify memory profile (no unexpected retention).
3. Confirm correctness via behavior tests.
4. Document trade-offs through test names and comments.
