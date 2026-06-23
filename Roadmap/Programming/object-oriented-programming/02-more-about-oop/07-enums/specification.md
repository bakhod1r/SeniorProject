# Enums — Specification Deep-Dive

> JLS chapter 8 section 9 (`§8.9`) governs enums. JVMS §4.1, §4.5 (ACC_ENUM). `java.lang.Enum` and `java.util.EnumSet`/`EnumMap` Javadocs cover runtime behavior.

---

## 1. Where canonical text lives

| Topic                    | Source                |
|--------------------------|-----------------------|
| Enum declarations         | JLS §8.9             |
| Enum constants            | JLS §8.9.1           |
| Enum body                 | JLS §8.9.2           |
| Synthesized methods       | JLS §8.9.3           |
| Switch on enum            | JLS §14.11           |
| `ACC_ENUM` flag           | JVMS §4.1, §4.5, §4.6 |
| Enum class semantics      | `java.lang.Enum` Javadoc |
| EnumSet / EnumMap         | `java.util` package Javadoc |
| Pattern matching for enum | JLS §14.30, §15.20.2 |

---

## 2. JLS §8.9 — enum declaration

Syntax:

```
EnumDeclaration:
    {ClassModifier} enum Identifier [Superinterfaces] EnumBody
```

> An enum declaration is implicitly final unless it contains at least one enum constant that has a class body. (In which case the enum class is implicitly abstract, and the per-constant body produces a final anonymous subclass.)

The enum class is implicitly:
- `final` (with the exception above)
- Extends `java.lang.Enum<E>` (the type itself parameterizes E)

---

## 3. JLS §8.9.1 — enum constants

> An enum constant is a body-less declaration of a constant. Each constant invokes the enum's constructor implicitly.

Each constant is `public static final` of the enum's type. They appear before any other elements in the body.

```java
public enum Op {
    PLUS, MINUS;     // constants
    public abstract int apply(int, int);   // can come after
}
```

Multiple constants are separated by commas; the last is followed by a semicolon (if other declarations follow).

---

## 4. JLS §8.9.2 — enum body

The body can contain:
- Enum constants (must come first, before all other declarations)
- Static fields, methods, types
- Instance fields, methods (per-constant or shared)
- Constructors (implicitly private)

Nested types are permitted. Constants can have class bodies (anonymous subclass overriding methods).

---

## 5. JLS §8.9.3 — synthesized methods

Every enum class has implicitly:

- `public static E[] values()` — returns clone of the constants array
- `public static E valueOf(String name)` — returns constant by name; throws `IllegalArgumentException` if not found

These cannot be redefined by the programmer.

Inherited from `Enum<E>` (and `final` there):
- `name()`, `ordinal()`
- `equals()`, `hashCode()`, `toString()`, `compareTo()`, `getDeclaringClass()`

---

## 6. JLS §8.9.2 — constructors are private

> An enum constant has a constructor invocation. The constructor is private.

Even if you don't write `private`, the compiler treats the constructor as private. Public constructors aren't allowed:

```java
enum X {
    A;
    public X() { }   // ERROR — must be private (or default)
}
```

You can declare protected/package — these are silently treated as private.

---

## 7. Switch on enum (JLS §14.11)

A switch over an enum doesn't qualify constant names:

```java
switch (op) {
    case PLUS -> ...;     // not Op.PLUS
    case MINUS -> ...;
}
```

The compiler infers the type from the switch expression. Pattern matching switch (Java 21+) extends this with binding patterns and exhaustiveness checking.

---

## 8. Enum implements interfaces

An enum can declare `implements Iface1, Iface2`. It can use generic interfaces:

```java
public enum Op implements BinaryOperator<Integer> {
    PLUS  { public Integer apply(Integer a, Integer b) { return a + b; } };
}
```

Enums cannot extend other classes (always extend `Enum<E>`).

---

## 9. JVMS §4.1 — ACC_ENUM

```
class_access_flags:
    ...
    ACC_ENUM (0x4000)
```

Set on enum classes. The verifier and reflection use this flag to recognize enum types.

---

## 10. JVMS §4.5 — field flags

Enum constants are fields with:
```
ACC_ENUM | ACC_PUBLIC | ACC_STATIC | ACC_FINAL
```

The `ACC_ENUM` flag distinguishes enum constants from regular static finals.

---

## 11. Enum and serialization

Per `Object` serialization spec:
- Default behavior: write `name()`, deserialize via `Enum.valueOf`
- Custom `writeReplace`/`readResolve` are forbidden (the JVM enforces this)
- `serialVersionUID` is irrelevant — name is the key

This guarantees that deserialization produces the same singleton. Effective Java Item 89.

---

## 12. Enum and reflection

`Class<?>` introspection:
- `isEnum()` → true if `ACC_ENUM` set
- `getEnumConstants()` → returns the values (or null if not enum)
- `getDeclaringClass()` on a constant → its enum type

`Constructor.newInstance` is rejected:
```
java.lang.IllegalArgumentException: Cannot reflectively create enum objects
```

This is hardcoded in the JDK reflective access machinery.

---

## 13. Enum and pattern matching (JEP 441, Java 21)

```java
switch (op) {
    case PLUS -> ...;
    case MINUS -> ...;
}
```

If `op` is non-null, exhaustiveness check applies — every constant must have a case. Otherwise, compile error.

Java 21+ allows binding:
```java
case Op o when o.isCommutative() -> ...;
```

---

## 14. EnumSet / EnumMap contracts

`EnumSet`:
- All constants must be of one enum type
- Iteration order is declaration order
- O(1) `contains`/`add`/`remove`
- Supports `EnumSet.of`, `EnumSet.range`, `EnumSet.complementOf`, etc.

`EnumMap`:
- Keys must be one enum type
- Iteration order is declaration order
- O(1) `get`/`put`
- Allows null values (but not null keys)

---

## 15. Reading order

1. JLS §8.9 — enum declarations
2. JLS §8.9.1, §8.9.2 — constants and body
3. JLS §8.9.3 — synthesized methods
4. JLS §14.11 — switch on enum
5. JLS §14.30, §15.20.2 — pattern matching
6. JVMS §4.1, §4.5 — ACC_ENUM
7. `java.lang.Enum` Javadoc
8. `java.util.EnumSet` / `java.util.EnumMap` Javadocs

---

**Memorize this**: enums are specified in JLS §8.9. They're sugar for `final class extends Enum<E>` with private constructors and a fixed set of `public static final` instances. The bytecode flag is `ACC_ENUM`. Serialization is name-based; reflection cannot create new instances. EnumSet/EnumMap leverage ordinals for O(1) operations.
