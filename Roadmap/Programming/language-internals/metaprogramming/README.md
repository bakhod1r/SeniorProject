# Metaprogramming Roadmap

> *"Code that writes code is the highest form of code reuse — and the easiest way to ship code nobody can debug."*

This roadmap is about **programs that manipulate programs**: reflection, macros, code generation, annotation processing, AST rewriting. Used well, metaprogramming eliminates entire categories of boilerplate. Used badly, it produces magic that no one — including the author six months later — can read.

> Looking for the *machinery underneath* (ASTs, parsers, IRs)? See [Compilers & Interpreters](../compilers-and-interpreters/README.md).
>
> Looking for *codegen at build time* (protobuf, gRPC, `go generate`)? Sections 04 and 05 below cover this directly.

---

## Why a Dedicated Roadmap

Every mainstream language has metaprogramming — but they disagree wildly on *when* and *how*:

- **Rust** does it at compile time with macros (`macro_rules!`, procedural macros, `syn` / `quote`)
- **Java** does it at compile time with annotation processors and at runtime with reflection
- **Python** does it at runtime with `__getattr__`, decorators, metaclasses, `inspect`
- **Go** has almost no metaprogramming — `go generate` and a bit of `reflect` — and the language designers consider that a feature

Understanding the spectrum makes you fluent across stacks and lets you judge "is this annotation magic actually buying us anything?"

| Roadmap | Question it answers |
|---|---|
| [Design Patterns](../../code-craft/design-patterns/README.md) | What structures recur in OO code? |
| [Type Systems](../type-systems/README.md) | What can the compiler prove? |
| **Metaprogramming** (this) | When is it worth writing code that writes code? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-what-metaprogramming-is/) | What Metaprogramming Is (and Isn't) | Reflection, codegen, macros, eval; runtime vs compile-time |
| [02](02-reflection/) | Reflection | Inspecting types and values at runtime — Java `java.lang.reflect`, Go `reflect`, Python `inspect` |
| [03](03-annotations-and-decorators/) | Annotations & Decorators | Java annotations + APT, Python decorators, attribute-driven behavior |
| [04](04-build-time-code-generation/) | Build-Time Code Generation | `go generate`, protoc, OpenAPI codegen, source-level templating |
| [05](05-macros/) | Macros | Lisp's homoiconicity, Rust `macro_rules!`, Rust procedural macros (`syn` / `quote`), C preprocessor (briefly) |
| [06](06-metaclasses/) | Metaclasses & Class-Level Magic | Python metaclasses, Ruby `method_missing`, Smalltalk influences |
| [07](07-dynamic-dispatch-and-proxies/) | Dynamic Dispatch & Proxies | JDK proxies, byte-buddy / ASM, Python `__getattr__`, "duck typing" mechanisms |
| [08](08-dsls-via-metaprogramming/) | DSLs via Metaprogramming | Building internal DSLs with operator overloading, builder patterns, or macros |
| [09](09-when-not-to-metaprogram/) | When NOT to Metaprogram | Cognitive cost, debuggability, IDE support, "the framework knows but I don't" |
| [10](10-compile-time-vs-runtime-tradeoffs/) | Compile-Time vs Runtime Trade-offs | Startup time, binary size, observability, refactoring safety |

---

## Languages

The whole roadmap is a comparison: **Rust** (compile-time, type-checked macros), **Java** (annotation processing + reflection), **Python** (runtime, very dynamic), and **Go** (deliberately limited — `go generate` + `reflect`). Studying all four side-by-side makes the design trade-offs visible.

---

## Status

⏳ **Structure defined; 10 sub-folders scaffolded. Per-topic files (junior / middle / senior / professional / interview) pending.**

---

## References

- *On Lisp* — Paul Graham (the macro classic)
- *Let Over Lambda* — Doug Hoyte
- Rust Reference — *Procedural Macros* and *Declarative Macros*
- *Java Reflection in Action* — Forman & Forman
- *Fluent Python* — Luciano Ramalho (metaclasses, descriptors, decorators)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
