# Language Internals

The layer beneath the syntax — how programming languages actually work under the hood, language-agnostic where possible and concretely specified where the implementations diverge.

---

## Sections

- **[Concurrency, Async & Parallel](concurrency-async-parallel/)** — three closely-related but distinct domains:
  - **[Concurrency](concurrency-async-parallel/concurrency/)** — threading models, primitives, race conditions, deadlock detection.
  - **[Async Programming](concurrency-async-parallel/async-programming/)** — event loops, coroutines, `async/await`, runtimes (Tokio, libuv, asyncio).
  - **[Parallel Programming](concurrency-async-parallel/parallel-programming/)** — SIMD, work-stealing, fork-join, data parallelism, cache and NUMA effects.
- **[Memory Management](memory-management/)** — stack vs heap, allocators, GC strategies (mark-sweep, generational, reference counting), escape analysis, ownership models.
- **[Type Systems](type-systems/)** — static vs dynamic, structural vs nominal, generics, variance, type inference, soundness.
- **[Compilers and Interpreters](compilers-and-interpreters/)** — lexing, parsing, AST, IR, optimisation passes, codegen, JIT vs AOT, runtime interplay.
- **[Metaprogramming](metaprogramming/)** — reflection, macros (hygienic vs textual), code generation, build-time vs runtime.

---

## Related

- **[Code Craft](../code-craft/)** — how to apply these internals well at the source level.
- **[Quality Engineering › Performance](../quality-engineering/performance/)** — the practical payoff of understanding internals.
- **[Languages](../languages/)** — per-language tracks where these internals get concrete.
