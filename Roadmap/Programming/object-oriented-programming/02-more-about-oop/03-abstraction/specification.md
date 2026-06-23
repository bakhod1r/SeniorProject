# Abstraction — Specification Deep-Dive

> Where the rules live: **JLS §8.1.1.1** (abstract classes), **JLS §8.4.3.1** (abstract methods), **JLS §9** (interfaces), **JLS §9.4** (default methods), **JLS §8.1.1.2** (sealed classes), **JVMS §4.6** (method info, ACC_ABSTRACT), **JVMS §5** (loading/linking), **JVMS §6.5** (`invoke*`).

---

## 1. Where to find canonical text

| Concept                         | Authoritative source            |
|---------------------------------|---------------------------------|
| Abstract class declaration      | JLS §8.1.1.1                    |
| Abstract method declaration     | JLS §8.4.3.1                    |
| Interface declaration           | JLS §9                          |
| Interface methods (default/static/private) | JLS §9.4                |
| Sealed classes                  | JLS §8.1.1.2                    |
| Method invocation               | JLS §15.12                      |
| Generics and erasure            | JLS §4.6                        |
| Pattern matching for switch     | JLS §14.30, §15.20.2            |
| Class file format (ACC_ABSTRACT) | JVMS §4.1, §4.6                |
| Method dispatch                 | JVMS §5.4.6, §6.5               |
| Lambda metafactory              | `java.lang.invoke.LambdaMetafactory` Javadoc |
| MethodHandle/VarHandle          | `java.lang.invoke` package      |

---

## 2. JLS §8.1.1.1 — abstract classes

> An abstract class is a class that is incomplete, or to be considered incomplete. Only abstract classes can have abstract methods. A class C has abstract methods if any of the following is true:
> - C explicitly contains a declaration of an abstract method.
> - Any of C's superclasses has an abstract method and C neither declares nor inherits a method that overrides it.
> - A direct superinterface of C declares or inherits a method (which is therefore abstract or default) and C neither declares nor inherits a concrete method that overrides it.

Restrictions:
- A class declared `abstract` cannot be instantiated (`new` resolution fails).
- An abstract method cannot be `private`, `static`, or `final`.
- An abstract class can have constructors (called from subclass constructors via `super`).

---

## 3. JLS §8.4.3.1 — abstract methods

> An abstract method has no body. The method declaration ends with a semicolon. It is a compile-time error if the body of an abstract method contains a block.

```java
abstract void foo();   // OK
abstract void bar() { } // ERROR
```

The class containing an abstract method must be declared `abstract` or be an interface. If the class extends another class with an abstract method that it neither overrides nor explicitly leaves abstract, it must be declared abstract.

---

## 4. JLS §9 — interfaces

Interfaces are reference types that declare an abstract type. They can contain:
- Constant declarations (implicitly `public static final`)
- Method declarations: abstract, default, static, private (Java 9+)
- Nested type declarations

A class `implements` an interface to declare it provides implementations of the interface's abstract methods.

```java
public interface Comparable<T> {
    int compareTo(T o);
}
```

All interface members are implicitly public unless declared `private`.

---

## 5. JLS §9.4 — interface methods

A method in an interface is one of:

| Kind     | Modifiers                  | Body |
|----------|----------------------------|------|
| Abstract | implicit `public abstract` | No   |
| Default  | `default`, implicit `public` | Yes  |
| Static   | `static`, implicit `public` | Yes  |
| Private  | `private`                   | Yes  |
| Private static | `private static`     | Yes  |

Default methods participate in inheritance like instance methods but with restrictions on diamond conflicts (must be disambiguated).

---

## 6. JLS §9.4.1 — inheritance and conflicts

When class `C` would inherit two methods with the same signature:

> 1. If one is from a superclass chain and one from an interface chain, **the class chain wins**.
> 2. If both are from interfaces, the **most specific** wins (the one declared in a subinterface of the other).
> 3. Otherwise, `C` must override the method to disambiguate; otherwise it's a compile error.

This rule prevents the C++-style diamond ambiguity at the cost of forcing explicit resolution.

---

## 7. JLS §8.1.1.2 — sealed classes

> A class declaration may include a `sealed` modifier, in which case its `permits` clause lists the directly extending classes.

Sealed restrictions:
- Each permitted subclass must directly extend the sealed class.
- Each permitted subclass must be declared `final`, `sealed`, or `non-sealed`.
- Permitted subclasses must be in the same module (or, for unnamed modules, the same package).

The compiler emits the `PermittedSubclasses` attribute (JVMS §4.7.31).

---

## 8. JVMS §4.6 — method_info and ACC_ABSTRACT

The method_info structure includes an access_flags field. `ACC_ABSTRACT` (0x0400) marks abstract methods.

Constraints (JVMS §4.6):
- An abstract method must not have a Code attribute.
- An abstract method's class must have `ACC_ABSTRACT` (or be an interface).
- An abstract method must not be `final`, `private`, `static`, `synchronized`, or `native`.
- An abstract method's signature must match a method that subclasses or implementors must provide.

---

## 9. JVMS §5.4.6 — method resolution

When a method symbolic reference is resolved (during link time):

1. Search the receiver class C for a matching method.
2. If not found, search C's superclasses recursively.
3. If still not found, search C's superinterfaces (with maximally specific matching).
4. If multiple candidates and none more specific, link error.

The resolved method is then bound to a vtable index (for class methods) or itable entry (for interface methods).

---

## 10. JVMS §6.5 — `invokevirtual` and `invokeinterface`

`invokevirtual`:
- Pop receiver and args.
- Look up class of receiver.
- Find the method matching the resolved symbolic reference (via vtable index).
- Invoke.

`invokeinterface`:
- Same lookup logic but searches the receiver's itable for the interface specified.
- Slightly more expensive due to interface-table search.

Both opcodes are subject to inline-cache optimization at runtime.

---

## 11. JLS §15.12 — method invocation

Method invocation expression resolution:

1. **Compile-time step**: identify the type and method to invoke based on declared types.
2. **Run-time step**: dispatch to the actual method based on receiver's class.

Three phases of compile-time resolution:
- Phase 1: strict invocation (no boxing, no varargs, exact match)
- Phase 2: loose invocation (allow boxing/unboxing)
- Phase 3: variable-arity invocation

The first phase that finds an applicable method wins. Within a phase, the most specific method is chosen.

---

## 12. Default method resolution algorithm (JLS §9.4.1.3)

> A class C inherits a method M from its superclass S or superinterface I if M is not overridden, hidden, or made abstract in C.

Resolution order:
1. Methods in C itself
2. Methods inherited from C's superclass chain
3. Methods inherited from interfaces (most specific wins; ambiguous → compile error)

Methods can be:
- **Implemented** (concrete override)
- **Inherited** (method body comes from supertype)
- **Abstract** (must be overridden)

---

## 13. JVMS §4.7.31 — PermittedSubclasses attribute

```
PermittedSubclasses_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    u2 classes[number_of_classes];
}
```

The verifier (JVMS §5.4.4) checks: when class `C` declares a `super_class` of `S` and `S` has a `PermittedSubclasses` attribute, `C`'s name must appear in `S`'s list. Otherwise, `IncompatibleClassChangeError`.

This makes the sealed contract enforceable at the bytecode level, not just by `javac`.

---

## 14. Pattern matching switch (JLS §14.30, §15.20.2)

A pattern is a structure that can both test a value and bind variables. The basic forms:

- `Type t` — type test pattern (binds `t` if value is `Type`)
- `Type t when condition` — guarded pattern
- `Record(Type1 a, Type2 b)` — record pattern (deconstructing)

Switch patterns dispatch via `invokedynamic` to `SwitchBootstraps.typeSwitch`, which generates a classifier returning the case index.

Exhaustiveness: for sealed types, the compiler verifies every permitted subclass is handled. For other types, a `default` case is required.

---

## 15. JLS §4.6 — type erasure

Generic type parameters are erased to their bound (or `Object` if unbounded):

| Source            | Erased         |
|-------------------|----------------|
| `T`               | `Object`       |
| `T extends Number`| `Number`       |
| `List<String>`    | `List`         |
| `Map<K, V>`       | `Map`          |

Method signatures use erased types. Bridge methods are synthesized to preserve subtyping after erasure.

---

## 16. Reading order for spec depth

1. JLS §8.1.1.1, §8.4.3.1 — abstract classes/methods
2. JLS §9 — interfaces
3. JLS §9.4, §9.4.1 — interface methods + resolution
4. JLS §8.1.1.2 — sealed classes
5. JLS §15.12 — method invocation
6. JLS §14.30 — pattern matching
7. JLS §4.6 — erasure
8. JVMS §4.6 — method_info (ACC_ABSTRACT)
9. JVMS §4.7.31 — PermittedSubclasses
10. JVMS §5.4.6 — method resolution
11. JVMS §6.5 — invoke* opcodes
12. `java.lang.invoke` Javadoc — MethodHandle, LambdaMetafactory, VarHandle, SwitchBootstraps

---

**Memorize this**: the JLS specifies *what* abstraction means in source code; the JVMS specifies *how* it's encoded and dispatched. Abstract methods carry no Code attribute; dispatch uses vtable/itable; sealed types use the PermittedSubclasses attribute; pattern matching uses invokedynamic. Read the spec when behavior surprises you — it's almost always there in plain text.
