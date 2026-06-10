# Record — Professional

> **What?** Class file representation of records, the `Record` attribute, `RecordComponent` info, how `equals`/`hashCode`/`toString` are generated via `ObjectMethods.bootstrap`, the bytecode of compact constructors, and how record patterns desugar.
> **How?** Read class files with `javap -v -p`, study `java.lang.runtime.ObjectMethods` source, and observe pattern-matching switch with `-XX:+PrintCompilation`.

---

## 1. Record class file shape

```java
public record Point(double x, double y) { }
```

Compiles to:

```
public final class Point extends java.lang.Record
  flags: (0x0031) ACC_PUBLIC, ACC_FINAL, ACC_SUPER

  private final double x;       // ACC_PRIVATE | ACC_FINAL
  private final double y;       // ACC_PRIVATE | ACC_FINAL

  public Point(double, double); // canonical constructor
  public double x();             // accessor
  public double y();             // accessor
  public final boolean equals(Object); // synthetic, indy
  public final int hashCode();         // synthetic, indy
  public final String toString();      // synthetic, indy

  Record:
    components:
      double x;
      double y;
```

Key markers:
- Extends `java.lang.Record`
- Class is `final`
- Fields are `private final`
- A new `Record` attribute lists components

---

## 2. The `Record` attribute (JVMS §4.7.30)

```
Record_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 components_count;
    record_component_info components[components_count];
}
```

Each `record_component_info` lists:
- name
- descriptor (type)
- attributes (signature for generics, annotations)

This is what `Class.getRecordComponents()` reads. It's how the runtime knows which fields are components.

---

## 3. Auto-generated `equals` via `ObjectMethods.bootstrap`

```
public final boolean equals(java.lang.Object);
  Code:
     0: aload_0
     1: aload_1
     2: invokedynamic #18, 0  // InvokeDynamic #0:equals:(LPoint;Ljava/lang/Object;)Z
     7: ireturn
```

The `invokedynamic` calls `ObjectMethods.bootstrap` with:
- The record class
- The component names ("x;y")
- Method handles to the accessors

The bootstrap returns a `MethodHandle` that compares all components. After the first call, the call site is bound; subsequent calls are direct.

`hashCode` and `toString` use the same mechanism.

---

## 4. Compact constructor in bytecode

```java
public record Range(int lo, int hi) {
    public Range {
        if (lo > hi) throw new IllegalArgumentException();
    }
}
```

Compiles to:

```
public Range(int, int);
  Code:
     0: iload_1                     // lo
     1: iload_2                     // hi
     2: if_icmple   13              // skip throw if lo <= hi
     5: new IllegalArgumentException
     8: dup
     9: invokespecial <init>
    12: athrow
    13: aload_0
    14: invokespecial Record.<init>  // super
    17: aload_0
    18: iload_1
    19: putfield     lo
    22: aload_0
    23: iload_2
    24: putfield     hi
    27: return
```

The compact form's body comes first, then the implicit assignment to fields. If the body throws, fields are never assigned (object construction fails).

---

## 5. Accessor bytecode

```
public int lo();
  Code:
     0: aload_0
     1: getfield  lo
     4: ireturn
```

Three bytecodes. JIT inlines trivially.

---

## 6. Record patterns in switch

```java
switch (shape) {
    case Circle(double r) -> ...;
    case Square(double s) -> ...;
}
```

Compiles to `invokedynamic` to `SwitchBootstraps.typeSwitch` (for type matching) plus accessor calls to extract components:

```
0: aload_1
1: iconst_0
2: invokedynamic #N, 0     // typeSwitch
7: tableswitch:
       0: 22         // Circle case
       1: 50         // Square case

22: aload_1                 // load receiver
23: checkcast Circle
26: invokevirtual r()       // extract component
29: dstore_2                // store r
30: ...case body...
```

The compiler inserts `checkcast` and accessor calls per component. The JIT inlines all of this for monomorphic shapes.

---

## 7. Generic records

```java
public record Pair<A, B>(A first, B second) { }
```

After erasure, the fields are `Object`. Accessors return `Object` (with generic signatures preserved in `Signature` attribute):

```
private final java.lang.Object first;
public java.lang.Object first();
  Signature: ()TA;
```

Type checks at the call site use `checkcast`. Same as any generic class.

---

## 8. `Class.getRecordComponents()`

```java
RecordComponent[] components = Point.class.getRecordComponents();
for (var c : components) {
    System.out.println(c.getName() + ": " + c.getType());
}
```

Returns the components in declaration order. Used by frameworks (Jackson, etc.) to map records to JSON / DB columns / etc.

---

## 9. Annotations on record components

```java
public record User(@NotNull String name, @JsonProperty("user_age") int age) { }
```

Annotations on the component apply to:
- The record component (for reflective access)
- The corresponding field
- The constructor parameter
- The accessor method (return position)

This is determined by the `@Target` of the annotation. Without explicit `@Target`, annotations apply to all four locations.

---

## 10. Record + reflection

`Constructor.newInstance` works for records (unlike enums). You can create record instances via reflection just like classes.

`Class.isRecord()` tells you if a class is a record. `Class.getRecordComponents()` gives the components.

---

## 11. Records and serialization

Default Java serialization uses the canonical constructor for deserialization. This means:
- Validation in compact constructor runs again during deserialization.
- `serialVersionUID` is checked against the class.
- `transient` is honored for fields, but doesn't make sense for records (all components are serialized).

For custom serialization:
- `writeObject` / `readObject` are forbidden.
- Use `Serialization Proxy Pattern` if needed (but rarely necessary for records).

---

## 12. Hidden classes and records

Records work normally in hidden classes (`Lookup.defineHiddenClass`). The `Record` attribute is preserved.

LambdaMetafactory-generated hidden classes can be records, though this is uncommon.

---

## 13. Where the spec says it

| Topic                            | Source                |
|----------------------------------|-----------------------|
| Record declaration                | JLS §8.10            |
| Components                        | JLS §8.10.1           |
| Canonical and compact constructors| JLS §8.10.4           |
| Auto-generated members            | JLS §8.10.3           |
| Restrictions                      | JLS §8.10.5           |
| `Record` attribute                | JVMS §4.7.30          |
| `ACC_RECORD` (ne `final`)         | not used; records use `ACC_FINAL` |
| `ObjectMethods.bootstrap`         | `java.lang.runtime.ObjectMethods` Javadoc |
| Pattern matching                  | JLS §14.30, §15.20.2 |
| Record patterns (deconstruction)  | JLS §14.30.1.4        |

---

**Memorize this**: records compile to a `final class extends Record` with `private final` fields per component. The `Record` attribute lists components for reflection. `equals`/`hashCode`/`toString` use `invokedynamic` to `ObjectMethods.bootstrap`. Compact constructors run before field assignment. Pattern matching uses typeSwitch + accessor calls. The JIT inlines all of this.
