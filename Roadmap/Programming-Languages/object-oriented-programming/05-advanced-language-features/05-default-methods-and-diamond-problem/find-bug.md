# Default Methods and the Diamond Problem — Find the Bug

> 10 buggy snippets, each illustrating a silent default-method bug that compiles, looks fine in review, and only bites at runtime, under refactor, or after a JDK upgrade. For each: read the code, decide which resolution rule (or which language constraint) is being broken, identify the *runtime symptom*, and write down the fix.

---

## Bug 1 — A diamond conflict that the author never resolved

```java
public interface Walker {
    default String describe() { return "walks"; }
}
public interface Swimmer {
    default String describe() { return "swims"; }
}

public class Duck implements Walker, Swimmer { }
```

**Symptom.** `Duck.java` fails to compile with a message most newcomers find baffling on first read:

```
error: class Duck inherits unrelated defaults for describe() from types Walker and Swimmer
public class Duck implements Walker, Swimmer { }
       ^
```

The class isn't actually broken at runtime — it never reaches runtime. The compiler refuses to pick a default because neither `Walker` nor `Swimmer` is more specific than the other.

**Violation.** **Rule 3 of the resolution algorithm** (JLS §9.4.1.4) — when two unrelated interfaces supply conflicting defaults and no class method exists, the implementer *must* override and resolve manually.

**Fix.** Override `describe` in `Duck` and pick one (or compose both):

```java
public class Duck implements Walker, Swimmer {
    @Override
    public String describe() {
        return Walker.super.describe() + " and " + Swimmer.super.describe();
    }
}
```

The `InterfaceName.super.method()` syntax is the only way to reach a specific interface's default. Don't just delete `implements Swimmer` to make it compile — the conflict is telling you the design has two roles converging in one class. If that's intentional, resolve it explicitly.

---

## Bug 2 — A class method silently shadows the interface default

```java
public class Logger {
    public String log(String msg) { return "[class] " + msg; }
}
public interface AuditLog {
    default String log(String msg) { return "[audit] " + msg; }
}
public class AuditingLogger extends Logger implements AuditLog { }
```

```java
// The library author who shipped AuditLog assumed every implementor would inherit the audit prefix:
String result = new AuditingLogger().log("hello");
// expected: "[audit] hello"
// actual:   "[class] hello"
```

**Symptom.** No compile error. No runtime error. The audit log silently *doesn't* prefix messages with `[audit]` — instead, `Logger.log` runs. A QA tester notices six weeks later that the audit trail is missing the prefix every other request.

**Violation.** **Rule 1, "classes win"** (JLS §8.4.8). Once `Logger` (a class) supplies `log(String)`, it overrides any interface default with the same signature. The interface ladder is irrelevant.

**Fix.** Either (a) name the default distinctively (`auditLog` rather than `log`), or (b) drop the inheritance from `Logger` and depend on it via composition, or (c) override `log` in `AuditingLogger` to call both:

```java
public class AuditingLogger extends Logger implements AuditLog {
    @Override
    public String log(String msg) {
        return AuditLog.super.log(msg) + " | " + super.log(msg);
    }
}
```

The general lesson: never name an interface default after a method that a plausible parent class might also supply.

---

## Bug 3 — A default that calls itself through `this`

```java
public interface Greeter {
    String name();
    default String greet() { return "Hello, " + name() + "!"; }
    default String greetTwice() { return greet() + " " + greet(); }
}

public class LoudGreeter implements Greeter {
    public String name() { return "Sam"; }
    @Override
    public String greet() { return greetTwice().toUpperCase(); }   // (*)
}
```

**Symptom.** Calling `new LoudGreeter().greetTwice()` produces:

```
java.lang.StackOverflowError
    at LoudGreeter.greet(LoudGreeter.java:5)
    at Greeter.greetTwice(Greeter.java:4)
    at LoudGreeter.greet(LoudGreeter.java:5)
    at Greeter.greetTwice(Greeter.java:4)
    ...
```

**Violation.** The default `greetTwice` calls `greet()` through `this` — dynamic dispatch. The implementor's `greet()` calls `greetTwice()`. Each goes through `invokeinterface`/`invokevirtual` on the same object, producing infinite recursion. The interface default's *call graph* became public API the moment it shipped, and the implementor's override broke the implicit invariant.

**Fix.** Either flatten the default so it doesn't call other defaults through `this`:

```java
default String greetTwice() { return ("Hello, " + name() + "! ").repeat(2).trim(); }
```

Or document `greet` as a *terminal* method that must not call `greetTwice`, ideally with `@implSpec`:

```java
public interface Greeter {
    String name();
    /** @implSpec must not call greetTwice() or recursion will occur. */
    default String greet() { return "Hello, " + name() + "!"; }
    default String greetTwice() { return greet() + " " + greet(); }
}
```

The FBCP-in-interface story (`senior.md` §1): defaults that call other defaults need their call graph documented. Otherwise an "innocent" override breaks the contract.

---

## Bug 4 — Default trying to override `equals`

```java
public interface IdentifiedById {
    long id();

    default boolean equals(Object other) {                           // (*)
        return other instanceof IdentifiedById o && o.id() == id();
    }
    default int hashCode() { return Long.hashCode(id()); }           // (*)
}
```

**Symptom.** Compile error at line `*`:

```
error: default method equals(Object) in interface IdentifiedById
       overrides a member of java.lang.Object
default boolean equals(Object other) {
                ^
```

Same for `hashCode`. The author thought "let me give everyone equals-by-id for free". The compiler refuses.

**Violation.** **JLS §9.4.1.3** — *"It is a compile-time error if a default method has the same signature as a non-private method of `java.lang.Object`."* The forbidden list: `equals`, `hashCode`, `toString`, `getClass`, `notify`, `notifyAll`, `wait` (all overloads).

**Fix.** Pick a different method name and document the convention:

```java
public interface IdentifiedById {
    long id();
    default boolean equalsById(IdentifiedById other) {
        return other != null && other.id() == id();
    }
}
```

Implementors that want id-based equality call `equalsById` from their own `equals` body. The compiler stops "helping" by silently overriding `Object`'s contract, and implementors retain control over what equality means.

---

## Bug 5 — Two unrelated defaults a class inherits and never realises

```java
// Library A — version 1.0
public interface Cleanup {
    default void close() { System.out.println("[cleanup] close"); }
}

// Library B — version 1.0
public interface Closeable {
    default void close() { System.out.println("[closeable] close"); }
}

// Application code — works fine in v1.0 because only one library defined close()
public class Connection implements Cleanup, Closeable { }
```

**Symptom.** Compiles and runs in v1.0 because, in this hypothetical version, only `Cleanup.close()` existed. After upgrading Library B to v1.1 — where `Closeable` *adds* a `default close()` — the application class fails to load:

```
java.lang.IncompatibleClassChangeError: Conflicting default methods: Cleanup.close Closeable.close
    at <generated>.Connection.close()
```

This fires at *runtime*, not at recompile, because `Connection.class` was compiled against v1.0 of Library B (no conflict at the time) and is now linking against v1.1 of Library B (conflict).

**Violation.** **JLS §13.5 binary compatibility.** Adding a default is *individually* binary-compatible, but *by composition* it can introduce a real diamond into downstream classes that never had one. The JVM refuses to silently pick one.

**Fix.** Recompile `Connection` against Library B v1.1 — `javac` will fail and force you to override `close()` explicitly. Until you do, the runtime is correctly refusing to guess.

```java
public class Connection implements Cleanup, Closeable {
    @Override
    public void close() {
        Cleanup.super.close();
        Closeable.super.close();
    }
}
```

This is the *binary-incompatibility-by-composition* hazard discussed in `senior.md` §2. Library authors should announce new defaults in release notes for exactly this reason.

---

## Bug 6 — A default depends on instance state that the subclass changed semantics for

```java
public interface Discountable {
    BigDecimal price();
    default BigDecimal discountedPrice() {
        return price().multiply(new BigDecimal("0.9"));
    }
}

public class Product implements Discountable {
    private final BigDecimal price;
    public Product(BigDecimal p) { this.price = p; }
    public BigDecimal price() { return price; }
}

public class FreeProduct extends Product {
    public FreeProduct() { super(BigDecimal.ZERO); }
    @Override
    public BigDecimal price() { return BigDecimal.ZERO; }   // always 0
    // discountedPrice() inherited: 0 * 0.9 = 0 — happens to be correct
}

public class TaxedProduct extends Product {
    private final BigDecimal taxRate;
    public TaxedProduct(BigDecimal p, BigDecimal taxRate) { super(p); this.taxRate = taxRate; }
    @Override
    public BigDecimal price() {                              // (*)
        return super.price().multiply(BigDecimal.ONE.add(taxRate));
    }
}
```

**Symptom.** A `TaxedProduct(100, 0.20)` returns `price() = 120`. The default `discountedPrice()` returns `120 * 0.9 = 108`. The business expectation was *discount applied to the pre-tax price*: `100 * 0.9 = 90`, then tax of 20% giving `108`. By coincidence the numbers match — but for a `TaxedProduct(100, 0.10)`, expected `99`, actual `99` again coincides. For tiered discounts (e.g., 50% off), the maths diverges and a customer notices.

**Violation.** The default `discountedPrice` *assumed* `price()` returned the pre-discount, pre-tax base. The subclass `TaxedProduct` changed the *semantics* of `price()` without overriding `discountedPrice`. The interface had an *invariant* it never declared — that `price()` is the base price — and the implementor silently broke it.

**Fix.** Either declare the invariant explicitly with `@implSpec` and force `TaxedProduct` to override `discountedPrice`, or restructure so the default doesn't reach through a class-overridable method:

```java
public interface Discountable {
    BigDecimal basePrice();
    BigDecimal price();   // may include tax, etc.
    default BigDecimal discountedPrice() {
        return basePrice().multiply(new BigDecimal("0.9"));
    }
}
```

Now `Product.basePrice()` and `Product.price()` are distinct abstract methods; the default depends on the well-defined one. The implementor can no longer surprise the default by changing semantics behind its back.

---

## Bug 7 — A default captures `this` in a lambda and leaks the implementor

```java
public interface EventSource<E> {
    void onEvent(Consumer<E> handler);

    default void forEachAsync(Consumer<E> handler, Executor exec) {
        onEvent(e -> exec.execute(() -> handler.accept(e)));   // (*)
    }
}

public class TemporaryListener implements EventSource<Order> {
    private final List<Order> seen = new ArrayList<>();
    public void onEvent(Consumer<Order> handler) { /* register */ }
}

// Caller code:
TemporaryListener l = new TemporaryListener();
l.forEachAsync(order -> log(order), workQueue);
l = null;     // we're done with it
// ... but workQueue is long-lived, and the lambda captured `this` of l ...
```

**Symptom.** A heap dump after the application has been running for hours shows thousands of `TemporaryListener` instances retained by `workQueue`'s pending task list. The application's memory grows linearly. The `seen` `ArrayList` inside each listener grows too, because event registration is still happening through the captured `this` reference.

**Violation.** The default `forEachAsync` builds a lambda that captures `this` (because the outer lambda body calls `onEvent` implicitly through `this.onEvent`). Implementors don't realise that calling `forEachAsync` *pins* `this` until the lambda is no longer reachable.

**Fix.** Either make the lambda capture a local reference and document it, or hoist the capture into a method parameter:

```java
default void forEachAsync(Consumer<E> handler, Executor exec) {
    Consumer<E> dispatch = handler;     // local — doesn't change capture set
    onEvent(e -> exec.execute(() -> dispatch.accept(e)));
}
```

This rewrite doesn't actually fix the `this` capture — the call to `onEvent` still uses `this`. The genuine fix is to avoid the inner lambda needing `this` at all:

```java
public interface EventSource<E> {
    void register(Consumer<E> handler);

    static <E> Consumer<E> async(Consumer<E> handler, Executor exec) {
        return e -> exec.execute(() -> handler.accept(e));
    }
}

// Caller:
l.register(EventSource.async(order -> log(order), workQueue));
```

Moving the async-wrapping logic out of the default and into a `static` helper kills the implicit `this` capture. The implementor's lifecycle is now under the caller's control. Defaults that capture `this` in lambdas they pass to long-lived collaborators are a recurring memory-leak shape.

---

## Bug 8 — A record component silently shadows the default

```java
public interface Identifiable {
    default String id() { return "default-id-" + System.identityHashCode(this); }
    default String describe() { return "Item " + id(); }
}

public record Order(String id, BigDecimal amount) implements Identifiable { }
```

```java
new Order(null, BigDecimal.TEN).describe();
// expected (per the interface design): "Item default-id-<hash>"
// actual:                              "Item null"
```

**Symptom.** A test that exercises a `null`-id `Order` returns `"Item null"`. The interface designer intended the default to *back-fill* a generated id for items without one. The record's component accessor silently shadowed the default.

**Violation.** **Rule 1, "classes win"** — `senior.md` §4. The record's implicit `String id()` accessor is a class method, so it overrides any same-named interface default. The default was never reached; `id()` simply returned the null field value.

**Fix.** Name the default distinctively, so it isn't shadowed by record components:

```java
public interface Identifiable {
    default String displayId() { return id() == null ? "default-id-" + System.identityHashCode(this) : id(); }
    String id();   // abstract — implementor must supply or use default in displayId
    default String describe() { return "Item " + displayId(); }
}
```

Now records implementing `Identifiable` can carry an `id` component without breaking the default's intent. The display logic lives in a method records can't accidentally shadow.

---

## Bug 9 — Trying to call a private interface helper from outside

```java
public interface Maths {
    private static int safeMul(int a, int b) {
        long r = (long) a * b;
        if (r < Integer.MIN_VALUE || r > Integer.MAX_VALUE) throw new ArithmeticException();
        return (int) r;
    }
    default int squareSafely(int x) { return safeMul(x, x); }
}

public class Calc implements Maths {
    public int cubeSafely(int x) {
        return Maths.safeMul(x, squareSafely(x));   // (*)
    }
}
```

**Symptom.** Compile error at line `*`:

```
error: safeMul(int, int) has private access in Maths
return Maths.safeMul(x, squareSafely(x));
            ^
```

The implementor expected `Maths.safeMul` to be callable as a "shared utility". It is not — `private` interface methods are only callable from inside the *same interface*.

**Violation.** **JEP 213** — `private` interface methods exist for factoring helpers out of `default` and `static` methods on the same interface. They are not inherited by implementor classes and they are not visible to sub-interfaces.

**Fix.** Either expose the helper as a `public static`:

```java
public interface Maths {
    static int safeMul(int a, int b) {
        long r = (long) a * b;
        if (r < Integer.MIN_VALUE || r > Integer.MAX_VALUE) throw new ArithmeticException();
        return (int) r;
    }
}
```

Or — more honestly — move it to a separate utility class:

```java
final class MathOps {
    static int safeMul(int a, int b) { /* ... */ }
}
```

The general rule: `private` interface methods are for *internal factoring of default-method logic*. They are not a public utility namespace. If you want one, make it a `public static` interface method or a utility class.

---

## Bug 10 — A static interface method called as an instance method

```java
public interface Validator<T> {
    static <T> Validator<T> always() { return x -> true; }
    static <T> Validator<T> never()  { return x -> false; }
    boolean isValid(T x);
}

public class FormValidator implements Validator<Form> {
    public boolean isValid(Form f) { return f.email() != null; }

    public Validator<Form> orAlways() {
        return this.always();      // (*)
    }
}
```

**Symptom.** Compile error at line `*`:

```
error: cannot make a static reference to the non-static method always() from the type Validator<Form>
return this.always();
            ^
```

The developer expected `this.always()` to be valid — they assumed `static` interface methods are inherited like defaults. They are not.

**Violation.** **JLS §9.4** — static interface methods are not inherited by implementor classes and cannot be called through an instance reference. They are namespace-qualified: `Interface.method(...)`.

**Fix.** Call the static method through the interface name:

```java
public Validator<Form> orAlways() {
    return Validator.always();
}
```

This rule frequently catches developers who came from C++ or pre-Java-8 backgrounds where `static` and `default` are easily confused. In Java they have *different inheritance semantics on interfaces*: `default` is inherited and polymorphic; `static` is not inherited and is namespace-scoped.

---

## Pattern summary

| Bug type                                                | What to look for                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Unresolved diamond (Bug 1)                              | Compile error citing two interfaces for one method                        |
| Class-method shadowing (Bugs 2, 6)                      | Class method with same signature as interface default                     |
| Object-method override attempt (Bug 4)                  | `default` declaring `equals`/`hashCode`/`toString`                        |
| Default call-graph fragility (Bugs 3, 7)                | Defaults calling defaults; lambdas inside defaults                        |
| Binary-incompat by composition (Bug 5)                  | `IncompatibleClassChangeError` at runtime after library upgrade           |
| Record-component shadowing (Bug 8)                      | Default named like a plausible record field (`id`, `name`, `value`)       |
| Private-interface-method misuse (Bug 9)                 | Call to `Interface.privateHelper` from outside the interface              |
| Static-vs-default confusion (Bug 10)                    | `this.staticMethod()` or attempted inheritance of `static` interface methods |

These bugs rarely produce immediate failures. They surface during library upgrades, refactors, when records are introduced, or in heap dumps weeks after deployment. The compiler enforces the language-level rules (Bugs 1, 4, 9, 10); the runtime catches the binary-compat surprises (Bug 5); everything else is contract drift that only your tests — or your production users — will detect.
