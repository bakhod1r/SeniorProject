# Project Layout — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. No full solutions inline; just enough to get you unstuck.

---

## Easy

### Task 1 — From flat to one package

Start with this layout:

```
hello/
├── go.mod              (module example.com/hello)
└── main.go             (package main)
```

`main.go` contains a `Greet(name string) string` function and uses it from `main()`.

Goal: extract `Greet` into a new package `greet/` with import path `example.com/hello/greet`. After the move:
- `main.go` calls `greet.Greet("world")`.
- `greet/greet.go` declares `package greet` and exports the function.
- `go run .` still prints the same output.

**Hint.** A directory-name-equals-package-name convention will save you. The export rule (capital first letter) matters.

---

### Task 2 — Add `internal/`

Continue from Task 1. Move `greet/` to `internal/greet/`. Verify:
- `go build ./...` still succeeds.
- The import in `main.go` becomes `example.com/hello/internal/greet`.
- If you copy the project under a different module path and try to import the old `internal/greet`, the build fails.

**Hint.** Use `gopls rename` (or your editor's "move package") to update imports automatically.

---

### Task 3 — Two binaries from one repo

Convert your single-binary project into a two-binary repo:

```
hello/
├── cmd/
│   ├── server/main.go     (HTTP server, prints "hello, <name>" on /)
│   └── cli/main.go        (prints "hello, <name>" to stdout)
└── internal/
    └── greet/
```

Both binaries use `internal/greet`. Build each with `go build ./cmd/server` and `go build ./cmd/cli`. Confirm they produce two separate binaries.

**Hint.** Each `cmd/<bin>/main.go` declares `package main` and has its own `func main()`. They cannot import each other.

---

### Task 4 — Add `testdata/` correctly

Add a unit test for `internal/greet/Greet` that reads its expected output from a golden file. The golden file lives at `internal/greet/testdata/golden.txt`. Verify:
- The test passes when the file content matches the function output.
- `go list ./...` does not list `testdata` as a package.
- `go build ./...` succeeds without trying to compile `testdata/`.

**Hint.** Use `os.ReadFile("testdata/golden.txt")` from inside the test. The current working directory of a test is the test package's directory.

---

### Task 5 — Recognize a layout

Clone any popular Go project (try `github.com/spf13/cobra` or `github.com/grpc/grpc-go`). Run:

```bash
tree -L 2 -d
```

Identify:
- Where is the entrypoint (or, for a library, the public package)?
- Is there an `internal/`? What is in it?
- Is there a `cmd/`? How many binaries?
- Is there a `pkg/`? What does it contain?

Write a one-paragraph summary of the layout in your own words.

**Hint.** Reading layouts is a trainable skill. Practice on three different repos to see the spectrum.

---

## Medium

### Task 6 — Domain split

You have this:

```
internal/
└── store/
    ├── store.go        (interface and constructor)
    ├── user.go         (UserRepo methods on *PG)
    ├── order.go        (OrderRepo methods on *PG)
    ├── billing.go      (BillingRepo methods on *PG)
    └── pg.go           (database connection)
```

Refactor into a layout where each domain has its own subpackage:

```
internal/
└── store/
    ├── pg/             (the *PG type and connection)
    ├── user/           (UserRepo, depends on pg)
    ├── order/
    └── billing/
```

Verify:
- All existing tests still pass.
- No import cycle: nothing under `user/` imports `order/`, etc.
- The top-level `internal/store/store.go` (if it remains) is a thin re-export or removed entirely.

**Hint.** The `*PG` type may need to be passed to each repo constructor instead of being the receiver. Functional separation matters.

---

### Task 7 — Build a layout decision

You are starting a new project with these requirements:
- One HTTP server (the main product).
- One CLI tool for ops (`migrate`, `seed`, `dump-users`).
- One worker process consuming a Kafka topic.
- All three share user/order types and Postgres access.
- One team for now; expecting to grow to two within a year.

Sketch the directory tree. Justify each top-level folder. Identify which packages should be `internal/` and why. Decide if you would use `pkg/`. Decide if you would use a workspace.

**Hint.** There is no single right answer. Document the trade-offs you considered. Your future self (or a code reviewer) will read this.

---

### Task 8 — Split a fat package

Find or create a Go package with at least 600 lines spanning three or more concerns (e.g., a `util` or `helpers` package). Refactor:
1. Identify cohesive groups of functions.
2. Promote each group to its own package.
3. Update imports.
4. Run all tests.

Document: what was the original package called, what are the new packages called, how many importers were affected, did you find any unused code along the way?

**Hint.** `go list -f '{{.Imports}}' ./...` shows what each package imports. `grep -r "old/util"` shows what imports the old package.

---

### Task 9 — Enforce a boundary with `depguard`

Configure `golangci-lint` with `depguard` to enforce a single rule: no file under `internal/domain/` may import a package whose name contains `sql` or `pgx`. Verify:
- The lint passes when the rule holds.
- The lint fails when you deliberately add `import "database/sql"` to a file in `internal/domain/`.

**Hint.** The `depguard` configuration goes in `.golangci.yml`. Run `golangci-lint run` to test.

---

### Task 10 — Workspace setup

Create a multi-module monorepo with:

```
acme/
├── go.work
├── shared/             (module github.com/acme/shared)
│   ├── go.mod
│   └── types/
│       └── types.go
└── service/            (module github.com/acme/service)
    ├── go.mod
    ├── cmd/service/main.go
    └── internal/
```

`shared/types/types.go` defines a `User` struct. `service/internal/` uses it via `github.com/acme/shared/types`. The workspace stitches them together.

Verify:
- `cd service && go build ./...` works (uses the workspace).
- Edit `shared/types/types.go`; the change is picked up immediately by `service` without `go get`.
- `cd service && GOWORK=off go build ./...` fails because the shared module is not in `service/go.mod`'s requires.

**Hint.** `go work init`, `go work use`, then add the second module.

---

### Task 11 — Move from technical to domain layout

Take a small project (yours or a sample) currently using:

```
internal/
├── handlers/    (5+ files)
├── services/    (5+ files)
└── repositories/ (5+ files)
```

Refactor to:

```
internal/
├── user/       (handler + service + repo for user)
├── order/      (handler + service + repo for order)
└── billing/
```

Document: which features moved, which broke during the move, what you discovered about coupling that the technical layout was hiding.

**Hint.** Move one feature at a time. Each move is one commit. The codebase should compile and pass tests after every commit.

---

## Hard

### Task 12 — Refactor an existing repo

Find a Go open-source project with at least 1,000 lines that has a layout you find unpleasant (a `util/` package, deeply nested directories, a `pkg/` that contains nothing public). On a fork:
1. Document the current layout and your critique.
2. Propose a new layout.
3. Implement the refactor on a branch.
4. Open a draft PR (do not actually merge into upstream — this is for your practice).

Compare CI run times, build times, and `go list -deps` output before and after.

**Hint.** Focus on small wins. A complete rewrite is rarely accepted; a focused improvement to one corner of the layout often is.

---

### Task 13 — Multi-binary CLI consolidation

You have a `cmd/` directory with 12 small operational binaries (`migrate`, `seed`, `dump-users`, `import-csv`, etc.). Each has a 50-line `main.go`. Refactor into a single `cmd/admin/` binary that uses `cobra` (or any CLI framework) to expose subcommands:

```
admin migrate
admin seed
admin dump users
admin import csv <file>
```

Verify:
- The single binary is smaller than the sum of the 12 individual binaries (or larger by a justifiable amount due to the framework).
- Every original behaviour is preserved.
- Container image size is smaller.

**Hint.** Each former `main.go` becomes a `command.RegisterX` call. The argument parsing is unified. Common helpers (config loading, logging) move to `internal/admin/`.

---

### Task 14 — Architecture lint with custom analyzer

Write a `go/analysis.Analyzer` that fails when any file under `internal/domain/` imports a package whose path contains `database/sql`, `net/http`, or `pgx`. Run it:
1. As a unit test: `analysistest.Run`.
2. As a CLI tool that any developer can run.
3. In CI: integrate into the pipeline so violating PRs are rejected.

Verify the test catches a deliberate violation and passes on clean code.

**Hint.** The `golang.org/x/tools/go/analysis` package has examples. The `imports` field of `analysis.Pass` gives you what you need.

---

### Task 15 — Generate the import graph

Write a small tool (or use `goda`) that produces a `.dot` graph of your project's import structure. Render with Graphviz. Save the rendered diagram in `docs/` for the next code review.

Bonus: have the tool fail CI if any package imports more than N other internal packages, where N is configurable. This catches "hub" packages early.

**Hint.** `go list -deps -f '{{.ImportPath}} {{.Imports}}' ./...` produces the raw edges.

---

### Task 16 — Promote a private package to public

Take a package currently at `internal/client/`. Decide it should be public: external consumers will `go get` your module and import it. Steps:
1. Move the package: `git mv internal/client client` (or to `pkg/client/`).
2. Add a `doc.go` describing the package's purpose, guarantees, and stability.
3. Audit the public API: every exported function/type/constant becomes a forever commitment. Remove what you cannot defend.
4. Tag a `v1.0.0` release.
5. Verify another module can `go get` and use it.

**Hint.** Once `v1.0.0` ships, every breaking change requires a `v2`. Be deliberate about what you expose.

---

### Task 17 — Split a service into its own module

Take a single-module monorepo with two services and one shared library. Convert it to a multi-module monorepo:

```
acme/
├── go.work
├── shared/
│   ├── go.mod
│   └── ...
├── service-a/
│   ├── go.mod
│   ├── cmd/
│   └── internal/
└── service-b/
    ├── go.mod
    ├── cmd/
    └── internal/
```

Verify:
- Each service builds independently: `cd service-a && go build ./...`.
- Local refactors across modules work via the workspace.
- CI builds each module with workspaces disabled (`GOWORK=off`) and they all pass.

Document which imports broke during the split and how you fixed them.

**Hint.** The shared library's path becomes `github.com/acme/shared/...` (or wherever the new module lives). Every service's imports of shared code must use the new path.

---

### Task 18 — Layout case study

Pick a layout decision you have seen in real code that you think is wrong. Write a 500-word memo:
1. What is the layout?
2. What problem does it claim to solve?
3. What does it actually do?
4. What would you do instead?
5. What is the migration plan?

Share with a peer and get their critique. Iterate.

**Hint.** Layout decisions are easier to defend on a whiteboard than in prose. Force yourself to write the prose — it sharpens the reasoning.

---

## Solution sketches

Brief hints to unblock you, not full solutions.

### Sketch 1 — Task 1

`greet/greet.go`:

```go
package greet

func Greet(name string) string {
    return "hello, " + name
}
```

`main.go`:

```go
import "example.com/hello/greet"
// ...
fmt.Println(greet.Greet("world"))
```

### Sketch 6 — Task 6 (`pg` shared type)

```go
// internal/store/pg/pg.go
package pg

type DB struct{ /* connection */ }

func New(dsn string) (*DB, error) { /* ... */ }
```

```go
// internal/store/user/user.go
package user

import "example.com/myapp/internal/store/pg"

type Repo struct{ db *pg.DB }
func New(db *pg.DB) *Repo { return &Repo{db: db} }
func (r *Repo) GetUser(id int64) (*User, error) { /* ... */ }
```

### Sketch 9 — Task 9 (depguard)

`.golangci.yml`:

```yaml
linters:
  enable:
    - depguard
linters-settings:
  depguard:
    rules:
      domain-purity:
        files:
          - "**/internal/domain/**"
        deny:
          - pkg: "database/sql"
            desc: "domain must not depend on SQL"
          - pkg: "github.com/jackc/pgx/v5"
            desc: "domain must not depend on pgx"
```

### Sketch 13 — Task 13 (`cobra` consolidation)

```go
// cmd/admin/main.go
package main

import (
    "example.com/myapp/internal/admin"
    "github.com/spf13/cobra"
)

func main() {
    root := &cobra.Command{Use: "admin"}
    root.AddCommand(admin.MigrateCmd(), admin.SeedCmd(), admin.DumpCmd())
    root.Execute()
}
```

Each `MigrateCmd`, `SeedCmd`, etc. lives under `internal/admin/<feature>/cmd.go`.

### Sketch 14 — Task 14 (analyzer skeleton)

```go
package nodbindomain

import (
    "strings"

    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "nodbindomain",
    Doc:  "ensure internal/domain does not import database packages",
    Run: func(pass *analysis.Pass) (any, error) {
        if !strings.Contains(pass.Pkg.Path(), "/internal/domain") {
            return nil, nil
        }
        for _, imp := range pass.Pkg.Imports() {
            switch imp.Path() {
            case "database/sql":
                pass.Reportf(0, "domain may not import database/sql")
            }
        }
        return nil, nil
    },
}
```

Wire it into `analysistest.Run` for unit testing and into a `cmd/<analyzer>/main.go` for CLI use.

---

Each task is a chance to get a layout decision wrong, see the consequences, and fix it. That is the only way to develop the instincts the senior level demands.
