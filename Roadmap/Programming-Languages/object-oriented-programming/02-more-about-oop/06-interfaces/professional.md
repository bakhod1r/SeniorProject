# Interfaces — Professional

> **What?** Class file representation of interfaces, `invokeinterface` semantics, itable construction, the LambdaMetafactory internals, hidden classes, and the bytecode of pattern-matching switch over sealed interfaces.
> **How?** Read class files with `javap -v`, study the JDK source for `LambdaMetafactory`, and trace runtime behavior with diagnostic flags.

---

## 1. Interface in the class file

An interface compiles to a class file with the `ACC_INTERFACE` flag (0x0200) set, plus `ACC_ABSTRACT` (0x0400):

```
$ javap -v -p Greeter.class | head -5
Classfile Greeter.class
  ...
  flags: (0x0601) ACC_PUBLIC, ACC_INTERFACE, ACC_ABSTRACT
```

Methods in an interface are implicitly `ACC_PUBLIC` (since Java 9, can also be `ACC_PRIVATE`). Abstract methods carry `ACC_ABSTRACT` and have no Code attribute. Default and static methods carry a Code attribute.

---

## 2. `implements` in bytecode

A class implementing an interface lists it in its `interfaces` array (constant pool indices):

```
public class Greeter implements Sayable {
  ...
  interfaces[1] = #5    // Sayable
}
```

Multiple interfaces appear as multiple entries.

---

## 3. `invokeinterface` semantics (JVMS §6.5)

```
invokeinterface
  Format:
    invokeinterface
    indexbyte1
    indexbyte2
    count
    0           // historical, must be 0
```

The dispatch:
1. Resolve the interface method symbolic reference.
2. Pop receiver and args.
3. Find the receiver's klass.
4. Search the klass's interface tables for the target interface.
5. Look up the method in that itable.
6. Invoke.

The `count` byte was historical (specifying argument count for stack manipulation); it's now ignored, must be 0.

---

## 4. itable construction

When a class is linked, the JVM builds an itable per implemented interface:

```
class Foo implements I, J {
  itable[I] = [Foo's I.m1, Foo's I.m2]
  itable[J] = [Foo's J.m1]
}
```

The itable is a contiguous block of method pointers. The JVM caches "for this receiver, where is interface I's table?" in inline caches per call site.

---

## 5. Default method dispatch

A default method has a body in the interface. When a class doesn't override:

```java
interface I { default String m() { return "I"; } }
class C implements I { }
```

`C`'s itable for I points to `I.m`. Calling `c.m()` dispatches there. JIT can inline.

---

## 6. Bridge methods for generic interfaces

```java
interface Function<T, R> { R apply(T t); }
class StrLen implements Function<String, Integer> {
    public Integer apply(String t) { return t.length(); }
}
```

After erasure, `Function.apply` has signature `Object apply(Object)`. `StrLen.apply(String)` doesn't match directly. The compiler synthesizes a bridge:

```
StrLen class file:
  Integer apply(String);     // user-written
  Object apply(Object);       // synthetic bridge
    Code: aload_1 checkcast String invokevirtual apply(String) areturn
```

The bridge ensures dispatch works regardless of which signature the caller uses.

---

## 7. `invokedynamic` and lambdas

```java
Function<String, Integer> f = String::length;
```

Compiles to:

```
0: invokedynamic #5,  0     // InvokeDynamic #0:apply:()Ljava/util/function/Function;
5: astore_1
```

The bootstrap method is `LambdaMetafactory.metafactory`. At first call:
1. Generates a hidden class implementing `Function`.
2. The hidden class's `apply` calls `String::length`.
3. The call site is bound; subsequent invocations use the cached hidden class.

Hidden classes:
- Have no symbolic name in any classloader.
- Cannot be referenced by other classes.
- Can be unloaded when their lookup is GC'd.

---

## 8. Method reference vs lambda

```java
Function<String, Integer> a = s -> s.length();           // lambda
Function<String, Integer> b = String::length;             // method reference
```

Both compile to `invokedynamic`. Method references are slightly more efficient because the metafactory can use a direct method handle without wrapping. Otherwise equivalent.

---

## 9. Pattern-matching switch over sealed interfaces

```java
sealed interface Shape permits Circle, Square { }
return switch (shape) {
    case Circle c -> ...;
    case Square s -> ...;
};
```

Compiles to `invokedynamic` with `SwitchBootstraps.typeSwitch`:

```
0: aload_1
1: iconst_0
2: invokedynamic #5,  0     // typeSwitch
7: tableswitch / lookupswitch
```

The bootstrap generates a classifier that returns 0 for Circle, 1 for Square, etc. The switch then jumps to the right case. After warmup, very efficient.

---

## 10. Sealed interface bytecode

The interface carries a `PermittedSubclasses` attribute:

```
PermittedSubclasses:
  #14   // class Circle
  #15   // class Square
```

The verifier rejects any class implementing the interface that isn't in this list.

---

## 11. ServiceLoader at the bytecode level

`ServiceLoader.load(I.class)` reads:
- `META-INF/services/I` files in the classpath (legacy)
- `provides ... with ...` declarations in `module-info.class` (JPMS)

For each provider class found, it loads the class and instantiates via the no-arg constructor (or `provider()` static method).

The classes themselves are normal — no special bytecode markers for SPI providers.

---

## 12. Constants in interfaces

```java
public interface Limits {
    int MAX = 100;
}
```

`MAX` is `public static final` implicitly:

```
public static final int MAX;
  flags: (0x0019) ACC_PUBLIC, ACC_STATIC, ACC_FINAL
  ConstantValue: int 100
```

Constants are loaded into Class objects at link time. Reading them doesn't trigger class init (constant variables, JLS §4.12.4).

---

## 13. Anonymous classes vs lambdas

Pre-Java 8:
```java
Runnable r = new Runnable() { public void run() { ... } };
```

Compiles to a separate inner class file (`Outer$1.class`). Each instance is allocated.

Java 8+:
```java
Runnable r = () -> { ... };
```

Compiles to `invokedynamic` + hidden class. The hidden class is generated on first use; non-capturing lambdas are cached.

Bytecode size: lambda version is *much* smaller in the calling class. Hidden class is lazy.

---

## 14. Where the spec says it

| Topic                              | Source                |
|------------------------------------|-----------------------|
| Interface declarations              | JLS §9               |
| Default methods                     | JLS §9.4              |
| Sealed interfaces                   | JLS §8.1.1.2          |
| `invokeinterface`                   | JVMS §6.5             |
| `invokedynamic`                     | JVMS §6.5             |
| Class file format                   | JVMS §4               |
| `ACC_INTERFACE` flag                | JVMS §4.1             |
| `PermittedSubclasses` attribute     | JVMS §4.7.31          |
| LambdaMetafactory                   | `java.lang.invoke.LambdaMetafactory` Javadoc |
| Hidden classes                       | JEP 371               |
| ServiceLoader                       | `java.util.ServiceLoader` Javadoc |

---

**Memorize this**: interfaces compile to class files with `ACC_INTERFACE`. `invokeinterface` looks up the itable for the target interface, then calls. Lambdas use `invokedynamic` + hidden classes; the JIT collapses well-warmed call sites. Sealed interfaces add `PermittedSubclasses`; pattern matching dispatches via typeSwitch indy.
