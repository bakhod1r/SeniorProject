# Module Graph Pruning — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Two Graphs: Full vs Pruned](#the-two-graphs-full-vs-pruned)
3. [What Exactly Gets Loaded Under Pruning](#what-exactly-gets-loaded-under-pruning)
4. [Why `go.mod` Records More Indirect Requirements](#why-gomod-records-more-indirect-requirements)
5. [Lazy Module Loading: The Companion Feature](#lazy-module-loading-the-companion-feature)
6. [`go mod graph` Under Pruning](#go-mod-graph-under-pruning)
7. [`go mod tidy` with `-go` and the Two Regimes](#go-mod-tidy-with-go-and-the-two-regimes)
8. [The `-compat` Flag](#the-compat-flag)
9. [When the Full Graph Must Still Be Loaded](#when-the-full-graph-must-still-be-loaded)
10. [Pruning and Test Dependencies](#pruning-and-test-dependencies)
11. [Interaction with MVS](#interaction-with-mvs)
12. [Interaction with `go.sum`](#interaction-with-gosum)
13. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
14. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
15. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know the headline: at `go 1.17+`, the module graph is pruned, `go.mod` grows an indirect block, and `go` commands get faster. The middle-level questions are *what precisely is in the pruned graph*, *what is left out*, *when the full graph still has to be loaded anyway*, and *how the tooling (`go mod graph`, `go mod tidy -go`, `-compat`) behaves across the 1.16/1.17 boundary*.

This file moves from "pruning exists" to "I can predict what the graph contains and why a given `go.mod` change happened."

After reading this you will:
- State precisely which modules' `go.mod` files load under pruning and which are pruned away
- Explain why the indirect block must exist for correctness, not just convenience
- Use `go mod tidy -go=1.16` vs `-go=1.17` and `-compat` deliberately
- Identify the situations that force Go to load the full graph anyway
- Reason about how pruning feeds MVS without changing its result
- Diagnose pruning-related `go.mod` churn from first principles

---

## The Two Graphs: Full vs Pruned

A module's `go.mod` requires other modules; those require still others. The closure of all these `require` edges is the **module graph**.

### The full (unpruned) graph

For a main module at `go 1.16` or lower, the graph is the *complete transitive closure*. Go loads the `go.mod` of every module reachable through any chain of requirements — including modules needed only by some distant dependency's tests or unused features. The graph is large; building it requires fetching many `go.mod` files.

### The pruned graph

For a main module at `go 1.17` or higher, the graph is *pruned*. Informally, it contains:

1. The main module.
2. Every module providing a package that is **imported** (transitively) by a package or test in the main module.
3. For each such module, the **direct requirements** recorded in its `go.mod` — but **not** the deeper transitive requirements of modules that are themselves only transitively relevant.

The decisive rule: a dependency's *own* dependencies are included in the pruned graph **only if** that dependency is at `go 1.17+` *and* its packages are imported by your build. The deep tails — requirements of modules you reach only indirectly and never import packages from — are pruned.

### The intuition

The full graph answers "what could anything possibly need?" The pruned graph answers "what does *building and testing the main module* actually need, plus one level of each relevant dependency's stated requirements?" The second question has a far smaller answer.

---

## What Exactly Gets Loaded Under Pruning

Precision matters here, because "pruned" is often mis-stated as "only direct dependencies." It is more than that.

The pruned module graph includes the transitive `go.mod` requirements of:

- The **main module** (your `go.mod`).
- Every module that **provides a package imported** by the main module's packages or tests — directly or transitively through *imports*.

For each of those modules, Go loads its `go.mod` and reads its `require` lines. But it does **not** recursively expand the requirements of a module unless that module *also* supplies an imported package and is at `go 1.17+`.

Contrast the two traversals:

- **Full graph:** follow `require` edges everywhere, unconditionally.
- **Pruned graph:** follow `require` edges, but stop descending into modules whose packages you never import (their requirements are not needed — except as recorded indirect deps in *your* `go.mod`).

The consequence: pruning replaces "walk the whole `require` forest" with "walk the part of the forest that the *import* graph actually touches, plus the immediate requirements of those modules."

A module whose `go` directive is `< 1.17` is *unpruned* internally: when such a module is relevant, Go must load its full transitive requirements, because that old module did not record enough indirect deps to be self-contained. This is why upgrading dependencies to `go 1.17+` keeps *your* graph small.

---

## Why `go.mod` Records More Indirect Requirements

This is the crux that confuses people. Under the full graph, the deep transitive requirements were always available at build time, because Go loaded them. Under pruning, Go deliberately does *not* load them — so if a needed version came from a pruned-away part of the graph, it would be lost.

The fix: the main module's `go.mod` must **record** every indirect dependency whose selected version is not otherwise implied by the pruned graph. `go mod tidy` computes this set and writes the `// indirect` lines.

Concretely, an indirect requirement is recorded in a pruned `go.mod` when:

- A package imported by your build (directly or transitively) is provided by that module, **and**
- The module's version is not already pinned by a `go 1.17+` direct dependency's recorded requirements.

So the larger indirect block is not redundancy — it is the information that pruning removed from the loadable graph, written back into the one file Go *always* reads: your `go.mod`. That is what makes a pruned `go.mod` **self-contained**: Go can determine the build list from your `go.mod` plus the `go.mod` of relevant `go 1.17+` dependencies, without crawling the deep graph.

The reference states this directly: *"so that the module graph can be pruned without changing the selected versions of any of the (transitively) imported packages, the go.mod file for each module needs to include enough indirect requirements."*

---

## Lazy Module Loading: The Companion Feature

Pruning is half of a pair. The other half is **lazy module loading**, also new in 1.17.

The goal of lazy loading: most `go` commands should be answerable from the **main module's `go.mod` alone**, without loading even the pruned graph, let alone the full one.

How it works: because a `go 1.17+` `go.mod` records *all* the indirect requirements needed to determine the versions of imported packages, the toolchain can resolve imports for `go build`, `go test`, and similar commands by consulting your `go.mod` and the `go.mod` files of the modules it actually needs to read — loading the broader graph *lazily*, only when a command genuinely requires it (for example, `go mod graph`, or adding a new dependency).

The combined effect:

- **Common path:** your `go.mod` is the source of truth. Build-list determination is cheap.
- **Rare path:** when Go must reconcile or expand the graph (new imports, `go get -u`, `go mod graph`), it loads more.

Lazy loading is why "the main module's `go.mod` becomes the source of truth" is the right mental model. Pruning makes the graph small; lazy loading avoids loading even that small graph unless necessary.

---

## `go mod graph` Under Pruning

`go mod graph` prints the module graph, one `from to` edge per line. Its output reflects pruning:

```bash
go mod graph
```

For a `go 1.17+` main module, this prints the **pruned** graph — substantially fewer edges than the equivalent full graph. The command *does* load the full graph internally when needed for completeness, but the relationships it shows are those of the pruned model relevant to your build.

Useful invocations:

```bash
go mod graph | wc -l                       # how many edges?
go mod graph | grep '^example.com/app@'    # what does the main module require?
go mod graph | grep ' golang.org/x/sys@'   # who pulls in x/sys?
```

If you downgrade the `go` directive to `1.16` and re-run, the edge count grows — you are now looking at the full graph. This is the cleanest way to *see* pruning: compare `go mod graph | wc -l` at `go 1.16` vs `go 1.21` for the same project.

---

## `go mod tidy` with `-go` and the Two Regimes

`go mod tidy` behaves differently depending on the target `go` version, and the `-go` flag lets you choose it explicitly:

```bash
go mod tidy -go=1.16    # produce a go.mod for the FULL-graph regime
go mod tidy -go=1.17    # produce a go.mod for the PRUNED-graph regime
```

What changes:

- `tidy -go=1.16` writes a `go 1.16` directive and records the indirect set appropriate for the **full graph** — generally *fewer* `// indirect` lines, because the deep graph is loaded at build time to fill gaps.
- `tidy -go=1.17` (or any 1.17+) writes that directive and records the **larger** indirect set required for the pruned graph to be self-contained.

Running `go mod tidy` with no `-go` flag uses the directive already in `go.mod` (or the toolchain default for a new module). The flag is how you *migrate*: `go mod tidy -go=1.17` is the supported one-shot upgrade from full to pruned.

Crossing this boundary is the single biggest source of large, surprising `go.mod` diffs. It is expected: you are changing graph regimes.

---

## The `-compat` Flag

When you migrate to pruning, you may still need older Go versions (in CI, in downstream consumers) to build the module correctly. The full graph and the pruned graph can, in edge cases, disagree about checksums recorded in `go.sum`. The `-compat` flag addresses this:

```bash
go mod tidy -compat=1.16
```

`-compat=<version>` tells `tidy` to *preserve enough additional `go.sum` entries* (and check consistency) so that the older Go version named can still load the module graph and reach the same build list. Specifically, it keeps the `go.sum` hashes for the `go.mod` files that the *older*, unpruned Go would need to load.

Defaults and behaviour:

- For a `go 1.17+` module, `go mod tidy` defaults to `-compat` equal to **one version below** the module's `go` directive (so a `go 1.17` module defaults to `-compat=1.16`). This keeps the immediately-prior Go release able to build.
- Set `-compat` explicitly when your support matrix demands a specific floor, e.g. `-compat=1.16` even on a `go 1.21` module if 1.16 consumers exist.
- `tidy` will *report an inconsistency* if it cannot make the pruned and `-compat` graphs agree — surfacing a real compatibility problem rather than hiding it.

In a modern codebase that only supports recent Go, you rarely set `-compat` by hand; the default is fine. You reach for it when you maintain a library consumed by laggard toolchains.

---

## When the Full Graph Must Still Be Loaded

Pruning is an optimization that applies to *most* operations. Some operations genuinely need the complete picture, and Go loads the full graph for them:

- **`go mod graph`** (without restriction) — to print all edges accurately, the full graph may be loaded.
- **`go get` of a module that affects deep requirements** — resolving a new or upgraded dependency can require expanding beyond the pruned set.
- **`go mod tidy`** — tidy must consider the complete graph to compute the correct indirect set (and, with `-compat`, the older graph too).
- **A dependency at `go 1.16` or lower in your graph** — that module is not self-contained, so Go loads its full transitive requirements to fill in what it did not record. One old dependency can pull a chunk of the full graph back in.
- **Conflicting or missing requirements** — when the pruned graph is insufficient to resolve a version, Go widens to the full graph to reconcile.

The practical lesson: pruning makes the *common* path cheap. Commands that must reason about the *entire* dependency universe still pay the full-graph cost — and a single legacy (`go < 1.17`) dependency can erode pruning's benefit for everyone downstream.

---

## Pruning and Test Dependencies

Tests complicate the graph, and pruning handles them with a deliberate rule.

The pruned graph includes the modules needed to build and **test the packages of the main module**. That is, the test dependencies of *your* packages are in scope. But the **test dependencies of your dependencies** are *not* automatically in the pruned graph — you do not run their tests, so their test-only requirements are pruned away.

This is precisely why pre-1.17 graphs were so bloated: the full graph dragged in the test dependencies of every transitive module, even though you would never run those tests. Pruning cuts exactly that fat.

Consequence for the indirect block: `go mod tidy` records the indirect deps needed to build and test *your* code, including imports reached only from *your* `_test.go` files. It does **not** record the test-only deps of upstream modules. If you ever need to run an upstream module's own tests (you usually cannot, and should not, from a consumer), pruning is one reason its test deps are absent.

---

## Interaction with MVS

Minimal Version Selection ([04-minimal-version-selection-mvs](../04-minimal-version-selection-mvs/middle.md)) is the algorithm that picks one version per module from the graph. Pruning and MVS relate as input and algorithm:

- **Pruning shapes the input.** It determines *which* `go.mod` files (and thus which `require` edges) MVS sees.
- **MVS is unchanged.** It still selects the maximum of the minimum required versions, per module.

The crucial design guarantee: **pruning is constructed so that MVS over the pruned graph selects the same versions as MVS over the full graph**, for every package the main module actually imports. That equivalence is exactly why the indirect block must be complete — the recorded indirect requirements ensure MVS has every version constraint it would have seen in the full graph for relevant packages.

So pruning is not "a different version-selection algorithm." It is "the same MVS, fed a smaller-but-equivalent graph." The build list is identical (outside deepening edge cases discussed at senior level); only the loading cost differs.

---

## Interaction with `go.sum`

`go.sum` records cryptographic hashes of module content and of module `go.mod` files. Pruning interacts with it in two ways:

1. **Fewer `go.mod` hashes needed (sometimes).** Because the pruned graph loads fewer `go.mod` files, fewer `go.mod` hashes are strictly required to verify the build. `go mod tidy` keeps `go.sum` aligned with what the pruned graph loads.
2. **`-compat` preserves extra hashes.** As covered above, `-compat=<older>` retains the `go.sum` entries that the older, unpruned Go would need — so that toolchain can verify the graph it loads. Without `-compat`, those entries might be tidied away, breaking older builds with "missing go.sum entry."

Two practical rules:

- Always commit `go.mod` and `go.sum` together after `tidy`. Pruning makes `go.mod` larger and can change which `go.sum` entries are kept.
- If older Go versions report missing `go.sum` entries after you migrated to pruning, you tidied without an adequate `-compat`. Re-run `go mod tidy -compat=<their version>`.

Integrity itself is unchanged: every module in the *build* is still verified. Pruning affects which *metadata* (`go.mod`) hashes are retained, not whether your dependencies are checked.

---

## Common Errors and Their Real Causes

A field guide to pruning-adjacent failures.

### `go: updates to go.mod needed; to update it: go mod tidy`

The build (under the default `-mod=readonly`) found that the pruned `go.mod` is missing a required indirect entry, or an entry is stale. Cause: a dependency change without a follow-up `tidy`. Fix: `go mod tidy`, commit.

### `missing go.sum entry for module providing package X` (only on older Go)

Your `go.mod` migrated to pruning and `tidy` dropped `go.sum` entries that an *older* consumer's full-graph load still needs. Cause: tidied without sufficient `-compat`. Fix: `go mod tidy -compat=<older version>`, commit.

### `go.mod` indirect block churns between developers

Two contributors on different Go toolchains run `tidy` and produce slightly different indirect sets or `go.sum` contents. Cause: unpinned toolchain across the pruning boundary, or different `-compat` defaults. Fix: pin the toolchain (`toolchain` directive, Go 1.21+) and agree on `-compat`.

### Graph is much bigger than expected for a 1.17+ module

A dependency in your graph is at `go 1.16` or lower, so it is not self-contained and Go loads its full transitive requirements. Cause: a legacy dependency. Fix: upgrade that dependency to a `go 1.17+` release if one exists; otherwise accept the larger graph.

### `go mod tidy` removes an indirect line you thought was needed

The package that required it is no longer imported by your build (a refactor removed the import). `tidy` correctly pruned it. Cause: stale assumption. Verify with `go mod why -m <module>`.

---

## Best Practices for Established Codebases

1. **Keep the `go` directive at `1.17+`** (in practice `1.21+`). Pruning is automatic and beneficial; there is no reason to stay on the full graph.
2. **Migrate with `go mod tidy -go=1.17`** (or higher) as a dedicated commit. The `go.mod` diff is large; isolate it.
3. **Set `-compat` to your real support floor.** If consumers run old Go, `go mod tidy -compat=<floor>`. Otherwise accept the default (one minor below your directive).
4. **Pin the toolchain.** The `toolchain` directive prevents indirect-block churn from differing local Go versions.
5. **Add a CI tidiness gate:** `go mod tidy && git diff --exit-code go.mod go.sum`.
6. **Upgrade legacy (`go < 1.17`) dependencies** when possible — each one that becomes self-contained shrinks your graph.
7. **Read `go mod graph | wc -l`** as a health metric. A surprising jump means a legacy dep or a new heavy dependency entered the graph.
8. **Never hand-edit the indirect block or `go.sum`.** Both are derived; `tidy` owns them.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — A `go 1.16` dependency silently bloats the graph

You are pruned, but one transitive dependency still declares `go 1.15`. Go must load its full requirements, dragging in deep modules. Symptom: `go mod graph` larger than peers expect. Fix: upgrade or replace the laggard.

### Pitfall 2 — Migrating without `-compat`, breaking old consumers

You bump to `go 1.21` and tidy. Internal CI passes. A downstream team on Go 1.16 reports "missing go.sum entry." Cause: their full-graph load needs hashes you tidied away. Fix: `go mod tidy -compat=1.16` (or document a minimum Go version and let them upgrade).

### Pitfall 3 — Treating the big indirect block as a merge artifact

After a directive bump, the indirect block doubles. A reviewer "cleans it up" by deleting unfamiliar lines. The next build fails or selects different versions. Fix: the block is generated; restore with `go mod tidy`.

### Pitfall 4 — Expecting `go mod graph` to be tiny

Pruning shrinks the graph but does not make it trivial — your direct deps' immediate requirements are all there. A few hundred edges on a real service is normal. Compare against the *full*-graph count to appreciate the reduction.

### Pitfall 5 — Toolchain drift across the boundary

Person A on Go 1.20 and Person B on Go 1.22 tidy the same module and produce different `go.mod`/`go.sum`. Their PRs revert each other. Fix: `toolchain go1.22.x` in `go.mod`, documented in `CONTRIBUTING.md`.

### Pitfall 6 — Confusing "pruned" with "fewer dependencies"

Pruning prunes the *graph Go loads*, not your dependency *count*. You depend on exactly the same modules; Go just loads fewer of their `go.mod` files. The build list (`go list -m all`) is unchanged.

### Pitfall 7 — `GOFLAGS=-mod=mod` masking tidiness problems

With `-mod=mod`, Go silently updates `go.mod` during builds, hiding the "updates needed" error that `-mod=readonly` would surface. CI then never catches a contributor who forgot to tidy. Fix: rely on the `-mod=readonly` default; do not set `-mod=mod` globally.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Define the pruned graph precisely (not just "direct dependencies")
- [ ] Explain why the indirect block is required for correctness, not convenience
- [ ] Describe lazy module loading and how it relates to pruning
- [ ] Predict how `go mod graph` output changes across the 1.16/1.17 boundary
- [ ] Use `go mod tidy -go=1.16` vs `-go=1.17` and explain the different indirect sets
- [ ] Explain what `-compat` preserves and when you must set it
- [ ] List the operations that force the full graph to load
- [ ] State the pruning rule for your tests vs your dependencies' tests
- [ ] Explain why pruning does not change MVS's selected versions
- [ ] Diagnose every error in the "Common Errors" section from a one-line message

---

## Summary

Module graph pruning replaces the full transitive closure of `require` edges with a graph that follows the *import* graph: the main module, the modules supplying packages it builds and tests, and those modules' immediate recorded requirements — stopping before the deep, never-imported tails. Because that pruning removes information Go used to load at build time, the main module's `go.mod` records a larger set of `// indirect` requirements, making it self-contained: the build list is computable from `go.mod` plus the `go.mod` of relevant `go 1.17+` dependencies.

Lazy module loading rides on top, letting most commands answer from `go.mod` alone. `go mod graph` reflects the pruned model; `go mod tidy -go=1.17` performs the migration; `-compat=<older>` keeps older toolchains able to load and verify the graph. The full graph is still loaded for `tidy`, `go mod graph`, `go get` of deep-affecting modules, and whenever a `go < 1.17` dependency (which is not self-contained) is relevant.

Throughout, MVS is unchanged: pruning is engineered so the pruned graph selects the same versions as the full graph for every imported package. The win is loading cost; the cost is a bigger, but self-contained, `go.mod`. Keep the directive modern, migrate in a dedicated commit, set `-compat` to your support floor, pin the toolchain, and let `tidy` own the indirect block.
