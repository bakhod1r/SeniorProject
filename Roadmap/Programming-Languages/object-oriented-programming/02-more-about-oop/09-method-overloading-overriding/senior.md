# Method Overloading / Overriding — Senior

> **What?** The runtime mechanics: vtable lookup for overrides, inline cache states, JIT devirtualization via class hierarchy analysis, the cost of bridge methods, and the design implications of polymorphism vs static dispatch.
> **How?** By understanding how the JIT collapses well-warmed virtual calls to direct calls, how megamorphism kills inlining, and how to design for monomorphic hot paths.

---

## 1. Vtable dispatch under the hood

Every class has a vtable indexed by method slot. Overrides replace the parent's slot for that method. Calling an instance method:

```
1. Pop receiver.
2. Read receiver's klass pointer.
3. Index klass's vtable at the resolved slot.
4. Call the function at that slot.
```

Cost: 1 indirect load + 1 indirect call ≈ 5 ns cold, ~1 ns hot. Well-warmed sites are even cheaper after JIT inlining.

---

## 2. Inline caches

The JIT installs an inline cache per virtual call site:

| State          | Action                                       |
|----------------|----------------------------------------------|
| Uninitialized  | First call: install klass + target           |
| Monomorphic    | One klass — direct call, often inlined       |
| Bimorphic      | Two klasses — branch on klass                 |
| Megamorphic    | 3+ klasses — vtable lookup, no inlining       |

For monomorphic call sites, the JIT often inlines the override completely, turning a "virtual" call into direct code.

---

## 3. Class hierarchy analysis (CHA)

When the JIT compiles a method, it looks at currently loaded classes. If a method has no overrides loaded, it's effectively `final` — the JIT inlines.

If a new subclass with an override is loaded later, the JIT *deoptimizes* the affected code and recompiles. Rare in practice.

This is why even non-`final` virtual calls are usually fast: CHA proves they're effectively direct.

---

## 4. `@Override` and the JIT

`@Override` is a compile-time annotation. The JIT doesn't see it. But its presence helps catch bugs that *would* affect runtime — typos, missing parents, etc.

`@Override` doesn't make code faster. It just makes it correct.

---

## 5. Overloading and JIT

Overloads are resolved at compile time. The bytecode contains `invokevirtual` to a specific method. The JIT just inlines or dispatches as usual; there's no overload-time runtime cost.

---

## 6. Bridge method overhead

Generic bridge methods add an indirection:

```java
class Box<T> { void put(T x) { } }
class IntBox extends Box<Integer> {
    @Override void put(Integer x) { }
}
```

When a caller does `box.put(x)` where `box: Box<Integer>`, the bytecode emits `invokevirtual Box.put(Object)`. Dispatch lands in `IntBox`'s synthetic bridge `put(Object)`, which casts and calls `put(Integer)`. Two calls instead of one.

The JIT typically inlines through the bridge, eliminating the indirection. So the cost is theoretical for hot paths, real for cold ones.

---

## 7. Megamorphic dispatch

Megamorphic call sites can be 3-10× slower than monomorphic ones. Causes:

- Many small implementations of the same interface
- Frameworks that proxy/intercept calls
- Tests that load mocks of multiple types

Detect with `-XX:+PrintInlining`; look for "callee not inlineable, megamorphic."

Fix:
- Reduce the number of implementations
- Extract hot paths into specialized methods
- Use sealed types to bound the variant set
- Use `final` on leaf classes

---

## 8. Static method hiding

Static methods are dispatched at compile time. There's no vtable involved. The "hide" relationship in source code is purely lexical.

```java
class Parent { static int compute() { return 1; } }
class Child extends Parent { static int compute() { return 2; } }

Parent.compute();    // 1 — direct call
Child.compute();     // 2 — direct call
((Parent) c).compute();    // 1 — static dispatch via declared type
```

For this reason, static methods can't be polymorphic and `@Override` doesn't apply.

---

## 9. Final methods and devirtualization

`final` methods are not in the vtable (in optimization terms — they're directly called). The JIT can always inline them.

For hot paths, mark methods `final` if you don't expect override. Or mark the class `final`. Or use sealed types.

---

## 10. Sealed types and dispatch

A sealed type's permitted set is closed. The JIT and the compiler both can use this:
- Pattern matching switch can dispatch via fast classifier
- Exhaustiveness check at compile time
- JIT can specialize each case

For closed hierarchies, sealed types beat open polymorphism in most metrics.

---

## 11. Designing for monomorphism

Common hot-path patterns that stay monomorphic:
- Internal helper methods (only one class implements)
- `final` class hierarchies
- Sealed types with bounded permits

Patterns that go megamorphic:
- Public interfaces with many impls
- Framework proxies/decorators stacking
- Generic frameworks with many user types

Profile to verify; fix if a critical site is megamorphic.

---

## 12. Performance comparison

For most workloads:
- Direct call (private/static/final): ~0.5 ns
- Monomorphic virtual: ~1 ns (JIT-inlined)
- Bimorphic virtual: ~2 ns
- Megamorphic virtual: ~5-10 ns

For typical apps, the difference is noise. For high-throughput services processing millions of calls/sec, it adds up.

---

## 13. Designing test mocks to preserve monomorphism

If you mock interfaces in tests but use one concrete type in production, the test creates extra polymorphism. Mitigate:
- Run benchmarks with production-like type diversity.
- Don't tune based on test-only profiles.
- For load tests, use real implementations.

---

## 14. Practical checklist

- [ ] Use `@Override` everywhere.
- [ ] Mark leaf classes `final` if not extended.
- [ ] Use sealed types for closed hierarchies.
- [ ] Profile hot paths for megamorphism.
- [ ] Avoid stacked decorators in inner loops.
- [ ] Check `-XX:+PrintInlining` for "callee not inlineable" warnings.

---

## 15. What's next

| Topic                          | File              |
|--------------------------------|-------------------|
| Bytecode internals              | `professional.md`  |
| JLS rules                       | `specification.md` |
| Interview prep                  | `interview.md`     |
| Common bugs                     | `find-bug.md`      |

---

**Memorize this**: overriding incurs a vtable lookup + (often) JIT inlining. Monomorphic call sites are essentially free; megamorphic are slower. CHA + inline caches are the JIT's tools for collapsing virtual dispatch. Use `final` and sealed types to assist the optimizer. Overloading has no runtime cost — it's compile-time selection.
