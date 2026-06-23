# Record — Specification Deep-Dive

> JLS §8.10 governs records. JVMS §4.7.30 specifies the `Record` attribute. `java.lang.Record`, `java.lang.runtime.ObjectMethods`, and `java.lang.reflect.RecordComponent` Javadocs cover runtime APIs.

---

## 1. Where canonical text lives

| Topic                          | Source                |
|--------------------------------|-----------------------|
| Record declaration              | JLS §8.10            |
| Record components               | JLS §8.10.1          |
| Record body                     | JLS §8.10.2          |
| Auto-generated members          | JLS §8.10.3          |
| Canonical/compact constructor   | JLS §8.10.4           |
| Restrictions                    | JLS §8.10.5           |
| `Record` attribute              | JVMS §4.7.30          |
| `ACC_FINAL` enforcement         | JVMS §4.1             |
| `java.lang.Record`              | `java.lang.Record` Javadoc |
| `RecordComponent` reflection    | `java.lang.reflect.RecordComponent` Javadoc |
| `ObjectMethods.bootstrap`       | `java.lang.runtime.ObjectMethods` Javadoc |
| Pattern matching                | JLS §14.30, §15.20.2 |
| Record patterns                 | JLS §14.30.1.4        |

---

## 2. JLS §8.10 — record declaration

> A record declaration is a special kind of class declaration. It declares a record class. A record class is implicitly final and extends `java.lang.Record`. The record declaration includes a header listing components, which are the canonical state of the class.

Syntax:

```
RecordDeclaration:
    {ClassModifier} record TypeIdentifier [TypeParameters] RecordHeader [Superinterfaces] RecordBody

RecordHeader:
    ( [RecordComponentList] )

RecordComponentList:
    RecordComponent {, RecordComponent}

RecordComponent:
    {Annotation} UnannType Identifier
    VariableArityRecordComponent
```

Records can be top-level, nested static, or local (declared inside a method).

---

## 3. JLS §8.10.1 — record components

> A record component is the canonical state of a record. For each component, the compiler implicitly declares a private final field (the *component field*) and a public method (the *accessor*) of the same name as the component.

Components cannot:
- Be `transient`
- Have `protected` access modifier (records expose all components publicly via accessors)

The accessor method has signature `T component()` where T is the component's type.

---

## 4. JLS §8.10.3 — auto-generated members

For each record:

- **Canonical constructor** (unless declared explicitly): takes parameters in component order, assigns each to the field.
- **Compact constructor** form: declared without parameter list; assignment is implicit.
- **Accessor methods**: one per component, named after it.
- **`equals(Object)`**: returns true iff all components are equal (using `Objects.equals`).
- **`hashCode()`**: combines component hashes (using `Objects.hashCode`).
- **`toString()`**: includes class name and `[component=value, ...]`.

Programmer can override any of these explicitly.

---

## 5. JLS §8.10.4 — constructors

The *canonical constructor* has the same parameter list as the component list:

```java
public record Point(int x, int y) {
    public Point(int x, int y) {        // explicit canonical
        this.x = x;
        this.y = y;
    }
}
```

The *compact form* omits the parameter list:

```java
public record Point(int x, int y) {
    public Point {                       // compact canonical
        // body runs; implicit assignment after
    }
}
```

Restrictions:
- Cannot be `final` or `synchronized`.
- Cannot delegate via `this(...)` — that's reserved for non-canonical constructors.
- Compact form cannot have a `return` statement.

Other constructors must end in `this(...)`:

```java
public record Range(int lo, int hi) {
    public Range(int single) {
        this(single, single);
    }
}
```

---

## 6. JLS §8.10.5 — restrictions

A record class cannot:
- Be `abstract`
- Be `sealed` (but it can implement a sealed interface)
- Have explicit superclass other than `Record`
- Have additional instance fields (only components become fields)
- Have instance initializer blocks
- Have native methods
- Have `protected` components

Records can:
- Implement multiple interfaces
- Have static fields, methods, types
- Have nested types
- Have type parameters
- Override the auto-generated members

---

## 7. JVMS §4.7.30 — Record attribute

```
Record_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 components_count;
    record_component_info components[components_count];
}

record_component_info {
    u2 name_index;
    u2 descriptor_index;
    u2 attributes_count;
    attribute_info attributes[attributes_count];
}
```

The `Record` attribute lists the components. It's used by:
- `Class.isRecord()` — checks for the attribute
- `Class.getRecordComponents()` — reads the list
- Pattern matching — to drive deconstruction

---

## 8. `java.lang.Record`

```java
public abstract class Record {
    protected Record() { }
    public abstract boolean equals(Object obj);
    public abstract int hashCode();
    public abstract String toString();
}
```

All records extend this abstract class. The methods are abstract, forcing the compiler (or programmer) to provide implementations.

The class is special — only the compiler can synthesize subclasses (records). Hand-written extensions of `Record` are invalid.

---

## 9. `RecordComponent` reflection

```java
public final class RecordComponent {
    public String getName() { ... }
    public Class<?> getType() { ... }
    public Type getGenericType() { ... }
    public Method getAccessor() { ... }
    public Annotation[] getAnnotations() { ... }
    // ...
}

RecordComponent[] components = MyRecord.class.getRecordComponents();
```

Used heavily by serialization libraries (Jackson, GSON), validation libraries, and frameworks that need to inspect record structure.

---

## 10. `ObjectMethods.bootstrap`

```java
public static Object bootstrap(MethodHandles.Lookup lookup,
                                String methodName,
                                TypeDescriptor type,
                                Class<?> recordClass,
                                String names,
                                MethodHandle... getters);
```

Called by `invokedynamic` to generate `equals`, `hashCode`, or `toString` for a record. Returns a `MethodHandle` (or `CallSite`) implementing the requested method.

This bootstrap is what makes the auto-generated methods both compact in bytecode and efficient at runtime.

---

## 11. Pattern matching (JLS §14.30)

Patterns enable destructuring tests:

```java
case Point(int x, int y) -> ...;
case Pair(Point(int x1, int y1), Point(int x2, int y2)) -> ...;
```

The compiler emits accessor calls to extract each component. With sealed types, the compiler verifies exhaustiveness.

For records specifically, the components are always in declaration order. The pattern variables are bound after each accessor returns.

---

## 12. JEP timeline

- JEP 359: Records (Preview) — Java 14
- JEP 384: Records (Second Preview) — Java 15
- JEP 395: Records — Java 16 (standardized)
- JEP 405: Record Patterns (Preview) — Java 19
- JEP 432: Record Patterns (Second Preview) — Java 20
- JEP 440: Record Patterns — Java 21 (standardized)

---

## 13. Reading order

1. JLS §8.10 — record declaration
2. JLS §8.10.1 — components
3. JLS §8.10.3 — auto-generated members
4. JLS §8.10.4 — constructors
5. JLS §8.10.5 — restrictions
6. JVMS §4.7.30 — Record attribute
7. `java.lang.Record` Javadoc
8. `RecordComponent` Javadoc
9. `ObjectMethods.bootstrap` Javadoc
10. JLS §14.30 — patterns
11. JLS §14.30.1.4 — record patterns

---

**Memorize this**: records are specified in JLS §8.10. They're a class extending `Record` with implicit final, private final component fields, public accessors, and auto-generated equals/hashCode/toString. The `Record` attribute (JVMS §4.7.30) is what makes them reflectively recognizable. Compact constructors validate before assignment. Pattern matching uses accessors for deconstruction.
