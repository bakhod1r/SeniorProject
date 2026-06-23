# Interfaces — Specification Deep-Dive

> **JLS §9** is the canonical chapter on interfaces. Sections of interest: **§9.1** (declarations), **§9.4** (methods), **§9.4.1** (resolution), **§9.5** (interface body), **JLS §8.1.1.2** (sealed), **JVMS §4.1** (ACC_INTERFACE), **JVMS §4.7.31** (PermittedSubclasses), **JVMS §6.5** (invoke* opcodes).

---

## 1. Where canonical text lives

| Topic                             | Source              |
|-----------------------------------|---------------------|
| Interface declarations            | JLS §9.1            |
| Interface body                    | JLS §9.5            |
| Methods (abstract/default/static) | JLS §9.4            |
| Default-method resolution         | JLS §9.4.1          |
| Constants in interfaces           | JLS §9.5            |
| Sealed interfaces                 | JLS §8.1.1.2        |
| Functional interfaces             | JLS §9.8            |
| Pattern matching (sealed switch)  | JLS §14.30, §15.20.2 |
| Class file `ACC_INTERFACE`        | JVMS §4.1           |
| `PermittedSubclasses` attribute   | JVMS §4.7.31        |
| `invokeinterface`                 | JVMS §6.5           |
| `invokedynamic`                   | JVMS §6.5           |
| LambdaMetafactory                 | `java.lang.invoke.LambdaMetafactory` Javadoc |
| Hidden classes                    | JEP 371             |
| ServiceLoader                     | `java.util.ServiceLoader` Javadoc |

---

## 2. JLS §9.1 — interface declaration syntax

```
NormalInterfaceDeclaration:
    {InterfaceModifier} interface Identifier [TypeParameters] [ExtendsInterfaces] [PermitsClause] InterfaceBody
```

Interface modifiers: `public`, `protected`, `private`, `abstract`, `static`, `sealed`, `non-sealed`, `strictfp` (deprecated for use). `abstract` is implicit but allowed for emphasis.

---

## 3. JLS §9.4 — interface methods

> An interface body may contain method declarations. The body of a method declared in an interface may be empty (an abstract method declaration), in which case it is an abstract method, or non-empty (a default or static method).

Modifiers permitted on interface methods:
- `public` (implicit unless `private`)
- `private` (Java 9+)
- `static` (with body)
- `default` (with body)
- `abstract` (implicit unless body is provided)
- `strictfp` (deprecated)

Methods cannot be `final`, `synchronized`, or `native`.

---

## 4. JLS §9.4.1 — resolution of conflicts

> If a class C inherits methods with the same signature from multiple supertypes:
> - If one is from a superclass chain and others from interfaces, the class chain wins.
> - If multiple are from interfaces and one is from a sub-interface of the others, that one wins.
> - Otherwise, the class must override and disambiguate; otherwise compile error.

Maximally-specific method (§15.12.2.5) determines which interface default applies in ambiguous cases.

---

## 5. JLS §9.5 — interface body

The interface body may contain:
- Constant declarations (implicitly `public static final`)
- Method declarations
- Nested type declarations (classes, interfaces, enums, records)

No instance fields. No constructors. No instance initializer blocks.

---

## 6. JLS §9.8 — functional interfaces

> A *functional interface* is an interface that has just one abstract method (aside from those from Object), and thus represents a single function contract.

Defines what makes a SAM type. Methods that override `Object` methods (e.g., `equals`, `hashCode`) don't count toward the abstract method count.

```java
@FunctionalInterface
public interface Comparator<T> {
    int compare(T a, T b);
    boolean equals(Object obj);   // Object method — doesn't count
}
```

---

## 7. JLS §8.1.1.2 — sealed interfaces

Same rules as sealed classes:
- `permits` clause lists permitted direct subtypes
- Each permitted subtype must be `final`, `sealed`, or `non-sealed`
- Permitted subtypes must be in the same module (or same package for unnamed modules)

Compiler emits `PermittedSubclasses` attribute (JVMS §4.7.31).

---

## 8. JLS §14.30, §15.20.2 — pattern matching

Patterns over sealed types yield exhaustiveness. Switch over a sealed type without a default case must cover every permitted variant; otherwise compile error.

```java
sealed interface S permits A, B { }

String f(S s) {
    return switch (s) {
        case A a -> "a";
        case B b -> "b";
    };   // exhaustive — no default needed
}
```

---

## 9. JVMS §4.1 — ACC_INTERFACE

A class file with `ACC_INTERFACE` set:
- `super_class` must be `java/lang/Object`
- All methods must be `ACC_PUBLIC` (or `ACC_PRIVATE` Java 9+)
- Cannot be `ACC_FINAL`
- Cannot have a `<init>` method

The verifier enforces these rules.

---

## 10. JVMS §6.5.invokeinterface

```
invokeinterface
  Stack: ..., objectref, [arg1, [arg2 ...]] →
         ..., [return value]
  Description: Invoke an interface method on the receiver.
```

Resolution:
1. Resolve the interface method symbolic reference (§5.4.3.4).
2. Verify accessibility.
3. Search for a method matching the resolved name and descriptor in the receiver's class and its superclasses.
4. Invoke.

Throws `IncompatibleClassChangeError` if the method's receiver class isn't an interface, `AbstractMethodError` if no concrete impl found, etc.

---

## 11. JVMS §6.5.invokedynamic

```
invokedynamic
  Format: invokedynamic indexbyte1 indexbyte2 0 0
  Description: Invoke a dynamically-computed call site.
```

Used by:
- Lambdas (`LambdaMetafactory.metafactory`)
- Pattern matching switch (`SwitchBootstraps.typeSwitch`)
- String concatenation (`StringConcatFactory.makeConcatWithConstants`)
- Records (`ObjectMethods.bootstrap` for equals/hashCode/toString)

The bootstrap method is called on first invocation; the result is a `CallSite` bound to the call site.

---

## 12. LambdaMetafactory contract

`LambdaMetafactory.metafactory(...)` produces a `CallSite` whose `getTarget()` returns a `MethodHandle` of the requested factory type. Invoking that handle returns an instance of the target functional interface.

Internally:
1. Generates a hidden class implementing the functional interface.
2. The hidden class's SAM method delegates to the lambda's implementation.
3. Returns a factory that creates instances of this hidden class (or returns a singleton for non-capturing lambdas).

---

## 13. Hidden classes (JEP 371)

```java
Lookup.defineHiddenClass(byte[] bytes, boolean initialize, Lookup.ClassOption... options);
```

Hidden class properties:
- No symbolic name accessible via `Class.forName`
- Cannot be referenced by other classes via constant pool
- Can be unloaded independently when no live references exist

Used for lambdas, dynamic proxies, framework-generated code.

---

## 14. ServiceLoader contract

> A ServiceLoader maintains a cache of providers that have been loaded. Each invocation of the iterator method returns an iterator that first yields all of the elements of the cache, in instantiation order, and then lazily locates and instantiates any remaining providers, adding each one to the cache in turn.

Providers are declared:
- In `META-INF/services/Interface` files (legacy classpath)
- Via `provides ... with ...` in `module-info.java` (JPMS)

A provider must have a public no-arg constructor or a public static `provider()` method.

---

## 15. Reading order

1. JLS §9.1 — interface syntax
2. JLS §9.4 — methods
3. JLS §9.4.1 — resolution
4. JLS §9.5 — body
5. JLS §9.8 — functional interfaces
6. JLS §8.1.1.2 — sealed
7. JLS §14.30 / §15.20.2 — pattern matching
8. JVMS §4.1 — class file flags
9. JVMS §4.7.31 — PermittedSubclasses
10. JVMS §6.5 — invokeinterface, invokedynamic
11. `LambdaMetafactory` Javadoc
12. JEP 371 — hidden classes

---

**Memorize this**: JLS §9 is the interface chapter. Default methods, sealed types, functional interfaces, and pattern matching are all built on top of base interface mechanics. The bytecode is `ACC_INTERFACE` + `invokeinterface`/`invokedynamic`. Sealed types add `PermittedSubclasses`. Lambdas + pattern switches use bootstrap methods to generate code dynamically.
