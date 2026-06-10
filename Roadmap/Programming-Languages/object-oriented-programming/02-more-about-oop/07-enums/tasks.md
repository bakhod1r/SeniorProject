# Enums — Practice Tasks

Twelve exercises in enum design, strategy enums, EnumSet/EnumMap, and pattern matching.

---

## Task 1 — Days of the week

Define `enum Day { MONDAY, ..., SUNDAY }` with:
- `boolean isWeekend()` returning true for SAT/SUN
- `int hoursOfDaylight(Month m)` (mock implementation)
- A static `EnumSet<Day> WEEKEND = EnumSet.of(SATURDAY, SUNDAY);`

---

## Task 2 — Strategy enum

Define `enum Op` with PLUS, MINUS, TIMES, DIVIDE. Each has an abstract `int apply(int a, int b)`. Implement per-constant. Test:

```java
Op.PLUS.apply(3, 4)   // 7
Op.DIVIDE.apply(10, 0)   // throws
```

---

## Task 3 — Enum + interface

Define `interface Operation { int apply(int a, int b); }` and `enum BasicOp implements Operation`. Show that you can pass either a `BasicOp` constant or a custom lambda to a method expecting `Operation`.

---

## Task 4 — Enum singleton

Implement a `Database` singleton via enum:
- Hold a fake `Connection` field
- Provide `save(Object)` and `query(String)` methods
- Verify the same instance via `Database.INSTANCE == Database.INSTANCE`

---

## Task 5 — Per-constant data

Define `enum HttpStatus` with constants and per-constant `code` and `description` fields. Add static factory `from(int code)` returning the corresponding constant or `null`.

---

## Task 6 — EnumSet vs HashSet benchmark

Create a JMH benchmark comparing:
- `EnumSet.of(...)` vs `Set.of(...)` for `contains` operations
- `EnumMap` vs `HashMap` for `get` operations

Verify EnumSet/EnumMap are faster.

---

## Task 7 — State machine with enum

Model a vending machine:
```java
enum State {
    IDLE, COIN_INSERTED, ITEM_SELECTED, DISPENSING;
    abstract State on(Event e);
}
```
Each state implements `on(Event e)` returning the next state.

---

## Task 8 — Switch with binding

Pattern-match a `enum Op` in a switch (Java 21+) with:
- Guard: `case PLUS when isCommutative()`
- Constants combined: `case PLUS, MINUS -> "binary"`

---

## Task 9 — Enum from JSON

Using Jackson, serialize an `enum Color { RED, GREEN, BLUE }` as JSON. Test:
- Default: `"RED"`
- Custom via `@JsonValue` to lowercase: `"red"`

---

## Task 10 — Don't store ordinal

Given an existing system that stores `direction.ordinal()` in DB:
1. Reorder constants and observe corruption
2. Refactor to store `name()`
3. Discuss migration path

---

## Task 11 — Enum implementing Comparator

Define `enum SortBy` with `BY_NAME`, `BY_AGE`, `BY_DATE` — each implements `Comparator<User>`. Use `users.sort(SortBy.BY_AGE)`.

---

## Task 12 — Migrate enum to sealed records

Given:
```java
enum Shape {
    CIRCLE(3.14), SQUARE(1.0), TRIANGLE(0.5);
    private final double factor;
    ...
}
```

Refactor to:
```java
sealed interface Shape { ... }
record Circle(double radius) implements Shape { ... }
record Square(double side) implements Shape { ... }
record Triangle(double base, double h) implements Shape { ... }
```

Compare: how does the data model change? When is each preferable?

---

## Validation

| Task | How |
|------|-----|
| 1 | `Day.SATURDAY.isWeekend()` is true |
| 2 | `Op.PLUS.apply(3, 4) == 7` |
| 3 | Can pass both `BasicOp.PLUS` and `(a, b) -> a*b` |
| 4 | `Database.INSTANCE == Database.INSTANCE` is true; reflection throws |
| 5 | `HttpStatus.from(404).description()` returns Not Found |
| 6 | JMH shows EnumSet/EnumMap faster |
| 7 | Verify state transitions match expected sequence |
| 8 | Switch compiles with guard; covers all cases |
| 9 | JSON output matches expected format |
| 10 | After reorder, ordinal-based DB has wrong directions |
| 11 | Sort produces correct order |
| 12 | Records carry per-variant data; sealed gives exhaustive matching |

---

**Memorize this**: enums are for closed sets of labels with optional per-constant behavior. Use EnumSet/EnumMap for performance. Use enum + interface for SPI. Use sealed records when variants carry typed data. Don't use ordinal() for persistence.
