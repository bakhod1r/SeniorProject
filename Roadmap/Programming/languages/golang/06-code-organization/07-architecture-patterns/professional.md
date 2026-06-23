# Architecture Patterns — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why Tooling, Not Vigilance](#why-tooling-not-vigilance)
3. [How Go's Package System Interacts with These Patterns](#how-gos-package-system-interacts-with-these-patterns)
4. [`depguard`: Per-Package Import Bans](#depguard-per-package-import-bans)
5. [`go-arch-lint`: Component-Graph Rules](#go-arch-lint-component-graph-rules)
6. [Custom Analyzers with `golang.org/x/tools/go/analysis`](#custom-analyzers-with-golangorgxtoolsgoanalysis)
7. [Build-Time vs Runtime Checks](#build-time-vs-runtime-checks)
8. [Build Tags as a Coarser Boundary](#build-tags-as-a-coarser-boundary)
9. [`internal/` and Module Boundaries](#internal-and-module-boundaries)
10. [Integrating Enforcement into CI](#integrating-enforcement-into-ci)
11. [Operating an Architecture Test Suite](#operating-an-architecture-test-suite)
12. [Edge Cases the Tools Miss](#edge-cases-the-tools-miss)
13. [Summary](#summary)

---

## Introduction

This file is for the engineers who *operate* an architecture, not just choose one. Once a Go service is past a few thousand lines, the architectural rules survive only if they are checked on every PR by a tool that does not get tired.

After reading this you will:

- Pick the right enforcement tool — `depguard`, `go-arch-lint`, or a custom analyzer — for each kind of rule.
- Write rules that fail the build the first time they are violated, not the tenth.
- Know which checks Go's own package system already enforces (and which it does not).
- Build a small custom analyzer for rules off the shelf does not cover.
- Wire the checks into a CI pipeline that does not slow down development.

For deeper conceptual treatments of the patterns themselves, see [`../../19-architecture-patterns/`](../../19-architecture-patterns/).

---

## Why Tooling, Not Vigilance

A rule like "core must not import adapter" has three lifetimes:

1. **Day 0.** The architect knows the rule. Compliance is 100%.
2. **Month 6.** Half the team has joined since day 0. They have read the rule once. Compliance drifts.
3. **Year 2.** A new contributor adds `import "internal/adapter/postgres"` in `internal/core/service/order.go` because it is convenient. The reviewer is tired. The PR merges.

A linter that fails the build at month 6 keeps year 2 honest. A README that "documents the rule" does not. The senior playbook is:

- Every architectural rule has at least one machine check.
- Checks live in the repo, run in CI, and block merges.
- The cost of writing the check is amortised across years of saved drift.

The remainder of this file is the menu of checks.

---

## How Go's Package System Interacts with These Patterns

Go is unusually friendly to architectural enforcement, because three language features already do free work:

- **No cyclic imports.** The compiler refuses them. This single rule prevents the worst architectural mess most languages suffer.
- **`internal/` packages.** A package under `.../internal/...` can be imported only from within the subtree rooted at the parent of `internal/`. Documented at [go.dev/ref/mod#vcs-import](https://go.dev/ref/mod). This is *language-level* enforcement of the outermost boundary.
- **No package privacy beyond `internal/`.** This is not a feature, but a useful constraint: if you want a package to be off-limits to certain importers, your only weapon is `internal/` placement plus tooling. There is no `module-private` keyword. So tooling is unavoidable for finer rules.

What Go *does not* enforce:

- "Domain may not import database/sql." Go has no built-in concept of "domain."
- "Adapter A may not import adapter B." Both are under `internal/adapter/`; Go is happy.
- "This interface is implemented exactly once and the implementation lives in package X." Go's structural typing does not care.

These are exactly the rules tools exist to enforce.

---

## `depguard`: Per-Package Import Bans

[`depguard`](https://github.com/OpenPeeDeeP/depguard) is a `golangci-lint`-integrated linter that reads a YAML rule list and forbids specific imports per package or directory glob. It is the workhorse for "package X may not import Y."

### A typical configuration for hexagonal Go

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
          - "$all"
          - "!**/internal/adapter/**"
          - "!**/cmd/**"
        files-include:
          - "**/internal/core/**"
        deny:
          - pkg: "github.com/acme/billing/internal/adapter"
            desc: "core must not import adapter packages"
          - pkg: "database/sql"
            desc: "core must not touch SQL drivers"
          - pkg: "net/http"
            desc: "core must not depend on HTTP types"
          - pkg: "github.com/spf13/viper"
            desc: "core must not read configuration directly"

      adapters-do-not-cross:
        files:
          - "**/internal/adapter/secondary/postgres/**"
        deny:
          - pkg: "github.com/acme/billing/internal/adapter/secondary/redis"
          - pkg: "github.com/acme/billing/internal/adapter/secondary/stripe"

      domain-is-pure-go:
        files:
          - "**/internal/core/domain/**"
        deny:
          - pkg: "context"
            desc: "domain types do not need context"
          - pkg: "github.com/acme/billing/internal/core/port"
            desc: "domain must not depend on ports"
```

Three rules — three real architectural commitments:

1. The core ring stays pure.
2. Adapters do not depend on each other (every adapter is independent).
3. The innermost ring (`domain`) is even purer than the rest of the core.

### Limits of `depguard`

- Rules match by *file glob*, not by *Go package*. Two packages in the same folder structure share a rule.
- `depguard` cannot express "package X must contain exactly one struct that implements interface Y."
- It cannot express "this `interface` may be implemented in package P only."

For these, reach for `go-arch-lint` or a custom analyzer.

---

## `go-arch-lint`: Component-Graph Rules

[`go-arch-lint`](https://github.com/fe3dback/go-arch-lint) treats your repository as a *graph of components* and lets you describe allowed and forbidden edges. It is more expressive than `depguard` for architectural rules because it lets you talk about whole rings, not individual packages.

### A configuration for the hexagonal layout

```yaml
# .go-arch-lint.yml
version: 3
workdir: .

components:
  domain:    { in: internal/core/domain/** }
  port:      { in: internal/core/port/** }
  service:   { in: internal/core/service/** }
  primary:   { in: internal/adapter/primary/** }
  secondary: { in: internal/adapter/secondary/** }
  cmd:       { in: cmd/** }

deps:
  domain:    {} # depends on nothing in this module
  port:      { mayDependOn: [domain] }
  service:   { mayDependOn: [domain, port] }
  primary:   { mayDependOn: [domain, port, service] }
  secondary: { mayDependOn: [domain, port] }
  cmd:       { mayDependOn: [domain, port, service, primary, secondary] }

excludeFilesRegExp:
  - ".*_test\\.go$"
```

Run:

```bash
go-arch-lint check
```

The tool walks the import graph and reports any edge that is not declared in `mayDependOn`. The output shows the file, the import, and the broken rule — actionable in CI.

### Why this is closer to "describe the diagram"

The picture in [`junior.md`](junior.md) becomes the configuration directly. Engineers can read the YAML and see the architecture; reviewers can see when a PR adds an edge that does not belong.

### Limits of `go-arch-lint`

- It checks *imports*, not behaviour. A package can have legal imports and still smuggle infrastructure through a bad interface.
- Glob-based component definitions are coarse. Splitting `secondary` into `secondary-postgres` and `secondary-redis` requires duplication.
- The rule grammar does not cover "this type must implement that interface" or "no `init()` in this package."

For those, write an analyzer.

---

## Custom Analyzers with `golang.org/x/tools/go/analysis`

When the off-the-shelf tools cannot say what you mean, write a small Go program. The standard library provides the framework: `golang.org/x/tools/go/analysis`.

### A minimal analyzer that bans `database/sql` in `internal/core`

```go
// internal/architest/cmd/nopureSQL/main.go
package main

import (
    "strings"

    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/singlechecker"
)

var Analyzer = &analysis.Analyzer{
    Name: "nopureSQL",
    Doc:  "disallows database/sql imports inside internal/core",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    if !strings.Contains(pass.Pkg.Path(), "/internal/core") {
        return nil, nil
    }
    for _, f := range pass.Files {
        for _, imp := range f.Imports {
            path := strings.Trim(imp.Path.Value, `"`)
            if path == "database/sql" {
                pass.Reportf(imp.Pos(),
                    "package %s must not import database/sql", pass.Pkg.Path())
            }
        }
    }
    return nil, nil
}

func main() { singlechecker.Main(Analyzer) }
```

Build and run:

```bash
go build -o ./bin/nopureSQL ./internal/architest/cmd/nopureSQL
./bin/nopureSQL ./...
```

The analyzer follows the same conventions as `vet` and any other static-analysis tool: stable, parallel-safe, and CI-friendly.

### What custom analyzers can encode

- "Every type ending in `Service` must have a constructor named `NewXxxService`."
- "No `init()` function in `internal/core/`."
- "Every interface declared in `internal/core/port/` must be satisfied by at least one type under `internal/adapter/`."
- "The `cmd/` packages are the only ones allowed to call `log.Fatal`."

These are the rules that your architecture *actually* embodies, beyond imports.

### When to write one

- Same architectural review comment shows up on five PRs in three weeks.
- The rule is non-obvious enough that the team forgets it.
- The rule cannot be expressed as a simple "ban this import."

A 100-line analyzer that survives three years has paid for itself many times.

---

## Build-Time vs Runtime Checks

The previous tools all run *before* the binary is built. They reject the PR; nothing reaches production. There are also runtime checks, with different trade-offs.

| Check | When it runs | Pros | Cons |
|---|---|---|---|
| Compiler (cyclic imports) | Build | Free; cannot be disabled | Coarse — only cycles |
| `internal/` rule | Build | Built into the toolchain | Coarse — only outermost boundary |
| `depguard` | `golangci-lint` run | Easy YAML rules | Glob-based, file-level |
| `go-arch-lint` | Stand-alone | Describes the diagram | YAML expressiveness limited |
| Custom analyzer | Stand-alone | Anything you can compute | You write and maintain it |
| Boundary test (`go test`) | Test time | Lives with the code, simple | Runs only when tested |
| Runtime panic (e.g. assert imports in init) | Boot | Catches dynamic violations | Production discovers the bug |

The senior preference is *build-time*, *PR-time*, *cheap*. Runtime panics for architectural violations are an admission that the build-time check was missed.

---

## Build Tags as a Coarser Boundary

When the rule is "this code must not be compiled into a particular binary," build tags do the job at the language level.

```go
//go:build !production

package fakegateway
```

`fakegateway` is now invisible to any build that uses `-tags production` (or that omits `!production`). This is useful for:

- In-memory adapters that should never appear in a production binary.
- Test helpers that ship as a Go file but should not pollute the production tree.
- Vendor-specific code that should be excluded from open-source distributions.

Build tags do not enforce architecture per se, but they are the right tool when "do not even compile this together" is what you mean.

---

## `internal/` and Module Boundaries

The single biggest free architectural feature is the `internal/` directory rule.

```
github.com/acme/billing/
├── internal/
│   └── secret/...      ← visible only inside billing
└── pkg/
    └── public/...      ← visible to other modules
```

If another module tries to `import "github.com/acme/billing/internal/secret"`, `go build` fails with:

```
package github.com/acme/billing/internal/secret is not allowed
```

This is *language-level* enforcement; it is not bypassable without source-modification of the host module. Use it deliberately:

- Default to `internal/`. You can always promote later.
- Move something to `pkg/` only when an external consumer is actually consuming it.
- For a multi-module monorepo, repeat the structure per module: `services/billing/internal/`, `services/catalog/internal/`. Each module's `internal/` is private to *that* module.

In a monorepo with one Go module, `internal/` is the only "private" boundary you have. Inside it, every package can import every other package — your tooling makes finer rules.

---

## Integrating Enforcement into CI

A practical pipeline:

```yaml
# .github/workflows/ci.yml (excerpt)
jobs:
  arch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23' }

      - run: go vet ./...
      - run: go test ./...

      - name: golangci-lint (depguard)
        uses: golangci/golangci-lint-action@v6
        with: { version: v1.59.1 }

      - name: go-arch-lint
        run: |
          go install github.com/fe3dback/go-arch-lint@latest
          go-arch-lint check

      - name: custom analyzers
        run: |
          go build -o ./bin/nopureSQL ./internal/architest/cmd/nopureSQL
          ./bin/nopureSQL ./...
```

The order matters: cheaper checks first. `go vet` catches obvious mistakes; `go test` catches behavioural regressions; `depguard` and `go-arch-lint` catch architectural drift; custom analyzers catch the project-specific rules.

### CI cost budget

If architectural checks add more than ~30 seconds to a typical PR build, review what they are doing. Most should be sub-second on a 50 KLOC codebase. If `go-arch-lint` is slow, reduce the component glob breadth; if a custom analyzer is slow, profile it.

---

## Operating an Architecture Test Suite

Treat the architectural rules as a *test suite* that lives alongside the unit tests.

### One file per rule

```
internal/architest/
├── domain_no_infra_test.go
├── adapters_independent_test.go
├── ports_implemented_test.go
└── cmd_only_logfatal_test.go
```

Each file fails for one reason. Reviewers can see exactly which rule has been broken.

### Periodic review

Every quarter:

1. List all the rules. Are any obsolete? Delete them.
2. Are there architectural review comments that recur on PRs but have no rule? Add a rule.
3. Has any rule been silenced (e.g., a `//nolint:depguard` comment)? Audit the silences.

A rule that is silenced more than once should either be removed or replaced. Living with permanent exemptions is silently giving up.

---

## Edge Cases the Tools Miss

Even with all of the above, some violations escape the linters.

- **Reflection-based imports.** A package that uses `reflect` to call into another can route around the import graph. Tools see only static imports.
- **`unsafe.Pointer` smuggling.** Same: bypasses the type system; bypasses the analyzer.
- **`runtime/debug.SetGCPercent` from a domain package.** It is not an import, but it is an infrastructural concern.
- **Network calls hidden in stdlib.** A core package importing `os/exec` or `net` does not look like an architecture violation; it is one.
- **Side effects in `init()`.** Domain code that registers itself in a global at import time has just become non-pure.

For these, the right tool is *code review with conventions*. No linter substitutes for a senior who reads the diff.

---

## Summary

Patterns survive only when the rules are checked by tooling, not by goodwill. Go's package system gives you cyclic-import detection and the `internal/` boundary for free; everything beyond that is a job for `depguard`, `go-arch-lint`, custom analyzers, or boundary tests.

Pick the cheapest tool that expresses the rule. Run it in CI. Treat the architectural rules as a small test suite that you maintain alongside unit tests. Delete rules that no longer pay; add rules when the same review comment shows up three times.

For deeper material — running the patterns at scale, evolving them, the trade-offs of each — see [`../../19-architecture-patterns/`](../../19-architecture-patterns/).

---

[← Senior](senior.md) · [Specification →](specification.md)
