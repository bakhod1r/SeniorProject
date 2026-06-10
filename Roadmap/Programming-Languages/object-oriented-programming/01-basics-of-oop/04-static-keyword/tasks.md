# Static Keyword — Tasks

> Hands-on exercises for `static` fields, methods, blocks, and nested classes. Every task lists acceptance criteria.

---

## Task 1 — Convert mutable static state to DI

You're given:

```java
public class UserService {
    private static Map<Long, User> cache = new HashMap<>();
    public static User find(long id) { return cache.computeIfAbsent(id, UserService::loadFromDb); }
    private static User loadFromDb(long id) { /* DB call */ }
}
```

**Requirements:**
- Refactor to an instance class with a constructor that takes a `UserRepository` dependency.
- Replace the static `cache` with an instance field (use `ConcurrentHashMap`).
- Make `find` an instance method.
- Tests inject a fake `UserRepository` and verify caching.

**Acceptance:**
- No static mutable state remains.
- Two `UserService` instances have independent caches.
- Test demonstrates a fake repository being substituted.

---

## Task 2 — Lazy holder singleton

Implement a `Config` singleton with expensive construction.

**Requirements:**
- `private` constructor that simulates expensive work (e.g., reads a file, parses JSON).
- Lazy holder idiom: `private static class Holder { static final Config INSTANCE = new Config(); }`.
- `public static Config getInstance()` returns `Holder.INSTANCE`.
- Test: 100 threads call `getInstance()` simultaneously; exactly one `Config` is constructed; all receive the same instance.

**Acceptance:**
- Construction count is exactly 1.
- All callers receive the same reference.
- No explicit synchronization in the implementation.

---

## Task 3 — Enum singleton

Reimplement Task 2 as an enum singleton.

**Requirements:**
- `enum Config { INSTANCE; ... }` with the same `getConfig(...)` API.
- Test that `Config.INSTANCE` is reflection-resistant (Constructor.setAccessible attempts fail).
- Compare with the lazy holder version: enum is reflection-safe and serializable; lazy holder is lazy.

**Acceptance:**
- Reflection cannot create a second instance.
- API matches Task 2's behavior.

---

## Task 4 — Static factory methods for `Money`

Build a `Money` value type with no public constructor.

**Requirements:**
- `private` canonical constructor.
- Static factories: `Money.of(long cents, Currency)`, `Money.usd(long cents)`, `Money.eur(long cents)`, `Money.zero(Currency)`.
- Cache `Money.zero(USD)` and `Money.zero(EUR)` as static finals.
- `equals`/`hashCode`/`toString`.

**Acceptance:**
- `new Money(100, USD)` is a compile error.
- `Money.zero(USD) == Money.zero(USD)` is `true` (cached singleton).
- Standard equality tests pass.

---

## Task 5 — Static initializer order

Without running the code, predict what `System.out.println(Foo.A + " " + Foo.B);` prints:

```java
public class Foo {
    public static int A = B + 1;
    public static int B = 10;
}
```

**Requirements:**
- Predict the output before running.
- Run and confirm.
- Explain why.
- Refactor to make the dependency explicit (e.g., reorder, use `static {}`).

**Acceptance:**
- A README explains the initialization order rule (textual order, defaults before initializers).
- The refactored version produces the intended output.

---

## Task 6 — Detect a class init deadlock

Construct two classes whose static initializers depend on each other:

```java
class A { static final int X = B.Y + 1; static { ... } }
class B { static final int Y = A.X + 1; static { ... } }
```

**Requirements:**
- Trigger the deadlock from two threads simultaneously.
- Use `jstack` to capture the deadlocked threads.
- Refactor to break the cycle (move the cross-class read into a method call, or compute both values in one place).

**Acceptance:**
- The original code deadlocks reliably.
- `jstack` output identifies the deadlock.
- The refactor compiles and runs without deadlock.

---

## Task 7 — Static utility class

Build a `Strings` utility class.

**Requirements:**
- `final` class.
- `private` constructor that throws `AssertionError` (defends against reflection).
- Methods: `reverse`, `truncate`, `slugify`, `isBlank`, `nullToEmpty`. All `static`.
- Each method handles `null` either by documented contract or by throwing.

**Acceptance:**
- `new Strings()` is a compile error.
- Reflection-based instantiation throws.
- Comprehensive unit tests cover null/edge cases.

---

## Task 8 — `static final` constant + cross-jar inlining

Demonstrate the compile-time inlining surprise:

**Requirements:**
- Write a library jar `lib.jar` with `public class Limits { public static final int MAX = 100; }`.
- Write an app jar that prints `Limits.MAX`.
- Build, run — see `100`.
- Recompile `lib.jar` with `MAX = 200`. Replace only `lib.jar` (do not rebuild app).
- Run app — still prints `100`.
- Document why and demonstrate the fix: change `Limits.MAX` to a method (`public static int max() { return 100; }`).

**Acceptance:**
- The two outputs (`100` then `100`) confirm inlining.
- After the fix, replacing `lib.jar` yields `200` without rebuilding the app.

---

## Task 9 — Replace static `SimpleDateFormat`

You're given a thread-unsafe pattern:

```java
private static final SimpleDateFormat FORMAT = new SimpleDateFormat("yyyy-MM-dd");
public static String format(Date d) { return FORMAT.format(d); }
```

**Requirements:**
- Identify the thread-safety bug (concurrent `SimpleDateFormat.format` calls corrupt internal state).
- Replace with `DateTimeFormatter` (immutable, thread-safe):
  ```java
  private static final DateTimeFormatter FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd");
  ```
- Or, if `Date` is required by API, use `ThreadLocal<SimpleDateFormat>`.
- Test concurrent formatting from 100 threads; verify no exceptions and consistent output.

**Acceptance:**
- The original code breaks under concurrency.
- The refactor passes the concurrent test.

---

## Task 10 — Static counter via `AtomicLong`

Build a global request counter.

**Requirements:**
- `public class RequestCounter` with a `private static final AtomicLong count = new AtomicLong()`.
- `public static long incrementAndGet()`.
- `public static long get()`.
- 1000 threads each call `incrementAndGet()` 1000 times; final `get()` returns exactly 1,000,000.

**Acceptance:**
- Concurrent test passes.
- No race conditions.
- Document why `AtomicLong` over `LongAdder` (or vice versa) for this use case.

---

## Task 11 — Static method handle

Use `MethodHandle` for a static method.

**Requirements:**
- Look up `Math.max(int, int)` via `MethodHandles.lookup().findStatic(...)`.
- Invoke 1,000,000 times via the handle and via direct call. Compare timings with JMH (or rough timing).
- Confirm the handle's overhead is negligible after warmup.

**Acceptance:**
- The handle works.
- Benchmark output shows negligible overhead.
- Brief writeup compares `MethodHandle.invoke` vs `Method.invoke`.

---

## Task 12 — Refactor a constants god-class

You're given:

```java
public class Constants {
    public static final int MAX_USERS = 1000;
    public static final String DEFAULT_LANG = "en";
    public static final int MIN_AGE = 13;
    public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);
    // ... 30 more
}
```

**Requirements:**
- Group constants by domain. Move `MIN_AGE` and `MAX_USERS` to a `UserPolicy` class. Move `DEFAULT_LANG` to `LocaleConfig`. Move `DEFAULT_TIMEOUT` to `HttpClientConfig`. Etc.
- Update all callers.
- Decide which should remain `static final` and which should become getters (for cross-jar flexibility).

**Acceptance:**
- The original `Constants` god-class is gone.
- Each domain class has its own well-named constants.
- All callers compile and tests pass.

---

## Task 13 — Static nested Builder

Build an `HttpRequest.Builder`.

**Requirements:**
- `HttpRequest` is immutable, with private constructor.
- `static class Builder` (note: `static`, not inner) provides fluent setters.
- `Builder.build()` validates and returns an `HttpRequest`.
- Both `HttpRequest` and `Builder` are nested in their parent type.

**Acceptance:**
- `new HttpRequest.Builder().uri(...).header("X","1").build()` works.
- `Builder` doesn't carry an enclosing `HttpRequest` reference.
- Construction is exclusively via the builder.

---

## Task 14 — Test class initialization order

Write unit tests for class initialization:

**Requirements:**
- A class `Logger` with a `static {}` block that logs `"Logger init"` to a static list.
- Trigger initialization with each of: `new Logger()`, `Logger.staticMethod()`, `Logger.NON_FINAL_STATIC` read, `Class.forName("Logger")`, `Logger.class` read (does not initialize), reading a `static final` constant (does not initialize).
- Verify the static list contains exactly one `"Logger init"` entry per JVM.

**Acceptance:**
- Each trigger and non-trigger is documented in test names.
- The list assertions pass.

---

## Task 15 — Static cache memory leak demo

Demonstrate and fix a static cache leak.

**Requirements:**
- `public class LeakyCache { private static final Map<String, byte[]> cache = new HashMap<>(); ... }` — entries are never removed.
- Run a loop adding millions of large `byte[]` entries.
- Use a heap dump (`jmap -dump`) and Eclipse MAT to confirm the cache is the GC root holding the bytes.
- Refactor: replace with `Caffeine.newBuilder().maximumSize(1000).build()` or `WeakHashMap`.
- Re-run; confirm memory stabilizes.

**Acceptance:**
- The original code OOMs (or at least grows unboundedly).
- Heap dump screenshot shows the static field as GC root.
- The refactored version stabilizes.

---

## How to verify

For every task, write JUnit tests. Tests should:
1. Demonstrate the static behavior (init order, threading, caching).
2. Fail when invariants break (refactor catches the bug).
3. Document the contract through their names.
