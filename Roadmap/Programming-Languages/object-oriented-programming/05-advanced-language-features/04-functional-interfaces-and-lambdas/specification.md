# Functional Interfaces and Lambdas — Specification Reading Guide

> Lambdas are a *language* feature (JLS) implemented by a *runtime* contract (JVMS) and shipped as one named JDK API (`java.lang.invoke.LambdaMetafactory`). This file maps each claim made in the earlier files to the exact JLS section, JVMS section, or JEP number that authorises it. When two seniors disagree about lambda behaviour, the answer is in one of the sections below.

---

## 1. Where to find the canonical text

| Topic                                              | Authoritative source                            |
|----------------------------------------------------|--------------------------------------------------|
| Functional interfaces (SAM rule)                   | **JLS §9.8**                                     |
| Lambda expressions (syntax, target type, evaluation) | **JLS §15.27**                                  |
| Method references (four flavours, resolution)      | **JLS §15.13**                                   |
| Effectively final variables                        | JLS §4.12.4                                      |
| Capture of `this` and local variables              | JLS §15.27.2                                     |
| Target typing and poly expressions                 | JLS §15.27.3, §15.12.2.1                         |
| Type inference for lambda parameters               | JLS §18                                          |
| `default` and `static` methods on interfaces       | JLS §9.4.3                                       |
| `Object` methods don't count toward SAM            | JLS §9.8 (third paragraph)                       |
| `invokedynamic` instruction                        | **JVMS §6.5** (`invokedynamic`)                  |
| `BootstrapMethods` class-file attribute            | **JVMS §4.7.23**                                 |
| `MethodHandle` and `CallSite`                      | `java.lang.invoke` Javadoc                       |
| `LambdaMetafactory.metafactory` / `altMetafactory` | `java.lang.invoke.LambdaMetafactory` Javadoc     |
| `SerializedLambda`                                 | `java.lang.invoke.SerializedLambda` Javadoc      |
| `java.util.function` package                       | `java.util.function` Javadoc                     |

The **JLS** is what `javac` enforces. The **JVMS** is what the JVM enforces at link time. Everything *between* — how `javac` emits an `invokedynamic` for each lambda, what arguments it puts in the `BootstrapMethods` attribute, what bytecode the metafactory spins — is a JDK *implementation choice* deliberately left under-specified so future JDKs can change it (JEP 181).

---

## 2. The relevant JEPs

| JEP    | Title                                                   | Status            |
|--------|---------------------------------------------------------|-------------------|
| **126** | Lambda Expressions & Virtual Extension Methods         | Delivered in Java 8 |
| **109** | Enhance Core Libraries with Lambda                      | Delivered in Java 8 |
| **181** | Nest-Based Access Control / `invokedynamic` strategy for lambdas (informal name) | Delivered in Java 8 — but see note |
| 213    | Milling Project Coin                                    | Delivered in Java 9 (minor lambda tweaks) |
| 286    | Local-Variable Type Inference (`var`)                   | Java 10 (interacts with lambda parameter inference) |
| 323    | Local-Variable Syntax for Lambda Parameters             | Java 11 (`(var x, var y) -> ...`) |
| 269    | Convenience Factory Methods for Collections             | Java 9 (often combined with lambdas) |

> Note on JEP 181: the JEP titled "Nest-Based Access Control" is **not** the lambda invokedynamic strategy — that was scoped under JEP 126's umbrella implementation and is documented in `java.lang.invoke.LambdaMetafactory`. The colloquial reference "JEP 181" for the lambda-metafactory mechanism is a community shorthand that can mislead; the *authoritative* source is the Javadoc for `LambdaMetafactory` plus JEP 126's "Translation of Lambda Expressions" section.

For everyday work, the two JEPs you need to know are **126** (the language change that introduced lambdas) and **109** (the matching library changes — `java.util.function`, `forEach`, `Stream`).

---

## 3. JLS §9.8 — functional interfaces

§9.8 defines a *functional interface* as one with exactly one *abstract method*. The precise rule:

- The interface declares (or inherits) **exactly one** abstract method other than the public methods of `Object`.
- `default` methods (§9.4.3) do not count.
- `static` methods do not count.
- *Public* methods inherited from `Object` (`equals`, `hashCode`, `toString`, …) do not count, even if redeclared as abstract.

```java
@FunctionalInterface
public interface MyComparator<T> {
    int compare(T a, T b);          // the SAM

    boolean equals(Object o);       // explicitly redeclared — STILL a functional interface
    default int reversedCompare(T a, T b) { return -compare(a, b); }   // doesn't disqualify
    static MyComparator<Object> natural() { return Comparator::compare; } // doesn't disqualify
}
```

The `@FunctionalInterface` annotation makes the rule a compile-time enforcement — if a future change adds a second abstract method, `javac` issues the error `Multiple non-overriding abstract methods found in interface ...`. Use it on every interface you intend lambdas to target.

---

## 4. JLS §15.27 — lambda expressions

§15.27 specifies lambda syntax and semantics:

- **§15.27.1 (Lambda Parameters).** Parameters may be implicit-typed (`(a, b) -> ...`), explicit-typed (`(int a, int b) -> ...`), or `var`-typed since Java 11 (`(var a, var b) -> ...`). All three flavours must agree on having or not having modifiers like `final`.
- **§15.27.2 (Lambda Body).** Either an expression or a block. A block body must complete normally with a `return` of an expression compatible with the SAM's return type (or, for `void`, with no return value).
- **§15.27.3 (Type of a Lambda Expression).** A lambda expression has **no standalone type** — it is a *poly expression* whose type is its *target type*, which must be a functional interface. The compiler then checks the lambda is *compatible* with that target.
- **§15.27.4 (Run-Time Evaluation).** Evaluation may either return a fresh instance or an existing one; the JLS is intentionally silent on whether non-capturing lambdas are singletons (an implementation choice).

The "poly expression" rule means a lambda can have *different types* in different contexts:

```java
Function<String, Integer>   asFunction  = s -> s.length();
Comparator<String>          asCmpFails;  // wouldn't compile — wrong SAM shape
ToIntFunction<String>       asInt       = s -> s.length();
```

The same source text `s -> s.length()` is two different objects with two different runtime types depending on the target.

---

## 5. JLS §15.13 — method references

§15.13 specifies the four method reference kinds:

- **§15.13.1**  
  | Form                              | Example              | Semantics                        |
  |-----------------------------------|----------------------|-----------------------------------|
  | `TypeName :: staticMethod`        | `Integer::parseInt`  | Call the static method            |
  | `Primary :: instanceMethod`       | `obj::method`        | Bind to the specific instance     |
  | `ReferenceType :: instanceMethod` | `String::length`     | Receiver is the lambda argument   |
  | `ClassType :: new`                | `ArrayList::new`     | Call the constructor              |
  | `ArrayType :: new`                | `String[]::new`      | Allocate an array of given size   |

- **§15.13.2 (Compile-Time Declaration).** When the method is overloaded, resolution picks the *most specific applicable* method given the target functional interface's parameter types — same algorithm as method-invocation overload resolution.
- **§15.13.3 (Run-Time Evaluation).** Like lambdas, method references are *poly expressions* — they have no standalone type.

§15.13 also covers the array constructor form `String[]::new`, which targets `IntFunction<String[]>` and is used by `Stream.toArray`.

---

## 6. JVMS §6.5 — `invokedynamic`

`invokedynamic` (JVMS §6.5, opcode 0xBA) is the bytecode instruction every lambda compiles to. Its operand is an index into the constant pool pointing at a `CONSTANT_InvokeDynamic_info` structure, which in turn references the class's `BootstrapMethods` attribute (§4.7.23) for the bootstrap method handle and static arguments.

The runtime contract:

- On **first execution** at a given site, the JVM calls the bootstrap method with three standard arguments (`MethodHandles.Lookup`, `String invokedName`, `MethodType invokedType`) plus the static arguments from the constant pool entry.
- The bootstrap returns a `java.lang.invoke.CallSite`. The JVM **links** the site to that `CallSite.getTarget()` `MethodHandle`.
- On every subsequent execution, the site invokes the linked target. There is no further bootstrap call unless the call site is mutable (`MutableCallSite`/`VolatileCallSite`).

For lambdas, the bootstrap is `LambdaMetafactory.metafactory` and the returned `CallSite` is a `ConstantCallSite`, so the link is permanent.

---

## 7. JVMS §4.7.23 — `BootstrapMethods`

The `BootstrapMethods` class-file attribute carries the table of bootstrap methods referenced by `CONSTANT_InvokeDynamic_info` entries. Each entry contains:

- A `bootstrap_method_ref` — index into the constant pool pointing at a `CONSTANT_MethodHandle_info` (the bootstrap method handle itself).
- A `bootstrap_arguments` array — typed indices into the constant pool for the static arguments.

For lambdas, the bootstrap method handle is `LambdaMetafactory.metafactory` (or `altMetafactory` for serialisable / multi-interface lambdas), and the static arguments are:

1. `MethodType samMethodType` — erased SAM signature.
2. `MethodHandle implMethod` — handle to the generated `lambda$N$M` static method.
3. `MethodType instantiatedMethodType` — pre-erasure SAM signature for the actual lambda.

`javap -p -v Demo.class` will print this attribute and show exactly which static arguments your lambda site uses.

---

## 8. `java.lang.invoke.LambdaMetafactory` — the bridge

`LambdaMetafactory.metafactory` is normatively specified by its Javadoc, not by the JLS or JVMS. The contract:

```java
public static CallSite metafactory(
    MethodHandles.Lookup caller,
    String invokedName,
    MethodType invokedType,
    MethodType samMethodType,
    MethodHandle implMethod,
    MethodType instantiatedMethodType) throws LambdaConversionException
```

Implementation: produces a `ConstantCallSite` whose target is either (a) a `MethodHandle` returning a singleton instance for non-capturing lambdas, or (b) a `MethodHandle` that invokes the spun class's constructor with the captures.

`altMetafactory` extends this with a flag bitmask used by `Serializable`, marker interfaces, and bridge methods:

```java
public static final int FLAG_SERIALIZABLE       = 1;
public static final int FLAG_MARKERS            = 2;
public static final int FLAG_BRIDGES            = 4;
```

The Javadoc is binding for behaviour; the actual spun class is an implementation detail.

---

## 9. `java.util.function` — the catalogue

The `java.util.function` package (Javadoc) groups the standard functional interfaces into 43 types covering common shapes:

- **Generic family.** `Function<T, R>`, `BiFunction<T, U, R>`, `Consumer<T>`, `BiConsumer<T, U>`, `Supplier<T>`, `Predicate<T>`, `BiPredicate<T, U>`, `UnaryOperator<T>`, `BinaryOperator<T>`.
- **`int` family.** `IntFunction<R>`, `ToIntFunction<T>`, `IntConsumer`, `IntSupplier`, `IntPredicate`, `IntUnaryOperator`, `IntBinaryOperator`, `IntToLongFunction`, `IntToDoubleFunction`.
- **`long` family.** Mirror of the `int` family with `Long`.
- **`double` family.** Mirror of the `int` family with `Double`.
- **Cross-primitive.** `ToIntBiFunction<T, U>`, `ObjIntConsumer<T>`, `ObjLongConsumer<T>`, `ObjDoubleConsumer<T>`.

The Javadoc spells out each SAM and the default-method utilities (`andThen`, `compose`, `and`, `or`, `negate`, `Predicate.not`). Read it before inventing your own functional interface.

---

## 10. Reading the spec on a specific lambda

Suppose a colleague asserts that a particular lambda is allocation-free. To verify against the spec:

1. **Confirm it's non-capturing** (§15.27.2: a lambda *captures* a variable when the variable's effective value is read inside the body).
2. **Check JVMS §6.5**: non-capturing lambdas compile to an `invokedynamic` site with no capture arguments.
3. **Read `LambdaMetafactory` Javadoc**: it documents that non-capturing call sites return a singleton — but this is *behaviour* of the standard implementation, not a JVMS guarantee. Treat as a *strong* expectation, not a contract.
4. **Verify with `javap -v`**: the `BootstrapMethods` entry's static args show the impl method and signatures; the site's invocation type shows no capture parameters.

That's the workflow for "is this lambda actually free?" — and it applies symmetrically to "does this lambda capture the outer instance?", "is this lambda serialisable?", etc.

---

## 11. Quick rules

- [ ] Functional interface rule lives in **JLS §9.8** — exactly one abstract method, `default`/`static`/`Object`-methods excluded.
- [ ] Lambda syntax and target typing live in **JLS §15.27**; method references in **§15.13**.
- [ ] Effectively-final rule is **JLS §4.12.4** + §15.27.2.
- [ ] `invokedynamic` bytecode is **JVMS §6.5**; the call-site contract is in `java.lang.invoke.CallSite`.
- [ ] `BootstrapMethods` class-file attribute is **JVMS §4.7.23**.
- [ ] Lambda implementation strategy is normatively specified in `LambdaMetafactory` Javadoc, not JLS/JVMS.
- [ ] JEPs **126** (language) and **109** (libraries) introduced lambdas in Java 8.

---

## 12. What's next

| Topic                                                              | File              |
|--------------------------------------------------------------------|-------------------|
| Ten lambda bugs and their fixes                                    | `find-bug.md`     |
| JIT, allocation, primitive specializations                         | `optimize.md`     |
| Hands-on refactors                                                 | `tasks.md`        |
| Interview Q&A                                                      | `interview.md`    |

See also: [../03-reflection-and-annotations/](../03-reflection-and-annotations/) for `MethodHandle`/`Lookup`, [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/) for `invokedynamic` in context with other invoke instructions, and [../../../../05-lambda-expressions/](../../../../05-lambda-expressions/) for a chapter-level treatment.

---

**Memorize this:** JLS §9.8 says *what counts as a functional interface*, §15.27 says *how lambdas resolve to one*, JVMS §6.5 + §4.7.23 say *how the JVM links the call site*, and `LambdaMetafactory`'s Javadoc says *what the link produces*. Every claim in the earlier files comes back to one of those four documents — when in doubt, read the section, not the blog post.
