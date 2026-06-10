# Abstraction — Practice Tasks

Twelve exercises in choosing the right abstraction tool, designing contracts, and recognizing premature/leaky abstractions.

---

## Task 1 — Interface vs abstract class

You're designing a `PaymentMethod` type. Two impls exist: `CreditCard` and `BankTransfer`. Each needs its own validation and payment logic, but they share a common `displayName()` formatter and an `id` field.

Choose between interface and abstract class. Justify. Sketch the type.

---

## Task 2 — Functional interface

Define a `@FunctionalInterface` for a validator: takes a value, returns a list of error messages (empty if valid). Provide a default `andThen` that composes two validators, accumulating errors.

Implement it for "string is non-empty" and "string length < 100." Show how to compose them.

---

## Task 3 — Strategy refactor

Given:
```java
class Sorter {
    void sort(List<Integer> list, String mode) {
        if (mode.equals("asc")) list.sort(Comparator.naturalOrder());
        else if (mode.equals("desc")) list.sort(Comparator.reverseOrder());
        else if (mode.equals("random")) Collections.shuffle(list);
    }
}
```

Refactor using the Strategy pattern. The `Sorter` should accept a strategy interface and delegate to it. Add a fourth strategy without modifying `Sorter`.

---

## Task 4 — Template Method

Design an `HttpHandler` abstract class:
- `final void handle(Request)` — the template, calls `validate`, `process`, `log`.
- `abstract Response process(Request)`
- `protected void validate(Request)` with default no-op
- `protected void log(Response)` with default impl

Implement two subclasses (`UserHandler`, `OrderHandler`) demonstrating the pattern.

---

## Task 5 — Sealed Result

Define `sealed interface Result<T> permits Success, Failure { }` with records for each. Add a `map(Function<T, U>)` default method that transforms `Success` and propagates `Failure`. Test with a chain of operations.

---

## Task 6 — Bridge

You have shapes (Circle, Square, Triangle) and renderers (SVG, Canvas, ASCII). Avoid the 3×3 explosion. Design a Bridge: `Shape` holds a `Renderer`; each subclass calls back through `renderer.drawX(...)`.

---

## Task 7 — Adapter

Given a third-party library with class:
```java
class LegacyAuth {
    String authorize(String username, String password, String mfaCode);
}
```

Adapt it to fit your application's `Authenticator` interface:
```java
interface Authenticator {
    Optional<User> authenticate(Credentials creds);
}
```

Where `Credentials` is your record with username + password + optional MFA. Handle null returns from legacy.

---

## Task 8 — Decorator

Implement a `LoggingService` decorator that wraps any `Service`:
```java
interface Service { Result call(Request r); }
```
The decorator should log inputs and outputs without modifying the wrapped impl. Stack two decorators (logging + metrics) and verify both execute.

---

## Task 9 — Identify the leak

Read this and identify the leaky abstraction:

```java
public interface Cache<K, V> {
    V get(K key);
    void put(K key, V value);
}

class FileCache implements Cache<String, byte[]> {
    @Override
    public byte[] get(String key) {
        try {
            return Files.readAllBytes(Path.of("/cache", key));
        } catch (IOException e) { return null; }
    }
    // ...
}
```

What contract is implicit but undocumented? What invariants does the file impl break? Propose a rewrite that's more honest about possible failures.

---

## Task 10 — Premature abstraction

Audit this code. Is the abstraction premature? What signals suggest yes/no? Refactor if appropriate.

```java
public interface UserService {
    User findById(long id);
    void save(User u);
}
public class UserServiceImpl implements UserService {
    private final EntityManager em;
    // ...
}
// only impl in the codebase
```

Justify: keep, collapse, or evolve.

---

## Task 11 — Hidden state

Convert this code so its only public surface is the abstract behavior, hiding all state and helpers:

```java
public class Counter {
    public int n;
    public boolean strict;
    public List<Integer> history = new ArrayList<>();
    public void inc() { /* ... */ }
}
```

Decide: record? class? interface? final? Justify and refactor.

---

## Task 12 — Pattern matching with abstraction

Given:
```java
sealed interface Token permits NumberToken, OperatorToken, EOFToken { }
record NumberToken(double v) implements Token { }
record OperatorToken(char op) implements Token { }
record EOFToken() implements Token { }
```

Write `evaluate(List<Token> tokens)` that interprets a Reverse Polish Notation expression using a switch over `Token`. Add a new variant `ParenToken` and observe what the compiler does.

---

## Validation

| Task | How |
|------|-----|
| 1 | Code review; can you replace the chosen abstraction with the other and lose nothing? |
| 2 | Test that `nonEmpty.andThen(notTooLong).validate("")` returns both errors |
| 3 | Add a fourth strategy without changing `Sorter` source |
| 4 | Verify subclasses can override only `process`; the template is enforced |
| 5 | Chain `Success(5).map(x -> x*2).map(x -> "got " + x)` returns `Success("got 10")` |
| 6 | Add a fourth shape and a fourth renderer; both compose correctly |
| 7 | Mock `LegacyAuth` returning null; verify Optional.empty() emerges |
| 8 | Stack three decorators; verify all log lines appear |
| 9 | Add explicit "may throw" or `Optional<V>` to `Cache.get` |
| 10 | Justify in writing; commit your decision and reason |
| 11 | After refactor, attempting `counter.n = 5` shouldn't compile |
| 12 | Add `ParenToken` to `permits`; observe compile error pinpointing every switch |

---

## Solutions sketch

**Task 1**: abstract class is reasonable due to shared `id` field. Or use an interface + a record inside the implementations to share data. Either works.

**Task 2**:
```java
@FunctionalInterface
interface Validator<T> {
    List<String> validate(T t);
    default Validator<T> andThen(Validator<T> other) {
        return t -> {
            List<String> errors = new ArrayList<>(validate(t));
            errors.addAll(other.validate(t));
            return errors;
        };
    }
}
```

**Task 5**:
```java
sealed interface Result<T> permits Success, Failure {
    default <U> Result<U> map(Function<T, U> f) {
        return switch (this) {
            case Success<T> s -> new Success<>(f.apply(s.value()));
            case Failure<T> e -> new Failure<>(e.error());
        };
    }
}
```

**Task 9**: the `Cache.get` returns `null` on absent *and* on IO failure — same value for two different conditions. Caller can't distinguish. Better: throw on IO error, return `Optional.empty()` on absence.

**Task 10**: with one impl and no plan for more, it's premature. Collapse `UserServiceImpl` directly into `UserService` (rename to `UserService`). Revisit when a second impl appears.

---

**Memorize this**: every abstraction has a cost (cognitive, testing, dispatch) and a benefit (swap-ability, testability, evolution). Pay the cost only when the benefit is real.
