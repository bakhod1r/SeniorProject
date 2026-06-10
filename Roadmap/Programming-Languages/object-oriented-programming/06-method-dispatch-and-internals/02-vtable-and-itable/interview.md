# vtable and itable — Interview Q&A

20 questions on vtables, itables, HotSpot internals, performance, and edge cases. Suited to senior backend or platform interviews where Java internals come up.

---

## Q1. What is a vtable in HotSpot, and what does it store?

A vtable (virtual method table) is a per-class array of `Method*` pointers held inside the class's `Klass` metadata in metaspace. Each slot corresponds to one overridable instance method — `Object`'s inherited slots first, then the class's class-specific slots in declaration order. `invokevirtual` resolves to a fixed slot index at link time, and dispatch becomes a two-load operation: load the receiver's klass pointer from the object header, load the method pointer from the precomputed vtable slot.

**Trap:** Candidates often say "the vtable is in the object". It isn't — the object only holds the klass pointer; the vtable lives in the `Klass` to avoid duplicating the table per instance.

---

## Q2. What's the difference between a vtable and an itable?

Vtables exist *per class*; one table covers all overridable methods. Itables exist *per interface implemented by a class*; one table per interface. `invokevirtual` uses the vtable (single indexed load). `invokeinterface` uses the itable — but first it has to find *which* itable corresponds to the static interface type, which involves a secondary super search on the class. HotSpot caches the result at the call site (inline cache) so the steady-state cost is comparable to `invokevirtual`.

**Follow-up:** "Why can't a class just have one big table with both class methods and all its interface methods?" — Because a class can implement many interfaces and the interfaces don't share a fixed slot ordering. A single table would require coordinating slot numbers across the entire interface graph, which doesn't scale.

---

## Q3. Which methods are NOT in the vtable?

`private` methods (no override possible), `static` methods (belong to the class, not the instance), `final` methods (declared non-overridable), constructors (never inherited), and methods on `final` classes (no subclass to override). These are dispatched statically — `invokestatic`, `invokespecial`, or a direct call after C2 devirtualization. The vtable holds only methods that could legally be overridden by a subclass.

**Follow-up:** "What about `default` methods on interfaces?" — They are dispatched via the itable, not a class vtable. Each implementing class's itable points at the chosen default (or override) for each interface method.

---

## Q4. Walk through what happens when `dog.speak()` is called.

Assume `Dog extends Animal` and `speak()` is overridden in `Dog`. The bytecode is `invokevirtual Animal.speak`.

1. Constant pool resolution gives a vtable slot index — say slot 12 — based on `Animal`'s vtable layout.
2. At runtime, the JVM loads `klass*` from `dog`'s object header.
3. It loads the method pointer at offset (`vtable_base + 12 * word_size`) of that Klass.
4. In `Dog`'s vtable, slot 12 holds `Dog.speak` (the override).
5. The JVM jumps to that method's entry point.

After the JIT compiles the caller and observes the receiver is always `Dog`, it can replace this sequence with a guarded direct call to `Dog.speak`, with deoptimisation if the assumption breaks.

---

## Q5. How does the JIT decide to devirtualize a call?

Through Class Hierarchy Analysis (CHA) and call-site profiling:

- **CHA:** scans loaded classes for subclasses/implementations. If the static type's only target is one concrete method, emit a direct call.
- **Profiling:** the interpreter and C1 record which receiver types appear at each call site. If one type dominates (>95%), C2 emits a *guarded* direct call: type check, then direct call.

If a new class loads later that adds a target, the JIT deoptimises and recompiles. This is why `final`, `sealed`, and records help — they make CHA's job conclusive.

---

## Q6. What is a "megamorphic" call site?

A call site that sees more than 2 distinct receiver types at runtime. The JIT's inline cache can't hold them all, so it falls back to the full vtable/itable lookup on every call. The callee can't be inlined (the JIT doesn't know which one to inline), which usually costs more than the dispatch itself — inlining enables constant folding, escape analysis, and further optimisations that are lost in the megamorphic case.

**Real-world fix:** group polymorphic work by concrete type, seal the hierarchy, or accept the cost if the site isn't hot.

---

## Q7. What's the cost difference between `invokevirtual` and `invokeinterface`?

In the monomorphic / inline-cached case, essentially identical: one type check (compare-and-branch) plus a direct call. In the megamorphic case, `invokeinterface` is roughly 1.5x-4x slower because it requires (a) finding the right itable via the secondary super array search, then (b) the indexed load into that itable, before (c) the indirect call. JDK 21's packed-cache secondary super check reduces this dramatically.

**Trap:** Saying "interfaces are always slower than abstract classes". That was more true a decade ago; in modern JVMs with monomorphic inline caches and CHA on sealed types, the difference is rarely measurable.

---

## Q8. What is a bridge method and why does it exist?

A bridge method is a synthetic method (`ACC_BRIDGE | ACC_SYNTHETIC`) inserted by javac to preserve a parent's erased signature when a subclass overrides with a covariant return or a more specific generic type. Example: `class StringBox extends Box<String>` declares `String peek()`; javac inserts a bridge `Object peek()` that calls the real one. Both occupy vtable slots — the bridge takes the slot inherited from the parent's erased signature; the real method gets a new slot.

**Follow-up:** "What happens if reflection iterates `getDeclaredMethods()`?" — Both methods appear; filter with `Method.isBridge()` or `isSynthetic()`.

---

## Q9. What is the "Miranda method" problem?

When an abstract class implements an interface but doesn't provide a concrete method for one of the interface's methods, the JVM must still allocate a vtable slot for that method — otherwise a subclass that provides the implementation has no slot to overwrite. HotSpot inserts a synthetic abstract `Method*` (or a thunk throwing `AbstractMethodError`) at that slot. The term "Miranda" is a pun on Miranda rights — "if you don't have an implementation, one will be appointed for you".

---

## Q10. How are default methods on interfaces dispatched?

Via the itable. Each implementing class's itable maps every method in the interface to a `Method*`. If the class overrides the default, the itable points at the override. If it doesn't, the itable points at the interface's default implementation. When multiple interfaces provide conflicting defaults (no maximally-specific selection per JVMS §5.4.3.3), the class must override explicitly or compilation/linking fails with `IncompatibleClassChangeError`.

---

## Q11. What is the secondary super array?

A per-class array listing all the class's secondary supertypes — primarily implemented interfaces and supertypes that don't fit the linear primary chain. The JVM uses it for `instanceof` checks against interfaces, checked casts, and to find the right itable during `invokeinterface`. HotSpot caches the most recently matched super to avoid repeated linear scans; JDK 21 added a hash-based cache making the lookup near-constant time.

---

## Q12. How does `instanceof` interact with itables?

For `instanceof SomeClass` against a primary supertype: a linear-chain check (fast).

For `instanceof SomeInterface` or against a non-linear supertype: a secondary super array search. Pre-JDK 21 this was a linear scan with a single-entry cache; JDK 21+ uses a hashed cache. Cost grows roughly linearly with the receiver's implemented-interface count in the worst case on older JVMs.

Itables themselves aren't searched for `instanceof` — but the *same* secondary super array is. A class with many implemented interfaces has both a large itable list and a slower `instanceof` against interfaces.

---

## Q13. Are records' methods in a vtable?

Yes — every class has a vtable, and records inherit from `Record`/`Object`. The accessor methods, `equals`, `hashCode`, and `toString` overrides occupy slots in the record's vtable. The difference is that records are *implicitly final*: no subclass can exist, so CHA proves monomorphism for every call site receiving a record, and the JIT devirtualizes unconditionally. Records' vtables are present but the JIT effectively never has to consult them at runtime.

---

## Q14. What does `Method.invoke()` do regarding the vtable?

It performs *virtual dispatch* on the receiver. The `Method` object you obtained via `getMethod` describes which symbolic method to invoke; the actual call uses the receiver's class to pick the override. So `parent.class.getMethod("m").invoke(child)` calls `child.m`, not `parent.m`. To invoke exactly the parent's method, use `MethodHandles.Lookup.findSpecial`, which produces an `invokespecial`-style handle that bypasses the vtable.

---

## Q15. Why does a deep inheritance hierarchy cost more at class loading?

Vtable construction for class `C` involves: copy the parent's vtable, patch the slots that `C` overrides, append new slots, fill miranda entries. The copy is O(parent vtable size). Across a 6-level chain where each level adds methods, the cumulative cost grows quadratically — every descendant's vtable construction does the full work of copying everything above it.

Plus, each level is its own class with its own constant pool resolution, method table, and itable construction. For an enterprise framework with thousands of classes in deep hierarchies, this dominates startup.

**Follow-up:** "Does the dispatch get slower too?" — No. Dispatch is a fixed-offset load regardless of depth. The cost is at class loading only.

---

## Q16. What is an inline cache?

A per-call-site optimisation: after the first invocation resolves the target method, the JIT rewrites the call site as a *guarded direct call*. Equivalent native code:

```
   cmp klass_ptr, EXPECTED_KLASS
   jne slow_path                 // class changed, redo lookup
   call EXPECTED_METHOD          // direct, can be inlined
```

This is the trick that makes `invokeinterface` competitive with `invokevirtual`. Inline caches come in degrees: monomorphic (1 type), bimorphic (2 types), megamorphic (3+ types, fall back to full lookup).

---

## Q17. How do sealed types affect dispatch performance?

Runtime structure is unchanged — vtables and itables look the same. The difference is *what the JIT can prove*:

- `javac` enforces the closed permits list (exhaustive `switch` is checked).
- CHA can enumerate all possible targets; CHA-based devirtualization succeeds even without runtime profiling.
- The JIT can emit a Klass-switch with multiple direct calls when the permits list is small (typically up to 3-4 cases).

The net effect: sealed types with final implementations (often records) keep call sites monomorphic or low-arity polymorphic, which is the JIT's sweet spot.

---

## Q18. What's in the `Klass` structure besides the vtable and itables?

Roughly: a header (size, type info), the class's name, a pointer to the class loader, the superclass and primary super chain, the secondary super array, the methods table (`Method*` array for all methods including private/static), the fields layout, the constant pool reference, the access flags, and protection-domain info. The vtable and itables are appended at known offsets. The whole structure typically occupies 1-10 KB per class in metaspace.

Source: `instanceKlass.hpp` in the OpenJDK source tree.

---

## Q19. How would you investigate a slow loop that you suspect is megamorphic?

1. Confirm with async-profiler: look for `itable_stub` or `vtable_stub` frames at the top of the flame graph.
2. Confirm with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`: find the call site labelled `(megamorphic)` or `(virtual call)`.
3. Inspect the source: how many concrete receiver types reach this site? Where do they come from?
4. Apply one of: group iteration by concrete type, seal the hierarchy, mark classes final, restructure to a switch over a sealed type, or accept the cost.
5. Re-measure with JMH and re-profile. The flame graph should no longer show stub frames.

---

## Q20. Should you mark every class `final` for performance?

No. Three reasons:

1. The JIT often proves monomorphism via CHA + profiling anyway, making `final` redundant.
2. `final` is *design intent*: "I don't want this extended". Use it where that's true. Performance is a secondary benefit.
3. Aggressive `final` can hurt testability (mocking frameworks can't subclass) and extensibility (third parties can't customise behaviour).

Where `final` does help measurably: methods on classes that have many subclasses where one specific method shouldn't be overridden, classes that are leaves in your design intent, and AOT-compiled code (GraalVM Native Image) where there's no runtime profiling. For ordinary JIT-compiled steady-state code, `final` is a hint that's already redundant most of the time.

---

## Bonus — design-level question

**"Critique a class that `implements` 12 interfaces."**

Twelve interfaces means 12 itables in the `Klass`, a 12-entry secondary super array, and `instanceof` checks against any of them go through the secondary super path. Pre-JDK 21, that's measurable cost. Beyond performance, it usually means the class is doing too much (SRP smell), or the interfaces are *marker* interfaces being used as classification ("this is `Auditable`, `Versionable`, ..."). Replace markers with composition (a `metadata` field) or split the class.

Cross-link to [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) — the design-level fix is the same as the dispatch-level fix.

---

## Quick rules

- [ ] Vtable = per-class, indexed by slot; itable = per-interface, indexed via secondary super search.
- [ ] `private`, `static`, `final`, and constructor methods bypass the vtable.
- [ ] CHA + profiling + inline caches make most call sites effectively monomorphic.
- [ ] Bridge methods, miranda methods, and covariant returns add vtable slots.
- [ ] Sealed types and records keep dispatch surface small without changing runtime structure.
- [ ] Profile before optimising; most code's dispatch cost is below noise.

---

**Memorize this:** vtable = one array per class, itable = one per interface per class, inline cache = JIT's optimisation to make either of them cheap. Every other question in this section is a refinement of those three ideas.
