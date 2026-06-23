# Record — Middle

> **What?** The patterns that make records powerful: compact constructors with validation/normalization, defensive copying for mutable components, static factory methods, sealed interfaces with record variants, generic records, and record patterns in switch.
> **How?** By treating records as the modern Java answer to "data class" — eliminating boilerplate while making invariants and immutability easy to express.

---

## 1. Compact constructor

The compact form runs validation/normalization without parameter ceremony:

```java
public record Email(String address) {
    public Email {
        if (address == null || !address.contains("@"))
            throw new IllegalArgumentException("invalid email: " + address);
        address = address.toLowerCase();    // normalize
    }
}
```

After your code runs, the parameters are assigned to the corresponding fields. You can mutate the parameter variables (`address = ...`) before the implicit assignment.

---

## 2. Canonical vs compact vs other constructors

```java
public record Range(int lo, int hi) {
    // compact — implicit parameter list & assignment
    public Range {
        if (lo > hi) throw new IllegalArgumentException();
    }

    // explicit canonical — full parameter list
    public Range(int lo, int hi) {
        if (lo > hi) throw new IllegalArgumentException();
        this.lo = lo;
        this.hi = hi;
    }

    // alternative constructor
    public Range(int single) {
        this(single, single);
    }
}
```

You can have *only one* canonical constructor (compact OR explicit). You can have additional constructors that delegate via `this(...)`.

---

## 3. Defensive copying for mutable components

Records hold the references they're given. If a component is mutable, the caller can mutate it after construction:

```java
public record Tags(List<String> values) { }

List<String> mut = new ArrayList<>(List.of("a", "b"));
Tags t = new Tags(mut);
mut.clear();                  // mutates t.values() too!
```

Fix with compact constructor + defensive copy:

```java
public record Tags(List<String> values) {
    public Tags {
        values = List.copyOf(values);     // immutable copy
    }
}
```

`List.copyOf` is idempotent (returns the input if already immutable) and gives you an immutable list — best of both worlds.

---

## 4. Custom accessors

You can override an accessor to return a defensive copy:

```java
public record Tags(List<String> values) {
    public List<String> values() { return List.copyOf(values); }
}
```

This is rarely needed if you use `List.copyOf` in the constructor — the field is already immutable, so the accessor's return is also immutable.

---

## 5. Static factories

```java
public record Point(double x, double y) {
    public static Point origin() { return new Point(0, 0); }
    public static Point of(double x, double y) { return new Point(x, y); }
}
```

Useful for:
- Named constants (`Point.origin()`)
- Polymorphic creation (return different subtypes when sealed)
- Validation that's better expressed as a factory than a constructor

---

## 6. `with` methods (manual copy-and-modify)

Until JEP 468 (or successor) lands a built-in `with` syntax, write `withX` methods:

```java
public record User(String name, int age, String email) {
    public User withName(String name) { return new User(name, age, email); }
    public User withAge(int age)      { return new User(name, age, email); }
    public User withEmail(String e)   { return new User(name, age, e); }
}

User v2 = u.withAge(31).withEmail("x@y.com");
```

Each call allocates a new record. JIT often eliminates the intermediates via escape analysis.

---

## 7. Records implementing sealed interfaces (algebraic types)

```java
public sealed interface JsonValue permits JNull, JBool, JNum, JStr, JArr, JObj { }
public record JNull() implements JsonValue { }
public record JBool(boolean v) implements JsonValue { }
public record JNum(double v) implements JsonValue { }
public record JStr(String v) implements JsonValue { }
public record JArr(List<JsonValue> items) implements JsonValue {
    public JArr { items = List.copyOf(items); }
}
public record JObj(Map<String, JsonValue> fields) implements JsonValue {
    public JObj { fields = Map.copyOf(fields); }
}
```

Combine with pattern matching:

```java
String render(JsonValue v) {
    return switch (v) {
        case JNull n -> "null";
        case JBool b -> Boolean.toString(b.v());
        case JNum n -> Double.toString(n.v());
        case JStr s -> "\"" + s.v() + "\"";
        case JArr a -> a.items().stream().map(this::render).collect(Collectors.joining(",", "[", "]"));
        case JObj o -> o.fields().entrySet().stream()
            .map(e -> "\"" + e.getKey() + "\":" + render(e.getValue()))
            .collect(Collectors.joining(",", "{", "}"));
    };
}
```

This is *the* modern Java idiom for tree/AST data.

---

## 8. Record patterns

Java 21 introduced record patterns (deconstructors):

```java
public record Point(int x, int y) { }

if (obj instanceof Point(int x, int y) p) {
    use(x, y, p);   // x and y are bound to the components
}
```

In switch:

```java
return switch (shape) {
    case Circle(double r) -> Math.PI * r * r;
    case Rect(double w, double h) -> w * h;
};
```

Nested deconstruction:

```java
case Pair(Point(int x1, int y1), Point(int x2, int y2)) -> { ... }
```

Records are designed to support this. The accessor methods are used implicitly during pattern matching.

---

## 9. Generic records

```java
public record Pair<A, B>(A first, B second) {
    public <C> Pair<C, B> mapFirst(Function<A, C> f) {
        return new Pair<>(f.apply(first), second);
    }
}

Pair<String, Integer> p = new Pair<>("hello", 5);
Pair<Integer, Integer> p2 = p.mapFirst(String::length);
```

Type parameters work just like in classes. The compiler handles erasure correctly.

---

## 10. Record annotations

```java
public record User(@NotNull String name, @Min(0) int age) { }
```

Annotations on the components apply to:
- The component (record component metadata)
- The corresponding field
- The constructor parameter
- The accessor method (return type position)

Use `@Target` to narrow if needed.

Common patterns:
- `@JsonProperty("user_name")` for JSON mapping
- `@Column("name")` for JPA mapping
- Validation annotations (`@NotNull`, `@Size`, etc.)

---

## 11. Records and inheritance trade-offs

You can't extend a record. You *can*:
- Implement multiple interfaces (use this for abstraction)
- Use composition (delegate to a record from a class that needs to extend something)
- Use sealed interfaces above records for hierarchy

This forces good design — most "extension" reasons should be composition or interface implementation, not inheritance.

---

## 12. Records as DTOs

Records are excellent for HTTP request/response, API DTOs, internal messages:

```java
public record CreateUserRequest(String name, int age, String email) { }
public record CreateUserResponse(long id, Instant created) { }

@PostMapping("/users")
public CreateUserResponse create(@RequestBody CreateUserRequest req) { ... }
```

Jackson and most frameworks understand records natively.

---

## 13. Records and serialization

Java serialization for records is component-based. Custom `writeReplace`/`readResolve` are forbidden in some forms. Generally:
- Record's `writeObject` writes the component values.
- `readObject` calls the canonical constructor with the values.
- Validation in compact constructor runs again on deserialization.

This means deserialization respects record invariants — better than the historical default for regular classes.

---

## 14. Record limitations to remember

- No additional instance fields (just components)
- No instance initializer blocks
- Cannot be `abstract`
- Cannot be extended
- Components cannot be `protected` (always `private final` underneath)
- Cannot have native methods

If any of these matter, use a class.

---

## 15. What's next

| Topic                                   | File              |
|-----------------------------------------|-------------------|
| JIT view of records, EA, performance     | `senior.md`        |
| Bytecode of records, ObjectMethods       | `professional.md`  |
| JLS records                              | `specification.md` |
| Record bug patterns                      | `find-bug.md`      |

---

**Memorize this**: records are concise immutable data carriers. Use compact constructors for validation; defensive copying for mutable components; static factories for clarity. Combine with sealed interfaces for algebraic types. Use record patterns for deconstruction. Replace many DTO/POJO classes with records.
