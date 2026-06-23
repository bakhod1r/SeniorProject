# Enums — Senior

> **What?** Internal mechanics: how enums are loaded once, how `EnumSet`/`EnumMap` use array indexing for O(1) operations, the JIT view of enum dispatch (highly optimizable due to closed set), strategy enum patterns, and how enums interact with serialization and reflection.
> **How?** By understanding that enums are syntactic sugar for a `final class` with a fixed instance set, and exploiting that fact for performance and design.

---

## 1. Enum is just a class

Behind the syntax:

```java
public enum Direction { NORTH, EAST }
```

Compiles to roughly:

```java
public final class Direction extends Enum<Direction> {
    public static final Direction NORTH = new Direction("NORTH", 0);
    public static final Direction EAST  = new Direction("EAST", 1);

    private static final Direction[] VALUES = { NORTH, EAST };

    private Direction(String name, int ordinal) { super(name, ordinal); }
    public static Direction[] values() { return VALUES.clone(); }
    public static Direction valueOf(String name) { /* lookup */ }
}
```

Each constant is a `static final` reference. They're all initialized in `<clinit>` once, on first use of the class.

---

## 2. Class initialization

The JVM guarantees enum class initialization is thread-safe (JLS §12.4.2). This is why one-constant enums are the easiest singleton pattern.

`<clinit>` runs once, ever, on the first reference to the class. After that, all constants are accessible as singletons.

---

## 3. EnumSet bitset implementation

For ≤64 constants:

```java
class RegularEnumSet<E extends Enum<E>> extends EnumSet<E> {
    private long elements;   // bitset

    public boolean contains(Object o) {
        return (elements & (1L << ((Enum<?>) o).ordinal())) != 0;
    }
    public boolean add(E e) {
        long prev = elements;
        elements |= (1L << e.ordinal());
        return prev != elements;
    }
    public int size() {
        return Long.bitCount(elements);
    }
}
```

`contains`, `add`, `remove` are single bitwise operations + `bitCount`. Compare to `HashSet`: hash + lookup + collision check.

Bulk operations (`addAll`, `retainAll`) become bitwise OR/AND on the entire bitset — single instructions for the whole set.

For >64 constants: `JumboEnumSet` uses `long[]`. Still much faster than HashSet.

---

## 4. EnumMap array-backed

```java
class EnumMap<K extends Enum<K>, V> extends AbstractMap<K, V> {
    private Object[] vals;

    public V get(Object key) {
        return (V) vals[((Enum<?>) key).ordinal()];
    }
    public V put(K key, V value) {
        Object old = vals[key.ordinal()];
        vals[key.ordinal()] = value;
        return (V) old;
    }
}
```

O(1) array access. No hashing. No collisions. Iteration is linear scan over the array — also faster than HashMap.

For enum-keyed maps, `EnumMap` is almost always the right choice.

---

## 5. JIT specialization on enums

The JIT knows the set of enum constants is closed. It can:
- Inline `==` checks against constants.
- Specialize switch into `tableswitch` with constant indices.
- Devirtualize per-constant method overrides via klass-based inline caching.

For a switch on an enum:
```java
switch (op) {
    case PLUS -> a + b;
    case MINUS -> a - b;
}
```

Compiles to bytecode using a `tableswitch` indexed by `ordinal()`. Sometimes the compiler emits a synthetic indirection table (because reordering the enum changes ordinals; the JIT preserves correctness).

---

## 6. Per-constant method dispatch

```java
public enum Op {
    PLUS  { public int apply(int a, int b) { return a + b; } },
    MINUS { public int apply(int a, int b) { return a - b; } };
    public abstract int apply(int a, int b);
}
```

Each constant is essentially an anonymous subclass:

```
Op$1 extends Op { public int apply(...) { return a + b; } }
Op$2 extends Op { public int apply(...) { return a - b; } }
```

Calls `op.apply(...)` go through `invokevirtual`. The JIT often devirtualizes when it can prove which constant is being used.

---

## 7. Enum and serialization

The default Java serialization for enums:
- Serializes the enum's `name()` (not its state)
- Deserializes via `Enum.valueOf(class, name)`
- Returns the same singleton instance

This means even `transient` and `private` fields aren't serialized — only the name. Custom serialization (`writeObject`, `readObject`) is forbidden for enums.

---

## 8. Enum and reflection

`Class.isEnum()` detects enum types. `Class.getEnumConstants()` returns all constants.

Important: `Constructor.newInstance` on an enum throws `IllegalArgumentException`. The JVM enforces "enum cannot be instantiated reflectively." This protects the singleton property.

---

## 9. Enum constructors run during class init

A subtle gotcha:

```java
public enum Service {
    DEFAULT;
    private final Connection conn = openConnection();   // runs at class init!
    private Connection openConnection() { ... }
}
```

If `openConnection` is slow or fails, the enum class fails to initialize, throwing `ExceptionInInitializerError` for all subsequent uses.

Don't do heavy work in enum constructors. Use lazy initialization if needed.

---

## 10. Enum vs sealed sealed records — performance

Enum dispatch:
- Single class, all instances the same class (or anonymous subclass for per-constant overrides).
- `==` comparison is one pointer compare.
- EnumSet/EnumMap are highly optimized.

Sealed records:
- Multiple classes, one per variant.
- Pattern matching via typeSwitch indy, ~1-2 ns after warmup.
- Each variant can carry typed data.

For pure label sets, enum wins on performance. For typed variants, sealed records are necessary.

---

## 11. Hot path enum dispatch

```java
double calc(Op op, double a, double b) {
    return op.apply(a, b);
}
```

If `op` is monomorphic (always PLUS in this call site), JIT inlines `Op$PLUS.apply`. If varied (megamorphic), full vtable dispatch.

For very hot dispatch, sometimes `if/else` chains are faster:

```java
if (op == Op.PLUS)  return a + b;
if (op == Op.MINUS) return a - b;
```

The JIT can inline both branches without dispatch. But this loses the open/closed nature of the enum.

---

## 12. Enums in concurrent code

Enum constants are immutable singletons — safe to share across threads without synchronization. They're naturally thread-safe.

Mutable per-constant state is dangerous:
```java
public enum Counter {
    INSTANCE;
    private int count;   // !! multi-thread mutation hazard
    public void inc() { count++; }
}
```

If you need mutation, use `AtomicInteger`. Enums make natural homes for *immutable* configuration, not for mutable state.

---

## 13. Enum and Collections.singleton for one-constant sets

For a single-element EnumSet, you can use:

```java
EnumSet<Day> just = EnumSet.of(Day.MONDAY);
// or
Set<Day> single = Collections.singleton(Day.MONDAY);
```

`EnumSet.of(one)` is preferred — same array-indexing performance characteristics as larger EnumSets.

---

## 14. Practical performance tips

- Use `EnumSet`/`EnumMap` for enum-typed collections.
- Avoid expensive work in enum constructors.
- Use `==` (not `equals`) for comparison.
- Use `name()` for persistence.
- For megamorphic enum dispatch, consider replacing `apply()` with switch in the caller.

---

## 15. What's next

| Topic                            | File              |
|----------------------------------|-------------------|
| Bytecode of enums                | `professional.md`  |
| JLS enum rules                   | `specification.md` |
| Interview prep                   | `interview.md`     |

---

**Memorize this**: enums are sugar for `final class extends Enum<X>` with fixed instances. EnumSet/EnumMap leverage the closed set for O(1) operations. JIT often devirtualizes enum dispatch. Use for closed sets of labels; use sealed records for typed variants. Avoid heavy work in constructors.
