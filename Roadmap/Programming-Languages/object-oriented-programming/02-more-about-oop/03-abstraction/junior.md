# Abstraction — Junior

> **What?** *Abstraction* is the act of hiding *how* something is done and exposing only *what* it does. In Java, the main tools for expressing abstraction are **abstract classes** (the `abstract` keyword), **interfaces**, and the public-vs-private boundary.
> **How?** Define a *contract* (abstract methods, interface methods) that callers depend on, while keeping the *implementation* private and replaceable.

---

## 1. The mental model

Abstraction = **separating interface from implementation**.

When you call `list.add("hi")`, you don't know (and shouldn't care) whether it's an `ArrayList`, `LinkedList`, or `CopyOnWriteArrayList`. You only know the *contract*: "this collection accepts an element."

Abstraction is the technique that makes that ignorance possible.

```java
List<String> names = new ArrayList<>();    // implementation chosen
names.add("Alice");                        // abstract contract used
```

The variable's type (`List<String>`) is the abstraction; the constructor (`new ArrayList<>()`) is the concrete implementation.

---

## 2. Abstract classes

A class declared `abstract` cannot be instantiated and may declare *abstract methods* — methods without bodies that subclasses must implement.

```java
abstract class Shape {
    abstract double area();           // no body — subclass must provide
    public String describe() {        // concrete method — uses area()
        return "shape with area " + area();
    }
}

class Circle extends Shape {
    private final double r;
    Circle(double r) { this.r = r; }
    @Override double area() { return Math.PI * r * r; }
}

class Square extends Shape {
    private final double s;
    Square(double s) { this.s = s; }
    @Override double area() { return s * s; }
}
```

You can't write `new Shape()` — only `new Circle(5)` or `new Square(3)`. Each subclass provides its own `area()`. The `describe()` method is concrete and works for all subclasses by polymorphic dispatch.

---

## 3. Interfaces

An interface is a *pure abstraction*: no state (no instance fields), only method signatures (and possibly default implementations).

```java
interface Drawable {
    void draw();                                   // abstract
    default void drawDouble() { draw(); draw(); } // default method (Java 8+)
}

class Circle implements Drawable {
    @Override public void draw() {
        System.out.println("circle drawn");
    }
}
```

A class can implement many interfaces (multiple inheritance of *type*, but not state). This is Java's main answer to abstraction.

---

## 4. Abstract class vs interface

| Question                          | Abstract class | Interface       |
|-----------------------------------|----------------|-----------------|
| Can have instance fields?         | Yes            | No              |
| Can have constructors?            | Yes            | No              |
| Multiple inheritance?             | One per class  | Many per class  |
| Default method implementations?   | Yes            | Yes (since Java 8) |
| Static methods?                   | Yes            | Yes (since Java 8) |
| Best for…                         | Shared state + behavior | Capabilities, contracts |

**Rule of thumb**: start with an interface. Only switch to an abstract class when you have meaningful shared state to factor out.

---

## 5. Why abstraction matters

**Decoupling.** Callers depend on the *contract*, not the *implementation*. You can swap implementations without changing callers.

```java
// caller depends on List
void process(List<String> items) { /* ... */ }

process(new ArrayList<>(...));    // works
process(new LinkedList<>(...));   // also works
process(List.of("a", "b"));        // also works (immutable list)
```

**Testability.** Replace real dependencies with mocks/stubs in tests.

```java
interface Mailer { void send(String to, String subject); }

class TestMailer implements Mailer {
    final List<String> sent = new ArrayList<>();
    public void send(String to, String subject) {
        sent.add(to + ": " + subject);
    }
}
```

**Evolution.** Improve the implementation without breaking callers.

---

## 6. Hiding implementation behind methods

Even within a single class, abstraction means "the public API tells you *what*, not *how*."

```java
public class Counter {
    private int n;                          // implementation detail
    public void increment() { n++; }        // public API
    public int value() { return n; }
}
```

Tomorrow you might switch to `AtomicInteger` for thread safety:

```java
public class Counter {
    private final AtomicInteger n = new AtomicInteger();
    public void increment() { n.incrementAndGet(); }
    public int value() { return n.get(); }
}
```

The public API didn't change. Callers don't know or care that the storage flipped.

---

## 7. Programming to an interface, not an implementation

**Wrong:**
```java
ArrayList<String> names = new ArrayList<>();
ArrayList<String> filtered = filterStartsWith(names, "A");

ArrayList<String> filterStartsWith(ArrayList<String> in, String prefix) { /* ... */ }
```

**Right:**
```java
List<String> names = new ArrayList<>();
List<String> filtered = filterStartsWith(names, "A");

List<String> filterStartsWith(List<String> in, String prefix) { /* ... */ }
```

The `List` version accepts any list and is testable with `List.of(...)`. The `ArrayList` version forces callers to use `ArrayList` specifically.

---

## 8. The `abstract` modifier

Where it can appear:

| On a class    | Class can't be instantiated. May have abstract methods. |
|---------------|----------------------------------------------------------|
| On a method   | Method has no body. Class must be abstract.             |
| On a field    | **Not allowed.** Fields aren't abstract.                |

You also can't combine `abstract` with `final`, `private`, or `static`:

- `abstract final` — contradictory (you can't both extend and forbid extension).
- `abstract private` — contradictory (subclasses can't see private).
- `abstract static` — contradictory (statics aren't dispatched polymorphically).

---

## 9. A simple template-method example

A classic use of abstract classes is the "template method" pattern: the parent defines the algorithm; subclasses fill in steps.

```java
abstract class HttpHandler {
    public final void handle(Request r) {       // template — final, callers always use this
        validate(r);
        Response resp = process(r);
        log(resp);
    }
    protected abstract Response process(Request r);
    protected void validate(Request r) { /* default */ }
    protected void log(Response r) { /* default */ }
}

class UserHandler extends HttpHandler {
    @Override protected Response process(Request r) {
        return new Response("user: " + r.userId());
    }
}
```

The template (`handle`) is the algorithm. The hooks (`process`, `validate`, `log`) are extension points.

---

## 10. Encapsulation vs abstraction

These are related but distinct:

- **Encapsulation** is about **hiding internal state** (using `private` fields, controlled mutation through methods).
- **Abstraction** is about **hiding implementation choices** (using interfaces, abstract classes, well-designed APIs).

In practice, both serve the same goal: make the *public surface* small, stable, and meaningful.

---

## 11. Common newcomer mistakes

**Mistake 1: making everything an interface "for testability."**

```java
interface User { String name(); int age(); }
class UserImpl implements User { /* ... */ }
```

If `User` has no real abstraction — just data — make it a record. Don't conflate "interface" with "abstraction."

**Mistake 2: leaking implementation details through the API.**

```java
public class Cache {
    public HashMap<String, X> data = new HashMap<>();   // exposes mutability + impl type
}
```

Better:
```java
public class Cache {
    private final Map<String, X> data = new HashMap<>();
    public X get(String k) { return data.get(k); }
    public void put(String k, X v) { data.put(k, v); }
}
```

**Mistake 3: abstract classes with no abstract methods.**

```java
abstract class Helper { ... }
```

If nothing is abstract, why is the class abstract? Either it should be a regular class or an interface with default methods.

---

## 12. When NOT to abstract

- Premature abstraction. The "rule of three": don't extract an abstraction until you have at least three concrete cases that need it.
- Single-implementation interfaces. If `Service` has only one impl, just use a class.
- Excessive flexibility. Don't add hooks "in case someone needs them." Add them when someone does.

---

## 13. What's next

| Question                                         | Read             |
|--------------------------------------------------|------------------|
| When abstract class? When interface?             | `middle.md`       |
| Cost of abstraction at runtime? JIT impact?      | `senior.md`       |
| Bytecode of `abstract` and dispatch tables       | `professional.md` |
| Spec rules on abstract methods, default methods  | `specification.md` |
| Patterns: template method, strategy, factory     | `middle.md`, `senior.md` |

---

**Memorize this**: Abstraction = separation of *contract* from *implementation*. Use interfaces by default; abstract classes when you have shared state. Hide implementation behind small, stable APIs. Don't abstract until you need to.
