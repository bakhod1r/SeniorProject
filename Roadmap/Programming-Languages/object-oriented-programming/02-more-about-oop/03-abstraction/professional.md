# Abstraction — Professional

> **What?** The bytecode and runtime mechanics behind abstract methods, interface dispatch tables, default-method resolution, lambda metafactory, and how the JVM's invokedynamic machinery turns an abstract type into a JIT-friendly call site.
> **How?** By reading the spec, disassembling with `javap`, and understanding `LambdaMetafactory`, `MethodHandle`, and `invokedynamic`.

---

## 1. The `abstract` modifier in bytecode

In a class file, `abstract` is encoded as flag `0x0400` (`ACC_ABSTRACT`) on the class or method.

For abstract methods, the `Code` attribute is **absent** — the method has no body. The verifier permits this only when the class itself is abstract or the method is in an interface.

```
$ javap -p Shape.class
abstract class Shape {
  abstract double area();           // ACC_ABSTRACT, no Code attribute
  java.lang.String describe();      // concrete, has Code
}
```

---

## 2. Interface methods and dispatch

Pre-Java 8: every interface method was implicitly `public abstract`. Bytecode-wise, it had `ACC_PUBLIC | ACC_ABSTRACT | ACC_INTERFACE`.

Java 8+: interfaces can have:
- `default` methods — `ACC_PUBLIC` only, with a `Code` attribute
- `static` methods — `ACC_STATIC | ACC_PUBLIC`
- `private` methods — `ACC_PRIVATE` (Java 9+)

Interface default methods are dispatched via `invokeinterface` like any other interface method.

---

## 3. itable layout

Each implementing class has an itable per implemented interface:

```
class Foo implements I, J {
  itable[I] = { Foo's impl of I.m1, Foo's impl of I.m2 }
  itable[J] = { Foo's impl of J.m1 }
}
```

Looking up `i.m1()` where `i: I` requires:
1. Find `I`'s itable in the receiver's klass.
2. Index into `I`'s table.
3. Call.

The first step (finding the itable for `I`) is a per-class search in the worst case. HotSpot inline-caches this lookup.

---

## 4. `invokedynamic` and lambdas

Java 8 introduced `invokedynamic` (already in JVM since Java 7). When you write a lambda:

```java
Function<Integer, Integer> sq = x -> x * x;
```

`javac` emits an `invokedynamic` bound to `LambdaMetafactory.metafactory`:

```
invokedynamic #2,  0     // InvokeDynamic #0:apply:()Ljava/util/function/Function;
```

At runtime, the metafactory generates a *hidden class* that implements `Function` and forwards `apply` to the lambda's body. This hidden class is created lazily, only when the call site is first reached.

After the first invocation, the call site is bound to the hidden class. From then on, subsequent invocations are direct.

---

## 5. The lambda generation cost

Each lambda call site:
- First invocation: ~50 µs (class generation, linkage)
- Subsequent: ~1 ns (JIT-inlined)

For high-throughput code, this is fine — the cost is amortized. For startup-sensitive code, lambdas can add 1–10 ms to startup. Tools like `-Xshare:auto` and AppCDS mitigate this.

---

## 6. `MethodHandle` and `VarHandle`

`MethodHandle` (Java 7+) is a typed reference to a method. Created via `MethodHandles.Lookup`:

```java
MethodHandle mh = MethodHandles.lookup()
    .findVirtual(String.class, "length", MethodType.methodType(int.class));
int len = (int) mh.invokeExact("hello");
```

After JIT, `mh.invokeExact` can be as fast as a direct call. Used in:
- `String.format`'s implementation (Java 9+ uses indy/`String concat`)
- `LambdaMetafactory`
- High-performance reflection alternatives

`VarHandle` (Java 9+) does the same for fields, with memory-ordering options (acquire/release/volatile).

---

## 7. Default method resolution algorithm

JLS §9.4.1: when class `C` inherits methods with the same signature from multiple supertypes:

1. **Class wins.** If a non-abstract method comes from a class chain (rather than interface), it wins.
2. **Most specific interface wins.** If two interfaces provide defaults and one extends the other, the more specific (subinterface) wins.
3. **Otherwise, ambiguous.** Class must override and disambiguate.

Bytecode-wise, the resolution happens at link time. The vtable/itable slot points to the chosen method.

---

## 8. Bridge methods for covariance

When a subclass narrows the return type, the compiler generates a bridge method:

```java
class A { Object get() { return null; } }
class B extends A { @Override String get() { return "x"; } }
```

```
B class file:
  public java.lang.String get();        // user-written
  public java.lang.Object get();        // synthetic bridge — calls get():String, returns as Object
```

This preserves binary compatibility: code compiled against `A.get()` still gets a method with signature `()Ljava/lang/Object;`.

---

## 9. Generics, erasure, and abstraction

Generic type parameters are erased at runtime. `List<String>` and `List<Integer>` are both `List` after erasure. This means:

- Abstract methods with generic parameters compile to `Object` versions in bytecode
- Bridge methods cast and dispatch
- `instanceof T` (where T is a type parameter) doesn't work — `T` doesn't exist at runtime

For deeply generic abstractions, this leakage matters:

```java
public <T> List<T> empty() { return List.of(); }
```

Erased to `List<Object> empty()`. The cast at the call site is a `checkcast` bytecode.

---

## 10. Sealed types in bytecode

The `PermittedSubclasses` attribute (JVMS §4.7.31) lists classes allowed to extend a sealed class:

```
PermittedSubclasses_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    u2 classes[number_of_classes];
}
```

The verifier rejects any class whose superclass declares this attribute and doesn't list the subclass. This makes the closed-world assumption verifiable at link time.

Pattern-matching `switch` over a sealed type compiles to an `invokedynamic` to `SwitchBootstraps.typeSwitch`, which generates a fast classifier.

---

## 11. Hidden classes and frameworks

`Lookup.defineHiddenClass` (Java 15+) creates a class that:
- Has no name in any classloader
- Cannot be referenced by other classes
- Can be unloaded when the lookup or method handle is GC'd

Used internally for:
- Lambda metafactory's generated impls
- `String.format` indy bootstrap
- Dynamic proxies (planned migration from `java.lang.reflect.Proxy`)

Hidden classes live in the same metaspace region but bypass classloader caches.

---

## 12. The JIT and abstract dispatch

When the JIT compiles a method containing an abstract or virtual call:

1. It checks the inline cache state.
2. If monomorphic — emits a klass-pointer compare + direct call (or inline).
3. If bimorphic — branch on klass.
4. If megamorphic — emit vtable/itable lookup.

Useful flags:

```
-XX:+UnlockDiagnosticVMOptions
-XX:+PrintInlining            # inlining decisions
-XX:+PrintCompilation         # compile events
-XX:CompileCommand=print,Class.method   # disassemble specific method
```

Adding `hsdis` (HotSpot disassembler) enables actual machine code output.

---

## 13. Abstract methods and verification

JVMS §4.10 verification rejects:
- An abstract method with a `Code` attribute
- A non-abstract method without a `Code` attribute (except native)
- An abstract class instantiated via `new` (caught by `invokespecial` resolution)
- A class implementing an interface but missing implementations (only at link time when actual instantiation occurs)

The runtime throws `AbstractMethodError` if dispatch lands on an abstract method (e.g., due to binary incompatibility).

---

## 14. Frameworks built on abstraction primitives

| Framework      | Abstraction technique                              |
|----------------|----------------------------------------------------|
| Spring         | Bean interfaces + dynamic proxies (CGLIB/JDK proxy) |
| Hibernate      | Entities + abstract sessions + JPA contracts       |
| Mockito        | Subclass-based mocking (CGLIB) or interface-based   |
| ByteBuddy      | Runtime class generation                           |
| Lombok         | Annotation processing → generated boilerplate      |

All of these rely on the JVM's abstract-method machinery. Understanding `invokedynamic`, hidden classes, and the inline cache lets you debug their performance.

---

## 15. Where the spec says it

| Topic                                | Source                |
|--------------------------------------|-----------------------|
| `abstract` class/method               | JLS §8.1.1.1, §8.4.3.1 |
| Interface declarations                | JLS §9               |
| Default methods                       | JLS §9.4              |
| Sealed types                          | JLS §8.1.1.2          |
| `invokevirtual`/`invokeinterface`     | JVMS §6.5             |
| `invokedynamic`                       | JVMS §6.5             |
| Lambda metafactory                    | `java.lang.invoke.LambdaMetafactory` Javadoc |
| MethodHandle / VarHandle              | `java.lang.invoke` package Javadoc |
| Class file attributes (incl. `PermittedSubclasses`) | JVMS §4.7 |

---

**Memorize this**: abstract methods are bytecode metadata; dispatch happens via vtable/itable; lambdas use `invokedynamic` + hidden classes; the JIT collapses well-designed abstractions to direct calls. Read `javap -v -p` to verify the metadata; use `-XX:+PrintInlining` to verify the JIT can collapse it.
