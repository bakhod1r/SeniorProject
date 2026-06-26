# Build-Time Code Generation — Interview Questions

> **Topic:** [Build-Time Code Generation](README.md)

---

## Introduction

These questions probe whether a candidate understands code generation as an engineering discipline, not just a tool they once invoked. The strongest answers treat generation as one point on a spectrum that includes macros and reflection, reason precisely about *when* the work happens (build time vs compile time vs runtime), and distinguish what the generator guarantees (the output compiles) from what it does not (wire compatibility, freshness, reproducibility). Weaker answers stop at "protobuf generates a class for you" without explaining the source-of-truth principle, the regeneration discipline, or the operational realities — version skew, drift, schema evolution — that determine whether a generation strategy survives contact with a real codebase.

The questions are grouped: **Conceptual** (the model and its trade-offs), **Tool-Specific** (protoc/gRPC, `go generate`, Java APT/Lombok/Dagger, OpenAPI, Rust `build.rs`/`bindgen`), **Tricky / Trap** (where the textbook answer is subtly wrong), and **Design** (open-ended scenarios that reveal whether the candidate has actually operated generated systems).

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design](#design)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual

### Question 1

**What is build-time code generation, and why would you prefer it over writing the code by hand?**

Build-time code generation runs a tool — a code generator — that produces source code (or other artifacts) from a more compact input *before or during the build*, so that by the time the compiler runs, the generated files look like ordinary hand-written source. You prefer it for mechanical, repetitive boilerplate (serialization, getters/setters, RPC stubs, mappers, mock objects) because the input is a *single source of truth* and the generated code is *derived* from it: change the input once, and every derived piece updates consistently. Versus hand-writing, you eliminate an entire class of "I forgot to update the serializer when I added a field" bugs. Versus reflection, you get zero runtime cost, full static type-checking, IDE autocomplete, and debuggability — because the generated code is real code the compiler sees.

### Question 2

**Explain the "single source of truth" principle in code generation. What is the cardinal rule that follows from it?**

In a codegen setup, one artifact is canonical — the schema, spec, or annotation — and everything else is derived from it. The schema is upstream; the generated code is downstream. The cardinal rule that follows: **never hand-edit generated code.** If the generated output is wrong, you fix the input and regenerate; you do not patch the generated file, because the next regeneration overwrites your patch, and meanwhile your input and output disagree. Generators reinforce this socially with a `// DO NOT EDIT` header. Editing downstream is the most common and most insidious codegen mistake.

### Question 3

**Compare code generation, macros, and reflection as three ways to achieve the same DRY goal.**

All three let you describe something once and derive boilerplate, but they differ by *when* the work happens. **Reflection** does it at runtime — inspecting types by name as the program runs; maximally flexible, but not statically checked, has runtime cost, and breaks ahead-of-time compilation (the closed-world assumption). **Macros** do it at compile time, inside the compiler, transforming the AST/token stream; statically checked and AOT-friendly, but the output is ephemeral and hard to inspect/debug. **Code generation** does it at build time, before the compiler, emitting real source files; statically checked, AOT-friendly, *and* inspectable/debuggable/committable, at the cost of build plumbing and diff noise. The decision criteria: need a cross-language artifact from one schema → codegen; language-internal with no external schema → macro; need runtime dynamism and AOT is irrelevant → reflection.

### Question 4

**Why does code generation produce code that has zero runtime cost, full type-checking, and IDE autocomplete, while reflection does not?**

Because generated code is *real code on disk* by the time the compiler runs. The compiler type-checks it, optimizes it, and links it like any source file — so there is no runtime introspection (zero runtime cost), the compiler catches type errors (full type-checking), and the IDE indexes the file (autocomplete and "go to definition"). Reflection, by contrast, defers the equivalent work to runtime: types are resolved by name as the program executes, so errors surface at runtime, there is per-call introspection cost, and the IDE cannot see methods that are only invoked dynamically.

### Question 5

**What are the three kinds of build-time generation? Give an example of each.**

Template-based, schema-driven, and annotation-driven. **Template-based**: a string template plus a data model produces text (Mustache, Jinja2, Go `text/template`, T4) — general but language-unaware. **Schema-driven**: a formal IDL drives a dedicated generator that understands the target language (protobuf/`protoc`, OpenAPI, Thrift, GraphQL, sqlc, jOOQ) — typed and cross-language. **Annotation-driven**: you annotate your own source and a processor runs inside the compiler to emit companions (Java APT — Lombok, Dagger, MapStruct, AutoValue; Kotlin KSP/KAPT). They differ in what the input is and who triggers generation — you, a dedicated generator, or the compiler itself.

### Question 6

**What is "stale generated code," and how do you prevent it?**

Stale generated code is generated output that no longer matches its input because someone changed the input but forgot to regenerate. It produces confusing, silent bugs — a new schema field "doesn't exist," behavior lags the schema. You prevent it with a **CI drift check**: in CI, run the generator, then `git diff --exit-code`; if the working tree changed, someone forgot to regenerate, so fail the build. This is the single most valuable piece of generation plumbing and makes "forgot to regenerate" impossible to merge.

### Question 7

**Why is build-time code generation a strong fit for ahead-of-time compilation and native-image targets, where reflection is not?**

AOT compilers (GraalVM native image, Go, Dart AOT) assume a *closed world*: every reachable type and method must be known statically at build time. Reflection violates this — "look up the field named `email` at runtime" cannot be resolved at build time, so you must hand-write reflection configuration enumerating every reflectively accessed member, and missing one yields a runtime failure that appears only in the native image. Generated code contains no reflection: the access is compiled into ordinary field reads the AOT compiler sees and includes. This is why Dagger's generated DI works in native images while reflective DI needs extensive configuration.

### Question 8

**What does the generator guarantee, and — importantly — what does it not guarantee?**

It guarantees the output is syntactically valid and will compile (for a competent schema-driven generator). It guarantees *nothing* about: wire/API compatibility across schema versions (you can compile a change that breaks every deployed client), runtime correctness over time, freshness (it does not know the input changed unless you run it), or reproducibility (a nondeterministic generator differs every run). Those are separate disciplines — a compatibility linter, a drift check, a pinned deterministic toolchain — layered on top of generation.

---

## Tool-Specific

### Question 9

**In protobuf, what actually identifies a field on the wire — its name or its number? What follows for schema evolution?**

The **field number**, not the name. The wire format encodes the integer tag, so renaming a field (`email` → `email_address`) is wire-compatible and purely cosmetic, while changing its number is a breaking change. It follows that you add fields with *new* numbers (old readers ignore unknown fields, new readers see defaults for absent ones), and when you delete a field you must mark its number (and name) `reserved` so it is never reused — reusing a deleted number silently corrupts data when old messages arrive. The generator will happily emit code for an incompatible change; only review or a breaking-change linter (`buf breaking`) catches it.

### Question 10

**How does `go generate` relate to `go build`? What is the common trap?**

`go generate` is a *convention*, not part of `go build`. A `//go:generate <command>` comment marks a file, and running `go generate ./...` executes those commands to produce code. The trap: **`go build` does not run `go generate`**. If you change a schema and rebuild, the build happily uses the *old* generated file — there is no warning. Because of this, Go projects typically commit generated files and add a CI drift check, and wire regeneration into a `make gen` target rather than relying on people remembering.

### Question 11

**How does Java annotation processing (APT) work, and how do Lombok, Dagger, and MapStruct use it?**

Annotation processors are plugins registered with `javac`. During compilation the compiler invokes them in *rounds*; they read annotated program elements and emit new source files, which are compiled in the same run. **Dagger** reads `@Component`/`@Inject` and generates the dependency-injection wiring at compile time. **MapStruct** reads `@Mapper` and generates field-by-field mapper implementations (no reflection). **AutoValue** generates immutable value classes. **Lombok** is the outlier: instead of emitting separate files, it *modifies the AST* during processing to inject getters/setters/`equals`/etc. into the compiled class — it rides the same APT entry point but mutates rather than generates new files.

### Question 12

**Contrast Dagger's compile-time dependency injection with Spring's classic runtime DI.**

Dagger builds the DI graph at **compile time**: its annotation processor generates explicit wiring code, so a missing binding is a *compile error*, startup cost is near-zero, and there is no reflection — making it native-image-friendly. Classic Spring builds the graph at **runtime**: it scans the classpath and resolves beans by type via reflection as the app starts, so a missing bean fails at *startup* (or later), there is reflection/scanning cost at boot, and native images require explicit reflection configuration. This is the codegen value proposition in miniature: move work from runtime to build time, turning runtime failures into compile errors.

### Question 13

**What does OpenAPI/Swagger code generation give you, and what is the source of truth?**

An OpenAPI spec (YAML/JSON describing endpoints, request/response schemas, status codes) is the source of truth. A generator (e.g. `openapi-generator`) produces typed HTTP client SDKs and/or server scaffolding in many languages from that one spec. The benefit: clients and servers across languages agree on the API contract, and a spec change regenerates consistent code everywhere. The trade-offs mirror protobuf: you must decide spec-first (write the spec, generate code) vs code-first (annotate handlers, generate the spec), keep generated SDKs in sync, and manage versioned distribution.

### Question 14

**What is Rust's `build.rs`, and how do `bindgen` and `prost` use it?**

`build.rs` is a build script that Cargo compiles and runs *before* compiling the crate. It is the idiomatic place for build-time code generation in Rust: it writes generated files into Cargo's `OUT_DIR`, which the crate pulls in with `include!(concat!(env!("OUT_DIR"), "/generated.rs"))`. **`bindgen`** reads C/C++ headers and generates Rust FFI bindings (typed `extern` declarations) for wrapping a C library. **`prost`** reads `.proto` files and generates Rust protobuf message types. Because `build.rs` runs on every build, the generated code is usually *not* committed — Cargo regenerates it. A subtlety: a `build.rs` that does heavy work or always re-emits files wrecks incrementality; use `cargo:rerun-if-changed=` to scope when it reruns.

### Question 15

**Where does Rust's `#[derive(...)]` sit on the codegen-vs-macro spectrum?**

It is the boundary case: a `derive` is a *procedural macro* — a compiled program that reads your struct's token stream and emits trait `impl` blocks at compile time. So it does codegen, but *inside the compiler*, and the output is **ephemeral** — there is no file on disk; you need `cargo expand` to see it. Contrast with `build.rs` + `prost`, which writes a real `.rs` file you can open. serde uses derive because serialization is language-internal with no external schema; gRPC uses `build.rs` codegen because the `.proto` is a cross-language source of truth. Same goal, different point on the macro↔codegen continuum: integration vs inspectability.

### Question 16

**What do sqlc and jOOQ do, and what specific failure mode do they turn into a compile error?**

Both generate type-safe database-access code. **sqlc** reads your SQL queries plus schema and generates typed Go functions; **jOOQ** reads your database schema and generates a typed Java query DSL. The failure mode they eliminate: a column rename or type change that, with string-based SQL, would be a *runtime* error (or silent wrong result). With generated code, the rename changes the generated types and your callers *fail to compile* — schema drift becomes a build-time error instead of a production incident.

---

## Tricky / Trap Questions

### Question 17

**"Our build passes locally but fails in CI with a generated-code diff, on a PR that didn't touch any schema." What is happening?**

Almost certainly **generator version skew**. Your local generator (e.g. `protoc-gen-go`) is a different version than CI's pinned one, so regenerating produces slightly different output, and the drift check fails on an unrelated PR. The fix is to pin the generator and all plugins repo-wide (Go `tools.go` + `go.mod`, a lockfile, or a container image) and assert the version in CI, so everyone produces byte-identical output. The deeper lesson: treat the generator as a pinned build dependency with the same rigor as the compiler.

### Question 18

**A teammate "fixed a typo" directly in `user.pb.go` and the fix vanished. Why, and what is the correct fix?**

`user.pb.go` is generated; the next `protoc`/`go generate` run overwrites the entire file from the schema, erasing any hand edit. The correct fix is *upstream*: change whatever the generator reads — the `.proto` field name, the source constant, or the generator configuration — and regenerate. The `// DO NOT EDIT` header exists precisely to warn against this. A generated stack frame or generated source should always redirect you to the schema, never invite a downstream patch.

### Question 19

**Is committing generated code to Git always wrong because it violates DRY?**

No — it is a legitimate trade-off, not a violation to be reflexively avoided. Committing generated code makes the repo self-contained and reproducible without the generator: zero-setup clones, fast CI, auditable artifacts, and a five-year-old commit still builds even if the generator is gone. The costs are diff noise, a two-step authoring flow, and the need for a drift check. The alternative — gitignore and regenerate-on-build — is cleaner but makes every build depend on a present, pinned generator. The right choice depends on whether your build auto-runs the generator (Cargo, Gradle APT favor gitignore) and your reproducibility/audit needs (favor commit). Calling either "always wrong" reveals a shallow understanding.

### Question 20

**You changed a protobuf field's type from `int32` to `string`, it regenerated and compiled cleanly, and you shipped it. What is the danger?**

The *build* is fine but the *wire* is broken. `int32` and `string` are not wire-compatible, so every deployed client serializing/deserializing the old type now mis-decodes the new messages — a production-wide incompatibility that the generator never warned about, because it only guarantees the output compiles, not that it is wire-compatible across versions. This is why schema-driven generation needs a *breaking-change linter* (`buf breaking`) gating every change, ideally at a schema registry push.

### Question 21

**Why might adding an annotation processor like KAPT measurably slow your build, and what mitigates it?**

KAPT (Kotlin Annotation Processing Tool) runs the Java APT machinery over Kotlin by generating Java stubs for every Kotlin file before processing — that stub generation and the extra compiler rounds add real build time. The mitigation is **KSP** (Kotlin Symbol Processing), a Kotlin-native API that processes symbols directly without the Java-stub detour, often roughly halving annotation-processing time. More generally, annotation processors run in rounds and can generate code that triggers further processing, so keeping processors independent and minimal helps.

### Question 22

**A drift check that runs the generator and diffs is "passing" on one machine and "failing" on another for the same commit. The generator versions match. What else could be wrong?**

The generator may be **nondeterministic** — emitting different bytes for identical input due to map-iteration ordering, embedded timestamps, absolute paths, or environment-dependent output. If the generator is not deterministic, the drift check is meaningless because every run legitimately "differs." The fix is to make the generator deterministic (configuration or a fixed version that guarantees stable output) or normalize the output, and to run generation hermetically so the environment cannot leak in. Reproducibility is the property every drift check and migration silently depends on.

### Question 23

**"We'll just use reflection — it does the same thing as codegen without the build complexity." When is this reasoning a trap?**

It is a trap whenever you target ahead-of-time compilation or a native image (reflection breaks the closed-world assumption and needs fragile per-type configuration), whenever runtime cost matters on a hot path (reflection has per-call introspection overhead), whenever you want errors at compile time rather than runtime, or whenever you need the IDE to autocomplete and the debugger to step into the code. Reflection genuinely avoids build plumbing and gives runtime dynamism, but "same thing" is wrong: it moves the work to runtime and gives up static safety, AOT-fitness, and tooling support. The right answer names the constraints, not a blanket preference.

---

## Design

### Question 24

**Design how a 200-service organization should manage protobuf schemas and generated code across teams.**

I would centralize the schemas in a **schema registry** (e.g. Buf Schema Registry) so each contract has one governed, versioned home with access control. The registry enforces **compatibility at push time** — rejecting reused field numbers, type changes, and other wire breaks *before* they reach any consumer, which is the enforcement the generator itself never provides. Generation runs **hermetically** with a pinned, deterministic toolchain (containerized or via the registry's remote plugins) so output is reproducible. I would distribute generated code as **versioned SDKs** (publish `payments-client@2.3.0`) so independently-deployed teams upgrade on their own schedule rather than via a flag day. Generator upgrades roll as **canaried migrations** decoupled from schema changes, diffing generated output on representative services first. Breaking changes use **expand-migrate-contract**. The whole thing is owned by a platform team — generation is shared infrastructure with the same governance as a compiler or package registry.

### Question 25

**You are starting a new service with a gRPC API. Decide: commit generated stubs or gitignore them? Walk through your reasoning.**

I weigh whether the build auto-runs the generator and what reproducibility/audit demands exist. For a Go service, `go build` does *not* run `go generate`, so gitignoring would force every developer and CI job to install a pinned `protoc` + plugins just to build — friction. So I would lean toward **committing** the stubs: zero-setup clones, fast CI, auditable artifacts, and old commits that still build. I would then pin the generator in `tools.go`, regenerate via a `make gen` target, and add a **CI drift check** (`make gen` + `git diff --exit-code`) so committed code can never go stale. If instead this were a Rust crate where `build.rs` regenerates on every build, or a Bazel mono-repo where generation is hermetic in the build graph, I would **gitignore** — the build already guarantees fresh, reproducible output, so committing would only add diff noise. The decision is driven by the build's behavior, not preference.

### Question 26

**Design a CI pipeline that makes generated code impossible to break or let go stale.**

Three gates. First, a **drift check**: regenerate with the pinned generator, then `git diff --exit-code` — fail if the committed generated code is stale. Second, a **breaking-change check** on the schema (`buf breaking --against main`, or an OpenAPI diff) — fail on wire/API incompatibility the generator would silently allow. Third, **build-and-test the generated output** as part of CI so a bad template or bad schema that produces non-compiling or misbehaving code is caught. Supporting these: pin the generator and plugins repo-wide (so drift checks are deterministic), ensure the generator is deterministic (so the drift check is meaningful), and record provenance of the generated artifacts for the SBOM. Together these turn the three failure modes — staleness, incompatibility, and broken output — into red builds before merge.

### Question 27

**A team wants to remove a field from a widely-used shared schema. Design the safe migration.**

Expand-migrate-contract. **Expand:** do nothing destructive yet; if the field is being replaced, add the replacement *additively* with a new field number. **Migrate:** move consumers off the old field one team/service at a time, on their own schedules, using telemetry to track usage of the old field. **Contract:** only once telemetry confirms zero consumers read the old field, remove it and mark its number (and name) `reserved` so it can never be reused. At no point do all consumers switch simultaneously — there is no flag day. This is safe *because* generation makes the contract explicit and the registry can gate each step, and the generated code makes "who still uses the old field" answerable. Skipping the contract phase is fine for safety but bloats the schema; skipping the migrate phase or reusing the number later is what causes outages.

---

## Cheat Sheet

| Question | One-line answer |
|------|------|
| What is build-time codegen? | A tool emits source from a compact input before compile; the compiler sees ordinary code. |
| Cardinal rule? | Never hand-edit generated code — fix the input and regenerate. |
| Codegen vs macro vs reflection? | Build-time/files vs compile-time/ephemeral vs runtime/dynamic. |
| Why codegen for native image? | No runtime reflection to configure; closed-world-friendly. |
| protobuf wire contract? | Field *numbers*, not names; never reuse; `reserved` on delete. |
| Does the generator enforce compatibility? | No — add a breaking-change linter. |
| `go generate` vs `go build`? | A convention; `go build` does not run it. |
| Dagger vs Spring DI? | Compile-time generated vs runtime reflective. |
| Stale code prevention? | CI drift check: regenerate + `git diff --exit-code`. |
| Commit or gitignore? | Build auto-runs generator → gitignore; otherwise commit + drift check. |
| `build.rs` / `bindgen` / `prost`? | Cargo runs `build.rs` pre-compile; bindgen = C→Rust FFI, prost = proto→Rust. |
| Fleet-scale management? | Schema registry + pinned hermetic toolchain + versioned SDKs + expand-migrate-contract. |

---

## Further Reading

- The Protocol Buffers language guide (field numbers, `reserved`, updating messages).
- The `buf` documentation — registry, breaking-change detection, hermetic generation.
- The Dagger and MapStruct docs on compile-time generation.
- The Cargo book chapter on build scripts; the `bindgen` and `prost` user guides.
- `tasks.md` in this folder for hands-on practice.
