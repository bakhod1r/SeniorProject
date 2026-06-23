# Internal Packages — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [When to Reach for `internal/`](#when-to-reach-for-internal)
3. [Multi-Level `internal/` Trees](#multi-level-internal-trees)
4. [Refactoring an Exposed Package into `internal/`](#refactoring-an-exposed-package-into-internal)
5. [Refactoring an `internal/` Package into the Public Surface](#refactoring-an-internal-package-into-the-public-surface)
6. [Module-Path vs Repo-Path: Where the Boundary Really Sits](#module-path-vs-repo-path-where-the-boundary-really-sits)
7. [`internal/` and Tests](#internal-and-tests)
8. [`internal/` and Examples](#internal-and-examples)
9. [`internal/` Plus `vendor/` Plus `replace`](#internal-plus-vendor-plus-replace)
10. [Common Patterns: `app/internal/service`, `cmd/internal/...`, and `pkg/`-vs-`internal/`](#common-patterns)
11. [Comparing to Other Languages' Visibility Mechanisms](#comparing-to-other-languages-visibility-mechanisms)
12. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At the junior level you learned the rule: a package under an `internal/` directory may be imported only from the subtree above that `internal/`. That rule is one sentence; the practical work is *deciding when, where, and how deeply to use it*.

Middle-level mastery is about deliberate choices. Should `auth` live in `internal/auth` or in `pkg/auth`? Should that `parse` helper be private to the whole module, or only to one feature? When you refactor an exposed package into `internal/`, what breaks for downstream consumers and what does not? When the rule trips you up, why?

After reading this you will:
- Decide which packages belong under `internal/` and which do not, with a written rule of thumb
- Use multi-level `internal/` to scope visibility to a feature or subsystem
- Refactor a public package into `internal/` (and back out) without surprises
- Predict how `internal/` interacts with `vendor/`, `replace`, and `go.work`
- Choose between the `pkg/` and `internal/` conventions
- Map the rule to the visibility mechanisms of Java, Rust, Python, and TypeScript

---

## When to Reach for `internal/`

`internal/` is cheap; the question is not "may I?" but "should I?"

### A short rule of thumb

Place a package under `internal/` if all three are true:

1. **No external module needs to import it today.** If even one third party would want a stable handle on it, it is part of your API.
2. **You expect to change it without coordinating with downstream callers.** If you commit to stability, you are paying the cost of a public API anyway — keeping it private buys nothing.
3. **The package is not the *purpose* of your module.** A library exists to be imported. Its top-level packages should be importable, not hidden behind `internal/`.

If you cannot answer "yes" to all three, leave the package public.

### Signs you should *not* use `internal/`

- The whole project is a library and the package is its `Render`/`Parse`/`Encode` entry point.
- You are about to publish an SDK and `internal/` would hide most of the SDK.
- Your team plans to release the package as a stand-alone module later. (Hint: do that *now* if you really mean it.)
- You want to encourage but not require external use. (`internal/` is binary; soft hints belong in documentation.)

### Signs you almost certainly should use `internal/`

- The package is application infrastructure: database wiring, queue plumbing, request middleware, config loading.
- The package is in transition — the API is unsettled and you do not want anyone depending on its current shape.
- The package contains code only your binaries and tests use.
- Two of your packages share a helper that is meaningless in any other context (`internal/cliutil`, `internal/protoutil`).

### A worked decision

```
project/
├── api/        ← yes, public — your contract
├── parser/     ← yes, public — the library entry point
├── server/     ← maybe — leave public if others might embed
├── cmd/api/    ← public, but trivial main.go
└── internal/
    ├── auth/      ← infra, no external user
    ├── repo/      ← internal, schema details leak otherwise
    └── metrics/   ← only your code reports its metrics
```

The split is not arbitrary; each placement has a rationale you should be able to defend in code review.

---

## Multi-Level `internal/` Trees

A single `internal/` at the module root is the common case. Multi-level `internal/` exists for one reason: you want to make a package private *to a sub-tree*, not to the whole module.

### A typical multi-level layout

```
project/
├── go.mod
├── cmd/
│   ├── api/main.go
│   └── worker/main.go
├── handler/
│   ├── handler.go
│   └── internal/
│       └── parse/        ← visible to handler/, hidden from worker/
│           └── parse.go
├── worker/
│   ├── worker.go
│   └── internal/
│       └── jobs/         ← visible to worker/, hidden from handler/
│           └── jobs.go
└── internal/
    ├── db/               ← module-wide private
    └── auth/
```

Two boundaries:

- `internal/db` and `internal/auth` are visible to every file under `project/`.
- `handler/internal/parse` is visible only under `handler/`. The worker cannot import it.
- `worker/internal/jobs` is visible only under `worker/`. The handler cannot import it.

This is how you encode "feature-private" code in addition to "module-private" code.

### When the extra boundary helps

- Two features share an unfortunate temptation to reach into each other's helpers. Multi-level `internal/` shuts the door.
- One feature has a richer internal API that you want to keep evolving without affecting the rest of the module.
- You suspect a feature might one day be extracted into its own module. Treating it as a small mono-repo with its own `internal/` is preparation for that move.

### When it hurts

- Beginners on the project get confused: "why can't I import `parse` here?"
- Each extra `internal/` adds a path element to every import. Long imports are tiring to read.
- Real coupling is sometimes legitimate. If `worker` *should* call `handler`'s `parse`, the boundary is wrong.

### Rule of thumb

Add a deeper `internal/` only after you have observed a real, repeated leak. Do not pre-emptively erect boundaries — they are easy to add later, harder to remove.

---

## Refactoring an Exposed Package into `internal/`

You released a library. A package you thought no one would care about turns out to leak implementation details. You want to hide it. The mechanics are simple; the consequences are not.

### Mechanics

```bash
# Before:
project/
├── go.mod                          ← module example.com/project
├── parser.go
└── helper/
    └── helper.go                   ← package helper

# After:
project/
├── go.mod
├── parser.go
└── internal/
    └── helper/
        └── helper.go               ← package helper, now private
```

Steps:

```bash
git mv helper internal/helper
goimports -w .   # or hand-update every "example.com/project/helper" to "...internal/helper"
go mod tidy
go build ./...
go test ./...
```

The package's name (`package helper`) does not change — only its import path does.

### Consequences for downstream consumers

If anyone outside `example.com/project` was importing `example.com/project/helper`, their next build breaks:

```
use of internal package example.com/project/internal/helper not allowed
```

That is *the entire point* — but it is also a breaking change in the SemVer sense. You owe consumers a major version bump:

- The library is at `v1.x.y`. The next release must be `v2.0.0`.
- The module path becomes `example.com/project/v2`.
- Release notes: "Removed: `helper` package (was unintentionally exposed). Equivalents are now internal."

If you skip the major bump, every downstream `go get -u` will fail noisily. Communicate the change.

### When *not* to make this move

- The package is widely depended on. A v2 migration causes more pain than the leak. Live with it; deprecate carefully; never delete.
- The package is the natural extension point for plugins or embedders. Restricting it kills the embedding story.
- You can solve the underlying coupling without restricting visibility — for example, by stabilising the interface and documenting which symbols are guaranteed.

### A safer half-step: deprecate first, hide later

You can mark the package deprecated for a release cycle, see who screams, and only then refactor:

```go
// Package helper provides text helpers.
//
// Deprecated: helper is being moved to an internal package; pin to v1.x if you depend on it.
package helper
```

A `Deprecated:` comment is picked up by `pkg.go.dev`, `gopls`, and `golangci-lint`. Consumers see the warning before they see the breakage.

---

## Refactoring an `internal/` Package into the Public Surface

The reverse motion is also common: an `internal/` package matures into something worth exposing.

### Mechanics

```bash
# Before:
project/
├── go.mod
└── internal/
    └── auth/
        └── auth.go

# After:
project/
├── go.mod
└── auth/
    └── auth.go
```

```bash
git mv internal/auth auth
goimports -w .
go mod tidy
go build ./...
go test ./...
```

### What you are committing to

Promoting a package to the public surface is a *promise*. You owe the rest of the world:

- **Stability.** Breaking changes need a major version bump.
- **Documentation.** A real package comment, examples on `pkg.go.dev`, a tutorial entry.
- **Tests as documentation.** Examples in `_test.go` doubling as runnable godoc.
- **Considered API surface.** Every exported name becomes part of the contract. If you are not ready to defend each one, do not export them yet.

### A safer half-step: re-export from the public package

Instead of promoting the *package*, promote a small slice of it. Keep the implementation in `internal/`, expose a stable façade in the public surface:

```go
// auth/auth.go
package auth

import "example.com/project/internal/auth"

// Login is the stable entry point.
func Login(user, pass string) error {
    return internal.Login(user, pass)
}
```

Now you have a tiny, intentional public API. The internals stay free to evolve. This is a common compromise.

---

## Module-Path vs Repo-Path: Where the Boundary Really Sits

The rule talks about *import paths*, not file paths. The two normally agree but can drift in subtle ways.

### The boundary is the parent of the `internal/` element in the *import path*

A module declares its path in `go.mod`:

```
module example.com/group/project
```

If `internal/x` lives at `<repo-root>/internal/x`, its import path is `example.com/group/project/internal/x`. The "parent of `internal/`" is `example.com/group/project/` — i.e., the module root.

### What if the module path differs from the repo layout?

```
my-repo/
├── go.mod                          ← module example.com/cool/lib
└── pkgsrc/
    ├── lib.go                      ← package lib
    └── internal/
        └── helper/
            └── helper.go
```

This module declares `example.com/cool/lib` but has files in `pkgsrc/`. There is no language reason for that — it is unusual. Now the import paths are:

- `example.com/cool/lib` (the package at `pkgsrc/lib.go`)
- `example.com/cool/lib/internal/helper` ?

This is a trap: the toolchain looks for the package by import path, *not* by directory. Such a layout typically does not work; you will get "cannot find package" errors. In practice, the directory layout under the module root mirrors the import path layout. Do not try to be clever.

### Sub-modules

If you have a nested `go.mod`, the inner module is its own world:

```
project/
├── go.mod                  ← module example.com/project
├── internal/
│   └── foo/
└── tools/
    └── go.mod              ← module example.com/project/tools
```

`example.com/project/tools` is a *different* module. It cannot import `example.com/project/internal/foo` from outside — even though they live in the same git repository. The `internal/` rule is about modules, not repositories.

This is one of the most important middle-level realisations: **`internal/` is module-scoped, not repo-scoped.** Two modules in the same monorepo are as foreign to each other, visibility-wise, as two unrelated GitHub projects.

---

## `internal/` and Tests

Tests are normal Go code. The `internal/` rule applies to them too, with one practical wrinkle.

### White-box tests

A `_test.go` file in the same package as the code it tests is in the same directory:

```
project/internal/auth/
├── auth.go              ← package auth
└── auth_test.go         ← package auth (white box)
```

`auth_test.go` is inside `internal/auth/`, which is inside the parent of `internal/`. It can use any unexported helper in `auth.go`. No drama.

### Black-box tests

A `_test.go` file using `package x_test` is technically a different package, but it lives in the same directory:

```
project/internal/auth/
├── auth.go              ← package auth
└── auth_blackbox_test.go ← package auth_test
```

The test imports `example.com/project/internal/auth`. The file is at `project/internal/auth/`, which is inside `project/` — the parent of `internal/`. Allowed.

### Tests in a sibling directory

You sometimes see test packages organised separately:

```
project/
├── internal/
│   └── auth/
│       └── auth.go
└── tests/
    └── auth_integration_test.go    ← imports internal/auth
```

`tests/` is inside `project/`, which is the parent of `internal/`. Allowed.

But:

```
project-tests/                  ← a *different* module, not a subdir of project
└── auth_integration_test.go    ← imports internal/auth
```

Now `project-tests/` is a different module. It is *not* inside the parent of `internal/`. Forbidden.

### Test fixtures and `testdata/`

`testdata/` is special-cased by the toolchain (it is excluded from package listings). Files in `testdata/` are not Go code that imports anything. The `internal/` rule is irrelevant to them.

---

## `internal/` and Examples

`pkg.go.dev` renders example functions found in `_test.go` files. Examples that import an `internal/` package only render if they live inside the parent of `internal/` — which is fine, because the test file is normally next to the code.

What you cannot do: write an example in `pkg.go.dev` documentation for an `internal/` package and expect outside users to copy it. They cannot run it; they cannot import the package. If you want users to copy an example, the function being illustrated must be public.

---

## `internal/` Plus `vendor/` Plus `replace`

These three features interact, and beginners trip on the interactions.

### `internal/` plus `vendor/`

`go mod vendor` copies every dependency into `vendor/`, including their `internal/` packages. The copied bytes look like ordinary Go code. They are still subject to the same rule:

```
vendor/
└── example.com/upstream/
    ├── pub.go              ← public, may be imported
    └── internal/
        └── helper/
            └── helper.go   ← still rejected if you import it
```

You can *read* the source. You cannot *import* it. The compiler enforces the original layout. This sometimes confuses people: "I can see the file right there!" Yes, but `internal/` is about the import path, not the visible filesystem.

### `internal/` plus `replace`

`replace` redirects an import path to a different source. It does not change the path itself:

```
replace example.com/upstream/internal/helper => ./local-helper
```

The path is still `example.com/upstream/internal/helper`. The rule still rejects importers outside the parent. The `replace` is honoured only after the rule has already vetted the import. In short: `replace` cannot be used to bypass `internal/`.

### `internal/` plus `go.work`

A workspace lets several modules sit next to each other. Each module keeps its own `internal/` boundaries. Two modules in the same workspace cannot reach into each other's `internal/`:

```
workspace/
├── go.work
├── modA/
│   ├── go.mod              ← module example.com/A
│   └── internal/x/
└── modB/
    └── go.mod              ← module example.com/B  (can NOT import A/internal/x)
```

The workspace shares build state and lets `go mod tidy` see all modules at once, but it does not merge them into one module. The `internal/` rule is still per-module.

---

## Common Patterns

### Pattern 1 — `app/internal/service`, `app/internal/repo`

A web application separates concerns into private packages:

```
app/
├── go.mod
├── cmd/
│   └── server/main.go
├── api/                       ← public DTOs (handcrafted or generated)
└── internal/
    ├── service/
    │   ├── user.go
    │   └── order.go
    ├── repo/
    │   ├── user_postgres.go
    │   └── order_postgres.go
    └── handler/
        ├── user.go
        └── order.go
```

`cmd/server/main.go` wires `handler` → `service` → `repo`, all from `internal/`. Nothing under `internal/` leaks. The only public surface is `api/` — typically just data shapes.

### Pattern 2 — `cmd/<tool>/internal/...`

Multiple binaries sharing helpers only meaningful to those binaries:

```
project/
├── go.mod
├── cmd/
│   ├── api/main.go
│   ├── worker/main.go
│   └── internal/
│       ├── flagutil/        ← argparse helpers shared by api & worker
│       └── log/             ← consistent logging setup
└── internal/
    └── domain/              ← module-wide internals
```

`cmd/internal/flagutil` is reachable from anything under `cmd/`. The library code under `internal/domain` cannot reach it (and shouldn't — argparse is binary-specific).

### Pattern 3 — `pkg/` for public, `internal/` for private (used by some teams)

Some teams adopt a pattern with a top-level `pkg/` directory:

```
project/
├── go.mod
├── pkg/                  ← public packages
│   ├── client/
│   └── types/
└── internal/             ← private packages
    ├── server/
    └── store/
```

This is *convention*, not a Go feature. The `pkg/` directory has no special meaning to the toolchain. It is just a way to make "this is the public surface" visually obvious. The Go community has mixed feelings — some style guides recommend `pkg/`, others ([Go's own standard library](https://github.com/golang/go/tree/master/src)) do not bother. Use what your team agrees on.

### Pattern 4 — A tiny re-export façade

Hide the implementation in `internal/` but expose a one-page public façade:

```
parser/
├── go.mod
├── parser.go             ← public: Parse, Encode, Tree
└── internal/
    ├── lexer/
    ├── ast/
    └── codegen/
```

`parser.go` contains a small set of exported functions and types, each delegating to the internal packages. This keeps your public API tiny while letting the internals breathe.

### Pattern 5 — Internal "shared types" for two siblings

Two siblings need to talk through a shared type that no outsider should ever see:

```
service/
├── go.mod
├── handler/
│   └── handler.go         ← imports internal/dto
├── worker/
│   └── worker.go          ← imports internal/dto
└── internal/
    └── dto/
        └── job.go         ← type Job — shared
```

`internal/dto` is private to the module. Both siblings can import it. No external module ever sees `Job` — because `Job` is an implementation detail, not a contract.

---

## Comparing to Other Languages' Visibility Mechanisms

Go's `internal/` is unusual. A quick comparison with other ecosystems:

| Language    | Mechanism                                         | Granularity                       | Enforcement   |
|-------------|---------------------------------------------------|-----------------------------------|---------------|
| Go          | `internal/` directory; lowercase identifiers       | Package (directory) and symbol    | Compiler      |
| Java        | `package`-private (default), `private`, `protected`, `public` | Class and member         | Compiler      |
| C#          | `internal` keyword, `private`, `public`            | Assembly and member               | Compiler      |
| Rust        | `pub`, `pub(crate)`, `pub(super)`                  | Crate, module, super-module       | Compiler      |
| Python      | Convention only: `_name`, `__name`                 | Symbol (loosely)                  | Convention only |
| TypeScript  | `private`/`protected`/`public`, `export`           | Class member, module export       | Compiler (erased at runtime) |

The two closest analogues are **Java's package-private** and **Rust's `pub(crate)`**. Both restrict visibility to a build unit. Go's `internal/` is closer to `pub(crate)` in practice: visible *within the module*, hidden from *outside*.

The biggest differences:

- **Granularity.** Java and Rust are per-symbol. Go is per-package — you cannot mark one function "internal" while exporting the rest.
- **Mechanism.** Go uses *directory layout* to encode a build-time rule. Java and Rust use *keywords*. C#'s `internal` is the closest to Go's `internal/` in *meaning* (assembly-private), but it is annotation-based.
- **Cultural status.** Go's `internal/` is a strong cultural signal — packages under it are clearly off-limits to outsiders, even though it is just a directory name. In Python, the underscore convention is far weaker; Python tooling does not enforce it.

The trade-off: Go's mechanism is coarser but cheaper to apply. There is no annotation churn. You get directory-level intuition that any developer can read at a glance.

---

## Pitfalls You Will Meet

### Pitfall 1 — `internal/` at the wrong depth, take 2

A common middle-level mistake is over-deepening `internal/`:

```
project/internal/foo/internal/bar/internal/baz/...
```

Each level narrows visibility. By the third nesting, you have a package visible to almost nobody. Either you genuinely have three levels of feature-isolation (rare), or you reflexively typed `internal/` more times than needed.

### Pitfall 2 — Renaming a module without rethinking the boundary

If you change `module example.com/old` to `module example.com/new`, every `internal/` boundary moves with the module path. Usually this is fine; occasionally a path you assumed was "outside" is now "inside" or vice-versa. Run `go build ./...` end-to-end after any module rename.

### Pitfall 3 — `go mod tidy` cannot warn you about over-protection

A package buried under `internal/` that *should* be public will not produce any tooling warning. The only signal is "users complain they can't import it." Audit `internal/` periodically: walk the tree, ask "is this still meant to be private?"

### Pitfall 4 — Documentation drift

You move `parser.Helper` into `internal/parser/helper`. A README, a blog post, or a comment somewhere still references the old import path. Search the whole repo for the old path before you ship.

### Pitfall 5 — Mistaking `internal/` for code modularity

`internal/` controls *who can import*. It does *not* enforce *which* packages depend on which. A spaghetti import graph entirely under `internal/` is still spaghetti. Treat `internal/` and good architecture as orthogonal disciplines.

### Pitfall 6 — Mixing `internal/` with very-public types

If `internal/foo` exports a type and a public package returns that type:

```go
package api

import "example.com/project/internal/foo"

func Get() *foo.Thing { ... }
```

Outsiders can call `Get` and receive a `*foo.Thing`. They cannot reference the type by name (they cannot import `foo`), but they can hold it, pass it around, and call its exported methods. This is sometimes intentional (return an opaque handle); sometimes a leak. Check whether you really want the type to be expressible in callers' source.

### Pitfall 7 — Confusing "internal" the symbol with `internal/` the directory

Naming a *function* `internal` is legal. Naming a *file* `internal.go` is legal. Neither activates the rule. Only a directory named exactly `internal` triggers visibility enforcement.

### Pitfall 8 — Forgetting that the rule helps *you* refactor

The biggest middle-level shift in mindset: stop thinking of `internal/` as something you do *to* outside callers. Think of it as something you do *for* yourself — it is the lever that lets you change a package's API without coordinating across the world. If you are afraid to change a package's signature, see if it can move under `internal/`.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Decide for any new package whether it belongs under `internal/` or in the public surface
- [ ] Use multi-level `internal/` to scope visibility to a feature
- [ ] Refactor a public package into `internal/` and absorb the major-version bump
- [ ] Refactor an `internal/` package into the public surface deliberately
- [ ] Explain why `internal/` does not interact with `vendor/`, `replace`, or `go.work`
- [ ] Write a black-box test for an internal package
- [ ] Compare `internal/` to `package`-private in Java and `pub(crate)` in Rust
- [ ] Identify and avoid over-nesting `internal/`
- [ ] Use `internal/` as a refactoring lever rather than as a punishment for outside callers

---

## Summary

`internal/` is a placement decision, not a code change. Use it as your default for new packages. Use multi-level `internal/` only when a feature genuinely needs its own private subtree. Refactoring in or out is a `git mv` plus an import-path update — but moving *out* of `internal/` is a public commitment, and moving *into* it after publication is a breaking change.

The rule interacts with `vendor/`, `replace`, and `go.work` exactly once: not at all. Each of those features is independent, and none can be used to bypass `internal/`. The boundary is per-module, not per-repository — sub-modules in a monorepo are as foreign to each other as separate GitHub projects.

Compared to other languages, Go's mechanism is coarse but cheap. You sacrifice per-symbol granularity for directory-level intuition any contributor can read. Used deliberately, `internal/` is one of the highest-leverage tools in Go's design — it lets you ship a small, intentional public API and a large, free-to-refactor private one.
