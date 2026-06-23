# Abstraction — Senior

> **What?** The runtime cost of abstraction (vtable lookups, megamorphic dispatch, indirection layers), how the JIT collapses well-designed abstractions to near-zero overhead, and how to recognize when abstraction is hurting more than helping.
> **How?** By measuring dispatch costs, understanding when abstraction layers compose to JIT-friendly code, and choosing the right tool for the job: interface, abstract class, sealed type, or no abstraction at all.

---

## 1. The cost of "one extra interface"

Every interface or abstract method in the call path is a virtual call. The JIT can usually inline it, but only when:

- The receiver type is monomorphic (or bimorphic) at this site.
- The method is small enough.
- No deoptimization barrier (e.g., a `Class.forName` reload) is in play.

When all three hold, the abstraction costs essentially nothing.

When they don't:
- Megamorphic site → vtable lookup, ~5 ns each call.
- Cold cache lines → far higher.
- Deeply nested wrappers → multiplicative.

---

## 2. Interface dispatch is slightly more expensive than virtual

`invokeinterface` involves an itable search where `invokevirtual` involves a vtable index. Both are inline-cached. In benchmarks, the difference is 0–10% — usually noise unless you're in a megaloop.

Hot path: prefer concrete types or `final` classes if you don't actually need the abstraction. Cold path: use whatever is most readable.

---

## 3. JIT inlining of forwarders

The bridge pattern, decorator pattern, and adapter pattern all introduce forwarding methods:

```java
public final class TimedService implements Service {
    private final Service delegate;
    public Result call(Request r) {
        long t0 = System.nanoTime();
        Result out = delegate.call(r);
        metrics.record(System.nanoTime() - t0);
        return out;
    }
}
```

If `delegate.call(r)` is monomorphic at this site, the JIT inlines it through the wrapper. Result: zero-cost decorator.

If the wrapper is non-final but only one subclass loaded, CHA + monomorphic dispatch still works. If multiple decorators are stacked, the JIT inlines them all into one method blob — assuming they fit within `MaxInlineSize` and `FreqInlineSize` budgets.

---

## 4. Abstraction debt

Every layer of abstraction has a *cognitive* cost: callers must understand the contract, mocks must implement it, tests must exercise its corner cases.

Premature abstraction is a debt that compounds. Common signs:
- Interface with one implementation
- Abstract base with one subclass
- "Service" classes whose only job is to call another service
- 5-layer dependency chain to do one thing

Cure: collapse. Inline the abstraction until you actually need polymorphism.

---

## 5. Sealed types vs open polymorphism

| Choice           | When                                              |
|------------------|---------------------------------------------------|
| Sealed interface | Small, closed set of variants known at compile time |
| Open interface   | Plugins, frameworks, user-extensible APIs         |
| Abstract class   | Shared state, template methods                    |
| Concrete class   | No variation needed                               |
| Record           | Pure data with auto equals/hashCode               |

Sealed types compile to bounded switch dispatch — fast, exhaustive, easy to reason about. Open polymorphism gives extensibility but loses exhaustiveness.

---

## 6. Functional abstractions

Java 8 reframed many abstractions as functional interfaces (single abstract method):

```java
@FunctionalInterface
public interface Function<T, R> {
    R apply(T t);
}

Function<String, Integer> length = String::length;
```

Compiled to `invokedynamic` + `LambdaMetafactory`. After JIT, lambda invocation is ~1 ns — faster than equivalent anonymous class.

For high-throughput callbacks, prefer functional interfaces over anonymous classes. Especially in stream pipelines.

---

## 7. Streams: abstraction over iteration

The Stream API abstracts iteration into a pipeline of operations:

```java
list.stream()
    .filter(s -> s.startsWith("A"))
    .map(String::toUpperCase)
    .collect(Collectors.toList());
```

Abstraction wins: you don't write loops. Performance loses (slightly): 2× to 10× slower than a hand-written loop on micro-benchmarks. The JIT can't always fuse the lambda chain into a tight loop.

For hot paths processing millions of elements, hand-written loops may beat streams. For most code, streams are fine and more readable.

---

## 8. Reflection vs abstraction

Reflection (`Class.forName`, `Method.invoke`) is the ultimate abstraction — you don't even know the type at compile time. Cost: ~100× slower than direct calls.

Use reflection only at boundaries: dependency injection, serialization, plugin loading. Don't reflect in hot paths.

`MethodHandle` (since Java 7) and `VarHandle` (since Java 9) are typed reflection alternatives that the JIT can sometimes inline. Use these in framework code where reflection is required but performance matters.

---

## 9. Abstract methods and the JIT

`abstract` methods compile to a vtable slot with no implementation pointer (or a "throws AbstractMethodError" stub). At runtime, dispatch finds the concrete implementation as usual.

The JIT treats abstract calls the same as virtual calls — inline cache, monomorphic optimization, etc. There's no inherent cost to "abstract."

---

## 10. Designing for change

Common heuristic: design abstractions for *plausible* change, not *imagined* change.

Example: an HTTP client should probably abstract over the underlying transport (HTTP/1.1 vs HTTP/2 vs HTTP/3). It probably should not abstract over "what if we replace HTTP with something else?"

Heuristic in code: how many *real* implementations exist or are planned? <2 → no abstraction. =2 → maybe. ≥3 → almost certainly.

---

## 11. Cost-of-change matrix

| Change                            | Easier with abstraction? |
|-----------------------------------|--------------------------|
| Replace one impl with another     | Yes (huge)               |
| Add new impl alongside existing   | Yes                      |
| Add new method to the interface   | No (must update all impls) |
| Remove a method                   | No                       |
| Change the contract (semantics)   | No (often catastrophic)  |

Abstraction makes *swap* easy, *evolve* harder. If your contract is unstable, abstraction may be premature.

---

## 12. Abstraction in the JDK

Examples of well-designed abstractions in the JDK:

- `java.util.Collection` — capability-driven, well-documented contract
- `java.io.InputStream` / `java.io.OutputStream` — minimal core API, decorator-friendly
- `java.lang.AutoCloseable` — single method, integrates with try-with-resources
- `java.util.function.Function` — compact, composable

Examples of leakier ones:

- `java.util.Date` — almost entirely deprecated; replaced by `java.time`
- `java.lang.Cloneable` — marker interface with no methods; `clone()` is on `Object`; nightmare
- `java.util.Stack` — extends `Vector`, exposes incompatible ops
- `java.util.Hashtable` — deprecated; `HashMap` and `ConcurrentHashMap` replaced it

Lesson: even Sun/Oracle gets it wrong sometimes. Your abstractions don't need to be permanent — they need to be *replaceable*.

---

## 13. Profiling abstraction costs

```bash
# CPU profile to find hot dispatch sites
async-profiler -e cpu -d 60 -f profile.html <pid>

# Allocation profile to find lambda/anon allocation
async-profiler -e alloc -d 60 -f alloc.html <pid>

# JIT inlining decisions
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining ...

# JIT compilation events
java -XX:+PrintCompilation ...
```

Look for:
- Methods that *never* get inlined (`callee is too large`, `not inlineable`)
- Megamorphic call sites (`virtual call`)
- Lambda allocation in hot paths

---

## 14. The cost of "everything is interfaces" architecture

Microservices / DI-heavy frameworks tend to:
- Define interfaces for every class (often with one impl)
- Use proxies for cross-cutting concerns (transactions, security)
- Stack 5-10 interceptors per call

Each layer is a virtual call. JIT handles a few; many more layer up to noticeable latency.

Rule: in inner loops, prefer concrete types. At service boundaries, abstractions are fine.

---

## 15. Modern language features that reduce ceremony

- **Records** replace many "data interface + impl class" pairs.
- **Sealed types** replace many visitor-pattern abstractions.
- **Pattern matching for switch** replaces many polymorphism-via-overrides.
- **Lambdas** replace many strategy interfaces.

Each of these *narrows* the cases where you need traditional abstraction. Use them where they fit.

---

## 16. Practical checklist

- [ ] Each abstraction has ≥ 2 concrete implementations or a clear plan for one.
- [ ] Each interface has a documented contract.
- [ ] Hot-path code prefers concrete or `final` types.
- [ ] Sealed types are used for closed variants.
- [ ] Records replace "data class + interface" pairs.
- [ ] Profiling shows monomorphic or bimorphic dispatch in hot paths.
- [ ] Removing the abstraction would not simplify the codebase.

---

**Memorize this**: abstraction is free in the JIT *when monomorphic*. Megamorphism is the silent killer; check for it in hot paths. Sealed types give you exhaustiveness for the price of nothing. Records make data-class abstractions obsolete. Don't abstract until the cost of *not* abstracting exceeds the cost of the indirection.
