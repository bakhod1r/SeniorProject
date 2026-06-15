# Module Graph Pruning — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where Pruning Is Specified](#where-pruning-is-specified)
3. [The `go` Directive as the Pruning Switch](#the-go-directive-as-the-pruning-switch)
4. [The Pruned Module Graph (Per the Reference)](#the-pruned-module-graph-per-the-reference)
5. [Self-Contained `go.mod`: The Indirect-Requirement Rule](#self-contained-gomod-the-indirect-requirement-rule)
6. [Lazy Module Loading (Per the Reference)](#lazy-module-loading-per-the-reference)
7. [When the Full Graph Is Loaded](#when-the-full-graph-is-loaded)
8. [`go mod tidy`, `-go`, and `-compat` (Specified)](#go-mod-tidy-go-and-compat-specified)
9. [Pruning and `vendor/modules.txt`](#pruning-and-vendormodulestxt)
10. [Interaction with MVS and `go.sum`](#interaction-with-mvs-and-gosum)
11. [Differences Across Go Versions](#differences-across-go-versions)
12. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify module graph pruning. Pruning is a property of the *module system and tooling*, not the language. The authoritative reference is the **Go Modules Reference** at `go.dev/ref/mod`, specifically the section *"Module graph pruning"*, supplemented by the Go 1.17 lazy-module-loading design document and the toolchain source.

Sources of truth, in decreasing formality:

1. **Go Modules Reference — "Module graph pruning"** — `go.dev/ref/mod#graph-pruning`.
2. **Go 1.17 lazy module loading design document** — the proposal that introduced both features.
3. **Go 1.17 release notes** — the user-facing announcement.
4. **Toolchain source** — `cmd/go/internal/modload` (graph loading, MVS, tidy).

This file separates "what the reference states" from convention and implementation detail. Where the reference is silent, the toolchain source is the de-facto specification.

---

## Where Pruning Is Specified

Pruning is documented officially in:

1. **Go Modules Reference, section "Module graph pruning"** — the normative description of the pruned graph and the self-containment requirement.
2. **Go Modules Reference, sections on `go.mod`, `go mod tidy`, and the `go` directive** — how the directive controls pruning and how `tidy` records requirements.
3. **The lazy-loading design document** (`proposal/design/36460-lazy-module-loading.md`) — the rationale and the algorithm.

A paraphrase of the reference's core statement:

> For modules that specify `go 1.17` or higher, the module graph includes only the immediate dependencies of other `go 1.17` modules, not their full transitive dependencies. The module graph is *pruned*. So that the pruned graph selects the same versions as the full graph for all imported packages, the `go.mod` file of a `go 1.17` (or higher) module must include an indirect requirement for every module that provides a transitively-imported package and is not already an (implied) requirement.

That paraphrase is the substance; the reference expands each clause.

---

## The `go` Directive as the Pruning Switch

The `go` directive in `go.mod` determines whether a module's graph is pruned. Per the reference:

- A module whose `go` directive is **`1.17` or higher** uses the **pruned** module graph.
- A module whose `go` directive is **`1.16` or lower** uses the **full (unpruned)** module graph.

Two important scoping rules:

1. **Pruning is decided by the *main module's* `go` directive.** Whether a build's graph is pruned depends on the directive of the module being built, not of its dependencies.
2. **Each dependency's `go` directive decides its *own* self-containment.** Within a pruned build, a dependency at `go 1.17+` is treated as self-contained (only its direct requirements are added); a dependency at `go ≤ 1.16` is expanded to its full transitive requirements, because it did not record enough indirect requirements to be self-contained.

The directive is therefore both a pruning switch (for the main module) and a self-containment marker (for every module in the graph).

---

## The Pruned Module Graph (Per the Reference)

The reference defines the pruned module graph as containing:

1. The **main module**.
2. Every module that provides a package **transitively imported** by a package or test of the main module.
3. For each `go 1.17+` module already in the graph, the modules named in its **`require` directives** (one level), added to the graph.
4. The **full transitive requirements** of any `go ≤ 1.16` module in the graph (such modules are not pruned, being non-self-contained).

The reference is explicit on the guarantee:

- The pruned graph is constructed so that, for **every package imported by the main module**, MVS selects the **same version** as it would over the full graph.

Equivalently: pruning removes requirement edges that cannot affect the selected version of any imported package — and records, in the main module's `go.mod`, any version those removed edges would have contributed.

---

## Self-Contained `go.mod`: The Indirect-Requirement Rule

The reference states the rule that makes pruning correct: a `go 1.17+` module's `go.mod` must be **self-contained**. Specifically, it must contain a (possibly `// indirect`) `require` directive for:

- Every module that provides a package or test imported by the main module's packages, **and**
- Every module whose selected version is determined by a requirement that pruning removed from the loadable graph (so that the version is still recorded somewhere Go reads).

Consequences specified or implied:

- A `go 1.17+` `go.mod` typically lists **more** `// indirect` requirements than a `go 1.16` one for the same code, because the deep graph is no longer loaded to supply them.
- `go mod tidy` computes and maintains this set. The reference designates `tidy` as the canonical writer of the requirement set.
- The grouping of direct requirements and `// indirect` requirements into separate `require` blocks is a **formatting convention** produced by `tidy`; it is not semantically required. A single `require` block with `// indirect` comments is equivalent.

---

## Lazy Module Loading (Per the Reference)

The reference describes lazy module loading as the companion to pruning:

- The `go` command attempts to load the **least** of the module graph necessary to perform the requested operation.
- For an operation on a `go 1.17+` main module whose `go.mod` is already tidy, the **main module's `go.mod` alone** is often sufficient to resolve imported packages — the broader graph is not loaded.
- The broader (pruned, then full) graph is loaded **lazily**, only when an operation requires it.

The reference frames the combined goal: most `go` commands should run without loading the full module graph, making them fast and resilient to missing or unreachable deep `go.mod` files.

---

## When the Full Graph Is Loaded

The reference and the design document enumerate operations that still require the full module graph:

- **`go mod graph`** — printing the complete graph.
- **`go mod tidy`** — computing the complete recorded requirement set (and, with `-compat`, the older regime's graph).
- **`go get`** affecting modules whose requirements were pruned — the graph deepens to reconcile.
- **Any build where a `go ≤ 1.16` dependency is relevant** — that module's full transitive requirements are loaded, because it is not self-contained.
- **Reconciliation when the pruned graph is insufficient** to resolve a version unambiguously.

Outside these, a tidy `go 1.17+` module's everyday commands operate on the pruned graph or the main module's `go.mod` alone.

---

## `go mod tidy`, `-go`, and `-compat` (Specified)

The reference documents `go mod tidy`'s flags relevant to pruning:

### `-go=<version>`

Sets the `go` directive of the module to `<version>` and updates `go.mod` and `go.sum` for the **module graph regime** of that version.

- `go mod tidy -go=1.16` produces a `go.mod` for the **full-graph** regime (smaller indirect set).
- `go mod tidy -go=1.17` (or higher) produces a `go.mod` for the **pruned** regime (larger indirect set).

This flag is the supported mechanism for migrating a module across the pruning boundary.

### `-compat=<version>`

Instructs `tidy` to produce a `go.mod` and `go.sum` that also allow the named **older** Go version to load the module graph and reach the same build list. Specifically:

- `tidy` checks that the build list computed under the current (pruned) regime **agrees** with the build list the `-compat` version would compute under its regime; an inconsistency is reported as an error.
- `tidy` **retains the additional `go.sum` entries** (notably `go.mod` hashes) that the `-compat` version needs to load its graph.

The reference specifies the **default**: for a module at `go 1.17` or higher, `go mod tidy` defaults `-compat` to the version **immediately preceding** the module's `go` directive (e.g., a `go 1.17` module defaults to `-compat=1.16`).

---

## Pruning and `vendor/modules.txt`

The Go 1.17 changes to vendoring support pruning. Per the reference, `vendor/modules.txt` records, for each vendored module:

- `## explicit` — the module is a direct dependency of the main module.
- `## go <version>` (Go 1.17+) — the dependency module's own `go` directive.
- `## explicit; go <version>` — both markers combined.

The `## go <version>` marker exists so that a build operating in vendor mode (which does not load the module graph) can apply the correct **per-module pruning and language semantics** using only the vendored metadata. The marker was added in Go 1.17 specifically to support pruning under vendoring.

A vendored `go 1.17+` module is therefore consistent with the pruned graph: the package set vendored is what the import graph reaches, and the per-module `go` markers preserve pruning-relevant metadata. See [03-go-mod-vendor/specification.md](../03-go-mod-vendor/specification.md).

---

## Interaction with MVS and `go.sum`

### MVS

Per the reference, **Minimal Version Selection is unchanged by pruning**. Pruning alters the graph MVS receives, not the algorithm. The construction of the pruned graph guarantees that MVS selects the same version for every imported package as it would over the full graph. See [04-minimal-version-selection-mvs/specification.md](../04-minimal-version-selection-mvs/specification.md).

### `go.sum`

Pruning loads fewer `go.mod` files, so fewer `go.mod` hashes are strictly required to verify the build. The reference notes:

- `go mod tidy` keeps `go.sum` aligned with the modules the pruned graph loads.
- `-compat=<older>` retains the `go.sum` entries the older, full-graph regime needs.
- Module **content** integrity is unaffected: every built module is still verified against `go.sum`.

A missing-`go.sum`-entry error on an older Go after migration indicates an inadequate `-compat`; the fix is `go mod tidy -compat=<that version>`.

---

## Differences Across Go Versions

The behaviour around pruning has evolved:

- **Go 1.16 and earlier** — Full (unpruned) module graph. The complete transitive closure of requirements is loaded. `go.mod` records fewer `// indirect` requirements.
- **Go 1.17** — **Module graph pruning introduced** for modules at `go 1.17+`. **Lazy module loading introduced.** `go.mod` of pruned modules records the larger indirect set. `vendor/modules.txt` gains the `## go <version>` marker. `go mod tidy` gains the `-compat` flag with a default of one version below the directive.
- **Go 1.18** — Workspaces (`go.work`) introduced; pruning remains per-main-module.
- **Go 1.21** — `toolchain` directive introduced; relevant to reproducibility alongside pruning but does not change pruning rules. The `go` directive's role as the pruning switch is unchanged.
- **Go 1.21+** — Continued refinements to error messages and tidy behaviour; the pruning model (driven by the `go` directive at the `1.17` boundary) is stable.

The defining rule — `go 1.17+` modules use the pruned graph and must keep a self-contained `go.mod` — has been stable since Go 1.17.

---

## References

- [Go Modules Reference](https://go.dev/ref/mod) — authoritative.
- [Module graph pruning (reference)](https://go.dev/ref/mod#graph-pruning)
- [The `go` directive (reference)](https://go.dev/ref/mod#go-mod-file-go)
- [`go mod tidy` and `-compat` (reference)](https://go.dev/ref/mod#go-mod-tidy)
- [Go 1.17 lazy module loading design document](https://go.googlesource.com/proposal/+/master/design/36460-lazy-module-loading.md)
- [Go 1.17 Release Notes — Module graph pruning](https://go.dev/doc/go1.17#go-command)
- [`vendor/modules.txt` format (reference)](https://go.dev/ref/mod#vendoring)
- [Minimal Version Selection (reference)](https://go.dev/ref/mod#minimal-version-selection)
- [Source: `cmd/go/internal/modload`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modload/)
