# Architecture Patterns — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build (or refactor), what success looks like, and a hint for the expected outcome. The focus throughout is on *organization*: where each file lives, what it imports, and how the dependency rule is enforced. For deeper conceptual exercises see [`../../19-architecture-patterns/`](../../19-architecture-patterns/).

---

## Easy

### Task 1 — Recognise the pattern

You are given the following Go module trees. For each, name the architecture pattern in use.

**A.**
```
cmd/api/main.go
internal/handler/
internal/service/
internal/domain/
internal/repo/
```

**B.**
```
cmd/api/main.go
internal/core/domain/
internal/core/port/
internal/core/service/
internal/adapter/primary/http/
internal/adapter/secondary/postgres/
```

**C.**
```
cmd/api/main.go
internal/entity/
internal/usecase/place_order.go
internal/usecase/cancel_order.go
internal/adapter/http/
internal/adapter/repository/
```

**D.**
```
cmd/api/main.go
internal/domain/model/
internal/domain/service/
internal/application/
internal/infrastructure/
```

**Goal.** Build pattern-recognition reflex. Answers at the end of this file.

---

### Task 2 — Sketch a layered service

Design (on paper, no code) the folder tree for a Go service that exposes a single endpoint `POST /tasks` for creating a to-do task and stores tasks in Postgres. Use layered architecture. Every folder you list must have a one-sentence justification.

**Goal.** Practise the smallest pattern.

---

### Task 3 — Spot the leak

Given this `internal/domain/order.go`, name the architectural violation:

```go
package domain

import (
    "database/sql"
    "errors"
)

type Order struct {
    ID    string
    Total int64
    DB    *sql.DB
}

func (o *Order) Validate() error {
    if o.Total <= 0 { return errors.New("invalid total") }
    return nil
}
```

**Goal.** Train your eye for "domain knows about infrastructure."

---

### Task 4 — Write a boundary test

For a Go module rooted at `github.com/me/shop`, write a test under `internal/core/domain/` that fails if the package imports `database/sql`, `net/http`, or anything under `internal/adapter/`. Use the `go/build` package or `go list`.

**Goal.** Make the architecture *executable*.

---

### Task 5 — From flat package to layered

Take a real or mock Go file containing all of:

- HTTP handler
- SQL queries
- business validation
- struct definitions

…and split it into four packages — `handler`, `service`, `domain`, `repo` — preserving behaviour. Run the original tests; they must still pass.

**Goal.** Mechanical experience of "split by layer."

---

## Medium

### Task 6 — Convert layered to hexagonal

Starting from a small layered service (your own or one from Task 5):

1. Create `internal/core/port/` and move every interface declared in `service` into it.
2. Rename `internal/repo/` to `internal/adapter/secondary/postgres/`.
3. Rename `internal/handler/` to `internal/adapter/primary/http/`.
4. Rename `internal/service/` to `internal/core/service/`.
5. Verify: `internal/core/` does not import any `internal/adapter/...`.
6. Run the test suite.

**Goal.** Practise the most common pattern migration.

---

### Task 7 — Add an in-memory adapter

After Task 6, add `internal/adapter/secondary/memory/` containing a `OrderRepo` that implements the same `port.OrderRepository` interface using a `map[OrderID]*Order`. Write a unit test for the core service that uses the in-memory adapter and runs in <10 ms.

**Goal.** Demonstrate the testing payoff of hexagonal.

---

### Task 8 — Wire two binaries that share a core

Take a hexagonal service and add a second binary `cmd/worker/main.go` that consumes from a fake "queue" (a channel in memory or a Kafka client) and calls the same core service. Both binaries must:

- Live under `cmd/`.
- Import the same `internal/core/` packages.
- Pull in different primary adapters.

**Goal.** Prove that hexagonal makes "the same logic, different drivers" cheap.

---

### Task 9 — Identify dependency-direction violations

Given a Go module of your choice (or one constructed by an instructor), generate the import graph using:

```bash
go list -f '{{ .ImportPath }} -> {{ join .Imports " " }}' ./internal/...
```

…and identify every edge that violates a stated dependency rule (e.g., "core does not import adapter," "adapter does not import other adapter"). Produce a numbered list.

**Goal.** Familiarity with `go list` as an architectural inspection tool.

---

### Task 10 — Add a `depguard` rule

In a Go module of your choice, add a `.golangci.yml` with a `depguard` rule that forbids `internal/core/**` from importing `database/sql`, `net/http`, or anything under `internal/adapter/`. Confirm the rule fires when you intentionally introduce a violation.

**Goal.** Encode an architectural rule as machine-checked configuration.

---

### Task 11 — Convert layered to clean

Take the layered service from Task 5 and convert it to clean architecture:

1. Rename `internal/domain/` → `internal/entity/`.
2. Rename `internal/service/` → `internal/usecase/`.
3. Make each use case a single file with one struct and one method (`Execute` or `Handle`).
4. Move shared interfaces into `internal/usecase/ports.go`.
5. Verify the dependency rule: `entity` imports nothing from this module; `usecase` imports `entity` and its own `ports`; `adapter` imports `entity` and `usecase`.

**Goal.** Practise the layered → clean migration.

---

### Task 12 — Reorganise from layer-first to feature-first

Take a layered or hexagonal service with three or more entities (`order`, `invoice`, `user`). Refactor `internal/` so that each *feature* is a sub-package containing all its layers:

```
internal/order/{handler,service,domain,repo}
internal/invoice/{handler,service,domain,repo}
internal/user/{handler,service,domain,repo}
```

Then refactor *back* to the hybrid:

```
internal/core/domain/{order,invoice,user}
internal/core/service/{order,invoice,user}
internal/adapter/primary/http/{order,invoice,user}
internal/adapter/secondary/postgres/{order,invoice,user}
```

Compare both layouts on:

- File count.
- Average files touched per typical feature change.
- Conceptual clarity for a new engineer.

**Goal.** Develop intuition for layer-vs-feature trade-offs.

---

## Hard

### Task 13 — Build a custom architecture analyzer

Using `golang.org/x/tools/go/analysis`, write a single-file analyzer that:

1. Walks every Go file in the module.
2. For each file under `internal/core/`, fails if it imports any of `database/sql`, `net/http`, or any package under `internal/adapter/`.
3. Outputs a `pass.Reportf` with the file, line, and the offending import.

Wire it into CI as a separate job that runs after `go test`.

**Goal.** Build an architectural rule that no off-the-shelf linter could express directly.

---

### Task 14 — Migrate hexagonal to clean without a big bang

Given a hexagonal Go service (~3 KLOC), migrate it to clean architecture in a sequence of small PRs:

- PR 1: rename `internal/core/domain/` → `internal/entity/` (alias-based to keep both paths working).
- PR 2: rename `internal/core/service/` → `internal/usecase/` (one use case per file).
- PR 3: move ports from `internal/core/port/` into `internal/usecase/ports.go`.
- PR 4: rename `internal/adapter/{primary,secondary}/` → `internal/adapter/`.
- PR 5: delete the aliases and the empty old directories.

Each PR must compile, pass tests, and be small enough to review in 30 minutes.

**Goal.** Practise the senior-level skill of refactoring without breaking the build.

---

### Task 15 — Detect "fake hexagonal"

You inherit a Go service that claims to be hexagonal. Suspect it is hexagonal in name only (the actual logic lives in the HTTP handlers).

Write a small Go program that, for every package under `internal/core/service/`, prints the line count of *non-test, non-comment Go code*. Do the same for `internal/adapter/primary/http/`. If `adapter/primary/http/` is more than 2× the size of `core/service/`, flag it as suspicious.

**Goal.** Build a measurement tool for "is the architecture working?"

---

### Task 16 — Architect a modular monolith

Design (on paper) a Go module containing three bounded contexts: `billing`, `catalog`, `fulfilment`. Specify:

- Folder layout under `internal/`.
- The pattern each context uses (you may pick differently per context — justify each).
- The cross-context communication mechanism (event bus, exposed port, HTTP).
- The `cmd/` binaries you would ship initially.
- Which architectural rules are enforced by Go's `internal/` rule, by `depguard`, and by custom analyzers.

Produce a short ARCHITECTURE.md (≤ 200 lines).

**Goal.** Practise multi-context architectural reasoning.

---

### Task 17 — Extract a context

Continuing from Task 16: extract `billing` from the monolith into its own Go module and its own service. The remaining contexts must continue to work, calling `billing` via HTTP/gRPC. List the steps in order, with the tests you would write at each step.

**Goal.** Prove that a well-architected monolith is extractable.

---

### Task 18 — Quarterly architectural cleanup

Pick a Go codebase you are familiar with (work, OSS, your own). Spend 2 hours on the following audit:

1. List every interface in `internal/core/port/` (or equivalent). For each, count its implementations. Flag any with exactly one.
2. List every package. For each, identify whether it has changed in the last 6 months. Flag any with no changes.
3. Run `gocyclo` on each function in `internal/core/`. Flag anything with cyclomatic complexity > 10.
4. Read `cmd/<binary>/main.go`. If it is over 200 lines, propose an extraction.
5. Produce a one-page summary: "what to delete, what to merge, what to keep."

**Goal.** Practise architectural *subtraction* — the senior skill that produces healthier codebases over time.

---

## Hints / Expected Outcomes

### Task 1 hints

A — layered. B — hexagonal. C — clean. D — onion.

### Task 2 hint

```
cmd/tasks-api/main.go             ← composition root
internal/
├── handler/task.go               ← HTTP I/O, request decode, response encode
├── service/task.go                ← validation + orchestration
├── domain/task.go                 ← Task struct, domain rules
└── repo/task.go                   ← Postgres queries
go.mod
```

A test for `service` mocks the repo; a test for `handler` mocks the service.

### Task 3 hint

The `Order` struct holds `*sql.DB`. Domain entities must not carry persistence handles. Move `*sql.DB` out of the domain into the repository; pass it through repository methods, not through the domain object.

### Task 4 hint

```go
package domain_test

import (
    "go/build"
    "strings"
    "testing"
)

func TestDomainHasNoForbiddenImports(t *testing.T) {
    p, err := build.Default.Import("github.com/me/shop/internal/core/domain", "", 0)
    if err != nil { t.Fatal(err) }
    forbidden := []string{"database/sql", "net/http", "github.com/me/shop/internal/adapter"}
    for _, imp := range p.Imports {
        for _, bad := range forbidden {
            if strings.HasPrefix(imp, bad) {
                t.Errorf("forbidden import: %s", imp)
            }
        }
    }
}
```

### Task 6 hint

Use `gopls rename` or `gofmt -r` to update import paths in bulk. After renames, run `go vet ./...` and `go test ./...` to catch missed updates.

### Task 7 hint

```go
package memory

type OrderRepo struct{ data map[domain.OrderID]*domain.Order }

func New() *OrderRepo { return &OrderRepo{data: map[domain.OrderID]*domain.Order{}} }

func (r *OrderRepo) Save(o *domain.Order) error {
    r.data[o.ID] = o; return nil
}
```

### Task 8 hint

The two `main.go` files share the wiring of `core/service`. They differ only in *which* primary adapter they construct. The core constructor signature does not change.

### Task 9 hint

```bash
go list -f '{{ .ImportPath }} -> {{ join .Imports " " }}' ./internal/... \
  | grep -E "internal/core.*->.*internal/adapter"
```

If the grep finds anything, you have a violation.

### Task 10 hint

```yaml
linters:
  enable: [depguard]
linters-settings:
  depguard:
    rules:
      core:
        files:
          - "**/internal/core/**"
        deny:
          - pkg: "database/sql"
          - pkg: "net/http"
          - pkg: "github.com/me/shop/internal/adapter"
```

### Task 11 hint

A clean use case is a small struct:

```go
package usecase

type PlaceOrder struct{ Repo OrderRepository }

func (p *PlaceOrder) Execute(o *entity.Order) error {
    if err := o.Validate(); err != nil { return err }
    return p.Repo.Save(o)
}
```

One file per use case keeps the package readable as it grows.

### Task 12 hint

Layer-first wins for *cross-cutting* changes (e.g., changing how all repos handle errors). Feature-first wins for *vertical* changes (adding one endpoint to one feature). The hybrid is best when the team grows past 4–5 engineers.

### Task 13 hint

```go
var Analyzer = &analysis.Analyzer{
    Name: "noinfra",
    Doc:  "core/** must not import infrastructure packages",
    Run:  func(p *analysis.Pass) (interface{}, error) {
        if !strings.Contains(p.Pkg.Path(), "/internal/core/") {
            return nil, nil
        }
        for _, f := range p.Files {
            for _, imp := range f.Imports {
                path := strings.Trim(imp.Path.Value, `"`)
                if path == "database/sql" || path == "net/http" ||
                   strings.Contains(path, "/internal/adapter/") {
                    p.Reportf(imp.Pos(), "forbidden import in core: %s", path)
                }
            }
        }
        return nil, nil
    },
}
```

### Task 14 hint

Type aliases (`type X = Y`) make package renames zero-cost. After PR 1:

```go
// internal/entity/order.go
package entity

import old "github.com/me/shop/internal/core/domain"

type Order = old.Order
```

This lets the rest of the code migrate import paths gradually. Delete the alias in PR 5.

### Task 15 hint

A typical "fake hexagonal" service has a 1500-line `adapter/primary/http/order.go` and a 50-line `core/service/order.go`. The ratio of those two line counts is a fast sniff test.

### Task 16 hint

A reasonable starting layout:

```
internal/
├── billing/
│   ├── core/{domain,port,service}
│   └── adapter/...
├── catalog/
│   └── ... (layered if simple)
├── fulfilment/
│   └── ... (hexagonal if complex)
└── shared/
    └── events/             ← cross-context event types (small, stable)
cmd/
├── api/main.go
├── worker-billing/main.go
└── worker-fulfilment/main.go
```

Cross-context calls go through `shared/events/` (an in-process bus or a wrapper around Kafka). Direct imports of another context's `internal/` are forbidden; enforce with a custom analyzer.

### Task 17 hint

Step-by-step:

1. Define an HTTP/gRPC contract for `billing`'s public operations.
2. Replace in-process calls in other contexts with calls to a `BillingClient` interface.
3. Implement `BillingClient` first as a direct struct delegating to the in-process billing core; then as an HTTP client.
4. Add a feature flag that switches between the two implementations at startup.
5. Move `billing/` to a new module `github.com/me/billing`. Update imports.
6. Run the system with the HTTP client. When stable, delete the in-process delegate.

Each step ships independently; rollback at any point is one PR.

### Task 18 hint

Aim to *delete* something. If the audit produces no deletions, you missed candidates; look harder. The healthiest senior signal is the willingness to remove a layer that was added "just in case."

---

[← Interview](interview.md) · [Find the Bug →](find-bug.md)
