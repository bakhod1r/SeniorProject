# Record — Senior

> **What?** Performance characteristics of records — escape analysis, scalar replacement, JIT-friendly equals/hashCode, compact memory layout — and the design trade-offs of using records vs classes vs sealed unions in real systems.
> **How?** By understanding how `ObjectMethods.bootstrap` powers auto-generated equals/hashCode, how `final` fields enable EA, and when records simplify or complicate domain modeling.

---

## 1. Records are JIT-friendly

The key properties:
- `final` class: JIT can devirtualize all method calls.
- `final` fields: enable scalar replacement via escape analysis.
- Auto-generated `equals`/`hashCode`/`toString` use `invokedynamic` for compactness.

For most workloads, records perform as well as or better than hand-written immutable classes. The cost is minimal; the productivity gain is significant.

---

## 2. Escape analysis on records

```java
public double distance(Point a, Point b) {
    Point diff = new Point(a.x - b.x, a.y - b.y);
    return Math.hypot(diff.x(), diff.y());
}
```

If `diff` doesn't escape, C2 can apply scalar replacement: the record is never allocated; its fields live in registers.

Records help EA because:
- Final fields and final class signal immutability and no escape via subclass.
- Accessors are tiny and inlined.
- The compiler tells the JIT exactly what fields exist.

Verify with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`.

---

## 3. The `ObjectMethods.bootstrap` trick

Auto-generated `equals`, `hashCode`, `toString` use `invokedynamic` to call `java.lang.runtime.ObjectMethods.bootstrap`. This generates an efficient, consistent implementation at link time.

Why? It's compact in bytecode and lets the JVM specialize the implementation for the specific component types.

---

## 4. Memory layout

Record fields are laid out the same as any class's instance fields: object header (8-12 bytes) + fields (sized by type) + alignment padding. The JVM may reorder fields for alignment.

For a `record Point(double x, double y)`:
- Header: 12-16 bytes
- `x`: 8 bytes
- `y`: 8 bytes
- Padding to 8-byte alignment

Total: ~32 bytes.

Project Valhalla's value classes will eliminate the header and allow flat storage — making records into stack-allocatable values.

---

## 5. Records and Hibernate / JPA

JPA traditionally requires no-arg constructors and setters. Records provide neither. Workarounds:

- Use records as DTOs at the API/service boundary; entities remain classes.
- Use `@Embeddable` records (Hibernate 6+ supports this).
- Use record-aware ORM features (Spring Data JDBC, MyBatis).

For pure data-mapping use cases (Spring Data, DTOs, immutable views), records work great. For full ORM entities, classes still dominate.

---

## 6. Records and Jackson

```java
public record User(String name, int age) { }

ObjectMapper m = new ObjectMapper();
String json = m.writeValueAsString(new User("Alice", 30));
// {"name":"Alice","age":30}

User u = m.readValue(json, User.class);
```

Jackson 2.12+ supports records natively. Annotations on components (e.g., `@JsonProperty("user_name")`) work as expected.

For other serialization libraries (Gson, MessagePack, etc.), check version compatibility. Most have caught up.

---

## 7. Records as keys in collections

Records have correct `equals` and `hashCode` based on all components. Use them as `HashMap` keys safely:

```java
Map<Point, String> labels = new HashMap<>();
labels.put(new Point(0, 0), "origin");
labels.get(new Point(0, 0));    // "origin" — same content, same hash
```

For frequent map keys, hashCode is computed each time — not cached. For performance-critical code, consider caching the hash:

```java
public record Point(int x, int y) {
    private static final Map<Point, Integer> HASH_CACHE = ...;
    @Override public int hashCode() { return HASH_CACHE.computeIfAbsent(this, ...); }
}
```

Rarely needed.

---

## 8. Records and concurrency

Records are immutable — automatically thread-safe for sharing. No synchronization needed.

Multiple threads can read the same record without coordination. Final fields give safe publication via JLS §17.5.

Replace many mutable `Bean`-style classes with records and concurrency bugs vanish.

---

## 9. Records vs sealed interface + records

A sealed interface with record variants is the modern algebraic data type pattern:

```java
sealed interface Json permits JNum, JStr, ... { }
record JNum(double v) implements Json { }
```

Trade-offs vs a single record + enum:
- Sealed: each variant has its own type, components, methods.
- Enum + data: one type with discriminator + payload bag.

For complex variants, sealed records win. For simple tags, enums.

---

## 10. Records and lambda capture

```java
record Pair(int a, int b) { }
List<Pair> pairs = ...;
int sum = pairs.stream().mapToInt(p -> p.a() + p.b()).sum();
```

Lambdas referencing record components are clean. The JIT inlines the accessors after warmup; effectively zero cost.

---

## 11. When records hurt design

- **Long parameter lists.** A 12-component record is hard to construct correctly. Use a builder for the regular class wrapping the record's fields. Or split the data into smaller records.
- **Hidden invariants.** The compact constructor is the only place to enforce; if your invariants span methods, records may be too rigid.
- **Heavy behavior.** Records are *data carriers*. Don't put service logic on a record; put it in a class that consumes records.

---

## 12. Records and inheritance — alternatives

If you need to extend a record-like type:
- Use composition (record-typed field in a class).
- Use a sealed interface above records.
- Use a regular immutable class (manually written).

The constraint forces clean design — usually for the better.

---

## 13. Record performance vs class performance

For equivalent immutable classes, records:
- Are typically slightly faster (auto-generated indy can be more efficient).
- Have identical memory layout.
- Are equally JIT-friendly.

There's no record-specific tax. Use them whenever they fit.

---

## 14. Future: pattern-matching records

```java
switch (shape) {
    case Circle(var r) when r < 1 -> "small";
    case Circle(var r) -> "circle, r=" + r;
    case Square(var s) -> "square " + s;
}
```

Java 21 stabilized record patterns. Future versions may add nested patterns, even more exhaustive checks, and `with` syntax for copy-and-modify.

---

## 15. Practical checklist

- [ ] Replace POJO data classes with records.
- [ ] Use compact constructors for validation/normalization.
- [ ] Defensive copy mutable components in compact constructor.
- [ ] Combine with sealed interfaces for algebraic types.
- [ ] Use record patterns for deconstruction.
- [ ] Keep records small and focused on data.

---

## 16. What's next

| Topic                          | File              |
|--------------------------------|-------------------|
| Bytecode of records             | `professional.md`  |
| JLS records                     | `specification.md` |
| Interview prep                  | `interview.md`     |
| Common bugs                     | `find-bug.md`      |

---

**Memorize this**: records are concise, immutable, JIT-friendly. They replace POJOs, DTOs, value types, sealed-type variants. Use compact constructors for invariants and defensive copies. Combine with sealed interfaces for ADTs. Use record patterns for deconstruction. Modern Java without records is much more verbose.
