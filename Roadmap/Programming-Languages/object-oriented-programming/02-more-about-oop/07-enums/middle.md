# Enums — Middle

> **What?** Beyond simple lists of constants: strategy enums (per-constant behavior), enum + interface for polymorphism, enum maps and sets for performance, enum vs sealed-type trade-offs, and the patterns that make enums a powerful design tool.
> **How?** By treating enums as full-fledged classes with shared and per-constant behavior, using them where the variant set is closed and known.

---

## 1. The strategy enum pattern

The classic Operation enum:

```java
public enum Operation {
    PLUS("+") {
        @Override public double apply(double a, double b) { return a + b; }
    },
    MINUS("-") {
        @Override public double apply(double a, double b) { return a - b; }
    },
    TIMES("*") {
        @Override public double apply(double a, double b) { return a * b; }
    };

    private final String symbol;
    Operation(String symbol) { this.symbol = symbol; }
    public String symbol() { return symbol; }
    public abstract double apply(double a, double b);
}

double r = Operation.PLUS.apply(3, 4);
String sym = Operation.PLUS.symbol();
```

Each constant has its own `apply`. The shared `symbol` field/method is on the enum class. This is *open-closed* applied to enums: add a constant by editing the enum, and every consumer that uses `apply` works.

---

## 2. Enum implementing interface

```java
public interface Operation { double apply(double a, double b); }

public enum BasicOp implements Operation {
    PLUS  { public double apply(double a, double b) { return a + b; } },
    MINUS { public double apply(double a, double b) { return a - b; } };
}
```

Now `Operation` can be implemented by enums *and* regular classes. Useful when some operations are predefined (basic) and others are dynamic (user-supplied lambdas, plugins).

```java
Operation custom = (a, b) -> Math.pow(a, b);
List<Operation> all = List.of(BasicOp.PLUS, BasicOp.MINUS, custom);
```

---

## 3. Per-constant data

```java
public enum Currency {
    USD("$", 100, "United States dollar"),
    EUR("€", 100, "Euro"),
    JPY("¥", 1, "Japanese yen");

    private final String symbol;
    private final int subunitsPerMain;
    private final String description;

    Currency(String s, int sub, String d) {
        this.symbol = s;
        this.subunitsPerMain = sub;
        this.description = d;
    }
    public String symbol() { return symbol; }
    public int subunits() { return subunitsPerMain; }
    public String description() { return description; }
}
```

Each constant has its own values. Encapsulated, type-safe, easy to iterate.

---

## 4. EnumSet — bitset performance

```java
EnumSet<Day> weekdays = EnumSet.range(Day.MONDAY, Day.FRIDAY);
EnumSet<Day> weekend  = EnumSet.complementOf(weekdays);
boolean isWeekend = weekend.contains(today);
```

Internals: for ≤64 constants, EnumSet uses a single `long` as a bitset. Operations like `contains`, `add`, `union` are bitwise — single CPU instructions.

For >64 constants, it uses a `long[]`. Still vastly faster than `HashSet<MyEnum>`.

Bulk ops:
- `EnumSet.allOf(Day.class)` — all constants
- `EnumSet.noneOf(Day.class)` — empty
- `EnumSet.of(...)` — specific constants
- `EnumSet.complementOf(other)` — bitwise NOT
- `EnumSet.copyOf(other)` — copy

---

## 5. EnumMap — array-backed map

```java
EnumMap<Day, Schedule> schedules = new EnumMap<>(Day.class);
schedules.put(Day.MONDAY, weekSchedule);
```

Internals: an array indexed by `ordinal()`. Access is O(1) with array indexing — faster than HashMap's hash + collision handling.

Iteration order is the enum declaration order (not insertion order).

---

## 6. Enum vs sealed type — when to choose what

| Use case                                   | Choose                              |
|--------------------------------------------|-------------------------------------|
| Small fixed set of *labels*                | Enum                                |
| Small fixed set of *typed variants* (with payload) | Sealed interface + records  |
| Need ordinal/EnumSet/EnumMap               | Enum                                |
| Variant has substantial per-instance data  | Sealed + records                    |
| Want pattern matching exhaustiveness       | Either (both work)                  |
| Want shared methods + per-variant override  | Enum (cleaner)                      |
| Need type parameters per variant           | Sealed + records (enums can't generic-vary)  |

Sealed types extended what enums could express: typed variants with their own data shape. Many former enum-with-data uses are cleaner as sealed records.

---

## 7. Pattern matching switch on enum

```java
String describe(Day d) {
    return switch (d) {
        case MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY -> "weekday";
        case SATURDAY, SUNDAY -> "weekend";
    };
}
```

Comma-separated cases for groups. Compiler verifies exhaustiveness.

For pattern matching with binding (Java 21+):

```java
switch (someValue) {
    case Day d when d == Day.MONDAY -> ...;
    case Day d -> ...;
}
```

---

## 8. Enum constructors run during class init

The enum's `<clinit>` (class initializer) creates each constant in declaration order:

```java
public enum Heavy {
    ONE,    // calls Heavy() once
    TWO,    // calls Heavy() once
    THREE;  // calls Heavy() once

    Heavy() { System.out.println("init"); }
}
```

Output during `<clinit>`: "init init init" — three times.

Implication: don't do expensive work in enum constructors (DB calls, file IO). It runs at class load.

---

## 9. Enum and the singleton pattern

Effective Java Item 3:

```java
public enum Database {
    INSTANCE;
    private final Connection conn = ...;
    public void save(Object o) { ... }
}

Database.INSTANCE.save(thing);
```

Why preferred over other singletons:
- Class initialization is thread-safe by JVM contract.
- Serialization writes the constant's name; deserialization returns the same instance.
- Reflection (`Constructor.newInstance`) throws `IllegalArgumentException` for enums.

Drawback: testing is harder (can't replace the singleton). For testable singletons, prefer DI.

---

## 10. Enums as namespaces for related operations

```java
public enum HttpMethod {
    GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD;

    public boolean isSafe() {
        return this == GET || this == HEAD || this == OPTIONS;
    }

    public boolean isIdempotent() {
        return isSafe() || this == PUT || this == DELETE;
    }
}
```

Convenient: behavior associated with the enum, not in a separate utility class.

---

## 11. Enum + interface for SPI

```java
public interface PaymentProcessor {
    Result process(Payment p);
}

public enum BuiltinProcessors implements PaymentProcessor {
    STRIPE   { public Result process(Payment p) { ... } },
    PAYPAL   { public Result process(Payment p) { ... } };
}
```

A user can pass `BuiltinProcessors.STRIPE` *or* a custom implementation. Enums become a curated set of well-known options.

---

## 12. Enum iteration order

`values()` returns constants in declaration order. This is part of the contract.

```java
for (Day d : Day.values()) { ... }
```

If you need a different order, sort:

```java
Arrays.stream(Day.values()).sorted(...).forEach(...);
```

But: don't rely on declaration order for behavior. Reordering should be safe.

---

## 13. Enums and `ordinal()`

`ordinal()` is the zero-based position. Avoid it for:
- Database storage (reorder constants, data breaks)
- Serialization formats (versioning hazard)
- Cross-version comparisons

Use it for:
- Internal optimizations (EnumSet, EnumMap)
- Stable arrays (where you control allocations)

---

## 14. Enum body restrictions

You can't have:
- Public constructors (always private)
- Reassignment of enum constants
- Enum constants instantiated outside the enum class

You can have:
- Fields (instance and static)
- Methods (including abstract)
- Nested types
- Static initializers
- Constructors (private)

---

## 15. Adding methods to existing enums

Enums in libraries often add methods over time. Since enums are final, this works seamlessly:

```java
public enum HttpStatus {
    OK(200), NOT_FOUND(404), SERVER_ERROR(500);
    private final int code;
    HttpStatus(int c) { this.code = c; }
    public int code() { return code; }

    // added in v2:
    public boolean isClient() { return code >= 400 && code < 500; }
}
```

Existing callers benefit; no migration needed.

---

## 16. What's next

| Topic                              | File              |
|------------------------------------|-------------------|
| EnumSet/EnumMap internals          | `senior.md`        |
| Bytecode of enums                  | `professional.md`  |
| JLS enum rules                     | `specification.md` |
| Common enum bugs                   | `find-bug.md`      |

---

**Memorize this**: enums are full-fledged classes with a fixed set of singleton instances. Add per-constant behavior with overrides. Use EnumSet/EnumMap for performance. Use enums for labels and small variant sets; sealed records for typed variants with rich data. Avoid `ordinal()` for persistence.
