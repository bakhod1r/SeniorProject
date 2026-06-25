# Deoptimization & Speculation — Middle Level

> **Topic:** [Deoptimization & Speculation](README.md)
> **Focus:** The mechanics — deopt points, the metadata that maps optimized machine state back to bytecode-level state, eager vs lazy deopt, and the specific speculative optimizations (monomorphic inlining, type specialization, branch pruning) that depend on this machinery.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

> Focus: **How does the runtime physically rewind from optimized native code back to interpreter state, and what optimizations rely on being able to do that?**

At the junior level the picture was: *bet → guard → (fast | deopt)*. That's correct, but it hides the hardest engineering problem in the whole topic, which is the *deopt* part. When a guard fails, the runtime is in the middle of executing **native machine code** — values are scattered across CPU registers and optimized stack slots, in an order and a layout chosen by a register allocator that bears no resemblance to the original bytecode. To deoptimize, the runtime must, *at that exact instruction*, reconstruct the state the program would have been in if the **interpreter** had been running the function all along: the right values in the right virtual local-variable slots, the right operand stack, the right bytecode index to resume from.

Doing this requires the optimizing compiler to have recorded, for every point where a deopt can happen, a precise **map** from "where each value physically lives in the optimized frame" back to "which abstract bytecode-level slot it represents." HotSpot calls these **scope descriptors** / debug info; V8 calls them **deopt data** / **translations**. This page is about that map and the machinery around it: where deopt points are placed, how the frame gets reconstructed, the difference between **eager** deopt (right now, at a guard) and **lazy** deopt (mark the code dead, deopt next time we're about to run it), and how class loading can *invalidate already-running optimized code* by breaking a class-hierarchy assumption.

Then we connect the machinery back to the optimizations it enables: **monomorphic inlining** (inline a call because we bet the target is always the same), **type specialization** (compile for the observed type, guard the rest), and **branch pruning** (don't even compile a branch that's never been taken — guard the entry instead). All three are only *safe* because deopt exists as the escape hatch.

> 🎓 **Why this matters for a mid-level engineer:** Once you understand that the JIT records a reconstruction map at every deopt point, a lot of mysterious behavior becomes legible — why optimized code carries "metadata overhead," why some optimizations are cheap and others expensive, why a class load on an unrelated thread can suddenly slow down code that was running fine. You stop treating the JIT as a black box and start predicting its behavior.

This page covers: deopt points and where they live, the scope-descriptor / translation metadata, the frame-reconstruction algorithm, eager vs lazy deopt, CHA-driven invalidation on class loading, and the three foundational speculative optimizations that all rest on this.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md` — bet/guard/deopt, tiers, "semantics are always preserved."
- **Required:** A working model of a **call stack**: frames, locals, operand stack, return addresses.
- **Required:** Rough familiarity with **bytecode** as an intermediate representation (JVM bytecode, V8 bytecode/Ignition, or .NET IL).
- **Helpful but not required:** Some idea of what a **register allocator** does (assigns values to CPU registers / stack slots).
- **Helpful but not required:** What **inlining** is and why it helps.

You do **not** need to know:

- The detailed escape-analysis / scalar-replacement reification story (that's `senior.md`).
- Production diagnosis of deopt storms at scale and cross-engine comparison depth (that's `professional.md`).
- Compiler IR internals (SSA, sea-of-nodes) beyond the names.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Deopt point** | A location in optimized code where deoptimization can occur (a guard, a type check, a CHA-dependent call, an uncommon branch). |
| **Scope descriptor** | (HotSpot) Metadata at a deopt point describing, for each enclosing (possibly inlined) method scope, where every local/stack value physically lives. |
| **Debug info / OopMap** | (HotSpot) The compiler-recorded mapping from physical locations to abstract values, plus which slots hold object references (oops) the GC must know about. |
| **Translation / deopt data** | (V8) The equivalent metadata: a list of instructions describing how to rebuild each interpreter frame's register file and stack from the optimized frame. |
| **Frame reconstruction** | The act of building one or more interpreter/baseline frames from a single optimized frame at deopt time. |
| **Virtual state** | The abstract, bytecode-level view of the program: which locals/stack slots hold which logical values, independent of physical layout. |
| **Eager deopt** | Deoptimizing *immediately* at the failing guard, on the current thread, in the current frame. |
| **Lazy deopt** | Marking optimized code as invalid ("not entrant") so that frames already on the stack deopt *when control returns to them*, rather than instantly. |
| **Not entrant** | (HotSpot) State of compiled code that may no longer be entered by *new* calls; existing activations still finish or deopt lazily. |
| **CHA (Class Hierarchy Analysis)** | The runtime analyzing the loaded class hierarchy to conclude e.g. "this method has no overrides," enabling speculative devirtualization/inlining. |
| **Devirtualization** | Turning a virtual/dynamic call into a direct (or inlined) call by speculating on the target. |
| **Monomorphic inlining** | Inlining a call site that has only ever resolved to one target, guarded so a different target triggers deopt. |
| **Type specialization** | Compiling an operation for the concrete type(s) observed at runtime, guarding that the type still matches. |
| **Branch pruning** | Not compiling a branch that profiling shows is never taken; entering it triggers a deopt instead. |
| **Speculation log / feedback** | (V8 `FeedbackVector`, HotSpot profiling counters) Runtime-gathered type/branch data that drives what to speculate on. |
| **OSR (On-Stack Replacement)** | Swapping a running (often long-looping) interpreter frame for an optimized one *mid-execution*; the inverse direction of deopt. |

---

## Core Concepts

### 1. The hard problem: rewinding from native code to virtual state

An optimizing compiler is free to:

- keep a Java/JS local variable entirely in a CPU register, never writing it to memory,
- compute a value early and reuse it,
- eliminate a variable that's provably unused,
- reorder operations,
- inline three or four method bodies into one flat native function,
- delete an object and keep only its fields in registers (scalar replacement — covered in `senior.md`).

All of that makes the optimized frame **unrecognizable** compared to the tidy bytecode model where every local has a numbered slot and the operand stack is explicit. Yet when a guard fails, the runtime must resume in the interpreter, which *only* understands that tidy bytecode model. So the compiler must leave behind, at every deopt point, enough information to **translate** the messy physical reality back into the clean virtual model.

### 2. Deopt points and what they record

A **deopt point** is any place the compiler emitted a guard or otherwise produced code that's only valid under a speculation. At each one, the compiler records metadata answering: *if we have to bail out here, where does every live value go in the reconstructed interpreter frame(s)?*

In HotSpot this metadata is the **scope descriptor** (one per inlined method scope at that point) plus the **OopMap** (which slots hold GC-visible references). Conceptually it's a table:

```text
At deopt point P (bci = 23 in method foo, inlined into bar at bci = 7):
  scope foo:
    local[0] -> RSI            (in a register)
    local[1] -> [RSP+16]       (spilled to stack)
    local[2] -> constant 0     (compiler proved it constant)
    stack[0] -> RAX
  scope bar (caller):
    local[0] -> [RSP+40]
    ...
```

In V8 the equivalent is the **translation array** in the deopt data: a compact instruction stream that the deoptimizer "interprets" to materialize each frame. Note the **inlining** wrinkle: if the optimized code inlined `foo` into `bar`, then a deopt inside the inlined `foo` must reconstruct **two** interpreter frames — one for `foo`, one for `bar` — out of the **single** optimized frame. The metadata describes the whole inlined scope chain.

### 3. The frame-reconstruction algorithm

When an eager deopt fires, the deoptimizer roughly:

1. **Captures** the current optimized frame: register contents and stack slots at the deopt point.
2. **Reads** the deopt metadata for this exact PC (program counter).
3. **Allocates** one new interpreter/baseline frame *per inlined scope* (so an N-deep inline expands into N frames).
4. **Fills** each frame's locals and operand stack by copying values from wherever the metadata says they physically live (register, stack slot, or an inlined constant).
5. **Sets** each frame's bytecode index (`bci` / bytecode offset) to the resume point.
6. **Replaces** the single optimized frame on the stack with the stack of reconstructed frames.
7. **Resumes** execution in the interpreter at the innermost reconstructed frame.

The cost is roughly proportional to inline depth and number of live values — usually microseconds. Cheap once; expensive in a loop.

### 4. Eager vs lazy deopt

**Eager deopt** is what we've described: a guard fails *right now*, on the running thread, and we reconstruct and resume immediately. It's local to the failing frame.

**Lazy deopt** handles a different situation: the runtime decides that some already-compiled code is *no longer valid* — but that code might be **running on the stack right now**, possibly on other threads, possibly several frames deep. You can't safely reach into another thread's mid-execution native frame and rewrite it from outside. So instead the runtime marks the compiled method **not entrant**: no *new* calls will use it, and each currently-active frame of it is patched so that **when control returns to it**, it deopts then. The invalidation is *scheduled* rather than *immediate*.

```text
EAGER:  guard fails  -> deopt this frame immediately, resume in interpreter.
LAZY:   runtime invalidates code -> mark "not entrant" -> existing frames
        deopt when reached -> new calls go to interpreter/recompile.
```

### 5. Class loading can invalidate running code (CHA)

This is the canonical lazy-deopt trigger on the JVM. Suppose at compile time HotSpot ran **Class Hierarchy Analysis** and found that `PaymentProcessor.process()` had **no overriding subclass** anywhere loaded. It then *speculatively devirtualized and inlined* `process()` into the caller — a big win — guarded only by the assumption "no override exists." This is recorded as a **dependency** on the class hierarchy.

Later, your app dynamically loads a plugin defining `class FraudProcessor extends PaymentProcessor { override process() {...} }`. The assumption is now **false**. HotSpot's class loader checks registered dependencies, finds the optimized code that bet on "no override," and **invalidates** it (lazy deopt: mark not entrant, deopt active frames on return). The next call recompiles, this time with a proper virtual dispatch or a polymorphic guard. The semantics were always correct; the runtime just had to give up the speculation the instant a new class made it untrue.

### 6. The optimizations this machinery unlocks

The whole deopt apparatus exists to make these *safe*:

- **Monomorphic inlining.** A call site that has only ever resolved to one target gets inlined directly, with a guard: *"is the receiver still the type I inlined for?"* Fail → deopt. Inlining is the single most valuable optimization because it exposes further optimizations across the call boundary.
- **Type specialization.** `a + b` is compiled as an integer add (or a string concat, or a double add) based on observed types, with type guards. Other types → deopt. This is what makes dynamic-language arithmetic fast.
- **Branch pruning (uncommon branches).** Profiling shows a branch (e.g. an error path, a rare slow case) is never taken. The compiler **omits compiling it** and puts an **uncommon trap** at its entry. If that branch is ever taken, the trap deopts and the interpreter handles it. You pay zero code-size/optimization cost for cold paths.

Every one of these is a *bet recorded as a deopt point with reconstruction metadata.*

---

## Real-World Analogies

**The stunt-double swap (frame reconstruction).** A film shoots a fast, dangerous chase with a stunt double standing in for the lead actor — that's the optimized code, fast and specialized. The moment a close-up dialogue shot is needed (a guard fails), the production must **swap the double out for the real actor and put them in exactly the right position, mid-scene**: same spot, same pose, same expression. The "continuity notes" that tell the crew precisely how to place the real actor are the **scope descriptors**. Get them wrong and the scene jumps; get them right and the audience never notices the swap.

**The simultaneous translator (virtual ↔ physical mapping).** The optimized frame "speaks" in registers and spilled stack slots; the interpreter "speaks" in numbered locals and an operand stack. The deopt metadata is a phrasebook that translates every value from one language to the other at the exact moment of handover.

**Recalled product, used by customers right now (lazy deopt).** A manufacturer discovers a part is defective (a loaded class breaks an assumption). They can't teleport into every customer's home and swap it mid-use. So they issue a recall: *no new units ship with the part, and when you next bring yours in, we'll replace it.* That's "not entrant + deopt on return."

---

## Mental Models

### Model 1: Optimized code carries its own "undo log"

Think of every deopt point as carrying a tiny **undo log** that says how to put the program back into a universally-understood state. The optimizing compiler is allowed to do wild things *only because* it promises to keep this undo log accurate. The log is the price of admission for aggressive optimization.

### Model 2: One physical frame can explode into many virtual frames

Because of inlining, the mental model "one stack frame = one method" is *only true in the interpreter*. In optimized code, one native frame may represent a whole *chain* of inlined methods. Deopt is the moment that compressed representation **decompresses** back into the per-method frames the interpreter expects.

### Model 3: Speculation = "compile the common case, *describe* the rare case"

The compiler doesn't compile every possibility. It compiles the common case as fast straight-line code, and for every rare case it just leaves a **description of how to escape to safety**. Branch pruning is the purest example: the rare branch isn't compiled at all — only its escape route (the uncommon trap + metadata) is.

### Model 4: Invalidation is event-driven

Some deopts are *guard-driven* (eager: a value was the wrong type). Others are *event-driven* (lazy: the world changed — a class loaded, an assumption registered as a dependency got broken). The first reacts to *data*; the second reacts to *program structure changing underneath you*.

---

## Code Examples

### Example 1: Forcing and reading a HotSpot deopt with scope info

```java
// Devirt.java
class Animal { String sound() { return "?"; } }
class Dog extends Animal { String sound() { return "woof"; } }

public class Devirt {
    static String speak(Animal a) {   // hot; HotSpot may speculate the target
        return a.sound();
    }
    public static void main(String[] args) throws Exception {
        Animal a = new Dog();
        long acc = 0;
        // Warm up: only Dog seen -> CHA may devirtualize/inline Dog.sound().
        for (int i = 0; i < 1_000_000; i++) acc += speak(a).length();

        // Introduce a new type AFTER warm-up to provoke deopt/invalidation.
        Animal b = new Animal() { String sound() { return "meow"; } };
        for (int i = 0; i < 1_000_000; i++) acc += speak(b).length();

        System.out.println(acc);
    }
}
```

Run with:

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation \
     -XX:+TraceDeoptimization Devirt
```

In the trace you'll see `speak` compiled, then deoptimization activity when the second, unseen receiver type shows up — the monomorphic-inlining bet on "always `Dog`" no longer holds, and the call site is recompiled as polymorphic.

### Example 2: Reading a V8 translation/bailout reason

```js
// specialize.js
function pick(o) {
  return o.value;     // V8 speculates on o's hidden class (shape)
}

const a = { value: 1 };          // shape S1
for (let i = 0; i < 1_000_000; i++) pick(a);   // monomorphic on S1

const b = { name: 'x', value: 2 };  // DIFFERENT shape S2 (extra field first)
console.log(pick(b));               // shape guard fails -> deopt
```

```bash
node --trace-deopt --trace-opt specialize.js
```

You'll see `pick` optimized, then a deopt with a reason like `wrong map` (the *map* is V8's hidden class). The optimized `pick` had a **map guard**; feeding a different shape failed it, and V8 rebuilt the interpreter frame from the translation data and resumed.

### Example 3: Branch pruning made visible

```js
// prune.js
function f(x) {
  if (x < 0) {
    // Cold path: never taken during warm-up.
    return slowPath(x);
  }
  return x * 2;          // hot path: only this is exercised at first
}
function slowPath(x) { return -x * 3; }

for (let i = 0; i < 1_000_000; i++) f(i);   // x >= 0 always

// Now take the pruned branch ONCE.
console.log(f(-5));      // entering the cold branch -> deopt
```

With `--trace-deopt` you'll observe a deopt when `f(-5)` first drives execution into the branch the compiler had treated as never-taken. The cold branch wasn't fully optimized; entering it triggered the trap, and execution fell back to handle it correctly (`f(-5)` returns `15`).

### Example 4: Inlining means one frame becomes two on deopt (conceptual)

```js
function inner(o) { return o.x; }       // will be inlined into outer
function outer(o) { return inner(o) + 1; }

// After warm-up, V8 inlines inner() into outer(): ONE optimized frame.
// If a shape guard inside the inlined inner() fails, the deoptimizer must
// reconstruct TWO interpreter frames (inner + outer) from that one frame,
// using the translation data that records both inlined scopes.
```

You can't "see" the two frames in a one-line trace, but `--trace-deopt`'s output references the inlining position, and a stack trace captured at the deopt resume point will show both `inner` and `outer` — proof the single physical frame was decompressed into two virtual ones.

---

## Pros & Cons

### Pros

- **Inlining across dynamic call boundaries.** Monomorphic inlining + deopt is what lets dynamic dispatch become a direct, inlinable call — the biggest single optimization lever.
- **Zero cost for cold paths.** Branch pruning means error handlers and rare cases don't bloat or slow the optimized code; you only pay if you actually hit them.
- **Adapts to the running program.** Speculation is driven by *actual* profiling feedback, so the compiled code fits this run's behavior.
- **Correct under a changing world.** Lazy deopt + CHA dependencies let the JVM aggressively devirtualize *and* stay correct when classes load later.

### Cons

- **Metadata is not free.** Every deopt point carries scope descriptors / translation data. This costs memory and constrains how aggressively some transforms can be applied (the compiler must always be able to reconstruct state).
- **Deopt cost scales with inline depth.** A deep inline that bails reconstructs many frames — more expensive than a shallow one.
- **Lazy deopt has latency.** A broken assumption isn't fixed instantly; frames already on the stack run their (now-suspect-but-still-correct) compiled code until they return.
- **Reasoning requires tooling.** None of this is visible from the source; you must read engine traces to understand what got speculated and why it bailed.

---

## Use Cases

- **Diagnosing why a hot, simple-looking function is slow** — read the deopt reason (`wrong map`, `not a Smi`, `not entrant`) to find the broken assumption.
- **Understanding inlining decisions** — knowing that monomorphic call sites inline tells you why keeping a site monomorphic is so valuable.
- **Explaining "spooky action at a distance"** — when loading a plugin or class slows down unrelated code, CHA invalidation is usually the cause.
- **Reasoning about warm-up** — early deopts during warm-up are the engine discovering your types/shapes/branches; steady-state code should stop deopting.

---

## Coding Patterns

### Pattern 1: Keep call sites monomorphic to preserve inlining

```js
// ❌ Polymorphic call site: handler could be many shapes -> can't inline well.
function dispatch(handler, ev) { return handler.handle(ev); }

// ✅ If a site is hot, drive it with one concrete type so it stays
//    monomorphic and inlinable. Specialize separate sites for separate types.
```

### Pattern 2: Stabilize shapes before the loop, not inside it

```js
// ❌ Shape changes inside the hot loop -> repeated map-guard deopts.
function build(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = {};            // empty shape...
    o.i = i;                 // ...mutated each iteration
    out.push(o);
  }
  return out;
}

// ✅ Construct with the final shape so every object shares one map.
function buildFast(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = { i };   // one stable shape
  return out;
}
```

### Pattern 3: Route the rare case out of the hot function (keep branches prunable)

```js
// ✅ The hot function stays narrow; the rare/cold path lives elsewhere so the
//    optimizer can prune it and trap on entry instead of compiling it inline.
function handle(req) {
  if (req == null) return handleNull(req);   // cold, separate
  return fastHandle(req);                     // hot, monomorphic
}
```

### Pattern 4 (JVM): avoid surprise overrides of hot virtual methods

```java
// If a hot path calls a virtual method that CHA can prove monomorphic,
// it gets devirtualized/inlined. Loading a subclass that overrides it later
// forces invalidation. Mark methods final (or keep classes effectively
// final) when you know they won't be overridden, to make the speculation
// permanent rather than provisional.
```

---

## Best Practices

- **Treat warm-up deopts as normal; treat steady-state deopts as bugs.** The signal is *repetition on the same site*, not the mere presence of deopt lines.
- **Read the reason string.** `not a Smi`, `wrong map`, `not entrant`, `unstable map`, `insufficient type feedback` each point at a different broken assumption.
- **Keep inline-critical sites monomorphic.** Inlining is the optimization you most want to protect; polymorphism is its enemy.
- **Stabilize object shape at construction.** One construction path → one hidden class → stable map guards.
- **On the JVM, make intentionally-non-overridable methods `final`.** It turns a provisional CHA bet into a permanent fact, removing an invalidation risk.
- **Don't fight branch pruning.** Letting cold paths be cold (and separate) is *good*; it keeps the hot path lean. Don't merge rare error handling into hot loops.

---

## Edge Cases & Pitfalls

### Pitfall 1: Confusing eager and lazy deopt symptoms

A type guard failing is *eager* and local — you'll see it pinned to a specific site and value. A `made not entrant` after a class load is *lazy* and structural — the code wasn't wrong, the world changed. Misdiagnosing one as the other sends you fixing the wrong thing.

### Pitfall 2: Inlining hides the real deopt site

A deopt reason may point at a method that *got inlined into* the one you were profiling. The failing guard lives in the inlined callee, not the caller you were staring at. Always check whether inlining is in play.

### Pitfall 3: "It deopted once, so my code is broken"

A single deopt as the engine learns a new type is expected and cheap. Re-optimization usually folds the new type into a polymorphic version that then runs fast. Only sustained, repeated deopts indicate a real problem.

### Pitfall 4: Assuming devirtualization is permanent

CHA-based devirtualization is *provisional* — valid only until a class that breaks it loads. Dynamic class loading, plugin systems, and some frameworks (proxies, bytecode generation) can invalidate it at runtime. If a hot method must stay devirtualized, make it non-overridable.

### Pitfall 5: Forgetting the GC interaction

Deopt metadata also tells the GC which optimized-frame slots hold object references (OopMaps). This is why values can't be laid out *completely* arbitrarily — the compiler must always be able to describe, at every safepoint/deopt point, where the live references are. It's a constraint that quietly bounds optimization.

### Pitfall 6: Long-running frames delaying lazy deopt

If a method marked *not entrant* is sitting in a very long loop, it keeps running its now-invalid (but still semantically correct) compiled code until the loop exits or an OSR/safepoint lets the runtime intervene. Long loops can therefore delay the benefit of invalidation.

---

## Cheat Sheet

```text
DEOPT POINT       Any guard / CHA-dependent call / uncommon branch where a
                  bailout can happen. Carries reconstruction metadata.

THE METADATA      HotSpot: scope descriptors + OopMap (per inlined scope).
                  V8:      translation array in deopt data.
                  Maps physical (register/stack/const) -> virtual (local/stack slot).

RECONSTRUCTION    1 optimized frame -> N interpreter frames (N = inline depth).
                  Copy each live value to its virtual slot, set bci, resume.

EAGER vs LAZY     EAGER: guard fails -> deopt this frame now.
                  LAZY : code invalidated -> mark "not entrant" -> frames deopt
                         on return; new calls recompile.

CHA INVALIDATION  Compile bets "no override of m()"; later a class overriding m()
                  loads -> dependency broken -> lazy-deopt the dependent code.

OPTIMIZATIONS     monomorphic inlining  (bet: one call target)
THAT RELY ON IT   type specialization   (bet: this type)
                  branch pruning        (bet: this branch never taken)

DEOPT REASONS     V8: "not a Smi", "wrong map", "unstable map",
                      "insufficient type feedback"
                  HotSpot: "made not entrant", "uncommon trap", "class_check"

STILL TRUE        Semantics preserved, always. Deopt = slower, never wrong.
```

---

## Summary

Deoptimization is harder than it sounds because, when a guard fails, the runtime is mid-execution in **native code** whose layout — registers, spilled slots, inlined scopes — looks nothing like the clean bytecode model the interpreter understands. To bridge that gap, the optimizing compiler records, at every **deopt point**, precise metadata (**scope descriptors** in HotSpot, **translation data** in V8) mapping each physical location back to its abstract bytecode-level slot. At deopt time the runtime uses that map to **reconstruct** one or more interpreter frames — one per inlined scope — fill them with the right values, set the resume bytecode index, and continue. That is the entire trick.

Deopts come in two flavors: **eager** (a guard fails now, deopt this frame immediately) and **lazy** (the runtime invalidates code because the world changed — most famously when a newly **loaded class breaks a CHA assumption** — marking it *not entrant* so frames deopt on return). This machinery is not academic: it's the enabling foundation for the JIT's most valuable optimizations — **monomorphic inlining**, **type specialization**, and **branch pruning** — each of which compiles only the common case and leaves behind a described escape route for the rest. The next level, `senior.md`, takes the hardest case of all: when escape analysis *deleted* an object entirely and a deopt suddenly requires that object to **exist again** — and the runtime must materialize it from scattered scalar values mid-flight.
