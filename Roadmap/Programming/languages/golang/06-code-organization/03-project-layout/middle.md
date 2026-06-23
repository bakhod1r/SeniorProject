# Project Layout — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why Layout Matters Beyond Aesthetics](#why-layout-matters-beyond-aesthetics)
3. [The `golang-standards/project-layout` Debate](#the-golang-standardsproject-layout-debate)
4. [When to Introduce `internal/`](#when-to-introduce-internal)
5. [The `pkg/` Question](#the-pkg-question)
6. [Multi-Binary Repositories](#multi-binary-repositories)
7. [Domain-Driven vs Technical Layout](#domain-driven-vs-technical-layout)
8. [Monorepo vs Polyrepo](#monorepo-vs-polyrepo)
9. [Growing a Service from `main.go` to Production](#growing-a-service-from-maingo-to-production)
10. [Naming Conventions and Anti-Patterns](#naming-conventions-and-anti-patterns)
11. [API and Contract Folders](#api-and-contract-folders)
12. [Configs, Scripts, and Build Helpers](#configs-scripts-and-build-helpers)
13. [Choosing Between Layouts: A Decision Tree](#choosing-between-layouts-a-decision-tree)
14. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

At the junior level, you learned the mechanics: one directory is one package, `cmd/` for binaries, `internal/` for hiding code. That answers *what* the folders are. The middle-level job is *why* and *when*: why introduce `internal/` at all, when does `pkg/` add value, when does a monorepo turn into a tarball, and when does a tidy layout become an obstruction.

Project layout is not an architectural style on its own — it is the *expression* of architectural intent. A flat layout says "this project is small." A `cmd/` + `internal/` + `pkg/` layout says "this project ships multiple binaries and exposes a public API." Choosing layout is choosing how change will move through the codebase.

After reading this you will:
- Pick a layout for a new project that fits its size and scope, instead of cargo-culting one.
- Decide when to introduce `internal/`, `pkg/`, `api/` — and when not to.
- Lay out a multi-binary monorepo without import-cycle pain.
- Recognize when a layout is fighting your team and refactor toward something simpler.

---

## Why Layout Matters Beyond Aesthetics

A bad layout is not just ugly. It costs you in three concrete ways:

1. **Onboarding time.** A new engineer who cannot find the entrypoint or the database code in five minutes is going to ask in Slack, interrupt someone, and lose a chunk of their first day.
2. **Refactor cost.** Shared code in the wrong place forces awkward imports, then forces extracted-but-not-quite-right packages, then forces import cycles. Every wrong move compounds.
3. **Build-time isolation.** Go's incremental build cache keys on package directories. A layout where one feature change touches twenty packages re-compiles twenty packages. A layout where one feature change touches one package re-compiles one.

Good layout is invisible. Engineers find what they need, refactors are local, and CI runs are short. Bad layout is visible at every standup ("where do I put this?", "why is my build slow?", "why does the tests folder import the handlers folder?").

---

## The `golang-standards/project-layout` Debate

Visit [github.com/golang-standards/project-layout](https://github.com/golang-standards/project-layout) and you will see a tree with `cmd/`, `internal/`, `pkg/`, `api/`, `configs/`, `init/`, `scripts/`, `build/`, `deployments/`, `test/`, `docs/`, `tools/`, `examples/`, `third_party/`, `githooks/`, `assets/`, `website/`. Twenty top-level folders. Many newcomers treat this as the canonical Go layout.

It is not. Two facts matter:

1. **It is not endorsed by the Go team.** Russ Cox and other core maintainers have publicly criticized it. The repository's README itself acknowledges this — read it before you cite the template.
2. **Most Go projects use a much smaller subset.** The Kubernetes layout, the Go standard library layout, popular libraries like Cobra, gRPC, etcd — none of them follow the template literally.

What the template *does* do well: it surveys what real projects use, gives names to common patterns, and offers a starting checklist. What it does badly: it implies a level of formality that few projects need, and it lists folders (`init/`, `build/`, `deployments/`) that are arguably outside the source tree entirely.

**Practical guidance:**
- Use the template as a *menu*, not a recipe.
- Pick `cmd/`, `internal/`, and (maybe) `pkg/`. Add `api/`, `configs/`, `scripts/` if you actually have those artifacts.
- Skip everything else until you have a real reason. `deployments/` is usually a separate repo. `build/` is your `Dockerfile` and `Makefile`. `examples/` is a YAGNI risk.

The Go standard library, which is the closest thing Go has to a layout reference, has no `cmd/` per binary, no `pkg/`, no `internal/` at the root — its rules are different because it is a special-purpose mono-source-tree. Do not model your service on it.

---

## When to Introduce `internal/`

`internal/` is a real fence. Use it deliberately. Three reasons to introduce it:

### 1. You publish your repository as an importable module

The moment your repo's `go.mod` path is one that other modules might `go get`, you have a *public surface*. Anything not under `internal/` is, by Go's rules, fair game for outside consumers. They can import it, depend on its types, and break when you change them. Hide what you do not want to commit to. The default position should be: **everything is `internal/` until it is consciously promoted.**

### 2. Your repository is consumed inside a larger workspace

In a monorepo with a workspace (`go.work`), every module sees every other module's exports. `internal/` is the only mechanism that lets you tell a sibling module: "stay out of my private code." Without `internal/`, the workspace gives every module unfettered access.

### 3. You want to isolate teams within a single module

Even inside one module, nested `internal/` directories let one feature team protect its code from another:

```
internal/
├── billing/
│   └── internal/
│       └── store/      ← only billing/* may import
├── user/
│   └── internal/
│       └── store/      ← only user/* may import
```

The `internal/store` under `billing/` is reachable only by `billing/*`. The `internal/store` under `user/` is reachable only by `user/*`. The wall protects against accidental cross-team imports during late-night refactors.

### When you do not need `internal/`

- Your project is a leaf binary (a CLI tool, a one-off script). There is nothing to hide.
- Your project is a library with a tiny, intentional surface. Everything is public on purpose.
- You are at week one of a project. You can add `internal/` later with `gopls rename` in five minutes.

The mistake is not "I added `internal/` too early" — it is "I added it as decoration without understanding what it enforces."

---

## The `pkg/` Question

The `pkg/` debate is the most religious topic in Go layout. Three positions:

### Position A — `pkg/` is useful

Argument: a directory named `pkg/` clearly signals "this code is intended for external consumption." Combined with `internal/` (private) and `cmd/` (binaries), it forms a clean tri-partite layout: binaries, public, private.

```
myrepo/
├── cmd/        ← binaries
├── internal/   ← private code
└── pkg/        ← public code (libraries)
```

Used by: many large companies, the `golang-standards/project-layout` template, several CNCF projects.

### Position B — `pkg/` adds noise

Argument: in Go, by default everything is public. `pkg/` adds a redundant directory level to import paths (`github.com/foo/bar/pkg/client` instead of `github.com/foo/bar/client`). The `internal/` boundary already does the work; `pkg/` is just visual.

Used by: the Go standard library, many small to medium projects, many style guides written by experienced Go developers.

### Position C — Use `pkg/` only if your repo also has non-Go content

Argument: when a repository contains code in multiple languages (Go + TypeScript + Python), separating Go code into `pkg/` (and `cmd/`) clearly delineates the Go module. In a Go-only repo, the `pkg/` segment is dead weight.

```
mixed-repo/
├── go.mod
├── pkg/        ← Go library code
├── cmd/        ← Go binaries
├── ts/         ← TypeScript
└── py/         ← Python
```

This is a defensible compromise.

### Practical recommendation

- For **Go-only repos**, `pkg/` is optional and arguably noise. Skip it unless your team has already standardized on it.
- For **mixed-language repos**, `pkg/` clarifies which subtree the Go module covers.
- For **libraries published as `go get` modules**, never use `pkg/` — it forces consumers to write `import "your/lib/pkg/foo"` instead of the cleaner `import "your/lib/foo"`.

If you join a team that uses `pkg/`, follow the convention. If you start a new project, the burden of proof is on `pkg/` to justify its existence.

---

## Multi-Binary Repositories

A single binary lives at `main.go`. Two or more binaries need `cmd/<binary>/main.go`.

### Standard layout

```
myproject/
├── go.mod
├── cmd/
│   ├── server/
│   │   └── main.go
│   ├── worker/
│   │   └── main.go
│   └── cli/
│       └── main.go
└── internal/
    ├── app/         ← shared application logic
    ├── store/
    └── transport/
```

Each `cmd/<bin>/main.go` is a thin wrapper:

```go
package main

import (
    "log"
    "os"

    "example.com/myproject/internal/app"
)

func main() {
    if err := app.RunServer(os.Args[1:]); err != nil {
        log.Fatal(err)
    }
}
```

`worker/main.go` calls `app.RunWorker`; `cli/main.go` calls `app.RunCLI`. The branching happens through three different entrypoints, not one entrypoint with a `--mode` flag.

### Why three thin `main.go`s instead of one fat one?

- **Independent build.** `go build ./cmd/server` produces just the server binary, without compiling worker or CLI code. In production, smaller binaries mean smaller container images.
- **Independent linker flags.** Each binary can have different `-ldflags` for version stamping.
- **Independent build tags.** The CLI may exclude server-only code via `//go:build cli`.
- **Clearer dependency graph.** `go mod why` and `go list -m all` show what each binary actually needs.

### What to share, what not to share

- **Domain types** (User, Order, Invoice) → shared in `internal/domain/`.
- **Business operations** (CreateUser, ChargeInvoice) → shared in `internal/app/`.
- **Persistence** (Postgres queries, S3 access) → shared in `internal/store/`.
- **Transport** (HTTP handlers, gRPC servers) → split per binary if they differ; shared if they overlap.
- **Configuration loading** → shared in `internal/config/`.

### What about `cmd/<bin>/internal/`?

Yes — each `cmd/<bin>/` can have its own `internal/`:

```
cmd/server/
├── main.go
└── internal/
    └── routes/      ← only cmd/server/* may import
```

The `routes` package is invisible to the worker and CLI binaries. Use this when a piece of code is specific to one binary and you want to make accidental cross-imports impossible.

### Anti-pattern: The mega-`main.go`

```go
// BAD
package main

import "os"

func main() {
    switch os.Args[1] {
    case "server":
        runServer()
    case "worker":
        runWorker()
    case "cli":
        runCLI()
    }
}
```

This produces *one binary* that decides its role at runtime. Build size is the union of all three. Containers ship more code than they need. Linker flags can't differ. This is a common shortcut early in a project; refactor away from it as soon as you have a real second binary.

---

## Domain-Driven vs Technical Layout

There are two ways to organize `internal/`. Most projects start with one and evolve to the other.

### Technical layout (group by role)

```
internal/
├── handlers/        ← all HTTP handlers
├── services/        ← all business logic
├── repositories/    ← all database code
├── models/          ← all domain types
└── middleware/
```

This mirrors the Java / Spring style. It is intuitive at first.

**When it works:** Small projects (≤ 10 endpoints). Three layers stay readable.

**When it breaks:** Adding the "billing" feature touches `handlers/`, `services/`, `repositories/`, `models/`, `middleware/`. Five files in five different folders. Tomorrow's "shipping" feature does the same. After a year, every folder has 50 files and every diff is scattered.

### Domain layout (group by feature)

```
internal/
├── billing/
│   ├── handler.go
│   ├── service.go
│   ├── repository.go
│   └── types.go
├── user/
│   ├── handler.go
│   ├── service.go
│   ├── repository.go
│   └── types.go
└── shared/
    └── auth/
```

Each feature is a self-contained package. Adding "shipping" creates one new directory and touches no others.

**When it works:** Medium-to-large projects (10+ endpoints, multiple teams).

**When it breaks:** When features cross-cut significantly (auth touches every feature; billing depends on user). Then you need shared packages, and the temptation to make `shared/` a kitchen sink reappears.

### A pragmatic mixed layout

Most mature Go services land here:

```
internal/
├── domain/          ← types and business rules, no I/O
│   ├── user.go
│   ├── order.go
│   └── billing.go
├── store/           ← persistence; one file per aggregate
│   ├── user.go
│   ├── order.go
│   └── billing.go
├── http/            ← HTTP layer; one handler file per feature
│   ├── user.go
│   ├── order.go
│   └── billing.go
└── app/             ← orchestration; one file per use case
    ├── create_user.go
    ├── place_order.go
    └── charge_invoice.go
```

A new feature still touches multiple files, but each file is small and the structure is predictable. This is the layout most Go-shaped DDD projects converge on.

### Refactoring from technical to domain

When `services/` has 40 files and you cannot remember which is which, it is time. Move feature-by-feature, not all at once. Use `gopls rename`. Each move is one PR.

---

## Monorepo vs Polyrepo

A **polyrepo** is one repository per service, each with its own `go.mod`. A **monorepo** is many services in one repository, possibly with one or many `go.mod` files.

### Polyrepo

```
acme-user-service/
├── go.mod
├── cmd/user/
└── internal/

acme-billing-service/
├── go.mod
├── cmd/billing/
└── internal/

acme-shared/
├── go.mod
└── pkg/types/
```

Three repos, three modules. `acme-shared` is published; the services depend on it via `go get`.

**Pros:**
- Clear ownership per repo.
- Independent CI, independent release cadence.
- Easy to open-source one piece without releasing the rest.

**Cons:**
- Cross-repo refactors are painful: change `acme-shared`, tag, then update each consumer.
- Versioning every shared library, even tiny ones, is an overhead.
- Different teams drift on tooling, lint configs, Go versions.

### Single-module monorepo

```
acme/
├── go.mod          ← single module: github.com/acme/svc
├── cmd/
│   ├── user/
│   ├── billing/
│   └── inventory/
└── internal/
    ├── shared/
    ├── user/
    ├── billing/
    └── inventory/
```

One module, many binaries. Shared code is a normal `internal/` package; refactors are atomic.

**Pros:**
- Atomic refactors across all services.
- One `go.mod`, one `go.sum`, one toolchain version.
- One CI pipeline with shared linting/testing.

**Cons:**
- Every binary is built from one source tree; CI can be slow if not partitioned.
- Boundary enforcement relies on `internal/` discipline (or import-graph linters).
- The repo grows large; `git clone` takes longer.

### Multi-module monorepo (with `go.work`)

```
acme/
├── go.work
├── shared/
│   ├── go.mod
│   └── types/
├── user/
│   ├── go.mod
│   ├── cmd/
│   └── internal/
└── billing/
    ├── go.mod
    ├── cmd/
    └── internal/
```

Each service is its own module. A `go.work` file at the root stitches them together for local development; CI builds each module independently.

**Pros:**
- Hard module boundaries (each service has its own `go.mod` and dependency tree).
- Independent release cadence per module.
- Atomic local refactors via the workspace.

**Cons:**
- More complex tooling (every CI job needs to know which module it builds).
- `internal/` discipline still required between modules.
- Requires Go 1.18+ for workspace support.

### Choosing

| Situation | Recommendation |
|-----------|----------------|
| One team, ≤ 5 services | Single-module monorepo |
| Multiple teams, shared types, frequent cross-cutting changes | Single-module monorepo |
| Multiple teams, mostly independent services, want per-team release cadence | Multi-module monorepo with `go.work` |
| Open-source release per service, very different versioning | Polyrepo |
| You inherited a polyrepo and refactors hurt | Migrate toward monorepo, not deeper into polyrepo |

The industry has been trending monorepo-ward for a decade. The pain is real but local; the polyrepo pain is distributed and chronic.

---

## Growing a Service from `main.go` to Production

A typical evolution, told as a sequence of layouts.

### Phase 1 — Sketch (day 1)

```
myapp/
├── go.mod
└── main.go        ← 50 lines: HTTP server, one route, echoes request
```

You are exploring. Folders are noise. Stay flat.

### Phase 2 — First split (week 1)

`main.go` is 200 lines. Time to split:

```
myapp/
├── go.mod
├── main.go
├── server.go      ← HTTP setup
└── handler.go     ← request handling
```

Still `package main`, still flat. You added two files, no new packages.

### Phase 3 — First package (week 2)

You added a Postgres client. It is 300 lines and has its own tests:

```
myapp/
├── go.mod
├── main.go
├── server.go
└── store/
    ├── pg.go
    ├── pg_test.go
    └── store.go
```

`store` is a new package. Imports become `example.com/myapp/store`. Tests run with `go test ./...`.

### Phase 4 — First `internal/` (month 1)

Your repo is on GitHub. You realize people might import `store` accidentally if your tags ever leak. Move it under `internal/`:

```
myapp/
├── go.mod
├── main.go
├── server.go
└── internal/
    └── store/
        ├── pg.go
        ├── pg_test.go
        └── store.go
```

A single `gopls rename` updates every reference. The build still works. Outsiders cannot import `internal/store`.

### Phase 5 — Second binary (month 3)

Product wants a CLI to backfill data. The CLI shares the store:

```
myapp/
├── go.mod
├── cmd/
│   ├── server/
│   │   └── main.go     ← was the old main.go
│   └── cli/
│       └── main.go     ← new
└── internal/
    └── store/
```

Now `go build ./cmd/server` and `go build ./cmd/cli` produce two binaries. Both import `internal/store`.

### Phase 6 — Domain split (month 6)

`internal/` has 20 files in one package. Refactor by feature:

```
internal/
├── domain/
├── store/
├── http/
└── app/
```

Each feature is a sub-package. Tests live next to code. Adding a feature touches 1–4 files in known places.

### Phase 7 — API contract (year 1)

You publish an OpenAPI spec. Add `api/`:

```
myapp/
├── api/openapi.yaml
├── cmd/
└── internal/
    └── http/        ← uses api/openapi.yaml as source of truth
```

Generated code from the spec lands in `internal/http/api/` (kept inside `internal/` to prevent leakage).

### Phase 8 — Multi-team (year 2)

A second team owns billing. Either:
- Keep one module, isolate billing under `internal/billing/internal/...` to prevent leaks; or
- Migrate to a multi-module monorepo with `go.work`.

The choice depends on how independent the teams need to be.

The trick is to **let the layout grow with the project**, not to over-anticipate. Each phase is a small refactor that is locally justified.

---

## Naming Conventions and Anti-Patterns

### Good package names

- Single word: `auth`, `user`, `store`, `http`, `tracing`.
- Lowercase, no underscores, no hyphens.
- Match the directory exactly.
- Describe the *thing*, not the layer (`tracing`, not `tracinghelpers`).

### Bad package names

- `util`, `common`, `helpers`, `misc` — dumping grounds.
- `models`, `entities` — too generic; what *kind* of model?
- `serverhttp`, `serverhttputil` — verbose, dilutes the name.
- `userpackage` — redundant; `package` is implied.

### Naming files

- `<feature>.go` and `<feature>_test.go`.
- For an interface and an implementation: `store.go` (interface), `pg.go` (Postgres impl), `memory.go` (in-memory impl).
- One concept per file when files exceed 300 lines.
- Avoid `helpers.go`, `utils.go` — promote helpers into named files.

### Anti-pattern: A package per type

```
internal/
├── user/
│   └── user.go        ← only User type
├── order/
│   └── order.go       ← only Order type
├── invoice/
│   └── invoice.go     ← only Invoice type
```

If each package has one file with one type, you are using packages as namespaces — Go does not need that. Combine into `internal/domain/` with `user.go`, `order.go`, `invoice.go`.

---

## API and Contract Folders

For services with formal API contracts:

```
api/
├── openapi.yaml             ← REST contract (OpenAPI 3.x)
├── proto/
│   └── billing/v1/billing.proto  ← gRPC
└── jsonschema/
    └── events.json          ← async event schemas
```

The contract lives in `api/`. Generated code (Go stubs from `protoc`, OpenAPI client/server) lands in `internal/`:

```
internal/
└── api/
    ├── openapigen/        ← from openapi-generator
    └── proto/
        └── billing/v1/    ← from protoc
```

Why generated code under `internal/`? Because it is implementation detail. If you publish a Go client, *that* one goes into `pkg/client` or a separate module — but the generated stubs that *your service* uses are private.

---

## Configs, Scripts, and Build Helpers

`configs/` ships sample configs. Production configs live elsewhere (Vault, Kubernetes secrets, environment variables). Never check in real credentials.

```
configs/
├── example.yaml         ← committed, for local dev
└── README.md            ← explains each field
```

`scripts/` holds repeatable automation that is too small for its own tool:

```
scripts/
├── migrate.sh
├── seed-dev.sh
└── release.sh
```

If a script grows past 100 lines, promote it to a Go program under `cmd/<tool>/`. Bash files lose readability fast.

`build/` (if you have one) holds Dockerfiles and CI configurations. Many teams move these to the repo root (`Dockerfile`, `.github/workflows/`) where their respective tools expect them. `build/` is fine as a gathering place but check that your tooling is not surprised by it.

---

## Choosing Between Layouts: A Decision Tree

Use this sequence when starting a new project:

1. **Will it be one binary or many?**
   - One → flat or single `cmd/<bin>/`.
   - Many → `cmd/<bin>/` per binary.
2. **Will it have shared code between binaries?**
   - No → leave `main.go` flat.
   - Yes → introduce `internal/`.
3. **Will it expose a public API for outside consumers (i.e., is it a library or a service with a published Go client)?**
   - No → done. `cmd/` + `internal/` is enough.
   - Yes → either a top-level public package (no `pkg/`) or `pkg/` + `internal/`.
4. **Will it have non-Go content (frontends, docs, infra)?**
   - No → keep Go at the root.
   - Yes → consider `pkg/` + `cmd/` to clearly delimit the Go subtree.
5. **Will it host multiple teams or services?**
   - No → single module.
   - Yes → multi-module monorepo with `go.work`, or polyrepo.
6. **Does it ship an API contract (OpenAPI, Protobuf)?**
   - Yes → add `api/` for the source-of-truth spec, generate into `internal/`.

The final layout is whatever falls out of these answers. There is no template that fits every project; there is a small set of decisions that fit every project.

---

## Pitfalls You Will Meet

### Pitfall 1 — Import cycles between sibling internal packages

```
internal/user → imports internal/billing
internal/billing → imports internal/user
```

`go build` rejects this. The fix is usually one of:
- Extract shared types into `internal/domain/` and have both packages depend on it.
- Move one direction's API to an interface defined in the *consumer*, satisfied by the *provider*.
- Merge the two packages if they are inherently coupled.

### Pitfall 2 — `internal/` too high, blocking reuse you actually want

If everything is under one `internal/` at the root, every other module in your monorepo can import it. You may want a *narrower* fence:

```
billing/internal/store    ← only billing/* can import; even sibling user/ cannot
```

Move `internal/` deeper to make the fence smaller.

### Pitfall 3 — Renaming the module

Changing `module example.com/myapp` to `module github.com/me/myapp` requires updating every internal import. Tools handle this; manual `sed` works for small repos. Plan ahead so you only do it once.

### Pitfall 4 — `pkg/` adopted then half-removed

A team adopts `pkg/`, then half the team thinks it is noise and starts adding code at the root. Now the layout is inconsistent and confusing. Pick one and document it.

### Pitfall 5 — `cmd/` with a single binary, named the same as the repo

```
myapp/
└── cmd/myapp/main.go
```

This is fine, but `go install ./cmd/myapp` produces a binary named `myapp`, and so does `go install ./...`. If your repo is at `github.com/foo/myapp`, this is desirable. If you want a different binary name, the binary takes the name of the directory containing `main.go`, so just rename.

### Pitfall 6 — Workspaces and CI

`go.work` is for local development. It must not be committed in a way that affects production builds. Put `go.work` and `go.work.sum` in `.gitignore` *or* commit them and ensure CI is workspace-aware. Mixing the two is confusing.

---

## Self-Assessment

You are at middle level if you can:

- [ ] Defend a layout decision in a code review with reasons, not appeals to authority.
- [ ] Explain why `golang-standards/project-layout` is a menu, not a rule.
- [ ] Decide between technical and domain layout for a given project size.
- [ ] Lay out a multi-binary repo so each binary builds independently.
- [ ] Choose between single-module, multi-module, and polyrepo for a real team.
- [ ] Refactor `internal/` boundaries to enforce sub-team isolation.
- [ ] Recognize the `pkg/` debate and pick a side for your project (either side, with reasons).
- [ ] Detect import cycles early and resolve them via interface flips or shared `domain/` packages.

---

## Summary

- Layout is the disk-level expression of architecture. Choose it deliberately.
- `golang-standards/project-layout` is a popular community template, not an official standard. Use it as a menu.
- `internal/` is the only fence the toolchain enforces; introduce it when you have something to hide or a public surface to defend.
- `pkg/` is convention; useful in mixed-language repos, often noise in Go-only repos.
- Multi-binary repos use `cmd/<bin>/main.go` per binary, with shared logic in `internal/`.
- Domain layout (group by feature) scales better than technical layout (group by role) past 10 features.
- Single-module monorepos are the default for small to mid-sized teams; multi-module monorepos with `go.work` for larger ones; polyrepos for explicit independence.
- Grow layout with the project. Each phase is a local refactor, not a redesign.
- `api/`, `configs/`, `scripts/` are optional and should reflect real artifacts, not aspirations.
