# Final Keyword — Tasks

> Hands-on exercises for `final` fields, methods, classes, parameters, and immutability patterns. Every task lists acceptance criteria.

---

## Task 1 — Convert mutable to immutable

You're given:

```java
public class Person {
    public String name;
    public int age;
}
```

**Requirements:**
- Make the class `final`.
- Make fields `private final`.
- Add a constructor that validates inputs.
- Add accessors (getters with no `get` prefix is OK).
- No setters.

**Acceptance:**
- `new Person("Alice", 30)` works.
- Reassignment fails to compile.
- Two `Person`s with same fields are not equal yet (next task adds equals).

---

## Task 2 — Add equals/hashCode/toString to immutable class

Continue from Task 1.

**Requirements:**
- Override `equals` to compare by all fields.
- Override `hashCode` consistent with equals.
- Override `toString` to print `Person[name=..., age=...]`.
- Test: equals/hashCode contract holds for various inputs.

**Acceptance:**
- Two `Person`s with same fields are `equal` and have the same `hashCode`.
- `toString` produces a useful debug string.

---

## Task 3 — Convert to a record

Reimplement Task 1+2 as a record.

**Requirements:**
- Use `record Person(String name, int age) { ... }`.
- Compact constructor for validation.
- Confirm equals/hashCode/toString are auto-generated correctly.

**Acceptance:**
- All Task 1+2 tests still pass against the record.
- Implementation is dramatically shorter.

---

## Task 4 — Defensive copy with `final`

Build an `Order` with a `List<OrderLine>`.

**Requirements:**
- `final class Order` with `final List<OrderLine> lines` field.
- Constructor: `this.lines = List.copyOf(lines)` for defensive copy.
- Getter: `public List<OrderLine> lines() { return lines; }` (already unmodifiable from `List.copyOf`).
- Test: caller mutating the original list does NOT affect the order.
- Test: caller trying to mutate the returned list throws `UnsupportedOperationException`.

**Acceptance:**
- Both tests pass.
- The `lines` reference is `final` AND the list is immutable.

---

## Task 5 — Demonstrate JMM safe publication

Write a class with `final` fields, share an instance across threads without synchronization.

**Requirements:**
- `public final class Config { private final String name; private final int port; ... }`.
- One thread constructs and assigns to a *plain* (non-volatile) static field.
- Another thread reads the field and verifies `name` and `port` are not at default values (null/0).
- Loop 1M+ times to demonstrate consistency.

**Acceptance:**
- Reader thread *never* sees default values (because of JMM freeze rule).
- Confirm with a comment: "freeze rule guarantees this without `volatile` or `synchronized`."

---

## Task 6 — Counter-example: non-final fields without sync

Write the same as Task 5 but with non-`final` fields.

**Requirements:**
- `public class UnsafeConfig { public String name; public int port; }`.
- One thread constructs.
- Another reads.
- Demonstrate that without `volatile`/synchronization, the reader *may* see default values (zero/null).
- Document the difference and why `final` (or `volatile`) is needed.

**Acceptance:**
- Test reproduces the issue (may require many iterations to see the race).
- A comment explains the JMM rules.

---

## Task 7 — Final method as orchestrator

Build an abstract base class with a `final` template method.

**Requirements:**
- `public abstract class BatchJob { public final void run() { ... } protected abstract void step(); }`.
- `run()` is `final` — orchestrates start, calls `step()`, then end.
- Subclasses implement `step()`.
- Test: a subclass cannot override `run()`.

**Acceptance:**
- Compile error if a subclass tries to override `run`.
- Subclasses work normally otherwise.

---

## Task 8 — `final` parameter in a lambda

Write a method that returns a `Predicate<String>` capturing a parameter.

**Requirements:**
- `public Predicate<String> startsWith(final String prefix) { return s -> s.startsWith(prefix); }`.
- The `prefix` is captured by the lambda.
- Test: returned predicate works correctly.
- Bonus: try removing `final` from `prefix` — confirm the code still compiles (effectively final).
- Bonus: add `prefix = ...` after the lambda — confirm compile error.

**Acceptance:**
- All variants behave as documented.

---

## Task 9 — Sealed class with all-final permits

Build a sealed `Shape` hierarchy.

**Requirements:**
- `public sealed interface Shape permits Circle, Square, Triangle`.
- All three are records (implicitly final).
- `area()` is implemented per subtype.
- A `switch` over `Shape` is exhaustive.

**Acceptance:**
- `switch` doesn't need a default branch.
- Adding a 4th subtype requires updating `permits` and breaks the switch (compile error) — confirming exhaustiveness.

---

## Task 10 — Constant inlining demo

Demonstrate cross-jar inlining.

**Requirements:**
- `lib.jar`: `public class Limits { public static final int MAX = 100; }`.
- `app.jar`: prints `Limits.MAX`.
- Build both. Run. See `100`.
- Edit `Limits.java` to `MAX = 200`. Recompile only `lib.jar`. Replace.
- Run app *without* recompiling. Should still see `100`.
- Document why and demonstrate the fix: change `MAX` to a method.

**Acceptance:**
- Behavior matches: stale value persists until app recompiles.
- Method-based version updates correctly.

---

## Task 11 — Identify "could be final" fields

Take an existing legacy codebase (or a small project of yours). Run a static analyzer (Error Prone with `FieldCanBeFinal`, IntelliJ "Field can be final" inspection, or PMD).

**Requirements:**
- Survey at least 20 fields. Identify which are eligible for `final`.
- Apply `final` to those fields.
- Run the build; fix any compile errors (typically reassignments you didn't notice).
- Run all tests.

**Acceptance:**
- Build passes.
- Tests pass.
- A short writeup of how many fields became `final` and any surprises.

---

## Task 12 — Builder for immutable result

Build an `EmailMessage.Builder`.

**Requirements:**
- `public final class EmailMessage` — immutable, all fields `final`.
- `private final String from; private final List<String> to; ...`.
- `static class Builder` is mutable.
- `Builder.build()` returns a new `EmailMessage` with defensive-copied collections.
- Test: build, mutate the builder, call `build()` again — both results are independent.

**Acceptance:**
- The first built `EmailMessage` is unaffected by builder mutations.
- Both builds produce valid, independent immutable instances.

---

## Task 13 — Constructor escape demonstration

Demonstrate the freeze-rule failure on constructor escape.

**Requirements:**
- `public final class Listener { private final int counter; public Listener(EventBus bus) { bus.register(this); counter = 42; } }`.
- An `EventBus` that immediately invokes a callback on `register`.
- Show that the callback *may* see `counter == 0`.
- Refactor: split into `new Listener()` and `listener.start(bus)` — counter is set before publication.

**Acceptance:**
- The original code reproduces the bug (use a tight loop and a memory barrier check).
- The refactor passes the same test reliably.

---

## Task 14 — Mark all leaf domain classes `final`

For your project's domain classes:

**Requirements:**
- Identify all classes that have no current subclasses and aren't designed for extension.
- Mark them `final`.
- Run all tests.
- For any class that breaks because of DI proxying (Spring/CGLIB), extract an interface and proxy the interface instead.

**Acceptance:**
- More classes are `final`.
- Tests pass.
- DI integration still works.

---

## Task 15 — Records vs hand-rolled comparison

Take three hand-rolled value classes. For each:

**Requirements:**
- Convert to a record where possible.
- Compare line counts (record version is typically 60–80% shorter).
- Confirm functional equivalence via tests.
- Document any cases where records *don't* fit (e.g., need a no-arg constructor for legacy frameworks, hidden representation, mutable state).

**Acceptance:**
- 3 records.
- All tests pass.
- Brief writeup on the trade-offs.

---

## How to verify

Tests should:
1. Demonstrate compile-time enforcement (assignment, override, subclass attempts fail to compile).
2. Demonstrate runtime semantics (immutability, defensive copying, JMM publication).
3. Document trade-offs (records vs hand-rolled, sealed vs open, etc.).
