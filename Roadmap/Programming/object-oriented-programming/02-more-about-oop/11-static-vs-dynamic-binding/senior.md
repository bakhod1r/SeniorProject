# Static vs Dynamic Binding — Senior

> **What?** Performance characteristics: vtable lookup costs, inline cache states, devirtualization via CHA, profile-guided optimization (PGO), and how modern JVMs make most virtual calls effectively as fast as direct calls.
> **How?** By understanding HotSpot's tiered compilation, the inline cache lifecycle, and how to profile to verify the JIT made the right calls.

---

## 1. Inline cache lifecycle

Every virtual call site has a tiny cache:

```
Uninitialized → Monomorphic → Bimorphic → Megamorphic
       on miss        on miss          on miss
```

| State          | Cost       | Inlining          |
|----------------|------------|-------------------|
| Uninitialized  | High (slow path) | No          |
| Monomorphic    | ~1 ns      | Often yes         |
| Bimorphic      | ~2 ns      | Sometimes         |
| Megamorphic    | ~5-10 ns   | No                |

For hot code, you want monomorphic or bimorphic call sites.

---

## 2. CHA-based devirtualization

When the JIT compiles a method, it looks at currently loaded classes. If a method has no overrides loaded, it can be inlined as if direct.

If a new subclass loads later with an override, the JIT deoptimizes the affected code (flushes the compiled version) and recompiles.

This means even non-`final` methods are usually direct calls after JIT, as long as no surprise subclass appears.

---

## 3. The cost of polymorphism

Modern JIT makes polymorphism nearly free *when monomorphic*. Polymorphism is expensive when:
- Many implementations exist (megamorphism)
- Receiver types vary unpredictably
- Frameworks generate many proxy classes
- Tests load mocks of multiple types

Profile to verify dispatch type.

---

## 4. `-XX:+PrintInlining`

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining MyApp 2>&1 | grep 'X.method'
```

Output examples:
- `inline (hot)` — JIT inlined this call
- `failed: callee not inlineable` — usually megamorphic
- `failed: too big` — method body too large

Use this to verify hot dispatch sites are inlined.

---

## 5. Profile-guided optimization (PGO)

JVMs profile actual receiver types at runtime. PGO can:
- Specialize for the most common type.
- Generate a fast path + fallback.
- Re-specialize when the distribution changes.

Java's JIT does this automatically via inline caches. GraalVM has more advanced PGO via `--pgo-instrument` and `--pgo`.

---

## 6. Monomorphism strategies

To keep call sites monomorphic:
- Use `final` on classes/methods you don't intend to extend.
- Use sealed types for closed hierarchies.
- Avoid stacking decorators in inner loops.
- Don't substitute mock impls in production.
- Profile before deciding.

---

## 7. Pattern matching as static dispatch

Pattern matching switch over sealed types compiles to fast `tableswitch`/`lookupswitch` on klass identity. This is closer to static dispatch — the compiler knows all possible types.

```java
return switch (s) {
    case Circle c -> ...;
    case Square sq -> ...;
};
```

After JIT: ~1-2 ns per dispatch. Faster than open polymorphism.

---

## 8. Records and binding

Records are `final` by default. All methods on records are JIT-friendly — direct dispatch.

```java
public record Money(long cents, String currency) {
    public Money plus(Money other) { ... }
}

m1.plus(m2);    // monomorphic, often inlined
```

Combine with sealed interfaces for type-safe but JIT-friendly polymorphism.

---

## 9. `MethodHandle` and dynamic dispatch

```java
MethodHandle mh = lookup.findVirtual(I.class, "compute", MethodType.methodType(int.class));
int result = (int) mh.invokeExact((I) obj);
```

`MethodHandle.invokeExact` can be JIT-inlined like `invokevirtual`. Used by frameworks for performance-friendly reflection.

For typed reflection, `MethodHandle` is the right tool.

---

## 10. Lambdas and dispatch

A lambda implementing a functional interface:

```java
Function<String, Integer> length = String::length;
length.apply("hello");
```

Compiles to `invokedynamic` + hidden class. After warmup, `apply` is direct dispatch — the hidden class is `final` and monomorphic at the call site.

---

## 11. Practical performance tips

- Profile hot dispatch sites with `-XX:+PrintInlining`.
- Mark non-extensible classes `final`.
- Use sealed types for closed sets.
- Avoid 5+ implementations in hot paths.
- For very hot code, consider `if-else` chains over polymorphic dispatch (rare).

---

## 12. Static binding wins in:

- Hot inner loops (data crunching, parsing, encoding)
- Tight numeric kernels
- Allocator hot paths
- Critical-path code with profiled monomorphism

## Dynamic binding wins in:

- Strategy/policy variation at runtime
- Plugin architectures
- Domain modeling with polymorphism
- Most application code (after JIT)

---

## 13. JIT-friendly design checklist

- [ ] Use `final` for leaf classes.
- [ ] Use sealed types for closed variants.
- [ ] Profile to verify monomorphism.
- [ ] Avoid framework-generated proxies in inner loops.
- [ ] Records over POJOs for data classes.
- [ ] Pattern matching switch over instanceof chains.

---

## 14. What's next

| Topic                         | File              |
|-------------------------------|-------------------|
| Bytecode internals             | `professional.md`  |
| Spec rules                     | `specification.md` |
| Interview prep                 | `interview.md`     |
| Common bugs                    | `find-bug.md`      |

---

**Memorize this**: dynamic binding is fast in modern JVMs *when monomorphic*. Megamorphism is the silent killer. CHA + inline caches devirtualize most calls. `final`, sealed types, and records help the optimizer. Profile with `-XX:+PrintInlining`.
