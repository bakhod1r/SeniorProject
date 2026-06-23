# Covariant Returns and Bridge Methods — Specification Reading Guide

> Covariant returns are a *source-language* feature defined by JLS §8.4.5. Bridge methods are an *implementation detail* required to keep that feature compatible with the JVM's descriptor-based dispatch (JVMS §4.6, §6.5). This file maps each concept to the binding spec text and to the reflection API methods that expose them at runtime.

---

## 1. Where to find the canonical text

| Concept                                          | Authoritative source                                |
| ------------------------------------------------ | --------------------------------------------------- |
| Return-type substitutability (covariant return)  | **JLS §8.4.5** — *Method Return Type*               |
| Overriding rules                                 | **JLS §8.4.8** — *Inheritance, Overriding, Hiding*  |
| Access modifier on overrides                     | JLS §8.4.8.3                                        |
| `@Override` annotation                           | JLS §9.6.4.4                                        |
| Type erasure                                     | **JLS §4.6** — *Type Erasure*                       |
| Method signature and erasure of methods          | JLS §8.4.2                                          |
| `method_info` structure in class file            | **JVMS §4.6**                                       |
| `access_flags` for methods                       | JVMS §4.6, Table 4.6-A                              |
| `Synthetic` attribute                            | **JVMS §4.7.6**                                     |
| `Signature` attribute (for generic info)         | JVMS §4.7.9                                         |
| `BridgeMethod` flag — `ACC_BRIDGE` (0x0040)      | JVMS §4.6, Table 4.6-A                              |
| `Synthetic` flag — `ACC_SYNTHETIC` (0x1000)      | JVMS §4.6, Table 4.6-A                              |
| Method resolution at invoke time                 | **JLS §15.12**, **JVMS §5.4.3.3**                   |
| `invokevirtual` / `invokeinterface` semantics    | JVMS §6.5                                           |
| Selection of method at runtime                   | JVMS §5.4.6 — *Method Override*                     |
| Reflection — `Method.isBridge()`                 | `java.lang.reflect.Method` Javadoc                  |
| Reflection — `Method.isSynthetic()`              | `java.lang.reflect.AccessibleObject` / `Member`     |
| JEP for covariant returns                        | (No JEP — added in Java 5 / JSR 14 / JSR 175 era)   |

The JLS describes what `javac` *accepts*; the JVMS describes what the JVM *executes*. Bridges sit in the bytecode boundary, governed by both.

---

## 2. JLS §8.4.5 — return-type substitutability

The decisive paragraph of §8.4.5 defines when one method's return type is *return-type-substitutable* for another's. Paraphrased:

> A method declaration `d1` with return type `R1` is return-type-substitutable for a method `d2` with return type `R2` iff any of:
> - `R1` and `R2` are the same primitive type.
> - `R1` and `R2` are reference types and `R1` is a subtype of `R2`.
> - `R1` is a reference type and `R2` is `void` — (impossible in practice).
> - After type erasure, the descriptors are equal.

The second bullet is what permits covariant returns. The fourth bullet is what permits generic narrowing — even when the erased descriptors *are* equal, the source-level types may differ. That divergence is exactly what forces bridges into the class file.

§8.4.5 also requires that an overriding method's return type be return-type-substitutable for the overridden method's. So `Dog copy()` overriding `Animal copy()` is legal because `Dog <: Animal`.

---

## 3. JLS §8.4.8.3 — overriding and accessibility

§8.4.8.3 governs accessibility on overrides. Relevant to bridges:

- An overriding method must be at least as accessible as the overridden one.
- A method declared in a subclass that has the *same signature* (parameter types after erasure) as a method in the superclass *overrides* it.

The bridge generated for a covariant return inherits the access of the real method. If the real `Dog copy()` is `public`, the bridge `Animal copy()` is `public` too (you'll see `ACC_PUBLIC | ACC_BRIDGE | ACC_SYNTHETIC` together in `javap`). The bridge is never more restrictive than its real method — that would break callers of the parent type.

---

## 4. JLS §4.6 — type erasure

§4.6 defines erasure formally. The relevant rules:

- The erasure of a parameterised type `G<T1, ..., Tn>` is the raw type `G`.
- The erasure of a type variable is the erasure of its leftmost bound.
- The erasure of `T[]` is `|T|[]`.

Methods are erased by erasing their signature: parameter types and return type are individually erased. For `Comparable<T>.compareTo(T)` with no explicit bound, `T` erases to `Object`, so the erased descriptor is `(Ljava/lang/Object;)I`.

For `Comparable<Score>.compareTo(Score)` — there is no such method at the JVM level. What exists is `Comparable.compareTo(Object)`. Implementing classes must contribute a method with that descriptor; the source-typed `compareTo(Score)` does not match; therefore the compiler generates the bridge.

§4.6 is also the *only* JLS section that mentions bridges directly, briefly noting that they are generated to maintain binary compatibility under erasure.

---

## 5. JVMS §4.6 — `method_info` and `access_flags`

The `method_info` structure in a class file (JVMS §4.6) carries the method's `access_flags`, name, descriptor, attributes, and bytecode.

Relevant flag values from Table 4.6-A:

| Flag name        | Value    | Meaning                                              |
| ---------------- | -------- | ---------------------------------------------------- |
| `ACC_PUBLIC`     | 0x0001   | Declared public.                                     |
| `ACC_PRIVATE`    | 0x0002   | Declared private.                                    |
| `ACC_PROTECTED`  | 0x0004   | Declared protected.                                  |
| `ACC_STATIC`     | 0x0008   | Declared static.                                     |
| `ACC_FINAL`      | 0x0010   | Cannot be overridden.                                |
| `ACC_SYNCHRONIZED` | 0x0020 | Synchronized method.                                 |
| `ACC_BRIDGE`     | 0x0040   | A bridge method, generated by the compiler.          |
| `ACC_VARARGS`    | 0x0080   | Declared with variable number of arguments.          |
| `ACC_NATIVE`     | 0x0100   | Declared native.                                     |
| `ACC_ABSTRACT`   | 0x0400   | Declared abstract.                                   |
| `ACC_STRICT`     | 0x0800   | Declared `strictfp`.                                 |
| `ACC_SYNTHETIC`  | 0x1000   | Not present in the source code (compiler-generated). |

`ACC_BRIDGE` is specifically for bridge methods. `ACC_SYNTHETIC` is the broader "compiler-generated" marker. Bridges typically carry both, giving a flag mask of at least `0x1040` plus the access bits.

§4.6 also notes: "An instance initialisation method may have its `ACC_STATIC` flag set; however, an instance initialisation method is not a bridge method." Bridges are normal instance methods.

---

## 6. JVMS §4.7.6 — the `Synthetic` attribute

JVMS §4.7.6 defines the `Synthetic` attribute, which is the *attribute-form* equivalent of `ACC_SYNTHETIC`. Older class files (Java 1.4 and earlier) used the attribute; modern class files use the flag. Both are honoured by the JVM and by tooling.

Reflection's `Method.isSynthetic()` returns `true` if *either* the flag or the attribute is set. `Method.isBridge()` returns `true` only if `ACC_BRIDGE` is set.

Consequence: not every synthetic method is a bridge (e.g., access-bridge methods for private inner-class access are synthetic but not bridges). Use `isBridge()` specifically for the covariant/generic-override case.

---

## 7. JVMS §5.4.3.3 and §5.4.6 — method resolution and override

The JVM's `invokevirtual` instruction (JVMS §6.5) resolves a method at runtime through:

- **§5.4.3.3 — Method resolution.** Given a class and a `CONSTANT_Methodref_info`, find the method in the class hierarchy matching name + descriptor.
- **§5.4.6 — Method override.** Given the resolved method, dynamic dispatch selects the most-specific overriding method in the runtime class.

Crucially, both steps match by **descriptor**, not by source signature. That's the bedrock reason bridges must exist: when the runtime descriptor differs from the source signature, only a method with the runtime descriptor can be the override target.

For `someComparable.compareTo(scoreInstance)` where `someComparable` is typed as `Comparable<Score>`:

1. `javac` compiles the call to `invokeinterface Comparable.compareTo:(Ljava/lang/Object;)I` (erased).
2. At runtime, §5.4.3.3 resolves to a method on `Score` with descriptor `(Ljava/lang/Object;)I`. That's the *bridge*.
3. §5.4.6 picks the bridge as the override target.
4. The bridge body runs: `checkcast Score`, `invokevirtual Score.compareTo:(LScore;)I`.
5. That second `invokevirtual` is itself resolved by §5.4.3.3 / §5.4.6, dispatching to the real method.

Two levels of dispatch happen in this case. The JIT routinely flattens both, but the spec mandates them.

---

## 8. Reflection API — `Method.isBridge` and `Method.isSynthetic`

From `java.lang.reflect.Method` Javadoc:

> `public boolean isBridge()` — Returns `true` if this method is a bridge method; returns `false` otherwise.

> `public boolean isSynthetic()` — Returns `true` if this method is a synthetic method; returns `false` otherwise.

The two methods are independent boolean flags on the underlying `ACC_*` mask. Practically, *every* bridge is also synthetic, but the converse isn't true: lambda methods, access-bridge methods for nested class private access, and enum's `values()`/`valueOf()` are synthetic but *not* bridges.

Defensive reflection code:

```java
public static List<Method> realMethods(Class<?> c) {
    return Arrays.stream(c.getDeclaredMethods())
                 .filter(m -> !m.isBridge() && !m.isSynthetic())
                 .toList();
}
```

This is the idiomatic "give me what the user wrote" pattern.

---

## 9. JLS §15.12 — call-site method resolution

§15.12 governs how `javac` selects a method at a call site. The relevant sub-step for bridges is §15.12.2.5 (Choosing the Most Specific Method): when two methods are applicable, the more specific one wins.

At a *typed* call site (`Dog d; d.copy()`), the compiler selects `Dog.copy()` with descriptor `()LDog;` — no bridge involved. At a *parent-typed* call site (`Animal a = ...; a.copy()`), the compiler selects `Animal.copy()` with descriptor `()LAnimal;`, which at runtime resolves to the bridge on `Dog`, which forwards to the real `Dog.copy()`. The compile-time choice and runtime dispatch are different layers; both are governed by spec.

---

## 10. What the spec *does not* mandate

A few important non-rules, since they often confuse:

- **The spec does not require the bridge to be a separate method.** A JVM is free to implement covariant returns differently, as long as observable behaviour matches. In practice, every mainstream JVM expects `javac` to emit bridges, so they always exist.
- **The spec does not require annotations on the real method to be copied to the bridge.** Whether they are depends on annotation `@Retention` and `@Target` plus the compiler. Default behaviour: not copied. Frameworks must walk to the real method themselves.
- **The spec does not require bridges to carry `Signature` attributes.** Many compilers omit them, so `Method.getGenericReturnType()` on a bridge returns the erased type.
- **The spec does not mandate the source order of methods in the class file.** Don't rely on `getDeclaredMethods()` returning the real method first or last.

---

## 11. Quick rules

- [ ] Covariant returns are JLS §8.4.5; the override's return type must be return-type-substitutable for the parent's.
- [ ] Erasure rules are JLS §4.6; generic overrides produce a bridge whenever the source and erased signatures differ.
- [ ] Bridge flag is `ACC_BRIDGE = 0x0040`; synthetic flag is `ACC_SYNTHETIC = 0x1000`; both per JVMS §4.6.
- [ ] Dispatch is by descriptor (JVMS §5.4.3.3 / §5.4.6), which is why bridges must occupy real slots.
- [ ] `Method.isBridge()` is the canonical reflection probe; `Method.isSynthetic()` is the broader marker.
- [ ] Annotations and generic signatures are *not* automatically copied to bridges — frameworks must walk to the bridged method.

---

## 12. What's next

| Topic                                                  | File              |
| ------------------------------------------------------ | ----------------- |
| Ten realistic bugs caused by bridge methods            | `find-bug.md`      |
| Bridge invocation cost, JIT inlining                   | `optimize.md`      |
| Hands-on exercises                                     | `tasks.md`         |
| Interview Q&A                                          | `interview.md`     |

Cross-references: dispatch mechanics in [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/); slot layout in [../02-vtable-and-itable/](../02-vtable-and-itable/); for design principles in play here (covariance is an LSP/substitution mechanism), see [../../03-design-principles/](../../03-design-principles/).

---

**Memorize this:** JLS §8.4.5 authorises covariant returns; JLS §4.6 erases generics; JVMS §4.6 carries the `ACC_BRIDGE` flag; JVMS §5.4.3.3 dispatches by descriptor. Bridges exist because those four sections, taken together, leave no other way to make source-level type narrowing work at the bytecode level.
