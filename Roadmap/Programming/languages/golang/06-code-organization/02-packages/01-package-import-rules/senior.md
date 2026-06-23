# Package Import Rules — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Imports as a Public API Boundary](#imports-as-a-public-api-boundary)
3. [Designing Package Boundaries to Avoid Cyclic Imports](#designing-package-boundaries-to-avoid-cyclic-imports)
4. [Internal Packages as a Modularization Tool](#internal-packages-as-a-modularization-tool)
5. [Layering: How Imports Reflect Architecture](#layering-how-imports-reflect-architecture)
6. [The Cost of Wide Imports (Compile Time, Blast Radius)](#the-cost-of-wide-imports-compile-time-blast-radius)
7. [Aliasing Discipline at Scale](#aliasing-discipline-at-scale)
8. [Blank Imports as a Side-Effect Contract](#blank-imports-as-a-side-effect-contract)
9. [Dot Imports: When They Are Acceptable](#dot-imports-when-they-are-acceptable)
10. [Init Order as Architectural Risk](#init-order-as-architectural-risk)
11. [Imports in Generated Code](#imports-in-generated-code)
12. [Imports and `go vet`/`staticcheck`/Lint Rules](#imports-and-go-vetstaticchecklint-rules)
13. [Designing for Future Sub-Module Carving](#designing-for-future-sub-module-carving)
14. [Anti-Patterns](#anti-patterns)
15. [Senior Checklist](#senior-checklist)
16. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with `import` is not "how do I add a line at the top of a file" but "what does the *set* of imports in my package say about my architecture." Imports are the most visible, most static, and most consequential decision in a Go codebase: they determine compile time, deploy size, blast radius of breaking changes, and whether a future engineer can lift a sub-tree out into its own module.

This file is about *the design implications* of import choices. The mechanical rules — what an import path is, how to add or remove one — are in [junior.md](junior.md) and [middle.md](middle.md).

After reading this you will:
- Understand imports as part of your package's public contract
- Refactor cyclic imports systematically rather than by trial and error
- Use `internal/` as a deliberate architectural boundary
- Reason about layering (domain / application / infrastructure) in terms of import direction
- Audit and govern transitive import cost across a codebase
- Plan for sub-module carving by keeping imports flowing in one direction

---

## Imports as a Public API Boundary

In Go, the symbols a package exports (capitalised identifiers) are its *direct* public API. The set of import paths it consumes is its *indirect* public API. Consumers see the second through dependency closures: when they import your package, every transitive import of yours becomes their problem too.

### Why imports leak

When a consumer runs `go mod tidy`, every transitive `import` you have shows up in their `go.sum`. That means:

- Your dependency on a heavy framework forces compile-time inclusion in their binary.
- A breaking change in a transitive dep can break their build, even if they never named that dep.
- Their security scanner flags every CVE in your transitive set as their problem.

You cannot hide an import. There is no "private import" mechanism. Every choice is public.

### The implication

Treat new imports the same way you treat new exported types. Each one is a long-term commitment. Ask:

- *Can I do this without taking a new dependency?* The standard library is generous; reach for it first.
- *Is this dep maintained? Vetted? License-compatible?*
- *Will every consumer of my package be willing to ship this dep?*

A package that imports `database/sql`, `net/http`, and three small std-lib helpers is a clean dependency. A package that imports `k8s.io/client-go`, `aws-sdk-go-v2`, and a forking router is a heavy dependency. Both can be correct — but the second one carries a much heavier contract.

### Imports as a contract for refactor

When you delete an exported symbol, every consumer breaks. When you delete an import, only your package's behaviour changes — but if the imported package was load-bearing for a side effect (driver registration, init hook, build tag pin), removing it can silently break consumers downstream. Track removal of imports as carefully as removal of symbols.

---

## Designing Package Boundaries to Avoid Cyclic Imports

Go forbids import cycles. The compiler refuses to build them. This is a feature: it forces you to think about layering. But when a cycle appears, juniors split it arbitrarily and seniors split it deliberately.

### What a cycle means architecturally

A cycle says: "package A and package B are *the same level of abstraction*, but you wrote them as if one were below the other." The compiler is telling you the layering is wrong.

There are four canonical refactors. Pick the one that matches the *real* relationship between A and B.

### Refactor 1 — Extract an interface

Most cycles involve a high-level package wanting to call into a low-level one, while the low-level one wants to call back. Replace one direction with an interface.

```
Before:
  service → store → service     (cycle)

After:
  service → store
  store defines an interface that service implements; store calls via that interface
```

The store package no longer imports service. It calls a callback supplied by the caller. The cycle is gone.

### Refactor 2 — Introduce a shared "domain types" sub-package

When two packages need to talk about the same type but neither owns it, neither should import the other. Both depend on a third package that owns the type.

```
Before:
  order → customer → order   (cycle around shared types)

After:
  domain/    ← defines Order, Customer
  order      → domain
  customer   → domain
```

The new `domain/` package contains plain data types and pure functions. It imports nothing of yours. Both `order` and `customer` depend on it; neither depends on the other. This is the most common cycle-breaking move at scale.

### Refactor 3 — Flip the dependency via inversion

Sometimes a cycle hides the fact that one package is *actually* higher-level than the other, but you put the wiring backwards. Flip it.

```
Before:
  payment → notifier → payment

After:
  payment defines a Notifier interface
  payment imports nothing about notifier
  the wiring layer (cmd/) imports both, injects the concrete notifier into payment
```

This is dependency inversion in the classical Hexagonal sense. Heavy users put it in the `domain/` and `app/` layers consistently.

### Refactor 4 — Merge

Sometimes a cycle is real and indicates the two packages should be one. If A and B are conceptually inseparable and always change together, merge them. Cycles between artificially split packages are best fixed by un-splitting.

### The senior heuristic

When a cycle appears, do not just "move a function to fix the build." Diagnose first:

- Is there a missing layer? → introduce a `domain/` package.
- Is the dependency direction wrong? → invert with an interface.
- Are these the same thing in two files? → merge.
- Is one truly below the other? → extract a callback interface.

---

## Internal Packages as a Modularization Tool

Go's `internal/` directory is the closest the language has to "package private." Inside the module, an `internal/` package is importable only from siblings rooted at the parent of `internal/`. Outside, it is invisible.

### Senior use cases

- **Hide messy internals safely.** Anything that you want to refactor freely without bumping a major version goes in `internal/`. The set of *public* packages becomes your stable API surface; the set of *internal* packages can churn without consumer impact.
- **Enforce architecture.** Place architectural layers under `internal/` to forbid external use. Consumers who try to import are told off by the compiler, not by a lint rule that can be ignored.
- **Multi-team isolation in monorepos.** Use `internal/` boundaries at intermediate levels (e.g., `team-a/internal/`, `team-b/internal/`) so teams cannot accidentally couple to each other's internals.

### A common shape

```
github.com/example/svc/
├── go.mod
├── cmd/
│   └── svc/main.go              ← thin entry point
├── api/                          ← public, importable by other modules
│   └── client.go
├── internal/
│   ├── domain/                   ← business types
│   ├── app/                      ← use cases / application services
│   ├── infra/                    ← adapters: db, kafka, http
│   └── platform/                 ← logging, config, metrics
└── pkg/                          ← rarely needed; resist creating
```

### What `internal/` does *not* do

- It does not enforce layering between packages within the module. `internal/infra` can still import `internal/domain` and vice versa unless you discipline it (or use a lint rule).
- It does not protect you from a future engineer who refactors a critical type out of `internal/`. Code review is still required.
- It does not stop transitive surface leakage: if a public type's method exposes an `internal/` type, that type effectively leaks. `go vet` flags this.

---

## Layering: How Imports Reflect Architecture

A senior engineer reads imports the way an architect reads load-bearing walls. The set of `import` lines at the top of every file in a package answers: *what does this package depend on, and therefore where in the system does it sit?*

### The classical Go layering

Borrowing from Hexagonal / Onion / Clean Architecture:

```
domain/        ← types, value objects, pure logic. Imports: stdlib only.
app/           ← orchestration, use cases. Imports: domain, stdlib.
infra/         ← adapters: db, http clients, kafka. Imports: domain, app, third-party.
cmd/           ← wiring & main(). Imports: everything.
```

**Imports flow inward only.** `domain/` never imports `app/` or `infra/`. `app/` never imports `infra/`. `infra/` is allowed to import `app/` and `domain/`. `cmd/` is at the top and may import freely to wire things up.

### Why this matters

When you grep for `import "github.com/aws/aws-sdk-go-v2"`, you should find hits only in `infra/` and `cmd/`. If you find one in `domain/`, the architecture is broken — your business logic now depends on a vendor SDK and cannot be tested without mocking AWS.

This is enforceable with a lint rule (more in [Section 12](#imports-and-go-vetstaticchecklint-rules)). Many large Go codebases ship with a `depguard` or custom check that fails the build on inward-violating imports.

### Subtler layering problems

- **Logger in `domain/`.** Tempting, but it pulls a logger framework into your purest layer. Prefer to return errors and let the caller log.
- **Context in `domain/`.** `context.Context` is acceptable in `domain/` because it is stdlib and does not pin you to any framework.
- **Time in `domain/`.** Direct calls to `time.Now()` make `domain/` non-deterministic. Inject a clock via interface if testability matters.

### When layering is overkill

A 500-line tool does not need `domain/app/infra`. A single package is fine. Layering pays off when the codebase is past ~5,000 lines and has multiple binaries, multiple data stores, or multiple inbound transports.

---

## The Cost of Wide Imports (Compile Time, Blast Radius)

Every import has a cost. Most are tiny. Some are enormous.

### Compile-time cost

Go compiles the transitive closure of every import. A heavy library — `k8s.io/client-go`, `aws-sdk-go-v2`, certain ORMs — adds seconds to the build for every binary that reaches it.

A senior engineer audits the import graph periodically. Tools:

```
go list -deps -f '{{.ImportPath}}' ./...   # all packages compiled
go mod graph                                 # module-level graph
go build -x                                  # show every compile invocation
```

If a small CLI tool is taking 30 seconds to compile, the cause is almost always a heavy import dragged in transitively. Find it; remove it.

### Binary-size cost

Go links all reachable code. A heavy import bloats the binary even if only one function is used. For services where the binary ships in a container image, this affects deploy time, registry storage, and cold-start performance.

### Blast radius cost

When a heavy library publishes a breaking change, every consumer of every package that uses it must coordinate. A library author who imports `k8s.io/client-go` is implicitly committing to track its release schedule on behalf of all their consumers.

### Audit pattern

Quarterly, run on a representative binary:

```
go build -ldflags="-X main.version=audit"
go tool nm <binary> | sort -k 3 | head -100
go list -deps ./... | wc -l
```

Look for:

- Total package count growing month over month.
- Specific heavy imports that appear in unexpected places.
- Single-purpose dependencies that could be replaced by 30 lines of stdlib.

### A guiding principle

A small import that does one job is almost always preferable to a large one that does many. `golang.org/x/sync/errgroup` over a full async framework. `database/sql` over an ORM, when the data access is simple.

---

## Aliasing Discipline at Scale

Import aliases (`import foo "long/path/foo"`) are a footgun at scale.

### When aliases are required

- Two imports collide on the last path segment: `pkg/foo` and `other/foo`.
- A versioned import path: `import auth "github.com/x/auth/v3"` (without the alias, the local name is `auth`, but only because `v3` is a Go convention — be explicit).
- A package with an awkward name (e.g., a generated package that decided to call itself `apiv1pb`).

### When aliases harm

- Renaming `database/sql` to `db` because "it's shorter." A future reader has to look up what `db` means in this file.
- Different aliases for the same package across the codebase: `pb`, `proto`, `apipb`, `pbv1` all referring to the same generated package. Now grepping for use sites is impossible.
- Aliases that hide a bad import (renaming `unsafe` to `u` because it was easier to slip past review).

### Senior policy

Adopt a *consistent* aliasing convention, project-wide:

- For protobuf packages: always alias by the proto package name (`apiv1pb`).
- For multi-version paths: alias by the unversioned name with a version suffix (`authv3`).
- For collisions: alias the *less-used* one, with a name that reflects the domain.

Encode the policy as a lint rule. `importas` (a `golangci-lint` linter) checks alias consistency. Once enforced, alias chaos disappears.

---

## Blank Imports as a Side-Effect Contract

`import _ "foo"` runs `foo`'s `init()` functions and discards its symbols. This is a side-effect-only import. The danger is that the side effect is invisible at the call site.

### Legitimate uses

- **Driver registration.** `import _ "github.com/lib/pq"` registers the Postgres driver with `database/sql`. Without it, `sql.Open("postgres", ...)` fails.
- **Image format registration.** `import _ "image/png"` registers PNG decoding so `image.Decode` can read PNGs.
- **Plugin or codec registration** generally.

### Why they are dangerous

- Removing the line breaks runtime behaviour, not compile time. Tests that did not exercise the path will pass.
- A future engineer running `goimports` or a "remove unused import" linter may strip it. Mark blank imports with a comment that prevents auto-removal.
- Init-order is implementation-defined within a package; cross-package init order follows dependency order. A blank import that depends on environment variables or network is a maintenance landmine.

### Senior pattern

Place blank imports together, in a single block, with a comment per line explaining the side effect:

```go
import (
    _ "github.com/lib/pq"          // registers postgres driver
    _ "github.com/mattn/go-sqlite3" // registers sqlite driver
    _ "image/png"                   // adds PNG decoding to image.Decode
)
```

Document them in the package doc-comment as well. Never tolerate an undocumented blank import — it is a hidden coupling waiting to surprise someone.

---

## Dot Imports: When They Are Acceptable

`import . "foo"` brings every exported symbol of `foo` into the current namespace as if it were declared locally. The result is unreadable: a reader cannot tell which functions belong to which package.

### The blanket rule

Do not use dot imports.

### The narrow exception

The Go community tolerates dot imports in *one* place: `ginkgo`/`gomega` BDD-style tests, where the matcher DSL is the entire point of the framework:

```go
import (
    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

var _ = Describe("Server", func() {
    It("starts", func() {
        Expect(server.Start()).To(Succeed())
    })
})
```

Without the dot import, every line would prefix `ginkgo.Describe`, `gomega.Expect`, etc., and the DSL becomes noise. This is the only pattern where the trade-off is broadly accepted.

### Anywhere else

Refuse dot imports in code review. They are not a stylistic preference; they actively impair grep, jump-to-definition, and readability. Even within a single package's tests, prefer fully-qualified imports.

---

## Init Order as Architectural Risk

`init()` functions run before `main`. They run in dependency order: imported packages init first, then the importer. Within a package, init functions run in the order their files are passed to the compiler, which the language spec leaves implementation-defined (though gc orders by filename).

### Why init is risky

- **Hidden order.** A reader cannot easily tell which init runs first across the program.
- **No error path.** `init()` cannot return an error. If something fails, the only options are panic or silently set a sentinel.
- **No context.** No `context.Context`, no logger, no config. Whatever init needs, it has to find globally.
- **Side effects on import.** Adding a blank import implicitly invokes init. Easy to do, hard to notice.

### Senior policy

`init()` is acceptable for:

- Registering with a static registry (`sql.Register`, `image.RegisterFormat`).
- Compiling regexes once at startup.
- Setting up package-level constants that need a function call.

`init()` is *not* acceptable for:

- Reading environment variables.
- Opening network connections, files, or databases.
- Calling `os.Exit` or `panic` on bad config.
- Anything that should be testable, mockable, or observable.

If a package's startup logic is non-trivial, expose it as a `func New(ctx, cfg) (*X, error)` that `main` calls explicitly. Init order is then visible in `main`, errors flow normally, and tests can substitute.

### The audit

Grep for `func init()` across the codebase. Each one should be one-line trivial or carry a comment explaining why it is safe. Anything more should migrate to an explicit constructor.

---

## Imports in Generated Code

Code generators emit imports you didn't write. Treat the generated set as part of your package's public boundary.

### Common generators

- **protoc / `protoc-gen-go`.** Emits packages that import `google.golang.org/protobuf/runtime/...`. The runtime is a stable but heavy dep.
- **mockgen.** Emits mocks that import `github.com/golang/mock/gomock`. Pulls the testing framework into any package using mocks.
- **sqlc.** Emits database access code that imports `database/sql` and your driver package.
- **ent / gorm-gen.** Emit ORM scaffolding that pulls in entire ORM runtimes.
- **stringer / enumer.** Emit pure code with stdlib-only imports.

### Senior implications

- The generator *chooses* its imports. If you switch protoc-gen-go for protoc-gen-go-grpc, your import surface changes. Pin generator versions.
- Generated code is reviewed less carefully. A new transitive dependency can sneak in via a generator update. Audit `go.sum` after every generator bump.
- Generated files should be regenerated reproducibly. Pin the generator binary version (e.g., via `tools.go` and `go run`).

### `tools.go` pattern

```go
//go:build tools

package tools

import (
    _ "google.golang.org/protobuf/cmd/protoc-gen-go"
    _ "github.com/golang/mock/mockgen"
)
```

This file is excluded from normal builds (`tools` build tag) but is included in `go.mod`. It pins the generators' versions to the same `go.sum` as runtime deps. Engineers regenerate with `go run`, ensuring everyone uses the same generator version.

### Generated-code lint suppressions

Lint rules often exclude generated files via path patterns or `// Code generated ...; DO NOT EDIT.` headers. The trade-off is that a generator quietly producing bad imports won't be flagged. Periodically lint generated files explicitly to catch regressions.

---

## Imports and `go vet`/`staticcheck`/Lint Rules

Static analysis catches several import-related bugs.

### `go vet`

Run `go vet ./...` in CI. Relevant checks:

- **Composites.** Spots wrong field names in struct literals where types are imported.
- **Unreachable.** Catches imports that are now unused after dead-code removal.
- **Lostcancel.** Flags code paths that import `context` but leak cancellations.

### `staticcheck`

Far stricter. Relevant for imports:

- **SA1019.** Use of deprecated identifiers, including from imported packages.
- **U1000.** Unused code (private helpers no longer reachable).
- **ST1019.** Imports the same package twice with different aliases.

### `golangci-lint` linters specific to imports

- **goimports.** Auto-formats import blocks; groups stdlib and third-party.
- **importas.** Enforces a project-wide alias policy.
- **depguard.** Forbids importing specific packages from specific paths. The right tool for layering enforcement: forbid `aws-sdk-go-v2` from `internal/domain/`.
- **gomoddirectives.** Restricts use of `replace` and `retract`.
- **revive (forbid-import rule).** Similar to depguard, more flexible patterns.

### A senior-grade `.golangci.yml`

```yaml
linters:
  enable:
    - depguard
    - importas
    - goimports
    - staticcheck
    - revive

linters-settings:
  depguard:
    rules:
      domain:
        files: ["**/internal/domain/**"]
        deny:
          - pkg: "github.com/aws/aws-sdk-go-v2"
            desc: "domain layer must not import vendor SDKs"
          - pkg: "net/http"
            desc: "domain layer must not import HTTP"
  importas:
    alias:
      - pkg: github.com/example/api/v1
        alias: apiv1
```

Fail the build on violations. Lint is the only practical way to keep architecture consistent across a growing team.

---

## Designing for Future Sub-Module Carving

A package today might become its own module tomorrow — open-sourced, extracted for reuse, or split off as a separate service. If imports flow in one direction, carving is mechanical. If they don't, it's surgery.

### What blocks carving

- A cycle between the carve-out target and the rest of the codebase. Even if it builds today (because they are in the same module), splitting forces a `replace` cycle that won't work.
- Use of `internal/` packages from outside the new boundary. A function the carve-out target calls happens to live in `internal/`, which is unreachable across modules.
- Heavy imports of project-wide types that pull most of the codebase into the carve-out.

### What helps carving

- **Layered imports.** If the target package only imports `domain/`, `stdlib`, and one or two third-party deps, carving is trivial.
- **Public types, not internal.** If the target's API uses types from `internal/`, those types must be moved to a public location before carving.
- **A small, focused `go.mod` ready in spirit.** Ask: "If I had to write this module's `go.mod` today, what would be in it?" If the answer is a clean three-line list of imports, the package is ready.

### The carving rehearsal

Periodically, for any package that is a candidate to be lifted out, run:

```
go list -deps github.com/example/svc/internal/foo | sort -u
```

Inspect the list. Anything outside `domain/`, `stdlib`, or a small number of third-party deps is a coupling. Reduce it now, while it is cheap. Postpone, and the day someone needs to extract `foo` becomes a multi-week project.

### A real example

A team had a `metrics/` package shared by every service. When they tried to open-source it, they found:

- It imported `internal/config/` for default scrape interval.
- It imported `internal/auth/` for a metric label.
- It imported a logger that imported their service's domain types.

Carving took a month — most of which was breaking those couplings. If the team had treated `metrics/` as a "future external module" from day one, the import discipline would have made carving an afternoon's work.

---

## Anti-Patterns

- **`import "github.com/big/framework"` in `internal/domain/`.** Pulls a framework into business logic; defeats layering.
- **A `util/` package that imports half the project and is imported by the other half.** Cycle factory.
- **Inconsistent aliases for the same import path across files.** Makes grep useless.
- **Undocumented blank imports.** A future engineer cannot tell why they exist.
- **`import .` outside of test DSLs.** Hurts readability; obscures call sites.
- **`init()` functions that read env vars or open connections.** No error path; no testability.
- **Import block hand-formatted, breaking `goimports`.** Causes constant churn in PRs.
- **Generator emitting imports nobody reviews.** Hidden vendoring of large deps.
- **Heavy library taken in for one function.** Replace with stdlib or a 30-line helper.
- **Public API exposing types from `internal/`.** Compiler will warn via `go vet`; do not ignore.
- **Cyclic imports "fixed" by moving a function arbitrarily** instead of diagnosing the missing layer.
- **No lint enforcement of layering.** Architecture decays under the weight of small expedients.

---

## Senior Checklist

- [ ] Treat each new import as a long-term commitment, not a convenience
- [ ] Diagnose import cycles by missing-layer analysis, not by moving functions around
- [ ] Use `internal/` to hide implementation and enforce architecture
- [ ] Define explicit layering (domain / app / infra / cmd) and enforce with `depguard`
- [ ] Audit transitive import cost quarterly; remove heavy deps used for trivial reasons
- [ ] Adopt a single project-wide aliasing convention; enforce with `importas`
- [ ] Document every blank import with a comment naming the side effect
- [ ] Forbid dot imports outside test DSLs in code review
- [ ] Restrict `init()` to trivial registration; use `func New(ctx, cfg)` for real startup
- [ ] Pin generator versions via `tools.go`; audit `go.sum` after every generator bump
- [ ] Run `go vet` and `staticcheck` in CI; treat warnings as errors
- [ ] Periodically rehearse "what would it take to carve this package into its own module?"
- [ ] Review generated code's imports the same way you review hand-written ones

---

## Summary

In Go, imports are architecture made visible. Every `import` line is a public commitment, a compile-time cost, and a directional arrow in the dependency graph. A senior engineer reads imports diagnostically: where they flow, what they cost, and what they say about layering.

The mechanical command is one keyword. The decisions around it span team boundaries, performance budgets, security audits, and the lifetime of the codebase. Get the layering right; keep imports flowing in one direction; treat blank imports, dot imports, and `init()` as advanced tools used sparingly; enforce the rules with lint, not vibes. Done well, the import block at the top of every file becomes a precise, terse summary of what each package is — and what it is not.
