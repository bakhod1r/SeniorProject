# `go mod init` — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing a Module Boundary](#designing-a-module-boundary)
3. [The Module Path as a Public API Contract](#the-module-path-as-a-public-api-contract)
4. [Semantic Import Versioning, in Depth](#semantic-import-versioning-in-depth)
5. [Internal Packages and Module Boundaries](#internal-packages-and-module-boundaries)
6. [Architecture: Monorepo vs Polyrepo vs Multi-Module](#architecture-monorepo-vs-polyrepo-vs-multi-module)
7. [Choosing the Module Layout for a Real Service](#choosing-the-module-layout-for-a-real-service)
8. [Stability Tiers and the `go` Directive](#stability-tiers-and-the-go-directive)
9. [Replace Directives in Production](#replace-directives-in-production)
10. [Retraction and Deprecation](#retraction-and-deprecation)
11. [Module Path Migration Without Breaking Consumers](#module-path-migration-without-breaking-consumers)
12. [Reproducibility and Compliance Concerns](#reproducibility-and-compliance-concerns)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with `go mod init` is not "how do I run it" but "how do I design a module that others can depend on for years." The command itself is one keystroke; the surrounding decisions span code organisation, public-API contracts, release engineering, security, and team structure.

This file is about *the design and the trade-offs*. The mechanical content is in [junior.md](junior.md) and [middle.md](middle.md).

After reading this you will:
- Be able to choose a module boundary that minimises future churn
- Reason about Semantic Import Versioning (SIV) at the design level
- Use `internal/`, `replace`, `retract`, and major-version paths as a coherent set of tools
- Decide monorepo vs polyrepo vs multi-module with explicit cost analysis
- Migrate a production module's path without breaking dependents

---

## Designing a Module Boundary

A module is the smallest unit you can release independently. Choosing where the boundary goes is an architectural decision.

### The unit-of-release principle

Ask: *"What set of code do I want users to be able to upgrade or downgrade as one atomic version?"* That set is your module.

If a logging helper and a database driver are tightly coupled (the driver always needs the logger of the same version), they belong in one module. If they are independent (you can sensibly upgrade the driver without touching the logger), they should be separate modules.

### The unit-of-trust principle

A module is the smallest unit a consumer can audit. If a consumer wants to vet your code before depending on it, they vet a module. If your project is split into ten modules, they vet ten times — but they can also choose three and skip seven.

### The blast-radius principle

When you tag a release, *every* package in the module gets the same version. A subtle change in an obscure sub-package becomes a new module version, which may force consumers to rebuild and re-test even if they do not use that sub-package. Smaller modules reduce blast radius; larger modules reduce coordination.

### The naming principle

A module's name must be defendable for years. If you cannot articulate in one sentence what the module is and what it is *not*, it is too broad. `github.com/alice/util` is a module that does everything; `github.com/alice/csvkit` is a module that does CSVs.

### Module size in practice

| Lines of Go | Typical pattern |
|-------------|-----------------|
| < 500 | Single package, single module |
| 500–5,000 | Multi-package, single module (the sweet spot) |
| 5,000–50,000 | Multi-package, single module — start considering `internal/` carefully |
| 50,000+ | Multi-module monorepo, one per bounded context |

These are rules of thumb. Real numbers depend on team size, release cadence, and dependency cost.

---

## The Module Path as a Public API Contract

The module path is part of your public API surface. Senior engineers treat it that way.

### The path is forever

Every `import` line in every consumer's source code mentions your module path verbatim. If you rename, every consumer must rewrite imports. This is not unique to Go — it is true of any package manager — but Go's static-resolution model makes the rename more painful than a flexible runtime resolver would.

### The path encodes ownership

`github.com/alice/lib` claims that *Alice* is the canonical author. If Alice transfers the repo to Bob, the module path *can* still resolve, because GitHub redirects, but consumers see "the path now points to bob/lib." Some teams find that intolerable for compliance reasons.

For long-lived projects, prefer a path under a controlled domain you own: `lib.example.com/csvkit`, served via a `<meta>` tag (Go's *vanity import path* mechanism). This decouples the import path from the VCS host. It also means you can move from GitHub to GitLab to self-hosted without consumers noticing.

### Vanity paths

A vanity path serves an HTML page at `lib.example.com/csvkit?go-get=1` that contains:

```html
<meta name="go-import" content="lib.example.com/csvkit git https://github.com/alice/csvkit">
<meta name="go-source" content="lib.example.com/csvkit https://github.com/alice/csvkit https://github.com/alice/csvkit/tree/master{/dir} https://github.com/alice/csvkit/blob/master{/dir}/{file}#L{line}">
```

The Go tool reads the meta tags, follows the redirect, and clones from the actual URL. The user's `go.mod` shows `lib.example.com/csvkit`, never the underlying GitHub path.

When to bother:

- Your project's URL might change in the future.
- You want to brand the path under a company domain.
- You are likely to fork or move repositories without coordinating with consumers.

When not to bother:

- A solo project on GitHub. The vanity setup is overhead for no benefit.

---

## Semantic Import Versioning, in Depth

The `/v2` rule is not a quirk; it is a deliberate choice rooted in the *Diamond Dependency Problem*.

### The problem SIV solves

Consider:

```
A → B → C v1
  → D → C v2
```

Project `A` depends on `B` (which uses `C v1`) and `D` (which uses `C v2`). If `C v1` and `C v2` are incompatible, the build cannot satisfy both. Some package managers force a single version (and break one of `B`/`D`); others allow both versions to coexist with sufficient runtime indirection.

Go chose: **two majors of the same import path are two different modules**. So `C v1` is `github.com/x/c` and `C v2` is `github.com/x/c/v2`. Both can be in the build simultaneously, no conflict. The cost: every breaking change must rename the import path, which forces consumers to update intentionally.

### Consequences for design

- A breaking change is not free for consumers — they must edit imports. Make breaking changes count.
- v0.x.x is "we may break you anytime." v1.x.x is "we promise not to break you without bumping major." This is not enforced by the tooling, but it is the social contract.
- Long-lived libraries should aim to live at v1 forever. Plan API design so v1 lasts.
- Major-version bumps are coordinated efforts, not emergencies. Announce, document, provide a migration guide.

### The two-track release model

A library beyond v1 typically lives on two tracks:

- The **current track** (`/v3` if you are at v3): receives features and fixes.
- The **maintenance track** (`v2`, `v1`): receives security patches only.

Both tracks run from the same repository, on different branches. Consumers stuck on `/v2` keep getting security fixes; consumers on `/v3` get everything.

### Pre-1.0 modules

`v0.x.x` is the "anything can change" zone. Use it freely while the API is unstable. Consumers know what they are signing up for.

The default Minimum Version Selection (MVS) treats v0 as having no compatibility guarantees. So the social cost of breaking changes is much lower at v0.

---

## Internal Packages and Module Boundaries

Go has one structural mechanism for hiding implementation: the `internal/` folder.

```
github.com/alice/cooltool/
├── go.mod
├── internal/
│   └── parser/                  ← only importable from within the module
│       └── parser.go
└── public.go                     ← can import internal/parser
```

`internal/` packages can only be imported by code rooted at the parent of `internal/`. Outside the module, they are invisible. Inside the module, they are normal packages.

### Senior-level use

- **API surface control.** Anything that should not be in your public contract goes in `internal/`. You can refactor it freely without bumping major versions.
- **Multi-module repo:** an `internal/` folder at the repo root is private to the *root module*. Sub-modules (with their own `go.mod`) cannot reach into the root's `internal/`. This is sometimes surprising and sometimes intentional.
- **Package layout.** A common shape:
    ```
    cmd/<binary>/main.go          ← entry points, thin
    internal/<feature>/...         ← business logic, not importable externally
    pkg/<feature>/...              ← rarely needed; resist creating
    ```

### Why this matters at module-init time

When you choose your module path, you are also choosing where `internal/` lives. A module rooted at `github.com/alice/cooltool` puts `internal/` directly under that path. Sub-modules introduce sub-roots, each with their own `internal/`.

Decide the `internal/` strategy before tagging your first release. Moving things in and out of `internal/` later is a breaking change for any external import.

---

## Architecture: Monorepo vs Polyrepo vs Multi-Module

Three coarse models for organising Go code at a company scale.

### Polyrepo (one module per repository)

Each module has its own repository, its own CI, its own release cycle. Cross-module changes require coordinated PRs in multiple repos.

**Pros:** clear ownership, narrow access control, simple per-repo CI, reusable as third-party deps.
**Cons:** cross-cutting refactors are painful, dependency upgrades fan out, atomic changes across services are impossible.

### Monorepo (one repository, one module)

One huge `go.mod` covers everything. Every service, every shared library, every script.

**Pros:** atomic refactor, single source of truth, no inter-service version skew, simple `go test ./...`.
**Cons:** dependency graph is one global graph (a heavy dep pulled by one team affects everyone), build times scale poorly, hard to extract reusable libraries to publish externally.

### Monorepo with multiple modules

One repository, several `go.mod` files. Each module has its own dependency graph.

**Pros:** atomic file-level operations across modules; isolation of dependency graphs; modules can be released independently.
**Cons:** workflow tooling is more complex (need workspace files or per-module CI); consumers may struggle to find the right module.

### Senior decision matrix

| Factor | Polyrepo | Single-module monorepo | Multi-module monorepo |
|--------|----------|------------------------|-----------------------|
| Independent release cadence | ✔ | ✘ | ✔ |
| Atomic cross-module refactor | ✘ | ✔ | ✔ (with `go.work`) |
| Cross-team dependency control | ✔ | ✘ | ✔ |
| External reusability | ✔ | ✘ | ✔ |
| CI simplicity | ✔ | ✔ | ✘ |
| Tooling maturity | ✔ | ✔ | ⚠ |

A company growing past ~50 engineers usually settles on multi-module monorepo or a polyrepo with strong dependency governance. Pick the one that matches your release model.

---

## Choosing the Module Layout for a Real Service

Walk through a realistic scenario: you are starting a backend service.

### Scenario

A new microservice `paypipe`. It exposes an HTTP API, talks to a database, publishes events to Kafka. Will be one of ~20 services in a polyrepo company. Expected to live ~5 years.

### Decision tree

1. **Will any code in this repo be reused by other services?**
    - No → single module is simplest.
    - Yes → carve out a `pkg/` (or separate repo) for the reusable parts. Likely a separate module.
2. **Does the team have multiple binaries or sub-products?**
    - Multiple binaries → `cmd/<binary-name>/main.go`, all in the same module unless they need different release cadences.
3. **What is the release cadence?**
    - Continuous deploy → version pinning matters less; single module.
    - Tagged semver releases → care about `internal/` boundaries and major-version bumps.
4. **Is any part of the repo open-source?**
    - Yes → that part should be its own module, possibly its own repo, with a clean dependency graph.

### Recommended layout

```
github.com/example/paypipe/
├── go.mod                          (module: github.com/example/paypipe)
├── cmd/
│   └── paypipe/
│       └── main.go                 (package main)
├── internal/
│   ├── api/                        (HTTP handlers)
│   ├── store/                      (DB access)
│   ├── events/                     (Kafka producer)
│   └── domain/                     (business types)
├── pkg/                            (only if you mean to expose externally)
│   └── paypipeclient/
│       └── client.go
└── deploy/                         (Dockerfile, k8s manifests — not Go)
```

Single module. Module path matches the company VCS host. `cmd/` for binaries, `internal/` for non-public packages, `pkg/` only if there is a real public surface (here: a Go client SDK).

`go mod init github.com/example/paypipe` produces this. Everything else is `mkdir`.

---

## Stability Tiers and the `go` Directive

The `go` directive is a public commitment. Senior engineers manage it deliberately.

### Three tiers

- **Conservative.** Match the oldest Go that any consumer in your ecosystem still runs. For widely-shared libraries, this is often N-2 majors of Go.
- **Current.** Match the version your team builds against on most days. Most application repos.
- **Bleeding edge.** Match the *latest* Go to use experimental features (generics in 1.18, range-over-func in 1.23). Be aware: consumers cannot build with anything older.

### Library vs application

Libraries should be conservative — every bump excludes some consumers.

Applications can be aggressive — only the deploy environment matters.

### Bumping the `go` directive

Bumping is a breaking change for libraries (consumers on older Go cannot build). Treat it as a minor or major release event. Communicate in release notes.

For applications, bumping is a routine internal change.

### Enforcement

CI should run with the *minimum* Go version declared in `go.mod` to catch accidental use of newer features. Many teams run two CI matrices: minimum and latest.

---

## Replace Directives in Production

`replace` substitutes one module path/version for another. Three production-relevant uses:

### Use 1 — Local development against a fork

```
replace github.com/upstream/lib => ../local-fork
```

While developing a patch to an upstream library, you point your dependency at a sibling directory. Do not commit. Use `go.work` instead for less risk of leakage.

### Use 2 — Permanent fork

```
replace github.com/upstream/lib v1.5.0 => github.com/yourcorp/lib v1.5.0-fork.1
```

Your team maintains a fork of an upstream library. The replace points consumers to your fork at a specific version. Commit this. Document why.

### Use 3 — Pinning a security-patched version

```
replace github.com/affected/dep v1.2.0 => github.com/affected/dep v1.2.0-cve-fix.1
```

A direct or transitive dependency has an unfixed CVE. Until upstream releases a fix, you ship a patched version. Commit, with a comment pointing to the CVE and the date.

### Anti-uses

- **Replacing to a development directory in committed `go.mod`.** Causes everyone else's build to break.
- **Using `replace` instead of upgrading to a fixed upstream version.** Tech debt — upgrade as soon as the fix lands.
- **Stacking many `replace` lines** over time without removing stale ones. Each is a tiny piece of complexity.

---

## Retraction and Deprecation

### `retract` directive

Pulls back a published version of *your* module. Consumers using `go get` will no longer get the retracted version by default. Use this when you tagged a broken release:

```
retract v1.2.0  // bug: panics on empty input — fixed in v1.2.1
```

`retract` lives in the *latest* `go.mod`, not in the broken release itself. The Go toolchain learns about retractions by checking the latest version.

### Deprecation comment

To deprecate the entire module:

```
// Deprecated: use github.com/newhome/lib instead.
module github.com/oldhome/lib
```

Tools surface this comment when consumers run `go list -m -u all`.

### When to use which

- `retract`: a specific bad version exists.
- Deprecation comment: the whole module is over.
- Both: replaced by a new module that is a fresh start.

---

## Module Path Migration Without Breaking Consumers

You cannot migrate a Go module path without *eventually* breaking consumers. But you can soften the transition.

### Strategy 1 — Vanity URL pivot

If you used a vanity path (`lib.example.com/csvkit`), you can change the underlying repository without touching consumers. They keep importing the same path.

### Strategy 2 — Transition module

1. Create the new module at the new path. Tag `v1.0.0`.
2. Tag a final release of the old module at the same version (`v1.X.0`) that re-exports everything from the new module via type aliases:
    ```go
    package csvkit
    import new "github.com/newhome/csvkit"
    type Reader = new.Reader
    func NewReader(...) = new.NewReader  // simplified
    ```
3. Mark the old module deprecated.
4. Wait. Maintain security fixes on the old path for a stated period.

### Strategy 3 — `/v2` and beyond

If the migration is also a major version bump, this is the standard SIV path. New module at `/v2`, old at root. Both supported during the deprecation window.

### What you cannot do

- Make `go get` magically follow the new path. Consumers must explicitly update.
- Force a re-import without a code change.

---

## Reproducibility and Compliance Concerns

Once your module is in production, several non-obvious issues appear.

### `go.sum` integrity

`go.sum` records hashes. If `go.sum` is missing or stale, `go build` may silently fetch fresh versions, breaking reproducibility. Always commit `go.sum`. Always run `go mod tidy` in CI.

### `GOFLAGS=-mod=readonly` or `-mod=vendor`

In CI, set `GOFLAGS=-mod=readonly` to forbid `go.mod` writes during the build. A change in `go.mod` mid-build is almost always a bug.

### `GOPROXY` and `GOPRIVATE`

`GOPROXY=https://proxy.golang.org,direct` is the default. For corp-private modules:

- `GOPRIVATE=corp.example.com/*` tells Go *not* to send requests for those paths to the public proxy.
- `GONOSUMCHECK=corp.example.com/*` disables checksum-database verification for those modules.

### License compliance

The module path appears in license-extraction tools (e.g. `go-licenses`). For projects under audit, consistency in module paths simplifies the report.

### SBOM (Software Bill of Materials)

Most SBOM tools output module paths and versions verbatim from `go.mod`/`go.sum`. Wrong-cased or non-canonical paths can confuse downstream consumers.

---

## Anti-Patterns

- **`go mod init` after writing thousands of lines of code.** Do it first.
- **Single-segment module path for anything not a throwaway.** The dot rule exists for a reason.
- **Mixed-case module path.** Always lowercase.
- **Renaming a module without coordinating with consumers.** They will hate you.
- **Bumping major version without renaming the path to `/vN`.** The build is broken for anyone using `go get @latest`.
- **Committing a `replace` to a local file path.** Other developers' builds will fail.
- **Using `go.work` as a permanent layout.** It is a development overlay, not an architecture.
- **Modules that depend on themselves indirectly via `replace`.** Causes baffling cycles.
- **Choosing a module path under `github.com/<organisation>` when ownership of that organisation is shared / political.** If control is unclear, use a vanity path.

---

## Senior-Level Checklist

- [ ] Choose a module path you are willing to defend in five years
- [ ] Use a vanity path when long-term VCS host is uncertain
- [ ] Decide single vs multi-module *before* the first release tag
- [ ] Define `internal/` boundaries before publishing
- [ ] Adopt SIV: bump major when API breaks; tag majors as `/vN`
- [ ] Use `replace` only for explicitly justified cases; document each
- [ ] Use `retract` to pull back broken versions, not as routine
- [ ] Set `go` directive based on consumer reality, not aspirations
- [ ] Run `go mod tidy` and `go mod verify` in CI
- [ ] Document the module path in the README
- [ ] Plan for renames via vanity URL or transition modules

---

## Summary

`go mod init` is a one-line command that names a module forever. The senior responsibility is to make sure *what* is named and *how* it is named will hold up over the lifecycle of the project. That means choosing a path that survives VCS migrations, deciding on a single-vs-multi-module architecture early, planning major version bumps via SIV, and using `replace`/`retract`/`internal/` as a coherent set of governance tools.

The mechanical command is trivial. The decisions around it are not. Get the path right; design the module boundary deliberately; and treat every release as a public contract — because, once published, it is.
