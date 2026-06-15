# Build Systems Roadmap

> *"A program is never finished, only abandoned — and the build that produces it must outlive both."*

This roadmap is about **how source code becomes a runnable artifact**: compilation, linking, packaging, dependency resolution, and the tooling that orchestrates it all reproducibly.

> Looking for *what the compiler does internally* (lexing, parsing, codegen)? See [Compilers & Interpreters](../../language-internals/compilers-and-interpreters/README.md).
>
> Looking for *deploying* the built artifact (Docker, CI/CD, Kubernetes)? See the [DevOps](../../../DevOps/) section.

---

## Why a Dedicated Roadmap

Every language ships its own build tool — and every team eventually outgrows it. Understanding builds *as a category* (incremental compilation, dependency graphs, hermetic builds, caching) makes you fluent across `make`, `cargo`, `gradle`, `bazel`, `go build`, and whatever comes next.

| Roadmap | Question it answers |
|---|---|
| [Testing](../testing/README.md) | Does my code work? |
| [Performance](../performance/README.md) | Is my code fast? |
| **Build Systems** (this) | Can I reproducibly turn my source into a runnable artifact? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-build-fundamentals/) | Build Fundamentals | Compile / assemble / link, static vs dynamic linking, the C ABI |
| [02](02-dependency-graphs/) | Dependency Graphs | DAGs, topological order, incremental rebuilds, the "diamond problem" |
| [03](03-make-and-descendants/) | Make & Descendants | `make`, `ninja`, `meson`, `cmake` — the lineage and why they exist |
| [04](04-per-language-tools/) | Per-Language Tools | `go build` / `go mod`, `cargo` (Rust), `gradle` / `maven` (Java), `pip` / `poetry` / `uv` (Python), `npm` / `pnpm` / `bun` (JS/TS) |
| [05](05-polyglot-hermetic-builds/) | Polyglot / Hermetic Builds | `bazel`, `buck2`, `pants` — when one tool must build everything reproducibly |
| [06](06-dependency-management/) | Dependency Management | Semantic versioning, lock files, MVS (Minimum Version Selection), vendoring |
| [07](07-build-caching/) | Build Caching | Local caches, remote caches, content-addressable storage, sccache, build farms |
| [08](08-cross-compilation/) | Cross-Compilation | Building for a target that isn't your host (ARM on x86, Windows on Linux) |
| [09](09-reproducible-builds/) | Reproducible Builds | Bit-identical outputs, timestamps, paths, SOURCE_DATE_EPOCH |
| [10](10-build-performance/) | Build Performance | Parallelism, fan-out, profiling slow builds, the cost of incremental |

---

## Languages

The roadmap is tool-centric, but examples cover the build tools for **Go**, **Java**, **Python**, **Rust**, and (briefly) **C/C++** as the lingua franca underneath most build systems.

---

## Status

✅ **Content complete.** All 10 topics written across five tiers each — `junior` / `middle` / `senior` / `professional` / `interview`.

---

## References

- *Software Engineering at Google* — Winters, Manshreck, Wright (build chapters on Bazel and monorepo scale)
- *Managing Software Dependencies* — Russ Cox's series on Go modules and MVS
- *Recursive Make Considered Harmful* — Peter Miller (1997)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
