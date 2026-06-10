# Default Methods and the Diamond Problem — Practice Tasks

Eight exercises that force every default-method rule, edge case, and interaction with the wider language to bite. Each task starts with code that compiles, names the specific pressure (library evolution, diamond resolution, mixin design, FBCP, "class wins", private helpers, records, Comparable-style extension), and asks for a refactor or a new design.

Work each task in three passes: (1) read the snippet and name the design pressure (resolution rule, FBCP, LSP, ISP), (2) sketch the new shape on paper before touching the keyboard, (3) write code plus a small test that would have caught the original problem.

---

## Task 1 — Evolve a library interface by adding a default method

You ship a library with this interface in v1.0:

```java
public interface Cache<K, V> {
    V    get(K key);
    void put(K key, V value);
    void remove(K key);
}
```

A team upgrade lands. Users now ask for an "atomic compute if absent" operation. You cannot break their existing implementations.

**Objective.** Add `computeIfAbsent` to `Cache` in a backward-compatible way. Ship v1.1 such that every v1.0 implementor keeps compiling and linking.

**Constraints.**
- The new method must have a sensible default body that any v1.0 `Cache` would honour.
- The default may not throw `UnsupportedOperationException`.
- Implementors that have a faster atomic version (e.g., `ConcurrentHashMap`-backed) must be able to override and gain correctness benefits.
- Document the interaction between `get`/`put` and the default with `@implSpec` so future maintainers don't break the call graph.

**Acceptance criteria.**
- A class `InMemoryCache implements Cache<String, Integer>` from v1.0 compiles unchanged against v1.1.
- Calling `computeIfAbsent("k", k -> 42)` on an `InMemoryCache` returns `42` and leaves `"k" -> 42` in the cache.
- A second implementor `AtomicCache implements Cache<String, Integer>` that overrides `computeIfAbsent` uses a single `ConcurrentHashMap.computeIfAbsent` call — the default's `get`-then-`put` is not invoked.
- A JUnit test exercises both implementations through the same contract.

---

## Task 2 — Resolve a diamond conflict explicitly

```java
public interface Logger {
    default void log(String msg) { System.out.println("[log] " + msg); }
}

public interface Auditable {
    default void log(String msg) { audit().append(msg); }
    AuditTrail audit();
}

public class OrderProcessor implements Logger, Auditable {
    private final AuditTrail trail = new AuditTrail();
    public AuditTrail audit() { return trail; }
}
```

**Symptom.** The class does not compile — the two defaults for `log(String)` conflict and neither interface is more specific than the other.

**Objective.** Resolve the diamond so that:
- Calling `processor.log("order placed")` writes to *both* the console (via `Logger`) and the audit trail (via `Auditable`).
- The resolution is explicit and documented; a reviewer can see in three lines which interface's behaviour runs first.

**Constraints.**
- Use `Interface.super.method(...)` syntax to reach each specific default.
- Do not eliminate either interface from the `implements` clause.
- Do not introduce a separate "facade" method — `log` is still the call site callers use.

**Acceptance criteria.**
- The class compiles with no warnings.
- A test confirms both side effects fire on a single `log` call.
- The order of side effects is deterministic and documented (which one fires first and why).
- A reader can predict the behaviour from the override body without reading either superinterface.

---

## Task 3 — Design a mixin trait with interfaces and defaults

A logistics platform has three domain entities — `Order`, `Shipment`, `Booking` — each of which carries `createdAt` and `updatedAt` instants. The team currently duplicates these methods on every class:

```java
public final class Order {
    private final Instant createdAt;
    private final Instant updatedAt;
    /* ctor */
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
    public Duration age(Clock c) { return Duration.between(createdAt, c.instant()); }
    public boolean isStale(Clock c, Duration threshold) { return age(c).compareTo(threshold) > 0; }
}
// Shipment and Booking duplicate the last two methods.
```

**Objective.** Replace the duplication with a *mixin* interface that supplies `age` and `isStale` as defaults, depending on `createdAt()`/`updatedAt()` as abstract methods. Every entity should be able to opt in by adding `implements Auditable` and one line in its `implements` clause.

**Constraints.**
- The mixin interface declares only abstract `createdAt()` / `updatedAt()` and default `age` / `isStale`.
- No state lives in the interface — only behaviour. (Interfaces still can't have instance fields.)
- The interface accepts a `Clock` as a parameter (not via a default's hidden `Instant.now()` call) so the mixin remains testable.
- The mixin uses no global singletons.

**Acceptance criteria.**
- `Order`, `Shipment`, `Booking` shrink — each loses the `age` and `isStale` method bodies.
- A test against the mixin uses a fixed `Clock` (e.g., `Clock.fixed(...)`) and asserts deterministic age values.
- A new entity `Invoice` can adopt the mixin in one line and zero method bodies.
- Replacing `Auditable` with a more complex mixin (adding a `wasUpdatedSince(Instant)` default) does not require any change to the existing entities.

---

## Task 4 — Refactor a base class to use defaults (composition first, then defaults if appropriate)

```java
public abstract class AbstractValidator<T> {
    public final List<String> validate(T value) {
        var errors = new ArrayList<String>();
        check(value, errors);
        return errors;
    }
    protected abstract void check(T value, List<String> errors);

    protected final void require(boolean cond, String msg, List<String> errors) {
        if (!cond) errors.add(msg);
    }
}

public class EmailValidator extends AbstractValidator<String> {
    @Override
    protected void check(String email, List<String> errors) {
        require(email != null, "email is null", errors);
        require(email != null && email.contains("@"), "no @", errors);
    }
}
```

**Objective.** Refactor `AbstractValidator` so it is an *interface* with default methods, freeing implementors from `extends` and allowing them to compose multiple validators.

**Constraints.**
- The interface should have one abstract method (so it remains a `@FunctionalInterface` candidate).
- `require` should be a `private` interface method (Java 9, JEP 213) — invisible to implementors.
- `validate` should be the default method that collects errors and returns them.
- The new design must allow a class to implement two unrelated validators (e.g., `EmailValidator` and `LengthValidator`) without an `extends` cycle.

**Acceptance criteria.**
- `EmailValidator` is a record or a tiny final class implementing the interface — no `extends`.
- The interface qualifies as `@FunctionalInterface` (one abstract method, any number of defaults/statics/privates).
- A `CompositeValidator` can wrap a list of validators and return the concatenated errors — without inheriting from anything.
- A test demonstrates `EmailValidator` and `LengthValidator` being applied to the same input separately and via composition.

---

## Task 5 — Demonstrate the "class wins" rule

You inherit a library interface (you cannot edit it):

```java
public interface Auditable {
    default String log(String msg) { return "[audit] " + msg; }
}
```

Your team adds a new class:

```java
public class Logger {
    public String log(String msg) { return "[plain] " + msg; }
}

public class AuditingLogger extends Logger implements Auditable { }
```

**Symptom.** Calling `new AuditingLogger().log("hello")` returns `"[plain] hello"`, not `"[audit] hello"`. The library author's audit prefix is silently lost.

**Objective.** Write a one-page note for the team explaining (a) *which rule fires*, (b) *why it fires*, and (c) *what to do about it*. Then implement two distinct fixes and explain when each is appropriate.

**Constraints.**
- Fix A: keep `extends Logger`, override `log` in `AuditingLogger` to combine both behaviours.
- Fix B: do not extend `Logger` at all — compose it as a field, freeing the class to inherit the interface default cleanly.
- Both fixes must produce `"[audit] [plain] hello"` (or similar combined output).
- Add a test for each fix that demonstrates the expected output.

**Acceptance criteria.**
- The note correctly identifies Rule 1 ("classes win", JLS §8.4.8) as the cause.
- Each fix is implemented in its own file and the tests pass.
- The note explains when to prefer Fix A (when `extends Logger` is genuinely needed) vs Fix B (when composition is cleaner).
- A senior developer would accept the note as on-boarding material for a new hire.

---

## Task 6 — Use private interface methods to factor a default helper

```java
public interface PhoneNumberValidator {
    default boolean isValidUk(String number) {
        return number != null
            && !number.isBlank()
            && number.replaceAll("[\\s-()]", "").matches("^(\\+44|0)\\d{10}$");
    }
    default boolean isValidUs(String number) {
        return number != null
            && !number.isBlank()
            && number.replaceAll("[\\s-()]", "").matches("^(\\+1)?\\d{10}$");
    }
    default boolean isValidFr(String number) {
        return number != null
            && !number.isBlank()
            && number.replaceAll("[\\s-()]", "").matches("^(\\+33|0)\\d{9}$");
    }
}
```

**Symptom.** Three near-identical defaults share two pieces of logic: null/blank check and digit normalisation. Any bug fix (e.g., handling unicode whitespace) needs three edits.

**Objective.** Factor the shared logic into `private` interface methods (JEP 213, Java 9). The public default surface stays unchanged.

**Constraints.**
- Add a `private static boolean isNonBlank(String s)` for the null/blank check.
- Add a `private static String normalize(String s)` that strips formatting characters.
- The three public defaults shrink to one line each, calling the helpers + a regex match.
- The helpers must be invisible to implementors and external callers.

**Acceptance criteria.**
- The three defaults each fit on one line (excluding the regex).
- Attempting `PhoneNumberValidator.normalize(...)` from outside the interface fails to compile.
- A test confirms all three defaults still produce identical results before and after the refactor.
- Adding a fourth default (say, `isValidDe`) only requires writing the new public default + a new regex — no duplication of the null/blank/normalize logic.

---

## Task 7 — Show default method + record interaction (accessor wins)

You ship an interface with a sensible default for missing ids:

```java
public interface Identifiable {
    default String id() {
        return "auto-" + System.identityHashCode(this);
    }
    default String describe() {
        return "[" + id() + "]";
    }
}

public record Order(String id, BigDecimal amount) implements Identifiable { }
```

**Symptom.** Calling `new Order(null, BigDecimal.TEN).describe()` returns `"[null]"`, not `"[auto-<hash>]"`. The record's component accessor `id()` silently shadowed the default.

**Objective.** Reproduce the bug, explain the rule that causes it (Rule 1: classes win, with the record's implicit accessor counting as a class method), then redesign the interface so the "fallback" behaviour cannot be shadowed by record components.

**Constraints.**
- The interface must continue to work for non-record implementors that legitimately want the `id()` default.
- Records with an `id` component must still implement the interface cleanly — they shouldn't have to override anything.
- The "fallback when id is null" behaviour must live somewhere the record can't accidentally shadow.

**Acceptance criteria.**
- The redesigned interface uses a distinctively named method (e.g., `displayId()` or `effectiveId()`) for the fallback logic.
- A `record Order(String id, BigDecimal amount) implements Identifiable { }` with `id = null` produces a non-null display id.
- A test confirms the new behaviour against both records and a non-record implementor.
- The PR description explains the original bug and links to JLS §8.10 (records) and §8.4.8 (overriding).

---

## Task 8 — Design a Comparable-like extension via defaults

`java.lang.Comparable<T>` is a single-abstract-method interface that the JDK enriches via `Comparator` (a separate interface with combinators like `thenComparing`, `reversed`). Suppose you want a more compact alternative: a `Ordered<T>` interface that combines comparison with derived ordering predicates.

```java
public interface Ordered<T> extends Comparable<T> {
    // your default methods here
}
```

**Objective.** Design `Ordered<T>` such that:
- Implementors supply only `compareTo(T other)`.
- The interface provides defaults: `isLessThan(T)`, `isGreaterThan(T)`, `isAtMost(T)`, `isAtLeast(T)`, `min(T)`, `max(T)`.
- The defaults are *not* allowed to throw `UnsupportedOperationException`.
- The defaults compose cleanly — `isAtMost` calls `isLessThan` and equality, not its own duplicated logic.
- A `private` interface method factors any shared logic (e.g., the sign-of-compareTo check).

**Constraints.**
- Use `private` interface methods (Java 9, JEP 213) for shared internals.
- Document each default with `@implSpec` describing the call graph (which other defaults / abstracts it depends on).
- Implementors with a faster custom comparison may override any default; the override must still satisfy the documented contract.
- The interface is `sealed` to a known set of implementors (e.g., `permits Money, Quantity, Score`) — so you can change defaults in the future without surveying the world for implementors.

**Acceptance criteria.**
- A `record Money(long cents) implements Ordered<Money>` only implements `compareTo` and gets six new methods for free.
- A test exercises every default method with at least three records of each implementor type.
- Removing one default (say, `max`) and re-running the test correctly fails — the default was actually being exercised.
- Adding a new defaulted method (`clampTo(T low, T high)`) is a backward-compatible change.

---

## Validation

| Task | How to verify the fix |
| ---- | --------------------- |
| 1    | An old `InMemoryCache` compiled against v1.0 of the library still links and passes the new `computeIfAbsent` contract test against v1.1. |
| 2    | A single `log()` call produces two side effects (console + audit) and the test asserts both. |
| 3    | Adding a `Invoice` entity to the mixin is a one-liner; tests against a fixed `Clock` are deterministic. |
| 4    | `EmailValidator` doesn't `extend` anything and composes with `LengthValidator` via a `CompositeValidator`. |
| 5    | Two distinct fixes (override + compose) exist; both produce `"[audit] [plain] hello"`; the team note correctly cites Rule 1. |
| 6    | Calling a `private` helper from outside the interface fails to compile; the four defaults are uniformly one-line. |
| 7    | A `record Order(String id, ...)` with `id = null` produces a non-null `effectiveId`. |
| 8    | `record Money` implements `Ordered<Money>` with one method body; all six defaults exercise correctly under tests. |

---

## Worked solution sketch — Task 3 (`Auditable` mixin)

```java
// 1. The mixin lives as a small interface, with abstract methods for state and defaults for behaviour.
public interface Auditable {
    Instant createdAt();
    Instant updatedAt();

    /** @implSpec returns the duration since createdAt() relative to the given clock. */
    default Duration age(Clock clock) {
        return Duration.between(createdAt(), clock.instant());
    }

    /** @implSpec returns true if age(clock) exceeds threshold. */
    default boolean isStale(Clock clock, Duration threshold) {
        return age(clock).compareTo(threshold) > 0;
    }

    /** @implSpec returns the duration between createdAt() and updatedAt(); negative if updatedAt is before createdAt. */
    default Duration timeSinceCreation() {
        return Duration.between(createdAt(), updatedAt());
    }
}

// 2. Entities adopt the mixin by declaring implements + supplying the abstracts via their normal accessors.
public final class Order implements Auditable {
    private final Instant createdAt;
    private final Instant updatedAt;
    public Order(Instant createdAt, Instant updatedAt) {
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }
    @Override public Instant createdAt() { return createdAt; }
    @Override public Instant updatedAt() { return updatedAt; }
}

// 3. Records work too — the component accessor satisfies the abstract method automatically.
public record Booking(Instant createdAt, Instant updatedAt) implements Auditable { }

// 4. Tests use a fixed Clock so they're deterministic.
@Test
void orderIsStaleAfterThreshold() {
    Clock clock = Clock.fixed(Instant.parse("2026-01-15T00:00:00Z"), ZoneOffset.UTC);
    Order o = new Order(Instant.parse("2026-01-01T00:00:00Z"),
                        Instant.parse("2026-01-01T00:00:00Z"));
    assertThat(o.isStale(clock, Duration.ofDays(7))).isTrue();
    assertThat(o.isStale(clock, Duration.ofDays(20))).isFalse();
}
```

Notice three things:

1. The mixin has *no fields* and *no global singletons*. Defaults read class-owned state through `createdAt()` / `updatedAt()`.
2. The `Clock` is a parameter, not a hidden `Instant.now()` call. Tests substitute fixed clocks.
3. Records integrate naturally — the component accessor satisfies the interface's abstract method, and the record inherits the defaults cleanly because its accessor is named `createdAt` / `updatedAt` (matching the interface's abstract methods, *not* shadowing any defaults).

---

**Memorize this:** default-method exercises are not "make this compile". They are "make this evolve safely". Each task above puts you in a situation where the *next change* is the test: can you add a method to a library interface without breaking implementors? Can you resolve a diamond predictably? Can you refactor a base class into a mixin without inheriting state? If yes, you've internalised the feature.
