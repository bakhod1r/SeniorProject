# Project Layout — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Layout as Architecture Enforcement](#layout-as-architecture-enforcement)
3. [The Import Graph as a Design Document](#the-import-graph-as-a-design-document)
4. [Boundary Enforcement Beyond `internal/`](#boundary-enforcement-beyond-internal)
5. [Layout for Large Teams](#layout-for-large-teams)
6. [Build-Time and CI Implications](#build-time-and-ci-implications)
7. [Refactor Patterns: How to Move a Package](#refactor-patterns-how-to-move-a-package)
8. [Splitting and Merging Packages](#splitting-and-merging-packages)
9. [Hexagonal and Clean Architecture in Go Layout](#hexagonal-and-clean-architecture-in-go-layout)
10. [Stable APIs and the Cost of Public Packages](#stable-apis-and-the-cost-of-public-packages)
11. [Anti-Patterns at Scale](#anti-patterns-at-scale)
12. [Senior-Level Checklist](#senior-level-checklist)
13. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with project layout is not "what folders go where" but "how do I express and enforce the architecture so that the codebase resists drift?" Layout is the cheapest enforcement mechanism Go gives you. It is also the most powerful — `go build` rejects illegal imports unconditionally, and a smart layout converts architectural rules into compiler errors.

This file is about *layout as policy*. Mechanical content (where `cmd/` and `internal/` go) is in [junior.md](junior.md) and [middle.md](middle.md).

After reading this you will:
- Use `internal/` placement and import-graph linting to enforce architectural boundaries.
- Reason about a codebase by reading its import graph, not just its file tree.
- Refactor packages and modules without breaking consumers.
- Recognize the trade-offs of public APIs and minimize regrettable exports.
- Identify and dismantle layout anti-patterns that mid-sized teams accumulate.

---

## Layout as Architecture Enforcement

Architecture documents are aspirational. Layouts are real. If a `README.md` says "the domain layer must not depend on the database," but the disk layout permits the import, someone will eventually cross the line — and the architecture will silently rot.

A senior layout converts every architectural rule into a directory structure that the toolchain enforces:

```
internal/
├── domain/             ← no I/O, no database, no HTTP
├── store/              ← imports domain; never imported by domain
├── transport/          ← imports app; never imported by store
└── app/                ← imports domain and store; orchestrates use cases
```

The rule "domain has no dependencies" is enforced by *not putting any imports in `domain/*.go`*. The rule "store does not import transport" is enforced because transport is at the same level — a cycle would be detected by `go build`. But "domain must not import store" requires discipline, because Go does not detect the *direction* — only cycles.

That is where import-graph linters and `internal/` placement come in.

### Use `internal/` placement to make rules unbreakable

Push code one level deeper to make a rule unbreakable:

```
internal/
├── core/
│   ├── domain/
│   │   └── ...
│   └── internal/
│       └── pure/         ← only core/* can import
└── adapters/
    ├── store/
    └── transport/
```

`internal/core/internal/pure/` cannot be imported from `internal/adapters/`. The compiler rejects it. The architecture rule "adapters do not touch core internals" is now a compile-time invariant.

### Layout-as-enforcement is not free

Every nested `internal/` makes refactoring more expensive. If you nest three levels deep and later want to expose a piece, you have to move it — every importer's path changes. Use the technique surgically. Reserve it for the boundaries you genuinely fear violating.

---

## The Import Graph as a Design Document

A senior reads a codebase by running:

```bash
go list -deps ./...
```

And:

```bash
go mod graph
```

These produce the *real* dependency picture, free of marketing. A layout that looks clean but produces a tangled graph is a layout that will rot.

### Visualizing the graph

```bash
go list -f '{{.ImportPath}} -> {{join .Imports " "}}' ./internal/...
```

Pipe to a `.dot` file and render with Graphviz:

```bash
go list -deps -f '{{.ImportPath}}' ./... | \
    awk '{print "  \"" $1 "\""}' > graph.txt
```

Tools like `goda` ([github.com/loov/goda](https://github.com/loov/goda)) produce import-graph diagrams directly. A weekly graph snapshot, committed to the repo, lets reviewers spot drift.

### What a healthy graph looks like

- Few cycles (ideally zero — `go build` enforces this).
- Layers visible: `transport` → `app` → `domain` and `app` → `store` → `domain`.
- Few cross-feature edges: `billing/*` does not import `user/internal/*`.
- A small "load-bearing core" (`domain`, `errors`, `clock`) imported by many; everything else imports the core, not each other.

### What a sick graph looks like

- A `util/` package imported by every other package — a hidden hub.
- Sibling features importing each other (`billing` ↔ `user`).
- The `domain/` layer importing the `store/` layer — the architectural rule, broken.
- Long chains of one-purpose packages (`a` → `b` → `c` → `d` → `e`) — over-decomposition.

The graph tells you what the layout cannot. Use both.

---

## Boundary Enforcement Beyond `internal/`

`internal/` is binary: a package is or isn't reachable. For richer rules, layer additional tools.

### Architecture lint via `golangci-lint`

Linters like `forbidigo` and `depguard` (both shipped in `golangci-lint`) reject imports by pattern:

```yaml
linters-settings:
  depguard:
    rules:
      domain:
        list-mode: lax
        files:
          - "**/internal/domain/**"
        deny:
          - pkg: "database/sql"
            desc: "domain must not import database/sql"
          - pkg: "net/http"
            desc: "domain must not import net/http"
```

A pre-commit hook running `golangci-lint run` enforces the rule for every PR. The cost is a config file; the gain is "the rule cannot rot."

### Custom analyzers via `go/analysis`

For non-trivial rules — "no package under `internal/app/` may import a package under `internal/transport/`" — write a small `go/analysis.Analyzer` and run it as a unit test:

```go
// internal/lint/lint_test.go
package lint_test

import (
    "testing"

    "golang.org/x/tools/go/analysis/analysistest"
)

func TestNoTransportFromApp(t *testing.T) {
    analysistest.Run(t, analysistest.TestData(),
        noTransportFromAppAnalyzer, "example.com/myapp/internal/app/...")
}
```

The test fails if any file under `internal/app/` imports `internal/transport`. The architecture rule lives in code, runs in CI, and breaks the build when violated.

### Module boundaries

A multi-module monorepo with `go.work` makes module boundaries themselves a rule. Each module declares its public API in its top-level packages; everything else is `internal/`. A sibling module that depends on another's `internal/` is rejected by `go build`. This is the strongest enforcement available and the right choice for teams that need genuine independence.

---

## Layout for Large Teams

Once a codebase has more than three teams contributing, layout becomes a coordination tool.

### Per-team subtrees

```
internal/
├── billing/             ← team-billing
│   ├── internal/        ← invisible to other teams
│   ├── api.go           ← billing's public surface
│   └── ...
├── user/                ← team-user
│   ├── internal/
│   └── ...
└── shared/              ← cross-team contracts
    ├── auth/
    └── events/
```

The `billing/internal/...` layer is invisible to `user/`. The `billing/api.go` layer is the *only* surface a sibling team can depend on. This makes the team boundary a compile-time check.

### CODEOWNERS aligned with the tree

```
# .github/CODEOWNERS
/internal/billing/    @acme/team-billing
/internal/user/       @acme/team-user
/internal/shared/     @acme/architecture
```

Layout aligned with ownership means PRs route to the right reviewers automatically.

### Limits on cross-team imports

A senior decision: should `billing/` be allowed to import `user/api`? Usually yes — you cannot bill a user without a user. Should it be allowed to import `user/internal/...`? Never — that is what `internal/` prevents. Should it be allowed to import `user/store`? That depends on whether `store` is part of `user`'s public API. The answer is encoded in the directory structure: anything under `user/internal/` is private; anything else is public.

### When a team grows out of its subtree

`internal/billing/` reaches 50 packages and three sub-teams. Refactor: promote `internal/billing/` to its own module under `billing/`, with its own `go.mod`, joined to the workspace via `go.work`. The team now controls its module independently. Pull requests within billing no longer land in the main module's CI.

---

## Build-Time and CI Implications

Layout has direct measurable effects on `go build` time and CI duration.

### The build cache keys on package directories

`go build` caches the compiled output of each package keyed by the package's directory path and the hashes of its inputs. A change to `internal/util/helpers.go` invalidates the cache for *every package that imports `internal/util`*. If `util` is imported by 80 packages, you just paid for 80 recompiles.

The cure is the layout: replace one big `util` package with several small, focused packages (`slogutil`, `timeutil`, `httputil`). Each is imported by fewer consumers, so a change to one only invalidates a small subgraph.

### Independent binaries reduce work

```bash
go build ./cmd/server
```

Compiles only the packages reachable from `cmd/server/main.go`. If `cmd/cli/main.go` does not import `cmd/server`'s subtree, building one does not require building the other. Multi-binary layouts with shared `internal/` are friendly to incremental CI.

### `go test ./...` is a hammer

`go test ./...` re-runs every test in every package, in every binary. For large repos this is minutes of CI. Layout helps:

- Domain packages with no I/O have fast tests; integration packages have slow tests. Group them so CI can split: `go test ./internal/domain/...` is fast; `go test ./internal/integration/...` is slow.
- Use build tags on integration tests (`//go:build integration`) so they run only when the relevant code or its inputs change.

### `gopls` and large repos

`gopls` indexes the whole module. A monorepo with 500 packages forces `gopls` to load everything. Workspaces help — `go.work` lets `gopls` index per-module, so editor responsiveness scales sub-linearly with repo size. Multi-module monorepos are not just an organization choice; they are an editor-performance choice for very large repos.

---

## Refactor Patterns: How to Move a Package

Refactor is the test of layout. A good layout makes refactor cheap; a bad one makes it expensive.

### Pattern 1 — Move a leaf package

`internal/foo/bar` has no consumers under `internal/foo` other than itself. To move it to `internal/bar`:

1. `gopls rename` (or your IDE's "move package") moves the directory and updates every importer.
2. Run `go vet ./...` and `go build ./...`.
3. Commit.

This is trivial when only one importer exists. The pain comes when many do.

### Pattern 2 — Split a fat package

`internal/store` is 30 files and 5 subjects (users, orders, billing, audit, sessions). Split:

1. Create `internal/store/user/`, `internal/store/order/`, etc.
2. Move files. Update package declarations.
3. `gopls rename` updates every importer.
4. Verify `go build ./...` and `go test ./...`.

The scary step is when one of the new sub-packages depends on another (orders need users). Fix by:
- Defining a small interface in `order/` that `user/` can satisfy without importing.
- Or moving the cross-cutting type into `internal/domain/`.

### Pattern 3 — Promote a private package to public

You decide `internal/client/` should become a public Go package others can import. The path changes from `example.com/myapp/internal/client` to `example.com/myapp/client` (or `example.com/myapp/pkg/client`).

1. `git mv internal/client client`.
2. `gopls rename` updates internal importers.
3. Document the new public API. Add a `doc.go`.
4. Tag a release.

The harder part is the social one: now you have a public commitment. Outside consumers will pin to `v1.0.0` and any change becomes a breaking-change discussion.

### Pattern 4 — Demote a public package to private

The opposite. You realize `pkg/foo/` should be private:

1. `git mv pkg/foo internal/foo`.
2. Update every internal importer with `gopls rename`.
3. Communicate the breaking change to outside consumers (you cannot avoid this).
4. Bump major version (`v2`).

### Pattern 5 — Split a module

A piece of the monorepo grows large enough to merit its own module. Steps:

1. Create a new directory with its own `go.mod`.
2. Move the relevant packages. Update their import paths.
3. Add the new module to `go.work` for local development.
4. Add the new module to CI as an independent build target.
5. The boundary between the new module and the old one is now a *module boundary*, not a package boundary.

This is a one-way operation. Going back (re-merging modules) is also possible but expensive.

---

## Splitting and Merging Packages

When to split:

- The package has more than ~500 lines of unrelated logic.
- Two parts of the package have very different change cadences.
- Two parts have very different test stories (one is fast, one is integration-heavy).
- The package's name is becoming a generic word like `core` or `shared`.

When to merge:

- Two packages always change together. Their diffs in `git log` are highly correlated.
- Their public APIs reference each other heavily.
- Importers always import both.
- One is a stub with three functions that exist only because someone wanted a separate package.

### A heuristic: cohesion vs coupling

A package is healthy when it has high *cohesion* (its contents belong together) and low *coupling* (it depends on few other packages). Splitting too aggressively decreases cohesion: a package that does one tiny thing is harder to understand than a package that does the whole job. Merging too aggressively increases coupling: a package that does five things imports five things' dependencies and pulls them all into every importer.

The middle path is concrete: every package should have a one-sentence description. If you cannot describe what `util/` does in one sentence, split. If two packages have descriptions that overlap, merge.

---

## Hexagonal and Clean Architecture in Go Layout

Hexagonal Architecture (Ports and Adapters) and Clean Architecture map naturally to Go's layout once you understand the rules.

### Hexagonal layout

```
internal/
├── core/                ← business logic
│   ├── domain/          ← entities, value objects
│   └── ports/           ← interfaces (driving and driven)
├── driving/             ← inbound adapters (HTTP, gRPC, CLI)
│   ├── http/
│   └── grpc/
└── driven/              ← outbound adapters (DB, queue, external HTTP)
    ├── postgres/
    ├── kafka/
    └── stripe/
```

The rule: `core/` imports nothing from `driving/` or `driven/`. Adapters import `core/`, never the reverse.

Enforcement:
- `core/` has no `import "..."` of `internal/driving` or `internal/driven`.
- A `golangci-lint` `depguard` rule (or a custom analyzer) rejects PRs that violate this.

### Clean Architecture's onion

```
internal/
├── entities/            ← innermost
├── usecases/            ← imports entities
├── interfaces/          ← imports usecases (controllers, presenters)
└── frameworks/          ← imports interfaces (HTTP, DB)
```

Same rule: imports point inward. The outer layers depend on the inner; the inner know nothing of the outer. Layout makes the dependency direction visible.

### Reality check

Pure hexagonal/clean is overkill for a 2,000-line CRUD service. The pattern earns its keep when:
- The business logic is genuinely complex and worth isolating from infrastructure.
- The team will swap infrastructure (move from Postgres to DynamoDB, from REST to gRPC) and wants to do so without rewriting the core.
- Testing the core in isolation, without spinning up adapters, is high-value.

For most services, a lightweight version (`internal/domain`, `internal/store`, `internal/http`, `internal/app`) gets 80% of the benefit at 20% of the cost.

---

## Stable APIs and the Cost of Public Packages

Anything outside `internal/` is a public commitment. Senior engineers minimize public surfaces ruthlessly.

### Public packages cost forever

A function in `pkg/client.New()` that some consumer imported in 2021 is locked in. You cannot remove it without major-version bump. You cannot rename it without breakage. Every public symbol is a contract.

### The default should be `internal/`

When in doubt, put a new package under `internal/`. It is one `git mv` away from being public. It is many releases and breaking changes away from being made private again.

### Designing public APIs deliberately

When you decide to make a package public:

1. Write a `doc.go` that explains what the package does, what it does not do, and what guarantees it makes.
2. Minimize exported symbols. Every exported function, type, and constant is a future obligation.
3. Use small, narrow interfaces over wide concrete types where possible.
4. Avoid leaking internal types in public signatures (a public function returning an `internal.Foo` is awkward and brittle).
5. Tag a release. Stick to SemVer. v1+ means "I will not break this without a major bump."

### The `pkg/` and `internal/` rhythm

A common evolution:

- Build a feature under `internal/`.
- Use it for a year.
- A consumer asks for it.
- Move it to a public path. Tag v1.0.0. Maintain it forever.

The opposite — exposing speculatively in `pkg/`, then realizing you never wanted to commit — is much worse. You will either break consumers or maintain code you regret.

---

## Anti-Patterns at Scale

### Anti-pattern 1 — The hub package

A `util/` or `common/` imported by 50 packages. A change to it triggers 50 rebuilds and risks 50 bugs. Split into focused packages.

### Anti-pattern 2 — Layout that lies

A `pkg/` directory full of types that are only used internally. Move them to `internal/` or eliminate `pkg/`.

### Anti-pattern 3 — Mirror-layered packages

```
internal/
├── handlers/user.go
├── services/user.go
├── repositories/user.go
└── models/user.go
```

A user feature change touches four files in four directories. Layout fights cohesion. Refactor to domain layout.

### Anti-pattern 4 — Bin-packed `cmd/`

```
cmd/
├── server/main.go
├── worker/main.go
├── cli/main.go
├── migrate/main.go
├── seed/main.go
├── healthcheck/main.go
├── debug/main.go
└── ... (20 more)
```

Twenty binaries built from one repo, most of which are tiny operational tools. This is fine until each one drifts in flag parsing, logging conventions, and config loading. Senior fix: consolidate operational tools into one `cmd/admin` with subcommands, keep only the deployable binaries as separate `cmd/<bin>`.

### Anti-pattern 5 — Workspace abuse

`go.work` is for development. Some teams commit `go.work` and rely on it for production builds. This is fragile — `go.work` is a local-development convenience, and using it as a production tool means production builds depend on developer-machine state. In CI, build each module independently with `cd module && go build ./...`. Keep workspaces local.

### Anti-pattern 6 — `pkg/internal/...`

The double directory `pkg/internal/foo` is occasionally seen and almost never makes sense. `pkg/` says "public"; `internal/` says "private." Pick one. If a package is public-but-fragile, it is *internal* and should move out of `pkg/`.

### Anti-pattern 7 — God modules

A single `go.mod` with hundreds of modules' worth of code, no `internal/` discipline, every team importing every other team's deepest packages. This collapses under its own weight. The fix is a multi-module monorepo plus `internal/` enforcement.

---

## Senior-Level Checklist

Before merging a layout change of any size:

- [ ] The new layout makes one architectural rule a compile-time check (or you have a written justification for why it cannot).
- [ ] The import graph is no more tangled than before; preferably less.
- [ ] No new public packages introduced without a `doc.go` and an explicit decision.
- [ ] No new `util/`, `common/`, or `helpers/`.
- [ ] CI build time has not regressed (or has improved).
- [ ] CODEOWNERS aligns with the new tree if team boundaries are involved.
- [ ] The change is documented in a short CHANGELOG entry.
- [ ] If a `pkg/` move was involved, the consumer impact is enumerated.
- [ ] If a module split was involved, the workspace setup is verified, CI is updated, and the new module's `internal/` boundaries are correct.

---

## Summary

- Layout is the cheapest enforcement mechanism Go gives you. Use it.
- The import graph is a design document. Read it. Lint it.
- Push code under nested `internal/` to make architectural rules unbreakable; do this surgically.
- For large teams, align layout with ownership. Use CODEOWNERS to route reviews automatically.
- Refactor is the test of layout. A good layout makes refactor cheap.
- Public packages are forever commitments. Default to `internal/`; promote deliberately.
- Hexagonal and Clean Architecture map cleanly onto Go's layout, but the lightweight version (`domain`, `store`, `http`, `app`) is enough for most services.
- The most common scaling anti-patterns are hub packages (`util/`), mirror-layered packages, and god modules with no `internal/` discipline. Watch for them and dismantle early.
