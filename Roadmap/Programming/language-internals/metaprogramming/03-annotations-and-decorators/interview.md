# Annotations & Decorators — Interview Questions

> **Topic:** [Annotations & Decorators](README.md)
> **Focus:** Probing whether a candidate truly understands that "annotation" and "decorator" are two different mechanisms, how each is processed (compile time vs runtime), and the failure modes that show up in real systems.

---

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Java (annotations + APT)](#java-annotations--apt)
  - [Python (decorators)](#python-decorators)
  - [TypeScript / Angular / NestJS](#typescript--angular--nestjs)
  - [C# (attributes)](#c-attributes)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Questions](#design-questions)

---

## Conceptual / Foundational

## Question 1

**What is the fundamental difference between an annotation and a decorator?**

An annotation (Java) or attribute (C#) is **pure, inert metadata** attached to a declaration. It performs no action by itself; it exists only to be *read* by some other agent — the compiler, an annotation processor at build time, or a framework via reflection at runtime. A decorator (Python, TypeScript) is **live code** — a function executed at definition time that *wraps or replaces* the thing it decorates. The single sharpest test: if you delete every tool that reads the `@Something`, does the decorated code still behave differently? For an annotation, no — the effect lived entirely in the reader. For a decorator, yes — the effect lived in the decorator itself. The shared `@` syntax is the source of endless confusion; the semantics are unrelated.

## Question 2

**What does it mean to say "an annotation does nothing by itself"?**

It means the annotation is just a recorded fact on a code element. `@Override` does not change a method; it records "the author claims this overrides a parent." That claim only matters because the *compiler* chooses to read it and verify it. A custom `@Cool` annotation with no processor and no reflection reading it is completely inert — the program behaves identically with or without it. Annotations are "half a feature"; the other half is always a reader: a compile-time processor or runtime reflection.

## Question 3

**What are the two ways an annotation can be processed, and what does each cost?**

(1) **Compile time**, by an annotation processor (APT) that reads annotations during the build and generates code or raises errors — Dagger, Lombok, MapStruct. Cost: slower builds; benefit: zero runtime cost and build-time error detection. (2) **Runtime**, by a framework that uses reflection to scan loaded classes and react — Spring, JUnit, Jackson, Hibernate. Cost: startup scanning time plus per-call reflection overhead; benefit: no build coupling and full dynamism. This compile-vs-runtime split is the central axis of the whole topic and drives real architectural decisions like Spring vs Micronaut.

## Question 4

**Explain Python's decorator syntax in terms of plain function calls.**

`@d` above `def f(): ...` is exactly `f = d(f)` evaluated after `f` is defined. So `d` is a function that receives `f` and returns whatever should now be bound to the name `f` — usually a wrapper function that calls the original. Stacked decorators `@a` `@b` over `f` mean `f = a(b(f))`: applied bottom-up, executed outermost-first. A decorator with arguments, `@d(x)`, means `f = d(x)(f)` — `d(x)` is *called first* and must *return* the actual decorator (a decorator factory).

## Question 5

**What is action at a distance, and why is it the defining cost of these features?**

Action at a distance is behavior caused by something not visible at the call site. When `place(order)` mysteriously runs in a transaction, the cause is a `@Transactional` annotation and a proxy, neither visible where you call the method. Both annotations and decorators trade local readability for this kind of declarative magic. The cost shows up in debugging: you can't reason about a method by reading it; you must find the *reader* (compiler, processor, proxy, injector) that acts on the metadata. Managing this — keeping readers discoverable — is the core maintainability challenge of annotation-heavy systems.

## Question 6

**What is a meta-annotation?**

An annotation applied to *another annotation's definition*. In Java, `@Retention`, `@Target`, `@Documented`, `@Inherited`, and `@Repeatable` are meta-annotations: you put them on your `@interface` declaration to configure how your annotation behaves — how long it survives, where it may be applied, whether subclasses inherit it, and whether it may appear more than once. They're the configuration layer for the metadata system itself.

## Question 7

**Why does retention policy matter?**

Retention (`SOURCE`, `CLASS`, `RUNTIME`) decides *which readers can even see* an annotation. `SOURCE` is discarded after compilation — only annotation processors see it (e.g., `@Override`, Lombok). `CLASS` (the default) lives in the bytecode but isn't loaded for reflection. `RUNTIME` survives into reflection — required for any framework that reads it while the program runs (`@Test`, `@Entity`). The classic bug: writing a custom annotation a runtime framework must see but leaving it at the default `CLASS` retention, so reflection finds nothing — silently, with no error.

## Question 8

**Why must you use `functools.wraps` in a Python decorator?**

Because the wrapper function is a *different object* from the original. Without `functools.wraps(func)`, the decorated function reports `__name__ == "wrapper"`, loses its `__doc__`, and `inspect.signature` shows `(*args, **kwargs)` instead of the real signature. That breaks logging that uses the function name, documentation tools, debuggers, and any framework that dispatches on `__name__`. `functools.wraps` copies the identity metadata and sets `__wrapped__` so introspection can recover the original. It should be on every function-wrapping decorator.

---

## Language-Specific

### Java (annotations + APT)

## Question 9

**Walk through what `@Override` actually does.**

Nothing at runtime — it has `SOURCE` retention and is gone before the program runs. Its entire value is a compile-time check: the compiler reads `@Override` and verifies that the method genuinely overrides a method in a supertype (matching name and signature). If it doesn't — say you misspelled the method or got a parameter type wrong — compilation fails. Without `@Override`, that mistake silently compiles into a new, unrelated method, a bug `@Override` exists to catch. It's the purest example of "inert annotation, value lives in the reader."

## Question 10

**How does an annotation processor work?**

It's a class implementing `javax.annotation.processing.Processor` (usually via `AbstractProcessor`), discovered by `javac` through a `META-INF/services` entry. During compilation, `javac` runs processing in *rounds*: each round, the processor receives the annotated `Element`s (the compile-time structural model — `TypeElement`, `ExecutableElement`, etc.) and may generate new source files via the `Filer` or emit errors via the `Messager`. Generated files trigger further rounds until none remain. The processor never runs your program; it inspects declarations and emits text. This is how Dagger generates DI code and MapStruct generates mappers.

## Question 11

**How is Lombok different from a normal annotation processor like Dagger?**

Dagger *generates separate source files* — clean, standard APT. Lombok registers as a processor but then reaches into `javac`/`ecj` **internal APIs to mutate the AST in place**, injecting getters/setters/constructors directly into your class rather than generating new files. That's why Lombok's methods don't appear in your source but do appear in the compiled bytecode, and why IDEs need a Lombok plugin to "see" them. The downside is fragility: it depends on non-public compiler internals that break across JDK versions (notably the JDK 9 module system and subsequent releases). This generate-files vs mutate-AST distinction is a strong senior signal.

## Question 12

**A framework can't see your custom annotation at runtime. What's the most likely cause?**

The retention is wrong. If you didn't annotate your `@interface` with `@Retention(RetentionPolicy.RUNTIME)`, it defaults to `CLASS` retention, which is *not* available to reflection. The framework's `getAnnotation` / `isAnnotationPresent` returns nothing, silently. Less commonly: a missing `@Target` that the compiler enforced, scanning that doesn't cover the package, or the annotation being on a synthetic/proxied element the scanner doesn't reach.

### Python (decorators)

## Question 13

**Implement a decorator that takes an argument, e.g. `@retry(times=3)`.**

```python
import functools

def retry(times):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(times):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    if attempt == times - 1:
                        raise
        return wrapper
    return decorator
```

Three layers: `retry(times)` is the **factory** (captures the argument), returns `decorator` (the real decorator that receives `func`), which returns `wrapper`. `@retry(times=3)` evaluates `retry(3)` first, *then* applies the returned decorator to the function. Forgetting that a parameterized decorator needs this extra layer — or using `@retry` without parentheses — is the most common decorator mistake.

## Question 14

**What's the difference between `@staticmethod`, `@classmethod`, and `@property`?**

All three are built-in decorators that change method behavior. `@staticmethod` removes the implicit first argument — the method gets neither `self` nor `cls`; it's a plain function namespaced under the class. `@classmethod` makes the first argument the *class* (`cls`) rather than the instance, useful for alternative constructors. `@property` turns a method into a managed attribute — you access it as `obj.x` (no parentheses) and it runs the method; you can pair it with a `@x.setter`. They demonstrate that decorators are real behavior changes, not metadata.

## Question 15

**Explain decorator stacking order with an example.**

```python
@a
@b
def f(): ...
```

equals `f = a(b(f))`. Applied **bottom-up** (`b` wraps `f` first, then `a` wraps that), but at call time the outermost wrapper (`a`'s) runs first and the innermost last. So `@timing` over `@cache` measures the cached call (fast on hits), while `@cache` over `@timing` caches a timed call. Order encodes semantics — and for security stacks it's critical: `@authorize` must be *outside* `@cache` so cached responses still pass authorization.

## Question 16

**How does `@dataclass` relate to annotations and decorators?**

It's a beautiful hybrid. `@dataclass` is a *class decorator* (live code) that *reads Python's variable annotations* (`name: str`, `age: int` — Python's metadata feature) and **generates** `__init__`, `__repr__`, and `__eq__` based on them. So a decorator consumes annotations to do code generation at definition time — a microcosm of the whole topic: live decorator + inert annotations + generation. Note Python's variable annotations are themselves inert until something (like `@dataclass` or a type checker) reads them.

### TypeScript / Angular / NestJS

## Question 17

**How does Angular inject the right service if TypeScript types are erased at runtime?**

Three cooperating pieces. (1) The class must have a decorator (`@Injectable()`), which triggers metadata emission. (2) The `emitDecoratorMetadata` compiler flag makes `tsc` write the constructor's parameter *types* back as runtime metadata under the key `design:paramtypes`. (3) The `reflect-metadata` polyfill exposes `Reflect.getMetadata('design:paramtypes', SomeClass)` so Angular can read that array at runtime, look each type up in its injector, and supply the instances. The decorator's *presence* is what forces emission — a class with no decorator gets no `design:paramtypes`, so DI fails with "can't resolve parameters."

## Question 18

**Are TypeScript decorators standardized?**

There are two flavors. The **legacy** "experimental" decorators (`experimentalDecorators: true`), which Angular and NestJS rely on, have signatures like `(target, key, descriptor)` and support **parameter decorators** plus `emitDecoratorMetadata`. The **TC39 Stage-3** standard (TypeScript 5.0+, modern engines) uses a different `(value, context)` signature and **does not include parameter decorators** or design-type metadata emission. The two are incompatible. This is why Angular/Nest remain pinned to the legacy mode while new libraries adopt Stage-3, and why a flag flip or TS upgrade can break every parameter-decorator-based DI site at once.

## Question 19

**Why do Angular/NestJS use `@Inject(TOKEN)` for some dependencies instead of relying on the type?**

Because `design:paramtypes` only works when the compiler can name a *concrete class*. Interfaces and generic types **erase to `Object`** at runtime — there's nothing to inject by. So for interface-typed or token-based dependencies, you must provide an explicit injection token via `@Inject(TOKEN)`, which is a parameter decorator carrying the lookup key. This also explains why interface-based DI doesn't "just work" the way class-based DI does.

### C# (attributes)

## Question 20

**How do C# attributes compare to Java annotations?**

They're the same concept with different syntax: declarative metadata in square brackets (`[Obsolete]`, `[Required]`, `[Serializable]`) instead of `@`. Like Java annotations, attributes are inert until read — some by the compiler (`[Obsolete]` emits a warning), most via reflection at runtime (`[Required]` read by a validation framework, `[JsonPropertyName]` by a serializer). `[AttributeUsage]` is the equivalent of Java's `@Target`, restricting where the attribute may be applied. If you understand Java annotations, C# attributes require learning only the bracket syntax and the `GetCustomAttribute` reflection API.

## Question 21

**How would you read a custom C# attribute at runtime?**

Via reflection: get the `MemberInfo` (e.g., `typeof(T).GetMethod("Run")`), then call `GetCustomAttribute<MyAttribute>()` or `GetCustomAttributes()`. The attribute instance is constructed from the values you passed in brackets (positional args map to the constructor, named args to properties). Like Java, the attribute does nothing until this reflective read happens, and like Java you should cache the reflective lookup if it's on a hot path.

---

## Tricky / Trap Questions

## Question 22

**I wrote a custom annotation and it does nothing. Why?**

Because an annotation is *only* metadata — you wrote half a feature. You also need a *reader*: a compile-time annotation processor or runtime reflection that finds the annotation and acts on it. And the reader must be able to *see* it: a runtime reader needs `@Retention(RUNTIME)`. The most common version of this bug is forgetting both halves are required and then forgetting that the default retention (`CLASS`) hides the annotation from reflection.

## Question 23

**`@retry` vs `@retry()` — does it matter?**

Yes, critically. If `retry` is a decorator *factory* (it takes arguments and returns a decorator), you must call it: `@retry(3)` or `@retry()`. Writing bare `@retry` passes the *decorated function itself* as the factory's first positional argument, so `func` becomes `times`, and you get a baffling error or silent misbehavior. Conversely, if `retry` is a plain decorator, `@retry()` calls it with no function and fails. Knowing whether a decorator is "called" or "named" is essential. The robust pattern is to support both forms explicitly.

## Question 24

**My `@Transactional` method isn't running in a transaction. Why?**

Almost certainly **self-invocation**. Spring implements `@Transactional` with a proxy. When you call `this.transactionalMethod()` from *within the same bean*, the call goes directly to the object, bypassing the proxy — so the transaction advice never runs. The fix is to invoke through the proxy: inject the bean into itself and call `self.transactionalMethod()`, split into two beans, or use `TransactionTemplate` programmatically. The same trap hits `@Cacheable`, `@Async`, and `@Retryable`. A `final` method/class can also silently defeat CGLIB proxying.

## Question 25

**My decorated function's logs all say `wrapper`. What happened?**

You forgot `functools.wraps`. The wrapper replaced the original function object, so its `__name__` is `"wrapper"` and its `__doc__` and signature are lost. Anything that introspects the function — your logger, `help()`, a router keyed on `__name__`, `inspect.signature` — now sees the wrapper, not the real function. Adding `@functools.wraps(func)` inside the decorator copies the identity metadata and fixes it.

## Question 26

**A `@Test` method exists but never runs when I execute the class. Why?**

Because `@Test` does nothing on its own — it's inert metadata. A method only runs as a test because a *test runner* (JUnit, pytest) reflectively scans for the annotation and decides to invoke it. If you run the class with a plain `main`, nothing scans for `@Test`, so the methods are never invoked. The "test execution" lives entirely in the runner, not the annotation.

## Question 27

**Does putting `@Component` on a class make Spring use it, for free?**

Not for free, and not by mere presence. `@Component` is inert until Spring's **component scan** (runtime, reflection-based, often bytecode-level) discovers it — and only if the class is within a scanned package. Discovery costs startup time proportional to the classpath, and the resulting beans may be wrapped in proxies. The "magic" is an entire runtime subsystem reading the annotation, not the annotation doing anything itself.

## Question 28

**Two services injected by interface fail to resolve in Angular/Nest. Why might that be?**

Interface types erase to `Object` at runtime, so `design:paramtypes` can't carry them — there's no concrete class to look up. The DI container has nothing to match. The fix is to inject by token (`@Inject(MY_TOKEN)`) and register a provider for that token. This is a frequent surprise for developers who assume TypeScript's interfaces survive to runtime like classes do.

## Question 29

**You upgraded TypeScript and now every `@Inject()` breaks. What likely happened?**

You probably moved (or a dependency moved) to **TC39 Stage-3 decorators**, which don't support **parameter decorators** — exactly what `@Inject()` is. The legacy `experimentalDecorators` mode is required for parameter decorators and `emitDecoratorMetadata`-based DI. The fix is ensuring the DI-heavy packages keep `experimentalDecorators: true` (and the matching `useDefineForClassFields`/`reflect-metadata` setup), and not flipping to the standard decorators in code that relies on the legacy behavior.

## Question 30

**Will swapping a runtime-reflection framework for a native image "just work"?**

No. Native images (GraalVM) can't follow arbitrary runtime reflection, so annotations read reflectively at runtime stop working unless you provide **reachability metadata** declaring those accesses — effectively forcing the runtime processing back to build time. This is why reflection-heavy frameworks ship AOT processors/agents and why compile-time DI frameworks (Dagger, Micronaut) are natively native-image-friendly. The annotation strategy is half of native-image readiness.

---

## Design Questions

## Question 31

**Design a routing layer using decorators/annotations. What are the trade-offs?**

A decorator/annotation-based router (`@route("/users")`, `@GetMapping`) registers handlers declaratively: the decorator (Python/TS) runs at import/definition time and adds the handler to a registry, or the annotation (Java) is discovered by a runtime scanner. Decide compile-time vs runtime: runtime registration (Flask, Spring MVC) is simple and dynamic but pays startup scanning; compile-time registration (codegen) is faster to start and native-image friendly but needs a processor. Key design points: how routes are discovered (import side effects vs explicit registration vs scanning), how middleware stacks compose (decorator order = middleware order, so auth must wrap cache), and how to keep routes *discoverable* despite action at a distance (a way to list all routes). The central tension is convenience vs the invisibility of where a URL is wired.

## Question 32

**Design a validation framework driven by annotations. Compile-time or runtime?**

Annotations like `@NotNull`, `@Size(min=2)`, `@Email` declare constraints on fields. The reader can be runtime (Bean Validation / Hibernate Validator reflects over annotated fields when you call `validate(obj)`) or compile-time (a processor generates validation code, eliminating reflection). Runtime: flexible, integrates with any object graph, but pays reflection cost per validation and discovers configuration errors late. Compile-time: zero reflection, errors at build, native-image friendly, but more build infrastructure. Design choices: how constraints compose on one field (repeatable annotations), how to handle nested objects (`@Valid` cascade), how to localize messages, and how to surface violations (collected list vs fail-fast). For high-throughput APIs validating every request, the compile-time or cached-reflection path matters.

## Question 33

**Design a DI container. How do you wire dependencies from annotations/decorators, and when do you do the work?**

Two architectures mirroring the core axis. **Runtime reflection (classic Spring):** scan for `@Component`, read `@Autowired`/constructor parameter types via reflection, build the dependency graph at startup, instantiate in dependency order, wrap in proxies for AOP. Simple and dynamic; pays startup and reflection cost; native-image hostile. **Compile-time generation (Dagger, Micronaut):** a processor reads `@Inject`/`@Module` at build time, generates plain factory code with direct `new` calls, and reports missing bindings as *compile errors*. Near-instant startup, no runtime reflection, native-image ready; slower builds and a steeper learning curve. For TypeScript, you'd use the `reflect-metadata` `design:paramtypes` approach for class-typed deps and explicit tokens for interfaces. The decisive factor is your startup/cold-start budget and whether you target native images.

## Question 34

**Design a memoization/caching decorator. What edge cases must it handle?**

The decorator wraps a function, computes a cache key from the arguments, returns the stored result on a hit, and stores on a miss. Edge cases: (1) **unhashable arguments** — keys must be hashable; lists/dicts need conversion or rejection. (2) **`functools.wraps`** to preserve identity. (3) **Eviction** — unbounded caches leak memory; support a max size (LRU) like `functools.lru_cache(maxsize=...)`. (4) **Mutable return values** — returning a cached mutable object lets callers corrupt the cache; consider copying or documenting. (5) **Thread safety** — concurrent calls may both miss and compute; decide between a lock (correctness) and duplicate computation (throughput). (6) **Cache invalidation** — expose a `cache_clear`. (7) **Per-instance vs shared** — a method decorator may unintentionally key across instances or leak `self` into the key. (8) **Stacking order** — `@cache` outside `@authorize` would serve unauthorized cached data, so order it correctly. The decorator's power (it actually changes behavior) is exactly why these correctness traps matter.
