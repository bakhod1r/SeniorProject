# Functional Interfaces and Lambdas — Interview Q&A

20 questions on SAM rules, lambda mechanics, method references, capture, `invokedynamic`, primitive specializations, and composition. Each answer is something you should be able to deliver in under a minute, with the JLS or JEP reference ready if pushed.

---

## Q1. What is a functional interface?

A functional interface is an interface with exactly **one abstract method** — a SAM (Single Abstract Method). `default` methods, `static` methods, and the public methods of `Object` (`equals`, `hashCode`, `toString`) do not count toward the abstract-method count. The rule is normatively specified in **JLS §9.8**. The `@FunctionalInterface` annotation is optional but makes the rule a compile-time check — if someone adds a second abstract method, `javac` errors out.

**Trap:** "An interface annotated `@FunctionalInterface`." Wrong — the annotation just enforces; what *makes* it functional is the SAM count.

---

## Q2. What's the relationship between a lambda and a functional interface?

A lambda expression has **no standalone type** (JLS §15.27.3). It is a *poly expression* whose type is its target type — and that target type must be a functional interface. The same lambda source can have different runtime types in different contexts: `Function<String, Integer>`, `ToIntFunction<String>`, or a custom `StringLength` interface, depending on where it's assigned.

```java
Function<String, Integer> a = s -> s.length();
ToIntFunction<String>     b = s -> s.length();   // same source, different type
```

---

## Q3. What are the four kinds of method references?

JLS §15.13.1:

1. **Static** — `ClassName::staticMethod` (e.g., `Integer::parseInt`).
2. **Bound instance** — `instance::method` (e.g., `System.out::println`).
3. **Unbound instance** — `ClassName::instanceMethod` (e.g., `String::length`); the receiver is the lambda's argument.
4. **Constructor** — `ClassName::new` (e.g., `ArrayList::new`); for arrays, `String[]::new` targets `IntFunction<String[]>`.

All four compile to the same `invokedynamic` site you'd get from an equivalent lambda — there is no runtime difference, only readability.

---

## Q4. What does "effectively final" mean for captured locals?

JLS §4.12.4: a local variable is *effectively final* if it is not declared `final` but is never reassigned after its initialiser. A lambda may capture only final or effectively final locals (JLS §15.27.2). The compiler enforces this by copying the value at the point the lambda is evaluated; reassignment of the source variable after capture is forbidden because it would silently desync the lambda's copy.

```java
String tag = "user";          // effectively final
Runnable r = () -> System.out.println(tag);
tag = "admin";                // ← compile error: variable used in lambda must be effectively final
```

If you need shared mutable state, capture a holder (`AtomicInteger`, an array) — the *reference* is final, the contents are not.

---

## Q5. What does `this` refer to inside a lambda?

A lambda **does not introduce its own `this`** — `this` inside a lambda is the *enclosing class's* `this` (the same `this` you'd see one line above the lambda). This is different from anonymous inner classes, which have their own `this` referring to the anonymous instance. The difference matters for two reasons: (a) `this::method` in a lambda binds the outer object; (b) refactoring an anonymous class to a lambda silently changes the meaning of `this`.

---

## Q6. How is a lambda actually compiled?

`javac` emits, for each lambda:

1. A **private static synthetic method** in the enclosing class with the lambda body (named `lambda$enclosingMethod$index`).
2. An **`invokedynamic` instruction** at the source location, with a `BootstrapMethods` attribute (JVMS §4.7.23) naming `LambdaMetafactory.metafactory` as the bootstrap.

At first execution, the JVM calls the metafactory, which spins a class implementing the SAM interface and returns a `ConstantCallSite`. Subsequent executions just invoke the linked target — no further bootstrap calls.

There is *no* separate `.class` file per lambda on disk; the spun class is anonymous and lives in memory until its classloader is collected.

**Reference:** JEP 126 for the language change; `java.lang.invoke.LambdaMetafactory` Javadoc for the bootstrap contract.

---

## Q7. Are lambdas slower than anonymous inner classes?

In steady state, no. Both go through the same SAM dispatch and both are subject to the same JIT inlining decisions. Lambdas have a *one-time* linkage cost (~1–5 µs the first time an `invokedynamic` site executes) that anonymous classes don't — but anonymous classes have a *per-occurrence* class-loading cost that lambdas don't. For long-running code, the steady-state cost is what matters, and it's equivalent.

The real performance differences live elsewhere: capture allocation (16–24 bytes per evaluation if EA doesn't eliminate them), megamorphic dispatch when many distinct receivers flow through one call site, and boxing when you use `Function<Integer, Integer>` instead of `IntUnaryOperator`.

---

## Q8. What is `LambdaMetafactory.metafactory`?

The bootstrap method called by every lambda's `invokedynamic` site. Its signature:

```java
public static CallSite metafactory(
    MethodHandles.Lookup caller,
    String invokedName,                  // SAM method name
    MethodType invokedType,              // (captures) -> SAM-iface
    MethodType samMethodType,            // erased SAM signature
    MethodHandle implMethod,             // points at the synthetic lambda body
    MethodType instantiatedMethodType    // SAM with type params bound
) throws LambdaConversionException
```

It builds a class implementing the SAM and returns a `ConstantCallSite`. For non-capturing lambdas, the call site returns a singleton; for capturing ones, it allocates a small object per evaluation.

`altMetafactory` extends this for `Serializable` lambdas and marker-interface intersections.

---

## Q9. What's the difference between `Function.compose` and `Function.andThen`?

`f.andThen(g)` applies `f` *first*, then `g` — left-to-right reading order. `f.compose(g)` applies `g` *first*, then `f` — mathematical composition `f ∘ g`, right-to-left.

```java
trim.andThen(upper).apply("  hi  ");   // "HI"   (trim first, then upper)
trim.compose(upper).apply("  hi  ");   // "  HI  "   (upper first — doesn't trim spaces)
```

In practice you almost always want `andThen`. Reach for `compose` only when expressing a literal mathematical pipeline.

---

## Q10. What are primitive specializations and when do they matter?

The JDK ships primitive-typed functional interfaces — `IntFunction<R>`, `ToIntFunction<T>`, `IntUnaryOperator`, `IntPredicate`, `IntConsumer`, `IntSupplier`, and their `Long`/`Double` mirrors — to skip the boxing tax that the generic forms incur.

```java
Function<Integer, Integer> boxed = x -> x * 2;     // boxes twice per call
IntUnaryOperator           prim  = x -> x * 2;     // no boxing
```

Use them in hot paths over primitives. The JIT can often eliminate boxing in the generic form via escape analysis, but you save the JIT the work and remove the variance.

---

## Q11. Why must a captured local be effectively final?

Two reasons:

1. **Lifetime safety.** A lambda may outlive the method that created it (stored in a field, posted to an executor, registered as a listener). If the lambda referred to a *live* stack variable, by the time it ran the variable would no longer exist. Java sidesteps this by copying the value at capture; copying is only safe if the value can't change.
2. **Thread safety.** Implicit sharing of mutable locals across threads would require synchronisation users couldn't see. The rule forces the user to make sharing *explicit* (e.g., via `AtomicInteger`).

The rule is in JLS §15.27.2.

---

## Q12. Can a lambda throw a checked exception?

Only if its target functional interface declares the exception in its SAM signature. The JDK's `Function`, `Supplier`, `Consumer`, etc. do not declare any `throws`, so checked exceptions inside their bodies must be wrapped (in `RuntimeException` or similar) or caught.

```java
// Won't compile — InterruptedException is checked:
Supplier<String> s = () -> { Thread.sleep(1); return "done"; };

// Define a domain functional interface that declares it:
@FunctionalInterface
interface CheckedSupplier<T, E extends Exception> { T get() throws E; }
```

---

## Q13. What's a `Serializable` lambda and when would you use one?

A lambda is `Serializable` when its target type is an intersection that includes `Serializable`:

```java
Comparator<String> byLen = (Comparator<String> & Serializable)
    (a, b) -> Integer.compare(a.length(), b.length());
```

The metafactory generates a `writeReplace` method that produces a `SerializedLambda` describing the implementation method by name. Some distributed-computing frameworks (Spark, Flink) rely on this to ship behaviour across JVMs.

The cost: serialized lambdas are tied to the *name* of the synthetic implementation method, which depends on the enclosing method's name. Refactoring breaks previously-serialized lambdas. In general, prefer to serialize the *data* that parameterises a lambda rather than the lambda itself.

There is **no `@SerializableLambda` annotation** — the mechanism is the intersection type.

---

## Q14. What's the difference between `invokedynamic` and `invokevirtual`?

- **`invokevirtual`** dispatches a virtual method call on an object — the JVM resolves the method through the receiver's class hierarchy (vtable lookup) at the call site.
- **`invokedynamic`** is a *user-bootstrappable* call site. At first execution, the JVM calls a bootstrap method (in lambda's case, `LambdaMetafactory.metafactory`), which returns a `CallSite`. The JVM links the site to the call site's `MethodHandle` target, and subsequent executions go through that target directly.

For lambdas, the target the metafactory returns is a `MethodHandle` to either a singleton (non-capturing) or a constructor (capturing). The actual SAM body executes via `invokevirtual` or `invokeinterface` on the resulting object — `invokedynamic` is just the binding mechanism.

**Reference:** JVMS §6.5.

---

## Q15. Why doesn't a `Function<String, Integer>` compile when the body is `s -> Integer.parseInt(s)` but throws `NumberFormatException` is fine?

`NumberFormatException` extends `RuntimeException` — unchecked. The compiler doesn't track unchecked exceptions across functional-interface boundaries, so the lambda is acceptable. If the lambda threw a *checked* exception not declared by the SAM, it wouldn't compile.

This is also why "use `Function<T, R>` for everything" is brittle for I/O-heavy code: many I/O operations throw `IOException`, which doesn't fit `Function`'s SAM. You either wrap or define a domain functional interface.

---

## Q16. When does HotSpot inline a SAM call?

When the call site is **monomorphic** — i.e., the JIT's type profiler has only ever observed one receiver class at that site. In that case C2 inlines the SAM body directly, eliminating the dispatch overhead and enabling further optimisations (escape analysis, constant folding).

A **bimorphic** site (two observed types) still inlines, with a type-check branch. **Megamorphic** sites (three or more types) fall back to a real `invokeinterface` and lose the inlining wins.

Lambdas can easily make a call site megamorphic, because each *capturing* evaluation produces an instance of a distinct synthetic class. Reducing receiver variance (or hoisting lambdas to `static final` constants) keeps sites monomorphic.

---

## Q17. Are method references always equivalent to the corresponding lambda?

Almost always, but with two subtleties:

1. **Overload resolution.** A method reference that names an overloaded method is resolved by the target type. If multiple overloads fit the target shape, the reference is ambiguous — even when an explicit lambda would resolve cleanly with parameter types.
2. **Evaluation timing.** A bound instance reference `obj::method` evaluates `obj` *once*, at the point the reference is created. A lambda `() -> obj.method()` reads `obj` *each time the lambda runs*. If `obj` is reassigned in between, they behave differently.

```java
Object obj = "first";
Runnable r1 = obj::toString;           // captures "first"
Runnable r2 = () -> System.out.println(obj);   // captures the variable

obj = "second";
r1.run();   // would still call toString on "first" — but `obj` is a local, so it'd be captured;
            // for fields the difference is observable.
```

For 99% of code the two forms are interchangeable. Know the edges.

---

## Q18. Two lambdas are equal — when?

By default, never. Each lambda evaluation produces a distinct object; `equals` falls back to reference equality. Two textually identical lambdas in the same place produce two distinct objects:

```java
Consumer<String> a = s -> System.out.println(s);
Consumer<String> b = s -> System.out.println(s);
a.equals(b);   // false
```

For non-capturing lambdas, the *same* expression evaluated twice may return the same singleton (an implementation detail of the standard metafactory; not a JVMS guarantee). For capturing lambdas, each evaluation allocates a fresh object.

The practical consequence: `List.remove(lambda)` fails to find a "matching" lambda you registered earlier unless you hold the *same instance*. APIs that take and later remove lambdas must return a subscription handle.

---

## Q19. Why does the IDE warn against converting some anonymous classes to lambdas?

Three reasons the IDE refuses or warns:

1. **The anonymous class uses `this` to refer to itself.** After conversion, `this` is the enclosing class's `this`, changing meaning.
2. **The anonymous class has fields.** A lambda can't carry per-instance fields; the conversion would change semantics.
3. **The anonymous class implements multiple abstract methods** (or none) — not a SAM, so a lambda can't target it.

Even when the IDE *does* offer the conversion, audit it for `this` semantics and `Serializable` loss in PRs that mass-apply it.

---

## Q20. Design question — you're building a library API that takes a callback. How do you decide between `Function<T, R>` and a custom `@FunctionalInterface`?

Two questions decide it:

1. **Does the callback throw checked exceptions?** If yes, you need a custom interface — `Function<T, R>`'s SAM doesn't `throws`.
2. **Does the role have a domain name?** If users will call it `validate`, `transform`, `render`, `handle`, define a custom interface whose method name says that. `Function::apply` is generic on purpose; your callers may benefit from a more meaningful name.

If neither applies — pure function, no checked exceptions, no domain name worth giving — use `Function<T, R>` and save everyone the import.

```java
// Custom — communicates intent and allows checked exceptions:
@FunctionalInterface
public interface QueryRunner<T> {
    T run(Connection c) throws SQLException;
}

// Generic — fits a pure-function role:
public <T, R> Pipeline<R> map(Function<T, R> fn) { ... }
```

In both cases, document nullability, threading, and reentrancy expectations in Javadoc — lambdas can hide assumptions you'd never let an interface hide.

---

## What's next

See also: [../05-default-methods-and-diamond-problem/](../05-default-methods-and-diamond-problem/) for how `default` methods enable `andThen`, `and`, `or` on functional interfaces; [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/) for `invokedynamic` in the context of all four `invoke*` instructions; and [../../../../05-lambda-expressions/](../../../../05-lambda-expressions/) for the chapter-level treatment.

---

**Memorize this:** SAM is JLS §9.8, lambda is JLS §15.27, method reference is JLS §15.13, capture rule is JLS §4.12.4 + §15.27.2, `invokedynamic` is JVMS §6.5, and the lambda bootstrap lives in `java.lang.invoke.LambdaMetafactory`. Every interview question above ultimately points at one of those six locations.
