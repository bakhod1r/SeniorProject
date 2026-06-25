# Evaluation & Execution Models

Two programs can compute the same answer and yet be utterly different machines underneath. One evaluates an argument *before* the call, the other *only if it's used*; one walks a tree node by node, the other JITs a hot loop into native code mid-flight; one runs left-to-right because the language says so, the other reorders freely because the language deliberately left it unspecified. This section is about those choices — the **operational semantics** of how a language actually gets work done.

> *"A language is a machine for turning text into behaviour. The interesting question is always: which machine, and when does it decide?"*

The thread connecting every topic here is **when**. When is an argument evaluated? When does a side effect become visible relative to another? When is source turned into machine code — at build time, at first call, or never? Get the "when" wrong and you get the classic bugs of this domain: a debug `print` that changes the answer, an infinite loop that *shouldn't* run, a benchmark that's 100× too fast because the optimizer deleted the work, a `NullPointerException` whose stack trace points at code that "can't" have run yet.

---

## Why this matters

- **Performance** lives here. The single largest constant-factor wins in modern runtimes — inlining, JIT tiering, escape analysis, lazy thunk avoidance — are all evaluation-model decisions.
- **Correctness** lives here. Evaluation order is the source of more "works on my machine" bugs than almost anything else, because the language spec often permits *several* legal orders and compilers exploit that freedom.
- **Reasoning** lives here. Whether you can refactor `f(g(x))` into `let y = g(x) in f(y)` without changing behaviour depends entirely on the evaluation strategy and the effect model.

---

## The topics

| # | Topic | The question it answers |
|---|---|---|
| 01 | [Evaluation Strategies (call-by-x)](01-evaluation-strategies-call-by-x/) | When and how is an argument passed — by value, reference, name, need? |
| 02 | [Eager vs. Lazy Evaluation](02-eager-vs-lazy-evaluation/) | Compute now, or only when the result is demanded? |
| 03 | [Evaluation Order & Sequencing](03-evaluation-order-and-sequencing/) | In what order do sub-expressions and their side effects happen? |
| 04 | [Interpretation, Compilation, JIT, AOT](04-interpretation-compilation-jit-aot/) | When does source become executable, and on what spectrum? |
| 05 | [Bytecode & Virtual Machines](05-bytecode-and-virtual-machines/) | What is this intermediate "machine" that JVM/CLR/CPython/Wasm run? |
| 06 | [Effect & Error Execution Models](06-effect-and-error-execution-models/) | How do exceptions, effects, and control flow actually unwind and resume? |

---

## How to read this section

Read **01** and **02** together — call-by-value vs. call-by-need *is* eager vs. lazy from the caller's side, and the two topics share a vocabulary. **03** is the practical, bug-hunting heart of the section: sequence points, the unspecified order of argument evaluation, and the memory-model connection. Then **04** zooms out to the build-time/run-time spectrum (pure interpreter → bytecode VM → JIT → AOT), and **05** drills into the VM that sits in the middle of that spectrum. **06** ties it off with the control-flow side: how exceptions, `defer`/RAII, effect handlers, and result types model "things that don't just return a value."

Each topic ships the standard `junior` → `middle` → `senior` → `professional` tiers plus `interview` and `tasks`.

---

## Related sections

- **[Compilers & Interpreters](../compilers-and-interpreters/)** — the front-to-back pipeline; this section is the "execution" half seen as semantics rather than phases.
- **[Runtime Systems](../runtime-systems/)** — JIT tiering, deoptimization, and dispatch are the runtime machinery underneath topic 04.
- **[Concurrency, Async & Parallel](../concurrency-async-parallel/)** — the memory model defines the *inter-thread* part of evaluation order.
- **[Data Representation & Numerics](../data-representation-and-numerics/)** — what the values being evaluated actually are.
