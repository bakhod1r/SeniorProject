# Minimal Version Selection (MVS) — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Module Graph: MVS's Input](#the-module-graph-mvss-input)
3. [The Build List: MVS's Output](#the-build-list-mvss-output)
4. [The Selection Rule, Stated Precisely](#the-selection-rule-stated-precisely)
5. [The Four MVS Operations](#the-four-mvs-operations)
6. [`go get` and How It Drives MVS](#go-get-and-how-it-drives-mvs)
7. [Upgrades: One and All](#upgrades-one-and-all)
8. [Downgrades and Their Propagation](#downgrades-and-their-propagation)
9. [`// indirect` Requirements and Why They Exist](#indirect-requirements-and-why-they-exist)
10. [The `go` Directive and Module Graph Pruning](#the-go-directive-and-module-graph-pruning)
11. [Inspecting Selection: `graph`, `list -m`, `why`](#inspecting-selection-graph-list-m-why)
12. [`replace` and `exclude` vs MVS](#replace-and-exclude-vs-mvs)
13. [Common MVS Surprises and Their Real Causes](#common-mvs-surprises-and-their-real-causes)
14. [Best Practices](#best-practices)
15. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know the headline: MVS selects the *minimum* version that satisfies every requirement — the highest floor anyone set, never the latest available. The middle-level question is *how the algorithm actually runs*: how it builds the module graph, how it derives the build list from that graph, and how the four operations (build list, upgrade-all, upgrade-one, downgrade) are defined and differ.

This file moves from "what MVS chooses" to "how MVS computes it, and how the everyday commands (`go get`, `go mod tidy`) map onto the formal operations from Russ Cox's design."

After reading this you will:
- Construct the module graph in your head from a set of `go.mod` files
- Derive the build list by hand and verify it with `go list -m all`
- Name and distinguish the four MVS operations
- Predict exactly what `go get foo@v1.5.0`, `go get -u`, and a downgrade do to the build list
- Understand why downgrades are the hard case and what propagation means
- Explain `// indirect` lines and module graph pruning from first principles

---

## The Module Graph: MVS's Input

MVS operates on a directed graph. Each **node** is a `(module, version)` pair. Each **edge** points from a module-version to a module-version it requires.

The graph is built by transitively reading `go.mod` files:

1. Start at the main module's `go.mod`. Each `require` line is an outgoing edge.
2. For each module-version reached, fetch *its* `go.mod`, read *its* `require` lines, add those edges.
3. Repeat until no new nodes appear.

A worked graph. Main module `M` with these `go.mod` files in the graph:

```
M     requires A v1.1, B v1.2
A v1.1 requires C v1.3
B v1.2 requires C v1.4, D v1.2
C v1.3 requires (nothing)
C v1.4 requires (nothing)
D v1.2 requires (nothing)
```

As edges:

```
M    -> A v1.1
M    -> B v1.2
A v1.1 -> C v1.3
B v1.2 -> C v1.4
B v1.2 -> D v1.2
```

Notice that `C` appears as a requirement at two versions: `v1.3` (from A) and `v1.4` (from B). This is the interesting case — MVS must pick one.

The crucial property: an edge `X -> Y v1.4` records the version of `Y` that `X` was *built and tested against*. It is `X`'s declared *minimum*. The graph is a record of "who needs at least what."

---

## The Build List: MVS's Output

The **build list** is the result of running MVS over the graph: exactly one selected version per module.

For the graph above:

```
Module   Versions required        Selected
------   -----------------        --------
A        v1.1                     v1.1
B        v1.2                     v1.2
C        v1.3, v1.4               v1.4   ← max
D        v1.2                     v1.2
```

So the build list is `{A v1.1, B v1.2, C v1.4, D v1.2}` (plus the main module M itself). Confirm with:

```bash
$ go list -m all
M
A v1.1.0
B v1.2.0
C v1.4.0
D v1.2.0
```

The build list is what the compiler actually uses. Every import resolves to a package in one of these selected module versions.

---

## The Selection Rule, Stated Precisely

For each module path `m` that appears anywhere in the graph:

> **selected(m) = the maximum version v such that some edge in the graph requires `m` at `v`.**

"Maximum" is by semantic-version ordering (with pseudo-versions and `+incompatible` slotted in by the standard module version comparison). There is no minimum-bound, no range, no upper limit — only "at least this much," combined by taking the max.

Two consequences worth stating explicitly:

- **A version is selected only if it is named.** MVS never invents `v1.5.0` because it is "newer." It only ever selects a version that some `go.mod` literally wrote down. The build list is always a subset of the versions present in the graph.
- **Selection is monotone.** Adding a requirement can only *raise* a selected version, never lower it. This is what makes the algorithm composable and the build list stable.

This is the property that earns MVS its name: among all version assignments that satisfy every floor, it picks the *minimal* one. Any lower version would violate some floor; any higher version is unnecessary.

---

## The Four MVS Operations

Russ Cox's design defines MVS as four related algorithms. The everyday `go` commands are thin wrappers over them.

### 1. Build List (the base operation)

**Input:** the main module's requirements (its `go.mod`).
**Output:** the build list — one version per module.

Algorithm: do a graph traversal from the main module, following requirement edges, and for each module keep the maximum version seen. The result is the build list. This runs implicitly on every `go build`.

### 2. Upgrade All

**Input:** the build list plus "use the latest version of every module."
**Output:** a new requirement set where every module's floor is raised to its latest available version.

This is what `go get -u` (or `go get -u ./...`) does conceptually: it raises every direct (and, with `-u`, indirect) floor to the newest release, then recomputes the build list. It is the operation that *moves you forward* across the whole graph.

### 3. Upgrade One

**Input:** the build list plus "use version `v` of module `m`."
**Output:** a requirement set that floors `m` at `v`, leaving everything else as low as MVS allows.

This is `go get m@v`. The subtlety: raising `m` to `v` may *pull in new requirements* (because `m@v`'s `go.mod` requires newer versions of other modules), which can raise *those* floors too. Upgrade-one is local in intent but can ripple.

### 4. Downgrade

**Input:** the build list plus "use version `v` of module `m`, where `v` is *lower* than currently selected."
**Output:** a requirement set in which `m` is at most `v`, achieved by *removing or lowering* the requirements of any module that forced `m` higher.

This is `go get m@v` where `v` is older. It is the hard operation. To make `m` lower, MVS must find every module in the graph that requires `m` at a version higher than `v`, and downgrade *those* modules to versions that no longer require the higher `m`. The downgrade *propagates* outward. (Details in the [Downgrades](#downgrades-and-their-propagation) section.)

The asymmetry is the key insight: **upgrading is easy** (raise a floor, recompute the max), **downgrading is hard** (you must unwind every requirement that forced the higher version).

---

## `go get` and How It Drives MVS

`go get` is the user-facing entry point that triggers upgrade-one or downgrade. Its behaviour by argument:

| Command | MVS operation | Effect |
|---------|---------------|--------|
| `go get foo@v1.5.0` | upgrade-one (if higher) or downgrade (if lower) | Floors `foo` at `v1.5.0`; recomputes build list. |
| `go get foo@latest` | upgrade-one | Resolves `latest` to the newest tag, then floors `foo` there. |
| `go get foo@v1.5.0 bar@v2.0.0` | multiple upgrade-ones | Applies several floor changes, then one build-list recompute. |
| `go get -u foo` | upgrade-one + transitive upgrade | Raises `foo` *and* its dependencies to latest. |
| `go get -u ./...` | upgrade-all (scoped) | Raises every dependency of the listed packages. |
| `go get foo@none` | downgrade/remove | Removes the requirement on `foo` entirely. |

After any `go get`, the `go.mod` `require` lines are rewritten to express the new floors, and `go.sum` is updated with hashes for any newly-introduced versions. The selected version you end up with is the *MVS result*, which may exceed what you typed if a higher floor exists.

```bash
$ go get golang.org/x/text@v0.3.0
$ go list -m golang.org/x/text
golang.org/x/text v0.9.0     # a dependency floors it higher; you got v0.9.0
```

This is why "I asked for v0.3.0 but got v0.9.0" is not a bug — it is MVS selecting the max of the floors, one of which is higher than your request.

---

## Upgrades: One and All

### Upgrade-one in detail

`go get foo@v1.5.0` does more than edit one line. The toolchain:

1. Resolves `v1.5.0` to a concrete version (already concrete here; `@latest` would resolve to a tag).
2. Reads `foo@v1.5.0`'s `go.mod` to learn *its* requirements.
3. Adds `foo`'s requirements as new floors if they exceed current ones — this can transitively raise other modules.
4. Recomputes the build list.
5. Runs the equivalent of `go mod tidy`'s bookkeeping to add `// indirect` lines for any newly-needed floors.

So upgrading `foo` can quietly upgrade `bar` too, if `foo@v1.5.0` requires a newer `bar` than was previously selected. This is correct and expected: you cannot use `foo@v1.5.0` without satisfying *its* minimums.

### Upgrade-all (`go get -u`)

`go get -u ./...` raises the floor of every module reachable from your packages to its latest release, then recomputes. This is the deliberate "move everything forward" operation. Variants:

```bash
go get -u ./...           # latest minor/patch of all dependencies
go get -u=patch ./...     # latest patch only (stay on current minor)
```

`-u=patch` is the conservative choice: it picks up bug-fix releases without crossing minor-version boundaries, which lowers the risk of behavioural change. Both are *deliberate* — neither happens on a plain build.

---

## Downgrades and Their Propagation

Downgrading is where MVS earns its complexity. Suppose:

```
M -> A v1.2   (and A v1.2 -> C v1.5)
M -> C v1.1
selected C = v1.5   (A forced it up)
```

You want `C v1.3`. Simply writing `require C v1.3` does nothing — `A v1.2` still floors `C` at `v1.5`, and MVS picks the max. To actually get `C v1.3`, the downgrade operation must:

1. Find every module whose `go.mod` requires `C` at a version > `v1.3`. Here, that is `A v1.2`.
2. Downgrade *those* modules to the newest version of each that does **not** require `C > v1.3`. Perhaps `A v1.1` requires only `C v1.0` — so MVS downgrades `A` to `v1.1`.
3. Recompute. Now nothing forces `C` above `v1.3`, so `C v1.3` is selected.

This is **propagation**: lowering one module's selected version can force *other* modules down. `go get C@v1.3` performs this automatically, and you may be surprised to see `A` change too.

```bash
$ go get C@v1.3.0
go: downgraded A v1.2.0 => v1.1.0
```

The toolchain reports the cascade. If *no* older version of `A` exists that drops its `C` requirement, the downgrade may not be achievable without removing `A` entirely — at which point you either accept the higher `C`, or use `exclude`/`replace`.

The takeaway: **downgrades are graph-wide, not local.** Upgrading touches a floor and recomputes; downgrading must search the version history of *requiring* modules to undo a floor.

---

## `// indirect` Requirements and Why They Exist

A `require` line marked `// indirect` is a floor for a module your own code does not import directly. Two reasons it appears:

1. **Floor-raising for reproducibility.** In a fully tidied `go.mod`, every module in the build list that is *not* a direct import gets an explicit `// indirect` require, recording the exact version MVS selected. This makes the build list reconstructible from the main module's `go.mod` alone, without walking the whole graph — essential for graph pruning (next section).
2. **Overriding a transitive floor.** Sometimes you need a transitive dependency at a higher version than any of your direct dependencies require (e.g., to pick up a security fix). You add an explicit `// indirect` floor to raise it. MVS treats it like any other floor.

`go mod tidy` manages these lines: it adds the indirect requires needed to pin the build list, and removes ones that are no longer necessary. You should not hand-edit them; tidy keeps them correct.

A subtle point: for modules with `go 1.17+`, `go mod tidy` records *all* the build-list versions as indirect requires (the "module graph is in go.mod" property). For older `go` directives, only some indirect requires appear. This is the visible effect of pruning.

---

## The `go` Directive and Module Graph Pruning

The `go` directive in `go.mod` (e.g. `go 1.22`) is not just a language-version marker — it controls *how much of the module graph MVS loads*.

### Before pruning (`go 1.16` and earlier)

MVS loaded the **complete transitive module graph**: every `go.mod` of every module reachable from yours, however deep. For large dependency trees this meant fetching hundreds of `go.mod` files just to compute the build list.

### With pruning (`go 1.17+`)

When the main module's `go` directive is `1.17` or higher, MVS uses a **pruned module graph**. The rule: the graph includes the transitive requirements of dependencies that *also* declare `go 1.17+`, but for those that do, it only follows the requirements needed to provide packages actually imported by the main module's build — not their entire transitive closure.

To make this work, the main module's `go.mod` must list (as `// indirect` requires) every module in the build list, so the build list is computable from `go.mod` alone without walking the full graph. That is why a tidied `go 1.17+` module has more `// indirect` lines than an old one did.

The *result* of MVS — the selected versions — is the same for a correctly-tidied module. Pruning changes *how much work* MVS does to compute it, not *what it computes*. The practical effect is faster graph loading and fewer surprises from deep, irrelevant dependencies.

You will see this in `go mod graph`: a pruned graph is smaller, showing fewer deep edges than the full transitive set.

---

## Inspecting Selection: `graph`, `list -m`, `why`

Three commands let you observe MVS at every level.

### `go mod graph` — the input

Prints every requirement edge `A B`, meaning "module-version A requires module-version B."

```bash
$ go mod graph
example.com/app github.com/spf13/cobra@v1.8.0
github.com/spf13/cobra@v1.8.0 github.com/spf13/pflag@v1.0.5
github.com/spf13/cobra@v1.8.0 golang.org/x/sys@v0.0.0-...
```

To find every floor for one module:

```bash
go mod graph | grep 'golang.org/x/sys@'
```

The right-hand versions are the floors; the selected version is their max.

### `go list -m all` — the output

Prints the build list: the selected version per module.

```bash
go list -m all
```

Add `-versions` to see *available* versions of a module (candidates for a new floor):

```bash
go list -m -versions golang.org/x/sys
```

Add `-u` to annotate which selected versions have newer releases available (without changing anything):

```bash
$ go list -m -u all
golang.org/x/sys v0.15.0 [v0.18.0]   # [..] = a newer version exists
```

### `go mod why` — the justification

Explains *why* a module is in the build at all, by printing the shortest import chain that reaches it.

```bash
$ go mod why -m golang.org/x/sys
# golang.org/x/sys
example.com/app
github.com/spf13/cobra
golang.org/x/sys/unix
```

If `go mod why` prints `(main module does not need module ...)`, the module is in the graph as a floor but no package actually imports it — a candidate for `go mod tidy` to prune.

---

## `replace` and `exclude` vs MVS

Two directives let you override MVS's normal computation. They are covered fully in the next topic; here is how they interact with selection.

### `exclude`

```
exclude golang.org/x/text v0.5.0
```

Tells MVS to *skip* a specific version when selecting. If `v0.5.0` would have been the selected version, MVS picks the next-highest required version instead. `exclude` only affects the main module's selection; it is ignored when your module is a dependency of someone else's.

### `replace`

```
replace golang.org/x/text => golang.org/x/text v0.9.0
replace example.com/foo => ../local-fork
```

Tells the build to *substitute* a different module or version entirely, bypassing the graph's version for that path. With `replace`, the selected version is whatever the replacement says — MVS no longer governs it. Like `exclude`, `replace` in your `go.mod` applies only when you are the main module.

The mental model: MVS computes a selection from the graph; `exclude` removes a candidate from that computation; `replace` overrides the result outright. Both are escape hatches — reach for them only when the graph cannot express what you need (a bad version to avoid, a fork to substitute).

---

## Common MVS Surprises and Their Real Causes

### "I downgraded a direct dependency but the build list didn't change."

A transitive dependency floors it higher. Lowering *your* require below another floor does nothing — MVS picks the max. Find the higher requirer: `go mod graph | grep mod@`. To actually lower it, you need a downgrade (`go get mod@older`, which may cascade) or `exclude`/`replace`.

### "`go get foo@v1.5.0` also changed bar's version."

`foo@v1.5.0`'s `go.mod` requires a newer `bar` than was selected. Upgrade-one pulls in the upgraded module's own minimums. This is correct: you cannot run `foo@v1.5.0` without satisfying its floors.

### "My `go.mod` grew a dozen `// indirect` lines after upgrading."

For `go 1.17+`, the full build list is pinned as indirect requires (pruning requirement). Upgrading reshaped the build list, so the indirect lines were rewritten. `go mod tidy` keeps them minimal and correct.

### "Two versions of the same import path are in my build."

You have both `foo` and `foo/v2` (or higher). They are *different modules* with different import paths; MVS selects one version of each independently. No conflict.

### "A version like `v0.0.0-2023...-abc123` appeared."

A dependency requires an untagged commit, expressed as a pseudo-version. MVS compares it normally. It is the floor that module set; not an anomaly.

---

## Best Practices

1. **Read the graph, not just the list, when debugging versions.** `go mod graph` shows the floors; `go list -m all` shows the result. Surprises live in the gap between them.
2. **Upgrade deliberately and incrementally.** Prefer `go get -u=patch ./...` for routine maintenance; reserve full `-u` for intentional minor bumps. Always retest.
3. **Let `go mod tidy` own the `// indirect` lines.** Never hand-edit them. Run tidy after every `go get`.
4. **Pin the `go` directive to a current version (1.17+).** You get module graph pruning, faster graph loading, and a `go.mod` that pins the full build list.
5. **Use `exclude` only to skip a known-bad version, not to "downgrade."** For substitutions, use `replace` and document why.
6. **Verify the selected version after upgrade-one.** `go list -m foo` tells you what MVS actually chose, which may exceed your request.
7. **When a downgrade cascades, read the toolchain's report.** It tells you which other modules it had to lower; decide whether that is acceptable.
8. **Capture `go list -m all` at release tags** as a deterministic manifest of what shipped.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — Trying to downgrade by editing `go.mod` by hand

You lower a `require` version and the build list ignores you. A higher floor wins. Use `go get mod@older` (which performs the real downgrade and propagation) instead.

### Pitfall 2 — Assuming `go get foo` (no version) upgrades foo

Without `-u`, `go get foo` adds `foo` at its current/latest tag but does not upgrade *foo's* dependencies. To move foo and its tree forward, use `go get -u foo`. To just add a dependency, `go mod tidy` after importing is cleaner.

### Pitfall 3 — Surprised that `go build` never changes versions

A plain build is read-only with respect to `go.mod` (since Go 1.16, `-mod=readonly` is the default). It computes the build list from existing floors and never raises them. All upgrades are explicit `go get`/`tidy` operations.

### Pitfall 4 — Mistaking the module graph size for the build list size

`go mod graph` can list a module at several versions (every floor anyone set). `go list -m all` lists it once (the selected max). Counting graph edges as "dependencies" overcounts.

### Pitfall 5 — Forgetting that `replace`/`exclude` only apply to the main module

You add an `exclude` in a library, publish it, and a consumer ignores it. By design: those directives are honoured only for the *main* module of a build. Document this so consumers are not surprised.

### Pitfall 6 — Pruned graph hiding a deep transitive dependency

Under `go 1.17+` pruning, `go mod graph` may not show a deep dependency that is not in your build's import path. That is correct — it is not part of your pruned graph. If you need it, import it (and tidy will floor it).

### Pitfall 7 — Major-version mismatch giving "ambiguous import"

You import `foo` but a dependency moved to `foo/v2`. Both can be selected, and an import without the `/v2` suffix may resolve ambiguously. Fix the import path to name the major version you mean.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Build a module graph by hand from a set of `go.mod` files
- [ ] Derive the build list from that graph (max version per module) and verify with `go list -m all`
- [ ] State the selection rule precisely and explain why it earns the name "minimal"
- [ ] Name the four MVS operations and map `go get`/`go get -u` onto them
- [ ] Explain why upgrading is easy and downgrading is hard, including propagation
- [ ] Predict what `go get foo@v1.5.0` does to *other* modules' versions
- [ ] Explain `// indirect` requirements and why `go 1.17+` has more of them
- [ ] Explain module graph pruning and that it changes work, not the result
- [ ] Use `graph`, `list -m`, and `why` to debug a version surprise
- [ ] Describe how `replace` and `exclude` override MVS, and that they apply only to the main module

---

## Summary

MVS runs over a **module graph** — nodes are `(module, version)` pairs, edges are `require` floors — and produces a **build list** with one selected version per module, computed as the *maximum version any edge required*. That rule is the whole algorithm: selection is monotone, a version is selected only if some `go.mod` named it, and the result is the minimal assignment that satisfies every floor.

The design is four operations: **build list** (compute the selection), **upgrade-one** (raise one floor, possibly rippling), **upgrade-all** (raise every floor to latest), and **downgrade** (the hard one — lower a floor by *propagating* downgrades to every module that forced it higher). `go get` and `go get -u` are the user-facing wrappers; plain `go build` never changes anything.

Around the core sit the practical mechanics: `// indirect` lines that pin the build list (more of them under `go 1.17+` because of module graph pruning), the `go` directive that controls how much graph MVS loads, the inspection commands (`graph`, `list -m`, `why`) that let you see input, output, and justification, and the `replace`/`exclude` escape hatches that override selection for the main module only. Master the gap between the graph (all floors) and the list (the selected max), and every "why that version?" question answers itself.
