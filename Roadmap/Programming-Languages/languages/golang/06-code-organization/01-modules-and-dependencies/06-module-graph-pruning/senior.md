# Module Graph Pruning — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Pruning as a Scalability Decision](#pruning-as-a-scalability-decision)
3. [The Migration Across the 1.17 Boundary](#the-migration-across-the-117-boundary)
4. [Deepening the Module Graph](#deepening-the-module-graph)
5. [The Cost of a Single Legacy Dependency](#the-cost-of-a-single-legacy-dependency)
6. [Pruning, MVS, and Selection Equivalence](#pruning-mvs-and-selection-equivalence)
7. [`-compat` Strategy for Library Authors](#compat-strategy-for-library-authors)
8. [Pruning in Multi-Module Monorepos and Workspaces](#pruning-in-multi-module-monorepos-and-workspaces)
9. [`go.mod` Diff Hygiene Under Pruning](#gomod-diff-hygiene-under-pruning)
10. [CI Strategy for Pruned Modules](#ci-strategy-for-pruned-modules)
11. [Pruning and Vendoring](#pruning-and-vendoring)
12. [Reproducibility and Toolchain Pinning](#reproducibility-and-toolchain-pinning)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

A senior engineer treats module graph pruning not as a feature to learn but as a property of the dependency-management system that shapes build performance, `go.mod` diff hygiene, library-compatibility obligations, and the cost of every legacy dependency in the tree. The mechanical content — pruned vs full graph, the indirect block, `-compat` — is in [middle.md](middle.md). This file is about the *engineering decisions* pruning forces and the failure modes it introduces at scale.

After reading this you will:
- Reason about pruning as a scalability and reproducibility property, not a flag
- Plan and execute the 1.17 migration across many modules without breaking consumers
- Understand graph *deepening* — the one case where pruning changes the loaded version landscape
- Quantify the cost a single `go < 1.17` dependency imposes on everyone downstream
- Set a `-compat` policy that matches your library's actual support matrix
- Keep `go.mod` diffs reviewable and builds reproducible in a pruned world

---

## Pruning as a Scalability Decision

Pruning exists because the full graph did not scale. The pre-1.17 model loaded the transitive `go.mod` of *every* module any dependency mentioned, including test-only and feature-only requirements of distant modules. For a service with hundreds of dependencies, every `go` command paid an O(entire-dependency-universe) loading cost.

The senior framing: pruning changes the dominant term in graph-load cost from "size of the full transitive closure" to "size of the import-relevant subgraph plus one level of requirements." For large dependency trees this is the difference between thousands of `go.mod` reads and dozens.

Two architectural consequences follow:

1. **Graph-load time is now a function of *imported* breadth, not *declared* breadth.** A dependency that declares many requirements but whose packages you barely import contributes little to your pruned graph. This rewards dependencies with shallow *import* surfaces even if they have deep *requirement* lists.
2. **Self-containment becomes a `go.mod` property.** A pruned `go.mod` is a complete specification of the build list. This is what makes lazy loading, offline builds behind restricted networks, and fast CI possible. The larger `go.mod` is the price of that completeness.

You do not "decide" to prune — modern modules prune by default. The decision space is downstream: how to migrate, how to keep the benefit (avoid legacy deps), and how to manage the `go.mod`-size cost.

---

## The Migration Across the 1.17 Boundary

Crossing from a `go 1.16` (full-graph) module to a `go 1.17+` (pruned) module is a one-time, high-diff event. Done carelessly it breaks consumers; done well it is a clean, reviewable commit.

### The mechanical migration

```bash
go mod tidy -go=1.17 -compat=1.16
go build ./...
go test ./...
git add go.mod go.sum
git commit -m "Enable module graph pruning (go 1.17)"
```

`-go=1.17` sets the directive and records the larger pruned indirect set. `-compat=1.16` preserves the `go.sum` entries the previous Go release needs to load the (still-full) graph, so consumers on 1.16 are not broken in the same change.

### What changes in `go.mod`

- The `go` directive moves to `1.17` (or your chosen modern version).
- The `// indirect` block grows substantially — often doubling or more.
- `go.sum` gains and/or retains entries to satisfy both the pruned graph and the `-compat` floor.

### Migration discipline

- **Isolate the commit.** Never bundle a directive bump with feature work; the `go.mod`/`go.sum` diff drowns the real change.
- **Choose the target directive deliberately.** Going straight to `go 1.21` is fine and modern; just be aware that each minor version can have additional semantics (e.g., the `toolchain` directive at 1.21).
- **Set `-compat` to your true floor**, not reflexively to 1.16. If you support only Go 1.21+, the default `-compat` is correct and you avoid retaining unnecessary `go.sum` entries.
- **Re-run consumers' builds** if you publish a library. The migration changes your published `go.mod`; verify a 1.16 consumer (if you support one) still resolves.

---

## Deepening the Module Graph

The one nuance that contradicts "pruning never changes versions": **graph deepening**.

Normally, pruning is engineered so MVS selects identical versions over the pruned and full graphs. But certain operations *deepen* the pruned graph — pulling previously-pruned modules back into the loaded set — and a deepened graph can, in principle, surface additional version constraints.

Deepening happens when:

- **You add a new import** that reaches a package in a module not previously in the pruned graph. Resolving it requires loading more of the graph.
- **You run `go get` on a module** whose requirements were pruned away, forcing Go to expand the graph to reconcile the new version.
- **A `go < 1.17` dependency becomes relevant**, dragging its full requirements in.
- **`go mod tidy`** itself loads the full graph to compute the correct indirect set; the recorded result reflects the deepened view.

The senior point: deepening is *expected and benign*. The toolchain deepens precisely to keep selection correct. What it means in practice is that adding one import can produce a `go.mod` diff touching several seemingly-unrelated indirect lines — because deepening revealed constraints that pruning had elided. Reviewers should understand that a one-line import change legitimately producing a multi-line `go.mod` change is pruning working as designed, not a bug.

If you ever observe a *selected version* change after a deepening event, it is because the newly-loaded part of the graph carried a higher minimum requirement that was always logically present but not previously recorded. The correct response is to accept the recorded result (it is the right MVS outcome) and, if the bump is unwanted, explicitly pin a lower compatible version with full awareness.

---

## The Cost of a Single Legacy Dependency

Pruning's benefit is *conditional on your dependencies also being pruned*. A dependency whose `go.mod` declares `go 1.16` or lower is **not self-contained**: it did not record the indirect requirements pruning relies on. When such a module is relevant to your build, Go must load its **full transitive requirements** to fill the gap.

The implications are non-local:

- **One legacy dependency can re-inflate the graph** for everyone who depends on it, transitively. The pruning win is partially lost.
- **The effect compounds.** If the legacy dependency itself depends on more legacy dependencies, the unpruned region grows.
- **You cannot fix it locally.** Your `go.mod` can record the indirect deps, but the *graph load* still expands wherever the legacy module sits, because the toolchain cannot trust an old `go.mod` to be complete.

Senior actions:

1. **Audit dependency `go` directives.** `go list -m -f '{{.Path}} {{.GoVersion}}' all` surfaces which dependencies are still pre-1.17.
2. **Upgrade or replace laggards.** A newer release of the same library at `go 1.17+` restores self-containment. If upstream is dead, a `replace` to a maintained fork can help.
3. **Track the graph-size metric** (`go mod graph | wc -l`) over time; a sudden jump usually traces to a legacy dependency entering the tree.

This is the modern analogue of "transitive dependency hygiene": in a pruned world, the `go` directive of your dependencies is itself a performance characteristic you should care about.

---

## Pruning, MVS, and Selection Equivalence

The formal guarantee underpinning pruning: **for every package imported by the main module, MVS over the pruned graph selects the same version as MVS over the full graph.** ([04-minimal-version-selection-mvs](../04-minimal-version-selection-mvs/senior.md) covers MVS itself.)

This equivalence is *constructed*, not incidental. It holds because:

- The pruned graph retains every module supplying an imported package and that module's immediate requirements.
- The main module's `go.mod` records the indirect requirements that the pruned-away graph would otherwise have contributed.

The senior insight is *where the equivalence could break and why it does not*:

- It could break if a pruned-away module carried a higher minimum requirement for an imported package. It does not, because that requirement is captured either by a retained module's `go.mod` or by the recorded indirect block.
- It could break across the 1.16/1.17 boundary if `tidy` under-recorded. `-compat` plus `tidy`'s consistency check exist precisely to detect and prevent that.

So pruning is best understood as a *graph-compression* technique that preserves the MVS fixpoint. Treat any apparent version difference between pruned and full builds as a bug to report (with `-compat` reproduction), not as expected behaviour — the design promises they agree.

---

## `-compat` Strategy for Library Authors

For applications, `-compat` is usually the default. For **library authors**, it is a published-compatibility decision.

Your library's `go.mod` is consumed by other modules. If you migrate to `go 1.21` and tidy away `go.sum` entries that a consumer on an older Go needs to load your graph, that consumer breaks with "missing go.sum entry."

A deliberate `-compat` policy:

- **Decide your minimum supported Go version** explicitly. Document it (README, `go.mod` directive, CI matrix).
- **Tidy with that floor:** `go mod tidy -go=1.21 -compat=1.17` if you support consumers down to Go 1.17.
- **Test the floor in CI.** Run a job with the oldest supported Go that resolves and builds your module as a *consumer* would.
- **Raise the floor on a schedule,** not silently. Dropping support for an old Go version is a (minor) breaking change for some consumers; announce it.

The tension: a low `-compat` floor retains more `go.sum` entries (larger metadata, broader support); a high floor is leaner but excludes older consumers. Choose intentionally; do not let the default silently decide your support matrix.

---

## Pruning in Multi-Module Monorepos and Workspaces

### Per-module pruning

Pruning is a property of each **main module**, decided by *its* `go` directive. In a monorepo with several `go.mod` files, each module prunes (or not) independently. Standardize the directive across modules to avoid mixed regimes — a `go 1.16` module beside a `go 1.21` module behaves inconsistently and confuses contributors.

### Workspaces (`go.work`)

A `go.work` workspace overlays multiple modules for local development. Pruning still applies per main module; the workspace does not create a single unified pruned graph. When you build a particular module in the workspace, *that* module's directive governs its graph. The workspace's job is import resolution across members, not graph pruning.

Two practical notes:

- `go work sync` propagates dependency versions across workspace members; it respects each member's pruning regime.
- Do not rely on the workspace to "fix" a member's old directive. Each `go.mod` must be migrated on its own.

### Shared-dependency coordination

In a pruned monorepo, bumping a widely-shared dependency means re-tidying every module that imports it, each of which may record different indirect deps. Encode this in tooling (a script that tidies all modules) and a CI gate that verifies all are tidy.

---

## `go.mod` Diff Hygiene Under Pruning

Pruning makes `go.mod` larger and its diffs noisier. Managing that noise is a senior responsibility.

- **A one-line import change can touch many indirect lines** (deepening). Reviewers must learn this is normal. Document it so nobody "reverts the extra lines."
- **Separate dependency-bump commits from feature commits.** A PR that adds a dependency should isolate the `go.mod`/`go.sum`/indirect churn from the code that uses it. This also makes bisecting cleaner.
- **Review the *direct* block carefully, skim the *indirect* block.** The direct block is the human-meaningful surface — what you chose to depend on. The indirect block is derived; review it for *surprises* (a new heavyweight module, a license-incompatible dependency) rather than line by line.
- **Use `go mod why -m <module>`** on any indirect entry that looks alarming, to trace why it entered.
- **Gate tidiness in CI** so the indirect block is never stale in `main`.

The cultural risk mirrors vendoring: if reviewers rubber-stamp the indirect block, a malicious or undesirable dependency can enter unnoticed. Invest in scanning (`govulncheck`, license checks) so the indirect block's *contents* are validated even when the *diff* is skimmed.

---

## CI Strategy for Pruned Modules

A pruned module's CI should enforce the invariants pruning depends on.

### Tidiness gate

```bash
go mod tidy
git diff --exit-code go.mod go.sum
```

Fails if a contributor changed dependencies without re-tidying. This is the single most important pruning-related gate.

### Compatibility floor (libraries)

Run a matrix job on the oldest supported Go version, resolving and building the module as a consumer would. Catches `-compat` regressions before they reach downstream.

### Toolchain pin

Pin the Go version (`toolchain` directive plus a fixed CI image). Differing local toolchains across the pruning boundary produce indirect-block churn; pinning eliminates it.

### Graph-size guard (optional)

Track `go mod graph | wc -l` and alert on large jumps. A sudden increase usually means a legacy (`go < 1.17`) dependency entered the tree and re-inflated the loaded graph.

### Readonly default

Do **not** set `GOFLAGS=-mod=mod` globally in CI. The default `-mod=readonly` is what surfaces "updates to go.mod needed" — the signal that a contributor forgot to tidy. `-mod=mod` silently rewrites `go.mod` mid-build and hides the problem.

---

## Pruning and Vendoring

Pruning and vendoring ([03-go-mod-vendor](../03-go-mod-vendor/senior.md)) are independent but cooperate.

- **`vendor/modules.txt` records the `go` directive of each module** (the `## explicit; go 1.x` markers added in Go 1.17). This lets a vendored build apply the correct pruning semantics per module without loading the graph.
- **Vendoring a pruned module copies what the pruned import graph reaches** — the same package set the build needs. Pruning's smaller graph does not change *which packages* are vendored (vendoring is driven by imports, not by the loaded graph), but the `modules.txt` metadata reflects the pruned model.
- **A vendored, pruned module is doubly self-contained:** the source is on disk (`vendor/`) and the build list is fully described (pruned `go.mod`). This is the strongest reproducibility posture.

The interaction to watch: after migrating to pruning, re-run `go mod vendor` so `vendor/modules.txt` carries the updated `## explicit; go 1.x` markers and matches the new indirect block. A stale `vendor/` after a directive bump produces "inconsistent vendoring."

---

## Reproducibility and Toolchain Pinning

A pruned `go.mod` describes the build list, but reproducibility needs more than the dependency graph:

- **The `go` directive** governs pruning *and* language semantics.
- **The `toolchain` directive** (Go 1.21+) selects which Go version builds the module, affecting code generation and standard-library behaviour — neither of which pruning touches.
- **`go.sum`** verifies the bytes; `-compat` governs which `go.sum` metadata is retained for older toolchains.

For a reproducible pruned build:

1. Pin the `go` directive (pruning regime + language version).
2. Pin the `toolchain` directive and the CI build image.
3. Keep `go.mod`/`go.sum` tidy and committed together.
4. Optionally vendor for byte-on-disk reproducibility.

Pruning contributes the *graph* dimension of reproducibility — a self-contained, deterministic build list. The toolchain, standard library, and build flags are orthogonal dimensions you must pin separately.

---

## Anti-Patterns

- **Hand-editing the indirect block or `go.sum`.** Both are derived; editing them desynchronizes the pruned model. Always `go mod tidy`.
- **Migrating to pruning bundled with feature work.** The large `go.mod`/`go.sum` diff hides the real change and complicates bisecting. Isolate the directive bump.
- **Ignoring legacy (`go < 1.17`) dependencies.** Each one re-inflates the loaded graph for everyone downstream. Audit and upgrade.
- **Setting `-compat` reflexively to 1.16 forever.** Retains unnecessary `go.sum` entries on a modern module. Set it to your real support floor.
- **Reverting "extra" indirect lines after a deepening event.** Those lines are the correct MVS-preserving record. Reverting them breaks self-containment.
- **`GOFLAGS=-mod=mod` in CI.** Hides the "go.mod needs updating" signal that catches un-tidied contributions.
- **Assuming pruned and full builds can differ in selected versions.** They are engineered to agree; a real difference is a bug to report, not an accepted behaviour.
- **Mixing `go` directives across monorepo modules** without a reason. Standardize the regime.
- **Forgetting to re-vendor after a directive bump.** `vendor/modules.txt` markers go stale, producing "inconsistent vendoring."
- **Skipping the oldest-Go CI job for a library** that claims broad support. `-compat` regressions then surface only in downstream bug reports.

---

## Senior-Level Checklist

- [ ] Keep every module's `go` directive at a modern pruned version (`1.21`+ in 2026)
- [ ] Migrate the 1.17 boundary with `go mod tidy -go=... -compat=<floor>` in an isolated commit
- [ ] Audit dependency `go` directives; upgrade or replace `go < 1.17` laggards
- [ ] Understand deepening; do not revert the indirect lines it produces
- [ ] Set `-compat` to the library's real, documented support floor
- [ ] Run an oldest-supported-Go CI job for published libraries
- [ ] Gate `go mod tidy` cleanliness in CI; rely on the `-mod=readonly` default
- [ ] Pin the toolchain to eliminate indirect-block churn
- [ ] Re-vendor after any directive bump so `modules.txt` markers stay correct
- [ ] Treat any pruned-vs-full version discrepancy as a reportable bug
- [ ] Track `go mod graph | wc -l` as a graph-health metric
- [ ] Review the direct block carefully; scan the indirect block for surprises and run `govulncheck`

---

## Summary

At senior level, module graph pruning is a scalability and reproducibility property to be engineered around, not a flag to flip. It changes the dominant cost of graph loading from the full transitive closure to the import-relevant subgraph plus one level of requirements, and it makes `go.mod` a self-contained specification of the build list — at the price of a larger indirect block and noisier diffs.

The senior obligations cluster around three themes. **Migration:** cross the 1.17 boundary deliberately, with the right `-compat` floor, in an isolated commit, and verify older consumers. **Hygiene:** keep dependency `go` directives modern (a single legacy dependency re-inflates the loaded graph downstream), gate tidiness in CI, pin the toolchain, and re-vendor after directive bumps. **Correctness:** understand that pruning preserves the MVS fixpoint by construction, that deepening is benign and its `go.mod` churn legitimate, and that any genuine version divergence between pruned and full builds is a bug, not a feature.

Get those right and pruning is invisible in the best way: fast `go` commands, reproducible self-contained metadata, and reviewable diffs — with the indirect block owned entirely by `go mod tidy` and never by hand.
