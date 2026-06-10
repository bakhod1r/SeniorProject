# Enums — Professional

> **What?** Bytecode of `enum`: `ACC_ENUM` flag, `Enum<E>` superclass, synthetic methods (`values`, `valueOf`), per-constant anonymous subclasses, `<clinit>` order, and how the verifier prevents reflective enum instantiation.
> **How?** With `javap -v`, study the JDK's `Enum.java` and `EnumSet.java` source, observe class loading with `-Xlog:class+init`.

---

## 1. Class file flags

An enum compiles with:
- `ACC_ENUM` (0x4000) on the class
- `ACC_FINAL` (0x0010) — enums can't be extended (except via per-constant anonymous subclasses)
- Each constant field has `ACC_ENUM | ACC_PUBLIC | ACC_STATIC | ACC_FINAL`

```
$ javap -v Direction.class | head
public final class Direction extends java.lang.Enum<Direction>
  flags: (0x4030) ACC_PUBLIC, ACC_FINAL, ACC_SUPER, ACC_ENUM
```

Wait — `ACC_FINAL` and the ability to override via anonymous subclasses? The JVM allows this because the per-constant subclasses are auto-generated. User code can't extend the enum.

---

## 2. Synthetic methods

The compiler generates:

```
public static Direction[] values();
public static Direction valueOf(String);
```

`values()` returns a clone of the internal `Direction[] $VALUES`. The clone prevents callers from mutating the global array.

`valueOf(String)` calls `Enum.valueOf(Class, String)` which uses an internal name → constant map.

---

## 3. The `Enum<E>` superclass

```java
public abstract class Enum<E extends Enum<E>> implements Comparable<E>, Serializable {
    private final String name;
    private final int ordinal;

    protected Enum(String name, int ordinal) {
        this.name = name;
        this.ordinal = ordinal;
    }
    public final String name() { return name; }
    public final int ordinal() { return ordinal; }
    public final int compareTo(E o) { return ordinal - o.ordinal; }
    public final boolean equals(Object o) { return this == o; }
    public final int hashCode() { return super.hashCode(); }
    public final Class<E> getDeclaringClass() { ... }
    // ...
}
```

`equals` is `==` — exactly what you'd want for singletons. `hashCode` uses identity. `compareTo` is by ordinal. These are all `final` — you can't override.

---

## 4. Per-constant anonymous subclasses

```java
public enum Op {
    PLUS  { public int apply(int a, int b) { return a + b; } };
    public abstract int apply(int a, int b);
}
```

Compiles to:
- `Op` — abstract class with abstract `apply`
- `Op$1` — anonymous subclass implementing `apply` for PLUS

```
$ javap -v Op.class | grep extends
public abstract class Op extends java.lang.Enum<Op>

$ javap -v 'Op$1.class'
final class Op$1 extends Op
  flags: ACC_FINAL, ACC_SUPER, ACC_ENUM
```

Each constant is one anonymous final subclass.

---

## 5. `<clinit>` for enums

```
public static {};
  Code:
     0: new           #2  // class Op$1
     3: dup
     4: ldc           #4  // String PLUS
     6: iconst_0
     7: invokespecial #5  // Method Op$1."<init>":(Ljava/lang/String;I)V
    10: putstatic     #6  // Field PLUS:LOp;
    ...
   <similar block for each constant>
    last: putstatic   $VALUES
    last+1: return
```

Constants are constructed in declaration order, then stored in the `$VALUES` array. After `<clinit>`, all constants exist.

---

## 6. `Class.isEnum()` and reflection

`Class.isEnum()` returns true if `ACC_ENUM` is set on the class. `Class.getEnumConstants()` returns the values.

`Constructor.newInstance` on an enum throws:
```
IllegalArgumentException: Cannot reflectively create enum objects
```

This is enforced by the JVM, not just `javac`. Protects singleton invariants.

---

## 7. EnumSet implementations

Two concrete classes:

- `RegularEnumSet<E>` — uses a single `long` bitset, for ≤64 constants
- `JumboEnumSet<E>` — uses `long[]`, for >64 constants

Created via `EnumSet.of(...)`, `EnumSet.allOf(...)`, etc. — factory methods choose the right impl based on constant count.

```java
EnumSet.allOf(Day.class);   // 7 constants → RegularEnumSet
```

---

## 8. EnumMap internals

`EnumMap<K, V>` stores values in `Object[] vals` indexed by ordinal. `get(key)` is `vals[key.ordinal()]`. `put` updates the same slot.

Iteration order is declaration order (ordinal 0 to N).

Internally maintains a `Class<K> keyType` for runtime checks (used in `containsKey` etc.).

---

## 9. Switch on enum bytecode

```java
switch (op) {
    case PLUS -> a + b;
    case MINUS -> a - b;
}
```

Compiles to a `tableswitch` *via an indirection*. The compiler doesn't directly use `ordinal()` in the bytecode (because that would break if the enum is recompiled with reordered constants). Instead:

- A synthetic class `EnumDesugar` is generated holding an `int[]` mapping ordinals to switch indices.
- The switch reads `EnumDesugar.$SwitchMap$Op[op.ordinal()]` to get the index.
- Then `tableswitch` jumps based on that index.

This indirection means recompiling the enum and not the switch is safe (the synthetic map reflects the new enum's ordering).

---

## 10. Pattern matching switch on enum (Java 21+)

```java
switch (op) {
    case PLUS -> ...;
    case MINUS -> ...;
}
```

In Java 21+, this can compile to an `invokedynamic` to `SwitchBootstraps.enumSwitch`, which is even cleaner.

---

## 11. Records as enum-like

```java
public enum HttpMethod { GET, POST, PUT; ... }
```

vs

```java
public sealed interface HttpMethod permits Get, Post, Put { }
public record Get() implements HttpMethod { }
public record Post() implements HttpMethod { }
public record Put() implements HttpMethod { }
```

Both express closed variants. Enum is more compact for label-only sets. Sealed + records is necessary when variants carry data.

---

## 12. Enum in JPMS

Enums in modules behave like normal classes. Access modifiers apply. `EnumSet`/`EnumMap` work across modules normally.

`Class.forName` for enums respects module boundaries. Loading an enum from a different module requires the package to be exported.

---

## 13. Verifier rules for enums

JVMS §4.10 includes special rules:
- Enum classes must extend `Enum<E>` directly.
- Cannot have public constructors (only `private` synthesized one).
- Cannot be instantiated via `new` from outside the class.

These prevent the singleton pattern from being violated.

---

## 14. Where the spec says it

| Topic                          | Source                |
|--------------------------------|-----------------------|
| Enum types                      | JLS §8.9             |
| Enum constants                  | JLS §8.9.1           |
| Enum body                       | JLS §8.9.2           |
| Enum methods (synthesized)      | JLS §8.9.3           |
| Enum constructors               | JLS §8.9.2           |
| `Class.isEnum()`                | `java.lang.Class` Javadoc |
| `Enum<E>` API                   | `java.lang.Enum` Javadoc |
| `ACC_ENUM` flag                 | JVMS §4.1, §4.5      |
| EnumSet                         | `java.util.EnumSet` Javadoc |
| EnumMap                         | `java.util.EnumMap` Javadoc |

---

**Memorize this**: enum compiles to a `final class extends Enum<E>` with `ACC_ENUM` flag. Per-constant overrides become anonymous subclasses. `<clinit>` constructs all constants. `EnumSet`/`EnumMap` use ordinals for O(1) array indexing. Reflection cannot create new enum instances. The JIT often devirtualizes enum dispatch.
