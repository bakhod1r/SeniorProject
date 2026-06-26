# Build-Time Code Generation — Hands-On Tasks

> **Topic:** [Build-Time Code Generation](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I have run
`protoc` once" to "I can design and operate generated-code infrastructure for
a fleet of services." Every task is small enough to fit in one or two focused
sessions, and they build on one another. Attempt each problem before reading
the hints — wiring a drift check yourself teaches more about regeneration
discipline than reading about it ever will.

How to use this file: read the task, write the code or configuration, *run
it* (regenerate, build, break it on purpose, watch what fails), and only then
check the hints. Mark the self-check boxes when you can explain the result to
another engineer, not when the command merely succeeds. The sample solutions
are deliberately sparse — they appear only where the canonical answer is more
instructive than your first attempt would be.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the mental model. Each introduces one primitive or one failure
mode you will reuse for the rest of the file.

### Task 1: Your first generator round-trip

**Problem.** Pick one ecosystem: protobuf (`protoc`), Go `stringer`, or Java
Lombok. Define the smallest possible input (a 3-field `.proto`, a 3-constant
Go enum, or a 3-field `@Data` class), run the generator, and use the
generated output in a tiny `main`/test that prints something.

**Constraints.**
- Locate the generated file on disk and open it. Read at least 30 lines of it.
- Do not write any of the generated behavior by hand.

**Hints (try without first).**
- For protobuf: `protoc --go_out=paths=source_relative:. user.proto`, then
  marshal/unmarshal a message.
- For `stringer`: add `//go:generate stringer -type=Color`, run
  `go generate ./...`, then print a constant.
- Find the `// Code generated ... DO NOT EDIT.` header. That header is the
  whole topic in one line.

**Self-check.**
- [ ] You can point at the exact file the generator produced.
- [ ] You can explain why the compiler treats it like hand-written code.
- [ ] You can state where the *source of truth* lives and what is *derived*.

---

### Task 2: Break it by editing the wrong file

**Problem.** Take the generated file from Task 1 and hand-edit it (change a
string, rename a method body). Build and run — observe your edit works. Now
regenerate. Observe your edit vanish.

**Constraints.**
- Do the edit *in* the generated file, not the input. (You are deliberately
  committing the cardinal sin to feel its consequence.)

**Hints (try without first).**
- The regeneration overwrites the whole file from the input.
- Now do it the right way: make the same change *upstream* (in the schema /
  constant / annotation) and regenerate. The change should survive.

**Self-check.**
- [ ] You can explain why downstream edits are erased.
- [ ] You can name the single rule this task exists to burn in.

---

### Task 3: Add a field and watch it propagate

**Problem.** Add one field to your Task 1 input. Regenerate. Show that the
new field appears in the generated code automatically, with no hand-written
serialization/getter/string.

**Constraints.**
- Count the lines the generator added for one field. Note how many you would
  have written by hand.

**Hints (try without first).**
- For protobuf, give the new field a *new* field number.
- The "expansion ratio" (input lines vs generated lines) is the whole value
  proposition — quantify it.

**Self-check.**
- [ ] You can state the approximate expansion ratio you observed.
- [ ] You can explain why this is less error-prone than hand-editing N files.

---

## Core

These introduce the plumbing — the part where most real bugs live.

### Task 4: Make regeneration one command

**Problem.** Wire your generator into a single, documented command: a
`Makefile` target `make gen`, a `go generate ./...` directive, or a Gradle
task. Anyone who clones the repo should regenerate with one command.

**Constraints.**
- The command must regenerate *all* generated files, not just one.
- Document it in a README line.

**Hints (try without first).**
- For Make, declare the generated file as a target with the schema as a
  prerequisite, so `make` reruns the generator only when the schema changed.
- Verify incrementality: run `make gen` twice; the second run should do
  nothing if the schema is unchanged.

**Self-check.**
- [ ] A fresh clone can regenerate with exactly one documented command.
- [ ] You can explain how Make's timestamp check gives incremental regen.

---

### Task 5: Build a CI drift check

**Problem.** Write a CI step (or a local script) that runs the generator and
then fails if the working tree changed. Prove it works by (a) committing
fresh generated code and watching it pass, then (b) changing the schema
*without* regenerating and watching it fail.

**Constraints.**
- The check must be a single non-interactive command suitable for CI.

**Hints (try without first).**
- `make gen && git diff --exit-code` is the core. A non-zero exit means
  stale generated code.
- Make the failure message tell the developer exactly what to run.

**Solution (sparse).**
```bash
set -euo pipefail
make gen
if ! git diff --exit-code; then
  echo "Generated code is stale. Run 'make gen' and commit." >&2
  exit 1
fi
```

**Self-check.**
- [ ] The check fails on stale code and passes on fresh code.
- [ ] You can explain why this makes "forgot to regenerate" unmergeable.

---

### Task 6: Induce and diagnose version skew

**Problem.** Install two different versions of your generator (e.g. two
`protoc-gen-go` releases). Generate with each. Diff the outputs.

**Constraints.**
- Use the *same* input for both — only the generator version differs.

**Hints (try without first).**
- Even a patch-version difference can churn output (reordered imports,
  changed comments). That churn is exactly what breaks a drift check on an
  unrelated PR.
- Now pin the version (Go `tools.go` + `go.mod`, a lockfile, or a container)
  so the output is stable.

**Self-check.**
- [ ] You can show a diff caused purely by generator version.
- [ ] You can describe how pinning the generator eliminates it.
- [ ] You can explain why this is worse at fleet scale than in one repo.

---

### Task 7: Schema evolution — the right way and the wrong way

**Problem.** Starting from a protobuf message, perform three changes and
observe wire behavior for each: (a) rename a field, (b) add a field with a
new number, (c) delete a field and *reuse* its number for a different type.

**Constraints.**
- For each change, serialize a message with the *old* schema and parse it
  with the *new* one (and vice versa). Inspect the result.

**Hints (try without first).**
- The rename is wire-compatible — the wire uses the *number*, not the name.
- Adding with a new number is safe; old readers ignore the unknown field.
- Reusing a deleted number for a different type *corrupts* old messages —
  this is the case `reserved` exists to prevent.

**Self-check.**
- [ ] You can state which change broke the wire and which did not.
- [ ] You can explain why `reserved` is mandatory on delete.
- [ ] You can confirm the *build* succeeded even for the corrupting change —
      i.e. the generator did not protect you.

---

### Task 8: Add a breaking-change gate

**Problem.** Add a tool that detects wire-breaking schema changes (e.g.
`buf breaking --against main` for protobuf, or an OpenAPI diff tool). Make
the corrupting change from Task 7 and watch the gate reject it.

**Constraints.**
- The gate must run against the previous committed schema version.

**Hints (try without first).**
- This catches what the generator never will: reused numbers, type changes.
- Confirm a *safe* change (additive field) passes the gate.

**Self-check.**
- [ ] The gate rejects the corrupting change and accepts the additive one.
- [ ] You can explain why generation alone cannot provide this guarantee.

---

## Advanced

These probe the design axis — codegen vs alternatives, and operational depth.

### Task 9: Codegen vs reflection, measured

**Problem.** Implement the same small task two ways: once with generated code
(e.g. generated serialization or a generated mapper) and once with reflection.
Benchmark both. Then attempt to build the reflective version under an
ahead-of-time / native-image target.

**Constraints.**
- Use the same data and the same workload for both.
- Record both runtime cost and what the AOT build required.

**Hints (try without first).**
- The generated version should have no per-call introspection cost.
- The reflective version under native image will likely need explicit
  reflection configuration — and fail at runtime if you miss an entry.
- This is the concrete reason Dagger-style generated DI beats reflective DI
  for native images.

**Self-check.**
- [ ] You can quote a runtime-cost difference with numbers.
- [ ] You can describe what the AOT/native build required for reflection.
- [ ] You can explain "closed-world assumption" from your own experience.

---

### Task 10: The `derive` / macro boundary case

**Problem.** In Rust, serialize a struct two ways: with serde
`#[derive(Serialize)]` (macro-codegen) and with `build.rs` + `prost` from a
`.proto` (file-codegen). For the derive version, use `cargo expand` to *see*
the generated impl.

**Constraints.**
- Note, for each, whether a file exists on disk you can open.

**Hints (try without first).**
- serde derive produces *ephemeral* output — no file; `cargo expand` reveals it.
- `prost` writes a real `.rs` into `OUT_DIR` you can open.
- Articulate *why* serde uses derive (language-internal, no external schema)
  but gRPC uses `build.rs` (cross-language `.proto` source of truth).

**Self-check.**
- [ ] You can show the expanded serde impl via `cargo expand`.
- [ ] You can open the prost-generated file on disk.
- [ ] You can place each on the macro↔codegen continuum and justify it.

---

### Task 11: Annotation processing and build cost

**Problem.** In a Java/Kotlin project, add an annotation-driven generator
(Lombok, MapStruct, or Dagger). Measure clean-build time before and after.
If Kotlin, compare KAPT vs KSP for the same processor where available.

**Constraints.**
- Measure clean builds, not incremental ones, for a fair comparison.

**Hints (try without first).**
- Annotation processing runs in rounds inside the compiler and adds time.
- KAPT generates Java stubs for every Kotlin file; KSP processes symbols
  directly and is typically faster.

**Self-check.**
- [ ] You can quote a build-time delta from adding the processor.
- [ ] You can explain why KSP is usually faster than KAPT.

---

### Task 12: Prove a generator is (non)deterministic

**Problem.** Run your generator twice on identical input in two clean
environments (or after `touch`-ing nothing) and diff the byte output. If your
generator embeds timestamps or nondeterministic ordering, expose it.

**Constraints.**
- Inputs must be byte-identical between the two runs.

**Hints (try without first).**
- A nondeterministic generator (timestamps, map-iteration order, absolute
  paths) makes drift checks and reproducible builds impossible.
- If yours is deterministic, explain *what* makes it so; if not, identify the
  source of nondeterminism.

**Self-check.**
- [ ] You can state whether your generator is deterministic and why it matters.
- [ ] You can connect determinism to the soundness of Task 5's drift check.

---

## Capstone

A larger, integrative build. Expect it to take several sessions.

### Task 13: A governed, multi-consumer schema with reproducible generation

**Problem.** Build a miniature of organizational codegen. Define one
`.proto` (or OpenAPI spec) as the source of truth. Generate code for **two
different languages/consumers** from it (e.g. a Go server and a Python or Java
client). Then add the full operational envelope:

1. A single `make gen` regenerating *both* consumers.
2. A CI drift check.
3. A breaking-change gate against the previous schema.
4. A pinned, reproducible generator toolchain (container or pinned plugins),
   demonstrated by byte-identical output across two environments.
5. A documented decision: commit the generated code or gitignore it — with a
   written justification tied to how your build runs the generator.

**Constraints.**
- The two consumers must agree on the wire — prove it by sending a serialized
  message from one and parsing it in the other.
- The breaking-change gate must reject a wire-incompatible change and accept
  an additive one.

**Hints (try without first).**
- Reuse Tasks 4, 5, 6, 8, 12 — this capstone is their composition.
- For the commit-vs-gitignore decision: if your build auto-runs the generator
  (and is reproducible), gitignore is defensible; if not (e.g. Go, where
  `go build` does not run generation), committing + a drift check is usually
  better. Write down *which* and *why*.
- For the cross-language proof, serialize bytes in consumer A, write them to a
  file, read and parse in consumer B, assert field equality.

**Self-check.**
- [ ] One command regenerates both consumers; CI catches staleness.
- [ ] The breaking-change gate behaves correctly on both a safe and an
      unsafe change.
- [ ] You demonstrated byte-identical generation across two environments.
- [ ] You can defend your commit-vs-gitignore choice from your build's actual
      behavior, not preference.
- [ ] You can present this as the small-scale version of a schema registry +
      pinned toolchain + versioned-SDK setup, and name what is missing to make
      it fleet-ready (registry, access control, published SDKs, provenance).

---

### Task 14: Migrate a shared schema without a flag day

**Problem.** Using the capstone's two consumers, remove a field from the
shared schema using **expand-migrate-contract**, never breaking either
consumer at any step.

**Constraints.**
- At no point may a consumer fail to build or fail to parse the other's
  messages.

**Hints (try without first).**
- *Expand*: if replacing the field, add the replacement additively with a new
  number; nothing breaks.
- *Migrate*: move each consumer off the old field independently.
- *Contract*: only after both consumers are confirmed off the old field,
  remove it and `reserve` its number.

**Self-check.**
- [ ] No step broke either consumer's build or wire parsing.
- [ ] You `reserved` the removed field number and can explain why.
- [ ] You can explain why this required no simultaneous switch (no flag day),
      and what telemetry would gate the contract step in a real fleet.
