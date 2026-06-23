# Functional Interfaces and Lambdas — Find the Bug

> 10 snippets where a lambda compiles, passes a quick read, and bites in production or under test. For each: read the code, decide what's wrong, name the runtime symptom (compile error, exception, wrong value, leak), and write the fix down before reading the answer.

---

## Bug 1 — Reassigning a captured local

```java
public List<Runnable> makeCounters() {
    List<Runnable> rs = new ArrayList<>();
    int i = 0;
    while (i < 3) {
        rs.add(() -> System.out.println(i));   // ← compile error here
        i++;
    }
    return rs;
}
```

**Symptom.** Compile error:

```
error: local variables referenced from a lambda expression must be final or effectively final
            rs.add(() -> System.out.println(i));
                                            ^
```

**Violation.** The lambda captures `i`, but `i++` reassigns it after capture, so it is *not* effectively final (JLS §4.12.4).

**Fix.** Take a snapshot per iteration:

```java
int i = 0;
while (i < 3) {
    int snapshot = i;                                  // effectively final for *this* iteration
    rs.add(() -> System.out.println(snapshot));
    i++;
}
```

Or use a `for` loop with a per-iteration variable — `for (int j = 0; j < 3; j++)` makes each `j` effectively final in its scope.

If you genuinely need a mutable counter, capture a holder:

```java
int[] counter = {0};
rs.add(() -> counter[0]++);   // the array reference is final; its contents are not
```

The compiler refuses to let you implicitly share mutable state across lambda and enclosing frame — that refusal is a *feature*.

---

## Bug 2 — `this` capture inside a nested anonymous class

```java
public final class Service {
    private final String name = "Service";

    public Runnable makeTask() {
        return new Runnable() {
            @Override public void run() {
                Runnable inner = () -> System.out.println(this);   // what is `this`?
                inner.run();
            }
        };
    }
}
```

**Symptom.** A surprised log line. Reading `this` inside the lambda, a maintainer assumes it's the enclosing `Service` — actually it's the *anonymous Runnable instance*:

```
Service$1@7f31245a
```

**Violation.** A lambda's `this` is the *immediately enclosing* `this`. Here that's the anonymous `Runnable`, not `Service`. The maintainer is confused because the lambda lives *inside* an anonymous class — so the "enclosing `this`" rule chains.

**Fix.** Either use the explicit qualified `this`, or pull the value out before the lambda:

```java
return new Runnable() {
    @Override public void run() {
        Runnable inner = () -> System.out.println(Service.this);   // qualified
        inner.run();
    }
};

// Or, better, hoist the value the lambda actually needs:
return new Runnable() {
    @Override public void run() {
        String n = name;
        Runnable inner = () -> System.out.println(n);
        inner.run();
    }
};
```

The general lesson: when you see `this` inside a lambda, ask "what is the *nearest* `this` in source order?" — not "what would I have wanted it to be?"

---

## Bug 3 — Listener lambda holds the outer instance forever

```java
public final class Page {
    private final byte[] thumbnail = new byte[8 * 1024 * 1024];  // 8 MB
    private final EventBus bus;

    public Page(EventBus bus) {
        this.bus = bus;
        bus.on("tick", () -> handleTick());   // implicit this — captures *this*
    }

    private void handleTick() { /* ... */ }
}
```

**Symptom.** A heap-dump analysis (Eclipse MAT, VisualVM) shows the GC root path for `Page` going through `EventBus` → `Listener[]` → `Page$$Lambda$N` → `Page`. Old `Page` instances accumulate in the heap; OOM after a few hours under load.

**Violation.** The lambda body calls an *instance method* of the enclosing class, so it captures `this` implicitly. The bus retains the lambda; the lambda retains the `Page`; the `Page`'s 8 MB thumbnail is never collected.

**Fix.** Three options, in order of preference:

```java
// 1. If the handler doesn't need page state, make it static:
private static void handleTick(EventBus bus) { /* ... */ }
bus.on("tick", () -> Page.handleTick(this.bus));   // still captures `bus`, not `this`

// 2. Capture only the values needed, not `this`:
final EventBus localBus = this.bus;
bus.on("tick", () -> /* use localBus, not this */);

// 3. Hold the subscription so you can cancel it on close:
Subscription sub = bus.on("tick", () -> handleTick());
onClose(() -> sub.cancel());
```

A subtler version of this bug: passing `this::handleTick` — same problem, less visible. The `instance::method` form binds the receiver, retaining the instance.

---

## Bug 4 — `Function.apply` on `null` propagates `NullPointerException`

```java
Map<String, Function<Order, String>> formatters = Map.of(
    "csv", o -> o.id() + "," + o.total(),
    "json", o -> "{\"id\":" + o.id() + "}"
);

String render(String fmt, Order order) {
    return formatters.get(fmt).apply(order);   // ← NPE waiting
}

// Caller:
render("xml", anOrder);   // returns null from Map.get, NPE on apply
```

**Symptom.** `NullPointerException` at the `apply` line. With Java 14+ helpful NPE messages on, the message is:

```
Cannot invoke "java.util.function.Function.apply(Object)" because the return value
of "java.util.Map.get(Object)" is null
```

**Violation.** `Map.get` returns `null` for missing keys. The lambda is fine — the lookup is not.

**Fix.** Defend at the lookup site, not inside the lambdas:

```java
String render(String fmt, Order order) {
    Function<Order, String> f = formatters.get(fmt);
    if (f == null) throw new IllegalArgumentException("unknown format: " + fmt);
    return f.apply(order);
}

// Or with Optional, if missing is benign:
return Optional.ofNullable(formatters.get(fmt))
               .map(f -> f.apply(order))
               .orElse("");
```

A second NPE shape: a lambda that itself returns `null` and a chained `.andThen` that dereferences:

```java
Function<Order, Customer> getCustomer = Order::customer;   // may return null
Function<Customer, String> getEmail   = Customer::email;
Function<Order, String> chain = getCustomer.andThen(getEmail);   // NPE if customer is null
```

Insert a null check or use `Optional`:

```java
Function<Order, String> safe =
    o -> Optional.ofNullable(o.customer()).map(Customer::email).orElse("(none)");
```

---

## Bug 5 — Exception swallowed inside a stream lambda

```java
List<Order> bad = orders.stream()
    .filter(o -> {
        try { return validator.check(o); }
        catch (Exception e) { return false; }
    })
    .toList();
```

**Symptom.** The pipeline returns zero results from a batch of 10 000 orders. No errors logged anywhere. The validation team spends an afternoon checking inputs before someone notices the `catch` block.

**Violation.** The lambda swallows *every* exception, including programming bugs (`NullPointerException`, `ClassCastException`), and returns `false`. Failing inputs are silently filtered out as "invalid".

**Fix.** Differentiate expected from unexpected. If `ValidationException` is the only legitimate "this input is bad" signal, catch only that:

```java
.filter(o -> {
    try { return validator.check(o); }
    catch (ValidationException e) {
        log.debug("invalid order {}: {}", o.id(), e.getMessage());
        return false;
    }
})
```

Programming bugs (`NPE`, `ClassCastException`, `OutOfMemoryError`) will now propagate and you'll find them in CI or staging rather than as silent zeros in production.

The general rule: **never `catch (Exception e) { return false; }` inside a `Predicate`**. You're trading correctness for an empty result.

---

## Bug 6 — `Function<Integer, Integer>` in a hot loop

```java
public int sumOfSquares(int[] xs) {
    Function<Integer, Integer> square = x -> x * x;
    int total = 0;
    for (int x : xs) total += square.apply(x);   // boxes twice per call
    return total;
}
```

**Symptom.** JMH benchmark shows 3–5× slowdown vs. the inlined `total += x * x`. Profiler (async-profiler) attributes most of the time to `Integer.valueOf` and `Integer.intValue`.

**Violation.** `Function<Integer, Integer>` boxes the `int` argument to `Integer`, calls `apply(Integer)`, then unboxes the `Integer` return — one `Integer` allocation per element (mitigated by the small-value cache, but still on the hot path).

**Fix.** Use the primitive specialization:

```java
public int sumOfSquares(int[] xs) {
    IntUnaryOperator square = x -> x * x;            // no boxing
    int total = 0;
    for (int x : xs) total += square.applyAsInt(x);
    return total;
}

// Even better — use an IntStream:
public int sumOfSquares(int[] xs) {
    return IntStream.of(xs).map(x -> x * x).sum();
}
```

The rule: in hot paths over primitives, reach for `IntFunction`, `ToIntFunction`, `IntUnaryOperator`, `IntStream`. The generic forms are fine for one-off calls; they hurt at loop scale.

---

## Bug 7 — `Serializable` lambda fails after refactor

```java
// Original code:
public final class Reports {
    public List<Order> bigOrders(List<Order> all) {
        return all.stream()
            .filter((Predicate<Order> & Serializable) o -> o.total().compareTo(BIG) > 0)
            .toList();
    }
    private static final BigDecimal BIG = new BigDecimal("10000");
}
```

The lambda gets serialized into a distributed-computing job spec stored on disk. Months later, someone refactors:

```java
// "Cleanup" — rename method:
public final class Reports {
    public List<Order> largeOrders(List<Order> all) { /* same body */ }
}
```

**Symptom.** Re-running the saved job throws on deserialization:

```
java.io.InvalidObjectException: Class not found:
    com.acme.Reports$$Lambda$23/0x000000800101a000
Caused by: java.lang.LambdaConversionException: Invalid receiver type ...
```

**Violation.** `Serializable` lambdas serialize via `SerializedLambda`, which records the *implementation method's name and owner*. The compiler-generated lambda body method is named after the enclosing method (`lambda$bigOrders$0`). Renaming the enclosing method changes the synthesised name, breaking previously-serialized lambdas.

**Fix.** Treat serialized lambdas as a binary API surface. Two practical options:

```java
// 1. Don't use Serializable lambdas — store the *data* that would parameterise them,
//    rebuild the lambda from data each time:
record OrderFilterSpec(BigDecimal min) implements Serializable {
    Predicate<Order> toPredicate() { return o -> o.total().compareTo(min) > 0; }
}

// 2. If you must, isolate Serializable lambdas in a class you treat as immutable:
public final class StableLambdas {
    public static final SerializablePredicate<Order> BIG_ORDER =
        (SerializablePredicate<Order>) o -> o.total().compareTo(new BigDecimal("10000")) > 0;
}
// Then NEVER refactor StableLambdas without a migration plan.
```

The general guidance: avoid `Serializable` lambdas unless a specific framework demands them. Even then, prefer "serialize the data, rebuild the lambda" to "serialize the lambda directly".

---

## Bug 8 — Ambiguous method reference to an overloaded method

```java
public final class Util {
    public static int parse(String s)            { return Integer.parseInt(s); }
    public static int parse(String s, int radix) { return Integer.parseInt(s, radix); }
}

Function<String, Integer> parser = Util::parse;   // ← compile error
```

**Symptom.** Compile error:

```
error: incompatible types: invalid method reference
    Function<String, Integer> parser = Util::parse;
                                       ^
    reference to parse is ambiguous
      both method parse(String) and method parse(String,int) in Util match
```

**Violation.** `Util::parse` could resolve to either overload — the compiler can't pick based on the target type alone, because both would satisfy `Function<String, Integer>` after coercion.

Actually `parse(String, int)` would *not* fit `Function<String, Integer>` (wrong arity), and `javac` does resolve correctly when arity differs. The real ambiguous case is *same arity* with different parameter types:

```java
public static int convert(String s)  { ... }
public static int convert(Object o)  { ... }

Function<String, Integer> f = Util::convert;   // ambiguous: both arity-1 String-compatible
```

**Symptom.** Same compile error message.

**Fix.** Switch to a lambda — explicit parameter type disambiguates:

```java
Function<String, Integer> f = (String s) -> Util.convert(s);
```

Or rename one of the overloads. Method references *cannot* override resolution beyond what overload resolution would do for an explicit call; if explicit call would be ambiguous, the reference is too.

---

## Bug 9 — `compose` vs `andThen` confusion

```java
Function<String, String> trim  = String::trim;
Function<String, String> upper = String::toUpperCase;

// Intent: trim, then uppercase:
Function<String, String> clean = trim.compose(upper);

String s = clean.apply("  hello  ");
```

**Symptom.** The result is `"  HELLO  "`, not `"HELLO"`. The team blames the input until someone reads the docs.

**Violation.** `f.compose(g)` is mathematical composition `f ∘ g`: it applies `g` *first*, then `f`. So `trim.compose(upper)` is "uppercase first, then trim" — and uppercase doesn't remove whitespace.

**Fix.** Use `andThen`, which reads left-to-right:

```java
Function<String, String> clean = trim.andThen(upper);   // trim, then upper
clean.apply("  hello  ");   // "HELLO"
```

Mnemonic: `andThen` reads *forward*. `compose` reads *backward* — it's `f ∘ g`, which is "apply g, then f", a convention from mathematics. In Java code, you almost always want `andThen`.

A second variant: `Comparator.thenComparing` is *also* forward — `byName.thenComparing(byAge)` sorts by name first, age as tiebreaker. The comparator family is consistent; only `Function.compose` flips the order.

---

## Bug 10 — Comparing two lambdas with `==`

```java
public final class Subscriptions<T> {
    private final List<Consumer<T>> listeners = new ArrayList<>();

    public void subscribe(Consumer<T> c)   { listeners.add(c); }
    public void unsubscribe(Consumer<T> c) { listeners.remove(c); }
}

// Caller:
var subs = new Subscriptions<String>();
subs.subscribe(s -> System.out.println(s));     // subscribe lambda A
subs.unsubscribe(s -> System.out.println(s));   // try to unsubscribe — won't match
```

**Symptom.** The listener is never removed. `unsubscribe` returns `false`. Heap dump months later shows accumulating `Consumer` instances.

**Violation.** Two textually identical lambdas produce *different* objects (different capture-class instances). `Consumer<T>` does not override `equals`, so `List.remove` falls back to reference equality, which fails.

**Fix 1.** Hold a reference to the registered lambda:

```java
Consumer<String> listener = s -> System.out.println(s);
subs.subscribe(listener);
subs.unsubscribe(listener);   // same instance — removes correctly
```

**Fix 2.** Return a subscription handle that knows how to cancel itself:

```java
public final class Subscriptions<T> {
    private final List<Consumer<T>> listeners = new ArrayList<>();

    public AutoCloseable subscribe(Consumer<T> c) {
        listeners.add(c);
        return () -> listeners.remove(c);
    }
}

// Caller:
try (var sub = subs.subscribe(s -> System.out.println(s))) {
    // ... do work
}   // auto-cancel on close
```

The handle pattern is the standard fix for "I added a lambda and now I can't find the same one to remove" — events, observers, hooks. Whenever you give callers a lambda registration API, give them a way to cancel it back.

---

## Postscript — the underlying theme

Eight of these ten bugs share a single root cause: the lambda **looks** like just code, but it's an *object* with identity, lifetime, captures, and a runtime contract. Most lambda mistakes evaporate the moment you stop treating the lambda as a syntactic shortcut and start treating it as an instance of a functional interface — which is what JLS §15.27.3 says it is.

The other two (Bugs 6 and 9) are knowledge gaps — primitive specializations and `andThen` vs `compose` — that disappear once you have the catalogue from middle.md in your head.

---

## What's next

| Topic                                                              | File              |
|--------------------------------------------------------------------|-------------------|
| Cost analysis and JIT behaviour                                    | `optimize.md`     |
| Hands-on refactors                                                 | `tasks.md`        |
| Interview Q&A                                                      | `interview.md`    |

See also: [../03-reflection-and-annotations/](../03-reflection-and-annotations/) for `SerializedLambda` reflection, [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/) for `invokedynamic` linkage, and [../../../../05-lambda-expressions/](../../../../05-lambda-expressions/) for a deeper lambda chapter.
