# Functional Interfaces and Lambdas — Middle

> **What?** The everyday refactors: turning anonymous inner classes into lambdas, picking the right functional interface from `java.util.function`, the four method-reference flavours in real code, primitive specializations that avoid boxing, and lambda composition (`andThen`, `compose`, `and`, `or`, `negate`).
> **How?** Read the rewrite, name the old shape, name the new shape. Most of what makes lambda-heavy code good or bad lives in *which type* you pick and *whether you compose* — not in the lambda syntax itself.

---

## 1. The middle skill: pick the right type, not just any lambda

Junior-level lambda work is "I can replace this anonymous class with `x -> ...`". Middle-level work is "I see this is a `Predicate<Order>`, not an `OrderFilter` I had to invent, and I see I can `and`/`or` it with the other predicates the system already has." The syntax is the cheap part; the value is in fitting your callbacks into the JDK's existing vocabulary so callers don't need a tour of your private types.

Each section that follows is a transformation: starting code, the smell, the new shape. None of them require a framework — just `java.util.function`.

---

## 2. Anonymous inner class → lambda

The classic refactor. Six lines collapse to one:

```java
// Before — pre-Java 8 idiom:
Collections.sort(employees, new Comparator<Employee>() {
    @Override
    public int compare(Employee a, Employee b) {
        return a.salary().compareTo(b.salary());
    }
});

// After — lambda:
Collections.sort(employees, (a, b) -> a.salary().compareTo(b.salary()));

// Even better — method reference + a Comparator factory:
employees.sort(Comparator.comparing(Employee::salary));
```

Three steps happened:

1. The anonymous class became a lambda — same `compare` method, less ceremony.
2. The hand-written comparison became `Comparator.comparing`, a factory that builds a `Comparator<T>` from a key extractor `Function<T, U>`.
3. `Collections.sort(list, cmp)` became `list.sort(cmp)` — a `default` method on `List`.

The end state reads as "sort employees by salary", which is what the code is actually for. Anonymous classes for a SAM are now nearly always a smell — modern IDEs offer the conversion as a quick fix.

A second canonical case is `Runnable`:

```java
// Before:
new Thread(new Runnable() {
    @Override public void run() { doWork(); }
}).start();

// After:
new Thread(() -> doWork()).start();
new Thread(Demo::doWork).start();   // even shorter if doWork is static
```

When to *keep* an anonymous class: when you need extra fields, multiple methods (even if only one is abstract), or a self-reference (`this` meaning the class itself, not the enclosing class) — see senior.md.

---

## 3. Picking the right functional interface

`java.util.function` ships 43 types, but you only need a handful of shapes:

| Shape                             | Interface                       | SAM signature                  |
|----------------------------------|----------------------------------|--------------------------------|
| `T -> R`                         | `Function<T, R>`                | `R apply(T t)`                 |
| `(T, U) -> R`                    | `BiFunction<T, U, R>`           | `R apply(T t, U u)`            |
| `T -> T`                         | `UnaryOperator<T>`              | `T apply(T t)`                 |
| `(T, T) -> T`                    | `BinaryOperator<T>`             | `T apply(T t, T t2)`           |
| `T -> boolean`                   | `Predicate<T>`                  | `boolean test(T t)`            |
| `(T, U) -> boolean`              | `BiPredicate<T, U>`             | `boolean test(T t, U u)`       |
| `T -> void`                      | `Consumer<T>`                   | `void accept(T t)`             |
| `(T, U) -> void`                 | `BiConsumer<T, U>`              | `void accept(T t, U u)`        |
| `() -> T`                        | `Supplier<T>`                   | `T get()`                      |
| `() -> void`                     | `Runnable`                      | `void run()`                   |

Rule of thumb: write down the shape (inputs → output) and pick the interface that matches. Only invent a custom interface when the existing one's *name* would confuse readers — for example, `Validator<T>` instead of `Predicate<T>` can clarify intent. If you do define one, annotate it `@FunctionalInterface` (JLS §9.8) so future maintainers can't break the SAM rule:

```java
@FunctionalInterface
public interface Validator<T> {
    void validate(T t) throws ValidationException;     // checked exception → custom type
}
```

Note: the JDK's `Function<T,R>` cannot throw checked exceptions. If your operation throws checked, you must either wrap it (sneaky-throws, `RuntimeException`) or define a domain interface like `Validator` above.

---

## 4. Method reference forms in real code

Four flavours (JLS §15.13.1). All four compile to the same kind of `invokedynamic` site you would get from an equivalent lambda — there is no runtime difference, only readability.

```java
// 1. ClassName::staticMethod  →  Function<String, Integer>
list.stream().map(Integer::parseInt).toList();

// 2. instance::method  →  bound receiver
PrintStream out = System.out;
list.forEach(out::println);

// 3. ClassName::instanceMethod  →  receiver is the lambda's argument
list.stream().map(String::toUpperCase).toList();
// equivalent to: s -> s.toUpperCase()

// 4. ClassName::new  →  Supplier<T> or Function<X, T>
Supplier<List<String>>          mkList    = ArrayList::new;
Function<Integer, List<String>> mkSizedList = ArrayList::new;   // calls ArrayList(int)
```

The fourth flavour, `ClassName::new`, picks the right constructor by target type. The two `ArrayList::new` references above resolve to different constructors because the target functional interfaces differ. Overloaded constructors are resolved like overloaded methods (see find-bug.md for the ambiguity case).

When **not** to use a method reference:

```java
// Bad — looks shorter but loses the "what is happening" hint:
items.forEach(this::process);

// Often clearer:
items.forEach(item -> process(item));
```

Method references shine when the name already describes the action (`Integer::parseInt`, `String::trim`). They hurt when the call adds non-obvious shadowing (`this::handle` next to several `handle` overloads).

---

## 5. Primitive specializations — avoid the boxing tax

`Function<Integer, Integer>` looks innocent. Each `apply` boxes an `int` to an `Integer` on the way in and unboxes one on the way out — at hot-loop scale this becomes the dominant cost. `java.util.function` ships **primitive specializations** to skip the box:

```java
// Generic — boxes twice per call:
Function<Integer, Integer> doubleItBoxed = x -> x * 2;

// Primitive specialization — no boxing:
IntUnaryOperator doubleIt = x -> x * 2;
int y = doubleIt.applyAsInt(7);
```

The full set is large but follows two naming patterns:

| Name pattern              | Example                | Shape                                |
|---------------------------|------------------------|---------------------------------------|
| `IntFunction<R>`          | `int -> R`             | `R apply(int)`                       |
| `ToIntFunction<T>`        | `T -> int`             | `int applyAsInt(T)`                  |
| `IntToLongFunction`       | `int -> long`          | `long applyAsLong(int)`              |
| `IntPredicate`            | `int -> boolean`       | `boolean test(int)`                  |
| `IntConsumer`             | `int -> void`          | `void accept(int)`                   |
| `IntSupplier`             | `() -> int`            | `int getAsInt()`                     |
| `IntUnaryOperator`        | `int -> int`           | `int applyAsInt(int)`                |
| `IntBinaryOperator`       | `(int, int) -> int`    | `int applyAsInt(int, int)`           |

`Long`- and `Double`-prefixed variants exist for every shape. There are no `byte`/`short`/`char`/`float` specializations — those promote to `int`/`double` in computation.

The streams API mirrors this: `IntStream`, `LongStream`, `DoubleStream` exist so that `stream.mapToInt(Order::lineCount).sum()` runs without boxing.

```java
// Boxing-free:
int total = orders.stream().mapToInt(Order::lineCount).sum();

// Boxing version (works, slower in tight loops):
int total = orders.stream().map(Order::lineCount).reduce(0, Integer::sum);
```

Reach for the primitive specialization when the lambda lives inside a hot loop or a stream over millions of elements. For one-off calls, the generic form is fine — readability wins.

---

## 6. Composing predicates: `and`, `or`, `negate`

`Predicate<T>` exposes three `default` methods that build new predicates from old ones:

```java
Predicate<Order> isPaid    = Order::isPaid;
Predicate<Order> isOverdue = o -> o.due().isBefore(LocalDate.now());
Predicate<Order> isLarge   = o -> o.total().compareTo(new BigDecimal("1000")) > 0;

Predicate<Order> followUp   = isOverdue.and(isPaid.negate());
Predicate<Order> escalation = followUp.and(isLarge);

orders.stream().filter(escalation).forEach(this::page);
```

The composed predicate is itself a `Predicate<Order>` — short-circuit evaluation works as you'd expect (`a.and(b)` short-circuits when `a` is false; `a.or(b)` short-circuits when `a` is true).

There is also a static factory:

```java
Predicate<String> notNull = Predicate.not(Objects::isNull);
```

`Predicate.not(p)` (since Java 11) reads more naturally in method-reference contexts than `p.negate()`.

---

## 7. Composing functions: `andThen` vs `compose`

`Function<T, R>` ships two composition methods. They differ in **which function runs first**.

```java
Function<Integer, Integer> times2 = x -> x * 2;
Function<Integer, Integer> plus3  = x -> x + 3;

// andThen — left-to-right: apply this, then the argument:
Function<Integer, Integer> doubleThenAdd = times2.andThen(plus3);
//  doubleThenAdd.apply(5)  =>  plus3.apply(times2.apply(5))  =>  plus3.apply(10)  =>  13

// compose — right-to-left: apply the argument first, then this:
Function<Integer, Integer> addThenDouble = times2.compose(plus3);
//  addThenDouble.apply(5)  =>  times2.apply(plus3.apply(5))  =>  times2.apply(8)   =>  16
```

The mnemonic: **`andThen` is forward reading**. `f.andThen(g)` is "do f, **and then** do g". `f.compose(g)` is "f *composed with* g" — mathematical composition `f ∘ g`, which is right-to-left.

In practice, `andThen` is what you reach for nine times out of ten. Use `compose` when expressing a mathematical pipeline literally.

```java
Function<String, String>  parseName = String::trim;
Function<String, Integer> length    = String::length;
Function<Integer, String> tag       = n -> "len=" + n;

Function<String, String> pipeline = parseName.andThen(length).andThen(tag);
pipeline.apply("   hello  ");   // "len=5"
```

`Consumer<T>` and `BiConsumer<T,U>` also have `andThen` (chain side-effects in order). `Function.identity()` returns `x -> x`, useful as the seed of a fold or the default in a `Map.Entry` collector.

---

## 8. Throwing checked exceptions from a lambda

The JDK functional interfaces don't declare `throws`. If your lambda body throws a checked exception, it won't compile against `Function<T,R>`:

```java
// Won't compile — InterruptedException is checked:
Supplier<String> s = () -> { Thread.sleep(1000); return "done"; };
```

Three honest options:

```java
// 1. Wrap and rethrow as unchecked at the call site:
Supplier<String> s = () -> {
    try { Thread.sleep(1000); }
    catch (InterruptedException e) { throw new RuntimeException(e); }
    return "done";
};

// 2. Define a domain functional interface that declares the exception:
@FunctionalInterface
interface CheckedSupplier<T, E extends Exception> { T get() throws E; }

// 3. Use a small helper that wraps for you:
static <T> Supplier<T> sneaky(CheckedSupplier<T, ?> cs) {
    return () -> { try { return cs.get(); } catch (Exception e) { throw new RuntimeException(e); } };
}
```

Option 2 is the right answer for a library API; option 1 is fine for one-off application code. Avoid swallowing the exception (`catch (...) { return null; }`) — find-bug.md catalogues why.

---

## 9. Designing an API that takes a lambda

When you expose a method that accepts a callback, pick the JDK type if your shape fits, define a custom `@FunctionalInterface` if it doesn't, and name the parameter for the *role* the callback plays.

```java
public final class RetryExecutor {

    // Bad — generic Runnable hides what the caller is supposed to provide:
    public void retry(Runnable r) { ... }

    // Better — domain interface communicates the contract (may throw):
    @FunctionalInterface
    public interface Attempt<T> { T run() throws Exception; }

    public <T> T retry(int maxAttempts, Attempt<T> attempt) throws Exception {
        Exception last = null;
        for (int i = 0; i < maxAttempts; i++) {
            try { return attempt.run(); }
            catch (Exception e) { last = e; }
        }
        throw last;
    }
}
```

Three small wins: the SAM name `run` matches what callers do; the type parameter `T` makes the return value typed; the `throws Exception` is honest about failure.

---

## 10. Quick rules

- [ ] Replace `new SAM() { @Override … }` with a lambda; let the IDE quick-fix it.
- [ ] Pick the JDK functional interface that matches your shape before inventing a new one.
- [ ] Annotate every custom functional interface with `@FunctionalInterface`.
- [ ] Use a method reference when the lambda body is exactly one method call; otherwise keep the lambda.
- [ ] In hot loops, use primitive specializations (`IntUnaryOperator`, `IntStream`, `ToIntFunction`) to skip boxing.
- [ ] Compose predicates with `and`/`or`/`negate`/`Predicate.not` rather than re-spelling logic.
- [ ] Use `andThen` for forward-reading pipelines; reserve `compose` for literal mathematical composition.
- [ ] If your callback throws checked exceptions, define a domain functional interface — don't fight `Function<T,R>`.

---

## 11. What's next

| Topic                                                              | File              |
|--------------------------------------------------------------------|-------------------|
| `invokedynamic`, `LambdaMetafactory`, capture internals             | `senior.md`        |
| Reviewing lambda-heavy PRs; API design discipline                   | `professional.md`  |
| JLS/JVMS/JEP references                                            | `specification.md` |
| Ten silent lambda bugs                                              | `find-bug.md`      |
| Cold-start cost, primitive specializations, JIT inlining            | `optimize.md`      |
| Eight refactors                                                    | `tasks.md`         |
| Interview Q&A                                                       | `interview.md`     |

See also: [../05-default-methods-and-diamond-problem/](../05-default-methods-and-diamond-problem/) (default methods don't break SAM), [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/) (how `invokeinterface` resolves), and [../../../../05-lambda-expressions/](../../../../05-lambda-expressions/) (deeper lambda coverage).

---

**Memorize this:** "shape first, syntax second". Write the input-to-output shape on paper, then look up the matching `java.util.function` type. Reach for primitive specializations in hot paths; compose with `and`/`or`/`andThen` instead of repeating logic; replace anonymous SAM classes with lambdas or method references unless you need fields or `this`. The lambda is the cheap part — choosing the right interface is the design.
