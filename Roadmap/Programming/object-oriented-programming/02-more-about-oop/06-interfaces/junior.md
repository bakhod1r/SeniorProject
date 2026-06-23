# Interfaces — Junior

> **What?** An *interface* in Java is a reference type that declares a contract — a set of methods (and possibly default implementations) that a class can choose to *implement*. Interfaces enable multiple inheritance of *type*, polymorphism, and decoupling between callers and implementations.
> **How?** Use the `interface` keyword to declare. Use `implements` on a class to commit to providing the methods. A class can implement many interfaces.

---

## 1. The simplest interface

```java
public interface Greeter {
    String greet(String name);
}

public class FormalGreeter implements Greeter {
    @Override
    public String greet(String name) {
        return "Good day, " + name + ".";
    }
}

Greeter g = new FormalGreeter();
System.out.println(g.greet("Alice"));    // Good day, Alice.
```

`Greeter` is a *type* — variables can be declared of type `Greeter`. The class `FormalGreeter` *implements* `Greeter` by providing a body for `greet`. Any code that depends on `Greeter` works with `FormalGreeter`, or with any future implementation, with no changes.

---

## 2. Interface vs class — the differences

| Feature                  | Interface                       | Class                          |
|--------------------------|---------------------------------|--------------------------------|
| Instance fields          | No                              | Yes                            |
| Constructors             | No                              | Yes                            |
| Multiple inheritance     | Yes (`implements A, B, C`)      | No (single `extends`)         |
| Default method bodies    | Yes (since Java 8)              | n/a                            |
| Static methods           | Yes (since Java 8)              | Yes                            |
| `private` methods        | Yes (since Java 9)              | Yes                            |
| `final`                  | Cannot be `final`               | Can be `final`                 |
| `abstract`               | Implicitly abstract             | Explicitly with `abstract`     |

The key constraint: **interfaces have no instance state**. They describe behavior, not data.

---

## 3. Multiple interfaces

A class can implement many:

```java
public class Dog implements Animal, Trainable, Walker { ... }
```

Each interface contributes a *role* the class can play. Code that takes `Animal` can use any animal; code that takes `Trainable` can train any trainable thing; the class participates in all of them.

This is multiple inheritance of *type*, not state. Java's answer to the diamond problem.

---

## 4. Default methods (Java 8+)

```java
public interface Greeter {
    String greet(String name);
    default String greetWorld() { return greet("World"); }
}
```

`greetWorld()` has a body. Implementing classes inherit it unless they override. This lets you add new methods to interfaces without breaking existing implementations — backwards compatibility while evolving APIs.

```java
public class FormalGreeter implements Greeter {
    public String greet(String name) { return "Good day, " + name; }
    // greetWorld inherited from Greeter
}
```

---

## 5. Static methods on interfaces (Java 8+)

```java
public interface Comparator<T> {
    int compare(T a, T b);
    static <T extends Comparable<T>> Comparator<T> naturalOrder() {
        return Comparable::compareTo;
    }
}

Comparator<String> c = Comparator.naturalOrder();
```

Static methods on interfaces are scoped to the interface. They're useful for factory methods or utilities that "belong" with the type.

---

## 6. Constants in interfaces

```java
public interface Limits {
    int MAX_USERS = 100;     // implicitly public static final
}
```

All fields in an interface are implicitly `public static final`. They're constants. This was historically used for "constant interfaces," but Effective Java Item 22 advises against it — use enums or final classes for constants instead.

---

## 7. Functional interfaces

A *functional interface* has exactly one abstract method (SAM = single abstract method). Lambdas and method references can implement them:

```java
@FunctionalInterface
public interface Predicate<T> {
    boolean test(T t);
}

Predicate<String> isEmpty = s -> s.isEmpty();
Predicate<String> isLong = s -> s.length() > 100;
```

The `@FunctionalInterface` annotation isn't strictly required but tells the compiler "I intend exactly one abstract method" — it'll error if you accidentally add a second.

The JDK has many built-in functional interfaces in `java.util.function`: `Function`, `Predicate`, `Consumer`, `Supplier`, `BiFunction`, etc.

---

## 8. Implementing multiple interfaces

```java
public interface Walker { void walk(); }
public interface Swimmer { void swim(); }
public interface Flyer { void fly(); }

public class Duck implements Walker, Swimmer, Flyer {
    public void walk() { ... }
    public void swim() { ... }
    public void fly() { ... }
}
```

Now `Duck` is-a `Walker`, is-a `Swimmer`, is-a `Flyer`. Code that takes any of them can accept a `Duck`.

---

## 9. Interfaces vs abstract classes

| Use                           | Choose                |
|-------------------------------|-----------------------|
| Describe a capability/contract| Interface             |
| Multiple unrelated impls       | Interface             |
| Need shared state             | Abstract class        |
| Need shared template logic    | Abstract class        |
| Need to enforce constructor   | Abstract class        |
| Want lambda-friendly          | Functional interface  |

Default to interfaces. Switch to abstract classes only when you genuinely need shared state.

---

## 10. Inheritance among interfaces

Interfaces can extend other interfaces:

```java
public interface Animal { void breathe(); }
public interface Predator extends Animal { void hunt(); }

class Lion implements Predator {
    public void breathe() { ... }
    public void hunt() { ... }
}
```

A class implementing `Predator` must implement everything from `Predator` and its parent interfaces.

An interface can extend multiple others:

```java
public interface Amphibian extends Walker, Swimmer { }
```

---

## 11. The `implements` keyword

```java
public class Foo implements Bar, Baz extends Parent { ... }   // ERROR — wrong order
public class Foo extends Parent implements Bar, Baz { ... }   // OK
```

`extends` (single class) comes before `implements` (multiple interfaces).

---

## 12. Common newcomer mistakes

**Mistake 1: forgetting to implement all methods**

```java
public interface Drawable { void draw(); }
public class Circle implements Drawable { /* nothing */ }    // ERROR
```

The compiler requires `Circle` to either implement `draw()` or be `abstract`.

**Mistake 2: trying to add fields**

```java
public interface Shape {
    int sides;     // ERROR — interfaces can't have instance fields
}
```

You can declare `int sides = 3;` (which becomes `public static final int sides = 3` — a constant) but not a per-instance field.

**Mistake 3: trying to make instance methods `static`**

```java
public interface Counter {
    static void inc();    // ERROR — static methods need a body
}
```

Static interface methods must have a body. There's no such thing as a "static abstract" method on an interface.

**Mistake 4: marking interface methods `public`**

```java
public interface X {
    public void m();    // redundant — interface methods are implicitly public
}
```

Not an error, just unnecessary. All interface methods are public unless explicitly `private` (Java 9+).

---

## 13. When to use an interface

- Multiple classes need the same capability (Runnable, Comparable, AutoCloseable).
- You want to enable lambda implementations of single-method types.
- You want to abstract over implementations (List, Map, Set).
- You're building a plugin architecture.
- You want decoupling for testability.

## 14. When NOT to use an interface

- The class has only one implementation and won't have more.
- You need shared state (use a class).
- Just to "follow a pattern" — gratuitous interfaces add noise.

---

## 15. What's next

| Question                             | File              |
|--------------------------------------|-------------------|
| Default methods + diamond conflicts  | `middle.md`        |
| Functional interfaces, lambdas       | `middle.md`        |
| Interface dispatch internals         | `senior.md`        |
| Bytecode of interface method calls   | `professional.md`  |
| JLS rules                            | `specification.md` |

---

**Memorize this**: an interface is a contract. Use it for capabilities (`Comparable`, `AutoCloseable`), for plug-in points, and for lambda-friendly single-method types. Default to interfaces over abstract classes. Don't use them for state — that's what classes are for.
