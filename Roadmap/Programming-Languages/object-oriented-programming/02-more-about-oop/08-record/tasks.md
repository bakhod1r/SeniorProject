# Record — Practice Tasks

Twelve exercises in records: design, validation, sealed types, patterns.

---

## Task 1 — Convert POJO to record

```java
public class User {
    private String name;
    private int age;
    public User(String name, int age) { this.name = name; this.age = age; }
    public String getName() { return name; }
    public int getAge() { return age; }
    @Override public boolean equals(Object o) { ... }
    @Override public int hashCode() { ... }
    @Override public String toString() { ... }
}
```

Convert to a record. Verify the same behavior.

---

## Task 2 — Compact constructor validation

Implement `record Range(int lo, int hi)` with compact constructor that throws `IllegalArgumentException` if `lo > hi`. Test both valid and invalid construction.

---

## Task 3 — Defensive copy

```java
public record Tags(List<String> values) { }
```

Modify the compact constructor to defensively copy the input list. Verify that mutating the original list doesn't affect the record.

---

## Task 4 — `withX` methods

```java
public record Point(double x, double y) { }
```

Add `withX(double)` and `withY(double)` methods. Test:
```java
new Point(1, 2).withX(5)   // Point[x=5.0, y=2.0]
```

---

## Task 5 — Sealed + records (algebraic data type)

Define:
```java
sealed interface Json permits JNull, JBool, JNum, JStr, JArr, JObj { }
```

Implement each variant as a record. Write `String render(Json j)` using pattern-matching switch. Verify exhaustiveness (no `default`).

---

## Task 6 — Generic record

```java
public record Pair<A, B>(A first, B second) {
    public <C> Pair<C, B> mapFirst(Function<A, C> f) { ... }
    public <D> Pair<A, D> mapSecond(Function<B, D> f) { ... }
}
```

Implement and test.

---

## Task 7 — Record pattern in switch

Given:
```java
sealed interface Shape permits Circle, Square { }
record Circle(double r) implements Shape { }
record Square(double s) implements Shape { }
```

Write `double area(Shape)` using record patterns:
```java
return switch (s) {
    case Circle(double r) -> Math.PI * r * r;
    case Square(double side) -> side * side;
};
```

---

## Task 8 — Records as Map keys

```java
record Position(int x, int y) { }
Map<Position, String> map = new HashMap<>();
map.put(new Position(0, 0), "origin");
map.get(new Position(0, 0));   // "origin"
```

Verify same-content positions map to the same value. Test with 1000 random positions.

---

## Task 9 — Record + Jackson

```java
public record CreateUser(@JsonProperty("user_name") String name, int age) { }
```

Serialize to JSON; verify `user_name` (snake_case) appears. Deserialize a JSON string with `user_name` field; verify the record is constructed.

---

## Task 10 — Static factory methods

Add to `Point`:
```java
public static Point origin() { return new Point(0, 0); }
public static Point cartesian(double x, double y) { return new Point(x, y); }
public static Point polar(double r, double theta) {
    return new Point(r * Math.cos(theta), r * Math.sin(theta));
}
```

Test each.

---

## Task 11 — Nested patterns

```java
record Pair<A, B>(A first, B second) { }

void process(Object o) {
    if (o instanceof Pair(String name, Integer count)) {
        System.out.println(name + ": " + count);
    }
}
```

Test with `Pair<String, Integer>` and other types. Verify pattern matches only when both types align.

---

## Task 12 — Record vs Lombok

Compare with @Data POJO:
```java
@Data @AllArgsConstructor
public class User {
    private String name;
    private int age;
}
```

Convert to a record. List the differences:
- Records are immutable; `@Data` generates setters.
- Records use `name()` accessors; `@Data` uses `getName()`.
- Records can't extend; `@Data` POJOs can.
- Records are simpler to reason about.

Which would you choose for a DTO? For an entity?

---

## Validation

| Task | How |
|------|-----|
| 1 | All getters renamed to accessors; equals/hashCode/toString still pass tests |
| 2 | Valid range constructs; invalid throws |
| 3 | After construction, mutations to original list don't affect record |
| 4 | `p.withX(5).x()` returns 5; original `p` unchanged |
| 5 | Switch is exhaustive without `default`; each variant rendered correctly |
| 6 | Type parameters preserved through `mapFirst` |
| 7 | Pattern matches both shapes; component values bound correctly |
| 8 | All same-content positions retrieve the same value |
| 9 | JSON output uses `user_name`; deserialization reconstructs record |
| 10 | Each factory produces correct Point |
| 11 | Pattern matches only Pair<String, Integer>; other Pairs don't |
| 12 | Discuss trade-offs in writing |

---

**Memorize this**: records are concise, immutable, JIT-friendly. Use compact constructors for validation; defensive copies for mutable components; static factories for clarity; sealed types for closed variants. Pattern matching for deconstruction. They replace many POJOs and DTOs in modern Java.
