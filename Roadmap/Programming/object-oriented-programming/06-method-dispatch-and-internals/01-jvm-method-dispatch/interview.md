# JVM Method Dispatch — Interview Q&A

20 questions covering the five `invoke*` opcodes, runtime resolution, CHA, inline caches, deoptimization, lambdas, and the JIT machinery that makes virtual dispatch fast.

---

## Q1. Name the five `invoke*` opcodes and what each is used for.

`invokestatic` — `static` methods; no receiver. `invokespecial` — constructors (`<init>`), `private` methods, explicit `super.m()`; statically bound. `invokevirtual` — normal instance methods declared on a class; virtually dispatched. `invokeinterface` — instance methods declared on an interface; virtually dispatched through an itable. `invokedynamic` — bootstrapped call sites where the binding is decided at runtime by a bootstrap method; used for lambdas (JEP 181), string concatenation (JEP 280), constant dynamic (JEP 309), and pattern-match switches.

**Follow-up:** "Which is the cheapest?" Static and special are statically bound and inline cleanly; monomorphic virtual and interface inline to roughly the same cost. The gap appears when call sites go megamorphic.

---

## Q2. What's the difference between `invokevirtual` and `invokeinterface`?

Both perform *virtual* dispatch: the actual method body is selected based on the receiver's runtime class. The difference is the table used. `invokevirtual` looks up the method through the class's *vtable* — a flat, contiguous array of method pointers indexed by a compile-time slot. `invokeinterface` looks up through the class's *itable* — a per-interface table that requires either a search or a small hash lookup, because a class can implement many interfaces and the slot for a given interface method is not fixed at compile time. For monomorphic and bimorphic call sites both inline identically; for megamorphic sites `invokeinterface` is slightly more expensive (an extra ~1–3 cycles).

**Trap:** Saying "interfaces are slower than abstract classes". Only true for megamorphic call sites, only by a small margin. Don't choose abstract class over interface for dispatch reasons unless profiling proves it.

---

## Q3. What is `invokespecial` for, and why isn't `super.m()` virtual?

`invokespecial` is used when the *exact* method to invoke is known at compile time even though there's a receiver: constructors, private methods, and explicit `super.m()`. It deliberately bypasses the vtable. For `super.m()`, the static superclass is what you wrote; the JVM dispatches to that exact class's method, not to a deeper override. This is intentional: `super.m()` should mean "the parent's exact behaviour", and `invokespecial` is the mechanism that guarantees it. If `super.m()` were virtual, a sub-subclass could intercept the parent's behaviour through it — which would be a confusing semantic.

**Follow-up:** "Why are private methods `invokespecial` and not `invokevirtual`?" Because they can't be overridden (subclasses can't see them), so virtual dispatch would always resolve to the same method anyway. `invokespecial` makes that static binding explicit and avoids a needless vtable lookup.

---

## Q4. What does it mean for a call site to be monomorphic, bimorphic, or megamorphic?

A call site is *monomorphic* if only one receiver class is ever observed at runtime, *bimorphic* if two are observed, and *megamorphic* if three or more. HotSpot's inline cache records this. For monomorphic, C2 inlines the target directly with a single type guard. For bimorphic, C2 inlines both targets with a type-switch. For megamorphic, C2 falls back to a real `invokevirtual` / `invokeinterface` through the vtable / itable. The cost gap is large: monomorphic is essentially free (~0–1 ns), megamorphic is ~5–10 ns plus the loss of secondary optimizations like escape analysis.

**Trap:** Assuming "polymorphic = slow". Most "polymorphic" code is actually monomorphic at each call site — the JIT specializes per site, not per type.

---

## Q5. Explain CHA (Class Hierarchy Analysis). When does it fail?

CHA is HotSpot's analysis of the loaded class hierarchy at JIT time. If only one subclass of a given class has loaded, CHA can devirtualize any virtual call against that type to a direct call. The assumption is *speculative* — guarded by a deopt trigger that fires if a new subclass loads later. CHA fails when (a) the hierarchy is genuinely polymorphic (many subclasses loaded), (b) a class loads after JIT compilation and invalidates the assumption (causing deoptimization), or (c) reflection / `MethodHandle.invoke` bypasses bytecode-level dispatch entirely. The fix for (b) is `final` and `sealed` — they convert speculative CHA into permanent CHA.

**Follow-up:** "How does the JIT know which compiled methods to invalidate when a class loads?" HotSpot tracks *dependencies*: when CHA assumes "only impl X exists", the compiled method records that dependency. The class loader notifies dependent methods when a violating class loads, and the JIT marks them not-entrant.

---

## Q6. What is an inline cache and how does it evolve?

An inline cache is a per-call-site data structure HotSpot maintains in compiled code, recording the receiver type(s) observed at that site. It evolves through three states:

- **Monomorphic IC** — one `(klass, target)` pair plus a type guard. Cheapest.
- **Polymorphic IC (PIC)** — multiple `(klass, target)` pairs (typically up to ~4) plus a type-switch. Cheap.
- **Megamorphic** — after enough distinct misses, the IC transitions to a stub that performs a real vtable / itable walk. Slowest.

Once a call site is megamorphic, it stays that way in the current compiled code. The way back is deoptimization + recompilation with a new profile. The IC mechanism is what makes virtual dispatch fast in the common case.

**Trap:** Saying "polymorphic call sites are slow". A polymorphic IC with 2–3 entries is still very fast — type-switch + inline. "Slow" begins at megamorphic.

---

## Q7. What is deoptimization? Give three reasons it might happen.

Deoptimization is HotSpot abandoning a compiled method mid-execution and falling back to the interpreter. The JIT inserts *frame metadata* that maps compiled state to interpreter state, allowing a clean transition.

Three common triggers:

1. **`class_check`** — a type guard inserted by C2 found an unexpected receiver class.
2. **`class_loaded`** — a new class loaded that invalidates a CHA-based devirtualization assumption.
3. **`unstable_if`** — a branch the compiler predicted was never taken got taken (the branch profile was wrong).

After deopt, the method continues in the interpreter; the invocation counter eventually triggers recompilation with new profile data. Isolated deopts during warmup are normal; cascades in steady state are tuning bugs.

**Follow-up:** "How do you observe deopts?" `-XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation` shows `made not entrant`. `+TraceDeoptimization` adds the reason.

---

## Q8. How do lambdas use `invokedynamic`?

A lambda expression compiles to an `invokedynamic` instruction at the lambda's *creation* site, not its invocation. The bootstrap method is `LambdaMetafactory.metafactory`. On first execution, the JVM:

1. Calls `metafactory` with the call-site descriptor, the functional interface's method signature, a `MethodHandle` to the synthetic body (e.g., `lambda$run$0`), and the dynamic signature.
2. `metafactory` synthesizes a class implementing the functional interface, with the SAM method delegating to the synthetic body.
3. Returns a `ConstantCallSite` whose target is a `MethodHandle` constructing instances of that synthetic class.
4. The JVM caches the call site at this `invokedynamic` instruction.

Subsequent executions reuse the cached call site. The *actual* invocation of the lambda (`r.run()`) is a normal `invokeinterface` on the functional interface. `invokedynamic` was used only for the creation. This decoupling is the design's point: future Java versions can change *how* lambdas are realized without changing the bytecode.

**Follow-up:** "Why isn't the lambda body just compiled as an anonymous class?" `invokedynamic` lets the JVM choose the implementation strategy — including potential optimizations like value-class lambdas under Valhalla. Anonymous classes commit to a specific representation at compile time.

---

## Q9. What does `final` on a method do at the bytecode level vs the JIT level?

At the bytecode level, `final` does *nothing* visible — the same `invokevirtual` is emitted for a `final` method as for any other instance method. At the JIT level, `final` is a permanent CHA invariant: the JIT knows by construction that no subclass can override this method, so devirtualization needs no deopt guard. The compiled code is identical in either case for monomorphic call sites; the difference is that a `final` method is immune to deopt from future class loads.

`private` methods are slightly different: they use `invokespecial`, which is statically bound by the opcode itself. The JIT inlines them freely with no CHA dance.

**Trap:** Saying "`final` makes the call faster". The compiled steady-state code is typically identical to the non-`final` case. `final` removes the *risk* of deopt; it doesn't make the steady state faster.

---

## Q10. How do `sealed` types help dispatch performance?

`sealed` declares the implementer set is closed at compile time. CHA now has a permanent invariant: no future class load can invalidate the assumption "exactly these implementers exist". The JIT can:

1. Devirtualize aggressively across the closed set, with no deopt guard.
2. Compile pattern-match `switch` to a `tableswitch` over types, inlining all branches.
3. Avoid the megamorphic-IC fallback entirely if all branches inline.

Combined with `record` for each implementer (which is implicitly `final`), `sealed` gives the JIT the strongest possible type-set invariant. Pattern switches over sealed types typically run 2–3× faster than equivalent virtual dispatch over an open interface in tight loops.

**Trap:** Adding `sealed` everywhere. Sealed types are correct for *closed* sets where you control all implementers. For open plugin systems, sealed is wrong — use open polymorphism and accept the dispatch cost.

---

## Q11. Walk through what happens when you call `list.add(x)` where `list` is `List<String>` and the runtime class is `ArrayList`.

1. **`javac`** sees `list` as `List<String>` (an interface). Emits `invokeinterface List.add(Object)`. The generic type parameter is erased; the descriptor is `(Ljava/lang/Object;)Z`.
2. At runtime, the JVM **resolves** `List.add` per JVMS §5.4.3.4 — finds the abstract declaration on `List`.
3. The JVM performs **selection** per §5.4.6 on the receiver's actual class (`ArrayList`). `ArrayList.add(Object)` is found and selected.
4. **First few calls** run interpreted; the call site records `ArrayList` as the observed receiver.
5. **C1** compiles `list.add(x)` with profiling instrumentation.
6. **C2** sees the call site is monomorphic on `ArrayList`. CHA confirms `ArrayList` (assuming no subclass exists in this app). The call is devirtualized: direct call to `ArrayList.add`. The method body is inlined.

Net effect: a virtually dispatched call through an interface ends up as a direct, inlined call in compiled code. The bytecode is `invokeinterface`; the steady-state machine code is `call ArrayList::add` (or even fully inlined).

**Follow-up:** "What if `list` could be either `ArrayList` or `LinkedList`?" The call site is bimorphic; C2 emits a type switch with both bodies inlined.

---

## Q12. What's the difference between method *resolution* and method *selection*?

**Resolution** (JVMS §5.4.3) is the *static* step: given a symbolic reference (the constant pool entry like `Animal.speak`), find the actual method declaration. This happens once per call site at link time and produces a method ID.

**Selection** (JVMS §5.4.6) is the *dynamic* step: given the resolved method and a runtime receiver class, find which method body actually runs. This walks the receiver's class hierarchy looking for an override. It happens on every call (in concept; in practice the inline cache caches the result).

For `invokestatic` and `invokespecial`, resolution is the whole story — there is no selection. For `invokevirtual` and `invokeinterface`, both steps happen. The split is why "method called" and "method declared" can differ — resolution names the declared method; selection picks the override.

**Follow-up:** "When can resolution fail?" If the referenced method doesn't exist, or has wrong visibility, or has incompatible flags (static vs instance). The JVM throws `NoSuchMethodError`, `IllegalAccessError`, or `IncompatibleClassChangeError`.

---

## Q13. Why is reading bytecode with `javap -c -v` worth the time?

Because dispatch behaviour is *mechanical* once you can read the bytecode. Every question of the form "which method actually gets called?" or "is this a virtual call?" has a definite answer in the disassembly. `javap -c -v` shows the opcode, the constant-pool reference (`Methodref`, `InterfaceMethodref`, `InvokeDynamic`), the descriptor, and the local variable table. Many "subtle" dispatch bugs become obvious after one look — missing `@Override`, `private` shadowing, raw types triggering bridge methods, static methods called through instance references.

```
$ javap -c -v Demo.class
```

**Follow-up:** "What about `-p`?" `-p` shows private members. Use it when investigating bridge methods or compiler-generated synthetic methods.

---

## Q14. How does HotSpot's tiered compilation work?

Three (effective) levels:

- **Level 0 — Interpreter.** Every method starts here. A simple invocation counter ticks.
- **Levels 2–3 — C1 with profiling.** The fast compiler. Produces decent code quickly. Instruments call sites to record receiver-type profiles.
- **Level 4 — C2.** The optimizing compiler. Uses the profile collected at C1 to make inlining and devirtualization decisions.

(Graal can replace C2 via `-XX:+UseJVMCICompiler`.)

A method is promoted from level 0 to 2 after ~2500 invocations (default), then from 2 to 4 after ~10000. Hot code reaches C2 in milliseconds in real workloads. The profiling stage is essential — without it, C2 has to guess, often suboptimally. That's why tiered compilation is the default.

**Trap:** Believing "C2 is always faster". For tiny methods, C1's output is sometimes comparable. C2's wins compound through inlining, which is what makes monomorphic dispatch free.

---

## Q15. What happens at the bytecode level when you concatenate strings with `+`?

Since Java 9 (JEP 280), `"Hello, " + name + "! Age " + age` compiles to a single `invokedynamic` instruction. The bootstrap method is `StringConcatFactory.makeConcatWithConstants`. The bootstrap receives a *recipe string* describing the concatenation pattern (constants interleaved with placeholders) plus the dynamic argument types. It returns a `ConstantCallSite` holding a `MethodHandle` specialized for those types.

Before Java 9, the same code emitted a `StringBuilder` chain — `new StringBuilder().append(...).append(...).toString()`. The `invokedynamic` rewrite lets the JVM choose the best strategy at runtime (and change it across releases without breaking bytecode).

**Follow-up:** "Should I still avoid string `+` in hot loops?" Not because of allocations — `StringConcatFactory` chooses the right strategy. But if you're concatenating in a loop, *that* loop's allocations are the problem; a manual `StringBuilder` lets you reuse the buffer.

---

## Q16. What's a "megamorphic call site"? Why is it bad?

A megamorphic call site has seen three or more distinct receiver types. HotSpot's inline cache cannot hold that many entries efficiently; it falls back to a real vtable / itable lookup on every call. The cost is ~5–10 ns per call, but the bigger issue is that the JIT *cannot inline* — and inlining is what unlocks escape analysis, constant folding, dead-code elimination, and other secondary optimizations. A megamorphic call site in a hot loop typically costs orders of magnitude more than the raw dispatch overhead, because everything downstream of it also can't be optimized.

Common causes: shared utilities with many callers (profile pollution), heterogeneous collections iterated in tight loops, open hierarchies with many implementers.

**Trap:** "Just inline it manually." That helps if profile pollution is the cause. If the call site genuinely sees many types, you need to close the type set (`sealed`) or split the call site.

---

## Q17. How does pattern matching `switch` over a sealed type dispatch?

It compiles via `invokedynamic` to a `typeSwitch` bootstrap (`SwitchBootstraps.typeSwitch`). The bootstrap returns a `MethodHandle` that takes the receiver and returns an integer index — which case matched. The compiled code uses that index in a `tableswitch` to jump to the matching branch.

Because the sealed type's implementers are known at compile time and each branch's body is inlined, the JIT can fully specialize the dispatch. No vtable walk; no itable walk; just a small chain of type checks plus the inlined branch bodies. For closed type sets with 3–8 cases this is typically the fastest possible dispatch — faster even than the equivalent open polymorphism.

**Follow-up:** "What if the sealed hierarchy has 50 cases?" The type-switch chain becomes long. At some point, the JIT may decide to compile it as a hash-based dispatch instead, but exact behaviour is heuristic. For very large sealed hierarchies, profile.

---

## Q18. What does `final` do to bytecode? What does it do to JIT decisions?

To **bytecode**: nothing visible. A `final` method call still emits `invokevirtual`. The `final` modifier is a class-file flag (`ACC_FINAL`) on the method, not a different opcode.

To **JIT decisions**: a permanent CHA invariant. The JIT knows no subclass can ever override this method, so devirtualization needs no deopt guard. For non-`final` methods, the JIT speculates ("only one subclass exists today") and inserts a guard that triggers deopt on future class loads. For `final`, no speculation needed.

The combination of `final class` plus `final` methods plus `sealed` interfaces gives the JIT the strongest possible invariants. Use them not just for type safety but as JIT hints.

**Trap:** Assuming `final` changes the bytecode you see. It doesn't.

---

## Q19. How would you diagnose a sudden throughput drop in a production Java service?

1. **Check JFR** for compilation events. If methods are repeatedly compiled and made-not-entrant, there's a deopt cascade. Correlate with class load events.
2. **Run async-profiler** for a flame graph. Look for frames labeled `vtable stub` or `itable stub` — those are uncached megamorphic dispatch.
3. **Cross-reference with deploy history.** A recent deploy may have added a new implementer of a critical interface, going bimorphic → megamorphic.
4. **Cross-reference with class loads.** If a plugin or `ServiceLoader` recently activated a new implementation, CHA may have invalidated.
5. **Eyeball the receiver-type distribution** at the hot call site. If three or more concrete types account for the load, that's megamorphism.
6. **Consider sealing the type set** or **pre-loading plugins** at startup so all implementers are visible before the JIT compiles hot paths.

The structural fix is usually `sealed` plus `final` plus eager class loading at boot. The tactical fix may be specializing the hot call site (split the utility, group by concrete type, etc).

**Follow-up:** "What if the perf drop happened with no code change?" Look for class loads happening late — a plugin loaded only after first traffic, a `ServiceLoader` activated by a config flag, a dynamic agent attached. Any of these can invalidate CHA.

---

## Q20. When can you intentionally break SOLID for dispatch performance?

When the profiler points at a virtual call inside a hot loop, the receiver-type distribution confirms megamorphism, and a structural fix (sealing the type, splitting the call site) doesn't reach. Three local options, in order of severity:

1. **Replace an injected interface with a concrete `final` class field** for that specific component. CHA fully devirtualizes; the high-level architecture still uses the interface elsewhere.
2. **Inline the dispatch into a `switch` on a sealed type or enum.** Same OCP intent, faster dispatch.
3. **Collapse a decorator stack to a single composite layer** wired at startup. Fewer indirections, fewer object headers.

The discipline: do this *locally*, at the leaf, justified by a measured profile, documented in a comment. The trunk of the application keeps SOLID hygiene. The legitimate version of "break SOLID for performance" is "denormalize one hot path with measurement and documentation" — not "abandon SOLID throughout".

**Trap:** Performative denormalization. "Performance" is the most common cover story for design laziness. Profile first; refactor at the design level first; denormalize at the leaf only if both have failed.

---

**Use this list:** rotate one question from each major area — the opcode definitions (Q1, Q3), runtime mechanics (Q4, Q6, Q7, Q11, Q12), JIT machinery (Q5, Q14, Q16), modern features (Q8, Q10, Q15, Q17), and judgement (Q19, Q20). Strong candidates can read `javap` output, name the inline-cache states, explain deoptimization triggers, and articulate when `final` / `sealed` are JIT hints rather than just modelling choices. The bar is *measurement* — a candidate who has actually run `-XX:+PrintInlining` against their own code is rare and valuable.
