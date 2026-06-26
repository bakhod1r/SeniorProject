# Build-Time Code Generation — Junior Level

> **Topic:** [Build-Time Code Generation](README.md)
> **Focus:** Why a tool writes some of your source code *before* the compiler runs — and why the compiler then treats that code like any other file you typed by hand.

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

> Focus: **What does it mean to "generate code"?** And **why would you let a tool write source files for you instead of writing them yourself?**

**Build-time code generation** is the practice of running a program — a *code generator* — that produces source code (or other build artifacts) **before or during your build**, so that by the time the compiler runs, the generated files look like ordinary, hand-written source. The compiler does not know or care that a tool wrote them. It type-checks them, optimizes them, and links them exactly as it would any file you typed yourself.

Here is the whole idea in one sentence: **you describe something once, in a compact form (a schema, an annotation, a small spec), and a generator expands that description into the verbose, repetitive code you would otherwise type by hand.** The compact form is the *source of truth*; the generated code is *derived* from it.

A first concrete example. You have a network message — a `User` with an `id`, a `name`, and an `email`. You write a small `.proto` file describing those three fields. You run a tool called `protoc`. Out comes a `user.pb.go` (or `User.java`, or `user_pb2.py`) file containing a fully-typed `User` class with getters, setters, serialization, and parsing — hundreds of lines you never typed. You import that generated file and use `User` like a normal type, with full autocomplete in your IDE.

> 🎓 **Why this matters for a junior:** A huge amount of "boilerplate" — serialization code, getters and setters, API clients, database query wrappers, mock objects — does not need to be written by a human. It is mechanical. Generating it instead of typing it means fewer bugs, less tedium, and code that stays in sync with its definition automatically. Recognizing *"this looks like it could be generated"* is a senior instinct, and it starts here.

This page covers: what a code generator actually does, the difference between **generated** and **hand-written** code, the **single source of truth** idea, where generated files live in a project, and the most common generators you will meet early in your career (`protoc`, `go generate`, Java annotation processors like Lombok). The next level (`middle.md`) gets into the three *kinds* of generation and build-system wiring; `senior.md` and `professional.md` cover the engineering trade-offs, schema evolution, and generation at scale.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to compile and run a program in at least one language (Go, Java, Python, Rust, or C/C++).
- **Required:** What a *source file* is, and the rough idea that a compiler turns source files into an executable or library.
- **Required:** Basic familiarity with importing/using a type or function from another file.
- **Helpful but not required:** Having used a build tool — `go build`, `mvn`/`gradle`, `cargo`, `make`, or `npm`.
- **Helpful but not required:** Some exposure to JSON or another structured data format (you will meet schemas).

You do **not** need to know:

- How compilers parse and type-check (that is the compilers topic).
- The difference between code generation, macros, and reflection (covered in `middle.md` and `senior.md`).
- Any specific generator's full command-line surface — we keep examples small.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Code generation (codegen)** | Producing source code (or another artifact) automatically from a more compact input, instead of writing it by hand. |
| **Code generator** | The tool/program that does the generating. Examples: `protoc`, `stringer`, Lombok, `bindgen`, `sqlc`. |
| **Build time** | The moment your project is compiled — *before* the program runs. Generation that happens here is "build-time," as opposed to runtime. |
| **Generated code** | The source files a generator produces. Often named with a marker like `.pb.go`, `*_gen.go`, or placed under `target/generated-sources/`. |
| **Hand-written code** | The source files a human typed. The generator's *input* and the code that *uses* the generated output are usually hand-written. |
| **Source of truth** | The single, canonical place a fact is defined. In codegen, the schema/spec/annotation is the source of truth; generated code is derived from it. |
| **Schema** | A formal description of a data shape or interface — e.g. a `.proto` file, an OpenAPI spec, a SQL table definition. Often the input to a generator. |
| **Boilerplate** | Repetitive, mechanical code that follows a fixed pattern (getters, serialization, mappers). The classic thing worth generating. |
| **Regeneration** | Running the generator again after the input changes, so the generated code matches the new input. |
| **Stale generated code** | Generated files that no longer match their input because someone changed the input but forgot to regenerate. A common, confusing bug. |
| **Committed vs generated-on-build** | Two policies: either check generated files into Git, or `.gitignore` them and regenerate during every build. |
| **`go generate`** | A Go convention: a special comment marks a file, and running `go generate` executes the command in that comment to produce code. |
| **Annotation processor (APT)** | A Java/Kotlin mechanism where the compiler runs plugins that read annotations and emit new source files during compilation. Lombok, Dagger, and MapStruct use it. |
| **protobuf / protoc** | Protocol Buffers: a schema language (`.proto`) plus the `protoc` compiler that generates typed message classes and gRPC client/server stubs. |
| **Reflection** | Inspecting types and calling methods *at runtime* by name. An *alternative* to codegen for achieving similar goals — slower, less type-safe. |

---

## Core Concepts

### 1. The Pipeline: Input → Generator → Generated Code → Compiler

Every code-generation setup has the same four-stage shape:

```text
   ┌────────────┐     ┌────────────┐     ┌──────────────────┐     ┌──────────┐
   │  INPUT     │ ──▶ │ GENERATOR  │ ──▶ │  GENERATED CODE  │ ──▶ │ COMPILER │
   │ schema /   │     │  protoc /  │     │  user.pb.go /    │     │ go build │
   │ annotation │     │  Lombok /  │     │  User.java       │     │ javac    │
   └────────────┘     └────────────┘     └──────────────────┘     └──────────┘
```

The **input** is something compact and human-meaningful: "a User has an id, a name, and an email." The **generator** expands it. The **generated code** is verbose but mechanical. The **compiler** then sees ordinary source. The critical point: *the compiler never sees the input.* By the time `go build` or `javac` runs, the generated `.go`/`.java` files already exist and look hand-written.

### 2. Why Generate Instead of Type It Yourself?

Suppose you have 40 message types, each with 8 fields. Writing serialization, parsing, getters, and equality by hand for each is roughly 40 × ~150 = 6,000 lines of mind-numbing, error-prone code. Worse: when you add a field to one message, you must remember to update its serializer, its parser, its equality, its `toString`. Miss one, and you get a subtle bug.

With code generation, you change the schema in **one line** and regenerate. All 150 lines for that message update consistently. The mechanical work — the part humans are bad at and computers are perfect at — is done by the machine.

### 3. The Single Source of Truth

This is the most important idea on the page. In a codegen setup, one artifact is **canonical** and everything else is **derived** from it.

```text
       SOURCE OF TRUTH                 DERIVED (generated)
   ┌──────────────────────┐
   │  user.proto          │ ──────▶   user.pb.go       (Go server)
   │  (the schema)        │ ──────▶   User.java        (Java client)
   │                      │ ──────▶   user_pb2.py      (Python script)
   └──────────────────────┘
```

You **never edit the derived files by hand.** If the generated `User` is wrong, you fix the schema and regenerate — not the `.pb.go`. Editing generated code directly is the cardinal sin of codegen: your edit gets wiped out the next time someone regenerates, and now your schema and your code disagree.

### 4. Generated Code Is Real Code

A common confusion: people imagine generated code is some magic that happens at runtime. It is not. The generated `User.java` is a real file on disk. You can open it, read it, step through it in a debugger, and set breakpoints in it. Your IDE autocompletes its methods because it is a normal class. This is a big advantage over **reflection**, where the equivalent behavior happens invisibly at runtime and the IDE cannot help you.

### 5. Where Generated Files Live

There are conventions so you can tell generated files from hand-written ones at a glance:

| Language / tool | Typical generated location / name |
|------|------|
| Go (protobuf) | `user.pb.go` next to the package |
| Go (`stringer`) | `color_string.go` (the `_string` suffix) |
| Java (Maven/Gradle) | `target/generated-sources/` or `build/generated/` |
| Rust (`build.rs`) | `$OUT_DIR/` (a build-time temp dir), included via `include!` |
| OpenAPI clients | often `gen/` or `generated/` directory |

The naming and placement is a signal: *"do not hand-edit; I am produced by a tool."* Many generators also write a header comment like `// Code generated by protoc. DO NOT EDIT.`

### 6. Three Ways to Get the Same Result

You will hear that codegen is one of **three** ways to avoid writing boilerplate:

| Approach | When the work happens | Type-safe? | IDE autocomplete? | Runtime cost |
|------|------|------|------|------|
| **Code generation** | Build time | Yes (it is real code) | Yes | None |
| **Reflection** | Runtime | Often no | No | Yes (runtime introspection) |
| **Macros** | Compile time (inside the compiler) | Yes | Partial | None |

Junior takeaway: **codegen trades a little build complexity for zero runtime cost, full type-checking, and IDE support.** That trade is often worth it. The deeper comparison is in `senior.md`.

### 7. Committed vs Regenerated-On-Build

Two policies for the generated files themselves:

- **Commit them to Git.** Anyone who clones the repo can build immediately, no generator needed. The downside: pull requests show large, noisy diffs in generated files, and you must regenerate-and-commit whenever the schema changes.
- **`.gitignore` them and regenerate during the build.** The repo stays clean. The downside: every developer (and CI) must have the generator installed, at the right version, and the build must run it.

Both are legitimate. Which one a team picks is a real engineering decision covered in `senior.md`.

---

## Real-World Analogies

**The IKEA flat-pack.** The instruction booklet (input/schema) is small. The finished bookshelf (generated code) is large and assembled. You follow the booklet *once* to build it; you do not redesign the booklet for each shelf board. If you want a different shelf, you change the booklet, not the assembled wood.

**The mail-merge letter.** You write *one* template ("Dear {name}, your balance is {amount}") and a list of 10,000 customers. The mail-merge tool (generator) produces 10,000 personalized letters (generated output). Nobody types 10,000 letters by hand, and nobody edits an individual printed letter — they fix the template and re-run.

**The architect's blueprint.** The blueprint is the source of truth. The building is derived from it. You do not "edit the building" by knocking down a wall and then forget to update the blueprint — that is exactly the *stale generated code* problem, where reality and the source of truth diverge.

**The recipe and the dish.** The recipe (schema) is short and authoritative. The cooked dish (generated code) is the result. Change the recipe, re-cook. You would not scrape salt off a finished dish to "fix" it; you would fix the recipe.

---

## Mental Models

**Model 1 — "Type it once, expand it everywhere."** The whole value of codegen is the *expansion ratio*: a few lines of input become many lines of correct, consistent output. The more boilerplate the output, the bigger the win.

**Model 2 — "The schema is upstream; code is downstream."** Picture a river. The schema sits at the source. Generated code flows downstream from it. Water flows one way: edits go upstream (to the schema), never downstream (into generated files). If you try to push water uphill by editing generated code, the next regeneration washes it away.

**Model 3 — "By compile time, it is just code."** Forget that a tool was involved. Once the files exist on disk, the compiler, the debugger, and the IDE treat them as ordinary source. This is why generated code is debuggable and autocompletes — it is genuinely there.

**Model 4 — "Generation is a build step, not a runtime feature."** Codegen happens *before* your program runs. There is no generator in production; only the compiled output of the generated code runs. Contrast with reflection, which carries its machinery into runtime.

---

## Code Examples

### Example 1: Go — `stringer` generates `String()` methods

Without generation, giving an enum a human-readable name means a hand-written, easy-to-forget switch:

```go
// Hand-written: must be kept in sync with the constants by hand.
type Color int

const (
    Red Color = iota
    Green
    Blue
)

func (c Color) String() string {
    switch c {
    case Red:
        return "Red"
    case Green:
        return "Green"
    case Blue:
        return "Blue"
    }
    return "Color(?)"
}
```

Add a fourth color and forget to update the switch, and you get `Color(?)`. With `stringer`, you declare the intent with a comment and let the tool write the method:

```go
//go:generate stringer -type=Color
type Color int

const (
    Red Color = iota
    Green
    Blue
)
```

Run `go generate ./...`. The tool produces `color_string.go`:

```go
// Code generated by "stringer -type=Color"; DO NOT EDIT.

package main

import "strconv"

func (i Color) String() string {
    switch {
    case i >= 0 && i <= 2:
        return [...]string{"Red", "Green", "Blue"}[i]
    default:
        return "Color(" + strconv.Itoa(int(i)) + ")"
    }
}
```

Add `Yellow`, run `go generate` again, and the file updates itself. **You never edit `color_string.go`.**

### Example 2: Protobuf — schema generates a typed message

The input, `user.proto`:

```proto
syntax = "proto3";
package example;

message User {
  uint64 id = 1;
  string name = 2;
  string email = 3;
}
```

Run `protoc --go_out=. user.proto`. The generator emits `user.pb.go` containing a full `User` struct with getters, serialization, and parsing — hundreds of lines you did not write. In your hand-written code you simply use it:

```go
u := &example.User{Id: 7, Name: "Ada", Email: "ada@example.com"}
data, _ := proto.Marshal(u)   // serialize — code generated for you
var u2 example.User
_ = proto.Unmarshal(data, &u2) // parse — code generated for you
```

Add a `bool active = 4;` field to the `.proto`, regenerate, and `User` gains `GetActive()` automatically.

### Example 3: Java — Lombok generates getters/setters/constructors

Without Lombok, a simple data class is dozens of lines of getters, setters, `equals`, `hashCode`, and `toString`. With Lombok's annotation processor:

```java
import lombok.Data;

@Data
public class User {
    private long id;
    private String name;
    private String email;
}
```

`@Data` is read by Lombok's **annotation processor** at compile time, which generates `getId()`, `setId()`, `getName()`, ..., `equals()`, `hashCode()`, and `toString()` into the compiled class. Your source stays three fields; the compiled `.class` has all the boilerplate.

### Example 4: Python — protobuf generates a message module

```bash
protoc --python_out=. user.proto
```

produces `user_pb2.py`. You use it:

```python
import user_pb2

u = user_pb2.User(id=7, name="Ada", email="ada@example.com")
data = u.SerializeToString()      # generated serialization
u2 = user_pb2.User()
u2.ParseFromString(data)          # generated parsing
print(u2.name)                    # "Ada"
```

### Example 5: The cardinal sin — editing generated code

```go
// color_string.go — generated.
// Code generated by "stringer -type=Color"; DO NOT EDIT.
...
return [...]string{"Red", "Green", "Bleu"}[i]  // <-- someone "fixed" a typo here
```

This "fix" survives until the next `go generate`, which **overwrites the whole file** from the (still-misspelled) constant. The right fix is upstream: rename the constant, or correct whatever the generator reads. *Never edit downstream.*

---

## Pros & Cons

### Pros

- **No runtime cost.** The work is done before the program runs; production sees only ordinary compiled code.
- **Full static type-checking.** Generated code is real code, so the compiler catches mistakes — unlike reflection, where errors surface at runtime.
- **IDE autocomplete and "go to definition."** Because the generated file exists, your editor understands it.
- **Debuggable.** You can step into generated code and set breakpoints; it is just source.
- **Consistency.** Change the schema once; every derived piece updates uniformly. No "I forgot to update the serializer."
- **Less boilerplate to read in your own files.** Three-field `@Data` class instead of 80 lines.

### Cons

- **Build complexity.** You now need the generator installed at the right version, wired into the build.
- **Generated code is verbose and ugly.** Reading it can be unpleasant; debugging *through* it adds a layer.
- **Regeneration discipline.** Forget to regenerate after changing the input and you get **stale generated code** — confusing, silent bugs.
- **Diff noise.** If generated files are committed, schema changes produce large, distracting diffs in pull requests.
- **Generator version skew.** Two developers with different generator versions can produce different output, causing spurious diffs or build differences.
- **Learning curve.** Newcomers must learn "where does this `User` class actually come from?"

---

## Use Cases

- **Serialization / wire formats.** Protobuf, Thrift, FlatBuffers, Cap'n Proto — schema in, typed messages + (de)serialization out.
- **RPC stubs.** gRPC generates client and server interfaces from a `.proto` `service` definition.
- **API clients/servers.** An OpenAPI/Swagger spec generates typed HTTP clients and server scaffolding in many languages.
- **Enum stringers / reflection-free helpers.** Go's `stringer`, generated `MarshalJSON`, etc.
- **Boilerplate data classes.** Lombok, Java records-by-tool, AutoValue.
- **Mocks for testing.** `mockgen` (Go), Mockito-style generated mocks — fake implementations of interfaces for tests.
- **Type-safe database access.** `sqlc` and jOOQ generate typed Go/Java code from your SQL/schema, so a column rename becomes a compile error.

---

## Coding Patterns

**Pattern: Keep the input next to the output.** Put `user.proto` and the generated `user.pb.go` in the same package/folder so the relationship is obvious.

**Pattern: One generate command, checked in.** Use a single, documented command (a `Makefile` target, a `go:generate` directive) so anyone can regenerate with `make gen` or `go generate ./...`. Do not rely on people remembering ad-hoc commands.

**Pattern: Mark generated files loudly.** Keep the `DO NOT EDIT` header. Many tools and code-review systems recognize it and collapse the diff.

**Pattern: Treat the schema as the code review.** Review changes to the `.proto`/spec carefully; the generated diff is mechanical and follows from it.

**Pattern: Separate generated and hand-written into different files.** Never mix your own logic into a generated file. Put your methods on the generated type in a *separate, hand-written* file (most languages allow adding methods/extensions in another file).

---

## Best Practices

1. **Never hand-edit generated files.** Fix the input and regenerate. Keep the `DO NOT EDIT` header to enforce this socially.
2. **Make regeneration one command.** `make gen`, `go generate ./...`, or a Gradle task. Document it in the README.
3. **Pin the generator version.** Record the exact `protoc`/plugin version (in `tools.go`, a lockfile, or a container) so everyone generates identical output.
4. **Decide and document the commit policy.** Either commit generated code or `.gitignore` it — pick one explicitly, and make sure CI matches.
5. **Add your own code in separate files.** Put hand-written helpers in `user_extra.go`, not in `user.pb.go`.
6. **Regenerate in CI and fail on drift.** A CI check that runs the generator and fails if the working tree changes catches "forgot to regenerate" before merge. (More in `middle.md`.)
7. **Keep the schema readable.** It is the source of truth and the thing humans review; comment it well.

---

## Edge Cases & Pitfalls

**Stale generated code.** You changed `user.proto` but forgot to run the generator. The build still uses the old `user.pb.go`. Symptoms: a new field "doesn't exist," or behavior lags the schema. Cure: regenerate; better, a CI drift check.

**Editing the wrong file.** You "fixed" a bug in the generated file; the next regeneration silently erased your fix. Always fix upstream.

**Missing or wrong-version generator.** A teammate clones the repo, runs the build, and it fails because they do not have `protoc` (or have a different version producing different output). Pin versions; consider committing generated code to sidestep this.

**Confusing generated and hand-written code.** A newcomer searches for where `User` is defined and lands in a 600-line generated file, baffled. Conventions (`.pb.go`, `DO NOT EDIT`, a `generated/` folder) make the boundary obvious.

**Diff noise drowning the real change.** A one-line schema change produces a 400-line generated diff. Reviewers miss the actual change. Mitigate by reviewing the schema, not the generated output, and configuring the review tool to collapse generated files.

**Assuming generation is magic at runtime.** It is not. If you cannot find the generated file on disk, your build is not running the generator — that is the bug, not "magic that didn't happen."

---

## Cheat Sheet

| Question | Quick answer |
|------|------|
| What is code generation? | A tool writes source code from a compact input before the compiler runs. |
| When does it happen? | At **build time**, before the program runs. |
| What is the input usually? | A schema, spec, or annotation — the *source of truth*. |
| Can I edit generated files? | **No.** Fix the input and regenerate. |
| How do I spot generated files? | Names like `*.pb.go`, `*_string.go`, a `DO NOT EDIT` header, a `generated/` folder. |
| Why not just use reflection? | Codegen is type-checked, IDE-friendly, debuggable, and has zero runtime cost. |
| Commit generated code or not? | Either is valid — pick one and make CI match. |
| Most common junior tools? | `protoc` (protobuf/gRPC), `go generate` + `stringer`/`mockgen`, Lombok (Java). |

---

## Summary

Build-time code generation runs a tool that turns a compact, canonical **input** (a schema, spec, or annotation) into verbose but mechanical **source code**, *before* the compiler runs — so the compiler treats the result like any hand-written file. The input is the **single source of truth**; generated code is **derived** and must never be hand-edited. The payoff is real: zero runtime cost, full type-checking, IDE autocomplete, debuggability, and automatic consistency when the schema changes. The cost is build complexity, verbose output, diff noise, and the discipline of regenerating when the input changes. You have already met the common tools — `protoc`, `go generate` with `stringer`, and Lombok — and you now know the cardinal rule: *fix the schema, not the generated code.*

---

## Further Reading

- The Protocol Buffers documentation — the canonical schema-driven generator.
- The Go `go generate` design document and the `stringer` tool source.
- The Lombok project documentation (Java annotation-driven generation).
- "The Pragmatic Programmer" — its discussion of code generators and the DRY principle.
- `middle.md` in this folder — the three *kinds* of generation and build-system wiring.
