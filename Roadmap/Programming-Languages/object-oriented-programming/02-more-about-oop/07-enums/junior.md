# Enums — Junior

> **What?** An *enum* (enumeration) is a special kind of class with a fixed, named set of instances declared at compile time. Enums are the right tool when a value must be one of a small, predefined list of possibilities — like days of the week, HTTP methods, or order statuses.
> **How?** With the `enum` keyword. The instances are listed in the body; the JVM creates exactly one instance of each, and they're accessed by name.

---

## 1. The simplest enum

```java
public enum Direction {
    NORTH, EAST, SOUTH, WEST
}

Direction d = Direction.NORTH;
```

`Direction` is a type. `NORTH`, `EAST`, etc., are its only possible values — singleton instances. You can't write `new Direction()`; the compiler synthesizes a private constructor.

---

## 2. Why use enums

Before enums (Java 5+), you'd use `int` constants:

```java
public static final int NORTH = 0;
public static final int EAST = 1;
public static final int SOUTH = 2;
public static final int WEST = 3;
```

Problems:
- Type-unsafe: any int can be passed where a direction is expected.
- Stringly-typed: you can't iterate "all directions."
- Magic numbers in switches.
- Not self-describing in logs (`println(NORTH)` prints `0`).

Enums fix all of these: type-safe, iterable, named, printable.

---

## 3. Iterating and comparing

```java
for (Direction d : Direction.values()) {
    System.out.println(d);
}
```

Every enum has a synthesized `values()` static method returning all instances in declaration order, and a `valueOf(String)` returning the instance with that name.

Comparison uses `==` (since instances are unique singletons):

```java
if (d == Direction.NORTH) { ... }
```

`equals` works too but `==` is more idiomatic for enums.

---

## 4. Methods on enum constants

Enums can have fields, constructors, and methods like any class:

```java
public enum Planet {
    MERCURY(3.303e+23, 2.4397e6),
    VENUS(4.869e+24, 6.0518e6),
    EARTH(5.976e+24, 6.37814e6);

    private final double mass;
    private final double radius;

    Planet(double mass, double radius) {
        this.mass = mass;
        this.radius = radius;
    }

    public double surfaceGravity() {
        return 6.67300E-11 * mass / (radius * radius);
    }
}
```

The constructor is implicitly private. Each constant calls it during class initialization.

```java
Planet.EARTH.surfaceGravity();   // 9.80...
```

---

## 5. Enum in switch

```java
public String greeting(Direction d) {
    return switch (d) {
        case NORTH -> "facing north";
        case EAST  -> "facing east";
        case SOUTH -> "facing south";
        case WEST  -> "facing west";
    };
}
```

The compiler verifies exhaustiveness — every enum constant is handled (or there's a `default`).

In a traditional switch (`case NORTH:`), you don't qualify the constant name — the compiler infers from the switch expression's type.

---

## 6. Per-constant behavior

You can override methods per-constant:

```java
public enum Op {
    PLUS  { public int apply(int a, int b) { return a + b; } },
    MINUS { public int apply(int a, int b) { return a - b; } },
    TIMES { public int apply(int a, int b) { return a * b; } };

    public abstract int apply(int a, int b);
}

int result = Op.PLUS.apply(3, 4);   // 7
```

Each constant is essentially an anonymous subclass with its own `apply`. The enum body declares the abstract method that all constants must implement.

---

## 7. Common JDK enums

- `java.util.concurrent.TimeUnit` — NANOSECONDS, MICROSECONDS, ...
- `java.time.DayOfWeek` — MONDAY, TUESDAY, ...
- `java.time.Month` — JANUARY, FEBRUARY, ...
- `java.lang.Thread.State` — NEW, RUNNABLE, BLOCKED, ...
- `java.nio.file.StandardOpenOption` — READ, WRITE, CREATE, ...

Each demonstrates the same pattern: a small fixed set of named values with type-safe API.

---

## 8. The `name()` and `ordinal()` methods

Every enum has:

- `name()` — the declared name as a `String` (e.g., `"NORTH"`)
- `ordinal()` — the zero-based position in the declaration

```java
Direction.NORTH.name();      // "NORTH"
Direction.NORTH.ordinal();   // 0
```

**Use `name()` for serialization or logging.** Avoid `ordinal()` — it changes if you reorder declarations or insert new constants.

---

## 9. EnumSet and EnumMap

```java
EnumSet<Direction> compass = EnumSet.of(Direction.NORTH, Direction.SOUTH);
EnumMap<Direction, String> arrows = new EnumMap<>(Map.of(
    Direction.NORTH, "↑",
    Direction.SOUTH, "↓"
));
```

`EnumSet` and `EnumMap` are highly optimized:
- `EnumSet` uses a `long` bitset internally (or array for >64 constants).
- `EnumMap` uses an array indexed by ordinal.

Both are far faster than HashMap/HashSet for enum keys/values.

---

## 10. Enums in collections

You can use enums as map keys, set elements, etc. Use `EnumSet`/`EnumMap` for performance, but `HashSet`/`HashMap` work too.

```java
Set<DayOfWeek> weekend = Set.of(DayOfWeek.SATURDAY, DayOfWeek.SUNDAY);
```

---

## 11. Common newcomer mistakes

**Mistake 1: using ordinal() for persistence**

```java
db.save(direction.ordinal());
```

If you reorder or insert constants, old data becomes wrong.

Use `name()`:
```java
db.save(direction.name());
```

**Mistake 2: trying to extend an enum**

```java
class ExtendedDirection extends Direction { }   // ERROR
```

Enums are implicitly `final`. Use composition or interface implementation if you need to extend behavior.

**Mistake 3: comparing with `equals` then trying `==`**

Both work for enums. `==` is preferred (and works for null safety: `null == X` is false, while `null.equals(X)` is NPE).

---

## 12. Enums as singletons

Enums with one constant are the *enum singleton pattern*:

```java
public enum Database {
    INSTANCE;

    private final Connection conn = ...;
    public void save(Object o) { ... }
}

Database.INSTANCE.save(...);
```

This is the easiest way to make a singleton:
- Thread-safe (class init is synchronized)
- Serialization-safe (the JVM guarantees singletons across deserialization)
- Reflection-resistant (`Constructor.newInstance` on enum throws)

Effective Java Item 3 recommends this over other singleton patterns.

---

## 13. Enums implementing interfaces

```java
public interface Operation {
    int apply(int a, int b);
}

public enum Op implements Operation {
    PLUS  { public int apply(int a, int b) { return a + b; } },
    MINUS { public int apply(int a, int b) { return a - b; } };
}

Operation op = Op.PLUS;
op.apply(3, 4);
```

Useful when you have a fixed set of strategies (an "enum of operations") and want to abstract over them via an interface.

---

## 14. Quick reference

| Concept            | Mechanism                        |
|--------------------|----------------------------------|
| Constants          | List in enum body                 |
| Iterate            | `Direction.values()`              |
| Lookup by name     | `Direction.valueOf("NORTH")`      |
| Constant name      | `d.name()`                        |
| Position           | `d.ordinal()` (avoid in storage)  |
| Per-constant impl  | Anonymous body per constant       |
| Set of enums       | `EnumSet`                         |
| Map keyed by enum  | `EnumMap`                         |
| Singleton          | One-constant enum                 |

---

## 15. What's next

| Question                                  | File              |
|-------------------------------------------|-------------------|
| Strategy enum, interface implementation    | `middle.md`        |
| EnumSet/EnumMap internals                  | `senior.md`        |
| Bytecode of enums                          | `professional.md`  |
| JLS rules                                  | `specification.md` |

---

**Memorize this**: enums are a fixed, named set of singleton instances of a class. Use them for closed sets of values. Use `name()`, not `ordinal()`, for persistence. Use `EnumSet`/`EnumMap` for performance. Use one-constant enums for singletons.
