# Architecture Patterns — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architecture as a Cost Function](#architecture-as-a-cost-function)
3. [Dependency Direction Rules in Practice](#dependency-direction-rules-in-practice)
4. [Evolving from Layered to Hexagonal as a Service Grows](#evolving-from-layered-to-hexagonal-as-a-service-grows)
5. [Boundary Tests: Proving the Architecture Holds](#boundary-tests-proving-the-architecture-holds)
6. [Modular Monoliths and Bounded Contexts](#modular-monoliths-and-bounded-contexts)
7. [When Patterns Become Overhead](#when-patterns-become-overhead)
8. [Anti-Patterns That Survive Code Review](#anti-patterns-that-survive-code-review)
9. [Refactoring Toward a Pattern Without a Big Bang](#refactoring-toward-a-pattern-without-a-big-bang)
10. [Senior-Level Checklist](#senior-level-checklist)
11. [Summary](#summary)

---

## Introduction

A senior's relationship with architecture patterns is not "which one is best?" It is "what does the codebase need over the next two years, what does it cost to get there, and which structural changes can the team absorb?"

This file is about that judgment layer. The mechanical content — folder layouts, decisions, naming — is in [`junior.md`](junior.md) and [`middle.md`](middle.md). Here we focus on:

- Reasoning about architecture as a cost function, not a virtue.
- Enforcing dependency-direction rules with tests and tooling, not goodwill.
- Evolving a layered Go service into hexagonal without a stop-the-world rewrite.
- Recognising when the chosen pattern has stopped paying for itself.

For deeper material on individual patterns and DDD-flavoured architectures, see [`../../19-architecture-patterns/`](../../19-architecture-patterns/).

---

## Architecture as a Cost Function

Every architectural rule has a price tag — usually paid in extra files, extra interfaces, and extra cognitive load — and a benefit denominated in *future change cost*. The senior question is whether the integral of the benefit, over the project's life, exceeds the integral of the cost.

### The five-component cost model

For each architectural commitment (e.g., "domain may not import infrastructure"), estimate:

1. **One-time setup cost.** Folder moves, interface extraction, the first round of test fixes.
2. **Per-feature ongoing cost.** Every new feature now lives across N packages instead of one. N=2 is fine. N=5 is friction.
3. **Onboarding cost.** New engineers must learn the rule before they can ship. A team that turns over 30% per year pays this *every year*.
4. **Tooling cost.** Linters, code generators, custom analyzers. Setup once; maintain forever.
5. **Drift recovery cost.** When the rule is silently broken (and it will be), the cost to detect and undo the violation.

### Where the benefit comes from

A pattern earns its keep through:

- **Replaceable infrastructure.** You can swap Postgres for MySQL, or HTTP for gRPC, without touching the domain. *Only valuable if you actually swap.*
- **Test speed.** Unit tests run without containers. *Valuable on every PR, every CI run, every minute.*
- **Independent reasoning.** A new engineer can read `internal/usecase/` without learning the database schema. *Cumulative across years.*
- **Concurrent feature work.** Two teams change `internal/adapter/http/` and `internal/adapter/postgres/` without merge conflicts. *Valuable in proportion to team size.*

### The honest framing

If you cannot point at a *specific* benefit you are buying, the architecture is decoration. Decoration costs the same per feature as real architecture.

A useful sanity check: pick three features the team has shipped recently. For each, ask "did the pattern make this easier or harder?" Two harders beats one easier — reconsider the pattern.

---

## Dependency Direction Rules in Practice

Every pattern reduces, in Go, to a few "package X may not import package Y" rules. Make them explicit.

### Writing the rules down

A short, repository-rooted document is the spine of architectural enforcement.

```
# ARCHITECTURE.md (excerpt)

Module: github.com/acme/billing

Allowed import direction (top to bottom):

  cmd/                       (binaries)
  internal/adapter/primary/  (HTTP, gRPC, worker)
  internal/adapter/secondary/(postgres, redis, stripe)
  internal/core/service/
  internal/core/port/
  internal/core/domain/

Hard rules:
  R1. internal/core/** must not import internal/adapter/**.
  R2. internal/core/domain/** must not import internal/core/{port,service}.
  R3. internal/adapter/** must not import other internal/adapter/** (no
      cross-adapter deps).
  R4. cmd/** may import anything. It is the composition root.
```

Three lines beat three pages. They are also enforceable.

### From rules to enforcement

There are four enforcement levels:

1. **Code review.** Free, slow, fragile, and the rule decays in proportion to reviewer fatigue.
2. **`depguard`.** Linter-driven; bans specific imports per package or directory.
3. **`go-arch-lint`.** Component-graph rules; closer to "describe the diagram, fail the build on violation."
4. **Custom analyzer.** When tooling above does not fit, a `golang.org/x/tools/go/analysis` analyzer encodes the exact rule.

Mechanics for (2)–(4) are in [`professional.md`](professional.md). The senior point: *every architectural rule should be machine-checked before the third PR violates it.*

### A concrete `depguard` snippet

```yaml
# .golangci.yml
linters:
  enable: [depguard]

linters-settings:
  depguard:
    rules:
      core-stays-pure:
        list-mode: lax
        files:
          - "**/internal/core/**"
        deny:
          - pkg: "github.com/acme/billing/internal/adapter"
            desc: "core/** must not import adapter/**"
          - pkg: "database/sql"
            desc: "domain/use cases must not touch SQL directly"
          - pkg: "net/http"
            desc: "core/** must not import net/http"
```

This stops the violation at PR time, every time. The rule then survives staff turnover.

---

## Evolving from Layered to Hexagonal as a Service Grows

Most Go services begin layered and stay there until the second driver appears. The move to hexagonal is gradual.

### Phase 0 — Layered, single driver

```
internal/{handler,service,domain,repo}
```

Tests are fast (the service can be tested with a fake `repo`); the team is small; one binary.

### Phase 1 — A second driver lands

A Kafka consumer arrives. The temptation is to call the existing `service` from a new `cmd/worker/main.go` directly. That is fine *if* the service does not pull in HTTP types. If it does, you are forced into the cleanup.

What the cleanup looks like:

1. Move all `*http.Request` parsing out of `service` into `handler`.
2. Promote `service`'s incoming method set into an explicit interface, even if Go does not strictly need it.
3. The Kafka consumer now talks to that interface.

### Phase 2 — A second drivee lands

You add a Redis cache, or a Stripe gateway, or a search index. The pattern: there is now a *role* (`PaymentGateway`, `SessionStore`, `SearchIndex`) implemented by more than one package. The interface deserves a permanent home.

Move the `repo` package's interfaces into `internal/core/port/`. Move concrete implementations into `internal/adapter/secondary/<name>/`. Now the service is hexagonal in everything but folder names.

### Phase 3 — Rename to make the diagram visible

Move folders so they match the picture:

```
internal/handler   →  internal/adapter/primary/http
internal/repo      →  internal/adapter/secondary/postgres
internal/service   →  internal/core/service
internal/domain    →  internal/core/domain
                  +  internal/core/port
```

Add `go-arch-lint`. Add `internal/adapter/secondary/memory/` for tests. Done.

### What *not* to do

- Do not jump from Phase 0 to Phase 3 in one PR for a service larger than a thousand lines. The diff is unreviewable; the bugs hide in import cycles you induced.
- Do not introduce new patterns *and* new features in the same change. One axis at a time.
- Do not migrate when a major release is imminent. Migrations create tail bugs; ship the release first.

### Cost of the migration, honestly

For a 5–10 KLOC service: a week of one engineer, plus ~2 hours of review per other engineer. After it lands, expect 2–3 weeks of small "I forgot to move this" follow-ups. That is the *visible* cost. The *hidden* cost is that every contributor's mental model of the codebase has to be rebuilt.

If the migration cannot survive that scrutiny, do not start it.

---

## Boundary Tests: Proving the Architecture Holds

A README that says "domain has no infrastructure imports" is wishful. A test that says it is enforcement.

### A boundary test in Go

Use the standard library — no third-party dependency required.

```go
// internal/core/domain/boundary_test.go
package domain_test

import (
    "go/build"
    "strings"
    "testing"
)

func TestDomainHasNoInfrastructureImports(t *testing.T) {
    pkg, err := build.Default.Import("github.com/acme/billing/internal/core/domain", "", 0)
    if err != nil { t.Fatal(err) }

    forbidden := []string{
        "database/sql",
        "net/http",
        "github.com/acme/billing/internal/adapter",
    }

    for _, imp := range pkg.Imports {
        for _, bad := range forbidden {
            if strings.HasPrefix(imp, bad) {
                t.Errorf("forbidden import in domain: %s", imp)
            }
        }
    }
}
```

Run it in CI. The architecture rule survives every PR.

### Where boundary tests live

- One per ring you care about. Domain first, then use cases, then adapters' isolation.
- Always under the package whose boundary they protect — the test should fail in *its* package, not at the top level.
- Keep them tiny. A boundary test that takes 50 lines is a small linter — extract it to a tool instead.

### The `go list` shortcut

For a quick CI gate without writing a test:

```bash
go list -f '{{ .ImportPath }}: {{ .Imports }}' ./internal/core/domain/... | \
  grep -E "(database/sql|net/http|internal/adapter)" && \
  { echo "boundary violation"; exit 1; } || true
```

Less elegant; equally effective.

---

## Modular Monoliths and Bounded Contexts

In a single Go module spanning multiple bounded contexts (billing, catalog, fulfilment), each context is a *mini* application with its own architecture. The module-wide layout becomes:

```
internal/
├── billing/
│   ├── core/{domain,port,service}
│   └── adapter/...
├── catalog/
│   ├── core/{domain,port,service}
│   └── adapter/...
└── fulfilment/
    ├── core/...
    └── adapter/...
```

### Hard rule for monoliths

**Contexts may not import each other's `core/` directly.** Cross-context calls go through:

- A *published* port in `pkg/` (rare — only when the contract is stable enough), or
- An adapter in the consumer that calls the producer's HTTP/gRPC API, or
- An in-process event bus where the producer publishes domain events.

The rule keeps each context independently testable and, more importantly, independently *extractable* if you ever need to break the monolith into services. A monolith that violates this rule cannot be split without a rewrite; one that respects it can be split context-by-context as load grows.

### Bounded contexts and the four patterns

Inside a context, any of the four patterns is fine. Different contexts can pick different patterns — the simple billing context can be layered while the rich catalog context is onion. The module-wide consistency is at the *seams between contexts*, not within them.

This trade-off — one pattern per repo vs one pattern per context — is the most underdiscussed lever a senior has. Picking the wrong one wastes years.

---

## When Patterns Become Overhead

A pattern is overhead when its cost line crosses its benefit line. Signals:

- **The interfaces have one implementation each, with no plan for a second.** Each interface is a 4-line cost with no proportional benefit.
- **The DTO conversion code is longer than the business code.** "Hexagonal makes us good" — but the hexagonal layer is now 80% mapping and 20% logic.
- **Engineers ask "where do I put this?"** more than they ask "how should this work?" Cognitive overhead has consumed the design budget.
- **Every PR touches three or four packages for a one-line semantic change.** The pattern is enforcing fragmentation, not modularity.

### What to do when overhead wins

Three honest moves:

1. **Collapse interfaces with one impl.** Delete the port; reference the concrete type. The day a second impl arrives, re-add the port. YAGNI applied retroactively.
2. **Collapse layers that never swap.** If `service` and `usecase` always change together, they are one layer with two folders. Merge them.
3. **Stop adding files for ceremony.** A use case that is two lines does not need its own file with `Input`/`Output` structs and a New constructor. Make it a method.

The willingness to *delete* architecture is the senior signal. Adding architecture is celebrated; subtracting it requires courage and, usually, the political capital of a senior.

---

## Anti-Patterns That Survive Code Review

These tend to slip through because they look like good practice from a distance.

### The "abstract base service"

```go
// internal/core/service/base.go
type BaseService struct {
    Logger *slog.Logger
    DB     *sql.DB           // <-- already wrong: core has SQL
    Cache  redis.Client
}
```

A "base service" carrying infrastructure handles defeats the dependency rule and exists for one reason: a junior wanted to avoid passing dependencies through constructors. The cost is that *every* service depends on Redis, even ones that never use it.

**Fix.** Pass dependencies explicitly. If you have many of them, accept that the constructor is long; that is feedback that the service has too many responsibilities.

### The "service that returns DTOs"

```go
// in internal/core/service/order.go
func (s *OrderService) Get(id string) (*OrderDTO, error) { ... }
type OrderDTO struct { ID, Name string `json:"id,name"` }
```

The core has just imported HTTP/JSON concerns. The DTO belongs to the *adapter* (presenter), not the core.

**Fix.** Core returns domain types. The HTTP adapter constructs the DTO. The CLI adapter constructs the table row. Each adapter owns its serialisation.

### The "interface for the database driver"

```go
type DB interface { Exec(...) }
type OrderRepo struct { db DB }
```

Wrapping `*sql.DB` in your own `DB` interface to "abstract the database" gains nothing. The `*sql.DB` API is already an abstraction; the new wrapper is a layer that does not pay rent.

**Fix.** Take `*sql.DB` directly in the adapter. The *port* is `OrderRepository`, not `DB`. The Postgres adapter holds a `*sql.DB`; the in-memory adapter holds a map. Both implement `OrderRepository` — that is the abstraction that matters.

### The "every package has a `Manager`"

```go
internal/order/manager.go
internal/billing/manager.go
internal/notification/manager.go
```

`Manager` is a name that does not mean anything. Replace it with a noun: `OrderService`, `BillingProcessor`, `NotificationDispatcher`. Names are part of the architecture.

### The "shared types package"

```go
internal/shared/types/...
internal/common/...
internal/utils/...
```

These packages start small and become unmaintainable. Every domain has a different `User`. Forcing them into one shared type creates leaky coupling. The pattern that *looks* like DRY is, at the bounded-context level, anti-DRY.

**Fix.** Each context owns its own types. Two `User` structs in two contexts is not duplication if the meanings differ.

---

## Refactoring Toward a Pattern Without a Big Bang

Senior refactors are small, safe, and reviewable. The recipe:

1. **Add tests at the seams that exist today.** You cannot move what you cannot verify.
2. **Make one move per PR.** Move `repo/` to `adapter/secondary/postgres/`. Stop. Get review. Merge. *Then* move the next folder.
3. **Add the lint rule the moment a layer's job is clear.** Do not let the rule drift from the code.
4. **Communicate.** Architecture refactors fail when teammates see new folders and assume a quiet new opinion. Open the conversation; document the target.

### The "facade for the migration" trick

When a multi-PR refactor would otherwise leave the codebase half-broken between merges, introduce a temporary facade that exposes the new shape while the old code is moved underneath:

```go
// internal/core/service/order.go (the new home)
package service

import oldsvc "github.com/acme/app/internal/service" // legacy
type OrderService = oldsvc.OrderService               // alias!
```

The alias is a temporary signpost. New code imports the new path. Old code stays where it is. After everyone has migrated their imports, delete the alias and the legacy package together.

This trick is well-known in Go because type aliases (`type X = Y`) make package re-shaping zero-cost at runtime.

---

## Senior-Level Checklist

- [ ] You can name the dependency-direction rule for your codebase in one sentence.
- [ ] The rule is enforced by tooling (`depguard`, `go-arch-lint`, or custom), not goodwill.
- [ ] You have at least one boundary test that fails when the rule is broken.
- [ ] Composition lives in `cmd/<binary>/main.go`, not in `init()` or globals.
- [ ] You can describe, in 60 seconds, why this codebase chose its pattern over the others.
- [ ] You know the next migration step (e.g., "we go hexagonal when the second driver lands").
- [ ] You have *deleted* architectural code in the last six months. If not, you may be hoarding overhead.

---

## Summary

Architecture is a cost function. Patterns earn their keep through specific, measurable benefits — replaceable infrastructure, fast tests, independent reasoning, parallel team work — not through aesthetics. Choose deliberately, enforce by tooling, and *delete* patterns that have stopped paying.

The hardest senior skill is willingness to subtract. Adding architecture is rewarded socially; subtracting it is the actual measure of taste.

For the deeper material — full clean architecture, hexagonal, DDD, CQRS, event sourcing, dependency injection — see [`../../19-architecture-patterns/`](../../19-architecture-patterns/). The next file, [`professional.md`](professional.md), covers static-analysis enforcement of the rules introduced here.

---

[← Middle](middle.md) · [Professional →](professional.md)
