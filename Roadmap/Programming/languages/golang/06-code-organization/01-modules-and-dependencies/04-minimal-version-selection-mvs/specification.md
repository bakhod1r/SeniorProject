# Minimal Version Selection (MVS) — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where MVS Is Specified](#where-mvs-is-specified)
3. [Definitions](#definitions)
4. [The Selection Rule](#the-selection-rule)
5. [The Four Operations](#the-four-operations)
6. [The Module Graph](#the-module-graph)
7. [The `go` Directive and Graph Pruning](#the-go-directive-and-graph-pruning)
8. [Version Ordering](#version-ordering)
9. [`require`, `exclude`, `replace`, `retract` Semantics](#require-exclude-replace-retract-semantics)
10. [Consistency and Reproducibility Guarantees](#consistency-and-reproducibility-guarantees)
11. [Differences Across Go Versions](#differences-across-go-versions)
12. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does **not** specify Minimal Version Selection. MVS is part of the *module system*, not the language. The authoritative reference is the **Go Modules Reference** at `go.dev/ref/mod`, the design essay **"Minimal Version Selection"** by Russ Cox, and the toolchain source.

Sources of truth, in decreasing formality:

1. **Go Modules Reference** — `go.dev/ref/mod`, section *"Minimal version selection (MVS)"*.
2. **Russ Cox, "Minimal Version Selection"** — `research.swtch.com/vgo-mvs`, the original design with formal definitions of the four operations.
3. **`golang.org/x/mod/mvs`** — the reusable, documented implementation the toolchain builds on.
4. **Toolchain source** — `cmd/go/internal/modload` (graph loading, pruning, build-list construction).

This file separates "what the reference defines" from implementation detail. Where the reference is terse, the design essay and the `x/mod/mvs` package are the de-facto specification.

---

## Where MVS Is Specified

MVS is documented officially in:

1. **Go Modules Reference, "Minimal version selection (MVS)"** — defines the build list and the selection rule.
2. **Go Modules Reference, "The module graph"** and **"Pruned module graphs"** — define the input to MVS and how its scope is reduced.
3. **`go help goproxy` / `go help mod`** and the per-command help — operational behaviour of `go get`, `go list -m`, `go mod graph`.

A paraphrase of the reference's core statement (consult `go.dev/ref/mod#minimal-version-selection` for the exact text):

> The version of a module selected for a build is the *minimum* version that satisfies all requirements: for each module, the highest version specified in a `require` directive of any module in the build's module graph. The set of selected versions is the **build list**.

That sentence is the substance; the rest of this file expands each clause.

---

## Definitions

| Term | Definition (per the reference) |
|------|--------------------------------|
| **Main module** | The module containing the directory where the `go` command is invoked; the module whose `go.mod` roots the build. |
| **Module graph** | The directed graph of module requirements: each node is a module version; each edge `(a → b)` means `a`'s `go.mod` requires `b`. The main module's requirements are the roots. |
| **Build list** | The list of module versions used for a build, containing the selected version of every module in the graph. One version per module. |
| **Selected version** | For a module, the highest version required by any module in the graph (subject to `replace`/`exclude`). |
| **Requirement** | A `require path version` directive: declares that the module needs `path` at *at least* `version`. |
| **Pruned module graph** | The reduced graph used when the main module's `go` directive is `1.17` or higher. |

---

## The Selection Rule

The reference defines selection as follows (paraphrased and formalised):

Let the module graph reachable from the main module be `G`. For each module path `m` that appears in `G`, let `R(m)` be the set of versions `v` for which some `require m v` edge exists in `G`. Then:

> **selected(m) = max(R(m))**, using module version ordering.

The build list is `{ selected(m) : m in G }` together with the main module.

Stated properties (from the reference and the design essay):

- The selected version is the **minimum** version that satisfies every requirement — any lower version would violate a `require` floor; any higher is unnecessary. Hence *minimal* version selection.
- Selection is **deterministic**: it depends only on the module graph, which depends only on the `go.mod` files. No network state, no timestamps, no lockfile.
- Selection is **monotone**: adding a requirement can only raise a selected version, never lower it.
- There is **no maximum-version constraint** in the model; `require` expresses only a lower bound. Consequently the `max` always exists and selection never fails for lack of a satisfying assignment.

---

## The Four Operations

Russ Cox's design essay defines MVS as four operations. The Go command implements each.

| Operation | Definition | Command |
|-----------|------------|---------|
| **Build list** | Compute the selected version of every module from the main module's requirements. | implicit in every build; `go list -m all` prints it |
| **Upgrade one** | Raise one module's requirement to a specified (higher) version, pulling in that version's own requirements, then recompute. | `go get path@version` |
| **Upgrade all** | Raise every module's requirement to its latest version, then recompute. | `go get -u ./...` |
| **Downgrade** | Lower one module to at most a specified (lower) version by lowering or removing every module whose requirements force it higher, then recompute. | `go get path@version` (version below current) |

The design essay's key asymmetry: **upgrade** follows requirement edges forward from the upgraded module; **downgrade** searches *backward* to find and relax every requirement that forced the higher version, possibly removing modules (`path@none`). Downgrade is the only operation that consults a requiring module's version history.

---

## The Module Graph

Per the reference, the module graph is constructed by:

1. Reading the main module's `go.mod` requirements (the roots).
2. For each required module version, reading *its* `go.mod` and adding its requirements as edges.
3. Repeating transitively until no new module versions are discovered.

Properties:

- A module may appear in the graph at **multiple versions** (different requirers floor it differently). The build list collapses these to the single selected (max) version.
- The graph records, for each module version, the requirements *that version declares* — i.e. the versions it was built against. This is the source of MVS's high-fidelity property.
- `replace` and `exclude` directives of the **main module** modify the graph before selection (section 9).

`go mod graph` prints the (possibly pruned) module graph: one `a b` line per edge, where `a` and `b` are `module@version`.

---

## The `go` Directive and Graph Pruning

The `go` directive in the main module's `go.mod` determines the **module graph scope**:

- **`go 1.16` and earlier:** the full transitive module graph is loaded — every `go.mod` of every reachable module.
- **`go 1.17` and later:** the **pruned module graph** is used. The graph includes the main module's requirements and the transitive requirements of dependencies that also declare `go 1.17+`, but for those it follows only requirements needed to provide packages imported (directly or indirectly) by the main module's packages and tests. Dependencies declaring `go 1.16` or earlier are loaded fully.

To make pruning sound, the reference requires that a `go 1.17+` main module's `go.mod` record, as `// indirect` requirements, **every module in the build list**, so the build list is computable from the main `go.mod` without traversing the unpruned graph.

The reference is explicit that **pruning does not change the build list** for a properly maintained module; it reduces the set of `go.mod` files that must be read to compute it.

---

## Version Ordering

MVS's `max` uses the **module version ordering** defined in the reference:

- Versions are **semantic versions** of the form `vMAJOR.MINOR.PATCH`, optionally with a pre-release (`-rc.1`) or build (`+incompatible`) suffix.
- Ordering is by SemVer precedence: compare major, then minor, then patch; a pre-release sorts *before* its corresponding release; build metadata is ignored for precedence.
- **Pseudo-versions** (`vX.Y.Z-yyyymmddhhmmss-abcdefabcdef`) encode an untagged revision; they order by the embedded base version and commit timestamp and interleave deterministically with tagged versions.
- **`+incompatible`** denotes a major-version-2-or-higher module that does **not** use the `/vN` path suffix. The `+incompatible` build tag is part of the canonical version but ignored for precedence.
- A module path with a `/vN` (N ≥ 2) suffix is a **distinct module**: `example.com/m` and `example.com/m/v2` have independent requirement sets and independent selected versions. They may both appear in the build list.

---

## `require`, `exclude`, `replace`, `retract` Semantics

Per the reference, the directives interact with MVS as follows:

### `require path version`

Declares a minimum version of `path`. Contributes an edge to the module graph and a floor to `R(path)`. `// indirect` requires are floors for modules not imported directly by the declaring module; they participate in selection identically to direct requires.

### `exclude path version`

Removes the specified `(path, version)` from consideration — it is excluded from `R(path)` before `max` is taken. If excluded, MVS selects the next-highest required version. **`exclude` is honoured only when the module is the main module**; it is ignored when the module is a dependency of another build.

### `replace path [version] => newpath [newversion]`

Substitutes the contents (and `go.mod`) of `path` (optionally at `version`) with `newpath` at `newversion`, or with a local directory. The replacement's requirements feed the graph; the selected content for `path` is the replacement. **`replace` is honoured only for the main module**; ignored for dependencies.

### `retract version | [low, high]`

Declared by a module about its *own* published versions, indicating they should not be used. **Does not affect the declaring module's own selection.** It is read by *downstream* `go get` and `go list -m -u -retracted`, which warn about and avoid retracted versions when choosing new floors. A retracted version may still be *selected* by MVS at build time if it is the max floor and nothing has been changed to avoid it.

---

## Consistency and Reproducibility Guarantees

The reference frames the following as guarantees of the module system:

- **Reproducibility.** Given the same module graph (the same `go.mod` files), MVS produces the same build list — on any machine, at any time. No lockfile is required because the selection is a pure function of the committed requirements.
- **Determinism without network state.** Selection consults only `go.mod` requirement versions, never the set of currently-available tags. (`@latest` resolution, which *does* query the proxy, happens in `go get` *before* a concrete floor is written — not during build-list computation.)
- **Integrity is separate from selection.** `go.sum` records cryptographic hashes of the module content used; it verifies the bytes of selected versions but does not influence which versions are selected.
- **Minimality.** The build list is the lowest version assignment satisfying all requirements; no module is newer than something in the graph required.

A `go.mod` (with its requirements) plus the MVS rule fully specify the build list. The reference treats this as the reason Go modules need no separate lockfile.

---

## Differences Across Go Versions

- **Go 1.11** — Modules and MVS introduced. The four operations and the build-list rule are present from the start. Full module graph loaded.
- **Go 1.12–1.13** — Module proxy and checksum database added (integrity, downstream of MVS). Selection rule unchanged.
- **Go 1.16** — `-mod=readonly` becomes the default for builds; a build never silently changes the build list, surfacing missing requirements as errors instead.
- **Go 1.17** — **Module graph pruning** and **lazy module loading** introduced. A `go 1.17+` main module records the full build list as `// indirect` requires; the graph MVS walks is pruned. The build list is unchanged.
- **Go 1.18** — Workspaces (`go.work`) introduced. MVS remains per-module; the workspace overlays in-workspace module resolution without changing third-party selection.
- **Go 1.21** — `toolchain` directive added (selects the Go toolchain version); orthogonal to MVS selection of dependencies.
- **Go 1.22+** — Workspace tooling refinements (`go work sync`, `go work vendor`); MVS selection rule unchanged.

The selection rule — *select the maximum required version per module* — has been stable since Go 1.11. The principal evolutions are graph *scope* (pruning, laziness) and *defaults* (`-mod=readonly`), not the algorithm.

---

## References

- [Russ Cox, "Minimal Version Selection"](https://research.swtch.com/vgo-mvs) — the original design and formal definitions. Authoritative.
- [Go Modules Reference — Minimal version selection](https://go.dev/ref/mod#minimal-version-selection)
- [Go Modules Reference — The module graph](https://go.dev/ref/mod#glos-module-graph)
- [Go Modules Reference — Pruned module graphs](https://go.dev/ref/mod#graph-pruning)
- [Go Modules Reference — Versions and version ordering](https://go.dev/ref/mod#versions)
- [Go Modules Reference — `replace`, `exclude`, `retract` directives](https://go.dev/ref/mod#go-mod-file-replace)
- [`golang.org/x/mod/mvs` package](https://pkg.go.dev/golang.org/x/mod/mvs) — the reference implementation.
- [Source: `cmd/go/internal/modload`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modload/)
