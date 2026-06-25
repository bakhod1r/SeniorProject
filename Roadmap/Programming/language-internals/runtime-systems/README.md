# Runtime Systems

A compiler's job ends when the program starts; everything after that is the
**runtime system** — the machinery that decides how an object is laid out in
memory, how a method call finds its target, how a function gets faster the more
you run it, how the stack is walked when an exception unwinds, and how all of this
cooperates with the garbage collector. It is the layer between "your code" and
"the bare metal," and it is where the most surprising performance — and the most
surprising bugs — live.

> *"The compiler decides what your program means. The runtime decides how fast it
> means it."*

The unifying idea of this section is **late binding made fast**. Dynamic
languages (and even static ones with virtual dispatch, dynamic linking, and GC)
defer decisions to runtime: which method, which type, which address, which
optimized code. That flexibility costs cycles — unless the runtime is clever.
Inline caches, hidden classes, JIT tiering, and speculative optimization are all
the same trick in different costumes: *observe what actually happens at runtime,
bet that it keeps happening, and compile a fast path for that bet — with a way to
bail out when the bet is wrong.*

---

## Why this matters

- The gap between a naïve interpreter and a tiered JIT on the same program is
  often **10–100×** — and all of it is runtime-system engineering.
- The hardest production performance problems (megamorphic call sites, deopt
  storms, GC pauses interacting with the JIT, dynamic-linking startup cost) can
  only be diagnosed by someone who understands this layer.
- Every "why is my polymorphic code slow?" / "why did this get slower after a
  deploy?" / "why is startup so slow?" question bottoms out here.

---

## The topics

| # | Topic | The question it answers |
|---|---|---|
| 01 | [Object Model & Layout](01-object-model-and-layout/) | How is an object actually arranged in memory — fields, header, vtable, hidden class? |
| 02 | [Method Dispatch & Inline Caches](02-method-dispatch-and-inline-caches/) | How does a call find its target, and how is dynamic dispatch made nearly free? |
| 03 | [Dynamic Linking & Loading](03-dynamic-linking-and-loading/) | How are symbols resolved across shared libraries at load and run time? |
| 04 | [JIT Compilation & Tiering](04-jit-compilation-and-tiering/) | How does code compile itself at runtime and get hotter in stages? |
| 05 | [Deoptimization & Speculation](05-deoptimization-and-speculation/) | What happens when a runtime's optimistic bet turns out wrong? |
| 06 | [Stack Management & Unwinding](06-stack-management-and-unwinding/) | How is the call stack laid out, grown, walked, and unwound? |
| 07 | [Runtime ↔ GC Integration](07-runtime-gc-integration/) | How do the JIT, stack maps, safepoints, and write barriers cooperate with the collector? |

---

## How to read this section

Start with **01** (object model) and **02** (dispatch) — together they explain how
a method call on an object actually works, and they introduce hidden classes and
inline caches, the concepts everything else reuses. **03** (dynamic linking) is
somewhat standalone and explains the GOT/PLT/lazy-binding machinery that runs
before `main`. Then **04 → 05** are a pair: tiered JIT compilation and the
deoptimization that makes its speculation safe — read them together. **06**
(stack management) underpins both exception unwinding and the GC's need to find
roots, which leads naturally into **07** (runtime↔GC integration), where
safepoints, stack maps, and write barriers tie the whole runtime together.

Each topic ships the standard `junior` → `middle` → `senior` → `professional`
tiers plus `interview` and `tasks`.

---

## Related sections

- **[Evaluation & Execution Models](../evaluation-and-execution-models/)** — the interpret→JIT→AOT spectrum, seen here from the runtime's side.
- **[Memory Management](../memory-management/)** — the GC whose integration topic 07 is about.
- **[Data Representation & Numerics](../data-representation-and-numerics/)** — boxing, tagging, and NaN-boxing are object-model decisions.
- **[Language Security Internals](../language-security-internals/)** — JITs are both an attack surface (W^X, JIT spray) and an enforcement point (V8 isolates).
