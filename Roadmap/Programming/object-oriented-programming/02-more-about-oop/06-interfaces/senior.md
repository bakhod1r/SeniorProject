# Interfaces — Senior

> **What?** The runtime cost of interface dispatch (itable vs vtable, inline caches, devirtualization), how lambdas interact with functional interfaces via `invokedynamic`, and how to design interfaces that the JIT can optimize aggressively.
> **How?** By understanding HotSpot's interface dispatch, the inline cache states, and the design patterns that keep interface call sites monomorphic.

---

## 1. Interface dispatch under the hood

Every class that implements an interface has an *itable* (interface method table) entry per implemented interface. Calling an interface method:

```
1. Resolve the interface method symbolic reference.
2. Read the receiver's klass pointer.
3. Find the receiver's itable for the target interface.
4. Index into the itable.
5. Call the function pointer.
```

Step 3 (finding the right itable) is the key difference vs `invokevirtual`. Itables are typically a small array; the search is fast.

HotSpot caches the result inline at every call site. After the first invocation, subsequent calls become as fast as virtual dispatch.

---

## 2. Inline cache states for interfaces

Same as virtual dispatch:

| State          | Action                                       |
|----------------|----------------------------------------------|
| Uninitialized  | First call: install klass + target           |
| Monomorphic    | One klass — direct call, sometimes inlined   |
| Bimorphic      | Two klasses — branch                         |
| Megamorphic    | 3+ klasses — full itable lookup              |

For monomorphic call sites, the JIT often inlines the implementation. For megamorphic ones, no inlining.

---

## 3. Functional interfaces and `invokedynamic`

When you write a lambda implementing a functional interface:

```java
Function<String, Integer> f = String::length;
```

The compiler emits `invokedynamic` with `LambdaMetafactory.metafactory` as the bootstrap. At first call:

1. The metafactory generates a hidden class implementing `Function`.
2. The hidden class's `apply` calls `String::length`.
3. The call site is bound to the hidden class.

After warmup, calling `f.apply("hi")` is as fast as a direct method call — the JIT inlines through the hidden class's tiny `apply`.

---

## 4. Lambda capture and allocation

Non-capturing lambdas (don't reference outer variables):
```java
Predicate<String> isEmpty = String::isEmpty;
```
Generated once, cached. `isEmpty` is a singleton.

Capturing lambdas (reference outer vars):
```java
String prefix = "X";
Predicate<String> startsWith = s -> s.startsWith(prefix);
```
Each evaluation allocates a new instance carrying the captured `prefix`. In hot loops, the JIT often eliminates the allocation via escape analysis.

---

## 5. Default method dispatch

Default methods are dispatched like any other interface method. The JVM resolves them at link time and emits `invokevirtual` (Java 8+) or `invokeinterface`.

The default method body lives in the interface's class file. If a class doesn't override, the dispatch lands in the interface's method.

---

## 6. Sealed interfaces and pattern matching

Pattern matching on a sealed interface generates a `typeSwitch` `invokedynamic`:

```java
return switch (result) {
    case Success<?> s -> ...;
    case Failure<?> f -> ...;
};
```

The classifier is generated to be specifically efficient for the permitted set. Generally 1-2 ns per dispatch after JIT.

---

## 7. Interface design for performance

Make your interfaces friendly to the JIT:

- **Small methods** — easier to inline.
- **Stable receivers** — keep call sites monomorphic.
- **Avoid 5+ implementations** of the same interface in hot paths — leads to megamorphism.
- **Mark non-extensible classes `final`** — JIT can devirtualize.

For data-heavy contexts, prefer sealed interfaces with records. For unbounded extension (plugins, frameworks), accept the dispatch cost.

---

## 8. Interface vs abstract class — runtime cost

Roughly equivalent for monomorphic dispatch. For megamorphic, both incur a vtable/itable lookup. Itable is marginally slower than vtable because of the table search.

For value-like types, prefer `final` records or value classes (Project Valhalla).

---

## 9. The `Comparable<T>` design pattern

```java
public interface Comparable<T> {
    int compareTo(T o);
}

public class Money implements Comparable<Money> {
    public int compareTo(Money other) { ... }
}
```

The type parameter narrows the contract: `Money` only compares to `Money`. Most JDK interfaces use this pattern (`Comparable<T>`, `Comparator<T>`, `Function<T, R>`).

---

## 10. Functional interface composition

Default methods on functional interfaces let you compose without ceremony:

```java
Predicate<String> nonEmpty = s -> !s.isEmpty();
Predicate<String> notTooLong = s -> s.length() < 100;
Predicate<String> valid = nonEmpty.and(notTooLong);

Function<String, Integer> length = String::length;
Function<String, String> describe = length.andThen(n -> "length is " + n);
```

`and`, `andThen`, `compose`, `negate` all return new functional interfaces. Each is a tiny lambda; JIT inlines aggressively.

---

## 11. Interface and module boundaries

Interfaces are commonly used as the public contract of a JPMS module:

```java
module com.example.payment {
    exports com.example.payment.api;   // contains Gateway interface
    // internals not exported
}
```

External users depend only on the interface. Implementations live in non-exported packages and are loaded via `ServiceLoader` or DI.

---

## 12. `ServiceLoader` and SPI

`ServiceLoader` is the JDK's service-provider interface mechanism:

```java
ServiceLoader<PaymentGateway> loaders = ServiceLoader.load(PaymentGateway.class);
for (var loader : loaders) {
    var gateway = loader.create();
    ...
}
```

Each provider is registered in `META-INF/services/com.example.PaymentGateway` (legacy) or via `provides ... with ...` in module-info.java (JPMS).

Decouples the user from specific implementations. Common for plugin architectures.

---

## 13. Interface stability vs evolution

Once you publish an interface:
- Adding methods breaks impls (unless `default`).
- Removing methods breaks callers.
- Changing signatures breaks both.

Default methods make adding safe. For removing/changing, plan a deprecation cycle. For closed sets, sealed types let you evolve safely.

---

## 14. Practical performance tips

- Prefer `final` classes implementing interfaces (helps devirt).
- Use sealed interfaces for closed sets.
- Cache lambdas where capture is expensive.
- Avoid 5+ subtypes per interface in hot paths.
- Profile dispatch sites with `-XX:+PrintInlining`.

---

## 15. What's next

| Topic                          | File              |
|--------------------------------|-------------------|
| Bytecode internals              | `professional.md`  |
| Spec rules                      | `specification.md` |
| Interview prep                  | `interview.md`     |
| Common interface bugs           | `find-bug.md`      |

---

**Memorize this**: interface dispatch is a vtable/itable lookup with inline caching; effectively free when monomorphic. Lambdas use `invokedynamic` + hidden classes; non-capturing are singletons. Sealed interfaces give exhaustiveness for free. Design for monomorphism in hot paths.
