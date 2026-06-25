# Method Dispatch & Inline Caches — Interview Questions

> **Topic:** [Method Dispatch & Inline Caches](README.md)
> **Focus:** Probing whether a candidate understands how a call finds its target — from vtables and itables to inline caches, devirtualization, and the megamorphic cliff — and can reason about it at the level of real runtimes.

---

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual / Foundational

## Question 1

**What is method dispatch, and what is the difference between static and dynamic dispatch?**

Method dispatch is the act of determining which concrete block of code a call should jump to. In **static (direct) dispatch**, the target is known at compile time — free functions, `private`/`final`/non-virtual methods — so the compiler emits a direct call to a fixed address. In **dynamic (virtual) dispatch**, the target depends on the runtime type of the receiver, so the runtime must resolve it while the program executes; this is the mechanism behind polymorphism. Static dispatch is the cheapest possible call (one direct, predictable jump, fully inlinable). Dynamic dispatch costs at least an indirect call and usually some lookup, and it generally blocks inlining unless the compiler can prove or speculate a unique target.

## Question 2

**Explain how a vtable implements virtual dispatch.**

Each class with virtual methods has a single shared **vtable** — an array of function pointers, one slot per virtual method, with slot indices fixed at compile time. Each object stores a hidden **vptr** pointing to its class's vtable. A call `obj->method()` compiles to: load the vptr from the object, load the function pointer at the method's fixed slot index, and indirectly call it — two loads and an indirect call. Overriding a method means a subclass's vtable holds a different target at the same slot. This gives constant-time dynamic dispatch regardless of how many subclasses exist.

## Question 3

**Why is naive method lookup in a dynamic language slow, and how do inline caches fix it?**

Dynamic languages (Python, JavaScript, Ruby) can't freeze a vtable because objects and classes can change shape at runtime, so they resolve `obj.method()` by **searching** — walking the MRO, the prototype chain, or the ancestor list, doing a hash-table lookup at each step. Done on every call, that's expensive. The fix is the **inline cache**: a small memo attached to each call site recording "last time, the receiver was type X and the method was at address Y." A cheap **guard** re-checks the type; on a hit (the common case, since a call site usually sees the same type repeatedly) it jumps straight to the cached target, skipping the search. This turns a multi-step search into a guarded jump.

## Question 4

**What is a guard in an inline cache, and what does it actually compare?**

The guard is the runtime check that makes the cache's bet safe: it compares the receiver's type descriptor — its **hidden class / shape** (V8 Map, SpiderMonkey Shape) or class pointer (HotSpot klass) — against the cached one. Mechanically it's a pointer comparison and a conditional branch. If it passes, the cached target is correct and we jump to it; if it fails (a cache miss), the runtime re-resolves and updates the cache. Vtable and itable calls need no guard because the table *is* the dispatch — there's no speculation to verify.

## Question 5

**Define monomorphic, polymorphic, and megamorphic call sites.**

These describe how many distinct receiver types a single call site has observed. **Monomorphic**: one type — the inline cache is a single guard plus a direct call; the fast, happy case. **Polymorphic**: a small handful (typically up to ~4) — the cache becomes a short ordered list of guards (a polymorphic inline cache); still cheap. **Megamorphic**: more types than the PIC can hold — the runtime abandons per-site caching and falls back to a generic global lookup (or vtable/itable). Megamorphic is a performance cliff, not just a slower lookup.

## Question 6

**Why is a megamorphic call site a performance cliff, beyond just a longer lookup?**

Three costs compound. First, the lookup itself becomes a hash probe or table walk instead of a single compare-and-branch. Second, the call is now an **indirect branch whose target genuinely varies**, so the CPU's branch-target predictor mispredicts frequently, flushing the pipeline (on the order of 15-20 cycles each on a modern core). Third and most important, a megamorphic call **can't be devirtualized**, which **blocks inlining** and therefore all the downstream optimizations that inlining enables (constant folding across the call, escape analysis, scalar replacement). The lost inlining usually dwarfs the lookup cost — a megamorphic call is an optimization barrier.

## Question 7

**What is devirtualization, and what are the two main flavors?**

Devirtualization replaces a dynamic/virtual call with a direct (and inlinable) call when the target can be determined uniquely. **CHA (Class Hierarchy Analysis)** *proves* uniqueness by analyzing the currently loaded class hierarchy — if a method has a single implementor, the call has a single target. **Speculative devirtualization** *bets* on the profiled hot receiver type, emitting a guarded direct call (guarded inlining) with deoptimization as the fallback when the guard fails. CHA is proof (but in an open world must be revoked via deopt when a new conflicting class loads); speculation is a bet protected by a guard.

## Question 8

**How do inline caches relate to JIT inlining? Why is the IC more than a dispatch optimization?**

The inline cache is **dual-purpose**: it accelerates dispatch *and* records type feedback. The set of shapes a call site's IC observed during interpreted/baseline execution is exactly the information the optimizing compiler reads to decide what to inline. A monomorphic site → devirtualize and inline behind a guard; a 2-3 type site → polymorphic inline; a megamorphic site → leave as a generic call. So the IC is the JIT's type *sensor*, and inlining is the *actuator* that acts on its readings. This is why dispatch and inlining are really one feedback loop.

## Question 9

**How does the branch predictor interact with dynamic dispatch?**

A virtual/interface/megamorphic call compiles to an **indirect branch** — its target lives in a register or memory. The CPU's Branch Target Buffer predicts the target from history so the pipeline can keep fetching. For a monomorphic indirect call the target never changes, the prediction is always right, and the call is nearly free beyond the loads. For a megamorphic call the target varies, the predictor is often wrong, and each misprediction flushes the pipeline. So keeping a call site monomorphic pays off twice: it enables devirtualization/inlining (often no indirect branch at all), and even when an indirect call remains, a single-target one is predictor-friendly.

## Question 10

**Do inline caches apply only to method calls?**

No — they apply equally to **property/field access** in dynamic languages. In V8/SpiderMonkey, `point.x` is an inline-cached operation: a monomorphic access becomes a load from a fixed field offset behind a shape guard; polymorphic becomes a small set; megamorphic becomes a dictionary lookup. The same monomorphic-to-megamorphic degradation that hurts method calls hurts hot property reads identically, and the fix (stabilize object shapes) is the same.

---

## Language-Specific

## Question 11

**(C++) How is single-inheritance vtable layout structured, and why does it need no pointer adjustment?**

A derived class's vtable begins with the base class's slots in the same order, then appends new methods; overrides replace the target in the existing slot. Because slot indices are preserved, code compiled against `Base*` calls the right slot on a `Derived`. No `this` adjustment is needed because a `Derived` object *starts with* its `Base` sub-object at offset 0, so a `Base*` and the real `Derived*` are the same address. This is why single inheritance is the fast, simple case.

## Question 12

**(C++) What is a thunk, and when is one needed?**

Under **multiple inheritance**, an object has more than one vptr and more than one sub-object, so a pointer to a non-first base (e.g. `B*`) is offset from the real object pointer (`C*`). When a method is called through that base pointer, the actual method expects the most-derived `this`. A **thunk** is a tiny compiler-generated stub that adjusts the `this` pointer by the offset and then jumps (tail-calls) to the real method. The base's vtable slot points at the thunk rather than directly at the method. Thunks can also adjust return pointers for covariant returns. Single inheritance never needs them.

## Question 13

**(C++) Why doesn't calling a virtual method from a constructor reach the derived override?**

During construction, the object's vptr is set to the base class's vtable while the base constructor runs (the derived part isn't initialized yet). A virtual call in the constructor therefore dispatches to the base's version, not the derived override. This is by design — calling the override would touch not-yet-initialized derived state — but it surprises everyone once. The same applies in destructors, where the vptr has already been reset toward the base.

## Question 14

**(Java) Distinguish `invokevirtual` from `invokeinterface`.**

`invokevirtual` dispatches a class (instance) method through the receiver's vtable using a fixed slot — simple and fast. `invokeinterface` dispatches an interface method, which is harder because interface satisfaction is independent of the class hierarchy, so the method isn't at a fixed vtable slot across unrelated implementors. The JVM must locate the right **itable** (the per-(class, interface) table) and then the method within it — naively a search. In practice HotSpot accelerates interface call sites with inline caches, so the warm common case is a guarded direct call, but the cold/megamorphic case is more expensive than `invokevirtual`.

## Question 15

**(Java) How does HotSpot decide whether to inline a virtual call?**

C2 first tries **CHA**: if only one implementor of the method is loaded, it devirtualizes to a direct call and inlines it, recording a dependency that deoptimizes the method if a conflicting class is later loaded. If CHA can't prove uniqueness, it reads the call site's **type profile** (gathered earlier): a monomorphic profile gets a guarded inline with an uncommon trap on miss; a bimorphic profile gets a polymorphic inline of two targets; a megamorphic profile stays a real virtual call. All inlining is additionally gated by the **inlining budget** (callee size limits), so a large devirtualized callee may be devirtualized but not inlined.

## Question 16

**(JavaScript) Walk through what V8 does for `point.x` across a hot loop.**

On the first access, the IC is empty, so V8 does a generic lookup, finds `x` at some offset for the object's hidden class (Map), and records `{Map → offset}` in the call site's feedback — now **monomorphic**. On subsequent accesses it guards on the Map pointer; a hit loads from the fixed offset with no name search. If objects of a different shape arrive, the IC goes **polymorphic** (a small set of Map→offset entries); too many shapes push it **megamorphic** (a global dictionary-style lookup). When the function is optimized by TurboFan, a stable monomorphic site is compiled to an inlined load behind a single guard.

## Question 17

**(JavaScript) Why can adding fields in different orders make a hot site polymorphic even though "it's all the same object type"?**

V8 assigns a hidden class (Map) based on the object's structure *and the transition path that built it*. Building `{a, b}` by setting `a` then `b` yields a different Map than setting `b` then `a`. So two objects you consider logically identical can have different Maps, and a call site consuming them sees them as two types — driving the IC polymorphic for no semantic reason. Consistent construction order (or object literals with fixed key order) keeps the shape count at one.

## Question 18

**(Python) Explain MRO and C3 linearization, and how `__getattribute__` fits in.**

Python resolves `obj.attr` by first invoking `type(obj).__getattribute__`, whose default implementation searches: the type's **MRO (Method Resolution Order)** — the linear list of the class and all ancestors — for a data descriptor, then the instance `__dict__`, then the MRO again for non-data descriptors/class attributes. The MRO is computed by **C3 linearization**, which produces a consistent order respecting each class's local precedence and monotonicity (so a class appears before its parents, and the relative order from each base is preserved). C3 is what makes multiple inheritance in Python deterministic and is why some inheritance graphs raise an "inconsistent MRO" error — no valid linearization exists.

## Question 19

**(Python) Is Python method lookup cached?**

Historically each attribute access re-walked the MRO and dicts, which is slow. Modern CPython adds a **type method cache** (a global cache keyed by type and name, invalidated by a type-version tag bumped on class mutation) and, since 3.11/3.12, a **specializing adaptive interpreter** that rewrites hot bytecodes into specialized forms with per-site inline caches (e.g. `LOAD_ATTR` specializes to load from a known slot behind a type-version guard). So the steady-state hot path is much closer to a guarded direct access than to a full search. PyPy goes further with full tracing-JIT inline caches.

## Question 20

**(Go) How does interface dispatch work, and what is an itab?**

A Go interface value is two words: `(itab, data)`. The **itab** is a small header tying a concrete type to an interface: it holds the interface type, the concrete dynamic type, a type hash, and an array of function pointers — the concrete methods implementing the interface, in interface order. A call `r.Read(buf)` loads the itab, loads `fun[index_of_Read]`, and calls it with the `data` pointer as receiver. itabs are computed lazily and **cached** in a global table keyed by (interface type, concrete type), so the "does this type satisfy this interface and where are its methods" work happens once per pair, not per call. After warmup an interface call is roughly "load a function pointer from a 2-word value and call it."

## Question 21

**(Go) Does Go devirtualize interface calls?**

Yes, partially and at compile time. When the Go compiler can prove the concrete type at a call site — for example the value was just constructed as a concrete type — it can replace the interface call with a direct call and potentially inline it. This is the ahead-of-time analogue of CHA. When the concrete type can't be proven (e.g. iterating a `[]io.Reader` of arbitrary types), the call stays indirect through the itab. You can inspect the compiler's inlining and devirtualization decisions with `go build -gcflags=-m`.

## Question 22

**(C++/Java/Go) Compare how each resolves the type information needed to devirtualize.**

C++ resolves dispatch fully statically: vtable layout is fixed at compile/link time, and devirtualization happens only when the compiler (or LTO/whole-program optimization) can prove the dynamic type — no runtime profiling. Java/HotSpot resolves at runtime: CHA proves uniqueness from the *loaded* hierarchy and the JIT speculates on *profiled* types, both backed by deopt. Go is mostly ahead-of-time like C++ (itab-based dispatch, compile-time devirtualization where provable) with no IC/deopt tier. The axis that separates them is *when* type information is available: compile-time proof (C++/Go) versus runtime profile-and-speculate (Java/JS).

---

## Tricky / Trap

## Question 23

**A candidate says "virtual calls are slow, avoid them." Correct them.**

The blanket claim is wrong. A *predictable* virtual call — monomorphic, well-predicted by the BTB, and often devirtualized and inlined by the JIT — costs only a few cycles more than a static call, sometimes zero after inlining. The real cost is *unpredictable* dispatch: a megamorphic site that mispredicts the indirect branch and blocks inlining. So the goal isn't "eliminate virtual calls," it's "keep hot call sites type-stable." Hand-replacing clean polymorphism with `if/else` type ladders "for speed," without measuring, often produces slower *and* uglier code, because you've defeated the runtime's optimizations and possibly created your own unpredictable branch.

## Question 24

**`obj.method()` is called a million times on the same object type, yet the profiler shows it's slow. What are the likely causes?**

Despite a single *logical* type, the site may be **shape-fragmented**: objects built by different code paths have different hidden classes, so the IC sees several "types" and went polymorphic or megamorphic. Or the objects were demoted to **dictionary/hashed mode** (e.g. a `delete` on a property in JS), making them un-cacheable. Or the function is being measured during **warmup** before the JIT optimized it, or amid a **deopt storm** because a guard keeps failing. Or surrounding code with many indirect branches is evicting the BTB entry. The fix depends on which: stabilize shapes, avoid `delete`, measure in steady state, or relax bad speculation.

## Question 25

**Does marking a method `final` in Java make it faster?**

Usually not on an already-monomorphic hot site — modern HotSpot already devirtualizes effectively-monomorphic calls via CHA and speculation. `final` *proves* uniqueness, which removes the type guard and the deopt-on-class-load dependency, so its real value shows up in **open-world hot paths** where CHA can't help, in **plugin/classloader-heavy systems** where it prevents mid-run deoptimization, and as an intent/correctness declaration. Claiming "`final` makes everything faster" is cargo-culting; the honest answer is "it lets the compiler prove what it usually already speculates, with benefits that are situational — measure."

## Question 26

**In C++ multiple inheritance, is `(A*)&c == (B*)&c` for a `C : A, B`?**

No. Under multiple inheritance the `A` and `B` sub-objects live at different offsets within `c`, so `(A*)&c` and `(B*)&c` are different addresses. Code that assumes "same object implies same pointer value" breaks. Identity comparisons must compare most-derived pointers (cast both to `C*` or compare `&c`). This is also why a `reinterpret_cast` between base pointers is wrong where `static_cast`/`dynamic_cast` (which apply the offset) are correct.

## Question 27

**A nil interface trap: in Go, why can a non-nil interface hold a nil pointer and not panic, while a nil interface does?**

A Go interface value is `(itab, data)`. If you assign a typed nil pointer (e.g. `var p *T = nil; var i I = p`), the itab is present (the type is known) and only `data` is nil — so `i != nil`, and calling a method dispatches normally; it panics only if the method dereferences the nil receiver. If the interface itself was never assigned a concrete type, `itab` is nil, `i == nil`, and calling any method panics immediately because there's no itab to dispatch through. This "nil pointer wrapped in a non-nil interface" mismatch is one of Go's most common bugs.

## Question 28

**`volatile`/`final` confusion aside — does converting a `switch` on type to virtual dispatch always help performance?**

No. Both are forms of dispatch, and which is faster depends on the type distribution and the runtime. A short, well-predicted `switch`/type ladder on a stable distribution can beat a virtual call; a megamorphic virtual call beats a long, flat `switch`. Replacing virtual dispatch with a manual `instanceof` ladder doesn't help if the ladder is long and the distribution is uniform — you've just relocated the unpredictable branch. The right answer is to measure: keep whichever keeps the hot path predictable and inlinable, and don't assume one mechanism is universally faster.

## Question 29

**A site was fast in the microbenchmark and megamorphic in production. How is that possible?**

The microbenchmark fed a narrow set of types through the call site (often one), so the IC stayed monomorphic and the JIT inlined it. Production data has more type variety, pushing the same site polymorphic or megamorphic, at which point inlining is lost and indirect-branch mispredicts rise. The benchmark's **type distribution didn't match production's**, so the two reached different IC/inlining steady states. The lesson: warm and exercise benchmarks with a representative type mix, or the measured dispatch behavior is meaningless.

## Question 30

**Speculative devirtualization "never failed in testing." Why might it still be a production risk?**

A speculative guard that always passed in testing can fail on rare production inputs that introduce a different receiver type. Each failure triggers a **deoptimization**; if the rare type recurs, you get a **deopt storm** — repeated deopt/reoptimize cycles that can make the code slower than the interpreter and show up as tail-latency spikes. The risk is a performance failure mode (not a correctness one) that only manifests at scale and under input distributions the tests didn't cover. The mitigation is to let honestly-polymorphic sites be polymorphic rather than forcing a monomorphic bet.

---

## Design

## Question 31

**Design the dispatch mechanism for a small dynamic language interpreter. How do you make method calls fast?**

Start with naive lookup (walk the class/prototype chain, dict lookups) for correctness, then add **inline caches** at each call site: a feedback slot recording `(shape → resolved method)`. Guard on the receiver's shape; on a hit, jump to the cached target; on a miss, re-resolve and update — promoting monomorphic → polymorphic (a small ordered set, cap ~4) → megamorphic (a shared generic stub). Pair this with **hidden classes/shapes** so the guard is a single pointer compare, and ensure object construction produces stable shapes. For the interpreter loop itself, use a **threaded/computed-goto dispatch** to keep the bytecode-dispatch indirect branch predictable, and consider **quickening** (rewriting a generic bytecode into a specialized one after the first execution). If you later add a JIT, the ICs double as the type-feedback source for devirtualization and inlining.

## Question 32

**Design a benchmark that fairly measures the cost of monomorphic vs megamorphic dispatch.**

Use one call site reached through a function. For the monomorphic case, feed it a single type for many iterations; for the megamorphic case, feed it 5+ distinct types in a round-robin so the PIC overflows. Critically: (1) **reach steady state** — warm enough that the JIT has compiled and the ICs converged before timing; (2) **prevent the compiler from optimizing the work away** (consume the result, use a sink); (3) **isolate dispatch** — keep the per-call work tiny and identical across cases so the difference is dispatch, not the bodies; (4) **measure hardware counters** (`perf stat` for branch-misses and IPC) to confirm the slowdown is mispredicted indirect branches; (5) run both in the same process order or separate processes to avoid one polluting the other's IC/BTB state. Report steady-state numbers, not warmup.

## Question 33

**You're designing a hot request path on the JVM that dispatches through an interface to many implementations. How do you keep it fast?**

First, question whether the hot path truly needs to see all implementations at one site. If the type is known where the call is hot, call the concrete type directly (static dispatch). If polymorphism is essential, **hoist the type discrimination** to a single dispatch point and route to type-specialized methods whose internal call sites are monomorphic, so each inlines cleanly. Keep the interface small (smaller itable, fewer megamorphic risks). Mark genuinely non-overridden leaf classes `final`/sealed to enable CHA proof and remove deopt dependencies — valuable here because app servers load classes dynamically. Validate with `-XX:+PrintInlining`/`PrintDeoptimization` and `perf` to confirm the hot callee is inlined and the site isn't megamorphic, and design warmup so the path is optimized before it serves latency-critical traffic.

## Question 34

**Design an approach to find and eliminate megamorphic call sites in a large production codebase.**

Instrument and observe first: enable IC/inlining/deopt traces (`--trace-ic`/`--trace-opt`/`--trace-deopt` for Node; `-XX:+PrintInlining`/`+PrintCompilation`/`+PrintDeoptimization` for the JVM; CacheIR logging for SpiderMonkey) and run a representative workload; cross-reference with a CPU profiler measuring indirect-branch mispredicts to rank sites by impact. For each hot megamorphic site, **classify** it: *accidental* (shape fragmentation from inconsistent construction, over-general `Object`/`interface{}` containers, `delete`-induced dictionary mode) or *essential* (genuinely many types). Fix accidental ones at the data layer — centralize construction for stable shapes, homogenize collections, tighten static types. Fix essential ones by hoisting dispatch and specializing callees, or by accepting a small healthy PIC instead of forcing speculation. Then **verify**: re-trace to confirm the site is monomorphic/polymorphic, check that mispredicts dropped and the callee is now inlined, and guard against regressions with a perf test that asserts steady-state behavior.

## Question 35

**Design a CRDT-free shared cache of resolved dispatch targets for a multithreaded runtime — what are the concurrency concerns?**

The cache (itab cache, type method cache, or call-site IC) is read on the hot path by many threads and written rarely (on a miss). Reads must be lock-free and cheap — typically an atomic load of a pointer-sized entry guarded by a type/shape token. Writes (publishing a newly resolved target) must be **safely published** so a reader either sees the old fully-valid entry or the new fully-valid entry, never a torn one — use an atomic store with release semantics for the entry pointer, paired with acquire on the read. Invalidation (a class mutates, a new override loads) must bump a **version tag** that the guard checks, so stale cached targets are rejected without scanning every site. Avoid a global lock on the hot read path at all costs; favor per-site or per-type immutable entries swapped atomically (the runtime equivalent of copy-on-write). The hard cases are coordinating invalidation with in-flight optimized code (which is why JITs tie cache invalidation to deoptimization).
