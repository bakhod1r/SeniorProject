# Change Preventers — Professional Level

> Focus: runtime cost of cross-cutting cures (AOP, decorators), code-generation tooling internals, build-time vs runtime trade-offs.

---

## Table of Contents

1. [The cost of cures — overview](#the-cost-of-cures-overview)
2. [Spring AOP runtime](#spring-aop-runtime)
3. [AspectJ vs Spring AOP](#aspectj-vs-spring-aop)
4. [Python decorator overhead](#python-decorator-overhead)
5. [Code generation: build-time vs runtime](#code-generation-build-time-vs-runtime)
6. [MapStruct internals](#mapstruct-internals)
7. [Annotation processors](#annotation-processors)
8. [Profiling AOP-heavy applications](#profiling-aop-heavy-applications)
9. [Review questions](#review-questions)

---

## The cost of cures — overview

| Cure for Shotgun Surgery | Runtime cost | Build-time cost |
|---|---|---|
| Hand-written mappers | None | None |
| MapStruct (Java) | None (compile-time generation) | Annotation processor on each build |
| Lombok (Java) | None (bytecode manipulation at compile) | Annotation processor + IDE plugin |
| Pydantic v2 (Python) | Per-instance validation | None (it's a library) |
| Protobuf (multi-language) | Per-message serialization | Code-gen step |
| Spring AOP | Per-call proxy overhead | None |
| AspectJ (compile-time weaving) | None (woven into bytecode) | Compile-time weaving step |
| Python decorators | Per-call wrapper | None |

> **Trend:** modern tools push work to build time, where it's cheap, instead of runtime, where it accumulates per call.

---

## Spring AOP runtime

Spring AOP uses **proxy-based interception**. When you annotate a class with `@Service` and apply an aspect, Spring wraps the bean in a proxy:

- **JDK dynamic proxy** if the bean implements an interface.
- **CGLIB proxy** (subclass with bytecode generation) if no interface.

### The proxy chain

A call to a `@Transactional`-annotated method:

```
Client → Proxy → TransactionInterceptor.invoke() → 
       → AnnotationAwarePointcutAdvisor → 
       → MethodInvocation.proceed() → 
       → real method
```

Each layer is an indirect call. Total: ~5-10 extra method calls per intercepted call.

### Cost in practice

For a method that takes 1 microsecond, AOP overhead is ~50-100 nanoseconds — significant. For a method that takes 1 millisecond (typical service call with DB), overhead is ~0.01% — irrelevant.

**Implication:** AOP is fine for service-layer methods (slow, infrequent enough that overhead doesn't matter). Avoid AOP on hot inner-loop methods.

### Caveats

- **Proxies bypass `this`-calls.** Inside the proxied bean, `this.method()` skips the proxy. Solution: use `self`-injection or AspectJ.
- **Final classes/methods can't be CGLIB-proxied.** `final` defeats Spring AOP via subclassing.
- **Constructor calls aren't intercepted** by Spring AOP. You can't put `@Transactional` on a constructor.

---

## AspectJ vs Spring AOP

| | Spring AOP | AspectJ |
|---|---|---|
| **Implementation** | Runtime proxy | Compile-time bytecode weaving |
| **Intercepts** | Spring beans only | All Java code (any class) |
| **`this`-calls** | Skipped | Intercepted |
| **Overhead per call** | ~50-100ns | Near zero (woven inline) |
| **Build complexity** | Minimal | Requires `aspectjc` weaver |
| **Debugging** | Stacktraces show proxy frames | Stacktraces show woven code (cleaner) |

For most services, Spring AOP is enough. For libraries or hot paths, AspectJ wins on performance and clarity.

---

## Python decorator overhead

Python decorators are syntactic sugar for `f = decorator(f)`. The decorated function is the wrapper. Cost per call:

```python
def trace(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        print(f"Calling {fn.__name__}")
        return fn(*args, **kwargs)
    return wrapper

@trace
def add(a, b): return a + b

# Each call to add() goes through wrapper():
# - argument unpacking
# - print() call
# - inner function call
# - return value
```

Overhead: ~1-5 microseconds per call (CPython). For a function that takes 100ns, decorator is 10-50× overhead. For a function that takes 1ms, it's 0.5%.

### Decorator stacking

```python
@a
@b
@c
def f(): ...

# Equivalent to: f = a(b(c(f)))
# Each call: f → a's wrapper → b's wrapper → c's wrapper → real f
```

Three decorators = three extra function calls per invocation. Each decorator's overhead compounds.

### Optimization: keep decorators thin

For hot paths:
- Use `functools.lru_cache` (built-in C implementation, near-zero overhead).
- Avoid `print` / I/O in decorators.
- Consider `cython` or `mypyc` for compiled wrappers.

---

## Code generation: build-time vs runtime

Code generation moves work from runtime to build time.

### Build-time generators

Run as part of compilation:
- Java annotation processors (Lombok, MapStruct)
- Pydantic v2 validators (compiled in C, but conceptually code-gen)
- Protobuf `protoc`
- OpenAPI generator

**Pro:** runtime cost = zero; generated code is just code.
**Con:** build time increases; generated code may be hard to debug.

### Runtime "generators" (reflection-based)

- Jackson reflection mode
- Hibernate (uses CGLIB at runtime to build proxy entities)
- Java Bean Validation (`@NotNull`, etc.)

**Pro:** no build-time complexity.
**Con:** runtime cost, especially on first use; harder to optimize.

### Modern preference

The trend in modern stacks:
- **Java:** Lombok / MapStruct / Java records (compile-time) over reflection.
- **Python:** Pydantic v2 (compiled validators in Rust core) over runtime introspection.
- **Go:** code generation via `go:generate` over reflection.
- **TypeScript:** the type system itself (erased at runtime, zero cost).

---

## MapStruct internals

MapStruct is an annotation processor that generates mapper implementations at compile time.

```java
@Mapper
public interface CustomerMapper {
    @Mapping(source = "firstName", target = "name.first")
    @Mapping(source = "lastName", target = "name.last")
    CustomerDto toDto(Customer customer);
}
```

At compile time, MapStruct generates:

```java
public class CustomerMapperImpl implements CustomerMapper {
    public CustomerDto toDto(Customer customer) {
        if (customer == null) return null;
        CustomerDto dto = new CustomerDto();
        dto.setName(toName(customer.getFirstName(), customer.getLastName()));
        return dto;
    }
    private Name toName(String first, String last) { ... }
}
```

The output is plain Java — no reflection, no runtime overhead. As fast as a hand-written mapper, but generated and consistent.

### Build-time impact

A project with 100 mappers adds ~5-10 seconds to the compile time. On clean builds, noticeable; on incremental builds, only changed mappers regenerate.

### Debugging

MapStruct generates `*MapperImpl.java` files in `target/generated-sources/`. IDEs (IntelliJ, Eclipse) recognize these — you can navigate, set breakpoints, step through.

---

## Annotation processors

The mechanism behind Lombok, MapStruct, AutoValue, etc.

### How it works

1. `javac -proc:full ...` enables annotation processing.
2. Discovered processors (via `META-INF/services`) run after the source is parsed.
3. Each processor inspects the AST, looks for annotations, generates new source files (or modifies existing ones via `Trees`).
4. The generated sources are compiled in a follow-up pass.

### Lombok's special trick

Lombok manipulates the AST directly (using internal Java compiler APIs), modifying class files in-place. This is non-standard — Lombok provides IDE plugins so editors recognize the manipulation.

### Performance

Annotation processing adds 10-30% to compile time on a typical project. For large monorepos, this is significant — there are workarounds (incremental processing, separating processor-heavy modules).

---

## Profiling AOP-heavy applications

When AOP overhead becomes visible in profiles:

### Async-profiler

Look for frames named `AbstractMethodInterceptor.invoke`, `MethodInvocation.proceed`, `ReflectiveMethodInvocation` — Spring AOP's interception path.

### Flame-graph diagnosis

If you see a "tower" of interceptor frames before the real method, the AOP chain is deep. Each layer is a real method call in HotSpot's view.

### Cures (in order of impact)

1. **Disable interceptors not used in production.** Spring lets you toggle aspects per profile.
2. **Switch to AspectJ.** Compile-time weaving eliminates the proxy chain.
3. **Restructure the code so cross-cutting concerns happen at coarser granularity** (per-request rather than per-method).

---

## Review questions

1. **My Spring service has 8 aspects applied. Profile shows 12% time in interception. Diagnosis?**
   Each aspect adds proxy chain depth. With 8 aspects, you have ~16+ extra method calls per service call. Cures: AspectJ for hot aspects, fewer aspects (combine where possible), or coarser-grained interception (per-controller rather than per-method).

2. **Why is `this`-call not intercepted by Spring AOP?**
   Spring AOP uses proxies — calls go through the proxy only when made via the bean reference (the proxied object). Inside the bean, `this` is the original object (not the proxy), so internal calls bypass advice. AspectJ has no such limitation.

3. **MapStruct generates 5,000 lines of code. Is that bad?**
   Not bad — generated code is hidden in `target/generated-sources/`. It has zero runtime cost. The downside is build time and occasional debugging pain (when the mapper does the wrong thing, you have to read generated code).

4. **Pydantic v2 vs v1 — performance difference?**
   Pydantic v2 has its core in Rust (`pydantic-core`). Validation is 5-50× faster than v1 (which was pure Python). For high-throughput services, v2 is the standard choice.

5. **Lombok's `@Builder` generates a Builder. Run-time cost?**
   None. The Builder is plain Java, generated at compile time. Performance equivalent to hand-written.

6. **`functools.lru_cache` in Python — how is it different from a hand-rolled decorator cache?**
   `lru_cache` is implemented in C (CPython). Cache lookup is ~100× faster than a Python `dict`-based decorator. For hot paths, prefer it.

7. **Protobuf vs JSON — performance?**
   Protobuf serialization is ~5× faster than Jackson/JSON, payload is ~50% smaller. Cost: build-time `protoc` step + IDL maintenance. For internal service-to-service: protobuf wins. For public APIs (where consumer-friendliness matters): JSON usually still wins.

8. **Compile-time AspectJ weaving — does it survive across deployments?**
   Yes — the bytecode is permanently woven. The deployed `.jar` contains the woven code. No runtime weaver needed in production.

9. **Why does CGLIB-proxy fail on `final` classes?**
   CGLIB creates a subclass of the target. `final` classes can't be subclassed. Solution: use JDK dynamic proxies (require an interface) or AspectJ (works on any class).

10. **A team's build doubled in time after adding annotation processors. Diagnosis?**
    Likely culprits: overlapping processors (Lombok + MapStruct + Immutables all running), processors with bad caching (regenerate on every build), or incremental compilation disabled. Profile the build with `--profile` or `-Xlint:processing`.

---

> **Next:** [interview.md](interview.md) — Q&A.
