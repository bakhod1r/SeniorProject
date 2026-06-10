# Interfaces — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong because of an interface design or usage mistake.

---

## Bug 1 — Default method conflict ignored

```java
interface X { default String m() { return "X"; } }
interface Y { default String m() { return "Y"; } }
class Z implements X, Y { }
```

**Why?** Compile error: "class Z inherits unrelated defaults for m()."

**Fix:** override and disambiguate:
```java
class Z implements X, Y {
    @Override public String m() { return X.super.m(); }
}
```

---

## Bug 2 — Constants in interface used as inheritance

```java
public interface PhysicalConstants {
    double SPEED_OF_LIGHT = 299_792_458;
}

public class Calculator implements PhysicalConstants { /* uses SPEED_OF_LIGHT */ }
```

**Why?** "Constant interface anti-pattern" (Effective Java Item 22). The constants leak into Calculator's public API forever.

**Fix:** put constants in a final utility class:
```java
public final class PhysicalConstants {
    private PhysicalConstants() {}
    public static final double SPEED_OF_LIGHT = 299_792_458;
}
```

---

## Bug 3 — Marker interface + reflection

```java
public interface Cacheable { }   // no methods

public class CacheService {
    public void put(Object o) {
        if (o.getClass().isAssignableFrom(Cacheable.class)) {
            // ...
        }
    }
}
```

**Why?** `isAssignableFrom` is the wrong direction. Should be `Cacheable.class.isAssignableFrom(o.getClass())` or simply `o instanceof Cacheable`.

**Fix:**
```java
if (o instanceof Cacheable) { ... }
```

---

## Bug 4 — Functional interface with second abstract method

```java
@FunctionalInterface
public interface Validator<T> {
    boolean validate(T t);
    boolean isValid(T t);    // !! @FunctionalInterface error
}
```

**Why?** `@FunctionalInterface` requires exactly one abstract method.

**Fix:** make one a default, or remove `@FunctionalInterface`:
```java
@FunctionalInterface
public interface Validator<T> {
    boolean validate(T t);
    default boolean isValid(T t) { return validate(t); }
}
```

---

## Bug 5 — Sealed switch without exhaustiveness

```java
sealed interface Shape permits Circle, Square, Triangle { }

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.s() * sq.s();
        default -> 0.0;
    };
}
```

**Why?** Adding a default defeats exhaustiveness. New permitted variants won't be caught.

**Fix:** remove `default`. Compiler will force coverage.

---

## Bug 6 — Listener leak via interface

```java
EventBus bus = ...;
bus.addListener(event -> handle(event));
// listener captures `this`; reference held forever
```

**Why?** Listener lambda captures `this` from the enclosing instance. Bus holds the lambda → holds enclosing → leak.

**Fix:** use a static method reference, or unsubscribe on cleanup:
```java
bus.addListener(MyClass::staticHandler);
// or
this.subscription = bus.addListener(this::handle);
... cleanup: subscription.unsubscribe();
```

---

## Bug 7 — `instanceof` chain instead of polymorphism

```java
public double area(Shape s) {
    if (s instanceof Circle) return Math.PI * ((Circle) s).r() * ((Circle) s).r();
    if (s instanceof Square) return ((Square) s).s() * ((Square) s).s();
    throw new IllegalArgumentException();
}
```

**Why?** Each new shape requires updating this method. Open-closed principle violation.

**Fix:** add `area()` as an abstract method on `Shape`:
```java
public sealed interface Shape permits Circle, Square {
    double area();
}
```

Or sealed + pattern matching for closed sets.

---

## Bug 8 — Default method overrides inherited concrete method

```java
class Base { public String name() { return "Base"; } }
interface Named { default String name() { return "Named"; } }
class Sub extends Base implements Named { }

new Sub().name();   // ?
```

**Why?** Class wins over interface. Output: "Base". May surprise readers who expect the default to apply.

**Fix:** if you want the default, override explicitly:
```java
class Sub extends Base implements Named {
    @Override public String name() { return Named.super.name(); }
}
```

---

## Bug 9 — Mutable input to interface

```java
public interface UserList {
    List<User> users();
}
public class UserListImpl implements UserList {
    private List<User> users = new ArrayList<>();
    public List<User> users() { return users; }     // !! returns mutable
}
```

**Why?** Caller can mutate the returned list, modifying internal state.

**Fix:** return `List.copyOf(users)` or `Collections.unmodifiableList(users)`.

---

## Bug 10 — Abstract method on interface that should be default

```java
public interface DefaultPolicy {
    int retries();
    int timeoutMs();
}
public class MyPolicy implements DefaultPolicy {
    public int retries() { return 3; }
    public int timeoutMs() { return 5000; }
}

// Every impl must define both, even if defaults would work
```

**Why?** Forcing implementations when defaults would suffice. Adding a new method breaks every impl.

**Fix:** provide defaults:
```java
public interface DefaultPolicy {
    default int retries() { return 3; }
    default int timeoutMs() { return 5000; }
}
```

Implementations only override what they need.

---

## Bug 11 — Using interface for namespacing

```java
public interface Constants {
    String API_URL = "https://api.example.com";
    int MAX_RETRIES = 3;
}
```

**Why?** Constants in interfaces are technically valid but anti-pattern. They appear in subclass autocomplete, are part of the implementing class's public API, etc.

**Fix:** use a final utility class with private constructor.

---

## Bug 12 — Large fat interface

```java
public interface UserManager {
    User create(NewUser);
    User read(long);
    void update(User);
    void delete(long);
    List<User> search(SearchCriteria);
    void importCsv(InputStream);
    String exportJson();
    void notify(long, String);
    Statistics stats();
    void resetAll();
}
```

**Why?** Violates Interface Segregation Principle. Every implementer must support all 10 methods. Mocking is huge.

**Fix:** split by role:
```java
interface UserCrud { User create; User read; void update; void delete; }
interface UserSearch { List<User> search(...); }
interface UserImporter { void importCsv(...); }
// etc.
```

Compose where multi-role is needed.

---

## Pattern recap

| Bug | Family                              | Cure                                   |
|-----|-------------------------------------|----------------------------------------|
| 1   | Default-method diamond               | Override + super calls                 |
| 2   | Constant interface anti-pattern      | Final utility class                    |
| 3   | Wrong direction `isAssignableFrom`   | `instanceof`                           |
| 4   | Second abstract method               | Make default or remove annotation      |
| 5   | Default in sealed switch             | Remove default                         |
| 6   | Listener captures outer              | Static ref or explicit unsubscribe     |
| 7   | `instanceof` chain                   | Polymorphism or sealed + pattern       |
| 8   | Class shadows interface default      | Explicit override calling `super`      |
| 9   | Mutable list returned                | `List.copyOf` / unmodifiable           |
| 10  | All abstract no defaults             | Add sensible defaults                  |
| 11  | Constants in interface               | Final utility class                    |
| 12  | Fat interface                        | Split by role (ISP)                    |

---

**Memorize the shapes**: most interface bugs are about (a) *forgetting* to disambiguate diamond conflicts, (b) *misusing* interfaces for namespacing/constants, (c) *not using* sealed types/pattern matching for closed hierarchies, or (d) *fat interfaces* violating ISP. Use the modern toolkit.
