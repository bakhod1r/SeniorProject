# Build-Time Code Generation — Senior Level

> **Topic:** [Build-Time Code Generation](README.md)
> **Focus:** Codegen versus macros versus reflection as three routes to the same DRY goal; schema evolution; and the committed-vs-gitignored debate as an architectural decision, not a preference.

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

> Focus: **Given the same DRY goal — "describe a thing once, derive its boilerplate" — when do you reach for code generation, when for macros, and when for reflection?** And **how do generated systems survive schema evolution over years?**

At the senior level, build-time code generation stops being a tool and becomes a *design axis*. Almost every place you would generate code, you could instead use a **macro** (compile-time, inside the compiler) or **reflection** (runtime introspection). All three eliminate the same boilerplate; they differ in *when the work happens*, *what the compiler can check*, *what the toolchain can see*, and *what it costs at runtime and build time*. Choosing among them is an architecture decision with multi-year consequences — for type safety, for native-image/AOT compatibility, for debuggability, and for build complexity.

The senior also owns the *lifecycle* of generated systems. A `.proto` schema is not written once; it evolves for a decade while old and new clients coexist on the wire. The committed-vs-gitignored question is not a style preference; it is a decision about CI topology, supply-chain reproducibility, and who can build the repo. Generator version skew is a real outage source. And debugging *through* generated layers — a stack trace that lands in 600 lines of machine-written code — is a skill.

This page covers: the codegen/macro/reflection triangle with concrete decision criteria; protobuf schema evolution (field numbers, wire compatibility, reserved fields); the committed-vs-gitignored debate framed as architecture; Rust's `derive` macros as the *boundary case* between codegen and macros; and the operational realities — version skew, debugging, diff hygiene — that decide whether a generation strategy ages well.

> 🎓 **Why this matters at the senior level:** Juniors ask "how do I generate this?" Seniors ask "*should* I generate this, or use a macro, or reflection — and what does that choice cost me in three years when the schema has changed forty times and we want to ship a GraalVM native image?" Owning that question is the job.

---

## Prerequisites

- **Required:** `middle.md` — the three kinds of generation and build-system integration.
- **Required:** A working mental model of reflection (runtime type introspection) and of macros (compile-time AST transformation) in at least one language.
- **Required:** Experience evolving a wire format or public API without breaking clients.
- **Helpful but not required:** Exposure to GraalVM native image, Go's AOT model, or another reflection-hostile target.
- **Helpful but not required:** Having owned a CI pipeline's reproducibility/supply-chain story.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Macro** | Compile-time code transformation performed *inside* the compiler (Rust `macro_rules!`/proc-macros, Lisp macros, C++ templates as a degenerate case). Operates on the AST/token stream; output is compiled in the same run. |
| **Reflection** | Runtime inspection of types/fields/methods by name, and runtime invocation. The fully-dynamic alternative to generation. |
| **AOT (ahead-of-time) compilation** | Compiling to native code before run; reflection-heavy code needs explicit configuration because the compiler must know all reachable types statically. |
| **Native image** | A GraalVM-produced standalone binary; closed-world, so reflection/dynamic loading must be declared. Codegen is naturally compatible; reflection is not. |
| **Wire compatibility** | The property that messages serialized by one schema version can be read by another (forward/backward). Protobuf is designed around this. |
| **Field number** | In protobuf, the integer tag identifying a field on the wire (not the field name). Changing it breaks compatibility; the name is cosmetic. |
| **Reserved field** | A protobuf declaration that a field number/name must never be reused, preventing accidental wire collisions after a delete. |
| **`derive` macro** | Rust attribute (`#[derive(Serialize)]`) that runs a procedural macro to generate trait impls at compile time — codegen *inside* the compiler. |
| **Procedural macro** | A Rust macro that is itself a compiled program transforming token streams; the boundary case between "macro" and "code generator." |
| **Version skew** | Differing generator/plugin versions across developers/CI producing divergent output. |
| **Hermetic / reproducible build** | A build whose output depends only on declared, pinned inputs (including the generator), reproducible anywhere. |
| **Closed-world assumption** | The AOT compiler's premise that all reachable code is known at build time — broken by runtime reflection, satisfied by codegen. |

---

## Core Concepts

### 1. The Triangle: Codegen vs Macros vs Reflection

Three routes to "describe once, derive the boilerplate." They sit at different points in the compile/run timeline:

```text
   describe once
        │
        ├── REFLECTION ───── work happens at RUNTIME
        │      • inspects types by name as the program runs
        │      • no separate artifact; nothing to commit
        │      • NOT statically checked; errors at runtime
        │      • breaks AOT/native-image (closed-world)
        │      • cost: per-call runtime introspection
        │
        ├── MACROS ───────── work happens INSIDE THE COMPILER
        │      • transforms AST/tokens during compilation
        │      • no separate files (output is ephemeral)
        │      • statically checked; errors at compile time
        │      • AOT-friendly (output is real code)
        │      • cost: compile time; output hard to inspect
        │
        └── CODE GENERATION ─ work happens at BUILD TIME (before compile)
               • emits real source files on disk
               • files are inspectable, debuggable, autocompletable
               • statically checked; errors at compile time
               • AOT-friendly (it is ordinary code)
               • cost: build plumbing, diff noise, regeneration discipline
```

**Decision criteria:**

| Criterion | Prefer codegen | Prefer macro | Prefer reflection |
|------|------|------|------|
| Must the generated code be *inspectable/debuggable*? | ✔ (real files) | ✘ (ephemeral) | ✘ |
| AOT / native image target? | ✔ | ✔ | ✘ (needs config) |
| Cross-language artifact from one source? | ✔ (IDL) | ✘ (language-bound) | ✘ |
| Zero build plumbing, fully dynamic, plugin-discovery? | ✘ | ✘ | ✔ |
| Tightest integration with the language's syntax? | ✘ | ✔ | – |
| Runtime cost must be zero? | ✔ | ✔ | ✘ |

The senior summary: **reflection is the most flexible and the most expensive and the least safe; macros are the most language-integrated but the least inspectable; codegen is the most operationally visible (real files, real diffs) at the cost of build plumbing.** Most cross-language, AOT-targeted systems land on codegen.

### 2. Rust `derive` — the Boundary Case

`#[derive(Serialize, Deserialize)]` (serde) is *macros that do codegen*. A procedural macro is a compiled program that reads your struct's token stream and emits trait `impl` blocks at compile time. It has the macro's tight syntactic integration and AOT-friendliness, but the *output is ephemeral* — you cannot open a file to read it (you need `cargo expand` to see it). Compare to `build.rs` + `prost`, which writes a real `.rs` file to `OUT_DIR` you *can* open. Same goal (serialization without hand-writing), different point on the macro↔codegen continuum: derive favors integration, `build.rs` favors inspectability and cross-language schemas. Knowing *why* serde uses derive (it is language-internal, no external schema) but gRPC uses `build.rs` codegen (the `.proto` is the cross-language source of truth) is the senior distinction.

### 3. Why Codegen Beats Reflection for AOT / Native Image

This is the strongest modern argument for codegen. AOT compilers (GraalVM native image, Go's compiler, Dart AOT) assume a **closed world**: every reachable type and method must be statically known. Reflection violates this — "look up the field named `email` at runtime" cannot be resolved at build time, so you must hand-write `reflect-config.json` enumerating every reflectively-accessed member, and miss one and you get a `ClassNotFoundException` in production. Generated code has *no reflection*: the access is compiled into ordinary field reads the AOT compiler sees and includes. This is precisely why Dagger (generated DI) is native-image-friendly while classic Spring (reflective DI) needs extensive configuration, and why protobuf's generated codecs work in native images where a reflective serializer would need per-type config.

### 4. Schema Evolution — The Decade-Long Problem

A schema is the source of truth *over time*, with old and new code coexisting on the wire. Protobuf's design encodes the rules:

- **Field numbers are the contract, not names.** The wire encodes field *numbers*. Renaming `email` → `email_address` is wire-compatible (cosmetic); changing its number from `3` to `4` is a *break* — old readers look for `3` and find nothing, new data under `4` is ignored as unknown.
- **Adding a field is safe** if it gets a *new* number. Old readers ignore unknown fields (preserving them on re-serialize, in proto3); new readers see a default for absent fields.
- **Deleting a field requires `reserved`.** Mark the number (and name) `reserved` so it is never reused. Reuse a deleted number for a different type and you get silent data corruption when old messages arrive.
- **Type changes are mostly breaks.** `int32`↔`int64` is sometimes wire-compatible; `string`↔`bytes` is; most others are not. The generator will happily produce code for an incompatible change — the *wire* breaks, not the build.

The senior lesson: **the generator enforces nothing about wire compatibility.** A schema change can compile cleanly and break every deployed client. Compatibility is a discipline (and a linter — `buf breaking`) on top of generation, not a property of it.

### 5. Committed-vs-Gitignored as Architecture

Reframed from `middle.md` as a senior decision with system-wide consequences:

**Commit generated code →** the repo is **self-contained and reproducible without the generator**. CI builds with no toolchain bootstrap; an auditor can read exactly what ships; a five-year-old commit still builds even if the generator is long gone. Cost: every schema change is a two-step (edit + regenerate + commit), reviews carry mechanical diffs, and you need a drift check to enforce freshness. This favors *long-lived, audited, supply-chain-sensitive* codebases.

**Gitignore + regenerate →** the repo is **clean and DRY**, but builds now *depend on the generator being present and pinned*. This is fine when the build already runs the generator hermetically (Bazel, Cargo `build.rs`, Gradle APT). Cost: reproducing an old build requires reproducing the old generator; offline/air-gapped builds get harder; a broken generator release blocks everyone.

The deciding axes are **reproducibility/audit** (favors commit) versus **DRY/clean-repo + hermetic build tooling** (favors gitignore). Note the meta-point: *the more hermetic and reproducible your build system (Bazel), the safer gitignore becomes,* because the build graph itself guarantees the generator version.

### 6. Generator Version Skew Is an Outage Class

When `protoc-gen-go`, the OpenAPI generator, or a Lombok version differs across developers/CI, you get: (a) churning diffs (committed code), (b) divergent runtime behavior (gitignored code), or (c) a build that passes locally and fails in CI. Treat the generator as a **pinned dependency** with the same rigor as the compiler: pin it in a lockfile/`tools.go`/container image, and have CI assert the pinned version. Skew is the single most common operational pain in generated codebases.

### 7. Debugging Through Generated Layers

A stack trace landing in `user.pb.go:1487` or a serde-expanded impl is disorienting. Techniques: keep generated code committed and source-mapped so debuggers can step into it; use `cargo expand`/`-Xprint` to see macro output; keep your logic *out* of generated files so a frame in generated code points at the *generator/schema*, not your bug. The principle: a frame in generated code should redirect you *upstream* to the schema, not invite you to patch downstream.

---

## Real-World Analogies

**Reflection vs codegen vs macro = GPS vs printed directions vs a chauffeur who memorized the route.** Reflection (GPS) figures out the route live, every trip, at a cost, and needs a working signal (closed-world breaks it). Codegen (printed directions) is computed once, inspectable, and works offline. A macro (the chauffeur) has the route baked in and integrated, but you cannot read it — you just trust it.

**Schema evolution = renovating a house while people live in it.** Old residents (deployed clients) still walk the old hallways (field numbers). You can add rooms (new fields) freely; you must *wall off* removed rooms permanently (`reserved`) so a future renovation does not reconnect a door to a now-different room.

**Committed-vs-gitignored = vendoring vs fetching dependencies.** Committing generated code is like vendoring: self-contained, auditable, heavier repo. Gitignoring is like fetching on build: clean, but you depend on the source (generator) staying available and pinned.

---

## Mental Models

**Model 1 — "Pick your point on the when-axis."** Reflection = runtime, macro = compile time (in-compiler), codegen = build time (pre-compile). Everything else — safety, AOT-fitness, inspectability, cost — follows from *when* the work happens.

**Model 2 — "Closed world favors generation."** Any AOT/native-image target rewards moving introspection out of runtime. Reflection fights the closed world; codegen embraces it.

**Model 3 — "The generator checks syntax, not semantics-over-time."** It guarantees the output compiles; it guarantees *nothing* about wire compatibility or runtime correctness across versions. Compatibility is a separate discipline (and linter).

**Model 4 — "A frame in generated code points upstream."** When debugging lands you in machine-written code, the bug is in the schema/generator/your-usage, never to be fixed in the generated file.

---

## Code Examples

### Example 1: Protobuf schema evolution done right

```proto
message User {
  uint64 id = 1;
  string name = 2;
  // string email = 3;   <-- removed
  reserved 3;            // never reuse number 3
  reserved "email";      // never reuse the name
  string email_address = 4;  // new field, NEW number
  bool active = 5;           // additive, safe
}
```

Old clients still read `id`/`name` by number; they ignore `4`/`5`; number `3` can never collide. The build would happily compile a *bad* version that reuses `3` — only a breaking-change linter or review catches it.

### Example 2: serde derive (macro-codegen) vs prost (file codegen)

```rust
// Macro-codegen: ephemeral, language-internal, no external schema.
#[derive(serde::Serialize, serde::Deserialize)]
struct User { id: u64, name: String, email: String }
// `cargo expand` to *see* the generated impls — there is no file on disk.
```

```rust
// File-codegen: real .rs in OUT_DIR, from a cross-language .proto.
// build.rs: prost_build::compile_protos(&["user.proto"], &["."]).unwrap();
include!(concat!(env!("OUT_DIR"), "/example.rs")); // you can open this file
```

Same goal; serde favors integration (no schema, no files), prost favors a cross-language schema and inspectable output.

### Example 3: Dagger (codegen DI) vs reflective DI under native image

```java
@Component(modules = AppModule.class)
interface AppComponent { UserService userService(); }
// Dagger's annotation processor generates DaggerAppComponent with explicit
// `new`-call wiring — no reflection — so GraalVM native image needs no DI config.
```

The reflective equivalent (scan classpath, resolve beans by type at startup) requires `reflect-config.json` listing every injected type, and fails at *runtime* if one is missed.

### Example 4: Pinning the generator to kill version skew

```go
//go:build tools
package tools

import (
    _ "google.golang.org/protobuf/cmd/protoc-gen-go"      // version pinned by go.mod
    _ "google.golang.org/grpc/cmd/protoc-gen-go-grpc"
)
```

Now the plugin versions are part of `go.mod`; everyone generates identical output, and CI can assert it.

### Example 5: A breaking-change gate in CI

```yaml
- name: protobuf breaking-change check
  run: buf breaking --against '.git#branch=main'
```

This catches the wire-compatibility violations the *generator never will* — reused field numbers, type changes, field-number changes.

---

## Pros & Cons

### Pros

- **Codegen is the only option that yields cross-language artifacts** from one source of truth (IDL).
- **Codegen + macros both satisfy the closed-world AOT assumption**; reflection does not.
- **Codegen produces inspectable, debuggable, committable artifacts** — auditable supply chain.
- **Macros offer the tightest language integration** when no cross-language schema is needed (serde, derive).
- **Reflection offers maximal runtime flexibility** (plugin discovery, dynamic schemas) when AOT and performance are not constraints.

### Cons

- **Codegen carries the heaviest build/operational plumbing** (pinning, drift checks, version skew).
- **Macros are hard to inspect and debug**; errors can be cryptic; output is ephemeral.
- **Reflection breaks AOT/native image**, costs at runtime, and defers errors to runtime.
- **No route protects you from schema-evolution mistakes** — that is a separate discipline.
- **Generated diffs and version skew add ongoing review/maintenance tax.**

---

## Use Cases

- **Cross-language wire contracts under AOT:** protobuf/gRPC codegen — the only sane choice.
- **In-language serialization, no external schema:** Rust serde derive, language-bound macros.
- **Compile-time DI for native images / fast startup:** Dagger codegen over reflective Spring.
- **Type-safe DB access with schema-drift-as-compile-error:** sqlc/jOOQ codegen.
- **Plugin systems with runtime discovery, AOT not required:** reflection (service loaders, dynamic dispatch).
- **Long-lived, audited codebases:** committed generated code for reproducibility.

---

## Coding Patterns

**Pattern: Choose the route by constraints, not habit.** AOT target + cross-language → codegen. Language-internal + no schema → macro. Runtime-dynamic + flexibility-over-cost → reflection.

**Pattern: Layer a compatibility linter over schema-driven codegen.** `buf breaking`, OpenAPI diff tools — because the generator cannot enforce wire/API compatibility.

**Pattern: Treat the generator as a first-class, pinned dependency.** Lockfile/`tools.go`/container; CI asserts the version.

**Pattern: Keep logic out of generated files** so a generated-frame in a trace always redirects upstream.

**Pattern: Let build hermeticity drive the commit policy.** Hermetic build (Bazel) → gitignore is safe; non-hermetic → commit for reproducibility.

---

## Best Practices

1. **Decide codegen/macro/reflection by AOT-fitness, cross-language need, and inspectability — explicitly, and write it down.**
2. **Add a wire/API breaking-change gate** on every schema-driven generator.
3. **Pin generator and plugin versions repo-wide; assert them in CI.**
4. **Match commit policy to build hermeticity and audit needs.**
5. **Never reuse protobuf field numbers; `reserved` on every delete.**
6. **Keep generated code free of hand-written logic** for clean debugging.
7. **Prefer KSP over KAPT, derive over reflection, generated DI over reflective DI** when the target is AOT or startup-sensitive.

---

## Edge Cases & Pitfalls

**Reusing a deleted protobuf field number.** Silent, catastrophic: old messages decode garbage into the new field. Always `reserved`. The build will *not* warn you.

**Macro output you cannot see.** A serde/derive bug or a surprising trait impl is invisible until you `cargo expand`. Teams forget the tool exists and burn hours.

**Native-image failure from one missing reflection entry.** A reflective path that "worked in tests" (JIT mode) fails only in the native image. Generated code sidesteps the entire problem.

**Version skew that only manifests in CI.** Local `protoc` is newer; CI's is pinned; the committed code differs; the drift check fails on an "unrelated" PR. Pin everything.

**Gitignored generated code + a yanked generator release.** A bad upstream generator version can block all builds with no committed fallback. Vendoring/committing mitigates.

**Type change that compiles but breaks the wire.** `int32`→`string` regenerates cleanly and shatters every client. Only a compatibility linter catches it.

**Debugging into a 600-line generated frame.** Without source-mapped, committed generated code, the debugger has nothing to step into. Commit + map, or expand.

---

## Cheat Sheet

| Question | Senior answer |
|------|------|
| Codegen vs macro vs reflection? | Build-time/files vs compile-time/ephemeral vs runtime/dynamic. Pick by AOT-fitness, cross-language need, inspectability, cost. |
| Why codegen for native image? | Closed world: no runtime reflection to configure; generated access is statically visible. |
| Is `#[derive]` codegen or a macro? | Both — a proc-macro doing codegen *inside* the compiler; output is ephemeral (use `cargo expand`). |
| What is the protobuf contract? | Field *numbers*, not names. Add with new numbers; never reuse; `reserved` on delete. |
| Does the generator enforce compatibility? | No. Add a breaking-change linter (`buf breaking`). |
| Commit or gitignore generated code? | Commit for reproducibility/audit; gitignore when the build is hermetic and runs the generator. |
| Biggest operational risk? | Generator version skew. Pin it like the compiler. |
| Dagger vs Spring? | Compile-time generated DI (AOT-friendly, build errors) vs runtime reflective DI (config-heavy, startup errors). |

---

## Summary

At senior level, build-time code generation is one corner of a **triangle** with macros and reflection — three ways to satisfy the same DRY goal that differ by *when* the work happens (build time / compile time / runtime), and therefore by static-checkability, AOT/native-image fitness, inspectability, and cost. Reflection is the most flexible and the most expensive and breaks the closed-world assumption; macros integrate tightest with the language but produce ephemeral, hard-to-inspect output; codegen yields real, debuggable, cross-language artifacts at the price of build plumbing. Rust's `derive` is the instructive boundary case — a macro doing codegen. The senior responsibilities are lifecycle and operations: **schema evolution** (field numbers are the contract; `reserved` on delete; the generator enforces *nothing* about wire compatibility — a linter must); the **committed-vs-gitignored** decision as an architecture call driven by reproducibility/audit versus DRY/hermetic-build tooling; **version skew** as a first-class outage class to be pinned away; and **debugging through generated layers** by keeping logic upstream. The mature instinct: choose the route by constraints, layer a compatibility gate on top, pin the generator like a compiler, and let a generated stack frame always point you back to the schema.

---

## Further Reading

- The Protocol Buffers language guide on updating message types (field numbers, `reserved`, compatibility).
- `buf` and its breaking-change detection rules.
- The serde derive internals and `cargo expand`.
- GraalVM native-image reflection configuration docs (the problem codegen avoids).
- The Dagger vs runtime-DI comparison literature.
- `professional.md` in this folder — generation at organizational scale and toolchain ownership.
