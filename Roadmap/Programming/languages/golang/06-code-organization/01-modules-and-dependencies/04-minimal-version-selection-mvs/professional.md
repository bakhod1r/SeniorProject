# Minimal Version Selection (MVS) — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Algorithm, Formally](#the-algorithm-formally)
3. [The Four Operations in Pseudocode](#the-four-operations-in-pseudocode)
4. [Build List Construction Step by Step](#build-list-construction-step-by-step)
5. [Upgrade-One and Requirement Tightening](#upgrade-one-and-requirement-tightening)
6. [Downgrade and Reverse Propagation](#downgrade-and-reverse-propagation)
7. [Module Graph Pruning (`go 1.17+`)](#module-graph-pruning-go-117)
8. [Lazy Module Loading](#lazy-module-loading)
9. [Version Ordering: SemVer, Pseudo-Versions, `+incompatible`](#version-ordering-semver-pseudo-versions-incompatible)
10. [`replace`, `exclude`, `retract` in the Algorithm](#replace-exclude-retract-in-the-algorithm)
11. [Programmatic Inspection](#programmatic-inspection)
12. [Performance Profile](#performance-profile)
13. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
14. [Operational Playbook](#operational-playbook)
15. [Summary](#summary)

---

## Introduction

The professional level treats MVS not as "Go picks the minimum version" but as a precisely-specified set of four algorithms operating over a versioned requirement graph, plus the graph-pruning and lazy-loading machinery that makes those algorithms tractable on real-world dependency trees. The selection rule is one line; the engineering is in *how the graph is loaded*, *how downgrades propagate*, and *how version ordering handles pseudo-versions and `+incompatible`*.

This file is for engineers who maintain Go build infrastructure, write module-aware tooling, debug opaque version-selection failures in large monorepos, or need to reason about reproducibility guarantees down to the algorithm. After reading you will:

- State MVS's four operations formally and implement each in pseudocode.
- Reason about module graph pruning and lazy loading as graph-scope reductions, not result changes.
- Handle version ordering for pseudo-versions and `+incompatible` correctly.
- Know where `replace`, `exclude`, and `retract` enter the algorithm.
- Build inspection tooling on `go list -m -json` and `golang.org/x/mod` without re-implementing MVS.

The implementation lives primarily in `cmd/go/internal/modload` and the reusable `golang.org/x/mod/mvs` package. The algorithm is small enough to read in an afternoon; the value is in knowing *where the subtlety hides* — and it hides in downgrade propagation and graph scope, not in selection.

---

## The Algorithm, Formally

Define the requirement graph `G`:

- **Nodes:** module versions `(m, v)`, plus a distinguished main module `M`.
- **Edges:** `(m, v) -> (m', v')` iff `(m, v)`'s `go.mod` contains `require m' v'`. The main module `M` has edges for its own `require` directives.

For a module path `m`, let `Req(m)` be the set of versions `v` such that some node in `G` (reachable from `M`) requires `m` at `v`.

The **build list** `B` is defined by:

> For each module path `m` reachable from `M`, `B(m) = max(Req(m))` under module version ordering.

Properties that follow:

- **Existence/uniqueness.** Every reachable `m` has a non-empty `Req(m)` (it is reachable because something requires it), so `max` is defined and unique.
- **Minimality.** `B` is the pointwise-minimum assignment satisfying every floor: any lower version for some `m` would violate a `require` edge. Hence "minimal version selection."
- **Monotonicity.** Adding an edge can only enlarge some `Req(m)`, so `B(m)` can only increase. Selection never decreases under added requirements.
- **No upper bounds.** `require` expresses only `>=`. There is no `<` constraint in the model, so the max always exists and resolution never fails for lack of a satisfying assignment.

The graph itself is built by transitive closure: start from `M`'s requirements, fetch each required module's `go.mod`, add its edges, repeat to a fixpoint. Pruning (below) restricts *which* edges are followed without changing `B` for a tidy module.

---

## The Four Operations in Pseudocode

The reusable implementation is `golang.org/x/mod/mvs`. Its interface takes a `Reqs` object that can list a module's requirements and order versions. Paraphrased shapes:

### Build List

```go
// BuildList returns the selected version of every module reachable from target.
func BuildList(target Version, reqs Reqs) ([]Version, error) {
    selected := map[string]string{} // module path -> max version seen
    var visit func(v Version) error
    visit = func(v Version) error {
        if cur, ok := selected[v.Path]; ok && cmp(cur, v.Version) >= 0 {
            return nil // already have an equal-or-higher floor
        }
        selected[v.Path] = max(selected[v.Path], v.Version)
        deps, err := reqs.Required(v) // read v's go.mod requires
        if err != nil { return err }
        for _, d := range deps {
            if err := visit(d); err != nil { return err }
        }
        return nil
    }
    visit(target)
    return sortedFrom(selected), nil
}
```

A traversal keeping the max version per path. Linear in the number of edges visited.

### Upgrade-One

```go
// Upgrade raises target's requirement on `m` to version `v` (v higher),
// then recomputes, pulling in m@v's own requirements.
func Upgrade(target Version, reqs Reqs, m, v string) ([]Version, error) {
    // Add/replace the floor m>=v among target's requirements,
    // then BuildList over the modified requirement set.
    upgraded := withRequirement(target, reqs, m, v)
    return BuildList(target, upgraded)
}
```

### Upgrade-All

```go
// UpgradeAll raises every module in the build list to its latest version.
func UpgradeAll(target Version, reqs Reqs) ([]Version, error) {
    list, _ := BuildList(target, reqs)
    bumped := target
    for _, mod := range list {
        latest, _ := reqs.Latest(mod.Path) // newest available tag
        bumped = withRequirement(bumped, reqs, mod.Path, latest.Version)
    }
    return BuildList(bumped, bumped reqs)
}
```

### Downgrade

```go
// Downgrade lowers m to at most v by lowering every module that
// requires m above v, recursively, then recomputing.
func Downgrade(target Version, reqs Reqs, m, v string) ([]Version, error) {
    // For each module x in the build list whose go.mod requires m > v,
    // find the highest version of x that does NOT require m > v
    // (possibly x@none = removed), and constrain x to it.
    // Repeat to a fixpoint, then BuildList.
    ...
}
```

Downgrade is the only operation that searches *backwards* through the graph and consults the *version history* of requiring modules. The others move forward and need only each node's current requirements.

---

## Build List Construction Step by Step

Work a concrete example. Main module `M`:

```
M       requires A v1.1, B v1.2
A v1.1  requires C v1.3
B v1.2  requires C v1.4, D v1.2
C v1.3  requires (nothing)
C v1.4  requires (nothing)
D v1.2  requires E v1.0
E v1.0  requires (nothing)
```

Traversal from `M`, tracking `selected`:

1. Visit `M`. Requirements: `A v1.1`, `B v1.2`. `selected = {A:1.1, B:1.2}`.
2. Visit `A v1.1`. Requires `C v1.3`. `selected += {C:1.3}`.
3. Visit `C v1.3`. No requirements.
4. Visit `B v1.2`. Requires `C v1.4`, `D v1.2`. `C`: max(1.3, 1.4)=1.4. `selected = {A:1.1, B:1.2, C:1.4, D:1.2}`.
5. Visit `C v1.4`. No requirements.
6. Visit `D v1.2`. Requires `E v1.0`. `selected += {E:1.0}`.
7. Visit `E v1.0`. No requirements. Fixpoint.

Build list: `M, A v1.1, B v1.2, C v1.4, D v1.2, E v1.0`. Verify:

```bash
$ go list -m all
M
A v1.1.0
B v1.2.0
C v1.4.0   # max of {1.3 from A, 1.4 from B}
D v1.2.0
E v1.0.0
```

The only contested module is `C`, requested at `v1.3` and `v1.4`; the max, `v1.4`, wins. Everything else has a single floor and is selected trivially.

---

## Upgrade-One and Requirement Tightening

`go get C@v1.6.0` runs upgrade-one. Mechanically:

1. Resolve `v1.6.0` to a concrete version (here, already concrete; `@latest` would query the proxy for the newest tag).
2. Read `C v1.6.0`'s `go.mod` to obtain *its* requirements — say `C v1.6.0` now requires `E v1.5.0`.
3. Add `C >= v1.6.0` to `M`'s requirements. This also introduces `E v1.5.0` as a transitive floor.
4. Recompute the build list. `C` becomes `v1.6.0`; `E` rises from `v1.0.0` to `v1.5.0` because `C v1.6.0` floors it there.
5. Rewrite `go.mod`: `C`'s require line is updated; `E`'s indirect floor is raised. `go.sum` gains hashes for the new versions.

The non-local effect — `E` moving because `C` moved — is the *requirement-tightening* property. You cannot adopt `C v1.6.0` without satisfying `C v1.6.0`'s own minimums. The toolchain reports such cascades. This is why "I only upgraded C" can produce a multi-line `go.mod` diff.

`go get -u C` extends this: after flooring `C` at latest, it also raises `C`'s dependencies to *their* latest, recursively — a scoped upgrade-all rooted at `C`.

---

## Downgrade and Reverse Propagation

Downgrade is the algorithmically interesting operation. To lower `C` to `v1.3.0` in the example above (where `B v1.2` requires `C v1.4`):

1. Identify every module in the build list whose `go.mod` requires `C` at a version `> v1.3.0`. That is `B v1.2` (requires `C v1.4`).
2. For each such module, find the *highest* version that does **not** require `C > v1.3.0`. Inspect `B`'s version history: suppose `B v1.1` requires only `C v1.0`. Then `B` is constrained to `v1.1`.
3. If no such version exists (every `B` ever published requires `C v1.4+`), the downgrade can only proceed by removing `B` (`B@none`). The toolchain will report this; you decide whether dropping `B` is acceptable.
4. Repeat the search to a fixpoint (lowering `B` might itself relax other floors), then recompute the build list.

```bash
$ go get C@v1.3.0
go: downgraded B v1.2.0 => v1.1.0
```

The defining contrast with upgrade: upgrade reads each node's *current* requirements and moves forward; downgrade must enumerate the *version history* of every requiring module and search backward for a version that releases the constraint. This is why downgrade is slower, can surprise (cascading other modules down), and is the operation most likely to fail to achieve exactly what you asked without `exclude`/`replace`.

`x/mod/mvs.Downgrade` implements precisely this reverse search; reading it is the fastest way to understand the propagation rules exactly.

---

## Module Graph Pruning (`go 1.17+`)

The naive build-list algorithm loads the *entire* transitive module graph — every `go.mod` of every reachable module. For deep graphs this is expensive and pulls in `go.mod` files for modules that provide no package your build imports.

Pruning, enabled when the main module's `go` directive is `1.17+`, reduces the graph's scope:

- The pruned graph includes the main module's requirements and the **transitive requirements of each dependency that itself declares `go 1.17+`**, but for those dependencies it follows only the requirements needed to provide packages *actually imported* by the main module's build — not their full transitive closure.
- Dependencies on a pre-1.17 `go` directive are loaded fully (the toolchain cannot trust them to record a pruned-complete `go.mod`).

To preserve correctness, a pruned main module's `go.mod` must list, as explicit `// indirect` requires, **every module in the build list** — so the build list is computable from the main `go.mod` alone without walking the unpruned graph. This is exactly why a tidied `go 1.17+` module has many more `// indirect` lines than a `go 1.16` one.

The critical invariant: **pruning changes the graph scope MVS walks, not the build list it produces** (for a correctly-tidied module). The selected versions are identical; the work to compute them shrinks. `go mod graph` reflects the pruned graph, so it shows fewer deep edges under 1.17+.

---

## Lazy Module Loading

Complementing pruning, **lazy module loading** (also `go 1.17+`) defers reading a module's requirements until a package from it is actually needed by the build. Combined with pruning:

- A plain `go build` of a few packages loads only the `go.mod` files on the import path of those packages, plus the main module's pinned build list — not the whole graph.
- Commands that *need* the full graph (`go mod graph`, `go get`, `go mod tidy`) still load more, but bounded by pruning.

The effect: the common case (build, test, run a subset of packages) touches a minimal set of `go.mod` files. The build list is read from the main module's `go.mod` (which pins it) rather than recomputed from a full traversal. This is the engineering that makes MVS scale to large monorepos without paying graph-load cost on every command.

For tooling authors: do not assume `go mod graph` shows every module in existence under your dependencies — under pruning/laziness it shows the *relevant* graph. To enumerate the build list, use `go list -m all`, which reports the selection directly.

---

## Version Ordering: SemVer, Pseudo-Versions, `+incompatible`

MVS's `max` requires a total order on versions. The module version ordering is semantic-version precedence with module-specific rules:

- **Release versions** order by SemVer: `v1.2.0 < v1.2.1 < v1.3.0 < v2.0.0` (major, then minor, then patch).
- **Pre-release versions** (`v1.2.0-rc.1`) sort *before* their release (`v1.2.0-rc.1 < v1.2.0`), per SemVer.
- **Pseudo-versions** encode an untagged commit: `v0.0.0-20230615120000-abcdef123456` = base version, UTC commit timestamp, 12-hex commit prefix. They sort by the embedded base version and timestamp, slotting deterministically between real tags. MVS compares them like any other version — a pseudo-version can be a floor and can be selected.
- **`+incompatible`** marks a `v2+` module that does **not** use the `/vN` path suffix (typically pre-modules code with a `v2.0.0` tag but no module-aware `go.mod`). The version is `v2.0.0+incompatible`; the `+incompatible` build metadata is *ignored for precedence* but is part of the canonical version string. MVS handles it as `v2.0.0` for ordering while keeping the suffix in the recorded floor.

Two professional consequences:

- A module's `/vN` suffix makes it a *distinct module path*. `example.com/foo` and `example.com/foo/v2` have separate `Req` sets and separate selected versions; they never combine into one `max`. `+incompatible` is the legacy fallback when a `v2+` author never adopted the suffix.
- Pseudo-versions are normal inputs. Tooling that parses versions must use `golang.org/x/mod/semver` and `module.Version` comparison, never naive string compare, or it will misorder pseudo-versions and pre-releases.

---

## `replace`, `exclude`, `retract` in the Algorithm

Where each directive enters MVS:

- **`replace`** is applied when *reading a module's source and `go.mod`*. For the main module, a `replace m => m' v'` (or `=> ../path`) means: when MVS would load `m`, it loads the replacement instead, and the replacement's version/requirements feed the graph. The selected "version" of `m` is then governed by the replacement, not the original graph floor. `replace` directives are honoured **only for the main module**; ignored when the module is a dependency.
- **`exclude`** removes a specific `(m, v)` from `Req(m)` *before* taking the max. If the excluded version was the max, MVS selects the next-highest required version. Also main-module-only.
- **`retract`** does **not** affect the retracting module's own selection. It is metadata read by *downstream* `go get`/`go list -m -u -retracted`, causing them to warn and avoid the retracted version when choosing floors. It shapes future graphs, not the current build list of the module declaring it.

Order of application for the main module: resolve `replace` (substitute source/version), apply `exclude` (drop candidates), then run MVS `max` over the remaining requirement set. `retract` is consulted by `go get` when picking versions to *write*, not by the build-list computation itself.

---

## Programmatic Inspection

Tooling should *observe* MVS via the toolchain, not re-implement it.

### `go list -m -json all`

The build list as structured JSON. Each record carries `Path`, `Version`, `Replace`, `Indirect`, `Main`, and (with `-u`) `Update`:

```bash
go list -m -json all | jq -r 'select(.Main != true) | "\(.Path) \(.Version)\(.Indirect|if . then " (indirect)" else "" end)"'
```

This is the authoritative way to enumerate selected versions in MVS order, post-pruning.

### `go mod graph`

The (pruned) requirement edges — the MVS *input*. Use it to find every floor for a module:

```bash
go mod graph | awk -F'@' '/ golang.org\/x\/sys@/ {print $NF}' | sort -V | tail -1
# the highest required version == the selected one
```

### `golang.org/x/mod/mvs` and friends

For deep tooling, `x/mod/mvs` provides `BuildList`, `Req`, `Upgrade`, `Downgrade` against a `Reqs` interface you supply (backed by `x/mod/modfile` for parsing and `x/mod/semver`/`module` for ordering). The toolchain itself uses these, so reusing them yields identical results — but driving the `go` command and parsing its output is simpler and less likely to drift across releases.

```go
data, _ := os.ReadFile("go.mod")
f, _ := modfile.Parse("go.mod", data, nil)
for _, r := range f.Require {
    fmt.Println(r.Mod.Path, r.Mod.Version, r.Indirect)
}
```

### When to shell out vs. link the library

Re-implementing the full build-list computation (with pruning, replace/exclude, version ordering) is brittle and version-sensitive. Prefer `go list -m -json all` for the result and `go mod graph` for the input; link `x/mod/mvs` only when you need to *simulate* an operation (e.g. "what would upgrading X do?") without mutating the repo.

---

## Performance Profile

MVS selection is `O(edges)` — a single traversal taking a max per path. It is never the bottleneck. The costs are:

| Phase | Cost driver | Mitigation |
|-------|-------------|-----------|
| Graph loading | Number of `go.mod` files fetched | Module graph pruning + warm cache |
| Version resolution (`@latest`) | Proxy queries for tag lists | Cache; avoid `@latest` in hot paths |
| Downgrade search | Version history of requiring modules | Rare; inherent to the operation |
| Build-list materialisation | Reading the main module's pinned requires | Cheap; pinned in `go.mod` under 1.17+ |

| Scenario | Pre-1.17 (full graph) | 1.17+ (pruned + lazy) |
|----------|----------------------|------------------------|
| `go build` subset | Loads full transitive graph | Loads import-path `go.mod`s + pinned list |
| `go list -m all` | Full traversal | Reads pinned build list |
| `go mod graph` | Full graph | Pruned graph |
| `go get` / `tidy` | Full graph | Pruned graph (bounded) |

The headline: pruning and laziness convert "load hundreds of `go.mod` files on every command" into "load only what this command needs." On a large monorepo this is the difference between sub-second and multi-second module operations. Pinning the `go` directive at 1.17+ is the single highest-leverage MVS performance action.

---

## Edge Cases the Source Reveals

Reading `cmd/go/internal/modload` and `x/mod/mvs` exposes corners most users never hit:

- **`require` cycles.** Module graphs can contain cycles (A requires B, B requires A at some versions). MVS's traversal handles them via the visited/selected map; the max is still well-defined.
- **A module required at a pseudo-version *and* a release.** Both are in `Req(m)`; the max under version ordering wins, which may be the pseudo-version if its embedded timestamp is later than the release — surprising but correct.
- **`+incompatible` vs `/v2`.** If both `example.com/foo v2.0.0+incompatible` and `example.com/foo/v2 v2.0.1` appear, they are *different modules* (different paths) and both can be selected — a sign of an in-progress migration; audit with `go mod why`.
- **`exclude` of the *only* available version.** If every required version of `m` is excluded, the build fails to resolve `m` — the one way to manufacture an unsatisfiable case in MVS.
- **`replace` to a local path with its own requirements.** The local module's `go.mod` requirements feed the graph; a local fork can raise floors for other modules unexpectedly.
- **Retracted version selected.** MVS *will* select a retracted version if it is the max floor and nothing avoids it; only `go get`/`tidy` surface the retraction warning. Reproducibility wins over the retraction signal at build time.
- **Pruning boundary mismatch.** A dependency declaring `go 1.16` inside a `go 1.17+` main module is loaded fully; mixing old and new `go` directives changes graph scope (not the result).

These are pointers to *reach for the source* when a version selection defies the one-line rule. The implementation is small and well-commented; the surprises are always in graph scope, downgrade propagation, or version ordering — never in the `max` itself.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| See the selected version of a module | `go list -m example.com/foo` |
| See every floor for a module | `go mod graph \| grep 'example.com/foo@'` |
| Find who forces a high version | `go mod why -m example.com/foo`; inspect graph for the high floor |
| Upgrade one dependency | `go get example.com/foo@v1.5.0 && go mod tidy` |
| Upgrade all (minor/patch) | `go get -u ./... && go mod tidy` |
| Upgrade patch-only (conservative) | `go get -u=patch ./... && go mod tidy` |
| Downgrade a dependency | `go get example.com/foo@v1.3.0`; read the cascade report |
| Skip a known-bad version | Add `exclude example.com/foo v1.4.2`; `go mod tidy` |
| Substitute a fork | Add `replace example.com/foo => example.com/foo v1.4.1-fix`; `go mod tidy` |
| Speed up module operations | Set `go` directive to 1.17+ for pruning; `go mod tidy` |
| Diagnose "wrong version selected" | Compare `go mod graph` (floors) to `go list -m all` (result) |
| Detect available updates without applying | `go list -m -u all` |
| Find retracted selected versions | `go list -m -u -retracted all` |
| Enumerate build list as data | `go list -m -json all` |

---

## Summary

MVS is a precisely-specified set of four algorithms over a versioned requirement graph: **build list** (`max` of required versions per module — a linear traversal, minimal and monotone, never unsatisfiable because there are no upper bounds), **upgrade-one** (raise a floor and tighten via the upgraded module's own requirements), **upgrade-all** (raise every floor to latest), and **downgrade** (the hard, backward-searching operation that lowers a module by lowering every module whose history forced it higher). The selection rule is one line; the engineering subtlety lives in downgrade's reverse propagation and in graph scope.

Two `go 1.17+` mechanisms — **module graph pruning** (restrict the graph to requirements needed for actually-imported packages, pinning the full build list as `// indirect` requires) and **lazy module loading** (defer reading `go.mod` files until a package is needed) — change *how much graph MVS walks*, not *what it selects*. They are the difference between MVS scaling and not scaling on large monorepos, and pinning the `go` directive to a current version is the highest-leverage performance action.

Around the core sit version ordering (SemVer plus pseudo-versions and `+incompatible`, which demand the real `x/mod/semver` comparator), and the directives that enter the algorithm at defined points (`replace` substitutes source for the main module, `exclude` drops a candidate before the max, `retract` shapes downstream graphs). The professional discipline is to *observe* MVS through `go list -m -json all` and `go mod graph`, and to link `x/mod/mvs` only to *simulate* operations — never to re-implement a rule whose simplicity is the entire point, while remembering that the complexity that does exist sits in graph scope and downgrade, not in the maximum.
