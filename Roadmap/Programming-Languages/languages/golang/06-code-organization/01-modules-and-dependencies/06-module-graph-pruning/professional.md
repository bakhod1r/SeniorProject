# Module Graph Pruning — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Pruned Graph, Defined Precisely](#the-pruned-graph-defined-precisely)
3. [The Pruning Algorithm, Step by Step](#the-pruning-algorithm-step-by-step)
4. [Lazy Loading and the Module Loading State Machine](#lazy-loading-and-the-module-loading-state-machine)
5. [What `go mod tidy` Records and Why](#what-go-mod-tidy-records-and-why)
6. [The `-compat` Consistency Check in Detail](#the-compat-consistency-check-in-detail)
7. [Pruning's Effect on `go.sum`](#prunings-effect-on-gosum)
8. [Pruning and `vendor/modules.txt`](#pruning-and-vendormodulestxt)
9. [Graph Deepening Internals](#graph-deepening-internals)
10. [Performance Profile](#performance-profile)
11. [Programmatic Inspection](#programmatic-inspection)
12. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
13. [Operational Playbook](#operational-playbook)
14. [Summary](#summary)

---

## Introduction

The professional level treats module graph pruning as the contract between three subsystems: the module-graph loader (`modload`), the version resolver (MVS), and the `go.mod` writer (`go mod tidy`). Pruning is not a post-processing filter applied to a fully-loaded graph — it is a *loading strategy* that deliberately refuses to read parts of the graph, relying on the main module's `go.mod` to carry the information it skipped. Misunderstanding which information lives where is the root of most "works on my Go version, fails on theirs" and "indirect block churns endlessly" reports.

This file is for engineers who own Go build infrastructure, maintain widely-consumed libraries, debug module-resolution failures, or build module-graph tooling. After reading you will:

- Define the pruned graph in terms the toolchain actually implements.
- Trace the pruning algorithm end-to-end.
- Reason about lazy loading as a state machine with explicit promotion triggers.
- Understand what `go mod tidy` records, what `-compat` verifies, and how both touch `go.sum`.
- Diagnose deepening, churn, and cross-version inconsistency from first principles.

Pruning is conceptually a graph-compression that preserves the MVS fixpoint. Its details govern the reproducibility and performance of the build for the project's lifetime.

---

## The Pruned Graph, Defined Precisely

The Go Modules Reference defines the pruned module graph. Paraphrased and made operational:

For a main module `M` whose `go` directive is `≥ 1.17`, the **pruned module graph** is the graph containing:

1. `M` itself.
2. Every module `D` that provides a package transitively *imported* by a package or test of `M`.
3. For each module in (2) that is itself at `go ≥ 1.17`, the modules named in its `require` directives — i.e., **one level** of its stated requirements — *but not* the recursive expansion of those, unless they too provide imported packages.
4. For any module in the graph at `go ≤ 1.16` (not pruned, "unpruned dependency"), its **full transitive requirements**, because such a module is not self-contained.

The contrast with the **full graph**: the full graph is the unconditional transitive closure of all `require` edges. The pruned graph follows `require` edges only as far as the *import* graph and the one-level rule justify, treating `go ≥ 1.17` dependencies as self-contained boundaries.

The phrase to internalize: pruning follows the **import** graph, recording **requirements** only deeply enough to keep selection correct. A module you `require` (transitively) but never *import* a package from contributes its version (recorded as indirect in `M`'s `go.mod`) but not its deep requirement subtree.

---

## The Pruning Algorithm, Step by Step

Stripped to essentials, building the pruned graph for main module `M` proceeds:

1. **Seed.** Start with `M`'s `go.mod`: its `require` directives (direct and recorded indirect) define the initial module set with versions.
2. **Load relevant `go.mod` files.** For each module in the set that is *import-relevant* (supplies a package `M` builds or tests), load its `go.mod`.
3. **Expand one level for pruned modules.** For each loaded `go ≥ 1.17` module, add the modules it `require`s to the graph — but do not recurse into them unless they are themselves import-relevant.
4. **Expand fully for unpruned modules.** For each `go ≤ 1.16` module encountered, load and recursively expand its *entire* requirement subtree (it is not self-contained).
5. **Run MVS** over the resulting graph to select one version per module path.
6. **Verify against `M`'s `go.mod`.** Under `-mod=readonly`, if the selected build list requires a version not recorded (directly or indirectly) in `M`'s `go.mod`, the command errors with "updates to go.mod needed." Under `tidy`/`-mod=mod`, the missing requirements are written.

### Pseudocode

```go
func prunedGraph(main *Module) *Graph {
    g := newGraph()
    g.add(main)

    // The main module's go.mod (direct + recorded indirect) is the seed.
    work := main.Requires() // every require line, incl. // indirect

    for _, dep := range work {
        g.add(dep)
        if !importRelevant(main, dep) {
            continue // version recorded, but no requirement expansion
        }
        depMod := loadGoMod(dep) // read this module's go.mod
        if depMod.GoVersion >= "1.17" {
            // self-contained: take only its direct requires (one level)
            for _, r := range depMod.Requires() {
                g.add(r) // queued; expanded only if itself import-relevant
            }
        } else {
            // not self-contained: must expand fully (full subtree)
            g.addFullClosure(depMod)
        }
    }
    return g
}
```

The real implementation in `cmd/go/internal/modload` is more elaborate (it interleaves loading with MVS, handles `replace`/`exclude`, and caches aggressively), but the shape — import-relevance gates requirement expansion, and the `go` directive decides self-containment — is exactly this.

---

## Lazy Loading and the Module Loading State Machine

Lazy module loading is the runtime complement to pruning. The toolchain maintains a *loading level* and promotes it only when a command's needs demand it.

Three conceptual levels:

| Level | What is loaded | Sufficient for |
|-------|----------------|----------------|
| **main module only** | `M`'s `go.mod` (direct + indirect requires) | resolving imports whose modules are already pinned in `go.mod`; most `go build`/`go test` on an already-tidy module |
| **pruned graph** | `M`'s `go.mod` + `go.mod` of import-relevant `go 1.17+` deps (+ full subtrees of legacy deps) | resolving a build that touches modules not fully pinned by `go.mod`; `go list -m all` |
| **full graph** | the entire transitive closure | `go mod graph`, `go mod tidy`, reconciling `go get` of deep-affecting modules |

Promotion triggers:

- An import resolves to a package whose providing module is not determinable from the current level → promote.
- The user runs a command that is *defined* over the full graph (`go mod graph`, `go mod tidy`) → load full.
- A `go ≤ 1.16` dependency is encountered → its subtree must be loaded (partial full-graph load).

The design intent: the *common* developer/CI path (build/test a tidy module) stays at the cheapest level. The expensive levels are reserved for operations that genuinely need them. This is why a tidy `go 1.17+` module builds without ever loading the full graph — the main module's `go.mod` is the source of truth.

---

## What `go mod tidy` Records and Why

`go mod tidy` is the writer that makes pruning sound. Its job: ensure `M`'s `go.mod` records *exactly* the requirements needed for the pruned graph to select the same versions as the full graph, for every imported package.

What it records:

- **Direct requirements:** every module from which `M`'s packages import (non-test and test), without `// indirect`.
- **Indirect requirements:** every additional module whose version must be pinned in `M`'s `go.mod` so the pruned graph is self-contained. This includes:
  - Modules supplying transitively-imported packages whose version is not implied by a direct dependency's recorded requirements.
  - Modules whose version MVS would have raised based on a constraint living in a pruned-away part of the full graph — recorded so the pruned graph reproduces that raise.

What it removes:

- Requirements for modules no longer imported (after a refactor drops an import).
- Stale indirect entries no longer needed for self-containment.

Why the indirect set is larger under pruning: in the full graph, those versions were *derived* by loading the deep graph at build time. Pruning does not load that deep graph, so the versions must be *recorded*. `tidy` is computing the closure that pruning chose not to load and writing it down.

The two-`require`-block layout (direct in one, indirect in another) is `tidy`'s formatting convention for readability; it is not semantically required — a single block with `// indirect` comments is equivalent.

---

## The `-compat` Consistency Check in Detail

`-compat=<version>` makes `go mod tidy` maintain compatibility with an older Go version's *graph loading*. Mechanically:

1. `tidy` computes the build list under the **current** (pruned) regime.
2. It also computes the build list the **`-compat` version** would compute under *its* regime (for `-compat ≤ 1.16`, the full-graph regime).
3. It verifies the two build lists **agree** for all imported packages.
4. It retains the `go.sum` entries (notably `go.mod` hashes) that the `-compat` version needs to load *its* graph — entries the pruned regime would otherwise drop.

If the two regimes *disagree* on a selected version, `tidy -compat` reports an **inconsistency** and refuses to silently produce a `go.mod` that builds differently on the two Go versions. This is a feature: it surfaces a genuine cross-version hazard rather than hiding it.

Defaults:

- For a `go 1.17+` module, `tidy` defaults `-compat` to **one minor version below** the `go` directive. A `go 1.17` module defaults to `-compat=1.16`; a `go 1.21` module defaults to `-compat=1.20`.
- Override to your true support floor: `go mod tidy -compat=1.17` on a `go 1.21` module if you support consumers down to 1.17.

The practical failure this prevents: a consumer on an older Go loading the full graph, needing a `go.mod` hash that your pruned tidy removed, and failing with "missing go.sum entry." `-compat` keeps that hash.

---

## Pruning's Effect on `go.sum`

`go.sum` holds two kinds of hashes per module version: the module *content* hash (`h1:`) and the module *`go.mod`* hash (`/go.mod h1:`). Pruning primarily affects the latter.

- **Content hashes** are required for every module whose packages are *built*. Pruning does not change which packages are built, so content-hash requirements are largely unchanged.
- **`go.mod` hashes** are required for every module whose `go.mod` is *loaded*. Pruning loads fewer `go.mod` files, so *fewer* `go.mod` hashes are strictly required for the pruned build.
- **`-compat`** reintroduces the `go.mod` hashes an older, full-graph Go would load — so its graph-load verification succeeds.

Consequences:

- After migrating to pruning *without* `-compat`, `go.sum` may shed `go.mod` hashes; older consumers then fail to load the full graph.
- `go mod tidy` is the only correct way to reconcile `go.sum` with the pruned graph. Hand-editing `go.sum` (or deleting "unused" lines) breaks verification.
- Integrity of the *build* is unchanged: every built module is still content-verified. Pruning is about which *metadata* hashes are retained.

---

## Pruning and `vendor/modules.txt`

Vendoring records pruning-relevant metadata so a vendored build applies correct semantics without loading any graph.

The Go 1.17 addition to `vendor/modules.txt` is the per-module `go` directive marker:

```
# github.com/spf13/cobra v1.8.0
## explicit; go 1.15
github.com/spf13/cobra
# golang.org/x/sys v0.18.0
## go 1.17
golang.org/x/sys/unix
```

- `## explicit` — the module is a direct dependency of the main module.
- `## go 1.x` — the dependency module's own `go` directive, recorded so the vendored build knows whether that module is pruned (self-contained) when interpreting language-version-dependent semantics.

Why it matters for pruning: a vendored build does not load the module graph at all — it trusts `vendor/modules.txt`. To apply the right per-module semantics (including pruning-aware behaviour), the file must carry each module's `go` version. That marker is exactly what 1.17 added.

Operational rule: after bumping the main module's `go` directive or changing dependencies, re-run `go mod vendor` so these markers and the package set match the updated, pruned `go.mod`. A stale `vendor/` produces "inconsistent vendoring." See [03-go-mod-vendor/professional.md](../03-go-mod-vendor/professional.md).

---

## Graph Deepening Internals

Deepening is the controlled re-expansion of a pruned graph. The toolchain deepens to preserve correctness when the pruned view is insufficient.

When deepening occurs:

- **New import added.** Resolving the new package may require a module not in the current pruned set; the loader expands to find and pin it.
- **`go get <module>@<version>`.** Reconciling the requested version against the rest of the graph can require loading requirements previously pruned.
- **Legacy dependency relevant.** A `go ≤ 1.16` module forces loading its full subtree.

What deepening produces:

- Additional `// indirect` lines in `M`'s `go.mod`, recording versions revealed by the newly-loaded region.
- Additional `go.sum` entries for the newly-loaded `go.mod` files.

Why deepening is correct, not lossy: the design guarantees the *final* build list equals the full-graph build list for imported packages. Deepening simply loads enough of the graph to record the constraints pruning had elided. A single import change legitimately producing a multi-line `go.mod` diff is deepening writing those constraints down.

A *selected-version* change after deepening means the newly-loaded region carried a higher minimum requirement that was always logically present in the full graph. The recorded result is the correct MVS outcome; treat an unwanted bump by explicit, informed pinning — never by deleting the deepened lines.

---

## Performance Profile

Pruning's cost model, by operation:

| Operation | Graph level | Cost driver |
|-----------|-------------|-------------|
| `go build`/`go test` (tidy module) | main module only / pruned | import-relevant `go.mod` reads; usually cheap |
| `go list -m all` | pruned | size of pruned graph |
| `go mod graph` | full | size of full graph |
| `go mod tidy` | full (+ `-compat` graph) | full closure load, twice if `-compat` |
| `go get <dep>` | pruned → deepened | extent of deepening |

The headline win: for the common build/test path, graph-load cost drops from O(full transitive closure) to O(import-relevant subgraph). On large services this is the difference between thousands and dozens of `go.mod` reads, and it shows up as faster cold `go` commands and fewer `go.mod` fetches behind restricted networks.

The residual costs:

- `go mod tidy` is still O(full graph) (it must be — it computes the recorded closure). It is the expensive command; run it deliberately, not in hot loops.
- A legacy dependency re-introduces full-subtree loading for its region, partially eroding the win.

Measure with `go mod graph | wc -l` (pruned vs full by toggling the directive) and by timing cold `go list -m all`.

---

## Programmatic Inspection

Tools that need to reason about the pruned graph without re-implementing the toolchain:

### `go list -m -json all`

Emits the build list as JSON, one record per module, including `Path`, `Version`, `Indirect`, `GoVersion`, and `Replace`. This is the pruned build list (for a `go 1.17+` module) in the exact order MVS resolved it.

```bash
go list -m -json all | jq -r 'select(.Indirect == true) | .Path'   # indirect set
go list -m -json all | jq -r 'select(.GoVersion < "1.17") | "\(.Path) \(.GoVersion)"'  # legacy deps
```

The second query is the key one: it surfaces every dependency that is *not* self-contained and therefore inflates the loaded graph.

### `go mod graph`

Prints the (pruned) graph edges. Diff the edge count against a temporarily-downgraded directive to quantify pruning.

### `go mod why -m <module>`

Explains why a module is in the graph — invaluable for triaging a surprising indirect entry produced by deepening.

### `golang.org/x/mod/modfile`

Parses `go.mod` programmatically (`require`, `// indirect`, `go`, `toolchain` directives). Use it to *read* the recorded requirement set; do not use it to *compute* the pruned graph — that requires the toolchain's MVS-and-loading machinery, which will drift between releases.

### When to shell out

Computing the pruned graph from scratch is brittle (MVS, import-relevance, legacy-dependency expansion, `-compat` reconciliation). The supported approach is to invoke `go list`/`go mod` and parse their output, not to re-derive pruning.

---

## Edge Cases the Source Reveals

A close reading of `cmd/go/internal/modload` exposes corners worth knowing:

- **`replace` and pruning.** A `replace` redirects a module's source and `go.mod`. Pruning then uses the *replacement's* `go` directive to decide self-containment. Replacing a `go 1.21` module with a `go 1.15` fork re-inflates the graph in that region.
- **`exclude` directives** remove specific versions from consideration before MVS; pruning operates on the post-exclude graph.
- **A `go ≤ 1.16` main module with a `vendor/` directory** does not get pruning *or* the 1.17 `vendor/modules.txt` markers; its vendored build follows full-graph semantics.
- **Test-only imports of the main module** are in the pruned graph; test-only imports of *dependencies* are not. This asymmetry is intentional and is the bulk of pre-1.17 graph bloat that pruning removed.
- **`tidy` after adding a test import** can deepen the graph and grow `go.mod`, even though no non-test code changed.
- **Modules whose `go` directive is newer than your toolchain** are still recorded; the build may fail with a clear version-mismatch message, but pruning metadata is consistent.
- **The default `-compat` is dynamic** (one minor below the directive), so re-running `tidy` after bumping the `go` directive can change retained `go.sum` entries even with no dependency change.

These are pointers to *reach for the reference and the source* when behaviour surprises you. The `modload` package is well-commented and the pruning logic is tractable.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Migrate a module to pruning | `go mod tidy -go=1.17 -compat=1.16`; commit `go.mod`+`go.sum` in isolation. |
| Migrate straight to modern Go | `go mod tidy -go=1.21`; accept default `-compat` (1.20) or set your floor. |
| Verify go.mod is tidy | `go mod tidy && git diff --exit-code go.mod go.sum`. |
| Find legacy (`go < 1.17`) deps | `go list -m -json all \| jq -r 'select(.GoVersion < "1.17") \| .Path'`. |
| Quantify pruning | Compare `go mod graph \| wc -l` at the current directive vs a temporary `go 1.16`. |
| Triage a surprising indirect entry | `go mod why -m <module>`. |
| Fix "updates to go.mod needed" | `go mod tidy`; commit. |
| Fix older consumer "missing go.sum entry" | `go mod tidy -compat=<their Go version>`; commit. |
| Re-sync vendor after directive bump | `go mod vendor`; commit `vendor/`. |
| Prevent indirect-block churn | Pin `toolchain go1.x.y`; agree on `-compat`. |
| Reproduce pruned-vs-full selection | Tidy at both directives; `go list -m all` each; diff. A diff is a bug to report. |

---

## Summary

Module graph pruning is a *loading strategy*, not a filter: the toolchain refuses to read the deep, never-imported tails of the module graph, relying on the main module's `go.mod` to record the requirements it skipped. The pruned graph follows the import graph and expands requirements only one level for self-contained (`go ≥ 1.17`) dependencies, while fully expanding non-self-contained (`go ≤ 1.16`) ones. Lazy loading layers on top, keeping the common build/test path at the cheapest loading level and reserving full-graph loads for `tidy`, `go mod graph`, and deep reconciliation.

`go mod tidy` is the writer that makes this sound — it records exactly the direct and indirect requirements needed for the pruned graph to reproduce the full graph's MVS selection, and `-compat` verifies (and preserves the `go.sum` metadata for) an older Go version's full-graph load. Pruning sheds `go.mod` hashes from `go.sum` for files it no longer loads; `-compat` keeps the ones older toolchains need. `vendor/modules.txt`'s `## go 1.x` markers carry per-module directives so vendored builds apply pruning semantics without any graph load.

Deepening is the controlled re-expansion that records constraints pruning elided; its `go.mod` churn is correct, and any genuine selected-version divergence between pruned and full builds is a bug to report, not a behaviour to accept. The professional payoff is a precise mental model: imports drive what loads, the `go` directive decides self-containment, `tidy` records the closure, `-compat` guards cross-version agreement, and the build list is identical to the unpruned one — only the loading cost differs.
