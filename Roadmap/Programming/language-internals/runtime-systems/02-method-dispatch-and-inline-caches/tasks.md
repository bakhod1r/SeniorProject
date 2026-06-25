# Method Dispatch & Inline Caches — Tasks & Exercises

> **Topic:** [Method Dispatch & Inline Caches](README.md)
> **Focus:** Hands-on exercises that make dispatch visible — drawing vtables, building a toy inline cache, forcing call sites through mono/poly/mega, and reading real runtime traces.

---

## Table of Contents

- [How to Use This Page](#how-to-use-this-page)
- [Tier 1 — Foundations](#tier-1--foundations)
- [Tier 2 — Mechanisms](#tier-2--mechanisms)
- [Tier 3 — Inline Caches](#tier-3--inline-caches)
- [Tier 4 — Devirtualization & the JIT](#tier-4--devirtualization--the-jit)
- [Tier 5 — Production Diagnosis](#tier-5--production-diagnosis)
- [Capstone Projects](#capstone-projects)
- [Self-Assessment Checklist](#self-assessment-checklist)

---

## How to Use This Page

Each task has a **goal**, a **self-check** (how to know you got it right), and a collapsible **hint**. Solutions are intentionally sparse — for the conceptual tasks the self-check *is* the answer key, and for the coding tasks you learn far more by building it than by reading a finished version. Do the tiers in order; later tiers assume earlier mechanics. Where a task says "run with `--trace-ic`" or `perf`, actually run it — the entire point of this topic is that dispatch is invisible until you instrument it.

You'll want, at minimum: a C++ compiler (`g++`/`clang++`), Node.js (for V8 IC traces), and a Python 3.11+ interpreter. A JDK and Linux `perf` unlock the deeper tiers but aren't strictly required.

---

## Tier 1 — Foundations

### Task 1.1 — Classify the dispatch

**Goal:** For each call below, state whether it is statically or dynamically dispatched and why.

```text
a) C++:    std::sqrt(2.0)
b) C++:    animal->speak()          // speak is virtual, animal is Animal*
c) C++:    animal->name()           // name is NON-virtual
d) Java:   list.add(x)              // ArrayList via List reference
e) Java:   Math.max(a, b)
f) Go:     w.Write(buf)             // w is io.Writer
g) Python: obj.method()
```

**Self-check:** Static: (a) free function, (c) non-virtual so bound to the static type, (e) static method. Dynamic: (b) virtual through vtable, (d) interface/virtual call, (f) Go interface call through the itab, (g) dynamic-language method lookup. If you marked (c) as dynamic, re-read why non-virtual binds to the *declared* type even on a derived object.

<details><summary>Hint</summary>

Ask: "could the target change depending on the object's *runtime* type?" If no (free functions, static methods, non-virtual, `final`), it's static. If yes (virtual, interface, dynamic-language), it's dynamic.
</details>

### Task 1.2 — Draw the vtable

**Goal:** Given `class Base { virtual void f(); virtual void g(); }; class Derived : Base { void g() override; virtual void h(); };`, draw both vtables with slot indices and targets.

**Self-check:** `Base`: `[0]=Base::f, [1]=Base::g`. `Derived`: `[0]=Base::f, [1]=Derived::g, [2]=Derived::h`. The override replaces slot 1's target in place; `h` is appended at slot 2; slot indices are stable between base and derived.

<details><summary>Hint</summary>

Rule: derived vtable = base slots (same order, overrides swapped in) + new methods appended.
</details>

### Task 1.3 — Translate a virtual call to pseudo-assembly

**Goal:** Write the three pseudo-instructions that `animal->speak()` becomes, where `speak` is virtual at slot 0.

**Self-check:** `vptr = load [animal]` (the hidden pointer at offset 0); `target = load [vptr + 0]` (slot 0); `call target`. Two loads and an indirect call. Compare to a static call: a single `call <fixed addr>`.

<details><summary>Hint</summary>

The vptr is (typically) the first word of the object. The slot index is a compile-time constant.
</details>

### Task 1.4 — Why is naive dynamic lookup slow?

**Goal:** In one paragraph, explain why Python resolving `obj.method()` without caching is slower than a C++ vtable call.

**Self-check:** Your answer should mention that Python walks the MRO doing a *hash-table lookup per class* until it finds the name, whereas the vtable call is a fixed-index array load — no search, no hashing, constant work regardless of hierarchy depth. The vtable's slot index is known at compile time; Python's name must be searched at runtime because classes can change shape.

---

## Tier 2 — Mechanisms

### Task 2.1 — Prove multiple-inheritance pointer offset

**Goal:** Write and run a C++ program with `struct A { virtual void fa(); int a; }; struct B { virtual void fb(); int b; }; struct C : A, B {};`, create a `C c;`, and print `(void*)(A*)&c` and `(void*)(B*)&c`.

**Self-check:** The two addresses differ (by the size of A's sub-object, typically). If they're equal, your compiler placed B at offset 0 — verify by also printing `(void*)&c`. The difference is exactly the offset a thunk would subtract when calling a `B`-slot method on a `C`.

<details><summary>Hint</summary>

```cpp
printf("%p %p %p\n", (void*)&c, (void*)(A*)&c, (void*)(B*)&c);
```
`(A*)&c` should equal `&c`; `(B*)&c` should be larger.
</details>

### Task 2.2 — Explain the thunk

**Goal:** For Task 2.1's `C`, given that `C` overrides `fb`, explain what the `fb` slot in C's *B-vtable* points to, and what that target does.

**Self-check:** It points to a **thunk** (not directly to `C::fb`). The thunk subtracts the B-offset from `this` (converting `B*` back to `C*`) and then jumps to `C::fb`. This is needed because the caller, holding a `B*`, is offset N bytes into the object, but `C::fb` expects a `C*`.

<details><summary>Hint</summary>

The method body expects the most-derived `this`. Whoever held a non-first base pointer is at the wrong offset and must be adjusted before entering.
</details>

### Task 2.3 — Build a Go itab on paper

**Goal:** For `type Speaker interface { Speak() string }` and `type Dog struct{}` with `func (Dog) Speak() string`, write out the fields of the `(Speaker, Dog)` itab and the two-word interface value for `var s Speaker = Dog{}`.

**Self-check:** itab: `inter = *Speaker`, `_type = *Dog`, `hash`, `fun[0] = Dog.Speak`. Interface value: `(tab = &thatItab, data = &Dog{})`. The call `s.Speak()` is `tab.fun[0](data)`. If you wrote a fixed vtable slot independent of the interface, reconsider — the slot is *interface-relative*, found via the itab.

### Task 2.4 — MRO by hand (C3)

**Goal:** Given `class A: pass`, `class B(A): pass`, `class C(A): pass`, `class D(B, C): pass`, compute `D.__mro__` and verify with Python.

**Self-check:** `[D, B, C, A, object]`. Run `print(D.__mro__)` to confirm. Note `A` comes *after both* `B` and `C` (C3 monotonicity: a class never precedes its own subclasses), and the diamond `A` appears once, not twice.

<details><summary>Hint</summary>

C3: merge the linearizations of the parents plus the list of parents, always taking a head that doesn't appear in the *tail* of any list.
</details>

### Task 2.5 — Identity trap

**Goal:** Predict whether `((A*)&c) == ((B*)&c)` is `true` or `false` for the `C : A, B` from Task 2.1, and explain the consequence for using base pointers as map keys.

**Self-check:** `false` (different offsets). Consequence: if you key a map by `B*` and elsewhere by `A*` for the same object, they're different keys — you'll get phantom misses. Always normalize to the most-derived pointer for identity.

---

## Tier 3 — Inline Caches

### Task 3.1 — Implement a monomorphic inline cache

**Goal:** In any language, simulate a call site with a one-entry inline cache. Model "objects" as `{shape, methods}` and a call site that caches `(shape → method)`, guards on shape, and falls back to a "slow lookup" on a miss. Count slow lookups.

**Self-check:** Feeding 1,000 objects of the *same* shape should yield exactly **1** slow lookup (the first), and 999 guard hits. Feeding alternating shapes should yield ~1,000 slow lookups (every call misses and overwrites). The monomorphic cache only wins on type-stable streams.

<details><summary>Hint</summary>

```python
cache = None  # (shape, method)
slow = 0
def call_site(obj):
    global cache, slow
    if cache and cache[0] is obj.shape:      # guard
        return cache[1](obj)                  # hit
    slow += 1
    m = slow_lookup(obj)                      # miss
    cache = (obj.shape, m)
    return m(obj)
```
</details>

### Task 3.2 — Upgrade to a polymorphic inline cache

**Goal:** Extend Task 3.1 to hold up to **4** entries (a PIC), tried in order, and declare the site **megamorphic** (stop caching, always slow-lookup) on the 5th distinct shape.

**Self-check:** Round-robining 4 shapes: after warmup, **0** slow lookups in steady state (all 4 cached). Round-robining 5 shapes: the site goes megamorphic and every call is a slow lookup. Confirm your cap triggers on the *5th distinct* shape, not the 5th call.

<details><summary>Hint</summary>

Keep a list of `(shape, method)`. On miss, if `len < 4` append; else set a `megamorphic = True` flag and stop adding. Order the list most-recent-first so the hot type is checked first.
</details>

### Task 3.3 — Watch a real V8 IC transition

**Goal:** Write `ic.js` with one call site `function k(o){return o.kind();}` and three classes each defining `kind()`. Drive it monomorphic (one class), then polymorphic (two), then megamorphic (5+). Run `node --trace-ic ic.js` and find the site's state transitions.

**Self-check:** In the trace, locate the `kind` (or `.kind` property access feeding the call) load and see it go from `0`/`premonomorphic` → `1`/`monomorphic` → `P`/`polymorphic` → `N`/`megamorphic`. If you never see `megamorphic`, you didn't feed enough distinct shapes through the *same* site.

<details><summary>Hint</summary>

Keep the call site singular — one `k(o)` function called in a loop with different `o`. Grep the trace for the property/feedback line mentioning your method name.
</details>

### Task 3.4 — Shape fragmentation

**Goal:** Write two factory functions that both produce logically-`{x, y}` objects but assign the fields in different orders under a condition. Feed both into one hot V8 call site and show (via `--trace-ic`) that the site is polymorphic even though "it's all points."

**Self-check:** Despite one logical type, the IC reports ≥2 maps → polymorphic. Now rewrite the factory to always assign fields in the same order (or use an object literal) and confirm the site returns to monomorphic. This is the single most common real-world cause of accidental polymorphism.

<details><summary>Hint</summary>

`if (cond) { o.x=a; o.y=b; } else { o.y=b; o.x=a; }` makes two Maps. `return {x:a, y:b};` makes one.
</details>

### Task 3.5 — Property-access ICs

**Goal:** Demonstrate that inline caching applies to plain property reads, not just method calls. Benchmark `sum += o.x` over a million monomorphic objects vs a million objects of 6 mixed shapes.

**Self-check:** The mixed-shape version is measurably slower (megamorphic property access → dictionary-style lookup), proving the same IC machinery governs field reads. If the times are identical, your shapes weren't actually distinct (check construction).

---

## Tier 4 — Devirtualization & the JIT

### Task 4.1 — Trigger a deopt in V8

**Goal:** Warm a function monomorphically until TurboFan optimizes it (millions of calls with one type), then pass a second type and observe the deopt. Run with `node --trace-opt --trace-deopt`.

**Self-check:** `--trace-opt` shows the function optimized; introducing the new type fires a `--trace-deopt` line (a "wrong map"/"deoptimizing" message) at your call site. You've watched the sensor→actuator→safety loop: IC fed inlining, the new type violated the guard, deopt reverted.

<details><summary>Hint</summary>

Optimize first (a tight loop on type A), *then* in a separate loop pass type B. The deopt fires on the first B.
</details>

### Task 4.2 — Provoke a deopt storm and fix it

**Goal:** Write a loop whose call site *alternates* between two types every iteration. Observe (via `--trace-deopt`) repeated deopts. Then refactor so the hot path is type-stable (group by type, or replace the virtual call with a predictable branch) and show the storm disappears.

**Self-check:** The alternating version shows recurring deopt lines and poor throughput; the refactored version shows none after warmup and is faster. You've demonstrated that **over-speculation on an unstable type is worse than no speculation**.

<details><summary>Hint</summary>

`for (const it of [a,b,a,b,...]) it.f()` storms. Either sort the array by type, or write `(it instanceof A) ? aF(it) : bF(it)` so each callee is monomorphic.
</details>

### Task 4.3 — CHA devirtualization in the JVM

**Goal:** With a `final class Inc extends Op` as the only `Op` subclass, run a hot loop calling `op.apply()` under `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`. Confirm `Inc::apply` is inlined. Then add a second `Op` subclass, load it, and observe the inlining/deopt change.

**Self-check:** With one implementor, `PrintInlining` shows `Inc::apply` inlined (CHA proved uniqueness). After loading a second subclass, the assumption is invalidated — you should see deoptimization/recompilation and a guarded or virtual form. This shows CHA's open-world fragility.

<details><summary>Hint</summary>

Use enough warmup iterations to reach C2 (tens of thousands+). Load the second subclass *after* warmup (e.g. via reflection) to trigger the invalidation distinctly.
</details>

### Task 4.4 — Measure the value (or not) of `final`

**Goal:** Benchmark a monomorphic hot virtual call with and without `final` on the method/class, in steady state. Then benchmark an *open-world* case (multiple loaded implementors) with and without sealing.

**Self-check:** On the already-monomorphic case, expect little or no steady-state difference (CHA/speculation already handled it). On the open-world case, `final`/`sealed` should help more (it converts speculation into proof, removing guards/deopt risk). Your conclusion should be "`final` is situational, not a universal speedup" — backed by your numbers.

---

## Tier 5 — Production Diagnosis

### Task 5.1 — Confirm a slowdown is dispatch-driven with `perf`

**Goal:** Build two equivalent workloads (monomorphic vs megamorphic call site) and compare `perf stat -e branches,branch-misses,instructions,cycles` for each.

**Self-check:** The megamorphic run should show a markedly higher **branch-miss rate** and lower **IPC** (instructions/cycle), despite doing "the same work." This is the hardware fingerprint of unpredictable indirect dispatch. If the branch-miss rates are equal, your "megamorphic" workload wasn't actually overflowing the PIC.

<details><summary>Hint</summary>

Then `perf record -e branch-misses ./mega && perf report` to confirm the misses concentrate at the hot indirect call.
</details>

### Task 5.2 — Find the megamorphic site in a "mystery" program

**Goal:** Take any small program with a polymorphic hot loop (yours or a colleague's) and, using only runtime traces (`--trace-ic`/`PrintInlining`) plus a profiler, identify the call site that went megamorphic — *before* reading the source closely.

**Self-check:** You can name the file/line/method of the megamorphic site from traces alone, and predict from the trace whether the cause is accidental (shape fragmentation) or essential (many real types). Confirm against the source afterward.

### Task 5.3 — Apply the elimination playbook

**Goal:** For the site from 5.2, apply the playbook: classify (accidental vs essential), fix (stabilize shapes / homogenize collection / hoist dispatch + specialize callees), and verify (re-trace, re-`perf`).

**Self-check:** After the fix, the site is monomorphic or a small PIC, branch-misses drop, and the inlining log shows the hot callee inlined. Write down the before/after numbers — if you can't show the metric moved, you haven't verified the fix.

### Task 5.4 — Steady-state vs warmup

**Goal:** Take a JIT-language benchmark and report its throughput (a) including the first second and (b) only after warmup. Show how much the warmup window distorts the average.

**Self-check:** The warmup-inclusive number is meaningfully worse, because early calls run interpreted/un-devirtualized and some sites deopt. Your takeaway: production latency reflects steady state, and any benchmark that doesn't reach it is reporting warmup noise.

---

## Capstone Projects

### Capstone A — Toy interpreter with inline caches

Build a minimal interpreter for a tiny object language (objects with shapes and methods). Implement: naive lookup; then per-call-site inline caches (mono → PIC(4) → megamorphic); then hidden-class transitions so adding fields in different orders yields different shapes. Add a counter for slow lookups and a `--trace-ic`-style log of state transitions. **Done when:** a type-stable benchmark shows ~1 slow lookup per site and a shape-fragmented benchmark shows the same site go polymorphic/megamorphic — and you can explain every transition.

### Capstone B — Dispatch cost atlas

Across C++ (vtable), Java (`invokevirtual`/`invokeinterface`), Go (interface), and JS/Python, build one benchmark per mechanism measuring static vs monomorphic-virtual vs megamorphic-virtual cost in steady state, with `perf` branch-miss data where available. **Done when:** you have a single table comparing the four runtimes and can explain, for each, *why* megamorphic is slower (lookup + mispredict + lost inlining) and where each runtime gets its type information (compile-time proof vs runtime profile).

### Capstone C — Megamorphic hunt in a real codebase

Pick a real open-source service in a JIT language, run a representative workload under IC/inlining/deopt tracing plus a profiler, and produce a short report ranking the top megamorphic hot sites by impact, classifying each, and proposing (or prototyping) a fix for the top one. **Done when:** your report ties a measured perf cost to a specific call site, classifies the cause correctly, and (ideally) shows a before/after improvement.

---

## Self-Assessment Checklist

You understand this topic when you can, without notes:

- [ ] Classify any call as static or dynamic dispatch and justify it.
- [ ] Draw single- and multiple-inheritance vtables and explain why the latter needs thunks.
- [ ] Lay out a Go interface value and itab, and a Java itable, and say why interface dispatch differs from class dispatch.
- [ ] Compute a Python MRO by C3 and explain `__getattribute__`'s search order.
- [ ] Explain what an inline-cache guard physically compares and trace a mono → poly → mega transition.
- [ ] Give the three compounding reasons a megamorphic call site is a cliff.
- [ ] Distinguish CHA from speculative devirtualization and explain guarded inlining and deopt.
- [ ] Explain why the inline cache is the JIT's type-feedback sensor.
- [ ] Diagnose a slow hot call site with runtime traces and `perf` and apply the megamorphic-elimination playbook.
- [ ] State honestly when `final`/`sealed` helps and when it's cargo-culting.
- [ ] Recognize and fix accidental shape fragmentation and deopt storms.
- [ ] Always reason about production performance in steady state, not warmup.
