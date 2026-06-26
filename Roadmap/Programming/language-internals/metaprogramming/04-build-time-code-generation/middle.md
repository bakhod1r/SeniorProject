# Build-Time Code Generation — Middle Level

> **Topic:** [Build-Time Code Generation](README.md)
> **Focus:** The three kinds of generation (template, schema-driven, annotation-driven), how generators wire into real build systems, and the regeneration discipline that keeps generated code honest.

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
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What are the distinct *kinds* of build-time generation, and how does each one plug into a build?** And **how do you keep generated code from silently going stale?**

At the junior level, "code generation" is one idea: a tool writes source before the compiler runs. At the middle level you need to see that it is really a **spectrum** of techniques that differ in *what the input is* and *how the generator is triggered*. The three you will meet constantly:

1. **Template-based generation** — a string template (Mustache, Jinja, Go `text/template`, .NET T4) plus some data produces text. The most general and the most "manual": you control the template and the data, you write the output shape.
2. **Schema-driven generation** — a formal schema (`.proto`, OpenAPI, Thrift, GraphQL SDL, a SQL schema) drives a dedicated generator (`protoc`, `openapi-generator`, `sqlc`, jOOQ) that knows how to turn that schema into typed code.
3. **Annotation-driven generation** — you annotate your *own* source (`@Data`, `@Component`, `@AutoValue`) and a processor that runs *inside the compiler* (Java APT, Kotlin KSP/KAPT) emits companion code.

These differ in coupling, in where they run, and in how regeneration is triggered — and getting those mechanics right is what separates a tidy build from a flaky one. This page covers the three kinds in depth, how each integrates with Make/Gradle/Cargo/Bazel, the committed-vs-gitignored decision with its real trade-offs, incremental regeneration, and the CI **drift check** that catches stale output before it reaches `main`.

> 🎓 **Why this matters at the middle level:** Most generation bugs are not in the generated code — they are in the *plumbing*. Stale output, version skew between developers, a build that "works on my machine" because the generator ran an hour ago: these are build-engineering problems. Knowing the three kinds and their triggers lets you diagnose and fix them fast.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md` — the pipeline (input → generator → generated code → compiler), single source of truth, "never edit generated code."
- **Required:** Working knowledge of at least one build system: `go build`/`go generate`, Maven/Gradle, Cargo, or Make.
- **Required:** Comfort reading a schema (`.proto`, JSON/YAML, a SQL `CREATE TABLE`).
- **Helpful but not required:** Having configured a CI pipeline (GitHub Actions, GitLab CI) before.
- **Helpful but not required:** Exposure to gRPC, OpenAPI, or a DI framework (Dagger/Spring).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Template-based generation** | Generation driven by a text template with placeholders, filled from data. Examples: Mustache, Jinja2, Go `text/template`, T4. |
| **Schema-driven generation** | Generation driven by a formal schema/IDL through a dedicated generator. Examples: protobuf, OpenAPI, Thrift, GraphQL, sqlc, jOOQ. |
| **Annotation-driven generation** | Generation driven by annotations on your own source, processed during compilation. Java APT, Kotlin KSP/KAPT, Rust derive macros (a near relative). |
| **IDL (Interface Definition Language)** | A language for describing data/interfaces independent of any programming language — `.proto`, Thrift, OpenAPI are IDLs. |
| **APT (Annotation Processing Tool)** | Java's mechanism for compiler plugins that read annotations and emit new source/classes during compilation. |
| **KSP / KAPT** | Kotlin Symbol Processing (fast, modern) and Kotlin Annotation Processing Tool (older, runs the Java APT pipeline over stubs). |
| **`build.rs`** | A Rust build script compiled and run by Cargo *before* the crate, used to generate code, run `bindgen`/`prost`, or configure linking. |
| **`OUT_DIR`** | The Cargo-provided directory where `build.rs` writes generated files; the crate pulls them in with `include!`. |
| **Drift check** | A CI step that regenerates code and fails if the working tree changes — i.e. someone forgot to regenerate. |
| **Incremental regeneration** | Regenerating only the outputs whose inputs changed, instead of everything, to keep builds fast. |
| **Hermetic build** | A build that depends only on declared inputs (including the generator and its version), so it is reproducible anywhere. Bazel aims for this. |
| **Single source of truth** | The canonical artifact (schema/annotation/template+data) from which generated code is derived. |
| **Version skew** | Different developers/CI using different generator versions, producing different output. |

---

## Core Concepts

### 1. The Spectrum: Three Kinds of Generation

The three kinds are best understood by *what is the input* and *who triggers the generator*.

```text
  KIND                INPUT                         TRIGGER                       EXAMPLES
  ─────────────────   ───────────────────────────   ───────────────────────────   ──────────────────────
  Template-based      a template + a data model     you run the templating tool   Mustache, Jinja, T4,
                                                     (often via a script/Make)     Go text/template
  Schema-driven       a formal schema / IDL         a dedicated generator,        protoc, openapi-gen,
                                                     run from build/Make/CI        sqlc, jOOQ, Thrift
  Annotation-driven   annotations on your source    the compiler itself, via      Lombok, Dagger,
                                                     a processor plugin            MapStruct, KSP/KAPT
```

The deeper you go down this list, the more the generation is *integrated* with the language. Template-based generation is language-agnostic glue. Schema-driven generation is a separate compiler for a separate language (the IDL). Annotation-driven generation runs *inside your language's compiler* and reads your actual source.

### 2. Template-Based Generation

The most general technique: a **template** (a string with `{{placeholders}}`) plus a **data model** (a map/struct of values) produces text. The text can be source code, SQL, config, HTML, anything.

```text
   template ("Hello, {{.Name}}")  +  data ({Name: "Ada"})  ──▶  "Hello, Ada"
```

Strengths: total control, no schema required, works for any output. Weaknesses: *you* are responsible for producing valid code — the template engine does not understand the target language, so a missing brace produces broken output the engine cheerfully emits. This is why template-based generation is best for *small, controlled* outputs (a config file, a registry, a switch table) and why dedicated schema-driven generators exist for the heavy cases.

### 3. Schema-Driven Generation

Here the input is a **formal schema** in an IDL, and a **dedicated generator** that *understands that IDL* produces typed code. The generator knows the target language's idioms, so the output is correct by construction.

- **protobuf / gRPC:** `.proto` → `protoc` → message structs (`.pb.go`, `User.java`) and, with the gRPC plugin, client/server stubs from `service` definitions.
- **OpenAPI / Swagger:** an OpenAPI YAML/JSON spec → `openapi-generator` → typed HTTP clients and server scaffolding in dozens of languages.
- **Thrift:** Apache Thrift IDL → typed structs and RPC, similar to protobuf.
- **GraphQL:** an SDL schema → typed resolvers/clients (e.g. `graphql-codegen`, `gqlgen`).
- **SQL → typed query code:** `sqlc` reads your SQL queries + schema and generates typed Go functions; jOOQ reads your database schema and generates a typed Java query DSL. A column rename becomes a *compile error*, not a runtime surprise.

The shared property: the schema is **language-independent**, so the *same* schema generates a Go server, a Java client, and a Python script — all guaranteed to agree on the wire.

### 4. Annotation-Driven Generation

Here you do not write a separate schema; you annotate your **own source**, and a **processor runs inside the compiler** to emit companion code.

- **Java APT:** annotation processors are registered with `javac`. During compilation the compiler invokes them; they read annotated elements and write new source files (which are then compiled in the same run). **Lombok** generates accessors/equals/toString; **AutoValue** generates immutable value classes; **MapStruct** generates type-safe object mappers; **Dagger** generates a compile-time dependency-injection graph.
- **Kotlin KSP/KAPT:** KAPT runs the Java APT machinery over Kotlin (slow, generates Java stubs); **KSP** is a faster, Kotlin-native API that processes Kotlin symbols directly.

The defining trait: the trigger is **the compiler**, so generation and compilation are one step. There is no separate "run the generator" command — `javac`/`kotlinc` does it. (Lombok is a slight outlier: it *modifies the AST* rather than emitting separate files, but it rides the same APT entry point.)

### 5. Dagger vs Spring — Compile-Time vs Runtime DI

A concrete, interview-worthy contrast. Both wire up dependency injection, but at different times:

| | **Dagger** | **Spring (classic)** |
|------|------|------|
| When the DI graph is built | **Compile time** (annotation processor generates the wiring code) | **Runtime** (reflection scans classes, builds the graph as the app starts) |
| Errors surface | At **compile time** — a missing binding fails the build | At **runtime** — a missing bean fails on startup (or later) |
| Startup cost | Near-zero (wiring is precompiled) | Reflection + classpath scanning at boot |
| Native-image friendliness | High (no reflection needed) | Lower (reflection config required for GraalVM) |

This is the codegen value proposition in miniature: **move work from runtime to build time**, turning runtime failures into compile errors.

### 6. Build-System Integration

A generator is only useful if the build runs it reliably. Each ecosystem has a hook:

- **Make:** a target with the generated file as output and the schema as prerequisite — `make` reruns the generator only when the schema is newer. This is the original incremental-regeneration mechanism.
- **`go generate`:** a convention, *not* part of `go build`. A `//go:generate <cmd>` comment plus `go generate ./...` runs the commands. Importantly, `go build` does **not** run `go generate` — you (or CI) must. So Go projects typically *commit* generated files.
- **Gradle/Maven:** annotation processors run automatically during compilation (`annotationProcessor` / `<annotationProcessorPaths>`). Schema generators are wired as build tasks (e.g. the protobuf Gradle plugin) into `build/generated/`, and added to the source set so the compiler sees them.
- **Cargo + `build.rs`:** Cargo compiles and runs `build.rs` *before* the crate. It is the idiomatic place to call `prost`/`tonic` (protobuf) or `bindgen` (C headers → Rust FFI), writing into `OUT_DIR` and pulling the result in with `include!(concat!(env!("OUT_DIR"), "/generated.rs"))`. This makes generation part of every build, so Rust projects often *do not* commit generated code.
- **Bazel:** generation is a first-class build rule (`genrule`, `proto_library`, language `*_proto_library`). Bazel tracks the schema as a declared input and the generated code as a declared output, giving **hermetic, incremental** generation — the generator version is part of the build graph.

### 7. The Committed-vs-Gitignored Decision

A real engineering choice with consequences either way:

**Commit generated code when:** the generator is awkward to install (a specific `protoc` + plugins), you want zero-setup clones and fast CI, or your ecosystem does not auto-run generation (Go). Cost: noisy diffs, regenerate-and-commit discipline, version-skew diffs.

**Gitignore + regenerate-on-build when:** the generator runs automatically in your build (Cargo `build.rs`, Gradle annotation processing) so there is no extra setup, or you want a clean repo. Cost: every dev and CI must have the pinned generator; offline/air-gapped builds get harder.

The deciding factors: *does the build run the generator automatically?* and *is the generator easy to pin and install?* (More trade-off depth in `senior.md`.)

### 8. Incremental Regeneration and Drift Checks

**Incremental:** regenerate only what changed. Make and Bazel do this via input/output timestamps and the dependency graph. Naive scripts that "regenerate everything" are slow and a common build-speed complaint.

**Drift check:** the antidote to stale generated code. In CI, run the generator, then `git diff --exit-code`. If the working tree changed, someone forgot to regenerate — fail the build. This single check eliminates an entire class of "works locally, broken in review" bugs and is the most valuable piece of generation plumbing you can add.

---

## Real-World Analogies

**Three ways to get a translated document.** Template-based is filling in a form letter yourself. Schema-driven is sending the original to a professional translation service that knows the target language's grammar. Annotation-driven is having a translator sit *inside the printing press*, translating as the document is printed.

**Make as a smart kitchen.** A recipe (Makefile) says "the cake (generated code) depends on the batter (schema); only re-bake if the batter changed." Make checks timestamps and skips work that is already up to date — incremental regeneration.

**The drift check as a spell-checker on commit.** Just as a pre-commit spell-check refuses text with typos, a drift check refuses a commit where the generated code does not match its schema.

---

## Mental Models

**Model 1 — "Same idea, three triggers."** All three kinds expand a compact input into code. They differ in *who pulls the trigger*: you (template), a dedicated generator (schema), or the compiler itself (annotation).

**Model 2 — "The generator is a build dependency, like a compiler."** Treat `protoc` exactly as you treat `go`/`javac`: it must be present, pinned to a version, and reproducible. Version skew in the generator is as bad as version skew in the compiler.

**Model 3 — "Generated code has a freshness date."** It is valid only relative to the input it was made from. The drift check is the expiry alarm.

**Model 4 — "Move it left."** The recurring theme: shift work from runtime to build time. Reflection-based DI at startup becomes generated DI at compile time; runtime serialization becomes generated serialization. Earlier failure, less runtime cost.

---

## Code Examples

### Example 1: Go `go generate` with `mockgen`

```go
//go:generate mockgen -source=store.go -destination=store_mock.go -package=app

type Store interface {
    Get(id string) (User, error)
    Put(u User) error
}
```

`go generate ./...` runs `mockgen`, which produces `store_mock.go` containing a `MockStore` implementing `Store` for tests. Note: `go build` will **not** run this — you run `go generate` and commit `store_mock.go` (or wire it into CI/Make).

### Example 2: A Make rule with incremental regeneration

```makefile
# Regenerate user.pb.go only when user.proto is newer.
user.pb.go: user.proto
	protoc --go_out=paths=source_relative:. user.proto

.PHONY: gen
gen: user.pb.go
```

`make gen` regenerates only if `user.proto` changed since `user.pb.go` was written — the original incremental-regeneration mechanism.

### Example 3: Rust `build.rs` generating protobuf with `prost`

```rust
// build.rs — compiled and run by Cargo before the crate.
fn main() {
    prost_build::compile_protos(&["proto/user.proto"], &["proto/"]).unwrap();
}
```

```rust
// src/lib.rs — pull in the generated module from OUT_DIR.
pub mod user {
    include!(concat!(env!("OUT_DIR"), "/example.rs"));
}
```

Because `build.rs` runs on every build, the generated code is typically **not committed** — Cargo regenerates it.

### Example 4: A CI drift check (GitHub Actions)

```yaml
- name: Regenerate
  run: make gen
- name: Fail on drift
  run: |
    if ! git diff --exit-code; then
      echo "Generated code is stale. Run 'make gen' and commit."
      exit 1
    fi
```

This is the single most valuable piece of generation plumbing: it makes "forgot to regenerate" impossible to merge.

### Example 5: Java annotation-driven mapper (MapStruct)

```java
@Mapper
public interface UserMapper {
    UserDto toDto(User user);
}
```

At compile time, MapStruct's annotation processor generates `UserMapperImpl` with field-by-field copying code — no reflection at runtime, and a *compile error* if a field cannot be mapped.

### Example 6: sqlc — SQL to typed Go

```sql
-- name: GetUser :one
SELECT id, name, email FROM users WHERE id = $1;
```

`sqlc generate` produces a typed `GetUser(ctx, id) (User, error)` function. Rename the `email` column in the schema and regenerate: the *generated code changes and your callers fail to compile* — the database schema and the code are kept in lockstep at build time.

---

## Pros & Cons

### Pros

- **Schema-driven generation guarantees cross-language agreement** — one `.proto` makes a Go server and a Java client that cannot disagree on the wire.
- **Annotation-driven generation needs no separate schema** — annotations live with the code they describe.
- **Build-system integration (Make/Bazel/Cargo) gives free incrementality** — only changed inputs regenerate.
- **Drift checks make staleness impossible to merge.**
- **Move work left:** compile-time DI (Dagger), compile-time mapping (MapStruct), compile-time serialization — runtime failures become compile errors.

### Cons

- **Template-based generation has no language awareness** — easy to emit syntactically broken code.
- **Annotation processors slow compilation** — APT/KAPT add a measurable build cost; KSP mitigates but does not eliminate it.
- **Generator-as-build-dependency** must be installed, pinned, and reproducible everywhere, or you get version skew.
- **The committed-vs-gitignored decision has no free option** — each side has real costs (diff noise vs setup burden).
- **`go generate` is not part of `go build`** — a common trap; forgetting to run it produces stale output with no warning.

---

## Use Cases

- **Cross-language microservices:** protobuf/gRPC as the contract; each service generates its own stubs.
- **Public API SDKs:** an OpenAPI spec generates client SDKs in many languages from one source.
- **Type-safe persistence:** sqlc/jOOQ so schema drift becomes a compile error.
- **Compile-time DI:** Dagger in Android/JVM apps where startup time and native-image support matter.
- **Object mapping at boundaries:** MapStruct between entities and DTOs without reflection.
- **FFI bindings:** Rust `build.rs` + `bindgen` to wrap a C library with safe, typed Rust.
- **Test doubles:** `mockgen`/Mockito-generated mocks regenerated as interfaces evolve.

---

## Coding Patterns

**Pattern: One canonical generate command, wired into the build.** A `make gen` (or `go generate ./...`, or a Gradle task) that regenerates everything. Document it; CI runs it for the drift check.

**Pattern: Pin the generator version in-repo.** Go's `tools.go` + module versions; a lockfile; or a container image with the exact `protoc` + plugins. Eliminates version skew.

**Pattern: Schema as a library.** Put `.proto`/IDL files in a shared repo/module that all services depend on, so the contract has a single home.

**Pattern: Drift check in CI.** Regenerate, then `git diff --exit-code`. Non-negotiable for committed-generated-code projects.

**Pattern: Keep generated output in a clearly separated location.** `build/generated/`, `OUT_DIR`, or a `*_gen.go` suffix — so humans and tools can tell it apart.

---

## Best Practices

1. **Pick the right *kind* for the job.** Schema-driven for cross-language contracts; annotation-driven for in-language boilerplate; template-based only for small, controlled outputs.
2. **Make the generator a pinned, reproducible build dependency.** Treat it like the compiler.
3. **Decide committed-vs-gitignored from the build's behavior:** if the build auto-runs the generator (Cargo, Gradle APT), gitignore is natural; if not (Go), commit.
4. **Add a CI drift check** wherever generated code is committed.
5. **Lean on the build system's incrementality** (Make prerequisites, Bazel inputs) instead of "regenerate everything" scripts.
6. **Review the schema, not the generated diff.** The schema is the human-meaningful change.
7. **Keep hand-written extensions in separate files** from generated output.

---

## Edge Cases & Pitfalls

**`go build` doesn't run `go generate`.** The classic Go trap. Generation is a manual/CI step; forgetting it yields stale output silently. Mitigate with a Make target and a drift check.

**Annotation-processor ordering and rounds.** APT runs in *rounds*: processors can generate code that triggers further processing. Two processors that each consume the other's output can fail to converge or behave order-dependently. Keep processors independent where possible.

**KAPT is slow; reflection-config differs.** KAPT generates Java stubs for every Kotlin file, inflating build time. Migrating to KSP often halves annotation-processing time. Know which one your build uses.

**`build.rs` runs on *every* build and can wreck incrementality.** A `build.rs` that does heavy work or always re-emits files makes Cargo rebuild downstream every time. Use `cargo:rerun-if-changed=` directives to scope when it reruns.

**Version skew shows up as phantom diffs.** Two developers with different `protoc-gen-go` versions produce slightly different `.pb.go`; the diff churns on every commit. Pin the plugin version repo-wide.

**Template generators emit invalid code happily.** A Go `text/template` with a typo produces a file that fails to compile — but the *generator* succeeds, so the error surfaces later, confusingly. Compile the generated output as part of generation when possible.

**Committed generated code drifts during merges.** Two branches both regenerate; merging produces conflicts in generated files. Resolve by regenerating after the merge, not by hand-merging generated lines.

---

## Cheat Sheet

| Topic | Key point |
|------|------|
| Three kinds | Template (you trigger), schema-driven (dedicated generator), annotation-driven (compiler triggers). |
| Template tools | Mustache, Jinja2, Go `text/template`, T4 — general but language-unaware. |
| Schema tools | protoc/gRPC, OpenAPI, Thrift, GraphQL, sqlc, jOOQ — typed, cross-language. |
| Annotation tools | Lombok, Dagger, AutoValue, MapStruct (Java APT); KSP/KAPT (Kotlin). |
| `go generate` | A convention; **not** run by `go build`. Commit generated Go. |
| `build.rs` | Cargo runs it every build, before the crate; writes to `OUT_DIR`; often gitignored. |
| Dagger vs Spring | Compile-time DI (errors at build) vs runtime DI (errors at startup). |
| Drift check | CI: regenerate + `git diff --exit-code` → fail on staleness. |
| Commit policy | Auto-generated by build → gitignore; manual/awkward generator → commit. |

---

## Summary

Build-time code generation is a **spectrum**, not a single technique. **Template-based** generation is general but language-unaware; **schema-driven** generation (protobuf, OpenAPI, Thrift, GraphQL, sqlc, jOOQ) turns a language-independent IDL into typed, cross-language-consistent code; **annotation-driven** generation (Java APT — Lombok, Dagger, MapStruct, AutoValue; Kotlin KSP/KAPT) runs *inside the compiler* and emits companions to your annotated source. Each integrates with a build differently: Make rules give incrementality, `go generate` is a convention outside `go build`, Gradle/Maven run annotation processors automatically, Cargo runs `build.rs` on every build, and Bazel makes generation a hermetic build rule. The two recurring engineering decisions are **committed-vs-gitignored** (decided by whether the build auto-runs the generator) and **keeping output fresh** (a CI **drift check** that regenerates and fails on diff). The throughline is "move work left" — Dagger's compile-time DI versus Spring's runtime DI is the canonical example of turning runtime failures into compile errors.

---

## Further Reading

- The protobuf and gRPC generated-code guides; the `protoc` plugin model.
- The OpenAPI Generator project and its templating model (it is itself template-based under the hood).
- The Dagger documentation on compile-time dependency graphs.
- Kotlin Symbol Processing (KSP) overview and its comparison with KAPT.
- The Cargo book chapter on build scripts (`build.rs`).
- `senior.md` in this folder — codegen vs macros vs reflection, and schema evolution.
