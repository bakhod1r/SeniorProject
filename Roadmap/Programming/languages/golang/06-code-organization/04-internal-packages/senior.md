# Internal Packages — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Drawing Module Boundaries](#drawing-module-boundaries)
3. [Public-API Surface as a Product Decision](#public-api-surface-as-a-product-decision)
4. [Designing the Import Graph Around `internal/`](#designing-the-import-graph-around-internal)
5. [Internal Packages in Mono-Repos](#internal-packages-in-mono-repos)
6. [Splitting and Merging: When `internal/` Becomes a Module](#splitting-and-merging-when-internal-becomes-a-module)
7. [`internal/` and the Stability Contract](#internal-and-the-stability-contract)
8. [Anti-Patterns](#anti-patterns)
9. [Senior-Level Checklist](#senior-level-checklist)
10. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with `internal/` is not "where do I put this package" but "what shape should our module's public surface take, and which packages enforce that shape?" The mechanical command — `git mv pkg internal/pkg` — is one keystroke. The decision behind it spans architecture, release engineering, downstream maintenance, and the organisation's external commitments.

This file is about *the design decisions* and the architectural patterns. The mechanical content is in [junior.md](junior.md) and [middle.md](middle.md). The toolchain implementation is in [professional.md](professional.md).

After reading this you will:
- Decide where module boundaries should sit, treating `internal/` as a tool that shapes them
- Reason about your public API as a product with a versioning cost
- Design import graphs that scale across many internal subtrees
- Coordinate `internal/` discipline across a multi-module mono-repo
- Recognise and refuse the common anti-patterns

---

## Drawing Module Boundaries

Before placing a package in `internal/`, ask the deeper question: *what is the module*? `internal/` only matters relative to a module — its scope is "the module," its enforcement only crosses a module boundary, and a single module sets the entire policy.

### The single-module default

Most Go projects are one module. Public packages live at the root; private packages live under `internal/`. This is the simplest and the most common shape.

```
project/                 ← module example.com/project
├── go.mod
├── api/                 ← public
├── parser/              ← public
└── internal/            ← private to the module
    └── ...
```

### When to split into multiple modules

A second module appears when:

- **You ship a binary and a library independently.** The library is published; the binary is internal. They need different release cadences.
- **You have an SDK alongside a server.** The SDK is a separate module so consumers do not accidentally pull in the server's dependencies.
- **You have plugins.** Plugin authors need to import a stable contract. The contract module must not pull in your full implementation.
- **Two pieces of code have *genuinely* different release timelines.** A version bump on one should not force a bump on the other.

### What a second module costs

- **Two `go.mod` files to keep in sync.** Each has its own `require` block and lockfile.
- **Two release tags.** A change touching both modules now needs two coordinated tags.
- **Two `internal/` boundaries.** You cannot share an `internal/` package across modules. Code that was once shared must be either duplicated, lifted into a third module, or made public.

The cost is high enough that most projects should remain a single module. The default is one.

### `internal/` as a stand-in for module separation

Sometimes you reach for a second module because you want a stronger boundary. `internal/` may be the cheaper answer:

- **You want to prevent outside imports.** `internal/` already does that.
- **You want to prevent a feature from depending on another feature's helpers.** Multi-level `internal/` does that.
- **You want a "stable contract" for a library.** Use `internal/` for the implementation; expose a small, deliberate public surface.

Reach for a second module only when `internal/` cannot express what you want.

### Boundaries are paid for, not free

Every boundary you add — module, package, `internal/` directory — costs intellectual overhead. A senior engineer adds boundaries deliberately, removes them ruthlessly when they are not earning their keep, and keeps the count down.

---

## Public-API Surface as a Product Decision

Your public-API surface is the set of packages outside `internal/`. This set is a product. It has users. It has a release cycle. It accumulates technical debt. Treat it that way.

### The smallest viable surface

Aim for the smallest surface that lets a user do what your module promises. Every additional public package or function:

- Is a new contract you must keep stable.
- Is a new place where breaking changes force a major version.
- Is a new line of documentation, an example, a test.
- Is a new attack surface for security review.

A library that exposes ten well-chosen functions and twenty internal packages is healthier than one that exposes thirty packages "in case someone needs them."

### The "closed-by-default" rule

When in doubt, do not export. Internal stays internal until you have a concrete user story for promoting it. Promoting later is cheap; un-promoting is a breaking change.

### Surface review at release time

Before tagging a release, do a surface audit:

```bash
go list ./... | grep -v '/internal/'
```

The list is your public contract. Read it. For each package, ask: *do I want to be supporting this in two years?* If the answer is no, decide what to do — deprecate, hide under `internal/`, simplify — before the release. After the release, you have made a promise.

### Documenting what is public

A `doc.go` at the module root makes the contract explicit:

```go
// Package project implements the example.com/project public API.
//
// The supported entry points are:
//
//   - example.com/project           top-level types and constants
//   - example.com/project/api       public DTOs
//   - example.com/project/parser    text parser
//
// Anything under example.com/project/internal/... is internal and
// may change without notice. Do not import it from outside this
// module; the toolchain will refuse.
//
// See [stability policy].
//
// [stability policy]: https://example.com/project/stability
package project
```

This costs nothing to write and saves hours of "is this stable?" discussions.

### Versioning your surface

A clear public surface enables a clear versioning policy:

- **Patch** (`v1.2.3` → `v1.2.4`) — bug fixes only. No new exported names. No removed exported names. No changed signatures.
- **Minor** (`v1.2.3` → `v1.3.0`) — new exported names allowed. No removed names. No changed signatures.
- **Major** (`v1.x.y` → `v2.0.0`) — anything goes. Breaking changes are negotiated with consumers.

Keeping internals under `internal/` is what makes patch and minor releases sustainable. The internals churn at every release. The public surface churns only at majors. Without `internal/`, every release becomes a major release in fact, even when you call it minor.

---

## Designing the Import Graph Around `internal/`

`internal/` is a tool for shaping the import graph. A senior engineer designs the import graph deliberately, with `internal/` as one of the levers.

### The "onion" layout

A common Go architecture organises packages from public-facing to deeply private:

```
project/
├── api/                       ← public DTOs (one direction: out)
├── cmd/                       ← entry points
└── internal/
    ├── handler/               ← thinnest layer; touches api/
    ├── service/               ← business logic; touches repo/
    ├── repo/                  ← persistence; touches db/
    └── db/                    ← lowest level
```

Imports flow inward. `handler` may import `service`; `service` may import `repo`; `repo` may import `db`. Reverse arrows are forbidden by convention. `internal/` keeps any of these from leaking outside the module; the conventional layering keeps them honest inside the module.

### Enforcing direction

`internal/` does not directly enforce direction (`db` is just as importable as `handler` from inside the module). Direction is a discipline:

- **Code review.** Imports flowing the wrong way are visible in PRs.
- **Tooling.** Lint rules in `go-arch-lint`, `golangci-lint`'s `depguard`, or custom static checks reject upward imports.
- **Multi-level `internal/`.** If `db` should never be imported by any feature directly, hide it: `internal/repo/internal/db`. Then only `repo` can import it; the rest of the module cannot.

The `internal/` rule is your low-effort lever. Lint rules cover what `internal/` cannot.

### Cycles are stopped by Go itself

Go forbids import cycles at the language level, regardless of `internal/`. If you have an `internal/a` and `internal/b` and they import each other, the compiler rejects it. `internal/` does not weaken this — it composes with it.

### When the graph gets ugly

A senior engineer notices when the import graph is becoming spaghetti and reaches for boundaries:

- One `internal/` package imports half the others. Probably it should be split or moved.
- An `internal/` package imports a public package. Probably the abstraction is inverted; the public package may need to be hidden too.
- Two siblings each import the other's helpers. Probably they should share a common `internal/` package.

`internal/` is not a fix for these — it is a *vocabulary* in which to express the fix.

### The dependency-rule view

In a "clean architecture" sense:

- The module's *core* (domain types, interfaces) lives in `internal/domain` or, if part of the public API, at the module root.
- The module's *adapters* (HTTP handlers, database drivers, queue clients) live in `internal/adapter/...` and depend on the core, never the reverse.
- The module's *entry points* (`cmd/...`) wire core and adapters together.

`internal/` keeps the adapters and the wiring out of the public surface. The core may or may not be public, depending on whether the module is a library or an application.

---

## Internal Packages in Mono-Repos

A mono-repo amplifies every choice you make about `internal/`. The discipline scales differently from a single-module project.

### One module versus many

A *single-module* mono-repo has one `go.mod` at the root. All packages share one `internal/` namespace. Visibility is uniform across the repo.

A *multi-module* mono-repo has several `go.mod` files. Each module has its own `internal/`. Visibility is per-module — sibling modules cannot see each other's `internal/` even though they sit in the same repository.

### Why multi-module mono-repos are common

- **Independent release cadences.** Frontend SDK ships at its own pace; backend ships separately.
- **Different consumers.** A public Go SDK, a private CLI, and a server may have nothing to share except the repository they live in.
- **Reproducible builds with workspaces.** `go.work` lets developers iterate locally as if it were one module while still producing per-module artefacts.

### The cost of sharing in a multi-module mono-repo

Two modules cannot share `internal/` packages. If both want a helper, you have three choices:

1. **Duplicate the code.** Acceptable for tiny helpers. Wasteful for non-trivial logic.
2. **Promote the helper to a public package** in one of the modules. Now it is part of that module's contract. Often unwanted.
3. **Extract the helper into its own module.** Now you have three modules instead of two; that helper has its own `go.mod`, `internal/`, and version.

Each is a real trade-off. None is "the right answer."

### A pragmatic mono-repo layout

```
monorepo/
├── go.work
├── server/
│   ├── go.mod                         ← module example.com/server
│   ├── cmd/...
│   └── internal/...
├── sdk/
│   ├── go.mod                         ← module example.com/sdk
│   └── ...
└── shared/                            ← intentional shared module
    ├── go.mod                         ← module example.com/shared
    └── ...                            ← thoughtfully *public* helpers
```

`shared` is its own module precisely so both `server` and `sdk` can import it. Anything `shared` exposes is a third public surface to maintain. Keep it small.

### The tooling consequence

When a mono-repo has many modules:

- `go.work` lets local builds resolve cross-module imports without published versions.
- `go list -m all` per module still tells the truth about that module's dependencies.
- CI must build each module independently — a failing module should not silently free-ride on workspace-mode builds.
- The `internal/` rule is your friend: it prevents accidental leaks even when developers can see all source in one tree.

---

## Splitting and Merging: When `internal/` Becomes a Module

`internal/` is a flexible boundary. Sometimes it should harden into a module boundary; sometimes a separate module should fold back into `internal/`.

### Promotion: `internal/X` → its own module

You decide that `internal/X` should be reusable by other modules. Steps:

1. Create a new module: `mkdir x && cd x && go mod init example.com/x`.
2. Move the source: `git mv internal/x x` (across modules — sometimes a copy with history rewrite is cleaner).
3. Update the importers. They now write `import "example.com/x"`, not `import "example.com/project/internal/x"`.
4. Update the parent's `go.mod` to require `example.com/x`.
5. Tag and publish.

The package is now public *and* a separate module. Both are commitments; ensure you mean both.

### Demotion: a separate module → `internal/`

You decide that an external module is so tightly coupled to this project that it should be folded in. Steps:

1. Move the source under `internal/`: `git mv ../x internal/x` (history may need to be merged).
2. Drop the external `require` from `go.mod`.
3. Update importers to use the new internal path.
4. Tag a new major version of the consumer module if it was previously consuming the module externally.

This is a breaking change for anyone *else* who used the previously-external module. Coordinate.

### When to promote

- Multiple modules need the package.
- The package's API is genuinely stable.
- You are willing to commit to its public maintenance.

### When to demote

- The "shared" module had only one consumer.
- The API was unstable and forced repeated coordinated releases.
- You realised the package is *implementation*, not *contract*.

Both are real moves teams make as their understanding matures. The fact that `internal/` is a directory, not a keyword, makes both moves cheap mechanically. The cost is in the social and release-engineering coordination.

---

## `internal/` and the Stability Contract

Senior engineers think about `internal/` in terms of contracts.

### What `internal/` promises you

- Anything under `internal/` is a free-form workspace. You may rename, delete, or reshape packages without warning.
- No outside module can hold a stable handle on it.
- Tests, linters, and IDEs treat it as part of the same closed world your team owns.

### What `internal/` does not promise you

- It is not a security boundary. A determined adversary forks the repo, removes the `internal/`, and is done.
- It is not a code-quality boundary. A spaghetti `internal/` is still spaghetti.
- It is not a runtime mechanism. Symbols inside `internal/` are visible at runtime in stack traces, profiles, and panics — they are just unimportable.

### Treat `internal/` as your refactor budget

The most powerful framing for a senior engineer: *`internal/` is your refactor budget.* The more code you place there, the more you can reshape later without major-version pain. A library that hides 80% of its code in `internal/` can iterate freely; a library that exposes 80% of its code is locked in.

This reframes "should this be `internal/`?" from a permission question ("should outsiders see it?") to a flexibility question ("do I want to refactor this freely?"). The default answer to the second question is *yes*.

### Consumers should respect the convention even when they could bypass it

A consumer who forks your library and removes `internal/` to access a helper is making a unilateral promise to themselves: "I will maintain this fork forever." That is rarely the right call, but it happens. As a library author, do not over-engineer to prevent it; as a library consumer, do not do it.

---

## Anti-Patterns

### `internal/` everywhere

A library that ships *only* `internal/` packages and one public façade does the right thing in spirit but the wrong thing in scale. If 99% of the code is internal and the public surface is one function, the library is hiding something pathological — usually a single God function that orchestrates the hidden world. Re-design the public surface; the internals follow.

### `internal/` nowhere

A library with no `internal/` directory is exposing everything. Every helper, every utility, every implementation detail is part of the API. The first refactor that hides something is now a breaking change. Walk the public list at release time; ask which packages are accidentally public.

### `pkg/` and `internal/` doing the same job

Some teams adopt both `pkg/` and `internal/`, then forget which is which. A package in `pkg/` is "public-ish"; a package in `internal/` is "private." If your team cannot keep the convention straight, drop one. The Go standard library uses neither convention by name (its public packages are at the root); some teams use both productively. Pick one and stick with it.

### Renaming a directory to bypass a refactor

A teammate finds an `internal/` package they want to import from another module, and "fixes" it by renaming the directory. This works mechanically but is wrong: the boundary existed for a reason. Have the conversation about *whether* to expose the package. Do not bypass.

### Treating `internal/` as a TODO list

"I will hide this later." Two years later, the package is a load-bearing dependency for three external consumers, and you cannot hide it without a major version bump. Hide aggressively early; promote deliberately later.

### Multi-level `internal/` as a punishment

When two features fight over a helper, multi-level `internal/` is sometimes used to "force them to talk through the right channel." This usually fails — the developers find a way around it, often by promoting the helper to public, which is the opposite of what you wanted. Solve the social problem (which feature should own the helper?) before adding the boundary.

### Cross-module `internal/` plumbing

Two of your own modules in the same mono-repo, one trying to reach into the other's `internal/`. The toolchain refuses, and someone proposes making the inner module's helper public to "make life easier." The right answer is to extract the helper into a third, intentional shared module — or to admit that the two modules should be one.

### `internal/` as the only boundary

`internal/` is one of several discipline mechanisms: code review, lint rules, architectural decision records, tests of imports, package documentation. A team that relies on `internal/` alone gets a flat, two-level architecture. Combine with the others.

---

## Senior-Level Checklist

You are operating at senior level on `internal/` when you can:

- [ ] State *why* a given package is or is not under `internal/`, in terms of stability and refactor cost
- [ ] Audit a module's public surface at release time and propose hidings or promotions
- [ ] Decide when a sub-tree should become its own module versus stay as `internal/`
- [ ] Lay out a multi-module mono-repo with deliberate `internal/` boundaries per module
- [ ] Use multi-level `internal/` to enforce architectural direction without over-engineering
- [ ] Recognise the seven anti-patterns above and propose corrections
- [ ] Document the `internal/` convention in your project's `doc.go` or `CONTRIBUTING.md`
- [ ] Explain to a junior how `internal/` interacts with `vendor/`, `replace`, and `go.work` (it does not)
- [ ] Defend a major version bump caused by hiding a previously-public package
- [ ] Use `internal/` as a refactoring lever rather than as a wall

---

## Summary

At senior level, `internal/` is no longer a question of "where does this file go?" It is a vocabulary for shaping the public-API surface, designing the import graph, and preserving refactor flexibility. Used deliberately, it is the cheapest discipline mechanism Go offers — a directory rename produces a compiler-enforced boundary that holds across an entire module.

The key shift in thinking: `internal/` is a *refactor budget*. The more code that lives there, the more freely you can change it. A small, intentional public surface plus a fat, free-to-reshape `internal/` is the shape of a healthy Go module. The opposite — a sprawling public surface, no `internal/` — is the shape of a module that has accidentally promised everything.

Mono-repos and multi-module repositories complicate the picture but do not change the principle. Each module owns its own `internal/`. Sharing across modules is paid for in coordination cost; cheap inside a module, expensive across modules. Make those costs explicit when you choose your module boundaries.

Above all: do not fight the rule, do not bypass it, do not over-engineer around it. Respect the convention, document where the boundaries lie, and let the toolchain hold the line.
