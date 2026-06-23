# JVM Method Dispatch — Specification Reading Guide

> The five `invoke*` bytecodes and their resolution algorithms are defined precisely in the JVM Specification. This file maps each opcode and behaviour to its canonical section and to the relevant JEPs. Method dispatch is one of the few places in Java where the spec text *is* the implementation; reading it once removes a lot of magic.

---

## 1. Where to find the canonical text

| Concept                                              | Authoritative source                                  |
|------------------------------------------------------|-------------------------------------------------------|
| `invokestatic` instruction                           | **JVMS §6.5.invokestatic**                            |
| `invokespecial` instruction                          | **JVMS §6.5.invokespecial**                           |
| `invokevirtual` instruction                          | **JVMS §6.5.invokevirtual**                           |
| `invokeinterface` instruction                        | **JVMS §6.5.invokeinterface**                         |
| `invokedynamic` instruction                          | **JVMS §6.5.invokedynamic**                           |
| Method resolution (static lookup of declared method) | **JVMS §5.4.3.3** (class) and **§5.4.3.4** (interface) |
| Instance-method selection (virtual lookup at runtime) | **JVMS §5.4.5** and **§5.4.6**                       |
| Method linking and verification                      | **JVMS §5.4** and **§5.4.1**                          |
| Override rules                                       | **JLS §8.4.8** — *Inheritance, Overriding, Hiding*    |
| Final and private methods                            | JLS §8.4.3.3, §8.4.3.4                                |
| Throws clause restrictions on overrides              | JLS §8.4.6.4                                          |
| Covariant return types                               | JLS §8.4.5                                            |
| Default methods                                      | JLS §9.4.3                                            |
| Sealed classes / interfaces                          | JLS §8.1.1.2, §9.1.1.4                                |
| `MethodHandle` and `CallSite` types                  | `java.lang.invoke` package Javadoc                    |
| LambdaMetafactory contract                           | `java.lang.invoke.LambdaMetafactory` Javadoc + JEP 181|
| StringConcatFactory contract                         | `java.lang.invoke.StringConcatFactory` Javadoc + JEP 280|

The JVMS is what the runtime enforces; the JLS is what `javac` enforces. Dispatch lives in both: which opcode is emitted is a JLS decision; how that opcode runs is a JVMS decision.

---

## 2. JVMS §6.5.invokestatic — the simplest call

The full instruction definition runs to a page or so. The condensed rules:

- **Operands:** two-byte unsigned index into the constant pool, pointing to a `CONSTANT_Methodref_info` or `CONSTANT_InterfaceMethodref_info`.
- **Preconditions:** the referenced method must be `ACC_STATIC`. If not, `IncompatibleClassChangeError` at link time.
- **Execution:** no receiver. Arguments are popped from the operand stack. The method is invoked directly; no virtual lookup.
- **Linkage:** resolution per §5.4.3.3 (class) or §5.4.3.4 (interface).

Static methods on *interfaces* (legal since Java 8) also use `invokestatic`. The constant pool entry will be a `CONSTANT_InterfaceMethodref_info` rather than `CONSTANT_Methodref_info`.

```
0: invokestatic  #2  // Method com/example/Utils.add:(II)I
0: invokestatic  #5  // InterfaceMethod java/util/function/Function.identity:()Ljava/util/function/Function;
```

Both are `invokestatic`, just pointing at different constant-pool tag types.

---

## 3. JVMS §6.5.invokespecial — statically bound instance dispatch

`invokespecial` is used when the *exact* method to invoke is known at compile time, even though there is a receiver. Three triggering source forms (per JLS §15.12.3):

1. **Constructor call** (`new T(...)` or `super(...)` or `this(...)`).
2. **Private instance method call** on the current class.
3. **`super.m(...)` invocation** — explicit superclass method reference.

The spec text in §6.5.invokespecial walks through the *selection*: it consults the receiver's class for the *resolved* method, but unlike `invokevirtual` it does not search for an override. Roughly:

> If C is the class to be used to look up the method (determined as defined in §5.4.6), then the method is found in C, regardless of which class actually appears in the constant-pool method reference.

In practice: `super.greet()` from inside class `B extends A` always invokes `A.greet`. A deeper subclass `C extends B` overriding `greet` does *not* intercept; the lookup is anchored at the static superclass `A`.

A subtle case worth knowing: `invokespecial` on a *private* method follows nest-mate rules (since Java 11, JEP 181 / JEP 309). A nest mate may invoke another nest member's private method through `invokespecial` without the synthetic accessor methods earlier compilers had to generate.

---

## 4. JVMS §6.5.invokevirtual — class-bound virtual dispatch

The canonical opcode for instance methods declared on a class type. The spec text in §6.5.invokevirtual:

1. Resolve the referenced method per §5.4.3.3 (class method resolution).
2. Determine the *actual* method to invoke per §5.4.6 (selection of an instance method), which walks the receiver's class hierarchy looking for an override.
3. Invoke that method, passing the receiver and arguments.

The key step is §5.4.6 — *selection*. Given the resolved method `m` and the receiver's class `C`:

- If `C` declares a method that overrides `m` (per §5.4.5), use that.
- Otherwise, walk the superclass chain looking for an override.
- If none is found, the resolved method itself is used.

If the resolved method is not found in any superclass either, the JVM throws `AbstractMethodError`. This usually means a binary-compatibility break — a class file referencing a method that no longer exists in the compiled hierarchy.

A worked example:

```java
class A { public void m() { System.out.println("A"); } }
class B extends A { /* no override */ }
class C extends B { public void m() { System.out.println("C"); } }

A a = new C();
a.m();   // prints "C"
```

- Resolution (§5.4.3.3): the constant pool says `A.m()`. Resolved against `A`.
- Selection (§5.4.6): receiver class is `C`. Does `C` override `m`? Yes. Use `C.m`.

If `C` had not overridden:

- Selection: `C` does not override. Walk to `B`. `B` does not override. Walk to `A`. Use `A.m`.

---

## 5. JVMS §6.5.invokeinterface — interface-bound virtual dispatch

Mechanically very similar to `invokevirtual`, but with two differences specified in §6.5.invokeinterface:

1. **The resolution step uses §5.4.3.4** (interface method resolution), which walks the *interface* hierarchy. Default methods are found via `maximally-specific` selection — the spec's term for "most-overridden among the interfaces that provide a body".
2. **The instruction has a `count` operand.** A vestigial value telling the verifier how many argument slots the method consumes. Modern HotSpot ignores it; the spec keeps it for historical compatibility.

```
0: invokeinterface #5, 2   // count=2: receiver + one argument
```

The selection step (§5.4.6) is the same as for `invokevirtual`: walk the receiver's class hierarchy looking for an override. If the override comes from the interface itself (a default method) and another interface provides a *more specific* default for the same method, JVMS §5.4.6 / JLS §9.4.1.3 specify the "maximally specific" rule:

- If multiple superinterfaces provide a default for `m`, the one whose interface is a subtype of all others wins.
- If no such unique winner exists, an `IncompatibleClassChangeError` is thrown ("conflicting defaults").

This is the formal answer to "what if two interfaces I implement both provide a default for the same method?" The compiler usually forces you to disambiguate (`Iface.super.m()`); if you somehow bypass that — for instance, via separate compilation skew — the runtime detects it.

---

## 6. JVMS §6.5.invokedynamic — bootstrapped call sites

The most flexible opcode. Defined in §6.5.invokedynamic with significant cross-references to §5.4.3.6 (call-site specifier resolution) and the `java.lang.invoke` package.

The wire format:

```
invokedynamic <indy_cp_index> 0 0
```

The constant-pool slot at `indy_cp_index` is a `CONSTANT_InvokeDynamic_info`, containing:

- A `bootstrap_method_attr_index` — index into the class file's `BootstrapMethods` attribute.
- A `name_and_type_index` — name and method type for the call site.

The `BootstrapMethods` attribute (per JVMS §4.7.23) holds, for each bootstrap entry:

- A *bootstrap method handle* (referring to a `static` method).
- A list of *static arguments* — `CONSTANT_String`, `CONSTANT_Class`, `CONSTANT_Integer`, `CONSTANT_MethodType`, `CONSTANT_MethodHandle`, or `CONSTANT_Dynamic` (since JEP 309) entries.

On first execution of an `invokedynamic` instruction, the JVM:

1. Resolves the bootstrap method handle.
2. Builds a `Lookup` context (representing the calling class).
3. Invokes `bootstrap.invokeWithArguments(lookup, name, type, ...staticArgs)`.
4. Expects a `CallSite` back; binds the call site's target `MethodHandle` to the `invokedynamic` instruction.
5. Invokes the target MethodHandle with the runtime arguments.

Subsequent executions skip steps 1–4 and just invoke the cached MethodHandle. If the `CallSite` is a `MutableCallSite`, its target can change between invocations; the JIT handles this via guard-and-recompile.

The `LambdaMetafactory` and `StringConcatFactory` standard libraries are *the* bootstrap implementations Java itself ships. Any library can ship its own — that's exactly how Kotlin, Scala, and other JVM languages implement their advanced features.

---

## 7. JVMS §5.4.5 — overriding

§5.4.5 defines when one method *overrides* another from the JVM's perspective. The rules largely match JLS §8.4.8 but are restated in JVMS terms because the JVM must enforce them at link time without source.

A method `m1` declared in class `C1` overrides a method `m0` declared in class `C0` if and only if:

1. `C1` is a subclass of `C0`.
2. `m1` has the same name and descriptor as `m0`.
3. `m0` is accessible from `C1` (handles the package-private case — methods that are not visible cannot override).
4. `m1` is not `private`.

The accessibility rule (point 3) is the formal reason package-private methods cannot be overridden across packages: the subclass cannot *see* the parent's method, so the JVM doesn't treat the subclass's same-named method as an override.

```java
// package p1
public class A { void m() {} }   // package-private

// package p2
public class B extends p1.A { void m() {} }   // NOT an override

// p1.A.m() and p2.B.m() are two separate methods.
// Calls to A.m() resolved at link time will not pick up B.m().
```

This rarely bites in modern code (most things are `public`), but it surfaces with `protected` / package-private hierarchies and can produce surprising behaviour.

---

## 8. JVMS §5.4.3 — method resolution algorithm

§5.4.3.3 (class methods) and §5.4.3.4 (interface methods) define how a symbolic reference in the constant pool is resolved to an actual method. The algorithms are precise; an abridged version:

**Class method resolution (§5.4.3.3):**

1. If the referenced class `C` is an interface, throw `IncompatibleClassChangeError`.
2. Otherwise, *method lookup* (next step) is performed on `C` then its superclasses then its superinterfaces.
3. **Method lookup:**
   - If `C` declares a method matching the name + descriptor, return it.
   - Otherwise, recursively look up in `C`'s direct superclass.
   - If not found, look up the *maximally-specific* superinterface method (per §5.4.3.3).

**Interface method resolution (§5.4.3.4):**

1. If `C` is not an interface, `IncompatibleClassChangeError`.
2. Look up in `C` itself.
3. Look up in `java.lang.Object` — even interfaces inherit `equals`, `hashCode`, `toString` from `Object` indirectly.
4. Look up *maximally-specific* in `C`'s superinterfaces.

The "maximally specific" rule handles default methods across multiple superinterfaces; if more than one maximally specific candidate exists with non-abstract bodies, an `IncompatibleClassChangeError` is thrown at link time.

---

## 9. JLS §8.4.8 — override rules at the source level

The companion rules at the source level (what `javac` enforces). Worth knowing the precise list:

- **Same erased signature.** A subclass method overrides a superclass method only if their erased signatures match (JLS §8.4.2).
- **Covariant return** (JLS §8.4.5). The override's return type must be *return-type substitutable* — either the same or a subtype of the parent's.
- **Throws clause** (JLS §8.4.6.4). The override may declare fewer or narrower checked exceptions than the parent.
- **Access** (JLS §8.4.8.3). The override must be at least as accessible as the parent. A `public` method cannot be overridden by a `protected` one.
- **Final / static** (JLS §8.4.3.3, §8.4.3.4). A `final` method cannot be overridden. A `static` method is *hidden*, not overridden — calls dispatch based on compile-time type.

These rules combined make Java's static type system align with Liskov substitutability at the signature level. The behavioural side (preconditions, postconditions, invariants) is still the programmer's job — see [../../03-design-principles/01-solid-principles/specification.md](../../03-design-principles/01-solid-principles/specification.md) for the LSP discussion.

---

## 10. Relevant JEPs

| JEP                | Topic                                            | What it changed at the dispatch level                        |
|--------------------|--------------------------------------------------|--------------------------------------------------------------|
| **JEP 181** (Java 8) | Lambdas via `LambdaMetafactory`                | New `invokedynamic` use case; lambda creation is bootstrapped |
| **JEP 280** (Java 9) | String concatenation via `StringConcatFactory` | `+` on strings compiles to `invokedynamic`, not `StringBuilder` |
| **JEP 309** (Java 11) | Constant dynamic (`condy`)                    | A new `CONSTANT_Dynamic` constant-pool entry; constants computed lazily by bootstrap |
| **JEP 274** (Java 9) | Enhanced MethodHandles                         | New combinators (`loop`, `tryFinally`); `invokedynamic` payloads can do more |
| **JEP 360 / 397 / 409** | Sealed classes                              | Closed type sets; CHA can devirtualize without speculation   |
| **JEP 395** (Java 16) | Records                                       | Implicitly `final`, ideal `invokevirtual` targets             |
| **JEP 406 / 420 / 427 / 441** | Pattern matching for `switch`         | Sealed-type pattern switch compiles via `invokedynamic` to type-switch bootstrap |
| **JEP 458** (Java 21) | Launch multi-file source-code programs        | Indirect; affects how `javac` warms class loaders             |
| **JEP 471** (Java 23, preview) | Deprecate `sun.misc.Unsafe` memory access | Unrelated to dispatch but affects bytecode generation         |

The JEPs to remember by number are 181 (lambdas), 280 (string concat), 309 (condy). They are the modern `invokedynamic` use cases. Mention them in interviews and you're signalling familiarity with the dispatch story since Java 7.

---

## 11. `java.lang.invoke` — the runtime API

The classes in `java.lang.invoke` are the API behind `invokedynamic`. Worth knowing:

- **`MethodHandle`** — a typed, directly invokable function reference. The JIT inlines invocations of MethodHandles aggressively.
- **`MethodHandles.Lookup`** — capability object that grants access to private members for the purpose of building MethodHandles. Passed to bootstrap methods.
- **`MethodType`** — the signature of a method, used by `MethodHandle` and `invokedynamic`.
- **`CallSite`** — the binding point of an `invokedynamic` instruction. Three flavors: `ConstantCallSite`, `MutableCallSite`, `VolatileCallSite`.
- **`LambdaMetafactory`** — the bootstrap class for Java lambda call sites.
- **`StringConcatFactory`** — the bootstrap class for `+` on strings since Java 9.
- **`ConstantBootstraps`** — the bootstrap class for `condy` (JEP 309).

Direct use of MethodHandles is rare outside dynamic-language implementations and high-performance frameworks (Netty, Disruptor, some JSON libraries). But knowing the API tells you what's happening inside `invokedynamic`.

---

## 12. Reading list

1. **JVMS §6.5** — the canonical reference for all five opcodes. Read it once front to back.
2. **JVMS §5.4** — linking, resolution, and selection. The runtime machinery beneath the opcodes.
3. **JLS §8.4** — methods. Especially §8.4.8 (overriding), §8.4.5 (covariant returns), §8.4.6.4 (throws).
4. **JLS §9.4** — interface methods. Default methods, maximally-specific resolution.
5. **JLS §8.1.1.2 / §9.1.1.4** — sealed classes and interfaces.
6. **JEP 181** — *Java 8 lambdas*. The original `invokedynamic` use case for Java itself.
7. **JEP 280** — *String concatenation via invokedynamic*. The Java 9 rework.
8. **JEP 309** — *Constant dynamic*. Bootstrap-computed constants.
9. **JEP 360 / 397 / 409** — *Sealed classes*. Preview to standard.
10. **John Rose, "Bytecodes meet combinators: invokedynamic on the JVM"** — the canonical paper, OOPSLA 2009. Long, dense, definitive.
11. **Aleksey Shipilëv, "Java Lambdas and Performance"** (https://shipilev.net) — empirical study of `invokedynamic` lambda performance vs anonymous classes.
12. **Cliff Click's blog posts on the HotSpot interpreter and JIT** — particularly the entries on inline caches and deoptimization.
13. **The HotSpot source** — `src/hotspot/share/interpreter/` and `src/hotspot/share/c1/` and `src/hotspot/share/opto/` (C2). Reading even the comments is illuminating.

The spec sections do not *teach* dispatch — they *define* it. When a coworker says "but my subclass works", cite §5.4.5. When a reviewer says "this `super.m()` should call the deepest override", cite §6.5.invokespecial. When a junior asks "why is my lambda fast", point at JEP 181 and `LambdaMetafactory`. Dispatch is judgement above the spec; the spec gives you the levers you can point at.
