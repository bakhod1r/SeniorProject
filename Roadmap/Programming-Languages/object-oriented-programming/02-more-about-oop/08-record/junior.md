# Record — Junior

> **What?** A *record* is a special, concise kind of class introduced in Java 14 (preview) and standardized in Java 16. A record is an immutable data carrier — declare its components once, and the compiler synthesizes the fields, constructor, accessors, `equals`, `hashCode`, and `toString`.
> **How?** Use the `record` keyword followed by a header listing components. The body is usually empty or contains methods that operate on the components.

---

## 1. The simplest record

```java
public record Point(double x, double y) { }
```

This single line gives you:
- Two `private final` fields: `x`, `y`
- A canonical constructor `Point(double, double)`
- Two accessor methods: `x()`, `y()` (note: not `getX()`/`getY()`)
- A consistent `equals(Object)` that compares both components
- A consistent `hashCode()` based on both components
- A `toString()` like `Point[x=1.0, y=2.0]`

```java
Point p = new Point(1.0, 2.0);
System.out.println(p.x() + ", " + p.y());     // 1.0, 2.0
System.out.println(p);                         // Point[x=1.0, y=2.0]
System.out.println(p.equals(new Point(1, 2))); // true
```

---

## 2. What records are good for

Records are *data carriers*. Use them when:
- You have several values that belong together
- The values don't change after construction
- You want correct `equals`/`hashCode`/`toString` for free
- You don't need inheritance (records are implicitly final)

Examples:
- DTOs (Data Transfer Objects)
- Coordinates, ranges, intervals
- Result/error types
- Tuples (Pair, Triple)
- Configuration values
- Domain values (Money, Email, UUID-wrapper)

---

## 3. Records are immutable

```java
Point p = new Point(1, 2);
p.x = 5;                    // ERROR — fields are final
p = new Point(5, 2);        // OK — `p` reassigned, but the old Point is unchanged
```

Immutability is enforced by the compiler. The fields are `private final`. You cannot add a setter (records have no setters; if you wanted one, use a class).

For "modify and return new":

```java
public record Point(double x, double y) {
    public Point withX(double newX) { return new Point(newX, y); }
    public Point withY(double newY) { return new Point(x, newY); }
}
```

---

## 4. Records cannot extend

Records are implicitly `final`:

```java
record Sub extends Point { }     // ERROR
```

You can't extend a record. They can implement interfaces:

```java
public record Point(double x, double y) implements Comparable<Point> {
    public int compareTo(Point o) {
        return Double.compare(x, o.x);
    }
}
```

---

## 5. Compact constructor

Often you want to validate or normalize parameters. The *compact constructor* lets you do this without listing parameters:

```java
public record Range(int lo, int hi) {
    public Range {
        if (lo > hi) throw new IllegalArgumentException("lo > hi");
    }
}
```

The compact constructor body runs after parameter assignment. You can:
- Validate (`throw` if invalid)
- Normalize (modify the parameters before they're stored: `lo = Math.min(lo, 0);`)
- Defensively copy (e.g., `tags = List.copyOf(tags);`)

You cannot reassign `this.x` directly — the compact form does the assignment for you. Reassigning the *parameter* (`lo = ...`) before the implicit assignment is allowed.

---

## 6. Methods on records

Records can have methods like any class:

```java
public record Point(double x, double y) {
    public double distance(Point other) {
        double dx = x - other.x;
        double dy = y - other.y;
        return Math.hypot(dx, dy);
    }

    public static Point origin() { return new Point(0, 0); }
}
```

Static methods, instance methods, both work. Records can also have `static` fields, nested classes, etc.

---

## 7. Records and `equals`/`hashCode`

The compiler generates `equals` that compares all components and `hashCode` based on all of them:

```java
new Point(1, 2).equals(new Point(1, 2));    // true
new Point(1, 2).hashCode() == new Point(1, 2).hashCode();    // true
```

Override only if you have special equality semantics (rare). For floating-point, default uses `Double.compare`, which handles NaN correctly.

---

## 8. Records vs classes vs enums

| Feature        | Class                    | Record                    | Enum                              |
|----------------|--------------------------|---------------------------|-----------------------------------|
| Mutable        | Yes (by default)          | No                        | No (constants)                    |
| Inheritance    | Yes                       | Implicitly final          | Implicitly final                  |
| Multiple impls | Yes                       | Yes                       | Just the constants                |
| Auto methods   | None                      | equals/hashCode/toString  | name, ordinal                     |
| Best for       | Anything                  | Immutable data            | Closed set of named values        |

For "I have some related fields and need an immutable bundle," records are the right tool. For "open class with state and behavior," use a class. For "fixed set of named values," use an enum.

---

## 9. Records implementing interfaces

```java
public sealed interface Shape permits Circle, Square { }
public record Circle(double radius) implements Shape { }
public record Square(double side) implements Shape { }

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.radius() * c.radius();
        case Square sq -> sq.side() * sq.side();
    };
}
```

This is the modern Java pattern for algebraic data types. Sealed interface + records = type-safe, exhaustive, immutable variants.

---

## 10. Record components vs fields

The "components" are the named values in the record header:

```java
public record User(String name, int age) { }
//                  ^component   ^component
```

Components are not the same as fields, semantically:
- Components are part of the API contract (the canonical state).
- Fields are the implementation (always `private final`, named after components).
- Accessors return field values.

If you override an accessor, the component contract is what matters; the field is implementation detail.

---

## 11. Common newcomer mistakes

**Mistake 1: trying to extend**
```java
record Sub extends Base { }     // ERROR
```
Records can't extend.

**Mistake 2: using `getX()` for access**
```java
record User(String name) { }
user.getName();      // ERROR — accessor is `name()`
user.name();         // correct
```

**Mistake 3: trying to add instance fields**
```java
record User(String name) {
    private int counter;     // ERROR — records can't have additional instance fields
}
```
Only the components become fields. Add static fields if you need them.

**Mistake 4: forgetting the compact constructor's purpose**
```java
record Range(int lo, int hi) {
    public Range(int lo, int hi) {
        if (lo > hi) throw new IllegalArgumentException();
        // also need to assign:
        this.lo = lo;
        this.hi = hi;
    }
}
```
This is the *canonical* (full) constructor. The *compact* form omits parameters and does assignment for you:
```java
public Range {
    if (lo > hi) throw new IllegalArgumentException();
    // assignment is implicit
}
```

---

## 12. When NOT to use records

- The class needs setters (mutable state).
- The class needs to extend another class.
- Some "components" should be hidden (records expose all of them via accessors).
- The class is a service or controller (use class for behavior-heavy code).

---

## 13. Quick reference

| Aspect                | Behavior                                |
|-----------------------|-----------------------------------------|
| Modifier              | Implicitly `final`                      |
| Fields                | `private final`, one per component       |
| Accessors             | Public, named after components           |
| Constructor           | Auto-generated; can be customized         |
| `equals`/`hashCode`   | Auto-generated; can be overridden        |
| `toString`            | Auto-generated; can be overridden        |
| Inheritance           | Cannot extend; can implement interfaces  |
| Instance fields       | Only the components                      |
| Static fields/methods | Yes                                      |

---

## 14. What's next

| Topic                                    | File              |
|------------------------------------------|-------------------|
| Compact ctor patterns, defensive copy     | `middle.md`        |
| Sealed + records for algebraic types      | `middle.md`        |
| JIT view of records                       | `senior.md`        |
| Bytecode of records                       | `professional.md`  |
| JLS rules                                 | `specification.md` |

---

**Memorize this**: a record is a concise immutable data carrier. Components are the canonical state. The compiler synthesizes constructor, accessors, equals, hashCode, toString. Records are final and can implement interfaces. Use them for DTOs, value types, and algebraic data type variants.
