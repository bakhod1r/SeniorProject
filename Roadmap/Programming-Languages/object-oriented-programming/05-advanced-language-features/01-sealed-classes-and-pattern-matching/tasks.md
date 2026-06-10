# Sealed Classes and Pattern Matching — Practice Tasks

Eight exercises that force `sealed` + `record` + pattern matching to do real work. Each starts from a shape you will plausibly meet in production: an `instanceof` ladder, a stringly-typed dispatcher, a hand-rolled visitor, a generic `Result` that hides errors. Work each in three passes: (1) read the snippet and name the problem in sealed-types vocabulary, (2) sketch the new shape on paper before the keyboard, (3) write code plus a small test that would have caught the original failure.

---

## Task 1 — Refactor a payment-processing `instanceof` chain

```java
public class PaymentFeeCalculator {

    public BigDecimal feeFor(Object instrument, BigDecimal amount) {
        if (instrument instanceof CreditCard) {
            CreditCard c = (CreditCard) instrument;
            return amount.multiply(new BigDecimal("0.029"))
                         .add(new BigDecimal("0.30"))
                         .add(c.isInternational() ? new BigDecimal("1.50") : BigDecimal.ZERO);
        } else if (instrument instanceof BankTransfer) {
            BankTransfer b = (BankTransfer) instrument;
            return amount.multiply(new BigDecimal("0.008"));
        } else if (instrument instanceof Crypto) {
            return amount.multiply(new BigDecimal("0.015"));
        } else if (instrument instanceof ApplePay) {
            return amount.multiply(new BigDecimal("0.018"));
        } else {
            throw new IllegalArgumentException("unknown instrument: " + instrument);
        }
    }
}
```

**Objective.** Replace the `instanceof` ladder with a sealed type and a pattern-match `switch`. The compiler must enforce that every new payment instrument is handled.

**Constraints.**

- Introduce `sealed interface PaymentInstrument permits CreditCard, BankTransfer, Crypto, ApplePay`.
- Each instrument becomes a `record` (with whatever fields the original implied).
- Use record patterns in the switch arms — destructure inside `case`.
- Drop the `default` and the `throw new IllegalArgumentException`. The compiler will reject the switch if you leave a permit unhandled.

**Acceptance criteria.**

- Adding a fifth instrument (say, `GooglePay`) to `permits` produces a red compile in `feeFor` until you add a case.
- The `feeFor` body contains no `instanceof`, no cast, no `default`.
- A unit test constructs each instrument variant and asserts the expected fee.
- The first compile after introducing the new permit fails *at the switch*, not at runtime.

---

## Task 2 — Design `Result<T, E>` as a sealed type

You inherit a codebase that throws exceptions for every recoverable error, and the call graph has become a tangle of `try/catch`. Design a typed `Result<T, E>` so callers handle success and failure explicitly.

**Objective.** Build the `Result<T, E>` skeleton with:

- A sealed root `interface Result<T, E> permits Ok, Err`.
- Two `record` implementations: `Ok<T, E>(T value)` and `Err<T, E>(E error)`.
- Static factory methods `Result.ok(T)` and `Result.err(E)`.
- Instance methods `map(Function<? super T, ? extends U>)`, `flatMap(Function<? super T, Result<U, E>>)`, `mapErr(Function<? super E, ? extends F>)`, `getOrElse(T fallback)`.
- A `fold(Function<T, R> onOk, Function<E, R> onErr)` that pattern-matches over the sealed type.

**Constraints.**

- No exceptions thrown from `map`/`flatMap`. Failure flows through the sealed type only.
- Every internal switch over a `Result` is exhaustive — no `default`.
- The interface must be `sealed`, the implementations must be `final` (records are).

**Acceptance criteria.**

- A test composes three operations with `flatMap` and asserts the final `Err` carries the cause of the first failure.
- Pattern matching against `Result` in client code compiles only with both `Ok` and `Err` cases.
- The `Result<T, E>` type does not depend on `Throwable` or `Exception` — `E` is whatever you want it to be (often a sealed `enum` of failure modes).

---

## Task 3 — Build an expression evaluator over a sealed AST

You're writing a small calculator for arithmetic expressions: literals, addition, multiplication, negation, and variables (lookups in an environment map).

**Objective.** Design the AST as a sealed type and implement `eval(Expr, Map<String, Long>)` as a pattern-match `switch`.

```java
public sealed interface Expr permits Lit, Var, Add, Mul, Neg {}

// Define each as a record. Use record patterns in eval.
```

**Constraints.**

- Every variant is a `record`. The AST is immutable.
- `eval` uses record patterns: `case Add(Expr l, Expr r) -> eval(l, env) + eval(r, env);`
- A missing variable in `env` returns `Result<Long, EvalError>` where `EvalError` is a sealed sub-type. (Re-use the `Result` from Task 2 if you wrote it.)
- The switch must be exhaustive over `Expr` without a `default`.

**Acceptance criteria.**

- `eval(new Add(new Lit(2), new Mul(new Lit(3), new Var("x"))), Map.of("x", 4L))` returns `Result.ok(14L)`.
- `eval(new Var("missing"), Map.of())` returns `Result.err(new EvalError.UnknownVariable("missing"))`.
- Adding a `Div` variant requires updating exactly one method (`eval`); the compiler refuses to let you forget.
- A unit test exercises every variant.

---

## Task 4 — Migrate a visitor-pattern AST to sealed + pattern switch

You inherit this legacy AST and visitor:

```java
public abstract class Node {
    public abstract <R> R accept(NodeVisitor<R> v);
}

public final class NumberNode extends Node {
    private final int value;
    public NumberNode(int v) { this.value = v; }
    public int value() { return value; }
    @Override public <R> R accept(NodeVisitor<R> v) { return v.visit(this); }
}

public final class AddNode extends Node { /* analogous, left + right */ }
public final class NegateNode extends Node { /* analogous, operand */ }

public interface NodeVisitor<R> {
    R visit(NumberNode n);
    R visit(AddNode n);
    R visit(NegateNode n);
}

public final class Evaluator implements NodeVisitor<Integer> {
    public Integer visit(NumberNode n) { return n.value(); }
    public Integer visit(AddNode n)    { return n.left().accept(this) + n.right().accept(this); }
    public Integer visit(NegateNode n) { return -n.operand().accept(this); }
}
```

**Objective.** Replace the visitor pattern with a sealed AST and pattern-match `switch`. Delete the `accept`/`visit` machinery.

**Constraints.**

- Convert each `Node` subclass to a `record` implementing a sealed `Node` interface.
- Replace `Evaluator` with a static `eval(Node)` method using `switch` with record patterns.
- Delete `NodeVisitor`, all `accept` methods, and the `Evaluator` class.
- Verify that adding a `MulNode` variant breaks `eval` until you add a case.

**Acceptance criteria.**

- The AST classes shrink to one line each (record declaration).
- The visitor interface is deleted.
- A new operation (say, `prettyPrint(Node)`) is one new method with one switch, not a new visitor.
- The line count of the refactored module is at least 30% lower than the original.

---

## Task 5 — Ensure exhaustiveness in a multi-module codebase

You have a multi-module project:

- Module `domain` exports `sealed interface OrderEvent permits Placed, Shipped, Cancelled`.
- Module `reporting` consumes `OrderEvent` with an exhaustive `switch`.
- Module `analytics` also consumes `OrderEvent` with an exhaustive `switch`.

A product manager asks you to add `Returned` to the event types.

**Objective.** Add the new permit and update all consumers without leaving any stale exhaustive switch behind.

**Constraints.**

- Add `Returned` to `OrderEvent.permits` in `domain`.
- Recompile both `reporting` and `analytics`. Both should produce compile errors at every exhaustive switch over `OrderEvent`.
- Update each switch with a meaningful case for `Returned`. No `default` clauses introduced.
- Run the cross-module test suite. It should pass after the updates.

**Acceptance criteria.**

- Before the update, `reporting` and `analytics` compile cleanly against `domain` v1.
- After adding `Returned` to `domain` and recompiling, both consumer modules fail to compile until updated.
- After updating both consumers, every switch handles `Returned` explicitly.
- The build script enforces that all modules are recompiled together when `domain` changes (no stale binaries).
- A test simulates emitting a `Returned` event and verifies both consumers process it correctly.

---

## Task 6 — Add a permit with a deprecation cycle

You publish library `com.acme.events` with:

```java
public sealed interface UserEvent permits Registered, Verified, Suspended {}
```

The product needs a new `Deleted` event. The library has 50+ consumers, many of whom write exhaustive switches.

**Objective.** Ship `Deleted` as a binary-breaking change with a documented migration path.

**Constraints.**

- Write a release note (`CHANGELOG.md` entry) explaining the new permit, the binary-compat impact, and the action consumers must take.
- Bump the library's major version (e.g. 2.x → 3.0).
- Add the new permit *and* a default-implementation method on `UserEvent` that returns a sensible value for `Deleted` (so consumers who upgrade source-only get a hint).
- Provide an OpenRewrite recipe (or a documented `sed` invocation) that scans consumer code for exhaustive switches over `UserEvent` and adds a TODO comment in each.

**Acceptance criteria.**

- The CHANGELOG names the breaking change.
- A consumer recompiled against the new version fails at every exhaustive switch.
- A consumer running with the new library binary against the old compiled switch throws `MatchException` at runtime — and the release note tells them this will happen.
- The major-version bump matches SemVer conventions.
- A migration guide explains both "handle Deleted explicitly" and "add a `default` for forward compatibility, losing exhaustiveness".

---

## Task 7 — Nested record pattern destructuring

You're processing structured events:

```java
public sealed interface Event permits LoginEvent, ClickEvent, PurchaseEvent {}

public record User(long id, String name, String email) {}
public record Address(String street, String city, String country) {}

public record LoginEvent(User user, Instant at)                                    implements Event {}
public record ClickEvent(User user, String element, Instant at)                    implements Event {}
public record PurchaseEvent(User user, BigDecimal total, Address shipTo, Instant at) implements Event {}
```

**Objective.** Implement `summarize(Event)` that returns a string for each event, using *nested* record patterns to destructure both the event and its embedded `User`/`Address`.

**Constraints.**

- Use nested record patterns: `case LoginEvent(User(long id, String name, String email), Instant at) -> ...`.
- Use `var` where the type is obvious to reduce noise: `case LoginEvent(User(var id, var name, var email), var at) -> ...`.
- Demonstrate a *guarded* case: `case PurchaseEvent(User u, BigDecimal total, Address(_, _, "US"), Instant at) when total.compareTo(BigDecimal.valueOf(1000)) > 0 -> ...` (Java 22+ for unnamed patterns; otherwise bind the unused components and ignore them).
- Exhaustiveness must be compiler-checked.

**Acceptance criteria.**

- The switch handles all three event types.
- At least one case uses two-level nesting.
- At least one case uses a guard (`when`).
- A unit test exercises each branch including the guard's true/false split.

---

## Task 8 — Benchmark sealed switch vs polymorphic dispatch

**Objective.** Use JMH to compare three approaches to the same dispatch problem (e.g., a simple arithmetic operation over `Op = Add | Sub | Mul`) and characterise the performance trade-offs.

**Constraints.**

- Write three JMH benchmark methods:
  - `sealedSwitchMonomorphic` — pattern-match switch, scrutinee always the same concrete type per iteration (use `@Param`).
  - `polyMonomorphic` — virtual call through `interface Op`, same concrete type per iteration.
  - `polyMegamorphic` — virtual call through `interface Op`, scrutinee cycles through all three concretes per iteration.
- Run with `-prof gc` to see allocation rates.
- Run with `-prof perfasm` (Linux) or `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` to confirm devirtualization.

**Acceptance criteria.**

- The benchmark produces stable numbers (CV < 5%) after warmup.
- `sealedSwitchMonomorphic` and `polyMonomorphic` are within 10% of each other.
- `polyMegamorphic` is significantly slower (3x–10x) than the monomorphic variants.
- The output is documented in a short report explaining the JIT behaviour observed.
- The benchmark code is committed alongside the production code; CI runs it nightly and tracks regressions.

---

## Validation

| Task | How to verify the fix |
|------|-----------------------|
| 1 | Add a new permit and confirm `feeFor` fails to compile. |
| 2 | Run a chain of `flatMap` calls and assert the first `Err` is preserved. |
| 3 | Add a `Div` variant; the compiler points at exactly one missing case in `eval`. |
| 4 | Delete `NodeVisitor.java` and confirm the project still compiles. |
| 5 | Run a cross-module test that emits every event including the new `Returned`. |
| 6 | Run the old consumer JAR against the new library JAR; observe `MatchException`. |
| 7 | Pattern-match `summarize` over each variant and confirm the destructured values are correct. |
| 8 | Compare `polyMegamorphic` and `sealedSwitchMonomorphic` — the ratio should be 3x–10x. |

---

## Worked solution sketch — Task 1 (refactor payment fee calculator)

```java
// 1. Seal the parent.
public sealed interface PaymentInstrument
    permits CreditCard, BankTransfer, Crypto, ApplePay {

    BigDecimal amount();
}

// 2. Each variant is a record.
public record CreditCard(BigDecimal amount, String pan, boolean isInternational)
    implements PaymentInstrument {}

public record BankTransfer(BigDecimal amount, String iban)
    implements PaymentInstrument {}

public record Crypto(BigDecimal amount, String walletAddress)
    implements PaymentInstrument {}

public record ApplePay(BigDecimal amount, String deviceId)
    implements PaymentInstrument {}

// 3. Replace the instanceof ladder with pattern-match switch.
public final class PaymentFeeCalculator {

    private static final BigDecimal CARD_RATE      = new BigDecimal("0.029");
    private static final BigDecimal CARD_FIXED     = new BigDecimal("0.30");
    private static final BigDecimal CARD_INTL_FEE  = new BigDecimal("1.50");
    private static final BigDecimal BANK_RATE      = new BigDecimal("0.008");
    private static final BigDecimal CRYPTO_RATE    = new BigDecimal("0.015");
    private static final BigDecimal APPLE_PAY_RATE = new BigDecimal("0.018");

    public BigDecimal feeFor(PaymentInstrument p) {
        return switch (p) {
            case CreditCard(BigDecimal amount, var pan, var intl) ->
                amount.multiply(CARD_RATE)
                      .add(CARD_FIXED)
                      .add(intl ? CARD_INTL_FEE : BigDecimal.ZERO);
            case BankTransfer(BigDecimal amount, var iban) ->
                amount.multiply(BANK_RATE);
            case Crypto(BigDecimal amount, var wallet) ->
                amount.multiply(CRYPTO_RATE);
            case ApplePay(BigDecimal amount, var device) ->
                amount.multiply(APPLE_PAY_RATE);
        };
    }
}

// 4. A test that adding a new permit breaks the compile.
class PaymentFeeCalculatorTest {

    @Test void chargesCardWithIntlFee() {
        var calc = new PaymentFeeCalculator();
        var card = new CreditCard(new BigDecimal("100.00"), "4111", true);
        assertEquals(new BigDecimal("4.70"), calc.feeFor(card));
    }

    @Test void chargesBank() {
        var calc = new PaymentFeeCalculator();
        var bank = new BankTransfer(new BigDecimal("100.00"), "DE89");
        assertEquals(new BigDecimal("0.800"), calc.feeFor(bank));
    }
}
```

Three things to notice in the sketch:

1. The sealed parent + records moves the type system into the dispatch. No `instanceof`, no cast, no `default`.
2. The switch destructures with record patterns. The body of each arm reads the components directly.
3. Adding `GooglePay` to `permits` produces a compile error pointing at `feeFor`. The next maintainer cannot accidentally ship a payment instrument that returns zero fee.

---

**Memorize this:** sealed types and pattern matching are most useful when applied to existing pain — an `instanceof` ladder, a string-keyed switch, a visitor pattern with one operation, a `Result<T, ?>` that hides errors. Each task above is one of those situations. If, after the refactor, adding a new variant produces a red compile in every place that needs updating, you have applied the feature correctly.
