# Functional Interfaces and Lambdas — Practice Tasks

Eight exercises that force the lambda mechanics — SAM design, capture, method references, primitive specializations, composition, benchmarking — to bite. Each task gives a starting shape, an objective, constraints, and acceptance criteria. Work in three passes: (1) name the SAM and the shape on paper, (2) write the smallest code that satisfies the constraints, (3) add a test that would have caught the failure mode the task targets.

---

## Task 1 — Define a custom functional interface

Define a functional interface `Retryable<T>` whose SAM produces a `T` and is allowed to throw a checked exception.

```java
@FunctionalInterface
public interface Retryable<T> {
    T run() throws Exception;
}
```

**Objective.** Use it in a method `withRetry` that calls `attempt.run()` up to N times, returning the first success or rethrowing the final failure.

**Constraints.**
- The SAM must throw a *checked* exception (not just `RuntimeException`), so a caller writing `() -> Thread.sleep(100); return "ok";` does not need to wrap.
- The `@FunctionalInterface` annotation is mandatory — if a maintainer adds a second abstract method, the build must fail.
- `withRetry` accepts `int maxAttempts`, `Retryable<T> attempt`, and returns `T`.
- No external library; pure Java.

**Acceptance criteria.**
- A unit test calls `withRetry(3, () -> { counter.incrementAndGet(); throw new IOException(); })` and confirms `counter == 3` and the final `IOException` is rethrown.
- A second test calls `withRetry(3, () -> "ok")` and gets `"ok"` after exactly one attempt.
- Replacing the SAM method's signature breaks the compile in the test file (proves `@FunctionalInterface` is wired).
- Bonus: confirm that `() -> Thread.sleep(100); return null;` compiles against `Retryable<Void>` without `try/catch`.

---

## Task 2 — Refactor `Collections.sort(list, new Comparator() { ... })`

```java
// Starting code — pre-Java 8 style:
List<Employee> employees = loadEmployees();
Collections.sort(employees, new Comparator<Employee>() {
    @Override
    public int compare(Employee a, Employee b) {
        int byDept = a.department().compareTo(b.department());
        if (byDept != 0) return byDept;
        int bySalary = b.salary().compareTo(a.salary());   // descending
        if (bySalary != 0) return bySalary;
        return a.name().compareToIgnoreCase(b.name());
    }
});
```

**Objective.** Three progressively cleaner refactors:

1. Replace the anonymous class with a lambda.
2. Replace the lambda with `Comparator.comparing` and method references.
3. Use `thenComparing` to chain — and `reversed()` for the descending salary.

**Constraints.**
- Final form must use `list.sort(...)` (the `default` method on `List`), not `Collections.sort`.
- `reversed()` must apply only to the salary part, not the whole comparator.
- The chain must read top-to-bottom as the sort order.

**Acceptance criteria.**
- The final code has no `new` and no parameter list — just method references and comparator factories.
- A test with three departments, two salaries each, and three name cases verifies the order.
- The final line count is ≤ 4.

```java
// Reference target shape:
employees.sort(
    Comparator.comparing(Employee::department)
              .thenComparing(Comparator.comparing(Employee::salary).reversed())
              .thenComparing(Employee::name, String.CASE_INSENSITIVE_ORDER)
);
```

---

## Task 3 — Primitive specialization in a hot loop

```java
public final class StatsBoxed {
    public static int sum(int[] xs) {
        Function<Integer, Integer> identity = x -> x;
        int total = 0;
        for (int x : xs) total += identity.apply(x);
        return total;
    }
}
```

**Objective.** Rewrite `sum` to use a primitive specialization, and write a JMH benchmark that compares the two on a 1 000 000-element array.

**Constraints.**
- The specialized version must not allocate any `Integer` objects in the hot loop.
- The JMH benchmark must use `@Warmup(iterations = 10)` and `@Measurement(iterations = 10)`.
- The lambda must be constructed in `@Setup`, not inside `@Benchmark`.

**Acceptance criteria.**
- The specialized version uses `IntUnaryOperator` (or, better, `IntStream.of(xs).sum()`).
- JMH numbers show the specialized version at parity or faster than the boxed one in steady state. Both should be within ~20% of a hand-written `for`-loop sum (because EA may eliminate boxing).
- Running with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations -XX:+PrintInlining` confirms boxing is eliminated in one form and present in the other (until EA fires).
- Document, in a short comment block, what the numbers actually say about lambda overhead vs boxing overhead.

---

## Task 4 — Compose validation predicates

A `BookingRequest` must pass several checks before it's accepted: non-null fields, valid date range, party size in range, and customer present. Today they live as nested `if`s in the controller. Refactor:

```java
public record BookingRequest(
    String  customerId,
    LocalDate checkIn,
    LocalDate checkOut,
    int     partySize) {}
```

**Objective.** Build named `Predicate<BookingRequest>` constants and compose them into a single `IS_VALID` predicate using `Predicate.and`/`Predicate.not`.

**Constraints.**
- Each individual predicate is one line.
- The combined predicate is built with `and`/`Predicate.not` — no boolean operators in the composition.
- `IS_VALID` is a `public static final Predicate<BookingRequest>`.
- Add an `IS_VALID_OR_REASON` that, instead of returning a boolean, returns `Optional<String>` containing the first failure reason — implement with a `Stream<NamedRule>` and `findFirst`.

**Acceptance criteria.**
- Tests cover: all valid; null customer; check-out before check-in; party size 0; party size 13 (max 12).
- The composition reads top-to-bottom as English.
- No predicate body contains an `if` — pure expression form.
- Bonus: a separate predicate `IS_VALID_LOOSE` reuses three of the four rules via `and`, demonstrating reuse.

---

## Task 5 — Tiny event bus with `Consumer<Event>`

Build a minimal in-memory event bus:

```java
public final class EventBus<E> {
    public Subscription on(Consumer<E> listener) { /* … */ }
    public void publish(E event) { /* … */ }

    public interface Subscription extends AutoCloseable {
        @Override void close();
    }
}
```

**Objective.** Implement the bus so subscribers can register, receive events, and unsubscribe deterministically.

**Constraints.**
- `on` returns a `Subscription` whose `close()` removes the listener. Don't rely on `equals` to find the listener (find-bug.md Bug 10).
- `publish` notifies listeners in registration order and continues even if one listener throws (logging the exception).
- The bus must be safe to subscribe and unsubscribe *while* iterating during a `publish` call — use a copy-on-write list or a snapshot.
- Listeners that capture their enclosing instance must be unsubscribable without manual reference juggling.

**Acceptance criteria.**
- Tests cover: subscribe → publish → see event; close subscription → publish → no event; subscriber throws → other subscribers still fire; subscribe during publish → applies to *next* publish, not the current one.
- A small memory test (manual or `WeakReference`-based) shows that closing a subscription releases the listener for GC.
- Bonus: replace `Consumer<E>` with a domain `EventHandler<E>` interface that documents threading expectations in Javadoc.

---

## Task 6 — Benchmark lambda vs anonymous class

```java
@FunctionalInterface
interface Op { int apply(int a, int b); }

class Bench {
    Op lambda  = (a, b) -> a + b;
    Op anon    = new Op() { public int apply(int a, int b) { return a + b; } };
}
```

**Objective.** Write a JMH benchmark that compares throughput of `lambda.apply(x, y)` versus `anon.apply(x, y)` over 100 million calls.

**Constraints.**
- Both `lambda` and `anon` must be instance fields initialised in `@Setup`.
- The benchmark method takes a `@State(Scope.Thread)` parameter and returns the sum.
- Run with at least two JVM versions if available (e.g., 17 LTS and 21 LTS) and compare.

**Acceptance criteria.**
- Steady-state numbers for `lambda` and `anon` are within ~5% of each other — proving the senior.md claim that they're equivalent at runtime.
- The first warm-up iteration of the `lambda` benchmark is measurably slower than `anon`'s (linkage cost).
- Document, in a short comment block, what the numbers say and what they *don't* (e.g., they don't generalise to megamorphic call sites).
- Bonus: add a third variant where `anon` is created *inside* the benchmark method — show this is dominated by allocation.

---

## Task 7 — A lambda that needs an explicit type annotation

```java
public final class Loader {
    public static <T> T load(Supplier<T> supplier) { return supplier.get(); }
    public static <T> T load(Function<String, T> loader) { return loader.apply("default"); }
}
```

**Objective.** Demonstrate that `Loader.load(() -> "hello")` is ambiguous between the two overloads, then write call sites that resolve to each.

**Constraints.**
- Show the compile error for the ambiguous case in a `// won't compile:` comment (don't actually leave it uncompilable in the project; comment it out).
- Resolve to the `Supplier<T>` overload by casting: `Loader.load((Supplier<String>) () -> "hello")`.
- Resolve to the `Function<String, T>` overload by writing the lambda with a parameter: `Loader.load((String key) -> "hello-" + key)`.
- Show one alternative resolution using `<T>` type-witness syntax where applicable.

**Acceptance criteria.**
- All three resolved call sites compile and return the expected value.
- A short note in the test file explains *why* each cast/parameter style picks the overload it does (overload resolution under poly expressions, JLS §15.12.2).
- Bonus: refactor `Loader` to avoid the ambiguity entirely by renaming one overload.

---

## Task 8 — Function composition pipeline

Design a small text-cleaning pipeline using `Function.andThen`:

```java
public final class Pipeline {
    public static final Function<String, String> CLEAN = /* todo */;
}
```

**Objective.** Build `CLEAN` to: trim whitespace, replace runs of whitespace with single spaces, lowercase the result, and limit to 80 characters. Each step is its own named `Function<String, String>` constant; `CLEAN` is the `andThen` chain.

**Constraints.**
- Each step is a `public static final Function<String, String>` with a descriptive name.
- The composition uses `.andThen(...)` exclusively — no `.compose(...)`.
- The 80-character truncation is a separate step, not folded into the lowercase step.
- The pipeline must handle `null` input — define explicit policy (e.g., empty string for `null` at the start).

**Acceptance criteria.**
- A reader can re-order the steps by swapping the `andThen` calls; the chain remains readable.
- Unit tests cover: empty input, `null` input, all-whitespace input, mixed-case input, long input (>80 chars).
- `CLEAN.apply("   Hello   WORLD!   ")` returns `"hello world!"`.
- `CLEAN.apply(null)` returns `""` (or `null`, whichever your null policy chose).
- Bonus: write a second pipeline `LOG_FRIENDLY` that reuses three of the four steps plus a new one (e.g., escape line breaks), demonstrating reuse.

---

## Reflection (do this last)

After finishing the eight tasks, write a short retro (≤ 200 words) covering:

- Which tasks taught you something you didn't already know.
- Which tasks felt mechanical — and whether that means the technique is now second nature.
- Whether you reached for a primitive specialization, a domain functional interface, or `Function.identity()` at any point.
- One place in your actual production code you would now refactor based on a task here.

The point of the exercises is not the code that ends up checked in — it's the heuristics that end up checked into your head.

---

## What's next

| Topic                                                              | File              |
|--------------------------------------------------------------------|-------------------|
| Interview Q&A across all eight tasks' concepts                     | `interview.md`    |

See also: [../05-default-methods-and-diamond-problem/](../05-default-methods-and-diamond-problem/) for how `default` methods enable composition (`andThen`, `and`, `or`), [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/) for the dispatch side of the JMH numbers in Tasks 3 and 6, and [../../../../05-lambda-expressions/](../../../../05-lambda-expressions/) for the deeper chapter on lambdas.
