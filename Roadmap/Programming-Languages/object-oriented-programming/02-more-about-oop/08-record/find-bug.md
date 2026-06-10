# Record — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong because of a record misuse.

---

## Bug 1 — Mutable component leaks

```java
public record Tags(List<String> values) { }

List<String> mut = new ArrayList<>(List.of("a", "b"));
Tags t = new Tags(mut);
mut.clear();   // also clears t.values()!
```

**Why?** Records hold the reference to the input list. Mutations leak through.

**Fix:** compact constructor with defensive copy:
```java
public record Tags(List<String> values) {
    public Tags {
        values = List.copyOf(values);
    }
}
```

---

## Bug 2 — Trying to extend a record

```java
public record Base(int x) { }
public record Sub(int x, int y) extends Base { }   // ERROR
```

**Why?** Records are implicitly final.

**Fix:** use composition or a sealed interface:
```java
sealed interface HasX permits Base, Sub { int x(); }
record Base(int x) implements HasX { }
record Sub(int x, int y) implements HasX { }
```

---

## Bug 3 — Adding instance fields

```java
public record User(String name, int age) {
    private long createdAt;   // ERROR — records can't have additional instance fields
}
```

**Why?** Only components become instance fields.

**Fix:** add `createdAt` as a component:
```java
public record User(String name, int age, long createdAt) { }
```

Or use a static field if it's truly class-level data.

---

## Bug 4 — Returning the same mutable component without copying

```java
public record Tags(List<String> values) {
    public Tags { values = List.copyOf(values); }
    public List<String> values() { return values; }   // !! returns the immutable list — actually OK
}
```

Wait — this is fine because `List.copyOf` returns immutable. The bug would be:

```java
public record Tags(List<String> values) {
    // forgot the compact constructor!
    public List<String> values() { return values; }   // returns mutable!
}
```

**Why?** Without defensive copy in compact constructor, the underlying list is mutable.

**Fix:** add the compact constructor with `List.copyOf`.

---

## Bug 5 — Compact constructor with `return`

```java
public record Range(int lo, int hi) {
    public Range {
        if (lo > hi) return;   // ERROR
    }
}
```

**Why?** Compact constructors cannot have `return` — the implicit field assignment must occur.

**Fix:** throw on invalid input instead:
```java
public Range {
    if (lo > hi) throw new IllegalArgumentException();
}
```

---

## Bug 6 — Wrong accessor naming

```java
public record User(String name, int age) { }

user.getName();   // ERROR
user.name();      // correct
```

**Why?** Records use `componentName()` not `getComponentName()`.

**Fix:** use the component name directly.

---

## Bug 7 — `equals` override that breaks the contract

```java
public record User(String name, int age, String email) {
    @Override public boolean equals(Object o) {
        return o instanceof User u && u.name.equals(name);   // ignores age, email!
    }
    // hashCode not overridden — inconsistent
}
```

**Why?** `equals` and `hashCode` must be consistent. Two records can be `equals` but have different `hashCode` → broken contract.

**Fix:** if you override `equals`, override `hashCode` accordingly. Better: don't override; let the auto-generated versions work.

---

## Bug 8 — Trying to use `protected` component

```java
public record User(String name, protected int age) { }   // ERROR
```

**Why?** Components are implicitly `private final`. They expose `public` accessors. `protected` doesn't apply.

**Fix:** drop `protected`. The record naturally exposes the field via accessor.

---

## Bug 9 — Records ignoring sealed exhaustiveness

```java
sealed interface Shape permits Circle, Square { }
record Circle(double r) implements Shape { }
record Square(double s) implements Shape { }

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.s() * sq.s();
        default -> 0;     // !! defeats exhaustiveness
    };
}
```

**Why?** `default` makes the switch always exhaustive. Adding a new permitted variant won't break this method.

**Fix:** remove `default`. Compiler enforces coverage.

---

## Bug 10 — Mutable record field via reflection

```java
public record User(String name, int age) { }

Field f = User.class.getDeclaredField("name");
f.setAccessible(true);
f.set(user, "intruder");
```

**Why?** Reflection can bypass `final`. Records are immutable in normal use but reflection violates this.

**Fix:** at the JPMS level, don't `opens` modules to untrusted reflection. At application level, accept that records are conceptually immutable.

---

## Bug 11 — Generic record with wrong erasure expectation

```java
public record Box<T>(T value) { }

Box<String> a = new Box<>("hi");
Box<Integer> b = new Box<>(42);
a.getClass() == b.getClass();   // true — erasure
```

**Why?** Generics are erased. `Box<String>` and `Box<Integer>` have the same `Class<?>`.

**Fix:** if you need runtime type info, store it explicitly:
```java
public record Box<T>(T value, Class<T> type) { }
```

---

## Bug 12 — `Pair(String, String)` ambiguity in pattern

```java
record Pair(String first, String second) { }

if (obj instanceof Pair(String first, String second)) {
    // both are String — only differentiable by name
}
```

**Why?** No bug per se, but the pattern variable names matter for readability. `(String first, String second)` is clear; `(String a, String b)` is confusing if components are semantic (e.g., "key", "value").

**Fix:** name pattern variables descriptively:
```java
if (obj instanceof Pair(String key, String value)) { ... }
```

---

## Pattern recap

| Bug | Family                                | Cure                                  |
|-----|---------------------------------------|---------------------------------------|
| 1   | Mutable component leaked               | Defensive copy in compact ctor        |
| 2   | Trying to extend a record              | Use sealed interface                  |
| 3   | Adding instance fields                  | Make it a component                   |
| 4   | Forgot defensive copy                   | Compact ctor                          |
| 5   | `return` in compact ctor                | Throw instead                         |
| 6   | Using `getX()`                          | Use `x()`                             |
| 7   | Inconsistent equals/hashCode             | Don't override; or override both      |
| 8   | `protected` on component                 | Records don't support it              |
| 9   | `default` defeats exhaustiveness         | Remove default                        |
| 10  | Reflection bypasses final                | Module/security boundary              |
| 11  | Generic erasure                          | Store type explicitly                 |
| 12  | Unclear pattern names                    | Name descriptively                    |

---

**Memorize the shapes**: most record bugs are about (a) mutable component leaks, (b) misunderstanding immutability, or (c) trying to use class-style features (extends, instance fields). Records are simple by design; respect the constraints.
