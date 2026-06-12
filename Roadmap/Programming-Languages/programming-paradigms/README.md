# Programming Paradigms Roadmap

> *"A language that doesn't affect the way you think about programming is not worth knowing."* — Alan Perlis

A **paradigm** is a way of structuring computation and of thinking about programs — what the basic building blocks are (objects? functions? rules? streams?), how state is handled, and how control flows. This roadmap is the map of that space: the major paradigms, what problem each was invented to solve, and how to combine them in real code.

> The two largest paradigms have their own dedicated roadmaps:
> - **Object-Oriented Programming** → [object-oriented-programming/](../object-oriented-programming/)
> - **Functional Programming** → [code-craft/functional-programming/](../code-craft/functional-programming/)
>
> This roadmap covers everything *around* and *between* them — plus the overview that ties all paradigms together.

---

## Why a Dedicated Roadmap

Most engineers learn one paradigm (usually OOP) by osmosis and never see the others clearly. But the paradigm you reach for shapes every design decision you make. Knowing the full menu — and the trade-offs — is what lets you pick *reactive* for a UI stream, *data-oriented* for a hot loop, *declarative* for a config language, and *actors* for a distributed system, instead of forcing everything into the one shape you happen to know.

| Roadmap | Question it answers |
|---|---|
| [Object-Oriented Programming](../object-oriented-programming/) | How do I model with objects, messages, and responsibilities? |
| [Functional Programming](../code-craft/functional-programming/) | How do I compute by transforming values instead of mutating state? |
| **Programming Paradigms** (this) | What are *all* the ways to structure a program, and when does each win? |

---

## Sections

| # | Paradigm | Core idea |
|---|---|---|
| [01](01-overview-and-taxonomy/) | Overview & Taxonomy | The imperative ↔ declarative spectrum; how paradigms relate and overlap |
| [02](02-imperative-and-procedural/) | Imperative & Procedural | Statements, sequence, procedures; the substrate most others compile down to |
| [03](03-declarative-programming/) | Declarative Programming | Describe *what*, not *how* — SQL, config, build systems, constraint solvers |
| [04](04-logic-programming/) | Logic Programming | Facts, rules, and unification — Prolog, Datalog, rule engines |
| [05](05-reactive-programming/) | Reactive Programming | Values that change over time — observables, streams, backpressure (Rx) |
| [06](06-dataflow-and-stream-programming/) | Dataflow & Stream | Computation as a graph of data dependencies; pipelines, FBP |
| [07](07-actor-model-and-csp/) | Actor Model & CSP | Concurrency as isolated processes exchanging messages — Erlang, Akka, Go channels |
| [08](08-generic-programming/) | Generic Programming | Algorithms parameterized over types — templates, concepts, traits |
| [09](09-aspect-oriented-programming/) | Aspect-Oriented Programming | Cross-cutting concerns (logging, security) woven separately from core logic |
| [10](10-data-oriented-programming/) | Data-Oriented Programming | Design around data layout and transformation — ECS, cache-friendly, DOP |
| [11](11-event-driven-programming/) | Event-Driven Programming | Control flow driven by events and handlers; callbacks, the event loop |
| [12](12-array-oriented-programming/) | Array-Oriented Programming | Whole-array/vectorized operations — APL, J, NumPy, dataframes |
| [13](13-constraint-programming/) | Constraint Programming | Declare constraints, let a solver find solutions — CLP, SAT/SMT, schedulers |
| [14](14-probabilistic-programming/) | Probabilistic Programming | Programs as probability distributions — Bayesian inference, PPLs (Stan, Pyro) |
| [15](15-symbolic-programming/) | Symbolic Programming | Code as data, homoiconicity, term rewriting — Lisp tradition, CAS |
| [16](16-concatenative-and-stack-based/) | Concatenative & Stack-Based | Composition by juxtaposition over an implicit stack — Forth, Factor, PostScript |
| [17](17-multiparadigm-in-practice/) | Multiparadigm in Practice | How real languages (Rust, Scala, Kotlin, Python, C++) blend paradigms |

---

## Scope & Deduplication

This roadmap stays at the **paradigm / way-of-thinking** level and cross-links to where the *mechanics* live:

| Looks similar to | But here we cover | The mechanics live in |
|---|---|---|
| `07-actor-model-and-csp` | actors/CSP as a *way to structure* concurrency | [Language Internals → Concurrency](../language-internals/concurrency-async-parallel/) |
| `05-reactive-programming` | reactive *as a paradigm* (observables, backpressure) | [FP → Laziness & Streams](../code-craft/functional-programming/12-laziness-and-streams/), [System Design → Data Streaming](../../Architecture/system-design/15-data-streaming/) |
| `08-generic-programming` | generic programming *as a style* | [Language Internals → Type Systems](../language-internals/type-systems/) |
| `03-declarative-programming` | the declarative mindset | SQL, build tools, IaC roadmaps |
| OOP / FP | — (each is its own roadmap) | [OOP](../object-oriented-programming/), [FP](../code-craft/functional-programming/) |

---

## Status

**Content-complete** — all 17 topics are fully written, each with the 5-tier theory set (`junior` · `middle` · `senior` · `professional` · `interview`), following the Code Craft file convention. All content in **English**.
