# Reflection and Annotations — Specification Reading Guide

> The JLS defines what an annotation type *is* (§9.6) and what code shape javac emits when you write one. The Javadoc for `java.lang.reflect` defines what reflective access *means* at runtime. The Javadoc for `java.lang.invoke` defines `MethodHandle` and `VarHandle`. The JVMS defines how the invocation actually happens (§5.4 — resolution, §6.5 — `invokevirtual`/`invokeinterface`/`invokedynamic`). A handful of JEPs trace the modernisation arc: parameter names at runtime, variable handles, modular encapsulation, and the rewrite of core reflection on top of MethodHandles. This file maps each piece to its authoritative source.

---

## 1. Where to find the canonical text

| Concept                                                | Authoritative source                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Annotation type declarations                           | **JLS §9.6** — *Annotation Types*                          |
| Predefined annotations (`@Override`, `@Deprecated`, …) | **JLS §9.6.4**                                             |
| `@Target`, `@Retention`, `@Inherited`, `@Repeatable`, `@Documented` | JLS §9.6.4.1–9.6.4.6                          |
| Annotation element types and `default` values          | JLS §9.6.1                                                 |
| Repeating annotations and containers                   | JLS §9.6.3                                                 |
| Class file representation of annotations               | **JVMS §4.7.16, §4.7.18** — `RuntimeVisibleAnnotations` etc. |
| Method resolution and invocation                       | **JVMS §5.4, §6.5**                                        |
| `invokevirtual` / `invokeinterface` / `invokestatic` / `invokespecial` / `invokedynamic` | JVMS §6.5  |
| Reflection API                                         | `java.lang.reflect` Javadoc (`Class`, `Method`, `Field`, `Constructor`, `Modifier`, `Parameter`, `Proxy`) |
| MethodHandle, VarHandle, Lookup                        | `java.lang.invoke` Javadoc                                 |
| Annotation processing                                  | `javax.annotation.processing`, `javax.lang.model` (JSR 269) |
| Service loader                                         | `java.util.ServiceLoader` Javadoc                          |
| Module reflection rules                                | `java.lang.Module`, `java.lang.ModuleLayer` Javadoc; **JLS §7.7** |

The **JLS** describes source semantics; the **JVMS** describes class file format and runtime behaviour; the **Javadoc** is the binding contract for the API surface. For reflection, all three matter — annotations are a JLS feature with a JVMS class file representation that the runtime exposes through `java.lang.reflect`.

---

## 2. JLS §9.6 — what an annotation type is

JLS §9.6 defines an annotation type as a special interface declaration with the keyword `@interface`:

```java
@interface Marker { }
```

The following rules apply specifically (§9.6.1, §9.6.2):

- An annotation type **implicitly extends** `java.lang.annotation.Annotation`.
- Its body declares **elements** — method-like signatures with no body, optionally a `default` value clause.
- Element types are restricted to: primitives, `String`, `Class` or a parameterised `Class<?>`, enums, other annotation types, and one-dimensional arrays of those.
- Element values must be **compile-time constants** (or class literals or annotation expressions or array initialisers thereof).
- A single-element annotation may use the unnamed-value shorthand: `@Marker("foo")` is `@Marker(value = "foo")` if the element is named `value`.

```java
public @interface Schedule {
    String cron();
    long maxRuntimeSeconds() default 60;
    Priority priority() default Priority.NORMAL;
    Class<? extends RetryStrategy> retryStrategy() default DefaultRetry.class;
    String[] tags() default {};
}
```

What you cannot do (§9.6.1):

- Generic annotation types — `@interface Holder<T>` is illegal.
- Element types outside the restricted set — no `List<String>`, no `BigDecimal`, no `Optional`.
- Forward references in default values to elements declared later in the same annotation.

---

## 3. JLS §9.6.4 — the predefined annotations

JLS §9.6.4 lists the annotations that the language itself recognises:

| Annotation             | Defined at | What the spec says                                                |
| ---------------------- | ---------- | ----------------------------------------------------------------- |
| `@Override`            | §9.6.4.4   | Compile-time error if the annotated method does not override.     |
| `@Deprecated`          | §9.6.4.6   | Compiler must emit a warning when accessing the annotated entity; runtime info is preserved. |
| `@SuppressWarnings`    | §9.6.4.5   | Suppresses warnings of specified kinds in the annotated scope.    |
| `@SafeVarargs`         | §9.6.4.7   | The author asserts the varargs body does not perform unsafe operations. |
| `@FunctionalInterface` | §9.6.4.9   | Compile-time error if the interface is not functional.            |
| `@Target`              | §9.6.4.1   | Constrains where this annotation may appear.                      |
| `@Retention`           | §9.6.4.2   | Constrains how long the annotation is preserved.                  |
| `@Documented`          | §9.6.4.3   | Indicates the annotation should appear in generated Javadoc.      |
| `@Inherited`           | §9.6.4.3   | Subclasses inherit the annotation from a direct superclass.       |
| `@Repeatable`          | §9.6.3     | The annotation may appear more than once on the same target.      |

These are language-level annotations. The compiler treats them specially; `@Override` produces a real compilation error, not a runtime check.

---

## 4. Retention and the class file (JLS §9.6.4.2 + JVMS §4.7.16)

`@Retention(SOURCE)` annotations are discarded by `javac` after the annotation processor pipeline (see §6). They never make it to the `.class` file.

`@Retention(CLASS)` annotations are stored in the class file in the `RuntimeInvisibleAnnotations` attribute (JVMS §4.7.17). They are *not* available at runtime via reflection — bytecode-level tools (ASM, ByteBuddy) can read them.

`@Retention(RUNTIME)` annotations are stored in the `RuntimeVisibleAnnotations` attribute (JVMS §4.7.16). The JVM loads them; `Class.getAnnotation(...)` etc. can read them.

The same dichotomy applies for parameter annotations (`RuntimeVisibleParameterAnnotations`, JVMS §4.7.18) and type annotations introduced by JEP 104 / Java 8 (`RuntimeVisibleTypeAnnotations`, §4.7.20).

This is why "annotation processors don't need `RUNTIME` retention" — they read source-level metadata, not class file attributes. Only runtime reflection requires `RUNTIME` retention.

---

## 5. JVMS §5.4 and §6.5 — invocation semantics

When you call `Method.invoke(receiver, args)`, the JVM does:

1. **Access check.** Is the caller allowed to invoke this method given access flags and the module system? `setAccessible(true)` toggles this off where the JPMS allows.
2. **Argument adaptation.** Box primitives, widen reference types as needed. JVMS §5.4 — method resolution.
3. **Dispatch.** Equivalent to one of the `invoke*` bytecodes (JVMS §6.5):
   - `invokestatic` for `static` methods.
   - `invokespecial` for constructors and `private` methods.
   - `invokevirtual` for ordinary instance methods.
   - `invokeinterface` for interface methods.
4. **Return value handling.** Box primitives back if necessary; throw `InvocationTargetException` wrapping any exception the target throws.

`MethodHandle.invokeExact` follows the same logic but skips most of the per-call adaptation — the handle has a fixed `MethodType` checked at link time, so the bytecode `invokevirtual` on `MethodHandle.invokeExact` is what the JIT eventually inlines.

`invokedynamic` (JVMS §6.5) is the modern call site used by lambdas, `String` concatenation, switch over patterns, and `LambdaMetafactory.metafactory(...)`. The first time the bytecode executes, it calls a *bootstrap method* that returns a `CallSite` (typically a `ConstantCallSite` wrapping a `MethodHandle`). Subsequent executions go through the stable `MethodHandle` — the JIT inlines through it.

For the deeper dispatch story see [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/).

---

## 6. JSR 269 — pluggable annotation processing

JSR 269, integrated into the JDK starting with Java 6, defines the `javax.annotation.processing` API. The relevant types:

- `Processor` — the interface every processor implements.
- `AbstractProcessor` — the convenience base class with `getSupportedSourceVersion()`, `getSupportedAnnotationTypes()`, and `getSupportedOptions()`.
- `RoundEnvironment` — the `process(...)` method's view of which elements carry which annotations *this round*.
- `ProcessingEnvironment` — accessors for `Elements`, `Types`, `Filer`, `Messager`, `Options`.
- `Filer` — creates source files, class files, and resources. New files participate in subsequent rounds.
- `Messager` — emits diagnostics that show up in the IDE at the source element.
- `javax.lang.model.element.Element` — the source-level model. `TypeElement`, `ExecutableElement`, `VariableElement` are the subtypes you'll handle.

A processor lives on the *annotation processor path* (`-processorpath` to `javac`) or, if you're using JPMS, in a module that exports a `Processor` service. Discovery is via `META-INF/services/javax.annotation.processing.Processor`.

Two implementation rules from the JSR:

- A processor must not *modify* existing class files — only *generate* new ones. (Lombok works by tapping into javac internals and bends this rule, which is why it's a special case.)
- Processors run in *rounds* until no new source is generated. A processor that emits a file that itself triggers a re-run will eventually halt because each new round only sees newly generated elements.

---

## 7. `java.lang.invoke` — MethodHandle and VarHandle

`MethodHandle` (Java 7, JSR 292) is a directly-callable, typed reference to a method, field accessor, or constructor.

Key Javadoc sections:

- `MethodHandle.invokeExact(...)` — strict signature match. `WrongMethodTypeException` if the cast doesn't line up.
- `MethodHandle.invoke(...)` — adapts arguments where it can, like reflection.
- `MethodHandle.bindTo(Object)` — partially apply the receiver.
- `MethodHandle.asType(MethodType)` — re-shape the handle's signature.
- `MethodHandles.Lookup` — the capability object that `findStatic`, `findVirtual`, `findVarHandle` etc. live on. A `Lookup` carries the calling class's access rights; you must obtain it with `MethodHandles.lookup()` (private rights to the calling class) or `MethodHandles.publicLookup()` (public rights only).

`VarHandle` (Java 9, **JEP 193**) is the analogous type for *fields*. Key methods:

- `get`, `set` — plain reads/writes.
- `getVolatile`, `setVolatile` — sequentially consistent.
- `getAcquire`, `setRelease` — acquire/release semantics.
- `compareAndSet`, `weakCompareAndSet`, `getAndAdd`, `getAndBitwiseOr` — atomic primitives.
- `MethodHandles.arrayElementVarHandle(int[].class)` — per-element atomics on a plain Java array.

`VarHandle` replaces `sun.misc.Unsafe` for almost every legitimate field-level atomic. The Javadoc is the binding contract — the JVMS does not specify `VarHandle` semantics directly; the JLS Memory Model (§17.4) is what it implements.

---

## 8. JPMS — `java.lang.Module`, `opens`, and `setAccessible`

`java.lang.Module` (added with the module system) exposes the reflection-relevant module operations:

- `Module.isOpen(String packageName, Module other)` — is `packageName` open to `other` for reflection?
- `Module.addOpens(String, Module)` — open a package programmatically (caller must already have access; only `java.base` and a few others can really invoke this).
- `Module.canRead(Module)` — is the reachability declared?

The `module-info.java` keywords (JLS §7.7):

- `exports` — public types are visible to compile time and runtime.
- `opens` — all types/members are visible to reflection at runtime.
- `opens X to Y` — qualified open; only module Y may reflect in.
- `requires` — depends on another module.
- `requires transitive` — re-export the dependency.
- `provides X with Y` — `ServiceLoader` provider.
- `uses X` — `ServiceLoader` consumer.

What `setAccessible(true)` actually does (Javadoc, `AccessibleObject`):

- For members in the *same* module as the caller, succeeds.
- For members in a module that *opens* the package to the caller's module, succeeds.
- Otherwise throws `InaccessibleObjectException`.

The runtime flag `--add-opens module/package=target` is the deployment-time escape hatch. Use it for legacy frameworks that have not been updated for JPMS. New code should declare `opens` in `module-info.java`.

---

## 9. The relevant JEPs

| JEP   | Title                                                    | What it changed                                                                                  |
| ----- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **118** | Access to Parameter Names at Runtime                   | `-parameters` to `javac` emits parameter names in the class file; `Parameter.getName()` returns them. |
| **193** | Variable Handles                                       | Java 9; `VarHandle` API for typed atomic field access.                                          |
| **261** | Module System                                          | Java 9; modules, `module-info.java`, `opens`/`exports`/`requires`/`provides`/`uses`.            |
| **262** | TIFF Image I/O                                         | (Java 9; unrelated to reflection — listed here only because earlier docs mis-cite it.)          |
| **274** | Enhanced Method Handles                                | Java 9; `MethodHandles.Lookup` extensions, `loop` and `tryFinally` combinators.                 |
| **280** | Indify String Concatenation                            | Java 9; `String +` lowered to `invokedynamic` with a `StringConcatFactory` bootstrap.           |
| **396** | Strongly Encapsulate JDK Internals by Default          | Java 16; `--illegal-access=permit` no longer default — JDK internals require explicit `--add-opens`. |
| **403** | Strongly Encapsulate JDK Internals (final)             | Java 17; `--illegal-access` option removed entirely.                                            |
| **411** | Deprecate the SecurityManager for Removal              | Java 17; the SecurityManager hook is on the way out.                                            |
| **416** | Reimplement Core Reflection with Method Handles        | Java 18; `Method.invoke` now sits on top of `MethodHandle`, closing most of the perf gap after warmup. |

`jdeprscan` (the tool that scans for deprecated-API usage) is JEP **277**, not 262 — JEP 262 is the TIFF image-IO addition. Cite **JEP 277** if you mean the deprecation scanner.

---

## 10. The `Class<?>` Javadoc — the most-read part of the JDK

`java.lang.Class` is the entry point for reflection. The methods you should know by heart and their exact semantics from the Javadoc:

| Method                                            | What it returns                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Class.forName(String)`                           | Class with default loader, *initialized*.                                    |
| `Class.forName(String, boolean, ClassLoader)`     | As above, with explicit loader and initialization flag.                      |
| `getDeclaredMethods()`                            | All methods declared on *this class*, including non-public, excluding inherited. |
| `getMethods()`                                    | All *public* methods, including inherited from supertypes and interfaces.    |
| `getDeclaredFields()` / `getFields()`             | Same dichotomy for fields.                                                   |
| `getDeclaredConstructors()` / `getConstructors()` | Same for constructors.                                                       |
| `getAnnotations()`                                | All annotations *present* on this class — direct + inherited via `@Inherited`. |
| `getDeclaredAnnotations()`                        | Only directly declared annotations — no `@Inherited` propagation.            |
| `isAnnotationPresent(Class)`                      | True if `getAnnotation(...)` would return non-null.                          |
| `getAnnotationsByType(Class)`                     | For `@Repeatable` — flattens the container annotation.                       |
| `getNestHost()`, `getNestMembers()`               | JEP 181 nestmate API; controls private access among inner classes.           |

The "declared" vs non-declared distinction trips up newcomers regularly. Re-read it whenever a `NoSuchMethodException` confuses you.

---

## 11. Reading list

1. **JLS §9.6** — Annotation Types. The semantics every annotation declaration follows.
2. **JLS §9.6.4** — Predefined annotations. What the language itself enforces.
3. **JVMS §4.7.16–4.7.20** — Class file attributes for annotations. Where runtime reflection actually reads from.
4. **JVMS §5.4, §6.5** — Method resolution and `invoke*` instructions. The mechanics behind every reflective call.
5. **`java.lang.reflect` Javadoc** — `Class`, `Method`, `Field`, `Constructor`, `Modifier`, `Parameter`, `Proxy`.
6. **`java.lang.invoke` Javadoc** — `MethodHandle`, `VarHandle`, `MethodHandles.Lookup`, `LambdaMetafactory`.
7. **`javax.annotation.processing` Javadoc** — JSR 269, the annotation processor API.
8. **`java.util.ServiceLoader` Javadoc** — the modular plugin discovery contract.
9. **`java.lang.Module` Javadoc** + **JLS §7.7** — modules, `opens`, `exports`.
10. **JEP 118, 193, 261, 274, 396, 403, 416** — the modernisation arc from Java 8 to Java 18+.
11. **Joshua Bloch, *Effective Java* (3rd ed.)** — Items 64 ("Refer to objects by their interfaces"), 80 ("Use executors, tasks, and streams in preference to threads") — gives the design discipline behind "no reflection unless necessary."
12. **John Rose's blog (mlvm.dev.java.net archives, the OpenJDK wiki)** — the design rationale for `MethodHandle`, `invokedynamic`, and `LambdaMetafactory`.

The spec sections do not teach you *when* to reflect; they tell you exactly what happens when you do. Treat the Javadoc for `java.lang.reflect`, `java.lang.invoke`, and `javax.annotation.processing` as the binding contracts; the JLS as the rules javac obeys; the JVMS as the rules the runtime obeys; the JEPs as the design history that explains why the API looks the way it does.
