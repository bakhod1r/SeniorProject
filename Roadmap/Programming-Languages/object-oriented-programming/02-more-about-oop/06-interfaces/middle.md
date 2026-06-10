# Interfaces — Middle

> **What?** Default methods, diamond conflict resolution, functional interfaces and SAM types, sealed interfaces, marker interfaces, and the design choices around interface evolution.
> **How?** By understanding the rules the compiler follows when interfaces conflict, the conventions for designing functional and sealed interfaces, and the patterns that emerge from "interface-first" design.

---

## 1. Default methods — what they solve

Before Java 8, adding a method to an interface broke every existing implementation. Default methods let you add evolveable methods with safe defaults:

```java
public interface Stream<T> {
    Iterator<T> iterator();
    default long count() {
        long n = 0;
        for (var it = iterator(); it.hasNext(); it.next()) n++;
        return n;
    }
}
```

Old implementations get the default `count()` automatically. New ones can override for efficiency.

This is what allowed Java to add `forEach`, `stream`, `removeIf`, etc., to `Collection` without breaking backward compatibility.

---

## 2. The diamond problem with defaults

Two interfaces, conflicting defaults:

```java
interface A { default String m() { return "A"; } }
interface B { default String m() { return "B"; } }

class C implements A, B { }    // ERROR: inherits unrelated defaults
```

Java requires explicit resolution:

```java
class C implements A, B {
    @Override
    public String m() {
        return A.super.m();         // pick one
    }
}
```

Or compose:
```java
public String m() { return A.super.m() + " / " + B.super.m(); }
```

This is Java's answer to the diamond problem in multiple inheritance — force explicit choice.

---

## 3. Resolution rules (recap)

When a class inherits methods with the same signature:

1. **Class wins over interface.** If a method comes from a superclass chain, it wins.
2. **More specific interface wins.** Among interfaces, the one further down the inheritance chain wins.
3. **Otherwise, ambiguous.** Class must override and disambiguate.

```java
interface A { default String m() { return "A"; } }
interface B extends A { default String m() { return "B"; } }
class C implements A, B { }    // OK — B is more specific
```

`C.m()` returns "B" because B is a sub-interface of A.

---

## 4. Functional interfaces

A functional interface has exactly one abstract method. Lambdas and method references can implement them:

```java
@FunctionalInterface
interface Validator<T> {
    boolean validate(T t);

    default Validator<T> and(Validator<T> other) {
        return t -> validate(t) && other.validate(t);
    }

    default Validator<T> or(Validator<T> other) {
        return t -> validate(t) || other.validate(t);
    }
}
```

The interface has one abstract method (`validate`) and any number of default/static methods. Default methods can compose, providing fluent combinators.

The `@FunctionalInterface` annotation is enforcement: the compiler errors if you add a second abstract method.

---

## 5. The JDK's functional interfaces

Located in `java.util.function`:

| Interface          | Signature                | Use case            |
|--------------------|--------------------------|---------------------|
| `Function<T, R>`   | `R apply(T)`             | Transform           |
| `BiFunction<T,U,R>`| `R apply(T, U)`          | Two-arg transform   |
| `Predicate<T>`     | `boolean test(T)`        | Filter              |
| `Consumer<T>`      | `void accept(T)`         | Side effect         |
| `Supplier<T>`      | `T get()`                | Produce             |
| `UnaryOperator<T>` | `T apply(T)`             | T → T               |
| `BinaryOperator<T>`| `T apply(T, T)`          | T × T → T           |

Plus primitive specializations: `IntFunction`, `IntPredicate`, `IntToLongFunction`, etc., to avoid boxing.

---

## 6. Sealed interfaces

```java
public sealed interface Result<T> permits Success<T>, Failure<T> { }
public record Success<T>(T value) implements Result<T> { }
public record Failure<T>(String error) implements Result<T> { }
```

The set of implementations is closed. Combined with pattern-matching switch, you get exhaustiveness:

```java
String describe(Result<?> r) {
    return switch (r) {
        case Success<?> s -> "ok: " + s.value();
        case Failure<?> f -> "err: " + f.error();
    };   // compiler verifies exhaustive
}
```

Adding a new permitted variant forces every switch to update.

---

## 7. Marker interfaces

A marker interface has no methods; its presence on a class signals something:

```java
public interface Serializable { }
public interface Cloneable { }
```

Java has historically used these to enable JVM features (serialization, cloning). Modern Java prefers annotations:

```java
@Serializable
public class Foo { }   // hypothetical
```

Annotations are more flexible (parameterizable, runtime introspectable). Marker interfaces are still around but new uses are rare.

---

## 8. Tag interfaces (informal)

A tag interface groups types but doesn't define behavior:

```java
public interface DomainEvent { }
public class UserCreated implements DomainEvent { ... }
public class OrderShipped implements DomainEvent { ... }
```

Useful for reflection (`if (event instanceof DomainEvent)`) or for collections (`List<DomainEvent>`). Modern alternative: sealed interfaces, which give you exhaustive matching.

---

## 9. Adapter pattern with interfaces

Two interfaces that "should be the same":

```java
public interface OldApi { void doThing(String input); }
public interface NewApi { void execute(Request req); }

public class Adapter implements NewApi {
    private final OldApi old;
    public Adapter(OldApi o) { this.old = o; }
    public void execute(Request req) { old.doThing(req.input()); }
}
```

`Adapter` makes an `OldApi` look like a `NewApi`. Common for bridging libraries.

---

## 10. Interface segregation (ISP)

Don't force clients to depend on methods they don't use. Split fat interfaces:

```java
// FAT — every implementation must support all of these
interface UserManager {
    User create(NewUser);
    void delete(long);
    List<User> search(SearchCriteria);
    void importCsv(InputStream);
    String exportJson();
    void notify(long, String);
}

// SEGREGATED
interface UserRepository { User create(NewUser); void delete(long); List<User> search(SearchCriteria); }
interface UserImporter { void importCsv(InputStream); }
interface UserExporter { String exportJson(); }
interface UserNotifier { void notify(long, String); }
```

Implementations pick which roles to play. Mocks are smaller. Code is more focused.

---

## 11. Constants in interfaces — the anti-pattern

Effective Java Item 22 warns against the "constant interface anti-pattern":

```java
public interface PhysicalConstants {
    double SPEED_OF_LIGHT = 299_792_458;
    double GRAVITY = 9.81;
}

public class Calculator implements PhysicalConstants { }   // BAD
```

The class now has these constants in its public API by virtue of `implements`. They become part of the contract.

Better: put constants in a final utility class (or a record):

```java
public final class PhysicalConstants {
    private PhysicalConstants() {}
    public static final double SPEED_OF_LIGHT = 299_792_458;
    public static final double GRAVITY = 9.81;
}
```

---

## 12. Mixin via interface defaults

```java
public interface Loggable {
    default void log(String message) {
        System.out.println(getClass().getSimpleName() + ": " + message);
    }
}

public class Service implements Loggable {
    public void doWork() {
        log("starting");        // inherited from Loggable
    }
}
```

This is a "mixin" — adding behavior across unrelated classes without inheritance. Use sparingly; over-mixin pollutes the API surface.

---

## 13. Sealed interface with records

A common modern Java pattern:

```java
public sealed interface Expr permits Num, Add, Mul, Neg { }
public record Num(double v) implements Expr { }
public record Add(Expr l, Expr r) implements Expr { }
public record Mul(Expr l, Expr r) implements Expr { }
public record Neg(Expr e) implements Expr { }

double eval(Expr e) {
    return switch (e) {
        case Num n -> n.v();
        case Add(Expr l, Expr r) -> eval(l) + eval(r);
        case Mul(Expr l, Expr r) -> eval(l) * eval(r);
        case Neg(Expr inner) -> -eval(inner);
    };
}
```

This is *algebraic data types* in Java. Type-safe, exhaustive, immutable.

---

## 14. Interface evolution checklist

When you need to add a method to an existing interface:

- [ ] Can it be a default method with a sensible default?
- [ ] If not, is it on a sealed interface where you control all impls?
- [ ] If you have to break existing impls, is there a deprecation path (deprecate old method, add new one, remove later)?
- [ ] Are there third-party impls that will break?

Default methods + sealed interfaces give you strong evolution guarantees. Open interfaces are evolution-fragile.

---

## 15. What's next

| Topic                                | File              |
|--------------------------------------|-------------------|
| JIT view, inline caches, dispatch    | `senior.md`        |
| Bytecode of interface methods        | `professional.md`  |
| JLS rules on interfaces              | `specification.md` |
| Common interface bugs                | `find-bug.md`      |

---

**Memorize this**: interfaces describe contracts; default methods enable evolution; sealed interfaces close the hierarchy; functional interfaces enable lambdas. Use ISP to split fat interfaces. Use sealed + records for algebraic types. Don't put constants in interfaces.
