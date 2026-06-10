# Inheritance — Professional

> **What?** The bytecode-level mechanics of `extends`, `super`, and `invokevirtual`/`invokespecial`/`invokeinterface`; vtable construction at class-link time; the JLS rules on subtype compatibility, covariance/contravariance/invariance, and erasure interactions; the design rationale behind sealed classes and JEP 412 pattern matching.
> **How?** By reading the spec and confirming with `javap`, `-XX:+PrintAssembly`, and JFR class-load events.

---

## 1. The `extends` keyword in bytecode

A class file carries a single `super_class` field (constant pool index → CONSTANT_Class):

```
Classfile MyClass.class
  ...
  this_class:  #2    // MyClass
  super_class: #5    // ParentClass
```

If absent, the implicit super is `java/lang/Object`. There's no "extends" instruction at runtime — the relationship is encoded in metadata, used by the loader/linker.

---

## 2. Class loading, linking, and inheritance

JVMS §5.3 specifies that loading `MyClass` triggers loading of its superclass:

> If `C` is not an array class, recursively load its direct superclass and direct superinterfaces using the same class loader.

Linking (verification + preparation + resolution) happens after loading. Vtable layout is determined during the **preparation** phase: each class's method table is built by:

1. Copying the parent's vtable.
2. For each method declared by `MyClass`, either:
   - Add a new slot (if no parent method has the same signature), or
   - Override an existing slot (if it does).

Verification ensures the override is type-compatible (return covariance, throws narrowing, etc.).

---

## 3. `invokevirtual` semantics

JVMS §6.5.invokevirtual:

> The objectref must be of type `reference`. The runtime constant pool item at that index must be a symbolic reference to a method or interface method, which gives the name and descriptor of the method as well as a symbolic reference to the class in which the method is to be found.

The JVM resolves the method symbolic reference to a *vtable index* during preparation/resolution. Then the call dispatches:

```
1. Resolve method ref → vtable slot N.
2. Pop objectref from stack.
3. Read objectref's klass pointer from header.
4. Index klass's vtable at slot N.
5. Push args, jump to method.
```

Bytecode example:

```java
class Animal { void speak() {} }
class Dog extends Animal { @Override void speak() {} }

void test(Animal a) { a.speak(); }
```

```
0: aload_1                      // a
1: invokevirtual #5             // Method Animal.speak:()V
4: return
```

The reference is to `Animal.speak`, but at runtime, if `a` is a `Dog`, dispatch lands in `Dog.speak`.

---

## 4. `invokespecial` for `super` calls

When you write `super.m()`, the bytecode emits `invokespecial`, *not* `invokevirtual`. `invokespecial` performs **no** vtable lookup — it calls the method directly as resolved at link time.

```java
class Dog extends Animal {
    @Override
    void speak() {
        super.speak();         // invokespecial Animal.speak
        // ...
    }
}
```

Same instruction is used for:
- `super.method(...)` calls
- Constructor calls (`<init>`)
- Private method calls (in some bytecodes, also `invokevirtual` since Java 11+)

JVMS §6.5.invokespecial enforces: the method must be in the current class, an ancestor, or `Object`.

---

## 5. `invokeinterface` semantics

Interface method dispatch is more complex than virtual dispatch because:
- A class can implement many interfaces.
- An interface's method slot in the receiver's itable depends on which interface.

JVMS §6.5.invokeinterface:

```
1. Resolve interface method ref to (interface, method).
2. Pop objectref.
3. Find the interface's itable in objectref's klass.
4. Look up the method.
5. Invoke.
```

Modern HotSpot caches the resolved (klass, method) pair in an inline cache. After the first call, dispatch is essentially a klass-pointer compare + direct call.

---

## 6. JLS subtype rules

JLS §4.10 defines the subtype relation `<:` :

- Reflexive: `T <: T`.
- Class/interface: if `B extends A`, then `B <: A`.
- Array covariance: `B[] <: A[]` if `B <: A` (this is the famously unsound rule that enables `ArrayStoreException`).
- Generics: invariant — `List<B>` is **not** a subtype of `List<A>` even if `B <: A`. Wildcards (`? extends`, `? super`) provide use-site variance.
- Primitives: chain like `byte <: short <: int <: long`, etc., for *widening conversions* — not strict subtyping.

`null` is a subtype of every reference type.

---

## 7. Covariant return types

JLS §8.4.5: an override may declare a return type that is a *subtype* of the parent's return type.

```java
class A { Object clone() { return new Object(); } }
class B extends A { @Override B clone() { return new B(); } }
```

Bytecode reveals what's going on:

```
B.clone()
  Code:
    ...
    areturn          // returns reference of type B

// Synthesized "bridge method" for the parent's signature:
Object clone() {
    return clone();   // calls the B-returning override and returns it as Object
}
```

The `B clone()` method gets a synthetic *bridge method* with the parent's exact signature, which delegates to the actual override. This preserves binary compatibility.

---

## 8. Generics and bridge methods

Bridge methods are also why erasure and inheritance interact strangely.

```java
class Box<T> { void put(T x) { } }
class IntBox extends Box<Integer> {
    @Override void put(Integer x) { }
}
```

`Box<T>` erases to `Box`, so `Box.put` has signature `put(Object)`. `IntBox.put(Integer)` doesn't match `put(Object)` directly — bytecode-wise, they'd be different methods. The compiler synthesizes a bridge:

```
IntBox:
  put(Integer) { /* user code */ }
  put(Object) { /* synthetic bridge */
      checkcast Integer
      invokevirtual put(Integer)
  }
```

The bridge ensures dispatch works regardless of whether the caller invokes through `Box` or `IntBox`.

---

## 9. Interface default methods and inheritance

Java 8 introduced `default` methods on interfaces. Resolution rules (JLS §9.4.1.3):

1. **Class wins over interface.** If a class declares or inherits the method from a class chain, that wins.
2. **More specific interface wins.** If two interfaces both provide defaults, the one further down the inheritance chain wins.
3. **Otherwise, the implementer must override** to disambiguate.

Bytecode-wise, default methods are stored on the interface's class file and dispatched via `invokevirtual` (Java 8+) or `invokeinterface`, with a slot in the implementer's itable.

---

## 10. Sealed types in bytecode

A `sealed` class has `PermittedSubclasses` attribute in its class file (JVMS §4.7.31, added in Java 17):

```
PermittedSubclasses_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    u2 classes[number_of_classes];
}
```

The verifier enforces: a class with a `super_class` of a sealed class must be in that sealed class's `PermittedSubclasses` list.

```bash
$ javap -v Shape.class | grep -A 4 PermittedSubclasses
PermittedSubclasses:
  #14   // class Circle
  #15   // class Square
  #16   // class Triangle
```

---

## 11. Pattern matching `switch` and bytecode

Java 21's pattern-matching switch compiles to a `switch` over class hashes plus `instanceof` chains, often using `invokedynamic` and `SwitchBootstraps`:

```
0: aload_1
1: invokedynamic #5,  0     // typeSwitch
6: tableswitch:
       0: 28
       1: 35
       2: 42
   default: 50
```

The bootstrap method generates a runtime classifier that returns the matched index. Each case body is a label.

This indirection allows sealed-type exhaustiveness checking, guards (`when`), and binding all in a single switch.

---

## 12. The Method Resolution algorithm

JLS §15.12 describes overload resolution at compile time:

1. Find all *applicable* methods (signatures that can accept the argument types).
2. Among applicable, find the *most specific* (no other applicable method is more specific).
3. If exactly one — that's the chosen method.
4. If ambiguous — compile error.

**Specificity rules:**
- Subtype relations on parameters.
- Method type parameter substitutions.
- Three phases:
  1. Strict invocation: only direct subtypes, no boxing/varargs.
  2. Loose invocation: allow boxing/unboxing.
  3. Variable-arity: allow varargs.

A method found in phase 1 always wins over phase 2/3, even if "less specific" by other measures.

---

## 13. Fields vs methods at the bytecode level

| Operation       | Bytecode                  | Resolved at | Polymorphic? |
|-----------------|---------------------------|-------------|--------------|
| Read instance field  | `getfield`            | Static type | No           |
| Write instance field | `putfield`            | Static type | No           |
| Read static field    | `getstatic`           | Static type | No           |
| Write static field   | `putstatic`           | Static type | No           |
| Call instance method | `invokevirtual`       | Receiver    | Yes          |
| Call interface method| `invokeinterface`     | Receiver    | Yes          |
| Call static method   | `invokestatic`        | Static type | No           |
| Call constructor     | `invokespecial`       | Static type | No           |
| Call super method    | `invokespecial`       | Static type | No           |

Field access is always static (declared type wins). Method invocation is virtual unless one of the special opcodes applies.

---

## 14. Class hierarchy in HotSpot internals

In HotSpot, every class has a `Klass` C++ object containing:
- Pointer to its superclass `Klass`.
- Method tables (vtable, itable).
- Field offsets, packed for alignment.
- Constant pool, name, attributes.

Subclass `Klass` objects link to parent via `_super`. Vtable is built greedily — child copies parent's table, then patches overridden slots.

For research, see `oop.hpp`, `klass.hpp`, `instanceKlass.hpp` in the OpenJDK source.

---

## 15. Where to look in the spec

| Topic                              | Spec                                |
|------------------------------------|-------------------------------------|
| Class declaration / `extends`       | JLS §8.1.4                          |
| Override compatibility              | JLS §8.4.8                          |
| Subtyping rules                     | JLS §4.10                           |
| Inheritance for fields/methods      | JLS §8.2, §8.4.8                    |
| Default methods resolution          | JLS §9.4.1                          |
| Sealed classes                      | JLS §8.1.1.2                        |
| `invokevirtual` / `invokespecial`   | JVMS §6.5                           |
| Class loading / linking             | JVMS §5                             |
| `PermittedSubclasses` attribute     | JVMS §4.7.31                        |
| Vtable & method resolution          | JVMS §5.4.5                         |
| Method overload resolution          | JLS §15.12                          |

---

**Memorize this**: at the bytecode level, `extends` is a single constant-pool reference; vtables are built at link time; `invokevirtual` is a vtable lookup; `invokespecial` is a direct call. Sealed types add a `PermittedSubclasses` attribute used by the verifier and the pattern-matching compiler. Generics + inheritance produce bridge methods. Java's binary compatibility rules are the contract that lets the JVM optimize all of this.
