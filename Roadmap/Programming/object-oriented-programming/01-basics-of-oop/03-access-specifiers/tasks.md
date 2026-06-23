# Access Specifiers — Tasks

> Hands-on exercises that build muscle memory for choosing the right access level. Every task lists acceptance criteria — write JUnit tests where applicable.

---

## Task 1 — Tighten access on an over-public class

You're given:

```java
public class Counter {
    public int count;
    public int max;
    public Counter()  { this.count = 0; this.max = 100; }
    public void inc() { count++; }
    public boolean atMax() { return count >= max; }
}
```

**Requirements:**
- Make `count` and `max` `private`.
- Add a `count()` getter; `max` doesn't need one if no caller reads it.
- `inc()` throws `IllegalStateException` if already at max.
- Constructor `Counter(int max)` validates `max > 0`.

**Acceptance:**
- `counter.count = 5` no longer compiles.
- All public methods continue to work.
- Test demonstrates `inc()` past max throws.

---

## Task 2 — Singleton with private constructor

Implement a `ConfigLoader` singleton.

**Requirements:**
- `private` constructor (so no one outside the class can `new ConfigLoader()`).
- Static `getInstance()` returns the lazily-initialized single instance.
- Thread-safe lazy init (use double-checked locking, the holder idiom, or `enum` singleton).
- `loadConfig()` returns a config map.

**Acceptance:**
- `new ConfigLoader()` is a compile error.
- `ConfigLoader.getInstance()` always returns the same instance.
- 100 threads calling `getInstance()` concurrently get the same instance and only one initialization runs.

Stretch: implement a second variant using `enum ConfigLoader { INSTANCE; ... }` and discuss the differences (reflection-resistant, simpler, but less flexible if you want lazy init).

---

## Task 3 — Utility class with no instances

Build a `Strings` utility class.

**Requirements:**
- `final` class.
- `private` constructor that throws `AssertionError` (defends against reflection).
- `static` methods only: `reverse`, `countVowels`, `isPalindrome`, `truncate`.
- Each method is null-safe (or documents that null is rejected).

**Acceptance:**
- `new Strings()` is a compile error (constructor private + class final).
- Reflection: `Strings.class.getDeclaredConstructor().setAccessible(true).newInstance()` fails with `InvocationTargetException` wrapping `AssertionError`.
- All `static` methods have unit tests including null/edge cases.

---

## Task 4 — Refactor to package-private

You have:

```java
package com.example.payment;

public class PaymentService {
    public Money charge(Order order) { ... }
}

public class TransactionLog {
    public void record(Transaction t) { ... }    // only used by PaymentService
}

public class RetryPolicy {
    public boolean shouldRetry(Throwable t) { ... }   // only used by PaymentService
}
```

**Requirements:**
- Identify which classes/methods are only used inside `com.example.payment`.
- Reduce their access: drop `public` to package-private (no keyword).
- `PaymentService` stays `public`.
- Verify nothing breaks — same-package code still compiles.

**Acceptance:**
- Outside `com.example.payment`, `TransactionLog` and `RetryPolicy` are not visible.
- Inside the package, they remain usable.
- Tests in `src/test/java/com/example/payment/` still see them.

---

## Task 5 — `protected` vs package-private decision

Given:

```java
public abstract class Cache {
    protected Map<String, Object> data = new HashMap<>();      // ⚠ direct access
    public Object get(String k) { return data.get(k); }
    public void put(String k, Object v) { data.put(k, v); }
}

public class TtlCache extends Cache {
    protected void evictExpired() {
        data.entrySet().removeIf(...);             // direct mutation
    }
}
```

**Requirements:**
- Replace `protected` field with `private` + `protected final` accessor.
- `evictExpired()` should iterate via the accessor / a controlled mutator.
- If `TtlCache` is in the same package as `Cache`, consider package-private over `protected`.
- Confirm tests pass.

**Acceptance:**
- `data` is `private`. No subclass can write to it directly.
- The visible API of `Cache` for subclasses is documented `protected` methods.
- `TtlCache` continues to work.

---

## Task 6 — API/internal package split

Restructure a service package into `api/` and `internal/`.

Starting layout:

```
com/example/auth/
├── AuthService.java         (public class)
├── JwtParser.java            (public class)
├── PasswordHasher.java       (public class)
├── TokenStore.java           (public class)
└── User.java                 (public class)
```

**Requirements:**
- Split into:
  ```
  com/example/auth/api/
  ├── AuthService.java         (public interface)
  └── User.java                 (public record — domain type)
  
  com/example/auth/internal/
  ├── DefaultAuthService.java   (package-private — implements AuthService)
  ├── JwtParser.java            (package-private)
  ├── PasswordHasher.java       (package-private)
  └── TokenStore.java           (package-private)
  ```
- Add a `public` factory in `api/` that constructs the implementation: `Auth.create(...)` returns `AuthService`.

**Acceptance:**
- External callers see only `api/AuthService`, `api/User`, `api/Auth` (factory).
- Implementation classes are package-private and live in `internal/`.
- All tests pass.

---

## Task 7 — Add `module-info.java`

Continue from Task 6. Make the package a JPMS module.

**Requirements:**
- Create `module-info.java`:
  ```java
  module com.example.auth {
      exports com.example.auth.api;
      // not exporting internal — strong encapsulation
  }
  ```
- Ensure compilation produces a modular jar.
- Write a separate `consumer` module that imports `com.example.auth` and confirms:
  - It can see `AuthService` and `User`.
  - It cannot see `DefaultAuthService` or `JwtParser` — even with `Class.forName`.

**Acceptance:**
- `Class.forName("com.example.auth.internal.JwtParser")` from the consumer module throws `ClassNotFoundException` or `IllegalAccessError`.
- `Auth.create(...)` works.
- Build tooling (Maven/Gradle) successfully creates a modular distribution.

---

## Task 8 — Configure `opens` for a Jackson consumer

Continue from Task 7. Add a `User` JSON serialization scenario.

**Requirements:**
- `User` is a record. Jackson reads it via reflection.
- Jackson sees `User`'s public canonical accessors but needs to construct one too.
- Decide: do you `opens com.example.auth.api to com.fasterxml.jackson.databind`?
- Document the choice and the reasoning.

**Acceptance:**
- Jackson can deserialize JSON into `User` without runtime errors.
- The `opens` directive is *targeted* (only to the framework module) — not `opens com.example.auth.api;` (open to everyone).

---

## Task 9 — Test access patterns

Write a test class that:

**Requirements:**
- Lives in `src/test/java/com/example/payment/PaymentServiceTest.java` — same package as `PaymentService`.
- Accesses a package-private `RetryPolicy` directly (since they're in the same package).
- Avoids `setAccessible(true)`.
- Tests an internal helper without making it `public`.

**Acceptance:**
- Tests reach package-private members without weakening production access.
- Test class structure mirrors the production package layout.

---

## Task 10 — Use `MethodHandles.privateLookupIn`

You need to read a `private` field of a third-party class for diagnostic logging.

**Requirements:**
- Use `MethodHandles.privateLookupIn(targetClass, MethodHandles.lookup())` to obtain a Lookup capable of seeing privates.
- Use `lookup.findVarHandle(targetClass, "internalField", String.class)` to get a `VarHandle`.
- Read the field via the VarHandle.
- Document any required JPMS `opens` directive.

**Acceptance:**
- Reads work without `setAccessible(true)`.
- The `opens` directive is the *minimum* needed.
- A unit test demonstrates the read.

---

## Task 11 — Identify and eliminate `setAccessible(true)` calls

Audit a small codebase (one with reflection-based access).

**Requirements:**
- Grep for `setAccessible(true)` (often via `f.setAccessible(true)` or `m.setAccessible(true)`).
- For each, decide:
  - Was it for testing? Replace with same-package tests or `@VisibleForTesting`.
  - Was it for serialization? Replace with proper Jackson/Gson configuration or migrate to records.
  - Was it for framework-level access? Replace with `MethodHandles.privateLookupIn(...)`.
- Document the changes.

**Acceptance:**
- The codebase compiles and tests pass.
- All `setAccessible(true)` calls have been removed or replaced.
- Each replacement is documented.

---

## Task 12 — Sealed result type with restricted construction

Build a `Result<T,E>` type using sealed.

**Requirements:**
- `public sealed interface Result<T,E> permits Ok, Err`.
- `Ok` and `Err` are records (so `equals`/`hashCode`/`toString` are free).
- Hide `Ok` and `Err` constructors? No — records' canonical constructors are required public. But you can:
  - Make the records `package-private` so external code constructs only via factory methods.
  - Add `Result.ok(T)` and `Result.err(E)` static factories on the interface.

**Acceptance:**
- External code uses `Result.ok(...)` / `Result.err(...)` rather than `new Ok(...)` / `new Err(...)`.
- A `switch` over a `Result<T,E>` is exhaustive (compiler enforces the two cases).

---

## Task 13 — `protected final` template method

Build a base class for batch processing.

**Requirements:**
- `public abstract class BatchProcessor<T>`.
- `private` field `int batchSize`.
- `public` constructor `BatchProcessor(int batchSize)` validates positivity.
- `public final void run(Stream<T> input)` — orchestrates the batch processing, calling protected hooks.
- `protected abstract void processBatch(List<T> batch)` — subclasses implement.
- `protected final int batchSize()` — getter for subclasses.
- `protected void onBeforeBatch()` — optional override hook with empty default.
- `protected void onAfterBatch()` — same.

**Acceptance:**
- Subclasses cannot override `run`.
- Subclasses must implement `processBatch`.
- `onBeforeBatch`/`onAfterBatch` overrides are picked up.
- Default behavior works without overrides.

---

## Task 14 — Audit and document public surface

For one of your domain classes (or one from Task 4 / Task 6):

**Requirements:**
- List every public member.
- For each: justify why it's public. Could it be tighter?
- For each: write a one-paragraph contract (purpose, parameters, return, exceptions, threading).
- Identify candidates for tightening.

**Acceptance:**
- A markdown / Javadoc file documents the API.
- At least one public member is identified as over-public and refactored.
- The refactor is committed with a "tighten access" message.

---

## Task 15 — Cross-package nest exercise

Pre-Java 11, an inner-class private access generated synthetic bridges. Examine modern bytecode.

**Requirements:**
- Write a class `Outer` with a `private int counter` and an inner class `Outer.Inner` that increments it.
- Compile to Java 11+ target.
- Run `javap -v Outer.class` and `javap -v Outer$Inner.class`.
- Verify:
  - `NestHost` attribute on `Outer$Inner`.
  - `NestMembers` attribute on `Outer`.
  - No `access$000` synthetic bridge methods.
- Compile to Java 8 target (`--release 8`) and re-examine. The bridges should reappear.

**Acceptance:**
- A short markdown summary of the difference.
- Sample `javap` output for both targets included.

---

## Stretch goals

- For Task 7, run `jdeps --jdk-internals` against an old jar to find references to internal JDK packages and discuss what would need `--add-opens` to run on JDK 17+.
- For Task 12, extend `Result` with `map`, `flatMap`, `orElse`, etc., using pattern matching with sealed exhaustiveness.
- For Task 13, profile the `run` loop with JFR and confirm `processBatch` is monomorphic per concrete subclass (the JIT inlines the abstract call).

---

## How to verify

For every task, write JUnit tests where applicable. The test should:

1. Compile only with the right access levels (a setter that became private should produce a compile error in tests that try to call it directly).
2. Demonstrate the contract holds (singleton returns one instance; sealed switch is exhaustive; module hides internals).
3. Document the access design through the test names.

Tests are the living spec for your access-control decisions. A test named `internalHelper_isNotPublic_andCanBeTestedInSamePackage` tells future maintainers exactly what you intended.
