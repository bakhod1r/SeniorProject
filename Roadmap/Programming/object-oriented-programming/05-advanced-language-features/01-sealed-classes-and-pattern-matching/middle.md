# Sealed Classes and Pattern Matching — Middle

> **What?** A working tour of how `sealed` + `record` + pattern matching replaces three older Java idioms — `instanceof` ladders, the GoF visitor pattern, and stringly-typed dispatch — with shorter, exhaustive, type-checked code. Covers algebraic data types in Java, record patterns, nested patterns, and `Result<T, E>` as the canonical example.
> **How?** Each section shows a starting shape (an `instanceof` chain, a switch on a `kind` field, a visitor with one `visit` method per type), names the problem, and rewrites with sealed types plus a pattern-match `switch`. The diffs are real and small.

---

## 1. Why sealed + records is the modern OO refactor

A class hierarchy in classic Java is *open by default*: anyone with `extends MyClass` can join the family. That openness has costs you don't always want — you can't enumerate variants, you can't pattern-match exhaustively, and your library API includes "anyone you have never met" as a permitted implementer.

Sealed types flip the default. `sealed interface Shape permits Circle, Square, Triangle` says: these are all the shapes there will ever be. Pair that with records (immutable data carriers) and pattern matching (destructuring switches), and you get *algebraic data types* — the same shape that Haskell calls `data`, Rust calls `enum`, OCaml calls *variants*. Java now spells them with three keywords: `sealed`, `record`, `switch`.

The refactors below all share the same recipe:

1. Identify the closed set of variants.
2. Make them records implementing a sealed interface.
3. Replace dispatch (instanceof chain, kind-switch, visitor) with a pattern-match `switch`.

---

## 2. Refactor an `instanceof` chain into a pattern-match `switch`

Starting point — a payment dispatcher written before Java 16:

```java
public BigDecimal fee(PaymentInstrument p) {
    if (p instanceof CreditCard) {
        CreditCard c = (CreditCard) p;
        return c.amount().multiply(new BigDecimal("0.029"))
                         .add(new BigDecimal("0.30"));
    } else if (p instanceof BankTransfer) {
        BankTransfer b = (BankTransfer) p;
        return b.amount().multiply(new BigDecimal("0.008"));
    } else if (p instanceof Crypto) {
        Crypto x = (Crypto) p;
        return x.amount().multiply(new BigDecimal("0.015"));
    } else {
        throw new IllegalArgumentException("unknown: " + p.getClass());
    }
}
```

Three problems: redundant casts, no exhaustiveness check, and a `default` branch that fires only when somebody adds a fourth payment type and forgets to update this method.

Step 1: seal the parent.

```java
public sealed interface PaymentInstrument permits CreditCard, BankTransfer, Crypto {
    BigDecimal amount();
}

public record CreditCard(BigDecimal amount, String pan)        implements PaymentInstrument {}
public record BankTransfer(BigDecimal amount, String iban)     implements PaymentInstrument {}
public record Crypto(BigDecimal amount, String walletAddress)  implements PaymentInstrument {}
```

Step 2: rewrite as a pattern-match `switch`.

```java
public BigDecimal fee(PaymentInstrument p) {
    return switch (p) {
        case CreditCard c   -> c.amount().multiply(new BigDecimal("0.029"))
                                          .add(new BigDecimal("0.30"));
        case BankTransfer b -> b.amount().multiply(new BigDecimal("0.008"));
        case Crypto x       -> x.amount().multiply(new BigDecimal("0.015"));
    };
}
```

Three lines shorter, no casts, no `default`. Add `record ApplePay(...)` to `permits` and every `switch` over `PaymentInstrument` immediately turns red — the compiler tells you what to update.

---

## 3. Sealed + records as algebraic data types

The pair `sealed interface` + `record` implementations is Java's way of writing sum-of-products:

- **Sum type** — `PaymentInstrument` is one *of* `CreditCard | BankTransfer | Crypto`. A value is exactly one variant at a time.
- **Product type** — each `record` carries *all* of its fields together. `CreditCard(amount, pan)` is `amount × pan`.

Together you get any ADT a typed functional language can express, and `switch` becomes structural pattern matching over the sum.

An expression tree is the classic ADT example:

```java
public sealed interface Expr permits Lit, Add, Mul, Neg {}

public record Lit(int value)             implements Expr {}
public record Add(Expr left, Expr right) implements Expr {}
public record Mul(Expr left, Expr right) implements Expr {}
public record Neg(Expr operand)          implements Expr {}

public static int eval(Expr e) {
    return switch (e) {
        case Lit(int v)         -> v;
        case Add(Expr l, Expr r) -> eval(l) + eval(r);
        case Mul(Expr l, Expr r) -> eval(l) * eval(r);
        case Neg(Expr x)        -> -eval(x);
    };
}
```

Four variants, four cases, recursion is direct, and the compiler proves the switch is complete. The `Add(Expr l, Expr r)` syntax is a *record pattern* — see section 5.

---

## 4. `Result<T, E>` — error handling without exceptions

A useful sealed type to have in your toolkit:

```java
public sealed interface Result<T, E> permits Result.Ok, Result.Err {

    record Ok<T, E>(T value)  implements Result<T, E> {}
    record Err<T, E>(E error) implements Result<T, E> {}

    static <T, E> Result<T, E> ok(T v)  { return new Ok<>(v); }
    static <T, E> Result<T, E> err(E e) { return new Err<>(e); }

    default <U> Result<U, E> map(Function<? super T, ? extends U> f) {
        return switch (this) {
            case Ok<T, E> o  -> Result.ok(f.apply(o.value()));
            case Err<T, E> e -> Result.err(e.error());
        };
    }

    default <U> Result<U, E> flatMap(Function<? super T, Result<U, E>> f) {
        return switch (this) {
            case Ok<T, E> o  -> f.apply(o.value());
            case Err<T, E> e -> Result.err(e.error());
        };
    }
}
```

Callers compose without `try/catch`:

```java
Result<User, ApiError> result = findUser(id)
    .flatMap(this::loadProfile)
    .map(Profile::name);

switch (result) {
    case Result.Ok<String, ApiError> ok  -> ctx.render("Welcome " + ok.value());
    case Result.Err<String, ApiError> er -> ctx.renderError(er.error());
}
```

Two variants, every consumer must handle both. No `Optional` ambiguity (which loses the cause), no exception bubble that someone forgets to catch. The pattern scales: add `Loading` as a third variant for async UIs and the compiler flags every switch that needs updating.

---

## 5. Record patterns — destructuring in the case label

JEP 440 (final in Java 21) added *record patterns*: you can pull fields out of a record right in the `case` label.

```java
public sealed interface Json permits Json.Str, Json.Num, Json.Arr, Json.Obj {

    record Str(String value)         implements Json {}
    record Num(double value)         implements Json {}
    record Arr(List<Json> items)     implements Json {}
    record Obj(Map<String, Json> fields) implements Json {}
}

public static int depth(Json j) {
    return switch (j) {
        case Json.Str s             -> 1;
        case Json.Num n             -> 1;
        case Json.Arr(List<Json> items) ->
            1 + items.stream().mapToInt(MiddleExample::depth).max().orElse(0);
        case Json.Obj(Map<String, Json> fields) ->
            1 + fields.values().stream().mapToInt(MiddleExample::depth).max().orElse(0);
    };
}
```

The third and fourth cases never name a local variable for the record itself — they go straight to its components. The compiler synthesises calls to the record's accessors (`items()`, `fields()`).

A binding for the whole record *and* destructuring is also fine:

```java
case Json.Arr arr when arr.items().isEmpty() -> 0;
case Json.Arr(List<Json> items)              -> 1 + maxDepth(items);
```

The `when` clause is a *guarded pattern* — runs the case only if the guard is true. Guards must not have side effects (the compiler does not forbid them but pattern-match semantics assume purity; see [find-bug.md](find-bug.md) for the kind of bug a side-effecting guard creates).

---

## 6. Nested patterns

Record patterns nest naturally — destructure a record inside another record:

```java
public sealed interface Event permits Event.Login, Event.Click {

    record User(long id, String name) {}
    record Login(User user, Instant at)        implements Event {}
    record Click(User user, String element, Instant at) implements Event {}
}

public static String summary(Event e) {
    return switch (e) {
        case Event.Login(User(long id, String name), Instant at) ->
            "Login by " + name + " (#" + id + ") at " + at;
        case Event.Click(User(long id, String name), String element, Instant at) ->
            name + " clicked " + element + " at " + at;
    };
}
```

The `User(long id, String name)` inside `Login(...)` destructures one level deeper. There is no depth limit — you can nest as far as your data nests. The compiler still proves exhaustiveness over the outer sealed type.

This is the same idea as ML/Haskell pattern matching:

```haskell
case e of
  Login (User id name) at        -> "Login by " ++ name
  Click (User _ name) elt at     -> name ++ " clicked " ++ elt
```

Java's syntax is more verbose, but the type-system guarantees are equivalent.

---

## 7. Sealed types replace the visitor pattern

The GoF *Visitor* exists because pre-pattern-match Java had no way to dispatch on closed sums. You wrote one `visit` method per variant, hooked them up with a `accept(Visitor)` method on the parent, and accepted the boilerplate as the cost of double dispatch.

Before:

```java
public interface ExprVisitor<R> {
    R visit(Lit l);
    R visit(Add a);
    R visit(Mul m);
    R visit(Neg n);
}

public abstract class Expr {
    public abstract <R> R accept(ExprVisitor<R> v);
}

public final class Lit extends Expr {
    private final int value;
    public Lit(int v) { this.value = v; }
    public int value() { return value; }
    @Override public <R> R accept(ExprVisitor<R> v) { return v.visit(this); }
}
// ... three more classes, each repeating accept(v) → v.visit(this)

public final class Eval implements ExprVisitor<Integer> {
    public Integer visit(Lit l) { return l.value(); }
    public Integer visit(Add a) { return a.left().accept(this) + a.right().accept(this); }
    public Integer visit(Mul m) { return m.left().accept(this) * m.right().accept(this); }
    public Integer visit(Neg n) { return -n.operand().accept(this); }
}
```

After:

```java
public sealed interface Expr permits Lit, Add, Mul, Neg {}
public record Lit(int value)             implements Expr {}
public record Add(Expr left, Expr right) implements Expr {}
public record Mul(Expr left, Expr right) implements Expr {}
public record Neg(Expr operand)          implements Expr {}

public static int eval(Expr e) {
    return switch (e) {
        case Lit(int v)          -> v;
        case Add(Expr l, Expr r) -> eval(l) + eval(r);
        case Mul(Expr l, Expr r) -> eval(l) * eval(r);
        case Neg(Expr x)         -> -eval(x);
    };
}
```

Five classes shrink to four records plus one method. The `accept`/`visit` indirection is gone. Adding a new variant — `Div`, say — adds one record and breaks every switch, instead of forcing every visitor to add a new `visit(Div)` and every leaf to keep its `accept` correct.

The visitor still wins in one situation: *open* hierarchies where you want to add new operations *without modifying the variants*. Sealed + switch is for *closed* hierarchies where you control the variants but operations multiply. Choose by which axis moves; both are legitimate. See [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) for the broader trade-off.

---

## 8. Switch over generics and wildcards

A common gotcha: the type pattern `case List<String> ls -> ...` is *not* allowed because of erasure — the runtime cannot distinguish `List<String>` from `List<Integer>`. The compiler will only let you write *reifiable* type patterns. Use unbounded wildcards if you need to match the raw shape:

```java
public static String describe(Object x) {
    return switch (x) {
        case List<?> list -> "list of " + list.size();
        case Map<?, ?> m  -> "map of " + m.size();
        case String s     -> "string of length " + s.length();
        case null         -> "null";
        default           -> "unknown";
    };
}
```

A `null` *pattern* is also new: `case null` binds when the scrutinee is `null` without throwing `NullPointerException`. Pre-21 `switch` threw NPE on null; the pattern-match switch will throw only if you don't write `case null` and the scrutinee is null. We cover this in [find-bug.md](find-bug.md).

---

## 9. Sealing across files and modules

`permits` may name types only in:

- the **same compilation unit** (you can omit the `permits` clause and the compiler infers it from the file), or
- the **same package and module**, or
- a different package of the same **named module**.

`permits` may *not* cross module boundaries. A `sealed` type in module `core` cannot list a permit in module `app`. This rule prevents downstream modules from forcing themselves into your closed set.

```java
// File: shape/Shape.java
public sealed interface Shape
    permits shape.geom.Circle, shape.geom.Square, shape.geom.Triangle {}

// File: shape/geom/Circle.java
package shape.geom;
public record Circle(double r) implements shape.Shape {}
```

This works when both packages live in the same module. Cross-module sealing is intentionally forbidden; if you need it, your boundary is wrong.

When all permitted children live in the same file as the parent, you can omit `permits`:

```java
public sealed interface Op {            // permits inferred
    record Add() implements Op {}
    record Sub() implements Op {}
    record Mul() implements Op {}
}
```

The compiler reads the file, finds the implementing types, and writes the `permits` list into the class file. The runtime-visible attribute (`PermittedSubclasses`, JVMS §4.7.31) is still present — see [specification.md](specification.md).

---

## 10. Adding a new variant — what changes

When you add a permitted subclass, two things happen at compile time:

1. The `permits` clause grows by one entry.
2. Every `switch` over the sealed type that lacked a `default` clause turns red.

That second effect is the feature working. Each affected switch is a place that needs a real decision: handle the new variant explicitly, or accept its semantics by falling through to an existing case. There is no third option of "miss this and silently do the wrong thing".

In a polyrepo or multi-module setup, the change is *binary breaking* for any consumer that compiled an exhaustive switch against the old set. We treat this carefully in [senior.md](senior.md).

---

## 11. Quick rules

- [ ] When you find an `instanceof` ladder, seal the parent and rewrite as a pattern-match `switch`.
- [ ] Pair `sealed interface` with `record` implementations whenever the children are data — you get ADTs in two keywords.
- [ ] Use record patterns to destructure in the `case` label — `case Add(Expr l, Expr r) -> ...`.
- [ ] Nest patterns freely — `Login(User(long id, String name), Instant at)` is fine.
- [ ] Add `case null` when null is a meaningful input; otherwise let the switch throw NPE.
- [ ] Drop `default` from sealed-type switches. The compiler is more reliable than a fallback branch.
- [ ] When sealing across packages, both packages must share the same named module.
- [ ] Choose sealed + switch when variants are closed and operations multiply; choose visitor when variants are open and operations close.

---

## 12. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Closed-world dispatch, `non-sealed`, typeSwitch internals, binary compat | `senior.md`        |
| Code-review vocabulary, ArchUnit rules, migration                   | `professional.md`  |
| JLS §8.1.1.2, §9.1.1.4, JVMS §4.7.31, JEPs 360/397/409/394/406/440/441 | `specification.md` |
| Sealed and pattern-match hazards in production                       | `find-bug.md`      |
| typeSwitch lowering, JIT inlining, JMH benchmarks                   | `optimize.md`      |
| Hands-on refactors                                                  | `tasks.md`         |
| Interview Q&A                                                       | `interview.md`     |

---

**Memorize this:** `sealed interface` plus `record` plus pattern-match `switch` is Java's spelling of algebraic data types — sum-of-products with compiler-enforced exhaustiveness. Refactor `instanceof` ladders into pattern switches, replace the visitor pattern when the variants are closed, and let `Result<T, E>` carry your errors. The compiler now does the bookkeeping you used to do by hand.
